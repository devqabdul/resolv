# evidence-page: Evidence page with the eval report (D5)

- id: evidence-page
- proven: no
- anchors: backend/app/api/metrics.py, backend/evals/run.py, frontend/app

## What it is

`/evidence` renders the latest `backend/evals/report.md` and the headline numbers
(n labelled tickets, resolve-vs-route precision/recall, false-action rate, gate catch rate)
plus the count of human overrides in `overrides.jsonl`. Not built yet (T23).

## How to reach it

- Cockpit: `$WEB/evidence`, nav link "Evidence".
- API behind it: `GET $API/api/evals/report` -> `{generated_at, markdown, json}`.

## Drive it

```sh
curl -fsS "$API/api/evals/report" -o "$ART/report.json"
jq -e '(.markdown | length) > 0 and .json != null and .generated_at != null' "$ART/report.json"
# browser: open "$WEB/evidence"; expect [data-testid=evals-report] containing the report
#   heading, [data-testid=evals-n] >= 50, [data-testid=evals-false-action-rate],
#   [data-testid=evals-gate-catch-rate], [data-testid=overrides-count];
#   save "$ART/evidence.txt" and "$ART/evidence.png"
```

Expect the `jq -e` to exit 0 and each headline tile to equal the matching value in
`report.json` `.json`.

## Proof

The rendered page and the API serve the same report (same `generated_at`, same numbers),
with n ≥ 50 and a false-action rate shown. Side effect: none (read-only).

## Gotchas

- The page shows whatever report is on disk; run evals-report first if the head changed the
  pipeline.
- docs/02 §12 mentions a "Re-run evals" button calling `/api/evals/run`, which is not in the
  §6.1 contract; prove it only if a task adds that route.
- CORS on non-3000 web ports, see ticket-queue.
