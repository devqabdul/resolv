# 02 · Architecture — Resolv prototype

> Source of truth for names, modules, data model, API contracts and the agent state machine.
> If another doc disagrees with this one, this one wins. Keep it updated when you change a contract.

---

## 1. System overview

```
                 ┌──────────────────────────────────────────────────────────────────┐
                 │                         COCKPIT (Next.js)                         │
                 │  Queue + KPIs │ Ticket timeline │ Approvals │ Incidents │ Evidence │
                 └───────────────┬───────────────────────────────────────────────────┘
                                 │ REST (poll every 2 s)
┌────────────────────────────────▼─────────────────────────────────────────────────┐
│                           RESOLV BACKEND (FastAPI, :8000)                         │
│                                                                                   │
│  api/            tickets · approvals · incidents · metrics · audit · demo         │
│  workers/        queue processor · incident clusterer · SLA guard (asyncio tasks) │
│  agent/          ingest → understand → decide → gate → act → verify → close|handoff│
│  policy/         rules.yaml · engine.py (deterministic) · rbi_tat.py              │
│  services/       context · tickets · incidents · approvals · audit · metrics·demo │
│  integrations/   paytm client · helpdesk adapter · notify (slack/in-app) · llm    │
│  db/             SQLAlchemy models · session · SQLite (default) / Postgres        │
└───────────┬───────────────────────────────┬──────────────────────┬────────────────┘
            │ HTTP                          │ HTTPS                │ HTTPS (optional)
┌───────────▼───────────────┐   ┌───────────▼──────────┐   ┌───────▼───────────────┐
│ MOCK PAYTM API            │   │ Anthropic API        │   │ Slack incoming webhook│
│ (FastAPI, mounted at      │   │ + replay cache       │   │ (fallback: in-app     │
│  /mock/paytm or :8001)    │   │ + rule-based mock    │   │  notifications table) │
└───────────────────────────┘   └──────────────────────┘   └───────────────────────┘
```

**Design principle (say it in the pitch):** *the LLM proposes, the policy gate disposes.* The model never calls a money-moving API directly. It emits a structured `Decision`; code validates every proposed action against `rules.yaml` and the live ledger state; only then does the tool registry execute.

## 2. Repository layout

