'use client';
// One stat block per metric, hairline separators, dashes when /api/metrics is unreachable.
// Labels never wrap; blocks size to content and the strip wraps as a whole on narrow screens.
import { Fragment } from "react";
import { motion, useReducedMotion } from "motion/react";
import { Badge } from "@/components/ui/badge";
import { Separator } from "@/components/ui/separator";
import { useLayoutState } from "@/components/app-shell/layout-state";
import AnimatedNumber from "@/components/animated-number";
import { useMetrics, type Metrics } from "@/lib/api";
import { cn } from "@/lib/utils";

export const mmss = (n: number) => (n > 90 ? `${Math.floor(n / 60)}:${String(Math.round(n % 60)).padStart(2, "0")}` : `${Math.round(n)}s`);
const KPIS: { id: string; label: string; pick: (m: Metrics) => number; format?: (n: number) => string }[] = [
  { id: "auto_resolution_rate", label: "Auto-resolved", pick: (m) => m.auto_resolution_rate * 100, format: (n) => `${Math.round(n)}%` },
  { id: "avg_first_response_sec", label: "Avg first response", pick: (m) => m.avg_first_response_sec, format: mmss },
  { id: "open", label: "Open", pick: (m) => m.open },
  { id: "awaiting_approval", label: "Awaiting approval", pick: (m) => m.awaiting_approval },
  { id: "incidents_open", label: "Incidents open", pick: (m) => m.incidents_open },
  { id: "window", label: "Window", pick: (m) => m.window_minutes, format: (n) => (n % 60 ? `${Math.round(n)}m` : `${n / 60}h`) },
];

export default function KpiStrip() {
  const { data: m } = useMetrics(); // undefined on 404 / network error -> dashes
  const { motionOn } = useLayoutState();
  const open = true; // metrics are required data: always shown (user, 31 Oct)
  const reduce = useReducedMotion();
  // Closed: stays mounted at height 0; the negative margin cancels the parent's gap-6.
  return (
    <motion.div
      aria-hidden={!open}
      inert={!open}
      initial={false}
      animate={{ height: open ? "auto" : 0, opacity: open ? 1 : 0, marginBottom: open ? 0 : "-1.5rem" }}
      transition={{ duration: reduce || !motionOn ? 0 : 0.18, ease: [0.16, 1, 0.3, 1] }}
      className="overflow-hidden"
    >
    <section data-testid="kpi-strip" className="flex flex-wrap items-stretch gap-x-4 gap-y-3 border-b pb-5">
      {KPIS.map((k, i) => (
        <Fragment key={k.id}>
          {i > 0 && <Separator orientation="vertical" />}
          <div data-testid={`kpi-${k.id}`} className="flex flex-auto flex-col gap-1">
            <div className="font-mono text-3xl font-semibold tracking-tight tabular-nums">
              {m ? <AnimatedNumber value={k.pick(m)} format={k.format} /> : "-"}
            </div>
            <div className="text-sm leading-snug whitespace-nowrap text-muted-foreground">{k.label}</div>
          </div>
        </Fragment>
      ))}
      <Badge
        variant="outline"
        className={cn("h-7 shrink-0 self-start gap-2 px-2.5 text-sm", m && "border-highlight/40 bg-highlight/10")}
      >
        <span className="relative flex size-2">
          {m && <span className="absolute inline-flex size-full rounded-full bg-highlight opacity-75 motion-safe:animate-ping" />}
          <span className={cn("relative inline-flex size-2 rounded-full", m ? "bg-highlight" : "bg-muted-foreground")} />
        </span>
        {m ? "Live" : "Offline"}
      </Badge>
    </section>
    </motion.div>
  );
}
