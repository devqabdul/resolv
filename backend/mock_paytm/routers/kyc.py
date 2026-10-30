from fastapi import APIRouter, HTTPException

from .. import store

router = APIRouter()


@router.get("/kyc/{id}")
def get_kyc(id: str) -> dict:
    if id not in store.kyc:
        raise HTTPException(404, "kyc record not found")
    return store.kyc[id]


@router.post("/kyc/{id}/retrigger")
def retrigger_kyc(id: str) -> dict:
    k = store.kyc.get(id)
    if k is None:
        raise HTTPException(404, "kyc record not found")
    link = f"https://paytm.example/kyc/resubmit/{id}"
    k.update(status="PENDING", resubmission_link=link)
    k.pop("rejection_reason", None)
    return {"status": "PENDING", "resubmission_link": link}