```
resolv/
├── CLAUDE.md                     # instructions for the coding agent (see 06 + CLAUDE.md)
├── README.md
├── Makefile                      # make dev / make seed / make evals / make test
├── docker-compose.yml            # optional: postgres (pgvector/pgvector:pg16)
├── .env.example
├── docs/                         # these spec files
├── backend/
│   ├── pyproject.toml            # or requirements.txt; Python 3.11+
│   ├── app/
│   │   ├── main.py               # FastAPI app factory, lifespan (starts workers), mounts routers + mock
│   │   ├── config.py             # pydantic-settings: DATABASE_URL, LLM_MODE, ANTHROPIC_API_KEY, models, PAYTM_BASE_URL, SLACK_WEBHOOK_URL, INCIDENT_THRESHOLD, ...
│   │   ├── domain/
│   │   │   ├── enums.py          # TicketType, Path, TicketStatus, Priority, GateOutcome, ActionName, Channel
│   │   │   └── schemas.py        # pydantic: Understanding, Decision, ProposedAction, GateResult, ContextBundle, ...
│   │   ├── db/
│   │   │   ├── models.py         # SQLAlchemy 2.0 models (see §5)
│   │   │   └── session.py        # engine/session; create_all on startup; reset helper
│   │   ├── agent/
│   │   │   ├── state.py          # AgentState (TypedDict) carried through the graph
│   │   │   ├── graph.py          # LangGraph StateGraph wiring of nodes + conditional edges
│   │   │   ├── runner.py         # plain-Python fallback runner with the same nodes (no LangGraph)
│   │   │   ├── nodes/            # ingest.py understand.py decide.py gate.py act.py verify.py close.py handoff.py
│   │   │   ├── prompts/          # understand.md decide.md incident_notice.md reply_style.md
│   │   │   └── tools.py          # ToolRegistry: name → callable + schema; wraps integrations; audits every call
│   │   ├── policy/
│   │   │   ├── rules.yaml        # the policy (see §7)
│   │   │   ├── engine.py         # evaluate(decision, context) -> list[GateResult], ticket_outcome
│   │   │   ├── rbi_tat.py        # TAT deadline, days_late, compensation_due
│   │   │   └── pii.py            # mask(text) -> masked_text, found_entities
│   │   ├── integrations/
│   │   │   ├── paytm/client.py   # httpx client for mock/real Paytm API (base URL from env)
│   │   │   ├── paytm/schemas.py
│   │   │   ├── helpdesk/base.py  # HelpdeskAdapter interface (create/update/reply)
│   │   │   ├── helpdesk/internal.py  # DB-backed adapter used in the demo
│   │   │   ├── notify/slack.py   # incoming webhook; falls back to in-app
│   │   │   ├── notify/inapp.py   # notifications table
│   │   │   ├── llm/client.py     # LLMClient.structured(prompt, schema) -> pydantic; Anthropic SDK
│   │   │   ├── llm/cache.py      # replay cache (sqlite/json keyed by sha256 of request)
│   │   │   ├── llm/mock.py       # rule-based fallback producing Understanding/Decision without a model
│   │   │   └── embeddings.py     # fastembed wrapper; cosine similarity helpers (JSON-stored vectors)
│   │   ├── services/
│   │   │   ├── context.py        # build_context(ticket) -> ContextBundle (all fetches audited)
│   │   │   ├── tickets.py        # create/list/get/transition; enqueue run
│   │   │   ├── incidents.py      # signature(), cluster(), attach_fast_path(), notify()
│   │   │   ├── sla.py            # minutes_to_breach(), guard()
│   │   │   ├── approvals.py      # create/decide → executes via act/verify
│   │   │   ├── audit.py          # record(ticket_id, kind, payload, actor)
│   │   │   ├── metrics.py        # compute() for /api/metrics
│   │   │   └── demo.py           # reset/seed/scenario/spike
│   │   ├── api/                  # FastAPI routers: tickets.py approvals.py incidents.py metrics.py audit.py demo.py
│   │   └── workers/
│   │       └── scheduler.py      # asyncio loops: process_queue (every 1 s), cluster_incidents (15 s), sla_guard (30 s)
│   ├── mock_paytm/
│   │   ├── main.py               # FastAPI sub-app; mounted at /mock/paytm (or run standalone on :8001)
│   │   ├── store.py              # in-memory dicts + JSON snapshot; reset/seed
│   │   ├── scenarios.py          # canonical demo data + bank_outage(issuer, n)
│   │   └── routers/              # customers merchants transactions refunds compensations settlements kyc mandates notifications admin
│   ├── evals/
│   │   ├── dataset.jsonl         # ~60 labelled tickets
│   │   ├── overrides.jsonl       # appended by human overrides at runtime
│   │   ├── run.py                # python -m evals.run → report.md + report.json
│   │   └── report.md             # generated; committed before the pitch
│   └── tests/
│       ├── test_policy_engine.py
│       ├── test_rbi_tat.py
│       ├── test_gate_adversarial.py
│       ├── test_idempotency.py
│       ├── test_scenarios_mock.py
│       └── test_incident_fast_path.py
├── frontend/                     # Next.js 15 (App Router) + TypeScript + Tailwind
│   ├── app/
│   │   ├── layout.tsx            # nav + KPI strip
│   │   ├── page.tsx              # Queue
│   │   ├── tickets/[id]/page.tsx # Ticket timeline + override/approve
│   │   ├── approvals/page.tsx
│   │   ├── incidents/page.tsx
│   │   └── evidence/page.tsx
│   ├── components/               # KpiTile, TicketTable, Timeline, GateBadge, IncidentCard, DemoDrawer, Markdown
│   └── lib/api.ts                # typed fetchers; NEXT_PUBLIC_API_BASE
└── scripts/
    ├── demo_reset.sh             # curl reset + seed
    └── warm_cache.sh             # runs all scenarios + evals once in live mode to fill the replay cache
```

## 3. Agent loop (state machine)

Implemented as a **LangGraph `StateGraph`** (`agent/graph.py`). Every node is a plain function `(state: AgentState) -> AgentState` in `agent/nodes/`, so `agent/runner.py` can run the same nodes sequentially without LangGraph if the library causes friction (fallback: `runner.py`, selected with `AGENT_ENGINE=runner`).

```
            ┌────────┐    ┌────────────┐    ┌────────┐    ┌──────┐
 ticket ───►│ ingest │───►│ understand │───►│ decide │───►│ gate │
            └───┬────┘    └────────────┘    └────────┘    └──┬───┘
                │ matches active incident signature            │
                ▼                                              │ outcome
        ┌───────────────┐              ┌──────────┐  AUTO      │
        │ incident fast │              │   act    │◄───────────┤
        │ path (no LLM) │              └────┬─────┘            │ NEEDS_APPROVAL / HUMAN_ONLY / low confidence
        └───────────────┘                   ▼                  ▼
                                       ┌──────────┐      ┌──────────┐
                                       │  verify  │─fail►│ handoff  │
                                       └────┬─────┘      └──────────┘
                                            │ ok
                                            ▼
                                       ┌──────────┐
                                       │  close   │
                                       └──────────┘
```

