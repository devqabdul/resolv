'use client';
import { Fragment, use, useEffect, useState } from "react";
import Link from "next/link";
import { AnimatePresence, motion, useReducedMotion } from "motion/react";
import { CaretLeftIcon, SlackLogoIcon } from "@phosphor-icons/react";
import { Bar, BarChart, CartesianGrid, XAxis, YAxis } from "recharts";
import { toast } from "sonner";
import AnimatedNumber from "@/components/animated-number";
import { fmtDate, IncidentStatus, sigParts } from "@/components/IncidentCard";
import StatusBadge from "@/components/StatusBadge";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardAction, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { ChartContainer, ChartTooltip, ChartTooltipContent } from "@/components/ui/chart";
import { Empty, EmptyHeader, EmptyTitle } from "@/components/ui/empty";
import { Skeleton } from "@/components/ui/skeleton";
import { Spinner } from "@/components/ui/spinner";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Textarea } from "@/components/ui/textarea";
import { ago } from "@/lib/format";
import { notifyIncident, useAudit, useIncident, type AuditEvent, type Incident, type Ticket } from "@/lib/api";

const BUCKET = 5 * 60 * 1000;
const hhmm = (t: number) => new Date(t).toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit", hour12: false });
const clock = (iso: string) => new Date(iso).toLocaleTimeString("en-GB", { hour12: false });
const dur = (ms: number) => {
  const s = Math.max(0, Math.round(ms / 1000));
  return s < 60 ? `${s}s` : `${Math.floor(s / 60)}m ${s % 60}s`;
};

// Linked tickets per 5 min, gaps filled with zero.
function trend(tickets: Ticket[]) {
  const ts = tickets.map((t) => Math.floor(new Date(t.created_at).getTime() / BUCKET) * BUCKET);
  if (!ts.length) return [];
  const counts = new Map<number, number>();
  ts.forEach((t) => counts.set(t, (counts.get(t) ?? 0) + 1));
  const out = [];
  for (let t = Math.min(...ts); t <= Math.max(...ts); t += BUCKET) out.push({ t, count: counts.get(t) ?? 0 });
  return out;
}

