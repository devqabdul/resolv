'use client';
// One gate result: AUTO_EXECUTE emerald, NEEDS_APPROVAL amber, BLOCKED red, HUMAN_ONLY slate.
import { Badge } from "@/components/ui/badge";
import { GATE_TONE, toneBadge } from "@/components/status-tone";

export default function GateBadge({ action, outcome, reasons }: { action: string; outcome: string; reasons: string[] }) {
  return (
    <div data-testid="gate-badge" data-outcome={outcome} className="flex flex-col gap-2 rounded-lg border bg-muted/40 p-3">
      <div className="flex flex-wrap items-center gap-3">
        <span className="font-mono text-sm font-medium">{action}</span>
        <Badge className={toneBadge({ tone: GATE_TONE[outcome] })}>{outcome}</Badge>
      </div>
      {reasons.length > 0 && (
        <ul className="list-disc pl-5 text-sm text-muted-foreground">
          {reasons.map((r, i) => <li key={i}>{r}</li>)}
        </ul>
      )}
    </div>
  );
}
