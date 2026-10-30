# 03 · Tech stack + core component modules

> Companion to `02-ARCHITECTURE.md` (which wins on any conflict). This file answers three questions:
> *what do we build with*, *what does each module own*, and *what contracts keep the modules independent*.

---

## 1. Stack at a glance

| Layer | Choice | Why this one | Fallback |
|---|---|---|---|
| Language (backend) | **Python 3.11+** | Best LLM/agent library support; both of us know it; Claude Code is strongest here | — |
| Web framework | **FastAPI** + Uvicorn | Pydantic-native, auto OpenAPI docs at `/docs` (useful for the frontend person), async lifespan for workers | — |
| Data validation | **Pydantic v2** + pydantic-settings | Same models serve as LLM tool schemas (`model_json_schema()`), API bodies and config | — |
| Agent orchestration | **LangGraph** (`StateGraph`) | Named in the deck; explicit nodes + conditional edges map 1:1 to our state machine | `agent/runner.py` — same node functions run sequentially |
| LLM | **Anthropic Python SDK** (`claude-sonnet-5-5` decide, `claude-haiku-5-5` understand) + replay cache + rule mock | Tool-use gives strict structured output; cache makes the demo deterministic and offline-safe | `LLM_MODE=replay` → `mock` |
| ORM / DB | **SQLAlchemy 2.0**; **SQLite** (WAL) by default; **Postgres + pgvector** via Docker Compose optional | SQLite = zero infra on a venue laptop; Postgres is one env var away and keeps the deck claim honest | SQLite is already the fallback |
| Embeddings | **fastembed** (`BAAI/bge-small-en-v1.5`, 384-d, ONNX, no torch) | ~130 MB, CPU-only, fast install; used for past-ticket retrieval and secondary clustering | `EMBEDDINGS_ENABLED=false` → keyword retrieval, signature-only clustering |
| HTTP client | **httpx** | Sync + async, timeouts, used for mock Paytm, Slack, (real APIs later) | — |
| Policy rules | **PyYAML** + tiny expression evaluator (no `eval`) | Rules readable by non-engineers; judges can be shown the file | — |
| Background jobs | **asyncio tasks** in FastAPI lifespan | No broker, no extra process; three loops (queue, incidents, SLA) | — |
| Tests | **pytest** | Policy engine and gate tests are the thing judges will ask about | — |
| Frontend | **Next.js 15 (App Router) + TypeScript + Tailwind + SWR** | Named in the deck; `create-next-app` scaffolds in 2 min; SWR polling = live cockpit without websockets | Single-page cockpit (queue + drawer) |
| Notifications | **Slack incoming webhook** | One URL, one POST; visible "teammate" moment | In-app `notifications` table + panel (always written anyway) |
| Infra | **Makefile**; Docker Compose only for Postgres | `make dev` is the only command anyone should need | run the three commands by hand |
| Build tool | **Claude Code** driven by `CLAUDE.md` + `docs/` | We type specs, it types code; `06-IMPLEMENTATION-PLAN.md` is its task list | — |

## 2. What the deck says vs what the prototype does

Deck slide 6 ("Technology / tech stack used") lists the full stack. Where the prototype simplifies, keep the deck claims true at the *interface* level; use the one-liners below if a judge asks.

