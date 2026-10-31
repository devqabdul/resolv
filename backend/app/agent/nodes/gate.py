from app.agent.state import AgentState
from app.domain.enums import AuditKind
from app.policy.engine import evaluate
from app.services import audit, context


def gate(state: AgentState) -> AgentState:
    """Deterministic policy gate over the decision. No LLM; executes nothing."""
    ticket, run_id, dec = state["ticket"], state.get("run_id"), state["decision"]
    und = state["understanding"]
    summary = evaluate(dec, state["context"], ticket, und)
    audit.record(ticket.id, AuditKind.gate, summary.model_dump(mode="json"), run_id=run_id)
    for proposed, res in zip(dec.proposed_actions, summary.results, strict=True):
        before, after = proposed.params.get("amount_inr"), res.action.params.get("amount_inr")
        if before != after:
            audit.record(
                ticket.id,
                AuditKind.gate_adjusted_amount,
                {"action": res.action.name.value, "from": before, "to": after},
                run_id=run_id,
            )
    # Classification columns for the queue view (decision: T8, written once the gate has run).
    context.update_ticket(
        ticket.id,
        ticket_type=und.ticket_type.value,
        priority=dec.priority.value,
        path=dec.path.value,
    )
    return {**state, "gate": summary}
