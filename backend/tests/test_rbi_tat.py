from datetime import UTC, datetime, timedelta

import pytest

from app.domain.schemas import Transaction
from app.policy.rbi_tat import regulatory_clock

T0 = datetime(2026, 10, 28, 10, 0, tzinfo=UTC)


def _clock(method: str, days: int):
    txn = Transaction(
        id="txn_t", amount_inr=2499, method=method, status="DEBITED_NOT_CREDITED", created_at=T0
    )
    return regulatory_clock(txn, T0 + timedelta(days=days))


def test_three_days_upi_is_200() -> None:
    clock = _clock("upi", 3)
    assert clock.days_since_txn == 3
    assert clock.days_late == 2
    assert clock.compensation_due_inr == 200
    assert clock.tat_deadline == T0 + timedelta(days=1)


@pytest.mark.parametrize(
    ("method", "days", "due"),
    [("upi", 1, 0), ("card", 3, 0), ("card", 7, 200), ("wallet", 2, 100)],
)
def test_tat_table(method: str, days: int, due: int) -> None:
    assert _clock(method, days).compensation_due_inr == due
