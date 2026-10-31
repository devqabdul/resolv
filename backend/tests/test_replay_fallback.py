"""R25: replay miss with no key/network falls back to mock with 0 SDK calls (docs/06 T25)."""

import logging
import os
from pathlib import Path

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import select

from app.agent import runner
from app.agent.tools import build_registry
from app.config import settings
from app.db import session
from app.db.models import AuditEvent, Ticket
from app.integrations.llm import client as llm_client
from app.integrations.paytm.client import PaytmClient
from app.main import app
from app.services import context, demo

B = "http://localhost:8000/mock/paytm/v1"
ROOT = Path(__file__).parents[2]


def test_replay_miss_without_key_uses_mock(
    client: TestClient,
    monkeypatch: pytest.MonkeyPatch,
    tmp_path: Path,
    caplog: pytest.LogCaptureFixture,
) -> None:
    import anthropic

    p = PaytmClient(B, client=TestClient(app, base_url=B))
    monkeypatch.setattr(demo, "_paytm", lambda: p)
    monkeypatch.setattr(context, "_registry", build_registry(p))

    calls: list[tuple] = []

    class StubSdk:
        def __init__(self, *a, **kw) -> None:
            calls.append(("init", a, kw))

        def __getattr__(self, name: str):
            calls.append(("attr", name))
            raise AssertionError("Anthropic SDK must not be used")

    monkeypatch.setattr(anthropic, "Anthropic", StubSdk)
    monkeypatch.setattr(settings, "LLM_MODE", "replay")
    monkeypatch.setattr(settings, "ANTHROPIC_API_KEY", "")
    monkeypatch.setattr(settings, "LLM_CACHE_DIR", str(tmp_path / "empty_cache"))
    llm_client.FALLBACKS.clear()
    caplog.set_level(logging.INFO)

    demo.reset()
    demo.seed()
    tid = demo.scenario("d1_failed_upi")
    runner.run(tid)

    assert tid == "tkt_48213"
    with session.SessionLocal() as db:
        assert db.get(Ticket, tid).status == "RESOLVED"
        ev = db.scalars(select(AuditEvent).where(AuditEvent.ticket_id == tid)).all()
    written = {
        e.payload_json["name"]
        for e in ev
        if e.kind == "tool_call" and not e.payload_json["name"].startswith(("get_", "list_"))
    }
    assert {"initiate_reversal", "credit_compensation"} <= written
    assert "cache_miss" in caplog.text
    assert "llm_fallback mode=replay reason=no_api_key" in caplog.text
    assert llm_client.FALLBACKS and set(llm_client.FALLBACKS) == {"no_api_key"}
    assert calls == []


def test_warm_cache_script_static() -> None:
    p = ROOT / "scripts" / "warm_cache.sh"
    assert p.exists() and os.access(p, os.X_OK)
    text = p.read_text()
    for needle in [
        "LLM_MODE=live",
        "demo/reset",
        "demo/seed",
        "d1_failed_upi",
        "d3_over_limit",
        "hinglish_refund_status",
        "merchant_settlement",
        "kyc_rejected",
        "mandate_email",
        "dispute",
        "demo/spike",
        "make evals",
        "LLM_MODE=replay",
        "make test",
        "make lint",
    ]:
        assert needle in text, needle
