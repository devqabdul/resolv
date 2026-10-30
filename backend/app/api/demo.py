"""Demo routes (docs/02 §6.1). Tickets are created NEW; the queue worker runs them."""

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel, Field

from app.services import demo

router = APIRouter(prefix="/api/demo")


class SpikeIn(BaseModel):
    issuer_bank: str = "AXIS"
    count: int = Field(120, ge=1, le=500)
    minutes: int = Field(20, ge=1, le=240)


@router.post("/reset")
def reset() -> dict[str, bool]:
    demo.reset()
    return {"ok": True}


@router.post("/seed")
def seed() -> dict[str, object]:
    return {"ok": True, **demo.seed()}


@router.post("/ticket/{scenario}")
def scenario(scenario: str) -> dict[str, str]:
    if scenario not in demo.SCENARIOS:
        raise HTTPException(404, f"scenario {scenario} not found")
    return {"id": demo.scenario(scenario)}


@router.post("/spike")
def spike(body: SpikeIn) -> dict[str, object]:
    ids = demo.spike(body.issuer_bank, body.count, body.minutes)
    return {"created": len(ids), "ticket_ids": ids}
