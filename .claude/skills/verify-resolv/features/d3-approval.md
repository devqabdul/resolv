# d3-approval: D3 over-limit reversal goes to a human

- id: d3-approval
- proven: no
- anchors:

## What it is

Demo moment D3. Ticket `tkt_48219` (scenario `d3_over_limit`, `cust_arjun`, `txn_big`
₹12,000 UPI). The gate returns NEEDS_APPROVAL (auto limit ₹5,000), the ticket waits in
`AWAITING_APPROVAL` with a holding reply, no money moves. A named human approves; the
reversal executes via act/verify and the ticket is RESOLVED, with `approval_decided`
audited and `decided_by` set. Not built yet (T8, T9, T12).

## How to reach it

- API: `POST /api/demo/ticket/d3_over_limit`, `GET /api/approvals?status=PENDING`,
  `POST /api/approvals/{id}/decide {approve, note?, decided_by}`.
- Cockpit: `/approvals` (see approvals-page) or Approve on `/tickets/tkt_48219`
  (`[data-testid=approve-button]`).

## Drive it

```sh
M="$API/mock/paytm/v1"
curl -fsS -X POST "$API/api/demo/reset" && curl -fsS -X POST "$API/api/demo/seed"
curl -fsS -X POST "$API/api/demo/ticket/d3_over_limit" -o "$ART/create.json"
for i in $(seq 1 90); do curl -fsS "$API/api/tickets/tkt_48219" -o "$ART/pending.json"; jq -e '.ticket.status == "AWAITING_APPROVAL"' "$ART/pending.json" && break; sleep 1; done
jq -e '[.timeline[].kind] | index("approval_created") != null and index("reply_sent") != null' "$ART/pending.json"
curl -fsS "$M/transactions/txn_big" -o "$ART/txn_before.json"; jq -e '.refund_status == "NONE"' "$ART/txn_before.json"
curl -fsS "$API/api/approvals?status=PENDING" -o "$ART/approvals.json"
APR=$(jq -r 'map(select(.ticket_id == "tkt_48219"))[0].id' "$ART/approvals.json"); echo "$APR"
curl -fsS -X POST "$API/api/approvals/$APR/decide" -H 'content-type: application/json' \
  -d "{\"approve\":true,\"note\":\"verified over-limit reversal\",\"decided_by\":\"$VERIFIER\"}" -o "$ART/decide.json"
for i in $(seq 1 60); do curl -fsS "$API/api/tickets/tkt_48219" -o "$ART/resolved.json"; jq -e '.ticket.status == "RESOLVED"' "$ART/resolved.json" && break; sleep 1; done
jq -e --arg v "$VERIFIER" '[.timeline[] | select(.kind == "approval_decided")] | length == 1 and (.[0].actor == ("human:" + $v) or .[0].payload.decided_by == $v)' "$ART/resolved.json"
curl -fsS "$M/transactions/txn_big" -o "$ART/txn_after.json"; jq -e '.refund_status != "NONE"' "$ART/txn_after.json"
```

Expect `APR` to start with `apr_` and every `jq -e` to exit 0.

## Proof

Before the decision: `AWAITING_APPROVAL`, one PENDING approval for 12,000, a holding reply,
and the ledger untouched (`refund_status` `NONE`). After approve: `RESOLVED`, one
`approval_decided` naming the human, and the side effect on the ledger (`txn_big`
`refund_status` INITIATED/COMPLETED).

## Gotchas

- Reject path: `{"approve":false,...}` must leave `txn_big` at `NONE`; drive it on a fresh
  seed if a task touches rejection.
- Deciding the same approval twice must not refund twice (idempotency key).
