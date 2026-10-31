'use client';
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { AnimatePresence, motion, useReducedMotion } from "motion/react";
import { TrayIcon, WarningCircleIcon, XIcon } from "@phosphor-icons/react";
import { Alert, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Empty, EmptyHeader, EmptyMedia, EmptyTitle } from "@/components/ui/empty";
import { Skeleton } from "@/components/ui/skeleton";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import { useTickets, type Ticket } from "@/lib/api";
import { slaCountdown } from "@/lib/format";
import { cn } from "@/lib/utils";
import PriorityBadge from "./PriorityBadge";
import StatusBadge from "./StatusBadge";
import TypeBadge from "./TypeBadge";

const EASE = [0.16, 1, 0.3, 1] as const;
const MAX_ANIMATED = 20; // a 120-ticket spike animates only its first 20 rows
const COLS = ["Ticket", "Type", "Priority", "Status", "Path", "SLA", "Incident", "Resolved by"];
const NARROW = "w-px whitespace-nowrap";

// (decision: UI-1) "Open" matches the KPI: not RESOLVED / CLOSED / INCIDENT_LINKED.
const FILTERS: { id: string; label: string; keep: (t: Ticket) => boolean }[] = [
  { id: "all", label: "All", keep: () => true },
  { id: "open", label: "Open", keep: (t) => !["RESOLVED", "CLOSED", "INCIDENT_LINKED"].includes(t.status) },
  { id: "awaiting", label: "Awaiting approval", keep: (t) => t.status === "AWAITING_APPROVAL" },
  { id: "resolved", label: "Resolved", keep: (t) => t.status === "RESOLVED" || t.status === "CLOSED" },
  { id: "incident", label: "Incident", keep: (t) => !!t.incident_id },
];

// Green > 5 min left, amber <= 5 min, red once breached. (decision: FIX3: first-response SLA is 15 min, so amber at 15 showed on every new ticket)
function slaTone(due: string | null, now: number, overdue: boolean): string {
  if (!due) return "text-muted-foreground";
  if (overdue) return "bg-status-failed/12 text-status-failed";
  return new Date(due).getTime() - now <= 5 * 60_000 ? "bg-status-awaiting/12 text-status-awaiting" : "bg-status-resolved/12 text-status-resolved";
}

