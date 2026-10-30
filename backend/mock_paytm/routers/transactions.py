from fastapi import APIRouter, HTTPException

from .. import store

router = APIRouter()


def _fresh(t: dict) -> dict:
    if t["refund_id"] in store.refunds:
        store.refresh_refund(store.refunds[t["refund_id"]])
    return t


@router.get("/transactions")
def list_transactions(
    customer_id: str | None = None, merchant_id: str | None = None, since: str | None = None
) -> list[dict]:
    rows = [
        _fresh(t)
        for t in store.transactions.values()
        if (not customer_id or t["customer_id"] == customer_id)
        and (not merchant_id or t["merchant_id"] == merchant_id)
        and (not since or t["created_at"] >= since)
    ]
    return sorted(rows, key=lambda t: t["created_at"], reverse=True)


@router.get("/transactions/{id}")
def get_transaction(id: str) -> dict:
    if id not in store.transactions:
        raise HTTPException(404, "transaction not found")
    return _fresh(store.transactions[id])
