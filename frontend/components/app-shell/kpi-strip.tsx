'use client';
// One stat block per metric, hairline separators, dashes when /api/metrics is unreachable.
import { Fragment } from "react";
import { Badge } from "@/components/ui/badge";
import { Separator } from "@/components/ui/separator";
import AnimatedNumber from "@/components/animated-number";
import { useMetrics, type Metrics } from "@/lib/api";
import { cn } from "@/lib/utils";

const mmss = (n: number) => (n > 90 ? `${Math.floor(n / 60)}:${String(Math.round(n % 60)).padStart(2, "0")}` : `${Math.round(n)}s`);
const KPIS: { id: string; label: string; pick: (m: Metrics) => number; format?: (n: number) => string }[] = [
  { id: "auto_resolution_rate", label: "Auto-resolved", pick: (m) => m.auto_resolution_rate * 100, format: (n) => `${Math.round(n)}%` },
  { id: "avg_first_response_sec", label: "Avg first response", pick: (m) => m.avg_first_response_sec, format: mmss },
  { id: "open", label: "Open", pick: (m) => m.open },
  { id: "awaiting_approval", label: "Awaiting approval", pick: (m) => m.awaiting_approval },
  { id: "incidents_open", label: "Incidents open", pick: (m) => m.incidents_open },
  { id: "window", label: "Window", pick: (m) => m.window_minutes, format: (n) => (n % 60 ? `${Math.round(n)} min` : `${n / 60} h`) },
];

export default function KpiStrip() {
  const { data: m } = useMetrics(); // undefined on 404 / network error -> dashes
  return (
    <section data-testid="kpi-strip" className="flex items-stretch gap-5 overflow-x-auto border-b pb-5">
      {KPIS.map((k, i) => (
        <Fragment key={k.id}>
          {i > 0 && <Separator orientation="vertical" className="data-[orientation=vertical]:h-auto" />}
          <div data-testid={`kpi-${k.id}`} className="flex min-w-28 flex-col gap-1">
            <div className="font-mono text-3xl font-semibold tracking-tight tabular-nums">
              {m ? <AnimatedNumber value={k.pick(m)} format={k.format} /> : "-"}
            </div>
            <div className="text-sm whitespace-nowrap text-muted-foreground">{k.label}</div>
          </div>
        </Fragment>
      ))}
      <Badge
        variant="outline"
        className={cn("ml-auto h-7 self-start gap-2 px-2.5 text-sm", m && "border-highlight/40 bg-highlight/10")}
      >
        <span className="relative flex size-2">
          {m && <span className="absolute inline-flex size-full rounded-full bg-highlight opacity-75 motion-safe:animate-ping" />}
          <span className={cn("relative inline-flex size-2 rounded-full", m ? "bg-highlight" : "bg-muted-foreground")} />
        </span>
        {m ? "Live" : "Offline"}
      </Badge>
    </section>
  );
}
