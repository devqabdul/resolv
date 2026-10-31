from typing import Any

import httpx
import pytest
from fastapi.testclient import TestClient

from app.agent import runner
from app.agent.tools import build_registry
from app.config import settings
from app.integrations.paytm.client import PaytmClient
from app.main import app
from app.services import context, demo

B = "http://localhost:8000/mock/paytm/v1"


def _run_d3(
    client: TestClient, monkeypatch: pytest.MonkeyPatch, status: int
) -> list[dict[str, Any]]:
    calls: list[dict[str, Any]] = []

    def fake_post(url: str, **kw: Any) -> httpx.Response:
        calls.append({"url": url, **kw})
        return httpx.Response(status)

    p = PaytmClient(B, client=TestClient(app, base_url=B))
    monkeypatch.setattr(demo, "_paytm", lambda: p)
    monkeypatch.setattr(context, "_registry", build_registry(p))
    monkeypatch.setattr(settings, "SLACK_WEBHOOK_URL", "https://hooks.example.test/x")
    monkeypatch.setattr("app.integrations.notify.slack.httpx.post", fake_post)
    client.post("/api/demo/reset")
    client.post("/api/demo/seed")
    runner.run(demo.scenario("d3_over_limit"))
    return calls


@pytest.mark.parametrize("status,ok", [(200, True), (400, False)])
def test_slack_post_and_row(
    client: TestClient, monkeypatch: pytest.MonkeyPatch, status: int, ok: bool
) -> None:
    calls = _run_d3(client, monkeypatch, status)
    assert len(calls) == 1
    assert calls[0]["timeout"] == 3.0
    assert list(calls[0]["json"]) == ["text"] and "tkt_48219" in calls[0]["json"]["text"]
    rows = [r for r in client.get("/api/notifications").json() if r["ticket_id"] == "tkt_48219"]
    by = {r["channel"]: r for r in rows}
    assert by["inapp"]["delivered"] is True
    assert by["slack"]["delivered"] is ok
    assert by["slack"]["ts"] == by["inapp"]["ts"]
