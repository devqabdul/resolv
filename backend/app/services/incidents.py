"""Incident clustering (docs/02 §8): group tickets by ledger signature, draft one notice each."""

import json
from datetime import timedelta
from typing import Any

from sqlalchemy import func, select

from app.config import settings
from app.db import session
from app.db.models import Incident, IncidentTicket, Notification, Ticket
from app.domain.enums import AuditKind, HandlingMode, TicketStatus
from app.domain.schemas import IncidentNotice, TicketDTO
from app.integrations.llm.client import LLMClient, load_prompt
from app.services import audit, context
from app.services.tickets import new_id
from app.util.clock import now

FAST_PATH_REPLY = (
    "We've identified an issue affecting {bank} UPI payments and our team is on it. "
    "Your reversal is being processed automatically; no action needed. Ref {incident_id}"
)


def match_open_incident(ticket: TicketDTO) -> Incident | None:
    """Live incident with the ticket's ledger signature; no LLM (docs/02 §8 fast path).

    (decision: T16) COMMUNICATED still matches: the outage is ongoing until RESOLVED.
    """
    if not ticket.signature:
        return None
    with session.SessionLocal() as db:
        return db.scalars(
            select(Incident).where(
                Incident.signature == ticket.signature, Incident.status != "RESOLVED"
            )
        ).first()


def attach_fast_path(ticket: TicketDTO, incident: Incident, run_id: str | None = None) -> str:
    """Attach `ticket` via fast_path, bump the incident, audit; returns the holding reply text."""
    with session.SessionLocal() as db:
        inc = db.get(Incident, incident.id)
        assert inc is not None
        link = db.get(IncidentTicket, (inc.id, ticket.id))  # cluster may have linked it already
        if link is None:
            db.add(IncidentTicket(incident_id=inc.id, ticket_id=ticket.id, via="fast_path"))
        via = link.via if link else "fast_path"
        row = db.get(Ticket, ticket.id)
        if row is not None:
            row.incident_id, row.handling_mode = inc.id, HandlingMode.incident
        db.flush()
        inc.ticket_count = (
            db.scalar(select(func.count()).where(IncidentTicket.incident_id == inc.id)) or 0
        )
        seen = ticket.created_at or now()
        inc.last_seen = max(inc.last_seen or seen, seen)
        db.commit()
    payload = {"incident_id": incident.id, "via": via, "signature": ticket.signature}
    if link is None:
        audit.record(ticket.id, AuditKind.incident_linked, payload, run_id=run_id, actor="system")
    audit.record(ticket.id, AuditKind.incident_fast_path, payload, run_id=run_id)
    _, bank, _ = incident.signature.split("|")
    return FAST_PATH_REPLY.format(bank=bank, incident_id=incident.id)


def signature_for(ticket: TicketDTO, run_id: str | None = None) -> tuple[str | None, str | None]:
    """(candidate_txn_id, signature) from the ledger, no LLM (CLAUDE.md decision 30 Oct)."""
    cand = context.candidate_txn(context.list_ledger(context.get_tools(), ticket, run_id))
    if cand is None:
        return None, None
    return cand.id, f"failed_payment_reversal|{cand.issuer_bank}|{cand.failure_reason}"


def title_for(sig: str) -> str:
    _, bank, reason = sig.split("|")
    return f"UPI failures via {bank} ({reason})"


def notify(target: str, text: str, incident_id: str | None = None) -> None:
    """In-app notification row + audit (decision: T15; Slack lands in T17)."""
    with session.SessionLocal() as db:
        db.add(
            Notification(
                channel="inapp", target=target, text=text, delivered=True, incident_id=incident_id
            )
        )
        db.commit()
    audit.record(
        incident_id or "system",
        AuditKind.notification,
        {"channel": "inapp", "target": target},
        actor="system",
    )


def _draft(sig: str, items: list[Ticket]) -> IncidentNotice:
    _, bank, reason = sig.split("|")
    facts = {
        "signature": sig,
        "issuer_bank": bank,
        "failure_reason": reason,
        "ticket_count": len(items),
        "first_seen": min(t.created_at for t in items).isoformat(),
        "last_seen": max(t.created_at for t in items).isoformat(),
    }
    return LLMClient().structured(
        load_prompt("incident_notice"),
        f"<incident>{json.dumps(facts)}</incident>",
        IncidentNotice,
        settings.LLM_MODEL_DECIDE,
    )


def _fill_signatures(since: Any) -> None:
    """(decision: T15) NEW tickets that have not run ingest yet get their signature here."""
    with session.SessionLocal() as db:
        rows = db.scalars(
            select(Ticket).where(
                Ticket.status == TicketStatus.NEW,
                Ticket.signature.is_(None),
                Ticket.created_at >= since,
            )
        ).all()
        todo = [TicketDTO.model_validate(r, from_attributes=True) for r in rows]
    for t in todo:
        cand, sig = signature_for(t)
        if sig:
            context.update_ticket(t.id, candidate_txn_id=cand, signature=sig)


