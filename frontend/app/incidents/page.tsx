'use client';
import { SirenIcon } from "@phosphor-icons/react";
import IncidentCard from "@/components/IncidentCard";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { Empty, EmptyDescription, EmptyHeader, EmptyMedia, EmptyTitle } from "@/components/ui/empty";
import { Skeleton } from "@/components/ui/skeleton";
import { useIncidents } from "@/lib/api";

export default function Incidents() {
  const { data, error, mutate } = useIncidents();
  const open = data?.filter((i) => i.status === "OPEN").length ?? 0;
  const sorted = data && [...data].sort((a, b) => b.first_seen.localeCompare(a.first_seen));
  return (
    <div className="mx-auto flex w-full max-w-5xl flex-col gap-4">
      <p data-testid="incident-open-count" className="font-mono text-sm tabular-nums text-muted-foreground">{open} open</p>
      {error && !data ? (
        <Alert variant="destructive"><AlertDescription>Backend unreachable.</AlertDescription></Alert>
      ) : !sorted ? (
        <Card>
          <CardHeader><Skeleton className="h-6 w-1/2" /></CardHeader>
          <CardContent className="flex flex-col gap-4">
            <Skeleton className="h-12 w-32" />
            <Skeleton className="h-24 w-full" />
            <Skeleton className="h-9 w-40" />
          </CardContent>
        </Card>
      ) : sorted.length === 0 ? (
        <Empty className="border">
          <EmptyHeader>
            <EmptyMedia variant="icon"><SirenIcon /></EmptyMedia>
            <EmptyTitle>No incidents</EmptyTitle>
            <EmptyDescription>A spike of matching failures opens one here.</EmptyDescription>
          </EmptyHeader>
        </Empty>
      ) : (
        <div className="flex flex-col gap-5">
          {sorted.map((i) => <IncidentCard key={i.id} incident={i} onChanged={() => void mutate()} />)}
        </div>
      )}
    </div>
  );
}
