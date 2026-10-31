'use client';
import type { AuditEvent } from "@/lib/api";
import GateBadge from "./GateBadge";

// Narrowing helpers for the untyped audit payloads (no `any`).
export type Obj = Record<string, unknown>;
export const obj = (v: unknown): Obj | null => (v && typeof v === "object" && !Array.isArray(v) ? (v as Obj) : null);
export const arr = (v: unknown): unknown[] => (Array.isArray(v) ? v : []);
export const str = (v: unknown): string | undefined => (typeof v === "string" ? v : undefined);
export const num = (v: unknown): number | undefined => (typeof v === "number" ? v : undefined);
const strs = (v: unknown): string[] => arr(v).map((x) => (typeof x === "string" ? x : JSON.stringify(x)));
const inr = (v: unknown) => (typeof v === "number" ? `₹${v.toLocaleString("en-IN")}` : String(v ?? "-"));

const DOT: Record<string, string> = {
  understanding: "bg-cyan", decision: "bg-navy", gate: "bg-amber-500", gate_adjusted_amount: "bg-amber-500",
  tool_call: "bg-slate-400", tool_result: "bg-slate-400", verify: "bg-green-600", reply_sent: "bg-cyan",
  status_change: "bg-navy", handoff: "bg-purple-600", approval_created: "bg-amber-500", approval_requested: "bg-amber-500",
  approval_decided: "bg-green-600", override: "bg-cyan", incident_linked: "bg-purple-600", incident_fast_path: "bg-purple-600",
  notification: "bg-slate-500", error: "bg-red-600",
};

function actorChip(actor: string) {
  const cls = actor === "resolv" ? "bg-navy text-white" : actor.startsWith("human:") ? "bg-cyan text-navy" : "bg-gray-300 text-ink";
  return <span className={`rounded px-2 py-0.5 text-sm font-bold ${cls}`}>{actor}</span>;
}

function Json({ label, value }: { label: string; value: unknown }) {
  return (
    <details className="mt-1">
      <summary className="cursor-pointer text-base font-semibold text-navy">{label}</summary>
      <pre className="mt-1 max-h-80 overflow-auto rounded bg-ink p-3 text-sm text-white">{JSON.stringify(value, null, 2)}</pre>
    </details>
  );
}

function actionLine(a: unknown): string {
  const o = obj(a);
  const p = obj(o?.params) ?? {};
  return [str(o?.name) ?? "action", p.amount_inr !== undefined ? inr(p.amount_inr) : "", str(p.txn_id) ?? ""].filter(Boolean).join(" ");
}

