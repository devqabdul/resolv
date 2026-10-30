from datetime import datetime, timedelta
from functools import cache
from pathlib import Path
from typing import Any

import yaml

from app.domain.schemas import RegulatoryClock, Transaction

RULES_PATH = Path(__file__).parent / "rules.yaml"


@cache
def load_rules() -> dict[str, Any]:
    """Parsed `rules.yaml` (docs/02 §7.1), loaded once."""
    with RULES_PATH.open() as f:
        return yaml.safe_load(f)


def regulatory_clock(txn: Transaction, now: datetime) -> RegulatoryClock:
    """RBI harmonised TAT clock for a failed txn (docs/02 §7.3)."""
    rule = load_rules()["rbi_tat"][txn.method]
    days_since = (now - txn.created_at).days
    days_late = max(0, days_since - rule["auto_reversal_days"])
    return RegulatoryClock(
        days_since_txn=days_since,
        tat_deadline=txn.created_at + timedelta(days=rule["auto_reversal_days"]),
        days_late=days_late,
        compensation_due_inr=days_late * rule["compensation_per_day_inr"],
    )
