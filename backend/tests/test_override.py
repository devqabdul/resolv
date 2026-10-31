"""Human override (R11): ROUTE / RESOLVE through the gate / ESCALATE, audited and logged."""

import json
from pathlib import Path

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
from app.services import approvals, context, demo

B = "http://localhost:8000/mock/paytm/v1"
KEYS = {"ticket_id", "masked_text", "resolv_decision", "human_decision", "note", "ts"}


@pytest.fixture()
def paytm(client: TestClient, monkeypatch: pytest.MonkeyPatch, tmp_path: Path) -> PaytmClient:
    monkeypatch.setattr(settings, "LLM_MODE", "mock")
    monkeypatch.setattr(approvals, "OVERRIDES_FILE", tmp_path / "overrides.jsonl")
    p = PaytmClient(B, client=TestClient(app, base_url=B))
    monkeypatch.setattr(demo, "_paytm", lambda: p)
    monkeypatch.setattr(context, "_registry", build_registry(p))
    demo.reset()
    demo.seed()
    return p


def _lines() -> list[dict]:
    f = approvals.OVERRIDES_FILE
    return [json.loads(x) for x in f.read_text().splitlines()] if f.exists() else []


def _events(tid: str, kind: str) -> list[AuditEvent]:
    with session.SessionLocal() as db:
        q = select(AuditEvent).where(AuditEvent.ticket_id == tid, AuditEvent.kind == kind)
        return [*db.scalars(q).all()]


def test_route(client: TestClient, paytm: PaytmClient) -> None:
    runner.run(demo.scenario("d1_failed_upi"))
    body = {"path": "ROUTE", "note": "customer disputes amount", "decided_by": "Priya"}
    r = client.post("/api/tickets/tkt_48213/override", json=body)
    assert r.status_code == 200, r.text
    assert r.json()["ticket"]["status"] == "ROUTED"
    (ev,) = _events("tkt_48213", "override")
    assert ev.actor == "human:Priya"
    assert ev.payload_json["resolv_decision"]["path"] == "RESOLVE"
    assert ev.payload_json["human_decision"]["path"] == "ROUTE"
    (line,) = _lines()
    assert set(line) == KEYS and line["ticket_id"] == "tkt_48213"
    assert client.post("/api/tickets/nope/override", json=body).status_code == 404
    assert (
        client.post("/api/tickets/tkt_48213/override", json={**body, "path": "X"}).status_code
        == 422
    )


def test_resolve_d3_goes_through_gate(client: TestClient, paytm: PaytmClient) -> None:
    runner.run(demo.scenario("d3_over_limit"))
    body = {"path": "RESOLVE", "decided_by": "Priya", "note": "approved by lead"}
    r = client.post("/api/tickets/tkt_48219/override", json=body)
    assert r.status_code == 200, r.text
    assert r.json()["ticket"]["status"] == "RESOLVED" and r.json()["blocked"] == []
    assert paytm.get_transaction("txn_big").refund_status == "INITIATED"
    assert any(
        e.payload_json["decided_by"] == "Priya" for e in _events("tkt_48219", "approval_decided")
    )
    assert client.get("/api/approvals", params={"status": "PENDING"}).json() == []
    assert len(_lines()) == 1


def test_resolve_blocked_action_not_executed(client: TestClient, paytm: PaytmClient) -> None:
    runner.run(demo.scenario("d3_over_limit"))
    bad = {"name": "initiate_reversal", "params": {"txn_id": "txn_nope", "amount_inr": 5}}
    body = {"path": "RESOLVE", "decided_by": "Priya", "actions": [bad]}
    r = client.post("/api/tickets/tkt_48219/override", json=body)
    assert r.status_code == 200, r.text
    assert r.json()["blocked"][0]["outcome"] == "BLOCKED"
    assert r.json()["ticket"]["status"] == "ROUTED"
    assert paytm.get_transaction("txn_big").refund_status == "NONE"


def test_escalate(client: TestClient, paytm: PaytmClient) -> None:
    runner.run(demo.scenario("d1_failed_upi"))
    body = {"path": "ESCALATE", "decided_by": "Priya", "note": "legal risk"}
    t = client.post("/api/tickets/tkt_48213/override", json=body).json()["ticket"]
    assert t["status"] == "ESCALATED" and t["priority"] == "P1"
