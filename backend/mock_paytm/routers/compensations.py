from uuid import uuid4

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel

from .. import store

router = APIRouter()


class CompensationIn(BaseModel):
    customer_id: str
    amount_inr: int
    reason: str
    txn_id: str
    idempotency_key: str


@router.post("/compensations")
def create_compensation(body: CompensationIn) -> dict:
    if (prev := store.idem.get(("compensation", body.idempotency_key))) is not None:
        return prev
    if body.customer_id not in store.customers:
        raise HTTPException(404, "customer not found")
    if body.amount_inr <= 0:
        raise HTTPException(400, "amount must be positive")
    cid = f"cmp_{uuid4().hex[:8]}"
    resp = {"compensation_id": cid, "status": "CREDITED"}
    store.compensations[cid] = {**resp, **body.model_dump()}
    store.idem[("compensation", body.idempotency_key)] = resp
    return resp
