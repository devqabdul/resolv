'use client';
import { useState } from "react";
import { SirenIcon } from "@phosphor-icons/react";
import IncidentCard from "@/components/IncidentCard";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import { Empty, EmptyDescription, EmptyHeader, EmptyMedia, EmptyTitle } from "@/components/ui/empty";
import { Skeleton } from "@/components/ui/skeleton";
import { Table, TableBody, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { useIncidents, type Incident } from "@/lib/api";

const FILTERS: { id: string; label: string; keep: (i: Incident) => boolean }[] = [
  { id: "open", label: "Open", keep: (i) => i.status !== "RESOLVED" },
  { id: "resolved", label: "Resolved", keep: (i) => i.status === "RESOLVED" },
  { id: "all", label: "All", keep: () => true },
];
const COLS = ["Incident", "First seen", "Tickets", "Type", "Status"];

export default function Incidents() {
  const { data, error } = useIncidents();
  const [filter, setFilter] = useState("open");
  const sorted = data && [...data].sort((a, b) => b.first_seen.localeCompare(a.first_seen));
  const rows = sorted?.filter(FILTERS.find((f) => f.id === filter)!.keep);
  return (
    <div className="mx-auto flex w-full max-w-6xl flex-col gap-4">
      <Tabs value={filter} onValueChange={setFilter}>
        <TabsList className="h-10 rounded-full">
          {FILTERS.map((f) => (
            <TabsTrigger key={f.id} value={f.id} className="gap-2 rounded-full px-3">
              {f.label}
              <Badge
                variant="secondary"
                data-testid={f.id === "open" ? "incident-open-count" : undefined}
                className="h-5 rounded-full px-1.5 font-mono tabular-nums"
              >
                {sorted?.filter(f.keep).length ?? 0}
              </Badge>
            </TabsTrigger>
          ))}
        </TabsList>
      </Tabs>
      {error && !data ? (
        <Alert variant="destructive"><AlertDescription>Backend unreachable.</AlertDescription></Alert>
      ) : (
        <Card className="shadow-sm">
          <CardContent>
            {!rows ? (
              <div className="flex flex-col">
                {Array.from({ length: 4 }, (_, i) => (
                  <div key={i} className="flex items-center gap-4 border-b py-3">
                    <Skeleton className="size-8 rounded-md" />
                    <div className="flex flex-1 flex-col gap-2">
                      <Skeleton className="h-4 w-28" />
                      <Skeleton className="h-4 w-1/2" />
                    </div>
                    {[24, 10, 40, 24].map((w, j) => <Skeleton key={j} className="h-6 rounded-full" style={{ width: `${w * 4}px` }} />)}
                  </div>
                ))}
              </div>
            ) : rows.length === 0 ? (
              <Empty className="py-16">
                <EmptyHeader>
                  <EmptyMedia variant="icon"><SirenIcon /></EmptyMedia>
                  <EmptyTitle>No incidents</EmptyTitle>
                  <EmptyDescription>A spike of matching failures opens one here.</EmptyDescription>
                </EmptyHeader>
              </Empty>
            ) : (
              <Table className="text-base">
                <TableHeader>
                  <TableRow className="hover:bg-transparent">
                    {COLS.map((c) => <TableHead key={c} className="px-2 text-sm text-muted-foreground">{c}</TableHead>)}
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {rows.map((i) => <IncidentCard key={i.id} incident={i} />)}
                </TableBody>
              </Table>
            )}
          </CardContent>
        </Card>
      )}
    </div>
  );
}