function Body({ kind, p, replyDraft }: { kind: string; p: Obj; replyDraft?: string }) {
  switch (kind) {
    case "understanding":
      return (
        <div className="space-y-1">
          <div className="flex flex-wrap gap-2 text-base">
            <b className="text-navy">{str(p.ticket_type)}</b>
            <span>{Math.round((num(p.confidence) ?? 0) * 100)}% confident</span>
            <span>· {str(p.sentiment)}</span><span>· {str(p.language)}</span>
          </div>
          <p className="text-ink/80">{str(p.summary_for_agent)}</p>
        </div>
      );
    case "decision":
      return (
        <div className="space-y-2">
          <div className="flex gap-2"><b className="text-navy">{str(p.path)}</b><span>{str(p.priority)}</span>{str(p.route_to_team) && <span>→ {str(p.route_to_team)}</span>}</div>
          <p className="text-ink/80">{str(p.reasoning)}</p>
          <ul className="list-disc pl-6 font-mono text-base">{arr(p.proposed_actions).map((a, i) => <li key={i}>{actionLine(a)}</li>)}</ul>
          {str(p.customer_reply_draft) && (
            <details><summary className="cursor-pointer font-semibold text-navy">Reply draft</summary><p className="mt-1 italic">{str(p.customer_reply_draft)}</p></details>
          )}
        </div>
      );
    case "gate":
      return (
        <div className="space-y-2">
          <div className="text-base">Ticket outcome: <b>{str(p.ticket_outcome)}</b></div>
          {arr(p.results).map(obj).map((r, i) => (
            <GateBadge key={i} action={str(obj(r?.action)?.name) ?? "action"} outcome={str(r?.outcome) ?? "?"} reasons={strs(r?.reasons)} />
          ))}
        </div>
      );
    case "gate_adjusted_amount":
      return <p><b className="font-mono">{str(p.action)}</b>: {inr(p.from)} → <b>{inr(p.to)}</b></p>;
    case "tool_call":
    case "tool_result": {
      const ok = p.ok;
      return (
        <div data-testid="tool-call" data-name={str(p.name)}>
          <div className="flex items-center gap-2">
            <span className="font-mono text-lg font-bold text-navy">{str(p.name)}</span>
            {kind === "tool_result" && (
              <span className={`rounded-full px-2 py-0.5 text-sm font-bold text-white ${ok ? "bg-green-600" : "bg-red-600"}`}>
                {p.skipped ? "skipped" : String(p.status ?? (ok ? "ok" : "error"))}
              </span>
            )}
          </div>
          {kind === "tool_call" ? <Json label="Request" value={p.params} /> : <Json label="Response" value={p.body ?? p.error} />}
        </div>
      );
    }
    case "verify":
      return (
        <ul className="text-base">
          {arr(p.checks).map(obj).map((c, i) => (
            <li key={i}>{c?.ok ? "✔" : "✘"} <span className="font-mono">{str(c?.name)}</span> → {str(c?.observed)}{c?.retried ? " (retried)" : ""}</li>
          ))}
          {arr(p.checks).length === 0 && <li>{p.ok ? "✔ verified" : "✘ verification failed"}</li>}
        </ul>
      );
    case "reply_sent":
      return (
        <div className="max-w-xl rounded-2xl rounded-bl-none bg-cyan/15 px-4 py-3">
          <div className="text-sm font-semibold text-navy">{p.holding_reply ? "Holding reply" : "Reply"} via {str(p.channel)} ({str(p.language)})</div>
          <p>{str(p.text) ?? replyDraft ?? "(reply text not stored)"}</p>
        </div>
      );
    case "status_change":
      return <p className="text-lg">{str(p.from)} → <b>{str(p.to)}</b></p>;
    case "handoff":
      return (
        <div className="space-y-1">
          <div>Team <b>{str(p.assigned_team) ?? "-"}</b> · {str(p.outcome)}</div>
          <p className="text-ink/80">{str(p.agent_summary)}</p>
          {str(p.next_action_for_human) && <p>Next: <b>{str(p.next_action_for_human)}</b></p>}
          {strs(p.errors).map((e, i) => <p key={i} className="text-red-600">{e}</p>)}
        </div>
      );
    case "approval_created":
    case "approval_requested":
      return <div><b className="font-mono">{str(p.action)}</b> needs approval <span className="text-ink/60">({str(p.approval_id)})</span><ul className="list-disc pl-6">{strs(p.reasons).map((r, i) => <li key={i}>{r}</li>)}</ul></div>;
    case "approval_decided":
      return <p>{p.approve ? "Approved" : "Rejected"} by <b>{str(p.decided_by)}</b>{str(p.note) ? `: “${str(p.note)}”` : ""}{str(p.via) ? ` (via ${str(p.via)})` : ""}</p>;
    case "override": {
      const r = obj(p.resolv_decision);
      const h = obj(p.human_decision);
      return (
        <div className="grid grid-cols-2 gap-3">
          <div className="rounded bg-light p-2"><div className="text-sm text-ink/60">Resolv</div><b>{str(r?.path) ?? "-"}</b></div>
          <div className="rounded bg-cyan/15 p-2"><div className="text-sm text-ink/60">Human</div><b>{str(h?.path)}</b>{str(h?.note) && <p>{str(h?.note)}</p>}</div>
        </div>
      );
    }
    case "error":
      return <p className="font-semibold text-red-600">{str(p.node) ? `${str(p.node)}: ` : ""}{str(p.error) ?? str(p.engine) ?? JSON.stringify(p)}</p>;
    case "pii_masked":
      return <p>Masked: {strs(p.classes).join(", ") || "nothing"}</p>;
    case "ingest":
      return <p className="font-mono text-base">{str(p.signature) ?? "no signature"} · txn {str(p.candidate_txn_id) ?? "-"}</p>;
    case "notification":
      return <p>{str(p.channel)} → <b>{str(p.target)}</b></p>;
    default: // incident_linked, incident_fast_path and any unknown kind
      return <Json label="Payload" value={p} />;
  }
}

export default function TimelineEvent({ e, replyDraft }: { e: AuditEvent; replyDraft?: string }) {
  const isErr = e.kind === "error";
  return (
    <li data-testid="timeline-event" data-kind={e.kind} className="relative pb-5 pl-8">
      <span className={`absolute -left-[9px] top-5 h-4 w-4 rounded-full ring-4 ring-light ${DOT[e.kind] ?? "bg-gray-400"}`} />
      <div className={`rounded-lg bg-white p-4 shadow-sm ${isErr ? "ring-2 ring-red-500" : ""}`}>
        <div className="mb-2 flex flex-wrap items-center gap-2">
          <span className={`text-lg font-bold ${isErr ? "text-red-600" : "text-navy"}`}>{e.kind}</span>
          {actorChip(e.actor)}
          <span className="ml-auto text-sm text-ink/60">{new Date(e.ts).toLocaleTimeString("en-IN")}</span>
        </div>
        <Body kind={e.kind} p={e.payload} replyDraft={replyDraft} />
      </div>
    </li>
  );
}
