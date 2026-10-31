'use client';
import { useState } from "react";
import { CaretDownIcon } from "@phosphor-icons/react";
import { toneBadge } from "@/components/status-tone";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { cn } from "@/lib/utils";
import { Info } from "./tables";
import type { Miss } from "./types";

const MISS_LIMIT = 8;

const Pill = ({ children, bad }: { children: React.ReactNode; bad?: boolean }) => (
  <Badge variant="outline" className={toneBadge({ tone: bad ? "failed" : "resolved" })}>{children}</Badge>
);
const PathPill = ({ children, bad }: { children: React.ReactNode; bad?: boolean }) => (
  <Badge variant="outline" className={cn(toneBadge({ tone: bad ? "failed" : "closed" }), "font-mono")}>{children}</Badge>
);

function Row({ m }: { m: Miss }) {
  return (
    <TableRow>
      <TableCell className="font-mono">{m.id}</TableCell>
      <TableCell><Pill>{m.expected_type}</Pill></TableCell>
      <TableCell><Pill bad={m.actual_type !== m.expected_type}>{m.actual_type}</Pill></TableCell>
      <TableCell><PathPill>{m.expected_path}</PathPill></TableCell>
      <TableCell><PathPill bad={m.actual_path !== m.expected_path}>{m.actual_path}</PathPill></TableCell>
    </TableRow>
  );
}

export function MissesCard({ misses }: { misses: Miss[] }) {
  const [open, setOpen] = useState(false);
  const head = (
    <TableHeader>
      <TableRow>
        <TableHead>ID</TableHead>
        <TableHead>Expected type</TableHead>
        <TableHead>Predicted type</TableHead>
        <TableHead>Expected path</TableHead>
        <TableHead>Predicted path</TableHead>
      </TableRow>
    </TableHeader>
  );
  return (
    <Card className="shadow-sm">
      <CardHeader>
        <CardTitle className="flex items-center gap-2">Misses ({misses.length}) <Info label="About misses" text="Labelled tickets where the predicted type or path differs from the label. Money actions executed on a miss count as false actions." /></CardTitle>
      </CardHeader>
      <CardContent className="flex flex-col gap-2">
        {misses.length === 0 ? (
          <p className="text-sm text-muted-foreground">No misses in this run.</p>
        ) : (
          <Collapsible open={open} onOpenChange={setOpen}>
            <Table>
              {head}
              <TableBody>{misses.slice(0, MISS_LIMIT).map((m) => <Row key={m.id} m={m} />)}</TableBody>
            </Table>
            {misses.length > MISS_LIMIT && (
              <>
                <CollapsibleContent>
                  <Table>
                    <TableBody>{misses.slice(MISS_LIMIT).map((m) => <Row key={m.id} m={m} />)}</TableBody>
                  </Table>
                </CollapsibleContent>
                <CollapsibleTrigger asChild>
                  <Button variant="ghost" size="sm" className="mt-2">
                    {open ? "Show fewer" : `Show all ${misses.length}`}
                    <CaretDownIcon data-icon="inline-end" className={cn(open && "rotate-180")} />
                  </Button>
                </CollapsibleTrigger>
              </>
            )}
          </Collapsible>
        )}
      </CardContent>
    </Card>
  );
}
