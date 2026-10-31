"""Engine entry point + the sequential fallback engine (AGENT_ENGINE=runner).

Both engines run the same guarded nodes and the same §3.2 edge functions defined here;
`agent/graph.py` wires them into a LangGraph StateGraph.
"""

import logging
from collections.abc import Callable

from pydantic import TypeAdapter

from app.agent.nodes.act import act
from app.agent.nodes.close import close
from app.agent.nodes.decide import decide
from app.agent.nodes.gate import gate
from app.agent.nodes.handoff import handoff
from app.agent.nodes.ingest import ingest
from app.agent.nodes.understand import understand
from app.agent.nodes.verify import verify
from app.agent.state import AgentState
from app.config import settings
from app.db import session
from app.db.models import Ticket, TicketRun
from app.domain.enums import AuditKind, GateOutcome, TicketStatus
from app.domain.enums import Path as DecisionPath
from app.services import audit, tickets
from app.util.clock import now

log = logging.getLogger(__name__)
Node = Callable[[AgentState], AgentState]


def guarded(name: str, fn: Node) -> Node:
    """Nodes never raise (docs/04 §6): an error is audited, recorded and routes to handoff."""

    def run(state: AgentState) -> AgentState:
        if state.get("outcome") == "FAILED" and name != "handoff":
            return state  # an earlier node failed; pass through to handoff
        try:
            return fn(state)
        except Exception as e:
            log.exception("node %s failed", name)
            audit.record(
                state["ticket_id"],
                AuditKind.error,
                {"node": name, "error": str(e)},
                run_id=state.get("run_id"),
            )
            errors = [*state.get("errors", []), f"{name} failed: {e}"]
            return {**state, "errors": errors, "outcome": "FAILED"}

    return run


NODES: dict[str, Node] = {
    n: guarded(n, f)
    for n, f in [
        ("ingest", ingest),
        ("understand", understand),
        ("decide", decide),
        ("gate", gate),
        ("act", act),
        ("verify", verify),
        ("close", close),
        ("handoff", handoff),
    ]
}


# --- docs/02 §3.2 edges (shared by both engines) ---
def after_ingest(s: AgentState) -> str:
    return "end" if s.get("outcome") == "INCIDENT_LINKED" else "understand"


def after_gate(s: AgentState) -> str:
    g, d = s.get("gate"), s.get("decision")
    auto = g is not None and d is not None and g.ticket_outcome == GateOutcome.AUTO_EXECUTE
    ok = auto and d.path == DecisionPath.RESOLVE and s.get("outcome") != "FAILED"
    return "act" if ok else "handoff"


def after_verify(s: AgentState) -> str:
    return "close" if s.get("verify_ok") else "handoff"


def run_sequential(state: AgentState) -> AgentState:
    """The AGENT_ENGINE=runner engine: same nodes, same edges, no LangGraph."""
    s = NODES["ingest"](state)
    if after_ingest(s) == "end":
        return s
    s = NODES["gate"](NODES["decide"](NODES["understand"](s)))
    if after_gate(s) == "act":
        s = NODES["verify"](NODES["act"](s))
        if after_verify(s) == "close":
            return NODES["close"](s)
    return NODES["handoff"](s)


_STATE = TypeAdapter(AgentState)


def run(ticket_id: str, engine: str | None = None) -> AgentState:
    """Process one ticket synchronously with the selected engine; records a ticket_runs row."""
    run_id = tickets.new_id("run")
    with session.SessionLocal() as db:
        db.add(TicketRun(id=run_id, ticket_id=ticket_id, started_at=now()))
        db.commit()
    tickets.transition(ticket_id, TicketStatus.PROCESSING, run_id=run_id)
    state: AgentState = {"ticket_id": ticket_id, "run_id": run_id, "errors": []}
    try:
        if (engine or settings.AGENT_ENGINE) == "runner":
            out = run_sequential(state)
        else:
            from app.agent.graph import get_graph  # lazy: the runner works without LangGraph

            out = get_graph().invoke(state)
    except Exception as e:  # engine-level failure (nodes themselves never raise)
        log.exception("engine failed for %s", ticket_id)
        audit.record(ticket_id, AuditKind.error, {"engine": str(e)}, run_id=run_id)
        out = {**state, "outcome": "FAILED", "errors": [f"engine failed: {e}"]}

    outcome = out.get("outcome") or "FAILED"
    with session.SessionLocal() as db:
        still_processing = db.get(Ticket, ticket_id).status == TicketStatus.PROCESSING
    if still_processing:  # e.g. INCIDENT_LINKED fast path, or a failure inside close/handoff
        tickets.transition(ticket_id, outcome, run_id=run_id)
    with session.SessionLocal() as db:
        row = db.get(TicketRun, run_id)
        row.finished_at, row.outcome = now(), outcome
        row.state_json = _STATE.dump_python(out, mode="json")
        db.commit()
    return out
