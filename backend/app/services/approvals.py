"""Approvals: handoff opens PENDING rows; a human decides them (docs/02 §6.1, docs/01 FR-8).

An approved action runs through the same `act.execute` + `verify` + `close` code as the agent;
nothing here calls Paytm directly.
"""

from typing import Any

from pydantic import TypeAdapter
from sqlalchemy import select, update

from app.agent.state import AgentState
from app.db import session
from app.db.models import Approval, AuditEvent, TicketRun
from app.domain.enums import ActionName, AuditKind, GateOutcome, TicketStatus
from app.domain.schemas import ProposedAction
from app.services import audit, tickets
from app.services.tickets import new_id
from app.util.clock import now

_STATE = TypeAdapter(AgentState)


class ApprovalConflict(Exception):
    """The approval was already decided."""


def create(
    ticket_id: str, action: ProposedAction, reasons: list[str], run_id: str | None = None
) -> str:
    row = Approval(
        id=new_id("apr"),
        ticket_id=ticket_id,
        action_json=action.model_dump(mode="json"),
        reasons_json=reasons,
        status="PENDING",
    )
    with session.SessionLocal() as db:
        db.add(row)
        db.commit()
    audit.record(
        ticket_id,
        AuditKind.approval_created,
        {"approval_id": row.id, "action": action.name.value, "reasons": reasons},
        run_id=run_id,
    )
    return row.id


def list_approvals(status: str | None = None, ticket_id: str | None = None) -> list[Approval]:
    q = select(Approval).order_by(Approval.requested_at)
    if status:
        q = q.where(Approval.status == status)
    if ticket_id:
        q = q.where(Approval.ticket_id == ticket_id)
    with session.SessionLocal() as db:
        return [*db.scalars(q).all()]


def get(approval_id: str) -> Approval | None:
    with session.SessionLocal() as db:
        return db.get(Approval, approval_id)


def last_state(ticket_id: str) -> dict[str, Any] | None:
    """The newest ticket_runs.state_json (gate summary + decision) as JSON."""
    with session.SessionLocal() as db:
        return db.scalars(
            select(TicketRun.state_json)
            .where(TicketRun.ticket_id == ticket_id)
            .order_by(TicketRun.started_at.desc())
            .limit(1)
        ).first()


def decide(approval_id: str, approve: bool, note: str | None, decided_by: str) -> Approval:
    """Approve -> execute the action (+ unrun auto actions), verify, close if none pending.

    Reject -> ROUTED. Raises KeyError if missing, ApprovalConflict if already decided.
    """
    from app.agent.nodes.act import execute  # lazy: handoff -> approvals -> nodes cycle
    from app.agent.nodes.close import close
    from app.agent.nodes.verify import verify

    actor = f"human:{decided_by}"
    with session.SessionLocal() as db:  # claim atomically, like tickets.claim_new
        res = db.execute(
            update(Approval)
            .where(Approval.id == approval_id, Approval.status == "PENDING")
            .values(
                status="APPROVED" if approve else "REJECTED",
                decided_by=decided_by,
                decided_at=now(),
                note=note,
            )
        )
        db.commit()
        row = db.get(Approval, approval_id)
    if row is None:
        raise KeyError(f"Approval {approval_id} does not exist.")
    if not res.rowcount:
        raise ApprovalConflict(f"Approval {approval_id} is already {row.status}.")

    tid = row.ticket_id
    run_id = new_id("run")  # scopes this human action's audit rows; no ticket_runs row
    audit.record(
        tid,
        AuditKind.approval_decided,
        {"approval_id": approval_id, "approve": approve, "decided_by": decided_by, "note": note},
        actor=actor,
        run_id=run_id,
    )
    if not approve:
        tickets.transition(tid, TicketStatus.ROUTED, actor=actor, run_id=run_id)
        return row

    state: AgentState = {**_STATE.validate_python(last_state(tid) or {}), "run_id": run_id}
    t = state["ticket"]
    executed = [execute(ProposedAction.model_validate(row.action_json), t, run_id)]
    # (decision: T12) also run the gate's AUTO_EXECUTE actions not run yet; idempotency skips
    # the ones act already executed.
    executed += [
        execute(r.action, t, run_id)
        for r in (state["gate"].results if state.get("gate") else [])
        if r.outcome == GateOutcome.AUTO_EXECUTE and r.action.name != ActionName.send_reply
    ]
    state = verify({**state, "executed": executed})
    if state.get("verify_ok") and not list_approvals("PENDING", tid):
        close(state)
        # (decision: T12) close() stamps resolv; the approving human resolved this ticket.
        tickets.transition(tid, TicketStatus.RESOLVED, actor=actor, resolved_by=actor)
    # (decision: T12) act/verify/close audit as `resolv`; this run is a human action.
    with session.SessionLocal() as db:
        db.execute(update(AuditEvent).where(AuditEvent.run_id == run_id).values(actor=actor))
        db.commit()
    return row
