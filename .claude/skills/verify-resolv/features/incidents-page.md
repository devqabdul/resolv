# incidents-page: Incidents page and proactive notice

- id: incidents-page
- proven: no
- anchors:

## What it is

`/incidents` shows incident cards (title, signature, live ticket count, first/last seen,
proactive notice draft, Slack status). "Send proactive notice" sends the notice to every
linked customer through the mock notifications API and marks the incident `COMMUNICATED`.
Not built yet (T20).

## How to reach it

- Cockpit: `$WEB/incidents`, nav link "Incidents".
- API: `GET /api/incidents`, `GET /api/incidents/{id}`, `POST /api/incidents/{id}/notify`.

## Drive it

```sh
# precondition: incident-cluster drive ran; INC is the AXIS incident id
# browser: open "$WEB/incidents"; card [data-testid=incident-card][data-incident-id=$INC]
#   expect [data-testid=incident-signature] = failed_payment_reversal|AXIS|UPI_SWITCH_DOWN,
#   [data-testid=incident-ticket-count] >= 10, [data-testid=incident-notice-draft] not empty;
#   click [data-testid=incident-notify]; save "$ART/incidents.txt" and "$ART/incidents.png"
for i in $(seq 1 30); do curl -fsS "$API/api/incidents/$INC" -o "$ART/incident.json"; jq -e '.incident.status == "COMMUNICATED"' "$ART/incident.json" && break; sleep 1; done
jq -e '.incident.notified_at != null and (.notifications | length) >= 1' "$ART/incident.json"
```

Expect each `jq -e` to exit 0 and the card's `data-status` to read `COMMUNICATED` within 4 s.
API-only equivalent: `curl -fsS -X POST "$API/api/incidents/$INC/notify"`.

## Proof

The page shows the API's incident; the click moves it to `COMMUNICATED` with `notified_at`
set; side effect: notification rows for the linked customers (incident `notifications`).

## Gotchas

- Handles: `incident-card` (with `data-incident-id`, `data-status`), `incident-title`,
  `incident-signature`, `incident-ticket-count`, `incident-notice-draft`,
  `incident-slack-status`, `incident-notify`, `incident-tickets-link`.
- Notify twice must not double-send; the button can disable after `COMMUNICATED`.
- CORS on non-3000 web ports, see ticket-queue.
