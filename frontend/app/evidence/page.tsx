'use client';
import { useEffect, useState } from "react";
import { CaretDownIcon } from "@phosphor-icons/react";
import AnimatedNumber from "@/components/animated-number";
import Markdown from "@/components/Markdown";
import { toneBadge, type Tone } from "@/components/status-tone";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { Empty, EmptyDescription, EmptyHeader, EmptyTitle } from "@/components/ui/empty";
import { Skeleton } from "@/components/ui/skeleton";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { useEvalsReport } from "@/lib/api";
import { cn } from "@/lib/utils";

// report.json carries more than lib/api.ts types; typed locally (api.ts is not ours to edit).
type Miss = { id: string; expected_type: string; actual_type: string; expected_path: string; actual_path: string };
type PerType = { n: number; type_accuracy: number; path_accuracy: number };

const pct1 = (x: number) => `${(x * 100).toFixed(1)}%`;
const f2 = (x: number) => x.toFixed(2);
const MISS_LIMIT = 8;

// Mounts at 0 and moves to the real value once, so headline numbers count up on first load.
function Count({ value, format }: { value: number; format?: (n: number) => string }) {
  const [v, setV] = useState(0);
  useEffect(() => setV(value), [value]);
  return <AnimatedNumber value={v} format={format} />;
}

function Stat({ id, label, sub, tone, children }: { id: string; label: string; sub?: string; tone?: string; children: React.ReactNode }) {
  return (
    <div className="flex min-w-0 flex-1 basis-40 flex-col gap-1 px-6 first:pl-0">
      <div data-testid={id} className={cn("font-mono text-4xl font-semibold tabular-nums", tone)}>{children}</div>
      <div className="text-sm text-muted-foreground">{label}</div>
      {sub && <div className="text-xs text-muted-foreground">{sub}</div>}
    </div>
  );
}

function MissRow({ m }: { m: Miss }) {
  const typeMiss = m.expected_type !== m.actual_type;
  const exp = typeMiss ? m.expected_type : m.expected_path;
  const got = typeMiss ? m.actual_type : m.actual_path;
  return (
    <li className="flex flex-wrap items-center gap-2 border-b py-2 last:border-b-0">
      <span className="font-mono text-sm">{m.id}</span>
      <Badge variant="outline" className={toneBadge({ tone: "resolved" as Tone })}>{exp}</Badge>
      <span className="text-xs text-muted-foreground">got</span>
      <Badge variant="outline" className={toneBadge({ tone: "failed" as Tone })}>{got}</Badge>
    </li>
  );
}

function Loading() {
  return (
    <div className="flex flex-col gap-6">
      <div className="flex gap-6">{Array.from({ length: 6 }, (_, i) => <Skeleton key={i} className="h-16 flex-1" />)}</div>
      <Skeleton className="h-96 w-full" />
    </div>
  );
}

