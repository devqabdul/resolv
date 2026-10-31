"""SARVAM-1: Sarvam provider parses, falls back to mock, never touches the network in tests."""

import json
import logging
from pathlib import Path

import httpx
import pytest

from app.config import settings
from app.domain.enums import Path as DPath
from app.domain.schemas import Decision
from app.integrations.llm import client as llm_client
from app.integrations.llm.client import LLMClient

DISPUTE = "I want a chargeback"  # mock answers ROUTE -> risk


@pytest.fixture(autouse=True)
def _env(monkeypatch: pytest.MonkeyPatch, tmp_path: Path) -> None:
    monkeypatch.setattr(settings, "LLM_MODE", "live")
    monkeypatch.setattr(settings, "LLM_PROVIDER", "sarvam")
    monkeypatch.setattr(settings, "SARVAM_API_KEY", "test-key")
    monkeypatch.setattr(settings, "ANTHROPIC_API_KEY", "")
    monkeypatch.setattr(settings, "LLM_CACHE_DIR", str(tmp_path / "cache"))
    llm_client.FALLBACKS.clear()


def _http(handler) -> httpx.Client:
    return httpx.Client(transport=httpx.MockTransport(handler))


def _reply(message: dict) -> httpx.Response:
    return httpx.Response(200, json={"choices": [{"message": message, "finish_reason": "stop"}]})


def test_valid_tool_call_parses_into_schema() -> None:
    seen: list[httpx.Request] = []
    dec = Decision(path=DPath.ROUTE, route_to_team="l1_support")

    def handler(req: httpx.Request) -> httpx.Response:
        seen.append(req)
        call = {"function": {"name": "record_decision", "arguments": dec.model_dump_json()}}
        return _reply({"role": "assistant", "content": None, "tool_calls": [call]})

    out = LLMClient(http=_http(handler)).structured("sys", "usr", Decision, "m")
    assert out == dec
    req = seen[0]
    body = json.loads(req.content)
    assert str(req.url) == "https://api.sarvam.ai/v1/chat/completions"
    assert req.headers["api-subscription-key"] == "test-key"
    assert body["model"] == "sarvam-105b" and body["temperature"] == 0
    assert body["max_tokens"] <= 1500 and body["reasoning_effort"] is None
    assert body["tool_choice"] == {"type": "function", "function": {"name": "record_decision"}}
    assert list(Path(settings.LLM_CACHE_DIR).glob("*.json"))  # live writes the cache


def test_invalid_json_falls_back_to_mock(caplog: pytest.LogCaptureFixture) -> None:
    def handler(req: httpx.Request) -> httpx.Response:
        return _reply({"role": "assistant", "content": "sorry, not json"})

    with caplog.at_level(logging.INFO):
        out = LLMClient(http=_http(handler)).structured("sys", DISPUTE, Decision, "m")
    assert out.route_to_team == "risk"  # mock answer
    assert "llm_fallback provider=sarvam" in caplog.text
    assert llm_client.FALLBACKS == ["llm_error"]
    assert not list(Path(settings.LLM_CACHE_DIR).glob("*.json"))  # mock output is never cached


def test_missing_key_in_live_mode_falls_back_cleanly(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setattr(settings, "SARVAM_API_KEY", "")
    monkeypatch.setattr(httpx, "post", lambda *a, **kw: pytest.fail("network must not be used"))
    out = LLMClient().structured("sys", DISPUTE, Decision, "m")
    assert out.path == DPath.ROUTE and out.route_to_team == "risk"
    assert llm_client.FALLBACKS == ["no_api_key"]


def test_replay_hits_warmed_sarvam_cache_without_keys(monkeypatch: pytest.MonkeyPatch) -> None:
    dec = Decision(path=DPath.ROUTE, route_to_team="l1_support")

    def handler(req: httpx.Request) -> httpx.Response:
        call = {"function": {"name": "record_decision", "arguments": dec.model_dump_json()}}
        return _reply({"role": "assistant", "content": None, "tool_calls": [call]})

    LLMClient(http=_http(handler)).structured("sys", DISPUTE, Decision, "m")  # live warm
    monkeypatch.setattr(settings, "LLM_MODE", "replay")
    monkeypatch.setattr(settings, "SARVAM_API_KEY", "")
    assert LLMClient().structured("sys", DISPUTE, Decision, "m") == dec  # not the mock (risk)
    assert llm_client.FALLBACKS == []
