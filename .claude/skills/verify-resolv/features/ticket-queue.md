# ticket-queue: Cockpit ticket queue

- id: ticket-queue
- proven: no
- anchors:

## What it is

The cockpit home page lists every ticket (id, type badge, priority, status, path, SLA
countdown, incident badge, resolved_by), ordered by priority then created_at, refreshed
every 2 s. A row click opens the ticket. Backed by `GET /api/tickets`. Not built yet
(T9 API, T13 page).

## How to reach it

- Cockpit: `$WEB/` (the Queue). Row click -> `$WEB/tickets/{id}`.
- API: `GET $API/api/tickets?status=&type=&incident_id=&limit=50&since=` ->
  `{items: Ticket[], total}`.

## Drive it

```sh
curl -fsS -X POST "$API/api/demo/reset" && curl -fsS -X POST "$API/api/demo/seed"
curl -fsS -X POST "$API/api/demo/ticket/d1_failed_upi" -o "$ART/d1.json"
curl -fsS -X POST "$API/api/demo/ticket/d3_over_limit" -o "$ART/d3.json"
sleep 10
curl -fsS "$API/api/tickets?limit=50" -o "$ART/tickets.json"
jq -e '.total >= 2 and ([.items[].id] | index("tkt_48213") != null and index("tkt_48219") != null)' "$ART/tickets.json"
curl -fsS "$API/api/tickets?status=AWAITING_APPROVAL" -o "$ART/awaiting.json"
jq -e '[.items[].status] | all(. == "AWAITING_APPROVAL")' "$ART/awaiting.json"
```

Expect both `jq -e` to exit 0. Cockpit (browser tool): open `$WEB/`, wait for
`[data-testid=ticket-table]`; expect a row `[data-testid=ticket-row][data-ticket-id=tkt_48213]`
whose `[data-testid=ticket-status]` reads `RESOLVED` and a row for `tkt_48219` reading
`AWAITING_APPROVAL`. Click the `tkt_48213` row; expect the URL path `/tickets/tkt_48213`.
Save the snapshot as `$ART/queue.txt` and a screenshot as `$ART/queue.png`.

## Proof

The API list and the rendered table name the same ids and statuses; the status filter only
returns matching tickets; the row click lands on the ticket route. Side effect: none is
expected from reading; the injected tickets exist as rows in the instance DB (`total`).

## Gotchas

- Handles the frontend must implement: `ticket-table`, `ticket-row` with `data-ticket-id`
  and `data-status`, cells `ticket-status`, `ticket-type`, `ticket-priority`, `ticket-path`,
  `sla-countdown`, `incident-badge`, `resolved-by`.
- SWR polls every 2 s: wait for the status text, do not read the first paint.
- CORS: `backend/app/main.py` only allows origin `http://localhost:3000`, so on a verify
  instance's `WEB_PORT` the browser blocks every API call until origins are configurable.
- Ordering is priority first (P1 before P3), then created_at; do not assert insertion order.