| Deck says | Prototype does | One-line answer for a judge |
|---|---|---|
| Postgres + pgvector | SQLite (WAL) by default; `docker-compose.yml` with `pgvector/pgvector:pg16`; same SQLAlchemy models; vectors stored as JSON + Python cosine | "Same models and migrations; Compose file for Postgres/pgvector is in the repo. We demo on SQLite so the laptop demo has zero infrastructure dependencies." |
| Redis for session state | No Redis; run state in `ticket_runs.state_json`, queue is a DB status (`NEW → PROCESSING`) | "Redis only matters once we scale to multiple worker processes; for one process the DB is the queue." |
| LangGraph plan → act → verify loop | LangGraph `StateGraph` (or `runner.py` with identical nodes) | "Yes — nodes are plain functions, LangGraph wires the conditional edges." |
| Freshdesk / Zendesk helpdesk | `HelpdeskAdapter` interface; `internal.py` (DB-backed) used in demo | "Helpdesk is an adapter interface; Freshdesk is a ~100-line adapter against the same interface — not where the risk is." |
| Paytm payments / refund / settlement / KYC APIs | Mock Paytm API with the same shapes, 50–200 ms latency, realistic errors (409/422) | "Mocked with realistic contracts; the client points at `PAYTM_BASE_URL`, so a sandbox is a config change." |
| Provider-agnostic LLM (Claude / Gemini / GPT / Paytm stack) | `LLMClient` for Anthropic only | "One class; swapping providers is swapping that class. The policy gate is what makes any model safe." |
| Slack / Teams nudges | Slack webhook, in-app fallback | "Slack today; Teams is another webhook." |
| Docker on AWS / GCP | Two local processes (`:8000`, `:3000`) | "Containerised, runs locally; cloud deploy is a day-2 task, not a demo task." |
| PII masking, DPDP-ready | Regex masking before every LLM call and in the UI | "Masked before the model sees it; raw text only in the DB." |

## 3. Core component modules


### 3.1 `backend/app/db/` — models & session
- **Responsibility:** SQLAlchemy 2.0 models for every table in 02 §5; engine/session factory; `create_all()` on startup; `reset()` helper.
- **Interface:** `SessionLocal()` context manager; `init_db()`, `reset_db()`; model classes `Ticket, TicketRun, AuditEvent, Approval, Incident, IncidentTicket, Notification, KbDoc, TicketEmbedding, ActionExecution`.
- **Depends on:** `config.py`.
- **Done when:** `pytest tests/test_idempotency.py` can create tables in a temp SQLite and insert a ticket; `DATABASE_URL` switch to Postgres works (optional check).

### 3.2 `backend/app/domain/` — enums & schemas
- **Responsibility:** the vocabulary everything else imports: `TicketType, Path, TicketStatus, Priority, GateOutcome, ActionName, Channel`; pydantic `Understanding, ProposedAction, Decision, GateResult, GateSummary, ContextBundle, RegulatoryClock, ActionResult, TicketDTO`.
- **Done when:** `Decision.model_json_schema()` is accepted by the Anthropic tool-use API (checked in the first live call).

### 3.3 `backend/app/policy/` — the gate
- **Responsibility:** `rules.yaml` loader; `engine.evaluate(decision, ctx, ticket, understanding) -> GateSummary`; `rbi_tat.regulatory_clock(txn, now) -> RegulatoryClock`; `pii.mask(text) -> (masked, entities)`.
- **Interface:**
  ```python
  def evaluate(decision: Decision, ctx: ContextBundle, ticket: TicketDTO, understanding: Understanding) -> GateSummary
  def regulatory_clock(txn: Transaction, now: datetime) -> RegulatoryClock
  def mask(text: str) -> tuple[str, list[PiiEntity]]
  ```
- **Depends on:** `domain/`, PyYAML.
- **Done when:** `tests/test_policy_engine.py`, `test_rbi_tat.py`, `test_gate_adversarial.py` pass: ₹2,499 UPI 3 days old → AUTO, compensation 200; ₹12,000 → NEEDS_APPROVAL; unknown `txn_id` → BLOCKED; `dispute_chargeback` → HUMAN_ONLY; mandate via email → NEEDS_APPROVAL; KYC `FRAUD_SUSPECTED` → blocked + route.