function NoticeCard({ inc, draft, setDraft, customers, onSent, className }: {
  inc: Incident; draft: string; setDraft: (s: string) => void; customers: number; onSent: () => void; className?: string;
}) {
  const [busy, setBusy] = useState(false);
  async function send() {
    setBusy(true);
    try {
      await notifyIncident(inc.id);
      toast.success("Notice sent");
      onSent();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }
  return (
    <Card className={className}>
      <CardHeader>
        <CardTitle>Proactive customer notice (draft)</CardTitle>
        <CardAction>
          <Button data-testid="incident-notify" disabled={busy || inc.status !== "OPEN"} onClick={send}>
            {busy && <Spinner data-icon="inline-start" />}
            Send notification
          </Button>
        </CardAction>
      </CardHeader>
      <CardContent className="flex flex-col gap-3">
        <Textarea
          data-testid="incident-notice-draft"
          aria-label="Notice draft"
          rows={5}
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
        />
        <p data-testid="incident-slack-status" className="flex items-center gap-2 font-mono text-sm tabular-nums">
          {inc.notified_at && <SlackLogoIcon aria-hidden />}
          {inc.notified_at ? `Notice sent at ${clock(inc.notified_at)}` : "Notice not sent"}
        </p>
        <p className="text-sm text-muted-foreground">
          This will be sent to all affected customers (<span className="font-mono tabular-nums">{customers}</span>) via in-app notification
        </p>
      </CardContent>
    </Card>
  );
}

function Loading() {
  return (
    <div className="flex flex-col gap-6">
      <Skeleton className="h-8 w-40" />
      <div className="flex flex-wrap justify-between gap-4">
        <div className="flex flex-col gap-2"><Skeleton className="h-8 w-56" /><Skeleton className="h-5 w-72" /></div>
        <Skeleton className="h-16 w-96" />
      </div>
      <Skeleton className="h-9 w-96" />
      <div className="grid gap-4 lg:grid-cols-3">{[0, 1, 2].map((i) => <Skeleton key={i} className="h-72" />)}</div>
    </div>
  );
}

export default function IncidentPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const { data, error, mutate } = useIncident(id);
  const { data: linked } = useAudit({ kind: "incident_linked", limit: 1000 });
  const { data: fast } = useAudit({ kind: "incident_fast_path", limit: 1000 });
  const { data: notes } = useAudit({ kind: "notification", limit: 1000 });
  const reduce = useReducedMotion();
  const [tab, setTab] = useState("overview");
  const [draft, setDraft] = useState<string | null>(null); // null = untouched, show the server draft
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 15000);
    return () => clearInterval(t);
  }, []);

  if (error && !data) {
    return (
      <div className="flex flex-col gap-4">
        <BackLink />
        <Alert variant="destructive"><AlertDescription>Incident {id} could not be loaded.</AlertDescription></Alert>
      </div>
    );
  }
  if (!data) return <Loading />;

  const { incident: inc, tickets } = data;
  const sig = sigParts(inc.signature);
  const mine = (e: AuditEvent) => e.payload.incident_id === id;
  const linkedEv = (linked ?? []).filter(mine).sort((a, b) => a.ts.localeCompare(b.ts));
  const fastTickets = new Set((fast ?? []).filter(mine).map((e) => e.ticket_id));
  const audit = [...linkedEv, ...(fast ?? []).filter(mine), ...(notes ?? []).filter((e) => e.ticket_id === id)]
    .sort((a, b) => b.ts.localeCompare(a.ts));
  // The cluster pass creates the incident and links its first tickets in one go, so the earliest
  // incident_linked event is the detection moment.
  const detected = linkedEv[0];
  const customers = tickets.filter((t) => t.customer_id).length;
  const series = trend(tickets);

  const stats: { label: string; value: React.ReactNode }[] = [
    ...(sig.bank ? [{ label: "Issuer bank", value: sig.bank }] : []),
    { label: "Tickets affected", value: <AnimatedNumber value={inc.ticket_count} /> },
    ...(fast && inc.ticket_count > 0
      ? [{ label: "LLM calls saved", value: `${Math.round((fastTickets.size / inc.ticket_count) * 100)}%` }]
      : []),
    ...(detected ? [{ label: "Detection time", value: dur(new Date(detected.ts).getTime() - new Date(inc.first_seen).getTime()) }] : []),
  ];

  const notice = (className?: string) => (
    <NoticeCard
      inc={inc}
      draft={draft ?? inc.proactive_notice_draft ?? ""}
      setDraft={setDraft}
      customers={customers}
      onSent={() => void mutate()}
      className={className}
    />
  );

  return (
    <div className="flex flex-col gap-6">
      <BackLink />

      <div className="flex flex-wrap items-start justify-between gap-6">
        <div className="flex min-w-0 flex-col gap-1">
          <div className="flex items-center gap-3">
            <h2 className="font-mono text-2xl font-bold">{inc.id}</h2>
            <AnimatePresence mode="wait" initial={false}>
              <motion.span
                key={inc.status}
                initial={reduce ? false : { opacity: 0 }}
                animate={{ opacity: 1 }}
                exit={reduce ? undefined : { opacity: 0 }}
                transition={{ duration: 0.2 }}
              >
                <IncidentStatus status={inc.status} />
              </motion.span>
            </AnimatePresence>
          </div>
          <p data-testid="incident-title" className="text-lg font-semibold">{inc.title}</p>
          <p className="text-sm text-muted-foreground">
            Detected at {fmtDate(detected?.ts ?? inc.first_seen, true)} ({ago(detected?.ts ?? inc.first_seen, now)})
          </p>
        </div>
        <dl className="flex flex-wrap items-stretch">
          {stats.map((s, i) => (
            <Fragment key={s.label}>
              {i > 0 && <div aria-hidden className="mx-6 w-px bg-border" />}
              <div className="flex flex-col gap-1">
                <dt className="text-sm text-muted-foreground">{s.label}</dt>
                <dd className="font-mono text-2xl font-semibold tabular-nums">{s.value}</dd>
              </div>
            </Fragment>
          ))}
        </dl>
      </div>

      <Tabs value={tab} onValueChange={setTab} className="gap-4">
        <TabsList variant="line">
          <TabsTrigger value="overview">Overview</TabsTrigger>
          <TabsTrigger value="tickets">Affected tickets</TabsTrigger>
          <TabsTrigger value="notice">Proactive notice</TabsTrigger>
          <TabsTrigger value="audit">Audit log</TabsTrigger>
        </TabsList>

        <TabsContent value="overview" className="grid items-start gap-4 lg:grid-cols-3">
          <Card>
            <CardHeader><CardTitle>Incident details</CardTitle></CardHeader>
            <CardContent>
              <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-3 text-sm">
                <dt className="text-muted-foreground">Signature</dt>
                <dd data-testid="incident-signature" className="font-mono break-words">
                  {inc.signature.split("|").map((p, i) => <Fragment key={i}>{i > 0 && <>|<wbr /></>}{p}</Fragment>)}
                </dd>
                {sig.reason && (
                  <>
                    <dt className="text-muted-foreground">Failure reason</dt>
                    <dd className="font-mono">{sig.reason}</dd>
                  </>
                )}
                <dt className="text-muted-foreground">Status</dt>
                <dd><IncidentStatus status={inc.status} /></dd>
                {detected?.actor === "system" && (
                  <>
                    <dt className="text-muted-foreground">Created by</dt>
                    <dd>System (auto-detected)</dd>
                  </>
                )}
              </dl>
            </CardContent>
          </Card>
          <Card>
            <CardHeader><CardTitle>Trend (tickets per 5 min)</CardTitle></CardHeader>
            <CardContent>
              <ChartContainer config={{ count: { label: "Tickets", color: "var(--destructive)" } }} className="aspect-auto h-56 w-full">
                <BarChart data={series} margin={{ left: 0, right: 8, top: 8 }}>
                  <CartesianGrid vertical={false} />
                  <XAxis dataKey="t" tickFormatter={hhmm} tickLine={false} axisLine={false} tickMargin={8} minTickGap={24} />
                  <YAxis allowDecimals={false} tickLine={false} axisLine={false} width={32} />
                  <ChartTooltip cursor={false} content={<ChartTooltipContent labelFormatter={(_, p) => hhmm(Number(p?.[0]?.payload?.t))} />} />
                  <Bar dataKey="count" fill="var(--color-count)" radius={4} isAnimationActive={!reduce} />
                </BarChart>
              </ChartContainer>
            </CardContent>
          </Card>
          {notice()}
        </TabsContent>

        <TabsContent value="tickets">
          <Card className="shadow-sm">
            <CardHeader>
              <CardTitle>Affected tickets</CardTitle>
              <CardAction>
                <Button asChild variant="outline" size="sm">
                  <Link data-testid="incident-tickets-link" href={`/?incident_id=${inc.id}`}>Open in queue</Link>
                </Button>
              </CardAction>
            </CardHeader>
            <CardContent>
              {tickets.length === 0 ? (
                <Empty><EmptyHeader><EmptyTitle>No linked tickets</EmptyTitle></EmptyHeader></Empty>
              ) : (
                <Table className="text-base">
                  <TableHeader>
                    <TableRow className="hover:bg-transparent">
                      {["Ticket", "Created", "Status"].map((c) => <TableHead key={c} className="px-2 text-sm text-muted-foreground">{c}</TableHead>)}
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {[...tickets].sort((a, b) => b.created_at.localeCompare(a.created_at)).map((t) => (
                      <TableRow key={t.id} className="hover:bg-muted/50">
                        <TableCell className="w-full max-w-0 min-w-32 px-2 py-2.5">
                          <Link href={`/tickets/${t.id}`} className="font-mono text-sm font-medium text-highlight-text hover:underline">{t.id}</Link>
                          <div className="truncate text-sm text-muted-foreground">{t.masked_text}</div>
                        </TableCell>
                        <TableCell className="px-2 font-mono text-sm whitespace-nowrap tabular-nums">{fmtDate(t.created_at)}</TableCell>
                        <TableCell className="px-2"><StatusBadge status={t.status} /></TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              )}
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="notice">{notice()}</TabsContent>

        <TabsContent value="audit">
          <Card className="shadow-sm">
            <CardContent>
              {!linked || !fast || !notes ? (
                <Skeleton className="h-40 w-full" />
              ) : audit.length === 0 ? (
                <Empty><EmptyHeader><EmptyTitle>No audit events</EmptyTitle></EmptyHeader></Empty>
              ) : (
                <Table>
                  <TableHeader>
                    <TableRow className="hover:bg-transparent">
                      {["Time", "Ticket", "Kind", "Actor"].map((c) => <TableHead key={c} className="px-2 text-sm text-muted-foreground">{c}</TableHead>)}
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {audit.map((e) => (
                      <TableRow key={e.id}>
                        <TableCell className="px-2 font-mono text-sm tabular-nums">{clock(e.ts)}</TableCell>
                        <TableCell className="px-2 font-mono text-sm">
                          {e.ticket_id?.startsWith("tkt_") ? (
                            <Link href={`/tickets/${e.ticket_id}`} className="text-highlight-text hover:underline">{e.ticket_id}</Link>
                          ) : (e.ticket_id ?? "-")}
                        </TableCell>
                        <TableCell className="px-2">
                          <Badge variant="outline" className="h-6 px-2.5 font-mono text-sm font-normal">{e.kind}</Badge>
                        </TableCell>
                        <TableCell data-testid="audit-actor" className="px-2 font-mono text-sm">{e.actor}</TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              )}
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>
    </div>
  );
}

function BackLink() {
  return (
    <Button asChild variant="ghost" size="sm" className="-ml-2 w-fit text-muted-foreground">
      <Link href="/incidents"><CaretLeftIcon data-icon="inline-start" />Back to incidents</Link>
    </Button>
  );
}
