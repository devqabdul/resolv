'use client';
// RBI TAT clock from run.state.context.regulatory_clock; dashes when there is no candidate txn.
import { Badge } from "@/components/ui/badge";
import { Card, CardAction, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { toneBadge } from "@/components/status-tone";
import { cn } from "@/lib/utils";
import { inr, num, str, type Obj } from "./TimelineEvent";

export default function RegulatoryClock({ clock }: { clock: Obj | null }) {
  const daysLate = num(clock?.days_late);
  const comp = num(clock?.compensation_due_inr);
  const late = (daysLate ?? 0) > 0;
  const deadline = str(clock?.tat_deadline);
  const cells: [string, string, boolean][] = [
    ["Days since txn", String(num(clock?.days_since_txn) ?? "-"), false],
    ["TAT deadline", deadline ? new Date(deadline).toLocaleDateString("en-IN", { day: "numeric", month: "short" }) : "-", false],
    ["Days late", String(daysLate ?? "-"), late],
    ["Compensation due", comp === undefined ? "-" : inr(comp), (comp ?? 0) > 0],
  ];
  return (
    <Card data-testid="regulatory-clock" data-late={late}>
      <CardHeader>
        <CardTitle>RBI regulatory clock</CardTitle>
        {late && <CardAction><Badge className={toneBadge({ tone: "failed" })}>Past TAT</Badge></CardAction>}
      </CardHeader>
      <CardContent>
        <dl className="grid grid-cols-2 gap-px overflow-hidden rounded-lg border bg-border">
          {cells.map(([label, value, bad]) => (
            <div key={label} className="flex flex-col gap-1 bg-card p-3">
              <dt className="text-sm text-muted-foreground">{label}</dt>
              <dd className={cn("font-mono text-3xl font-semibold tabular-nums", bad && "text-status-failed")}>{value}</dd>
            </div>
          ))}
        </dl>
      </CardContent>
    </Card>
  );
}
