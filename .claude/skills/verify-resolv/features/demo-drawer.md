# demo-drawer: Demo drawer (?demo=1)

- id: demo-drawer
- proven: no
- anchors: backend/app/api/demo.py, frontend/app/page.tsx

## What it is

On the Queue page with `?demo=1` a drawer gives the presenter Reset, Seed, Inject scenario
(dropdown of the 7 scenarios) and Inject spike (bank, count). Without `?demo=1` it is
hidden. Not built yet (T20).

## How to reach it

- Cockpit: `$WEB/?demo=1`.
- API behind it: `POST /api/demo/reset`, `/seed`, `/ticket/{scenario}`, `/spike`.

## Drive it

```sh
# browser: open "$WEB/" -> expect no [data-testid=demo-drawer]
# browser: open "$WEB/?demo=1" -> expect [data-testid=demo-drawer]; click [data-testid=demo-reset],
#   then [data-testid=demo-seed]; select d1_failed_upi in [data-testid=demo-scenario-select],
#   click [data-testid=demo-inject-scenario]; save "$ART/drawer.txt"
for i in $(seq 1 30); do curl -fsS "$API/api/tickets?limit=50" -o "$ART/tickets.json"; jq -e '[.items[].id] | index("tkt_48213") != null' "$ART/tickets.json" && break; sleep 1; done
curl -fsS "$API/mock/paytm/v1/transactions?customer_id=cust_riya" | jq -e 'map(.id) | index("txn_48213_a") != null'
# browser: type AXIS into [data-testid=demo-spike-bank], 120 into [data-testid=demo-spike-count],
#   click [data-testid=demo-inject-spike]
for i in $(seq 1 60); do curl -fsS "$API/api/incidents" -o "$ART/incidents.json"; jq -e 'length == 1' "$ART/incidents.json" && break; sleep 1; done
```

Expect the drawer only with `?demo=1`, every `jq -e` to exit 0, and the Queue row for
`tkt_48213` to appear without a page reload. The scenario dropdown lists exactly
`d1_failed_upi`, `d3_over_limit`, `hinglish_refund_status`, `merchant_settlement`,
`kyc_rejected`, `mandate_email`, `dispute`.

## Proof

Each drawer control has its API side effect: seeded ledger (`txn_48213_a` exists), the
scenario ticket row, and one incident after the spike.

## Gotchas

- Handles: `demo-drawer`, `demo-reset`, `demo-seed`, `demo-scenario-select`,
  `demo-inject-scenario`, `demo-spike-bank`, `demo-spike-count`, `demo-inject-spike`.
- Reset wipes this instance's DB and mock only; other instances are untouched.
- CORS on non-3000 web ports, see ticket-queue.
