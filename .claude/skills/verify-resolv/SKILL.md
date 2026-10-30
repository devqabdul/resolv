---
name: verify-resolv
description: >-
  Prove a change to Resolv (the autonomous payments-support teammate) works by driving
  the real running app: the FastAPI backend on its own port (Resolv API under /api plus the
  mounted mock Paytm under /mock/paytm/v1) and the Next.js 15 cockpit on its own port.
  Drives HTTP routes with curl and cockpit pages by route path and data-testid, then records
  SHA-bound evidence under .verify/. Use it after any change to backend/ or frontend/, when
  a task names a feature id from features/README.md, or when asked to "verify", "prove" or
  "demo-check" D1-D5. Tests passing is not verification.
---

# verify-resolv

Resolv is one runnable app with two processes. The **backend** (`backend/`, FastAPI,
uvicorn) serves the Resolv API at `/api/*` and mounts the in-memory mock Paytm at
`/mock/paytm/v1`. The **cockpit** (`frontend/`, Next.js 15 App Router) is the agent-facing
UI. A verify instance is one backend plus one cockpit, each on its own claimed port, with
its own SQLite file and its own copy of the cockpit build. API features are driven with
`curl` + `jq`. Cockpit features are driven with a browser tool (Playwright MCP or Chrome)
by route path and `data-testid`, never by position. Every proof is recorded with
`scripts/verify_evidence.py`.

## Session variables

Run every block below from a shell that first ran this preamble. Shell state does not
survive between tool calls, so paste it at the top of each block.

```sh
ROOT=$(git rev-parse --show-toplevel); cd "$ROOT"
SKILL="$ROOT/.claude/skills/verify-resolv"
INSTANCE="${INSTANCE:-a}"             # one short name per instance: a, b, t12-owner ...
VERIFIER="${VERIFIER:-verify-resolv-session}"
RUN="$ROOT/.verify-run/$INSTANCE"     # per-instance run state; cleanup deletes it
ART="$RUN/art"                        # captured artifacts before they are recorded
test -f "$RUN/env" && . "$RUN/env"    # API_PORT WEB_PORT API WEB LLM_MODE AGENT_ENGINE, from Launch
```

- `INSTANCE`: the instance name. Two instances never share a name.
- `VERIFIER`: under factory-conductor, the verifier id from the verifier brief. Working
  alone, a stable name for this session. Never the author of the change being proven.

## Launch

Each instance claims two ports with the recorder (`$INSTANCE-api` from 41000,
`$INSTANCE-web` from 43000), gets a fresh SQLite file under `$RUN/`, and runs the
cockpit from its own copy in `$RUN/web` (two `next dev` servers in one `frontend/`
directory share `.next/` and the second one serves HTTP 500). The backend env is set
explicitly so `.env` cannot leak in: `LLM_MODE=mock` (no network), `MOCK_LATENCY_MS=0`,
`EMBEDDINGS_ENABLED=false`, blank `SLACK_WEBHOOK_URL` (never post to a real Slack), and
`PAYTM_BASE_URL` pointing at this instance's own mounted mock. Override `LLM_MODE` or
`AGENT_ENGINE` in the environment before launch when a feature says so. Set `KEEP_DB=1`
to restart on the same SQLite file (sla-guard needs this).

