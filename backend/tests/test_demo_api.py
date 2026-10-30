import pytest
from fastapi.testclient import TestClient

from app.agent import runner
from app.agent.tools import build_registry
from app.integrations.paytm.client import PaytmClient
from app.main import app
from app.services import context, demo

B = "http://localhost:8000/mock/paytm/v1"


@pytest.fixture()
def paytm(monkeypatch: pytest.MonkeyPatch) -> PaytmClient:
    p = PaytmClient(B, client=TestClient(app, base_url=B))
    monkeypatch.setattr(demo, "_paytm", lambda: p)
    monkeypatch.setattr(context, "_registry", build_registry(p))
    return p


def test_d1_end_to_end(client: TestClient, paytm: PaytmClient) -> None:
    assert client.post("/api/demo/reset").status_code == 200
    assert client.post("/api/demo/seed").json()["kb_docs"] == 6
    assert client.post("/api/demo/ticket/d1_failed_upi").json() == {"id": "tkt_48213"}
    assert client.post("/api/demo/ticket/nope").status_code == 404

    runner.run("tkt_48213")
    d = client.get("/api/tickets/tkt_48213").json()
    assert d["ticket"]["status"] == "RESOLVED"
    kinds = {e["kind"] for e in d["timeline"]}
    assert {
        "ingest", "pii_masked", "tool_call", "tool_result", "understanding",
        "decision", "gate", "verify", "reply_sent", "status_change",
    } <= kinds  # fmt: skip
    assert paytm.get_transaction("txn_48213_a").refund_status == "INITIATED"
    calls = {
        e["payload"]["name"]: e["payload"]["params"]
        for e in d["timeline"]
        if e["kind"] == "tool_call"
    }
    assert calls["initiate_reversal"]["amount_inr"] == 2499
    assert calls["credit_compensation"]["amount_inr"] == 200


def test_spike_texts_deterministic(client: TestClient, paytm: PaytmClient) -> None:
    body = {"issuer_bank": "AXIS", "count": 12, "minutes": 20}
    runs = []
    for _ in range(2):
        client.post("/api/demo/reset")
        client.post("/api/demo/seed")
        ids = client.post("/api/demo/spike", json=body).json()["ticket_ids"]
        assert len(ids) == 12
        runs.append(
            sorted(client.get(f"/api/tickets/{i}").json()["ticket"]["raw_text"] for i in ids)
        )
    assert runs[0] == runs[1]
