"""Health (docs/02 §6.1); `/api/metrics` and `/api/evals/report` join here later (decision: T9)."""

import httpx
from fastapi import APIRouter
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
        "db": settings.DATABASE_URL.split(":", 1)[0].split("+", 1)[0],
        "mock_paytm": mock,
    }


@router.get("/metrics")
def get_metrics(window_minutes: int = 240) -> dict[str, object]:
    return metrics.compute(window_minutes)
