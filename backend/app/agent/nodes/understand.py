from app.agent.state import AgentState
from app.config import settings
from app.domain.enums import AuditKind
from app.domain.schemas import Understanding
from app.integrations.llm.client import LLMClient, load_prompt
from app.policy.rbi_tat import load_rules
from app.services import audit, context

llm = LLMClient()


def understand(state: AgentState) -> AgentState:
    """Build the context (audited tool calls), then classify the masked ticket (haiku)."""
    ticket, run_id = state["ticket"], state.get("run_id")
    ctx = context.build_context(ticket, context.get_tools(), run_id)
    user = f"<ticket>{ticket.masked_text}</ticket>\n<context>{ctx.model_dump_json()}</context>"
    und = llm.structured(
        load_prompt("understand"), user, Understanding, settings.LLM_MODEL_UNDERSTAND
    )
    audit.record(ticket.id, AuditKind.understanding, und.model_dump(mode="json"), run_id=run_id)
    low = und.confidence < load_rules()["low_confidence_threshold"]
    return {**state, "context": ctx, "understanding": und, "low_confidence": low}