### 3.4 `backend/app/agent/` — the loop
- **Responsibility:** `state.py`, eight node functions, `graph.py` (LangGraph), `runner.py` (fallback), `tools.py` (ToolRegistry), `prompts/*.md`.
- **Interface:**
  ```python
  def run_ticket(ticket_id: str) -> AgentState            # agent/graph.py (or runner.py); creates TicketRun, audits, returns final state
  class ToolRegistry:                                      # agent/tools.py
      def register(self, name: str, fn: Callable[..., dict], schema: type[BaseModel], *, money_moving: bool = False) -> None
      def call(self, name: str, params: dict, *, ticket_id: str, run_id: str, actor: str = "resolv") -> ActionResult
      def spec_for_prompt(self) -> str
  ```
- **Depends on:** `policy/`, `services/context`, `services/audit`, `integrations/llm`, `integrations/paytm`.
- **Done when:** scenario `d1_failed_upi` runs end-to-end in `LLM_MODE=mock` (no network) and in `live`, producing the audit kinds listed in 02 §3.2.

### 3.5 `backend/app/services/` — business services
- **Responsibility:** `context.build_context(ticket)`, `tickets.create/list/get/transition/enqueue`, `audit.record`, `incidents.signature/cluster/attach_fast_path/notify`, `sla.minutes_to_breach/guard`, `approvals.create/decide`, `metrics.compute`, `demo.reset/seed/scenario/spike`.
- **Interface (key ones):**
  ```python
  def build_context(ticket: TicketDTO, *, run_id: str) -> ContextBundle
  def record(ticket_id: str, kind: str, payload: dict, *, actor: str = "resolv", run_id: str | None = None) -> AuditEvent
  def cluster() -> list[Incident]                       # called by worker every 15 s
  def attach_fast_path(ticket: TicketDTO) -> Incident | None
  def decide(approval_id: str, approve: bool, decided_by: str, note: str | None) -> tuple[Approval, Ticket]
  def compute(window_minutes: int = 240) -> MetricsDTO
  ```
- **Done when:** D1–D5 in 01 §2 work through the API (frontend not required to prove it — use `/docs`).

### 3.6 `backend/app/api/` — routers
- **Responsibility:** every endpoint in 02 §6.1, thin: validate → call service → return DTO. CORS for `http://localhost:3000`.
- **Done when:** `GET /api/health` returns `{ok: true, llm_mode, db, mock_paytm}` and `/docs` lists all routes.

### 3.7 `backend/app/workers/` — loops
- **Responsibility:** `scheduler.start(app)` creating three asyncio tasks: `process_queue` (1 s, concurrency `QUEUE_CONCURRENCY`), `cluster_incidents` (15 s), `sla_guard` (30 s). Each iteration runs the sync function in a thread; exceptions are logged and audited as `error`, never propagate.
- **Done when:** a `NEW` ticket is picked up within 1 s; killing the LLM key does not stop the loop.

### 3.8 `backend/app/integrations/` — adapters
- **Responsibility:** `paytm/client.py` (httpx, base URL from env, typed responses, raises `PaytmError(status, code)`), `helpdesk/base.py` + `internal.py`, `notify/slack.py` (+ `inapp.py` fallback), `llm/client.py` (`structured()`), `llm/cache.py`, `llm/mock.py`, `embeddings.py`.
- **Interface:**
  ```python
  class PaytmClient:
      def get_customer(self, id) -> CustomerProfile; def get_merchant(self, id) -> MerchantProfile
      def list_transactions(self, *, customer_id=None, merchant_id=None, since=None) -> list[Transaction]
      def get_transaction(self, id) -> Transaction; def get_refund(self, id) -> Refund
      def create_refund(self, *, txn_id, amount_inr, reason, idempotency_key) -> Refund
      def create_compensation(self, *, customer_id, amount_inr, reason, txn_id, idempotency_key) -> Compensation
      def list_settlements(self, *, merchant_id) -> list[Settlement]; def retrigger_settlement(self, id) -> Settlement
      def get_kyc(self, id) -> KycCase; def retrigger_kyc(self, id) -> KycCase
      def list_mandates(self, *, customer_id) -> list[Mandate]; def cancel_mandate(self, id) -> Mandate
      def notify(self, *, customer_id, channel, text) -> dict
  class LLMClient:
      def structured(self, *, system: str, user: str, schema: type[T], tool_name: str, model: str) -> T
  def notify(channel: Literal["slack","inapp"], target: str, text: str, *, ticket_id=None, incident_id=None) -> Notification
  def embed(texts: list[str]) -> list[list[float]]; def cosine(a, b) -> float
  ```
