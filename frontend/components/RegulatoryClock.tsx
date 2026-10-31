'use client';
// RBI TAT clock from run.state.context.regulatory_clock; dashes when there is no candidate txn.
// T+N and the per-day rate are derived from the clock itself (days_since - days_late, comp / days_late),
// so they only show once the txn is late (before that days_late is 0 and N is not recoverable).
import { ClockIcon } from "@phosphor-icons/react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { cn } from "@/lib/utils";
import { fmtDate, inr, num, str, type Obj } from "./TimelineEvent";

export default function RegulatoryClock({ clock }: { clock: Obj | null }) {
  const since = num(clock?.days_since_txn);
  const daysLate = num(clock?.days_late);
  const comp = num(clock?.compensation_due_inr);
  const late = (daysLate ?? 0) > 0;
  const deadline = str(clock?.tat_deadline);
  const tatDays = since !== undefined && daysLate !== undefined ? since - daysLate : undefined;
  const cells: [string, string, string | undefined, boolean][] = [
    ["Days since txn", String(since ?? "-"), undefined, false],
    ["RBI TAT deadline", deadline ? fmtDate(deadline) : "-", late && tatDays !== undefined ?`(T+${tatDays} days)` : undefined, false],
    ["Days late", String(daysLate ?? "-"), undefined, late],
    ["Compensation due", comp === undefined ? "-" : inr(comp), comp && daysLate ? `(${inr(comp / daysLate)} × ${daysLate} days)` : undefined, (comp ?? 0) > 0],
  ];
  return (
    <Card data-testid="regulatory-clock" data-late={late}>
      <CardHeader>
        <CardTitle className="flex items-center gap-2"><ClockIcon className="text-muted-foreground" />RBI regulatory clock</CardTitle>
      </CardHeader>
      <CardContent>
        <dl className="grid grid-cols-2 gap-y-4 sm:grid-cols-4 sm:divide-x">
          {cells.map(([label, value, hint, bad]) => (
            <div key={label} className="flex flex-col gap-1 px-3 first:pl-0">
              <dt className="text-sm text-muted-foreground">{label}</dt>
              <dd className={cn("font-mono text-2xl font-semibold tabular-nums", bad && "text-status-failed")}>{value}</dd>
              {hint && <dd className="font-mono text-xs text-muted-foreground tabular-nums">{hint}</dd>}
            </div>
          ))}
        </dl>
      </CardContent>
    </Card>
  );
}
