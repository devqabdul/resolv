# Resolv — spec pack (Paytm Build for India AI Hackathon, Track 3: Autonomous AI Teammates)

## What we are building (the gist)

Resolv is a Python backend plus a web cockpit that takes a payments-support ticket and *finishes* it. Tickets are seeded by us (no real helpdesk). Each one runs through five fixed steps — **understand → decide → policy gate → act → verify** — where the LLM does only two jobs: turn messy customer text into a structured understanding (ticket type, transaction, amount, sentiment, language), and propose a decision (resolve / route / escalate, plus the exact actions). Everything that touches money passes a deterministic policy gate written in code, not prompts: the RBI T+1 reversal rule with ₹100/day compensation, a ₹5,000 auto-refund limit, and human-only categories (disputes, fraud). Actions execute against a **mock Paytm API we build ourselves** (transactions, refunds, compensation, settlements, KYC, mandates), so the demo never depends on anything external. Every step is written to an audit log, and the cockpit shows it as a per-ticket timeline with Override and Approve buttons.

Three things on top of that loop make it a teammate rather than a bot: an **incident clusterer** that spots a spike of identical failures (we inject a "bank outage" of ~120 tickets live) and collapses it into one incident with a drafted proactive notice; an **SLA guard** that nudges Slack before a breach; and an **eval harness** with ~60 labelled tickets that reports resolve-vs-route precision and the false-action rate — the "evidence" slide. Five resolvable ticket types, SQLite by default with Postgres + pgvector via Docker Compose, a Next.js cockpit with five pages, the Anthropic API behind a replay cache so the live demo is deterministic even if the venue wifi dies.

## The documents

| File | What it is | Read it when |
|---|---|---|
| `01-PRODUCT-SPEC.md` | What we build, demo moments D1–D5, ticket taxonomy, functional requirements, canonical demo data, acceptance criteria | Before anything else |
| `02-ARCHITECTURE.md` | Repo layout, agent state machine, LLM contracts, data model, API contracts, `rules.yaml`, clustering, fallbacks, env vars. **Source of truth** | Before coding; whenever a name or contract is in doubt |
| `03-TECH-STACK-AND-MODULES.md` | Stack choices with reasons; module-by-module responsibilities and interfaces | When answering "why X?" |
| `04-TECHNOLOGIES.md` | Per-technology reference: version, install, config, how we use it, gotchas, fallback | When installing or when something misbehaves |
| `06-IMPLEMENTATION-PLAN.md` | Tasks T1…T29 in build order with files, acceptance commands and the prompt to paste into Claude Code | Task by task |
| `CLAUDE.md` | Instructions for Claude Code: hard rules, how to run, conventions, required tests, fallbacks, demo facts | Goes at the repo root |

### Reading order

- **Human:** `01` → `02` → `03` → `04` → `06`.
- **Claude Code:** `CLAUDE.md` → `02` → `06` (then each task's own section references).

## Handing this folder to Claude Code

1. Create the repo (`mkdir resolv && cd resolv && git init`).
2. Copy this folder to `docs/` and move `CLAUDE.md` to the repo root: `cp -r <this folder> docs && mv docs/CLAUDE.md .`
3. Create `.env` from the values in `02 §15` (API key, `LLM_MODE=mock` for the first tasks).
4. Start Claude Code in the repo and paste:
   > Read CLAUDE.md and docs/06-IMPLEMENTATION-PLAN.md, then do T1.
5. After each task: run its **Accept** commands yourself, `git commit`, then paste the next task's **Prompt**.

## Demo moments

| Demo moment | What the judges see |
|---|---|
| **D1** | Failed-UPI ticket resolved with no human: reversal + ₹200 RBI compensation + reply, full timeline |
| **D2** | 120-ticket bank-outage spike becomes one incident with a drafted proactive notice; fast path, no 120 LLM calls |
| **D3** | ₹12,000 reversal → NEEDS_APPROVAL → human approves → executes, audited with name |
| **D4** | Human override recorded and appended to the eval set |
| **D5** | Evidence page: n≈60, path precision, false-action rate, gate catch rate; live KPI tiles |

## Three facts to repeat in the pitch

1. **The LLM proposes, the policy gate disposes** — the model never touches money; rules are code and are unit-tested.
2. **Spikes become incidents** — 1,000 tickets from one bank outage become one incident, one owner, one proactive notice, no LLM call per ticket.
3. **Evidence, not claims** — a labelled eval set with a reported false-action rate; human overrides feed it.
