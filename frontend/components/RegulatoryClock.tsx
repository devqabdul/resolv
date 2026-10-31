'use client';
import { num, str, type Obj } from "./TimelineEvent";

// RBI TAT clock from run.state.context.regulatory_clock; dashes when there is no candidate txn.
export default function RegulatoryClock({ clock }: { clock: Obj | null }) {
  const late = (num(clock?.days_late) ?? 0) > 0;
  const deadline = str(clock?.tat_deadline);
  const comp = num(clock?.compensation_due_inr);
  const cells: [string, string][] = [
    ["Days since txn", String(num(clock?.days_since_txn) ?? "-")],
    ["TAT deadline", deadline ? new Date(deadline).toLocaleDateString("en-IN", { day: "numeric", month: "short" }) : "-"],
    ["Days late", String(num(clock?.days_late) ?? "-")],
    ["Compensation due", comp === undefined ? "-" : `₹${comp.toLocaleString("en-IN")}`],
  ];
  return (
    <section data-testid="regulatory-clock" data-late={late} className={`rounded-xl p-5 shadow-sm ${late ? "bg-red-50 ring-2 ring-red-500" : "bg-white"}`}>
      <h2 className="mb-3 text-xl font-bold text-navy">RBI regulatory clock</h2>
      <div className="grid grid-cols-2 gap-4">
        {cells.map(([label, value], i) => (
          <div key={label}>
            <div className="text-sm font-semibold uppercase text-ink/60">{label}</div>
            <div className={`text-3xl font-bold ${late && i >= 2 ? "text-red-600" : "text-navy"}`}>{value}</div>
          </div>
        ))}
      </div>
    </section>
  );
}