export default function EvidencePage() {
  const { data: r, isLoading } = useEvalsReport(); // undefined on 404 / error -> empty state
  if (isLoading) return <Loading />;
  if (!r) {
    return (
      <Empty>
        <EmptyHeader>
          <EmptyTitle>No eval report yet</EmptyTitle>
          <EmptyDescription>Run this in the repo root, then reload.</EmptyDescription>
        </EmptyHeader>
        <code className="rounded-md bg-muted px-3 py-1.5 font-mono text-sm">make evals</code>
      </Empty>
    );
  }
  const j = r.json;
  const misses = ((j as unknown as { misses?: Miss[] }).misses ?? []);
  const perType = Object.entries((j as unknown as { per_type?: Record<string, PerType> }).per_type ?? {});
  const gateFull = j.gate_catch_core.caught === j.gate_catch_core.total;
  const when = new Date(r.generated_at).toLocaleString("en-GB", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit", hour12: false });
  const toneOk = "text-status-resolved";
  const toneBad = "text-status-failed";

  return (
    <div className="flex flex-col gap-6">
      <section className="flex flex-col gap-2">
        <div className="flex flex-wrap divide-x divide-border gap-y-6">
          <Stat id="evals-n" label="Labelled tickets"><Count value={j.n} /></Stat>
          <Stat id="evals-type-accuracy" label="Type accuracy"><Count value={j.type_accuracy * 100} format={(n) => `${n.toFixed(1)}%`} /></Stat>
          <Stat id="evals-resolve-precision" label="RESOLVE precision"><Count value={j.path_per_class.RESOLVE.precision * 100} format={(n) => `${n.toFixed(1)}%`} /></Stat>
          <Stat id="evals-false-action-rate" label="False-action rate" tone={j.false_action_rate === 0 ? toneOk : toneBad}>
            <Count value={j.false_action_rate * 100} format={(n) => `${n.toFixed(1)}%`} />
          </Stat>
          <Stat id="evals-gate-catch-rate" label="Gate catch (core)" sub={`${j.gate_catch.caught}/${j.gate_catch.total} all adversarial`} tone={gateFull ? toneOk : toneBad}>
            <Count value={j.gate_catch_core.caught} />/{j.gate_catch_core.total}
          </Stat>
          <Stat id="overrides-count" label="Human overrides"><Count value={r.overrides_count} /></Stat>
        </div>
        <p className="text-sm text-muted-foreground">Generated {when} · {j.mode} mode</p>
      </section>

      <div className="grid grid-cols-1 gap-6 xl:grid-cols-2">
        <div className="flex flex-col gap-6">
          <section className="flex flex-col gap-2">
            <h2 className="text-lg font-semibold">Path quality</h2>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Class</TableHead>
                  <TableHead className="text-right">Precision</TableHead>
                  <TableHead className="text-right">Recall</TableHead>
                  <TableHead className="text-right">F1</TableHead>
                  <TableHead className="text-right">Support</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {Object.entries(j.path_per_class).map(([k, c]) => (
                  <TableRow key={k}>
                    <TableCell className="font-mono">{k}</TableCell>
                    <TableCell className="text-right font-mono tabular-nums">{f2(c.precision)}</TableCell>
                    <TableCell className="text-right font-mono tabular-nums">{f2(c.recall)}</TableCell>
                    <TableCell className="text-right font-mono tabular-nums">{f2(c.f1)}</TableCell>
                    <TableCell className="text-right font-mono tabular-nums">{c.support}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </section>
          {perType.length > 0 && (
            <section className="flex flex-col gap-2">
              <h2 className="text-lg font-semibold">Per type</h2>
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Type</TableHead>
                    <TableHead className="text-right">n</TableHead>
                    <TableHead className="text-right">Correct</TableHead>
                    <TableHead className="text-right">Accuracy</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {perType.map(([t, p]) => (
                    <TableRow key={t}>
                      <TableCell className="font-mono">{t}</TableCell>
                      <TableCell className="text-right font-mono tabular-nums">{p.n}</TableCell>
                      <TableCell className="text-right font-mono tabular-nums">{Math.round(p.n * p.type_accuracy)}</TableCell>
                      <TableCell className="text-right font-mono tabular-nums">{pct1(p.type_accuracy)}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </section>
          )}
        </div>

        <section className="flex flex-col gap-2">
          <h2 className="text-lg font-semibold">Misses</h2>
          {misses.length === 0 ? (
            <p className="text-sm text-muted-foreground">No misses in this run.</p>
          ) : (
            <Collapsible>
              <ul>{misses.slice(0, MISS_LIMIT).map((m) => <MissRow key={m.id} m={m} />)}</ul>
              {misses.length > MISS_LIMIT && (
                <>
                  <CollapsibleContent>
                    <ul>{misses.slice(MISS_LIMIT).map((m) => <MissRow key={m.id} m={m} />)}</ul>
                  </CollapsibleContent>
                  <CollapsibleTrigger asChild>
                    <Button variant="ghost" size="sm" className="mt-2">
                      Show all {misses.length}
                      <CaretDownIcon data-icon="inline-end" />
                    </Button>
                  </CollapsibleTrigger>
                </>
              )}
            </Collapsible>
          )}
        </section>
      </div>

      <Card>
        <CardHeader><CardTitle>Full report</CardTitle></CardHeader>
        <CardContent><Markdown testId="evals-report">{r.markdown}</Markdown></CardContent>
      </Card>
    </div>
  );
}
