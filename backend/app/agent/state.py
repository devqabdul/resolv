from typing import Literal, TypedDict

from app.domain.schemas import (
    ActionResult,
    ContextBundle,
    Decision,
    GateSummary,
    TicketDTO,
    Understanding,
)


class AgentState(TypedDict, total=False):
    """docs/02 §3.1. Nodes are pure `(state) -> state`; side effects go through services/tools."""

    ticket_id: str
    run_id: str
    ticket: TicketDTO  # masked text, channel, ids
    context: ContextBundle  # §4
    understanding: Understanding
    decision: Decision
    gate: GateSummary  # ticket_outcome + per-action GateResult
    executed: list[ActionResult]  # tool results
    verify_ok: bool
    outcome: Literal[
        "RESOLVED", "ROUTED", "ESCALATED", "AWAITING_APPROVAL", "INCIDENT_LINKED", "FAILED"
    ]
    errors: list[str]
    # (decision: T7) set by `understand` when confidence < rules.yaml low_confidence_threshold;
    # the gate forces ROUTE in that case (engine.evaluate re-checks the same threshold).
    low_confidence: bool
