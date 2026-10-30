# sla-guard: SLA and RBI TAT breach guard

- id: sla-guard
- proven: no
- anchors: backend/app/services/sla.py, backend/app/workers/scheduler.py

## What it is

Every 30 s the guard checks tickets in `NEW, PROCESSING, ROUTED, ESCALATED,
AWAITING_APPROVAL`: when `min(sla_due_at, TAT deadline) − now` is under 15 minutes and the
ticket was not nudged, it sends one nudge to `#support-leads` ("<ticket> breaches in N min
— reasons — link"), raises priority to `P1` and audits `notification`. Not built yet (T17).

## How to reach it

- No route of its own. Observe through `GET /api/tickets/{id}`, `GET /api/notifications`.
- Lever: restart the instance on the same DB (`KEEP_DB=1`) with `DEMO_NOW_OVERRIDE` set
  to 10 minutes before the ticket's `sla_due_at`.

## Drive it

```sh
curl -fsS -X POST "$API/api/demo/reset" && curl -fsS -X POST "$API/api/demo/seed"
curl -fsS -X POST "$API/api/demo/ticket/dispute" -o "$ART/create.json"; TID=$(jq -r .id "$ART/create.json")
for i in $(seq 1 90); do curl -fsS "$API/api/tickets/$TID" -o "$ART/before.json"; jq -e '.ticket.status == "ROUTED"' "$ART/before.json" && break; sleep 1; done
DUE=$(jq -r .ticket.sla_due_at "$ART/before.json")
NOW=$(python3 -c 'import sys,datetime as d; print((d.datetime.fromisoformat(sys.argv[1])-d.timedelta(minutes=10)).isoformat())' "$DUE")
# run Cleanup's kill + release lines (keep $RUN), then relaunch on the same DB:
#   KEEP_DB=1 DEMO_NOW_OVERRIDE="$NOW" + the Launch block; re-seed the mock (in-memory):
curl -fsS -X POST "$API/mock/paytm/v1/admin/seed"
for i in $(seq 1 45); do curl -fsS "$API/api/notifications?limit=50" -o "$ART/notifications.json"; jq -e --arg t "$TID" 'map(select(.ticket_id == $t and .target == "#support-leads")) | length == 1' "$ART/notifications.json" && break; sleep 1; done
curl -fsS "$API/api/tickets/$TID" -o "$ART/after.json"
jq -e '.ticket.priority == "P1" and ([.timeline[].kind] | index("notification") != null)' "$ART/after.json"
sleep 35; curl -fsS "$API/api/notifications?limit=50" | jq -e --arg t "$TID" 'map(select(.ticket_id == $t and .target == "#support-leads")) | length == 1'
```

Expect the nudge within 45 s of the relaunch (one guard tick is 30 s), each `jq -e` to
exit 0, and still exactly one nudge after another tick (nudged once per ticket).

## Proof

One `#support-leads` notification naming the ticket and "breaches in", priority raised to
`P1`, a `notification` audit event; the second tick adds no duplicate.

## Gotchas

- The restart empties the in-memory mock; re-seed it, never `/api/demo/reset` (that wipes the
  Resolv DB too).
- `DEMO_NOW_OVERRIDE` also moves every other clock (TAT maths); do not drive D1 on this
  instance afterwards.
- With `SLACK_WEBHOOK_URL` blank the nudge is `channel` `inapp`.
