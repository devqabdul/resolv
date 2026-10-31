# CLAUDE.md — Resolv (hackathon prototype)

Resolv is an autonomous support teammate for payments customer service: it takes a ticket, builds context from a (mock) Paytm ledger, decides resolve/route/escalate, executes actions through a deterministic policy gate, audits everything, clusters spikes into incidents, and hands the rest to humans with a draft and next action. Built for the Paytm Build for India AI Hackathon finals (Track 3) by Team Xeon, with this agent doing most of the typing.

## Read these first

| Doc | Use it for |
|---|---|
| `docs/01-PRODUCT-SPEC.md` | **What** we build, demo moments D1–D5, ticket types, functional requirements, canonical demo data |
| `docs/02-ARCHITECTURE.md` | **How**: repo layout, agent state machine, LLM contracts, data model, API contracts, `rules.yaml`, fallbacks. **Wins every conflict.** |
| `docs/03-TECH-STACK-AND-MODULES.md` | Stack choices and module responsibilities |
| `docs/04-TECHNOLOGIES.md` | Per-technology reference: versions, install, how we use it, gotchas |
| `docs/06-IMPLEMENTATION-PLAN.md` | **Task order** T1…T27 with acceptance commands. Start at T1. |

Before any task: read the task block in `docs/06`, then the `docs/02` sections it names. Do the task, run its Accept commands, commit. Do not start the next task unless asked.

## Hard rules (never break these, even if a task seems to ask)

1. **The LLM never moves money.** Model output is a `Decision` (pydantic). Every proposed action passes `app/policy/engine.py` and executes only through `app/agent/tools.py` `ToolRegistry.call()`. No node, service or route may call `integrations/paytm/client.py` money-moving methods (`initiate_reversal`, `credit_compensation`) except through the registry after a gate result of `AUTO_EXECUTE` or a human approval.
2. **Never call a real Paytm endpoint.** `PAYTM_BASE_URL` must point at the mounted mock (`/mock/paytm/v1`) or the standalone mock on `:8001`. If it points anywhere else, refuse and say so.
3. **Names are fixed.** Enums, ids, table/column names, routes, file paths, env vars and action names are exactly as in `docs/02`. Do not rename, pluralise or "improve" them. New fields are fine; mark them `(decision: …)` in a code comment and in `docs/02` if they change a contract.
4. **Everything is audited.** Every tool call writes `tool_call` + `tool_result`; every node writes its audit kind (`docs/02 §3.2`); approvals, overrides, notifications and incident links are audited with `actor` (`resolv`, `system`, `human:<name>`).
5. **Idempotency.** Every action execution computes `sha256(ticket_id + name + canonical params)` and checks `action_executions` first. A retry must never double-refund. Money-moving mock calls carry the same key as `idempotency_key`.
6. **PII is masked before any LLM call** (`app/policy/pii.py`). The UI shows `masked_text` by default. Never log raw phone/email/VPA/account numbers.
7. **No `eval()`/`exec()`** anywhere, including the rules expression evaluator. Parse `lhs op rhs` with a small tokeniser.
8. **`temperature=0`**, structured outputs via tool-use, `max_tokens ≤ 1500`. Prompts live in `app/agent/prompts/*.md`, not in Python strings.
9. **Unknown references are blocked.** The gate resolves `txn/refund/settlement/kyc/mandate` ids only from the `ContextBundle`; anything else → `BLOCKED unknown_reference`.
10. **Stay in the task.** No refactors, renames, dependency swaps or "while I'm here" changes beyond the task's file list. Keep `main` green: `make test` and `make lint` pass before every commit.
11. **Mock mode must always work.** `LLM_MODE=mock` and the mounted mock Paytm must run the 7 scenarios with no network. Do not make tests depend on the Anthropic API.

## How to run

```
cp .env.example .env            # set ANTHROPIC_API_KEY; LLM_MODE=mock until T6, then replay/live
make dev                        # backend :8000 (mock Paytm mounted at /mock/paytm/v1) + frontend :3000
make seed                       # POST /api/demo/reset + /seed
make test                       # pytest -q (backend/tests)
make evals                      # python -m evals.run → backend/evals/report.{md,json}
make warm                       # scripts/warm_cache.sh (live run of all scenarios, fills .llm_cache)
make lint                       # ruff check + format
```
Cockpit: `http://localhost:3000/?demo=1` (demo drawer). Health: `GET /api/health`.

`LLM_MODE`: `live` = always call Anthropic and write the cache · `replay` = cache first, live on miss (**pitch mode**) · `mock` = `integrations/llm/mock.py` rules, no network (**tests/CI**). Models: `LLM_MODEL_DECIDE=claude-sonnet-5-5`, `LLM_MODEL_UNDERSTAND=claude-haiku-5-5`.

Database: `DATABASE_URL=sqlite:///./resolv.db` by default; Postgres via `docker compose up -d` and `postgresql+psycopg://resolv:resolv@localhost:5432/resolv` (optional, T28).

## Conventions

