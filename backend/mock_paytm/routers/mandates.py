from fastapi import APIRouter, HTTPException

from .. import store

router = APIRouter()


@router.get("/mandates")
def list_mandates(customer_id: str | None = None) -> list[dict]:
    return [
        m for m in store.mandates.values() if not customer_id or m["customer_id"] == customer_id
    ]


@router.post("/mandates/{id}/cancel")
def cancel_mandate(id: str) -> dict:
    m = store.mandates.get(id)
    if m is None:
        raise HTTPException(404, "mandate not found")
    m["status"] = "CANCELLED"
    return {"status": "CANCELLED", "effective_at": store.iso(store.now())}
