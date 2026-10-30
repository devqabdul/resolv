# incident-fast-path: Later tickets attach to the open incident with no LLM call

- id: incident-fast-path
- proven: no
- anchors:

## What it is

Once an OPEN incident exists for `failed_payment_reversal|AXIS|UPI_SWITCH_DOWN`, a new
ticket whose most recent `DEBITED_NOT_CREDITED` transaction matches it is attached at ingest
(`via=fast_path`), gets the incident's holding reply and ends `INCIDENT_LINKED`, with no
`understanding` or `decision` event (no LLM call). Not built yet (T16).

## How to reach it

- API: `POST $API/api/tickets {channel, text, customer_id}` for a spike customer after
  incident-cluster ran.

## Drive it

```sh
# precondition: incident-cluster drive ran on this instance and INC is OPEN
curl -fsS -X POST "$API/api/tickets" -H 'content-type: application/json' \
  -d '{"channel":"in_app_chat","text":"Paise kat gaye par payment fail ho gaya, AXIS UPI","customer_id":"cust_spike_0001"}' -o "$ART/new.json"
TID=$(jq -r .id "$ART/new.json")
for i in $(seq 1 30); do curl -fsS "$API/api/tickets/$TID" -o "$ART/ticket.json"; jq -e '.ticket.status | IN("NEW","PROCESSING") | not' "$ART/ticket.json" && break; sleep 1; done
jq -e '.ticket.status == "INCIDENT_LINKED" and (.ticket.incident_id | startswith("inc_"))' "$ART/ticket.json"
jq -e '[.timeline[].kind] | index("incident_fast_path") != null and index("understanding") == null and index("decision") == null and index("reply_sent") != null' "$ART/ticket.json"
grep -c 'cache_\(hit\|miss\)' "$RUN/api.log"
```

Expect both `jq -e` to exit 0 within 30 s, and the `cache_` line count in `$RUN/api.log`
not to grow across this drive (run the grep before and after).

## Proof

Status `INCIDENT_LINKED`, the incident id set, an `incident_fast_path` event, a holding
reply, and no `understanding`/`decision` events; side effect: the ticket appears under
`GET /api/incidents/{INC}` `tickets` and the incident's `ticket_count` grew by 1.

## Gotchas

- `cust_spike_0001` already has a spike ticket; the new ticket is a second one for the same
  ledger pattern, which is the realistic case.
- Channel values: `in_app_chat`, `email`, `merchant_portal`.
- The automated check is `tests/test_incident_fast_path.py`; this recipe proves the running
  app, not the test.
