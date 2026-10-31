"""Ingest fast path + spike realism (docs/06 T16, docs/02 §8)."""

import time
from typing import Any

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import select

from app.agent import runner
from app.agent.tools import build_registry
from app.config import settings
from app.db import session
from app.db.models import AuditEvent, Incident, IncidentTicket
from app.integrations.helpdesk.internal import helpdesk
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


def _events(ticket_id: str) -> list[AuditEvent]:
    with session.SessionLocal() as db:
        return [*db.scalars(select(AuditEvent).where(AuditEvent.ticket_id == ticket_id))]


def _incident() -> Incident:
    with session.SessionLocal() as db:
        [inc] = db.scalars(select(Incident)).all()
        return inc


@pytest.mark.parametrize("engine", ["langgraph", "runner"])
def test_matching_ticket_takes_fast_path(
    engine: str, paytm: PaytmClient, monkeypatch: pytest.MonkeyPatch
) -> None:
    monkeypatch.setattr(settings, "AGENT_ENGINE", engine)
    demo.spike("AXIS", 20, 20)
    assert incidents.cluster()
    inc = _incident()
    assert (inc.signature, inc.status, inc.ticket_count) == (SIG, "OPEN", 20)

    [tid] = demo.spike("AXIS", 1, 20)
    sent: list[str] = []
    real = helpdesk.reply

    def spy(t: Any, text: str, *a: Any, **k: Any) -> None:
        sent.append(text)
        real(t, text, *a, **k)

    monkeypatch.setattr(helpdesk, "reply", spy)
    runner.run(tid)

    t = context.load_ticket(tid)
    assert (t.status, t.handling_mode) == ("INCIDENT_LINKED", "incident")
    kinds = [e.kind for e in _events(tid)]
    assert "incident_fast_path" in kinds and "reply_sent" in kinds
    assert not {"understanding", "decision"} & set(kinds)
    fp = next(e for e in _events(tid) if e.kind == "incident_fast_path")
    assert fp.payload_json["incident_id"] == inc.id
    [text] = sent
    assert "AXIS UPI payments" in text and text.endswith(f"Ref {inc.id}")
    with session.SessionLocal() as db:
        link = db.get(IncidentTicket, (inc.id, tid))
        row = db.get(Incident, inc.id)
    assert link is not None and link.via == "fast_path"
    assert row is not None and row.ticket_count == 21


def test_spike_of_120_absorbed_and_health_fast(client: TestClient, paytm: PaytmClient) -> None:
    ids = demo.spike("AXIS", 120, 20, batch_delay_s=0, background=False)
    assert len(ids) == 120
    assert incidents.cluster()
    for n, tid in enumerate(ids, 1):
        runner.run(tid)
        if n >= 10:
            incidents.cluster()
    inc = _incident()
    assert inc.ticket_count == 120
    with session.SessionLocal() as db:
        understood = set(
            db.scalars(select(AuditEvent.ticket_id).where(AuditEvent.kind == "understanding"))
        )
    assert len(understood & set(ids)) <= 15
    assert {context.load_ticket(i).status for i in ids} == {"INCIDENT_LINKED"}

    for _ in range(20):
        t0 = time.perf_counter()
        assert client.get("/api/health").status_code == 200
        assert time.perf_counter() - t0 < 0.3


def test_background_spike_returns_ids_at_once(paytm: PaytmClient) -> None:
    t0 = time.perf_counter()
    ids = demo.spike("AXIS", 25, 20, batch_delay_s=0.2, background=True)
    assert len(ids) == 25 and time.perf_counter() - t0 < 0.4
    deadline = time.time() + 5
    while time.time() < deadline:
        try:
            context.load_ticket(ids[-1])
            break
        except KeyError:
            time.sleep(0.05)
    assert all(context.load_ticket(i).customer_id for i in ids)
