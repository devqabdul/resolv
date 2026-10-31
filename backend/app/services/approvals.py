"""Approvals: handoff opens PENDING rows; a human decides them (docs/02 §6.1, docs/01 FR-8).

An approved action runs through the same `act.execute` + `verify` + `close` code as the agent;
nothing here calls Paytm directly.
"""

import json
from pathlib import Path as FsPath
from typing import Any

from pydantic import TypeAdapter
from sqlalchemy import select, update

from app.agent.state import AgentState
from app.db import session
from app.db.models import Approval, AuditEvent, Ticket, TicketRun
from app.domain.enums import ActionName, AuditKind, GateOutcome, Path, Priority, TicketStatus
from app.domain.schemas import Decision, ProposedAction
from app.policy.engine import evaluate
from app.services import audit, tickets
from app.services.tickets import new_id
from app.util.clock import now

_STATE = TypeAdapter(AgentState)
# (decision: T11) docs/02 names only the file; resolved from the backend package dir, not cwd.
OVERRIDES_FILE = FsPath(__file__).resolve().parents[2] / "evals" / "overrides.jsonl"


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


class OverrideConflict(Exception):
    """The ticket cannot be overridden as asked (e.g. RESOLVE before any agent run)."""


def _resolv_decision(state: dict[str, Any] | None) -> dict[str, Any] | None:
    d = (state or {}).get("decision")
    return {"path": d["path"], "actions": d.get("proposed_actions", [])} if d else None


def override(
    ticket_id: str,
    path: Path,
    note: str | None,
    decided_by: str,
    actions: list[ProposedAction] | None = None,
    assigned_team: str | None = None,
) -> list[dict[str, Any]]:
    """Apply a human's path to the ticket (docs/01 FR-8); returns the actions the gate blocked.

    RESOLVE never bypasses the gate: AUTO_EXECUTE and NEEDS_APPROVAL (the override is the
    approval) actions run via act.execute + verify; BLOCKED/HUMAN_ONLY ones are reported back.
    Raises KeyError for an unknown ticket, OverrideConflict if RESOLVE has no run to build on.
    """
    from app.agent.nodes.act import execute  # lazy: same cycle as decide()
    from app.agent.nodes.close import close
    from app.agent.nodes.verify import verify

    actor = f"human:{decided_by}"
    with session.SessionLocal() as db:
        t = db.get(Ticket, ticket_id)
        if t is None:
            raise KeyError(f"Ticket {ticket_id} does not exist.")
        masked, team = t.masked_text, t.assigned_team
    raw = last_state(ticket_id)
    if path == Path.RESOLVE and not all(raw and raw.get(k) for k in ("decision", "context")):
        raise OverrideConflict(f"Ticket {ticket_id} has no agent run to resolve from.")
    run_id = new_id("run")
    resolv = _resolv_decision(raw)
    human = {
        "path": path.value,
        "actions": [a.model_dump(mode="json") for a in actions] if actions is not None else None,
        "note": note,
    }
    audit.record(
        ticket_id,
        AuditKind.override,
        {"resolv_decision": resolv, "human_decision": human},
        actor=actor,
        run_id=run_id,
    )
    blocked: list[dict[str, Any]] = []
    approved: list[ProposedAction] = []
    if path == Path.RESOLVE:
        state: AgentState = {**_STATE.validate_python(raw), "run_id": run_id}
        d = state["decision"]
        dec = Decision(
            path=Path.RESOLVE,
            priority=d.priority,
            proposed_actions=actions if actions is not None else d.proposed_actions,
            customer_reply_draft=d.customer_reply_draft,
        )
        summary = evaluate(dec, state["context"], state["ticket"], state["understanding"])
        executed = []
        for r in summary.results:
            if r.outcome not in (GateOutcome.AUTO_EXECUTE, GateOutcome.NEEDS_APPROVAL):
                blocked.append(
                    {
                        "action": r.action.model_dump(mode="json"),
                        "outcome": r.outcome.value,
                        "reasons": r.reasons,
                    }
                )
                continue
            if r.action.name == ActionName.send_reply:
                continue  # close() sends the drafted reply
            if r.outcome == GateOutcome.NEEDS_APPROVAL:
                approved.append(r.action)
                audit.record(
                    ticket_id,
                    AuditKind.approval_decided,
                    {
                        "action": r.action.name.value,
                        "approve": True,
                        "decided_by": decided_by,
                        "note": note,
                        "via": "override",
                    },
                    actor=actor,
                    run_id=run_id,
                )
            executed.append(execute(r.action, state["ticket"], run_id))
        state = verify({**state, "decision": dec, "executed": executed})
        if state.get("verify_ok") and not blocked:
            close(state)
            tickets.transition(
                ticket_id,
                TicketStatus.RESOLVED,
                actor=actor,
                run_id=run_id,
                resolved_by=actor,
                path=path.value,
            )
        else:  # something was blocked or failed to verify: a human finishes it
            tickets.transition(
                ticket_id, TicketStatus.ROUTED, actor=actor, run_id=run_id, path=path.value
            )
    elif path == Path.ROUTE:
        tickets.transition(
            ticket_id,
            TicketStatus.ROUTED,
            actor=actor,
            run_id=run_id,
            path=path.value,
            assigned_team=assigned_team or team,
        )
    else:
        tickets.transition(
            ticket_id,
            TicketStatus.ESCALATED,
            actor=actor,
            run_id=run_id,
            path=path.value,
            priority=Priority.P1.value,
        )
    # Settle PENDING approvals: the override approves the actions it ran, rejects the rest.
    with session.SessionLocal() as db:
        for a in db.scalars(
            select(Approval).where(Approval.ticket_id == ticket_id, Approval.status == "PENDING")
        ):
            ran = any(
                (x.name.value, x.params) == (a.action_json["name"], a.action_json["params"])
                for x in approved
            )
            a.status = "APPROVED" if ran else "REJECTED"
            a.decided_by, a.decided_at, a.note = decided_by, now(), note
        db.execute(update(AuditEvent).where(AuditEvent.run_id == run_id).values(actor=actor))
        db.commit()
    line = {
        "ticket_id": ticket_id,
        "masked_text": masked,
        "resolv_decision": resolv,
        "human_decision": human,
        "note": note,
        "ts": now().isoformat(),
    }
    with OVERRIDES_FILE.open("a") as f:
        f.write(json.dumps(line, default=str) + "\n")
    return blocked
