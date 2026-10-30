# d1-auto-resolve: D1 failed UPI resolved with no human touch

- id: d1-auto-resolve
- proven: no
- anchors:

## What it is

Demo moment D1. Ticket `tkt_48213` (scenario `d1_failed_upi`, customer `cust_riya`):
₹2,499 UPI to `mer_urban_kart` debited but not credited 3 days ago. Resolv understands,
decides RESOLVE, the gate passes, it initiates the ₹2,499 reversal, credits ₹200 RBI TAT
compensation (2 days late × ₹100), sends the reply and marks the ticket RESOLVED by
`resolv`. Not built yet (T5-T11).

## How to reach it

- API: `POST $API/api/demo/ticket/d1_failed_upi`, then `GET $API/api/tickets/tkt_48213`.
- Cockpit: demo drawer "Inject scenario" `d1_failed_upi`, then the Queue row (see
  demo-drawer, ticket-timeline).

## Drive it

```sh
M="$API/mock/paytm/v1"
curl -fsS -X POST "$API/api/demo/reset" && curl -fsS -X POST "$API/api/demo/seed"
curl -fsS -X POST "$API/api/demo/ticket/d1_failed_upi" -o "$ART/create.json"
jq -e '.id == "tkt_48213" and .status == "NEW"' "$ART/create.json"
for i in $(seq 1 90); do curl -fsS "$API/api/tickets/tkt_48213" -o "$ART/ticket.json"; jq -e '.ticket.status | IN("NEW","PROCESSING") | not' "$ART/ticket.json" && break; sleep 1; done
jq -e '.ticket.status == "RESOLVED" and .ticket.resolved_by == "resolv" and .ticket.path == "RESOLVE"' "$ART/ticket.json"
jq -e '[.timeline[] | select(.kind == "tool_call") | .payload] | (map(select(.name == "initiate_reversal" and .params.amount_inr == 2499)) | length) == 1 and (map(select(.name == "credit_compensation" and .params.amount_inr == 200)) | length) == 1' "$ART/ticket.json"
jq -e '[.timeline[].kind] | index("reply_sent") != null' "$ART/ticket.json"
curl -fsS "$M/transactions/txn_48213_a" -o "$ART/txn.json"
jq -e '.refund_status != "NONE" and (.refund_id | startswith("rfd_"))' "$ART/txn.json"
curl -fsS -X POST "$API/api/tickets/tkt_48213/run" -o "$ART/rerun.json"; sleep 10
curl -fsS "$M/transactions/txn_48213_a" -o "$ART/txn_after_rerun.json"
jq -e --slurpfile a "$ART/txn.json" '.refund_id == $a[0].refund_id' "$ART/txn_after_rerun.json"
```

Expect every `jq -e` to exit 0 within 90 s in mock mode (≤ 10 s in replay, ≤ 90 s live).
The `tool_call` payload shape is `{name, params}`; if T5 names the keys differently, keep
the facts (2,499 reversal, 200 compensation) and fix the jq path.

## Proof

Status `RESOLVED`, `resolved_by` `resolv`, exactly one 2,499 reversal and one 200
compensation in the audited tool calls, a `reply_sent` event; side effect on the mock ledger:
`txn_48213_a` has `refund_status` `INITIATED` (or `COMPLETED` after 20 s) and an `rfd_` id;
a re-run does not create a second refund (same `refund_id`, idempotency).

## Gotchas

- Compensation is computed from "now − 3 days"; `DEMO_NOW_OVERRIDE` shifts it. With it
  unset, ₹200 is the only correct value.
- The mock has no GET for compensations: the proof is the audited `tool_result`
  (`cmp_` id, `CREDITED`).
- `AGENT_ENGINE=runner` must give the same result; launch with it to prove the fallback.
