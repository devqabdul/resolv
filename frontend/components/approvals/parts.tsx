'use client';
// (decision: UI-1) Approvals page pieces: stat cards, sidebar, decided cards, run-state narrowing.
import Link from "next/link";
import {
  CheckIcon,
  ClockIcon,
  ShieldCheckIcon,
  WarningCircleIcon,
  XIcon,
  type Icon,
} from "@phosphor-icons/react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardAction, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Separator } from "@/components/ui/separator";
import { Skeleton } from "@/components/ui/skeleton";
import AnimatedNumber from "@/components/animated-number";
import { toneBadge } from "@/components/status-tone";
import { ago } from "@/lib/format";
import type { ApprovalItem, TicketDetail } from "@/lib/api";
import { cn } from "@/lib/utils";

export const inr = (n: number) => `₹${n.toLocaleString("en-IN")}`;
const REF_KEYS = ["txn_id", "settlement_id", "mandate_id", "kyc_id", "refund_id"];

const ACTION_LABEL: Record<string, string> = { initiate_reversal: "Initiate reversal (refund)" };
const CHANNEL_LABEL: Record<string, string> = { in_app_chat: "In-app chat", merchant_portal: "Merchant portal", whatsapp: "WhatsApp" };
const sentence = (s: string) => {
  const t = s.replace(/_/g, " ").toLowerCase();
  return t.charAt(0).toUpperCase() + t.slice(1);
};
export const actionLabel = (name: string) => ACTION_LABEL[name] ?? sentence(name);
export const channelLabel = (c: string) => CHANNEL_LABEL[c] ?? sentence(c);

export function actionParts(a: Record<string, unknown>) {
  const p = (a.params ?? {}) as Record<string, unknown>;
  const refKey = REF_KEYS.find((k) => typeof p[k] === "string");
  return {
    name: String(a.name ?? "action"),
    rationale: typeof a.rationale === "string" ? a.rationale : "",
    amount: typeof p.amount_inr === "number" ? p.amount_inr : null,
    refKey: refKey ?? null,
    ref: refKey ? String(p[refKey]) : null,
  };
}

export function reasonList(r: unknown): string[] {
  if (Array.isArray(r)) return r.map((x) => (typeof x === "string" ? x : JSON.stringify(x)));
  return r ? [typeof r === "string" ? r : JSON.stringify(r)] : [];
}

/** "31 Oct 2026, 07:21 AM" */
export function stamp(ts: string) {
  const d = new Date(ts);
  return `${d.toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" })}, ${d.toLocaleTimeString("en-US", { hour: "2-digit", minute: "2-digit" })}`;
}

export function dur(ms: number) {
  const s = Math.max(0, Math.round(ms / 1000));
  if (s < 60) return `${s}s`;
  if (s < 3600) return `${Math.floor(s / 60)}m`;
  if (s < 86400) return `${Math.floor(s / 3600)}h`;
  return `${Math.floor(s / 86400)}d`;
}

// ---- run.state narrowing (shape per docs/02 ContextBundle / GateResult) ----
export interface RunTxn { id: string; amount_inr: number; method: string; status: string; issuer_bank: string | null; created_at: string }
export interface GateRow { action: Record<string, unknown>; outcome: string; reasons: string[] }
export interface RunView {
  customer: { id: string; name: string | null; phone_masked: string | null; vpa_masked: string | null } | null;
  txns: RunTxn[];
  clock: { days_since_txn: number; days_late: number } | null;
  gate: GateRow[];
}

const obj = (v: unknown): Record<string, unknown> | null => (v && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>) : null);
const str = (v: unknown) => (typeof v === "string" ? v : null);