export default function TicketTable({ incidentId, onClearIncident }: { incidentId?: string; onClearIncident: () => void }) {
  const router = useRouter();
  const reduce = useReducedMotion();
  const { data, error } = useTickets({ limit: 200, incident_id: incidentId });
  const [filter, setFilter] = useState("all");
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, []);

  // Rows already on screen never re-animate; the first load does not animate at all.
  const seen = useRef<Set<string> | null>(null);
  const fresh = new Set<string>();
  if (data && seen.current) {
    for (const t of data.items) {
      if (fresh.size >= MAX_ANIMATED) break;
      if (!seen.current.has(t.id)) fresh.add(t.id);
    }
  }
  useEffect(() => {
    if (data) seen.current = new Set([...(seen.current ?? []), ...data.items.map((t) => t.id)]);
  }, [data]);

  // (decision: FIX5) stable sort: non-incident rows first so D1/D3 stay on top after a spike
  const all = data ? [...data.items].sort((a, b) => Number(!!a.incident_id) - Number(!!b.incident_id)) : [];
  const items = all.filter(FILTERS.find((f) => f.id === filter)!.keep);

  const toolbar = (
    <div className="flex flex-wrap items-center gap-3">
      <ToggleGroup type="single" variant="outline" spacing={0} value={filter} onValueChange={(v) => v && setFilter(v)} aria-label="Filter by status">
        {FILTERS.map((f) => (
          <ToggleGroupItem key={f.id} value={f.id} className="px-3">{f.label}</ToggleGroupItem>
        ))}
      </ToggleGroup>
      {incidentId && (
        <Badge variant="secondary" className="h-8 gap-1.5 rounded-full pr-1 pl-3 text-sm">
          Filtered by incident <span className="font-mono">{incidentId}</span>
          <Button variant="ghost" size="icon-xs" className="rounded-full" aria-label="Clear incident filter" onClick={onClearIncident}>
            <XIcon />
          </Button>
        </Badge>
      )}
      <span className="ml-auto font-mono text-sm text-muted-foreground tabular-nums">
        {data ? `${items.length} of ${all.length}` : ""}
      </span>
    </div>
  );

  if (!data) {
    return (
      <div className="flex flex-col gap-4">
        {toolbar}
        {error ? (
          <Alert variant="destructive">
            <WarningCircleIcon />
            <AlertTitle>Backend unreachable.</AlertTitle>
          </Alert>
        ) : (
          <div className="flex flex-col">
            {Array.from({ length: 8 }, (_, i) => (
              <div key={i} className="flex items-center gap-4 border-b py-3">
                <div className="flex flex-1 flex-col gap-2">
                  <Skeleton className="h-4 w-28" />
                  <Skeleton className="h-3 w-3/4" />
                </div>
                {[24, 10, 32, 16, 16].map((w, j) => <Skeleton key={j} className="h-6 rounded-full" style={{ width: `${w * 4}px` }} />)}
              </div>
            ))}
          </div>
        )}
      </div>
    );
  }

  if (all.length === 0) {
    return (
      <div className="flex flex-col gap-4">
        {toolbar}
        <Empty className="border py-16">
          <EmptyHeader>
            <EmptyMedia variant="icon"><TrayIcon /></EmptyMedia>
            <EmptyTitle data-testid="queue-empty" className="text-base">No tickets yet. Open ?demo=1, then Seed and inject a scenario.</EmptyTitle>
          </EmptyHeader>
        </Empty>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-4">
      {toolbar}
      <Table data-testid="ticket-table" className="text-base">
        <TableHeader>
          <TableRow className="hover:bg-transparent">
            {COLS.map((h, i) => (
              <TableHead key={h} className={cn("px-2 text-sm text-muted-foreground", i > 0 && NARROW)}>{h}</TableHead>
            ))}
          </TableRow>
        </TableHeader>
        <TableBody>
          <AnimatePresence initial={false}>
            {items.map((t) => {
              const sla = slaCountdown(t.sla_due_at, now);
              const animate = !reduce && fresh.has(t.id);
              return (
                <motion.tr
                  key={t.id}
                  layout={reduce ? false : "position"}
                  initial={animate ? { opacity: 0, y: 8 } : false}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ duration: 0.2, ease: EASE }}
                  data-slot="table-row"
                  data-testid="ticket-row"
                  data-ticket-id={t.id}
                  data-status={t.status}
                  className="cursor-pointer border-b transition-colors hover:bg-muted/50"
                  onClick={() => router.push(`/tickets/${t.id}`)}
                >
                  <TableCell className="w-full max-w-0 min-w-32 px-2 py-2.5">
                    <Link href={`/tickets/${t.id}`} onClick={(e) => e.stopPropagation()} className="font-mono text-sm font-medium text-primary hover:underline">
                      {t.id}
                    </Link>
                    <div className="truncate text-sm text-muted-foreground">{t.masked_text}</div>
                  </TableCell>
                  <TableCell className={cn("px-2", NARROW)}><TypeBadge type={t.ticket_type} /></TableCell>
                  <TableCell className={cn("px-2", NARROW)}><PriorityBadge priority={t.priority} /></TableCell>
                  <TableCell className={cn("px-2", NARROW)}>
                    <motion.span
                      key={t.status}
                      className="inline-flex"
                      initial={reduce || !seen.current?.has(t.id) ? false : { opacity: 0 }}
                      animate={{ opacity: 1 }}
                      transition={{ duration: 0.2, ease: EASE }}
                    >
                      <StatusBadge status={t.status} />
                    </motion.span>
                  </TableCell>
                  <TableCell data-testid="ticket-path" className={cn("px-2 font-mono text-sm", NARROW)}>{t.path ?? "-"}</TableCell>
                  <TableCell data-testid="sla-countdown" className={cn("px-2", NARROW)}>
                    <span className={cn("inline-flex h-7 items-center rounded-full px-2.5 font-mono text-sm font-medium tabular-nums", slaTone(t.sla_due_at, now, sla.overdue))}>
                      {sla.text}
                    </span>
                  </TableCell>
                  <TableCell className={cn("px-2", NARROW)}>
                    {t.incident_id && (
                      <Link
                        href="/incidents"
                        data-testid="incident-badge"
                        title={t.incident_id}
                        onClick={(e) => e.stopPropagation()}
                        className="inline-flex h-6 items-center rounded-full bg-status-incident/12 px-2.5 text-sm font-medium text-status-incident hover:bg-status-incident/20"
                      >
                        INCIDENT
                      </Link>
                    )}
                  </TableCell>
                  <TableCell data-testid="resolved-by" className={cn("px-2", NARROW)}>
                    {t.resolved_by && (
                      <span
                        className={cn(
                          "inline-flex h-6 items-center rounded-full px-2.5 text-sm font-medium",
                          t.resolved_by === "resolv" ? "bg-highlight text-highlight-foreground" : "bg-primary text-primary-foreground",
                        )}
                      >
                        {t.resolved_by}
                      </span>
                    )}
                  </TableCell>
                </motion.tr>
              );
            })}
          </AnimatePresence>
          {items.length === 0 && (
            <TableRow className="hover:bg-transparent">
              <TableCell colSpan={COLS.length} className="px-3 py-8 text-center text-sm text-muted-foreground">No tickets match this filter.</TableCell>
            </TableRow>
          )}
        </TableBody>
      </Table>
    </div>
  );
}
