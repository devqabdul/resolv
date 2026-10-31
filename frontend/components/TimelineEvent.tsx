'use client';
// One row on the agent timeline: time column, rail dot, numbered title + one-line summary, kind
// pill, and a chevron that expands the kind-specific details (Collapsible, animated height).
import type { ReactNode } from "react";
import { motion, useReducedMotion } from "motion/react";
import { ArrowRightIcon, CaretDownIcon, CheckCircleIcon, WarningOctagonIcon, XCircleIcon } from "@phosphor-icons/react";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { PRIORITY_TONE, STATUS_TONE, toneBadge, type Tone } from "@/components/status-tone";
import GateResults from "@/components/ticket/GateResults";
import type { AuditEvent } from "@/lib/api";
import { cn } from "@/lib/utils";

// Narrowing helpers for the untyped audit payloads (no `any`).
export type Obj = Record<string, unknown>;
export const obj = (v: unknown): Obj | null => (v && typeof v === "object" && !Array.isArray(v) ? (v as Obj) : null);
export const arr = (v: unknown): unknown[] => (Array.isArray(v) ? v : []);
export const str = (v: unknown): string | undefined => (typeof v === "string" ? v : undefined);
export const num = (v: unknown): number | undefined => (typeof v === "number" ? v : undefined);
export const inr = (v: unknown) => (typeof v === "number" ? `₹${v.toLocaleString("en-IN", { maximumFractionDigits: 2 })}` : "-");
export const strs = (v: unknown): string[] => arr(v).map((x) => (typeof x === "string" ? x : JSON.stringify(x)));
const ampm = (s: string) => s.replace(/\b(am|pm)\b/, (m) => m.toUpperCase());
export const fmtDateTime = (iso: string) =>
  ampm(new Date(iso).toLocaleString("en-IN", { day: "numeric", month: "short", year: "numeric", hour: "numeric", minute: "2-digit", hour12: true }));
export const fmtDate = (iso: string) => new Date(iso).toLocaleDateString("en-IN", { day: "numeric", month: "short", year: "numeric" });
const fmtTime = (iso: string) =>
  ampm(new Date(iso).toLocaleTimeString("en-IN", { hour: "2-digit", minute: "2-digit", second: "2-digit", hour12: true }));
const EASE = [0.16, 1, 0.3, 1] as const;

// Rail dot colour: blue default, green success, amber waiting on a human, red failure.
export type Dot = "info" | "ok" | "wait" | "bad";
const DOT: Record<Dot, string> = {
  info: "bg-status-processing", ok: "bg-status-resolved", wait: "bg-status-awaiting", bad: "bg-status-failed",
};

const ACTION_LABEL: Record<string, string> = {
  initiate_reversal: "Reverse payment", credit_compensation: "Credit compensation", send_reply: "Send reply",
  retrigger_kyc: "Re-trigger KYC", retrigger_settlement: "Re-trigger settlement", cancel_mandate: "Cancel mandate",
};
export const humanAction = (name: string | undefined) => {
  if (!name) return "Action";
  const s = ACTION_LABEL[name] ?? name.replace(/_/g, " ");
  return s.charAt(0).toUpperCase() + s.slice(1);
};

