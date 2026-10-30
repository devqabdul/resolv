# 01 · Product Spec — Resolv prototype

> **Read this first.** It says *what* we build, *for whom*, and *how we know it is done*.
> `02-ARCHITECTURE.md` says *how*. `06-IMPLEMENTATION-PLAN.md` says *in what order*.
> Built with Claude Code doing most of the typing.

---

## 1. One-paragraph definition

**Resolv** is an autonomous support teammate for payments & fintech customer service. It takes a support ticket, builds full context (transaction ledger, customer/merchant profile, past tickets, policy knowledge), decides what to do (resolve / route / escalate), **executes the resolution itself through APIs** when a deterministic policy gate allows it, and hands everything else to a human with the research done, a drafted reply and the next action. It also spots spikes of identical failures and collapses them into one incident, watches regulatory SLAs (RBI TAT), and learns from human overrides through an eval set.

The hackathon prototype is a **working, demo-able vertical slice** of that: real agent loop, real policy gate, real audit log and cockpit — against a **mock Paytm API that we build ourselves**.

## 2. What the judges must see (the demo contract)

The pitch deck promised these moments (slide 4 and slide 10). The build is done when all five can be shown live, in this order:

| # | Moment | What is on screen |
|---|--------|-------------------|
| D1 | **Ticket arrives and is resolved with no human touch** | Ticket `#48213` ("Paid ₹2,499 by UPI… money debited, order failed… 3 days…") enters the queue. Within ~60–90 s the timeline shows: understanding → decision (RESOLVE, P1) → gate PASS → reversal initiated via refund API → ₹200 compensation credited (2 days × ₹100, RBI TAT) → personalised reply sent → status RESOLVED. |
| D2 | **A spike becomes one incident** | We inject ~120 "money debited" tickets from one issuing bank. Within ~30 s an **Incident** card appears: signature, ticket count climbing, drafted proactive notice, Ops nudge on Slack. Individual tickets are attached to the incident on a fast path and get a holding reply — no 120 LLM calls. |
| D3 | **Out-of-policy action goes to a human** | A ticket asking for a ₹12,000 reversal: Resolv proposes it, the gate returns NEEDS_APPROVAL, the ticket lands in the **Approvals** queue with the draft and reasoning. A human clicks Approve; the action executes and is audited as `approved_by: <name>`. |
| D4 | **Human override that trains the agent** | On any ticket a human clicks Override (e.g. ROUTE instead of RESOLVE), adds a note; the audit shows the override and the ticket is appended to the eval set as a labelled example. |
| D5 | **Evidence, not claims** | The **Evidence** page shows the latest eval report: resolve-vs-route precision/recall, false-action rate, gate catch rate, n=~60 labelled tickets. KPI tiles on the queue page show auto-resolution %, first-response time, open tickets, awaiting approval, open incidents. |


## 3. Users / personas

| Persona | Needs from the prototype |
|---------|--------------------------|
| **Customer / merchant** (simulated) | Gets the right reply, in their language, with a reference number — fast. We never show their raw PII to the LLM or on screen. |
| **Support agent** (demo: "Priya, L1 agent") | Queue of only the tickets that need judgement; each one arrives with context, reasoning, draft reply, next action; one-click override; approval requests. |
| **Support lead / Ops** (demo: "Ops lead") | Incident view, SLA risk, Slack nudges, KPIs. |
| **Judge** | Must be able to understand in 60 seconds what is autonomous, what is gated, and why it is safe. |

## 4. Scope

### 4.1 In scope — core loop

