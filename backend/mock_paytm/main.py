import os
import time

from fastapi import Depends, FastAPI

from .routers import (
    admin,
    compensations,
    customers,
    kyc,
    mandates,
    merchants,
    notifications,
    refunds,
    settlements,
    transactions,
)


def latency() -> None:
    ms = int(os.environ.get("MOCK_LATENCY_MS", "120"))
    if ms > 0:
        time.sleep(ms / 1000)


mock_app = FastAPI(title="Mock Paytm", dependencies=[Depends(latency)])
for r in (customers, merchants, transactions, refunds, compensations, settlements, kyc,
          mandates, notifications, admin):  # fmt: skip
    mock_app.include_router(r.router)
