"""In-app channel: a row in the `notifications` table (docs/02 §5)."""

from datetime import datetime

from app.db import session
from app.db.models import Notification


def write(
    channel: str,
    target: str,
    text: str,
    delivered: bool,
    ticket_id: str | None,
    incident_id: str | None,
    ts: datetime,
) -> None:
    with session.SessionLocal() as db:
        db.add(
            Notification(
                ts=ts,
                channel=channel,
                target=target,
                text=text,
                delivered=delivered,
                ticket_id=ticket_id,
                incident_id=incident_id,
            )
        )
        db.commit()
