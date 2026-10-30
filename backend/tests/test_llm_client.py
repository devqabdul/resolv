import json
import logging
from pathlib import Path
from types import SimpleNamespace

import pytest

from app.config import settings
from app.domain.enums import ActionName
from app.domain.enums import Path as DPath
from app.domain.schemas import ContextBundle, Decision, RegulatoryClock, Transaction, Understanding
from app.integrations.llm.client import LLMClient, load_prompt

FIX = Path(__file__).parent / "fixtures" / "paytm"
D1 = "Paid Rs 2,499 by UPI, money debited but order failed 3 days ago, still no refund"


def _user() -> str:
    txns = [Transaction(**t) for t in json.loads((FIX / "transactions_riya.json").read_text())]
    clock = RegulatoryClock(
        days_since_txn=3,
        tat_deadline="2026-10-29T10:00:00Z",
        days_late=2,
        compensation_due_inr=200,
    )
    ctx = ContextBundle(transactions=txns, regulatory_clock=clock)
    return f"<ticket>{D1}</ticket>\n<context>{ctx.model_dump_json()}</context>"


class FakeSdk:
    def __init__(self) -> None:
        self.calls: list[dict] = []
        self.messages = SimpleNamespace(create=self._create)

    def _create(self, **kw):
        self.calls.append(kw)
        dec = Decision(path=DPath.ROUTE, route_to_team="l1_support")
        block = SimpleNamespace(type="tool_use", input=dec.model_dump(mode="json"))
        return SimpleNamespace(content=[block])


@pytest.fixture(autouse=True)
def _env(monkeypatch: pytest.MonkeyPatch, tmp_path: Path) -> None:
    monkeypatch.setattr(settings, "LLM_MODE", "mock")
    monkeypatch.setattr(settings, "ANTHROPIC_API_KEY", "")
    monkeypatch.setattr(settings, "LLM_CACHE_DIR", str(tmp_path / "cache"))


def test_mock_d1_decision() -> None:
    c = LLMClient()
    und = c.structured("s", _user(), Understanding, settings.LLM_MODEL_UNDERSTAND)
    assert und.confidence >= 0.9 and und.entities["txn_id"] == "txn_48213_a"
    dec = c.structured("s", _user(), Decision, settings.LLM_MODEL_DECIDE)
    assert dec.path == DPath.RESOLVE
    names = [a.name for a in dec.proposed_actions]
    assert names == [
        ActionName.initiate_reversal,
        ActionName.credit_compensation,
        ActionName.send_reply,
    ]
    assert dec.proposed_actions[0].params["amount_inr"] == 2499
    assert dec.proposed_actions[1].params["amount_inr"] == 200


def test_mock_dispute_routes_to_risk() -> None:
    dec = LLMClient().structured("s", "I want a chargeback", Decision, "m")
    assert dec.path == DPath.ROUTE and dec.route_to_team == "risk" and not dec.proposed_actions


def test_live_sdk_args_and_replay_cache(
    monkeypatch: pytest.MonkeyPatch, caplog: pytest.LogCaptureFixture
) -> None:
    monkeypatch.setattr(settings, "LLM_MODE", "replay")
    sdk = FakeSdk()
    c = LLMClient(sdk=sdk)
    with caplog.at_level(logging.INFO):
        first = c.structured("sys", "usr", Decision, "claude-sonnet-5-5")
        assert len(sdk.calls) == 1 and "cache_miss" in caplog.text
        kw = sdk.calls[0]
        assert kw["temperature"] == 0 and kw["max_tokens"] == 1500
        assert kw["tool_choice"] == {"type": "tool", "name": "record_decision"}
        caplog.clear()
        second = c.structured("sys", "usr", Decision, "claude-sonnet-5-5")
    assert "cache_hit" in caplog.text and len(sdk.calls) == 1 and second == first


def test_replay_miss_without_key_falls_back_to_mock(
    monkeypatch: pytest.MonkeyPatch, caplog: pytest.LogCaptureFixture
) -> None:
    monkeypatch.setattr(settings, "LLM_MODE", "replay")
    with caplog.at_level(logging.INFO):
        dec = LLMClient().structured("sys", _user(), Decision, "m")
    assert "cache_miss" in caplog.text and dec.path == DPath.RESOLVE


def test_prompts_exist() -> None:
    for n in ("understand", "decide", "incident_notice", "reply_style"):
        assert load_prompt(n).strip()
