import pytest
from fastapi.testclient import TestClient
from sqlalchemy import create_engine, select
from sqlalchemy.orm import sessionmaker

from app.agent.nodes.decide import decide
from app.agent.nodes.ingest import ingest
from app.agent.nodes.understand import understand
from app.agent.state import AgentState
from app.agent.tools import build_registry
from app.db import session
from app.db.models import AuditEvent, Ticket
from app.domain.enums import ActionName
from app.integrations.llm import mock
from app.integrations.paytm.client import PaytmClient
from app.main import app
from app.services import context

B = "http://localhost:8000/mock/paytm/v1"
D1 = (
    "Paid Rs 2,499 by UPI from riya@okhdfc, money debited but order failed 3 days ago, "
    "still no refund. Call me on +91 98765 43210."
)


@pytest.fixture()
def prompts(tmp_path, monkeypatch) -> list[str]:
    eng = create_engine(f"sqlite:///{tmp_path / 't.db'}")
    session.init_db(eng)
    monkeypatch.setattr(session, "SessionLocal", sessionmaker(bind=eng, expire_on_commit=False))
    paytm = PaytmClient(B, client=TestClient(app, base_url=B))
    paytm.admin_reset()
    paytm.admin_seed()
    monkeypatch.setattr(context, "_registry", build_registry(paytm))
    seen: list[str] = []
    real = mock.respond

    def record(system, user, schema):
        seen.append(user)
        return real(system, user, schema)

    monkeypatch.setattr(mock, "respond", record)
    with session.SessionLocal() as db:
        db.add(Ticket(id="tkt_48213", channel="in_app_chat", customer_id="cust_riya", raw_text=D1))
        db.commit()
    return seen


def test_d1_ingest_understand_decide(prompts: list[str]) -> None:
    state: AgentState = {"ticket_id": "tkt_48213", "run_id": "run_0000d1d1"}
    state = decide(understand(ingest(state)))

    dec = state["decision"]
    assert dec.path == "RESOLVE" and not state["low_confidence"]
    acts = {a.name: a.params for a in dec.proposed_actions}
    assert acts[ActionName.initiate_reversal]["txn_id"] == "txn_48213_a"
    assert acts[ActionName.initiate_reversal]["amount_inr"] == 2499
    assert acts[ActionName.credit_compensation]["amount_inr"] == 200
    assert ActionName.send_reply in acts and dec.customer_reply_draft

    ctx = state["context"]
    assert ctx.regulatory_clock and ctx.regulatory_clock.compensation_due_inr == 200
    assert [r.refund_id for r in ctx.refunds] == ["rfd_riya_prev"]
    assert ctx.policy_summary and ctx.kb_snippets

    with session.SessionLocal() as db:
        t = db.get(Ticket, "tkt_48213")
        events = db.scalars(select(AuditEvent).where(AuditEvent.ticket_id == "tkt_48213")).all()
    assert t.candidate_txn_id == "txn_48213_a"
    assert t.signature == "failed_payment_reversal|HDFC|BANK_SWITCH_TIMEOUT"
    assert "riya@okhdfc" not in t.masked_text and "43210" not in t.masked_text
    kinds = [e.kind for e in events]
    for k in ("ingest", "pii_masked", "tool_call", "tool_result", "understanding", "decision"):
        assert k in kinds, k
    pii = next(e for e in events if e.kind == "pii_masked")
    assert {"phone", "upi_vpa"} <= set(pii.payload_json["classes"])
    assert all(e.run_id == "run_0000d1d1" and e.actor == "resolv" for e in events)

    assert len(prompts) == 2  # understand + decide
    for p in prompts:
        assert "riya@okhdfc" not in p and "9876543210" not in p and "98765 43210" not in p
