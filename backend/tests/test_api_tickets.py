import pytest
from fastapi.testclient import TestClient

from app.agent.tools import build_registry
from app.config import settings
from app.integrations.paytm.client import PaytmClient
from app.main import app
from app.services import context

B = "http://localhost:8000/mock/paytm/v1"
D1 = (
    "Paid Rs 2,499 by UPI from riya@okhdfc, money debited but order failed 3 days ago, "
    "still no refund. Call me on +91 98765 43210."
)


@pytest.fixture()
def seeded(monkeypatch: pytest.MonkeyPatch) -> None:
    paytm = PaytmClient(B, client=TestClient(app, base_url=B))
    paytm.admin_reset()
    paytm.admin_seed()
    monkeypatch.setattr(context, "_registry", build_registry(paytm))


def test_health(client: TestClient) -> None:
    r = client.get("/api/health")
    body = r.json()
    assert body["ok"] is True and body["mock_paytm"] in {"mounted", "reachable"}
    assert body["llm_mode"] == "mock" and body["db"] == "sqlite"


def test_health_mock_unreachable(client: TestClient, monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setattr(settings, "PAYTM_BASE_URL", "http://127.0.0.1:9/v1")
    body = client.get("/api/health").json()
    assert body["mock_paytm"] == "unreachable" and body["ok"] is False


def test_ticket_lifecycle(client: TestClient, seeded: None) -> None:
    r = client.post(
        "/api/tickets", json={"channel": "in_app_chat", "customer_id": "cust_riya", "text": D1}
    )
    t = r.json()
    assert r.status_code == 200 and t["status"] == "NEW" and t["id"].startswith("tkt_")
    assert client.post("/api/tickets", json={"channel": "fax", "text": "x"}).status_code == 422

    listed = client.get("/api/tickets", params={"status": "NEW"}).json()
    mine = next(i for i in listed["items"] if i["id"] == t["id"])
    assert listed["total"] >= 1 and "98765" not in mine["masked_text"] and mine["raw_text"] == ""

    d = client.get(f"/api/tickets/{t['id']}").json()
    assert {"ticket", "run", "timeline", "approvals", "incident"} <= d.keys()
    assert "98765" in d["ticket"]["raw_text"]
    assert client.get("/api/tickets/tkt_nope").json() == {"detail": "ticket tkt_nope not found"}

    done = client.post(f"/api/tickets/{t['id']}/run").json()
    assert done["ticket"]["status"] == "RESOLVED" and done["run"]["outcome"] == "RESOLVED"

    events = client.get("/api/audit", params={"ticket_id": t["id"]}).json()
    assert "decision" in {e["kind"] for e in events}
    only = client.get("/api/audit", params={"ticket_id": t["id"], "kind": "decision"}).json()
    assert only and {e["kind"] for e in only} == {"decision"}
