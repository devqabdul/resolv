"""Audit trail route (docs/02 §6.1); `/api/notifications` joins here in a later task."""

from datetime import datetime
from typing import Any

from fastapi import APIRouter, Query
from pydantic import BaseModel, ConfigDict, Field
from sqlalchemy import select

from app.db import session
from app.db.models import AuditEvent

router = APIRouter(prefix="/api")


class AuditEventOut(BaseModel):
    model_config = ConfigDict(from_attributes=True, populate_by_name=True)

    id: int
    ticket_id: str
    run_id: str | None = None
    ts: datetime
    actor: str
    kind: str
    # (decision: T9) column is payload_json; the wire name is `payload` (docs/06 T9 accept uses .payload)
    payload: dict[str, Any] = Field(validation_alias="payload_json")


@router.get("/audit", response_model=list[AuditEventOut])
def get_audit(
    ticket_id: str | None = None,
    kind: str | None = None,  # (decision: T9) extra filter beyond docs/02 §6.1
    limit: int = Query(200, ge=1, le=1000),
) -> list[AuditEvent]:
    """Newest last within the window of the latest `limit` events."""
    q = select(AuditEvent)
    if ticket_id:
        q = q.where(AuditEvent.ticket_id == ticket_id)
    if kind:
        q = q.where(AuditEvent.kind == kind)
    with session.SessionLocal() as db:
        rows = db.scalars(q.order_by(AuditEvent.id.desc()).limit(limit)).all()
    return [*reversed(rows)]
