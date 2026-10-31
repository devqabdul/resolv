'use client';
// Overall metrics: /api/metrics for the selected window, plus breakdowns derived from the
// latest 200 tickets filtered to the same window. Every number comes from an existing hook.
import { Fragment, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { useReducedMotion } from "motion/react";
import { ArrowRightIcon, WarningIcon } from "@phosphor-icons/react";
import { Area, AreaChart, Bar, BarChart, CartesianGrid, Cell, XAxis, YAxis } from "recharts";
import AnimatedNumber from "@/components/animated-number";
import { mmss } from "@/components/app-shell/kpi-strip";
import { inr, obj } from "@/components/TimelineEvent";
import { STATUS_TONE, toneBadge, type Tone } from "@/components/status-tone";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardAction, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from "@/components/ui/card";
import {
  ChartContainer, ChartLegend, ChartLegendContent, ChartTooltip, ChartTooltipContent, type ChartConfig,
} from "@/components/ui/chart";
import { Empty, EmptyDescription, EmptyHeader, EmptyTitle } from "@/components/ui/empty";
import { Separator } from "@/components/ui/separator";
import { cn } from "@/lib/utils";
import { Skeleton } from "@/components/ui/skeleton";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import {
  useApprovals, useEvalsReport, useIncidents, useMetrics, useTickets, type Incident, type Metrics, type Ticket,
} from "@/lib/api";

const WINDOWS = [
  { min: 60, label: "1h", bucket: 10 },
  { min: 240, label: "4h", bucket: 30 },
  { min: 1440, label: "24h", bucket: 120 },
] as const;
const INCIDENT_TONE: Record<Incident["status"], Tone> = { OPEN: "awaiting", COMMUNICATED: "processing", RESOLVED: "resolved" };
const pct1 = (n: number) => `${n.toFixed(1)}%`;
const hhmm = (t: number) => new Date(t).toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit", hour12: false });
const human = (s: string) => s.replaceAll("_", " ");
const tick = { fontSize: 14 };

function Stat({ id, label, children }: { id: string; label: string; children: React.ReactNode }) {
  return (
    <div data-testid={`dashboard-stat-${id}`} className="flex flex-auto flex-col gap-1">
      <div className="font-mono text-4xl font-semibold tracking-tight tabular-nums">{children}</div>
      <div className="text-xs font-medium tracking-wider whitespace-nowrap uppercase text-muted-foreground">{label}</div>
    </div>
  );
}

function ChartCard({ name, title, description, className, children }: {
  name: string; title: string; description: string; className?: string; children: React.ReactNode;
}) {
  return (
    <Card data-testid={`dashboard-chart-${name}`} className={className}>
      <CardHeader>
        <CardTitle className="text-xs font-medium tracking-wider uppercase text-muted-foreground">{title}</CardTitle>
        <CardDescription className="text-sm text-foreground/80">{description}</CardDescription>
      </CardHeader>
      <CardContent>{children}</CardContent>
    </Card>
  );
}

function NoData({ title = "No tickets in this window" }: { title?: string }) {
  return (
    <Empty className="py-8">
      <EmptyHeader>
        <EmptyTitle>{title}</EmptyTitle>
        <EmptyDescription>Pick a longer window or inject a scenario.</EmptyDescription>
      </EmptyHeader>
    </Empty>
  );
}

function Loading() {
  return (
    <div className="flex flex-col gap-6">
      <Skeleton className="h-9 w-40" />
      <div className="flex flex-wrap gap-4 border-b pb-5">
        {Array.from({ length: 8 }, (_, i) => <Skeleton key={i} className="h-16 min-w-28 flex-1" />)}
      </div>
      <div className="grid grid-cols-1 gap-6 xl:grid-cols-12">
        <Skeleton className="h-80 xl:col-span-8" />
        <Skeleton className="h-80 xl:col-span-4" />
        <Skeleton className="h-72 xl:col-span-8" />
        <Skeleton className="h-72 xl:col-span-4" />
        <Skeleton className="h-64 xl:col-span-4" />
        <Skeleton className="h-64 xl:col-span-4" />
        <Skeleton className="h-64 xl:col-span-4" />
      </div>
    </div>
  );
}

// Single-row stacked bar with a legend that carries the counts (labels, not colour alone).
function StackBar({ config, row, animate }: { config: ChartConfig; row: Record<string, number>; animate: boolean }) {
  const keys = Object.keys(config);
  return (
    <ChartContainer config={config} className="aspect-auto h-24 w-full">
      <BarChart data={[row]} layout="vertical" margin={{ left: 0, right: 0, top: 0, bottom: 0 }}>
        <XAxis type="number" hide domain={[0, "dataMax"]} />
        <YAxis type="category" hide />
        <ChartTooltip cursor={false} content={<ChartTooltipContent hideLabel />} />
        {keys.map((k) => (
          <Bar key={k} dataKey={k} stackId="a" fill={`var(--color-${k})`} stroke="var(--card)" strokeWidth={2} barSize={32} isAnimationActive={animate} />
        ))}
        <ChartLegend content={<ChartLegendContent className="text-sm" />} />
      </BarChart>
    </ChartContainer>
  );
}

export default function DashboardPage() {
  const [win, setWin] = useState<number>(240);
  const w = WINDOWS.find((x) => x.min === win) ?? WINDOWS[1];
  const { data: mNow, error: mErr } = useMetrics(win);
  const { data: tickets, error: tErr } = useTickets({ limit: 200 });
  const { data: report } = useEvalsReport();
  const { data: incidents } = useIncidents();
  const { data: approvals } = useApprovals("PENDING");
  const reduce = useReducedMotion();

  // Keep the last metrics while a new window loads, so numbers tween instead of flashing.
  const last = useRef<Metrics | undefined>(undefined);
  if (mNow) last.current = mNow;
  const m = mNow ?? last.current;

  // One slow clock for the window filter and the time buckets (no shifting axis on every poll).
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 30000);
    return () => clearInterval(t);
  }, []);

  // Recharts entry animation runs once, then stays off for polling updates.
  const [settled, setSettled] = useState(false);
  const ready = !!m || !!tickets;
  useEffect(() => {
    if (!ready) return;
    const t = setTimeout(() => setSettled(true), 1600);
    return () => clearTimeout(t);
  }, [ready]);
  const animate = !reduce && !settled;

  const d = useMemo(() => {
    const items: Ticket[] = tickets?.items ?? [];
    const from = now - win * 60000;
    const inWin = items.filter((t) => new Date(t.created_at).getTime() >= from);

    const bucketMs = w.bucket * 60000;
    const end = Math.floor(now / bucketMs) * bucketMs + bucketMs;
    const n = win / w.bucket;
    const start = end - n * bucketMs;
    const series = Array.from({ length: n }, (_, i) => ({ t: start + i * bucketMs, count: 0 }));
    for (const t of inWin) {
      const i = Math.floor((new Date(t.created_at).getTime() - start) / bucketMs);
      if (i >= 0 && i < n) series[i].count++;
    }

    const byStatus: Record<string, number> = {};
    for (const t of inWin) byStatus[t.status] = (byStatus[t.status] ?? 0) + 1;
    const status = Object.entries(byStatus).sort((a, b) => b[1] - a[1])
      .map(([s, count]) => ({ status: s, count, fill: `var(--color-${s})` }));

    const path = { RESOLVE: 0, ROUTE: 0, ESCALATE: 0 } as Record<string, number>;
    for (const t of inWin) if (t.path && t.path in path) path[t.path]++;
    const by = { resolv: 0, human: 0 };
    for (const t of inWin) {
      if (t.resolved_by === "resolv") by.resolv++;
      else if (t.resolved_by?.startsWith("human")) by.human++;
    }
    return { inWin, series, status, path, by };
  }, [tickets, now, win, w.bucket]);

  const byType = useMemo(
    () => Object.entries(m?.by_type ?? {}).sort((a, b) => b[1] - a[1]).map(([type, count]) => ({ type: human(type), count })),
    [m?.by_type],
  );

  if (!m && !tickets && !mErr && !tErr) return <Loading />;

  const winText = `Last ${w.label}`;
  const statusConfig = Object.fromEntries(
    d.status.map((s) => [s.status, { label: s.status, color: `var(--status-${STATUS_TONE[s.status] ?? "new"})` }]),
  ) satisfies ChartConfig;
  const pathTotal = d.path.RESOLVE + d.path.ROUTE + d.path.ESCALATE;
  const pathConfig = {
    RESOLVE: { label: `Resolve ${d.path.RESOLVE}`, color: "var(--chart-1)" },
    ROUTE: { label: `Route ${d.path.ROUTE}`, color: "var(--chart-2)" },
    ESCALATE: { label: `Escalate ${d.path.ESCALATE}`, color: "var(--chart-5)" },
  } satisfies ChartConfig;
  const byConfig = {
    resolv: { label: `Resolv ${d.by.resolv}`, color: "var(--chart-1)" },
    human: { label: `Human ${d.by.human}`, color: "var(--chart-2)" },
  } satisfies ChartConfig;
  const activeIncidents = (incidents ?? []).filter((i) => i.status !== "RESOLVED");
  const j = report?.json;

  const stats: { id: string; label: string; value: number | undefined; format?: (n: number) => string }[] = [
    { id: "avg_resolution_sec", label: "Avg resolution", value: m?.avg_resolution_sec, format: mmss },
    { id: "tat_breaches_prevented", label: "TAT breaches prevented", value: m?.tat_breaches_prevented },
    { id: "overrides_count", label: "Human overrides", value: report?.overrides_count },
  ];

  return (
    <div data-testid="dashboard" className="flex flex-col gap-6">
      <div className="flex flex-wrap items-center gap-4">
        <span className="font-mono text-xs font-medium tracking-[0.2em] uppercase text-highlight-text">Operations</span>
        <ToggleGroup
          type="single"
          variant="outline"
          value={String(win)}
          onValueChange={(v) => v && setWin(Number(v))}
          aria-label="Metrics window"
        >
          {WINDOWS.map((x) => (
            <ToggleGroupItem key={x.min} value={String(x.min)} className="px-4 font-mono">{x.label}</ToggleGroupItem>
          ))}
        </ToggleGroup>
        <p className="text-sm text-muted-foreground">
          <span className="font-mono tabular-nums">{d.inWin.length}</span> tickets in the last {w.label}
          {tickets && tickets.total > tickets.items.length && (
            <>, charts use the latest <span className="font-mono tabular-nums">{tickets.items.length}</span> of{" "}
              <span className="font-mono tabular-nums">{tickets.total}</span></>
          )}
        </p>
      </div>

      {mErr && !m && (
        <Alert variant="destructive">
          <WarningIcon />
          <AlertTitle>Metrics unavailable</AlertTitle>
          <AlertDescription>Could not load /api/metrics. Check that the backend is running on :8000.</AlertDescription>
        </Alert>
      )}

      <section className="flex flex-wrap items-stretch gap-x-4 gap-y-3 border-b pb-5">
        {stats.map((s, i) => (
          <Fragment key={s.id}>
            {i > 0 && <Separator orientation="vertical" />}
            <Stat id={s.id} label={s.label}>
              {s.value === undefined ? "-" : <AnimatedNumber value={s.value} format={s.format} />}
            </Stat>
          </Fragment>
        ))}
      </section>

      {tErr && !tickets && (
        <Alert variant="destructive">
          <WarningIcon />
          <AlertTitle>Tickets unavailable</AlertTitle>
          <AlertDescription>Could not load /api/tickets, so the ticket charts are empty.</AlertDescription>
        </Alert>
      )}

      <div className="grid grid-cols-1 gap-6 xl:grid-cols-12">
        <ChartCard name="over-time" title="Tickets created" description={`${winText}, per ${w.bucket < 60 ? `${w.bucket} min` : `${w.bucket / 60} h`}`} className="xl:col-span-8">
          {d.inWin.length === 0 ? <NoData /> : (
            <ChartContainer config={{ count: { label: "Tickets", color: "var(--chart-1)" } }} className="aspect-auto h-64 w-full">
              <AreaChart data={d.series} margin={{ left: 0, right: 8, top: 8 }}>
                <defs>
                  <linearGradient id="fill-count" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0%" stopColor="var(--color-count)" stopOpacity={0.45} />
                    <stop offset="100%" stopColor="var(--color-count)" stopOpacity={0.02} />
                  </linearGradient>
                </defs>
                <CartesianGrid vertical={false} strokeDasharray="3 3" />
                <XAxis dataKey="t" tickFormatter={hhmm} tickLine={false} axisLine={false} tickMargin={8} tick={tick} minTickGap={24} />
                <YAxis allowDecimals={false} tickLine={false} axisLine={false} width={32} tick={tick} />
                <ChartTooltip content={<ChartTooltipContent labelFormatter={(_, p) => hhmm(Number(p?.[0]?.payload?.t))} />} />
                <Area dataKey="count" type="monotone" stroke="var(--color-count)" strokeWidth={2.5} fill="url(#fill-count)" activeDot={{ r: 5, strokeWidth: 0 }} isAnimationActive={animate} />
              </AreaChart>
            </ChartContainer>
          )}
        </ChartCard>

        <ChartCard name="status" title="By status" description={winText} className="xl:col-span-4">
          {d.status.length === 0 ? <NoData /> : (
            <ChartContainer config={statusConfig} className="aspect-auto h-64 w-full">
              <BarChart data={d.status} layout="vertical" margin={{ left: 0, right: 16 }}>
                <XAxis type="number" hide allowDecimals={false} />
                <YAxis type="category" dataKey="status" tickLine={false} axisLine={false} width={150} tick={{ ...tick, fontFamily: "var(--font-mono)" }} />
                <ChartTooltip cursor={false} content={<ChartTooltipContent hideLabel nameKey="status" />} />
                <Bar dataKey="count" radius={4} barSize={20} isAnimationActive={animate}>
                  {d.status.map((s) => <Cell key={s.status} fill={s.fill} />)}
                </Bar>
              </BarChart>
            </ChartContainer>
          )}
        </ChartCard>

        <ChartCard name="by-type" title="By type" description={`${winText}, from metrics`} className="xl:col-span-4">
          {byType.length === 0 ? <NoData /> : (
            <ChartContainer config={{ count: { label: "Tickets", color: "var(--chart-2)" } }} className="aspect-auto w-full" style={{ height: Math.max(120, byType.length * 40) }}>
              <BarChart data={byType} layout="vertical" margin={{ left: 0, right: 16 }}>
                <XAxis type="number" hide allowDecimals={false} />
                <YAxis type="category" dataKey="type" tickLine={false} axisLine={false} width={190} tick={tick} />
                <ChartTooltip cursor={false} content={<ChartTooltipContent hideLabel />} />
                <Bar dataKey="count" fill="var(--color-count)" radius={4} barSize={20} isAnimationActive={animate} />
              </BarChart>
            </ChartContainer>
          )}
        </ChartCard>

        <ChartCard name="path" title="Resolution path" description={winText} className="xl:col-span-4">
          {pathTotal === 0 ? <NoData title="No decided tickets in this window" /> : <StackBar config={pathConfig} row={d.path} animate={animate} />}
        </ChartCard>
        <ChartCard name="resolved-by" title="Resolved by" description={winText} className="xl:col-span-4">
          {d.by.resolv + d.by.human === 0 ? <NoData title="No resolved tickets in this window" /> : <StackBar config={byConfig} row={d.by} animate={animate} />}
        </ChartCard>

        <Card data-testid="dashboard-trust" className="xl:col-span-4">
          <CardHeader>
            <CardTitle className="text-xs font-medium tracking-wider uppercase text-muted-foreground">Trust</CardTitle>
            <CardDescription className="text-sm text-foreground/80">{j ? `Offline eval, ${j.mode} mode` : "Offline eval report"}</CardDescription>
          </CardHeader>
          <CardContent>
            {!j ? (
              <Empty className="py-6">
                <EmptyHeader>
                  <EmptyTitle>No eval report yet</EmptyTitle>
                  <EmptyDescription>Run make evals in the repo root.</EmptyDescription>
                </EmptyHeader>
              </Empty>
            ) : (
              <div className="flex flex-col gap-4">
                <div
                  data-testid="dashboard-stat-false_action_rate"
                  className={cn(
                    "flex flex-col gap-1 rounded-lg px-4 py-3 ring-1",
                    j.false_action_rate === 0 ? "bg-status-resolved/8 ring-status-resolved/30 dark:glow-green" : "bg-status-failed/8 ring-status-failed/30",
                  )}
                >
                  <div className={cn("font-mono text-5xl font-semibold tracking-tight tabular-nums", j.false_action_rate === 0 ? "text-status-resolved" : "text-status-failed")}>
                    <AnimatedNumber value={j.false_action_rate * 100} format={pct1} />
                  </div>
                  <div className="text-xs font-medium tracking-wider uppercase text-muted-foreground">False-action rate</div>
                </div>
                <div className="grid grid-cols-3 gap-4">
                  <Stat id="evals_n" label="Labelled"><AnimatedNumber value={j.n} /></Stat>
                  <Stat id="type_accuracy" label="Type acc."><AnimatedNumber value={j.type_accuracy * 100} format={pct1} /></Stat>
                  <Stat id="gate_catch_core" label="Gate catch">
                    <span className={j.gate_catch_core.caught === j.gate_catch_core.total ? "text-status-resolved" : "text-status-failed"}>
                      <AnimatedNumber value={j.gate_catch_core.caught} />/{j.gate_catch_core.total}
                    </span>
                  </Stat>
                </div>
              </div>
            )}
          </CardContent>
          <CardFooter>
            <Button asChild variant="outline" size="sm">
              <Link href="/evidence">Open evidence<ArrowRightIcon data-icon="inline-end" /></Link>
            </Button>
          </CardFooter>
        </Card>

        <Card data-testid="dashboard-incidents" className="xl:col-span-4">
          <CardHeader>
            <CardTitle className="text-xs font-medium tracking-wider uppercase text-muted-foreground">Active incidents</CardTitle>
            <CardDescription className="text-sm text-foreground/80">Open or communicated</CardDescription>
            <CardAction>
              <Button asChild variant="ghost" size="sm">
                <Link href="/incidents">View all<ArrowRightIcon data-icon="inline-end" /></Link>
              </Button>
            </CardAction>
          </CardHeader>
          <CardContent>
            {activeIncidents.length === 0 ? (
              <Empty className="py-6"><EmptyHeader><EmptyTitle>No active incidents</EmptyTitle></EmptyHeader></Empty>
            ) : (
              <ul className="flex flex-col">
                {activeIncidents.slice(0, 5).map((i) => (
                  <li key={i.id} className="flex items-center gap-3 border-b py-2 last:border-b-0">
                    <span className="min-w-0 flex-1 truncate text-sm" title={i.title}>{i.title}</span>
                    <span className="font-mono text-lg font-semibold tabular-nums"><AnimatedNumber value={i.ticket_count} /></span>
                    <Badge className={toneBadge({ tone: INCIDENT_TONE[i.status] })}>{i.status}</Badge>
                  </li>
                ))}
              </ul>
            )}
          </CardContent>
        </Card>

        <Card data-testid="dashboard-approvals" className="xl:col-span-4">
          <CardHeader>
            <CardTitle className="text-xs font-medium tracking-wider uppercase text-muted-foreground">Pending approvals</CardTitle>
            <CardDescription className="text-sm text-foreground/80">Waiting for a human decision</CardDescription>
            <CardAction>
              <Button asChild variant="ghost" size="sm">
                <Link href="/approvals">View all<ArrowRightIcon data-icon="inline-end" /></Link>
              </Button>
            </CardAction>
          </CardHeader>
          <CardContent>
            {!approvals?.length ? (
              <Empty className="py-6"><EmptyHeader><EmptyTitle>Nothing to approve</EmptyTitle></EmptyHeader></Empty>
            ) : (
              <ul className="flex flex-col">
                {approvals.slice(0, 5).map((a) => {
                  const amount = obj(a.action_json.params)?.amount_inr;
                  return (
                    <li key={a.id} className="flex items-center gap-3 border-b py-2 last:border-b-0">
                      <span className="font-mono text-sm">{a.ticket_id}</span>
                      <span className="min-w-0 flex-1 truncate font-mono text-sm text-muted-foreground">{String(a.action_json.name ?? "action")}</span>
                      {typeof amount === "number" && <span className="font-mono text-lg font-semibold tabular-nums">{inr(amount)}</span>}
                    </li>
                  );
                })}
              </ul>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