// Title, one-line summary and dot tone per audit kind, from the real payload only.
export function describe(e: AuditEvent, channel: string): { title: string; summary?: string; dot: Dot } {
  const p = e.payload;
  switch (e.kind) {
    case "ingest":
      return { title: "Ticket ingested", summary: `Created from ${channel}${str(p.candidate_txn_id) ? ` • txn ${str(p.candidate_txn_id)}` : ""}`, dot: "info" };
    case "pii_masked": {
      const c = strs(p.classes);
      return { title: "PII masked", summary: c.length ? `Masked ${c.join(", ")} before any LLM call` : "Nothing to mask", dot: "info" };
    }
    case "understanding": {
      const conf = num(p.confidence);
      return {
        title: "Understanding (LLM)",
        summary: `Identified issue: ${str(p.ticket_type) ?? "unknown"}. ${str(p.summary_for_agent) ?? ""}`.trim(),
        dot: conf !== undefined && conf < 0.6 ? "wait" : "info",
      };
    }
    case "decision":
      return {
        title: "Decision (LLM)",
        summary: `Path: ${str(p.path) ?? "-"} • Priority: ${str(p.priority) ?? "-"} • Proposed actions: ${arr(p.proposed_actions).length}`,
        dot: "info",
      };
    case "gate": {
      const o = str(p.ticket_outcome) ?? "-";
      return {
        title: "Policy gate",
        summary: `Outcome: ${o} • ${arr(p.results).length} actions checked`,
        dot: o === "AUTO_EXECUTE" ? "ok" : o === "NEEDS_APPROVAL" ? "wait" : o === "BLOCKED" ? "bad" : "info",
      };
    }
    case "gate_adjusted_amount":
      return { title: "Gate adjusted amount", summary: `${humanAction(str(p.action))}: ${inr(p.from)} to ${inr(p.to)}`, dot: "wait" };
    case "approval_created":
    case "approval_requested":
      return { title: "Approval requested", summary: `${humanAction(str(p.action))} sent to a human approver with draft and reasoning`, dot: "wait" };
    case "approval_decided":
      return { title: "Human approval", summary: `${p.approve ? "Approved" : "Rejected"} by ${str(p.decided_by) ?? "-"}`, dot: p.approve ? "ok" : "bad" };
    case "verify": {
      const checks = arr(p.checks).map(obj);
      const ok = checks.filter((c) => c?.ok).length;
      return { title: "Verification", summary: checks.length ? `${ok} of ${checks.length} checks passed` : p.ok ? "Verified" : "Verification failed", dot: p.ok ? "ok" : "bad" };
    }
    case "reply_sent":
      return {
        title: p.holding_reply ? "Holding reply sent to customer" : "Reply sent to customer",
        summary: `via ${str(p.channel) ?? "-"}${str(p.language) ? ` (${str(p.language)})` : ""}`,
        dot: "ok",
      };
    case "status_change": {
      const pr = obj(p.priority);
      if (pr) return { title: "Priority changed", summary: `Priority raised to ${str(pr.to) ?? "-"}`, dot: "wait" };
      const to = str(p.to) ?? "-";
      return {
        title: "Status changed",
        summary: `Ticket marked as ${to}`,
        dot: to === "RESOLVED" ? "ok" : to === "AWAITING_APPROVAL" ? "wait" : to === "FAILED" ? "bad" : "info",
      };
    }
    case "handoff":
      return { title: "Handed off", summary: `To team ${str(p.assigned_team) ?? "-"} • ${str(p.outcome) ?? ""}`, dot: "info" };
    case "override":
      return { title: "Human override", summary: `Path ${str(obj(p.resolv_decision)?.path) ?? "-"} changed to ${str(obj(p.human_decision)?.path) ?? "-"}`, dot: "info" };
    case "incident_linked":
      return { title: "Incident linked", summary: str(p.incident_id), dot: "info" };
    case "incident_fast_path":
      return { title: "Incident fast path", summary: "Known incident, no LLM call", dot: "ok" };
    case "notification":
      return { title: "Notification sent", summary: `${str(p.channel) ?? "-"} to ${str(p.target) ?? "-"}`, dot: p.delivered === false ? "bad" : "info" };
    case "sla_nudge": {
      const m = num(p.minutes);
      return { title: "SLA nudge", summary: `Team ${str(p.team) ?? "-"}${m !== undefined ? ` • breaches in ${Math.max(Math.round(m), 0)} min` : ""}`, dot: "wait" };
    }
    case "error":
      return { title: "Error", summary: str(p.node) ? `Node ${str(p.node)} failed` : str(p.error), dot: "bad" };
    default: {
      const t = e.kind.replace(/_/g, " ");
      return { title: t.charAt(0).toUpperCase() + t.slice(1), dot: "info" };
    }
  }
}

function Pill({ tone, children, mono }: { tone: Tone | undefined; children: ReactNode; mono?: boolean }) {
  return <Badge className={toneBadge({ tone, className: mono ? "font-mono" : undefined })}>{children}</Badge>;
}

export function Json({ value }: { value: unknown }) {
  return <pre className="max-h-80 overflow-auto rounded-lg bg-muted p-3 font-mono text-xs leading-relaxed">{JSON.stringify(value, null, 2)}</pre>;
}