### 3.1 `AgentState` (`agent/state.py`)

```python
class AgentState(TypedDict, total=False):
    ticket_id: str
    run_id: str
    ticket: TicketDTO                 # masked text, channel, ids
    context: ContextBundle            # §4
    understanding: Understanding
    decision: Decision
    gate: GateSummary                 # ticket_outcome + per-action GateResult
    executed: list[ActionResult]      # tool results
    verify_ok: bool
    outcome: Literal["RESOLVED","ROUTED","ESCALATED","AWAITING_APPROVAL","INCIDENT_LINKED","FAILED"]
    errors: list[str]
    low_confidence: bool              # (decision: T7) set by understand; threshold = rules.yaml low_confidence_threshold
```

### 3.2 Node contracts

| Node | Input → Output | LLM? | Audit event kinds |
|------|----------------|------|-------------------|
| `ingest` | raw ticket → masked text, language hint, incident check | no | `ingest`, `pii_masked`, `incident_fast_path` |
| `understand` | masked text + context → `Understanding` | **yes** (haiku) | `tool_call`×n (context fetches), `understanding` |
| `decide` | understanding + context + policy summary → `Decision` | **yes** (sonnet) | `decision` |
| `gate` | decision + context → `GateSummary` | no | `gate` |
| `act` | AUTO_EXECUTE actions → `ActionResult[]` | no | `tool_call`, `tool_result` per action |
| `verify` | re-read mock API state | no | `verify` |
| `close` | send reply, mark resolved | no (reply text already drafted) | `reply_sent`, `status_change` |
| `handoff` | assign team, create approvals, nudge | no | `handoff`, `approval_created`, `notification` |

Conditional edges after `gate`:
- `gate.ticket_outcome == AUTO_EXECUTE and decision.path == RESOLVE` → `act`
- else → `handoff` (with `outcome` = `AWAITING_APPROVAL` if any `NEEDS_APPROVAL`, `ESCALATED` if path ESCALATE, else `ROUTED`)

After `verify`: `verify_ok` → `close`, else `handoff` with `errors`. The single retry of a failed action happens **inside** the `verify` node (re-invokes the tool with the same idempotency key), which keeps the graph acyclic. (decision: see 04 §LangGraph.) `AGENT_ENGINE=langgraph|runner` selects the LangGraph graph or the plain sequential runner.

### 3.3 LLM contracts (structured outputs via Anthropic tool-use)

`Understanding` (schema given to the model as a tool `record_understanding`):
```json
{
  "ticket_type": "failed_payment_reversal | refund_status | settlement_delay | kyc_resubmission | mandate_cancellation | dispute_chargeback | fraud_suspected | account_blocked | other",
  "confidence": 0.0,
  "entities": {"txn_id": "txn_...|null", "refund_id": null, "settlement_id": null, "mandate_id": null, "amount_inr": 2499, "txn_date": "2026-10-25", "merchant_name": "Urban Kart", "issuer_bank": "HDFC"},
  "sentiment": "frustrated | neutral | calm | angry",
  "language": "en | hi | hi-en",
  "is_repeat_issue": true,
  "summary_for_agent": "one or two sentences"
}
```
Rules in the prompt: pick `txn_id` **only** from the transactions listed in the context (ids are provided); if the customer's description matches none, leave `null` and lower confidence.

`Decision` (tool `record_decision`):
```json
{
  "path": "RESOLVE | ROUTE | ESCALATE",
  "priority": "P1 | P2 | P3",
  "proposed_actions": [
    {"name": "initiate_reversal", "params": {"txn_id": "txn_48213_a", "amount_inr": 2499, "reason": "DEBITED_NOT_CREDITED past RBI TAT"}, "rationale": "..."},
    {"name": "credit_compensation", "params": {"customer_id": "cust_riya", "amount_inr": 200, "txn_id": "txn_48213_a", "reason": "RBI TAT: 2 days late x ₹100"}, "rationale": "..."},
    {"name": "send_reply", "params": {"channel": "in_app_chat", "language": "en"}, "rationale": "..."}
  ],
  "customer_reply_draft": "Hi Riya, ...",
  "agent_summary": "...",
  "next_action_for_human": null,
  "route_to_team": null,
  "reasoning": "short chain of facts → rule → action"
}
```
The prompt includes a **policy summary** (limits, TAT rule, human-only categories) and the **computed regulatory clock** from `rbi_tat.py` so the model proposes the right compensation — but the gate recomputes it and overrides the amount if the model is wrong (audited as `gate_adjusted_amount`).

