# Resolv

## What it is

Resolv is an autonomous support teammate for payments customer service, built for the Paytm Build for India AI Hackathon finals (Track 3, Team Xeon). It takes a ticket and finishes it through five fixed steps: understand, decide, policy gate, act, verify. The LLM only proposes a `Decision`; a deterministic policy gate in code decides whether money moves, so the model never touches money. Actions run against a mock Paytm API we built, so the demo needs nothing external. On top of the loop sit an incident clusterer (a spike of identical failures becomes one incident), an SLA guard that nudges before a breach, and an eval harness that reports the false-action rate.

| Doc | Use it for |
|---|---|
| `docs/01-PRODUCT-SPEC.md` | What we build, demo moments D1-D5, canonical demo data |
| `docs/02-ARCHITECTURE.md` | How: layout, state machine, contracts, API. Source of truth |
| `docs/03-TECH-STACK-AND-MODULES.md` | Stack choices and module responsibilities |
| `docs/04-TECHNOLOGIES.md` | Per-technology reference and gotchas |
| `docs/06-IMPLEMENTATION-PLAN.md` | Task order with acceptance commands |
| `CLAUDE.md` | Hard rules, conventions, canonical demo facts |

## Quick start

Prerequisites: Python 3.12 managed by `uv`, Node 24, `make`.

```
cp .env.example .env     # add ANTHROPIC_API_KEY only if you will use live mode
npm --prefix frontend ci # install frontend deps (a fresh clone has no node_modules)
make dev                 # backend :8000 (mock Paytm mounted) + frontend :3000
make seed                # reset and seed the demo data (scripts/demo_reset.sh)
```

`make dev`/`backend`/`seed`/`warm` create `.env` from `.env.example` if missing, and `make backend` loads it with `uv run --env-file ../.env`, so its values (e.g. `DEMO_NOW_OVERRIDE`, `MOCK_LATENCY_MS`) reach both Resolv and the mounted mock Paytm.

The backend venv is created automatically by `uv` on the first `make backend` or `make dev` (Python 3.12 is pinned in `backend/.python-version`).

Open `http://localhost:3000/?demo=1` to get the demo drawer (Reset, Seed, inject the 7 scenarios, Spike AXIS 120). Health check: `GET http://localhost:8000/api/health`.

Demo flow:

1. Seed from the drawer (or `make seed`).
2. Inject `d1_failed_upi` and watch the row resolve: reversal of 2,499, 200 compensation, reply, `RESOLVED`.
3. Click Spike AXIS 120 and open the Incidents page: one incident, later tickets attach with no LLM call.
4. Inject `d3_over_limit` and open the Approvals page: the 12,000 reversal waits for a human.
5. Approve as a name; the ticket resolves and the audit shows who approved.
6. Open the Evidence page for the eval report and KPI tiles.

The other scenarios are `hinglish_refund_status`, `merchant_settlement`, `kyc_rejected`, `mandate_email` and `dispute`.

## LLM modes

Set with the `LLM_MODE` env var in `.env`.

| Mode | Behaviour | Use it for |
|---|---|---|
| `mock` | Rule-based `integrations/llm/mock.py`, no network | Tests and CI |
| `replay` | Cache first, live call on a miss; offline or no key falls back to mock | Pitch mode (the default in `.env.example`) |
| `live` | Always calls Anthropic and writes the cache | Warming the cache |

`.env.example` defaults to `LLM_MODE=replay`, so a fresh clone without a key falls back to the mock rules offline.

Related env vars: `ANTHROPIC_API_KEY`, `LLM_MODEL_DECIDE=claude-sonnet-5-5`, `LLM_MODEL_UNDERSTAND=claude-haiku-5-5`, `LLM_CACHE_DIR`.

## Warm the replay cache (attended)

This is the one step a human runs with a key before the pitch. It needs `ANTHROPIC_API_KEY` and network.

```
export ANTHROPIC_API_KEY=...   # your key
make warm                      # runs scripts/warm_cache.sh
```

`make warm` starts the backend in `live` mode, resets and seeds, injects all 7 scenarios and the AXIS spike so every prompt lands in the cache, runs `make evals`, switches `LLM_MODE=replay` in `.env`, restarts and checks `/api/health` reports `replay`, then runs `make test` and `make lint`. It does not commit. Afterwards, review and commit:

```
git add backend/.llm_cache backend/evals/report.* && git commit
```

## Tests and evals

```
make test     # pytest -q in backend/ (LLM_MODE=mock, no network)
make lint     # ruff check + ruff format --check
make evals    # python -m evals.run -> backend/evals/report.md and report.json
uv run --directory backend --extra optional pytest -q tests/test_embeddings_fastembed.py
```

The last command runs the embeddings test, which needs the `optional` extra (fastembed). The eval report lands in `backend/evals/report.md` and `report.json`. `GET /api/evals/report` returns `generated_at`, the report `markdown`, the `json` and `overrides_count` (human overrides appended to the eval set); it answers 404 until a report exists. The Evidence page renders it.

## Architecture at a glance

A FastAPI backend (SQLite, mock Paytm mounted at `/mock/paytm/v1`) runs each ticket through the agent nodes (`AGENT_ENGINE=langgraph`, or `runner` as the sequential fallback). Background loops cluster incidents and guard SLAs. A Next.js 15 cockpit polls the API every 2 seconds. `docs/02-ARCHITECTURE.md` is the source of truth for names and contracts.

- Pages: Queue `/`, `/tickets/[id]`, `/approvals`, `/incidents`, `/evidence`.
- API: `GET /api/health`, `GET /api/metrics`, `GET /api/evals/report`, `POST /api/demo/reset`, `/api/demo/seed`, `/api/demo/ticket/{scenario}`, `/api/demo/spike`; full list in docs/02 section 6.1.

## Safety rails

- Policy gate: every proposed action passes `app/policy/engine.py` and executes only through `ToolRegistry.call()` after `AUTO_EXECUTE` or a human approval.
- Idempotency: each execution is keyed by `sha256(ticket_id + name + canonical params)`, so a retry never double-refunds.
- PII masking: `app/policy/pii.py` masks before any LLM call; the UI shows `masked_text` and raw identifiers are never logged.
- No real Paytm: `PAYTM_BASE_URL` must point at the mounted mock (`/mock/paytm/v1`) or the standalone mock on `:8001`.
- Unknown references: ids not in the `ContextBundle` are `BLOCKED unknown_reference`.
- Audit everything: every tool call, node, approval, override, notification and incident link is written with an `actor`.