**Python (backend/)** — 3.11+, full type hints, pydantic v2 models for all IO, SQLAlchemy 2.0 style (`Mapped[...]`, `select()`), `httpx` for HTTP, `ruff` for lint+format (line length 100), `pytest` with `TestClient`. Ids: `tkt_`, `run_`, `apr_`, `inc_` + 8 hex; mock ids `txn_`, `rfd_`, `arn_`, `cmp_`, `stl_`, `kyc_`, `mnd_`. Times: UTC, ISO-8601, `datetime.now(tz=UTC)`; honour `DEMO_NOW_OVERRIDE` through one helper `app/util/clock.py` `now()` (decision). Nodes are pure functions `(state: AgentState) -> AgentState`; side effects go through services/tools. Loops in `workers/scheduler.py` catch all exceptions, audit `error`, and keep running. Logging: `structlog`-free plain `logging` with `cache_hit`/`cache_miss`, `tool_call`, `gate` lines at INFO.

**TypeScript (frontend/)** — Next.js 15 App Router, `strict: true`, Tailwind v4 + shadcn/ui (radix-nova, Phosphor icons) with the Paytm theme tokens in `app/globals.css` `(decision: UI-1, 31 Oct)`, see `frontend/DESIGN.md`, `useSWR` with `refreshInterval: 2000`, all API calls through `lib/api.ts` typed against `docs/02 §6.1`. Palette tokens: navy `#002E6E`, cyan `#00BAF2`, light `#F2F6FB`, text `#0B1F3A`. Large badges and numbers — it will be projected.

**Commits** — small and green, one per task: `T12: approvals service + override endpoint`. Fixes: `fix(gate): recompute compensation before auto_if`. Never commit `.env`; do commit `backend/.llm_cache/` and `backend/evals/report.*` once warmed.

## Tests that must exist and pass

- `tests/test_rbi_tat.py` — UPI 3 d → 200; UPI 1 d → 0; card 3 d → 0; card 7 d → 200; wallet 2 d → 100.
- `tests/test_policy_engine.py` — limits, recompute, holding reply on NEEDS_APPROVAL, mandate channel rule, settlement KYC rule, KYC fraud block.
- `tests/test_gate_adversarial.py` — unknown ref, dispute with reversal, low confidence, amount > txn, already-initiated refund.
- `tests/test_idempotency.py` — same decision twice → one refund.
- `tests/test_scenarios_mock.py` — 7 scenarios end in the expected status with the expected actions (`LLM_MODE=mock`).
- `tests/test_incident_fast_path.py` — matching ticket ends `INCIDENT_LINKED` with no `understanding` event.

## When stuck (pre-decided fallbacks, from docs/02 §13)

- LangGraph misbehaving → `AGENT_ENGINE=runner` (`agent/runner.py`), same nodes.
- Anthropic errors / offline → `LLM_MODE=replay`; still missing → `mock`.
- fastembed slow/missing → `EMBEDDINGS_ENABLED=false`; keyword retrieval, signature-only clustering.
- Slack 4xx/no webhook → in-app notifications only (always written).
- Postgres/Docker trouble → SQLite (default).
- A test is hard to satisfy → fix the code, not the assertion; if the spec is wrong, say so and stop.

## Incident signature (decision, 30 Oct)

`ingest` sets `tickets.candidate_txn_id` and `tickets.signature` from the ledger (`failed_payment_reversal|{issuer_bank}|{failure_reason}` for the most recent `DEBITED_NOT_CREDITED` txn) **before** any LLM call. The clusterer groups on that column. Never derive the signature from `understanding.ticket_type`.

## Canonical demo facts (must never drift)

- **D1:** ticket `tkt_48213` (scenario `d1_failed_upi`), customer `cust_riya`, txn `txn_48213_a` = ₹2,499 UPI to `mer_urban_kart`, issuer `HDFC`, failure `BANK_SWITCH_TIMEOUT`, status `DEBITED_NOT_CREDITED`, created **now − 3 days** → `days_late = 2` → compensation **₹200** → path `RESOLVE`, actions `initiate_reversal` (2,499) + `credit_compensation` (200) + `send_reply`, final status `RESOLVED`, `resolved_by = resolv`.
- **D3:** ticket `tkt_48219` (scenario `d3_over_limit`), customer `cust_arjun`, txn `txn_big` = ₹12,000 UPI `DEBITED_NOT_CREDITED` → reversal `NEEDS_APPROVAL` (auto limit ₹5,000), status `AWAITING_APPROVAL`, holding reply; approve → `RESOLVED` with `approval_decided` audited `decided_by`.
- **D2:** spike `issuer_bank=AXIS`, `failure_reason=UPI_SWITCH_DOWN`, `count=120`; incident threshold **10** within **60 min** window → one `OPEN` incident `"failed_payment_reversal|AXIS|UPI_SWITCH_DOWN"`, later tickets attach via fast path with **no LLM call**.
- Limits: auto refund ₹5,000; auto compensation ₹1,000. RBI TAT: UPI/IMPS/wallet T+1, card T+5, ₹100/day. Human-only: `dispute_chargeback`, `fraud_suspected`, `account_blocked`. Low-confidence threshold 0.6.
- Other scenarios: `hinglish_refund_status` (cust_riya, refund `rfd_riya_prev`), `merchant_settlement` (`mer_chai_point`, ON_HOLD_KYC → `retrigger_kyc`), `kyc_rejected` (`cust_meera`, ADDRESS_MISMATCH), `mandate_email` (`cust_meera`, `mnd_netflix`, channel email → approval), `dispute` (→ `ROUTED` to `risk`, no money action).
