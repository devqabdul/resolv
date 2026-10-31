'use client';
// One audit event on the timeline rail: kind icon, actor chip, mono time, kind-specific body.
import type { ComponentType, ReactNode } from "react";
import { motion, useReducedMotion } from "motion/react";
import {
  ArrowElbowDownLeftIcon, ArrowRightIcon, BellIcon, BrainIcon, ChatCircleTextIcon, CheckCircleIcon, CircleIcon,
  EyeSlashIcon, GavelIcon, LightningIcon, LinkSimpleIcon, ScalesIcon, SealCheckIcon, ShieldCheckIcon, SignpostIcon,
  TrayArrowDownIcon, UserSwitchIcon, UsersIcon, WarningOctagonIcon, WrenchIcon, XCircleIcon,
} from "@phosphor-icons/react";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { GATE_TONE, PRIORITY_TONE, STATUS_TONE, toneBadge, type Tone } from "@/components/status-tone";
import type { AuditEvent } from "@/lib/api";
import { cn } from "@/lib/utils";
import GateBadge from "./GateBadge";

// Narrowing helpers for the untyped audit payloads (no `any`).
export type Obj = Record<string, unknown>;
export const obj = (v: unknown): Obj | null => (v && typeof v === "object" && !Array.isArray(v) ? (v as Obj) : null);
export const arr = (v: unknown): unknown[] => (Array.isArray(v) ? v : []);
export const str = (v: unknown): string | undefined => (typeof v === "string" ? v : undefined);
export const num = (v: unknown): number | undefined => (typeof v === "number" ? v : undefined);
export const inr = (v: unknown) => (typeof v === "number" ? `₹${v.toLocaleString("en-IN", { maximumFractionDigits: 2 })}` : "-");
const EASE = [0.16, 1, 0.3, 1] as const;
const strs = (v: unknown): string[] => arr(v).map((x) => (typeof x === "string" ? x : JSON.stringify(x)));

type Icon = ComponentType<{ className?: string; weight?: "regular" | "bold" | "fill" }>;
const TONE_TEXT: Record<Tone, string> = {
  resolved: "text-status-resolved", processing: "text-status-processing", awaiting: "text-status-awaiting",
  new: "text-status-new", routed: "text-status-routed", incident: "text-status-incident",
  failed: "text-status-failed", closed: "text-status-closed",
};
const KIND: Record<string, { label: string; icon: Icon; tone: Tone }> = {
  ingest: { label: "Ingest", icon: TrayArrowDownIcon, tone: "new" },
  pii_masked: { label: "PII masked", icon: EyeSlashIcon, tone: "new" },
  understanding: { label: "Understanding", icon: BrainIcon, tone: "processing" },
  decision: { label: "Decision", icon: SignpostIcon, tone: "routed" },
  gate: { label: "Policy gate", icon: ShieldCheckIcon, tone: "awaiting" },
  gate_adjusted_amount: { label: "Gate adjusted amount", icon: ScalesIcon, tone: "awaiting" },
  tool_call: { label: "Tool call", icon: WrenchIcon, tone: "new" },
  tool_result: { label: "Tool result", icon: ArrowElbowDownLeftIcon, tone: "new" },
  verify: { label: "Verify", icon: SealCheckIcon, tone: "resolved" },
  reply_sent: { label: "Reply sent", icon: ChatCircleTextIcon, tone: "processing" },
  status_change: { label: "Status change", icon: ArrowRightIcon, tone: "routed" },
  handoff: { label: "Handoff", icon: UsersIcon, tone: "routed" },
  approval_created: { label: "Approval requested", icon: GavelIcon, tone: "awaiting" },
  approval_requested: { label: "Approval requested", icon: GavelIcon, tone: "awaiting" },
  approval_decided: { label: "Approval decided", icon: GavelIcon, tone: "resolved" },
  override: { label: "Human override", icon: UserSwitchIcon, tone: "processing" },
  incident_linked: { label: "Incident linked", icon: LinkSimpleIcon, tone: "incident" },
  incident_fast_path: { label: "Incident fast path", icon: LightningIcon, tone: "incident" },
  notification: { label: "Notification", icon: BellIcon, tone: "new" },
  error: { label: "Error", icon: WarningOctagonIcon, tone: "failed" },
};

function ActorChip({ actor }: { actor: string }) {
  const cls = actor === "resolv"
    ? "bg-primary text-primary-foreground"
    : actor.startsWith("human:") ? "bg-highlight text-highlight-foreground" : "bg-muted text-muted-foreground";
  return <Badge className={cn("h-6 px-2.5 font-mono text-sm font-normal", cls)}>{actor}</Badge>;
}

function Pill({ tone, children, mono }: { tone: Tone | undefined; children: ReactNode; mono?: boolean }) {
  return <Badge className={toneBadge({ tone, className: mono ? "font-mono" : undefined })}>{children}</Badge>;
}