Action names (`domain/enums.ActionName`): `initiate_reversal`, `credit_compensation`, `retrigger_settlement`, `retrigger_kyc`, `cancel_mandate`, `send_reply`, `notify_customer`, `create_internal_note`.

## 4. Context builder (`services/context.py`)

```python
class ContextBundle(BaseModel):
    customer: CustomerProfile | None
    merchant: MerchantProfile | None
    transactions: list[Transaction]        # last 10 in 30 days; each has status, issuer_bank, failure_reason, refund_status
    refunds: list[Refund]
    settlements: list[Settlement]
    kyc: KycCase | None
    mandates: list[Mandate]
    past_tickets: list[PastTicket]         # last 3 for this customer/merchant (+ top-3 similar by embedding if enabled)
    kb_snippets: list[KbSnippet]           # top-3 policy/help-centre snippets
    regulatory_clock: RegulatoryClock | None  # for the most likely txn: days_since_txn, tat_deadline, days_late, compensation_due_inr
    policy_summary: str                    # rendered from rules.yaml for the prompt
```
Candidate transaction selection: if the text mentions an amount/date/merchant, pre-rank transactions by those; the LLM confirms. `RegulatoryClock` is computed for the top candidate and recomputed in the gate for the chosen `txn_id`.

## 5. Data model (SQLAlchemy 2.0; SQLite default, Postgres optional)

| Table | Key columns |
|-------|-------------|
| `tickets` | `id (tkt_…)`, `channel`, `customer_id?`, `merchant_id?`, `raw_text`, `masked_text`, `language`, `status` (`NEW, PROCESSING, RESOLVED, ROUTED, ESCALATED, AWAITING_APPROVAL, INCIDENT_LINKED, CLOSED, FAILED`), `ticket_type?`, `priority?`, `path?`, `assigned_team?` (`payments_ops|merchant_ops|risk|l1_support`), `incident_id?`, `handling_mode` (`agent|incident|human`), `candidate_txn_id?` and `signature?` (set at ingest for clustering — decision), `sla_due_at`, `created_at`, `first_response_at?`, `resolved_at?`, `resolved_by?` (`resolv|human:<name>`). Scenario tickets use fixed ids: `tkt_48213` (D1), `tkt_48219` (D3) (decision). `INCIDENT_LINKED` counts as auto-handled in `auto_resolution_rate` (decision). |
| `ticket_runs` | `id (run_…)`, `ticket_id`, `started_at`, `finished_at?`, `outcome?`, `state_json` (final AgentState, for the UI) |
| `audit_events` | `id`, `ticket_id`, `run_id?`, `ts`, `actor` (`resolv|system|human:<name>`), `kind` (`ingest, pii_masked, tool_call, tool_result, understanding, decision, gate, gate_adjusted_amount, verify, reply_sent, status_change, handoff, approval_created, approval_decided, override, notification, incident_linked, incident_fast_path, error`), `payload_json` |
| `approvals` | `id (apr_…)`, `ticket_id`, `action_json`, `reasons_json`, `status` (`PENDING, APPROVED, REJECTED`), `requested_at`, `decided_by?`, `decided_at?`, `note?` |
| `incidents` | `id (inc_…)`, `signature` (`"failed_payment_reversal|AXIS|UPI_SWITCH_DOWN"`), `title`, `status` (`OPEN, COMMUNICATED, RESOLVED`), `ticket_count`, `first_seen`, `last_seen`, `owner_team`, `proactive_notice_draft`, `internal_summary`, `notified_at?` |
| `incident_tickets` | `incident_id`, `ticket_id`, `attached_at`, `via` (`cluster|fast_path`) |
| `notifications` | `id`, `ts`, `channel` (`slack|inapp`), `target` (`#ops`, `agent:priya`), `text`, `delivered` (bool), `ticket_id?`, `incident_id?` |
| `kb_docs` | `id`, `title`, `content`, `tags`, `embedding_json?` |
| `ticket_embeddings` | `ticket_id`, `embedding_json` (384 floats) |
| `action_executions` | `idempotency_key` (PK: `sha256(ticket_id+name+params)`), `ticket_id`, `name`, `params_json`, `result_json`, `executed_at`, `actor` |

Mock Paytm keeps its own in-memory store (`mock_paytm/store.py`) for customers, merchants, transactions, refunds, compensations, settlements, kyc_cases, mandates, notifications. It is **not** shared with the Resolv DB — Resolv only sees it through HTTP, exactly like a real integration.

## 6. API contracts

