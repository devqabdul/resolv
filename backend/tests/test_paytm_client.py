import os

os.environ["MOCK_LATENCY_MS"] = "0"
os.environ["LLM_MODE"] = "mock"

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import create_engine, select
from sqlalchemy.orm import sessionmaker

from app.agent.tools import build_registry
from app.db import session
from app.db.models import AuditEvent
from app.integrations.paytm.client import PaytmClient
from app.main import app

B = "http://localhost:8000/mock/paytm/v1"


@pytest.fixture()
def reg(tmp_path, monkeypatch):
    eng = create_engine(f"sqlite:///{tmp_path / 't.db'}")
    session.init_db(eng)
    monkeypatch.setattr(session, "SessionLocal", sessionmaker(bind=eng, expire_on_commit=False))
    http = TestClient(app, base_url=B)
    http.post("/admin/reset")
    http.post("/admin/seed")
    return build_registry(PaytmClient(B, client=http))


def test_reversal_flow_and_audit(reg):
    txns = reg.call("list_transactions", "tkt_1", "run_1", customer_id="cust_riya")
    t = next(x for x in txns if x.id == "txn_48213_a")
    assert (t.amount_inr, t.status) == (2499, "DEBITED_NOT_CREDITED")
    r = reg.call(
        "initiate_reversal", "tkt_1", "run_1",
        txn_id=t.id, amount_inr=2499, reason="t", idempotency_key="k1",
    )  # fmt: skip
    assert r.status == "INITIATED"
    assert reg.call("get_refund", "tkt_1", "run_1", refund_id=r.refund_id).refund_id == r.refund_id
    with session.SessionLocal() as db:
        kinds = [
            e.kind for e in db.scalars(select(AuditEvent).where(AuditEvent.ticket_id == "tkt_1"))
        ]
    assert kinds.count("tool_call") == 3 and kinds.count("tool_result") == 3


def test_missing_idempotency_key_raises(reg):
    for name, kw in [
        ("initiate_reversal", {"txn_id": "txn_48213_a", "amount_inr": 1, "reason": "t"}),
        (
            "credit_compensation",
            {"customer_id": "cust_riya", "amount_inr": 1, "reason": "t", "txn_id": "x"},
        ),
    ]:
        with pytest.raises(ValueError):
            reg.call(name, "tkt_2", None, **kw)


def test_non_mock_base_url_refused():
    for u in (
        "https://securegw.paytm.in",
        "http://localhost:9000/v1",
        "http://evil.com/mock/paytm/v1",
    ):
        with pytest.raises(ValueError):
            PaytmClient(u)
    PaytmClient("http://localhost:8001/v1")
