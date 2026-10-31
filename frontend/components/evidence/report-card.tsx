'use client';
import { ArrowSquareOutIcon, DownloadSimpleIcon, FileTextIcon } from "@phosphor-icons/react";
import Markdown from "@/components/Markdown";
import { Button } from "@/components/ui/button";
import { Card, CardAction, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import type { EvalsReport } from "@/lib/api";
import { Info, PathTable, TypeTable } from "./tables";
import { pct1, type Extra } from "./types";

function Dl({ rows }: { rows: [string, string][] }) {
  return (
    <dl className="flex flex-col gap-2 text-sm">
      {rows.map(([k, v]) => (
        <div key={k} className="flex flex-col gap-0.5 border-b pb-2 last:border-b-0">
          <dt className="text-muted-foreground">{k}</dt>
          <dd className="font-mono tabular-nums">{v}</dd>
        </div>
      ))}
    </dl>
  );
}

function download(markdown: string) {
  const url = URL.createObjectURL(new Blob([markdown], { type: "text/markdown" }));
  const a = document.createElement("a");
  a.href = url;
  a.download = "report.md";
  a.click();
  URL.revokeObjectURL(url);
}

export function ReportCard({ r, x }: { r: EvalsReport; x: Extra }) {
  const j = r.json;
  const perType = Object.entries(x.per_type ?? {});
  const served = Object.keys(x.served_by ?? {}).join(", ");
  const total = j.gate_catch.total;
  const missed = total - j.gate_catch.caught;
  return (
    <Card className="shadow-sm">
      <CardHeader>
        <CardTitle className="flex items-center gap-2"><FileTextIcon className="size-5" />Resolv evaluation report</CardTitle>
        <CardAction className="flex gap-2">
          <Dialog>
            <DialogTrigger asChild>
              <Button variant="outline" size="sm"><ArrowSquareOutIcon data-icon="inline-start" />View full report</Button>
            </DialogTrigger>
            <DialogContent className="max-h-[85vh] overflow-y-auto sm:max-w-3xl">
              <DialogHeader>
                <DialogTitle>Resolv evaluation report</DialogTitle>
                <DialogDescription>Full markdown report from the last eval run.</DialogDescription>
              </DialogHeader>
              <Markdown>{r.markdown}</Markdown>
            </DialogContent>
          </Dialog>
          <Button size="sm" onClick={() => download(r.markdown)}><DownloadSimpleIcon data-icon="inline-start" />Download report</Button>
        </CardAction>
      </CardHeader>
      <CardContent className="grid grid-cols-1 gap-6 lg:grid-cols-3">
        <section className="flex flex-col gap-2">
          <h3 className="text-sm font-semibold">Summary</h3>
          <Dl rows={[
            ["Labelled tickets", String(j.n)],
            ["Type accuracy", pct1(j.type_accuracy)],
            ["RESOLVE precision", pct1(j.path_per_class.RESOLVE.precision)],
            ["False-action rate", `${pct1(j.false_action_rate)} (${j.false_actions} of ${j.n})`],
            ["Gate catch rate", `${j.gate_catch_core.caught}/${j.gate_catch_core.total} core adversarial; ${j.gate_catch.caught}/${total} all adversarial rows`],
            ["Human overrides", String(r.overrides_count)],
            ["Mode", served ? `${j.mode} (served by ${served === j.mode ? "fixtures" : served})` : j.mode],
            ["Generated", r.generated_at],
          ]} />
        </section>
        <section className="flex flex-col gap-4">
          <div className="flex flex-col gap-2">
            <h3 className="text-sm font-semibold">Path precision / recall / F1</h3>
            <PathTable data={j.path_per_class} />
          </div>
          <div className="flex flex-col gap-2">
            <h3 className="flex items-center gap-2 text-sm font-semibold">Adversarial gate outcomes <Info label="About gate outcomes" text="Adversarial rows try to push a money action past the policy gate. Caught means the gate blocked or routed it." /></h3>
            <Dl rows={[
              ["Total adversarial rows", String(total)],
              ["Caught by gate", String(j.gate_catch.caught)],
              ["Missed by gate", String(missed)],
              ["Gate catch rate", `${j.gate_catch.caught}/${total} (${pct1(j.gate_catch_rate)})`],
            ]} />
          </div>
        </section>
        <section className="flex flex-col gap-2">
          <h3 className="text-sm font-semibold">Per type accuracy</h3>
          <TypeTable data={perType} />
        </section>
        {/* Stays mounted for verify recipes; the dialog shows its own copy. */}
        <div className="sr-only" data-testid="evals-report"><Markdown>{r.markdown}</Markdown></div>
      </CardContent>
    </Card>
  );
}
