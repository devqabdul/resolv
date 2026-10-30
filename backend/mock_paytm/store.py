"""In-memory Mock Paytm store: plain module-level dicts + functions."""

import os
import random
from datetime import UTC, datetime, timedelta

customers: dict[str, dict] = {}
merchants: dict[str, dict] = {}
transactions: dict[str, dict] = {}
refunds: dict[str, dict] = {}
compensations: dict[str, dict] = {}
settlements: dict[str, dict] = {}
kyc: dict[str, dict] = {}  # keyed by customer/merchant id
mandates: dict[str, dict] = {}
notifications: list[dict] = []
idem: dict[tuple[str, str], dict] = {}  # (kind, idempotency_key) -> stored response


def now() -> datetime:
    """Local clock helper (mock must not import app/). Honours DEMO_NOW_OVERRIDE."""
    raw = os.environ.get("DEMO_NOW_OVERRIDE", "").strip()
    if raw:
        dt = datetime.fromisoformat(raw)
        return dt if dt.tzinfo else dt.replace(tzinfo=UTC)
    return datetime.now(tz=UTC)


def iso(dt: datetime) -> str:
    return dt.isoformat()


def reset() -> None:
    for d in (customers, merchants, transactions, refunds, compensations, settlements, kyc,
              mandates, idem):  # fmt: skip
        d.clear()
    notifications.clear()


def _txn(id_: str, cust: str, mer: str, amt: int, method: str, status: str, bank: str,
         reason: str | None, created: datetime) -> None:  # fmt: skip
    transactions[id_] = {
        "id": id_, "customer_id": cust, "merchant_id": mer, "amount_inr": amt,
        "method": method, "status": status, "issuer_bank": bank, "failure_reason": reason,
        "created_at": iso(created), "refund_status": "NONE", "refund_id": None,
    }  # fmt: skip


def seed() -> None:
    reset()
    t = now()
    customers.update({
        "cust_riya": {"id": "cust_riya", "name": "Riya M.", "tier": "plus", "since": "2022-10-01",
                      "language": "en", "phone_masked": "+91 98XXXXXX21"},
        "cust_arjun": {"id": "cust_arjun", "name": "Arjun S.", "tier": "standard",
                       "since": "2024-02-14", "language": "en", "phone_masked": "+91 99XXXXXX07"},
        "cust_meera": {"id": "cust_meera", "name": "Meera K.", "tier": "standard",
                       "since": "2023-06-09", "language": "en", "phone_masked": "+91 97XXXXXX63"},
    })  # fmt: skip
    merchants.update({
        "mer_fresh_basket": {"id": "mer_fresh_basket", "name": "Fresh Basket",
                             "kyc_status": "VERIFIED", "settlement_cycle": "T+1"},
        "mer_metro_cabs": {"id": "mer_metro_cabs", "name": "Metro Cabs",
                           "kyc_status": "VERIFIED", "settlement_cycle": "T+1"},
        "mer_urban_kart": {"id": "mer_urban_kart", "name": "Urban Kart", "kyc_status": "VERIFIED",
                           "settlement_cycle": "T+1"},
        "mer_chai_point": {"id": "mer_chai_point", "name": "Chai Point", "kyc_status": "PENDING",
                           "settlement_cycle": "T+2"},
    })  # fmt: skip
    _txn("txn_48213_a", "cust_riya", "mer_urban_kart", 2499, "upi", "DEBITED_NOT_CREDITED",
         "HDFC", "BANK_SWITCH_TIMEOUT", t - timedelta(days=3))  # fmt: skip
    _txn("txn_riya_prev", "cust_riya", "mer_urban_kart", 1200, "upi", "DEBITED_NOT_CREDITED",
         "HDFC", "BANK_SWITCH_TIMEOUT", t - timedelta(days=62))  # fmt: skip
    transactions["txn_riya_prev"].update(refund_status="COMPLETED", refund_id="rfd_riya_prev")
    refunds["rfd_riya_prev"] = {
        "refund_id": "rfd_riya_prev", "txn_id": "txn_riya_prev", "amount_inr": 1200,
        "arn": "arn_riyaprev01", "reason": "prior human-resolved ticket",
        "created_ts": 0.0, "status": "COMPLETED", "eta": iso(t - timedelta(days=60)),
    }  # fmt: skip
    _txn("txn_big", "cust_arjun", "mer_urban_kart", 12000, "upi", "DEBITED_NOT_CREDITED",
         "ICICI", "BANK_SWITCH_TIMEOUT", t - timedelta(days=3))  # fmt: skip
    settlements["stl_chai_001"] = {
        "id": "stl_chai_001", "merchant_id": "mer_chai_point", "amount_inr": 48500,
        "status": "ON_HOLD_KYC", "expected_at": iso(t - timedelta(days=1)),
        "reason": "Merchant KYC pending verification",
    }  # fmt: skip
    kyc["mer_urban_kart"] = {"id": "kyc_urban_kart", "status": "VERIFIED"}
    kyc["mer_chai_point"] = {"id": "kyc_chai_point", "status": "PENDING"}
    kyc["cust_riya"] = {"id": "kyc_riya", "status": "VERIFIED"}
    kyc["cust_arjun"] = {"id": "kyc_arjun", "status": "VERIFIED"}
    kyc["cust_meera"] = {"id": "kyc_meera", "status": "REJECTED",
                         "rejection_reason": "ADDRESS_MISMATCH",
                         "resubmission_link": "https://paytm.example/kyc/resubmit/cust_meera"}  # fmt: skip
    mandates["mnd_netflix"] = {
        "id": "mnd_netflix", "customer_id": "cust_meera", "merchant_name": "Netflix",
        "amount_inr": 649, "frequency": "MONTHLY", "status": "ACTIVE",
    }  # fmt: skip


