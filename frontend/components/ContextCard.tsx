'use client';
import { arr, num, obj, str, type Obj } from "./TimelineEvent";

// Customer or merchant profile plus the candidate transaction, from run.state.context.
export default function ContextCard({ context, candidateTxnId }: { context: Obj | null; candidateTxnId: string | null }) {
  const cust = obj(context?.customer);
  const mer = obj(context?.merchant);
  const txn = arr(context?.transactions).map(obj).find((t) => t && t.id === candidateTxnId) ?? null;
  const amount = num(txn?.amount_inr);
  const rows: [string, string | undefined][] = cust
    ? [["Customer", str(cust.name)], ["Tier", str(cust.tier)], ["Phone", str(cust.phone_masked)], ["Since", str(cust.since)]]
    : mer
      ? [["Merchant", str(mer.name)], ["KYC", str(mer.kyc_status)], ["Settlement", str(mer.settlement_cycle)]]
      : [];
  return (
    <section data-testid="customer-card" className="rounded-xl bg-white p-5 shadow-sm">
      <h2 className="mb-3 text-xl font-bold text-navy">{mer && !cust ? "Merchant" : "Customer"}</h2>
      {rows.length === 0 && <p className="text-lg text-ink/60">No context yet.</p>}
      <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1 text-lg">
        {rows.map(([k, v]) => (
          <div key={k} className="contents"><dt className="text-ink/60">{k}</dt><dd className="font-semibold">{v ?? "-"}</dd></div>
        ))}
      </dl>
      {txn && (
        <div data-testid="candidate-txn" className="mt-4 rounded-lg bg-light p-4">
          <div className="flex flex-wrap items-baseline justify-between gap-2">
            <span className="font-mono text-base text-navy">{str(txn.id)}</span>
            <span className="text-3xl font-bold text-navy">{amount === undefined ? "-" : `₹${amount.toLocaleString("en-IN")}`}</span>
          </div>
          <div className="mt-1 text-base text-ink/80">
            {[str(txn.method)?.toUpperCase(), str(txn.issuer_bank), str(txn.failure_reason)].filter(Boolean).join(" · ")}
          </div>
          <span className="mt-2 inline-block rounded bg-amber-400 px-2 py-0.5 text-sm font-bold text-ink">{str(txn.status)}</span>
        </div>
      )}
    </section>
  );
}
