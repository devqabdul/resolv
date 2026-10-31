'use client';
// Consecutive tool_call/tool_result events as one timeline row. Each call/result pair is a
// sub-row; its call half and result half keep their own `timeline-event` + `data-kind` so the
// element count still equals the audit event count.
import { CaretRightIcon, CheckCircleIcon, CircleDashedIcon, MinusCircleIcon, XCircleIcon } from "@phosphor-icons/react";
import { Badge } from "@/components/ui/badge";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { toneBadge } from "@/components/status-tone";
import { Json, Row, obj, str, type Dot } from "@/components/TimelineEvent";
import type { AuditEvent } from "@/lib/api";

export interface ToolPair { call?: AuditEvent; result?: AuditEvent }

// Mock Paytm routes, from backend/app/integrations/paytm/client.py.
const ENDPOINT: Record<string, string> = {
  get_customer: "GET /v1/customers/{customer_id}", get_merchant: "GET /v1/merchants/{merchant_id}",
  list_transactions: "GET /v1/transactions", get_transaction: "GET /v1/transactions/{txn_id}",
  initiate_reversal: "POST /v1/refunds", get_refund: "GET /v1/refunds/{refund_id}",
  credit_compensation: "POST /v1/compensations", list_settlements: "GET /v1/settlements",
  retrigger_settlement: "POST /v1/settlements/{settlement_id}/retrigger", get_kyc: "GET /v1/kyc/{entity_id}",
  retrigger_kyc: "POST /v1/kyc/{entity_id}/retrigger", list_mandates: "GET /v1/mandates",
  cancel_mandate: "POST /v1/mandates/{mandate_id}/cancel", notify_customer: "POST /v1/notifications",
};

function endpoint(name: string, params: Record<string, unknown>) {
  const t = ENDPOINT[name];
  return t ? t.replace(/\{(\w+)\}/g, (_, k: string) => String(params[k] ?? k)) : name;
}

function paramsSummary(params: Record<string, unknown>) {
  return Object.entries(params)
    .filter(([k]) => k !== "idempotency_key")
    .map(([k, v]) => `${k}=${typeof v === "object" ? JSON.stringify(v) : String(v)}`)
    .join(", ");
}

function refOf(body: unknown) {
  if (Array.isArray(body)) return `${body.length} item${body.length === 1 ? "" : "s"}`;
  const b = obj(body);
  return str(b?.refund_id) ?? str(b?.compensation_id) ?? str(b?.id) ?? str(b?.status);
}

function state(r: AuditEvent | undefined): "COMPLETED" | "FAILED" | "SKIPPED" | "PENDING" {
  if (!r) return "PENDING";
  if (r.payload.skipped) return "SKIPPED";
  return r.payload.ok ? "COMPLETED" : "FAILED";
}

const STATE_ICON = {
  COMPLETED: <CheckCircleIcon weight="fill" className="size-4 shrink-0 text-status-resolved" />,
  FAILED: <XCircleIcon weight="fill" className="size-4 shrink-0 text-status-failed" />,
  SKIPPED: <MinusCircleIcon weight="fill" className="size-4 shrink-0 text-status-new" />,
  PENDING: <CircleDashedIcon className="size-4 shrink-0 text-muted-foreground" />,
};
const STATE_TONE = { COMPLETED: "resolved", FAILED: "failed", SKIPPED: "new", PENDING: "awaiting" } as const;

function PairRow({ pair }: { pair: ToolPair }) {
  const name = str((pair.call ?? pair.result)?.payload.name) ?? "tool";
  const params = obj(pair.call?.payload.params) ?? {};
  const s = state(pair.result);
  const ref = pair.result ? refOf(pair.result.payload.body) : undefined;
  return (
    <Collapsible asChild>
      <li data-testid="tool-call" data-name={name} className="flex flex-col px-3 py-2">
        <CollapsibleTrigger className="group/tc flex w-full items-center gap-3 text-left outline-none focus-visible:ring-3 focus-visible:ring-ring/50">
          {pair.call ? (
            <span data-testid="timeline-event" data-kind="tool_call" className="flex min-w-0 flex-1 items-center gap-2 overflow-hidden">
              {STATE_ICON[s]}
              <span className="min-w-0 truncate font-mono text-sm font-medium">{endpoint(name, params)}</span>
              <span className="min-w-0 flex-1 basis-0 truncate font-mono text-xs text-muted-foreground">{paramsSummary(params)}</span>
            </span>
          ) : (
            <span className="flex min-w-0 flex-1 items-center gap-2">
              {STATE_ICON[s]}
              <span className="font-mono text-sm font-medium">{name}</span>
            </span>
          )}
          {pair.result ? (
            <span data-testid="timeline-event" data-kind="tool_result" className="flex shrink-0 items-center gap-2">
              {ref && <span className="max-w-32 truncate font-mono text-xs text-muted-foreground">{ref}</span>}
              <Badge className={toneBadge({ tone: STATE_TONE[s], className: "font-mono text-xs" })}>{s}</Badge>
            </span>
          ) : (
            <Badge className={toneBadge({ tone: STATE_TONE[s], className: "font-mono text-xs" })}>{s}</Badge>
          )}
          <CaretRightIcon aria-hidden className="size-3.5 shrink-0 text-muted-foreground transition-transform group-data-[state=open]/tc:rotate-90 motion-reduce:transition-none" />
        </CollapsibleTrigger>
        <CollapsibleContent className="overflow-hidden data-[state=closed]:animate-collapsible-up data-[state=open]:animate-collapsible-down motion-reduce:animate-none">
          <div className="grid gap-2 pt-2 md:grid-cols-2">
            <div className="flex min-w-0 flex-col gap-1"><span className="text-xs text-muted-foreground">Request</span><Json value={pair.call?.payload.params ?? null} /></div>
            <div className="flex min-w-0 flex-col gap-1"><span className="text-xs text-muted-foreground">Response</span><Json value={pair.result ? (pair.result.payload.body ?? pair.result.payload.error ?? null) : null} /></div>
          </div>
        </CollapsibleContent>
      </li>
    </Collapsible>
  );
}

export default function ToolCallGroup({ pairs, n, beforeUnderstanding, enter, fresh }: {
  pairs: ToolPair[]; n: number; beforeUnderstanding: boolean; enter?: number; fresh?: boolean;
}) {
  const first = pairs[0].call ?? pairs[0].result;
  const states = pairs.map((p) => state(p.result));
  const done = states.filter((x) => x === "COMPLETED").length;
  const dot: Dot = states.includes("FAILED") ? "bad" : states.includes("PENDING") ? "info" : "ok";
  const names = [...new Set(pairs.map((p) => str((p.call ?? p.result)?.payload.name) ?? "tool"))];
  return (
    <Row
      n={n}
      ts={first?.ts ?? ""}
      dot={dot}
      title={beforeUnderstanding ? "Context fetched" : "Tool calls executed"}
      summary={`${pairs.length} call${pairs.length === 1 ? "" : "s"}, ${done} completed: ${names.join(", ")}`}
      kind="tool_call"
      defaultOpen
      enter={enter}
      fresh={fresh}
      details={<ul className="flex flex-col divide-y rounded-lg border">{pairs.map((p, i) => <PairRow key={(p.call ?? p.result)?.id ?? i} pair={p} />)}</ul>}
    />
  );
}
