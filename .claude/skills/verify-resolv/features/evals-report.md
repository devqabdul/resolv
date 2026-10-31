# evals-report: Eval run and report

- id: evals-report
- proven: no
- anchors:

## What it is

`make evals` (`python -m evals.run`) runs ~60 labelled tickets from
`backend/evals/dataset.jsonl` through the pipeline (replay LLM, mock Paytm) and writes
`backend/evals/report.md` + `report.json`: type accuracy, per-path precision/recall/F1,
false-action rate, gate catch rate. `GET /api/evals/report` serves the latest. Not built yet
(T21, T22).

## How to reach it

- Command: `make evals` (from the repo root).
- API: `GET $API/api/evals/report`.

## Drive it

```sh
(cd "$ROOT/backend" && DATABASE_URL="sqlite:///$RUN/evals.db" LLM_MODE=replay ANTHROPIC_API_KEY= \
  HTTPS_PROXY=http://127.0.0.1:9 NO_PROXY=localhost,127.0.0.1 MOCK_LATENCY_MS=0 SLACK_WEBHOOK_URL= \
  uv run python -m evals.run) 2>&1 | tee "$ART/evals.log"; echo "exit ${PIPESTATUS[0]}"
cp "$ROOT/backend/evals/report.json" "$ROOT/backend/evals/report.md" "$ART/"
jq -e '.n >= 50 and has("false_action_rate") and has("gate_catch_rate")' "$ART/report.json"
curl -fsS "$API/api/evals/report" -o "$ART/api_report.json"
jq -e --slurpfile r "$ART/report.json" '.json.n == $r[0].n' "$ART/api_report.json"
```

Expect `exit 0`, both `jq -e` to exit 0, and `report.md` to contain "false-action rate".
With a warmed cache the run makes no network call (the proxy points at a closed port).

## Proof

The files on disk are rewritten at this head (`generated_at` now), n ≥ 50, the false-action
and gate-catch rates are present, and the API serves the same numbers.

## Gotchas

- `backend/evals/report.*` are tracked files; the drive rewrites them. Commit them only when
  the task is "regenerate the report", else restore them.
- A cold cache plus no network fails on replay misses; that is a cache gap (see
  replay-cache), not an evals bug.
- Key names (`n`, `false_action_rate`, `gate_catch_rate`) are this map's reading of FR-12;
  if T22 names them differently, keep the facts and fix the jq paths.
