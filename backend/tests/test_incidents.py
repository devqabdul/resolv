import pytest
from fastapi.testclient import TestClient
from sqlalchemy import select

from app.agent import runner
from app.agent.tools import build_registry
from app.db import session
from app.db.models import AuditEvent, Incident, Ticket
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

    # (decision: FIX4) threaded path: returns COMMUNICATED at once, sends finish in the thread
    import threading

    assert incidents.send_notice(inc.id, background=True).status == "COMMUNICATED"
    for t in threading.enumerate():
        if t.name == "incident-notice":
            t.join(timeout=10)
    with session.SessionLocal() as db:
        notes = db.scalars(select(AuditEvent).where(AuditEvent.kind == "notification")).all()
    sent = [e.payload_json["sent"] for e in notes if e.payload_json.get("channel") == "customer"]
    assert sent == [len(ids)] * 2


def test_single_ticket_makes_no_incident(paytm: PaytmClient) -> None:
    demo.scenario("d1_failed_upi")
    assert incidents.cluster() == []
    assert _incidents() == []
    sig = context.load_ticket("tkt_48213").signature
    assert sig == "failed_payment_reversal|HDFC|BANK_SWITCH_TIMEOUT"


def test_resolved_spike_tickets_still_cluster(paytm: PaytmClient) -> None:
    ids = demo.spike("AXIS", 20, 20)
    for i in ids:
        runner.run(i)
    assert {context.load_ticket(i).status for i in ids} == {"RESOLVED"}
    assert incidents.cluster()
    [inc] = _incidents()
    assert (inc.signature, inc.status) == (SIG, "OPEN") and inc.ticket_count >= 10
    with session.SessionLocal() as db:
        linked = {
            e.ticket_id
            for e in db.scalars(select(AuditEvent).where(AuditEvent.kind == "incident_linked"))
        }
    assert linked == set(ids)
    with session.SessionLocal() as db:
        rows = db.scalars(select(Ticket).where(Ticket.id.in_(ids))).all()
    assert {(t.status, t.incident_id, t.handling_mode) for t in rows} == {
        ("RESOLVED", inc.id, "incident")
    }
    assert incidents.get(inc.id)["incident"].ticket_count == len(ids)  # type: ignore[index]
    assert incidents.cluster() == []
    assert len(_incidents()) == 1 and len(incidents.get(inc.id)["tickets"]) == len(ids)  # type: ignore[index]
