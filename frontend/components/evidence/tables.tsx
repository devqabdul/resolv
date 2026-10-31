'use client';
import { InfoIcon } from "@phosphor-icons/react";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import type { EvalsPathClass } from "@/lib/api";
import { f2, pct1, type PerType } from "./types";

const num = "text-right font-mono tabular-nums";

export function Info({ text, label }: { text: string; label: string }) {
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <button type="button" aria-label={label} className="text-muted-foreground hover:text-foreground">
          <InfoIcon className="size-4" />
        </button>
      </TooltipTrigger>
      <TooltipContent>{text}</TooltipContent>
    </Tooltip>
  );
}

export function PathTable({ data }: { data: Record<string, EvalsPathClass> }) {
  return (
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
        {Object.entries(data).map(([k, c]) => (
          <TableRow key={k}>
            <TableCell className="font-mono">{k}</TableCell>
            <TableCell className={num}>{f2(c.precision)}</TableCell>
            <TableCell className={num}>{f2(c.recall)}</TableCell>
            <TableCell className={num}>{f2(c.f1)}</TableCell>
            <TableCell className={num}>{c.support}</TableCell>
          </TableRow>
        ))}
      </TableBody>
    </Table>
  );
}

export function TypeTable({ data }: { data: [string, PerType][] }) {
  return (
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
        {data.map(([t, p]) => (
          <TableRow key={t}>
            <TableCell className="font-mono whitespace-normal wrap-anywhere">{t}</TableCell>
            <TableCell className={num}>{p.n}</TableCell>
            <TableCell className={num}>{p.correct ?? Math.round(p.n * p.type_accuracy)}</TableCell>
            <TableCell className={num}>{pct1(p.type_accuracy)}</TableCell>
          </TableRow>
        ))}
      </TableBody>
    </Table>
  );
}