Base: `http://localhost:8000`. All JSON. Ids are strings. Times ISO-8601 UTC; "now" always comes from `app/util/clock.py now()`, which honours `DEMO_NOW_OVERRIDE` (decision). Router placement (decision): `/api/health`, `/api/metrics`, `/api/evals/report` live in `api/metrics.py`; `/api/notifications` in `api/audit.py`.

### 6.1 Resolv API
| Method & path | Body / query | Returns |
|---|---|---|
| `POST /api/tickets` | `{channel, text, customer_id?, merchant_id?, metadata?}` | `Ticket` (status `NEW`), run enqueued |
| `GET /api/tickets` | `?status=&type=&incident_id=&limit=50&since=` | `{items: Ticket[], total}` ordered by priority then created_at |
| `GET /api/tickets/{id}` | — | `{ticket, run: {state}, timeline: AuditEvent[], approvals: Approval[], incident?: IncidentSummary}` |
| `POST /api/tickets/{id}/run` | — | re-process (new run) |
| `POST /api/tickets/{id}/override` | `{path, note, decided_by, actions?: ProposedAction[]}` | updated ticket; override audited; eval example appended |
| `GET /api/approvals` | `?status=PENDING` | `Approval[]` with ticket summary + reasoning |
| `POST /api/approvals/{id}/decide` | `{approve: bool, note?, decided_by}` | `{approval, ticket}`; on approve → act+verify+close path |
| `GET /api/incidents` | `?status=` | `Incident[]` |
| `GET /api/incidents/{id}` | — | `{incident, tickets: TicketSummary[], notifications}` |
| `POST /api/incidents/{id}/notify` | — | sends proactive notice to linked customers; `status=COMMUNICATED` |
| `GET /api/metrics` | `?window_minutes=240` | see FR-11 |
| `GET /api/audit` | `?ticket_id=&limit=` | `AuditEvent[]` |
| `GET /api/notifications` | `?limit=` | `Notification[]` (in-app fallback panel) |
| `GET /api/evals/report` | — | `{generated_at, markdown, json}` (reads `evals/report.*`) |
| `POST /api/demo/reset` | — | wipes Resolv DB + mock store |
| `POST /api/demo/seed` | — | loads canonical data (01 §10) + KB |
| `POST /api/demo/ticket/{scenario}` | — | creates the named scenario ticket |
| `POST /api/demo/spike` | `{issuer_bank: "AXIS", count: 120, minutes: 20}` | generates transactions + tickets |
| `GET /api/health` | — | `{ok, llm_mode, db, mock_paytm}` |

### 6.2 Mock Paytm API (`/mock/paytm/v1`, or standalone `:8001/v1`)
| Method & path | Notes |
|---|---|
| `GET /customers/{id}` | profile: name, tier, since, language, masked phone |
| `GET /merchants/{id}` | profile: name, kyc_status, settlement_cycle |
| `GET /transactions?customer_id=&merchant_id=&since=` | list; fields: `id, customer_id, merchant_id, amount_inr, method (upi|card|wallet|imps), status (SUCCESS|FAILED|DEBITED_NOT_CREDITED|PENDING), issuer_bank, failure_reason, created_at, refund_status (NONE|INITIATED|COMPLETED|FAILED), refund_id?` |
| `GET /transactions/{id}` | one |
| `POST /refunds` | `{txn_id, amount_inr, reason, idempotency_key}` → `{refund_id, arn, status: INITIATED, eta}`; 409 if already refunded; 422 if txn not eligible; 400 if amount > txn amount |
| `GET /refunds/{id}` | status progresses `INITIATED → COMPLETED` after `MOCK_REFUND_SETTLE_SECONDS` (default 20) |
| `POST /compensations` | `{customer_id, amount_inr, reason, txn_id, idempotency_key}` → `{compensation_id, status: CREDITED}` |
| `GET /settlements?merchant_id=` | `id, merchant_id, amount_inr, status (PROCESSING|SETTLED|ON_HOLD_KYC|FAILED), expected_at, reason` |
| `POST /settlements/{id}/retrigger` | → `{status: PROCESSING, expected_at}`; 422 if merchant KYC not VERIFIED |
| `GET /kyc/{customer_or_merchant_id}` | `status (VERIFIED|PENDING|REJECTED), rejection_reason?, resubmission_link?` |
| `POST /kyc/{id}/retrigger` | → `{status: PENDING, resubmission_link}` |
| `GET /mandates?customer_id=` | `id, merchant_name, amount_inr, frequency, status (ACTIVE|CANCELLED)` |
| `POST /mandates/{id}/cancel` | → `{status: CANCELLED, effective_at}` |
| `POST /notifications` | `{customer_id, channel, text}` → `{delivered: true}`; stored for the UI |
| `POST /admin/reset`, `POST /admin/seed`, `POST /admin/scenarios/bank_outage {issuer_bank, count, minutes}` | demo plumbing |

