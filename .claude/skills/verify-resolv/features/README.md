# resolv feature map

One file per user-facing feature, in sweep order. Every recipe assumes the SKILL.md
session preamble ran and the instance passed Doctor.

- [api-health](api-health.md) — an operator checks the backend is up, which LLM mode it runs in and that mock Paytm is mounted
- [mock-paytm-seed](mock-paytm-seed.md) — demo plumbing resets and seeds the mock Paytm ledger and injects a bank outage
- [ticket-queue](ticket-queue.md) — an agent sees every ticket in the cockpit queue, ordered by priority, and opens one
- [ticket-timeline](ticket-timeline.md) — an agent reads one ticket's full audited timeline: understanding, decision, gate, tool calls, reply
- [d1-auto-resolve](d1-auto-resolve.md) — a failed UPI ticket is resolved with reversal and RBI compensation and no human touch (D1)
- [d3-approval](d3-approval.md) — an over-limit reversal waits for a named human's approval, then executes (D3)
- [override](override.md) — a human overrides Resolv's path on a ticket and the override becomes an eval example (D4)
- [incident-cluster](incident-cluster.md) — a spike of failed payments from one bank becomes one incident (D2)
- [incident-fast-path](incident-fast-path.md) — a later ticket that matches an open incident is linked with no LLM call (D2)
- [sla-guard](sla-guard.md) — a ticket close to its SLA or RBI TAT breach raises priority and nudges support leads
- [metrics-kpi](metrics-kpi.md) — the KPI strip and /api/metrics show auto-resolution, first response, open, awaiting approval, incidents (D5)
- [notifications](notifications.md) — Slack-or-in-app notifications are written and listed in the in-app panel
- [approvals-page](approvals-page.md) — a human approves or rejects pending actions from the Approvals page
- [incidents-page](incidents-page.md) — Ops sees incident cards and sends the proactive notice to linked customers
- [evidence-page](evidence-page.md) — judges see the latest eval report and headline numbers on the Evidence page (D5)
- [demo-drawer](demo-drawer.md) — the presenter resets, seeds and injects scenarios and spikes from the ?demo=1 drawer
- [evals-report](evals-report.md) — `make evals` writes the eval report and /api/evals/report serves it
- [replay-cache](replay-cache.md) — with LLM_MODE=replay and no network the scenarios still run from the warmed cache