// Styled <details>: no Collapsible in components/ui and it needs no JS.
function Fold({ label, children }: { label: string; children: ReactNode }) {
  return (
    <details className="group/fold">
      <summary className="inline-flex cursor-pointer list-none items-center gap-1 text-sm font-medium text-primary hover:underline [&::-webkit-details-marker]:hidden">
        <ArrowRightIcon className="size-3.5 transition-transform group-open/fold:rotate-90" />
        {label}
      </summary>
      <div className="mt-2">{children}</div>
    </details>
  );
}

function Json({ label, value }: { label: string; value: unknown }) {
  return (
    <Fold label={label}>
      <pre className="max-h-80 overflow-auto rounded-lg bg-muted p-3 font-mono text-xs leading-relaxed">{JSON.stringify(value, null, 2)}</pre>
    </Fold>
  );
}

function Body({ kind, p, replyDraft }: { kind: string; p: Obj; replyDraft?: string }) {
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
          {str(p.reasoning) && <p className="text-base leading-relaxed">{str(p.reasoning)}</p>}
          {actions.length > 0 && (
            <div className="grid grid-cols-[minmax(0,1fr)_auto_auto] gap-x-4 rounded-lg border">
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
            <Fold label="Reply draft"><p className="rounded-lg bg-muted p-3 leading-relaxed">{str(p.customer_reply_draft)}</p></Fold>
          )}
        </div>
      );
    }
    case "gate":
      return (
        <div className="flex flex-col gap-2">
          <div className="flex items-center gap-2 text-muted-foreground">Ticket outcome <Pill tone={GATE_TONE[str(p.ticket_outcome) ?? ""]} mono>{str(p.ticket_outcome) ?? "-"}</Pill></div>
          {arr(p.results).map(obj).map((r, i) => (
            <GateBadge key={i} action={str(obj(r?.action)?.name) ?? "action"} outcome={str(r?.outcome) ?? "?"} reasons={strs(r?.reasons)} />
          ))}
        </div>
      );
    case "gate_adjusted_amount":
      return (
        <p className="flex flex-wrap items-center gap-2 font-mono tabular-nums">
          <span className="font-medium">{str(p.action)}</span>
          <span className="text-muted-foreground line-through">{inr(p.from)}</span>
          <ArrowRightIcon className="size-4 text-muted-foreground" />
          <b className="text-base">{inr(p.to)}</b>
        </p>
      );
    case "tool_call":
    case "tool_result": {
      const result = kind === "tool_result";
      const state = p.skipped ? "skipped" : String(p.status ?? (p.ok ? "ok" : "error"));
      return (
        <div data-testid="tool-call" data-name={str(p.name)} className="flex flex-col gap-1.5">
          <div className="flex flex-wrap items-center gap-2">
            <span className="font-mono font-medium">{str(p.name)}</span>
            {result
              ? <Pill tone={p.skipped ? "new" : p.ok ? "resolved" : "failed"} mono>{state}</Pill>
              : <Badge variant="outline" className="h-6 px-2.5 text-sm font-normal text-muted-foreground">request</Badge>}
          </div>
          {result ? <Json label="Response" value={p.body ?? p.error} /> : <Json label="Request" value={p.params} />}
        </div>
      );
    }
    case "verify": {
      const checks = arr(p.checks).map(obj);
      if (checks.length === 0) return <Pill tone={p.ok ? "resolved" : "failed"}>{p.ok ? "Verified" : "Verification failed"}</Pill>;
      return (
        <ul className="flex flex-col gap-1.5">
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
    case "reply_sent":
      return (
        <div className="flex max-w-xl flex-col gap-1 rounded-2xl rounded-bl-sm border border-highlight/30 bg-highlight/10 px-4 py-3">
          <div className="text-xs text-muted-foreground">
            {p.holding_reply ? "Holding reply" : "Reply"} via <span className="font-mono">{str(p.channel)}</span>{str(p.language) ? `, ${str(p.language)}` : ""}
          </div>
          <p className="text-base leading-relaxed">{str(p.text) ?? replyDraft ?? "Reply text not stored."}</p>
        </div>
      );
    case "status_change":
      return (
        <div className="flex flex-wrap items-center gap-2">
          <Pill tone={STATUS_TONE[str(p.from) ?? ""]}>{str(p.from) ?? "-"}</Pill>
          <ArrowRightIcon className="size-4 text-muted-foreground" />
          <Pill tone={STATUS_TONE[str(p.to) ?? ""]}>{str(p.to) ?? "-"}</Pill>
        </div>
      );
    case "handoff":
      return (
        <div className="flex flex-col gap-2">
          <div className="flex flex-wrap items-center gap-2">
            <Badge variant="outline" className="h-6 px-2.5 text-sm">Team {str(p.assigned_team) ?? "-"}</Badge>
            {str(p.outcome) && <Pill tone={STATUS_TONE[str(p.outcome) ?? ""]} mono>{str(p.outcome)}</Pill>}
          </div>
          {str(p.agent_summary) && <p className="leading-relaxed">{str(p.agent_summary)}</p>}
          {str(p.next_action_for_human) && <p><span className="text-muted-foreground">Next action:</span> <b className="font-medium">{str(p.next_action_for_human)}</b></p>}
          {strs(p.errors).map((e, i) => <p key={i} className="text-destructive">{e}</p>)}
        </div>
      );
    case "approval_created":
    case "approval_requested":
      return (
        <div className="flex flex-col gap-1.5">
          <p><span className="font-mono font-medium">{str(p.action)}</span> needs approval <span className="font-mono text-muted-foreground">{str(p.approval_id)}</span></p>
          {strs(p.reasons).length > 0 && <ul className="list-disc pl-5 text-muted-foreground">{strs(p.reasons).map((r, i) => <li key={i}>{r}</li>)}</ul>}
        </div>
      );
    case "approval_decided":
      return (
        <div className="flex flex-wrap items-center gap-2">
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
        <div className="flex flex-col gap-1.5">
          <div className="flex flex-wrap items-center gap-2">
            <span className="font-mono font-medium">{str(p.incident_id) ?? "-"}</span>
            {str(p.via) && <Badge variant="outline" className="h-6 px-2.5 text-sm font-normal">via {str(p.via)}</Badge>}
          </div>
          {str(p.signature) && <p className="break-all font-mono text-muted-foreground">{str(p.signature)}</p>}
          {kind === "incident_fast_path" && <p className="text-muted-foreground">Known incident, no LLM call.</p>}
        </div>
      );
    case "notification":
      return (
        <p className="flex flex-wrap items-center gap-2">
          <Badge variant="outline" className="h-6 px-2.5 font-mono text-sm font-normal">{str(p.channel) ?? "-"}</Badge>
          {str(p.target) && <><ArrowRightIcon className="size-4 text-muted-foreground" /><b className="font-medium">{str(p.target)}</b></>}
        </p>
      );
    case "error":
      return (
        <Alert variant="destructive">
          <WarningOctagonIcon />
          <AlertTitle>{str(p.node) ? `Node ${str(p.node)} failed` : "Error"}</AlertTitle>
          <AlertDescription className="break-words font-mono">{str(p.error) ?? str(p.engine) ?? JSON.stringify(p)}</AlertDescription>
        </Alert>
      );
    case "pii_masked": {
      const classes = strs(p.classes);
      return (
        <div className="flex flex-wrap items-center gap-2">
          {classes.length === 0 ? <span className="text-muted-foreground">Nothing to mask</span>
            : classes.map((c) => <Badge key={c} variant="secondary" className="h-6 px-2.5 font-mono text-sm font-normal">{c}</Badge>)}
        </div>
      );
    }
    case "ingest":
      return (
        <div className="flex flex-col gap-1 font-mono">
          <span className="break-all">{str(p.signature) ?? "no signature"}</span>
          <span className="text-muted-foreground">txn {str(p.candidate_txn_id) ?? "-"}</span>
        </div>
      );
    default:
      return <Json label="Payload" value={p} />;
  }
}

