"""Incident routes (docs/02 §6.1)."""

from datetime import datetime
from typing import Any

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel, ConfigDict

from app.api.tickets import TicketOut
from app.services import incidents

router = APIRouter(prefix="/api/incidents")


class IncidentOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: str
    signature: str
    title: str
    status: str
    ticket_count: int
    first_seen: datetime
    last_seen: datetime
    owner_team: str | None = None
    proactive_notice_draft: str | None = None
    internal_summary: str | None = None
    notified_at: datetime | None = None


class NotificationOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    ts: datetime
    channel: str
    target: str
    text: str
    delivered: bool
    ticket_id: str | None = None
    incident_id: str | None = None


class IncidentDetail(BaseModel):
    incident: IncidentOut
    tickets: list[TicketOut]
    notifications: list[NotificationOut]


@router.get("", response_model=list[IncidentOut])
def list_incidents(status: str | None = None) -> Any:
    return incidents.list_incidents(status)


@router.get("/{incident_id}", response_model=IncidentDetail)
def get_incident(incident_id: str) -> Any:
    d = incidents.get(incident_id)
    if d is None:
        raise HTTPException(404, f"Incident {incident_id} not found.")
    # Masked text only, like the tickets list (CLAUDE.md rule 6).
    d["tickets"] = [
        TicketOut.model_validate(t).model_copy(update={"raw_text": ""}) for t in d["tickets"]
    ]
    return d


@router.post("/{incident_id}/notify", response_model=IncidentOut)
def notify(incident_id: str) -> Any:
    try:
        return incidents.send_notice(incident_id)
    except KeyError:
        raise HTTPException(404, f"Incident {incident_id} not found.") from None