- **Done when:** `PaytmClient` round-trips every mock endpoint; `LLMClient.structured` returns a `Decision` in all three modes; Slack message arrives or the in-app row is written.

### 3.9 `backend/mock_paytm/` — the fake bank
- **Responsibility:** every endpoint in 02 §6.2; in-memory `store.py` with JSON snapshot; `scenarios.seed()` (01 §10) and `bank_outage(issuer_bank, count, minutes)`; simulated latency; refunds auto-progress `INITIATED → COMPLETED` after `MOCK_REFUND_SETTLE_SECONDS`.
- **Interface:** FastAPI sub-app `mock_paytm.main.app`, mounted in `app/main.py` at `/mock/paytm` (decision: mount, don't run separately — one process to start).
- **Done when:** `curl /mock/paytm/v1/transactions/txn_48213_a` shows the demo transaction; `POST /refunds` twice with the same `idempotency_key` returns the same refund; a second refund of the same txn returns 409.

### 3.10 `backend/evals/` — evidence
- **Responsibility:** `dataset.jsonl` (~60 rows, 01 FR-12), `run.py` (loads dataset, resets + seeds, runs each ticket via `run_ticket` in `LLM_MODE=replay`, compares to labels), `report.md`/`report.json`; `overrides.jsonl` append on human override.
- **Interface:** `python -m evals.run [--limit N] [--mode replay|mock]`; `GET /api/evals/report`.
- **Done when:** report shows per-class precision/recall/F1 for `path`, type accuracy, false-action rate, gate catch rate, and n.

### 3.11 `backend/tests/`
- `test_policy_engine.py`, `test_rbi_tat.py`, `test_gate_adversarial.py`, `test_idempotency.py` (same `(ticket_id, action, params)` executed twice → one `action_executions` row, one mock refund).

### 3.12 `frontend/` — cockpit
- **Responsibility:** five routes in 02 §12, components `KpiTile, TicketTable, Timeline, GateBadge, IncidentCard, DemoDrawer, Markdown`, `lib/api.ts` typed fetchers with SWR polling (2 s).
- **Done when:** D1–D5 can be *shown* from the browser alone, with the demo drawer driving reset/seed/scenario/spike; badges readable from 3 m.

## 4. Module contracts

### 4.1 Contract A — Mock Paytm API
Exactly 02 §6.2. Commit `backend/mock_paytm/schemas.py` (pydantic) first; `integrations/paytm/schemas.py` imports those schemas into `integrations/paytm/schemas.py` (decision: single source — `integrations/paytm/schemas.py` re-exports from `mock_paytm.schemas` until a real API exists).

### 4.2 Contract B — ToolRegistry
Read tools (context builder): `get_customer, get_merchant, list_transactions, get_transaction, get_refund, list_settlements, get_kyc, list_mandates, search_past_tickets, search_kb`.
Action tools (= `ActionName`): `initiate_reversal, credit_compensation, retrigger_settlement, retrigger_kyc, cancel_mandate, send_reply, notify_customer, create_internal_note`.
Every tool: `fn(**params) -> dict`; registry adds audit + idempotency for `money_moving=True`.

### 4.3 Contract C — Resolv REST API
Exactly 02 §6.1. Until the backend is up, the frontend runs on fixtures:

`frontend/fixtures/tickets.json` (shape of `GET /api/tickets`):
```json
{"items":[{"id":"tkt_0001","channel":"in_app_chat","customer_id":"cust_riya","masked_text":"Paid ₹2,499 by UPI to a merchant on 25 Oct. Money got debited but the order shows failed...","language":"en","status":"RESOLVED","ticket_type":"failed_payment_reversal","priority":"P1","path":"RESOLVE","assigned_team":null,"incident_id":null,"handling_mode":"agent","sla_due_at":"2026-10-31T06:15:00Z","created_at":"2026-10-31T06:00:00Z","first_response_at":"2026-10-31T06:01:10Z","resolved_at":"2026-10-31T06:01:12Z","resolved_by":"resolv"}],"total":1}
```
`frontend/fixtures/ticket_detail.json` (shape of `GET /api/tickets/{id}`): `{ticket, run:{state:{understanding, decision, gate, executed, outcome}}, timeline:[{id, ts, actor, kind, payload_json}], approvals:[], incident:null}` — include one event of each kind from 02 §5 so the `Timeline` component is built against every case.
`frontend/fixtures/metrics.json`: `{"auto_resolution_rate":0.55,"avg_first_response_sec":68,"avg_resolution_sec":540,"open":12,"awaiting_approval":1,"incidents_open":1,"tat_breaches_prevented":3,"by_type":{"failed_payment_reversal":{"total":40,"auto":28}},"window_minutes":240}`.
Switch with `NEXT_PUBLIC_USE_FIXTURES=1`; `lib/api.ts` returns fixtures when set.

### 4.4 Contract D — Audit event payloads
| kind | payload_json |
|---|---|
| `understanding` | the `Understanding` object |
| `decision` | the `Decision` object |
| `gate` | `GateSummary {ticket_outcome, results:[{action, outcome, reasons[]}]}` |
| `tool_call` / `tool_result` | `{name, params}` / `{name, ok, result | error, ms}` |
| `reply_sent` | `{channel, language, text}` |
| `handoff` | `{outcome, team, summary, next_action, approvals:[ids]}` |
| `override` / `approval_decided` | `{by, note, from, to}` / `{by, approve, note, action}` |
| `incident_linked` / `incident_fast_path` | `{incident_id, signature, via}` |

## 5. Dependencies

### 5.1 Backend (`backend/pyproject.toml` or `requirements.txt`)
```
fastapi>=0.115
uvicorn[standard]>=0.30
pydantic>=2.7
pydantic-settings>=2.3
sqlalchemy>=2.0
httpx>=0.27
pyyaml>=6.0
anthropic            # latest — SDK moves fast; check `client.models.list()` before building
langgraph            # latest
fastembed            # latest
anyio>=4
python-multipart
pytest>=8
pytest-asyncio
# optional (Postgres)
psycopg[binary]      # latest
pgvector             # latest
```
(decision: use `uv` if installed — `uv venv && uv pip install -r requirements.txt` — else plain `python -m venv .venv && pip install -r requirements.txt`.)

### 5.2 Frontend (`frontend/package.json`)
```
next@15, react@19, react-dom@19, typescript@5, tailwindcss (version chosen by create-next-app), swr@2, react-markdown, clsx
dev: @types/node, @types/react, eslint, eslint-config-next
```
Scaffold with `npx create-next-app@latest frontend --typescript --tailwind --app --eslint --no-src-dir --import-alias "@/*"` and add `swr react-markdown clsx`.

## 6. Make targets (root `Makefile`)
| Target | Does |
|---|---|
| `make install` | backend venv + deps; `npm install` in frontend; fastembed model pre-download |
| `make backend` | `uvicorn app.main:app --reload --port 8000` (cwd `backend/`) |
| `make frontend` | `npm run dev` (cwd `frontend/`) |
| `make dev` | both, in parallel (`make -j2 backend frontend`) |
| `make reset` / `make seed` | `curl -X POST :8000/api/demo/reset` / `/seed` |
| `make test` | `pytest -q` in `backend/` |
| `make evals` | `python -m evals.run` in `backend/` |
| `make warm-cache` | `scripts/warm_cache.sh` — all scenarios + evals once in `LLM_MODE=live` |
| `make pg` | `docker compose up -d` (optional) |
