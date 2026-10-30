# metrics-kpi: KPI strip and /api/metrics (D5)

- id: metrics-kpi
- proven: no
- anchors: backend/app/api/metrics.py, backend/app/services/metrics.py, frontend/app/layout.tsx

## What it is

`GET /api/metrics` computes, over the demo session, `auto_resolution_rate`,
`avg_first_response_sec`, `avg_resolution_sec`, `open`, `awaiting_approval`,
`incidents_open`, `tat_breaches_prevented`, `by_type` and `window_minutes`. The cockpit
layout shows five of them as large KPI tiles on every page. `INCIDENT_LINKED` counts as
auto-handled. Not built yet (T17, T13, T23).

## How to reach it

- API: `GET $API/api/metrics?window_minutes=240`.
- Cockpit: KPI strip in the layout on `$WEB/` (and every page).

## Drive it

```sh
curl -fsS -X POST "$API/api/demo/reset" && curl -fsS -X POST "$API/api/demo/seed"
curl -fsS "$API/api/metrics?window_minutes=240" -o "$ART/metrics_empty.json"
curl -fsS -X POST "$API/api/demo/ticket/d1_failed_upi" && curl -fsS -X POST "$API/api/demo/ticket/d3_over_limit"
for i in $(seq 1 90); do curl -fsS "$API/api/metrics?window_minutes=240" -o "$ART/metrics.json"; jq -e '.awaiting_approval == 1 and .auto_resolution_rate > 0' "$ART/metrics.json" && break; sleep 1; done
jq -e 'has("auto_resolution_rate") and has("avg_first_response_sec") and has("avg_resolution_sec") and has("open") and has("awaiting_approval") and has("incidents_open") and has("tat_breaches_prevented") and has("by_type") and .window_minutes == 240' "$ART/metrics.json"
jq -e '.tat_breaches_prevented >= 1 and .incidents_open == 0' "$ART/metrics.json"
```

Expect every `jq -e` to exit 0. Cockpit: on `$WEB/` expect `[data-testid=kpi-strip]` with
tiles `[data-testid=kpi-auto_resolution_rate]`, `kpi-avg_first_response_sec`, `kpi-open`,
`kpi-awaiting_approval` (text `1`) and `kpi-incidents_open` (text `0`), matching
`metrics.json`. Save `$ART/kpi.txt`.

## Proof

All FR-11 keys present; after D1 resolved and D3 pending: `awaiting_approval` 1,
`auto_resolution_rate` > 0, `tat_breaches_prevented` ≥ 1 (D1 paid ₹200 compensation); the
tiles show the same numbers. Side effect: none (read-only); the numbers move only because
tickets were injected.

## Gotchas

- Rates may be 0-1 floats in the API and percentages in the tile; compare by value.
- Numbers are per DB; a fresh instance starts at zero.
- CORS on non-3000 web ports, see ticket-queue.
