from app.agent.state import AgentState
from app.db import session
from app.db.models import Notification
from app.domain.enums import ActionName, AuditKind, GateOutcome, TicketType
from app.domain.enums import Path as DecisionPath
from app.integrations.helpdesk.internal import helpdesk
from app.policy.rbi_tat import load_rules
from app.services import approvals, audit, tickets
from app.util.clock import now

MONEY_TYPES = {TicketType.failed_payment_reversal, TicketType.refund_status}
HOLDING_REPLY = (
    "Thanks for your patience. We have found the issue and the fix is waiting for a quick "
    "approval from our team; we will update you as soon as it is done."
)


def _team(state: AgentState) -> str:
    """(decision: docs/06 T8) payments_ops money, merchant_ops settlements, risk human-only."""
    und, t = state.get("understanding"), state["ticket"]
    kind = und.ticket_type if und else None
    if kind and kind.value in load_rules()["human_only_ticket_types"]:
        return "risk"
    if kind == TicketType.settlement_delay or (t.merchant_id and not t.customer_id):
        return "merchant_ops"
    if kind in MONEY_TYPES:
        return "payments_ops"
    return "l1_support"


def _nudge(ticket_id: str, team: str, text: str, run_id: str | None) -> None:
    # (decision: T8 stub, replaced by integrations/notify in T18) in-app row + audit only.
    with session.SessionLocal() as db:
        db.add(
            Notification(
                channel="inapp",
                target=f"team:{team}",
                text=text,
                delivered=True,
                ticket_id=ticket_id,
            )
        )
        db.commit()
    audit.record(
        ticket_id,
        AuditKind.notification,
        {"channel": "inapp", "target": f"team:{team}"},
        run_id=run_id,
    )


def handoff(state: AgentState) -> AgentState:
    """Assign a team, open approvals, send a holding reply if needed, nudge the team."""
    t, run_id = state["ticket"], state.get("run_id")
    gate, dec = state.get("gate"), state.get("decision")
    pending = [r for r in (gate.results if gate else []) if r.outcome == GateOutcome.NEEDS_APPROVAL]
    if pending:
        outcome = "AWAITING_APPROVAL"
    elif dec and dec.path == DecisionPath.ESCALATE:
        outcome = "ESCALATED"
    elif dec is None or gate is None:
        outcome = "FAILED"  # a node errored before the gate; a human takes it from here
    else:
        outcome = "ROUTED"
    team = _team(state)

    for r in pending:
        approvals.create(t.id, r.action, r.reasons, run_id)
    holding = next(
        (
            r
            for r in (gate.results if gate else [])
            if r.action.name == ActionName.send_reply
            and r.outcome == GateOutcome.AUTO_EXECUTE
            and r.action.params.get("holding_reply")
        ),
        None,
    )
    fields: dict[str, object] = {"assigned_team": team}
    if pending and holding:
        p = holding.action.params
        helpdesk.reply(t, HOLDING_REPLY, run_id, p.get("channel"), p.get("language"), holding=True)
        fields["first_response_at"] = now()

    notes = [
        r.action.params
        for r in (gate.results if gate else [])
        if r.action.name == ActionName.create_internal_note
    ]
    audit.record(
        t.id,
        AuditKind.handoff,
        {
            "outcome": outcome,
            "assigned_team": team,
            "approvals": len(pending),
            "next_action_for_human": dec.next_action_for_human if dec else None,
            "agent_summary": dec.agent_summary if dec else None,
            "internal_notes": notes,
            "errors": state.get("errors", []),
        },
        run_id=run_id,
    )
    tickets.transition(t.id, outcome, run_id=run_id, **fields)
    nxt = (dec.next_action_for_human if dec else None) or "Review the ticket."
    _nudge(t.id, team, f"{t.id} is {outcome} for {team}: {nxt}", run_id)
    return {**state, "outcome": outcome}