All mock endpoints add 50–200 ms simulated latency (`MOCK_LATENCY_MS`) and return realistic ids (`txn_…`, `rfd_…`, `arn_…`).

## 7. Policy gate

### 7.1 `policy/rules.yaml` (initial content — copy as-is)
```yaml
version: 1
currency: INR
limits:
  auto_refund_max_inr: 5000
  auto_compensation_max_inr: 1000
  approval_queue_sla_minutes: 30
rbi_tat:                       # RBI harmonised TAT for failed transactions (Sept 2019 circular)
  upi:      { auto_reversal_days: 1, compensation_per_day_inr: 100 }
  imps:     { auto_reversal_days: 1, compensation_per_day_inr: 100 }
  wallet:   { auto_reversal_days: 1, compensation_per_day_inr: 100 }
  card:     { auto_reversal_days: 5, compensation_per_day_inr: 100 }
human_only_ticket_types: [dispute_chargeback, fraud_suspected, account_blocked]
low_confidence_threshold: 0.6   # below this the gate forces ROUTE
actions:
  initiate_reversal:
    money_moving: true
    requires:
      - txn.exists
      - txn.status == DEBITED_NOT_CREDITED
      - txn.refund_status in [NONE, FAILED]
      - params.amount_inr <= txn.amount_inr
    auto_if: params.amount_inr <= limits.auto_refund_max_inr
  credit_compensation:
    money_moving: true
    requires:
      - txn.exists
      - clock.days_late > 0
    recompute: params.amount_inr = clock.compensation_due_inr   # gate overrides LLM arithmetic
    auto_if: params.amount_inr <= limits.auto_compensation_max_inr
  retrigger_settlement:
    money_moving: false
    requires: [settlement.exists, settlement.status in [FAILED, ON_HOLD_KYC]]
    auto_if: merchant.kyc_status == VERIFIED
  retrigger_kyc:
    money_moving: false
    requires: [kyc.exists, kyc.status in [REJECTED, PENDING]]
    auto: true
    block_if: kyc.rejection_reason in [FRAUD_SUSPECTED, SANCTIONS_HIT]   # route instead, never explain
  cancel_mandate:
    money_moving: false
    requires: [mandate.exists, mandate.status == ACTIVE]
    auto_if: ticket.channel in [in_app_chat, merchant_portal]
  send_reply:      { money_moving: false, auto: true }
  notify_customer: { money_moving: false, auto: true }
  create_internal_note: { money_moving: false, auto: true }
sla:
  first_response_minutes: 15
  resolution_hours: { P1: 4, P2: 24, P3: 72 }
  nudge_before_breach_minutes: 15
pii:
  mask: [phone, email, account_number, upi_vpa, card_number, aadhaar, pan]
incidents:
  window_minutes: 60
  threshold: 10
  signature_fields: [ticket_type, issuer_bank_or_merchant_id, failure_reason]
```

### 7.2 Engine semantics (`policy/engine.py`)
```python
def evaluate(decision: Decision, ctx: ContextBundle, ticket: TicketDTO, understanding: Understanding) -> GateSummary
```
1. Ticket-level: if `understanding.ticket_type in human_only_ticket_types` → `HUMAN_ONLY` (all actions except `create_internal_note` dropped). If `confidence < threshold` and path is `RESOLVE` → force `ROUTE`.
2. Per action: resolve object references (`txn`, `settlement`, `kyc`, `mandate`) **from the ContextBundle only** — unknown id ⇒ `BLOCKED: unknown_reference`. Evaluate `requires` (tiny expression evaluator over dotted paths; no `eval()`), apply `recompute`, `block_if`, then `auto`/`auto_if` → `AUTO_EXECUTE` else `NEEDS_APPROVAL`.
3. Ticket outcome: `AUTO_EXECUTE` if all remaining actions auto; `NEEDS_APPROVAL` if any needs approval (auto ones still execute, except `send_reply`, which is replaced by a holding reply); `HUMAN_ONLY` as above.
4. Every result carries human-readable `reasons[]` ("amount 12,000 > auto limit 5,000") — these are shown in the cockpit and in Slack nudges.

### 7.3 `policy/rbi_tat.py`
```python
def regulatory_clock(txn, now) -> RegulatoryClock:
    rule = rules.rbi_tat[txn.method]
    days_since = (now - txn.created_at).days
    days_late = max(0, days_since - rule.auto_reversal_days)
    return RegulatoryClock(days_since_txn=days_since, tat_deadline=txn.created_at + rule.auto_reversal_days days,
                           days_late=days_late, compensation_due_inr=days_late * rule.compensation_per_day_inr)
```
Demo check: txn 3 days old, UPI → `days_late = 2`, `compensation_due_inr = 200`. **Unit-tested.**

