"""Ticket routes (docs/02 §6.1). Nothing here moves money; runs go through agent.runner."""

from datetime import datetime
from typing import Any

from fastapi import APIRouter, HTTPException, Query
from pydantic import BaseModel, ConfigDict

from app.agent import runner
from app.api.audit import AuditEventOut
from app.domain.enums import Channel, Path
from app.domain.schemas import ProposedAction, TicketDTO
from app.services import approvals, incidents, tickets

router = APIRouter(prefix="/api/tickets")


class TicketOut(TicketDTO):
    """(decision: T9) TicketDTO plus the columns the cockpit needs."""

    model_config = ConfigDict(from_attributes=True)

    ticket_type: str | None = None
    priority: str | None = None
    path: str | None = None
    assigned_team: str | None = None
    incident_id: str | None = None
    sla_due_at: datetime | None = None
    first_response_at: datetime | None = None
    resolved_at: datetime | None = None
    resolved_by: str | None = None


class ApprovalOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: str
    ticket_id: str
    action_json: dict[str, Any]
    reasons_json: list[str]
    status: str
    requested_at: datetime
    decided_by: str | None = None
    decided_at: datetime | None = None
    note: str | None = None


class RunOut(BaseModel):
    id: str
    outcome: str | None = None
    state: dict[str, Any] | None = None


class TicketList(BaseModel):
    items: list[TicketOut]
    total: int


class TicketDetail(BaseModel):
    ticket: TicketOut
    run: RunOut | None
    timeline: list[AuditEventOut]
    approvals: list[ApprovalOut]
    incident: dict[str, Any] | None = None  # (decision: T9; IncidentSummary since T15)


class TicketIn(BaseModel):
    channel: Channel
    text: str
    customer_id: str | None = None
    merchant_id: str | None = None
    metadata: dict[str, Any] | None = None  # accepted per §6.1, not stored


def _detail(ticket_id: str) -> dict[str, Any]:
    d = tickets.get_with_timeline(ticket_id)
    if d is None:
        raise HTTPException(404, f"ticket {ticket_id} not found")
    inc_id = d["ticket"].incident_id
    inc = incidents.get(inc_id) if inc_id else None
    return {**d, "incident": _incident_summary(inc["incident"]) if inc else None}


def _incident_summary(inc: Any) -> dict[str, Any]:
    """(decision: T15) IncidentSummary for the ticket detail."""
    keys = ("id", "signature", "title", "status", "ticket_count", "owner_team")
    return {k: getattr(inc, k) for k in keys}


@router.post("", response_model=TicketOut)
def create_ticket(body: TicketIn) -> Any:
    return tickets.create(str(body.channel.value), body.text, body.customer_id, body.merchant_id)


@router.get("", response_model=TicketList)
def list_tickets(
    status: str | None = None,
    type: str | None = None,
    incident_id: str | None = None,
    limit: int = Query(50, ge=1, le=500),
    since: datetime | None = None,
) -> TicketList:
    rows, total = tickets.list(
        status=status, type=type, incident_id=incident_id, limit=limit, since=since
    )
    # The list shows masked_text only; raw text is served by the detail route (CLAUDE.md rule 6).
    items = [TicketOut.model_validate(r).model_copy(update={"raw_text": ""}) for r in rows]
    return TicketList(items=items, total=total)


@router.get("/{ticket_id}", response_model=TicketDetail)
def get_ticket(ticket_id: str) -> Any:
    return _detail(ticket_id)


@router.post("/{ticket_id}/run", response_model=TicketDetail)
def run_ticket(ticket_id: str) -> Any:
    _detail(ticket_id)  # 404 first
    runner.run(ticket_id)
    return _detail(ticket_id)


class OverrideIn(BaseModel):
    path: Path
    note: str | None = None
    decided_by: str
    actions: list[ProposedAction] | None = None
    assigned_team: str | None = None  # (decision: T11) team for path=ROUTE; else keep the current


class OverrideOut(BaseModel):
    ticket: TicketOut
    blocked: list[dict[str, Any]]  # (decision: T11) gate-blocked actions, not executed


@router.post("/{ticket_id}/override", response_model=OverrideOut)
def override_ticket(ticket_id: str, body: OverrideIn) -> Any:
    _detail(ticket_id)  # 404 first
    try:
        blocked = approvals.override(
            ticket_id, body.path, body.note, body.decided_by, body.actions, body.assigned_team
        )
    except approvals.OverrideConflict as e:
        raise HTTPException(409, str(e)) from None
    t = TicketOut.model_validate(_detail(ticket_id)["ticket"])
    return {"ticket": t.model_copy(update={"raw_text": ""}), "blocked": blocked}