export function runView(detail: TicketDetail | undefined): RunView | null {
  const st = obj(detail?.run?.state);
  if (!st) return null;
  const ctx = obj(st.context);
  const cust = obj(ctx?.customer);
  const clock = obj(ctx?.regulatory_clock);
  const gate = obj(st.gate);
  return {
    customer: cust
      ? { id: String(cust.id), name: str(cust.name), phone_masked: str(cust.phone_masked), vpa_masked: str(cust.vpa_masked) }
      : null,
    txns: Array.isArray(ctx?.transactions) ? (ctx.transactions as RunTxn[]) : [],
    clock: clock && typeof clock.days_since_txn === "number"
      ? { days_since_txn: clock.days_since_txn, days_late: Number(clock.days_late ?? 0) }
      : null,
    gate: Array.isArray(gate?.results) ? (gate.results as GateRow[]) : [],
  };
}

/** RBI TAT in days by rail: UPI/IMPS/wallet T+1, card T+5. */
export const tatDays = (method: string) => (method.toLowerCase().includes("card") ? 5 : 1);

// ---- stat cards ----
type Stat = { id: string; label: string; value: number | null; format?: (n: number) => string; icon: Icon; tint: string };

export function StatCards({ pending, approved, rejected, now }: { pending?: ApprovalItem[]; approved?: ApprovalItem[]; rejected?: ApprovalItem[]; now: number }) {
  const today = new Date(now).toDateString();
  const decidedToday = (l?: ApprovalItem[]) => (l ? l.filter((a) => a.decided_at && new Date(a.decided_at).toDateString() === today).length : null);
  const waits = (pending ?? []).map((a) => now - new Date(a.requested_at).getTime()).sort((a, b) => a - b);
  const median = waits.length ? (waits.length % 2 ? waits[(waits.length - 1) / 2] : (waits[waits.length / 2 - 1] + waits[waits.length / 2]) / 2) : null;
  const stats: Stat[] = [
    { id: "pending", label: "Pending approvals", value: pending ? pending.length : null, icon: ClockIcon, tint: "bg-status-awaiting/12 text-status-awaiting" },
    { id: "p1", label: "High priority", value: pending ? pending.filter((a) => a.ticket?.priority === "P1").length : null, icon: WarningCircleIcon, tint: "bg-status-failed/12 text-status-failed" },
    { id: "median-wait", label: "Median wait time", value: pending ? median : null, format: dur, icon: ClockIcon, tint: "bg-highlight/12 text-highlight-text" },
    { id: "approved-today", label: "Approved today", value: decidedToday(approved), icon: CheckIcon, tint: "bg-status-resolved/12 text-status-resolved" },
    { id: "rejected-today", label: "Rejected today", value: decidedToday(rejected), icon: XIcon, tint: "bg-status-failed/12 text-status-failed" },
  ];
  return (
    <section className="grid grid-cols-2 gap-4 md:grid-cols-3 xl:grid-cols-5">
      {stats.map((s) => (
        <Card key={s.id} data-testid={`approvals-stat-${s.id}`} size="sm" className="shadow-sm">
          <CardContent className="flex items-start justify-between gap-3">
            <div className="flex min-w-0 flex-col gap-1">
              <div className="font-mono text-3xl font-semibold tracking-tight tabular-nums">
                {s.value === null ? (pending ? "-" : <Skeleton className="h-9 w-12" />) : s.format ? s.format(s.value) : <AnimatedNumber value={s.value} />}
              </div>
              <div className="text-sm leading-snug whitespace-nowrap text-muted-foreground">{s.label}</div>
            </div>
            <div className={cn("flex size-9 shrink-0 items-center justify-center rounded-lg", s.tint)}>
              <s.icon weight="bold" className="size-5" />
            </div>
          </CardContent>
        </Card>
      ))}
    </section>
  );
}

// ---- sidebar ----
export function Safeguards({ txnRef }: { txnRef: string | null }) {
  const rows = [
    ["Policy gate enforced", "Action validated against rules.yaml"],
    ["Transaction reference verified", txnRef ? `${txnRef} exists in customer ledger` : "Referenced ids exist in customer ledger"],
    ["Idempotency protection", "No duplicate execution on retries"],
    ["Full audit trail", "All actions are logged with reviewer details"],
  ];
  return (
    <Card data-testid="approvals-safeguards">
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <ShieldCheckIcon weight="duotone" className="size-5 text-primary" />
          Approval safeguards
        </CardTitle>
      </CardHeader>
      <CardContent className="flex flex-col gap-4">
        {rows.map(([t, d]) => (
          <div key={t} className="flex items-start gap-3">
            <div className="flex size-6 shrink-0 items-center justify-center rounded-full bg-status-resolved/12 text-status-resolved">
              <CheckIcon weight="bold" className="size-3.5" />
            </div>
            <div className="flex min-w-0 flex-col">
              <span className="font-medium">{t}</span>
              <span className="text-muted-foreground break-words">{d}</span>
            </div>
          </div>
        ))}
      </CardContent>
    </Card>
  );
}

