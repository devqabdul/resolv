'use client';
// Customer (or merchant) profile card and the candidate transaction card, from run.state.context.
import type { ReactNode } from "react";
import { CreditCardIcon, StorefrontIcon, UserIcon } from "@phosphor-icons/react";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { toneBadge } from "@/components/status-tone";
import { arr, fmtDate, fmtDateTime, inr, obj, str, type Obj } from "./TimelineEvent";

const TXN_TONE: Record<string, "failed" | "awaiting" | "resolved" | "new"> = {
  DEBITED_NOT_CREDITED: "failed", PENDING: "awaiting", SUCCESS: "resolved", REVERSED: "resolved",
};

const years = (iso: string) => ((Date.now() - new Date(iso).getTime()) / (365.25 * 864e5)).toFixed(1);

type Fact = [label: string, value: ReactNode, mono?: boolean];

function Facts({ facts, cols }: { facts: Fact[]; cols: string }) {
  return (
    <dl className={`grid gap-x-6 gap-y-3 ${cols}`}>
      {facts.map(([k, v, mono]) => (
        <div key={k} className="flex min-w-0 flex-col gap-0.5">
          <dt className="text-sm text-muted-foreground">{k}</dt>
          <dd className={mono ? "break-words font-mono text-sm tabular-nums" : "break-words font-medium"}>{v}</dd>
        </div>
      ))}
    </dl>
  );
}

export default function ContextCard({ context, candidateTxnId }: { context: Obj | null; candidateTxnId: string | null }) {
  const cust = obj(context?.customer);
  const mer = obj(context?.merchant);
  const txn = arr(context?.transactions).map(obj).find((t) => t && t.id === candidateTxnId) ?? null;
  const merchantOnly = !!mer && !cust;
  const who = merchantOnly ? mer : cust;
  const since = str(cust?.since);
  const facts = (merchantOnly
    ? ([["Merchant ID", str(mer?.id), true], ["KYC status", str(mer?.kyc_status), true], ["Settlement cycle", str(mer?.settlement_cycle)]] as Fact[])
    : ([
        ["Customer ID", str(cust?.id), true],
        ["Phone", str(cust?.phone_masked), true],
        ["Customer since", since ? <>{fmtDate(since)} <span className="text-muted-foreground">({years(since)} years)</span></> : undefined],
      ] as Fact[])
  ).filter((f) => f[1] !== undefined);
  const method = [str(txn?.method)?.toUpperCase(), str(txn?.issuer_bank)].filter(Boolean).join(" • ");

  return (
    <>
      <Card data-testid="customer-card">
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            {merchantOnly ? <StorefrontIcon className="text-muted-foreground" /> : <UserIcon className="text-muted-foreground" />}
            {merchantOnly ? "Merchant profile" : "Customer profile"}
          </CardTitle>
        </CardHeader>
        <CardContent className="flex flex-col gap-4">
          {!who ? (
            <p className="text-muted-foreground">No ledger context yet. It appears after the agent runs.</p>
          ) : (
            <>
              <div className="flex flex-wrap items-center gap-2">
                <span className="text-lg font-semibold">{str(who.name) ?? str(who.id)}</span>
                {str(cust?.tier) && <Badge className="h-6 rounded-full bg-highlight/12 px-2.5 text-sm font-medium text-highlight-text capitalize">{str(cust?.tier)}</Badge>}
              </div>
              <Facts facts={facts} cols="grid-cols-2" />
            </>
          )}
        </CardContent>
      </Card>
      {txn && (
        <Card data-testid="candidate-txn">
          <CardHeader>
            <CardTitle className="flex items-center gap-2"><CreditCardIcon className="text-muted-foreground" />Transaction details</CardTitle>
          </CardHeader>
          <CardContent className="flex flex-col gap-4">
            <span className="font-mono text-3xl font-semibold tabular-nums">{inr(txn.amount_inr)}</span>
            <Facts
              cols="grid-cols-2"
              facts={([
                ["Transaction ID", str(txn.id), true],
                ["Date & time", str(txn.created_at) ? fmtDateTime(str(txn.created_at) as string) : undefined, true],
                ["Payment method", method || undefined],
                ["Status", str(txn.status) ? <Badge className={toneBadge({ tone: TXN_TONE[str(txn.status) ?? ""] ?? "new", className: "h-auto max-w-full whitespace-normal break-all font-mono text-xs" })}>{str(txn.status)}</Badge> : undefined],
                ["Failure reason", str(txn.failure_reason), true],
              ] as Fact[]).filter((f) => f[1] !== undefined)}
            />
          </CardContent>
        </Card>
      )}
    </>
  );
}
