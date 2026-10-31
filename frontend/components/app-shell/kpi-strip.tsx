'use client';
// One card per metric, dashes when /api/metrics is unreachable. Deltas are real: the change since the
// first metrics response this page load saw, shown only when non-zero. Live/Offline lives in the header.
import { useRef } from "react";
import { usePathname } from "next/navigation";
import { motion, useReducedMotion } from "motion/react";
import { ClockIcon, FileIcon, LightningIcon, UsersIcon, WarningIcon, type Icon } from "@phosphor-icons/react";
import { Card, CardContent } from "@/components/ui/card";
import { useLayoutState } from "@/components/app-shell/layout-state";
import AnimatedNumber from "@/components/animated-number";
import { useMetrics, type Metrics } from "@/lib/api";
import { cn } from "@/lib/utils";

export const mmss = (n: number) => (n > 90 ? `${Math.floor(n / 60)}:${String(Math.round(n % 60)).padStart(2, "0")}` : `${Math.round(n)}s`);
type Kpi = {
  id: string;
  label: string;
  sub?: string;
  icon: Icon;
  tint: string;
  pick: (m: Metrics) => number;
  format?: (n: number) => string;
  /** formats a non-zero, rounded delta; omitted = no delta (e.g. the window) */
  delta?: (d: number) => string;
};
const signed = (n: number) => `${n > 0 ? "+" : "-"}${Math.abs(n)}`;
const KPIS: Kpi[] = [
  { id: "auto_resolution_rate", label: "Auto-resolved", icon: LightningIcon, tint: "bg-status-resolved/12 text-status-resolved", pick: (m) => m.auto_resolution_rate * 100, format: (n) => `${Math.round(n)}%`, delta: (d) => `${signed(d)} pts` },
  { id: "avg_first_response_sec", label: "Avg first response", icon: ClockIcon, tint: "bg-highlight/12 text-highlight-text", pick: (m) => m.avg_first_response_sec, format: mmss, delta: (d) => `${signed(d)}s` },
  { id: "open", label: "Open", icon: FileIcon, tint: "bg-primary/10 text-primary", pick: (m) => m.open, delta: signed },
  { id: "awaiting_approval", label: "Awaiting approval", icon: UsersIcon, tint: "bg-status-awaiting/12 text-status-awaiting", pick: (m) => m.awaiting_approval, delta: signed },
  { id: "incidents_open", label: "Incidents open", icon: WarningIcon, tint: "bg-status-failed/12 text-status-failed", pick: (m) => m.incidents_open, delta: signed },
  { id: "window", label: "Window", sub: "RBI TAT", icon: ClockIcon, tint: "bg-muted text-muted-foreground", pick: (m) => m.window_minutes, format: (n) => (n % 60 ? `${Math.round(n)}m` : `${n / 60}h`) },
];

export default function KpiStrip() {
  const { data: m } = useMetrics(); // undefined on 404 / network error -> dashes
  const { motionOn } = useLayoutState();
  // Metric cards live on the Dashboard only (user, 31 Oct).
  const open = usePathname() === "/dashboard";
  const reduce = useReducedMotion();
  const base = useRef<{ values: number[]; at: string } | null>(null);
  if (m && !base.current) {
    base.current = { values: KPIS.map((k) => k.pick(m)), at: new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }) };
  }
  // Closed: stays mounted at height 0; the negative margin cancels the parent's gap-6.
  return (
    <motion.div
      aria-hidden={!open}
      inert={!open}
      initial={false}
      animate={{ height: open ? "auto" : 0, opacity: open ? 1 : 0, marginBottom: open ? 0 : "-1.5rem" }}
      transition={{ duration: reduce || !motionOn ? 0 : 0.18, ease: [0.16, 1, 0.3, 1] }}
      className="-m-1 overflow-hidden p-1"
    >
      <section data-testid="kpi-strip" className="grid grid-cols-2 gap-4 md:grid-cols-3 xl:grid-cols-6">
        {KPIS.map((k, i) => {
          const d = m && base.current && k.delta ? Math.round(k.pick(m) - base.current.values[i]) : 0;
          return (
            <Card key={k.id} data-testid={`kpi-${k.id}`} size="sm" className={cn("shadow-sm", i === 0 && "ring-highlight/40 dark:glow-cyan")}>
              <CardContent className="flex items-start justify-between gap-3">
                <div className="flex min-w-0 flex-col gap-1">
                  <div className={cn("font-mono text-4xl font-semibold tracking-tight tabular-nums", i === 0 && "text-highlight-text")}>
                    {m ? <AnimatedNumber value={k.pick(m)} format={k.format} /> : "-"}
                  </div>
                  <div className="text-xs font-medium tracking-wider whitespace-nowrap uppercase text-muted-foreground">
                    {k.label}
                    {k.sub && <span className="ml-1.5 normal-case tracking-normal">{k.sub}</span>}
                  </div>
                  {d !== 0 && k.delta && (
                    <div className="font-mono text-xs text-muted-foreground tabular-nums">
                      {k.delta(d)} since {base.current?.at}
                    </div>
                  )}
                </div>
                <div className={cn("flex size-10 shrink-0 items-center justify-center rounded-lg ring-1 ring-current/15", k.tint)}>
                  <k.icon weight="duotone" className="size-5" />
                </div>
              </CardContent>
            </Card>
          );
        })}
      </section>
    </motion.div>
  );
}
