"""SLA guard + /api/metrics (docs/06 T17)."""

from datetime import timedelta

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import select

from app.agent import runner
from app.agent.tools import build_registry
from app.db import session
from app.db.models import AuditEvent, Notification, Ticket
from app.integrations.paytm.client import PaytmClient
from app.main import app
from app.services import context, demo, incidents, sla
from app.util.clock import now

B = "http://localhost:8000/mock/paytm/v1"


@pytest.fixture()
def paytm(monkeypatch: pytest.MonkeyPatch) -> PaytmClient:
    p = PaytmClient(B, client=TestClient(app, base_url=B))
    monkeypatch.setattr(demo, "_paytm", lambda: p)
    monkeypatch.setattr(context, "_registry", build_registry(p))
    demo.reset()
    demo.seed()
    return p


def test_metrics_after_d1_spike_d3(client: TestClient, paytm: PaytmClient) -> None:
    runner.run(demo.scenario("d1_failed_upi"))
    ids = demo.spike("AXIS", 20, 20, batch_delay_s=0, background=False)
    assert incidents.cluster()
    for tid in ids:
        runner.run(tid)
    runner.run(demo.scenario("d3_over_limit"))
    m = client.get("/api/metrics?window_minutes=240").json()
    assert m["auto_resolution_rate"] > 0.9
    assert m["awaiting_approval"] == 1
    assert m["incidents_open"] == 1
    assert m["avg_first_response_sec"] < 120
    for k in ("avg_resolution_sec", "open", "tat_breaches_prevented", "by_type", "window_minutes"):
        assert k in m
    assert m["tat_breaches_prevented"] >= 1


def test_guard_nudges_once_and_raises_p1(paytm: PaytmClient) -> None:
    tid = demo.scenario("d1_failed_upi")
    with session.SessionLocal() as db:
        t = db.get(Ticket, tid)
        assert t is not None
        t.sla_due_at = now() + timedelta(minutes=10)
        t.priority = "P3"
        t.status = "ROUTED"  # (decision: FIX7) only tickets waiting on a human are nudged
        db.commit()
    assert sla.guard() == [tid]
    assert sla.guard() == []

    def count(model: type, **kw: str) -> int:
        with session.SessionLocal() as db:
            return len(db.scalars(select(model).filter_by(**kw)).all())

    assert count(AuditEvent, ticket_id=tid, kind="sla_nudge") == 1
    assert count(Notification, ticket_id=tid) == 1
    with session.SessionLocal() as db:
        assert db.get(Ticket, tid).priority == "P1"  # type: ignore[union-attr]


def test_guard_skips_incident_linked(paytm: PaytmClient) -> None:
    # (decision: FIX5) incident-linked tickets are covered by the incident, no nudge
    tid = demo.scenario("d1_failed_upi")
    with session.SessionLocal() as db:
        t = db.get(Ticket, tid)
        assert t is not None
        t.sla_due_at = now() + timedelta(minutes=10)
        t.priority = "P3"
        t.status = "INCIDENT_LINKED"
        t.handling_mode = "incident"
        t.incident_id = "inc_deadbeef"
        db.commit()
    assert sla.guard() == []
    with session.SessionLocal() as db:
        assert db.get(Ticket, tid).priority == "P3"  # type: ignore[union-attr]
        assert not db.scalars(select(Notification).filter_by(ticket_id=tid)).all()


def test_guard_skips_spike_tickets_before_linking(paytm: PaytmClient) -> None:
    # (decision: FIX7) spike tickets are NEW until the fast path links them; never nudged then
    ids = demo.spike("AXIS", 12, 60, background=False)
    assert sla.guard() == []
    with session.SessionLocal() as db:
        assert not db.scalars(select(Notification).where(Notification.ticket_id.in_(ids))).all()