// Expanded details per kind. Returns null when the summary already says everything.
function Body({ kind, p, replyDraft }: { kind: string; p: Obj; replyDraft?: string }): ReactNode {
  switch (kind) {
    case "understanding": {
      const conf = num(p.confidence);
      return (
        <div className="flex flex-col gap-2">
          <div className="flex flex-wrap items-center gap-2">
            <Badge variant="outline" className="h-6 px-2.5 font-mono text-sm font-normal">{str(p.ticket_type) ?? "-"}</Badge>
            <Pill tone={conf !== undefined && conf < 0.6 ? "failed" : "resolved"} mono>{conf === undefined ? "-" : `${Math.round(conf * 100)}%`} confidence</Pill>
            {str(p.sentiment) && <Badge variant="secondary" className="h-6 px-2.5 text-sm">{str(p.sentiment)}</Badge>}
            {str(p.language) && <Badge variant="secondary" className="h-6 px-2.5 font-mono text-sm">{str(p.language)}</Badge>}
          </div>
          {str(p.summary_for_agent) && <p className="text-muted-foreground">{str(p.summary_for_agent)}</p>}
        </div>
      );
    }
    case "decision": {
      const actions = arr(p.proposed_actions).map(obj);
      return (
        <div className="flex flex-col gap-3">
          <div className="flex flex-wrap items-center gap-2">
            <Pill tone="routed" mono>{str(p.path) ?? "-"}</Pill>
            {str(p.priority) && <Pill tone={PRIORITY_TONE[str(p.priority) ?? ""]} mono>{str(p.priority)}</Pill>}
            {str(p.route_to_team) && <span className="text-muted-foreground">to team <b className="font-medium text-foreground">{str(p.route_to_team)}</b></span>}
          </div>
          {str(p.reasoning) && <p className="leading-relaxed">{str(p.reasoning)}</p>}
          {actions.length > 0 && (
            <div className="grid grid-cols-[minmax(0,1fr)_auto_auto] gap-x-4 rounded-lg border text-sm">
              {actions.map((a, i) => {
                const params = obj(a?.params) ?? {};
                return (
                  <div key={i} className="col-span-3 grid grid-cols-subgrid items-baseline border-b px-3 py-2 font-mono tabular-nums last:border-b-0">
                    <span className="truncate font-medium">{str(a?.name) ?? "action"}</span>
                    <span className="text-right">{params.amount_inr !== undefined ? inr(params.amount_inr) : ""}</span>
                    <span className="text-muted-foreground">{str(params.txn_id) ?? ""}</span>
                  </div>
                );
              })}
            </div>
          )}
          {str(p.customer_reply_draft) && (
            <div className="flex flex-col gap-1">
              <span className="text-xs text-muted-foreground">Reply draft</span>
              <p className="rounded-lg bg-muted p-3 text-sm leading-relaxed">{str(p.customer_reply_draft)}</p>
            </div>
          )}
        </div>
      );
    }
    case "gate":
      return <GateResults results={arr(p.results)} />;
    case "gate_adjusted_amount":
      return (
        <p className="flex flex-wrap items-center gap-2 font-mono tabular-nums">
          <span className="font-medium">{str(p.action)}</span>
          <span className="text-muted-foreground line-through">{inr(p.from)}</span>
          <ArrowRightIcon className="size-4 text-muted-foreground" />
          <b className="text-base">{inr(p.to)}</b>
        </p>
      );
    case "verify": {
      const checks = arr(p.checks).map(obj);
      if (checks.length === 0) return null;
      return (
        <ul className="flex flex-col gap-1.5 text-sm">
          {checks.map((c, i) => (
            <li key={i} className="flex flex-wrap items-center gap-2 font-mono">
              {c?.ok ? <CheckCircleIcon weight="fill" className="size-4 text-status-resolved" /> : <XCircleIcon weight="fill" className="size-4 text-status-failed" />}
              <span>{str(c?.name)}</span>
              <ArrowRightIcon className="size-3.5 text-muted-foreground" />
              <span className="font-medium">{str(c?.observed)}</span>
              {c?.retried ? <span className="font-sans text-muted-foreground">(retried)</span> : null}
            </li>
          ))}
        </ul>
      );
    }
    case "reply_sent": {
      const text = str(p.text) ?? replyDraft;
      if (!text) return null;
      return <p className="max-w-xl rounded-2xl rounded-bl-sm border border-highlight/30 bg-highlight/10 px-4 py-3 text-sm leading-relaxed">{text}</p>;
    }
    case "status_change": {
      const s = obj(p.priority) ?? p;
      const tones = obj(p.priority) ? PRIORITY_TONE : STATUS_TONE;
      return (
        <div className="flex flex-wrap items-center gap-2">
          <Pill tone={tones[str(s.from) ?? ""]} mono>{str(s.from) ?? "-"}</Pill>
          <ArrowRightIcon className="size-4 text-muted-foreground" />
          <Pill tone={tones[str(s.to) ?? ""]} mono>{str(s.to) ?? "-"}</Pill>
        </div>
      );
    }
    case "handoff":
      return (
        <div className="flex flex-col gap-2 text-sm">
          {str(p.agent_summary) && <p className="leading-relaxed">{str(p.agent_summary)}</p>}
          {str(p.next_action_for_human) && <p><span className="text-muted-foreground">Next action:</span> <b className="font-medium">{str(p.next_action_for_human)}</b></p>}
          {strs(p.errors).map((e, i) => <p key={i} className="text-destructive">{e}</p>)}
        </div>
      );
    case "approval_created":
    case "approval_requested":
      return (
        <div className="flex flex-col gap-1.5 text-sm">
          <p><span className="font-mono font-medium">{str(p.action)}</span> needs approval <span className="font-mono text-muted-foreground">{str(p.approval_id)}</span></p>
          {strs(p.reasons).length > 0 && <ul className="list-disc pl-5 text-muted-foreground">{strs(p.reasons).map((r, i) => <li key={i}>{r}</li>)}</ul>}
        </div>
      );
    case "approval_decided":
      return (
        <div className="flex flex-wrap items-center gap-2 text-sm">
          <Pill tone={p.approve ? "resolved" : "failed"}>{p.approve ? "Approved" : "Rejected"}</Pill>
          <span>by <b className="font-medium">{str(p.decided_by) ?? "-"}</b>{str(p.via) ? ` via ${str(p.via)}` : ""}</span>
          {str(p.note) && <p className="w-full text-muted-foreground">Note: {str(p.note)}</p>}
        </div>
      );
    case "override": {
      const r = obj(p.resolv_decision);
      const h = obj(p.human_decision);
      return (
        <div className="grid grid-cols-2 gap-3">
          <div className="flex flex-col gap-1.5 rounded-lg border bg-muted/40 p-3">
            <span className="text-xs text-muted-foreground">Resolv decided</span>
            <Pill tone="routed" mono>{str(r?.path) ?? "-"}</Pill>
          </div>
          <div className="flex flex-col gap-1.5 rounded-lg border border-highlight/40 bg-highlight/10 p-3">
            <span className="text-xs text-muted-foreground">Human decided</span>
            <Pill tone="processing" mono>{str(h?.path) ?? "-"}</Pill>
            {str(h?.note) && <p className="text-sm">{str(h?.note)}</p>}
          </div>
        </div>
      );
    }
    case "incident_linked":
    case "incident_fast_path":
      return (
        <div className="flex flex-col gap-1.5 text-sm">
          <span className="font-mono font-medium">{str(p.incident_id) ?? "-"}{str(p.via) ? ` via ${str(p.via)}` : ""}</span>
          {str(p.signature) && <p className="break-all font-mono text-muted-foreground">{str(p.signature)}</p>}
        </div>
      );
    case "error":
      return (
        <Alert variant="destructive">
          <WarningOctagonIcon />
          <AlertTitle>{str(p.node) ? `Node ${str(p.node)} failed` : "Error"}</AlertTitle>
          <AlertDescription className="break-words font-mono">{str(p.error) ?? str(p.engine) ?? JSON.stringify(p)}</AlertDescription>
        </Alert>
      );
    case "ingest":
      return (
        <div className="flex flex-col gap-1 font-mono text-sm">
          <span className="break-all">{str(p.signature) ?? "no signature"}</span>
          <span className="text-muted-foreground">txn {str(p.candidate_txn_id) ?? "-"}</span>
        </div>
      );
    case "pii_masked":
    case "notification":
    case "sla_nudge":
      return null;
    default:
      return <Json value={p} />;
  }
}

