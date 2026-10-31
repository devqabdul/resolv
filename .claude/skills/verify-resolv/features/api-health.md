# api-health: Backend health check

- id: api-health
- proven: 643ced81e1e6c62e6cb3058decdc8121b7cd2fdd
- anchors: backend/app/main.py:/api/health, backend/app/config.py:LLM_MODE

## What it is

`GET /api/health` tells an operator (and the cockpit) that the backend is up, which
`LLM_MODE` it runs in (`live`, `replay` or `mock`), which database driver it uses and that
the mock Paytm is mounted in-process. It is the first thing the pitch runbook checks.

## How to reach it

- HTTP: `GET $API/api/health` (docs/02 §6.1). No auth.
- `make dev` / `make backend` expose it on `:8000`; a verify instance exposes it on its
  own `API_PORT`.

## Drive it

```sh
curl -fsS -w '\n%{http_code}\n' "$API/api/health" | tee "$ART/health.txt"
sed -n 1p "$ART/health.txt" > "$ART/health.json"
jq -e '.ok == true and .llm_mode == "mock" and .db == "sqlite" and .mock_paytm == "mounted"' "$ART/health.json"
```

Expected output: `{"ok":true,"llm_mode":"mock","db":"sqlite","mock_paytm":"mounted"}`,
HTTP `200`, and the `jq -e` line prints `true` and exits 0. On an instance launched with
`LLM_MODE=replay` expect `"llm_mode":"replay"`.

## Proof

The JSON body above with `200`, and the side effect that the mount it reports is real:
`curl -fsS "$API/mock/paytm/v1/transactions?customer_id=cust_riya"` returns a JSON array
(empty before seed). `llm_mode` equals the mode the instance was launched with.

## Gotchas

- `db` is only the driver name (`sqlite` or `postgresql`), not the file. Per-instance DB
  isolation comes from Launch's `DATABASE_URL`, not from this route.
- `.env` sets `LLM_MODE`; process env wins (pydantic-settings). A wrong `llm_mode` here
  means the launch env did not reach uvicorn.
- T9 may move this route into `backend/app/api/metrics.py` (docs/02 §6 router placement):
  update the anchor then.
