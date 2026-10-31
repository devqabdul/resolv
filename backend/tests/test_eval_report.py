"""The committed eval report (docs/06 T22): headline numbers and GET /api/evals/report."""

import json
from pathlib import Path

from fastapi.testclient import TestClient

REPORT = Path(__file__).resolve().parents[1] / "evals" / "report.json"


def test_report_json() -> None:
    r = json.loads(REPORT.read_text())
    assert r["n"] >= 58
    assert "false_action_rate" in r
    assert r["gate_catch_core"] == {"caught": 5, "total": 5}  # the 5 FR-12 adversarial kinds
    assert r["gate_catch"]["caught"] == r["gate_catch"]["total"]  # all adversarial rows


def test_report_api(client: TestClient) -> None:
    d = client.get("/api/evals/report").json()
    assert set(d) == {"generated_at", "markdown", "json", "overrides_count"}
    assert d["json"]["n"] >= 58 and d["markdown"].startswith("# Resolv eval report")
    assert d["overrides_count"] == len((REPORT.parent / "overrides.jsonl").read_text().splitlines())
