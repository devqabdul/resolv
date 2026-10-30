# notifications: Slack or in-app notifications panel

- id: notifications
- proven: no
- anchors: backend/app/api/audit.py, backend/app/workers/scheduler.py, frontend/app/layout.tsx

## What it is

Every nudge (incident created -> `#ops`, SLA breach -> `#support-leads`, approval needed ->
an agent) is written to the `notifications` table, posted to Slack when
`SLACK_WEBHOOK_URL` works, and always listed in the in-app panel. With no webhook the row has
`channel` `inapp`. Not built yet (T18).

## How to reach it

- API: `GET $API/api/notifications?limit=50` -> `Notification[]`
  (`id, ts, channel, target, text, delivered, ticket_id?, incident_id?`).
- Cockpit: the in-app notifications panel in the layout.

## Drive it

```sh
curl -fsS -X POST "$API/api/demo/reset" && curl -fsS -X POST "$API/api/demo/seed"
curl -fsS -X POST "$API/api/demo/spike" -H 'content-type: application/json' -d '{"issuer_bank":"AXIS","count":120,"minutes":20}'
for i in $(seq 1 60); do curl -fsS "$API/api/notifications?limit=50" -o "$ART/notifications.json"; jq -e 'map(select(.target == "#ops" and .incident_id != null)) | length >= 1' "$ART/notifications.json" && break; sleep 1; done
jq -e 'map(select(.target == "#ops")) | .[0] | .channel == "inapp" and (.incident_id | startswith("inc_")) and (.text | length) > 0' "$ART/notifications.json"
grep -c 'hooks.slack.com' "$RUN/api.log"
```

Expect each `jq -e` to exit 0 and the `grep -c` to print `0` (blank webhook: no Slack call).
Cockpit: `$WEB/` shows `[data-testid=notifications-panel]` with a
`[data-testid=notification-item][data-channel=inapp]` whose text matches. Save
`$ART/notifications.txt`.

## Proof

An `#ops` notification row linked to the incident, `channel` `inapp`, listed by the API and
by the panel; no outbound Slack request with the webhook blank.

## Gotchas

- Launch blanks `SLACK_WEBHOOK_URL` on purpose; never point a verify instance at a real
  Slack channel. To prove the Slack branch, run a local catcher and set the webhook to it.
- `/api/notifications` lives in `api/audit.py` (docs/02 §6 router placement).
- Handles: `notifications-panel`, `notification-item` with `data-channel`.
