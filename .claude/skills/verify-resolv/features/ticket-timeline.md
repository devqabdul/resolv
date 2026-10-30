# ticket-timeline: Ticket detail and audited timeline

- id: ticket-timeline
- proven: no
- anchors: backend/app/api/tickets.py, backend/app/api/audit.py, backend/app/services/audit.py, frontend/app

## What it is

One ticket's page: masked ticket text, customer/merchant card, regulatory clock, and a
timeline of every audit event (understanding card, decision card with reasoning and
proposed actions, gate badges with reasons, tool calls with request/response, reply sent,
handoff). Backed by `GET /api/tickets/{id}` and `GET /api/audit`. Not built yet (T9, T14).

## How to reach it

- Cockpit: `$WEB/tickets/{id}`, or a row click on the Queue.
- API: `GET $API/api/tickets/{id}` -> `{ticket, run: {state}, timeline: AuditEvent[],
  approvals: Approval[], incident?}`; `GET $API/api/audit?ticket_id={id}&limit=200`.

## Drive it

```sh
curl -fsS -X POST "$API/api/demo/reset" && curl -fsS -X POST "$API/api/demo/seed"
curl -fsS -X POST "$API/api/demo/ticket/d1_failed_upi" -o "$ART/d1.json"
for i in $(seq 1 90); do curl -fsS "$API/api/tickets/tkt_48213" -o "$ART/ticket.json"; jq -e '.ticket.status == "RESOLVED"' "$ART/ticket.json" && break; sleep 1; done
jq -e '[.timeline[].kind] as $k | ["ingest","pii_masked","understanding","decision","gate","tool_call","tool_result","verify","reply_sent","status_change"] | all(. as $x | $k | index($x) != null)' "$ART/ticket.json"
jq -e '[.timeline[].actor] | all(. == "resolv" or . == "system" or startswith("human:"))' "$ART/ticket.json"
curl -fsS "$API/api/audit?ticket_id=tkt_48213&limit=200" -o "$ART/audit.json"
jq -e 'length > 0 and all(.ticket_id == "tkt_48213")' "$ART/audit.json"
```

Expect every `jq -e` to exit 0. Cockpit: open `$WEB/tickets/tkt_48213`; expect
`[data-testid=ticket-masked-text]` with masked text (no raw phone/VPA),
`[data-testid=ticket-status]` reading `RESOLVED`, `[data-testid=regulatory-clock]`, and in
`[data-testid=timeline]` at least one `[data-testid=timeline-event]` for each kind above,
each carrying `data-kind`; `[data-testid=gate-badge]` has `data-outcome="AUTO_EXECUTE"`.
Save `$ART/timeline.txt` and `$ART/timeline.png`.

## Proof

Every node's audit kind (docs/02 §3.2) is present for a full RESOLVE run, every event has a
known actor, and the page renders the same events as the API. Side effect: `audit_events`
rows for the ticket (the `/api/audit` read).

## Gotchas

- Handles: `ticket-masked-text`, `ticket-status` (with `data-status`), `customer-card`,
  `regulatory-clock`, `timeline`, `timeline-event` (with `data-kind`), `gate-badge` (with
  `data-outcome`), `tool-call` (expandable request/response).
- Masking is the default view; a raw-text toggle, if added, must not be on by default.
- CORS on non-3000 web ports, see ticket-queue.
