'use client';
// Customer or merchant profile plus the candidate transaction, from run.state.context.
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { toneBadge } from "@/components/status-tone";
import { arr, inr, obj, str, type Obj } from "./TimelineEvent";

const TXN_TONE: Record<string, "failed" | "awaiting" | "resolved" | "new"> = {
  DEBITED_NOT_CREDITED: "failed", PENDING: "awaiting", SUCCESS: "resolved", REVERSED: "resolved",
};

export default function ContextCard({ context, candidateTxnId }: { context: Obj | null; candidateTxnId: string | null }) {
  const cust = obj(context?.customer);
  const mer = obj(context?.merchant);
  const txn = arr(context?.transactions).map(obj).find((t) => t && t.id === candidateTxnId) ?? null;
  const rows: [string, string | undefined, boolean?][] = cust
    ? [["Tier", str(cust.tier)], ["Phone", str(cust.phone_masked), true], ["Customer since", str(cust.since), true]]
    : mer
      ? [["KYC", str(mer.kyc_status), true], ["Settlement", str(mer.settlement_cycle)]]
      : [];
  const merchantOnly = !!mer && !cust;
  const name = str((merchantOnly ? mer : cust)?.name);
  return (
    <Card data-testid="customer-card">
      <CardHeader>
        <CardTitle>{merchantOnly ? "Merchant" : "Customer"}</CardTitle>
        {name && <CardDescription className="text-lg font-medium text-foreground">{name}</CardDescription>}
      </CardHeader>
      <CardContent className="flex flex-col gap-4">
        {rows.length === 0 ? (
          <p className="text-muted-foreground">No ledger context yet. It appears after the agent runs.</p>
        ) : (
          <dl className="grid grid-cols-[auto_minmax(0,1fr)] gap-x-6 gap-y-1.5 text-base">
            {rows.map(([k, v, mono]) => (
              <div key={k} className="contents">
                <dt className="text-muted-foreground">{k}</dt>
                <dd className={mono ? "font-mono tabular-nums" : "font-medium capitalize"}>{v ?? "-"}</dd>
              </div>
            ))}
          </dl>
        )}
        {txn && (
          <div data-testid="candidate-txn" className="flex flex-col gap-3 rounded-lg border bg-muted/40 p-4">
            <div className="flex flex-wrap items-baseline justify-between gap-2">
              <span className="font-mono text-sm text-muted-foreground">{str(txn.id)}</span>
              <span className="font-mono text-3xl font-semibold tabular-nums">{inr(txn.amount_inr)}</span>
            </div>
            <div className="flex flex-wrap items-center gap-2">
              {str(txn.method) && <Badge variant="outline" className="h-6 px-2.5 font-mono text-sm uppercase">{str(txn.method)}</Badge>}
              {str(txn.issuer_bank) && <Badge variant="outline" className="h-6 px-2.5 font-mono text-sm">{str(txn.issuer_bank)}</Badge>}
              {str(txn.failure_reason) && <Badge variant="outline" className="h-6 px-2.5 font-mono text-sm font-normal">{str(txn.failure_reason)}</Badge>}
            </div>
            {str(txn.status) && (
              <Badge className={toneBadge({ tone: TXN_TONE[str(txn.status) ?? ""] ?? "new", className: "font-mono" })}>{str(txn.status)}</Badge>
            )}
          </div>
        )}
      </CardContent>
    </Card>
  );
}
