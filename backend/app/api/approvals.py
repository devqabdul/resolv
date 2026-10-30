"""Approval routes (docs/02 §6.1). Money moves only through services.approvals -> act/verify."""

from typing import Any

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel

from app.api.tickets import ApprovalOut, TicketOut
from app.services import approvals
from app.services.tickets import get_with_timeline

router = APIRouter(prefix="/api/approvals")


class ApprovalItem(ApprovalOut):
    """(decision: T12) "ticket summary + reasoning" for the Approvals page."""

    ticket: TicketOut | None = None
    reasoning: str = ""
    agent_summary: str = ""
    customer_reply_draft: str = ""


class DecideIn(BaseModel):
    approve: bool
    note: str | None = None
    decided_by: str


class DecideOut(BaseModel):
    approval: ApprovalOut
    ticket: TicketOut


def _ticket(ticket_id: str) -> TicketOut | None:
    d = get_with_timeline(ticket_id)
    # Masked text only, like the tickets list (CLAUDE.md rule 6).
    return TicketOut.model_validate(d["ticket"]).model_copy(update={"raw_text": ""}) if d else None


@router.get("", response_model=list[ApprovalItem])
def list_approvals(status: str | None = None) -> Any:
    out = []
    for a in approvals.list_approvals(status):
        dec = (approvals.last_state(a.ticket_id) or {}).get("decision") or {}
        out.append(
            ApprovalItem.model_validate(a).model_copy(
                update={
                    "ticket": _ticket(a.ticket_id),
                    "reasoning": dec.get("reasoning", ""),
                    "agent_summary": dec.get("agent_summary", ""),
                    "customer_reply_draft": dec.get("customer_reply_draft", ""),
                }
            )
        )
    return out


@router.post("/{approval_id}/decide", response_model=DecideOut)
def decide(approval_id: str, body: DecideIn) -> Any:
    try:
        row = approvals.decide(approval_id, body.approve, body.note, body.decided_by)
    except KeyError:
        raise HTTPException(404, f"Approval {approval_id} not found.") from None
    except approvals.ApprovalConflict as e:
        raise HTTPException(409, str(e)) from None
    return {"approval": approvals.get(row.id), "ticket": _ticket(row.ticket_id)}