_MERCHANTS = ["mer_urban_kart", "mer_chai_point", "mer_fresh_basket", "mer_metro_cabs"]


def bank_outage(issuer_bank: str, count: int, minutes: int) -> dict:
    """Deterministic: same (issuer_bank, count) -> same ids and amounts."""
    rng = random.Random(f"{issuer_bank}:{count}")
    t = now()
    if not os.environ.get("DEMO_NOW_OVERRIDE", "").strip():
        # (decision: 10-min floor keeps spike ids/timestamps replay-stable)
        t = t.replace(minute=t.minute - t.minute % 10, second=0, microsecond=0)
    # offsets leave room for the floor lag so rows stay within the last `minutes`
    span = max(minutes * 60 - 600, 60)
    ids = []
    for i in range(1, count + 1):
        cid = f"cust_spike_{i:04d}"
        customers[cid] = {"id": cid, "name": f"Spike Customer {i}", "tier": "standard",
                          "since": "2024-01-01", "language": "en", "phone_masked": "+91 90XXXXXX00"}  # fmt: skip
        tid = f"txn_spike_{i:04d}"
        _txn(tid, cid, rng.choice(_MERCHANTS), rng.randint(2, 40) * 50, "upi",
             "DEBITED_NOT_CREDITED", issuer_bank, "UPI_SWITCH_DOWN",
             t - timedelta(seconds=rng.randint(0, span - 1)))  # fmt: skip
        ids.append(tid)
    return {"created": count, "issuer_bank": issuer_bank, "failure_reason": "UPI_SWITCH_DOWN",
            "customer_ids": [f"cust_spike_{i:04d}" for i in range(1, count + 1)],
            "txn_ids": ids}  # fmt: skip


def settle_seconds() -> int:
    return int(os.environ.get("MOCK_REFUND_SETTLE_SECONDS", "20"))


def refresh_refund(r: dict) -> dict:
    """Lazily progress INITIATED -> COMPLETED after the settle window."""
    import time

    if r["status"] == "INITIATED" and time.time() - r["created_ts"] >= settle_seconds():
        r["status"] = "COMPLETED"
        t = transactions.get(r["txn_id"])
        if t:
            t["refund_status"] = "COMPLETED"
    return r