1. **Ticket ingestion** via API and via demo controls (seeded scenarios). Channels modelled: `in_app_chat`, `email`, `merchant_portal`.
2. **Context builder**: fetch customer/merchant profile, recent transactions, refunds, settlements, KYC, mandates from the mock Paytm API; last 3 past tickets of the same customer; relevant policy snippets from a small KB.
3. **Agent loop** (`understand → decide → gate → act → verify → close | handoff`) with structured LLM outputs.
4. **Policy gate** (deterministic, YAML rules): refund/compensation limits, RBI TAT computation, human-only categories, required preconditions per action, PII masking.
5. **Five resolvable ticket types** (see §5) + human-only categories.
6. **Actions** against mock Paytm: initiate reversal/refund, credit compensation, re-trigger settlement, re-trigger KYC, cancel mandate, send reply/notification.
7. **Audit log**: every understanding, decision, gate result, tool call/result, reply, handoff, approval, override.
8. **Cockpit UI** (Next.js): Queue + KPI tiles, Ticket detail with timeline + Override + Approve/Reject, Approvals, Incidents, Evidence.
9. **Incident clustering** by signature `(ticket_type, issuer_bank | merchant_id, failure_reason)` within a sliding window; incident fast path for new matching tickets; proactive notice draft.
10. **Demo controls**: reset, seed, inject scenario ticket by name, inject spike.
11. **LLM replay cache** so the demo is deterministic and survives network loss.
12. **Eval harness** + labelled dataset (~60 tickets) + Markdown report.

### 4.2 In scope — teammate features

- SLA guard (background job) + Slack nudges (incoming webhook) with in-app fallback.
- Override → append to eval dataset automatically.
- Embedding similarity (fastembed) for past-ticket retrieval and as a secondary clustering signal.
- Language detection and reply in the customer's language (English, Hindi, Hinglish).
- Postgres + pgvector via docker-compose as an alternative to SQLite.

### 4.3 In scope — adapters and extras

- Freshdesk adapter (real helpdesk) behind the same `HelpdeskAdapter` interface.
- Live metrics chart (last 60 min).
- Voice/IVR transcript channel.

### 4.4 Explicitly out of scope (say so if asked)

- Real Paytm APIs or real money movement — **mock only**.
- Authentication/SSO, multi-tenancy, rate limiting, production hardening.
- Fine-tuning any model. Learning = labelled evals + prompt/rule updates gated by eval regression.
- Mobile UI.

## 5. Ticket taxonomy

### 5.1 Resolvable types (Resolv may execute actions)

| `ticket_type` | Typical text | Context needed | Resolution actions | Policy notes |
|---|---|---|---|---|
| `failed_payment_reversal` | "Money debited, order failed / merchant didn't get it" | transaction (status `DEBITED_NOT_CREDITED`), issuer bank, age in days, refund status | `initiate_reversal`, `credit_compensation` (if past RBI TAT), `send_reply` | Reversal auto if `amount ≤ 5000` and txn eligible; compensation = `max(0, age_days − 1) × ₹100` for UPI/IMPS/wallet, auto if ≤ ₹1,000 |
| `refund_status` | "Where is my refund? It's been 10 days" | refund record (status, ARN, ETA) | `send_reply` with ARN/ETA; if refund `FAILED` → `initiate_reversal` again; if stuck beyond ETA → `route` to Merchant Ops with draft | No money moves unless refund is `FAILED` and eligible |
| `settlement_delay` (merchant) | "Settlement for yesterday not received" | settlement record, merchant KYC status, cycle | if `ON_HOLD_KYC` → `retrigger_kyc` + reply; if `FAILED` → `retrigger_settlement`; if `PROCESSING` → reply with ETA | `retrigger_settlement` auto only if merchant KYC `VERIFIED` |
| `kyc_resubmission` | "My KYC got rejected / app says KYC pending" | KYC case (status, rejection reason) | `retrigger_kyc` (sends link) + reply explaining reason | Always auto; never reveal fraud-related rejection reasons (route instead) |
| `mandate_cancellation` | "Cancel my autopay for X" | mandate record | `cancel_mandate` + reply | Auto only if the ticket comes from an authenticated channel (`in_app_chat`, `merchant_portal`); email → NEEDS_APPROVAL |

### 5.2 Human-only categories (Resolv may only research, draft and route)

`dispute_chargeback`, `fraud_suspected`, `account_blocked`, `other`. Gate returns `HUMAN_ONLY`; Resolv still produces understanding + summary + suggested next action.

## 6. Decision paths and gate outcomes

- **Paths** (chosen by the agent): `RESOLVE` (execute and close), `ROUTE` (assign to a team with draft + next action), `ESCALATE` (urgent human attention; P1; approval queue if an action is pending).
- **Gate outcomes** (per proposed action, decided by code): `AUTO_EXECUTE`, `NEEDS_APPROVAL`, `BLOCKED` (precondition failed — action dropped, reason logged), plus ticket-level `HUMAN_ONLY`.
- **Priorities**: `P1` (money stuck past regulatory TAT, repeat issue, frustrated high-value customer, incident-linked), `P2` default, `P3` informational.