// Motion: `enter` staggers first-load events; `fresh` marks events that arrived by polling
// (slide in plus a cyan left border fading over 1.2 s). Both are off under reduced motion.
export default function TimelineEvent({ e, replyDraft, enter, fresh }: { e: AuditEvent; replyDraft?: string; enter?: number; fresh?: boolean }) {
  const reduce = useReducedMotion();
  const k = KIND[e.kind];
  const I = k?.icon ?? CircleIcon;
  const animate = !reduce && (fresh || enter !== undefined);
  return (
    <motion.li
      data-testid="timeline-event"
      data-kind={e.kind}
      className="relative grid grid-cols-[2rem_minmax(0,1fr)] gap-3 pb-6 last:pb-0"
      initial={animate ? { opacity: 0, y: 8 } : false}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.2, ease: EASE, delay: fresh ? 0 : (enter ?? 0) * 0.03 }}
    >
      <span className={cn("relative z-10 flex size-8 items-center justify-center rounded-full border bg-card", TONE_TEXT[k?.tone ?? "new"])}>
        <I weight="bold" className="size-4" />
      </span>
      <motion.div
        className="-ml-1 flex min-w-0 flex-col gap-2 border-l-2 pt-1 pl-3"
        initial={animate && fresh ? { borderLeftColor: "rgba(0,186,242,1)" } : false}
        animate={{ borderLeftColor: "rgba(0,186,242,0)" }}
        transition={{ duration: 1.2, ease: "easeOut" }}
      >
        <div className="flex flex-wrap items-center gap-2">
          <span className={cn("font-medium", e.kind === "error" && "text-destructive")}>{k?.label ?? e.kind}</span>
          <ActorChip actor={e.actor} />
          <time dateTime={e.ts} className="ml-auto font-mono text-xs text-muted-foreground tabular-nums">
            {new Date(e.ts).toLocaleTimeString("en-IN", { hour12: false })}
          </time>
        </div>
        <Body kind={e.kind} p={e.payload} replyDraft={replyDraft} />
      </motion.div>
    </motion.li>
  );
}
