"""Re-exports of the Paytm entity schemas (single source: app/domain/schemas.py)."""

from pydantic import BaseModel

from app.domain.schemas import (
    CustomerProfile,
    KycCase,
    Mandate,
    MerchantProfile,
    Refund,
    Settlement,
    Transaction,
)


class Compensation(BaseModel):  # (decision: response shape of POST /compensations, docs/02 §6.2)
    compensation_id: str
    status: str


class MandateCancelled(BaseModel):  # (decision: response shape of POST /mandates/{id}/cancel)
    status: str
    effective_at: str | None = None


class SettlementRetriggered(BaseModel):  # (decision: response of POST /settlements/{id}/retrigger)
    status: str
    expected_at: str | None = None


class Delivered(BaseModel):  # (decision: response of POST /notifications)
    delivered: bool


__all__ = [
    "Compensation",
    "CustomerProfile",
    "Delivered",
    "KycCase",
    "Mandate",
    "MandateCancelled",
    "MerchantProfile",
    "Refund",
    "Settlement",
    "SettlementRetriggered",
    "Transaction",
]
