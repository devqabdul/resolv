"""Ticket rows: create, list, read with timeline, status transitions (docs/02 §5, §6.1)."""

from __future__ import annotations  # `list` below shadows the builtin in annotations

from datetime import timedelta
from typing import Any
from uuid import uuid4

from sqlalchemy import case, func, select, update

from app.db import session
from app.db.models import Approval, AuditEvent, Ticket, TicketRun
from app.domain.enums import AuditKind, TicketStatus
from app.policy.pii import mask
from app.policy.rbi_tat import load_rules
from app.services import audit
from app.util.clock import now


def new_id(prefix: str) -> str:
    return f"{prefix}_{uuid4().hex[:8]}"


def create(
    channel: str,
    text: str,
    customer_id: str | None = None,
    merchant_id: str | None = None,
    ticket_id: str | None = None,  # (decision: T8) scenario tickets pass fixed ids (tkt_48213)
) -> Ticket:
    """Insert a NEW ticket; the process_queue worker picks it up."""
    at = now()
    row = Ticket(
        id=ticket_id or new_id("tkt"),
        channel=channel,
        customer_id=customer_id,
        merchant_id=merchant_id,
        raw_text=text,
        masked_text=mask(text)[0],
        status=TicketStatus.NEW,
        created_at=at,
        sla_due_at=at + timedelta(minutes=load_rules()["sla"]["first_response_minutes"]),
    )
    with session.SessionLocal() as db:
        db.add(row)
        db.commit()
    return row


_PRIORITY = case((Ticket.priority == "P1", 1), (Ticket.priority == "P2", 2), else_=3)


def list(  # name fixed by docs/06 T8 (shadows the builtin here)
    status: str | None = None,
    type: str | None = None,  # query param name from docs/02 §6.1
    incident_id: str | None = None,
    limit: int = 50,
    since: Any = None,
) -> tuple[list[Ticket], int]:
    """(items, total), ordered by priority then created_at (newest first)."""
    q = select(Ticket)
    if status:
        q = q.where(Ticket.status == status)
    if type:
        q = q.where(Ticket.ticket_type == type)
    if incident_id:
        q = q.where(Ticket.incident_id == incident_id)
    if since is not None:
        q = q.where(Ticket.created_at >= since)
    with session.SessionLocal() as db:
        total = db.scalar(select(func.count()).select_from(q.subquery())) or 0
        rows = db.scalars(q.order_by(_PRIORITY, Ticket.created_at.desc()).limit(limit)).all()
    return [*rows], total


def get_with_timeline(ticket_id: str) -> dict[str, Any] | None:
    """{ticket, run: {state}, timeline, approvals} for GET /api/tickets/{id}."""
    with session.SessionLocal() as db:
        t = db.get(Ticket, ticket_id)
        if t is None:
            return None
        run = db.scalars(
            select(TicketRun)
            .where(TicketRun.ticket_id == ticket_id)
            .order_by(TicketRun.started_at.desc())
            .limit(1)
        ).first()
        timeline = db.scalars(
            select(AuditEvent).where(AuditEvent.ticket_id == ticket_id).order_by(AuditEvent.id)
        ).all()
        approvals = db.scalars(select(Approval).where(Approval.ticket_id == ticket_id)).all()
    return {
        "ticket": t,
        "run": {"id": run.id, "outcome": run.outcome, "state": run.state_json} if run else None,
        "timeline": [*timeline],
        "approvals": [*approvals],
    }


def transition(
    ticket_id: str,
    status: str,
    actor: str = "resolv",
    run_id: str | None = None,
    **fields: Any,
) -> None:
    """Set status (+ extra columns); audits `status_change` when the status actually moves."""
    with session.SessionLocal() as db:
        row = db.get(Ticket, ticket_id)
        if row is None:
            raise KeyError(f"Ticket {ticket_id} does not exist.")
        old = row.status
        row.status = str(status)
        for k, v in fields.items():
            if k == "first_response_at" and row.first_response_at is not None:
                continue  # the first response happens once
            setattr(row, k, v)
        db.commit()
    if old != str(status):
        audit.record(
            ticket_id,
            AuditKind.status_change,
            {"from": old, "to": str(status)},
            actor=actor,
            run_id=run_id,
        )


def claim_new(limit: int) -> list[str]:
    """Atomically move up to `limit` NEW tickets to PROCESSING; returns the claimed ids."""
    with session.SessionLocal() as db:
        ids = db.scalars(
            select(Ticket.id)
            .where(Ticket.status == TicketStatus.NEW)
            .order_by(Ticket.created_at)
            .limit(limit)
        ).all()
        claimed: list[str] = []
        for tid in ids:
            res = db.execute(
                update(Ticket)
                .where(Ticket.id == tid, Ticket.status == TicketStatus.NEW)
                .values(status=TicketStatus.PROCESSING)
            )
            if res.rowcount:
                claimed.append(tid)
        db.commit()
    for tid in claimed:
        audit.record(
            tid, AuditKind.status_change, {"from": "NEW", "to": "PROCESSING"}, actor="system"
        )
    return claimed
