"""SLA guard (docs/02 §9): nudge once, raise to P1 when < nudge_before_breach_minutes remain."""

from datetime import timedelta

from sqlalchemy import select

from app.db import session
from app.db.models import AuditEvent, Notification, Ticket
from app.domain.enums import AuditKind, TicketStatus
from app.policy.rbi_tat import load_rules
from app.services import audit
from app.util.clock import now

_OPEN = [
    TicketStatus.NEW,
    TicketStatus.PROCESSING,
    TicketStatus.ROUTED,
    TicketStatus.ESCALATED,
    TicketStatus.AWAITING_APPROVAL,
]


def minutes_to_breach(ticket: Ticket) -> float | None:
    """Minutes until `sla_due_at` (negative once breached); None when no SLA is set.
    ponytail: internal SLA only; the regulatory TAT deadline is not folded in."""
    return None if ticket.sla_due_at is None else (ticket.sla_due_at - now()).total_seconds() / 60


def guard() -> list[str]:
    """Nudge each near-breach open ticket once and raise it to P1. Returns the nudged ids.
    (decision: T17) "already nudged" = an existing `sla_nudge` audit row for the ticket."""
    limit = load_rules()["sla"]["nudge_before_breach_minutes"]
    with session.SessionLocal() as db:
        due = db.scalars(
            select(Ticket).where(
                Ticket.status.in_([str(s) for s in _OPEN]),
                Ticket.sla_due_at < now() + timedelta(minutes=limit),
                ~select(AuditEvent.id)
                .where(
                    AuditEvent.ticket_id == Ticket.id,
                    AuditEvent.kind == str(AuditKind.sla_nudge),
                )
                .exists(),
            )
        ).all()
        rows = [
            (t.id, t.assigned_team or "l1_support", t.priority, minutes_to_breach(t)) for t in due
        ]
    for tid, team, prio, mins in rows:
        text = (
            f"{tid} breaches in {max(mins or 0, 0):.0f} min — http://localhost:3000/tickets/{tid}"
        )
        with session.SessionLocal() as db:
            db.add(
                Notification(
                    channel="inapp", target=f"team:{team}", text=text, delivered=True, ticket_id=tid
                )
            )
            row = db.get(Ticket, tid)
            if row is not None:
                row.priority = "P1"
            db.commit()
        audit.record(tid, AuditKind.sla_nudge, {"team": team, "minutes": mins}, actor="system")
        audit.record(
            tid,
            AuditKind.notification,
            {"channel": "inapp", "target": f"team:{team}"},
            actor="system",
        )
        if prio != "P1":
            audit.record(
                tid,
                AuditKind.status_change,
                {"priority": {"from": prio, "to": "P1"}},
                actor="system",
            )
    return [r[0] for r in rows]
