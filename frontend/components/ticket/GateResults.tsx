'use client';
// Policy gate details: one row per proposed action with its outcome and reasons, plus the
// "LLM proposes, policy gate authorizes" callout.
import { CheckCircleIcon, ShieldCheckIcon, UserCircleIcon, WarningCircleIcon, XCircleIcon } from "@phosphor-icons/react";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { GATE_TONE, toneBadge } from "@/components/status-tone";
import { humanAction, inr, obj, str, strs } from "@/components/TimelineEvent";
import { cn } from "@/lib/utils";

const ICON = {
  AUTO_EXECUTE: [CheckCircleIcon, "text-status-resolved"],
  NEEDS_APPROVAL: [WarningCircleIcon, "text-status-awaiting"],
  BLOCKED: [XCircleIcon, "text-status-failed"],
  HUMAN_ONLY: [UserCircleIcon, "text-status-new"],
} as const;

export default function GateResults({ results }: { results: unknown[] }) {
  return (
    <div className="flex flex-col gap-3">
      <ul className="flex flex-col divide-y rounded-lg border">
        {results.map(obj).map((r, i) => {
          const a = obj(r?.action);
          const outcome = str(r?.outcome) ?? "?";
          const amount = obj(a?.params)?.amount_inr;
          const reasons = strs(r?.reasons);
          const [I, color] = ICON[outcome as keyof typeof ICON] ?? ICON.HUMAN_ONLY;
          return (
            <li key={i} data-testid="gate-badge" data-outcome={outcome} className="grid grid-cols-[auto_minmax(0,1fr)_auto] items-start gap-x-3 gap-y-1 px-3 py-2.5">
              <I weight="fill" className={cn("mt-0.5 size-5", color)} />
              <div className="flex min-w-0 flex-col gap-0.5">
                <span className="font-medium">
                  Action {i + 1}: {humanAction(str(a?.name))}
                  {typeof amount === "number" && <span className="font-mono tabular-nums"> {inr(amount)}</span>}
                </span>
                {reasons.length > 0 && <span className="text-sm text-muted-foreground">Reason: {reasons.join("; ")}</span>}
              </div>
              <Badge className={toneBadge({ tone: GATE_TONE[outcome], className: "font-mono text-xs" })}>{outcome}</Badge>
            </li>
          );
        })}
      </ul>
      <Alert className="border-highlight/30 bg-highlight/8">
        <ShieldCheckIcon className="text-highlight-text" />
        <AlertTitle>LLM proposes, policy gate authorizes</AlertTitle>
        <AlertDescription>The model suggests actions, but every action is validated against deterministic policy rules.</AlertDescription>
      </Alert>
    </div>
  );
}
