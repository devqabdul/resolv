"""D3 approval flow: list PENDING, approve -> refund + RESOLVED, reject -> ROUTED (R10)."""

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import select

from app.agent import runner
from app.agent.tools import build_registry
from app.config import settings
from app.db import session
from app.db.models import AuditEvent
from app.integrations.paytm.client import PaytmClient
from app.main import app
from app.services import context, demo

B = "http://localhost:8000/mock/paytm/v1"


@pytest.fixture()
def paytm(client: TestClient, monkeypatch: pytest.MonkeyPatch) -> PaytmClient:
    monkeypatch.setattr(settings, "LLM_MODE", "mock")
    p = PaytmClient(B, client=TestClient(app, base_url=B))
    monkeypatch.setattr(demo, "_paytm", lambda: p)
    monkeypatch.setattr(context, "_registry", build_registry(p))
    demo.reset()
    demo.seed()
    runner.run(demo.scenario("d3_over_limit"))
    return p


def _events(kind: str) -> list[AuditEvent]:
    with session.SessionLocal() as db:
        q = select(AuditEvent).where(AuditEvent.ticket_id == "tkt_48219", AuditEvent.kind == kind)
        return [*db.scalars(q).all()]


def _pending_id(client: TestClient) -> str:
    rows = client.get("/api/approvals", params={"status": "PENDING"}).json()
    assert len(rows) == 1
    a = rows[0]
    assert a["ticket_id"] == "tkt_48219" and a["ticket"]["id"] == "tkt_48219"
    assert a["action_json"]["name"] == "initiate_reversal"
    assert a["action_json"]["params"]["amount_inr"] == 12000
    assert a["action_json"]["params"]["txn_id"] == "txn_big"
    return a["id"]


def test_approve_resolves_once(client: TestClient, paytm: PaytmClient) -> None:
    aid = _pending_id(client)
    body = {"approve": True, "note": "ok", "decided_by": "Priya"}
    r = client.post(f"/api/approvals/{aid}/decide", json=body)
    assert r.status_code == 200, r.text
    assert r.json()["approval"]["status"] == "APPROVED"
    assert r.json()["ticket"]["status"] == "RESOLVED"

    txn = paytm.get_transaction("txn_big")
    assert txn.refund_status == "INITIATED"
    t = client.get("/api/tickets/tkt_48219").json()["ticket"]
    assert t["status"] == "RESOLVED" and t["resolved_by"] == "human:Priya"
    (ev,) = _events("approval_decided")
    assert ev.actor == "human:Priya" and ev.payload_json["decided_by"] == "Priya"

    again = client.post(f"/api/approvals/{aid}/decide", json=body)
    assert again.status_code == 409
    assert paytm.get_transaction("txn_big").refund_id == txn.refund_id
    reversals = [e for e in _events("tool_call") if e.payload_json["name"] == "initiate_reversal"]
    assert len(reversals) == 1 and reversals[0].actor == "human:Priya"
    assert client.get("/api/approvals", params={"status": "PENDING"}).json() == []


def test_reject_routes_without_refund(client: TestClient, paytm: PaytmClient) -> None:
    aid = _pending_id(client)
    body = {"approve": False, "note": "no", "decided_by": "Priya"}
    r = client.post(f"/api/approvals/{aid}/decide", json=body)
    assert r.status_code == 200, r.text
    assert r.json()["approval"]["status"] == "REJECTED"
    assert client.get("/api/tickets/tkt_48219").json()["ticket"]["status"] == "ROUTED"
    assert paytm.get_transaction("txn_big").refund_status == "NONE"
    assert not [e for e in _events("tool_call") if e.payload_json["name"] == "initiate_reversal"]


def test_decide_unknown_is_404(client: TestClient) -> None:
    body = {"approve": True, "decided_by": "Priya"}
    assert client.post("/api/approvals/apr_nope/decide", json=body).status_code == 404
