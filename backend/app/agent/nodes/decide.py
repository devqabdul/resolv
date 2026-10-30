from app.agent.state import AgentState
from app.config import settings
from app.domain.enums import AuditKind
from app.domain.schemas import Decision
from app.integrations.llm.client import LLMClient, load_prompt
from app.services import audit

llm = LLMClient()


def decide(state: AgentState) -> AgentState:
    """Propose path, actions and a reply draft (sonnet). The gate decides what runs."""
    ticket, run_id = state["ticket"], state.get("run_id")
    user = (
        f"<ticket>{ticket.masked_text}</ticket>\n"
        f"<understanding>{state['understanding'].model_dump_json()}</understanding>\n"
        f"<context>{state['context'].model_dump_json()}</context>"
    )
    system = f"{load_prompt('decide')}\n\n{load_prompt('reply_style')}"
    dec = llm.structured(system, user, Decision, settings.LLM_MODEL_DECIDE)
    audit.record(ticket.id, AuditKind.decision, dec.model_dump(mode="json"), run_id=run_id)
    return {**state, "decision": dec}
