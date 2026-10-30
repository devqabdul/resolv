from typing import Any

from app.db import session
from app.db.models import AuditEvent
from app.domain.enums import AuditKind


def record(
    ticket_id: str,
    kind: AuditKind | str,
    payload: dict[str, Any] | None = None,
    actor: str = "resolv",
    run_id: str | None = None,
) -> int:
    """Insert one audit_events row (own session, committed). Returns its id."""
    with session.SessionLocal() as db:
        ev = AuditEvent(
            ticket_id=ticket_id,
            run_id=run_id,
            actor=actor,
            kind=str(AuditKind(kind)),
            payload_json=payload or {},
        )
        db.add(ev)
        db.commit()
        return ev.id
