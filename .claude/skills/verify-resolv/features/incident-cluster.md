# incident-cluster: A spike becomes one incident (D2)

- id: incident-cluster
- proven: no
- anchors:

## What it is

Demo moment D2. Injecting ~120 "money debited" tickets from one issuing bank (`AXIS`,
`UPI_SWITCH_DOWN`) makes the clusterer (every 15 s, threshold 10 within 60 min, grouping on
`tickets.signature` set at ingest) open exactly one incident
`failed_payment_reversal|AXIS|UPI_SWITCH_DOWN` with a climbing ticket count, a drafted
proactive notice and an Ops nudge. Not built yet (T15, T16).

## How to reach it

- API: `POST $API/api/demo/spike {issuer_bank, count, minutes}`, `GET $API/api/incidents`,
  `GET $API/api/incidents/{id}`.
- Cockpit: demo drawer spike, then `/incidents` (see incidents-page).

## Drive it

```sh
curl -fsS -X POST "$API/api/demo/reset" && curl -fsS -X POST "$API/api/demo/seed"
curl -fsS -X POST "$API/api/demo/spike" -H 'content-type: application/json' \
  -d '{"issuer_bank":"AXIS","count":120,"minutes":20}' -o "$ART/spike.json"
SIG='failed_payment_reversal|AXIS|UPI_SWITCH_DOWN'
for i in $(seq 1 60); do curl -fsS "$API/api/incidents" -o "$ART/incidents.json"; jq -e --arg s "$SIG" 'map(select(.signature == $s)) | length == 1' "$ART/incidents.json" && break; sleep 1; done
jq -e --arg s "$SIG" 'map(select(.signature == $s)) | length == 1 and .[0].status == "OPEN" and .[0].ticket_count >= 10 and (.[0].proactive_notice_draft | length) > 0' "$ART/incidents.json"
INC=$(jq -r --arg s "$SIG" 'map(select(.signature == $s))[0].id' "$ART/incidents.json")
sleep 30; curl -fsS "$API/api/incidents/$INC" -o "$ART/incident.json"
jq -e '.incident.ticket_count >= 100 and (.tickets | length) == .incident.ticket_count' "$ART/incident.json"
curl -fsS "$API/api/tickets?incident_id=$INC&limit=200" -o "$ART/linked.json"
```

Expect the incident within 60 s (spec: within ~30 s), `INC` starting with `inc_`, every
`jq -e` exiting 0, and still exactly one incident for the signature after 30 more seconds.

## Proof

One OPEN incident with the canonical signature, a non-empty proactive notice draft, and a
ticket count that climbs toward 120; side effects: linked tickets carry `incident_id`
(`/api/tickets?incident_id=`) and a `#ops` notification exists (see notifications).

## Gotchas

- The signature comes from the ledger at ingest, never from `understanding.ticket_type`;
  clustering must fire before any spike ticket finishes `understand`.
- Count 120 with `QUEUE_CONCURRENCY=3` takes time; most tickets attach by fast path once
  the incident exists (see incident-fast-path).
- Threshold/window come from `INCIDENT_THRESHOLD` / `INCIDENT_WINDOW_MINUTES` (10 / 60).