def cluster() -> list[str]:
    """One clustering pass (docs/02 §8); returns the ids of incidents created this pass."""
    since = now() - timedelta(minutes=settings.INCIDENT_WINDOW_MINUTES)
    _fill_signatures(since)
    with session.SessionLocal() as db:
        rows = db.scalars(
            select(Ticket).where(
                Ticket.signature.is_not(None),
                Ticket.created_at >= since,
                # (decision: T15 — count all tickets in window, not only open; docs/02 §8 to
                # be amended) an outage is an outage even if Resolv already resolved some.
                Ticket.status != TicketStatus.CLOSED,
            )
        ).all()
    groups: dict[str, list[Ticket]] = {}
    for r in rows:
        groups.setdefault(r.signature or "", []).append(r)
    created = []
    for sig, items in groups.items():
        if len(items) >= settings.INCIDENT_THRESHOLD:
            inc_id, new = _attach(sig, items)
            if new:
                created.append(inc_id)
    return created


def _attach(sig: str, items: list[Ticket]) -> tuple[str, bool]:
    """get_or_create the incident for `sig`, attach `items` via cluster; (id, newly created)."""
    live = select(Incident).where(Incident.signature == sig, Incident.status != "RESOLVED")
    with session.SessionLocal() as db:
        new = db.scalars(live).first() is None
    # The LLM call runs outside the write session so SQLite is not locked while it waits.
    note = _draft(sig, items) if new else None
    with session.SessionLocal() as db:
        inc = db.scalars(live).first()
        new = inc is None
        if inc is None:
            inc = Incident(
                id=new_id("inc"),
                signature=sig,
                title=title_for(sig),
                status="OPEN",
                owner_team="payments_ops",
                first_seen=min(t.created_at for t in items),
            )
            db.add(inc)
        have = set(
            db.scalars(select(IncidentTicket.ticket_id).where(IncidentTicket.incident_id == inc.id))
        )
        linked = [t.id for t in items if t.id not in have]
        for tid in linked:
            db.add(IncidentTicket(incident_id=inc.id, ticket_id=tid, via="cluster"))
            row = db.get(Ticket, tid)
            if row is not None:
                row.incident_id, row.handling_mode = inc.id, HandlingMode.incident
        db.flush()
        inc.ticket_count = (
            db.scalar(select(func.count()).where(IncidentTicket.incident_id == inc.id)) or 0
        )
        inc.last_seen = max([inc.last_seen or now(), *(t.created_at for t in items)])
        if note is not None and not inc.proactive_notice_draft:
            inc.proactive_notice_draft = note.proactive_notice_draft
            inc.internal_summary = note.internal_summary
        db.commit()
        inc_id, summary = inc.id, inc.internal_summary or ""
    for tid in linked:
        audit.record(
            tid,
            AuditKind.incident_linked,
            {"incident_id": inc_id, "via": "cluster"},
            actor="system",
        )
    if new:
        notify("#ops", summary, inc_id)
    return inc_id, new


def list_incidents(status: str | None = None) -> list[Incident]:
    q = select(Incident).order_by(Incident.first_seen.desc())
    if status:
        q = q.where(Incident.status == status)
    with session.SessionLocal() as db:
        return [*db.scalars(q)]


def get(incident_id: str) -> dict[str, Any] | None:
    """{incident, tickets, notifications} for GET /api/incidents/{id}."""
    with session.SessionLocal() as db:
        inc = db.get(Incident, incident_id)
        if inc is None:
            return None
        ids = select(IncidentTicket.ticket_id).where(IncidentTicket.incident_id == incident_id)
        tickets = db.scalars(select(Ticket).where(Ticket.id.in_(ids))).all()
        notes = db.scalars(
            select(Notification).where(Notification.incident_id == incident_id)
        ).all()
    return {"incident": inc, "tickets": [*tickets], "notifications": [*notes]}


def send_notice(incident_id: str) -> Incident:
    """Proactive notice to each linked customer via notify_customer; status COMMUNICATED."""
    d = get(incident_id)
    if d is None:
        raise KeyError(f"Incident {incident_id} does not exist.")
    text = d["incident"].proactive_notice_draft or ""
    tools = context.get_tools()
    sent = [t for t in d["tickets"] if t.customer_id]
    for t in sent:
        tools.call(
            "notify_customer", t.id, None, customer_id=t.customer_id, channel=t.channel, text=text
        )
    with session.SessionLocal() as db:
        inc = db.get(Incident, incident_id)
        assert inc is not None
        inc.status, inc.notified_at = "COMMUNICATED", now()
        db.commit()
    audit.record(
        incident_id,
        AuditKind.notification,
        {"channel": "customer", "sent": len(sent)},
        actor="system",
    )
    return inc
