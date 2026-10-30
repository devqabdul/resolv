"""Health (docs/02 §6.1); `/api/metrics` and `/api/evals/report` join here later (decision: T9)."""

from fastapi import APIRouter
from sqlalchemy import text

from app.config import settings
from app.db import session

router = APIRouter(prefix="/api")


@router.get("/health")
def health() -> dict[str, object]:
    """Cheap by design (< 300 ms): SELECT 1, no network; the mock is mounted in-process."""
    with session.SessionLocal() as db:
        db.execute(text("SELECT 1"))
    return {
        "ok": True,
        "llm_mode": settings.LLM_MODE,
        "db": settings.DATABASE_URL.split(":", 1)[0].split("+", 1)[0],
        "mock_paytm": "mounted",
    }