## 8. Incident clustering (`services/incidents.py`)

```
every 15 s:
  tickets = open tickets created in last `window_minutes` whose `signature` column is set (at ingest, see below)
  groups  = group_by(ticket.signature)    # "<type>|<issuer_bank or merchant_id>|<failure_reason>", derived from the candidate txn, not from the LLM
  for sig, items in groups:
      if len(items) >= threshold:
          inc = get_or_create_incident(sig)   # title e.g. "UPI failures via AXIS (UPI_SWITCH_DOWN)"
          attach(items not yet attached, via="cluster"); inc.ticket_count = ...
          if newly created:
              draft proactive notice + internal summary (LLM, cached) ; notify Slack #ops ; audit each ticket `incident_linked`
```
**Fast path at ingest** (`agent/nodes/ingest.py`): if an `OPEN` incident exists whose signature matches the ticket's best-candidate transaction (same issuer bank + failure reason, same type keywords) → attach `via="fast_path"`, send holding reply from the incident template, status `INCIDENT_LINKED`, **no LLM call**. This is how 120 tickets are absorbed in seconds and what we say when asked "how does this scale during an outage?".

**Signature is set at ingest, with no LLM call** (decision, 30 Oct): `ingest` fetches the last transactions for `customer_id`, picks the most recent `DEBITED_NOT_CREDITED`, stores it as `tickets.candidate_txn_id`, and writes `tickets.signature = f"failed_payment_reversal|{txn.issuer_bank}|{txn.failure_reason}"` (merchant tickets: `settlement_delay|{merchant_id}|{settlement.reason}` from the most recent non-SETTLED settlement; otherwise `NULL`). The type prefix is inferred from the ledger state, not from `understanding.ticket_type`, so the clusterer can fire on the first 10 spike tickets *before* any of them finishes `understand`. If `understand` later disagrees with the inferred type, the ticket keeps its signature; the incident is about the ledger pattern, not the wording. Spike tickets always carry `customer_id`.

Optional secondary signal: embedding cosine ≥ 0.85 between the ticket text and the incident's centroid, used only to attach tickets whose transaction lookup failed.

## 9. SLA guard (`services/sla.py`)

Every 30 s: for tickets in `NEW, PROCESSING, ROUTED, ESCALATED, AWAITING_APPROVAL`: `due = min(sla_due_at, regulatory_clock.tat_deadline if any)`; if `due − now < nudge_before_breach_minutes` and not yet nudged → `notify(slack, "#support-leads", "<ticket> breaches in 12 min — <reasons> — <cockpit link>")`, raise priority to `P1`, audit `notification`. Metrics counts `tat_breaches_prevented` = tickets resolved by Resolv whose `days_late` would have grown by ≥ 1 if left to the human queue (simple proxy: resolved with `compensation_due_inr > 0` within the session).

## 10. LLM layer (`integrations/llm/`)

- `LLM_MODE = live | replay | mock`.
  - `live`: Anthropic SDK (`anthropic` Python), models from env (`LLM_MODEL_DECIDE=claude-sonnet-5-5`, `LLM_MODEL_UNDERSTAND=claude-haiku-5-5`), `temperature=0`, tool-use with the pydantic JSON schema, `max_tokens=1500`. Every response is written to the cache.
  - `replay`: cache hit → return stored response; miss → live (then cached). **Pitch runs in this mode after `scripts/warm_cache.sh`.**
  - `mock`: `llm/mock.py` — keyword rules produce a plausible `Understanding`/`Decision` for the 7 scenarios + spike variants. Last-resort fallback; also used in CI/tests.
- Cache key: `sha256(mode-independent payload: model + system + messages + tool schema)`; store in `backend/.llm_cache/*.json` (committed to the repo after warming so a fresh clone can demo offline).
- Prompts live in `agent/prompts/*.md` and are loaded at startup; `reply_style.md` fixes tone (short, apologise once, give reference number, say exactly what happens next, same language as customer, no promises beyond policy).
- PII: `policy/pii.py` masks before any prompt; the LLM only sees `+91-98XXXXXX12`, `r***@gmail.com`, `riya@okaxis → r***@okaxis`.

## 11. Workers (`workers/scheduler.py`)

