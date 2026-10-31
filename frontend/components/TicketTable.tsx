'use client';
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { useSWRConfig } from "swr";
import { toast } from "sonner";
import { AnimatePresence, motion, useReducedMotion } from "motion/react";
import { ArrowClockwiseIcon, CaretUpDownIcon, CopyIcon, DotsThreeIcon, TrayIcon, WarningCircleIcon, XIcon } from "@phosphor-icons/react";
import { Alert, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardFooter, CardHeader, CardTitle } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import {
  DropdownMenu, DropdownMenuContent, DropdownMenuGroup, DropdownMenuItem, DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Empty, EmptyHeader, EmptyMedia, EmptyTitle } from "@/components/ui/empty";
import { Label } from "@/components/ui/label";
import {
  Pagination, PaginationContent, PaginationEllipsis, PaginationItem, PaginationLink, PaginationNext, PaginationPrevious,
} from "@/components/ui/pagination";
import { Select, SelectContent, SelectGroup, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { rerunTicket, useTickets, type Ticket } from "@/lib/api";
import { slaCountdown } from "@/lib/format";
import { cn } from "@/lib/utils";
import { toneBadge, type Tone } from "./status-tone";
import PriorityBadge from "./PriorityBadge";
import StatusBadge from "./StatusBadge";
import TypeBadge from "./TypeBadge";

const EASE = [0.16, 1, 0.3, 1] as const;
const MAX_ANIMATED = 20; // a 120-ticket spike animates only its first 20 rows
const NARROW = "w-px whitespace-nowrap";
const ALL = "all";
const PATH_TONE: Record<string, Tone> = { RESOLVE: "resolved", ROUTE: "new", ESCALATE: "routed" };
const DONE = ["RESOLVED", "CLOSED"];

// (decision: UI-1) "Open" matches the KPI: not RESOLVED / CLOSED / INCIDENT_LINKED.
const FILTERS: { id: string; label: string; keep: (t: Ticket) => boolean }[] = [
  { id: "all", label: "All", keep: () => true },
  { id: "open", label: "Open", keep: (t) => !["RESOLVED", "CLOSED", "INCIDENT_LINKED"].includes(t.status) },
  { id: "awaiting", label: "Awaiting approval", keep: (t) => t.status === "AWAITING_APPROVAL" },
  { id: "resolved", label: "Resolved", keep: (t) => DONE.includes(t.status) },
  { id: "incident", label: "Incident", keep: (t) => !!t.incident_id },
];

// SLA state: resolved tickets compare resolved_at with the deadline, open ones compare now.
type Sla = { text: string; tone: string; state: "breached" | "due" | "ok" | null };
function slaOf(t: Ticket, now: number): Sla {
  if (!t.sla_due_at) return { text: "-", tone: "text-muted-foreground", state: null };
  if (DONE.includes(t.status)) {
    if (!t.resolved_at) return { text: "-", tone: "text-muted-foreground", state: null };
    const m = slaCountdown(t.sla_due_at, new Date(t.resolved_at).getTime());
    return m.overdue
      ? { text: `+${m.text.slice(1)}`, tone: "bg-status-failed/12 text-status-failed", state: "breached" }
      : { text: `-${m.text}`, tone: "bg-status-resolved/12 text-status-resolved", state: "ok" };
  }
  const c = slaCountdown(t.sla_due_at, now);
  // Green > 5 min left, amber <= 5 min, red once breached. (decision: FIX3: first-response SLA is 15 min, so amber at 15 showed on every new ticket)
  if (c.overdue) return { text: c.text, tone: "bg-status-failed/12 text-status-failed", state: "breached" };
  if (new Date(t.sla_due_at).getTime() - now <= 5 * 60_000) return { text: c.text, tone: "bg-status-awaiting/12 text-status-awaiting", state: "due" };
  return { text: c.text, tone: "bg-status-resolved/12 text-status-resolved", state: "ok" };
}

type SortKey = "created_at" | "ticket_type" | "priority" | "status" | "path" | "sla_due_at" | "resolved_by";
const COLS: { label: string; sort?: SortKey }[] = [
  { label: "Ticket", sort: "created_at" },
  { label: "Type", sort: "ticket_type" },
  { label: "Priority", sort: "priority" },
  { label: "Status", sort: "status" },
  { label: "Path", sort: "path" },
  { label: "SLA", sort: "sla_due_at" },
  { label: "Incident" },
  { label: "Resolved by", sort: "resolved_by" },
];
const SLA_FILTERS = [
  { id: "breached", label: "Breached" },
  { id: "due", label: "Due ≤ 5 min" },
  { id: "ok", label: "On track" },
];

// 1 … cur-1 cur cur+1 … last
function pageList(cur: number, last: number): (number | "gap")[] {
  const out: (number | "gap")[] = [];
  for (let p = 1; p <= last; p++) {
    if (p === 1 || p === last || Math.abs(p - cur) <= 1) out.push(p);
    else if (out[out.length - 1] !== "gap") out.push("gap");
  }
  return out;
}

function FilterSelect({ id, label, value, onChange, options }: {
  id: string; label: string; value: string; onChange: (v: string) => void; options: { value: string; label: string }[];
}) {
  return (
    <div className="flex flex-col gap-1">
      <Label htmlFor={id} className="text-xs text-muted-foreground">{label}</Label>
      <Select value={value} onValueChange={onChange}>
        <SelectTrigger id={id} size="sm" className="min-w-32">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          <SelectGroup>
            {options.map((o) => <SelectItem key={o.value} value={o.value}>{o.label}</SelectItem>)}
          </SelectGroup>
        </SelectContent>
      </Select>
    </div>
  );
}

export default function TicketTable({ incidentId, onClearIncident }: { incidentId?: string; onClearIncident: () => void }) {
  const router = useRouter();
  const reduce = useReducedMotion();
  const { mutate } = useSWRConfig();
  const { data, error } = useTickets({ limit: 200, incident_id: incidentId });
  const [filter, setFilter] = useState("all");
  const [type, setType] = useState(ALL);
  const [priority, setPriority] = useState(ALL);
  const [channel, setChannel] = useState(ALL);
  const [slaFilter, setSlaFilter] = useState(ALL);
  const [sort, setSort] = useState<{ key: SortKey; dir: 1 | -1 } | null>(null);
  const [page, setPage] = useState(1);
  const [size, setSize] = useState(10);
  const [selected, setSelected] = useState<Set<string>>(new Set());
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

  const all = data?.items ?? [];
  const reset = <T,>(set: (v: T) => void) => (v: T) => {
    set(v);
    setPage(1);
  };
  const filtered = all.filter(
    (t) =>
      (type === ALL || t.ticket_type === type) &&
      (priority === ALL || t.priority === priority) &&
      (channel === ALL || t.channel === channel) &&
      (slaFilter === ALL || slaOf(t, now).state === slaFilter),
  );
  const items = filtered.filter(FILTERS.find((f) => f.id === filter)!.keep);
  const byCreated = (a: Ticket, b: Ticket) => b.created_at.localeCompare(a.created_at);
  const sorted = sort
    ? [...items].sort((a, b) => {
        const x = a[sort.key] ?? "";
        const y = b[sort.key] ?? "";
        if (!x !== !y) return x ? -1 : 1; // empty values last either way
        return x.localeCompare(y) * sort.dir;
      })
    : // (decision: FIX5) default: newest first, non-incident rows first so D1/D3 stay on top after a spike
      [...items].sort((a, b) => Number(!!a.incident_id) - Number(!!b.incident_id) || byCreated(a, b));
  const last = Math.max(1, Math.ceil(sorted.length / size));
  const cur = Math.min(page, last);
  const rows = sorted.slice((cur - 1) * size, cur * size);
  const pageIds = rows.map((t) => t.id);
  const pageChecked = pageIds.length > 0 && pageIds.every((id) => selected.has(id));
  const pageSome = pageIds.some((id) => selected.has(id));

  const distinct = (pick: (t: Ticket) => string | null) => [...new Set(all.map(pick).filter((v): v is string => !!v))].sort();
  const toggleSort = (key: SortKey) =>
    setSort((s) => (s?.key === key ? { key, dir: s.dir === 1 ? -1 : 1 } : { key, dir: key === "created_at" ? -1 : 1 }));
  const toggleRow = (id: string, on: boolean) =>
    setSelected((s) => {
      const n = new Set(s);
      if (on) n.add(id);
      else n.delete(id);
      return n;
    });
  const clearFilters = () => {
    setFilter("all");
    setType(ALL);
    setPriority(ALL);
    setChannel(ALL);
    setSlaFilter(ALL);
    setPage(1);
  };
  const rerun = async (ids: string[]) => {
    const res = await Promise.allSettled(ids.map((id) => rerunTicket(id)));
    const failed = res.filter((r) => r.status === "rejected").length;
    if (failed) toast.error(`Re-run failed for ${failed} of ${ids.length} tickets.`);
    else toast.success(ids.length === 1 ? `Re-ran ${ids[0]}.` : `Re-ran ${ids.length} tickets.`);
    void mutate((k) => typeof k === "string" && k.startsWith("/api/tickets"));
  };
  const copyId = async (id: string) => {
    try {
      await navigator.clipboard.writeText(id);
      toast.success(`Copied ${id}.`);
    } catch {
      toast.error("Clipboard unavailable.");
    }
  };

  const topBar = (
    <CardHeader className="flex flex-col gap-4 border-b">
      <CardTitle className="sr-only">Tickets</CardTitle>
      <div className="flex w-full flex-wrap items-end gap-4">
        <Tabs value={filter} onValueChange={(v) => (v === "awaiting" ? router.push("/approvals") : reset(setFilter)(v))}>
          <TabsList variant="line" aria-label="Filter by status">
            {FILTERS.map((f) => (
              <TabsTrigger key={f.id} value={f.id} className="px-2">
                {f.label} <span className="font-mono text-muted-foreground tabular-nums">({filtered.filter(f.keep).length})</span>
              </TabsTrigger>
            ))}
          </TabsList>
        </Tabs>
        <div className="ml-auto flex flex-wrap items-end gap-3">
          <FilterSelect id="f-type" label="Type" value={type} onChange={reset(setType)}
            options={[{ value: ALL, label: "All types" }, ...distinct((t) => t.ticket_type).map((v) => ({ value: v, label: v }))]} />
          <FilterSelect id="f-priority" label="Priority" value={priority} onChange={reset(setPriority)}
            options={[{ value: ALL, label: "All priorities" }, ...["P1", "P2", "P3", "P4"].map((v) => ({ value: v, label: v }))]} />
          <FilterSelect id="f-channel" label="Channel" value={channel} onChange={reset(setChannel)}
            options={[{ value: ALL, label: "All channels" }, ...distinct((t) => t.channel).map((v) => ({ value: v, label: v }))]} />
          <FilterSelect id="f-sla" label="SLA" value={slaFilter} onChange={reset(setSlaFilter)}
            options={[{ value: ALL, label: "All" }, ...SLA_FILTERS.map((f) => ({ value: f.id, label: f.label }))]} />
          <Button variant="link" size="sm" onClick={clearFilters}>Clear</Button>
          <span className="pb-1 font-mono text-sm whitespace-nowrap text-muted-foreground tabular-nums">
            {data ? `${sorted.length} tickets` : ""}
          </span>
        </div>
      </div>
      {incidentId && (
        <Badge variant="secondary" className="h-8 gap-1.5 rounded-full pr-1 pl-3 text-sm">
          Filtered by incident <span className="font-mono">{incidentId}</span>
          <Button variant="ghost" size="icon-xs" className="rounded-full" aria-label="Clear incident filter" onClick={onClearIncident}>
            <XIcon />
          </Button>
        </Badge>
      )}
    </CardHeader>
  );

  if (!data || all.length === 0) {
    return (
      <Card className="shadow-sm">
        {topBar}
        <CardContent>
          {error && !data ? (
            <Alert variant="destructive">
              <WarningCircleIcon />
              <AlertTitle>Backend unreachable.</AlertTitle>
            </Alert>
          ) : !data ? (
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
          ) : (
            <Empty className="py-16">
              <EmptyHeader>
                <EmptyMedia variant="icon"><TrayIcon /></EmptyMedia>
                <EmptyTitle data-testid="queue-empty" className="text-base">No tickets yet. Open ?demo=1, then Seed and inject a scenario.</EmptyTitle>
              </EmptyHeader>
            </Empty>
          )}
        </CardContent>
      </Card>
    );
  }

  const stop = (e: React.MouseEvent) => e.stopPropagation();
  return (
    <Card className="shadow-sm">
      {topBar}
      <CardContent className="flex flex-col gap-2">
        {selected.size > 0 && (
          <div className="flex items-center gap-3 rounded-lg bg-muted px-3 py-1.5 text-sm">
            <span className="font-medium"><span className="font-mono tabular-nums">{selected.size}</span> selected</span>
            <Button variant="outline" size="sm" onClick={() => rerun([...selected])}>
              <ArrowClockwiseIcon data-icon="inline-start" />
              Re-run
            </Button>
            <Button variant="ghost" size="sm" onClick={() => setSelected(new Set())}>Clear selection</Button>
          </div>
        )}
        <Table data-testid="ticket-table" className="text-base">
          <TableHeader>
            <TableRow className="hover:bg-transparent">
              <TableHead className={cn("px-2", NARROW)}>
                <Checkbox
                  aria-label="Select page"
                  checked={pageChecked ? true : pageSome ? "indeterminate" : false}
                  onCheckedChange={(on) => setSelected((s) => {
                    const n = new Set(s);
                    pageIds.forEach((id) => (on === true ? n.add(id) : n.delete(id)));
                    return n;
                  })}
                />
              </TableHead>
              {COLS.map((c, i) => (
                <TableHead key={c.label} className={cn("px-2 text-sm text-muted-foreground", i > 0 && NARROW)} aria-sort={sort && sort.key === c.sort ? (sort.dir === 1 ? "ascending" : "descending") : undefined}>
                  {c.sort ? (
                    <Button variant="ghost" size="sm" className="-ml-2 text-muted-foreground" onClick={() => toggleSort(c.sort!)}>
                      {c.label}
                      <CaretUpDownIcon data-icon="inline-end" />
                    </Button>
                  ) : c.label}
                </TableHead>
              ))}
              <TableHead className={cn("px-2", NARROW)}><span className="sr-only">Actions</span></TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            <AnimatePresence initial={false}>
              {rows.map((t) => {
                const sla = slaOf(t, now);
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
                    data-state={selected.has(t.id) ? "selected" : undefined}
                    className="cursor-pointer border-b transition-colors hover:bg-muted/50 data-[state=selected]:bg-muted"
                    onClick={() => router.push(`/tickets/${t.id}`)}
                  >
                    <TableCell className={cn("px-2", NARROW)} onClick={stop}>
                      <Checkbox aria-label={`Select ${t.id}`} checked={selected.has(t.id)} onCheckedChange={(on) => toggleRow(t.id, on === true)} />
                    </TableCell>
                    <TableCell className="w-full max-w-0 min-w-32 px-2 py-2.5">
                      <Link href={`/tickets/${t.id}`} onClick={stop} className="font-mono text-sm font-medium text-highlight-text hover:underline">
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
                      {t.assigned_team && t.status !== "RESOLVED" && t.status !== "CLOSED" && (
                        <Badge data-testid="ticket-team" variant="outline" className="ml-1.5 font-mono">{t.assigned_team}</Badge>
                      )}
                    </TableCell>
                    <TableCell data-testid="ticket-path" className={cn("px-2", NARROW)}>
                      {t.path ? <Badge className={toneBadge({ tone: PATH_TONE[t.path], className: "font-mono" })}>{t.path}</Badge> : <span className="text-muted-foreground">-</span>}
                    </TableCell>
                    <TableCell data-testid="sla-countdown" className={cn("px-2", NARROW)}>
                      <span className={cn("inline-flex h-7 items-center rounded-full px-2.5 font-mono text-sm font-medium tabular-nums", sla.tone)}>
                        {sla.text}
                      </span>
                    </TableCell>
                    <TableCell className={cn("px-2", NARROW)}>
                      {t.incident_id ? (
                        <Link
                          href="/incidents"
                          data-testid="incident-badge"
                          title={t.incident_id}
                          onClick={stop}
                          className="inline-flex h-6 items-center rounded-full bg-status-processing/12 px-2.5 text-sm font-medium text-status-processing hover:bg-status-processing/20"
                        >
                          INCIDENT
                        </Link>
                      ) : <span className="text-muted-foreground">-</span>}
                    </TableCell>
                    <TableCell data-testid="resolved-by" className={cn("px-2", NARROW)}>
                      {t.resolved_by ? (
                        <Badge
                          variant={t.resolved_by === "resolv" ? "default" : "outline"}
                          className={cn(
                            "h-6 px-2.5 text-sm",
                            t.resolved_by === "resolv" ? "bg-highlight text-highlight-foreground" : "border-primary text-primary",
                          )}
                        >
                          {t.resolved_by}
                        </Badge>
                      ) : <span className="text-muted-foreground">-</span>}
                    </TableCell>
                    <TableCell className={cn("px-2", NARROW)} onClick={stop}>
                      <DropdownMenu>
                        <DropdownMenuTrigger asChild>
                          <Button variant="ghost" size="icon-sm" aria-label={`Actions for ${t.id}`}>
                            <DotsThreeIcon />
                          </Button>
                        </DropdownMenuTrigger>
                        <DropdownMenuContent align="end">
                          <DropdownMenuGroup>
                            <DropdownMenuItem onSelect={() => router.push(`/tickets/${t.id}`)}>Open ticket</DropdownMenuItem>
                            <DropdownMenuItem onSelect={() => rerun([t.id])}>
                              <ArrowClockwiseIcon />
                              Re-run
                            </DropdownMenuItem>
                            <DropdownMenuItem onSelect={() => copyId(t.id)}>
                              <CopyIcon />
                              Copy ticket id
                            </DropdownMenuItem>
                          </DropdownMenuGroup>
                        </DropdownMenuContent>
                      </DropdownMenu>
                    </TableCell>
                  </motion.tr>
                );
              })}
            </AnimatePresence>
            {rows.length === 0 && (
              <TableRow className="hover:bg-transparent">
                <TableCell colSpan={COLS.length + 2} className="px-3 py-8 text-center text-sm text-muted-foreground">No tickets match this filter.</TableCell>
              </TableRow>
            )}
          </TableBody>
        </Table>
      </CardContent>
      <CardFooter className="flex flex-wrap items-center gap-4 border-t py-3">
        <span className="text-sm text-muted-foreground">
          Showing <span className="font-mono tabular-nums">{sorted.length ? (cur - 1) * size + 1 : 0}-{Math.min(cur * size, sorted.length)}</span> of{" "}
          <span className="font-mono tabular-nums">{sorted.length}</span> tickets
        </span>
        <div className="ml-auto flex items-center gap-3">
          <Pagination className="mx-0 w-auto">
            <PaginationContent>
              <PaginationItem>
                <PaginationPrevious
                  href="#"
                  aria-disabled={cur === 1}
                  className={cn(cur === 1 && "pointer-events-none opacity-50")}
                  onClick={(e) => { e.preventDefault(); setPage(Math.max(1, cur - 1)); }}
                />
              </PaginationItem>
              {pageList(cur, last).map((p, i) =>
                p === "gap" ? (
                  <PaginationItem key={`gap-${i}`}><PaginationEllipsis /></PaginationItem>
                ) : (
                  <PaginationItem key={p}>
                    <PaginationLink
                      href="#"
                      isActive={p === cur}
                      className={cn("font-mono tabular-nums", p === cur && "border-primary bg-primary text-primary-foreground hover:bg-primary/90 hover:text-primary-foreground")}
                      onClick={(e) => { e.preventDefault(); setPage(p); }}
                    >
                      {p}
                    </PaginationLink>
                  </PaginationItem>
                ),
              )}
              <PaginationItem>
                <PaginationNext
                  href="#"
                  aria-disabled={cur === last}
                  className={cn(cur === last && "pointer-events-none opacity-50")}
                  onClick={(e) => { e.preventDefault(); setPage(Math.min(last, cur + 1)); }}
                />
              </PaginationItem>
            </PaginationContent>
          </Pagination>
          <Select value={String(size)} onValueChange={(v) => { setSize(Number(v)); setPage(1); }}>
            <SelectTrigger size="sm" aria-label="Rows per page" className="font-mono tabular-nums">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectGroup>
                {[10, 25, 50].map((n) => <SelectItem key={n} value={String(n)} className="font-mono">{n} / page</SelectItem>)}
              </SelectGroup>
            </SelectContent>
          </Select>
        </div>
      </CardFooter>
    </Card>
  );
}
