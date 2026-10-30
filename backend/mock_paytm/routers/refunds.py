import time
from datetime import timedelta
from uuid import uuid4

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel

from .. import store

router = APIRouter()


class RefundIn(BaseModel):
    txn_id: str
    amount_inr: int
    reason: str
    idempotency_key: str


@router.post("/refunds")
def create_refund(body: RefundIn) -> dict:
    if (prev := store.idem.get(("refund", body.idempotency_key))) is not None:
        return prev
    t = store.transactions.get(body.txn_id)
    if t is None:
        raise HTTPException(404, "transaction not found")
    if body.amount_inr > t["amount_inr"]:
        raise HTTPException(400, "amount exceeds transaction amount")
    if t["status"] not in ("SUCCESS", "DEBITED_NOT_CREDITED"):
        raise HTTPException(422, "transaction not eligible for refund")
    if t["refund_status"] != "NONE":
        raise HTTPException(409, "transaction already refunded")
    rid = f"rfd_{uuid4().hex[:8]}"
    eta = store.now() + timedelta(seconds=store.settle_seconds())
    resp = {"refund_id": rid, "arn": f"arn_{uuid4().hex[:12]}", "status": "INITIATED",
            "eta": store.iso(eta)}  # fmt: skip
    store.refunds[rid] = {**resp, "txn_id": body.txn_id, "amount_inr": body.amount_inr,
                          "reason": body.reason, "created_ts": time.time()}  # fmt: skip
    t.update(refund_status="INITIATED", refund_id=rid)
    store.idem[("refund", body.idempotency_key)] = resp
    return resp


@router.get("/refunds/{id}")
def get_refund(id: str) -> dict:
    if id not in store.refunds:
        raise HTTPException(404, "refund not found")
    r = store.refresh_refund(store.refunds[id])
    return {k: v for k, v in r.items() if k != "created_ts"}