Started in FastAPI `lifespan` as asyncio tasks (no Celery/Redis):
- `process_queue`: every 1 s pick up to `QUEUE_CONCURRENCY` (default 3) tickets with status `NEW`, mark `PROCESSING`, run the graph in a thread (`anyio.to_thread`) so blocking HTTP/LLM calls don't stall the API.
- `cluster_incidents`: every 15 s (§8).
- `sla_guard`: every 30 s (§9).
All loops are wrapped so one exception never kills the loop (log + audit `error`).

## 12. Cockpit (Next.js) — pages and components

| Route | Shows | Actions |
|---|---|---|
| `/` Queue | KPI strip (`auto_resolution_rate`, `avg_first_response_sec`, `open`, `awaiting_approval`, `incidents_open`); table: id, type badge, priority, status, path, SLA countdown, incident badge, resolved_by | Row click → ticket; **Demo drawer** (`?demo=1`): Reset, Seed, Inject scenario (dropdown), Inject spike (bank, count) |
| `/tickets/[id]` | Left: masked ticket text, customer/merchant card, regulatory clock; Right: **Timeline** of audit events (understanding card, decision card with reasoning + proposed actions, gate badges with reasons, tool calls with request/response, reply sent, handoff) | Override (path dropdown + note + name), Approve/Reject if pending approval, Re-run |
| `/approvals` | Pending approvals: ticket summary, proposed action, gate reasons, Resolv reasoning | Approve / Reject with note |
| `/incidents` | Incident cards: title, signature, ticket count (live), first/last seen, notice draft, Slack status | Send proactive notice; open linked tickets |
| `/evidence` | Rendered `evals/report.md` + headline numbers; link to `overrides.jsonl` count | Re-run evals (calls `make evals` via `/api/evals/run`) |

Styling: Tailwind, navy/cyan palette matching the deck (`#002E6E`, `#00BAF2`), big status badges — judges watch from 3 m away. Polling with `useSWR(..., {refreshInterval: 2000})`.

## 13. Failure modes & fallbacks (decided in advance)

| Failure | Detection | Fallback |
|---|---|---|
| Anthropic API down / no internet | `/api/health.llm_mode`, errors in audit | `LLM_MODE=replay` (warmed cache) → `mock` |
| LangGraph import/runtime trouble | graph fails to run end-to-end | `agent/runner.py` sequential runner |
| Docker/Postgres trouble | `make dev` fails | `DATABASE_URL=sqlite:///./resolv.db` (default anyway) |
| fastembed model download slow | startup > 60 s | `EMBEDDINGS_ENABLED=false` → keyword retrieval, signature-only clustering |
| Slack webhook missing | 4xx | in-app notifications panel (always written) |
| Frontend routes incomplete | routes missing | single page: queue + inline timeline drawer; approvals/incidents as tabs |
| Live demo breaks mid-pitch | — | pre-recorded screen video of the D1–D5 run (record during rehearsal) |

## 14. Security & privacy notes (for Q&A)

- PII masked before LLM and in UI; raw text stored only in the DB (`raw_text`) — in production it would be encrypted at rest and access-logged.
- No action without a gate decision; idempotency keys prevent double execution; unknown references rejected; money-moving actions above limits require a named human approval; everything audited with actor.
- Prompt-injection posture: customer text is data, never instructions; tool schemas constrain outputs; the gate ignores any "instruction" content; replies are templated around the LLM draft.
- DPDP Act 2023 alignment: data minimisation (only fields needed for the ticket), purpose limitation, deletion on reset.

## 15. Environment variables (`.env.example`)

```
DATABASE_URL=sqlite:///./resolv.db          # or postgresql+psycopg://resolv:resolv@localhost:5432/resolv
LLM_MODE=replay                              # live | replay | mock
ANTHROPIC_API_KEY=
LLM_MODEL_DECIDE=claude-sonnet-5-5
LLM_MODEL_UNDERSTAND=claude-haiku-5-5
LLM_CACHE_DIR=./.llm_cache
PAYTM_BASE_URL=http://localhost:8000/mock/paytm/v1   # mock is mounted in-process (decision); standalone :8001 is optional
AGENT_ENGINE=langgraph                       # langgraph | runner (fallback, same nodes)
MOCK_LATENCY_MS=120
MOCK_REFUND_SETTLE_SECONDS=20
SLACK_WEBHOOK_URL=
EMBEDDINGS_ENABLED=true
INCIDENT_THRESHOLD=10
INCIDENT_WINDOW_MINUTES=60
QUEUE_CONCURRENCY=3
DEMO_NOW_OVERRIDE=                           # optional fixed "now" for deterministic TAT maths
NEXT_PUBLIC_API_BASE=http://localhost:8000
NEXT_PUBLIC_USE_FIXTURES=0                   # 1 = frontend renders from fixture JSON before the backend exists
```
