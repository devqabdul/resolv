from fastapi import APIRouter
from pydantic import BaseModel

from .. import store

router = APIRouter()


class NotificationIn(BaseModel):
    customer_id: str
    channel: str
    text: str


@router.post("/notifications")
def send_notification(body: NotificationIn) -> dict:
    store.notifications.append({**body.model_dump(), "sent_at": store.iso(store.now())})
    return {"delivered": True}
