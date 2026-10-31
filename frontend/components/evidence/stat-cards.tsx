'use client';
import { useEffect, useState } from "react";
import { ChartBarIcon, FileTextIcon, ShieldCheckIcon, TargetIcon, UserIcon, type Icon } from "@phosphor-icons/react";
import AnimatedNumber from "@/components/animated-number";
import { Card, CardContent } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import type { EvalsReport } from "@/lib/api";
import { pct } from "./types";
import { cn } from "@/lib/utils";

// Mounts at 0 and moves to the real value once, so headline numbers count up on first load.
function Count({ value, format }: { value: number; format?: (n: number) => string }) {
  const [v, setV] = useState(0);
  useEffect(() => setV(value), [value]);
  return <AnimatedNumber value={v} format={format} />;
}

const p1 = (n: number) => `${n.toFixed(1)}%`;
const OK = "text-status-resolved";
const BAD = "text-status-failed";
const TINT_OK = "bg-status-resolved/12 text-status-resolved";
const TINT_BAD = "bg-status-failed/12 text-status-failed";
const TINT_NEUTRAL = "bg-primary/10 text-primary";

function StatCard({ id, label, sub, icon: Ic, tint, tone, children }: { id: string; label: string; sub?: string; icon: Icon; tint: string; tone?: string; children: React.ReactNode }) {
  return (
    <Card size="sm" className="shadow-sm">
      <CardContent className="flex items-start justify-between gap-3">
        <div className="flex min-w-0 flex-col gap-1">
          <div data-testid={id} className={cn("font-mono text-3xl font-semibold tracking-tight tabular-nums", tone)}>{children}</div>
          <div className="text-sm leading-snug text-muted-foreground">{label}</div>
          {sub && <div className="text-xs text-muted-foreground">{sub}</div>}
        </div>
        <div className={cn("flex size-9 shrink-0 items-center justify-center rounded-lg", tint)}>
          <Ic weight="duotone" className="size-5" />
        </div>
      </CardContent>
    </Card>
  );
}

export function StatCards({ r }: { r: EvalsReport }) {
  const j = r.json;
  const noFalse = j.false_action_rate === 0;
  const gateFull = j.gate_catch_core.caught === j.gate_catch_core.total;
  return (
    <section className="grid grid-cols-2 gap-4 md:grid-cols-3 xl:grid-cols-6">
      <StatCard id="evals-n" label="Labelled tickets" icon={FileTextIcon} tint={TINT_NEUTRAL}><Count value={j.n} /></StatCard>
      <StatCard id="evals-type-accuracy" label="Type accuracy" icon={TargetIcon} tint={TINT_NEUTRAL}><Count value={pct(j.type_accuracy)} format={p1} /></StatCard>
      <StatCard id="evals-resolve-precision" label="RESOLVE precision" icon={ChartBarIcon} tint={TINT_NEUTRAL}><Count value={pct(j.path_per_class.RESOLVE.precision)} format={p1} /></StatCard>
      <StatCard id="evals-false-action-rate" label="False-action rate" icon={ShieldCheckIcon} tint={noFalse ? TINT_OK : TINT_BAD} tone={noFalse ? OK : BAD}>
        <Count value={pct(j.false_action_rate)} format={p1} />
      </StatCard>
      <StatCard id="evals-gate-catch-rate" label="Gate catch rate" sub={`${j.gate_catch.caught}/${j.gate_catch.total} all adversarial`} icon={ShieldCheckIcon} tint={gateFull ? TINT_OK : TINT_BAD} tone={gateFull ? OK : BAD}>
        <Count value={j.gate_catch_core.caught} />/{j.gate_catch_core.total}
      </StatCard>
      <StatCard id="overrides-count" label="Human overrides" icon={UserIcon} tint={TINT_NEUTRAL}><Count value={r.overrides_count} /></StatCard>
    </section>
  );
}

export function StatSkeleton() {
  return (
    <div className="grid grid-cols-2 gap-4 md:grid-cols-3 xl:grid-cols-6">
      {Array.from({ length: 6 }, (_, i) => <Skeleton key={i} className="h-[88px] w-full rounded-xl" />)}
    </div>
  );
}
