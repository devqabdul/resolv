# mock-paytm-seed: Mock Paytm reset, seed and bank outage

- id: mock-paytm-seed
- proven: 643ced81e1e6c62e6cb3058decdc8121b7cd2fdd
- anchors: backend/mock_paytm/routers/admin.py, backend/mock_paytm/store.py:def seed, backend/mock_paytm/store.py:def bank_outage, backend/mock_paytm/routers/transactions.py, backend/mock_paytm/routers/refunds.py

## What it is

The mock Paytm ledger that Resolv reads over HTTP. Demo plumbing wipes it, loads the
canonical demo data (docs/01 §10: `cust_riya` with `txn_48213_a` ₹2,499 UPI
`DEBITED_NOT_CREDITED` via `HDFC` / `BANK_SWITCH_TIMEOUT`, `cust_arjun` with `txn_big`
₹12,000, ...) and injects a bank outage spike (`AXIS` / `UPI_SWITCH_DOWN`). The refund route
is idempotent and refuses a second refund.

## How to reach it

- `POST $API/mock/paytm/v1/admin/reset`, `POST .../admin/seed`,
  `POST .../admin/scenarios/bank_outage {issuer_bank, count, minutes}` (docs/02 §6.2).
- Read side: `GET .../transactions?customer_id=`, `GET .../transactions/{id}`,
  `POST .../refunds`, `GET .../refunds/{id}`.
- Later: `POST /api/demo/reset` and `/api/demo/seed` (T9) call these, and the cockpit demo
  drawer calls those (see demo-drawer).

## Drive it

```sh
M="$API/mock/paytm/v1"
curl -fsS -X POST "$M/admin/reset" -o "$ART/reset.json"
curl -fsS -X POST "$M/admin/seed" -o "$ART/seed.json"
curl -fsS "$M/transactions?customer_id=cust_riya" -o "$ART/riya_txns.json"
jq -e '.ok == true and .customers >= 3' "$ART/seed.json"
jq -e 'map(select(.id == "txn_48213_a"))[0] | .amount_inr == 2499 and .method == "upi" and .status == "DEBITED_NOT_CREDITED" and .issuer_bank == "HDFC" and .failure_reason == "BANK_SWITCH_TIMEOUT" and .refund_status == "NONE"' "$ART/riya_txns.json"
curl -fsS -X POST "$M/refunds" -H 'content-type: application/json' \
  -d '{"txn_id":"txn_48213_a","amount_inr":2499,"reason":"verify","idempotency_key":"verify-k1"}' -o "$ART/refund1.json"
curl -fsS -X POST "$M/refunds" -H 'content-type: application/json' \
  -d '{"txn_id":"txn_48213_a","amount_inr":2499,"reason":"verify","idempotency_key":"verify-k1"}' -o "$ART/refund1_retry.json"
curl -s -o "$ART/refund2.json" -w '%{http_code}\n' -X POST "$M/refunds" -H 'content-type: application/json' \
  -d '{"txn_id":"txn_48213_a","amount_inr":2499,"reason":"verify","idempotency_key":"verify-k2"}' | tee "$ART/refund2_code.txt"
curl -fsS "$M/transactions/txn_48213_a" -o "$ART/txn_after.json"
curl -fsS -X POST "$M/admin/scenarios/bank_outage" -H 'content-type: application/json' \
  -d '{"issuer_bank":"AXIS","count":120,"minutes":20}' -o "$ART/outage.json"
jq -e '.created == 120 and .failure_reason == "UPI_SWITCH_DOWN" and (.txn_ids | length) == 120' "$ART/outage.json"
curl -fsS "$M/transactions?customer_id=cust_spike_0001" -o "$ART/spike_txn.json"
```

Expected: seed returns `{"ok":true,"customers":3,"transactions":N}`; every `jq -e` exits 0;
`refund1.json` has `status` `INITIATED`, an `rfd_` id and an `arn_`; `refund1_retry.json` is
byte-identical (idempotent replay); the second key prints `409`; `txn_after.json` has
`refund_status` `INITIATED` and `refund_id` equal to refund1's id; `spike_txn.json` holds one
`AXIS` / `UPI_SWITCH_DOWN` / `DEBITED_NOT_CREDITED` transaction.

## Proof

Seed loads the canonical D1 transaction with the exact facts above; the refund side effect
lands on the transaction row (`refund_status` NONE -> INITIATED, `refund_id` set); the same
idempotency key returns the same refund and a new key on a refunded txn is refused with 409;
the outage creates 120 `txn_spike_*` rows.

## Gotchas

- The store is in-memory per backend process: a restart empties it, and two instances never
  see each other's ledger. Re-seed after every Launch.
- Seed calls reset first, so seeding twice is safe; it also discards refunds made earlier.
- With `DEMO_NOW_OVERRIDE` unset, the outage floors "now" to 10 minutes so spike ids and
  timestamps are replay-stable.
- `MOCK_LATENCY_MS=0` in Launch; the default 120 ms per call makes the 120-row spike slow.
- Refunds move `INITIATED -> COMPLETED` lazily after `MOCK_REFUND_SETTLE_SECONDS` (20 s): a
  slow drive can read `COMPLETED`.
