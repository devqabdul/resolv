from datetime import UTC, datetime

from app.config import settings


def now() -> datetime:
    """UTC now; honours DEMO_NOW_OVERRIDE (ISO-8601) when set (decision, docs/02 §6)."""
    if settings.DEMO_NOW_OVERRIDE:
        dt = datetime.fromisoformat(settings.DEMO_NOW_OVERRIDE)
        return dt if dt.tzinfo else dt.replace(tzinfo=UTC)
    return datetime.now(tz=UTC)