## 7. Functional requirements by module

### FR-1 Ingestion
- `POST /api/tickets` accepts `{channel, text, customer_id?, merchant_id?, metadata?}`; returns the ticket; enqueues a run.
- PII masking applied before any LLM call (phone, email, account numbers, full UPI VPAs); masked text is what the UI shows by default.
- Tickets matching an **active incident signature** at ingest skip the LLM path: attach to incident, send holding reply, status `INCIDENT_LINKED`.

### FR-2 Context builder
- Produces a `ContextBundle`: customer or merchant profile, last 10 transactions (30 days), refunds, settlements, KYC, mandates, last 3 tickets, top-3 KB snippets (keyword or embedding match), regulatory clock (`days_since_txn`, `tat_deadline`, `days_late`, `compensation_due`).
- Every fetch is a tool call recorded in the audit log.

### FR-3 Understand (LLM, structured)
Returns `Understanding { ticket_type, confidence, entities{txn_id?, amount?, date?, merchant?, bank?}, sentiment, language, is_repeat_issue, summary_for_agent }`. If `confidence < 0.6` → path forced to `ROUTE`.

### FR-4 Decide (LLM, structured)
Returns `Decision { path, priority, proposed_actions[{name, params, rationale}], customer_reply_draft, agent_summary, next_action_for_human?, reasoning }`. The LLM may only reference entity ids that exist in the `ContextBundle` (the gate rejects unknown ids).

### FR-5 Policy gate (code)
- Loads `policy/rules.yaml`; evaluates each proposed action's `requires` preconditions and `auto_if` limits; returns `GateResult { action, outcome, reasons[] }`.
- Computes RBI TAT values independently (does not trust LLM arithmetic).
- Ticket-level: `HUMAN_ONLY` categories; `NEEDS_APPROVAL` if any money-moving action exceeds limits; `BLOCKED` actions removed.
- Unit-tested (this is the thing judges will poke at).

### FR-6 Act + Verify
- Executes `AUTO_EXECUTE` actions in order through the tool registry; records request/response; idempotency key per `(ticket_id, action_name, params_hash)` so a retry never double-refunds.
- Verify re-reads state from the mock API (e.g. refund `status == INITIATED`); on mismatch retry once, then `handoff` with reason.

### FR-7 Close / Handoff
- Close: send reply (in customer language), set `RESOLVED`, `resolved_by = resolv`, record `first_response_at`/`resolved_at`, enqueue CSAT (logged only).
- Handoff: set `ROUTED`/`ESCALATED`/`AWAITING_APPROVAL`, assign team, store summary + draft + next action, create `Approval` rows for `NEEDS_APPROVAL` actions, Slack/in-app nudge.

### FR-8 Approvals & overrides
- `POST /api/approvals/{id}/decide {approve, note, decided_by}` → executes the action via the same act/verify path, audited with the human's name.
- `POST /api/tickets/{id}/override {path, note, actions?, decided_by}` → records `override` audit event, executes human's choice, appends `{ticket, resolv_decision, human_decision}` to `evals/overrides.jsonl`.

### FR-9 Incidents
- Background job every 15 s: group tickets created in the last 60 min by signature; if `count ≥ INCIDENT_THRESHOLD` (default 10) → create/update `Incident`, link tickets, set `handling_mode = incident`.
- On creation: LLM drafts a proactive customer notice + an internal Ops summary; Slack nudge to `#ops`; incident appears in cockpit within one poll.
- `POST /api/incidents/{id}/notify` sends the notice to all linked customers via mock notifications API and marks the incident `COMMUNICATED`.

### FR-10 SLA guard
- Every 30 s: for open tickets compute `minutes_to_breach` (internal SLA or RBI TAT); if `< 15` → Slack nudge once per ticket; raise priority.

### FR-11 Metrics
`GET /api/metrics` → `{auto_resolution_rate, avg_first_response_sec, avg_resolution_sec, open, awaiting_approval, incidents_open, tat_breaches_prevented, by_type{...}, window_minutes}` computed from the DB over the current demo session.

