import pytest
from fastapi.testclient import TestClient

from app.agent import runner
from app.agent.tools import build_registry
from app.integrations.paytm.client import PaytmClient
from app.main import app
from app.services import context, demo

B = "http://localhost:8000/mock/paytm/v1"


@pytest.fixture()
def d3(client: TestClient, monkeypatch: pytest.MonkeyPatch) -> TestClient:
    p = PaytmClient(B, client=TestClient(app, base_url=B))
    monkeypatch.setattr(demo, "_paytm", lambda: p)
    monkeypatch.setattr(context, "_registry", build_registry(p))
    client.post("/api/demo/reset")
    client.post("/api/demo/seed")
    runner.run(demo.scenario("d3_over_limit"))
    return client


def test_handoff_notification_listed(d3: TestClient) -> None:
    rows = d3.get("/api/notifications").json()
    row = next(r for r in rows if r["ticket_id"] == "tkt_48219")
    assert set(row) == {
        "id",
        "ts",
        "channel",
        "target",
        "text",
        "delivered",
        "ticket_id",
        "incident_id",
    }
    assert row["channel"] == "inapp" and row["delivered"] is True
    assert row["target"].startswith("team:")
    assert "http://localhost:3000/tickets/tkt_48219" in row["text"]
    assert "gate:" in row["text"]
    assert len(d3.get("/api/notifications?limit=1").json()) == 1
    kinds = [e["kind"] for e in d3.get("/api/audit?ticket_id=tkt_48219").json()]
    assert "notification" in kinds
