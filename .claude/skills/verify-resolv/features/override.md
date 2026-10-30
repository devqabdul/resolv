# override: Human override that trains the agent (D4)

- id: override
- proven: no
- anchors: backend/app/api/tickets.py, backend/app/services/approvals.py, backend/evals

## What it is

Demo moment D4. On any ticket a human picks a different path (for example ROUTE instead of
RESOLVE), adds a note and their name. Resolv records an `override` audit event with
`actor` `human:<name>`, executes the human's choice and appends
`{ticket, resolv_decision, human_decision}` to `backend/evals/overrides.jsonl` as a
labelled eval example. Not built yet (T12, T14).

## How to reach it

- API: `POST $API/api/tickets/{id}/override {path, note, decided_by, actions?}`.
- Cockpit: `/tickets/{id}`, `[data-testid=override-form]`.

## Drive it

```sh
OV="$ROOT/backend/evals/overrides.jsonl"; BEFORE=$(cat "$OV" 2>/dev/null | wc -l)
curl -fsS -X POST "$API/api/demo/reset" && curl -fsS -X POST "$API/api/demo/seed"
curl -fsS -X POST "$API/api/demo/ticket/hinglish_refund_status" -o "$ART/create.json"
TID=$(jq -r .id "$ART/create.json")
for i in $(seq 1 90); do curl -fsS "$API/api/tickets/$TID" -o "$ART/before.json"; jq -e '.ticket.status | IN("NEW","PROCESSING") | not' "$ART/before.json" && break; sleep 1; done
curl -fsS -X POST "$API/api/tickets/$TID/override" -H 'content-type: application/json' \
  -d "{\"path\":\"ROUTE\",\"note\":\"needs payments_ops look\",\"decided_by\":\"$VERIFIER\"}" -o "$ART/override.json"
curl -fsS "$API/api/tickets/$TID" -o "$ART/after.json"
jq -e --arg v "$VERIFIER" '[.timeline[] | select(.kind == "override")] | length == 1 and .[0].actor == ("human:" + $v)' "$ART/after.json"
jq -e '.ticket.path == "ROUTE"' "$ART/after.json"
AFTER=$(wc -l < "$OV"); echo "overrides.jsonl $BEFORE -> $AFTER"; tail -1 "$OV" | tee "$ART/override_line.json" | jq -e --arg t "$TID" '.ticket.id == $t or .ticket_id == $t'
```

Expect each `jq -e` to exit 0 and the line count to grow by exactly 1. Cockpit: on
`$WEB/tickets/$TID` choose `ROUTE` in `[data-testid=override-path]`, type into
`[data-testid=override-note]` and `[data-testid=override-decided-by]`, click
`[data-testid=override-submit]`; expect a `[data-testid=timeline-event][data-kind=override]`.

## Proof

One `override` audit event with the human actor, the ticket's path changed to the human's
choice, and the side effect: one new JSON line in `backend/evals/overrides.jsonl` naming the
ticket with both decisions.

## Gotchas

- `backend/evals/overrides.jsonl` is a tracked file: the drive appends to the real repo
  file. Do not commit the verify line; restore the file after recording evidence.
- Path values are `RESOLVE`, `ROUTE`, `ESCALATE` (enums.Path), uppercase.