### FR-12 Evals
- `evals/dataset.jsonl`: ~60 labelled tickets `{id, channel, text, customer_id|merchant_id, expected_type, expected_path, expected_actions[], expected_gate, adversarial, notes}` covering all 5 types, the human-only categories, 5 adversarial cases (over-limit refund, fake txn id, dispute phrased as refund, fraud, mandate via email). `expected_gate` ∈ `AUTO_EXECUTE|NEEDS_APPROVAL|HUMAN_ONLY|BLOCKED`; `adversarial` is a boolean used for the gate catch rate.
- `python -m evals.run` runs each through the pipeline (replay LLM mode, mock API) and writes `evals/report.md` + `evals/report.json`: type accuracy, path precision/recall/F1 per class, **false-action rate** (money-moving actions executed that were not expected), **gate catch rate** (adversarial proposals blocked or sent to approval).
- Evidence page renders the latest report.

### FR-13 Demo controls
`POST /api/demo/reset`, `/seed`, `/ticket/{scenario}` (scenarios: `d1_failed_upi`, `d3_over_limit`, `hinglish_refund_status`, `merchant_settlement`, `kyc_rejected`, `mandate_email`, `dispute`), `/spike {issuer_bank, count}`.

## 8. Non-functional requirements (hackathon-grade)

- **Latency**: a ticket completes in ≤ 90 s live, ≤ 10 s in replay mode.
- **Determinism**: with `LLM_MODE=replay` and a warmed cache, the demo produces identical output every run.
- **Resilience**: no network → replay cache → rule-based `mock` LLM; Docker absent → SQLite; Slack absent → in-app notifications panel.
- **Safety**: no action without gate approval; idempotent actions; unknown ids rejected; PII masked before LLM.
- **Observability**: every step visible in the cockpit timeline within 2 s (polling).

## 9. Acceptance criteria (definition of done)

- [ ] `make dev` (or documented 3 commands) starts backend, mock Paytm and frontend on a clean laptop in < 5 min.
- [ ] D1–D5 demo moments reproducible three times in a row in replay mode.
- [ ] `pytest` passes: policy engine (limits, TAT maths, human-only, preconditions), gate on adversarial decisions, idempotency.
- [ ] `python -m evals.run` produces a report with n ≥ 50 and false-action rate reported.
- [ ] Audit log complete for every ticket shown in the demo.
- [ ] Deck slide 10 ("What we will build") updated to match what actually shipped.

## 10. Canonical demo data (must exist after `/seed`)

- Customer `cust_riya` — Riya M., 4-year user, high activity, language `en` (variant `hi-en` for the Hinglish scenario), tier `plus`.
- Transaction `txn_48213_a` — ₹2,499 UPI to merchant `mer_urban_kart` on **2026-10-25**, status `DEBITED_NOT_CREDITED`, issuer bank `HDFC`, failure `BANK_SWITCH_TIMEOUT`, no refund yet. (Demo day is 31 Oct; the seed sets `created_at` relative to "now − 3 days" so the maths always gives 2 days late = ₹200.)
- A prior ticket for `cust_riya` from ~2 months ago, same type, resolved by a human, with its refund `rfd_riya_prev` (status `COMPLETED`) — reused by the `hinglish_refund_status` scenario.
- Scenario tickets carry fixed ids so the runbook can deep-link them: `tkt_48213` (D1), `tkt_48219` (D3).
- Customer `cust_arjun` with `txn_big` ₹12,000 UPI `DEBITED_NOT_CREDITED` (for D3).
- Merchant `mer_chai_point` with settlement `ON_HOLD_KYC`; merchant `mer_urban_kart` with KYC `VERIFIED`.
- Customer `cust_meera` with KYC case `REJECTED` (reason `ADDRESS_MISMATCH`) and an active mandate `mnd_netflix`.
- Spike generator: `N` customers × transactions to random merchants, issuer bank `AXIS`, failure `UPI_SWITCH_DOWN`, created within the last 20 minutes, plus a matching ticket text with ~8 phrasing variants (English + Hinglish).

## 11. Decisions to confirm before building

1. Which Anthropic model: default `claude-sonnet-5-5` for decide, `claude-haiku-5-5` for understand. Confirm the API key has credit.
2. Slack workspace + incoming webhook URL ready? If not, the in-app notifications panel is the fallback and is fine for the demo.
