'use client';
// One gate result: AUTO_EXECUTE green, NEEDS_APPROVAL amber, BLOCKED red, HUMAN_ONLY grey.
const COLOR: Record<string, string> = {
  AUTO_EXECUTE: "bg-green-600 text-white",
  NEEDS_APPROVAL: "bg-amber-400 text-ink",
  BLOCKED: "bg-red-600 text-white",
  HUMAN_ONLY: "bg-gray-400 text-ink",
};

export default function GateBadge({ action, outcome, reasons }: { action: string; outcome: string; reasons: string[] }) {
  return (
    <div data-testid="gate-badge" data-outcome={outcome} className="rounded-lg border border-navy/10 bg-light p-3">
      <div className="flex flex-wrap items-center gap-3">
        <span className="font-mono text-lg font-bold text-navy">{action}</span>
        <span className={`rounded-full px-3 py-1 text-base font-bold ${COLOR[outcome] ?? "bg-gray-300 text-ink"}`}>{outcome}</span>
      </div>
      {reasons.length > 0 && (
        <ul className="mt-2 list-disc pl-6 text-base text-ink/80">
          {reasons.map((r, i) => <li key={i}>{r}</li>)}
        </ul>
      )}
    </div>
  );
}