// Shared row shell, also used by the grouped tool-call row. `testProps` lands on the <li>.
// Motion: `enter` staggers first-load rows; `fresh` rows (arrived by polling) slide in with a
// brief cyan wash. Both are off under reduced motion.
export function Row({
  n, ts, dot, title, summary, kind, details, defaultOpen, enter, fresh, testProps,
}: {
  n: number; ts: string; dot: Dot; title: string; summary?: string; kind: string; details: ReactNode;
  defaultOpen?: boolean; enter?: number; fresh?: boolean; testProps?: Record<string, string>;
}) {
  const reduce = useReducedMotion();
  const animate = !reduce && (fresh || enter !== undefined);
  const head = (
    <>
      <div className="flex min-w-0 flex-1 flex-col gap-0.5">
        <span className={cn("font-medium", dot === "bad" && "text-destructive")}>{n}. {title}</span>
        {summary && <span className="truncate text-sm text-muted-foreground">{summary}</span>}
      </div>
      <Badge className="h-6 shrink-0 rounded-full bg-highlight/12 px-2.5 font-mono text-xs font-normal text-highlight-text">{kind}</Badge>
    </>
  );
  return (
    <motion.li
      {...testProps}
      className="group/row relative grid grid-cols-[6rem_1rem_minmax(0,1fr)] gap-x-3 rounded-lg pb-5 last:pb-0"
      initial={animate ? { opacity: 0, y: 8, backgroundColor: fresh ? "rgba(0,186,242,0.14)" : "rgba(0,186,242,0)" } : false}
      animate={{ opacity: 1, y: 0, backgroundColor: "rgba(0,186,242,0)" }}
      transition={{ duration: 0.2, ease: EASE, delay: fresh ? 0 : (enter ?? 0) * 0.03, backgroundColor: { duration: 1.2, ease: "easeOut" } }}
    >
      <time dateTime={ts} className="pt-0.5 font-mono text-xs whitespace-nowrap text-muted-foreground tabular-nums">{fmtTime(ts)}</time>
      <span aria-hidden className="relative flex justify-center">
        <span className="absolute top-2 -bottom-5 w-px bg-border group-last/row:hidden" />
        <span className={cn("relative mt-1.5 size-2.5 rounded-full ring-4 ring-card", DOT[dot])} />
      </span>
      {details ? (
        <Collapsible defaultOpen={defaultOpen} className="min-w-0">
          <CollapsibleTrigger className="group/trig flex w-full items-start gap-3 rounded-md text-left outline-none focus-visible:ring-3 focus-visible:ring-ring/50">
            {head}
            <CaretDownIcon aria-hidden className="mt-1 size-4 shrink-0 text-muted-foreground transition-transform group-data-[state=open]/trig:rotate-180 motion-reduce:transition-none" />
          </CollapsibleTrigger>
          <CollapsibleContent className="overflow-hidden data-[state=closed]:animate-collapsible-up data-[state=open]:animate-collapsible-down motion-reduce:animate-none">
            <div className="pt-3">{details}</div>
          </CollapsibleContent>
        </Collapsible>
      ) : (
        <div className="flex min-w-0 items-start gap-3 pr-7">{head}</div>
      )}
    </motion.li>
  );
}

export default function TimelineEvent({ e, n, channel, replyDraft, enter, fresh }: {
  e: AuditEvent; n: number; channel: string; replyDraft?: string; enter?: number; fresh?: boolean;
}) {
  const d = describe(e, channel);
  return (
    <Row
      n={n}
      ts={e.ts}
      dot={d.dot}
      title={d.title}
      summary={d.summary}
      kind={e.kind}
      details={Body({ kind: e.kind, p: e.payload, replyDraft })}
      defaultOpen={e.kind === "gate"}
      enter={enter}
      fresh={fresh}
      testProps={{ "data-testid": "timeline-event", "data-kind": e.kind }}
    />
  );
}
