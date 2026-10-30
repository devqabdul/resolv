from datetime import timedelta

from fastapi import APIRouter, HTTPException

from .. import store

router = APIRouter()


@router.get("/settlements")
def list_settlements(merchant_id: str | None = None) -> list[dict]:
    return [
        s for s in store.settlements.values() if not merchant_id or s["merchant_id"] == merchant_id
    ]


@router.post("/settlements/{id}/retrigger")
def retrigger(id: str) -> dict:
    s = store.settlements.get(id)
    if s is None:
        raise HTTPException(404, "settlement not found")
    if store.merchants.get(s["merchant_id"], {}).get("kyc_status") != "VERIFIED":
        raise HTTPException(422, "merchant KYC not VERIFIED")
    s["status"] = "PROCESSING"
    s["expected_at"] = store.iso(store.now() + timedelta(days=1))
    return {"status": "PROCESSING", "expected_at": s["expected_at"]}
