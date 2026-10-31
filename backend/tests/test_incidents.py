import pytest
from fastapi.testclient import TestClient
from sqlalchemy import select

from app.agent.tools import build_registry
from app.db import session
from app.db.models import AuditEvent, Incident
from app.integrations.paytm.client import PaytmClient
from app.main import app
from app.services import context, demo, incidents

B = "http://localhost:8000/mock/paytm/v1"
SIG = "failed_payment_reversal|AXIS|UPI_SWITCH_DOWN"


@pytest.fixture()
def paytm(monkeypatch: pytest.MonkeyPatch) -> PaytmClient:
    p = PaytmClient(B, client=TestClient(app, base_url=B))
    monkeypatch.setattr(demo, "_paytm", lambda: p)
    monkeypatch.setattr(context, "_registry", build_registry(p))
    demo.reset()
    demo.seed()
    return p


def _incidents() -> list[Incident]:
    with session.SessionLocal() as db:
        return [*db.scalars(select(Incident))]


def test_spike_clusters_into_one_incident(client: TestClient, paytm: PaytmClient) -> None:
    ids = demo.spike("AXIS", 20, 20)
    assert incidents.cluster()
    [inc] = _incidents()
    assert (inc.signature, inc.status, inc.owner_team) == (SIG, "OPEN", "payments_ops")
    assert "AXIS" in inc.title and "UPI_SWITCH_DOWN" in inc.title
    assert inc.ticket_count >= 10 and inc.proactive_notice_draft

    assert [i["id"] for i in client.get("/api/incidents").json()] == [inc.id]
    d = client.get(f"/api/incidents/{inc.id}").json()
    assert d["incident"]["id"] == inc.id
    assert sorted(t["id"] for t in d["tickets"]) == sorted(ids)
    assert all(t["handling_mode"] == "incident" for t in d["tickets"])
    assert d["notifications"][0]["target"] == "#ops"
    assert client.get(f"/api/tickets/{ids[0]}").json()["incident"]["id"] == inc.id

    assert incidents.cluster() == []
    assert len(_incidents()) == 1

    r = client.post(f"/api/incidents/{inc.id}/notify").json()
    assert r["status"] == "COMMUNICATED" and r["notified_at"]
    with session.SessionLocal() as db:
        calls = db.scalars(select(AuditEvent).where(AuditEvent.kind == "tool_call")).all()
        linked = db.scalars(select(AuditEvent).where(AuditEvent.kind == "incident_linked")).all()
    assert any(c.payload_json["name"] == "notify_customer" for c in calls)
    assert len(linked) == len(ids) and all(e.actor == "system" for e in linked)
    assert client.post("/api/incidents/inc_nope/notify").status_code == 404


def test_single_ticket_makes_no_incident(paytm: PaytmClient) -> None:
    demo.scenario("d1_failed_upi")
    assert incidents.cluster() == []
    assert _incidents() == []
    sig = context.load_ticket("tkt_48213").signature
    assert sig == "failed_payment_reversal|HDFC|BANK_SWITCH_TIMEOUT"
