'use client';
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Empty, EmptyDescription, EmptyHeader, EmptyTitle } from "@/components/ui/empty";
import { Skeleton } from "@/components/ui/skeleton";
import { TooltipProvider } from "@/components/ui/tooltip";
import { useEvalsReport } from "@/lib/api";
import { MissesCard } from "@/components/evidence/misses-card";
import { ReportCard } from "@/components/evidence/report-card";
import { StatCards, StatSkeleton } from "@/components/evidence/stat-cards";
import { Info, PathTable, TypeTable } from "@/components/evidence/tables";
import type { Extra } from "@/components/evidence/types";

function Loading() {
  return (
    <div className="flex flex-col gap-6">
      <StatSkeleton />
      <div className="grid grid-cols-1 gap-6 xl:grid-cols-2">
        <Skeleton className="h-96 w-full rounded-xl" />
        <Skeleton className="h-96 w-full rounded-xl" />
      </div>
      <Skeleton className="h-80 w-full rounded-xl" />
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
  const x = j as unknown as Extra;
  const misses = x.misses ?? [];
  const perType = Object.entries(x.per_type ?? {});
  const when = new Date(r.generated_at).toLocaleString("en-GB", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit", hour12: false });

  return (
    <TooltipProvider>
      <div className="flex flex-col gap-6">
        <section className="flex flex-col gap-2">
          <StatCards r={r} />
          <p className="text-sm text-muted-foreground">Generated {when} · {j.mode} mode</p>
        </section>

        <div className="grid grid-cols-1 items-start gap-6 xl:grid-cols-2">
          <Card className="min-w-0 shadow-sm">
            <CardHeader>
              <CardTitle className="flex items-center gap-2">Path quality <Info label="About path quality" text="Precision, recall and F1 of the RESOLVE / ROUTE / ESCALATE decision against labels" /></CardTitle>
            </CardHeader>
            <CardContent className="flex flex-col gap-6">
              <PathTable data={j.path_per_class} />
              {perType.length > 0 && (
                <div className="flex flex-col gap-2">
                  <h3 className="flex items-center gap-2 text-base font-semibold">Per type <Info label="About per type" text="Ticket type accuracy per labelled type. Correct is the number of tickets whose predicted type matched the label." /></h3>
                  <TypeTable data={perType} />
                </div>
              )}
            </CardContent>
          </Card>
          <MissesCard misses={misses} />
        </div>

        <ReportCard r={r} x={x} />
      </div>
    </TooltipProvider>
  );
}
