from fastapi import APIRouter
from pydantic import BaseModel

from .. import scenarios, store

router = APIRouter(prefix="/admin")


class BankOutageIn(BaseModel):
    issuer_bank: str
    count: int
    minutes: int


@router.post("/reset")
def reset() -> dict:
    store.reset()
    return {"ok": True}


@router.post("/seed")
def seed() -> dict:
    store.seed()
    return {"ok": True, "customers": len(store.customers), "transactions": len(store.transactions)}


@router.post("/scenarios/bank_outage")
def bank_outage(body: BankOutageIn) -> dict:
    return scenarios.bank_outage(body.issuer_bank, body.count, body.minutes)
