from app.agent.state import AgentState
from app.domain.enums import ActionName, TicketStatus
from app.integrations.helpdesk.internal import helpdesk
from app.services import tickets
from app.util.clock import now


def close(state: AgentState) -> AgentState:
    """Send the drafted reply through the helpdesk adapter and mark the ticket RESOLVED."""
    t, run_id, dec = state["ticket"], state.get("run_id"), state["decision"]
    reply = next((a for a in dec.proposed_actions if a.name == ActionName.send_reply), None)
    params = reply.params if reply else {}
    if dec.customer_reply_draft:
        helpdesk.reply(
            t, dec.customer_reply_draft, run_id, params.get("channel"), params.get("language")
        )
    at = now()
    tickets.transition(
        t.id,
        TicketStatus.RESOLVED,
        run_id=run_id,
        resolved_by="resolv",
        resolved_at=at,
        first_response_at=at,
    )
    return {**state, "outcome": "RESOLVED"}