```sh
mkdir -p "$RUN" "$ART"
API_PORT=$(python3 $SKILL/scripts/verify_evidence.py port --instance "$INSTANCE-api" | sed 's/^PORT: //')
WEB_PORT=$(python3 $SKILL/scripts/verify_evidence.py port --instance "$INSTANCE-web" --base 43000 | sed 's/^PORT: //')
printf 'API_PORT=%s\nWEB_PORT=%s\nAPI=http://localhost:%s\nWEB=http://localhost:%s\nLLM_MODE=%s\nAGENT_ENGINE=%s\n' \
  "$API_PORT" "$WEB_PORT" "$API_PORT" "$WEB_PORT" "${LLM_MODE:-mock}" "${AGENT_ENGINE:-langgraph}" > "$RUN/env"
. "$RUN/env"
[ "${KEEP_DB:-0}" = 1 ] || rm -f "$RUN/resolv.db"

# backend: Resolv API + mounted mock Paytm, per-instance DB, no network
(cd "$ROOT/backend" && exec env \
  DATABASE_URL="sqlite:///$RUN/resolv.db" LLM_MODE="$LLM_MODE" \
  AGENT_ENGINE="$AGENT_ENGINE" MOCK_LATENCY_MS=0 EMBEDDINGS_ENABLED=false \
  SLACK_WEBHOOK_URL= PAYTM_BASE_URL="$API/mock/paytm/v1" \
  DEMO_NOW_OVERRIDE="${DEMO_NOW_OVERRIDE:-}" \
  nohup uv run uvicorn app.main:app --host 127.0.0.1 --port "$API_PORT") \
  > "$RUN/api.log" 2>&1 < /dev/null & echo $! > "$RUN/api.pid"

# cockpit: private copy of frontend/ (own .next), shared node_modules
rsync -a --delete --exclude node_modules --exclude .next "$ROOT/frontend/" "$RUN/web/"
test -d "$ROOT/frontend/node_modules" || npm --prefix "$ROOT/frontend" ci
ln -sfn "$ROOT/frontend/node_modules" "$RUN/web/node_modules"
(cd "$RUN/web" && exec env NEXT_PUBLIC_API_BASE="$API" NEXT_PUBLIC_USE_FIXTURES=0 \
  nohup npm run dev -- -p "$WEB_PORT") > "$RUN/web.log" 2>&1 < /dev/null & echo $! > "$RUN/web.pid"

# readiness: health 200 on API_PORT and GET / 200 on WEB_PORT, timeout 90 seconds
for i in $(seq 1 90); do
  curl -fsS -o /dev/null "$API/api/health" && curl -fsS -o /dev/null "$WEB/" && { echo "READY $INSTANCE api=$API web=$WEB"; break; }
  sleep 1
done
```

Ready means the loop prints `READY <instance> api=... web=...`. The backend is up in
about 3 seconds; the first `GET /` compiles the cockpit and takes 3-10 seconds. If no
`READY` line after 90 seconds, stop waiting, read `$RUN/api.log` and `$RUN/web.log`, run
Cleanup and report the launch failure. The cockpit reads `NEXT_PUBLIC_API_BASE` (defined in
docs/02 §2/§15 and `.env.example`), set here to this instance's backend.

## Doctor

Read-only. Checks both processes, that each port is held by this instance's process, that
the mounted mock answers, and that the running code is HEAD (clean `backend/` and
`frontend/`, and the cockpit copy equal to `frontend/`). Run it after Launch, before the
first drive, and after any failed drive.

```sh
H=$(curl -fsS "$API/api/health"); echo "$H"
api_health=fail; echo "$H" | jq -e '.ok == true' && api_health=pass
llm_mode=fail; echo "$H" | jq -e --arg m "${LLM_MODE:-mock}" '.llm_mode == $m' && llm_mode=pass
mock_paytm=fail; curl -fsS "$API/mock/paytm/v1/transactions?customer_id=cust_riya" | jq -e 'type == "array"' && mock_paytm=pass
api_port=fail; P=$(lsof -ti tcp:"$API_PORT" -sTCP:LISTEN | head -1); ps -o command= -p "$P" | grep -q -- "--port $API_PORT" && api_port=pass
web_page=fail; curl -fsS -o /dev/null "$WEB/" && web_page=pass
web_port=fail; W=$(lsof -ti tcp:"$WEB_PORT" -sTCP:LISTEN | head -1); lsof -a -p "$W" -d cwd -Fn | grep -qx "n$RUN/web" && web_port=pass
build=fail; test -z "$(git status --porcelain backend frontend)" && diff -rq -x node_modules -x .next -x next-env.d.ts frontend "$RUN/web" && build=pass
ALL=--ok; for c in $api_health $llm_mode $mock_paytm $api_port $web_page $web_port $build; do [ "$c" = pass ] || ALL=--fail; done
python3 $SKILL/scripts/verify_evidence.py doctor --instance "$INSTANCE" --verifier "$VERIFIER" $ALL \
  --check api_health=$api_health --check llm_mode=$llm_mode --check mock_paytm=$mock_paytm \
  --check api_port=$api_port --check web_page=$web_page --check web_port=$web_port --check build=$build
```

Expect `DOCTOR: ok .verify/<instance>/doctor/<sha>/doctor.json`. `DOCTOR: red` means do
not drive: the failing `--check` names what to fix (a `build=fail` means uncommitted
changes or a stale cockpit copy: commit, then relaunch).

## Drive

Per-feature recipes live in `features/` (index: `features/README.md`). Every recipe uses
the same harness:

