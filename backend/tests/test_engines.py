import pytest
from fastapi.testclient import TestClient
from sqlalchemy import create_engine, select
from sqlalchemy.orm import sessionmaker

from app.agent import runner
from app.agent.graph import build_graph
from app.agent.tools import build_registry
from app.config import settings
from app.db import session
from app.db.models import ActionExecution, AuditEvent, Ticket, TicketRun
from app.integrations.paytm.client import PaytmClient
from app.main import app
from app.services import context, tickets

B = "http://localhost:8000/mock/paytm/v1"
D1 = (
    "Paid Rs 2,499 by UPI from riya@okhdfc, money debited but order failed 3 days ago, "
    "still no refund. Call me on +91 98765 43210."
)


@pytest.fixture()
def d1(tmp_path, monkeypatch) -> str:
    eng = create_engine(f"sqlite:///{tmp_path / 't.db'}")
    session.init_db(eng)
    monkeypatch.setattr(session, "SessionLocal", sessionmaker(bind=eng, expire_on_commit=False))
    monkeypatch.setattr(settings, "LLM_MODE", "mock")
    paytm = PaytmClient(B, client=TestClient(app, base_url=B))
    paytm.admin_reset()
    paytm.admin_seed()
    monkeypatch.setattr(context, "_registry", build_registry(paytm))
    return tickets.create("in_app_chat", D1, customer_id="cust_riya", ticket_id="tkt_48213").id


def test_build_graph_is_langgraph() -> None:
    assert type(build_graph()).__module__.startswith("langgraph.")


@pytest.mark.parametrize("engine", ["langgraph", "runner"])
def test_d1_resolves(d1: str, engine: str, monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setattr(settings, "AGENT_ENGINE", engine)
    out = runner.run(d1)

    assert out["outcome"] == "RESOLVED" and out["verify_ok"] and not out["errors"]
    with session.SessionLocal() as db:
        t = db.get(Ticket, d1)
        execs = {e.name: e for e in db.scalars(select(ActionExecution)).all()}
        kinds = [e.kind for e in db.scalars(select(AuditEvent)).all()]
        run = db.scalars(select(TicketRun)).one()
    assert (t.status, t.resolved_by, t.assigned_team) == ("RESOLVED", "resolv", None)
    assert t.resolved_at and t.first_response_at and t.ticket_type == "failed_payment_reversal"
    assert set(execs) == {"initiate_reversal", "credit_compensation"}
    assert execs["initiate_reversal"].params_json["amount_inr"] == 2499
    assert execs["initiate_reversal"].result_json["refund_id"].startswith("rfd_")
    assert execs["credit_compensation"].params_json["amount_inr"] == 200
    assert execs["credit_compensation"].result_json["status"] == "CREDITED"
    for k in ("gate", "verify", "reply_sent", "status_change"):
        assert k in kinds, k
    assert run.outcome == "RESOLVED" and run.state_json["outcome"] == "RESOLVED"
