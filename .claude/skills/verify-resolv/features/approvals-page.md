# approvals-page: Approvals queue page

- id: approvals-page
- proven: no
- anchors:

## What it is

`/approvals` lists pending approvals with the ticket summary, the proposed action, the gate
reasons ("amount 12,000 > auto limit 5,000") and Resolv's reasoning, with Approve / Reject
plus a note and the decider's name. Not built yet (T19).

## How to reach it

- Cockpit: `$WEB/approvals`, nav link with accessible name "Approvals".
- API behind it: `GET /api/approvals?status=PENDING`, `POST /api/approvals/{id}/decide`.

## Drive it

```sh
curl -fsS -X POST "$API/api/demo/reset" && curl -fsS -X POST "$API/api/demo/seed"
curl -fsS -X POST "$API/api/demo/ticket/d3_over_limit"
for i in $(seq 1 90); do curl -fsS "$API/api/approvals?status=PENDING" -o "$ART/pending.json"; jq -e 'map(select(.ticket_id == "tkt_48219")) | length == 1' "$ART/pending.json" && break; sleep 1; done
# browser: open "$WEB/approvals"; in [data-testid=approval-card][data-ticket-id=tkt_48219]
#   fill [data-testid=approval-note] and [data-testid=approval-decided-by] (= $VERIFIER),
#   click [data-testid=approval-approve]; save snapshot "$ART/approvals.txt"
for i in $(seq 1 60); do curl -fsS "$API/api/tickets/tkt_48219" -o "$ART/ticket.json"; jq -e '.ticket.status == "RESOLVED"' "$ART/ticket.json" && break; sleep 1; done
jq -e --arg v "$VERIFIER" '.approvals[0].status == "APPROVED" and .approvals[0].decided_by == $v' "$ART/ticket.json"
curl -fsS "$API/mock/paytm/v1/transactions/txn_big" | jq -e '.refund_status != "NONE"'
```

Expect before the click: the card shows `[data-testid=approval-reasons]` containing
`5,000` and `[data-testid=approval-action]` naming `initiate_reversal` 12,000. After the
click: the card leaves the list within 4 s and every `jq -e` exits 0.

## Proof

The decision made in the page reaches the API (`APPROVED`, `decided_by` = the name typed),
the ticket is `RESOLVED`, and the ledger side effect exists (`txn_big` refunded).

## Gotchas

- Handles: `approval-card` (with `data-approval-id`, `data-ticket-id`), `approval-action`,
  `approval-reasons`, `approval-reasoning`, `approval-note`, `approval-decided-by`,
  `approval-approve`, `approval-reject`.
- CORS on non-3000 web ports, see ticket-queue.
