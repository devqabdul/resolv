"""The agent loop as a LangGraph StateGraph (docs/02 §3, docs/04 §6)."""

from functools import cache

from langgraph.graph import END, StateGraph
from langgraph.graph.state import CompiledStateGraph

from app.agent.runner import NODES, after_gate, after_ingest, after_verify
from app.agent.state import AgentState


def build_graph() -> CompiledStateGraph:
    g = StateGraph(AgentState)
    for name, fn in NODES.items():
        g.add_node(name, fn)
    g.set_entry_point("ingest")
    g.add_conditional_edges("ingest", after_ingest, {"end": END, "understand": "understand"})
    g.add_edge("understand", "decide")
    g.add_edge("decide", "gate")
    g.add_conditional_edges("gate", after_gate, {"act": "act", "handoff": "handoff"})
    g.add_edge("act", "verify")  # the single retry lives inside verify, keeping the graph acyclic
    g.add_conditional_edges("verify", after_verify, {"close": "close", "handoff": "handoff"})
    g.add_edge("close", END)
    g.add_edge("handoff", END)
    return g.compile()


@cache
def get_graph() -> CompiledStateGraph:
    return build_graph()