API features: `curl` against `$API`, capture each response into `$ART`, assert with `jq -e`
(exit 0 = expected, exit 1 = not). Async work (queue every 1 s, clusterer every 15 s, SLA
guard every 30 s) is polled with a stated timeout, never assumed:

```sh
curl -fsS -X POST "$API/api/demo/reset" && curl -fsS -X POST "$API/api/demo/seed"
curl -fsS -X POST "$API/api/demo/ticket/d1_failed_upi" -o "$ART/create.json"
for i in $(seq 1 90); do
  curl -fsS "$API/api/tickets/tkt_48213" -o "$ART/ticket.json"
  jq -e '.ticket.status | IN("NEW","PROCESSING") | not' "$ART/ticket.json" && break; sleep 1
done
jq -e '.ticket.status == "RESOLVED"' "$ART/ticket.json"   # expect exit 0
```

Cockpit features: open `$WEB` + the route with the browser tool, address controls only by
`[data-testid=...]`, ARIA role + name, or route path. Capture the page text or accessibility
snapshot into `$ART/*.txt` and a screenshot into `$ART/*.png`, then confirm the same state
through the API (the UI is a view of `/api`, so the API read is the side-effect proof).
Use `http://localhost:<port>` URLs, not `127.0.0.1` (CORS origin).

Playwright MCP shape: `browser_navigate` to `$WEB/tickets/tkt_48213`, `browser_snapshot`,
`browser_click` on the element whose ref matches `[data-testid=approve-button]`,
`browser_take_screenshot` with a filename under `$ART`.

## Evidence

- Exercise the real user path. Never internal setters, never test-only endpoints.
- Capture the action *and* the resulting state, not just a final screenshot.
- Verify side effects (rows inserted, files written, messages sent, webhooks fired) alongside what is visible.
- Mocks only where a production boundary already isolates the external system.
- Where the safe path is a dry-run or test mode, verify what it *actually* skips by observing files, network and git refs, not by trusting its name. Some dry-runs still touch the network or open a browser.
- Evidence goes to `.verify/<instance>/<feature-id>/<sha>/`, one directory per feature per head, recorded with `scripts/verify_evidence.py record`.
- Harness output is JSON wherever the harness can emit it, so a verifier can read it without a human.
- Cleanup removes instances, never evidence.

The mock Paytm is the production boundary (Resolv only reaches it over HTTP, exactly like
the real API), so driving through it is allowed. `/api/demo/*` is the documented demo
control surface (FR-13), not a test-only setter.

```sh
python3 $SKILL/scripts/verify_evidence.py record --instance "$INSTANCE" --feature d1-auto-resolve \
  --verifier "$VERIFIER" --result pass \
  --action "POST /api/demo/ticket/d1_failed_upi; poll GET /api/tickets/tkt_48213" \
  --observed "status RESOLVED, resolved_by resolv, reversal 2499 + compensation 200" \
  --side-effect "mock Paytm txn_48213_a refund_status INITIATED with an rfd_ id" \
  --artifact "$ART/ticket.json" --artifact "$ART/txn.json"
```

Expect `EVIDENCE: .verify/<instance>/<feature>/<sha>/evidence.json`, exit 0. Record a
failed drive with `--result fail` too. Under factory-conductor, export
`VERIFY_EVIDENCE_DIR=<run root>/.verify` first.

## Cleanup

Stops this instance's processes by pid file and by listening port, never by process name,
releases both port claims and deletes `$RUN`. Artifacts were copied into `.verify/` by
`record`, so nothing is lost.

```sh
for p in $(cat "$RUN/api.pid" "$RUN/web.pid" 2>/dev/null) \
         $(lsof -ti tcp:"$API_PORT" -sTCP:LISTEN) $(lsof -ti tcp:"$WEB_PORT" -sTCP:LISTEN); do
  kill "$p" 2>/dev/null
done
sleep 2; lsof -nP -iTCP:"$API_PORT" -iTCP:"$WEB_PORT" -sTCP:LISTEN || echo "STOPPED $INSTANCE"
python3 $SKILL/scripts/verify_evidence.py release --instance "$INSTANCE-api"
python3 $SKILL/scripts/verify_evidence.py release --instance "$INSTANCE-web"
rm -rf "$RUN"
```

Expect `STOPPED <instance>` and two `RELEASED:` lines. `.verify/` is never touched.
