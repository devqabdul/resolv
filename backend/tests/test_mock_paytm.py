import os

os.environ["MOCK_LATENCY_MS"] = "0"

from fastapi.testclient import TestClient

from app.main import app

B = "/mock/paytm/v1"
c = TestClient(app)


def _seed() -> None:
    c.post(f"{B}/admin/reset")
    c.post(f"{B}/admin/seed")


def test_seed_and_refund_idempotency() -> None:
    _seed()
    t = c.get(f"{B}/transactions", params={"customer_id": "cust_riya"}).json()[0]
    assert (t["id"], t["amount_inr"], t["status"], t["issuer_bank"]) == (
        "txn_48213_a",
        2499,
        "DEBITED_NOT_CREDITED",
        "HDFC",
    )
    assert t["failure_reason"] == "BANK_SWITCH_TIMEOUT" and t["refund_status"] == "NONE"
    body = {"txn_id": "txn_48213_a", "amount_inr": 2499, "reason": "t", "idempotency_key": "k1"}
    r1 = c.post(f"{B}/refunds", json=body)
    assert r1.json()["status"] == "INITIATED"
    assert c.post(f"{B}/refunds", json=body).json() == r1.json()
    assert c.post(f"{B}/refunds", json={**body, "idempotency_key": "k2"}).status_code == 409


def test_bank_outage_deterministic() -> None:
    _seed()
    args = {"issuer_bank": "AXIS", "count": 20, "minutes": 20}
    a = c.post(f"{B}/admin/scenarios/bank_outage", json=args).json()
    amounts = [t["amount_inr"] for t in c.get(f"{B}/transactions").json() if "spike" in t["id"]]
    b = c.post(f"{B}/admin/scenarios/bank_outage", json=args).json()
    assert a["created"] == 20 and a["txn_ids"] == b["txn_ids"]
    amounts2 = [t["amount_inr"] for t in c.get(f"{B}/transactions").json() if "spike" in t["id"]]
    assert amounts == amounts2


def test_bank_outage_timestamps_identical(monkeypatch) -> None:
    monkeypatch.setenv("DEMO_NOW_OVERRIDE", "2026-10-30T12:00:00+00:00")
    args = {"issuer_bank": "AXIS", "count": 20, "minutes": 20}
    runs = []
    for _ in range(2):
        _seed()
        c.post(f"{B}/admin/scenarios/bank_outage", json=args)
        rows = [t for t in c.get(f"{B}/transactions").json() if "spike" in t["id"]]
        runs.append(sorted((t["id"], t["created_at"]) for t in rows))
    assert runs[0] == runs[1] and len(runs[0]) == 20
    assert c.get(f"{B}/merchants/mer_metro_cabs").status_code == 200


def test_compensation_idempotency() -> None:
    _seed()
    body = {"customer_id": "cust_riya", "amount_inr": 200, "reason": "t",
            "txn_id": "txn_48213_a", "idempotency_key": "c1"}  # fmt: skip
    r1 = c.post(f"{B}/compensations", json=body)
    assert r1.json()["status"] == "CREDITED"
    assert c.post(f"{B}/compensations", json=body).json() == r1.json()
    # 02 §6.2 names no conflict code for compensations: a new key is a new credit (200)
    r3 = c.post(f"{B}/compensations", json={**body, "idempotency_key": "c2"})
    assert r3.status_code == 200 and r3.json()["compensation_id"] != r1.json()["compensation_id"]
