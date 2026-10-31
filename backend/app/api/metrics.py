"""Health (docs/02 §6.1); `/api/metrics` and `/api/evals/report` join here later (decision: T9)."""

import json
from pathlib import Path

import httpx
from fastapi import APIRouter, HTTPException
from sqlalchemy import text

from app.config import settings
from app.db import session
from app.services import metrics
from mock_paytm import store

router = APIRouter(prefix="/api")


def _mock_status() -> str:
    """(decision: T9) in-process store call when the mock is mounted here, else a 1 s GET."""
    base = settings.PAYTM_BASE_URL.rstrip("/")
    if base.endswith("/mock/paytm/v1"):
        store.now()  # touches the mounted mock's module; no socket
        return "mounted"
    try:
        httpx.get(f"{base}/customers/cust_riya", timeout=1.0)
    except httpx.HTTPError:
        return "unreachable"
    return "reachable"


@router.get("/health")
def health() -> dict[str, object]:
    """Cheap by design (< 300 ms): SELECT 1 plus the mock probe."""
    with session.SessionLocal() as db:
        db.execute(text("SELECT 1"))
    mock = _mock_status()
    return {
        "ok": mock in {"mounted", "reachable"},
        "llm_mode": settings.LLM_MODE,
        "llm_provider": settings.LLM_PROVIDER,  # (decision: SARVAM-1)
        "db": settings.DATABASE_URL.split(":", 1)[0].split("+", 1)[0],
        "mock_paytm": mock,
    }


@router.get("/metrics")
def get_metrics(window_minutes: int = 240) -> dict[str, object]:
    return metrics.compute(window_minutes)


_EVALS = Path(__file__).resolve().parents[2] / "evals"


@router.get("/evals/report")
def evals_report() -> dict[str, object]:
    """docs/02 §6.1 + D15: the committed eval report plus `overrides_count` (lines of overrides.jsonl).
    (decision: T22) 404 when `evals.run` has not produced a report yet."""
    js, md = _EVALS / "report.json", _EVALS / "report.md"
    if not js.exists() or not md.exists():
        raise HTTPException(404, "No eval report yet; run `python -m evals.run`.")
    ov = _EVALS / "overrides.jsonl"
    count = len([x for x in ov.read_text().splitlines() if x.strip()]) if ov.exists() else 0
    data = json.loads(js.read_text())
    return {
        "generated_at": data["generated_at"],
        "markdown": md.read_text(),
        "json": data,
        "overrides_count": count,
    }