const decidedTone = (s: string) => toneBadge({ tone: s === "APPROVED" ? "resolved" : "failed" });

export function RecentDecisions({ items, now, onViewAll }: { items: ApprovalItem[] | null; now: number; onViewAll: () => void }) {
  return (
    <Card data-testid="approvals-recent">
      <CardHeader>
        <CardTitle>Recent approval decisions</CardTitle>
        <CardAction>
          <Button variant="link" size="sm" onClick={onViewAll}>View all</Button>
        </CardAction>
      </CardHeader>
      <CardContent className="flex flex-col">
        {!items ? (
          <div className="flex flex-col gap-3">
            <Skeleton className="h-10 w-full" />
            <Skeleton className="h-10 w-full" />
          </div>
        ) : items.length === 0 ? (
          <p className="text-muted-foreground">No decisions yet.</p>
        ) : (
          items.map((a, i) => {
            const act = actionParts(a.action_json);
            const ok = a.status === "APPROVED";
            return (
              <div key={a.id}>
                {i > 0 && <Separator className="my-3" />}
                <div className="flex items-start gap-3">
                  <div className={cn("flex size-6 shrink-0 items-center justify-center rounded-full", ok ? "bg-status-resolved/12 text-status-resolved" : "bg-status-failed/12 text-status-failed")}>
                    {ok ? <CheckIcon weight="bold" className="size-3.5" /> : <XIcon weight="bold" className="size-3.5" />}
                  </div>
                  <div className="flex min-w-0 flex-1 flex-col gap-0.5">
                    <Link href={`/tickets/${a.ticket_id}`} className="font-mono text-sm underline-offset-4 hover:underline">{a.ticket_id}</Link>
                    <span className="break-words">
                      {actionLabel(act.name)}
                      {act.amount !== null && <span className="whitespace-nowrap font-mono tabular-nums"> {inr(act.amount)}</span>}
                    </span>
                    <span className="text-xs text-muted-foreground">
                      by {a.decided_by ?? "-"}
                      {a.decided_at && <> • {ago(a.decided_at, now)}</>}
                    </span>
                  </div>
                  <Badge className={decidedTone(a.status)}>{a.status}</Badge>
                </div>
              </div>
            );
          })
        )}
      </CardContent>
    </Card>
  );
}

// ---- Approved / Rejected tab cards ----
export function DecidedCard({ item }: { item: ApprovalItem }) {
  const act = actionParts(item.action_json);
  return (
    <Card size="sm" data-testid="approval-decided-card" data-approval-id={item.id} data-ticket-id={item.ticket_id}>
      <CardHeader>
        <CardTitle className="flex flex-wrap items-center gap-2">
          <Link href={`/tickets/${item.ticket_id}`} className="font-mono text-sm underline-offset-4 hover:underline">{item.ticket_id}</Link>
          <span>{actionLabel(act.name)}</span>
          {act.amount !== null && <span className="font-mono tabular-nums">{inr(act.amount)}</span>}
        </CardTitle>
        <CardDescription>
          by {item.decided_by ?? "-"}
          {item.decided_at && <> • <span className="font-mono tabular-nums">{stamp(item.decided_at)}</span></>}
        </CardDescription>
        <CardAction>
          <Badge className={decidedTone(item.status)}>{item.status}</Badge>
        </CardAction>
      </CardHeader>
      {item.note && <CardContent className="text-muted-foreground">{item.note}</CardContent>}
    </Card>
  );
}
