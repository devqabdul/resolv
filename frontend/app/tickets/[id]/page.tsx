'use client';
// Ticket detail (T14). Sample response for layout work: frontend/fixtures/ticket_d1.json
// (a captured GET /api/tickets/tkt_48213 after a D1 run); not imported at runtime.
import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import { useState } from "react";
import { toast } from "sonner";
import { ArrowClockwiseIcon, ArrowLeftIcon, LinkSimpleIcon, MagnifyingGlassIcon, WarningOctagonIcon } from "@phosphor-icons/react";
import ApprovalActions from "@/components/ApprovalActions";
import ContextCard from "@/components/ContextCard";
import OverrideForm from "@/components/OverrideForm";
import PriorityBadge from "@/components/PriorityBadge";
import RegulatoryClock from "@/components/RegulatoryClock";
import Timeline from "@/components/Timeline";
import { obj } from "@/components/TimelineEvent";
import TypeBadge from "@/components/TypeBadge";
import { STATUS_TONE, toneBadge } from "@/components/status-tone";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardAction, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Empty, EmptyContent, EmptyDescription, EmptyHeader, EmptyMedia, EmptyTitle } from "@/components/ui/empty";
import { Skeleton } from "@/components/ui/skeleton";
import { Spinner } from "@/components/ui/spinner";
import { rerunTicket, useTicket } from "@/lib/api";
import { cn } from "@/lib/utils";

const chip = "h-7 px-3 text-sm";

export default function TicketPage() {
  const { id } = useParams<{ id: string }>();
  const { data, error, mutate } = useTicket(id ?? null);
  const [busy, setBusy] = useState(false);

  if (!data) {
    if (error?.message.endsWith("404")) return <NotFound id={id} />;
    if (error)
      return (
        <Alert variant="destructive">
          <WarningOctagonIcon />
          <AlertTitle>Backend unreachable</AlertTitle>
          <AlertDescription>{error.message}</AlertDescription>
        </Alert>
      );
    return <TicketSkeleton />;
  }

  const { ticket: t, run, timeline, approvals, incident } = data;
  const ctx = obj(run?.state?.context);
  const pending = approvals.find((a) => a.status === "PENDING");
  const refresh = () => void mutate();

  async function rerun() {
    setBusy(true);
    try {
      const d = await mutate(await rerunTicket(t.id), { revalidate: false });
      toast.success("Re-run finished", { description: d ? `Ticket is now ${d.ticket.status}` : undefined });
    } catch (x) {
      toast.error("Re-run failed", { description: x instanceof Error ? x.message : undefined });
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <BackButton />
      <div className="flex flex-wrap items-center gap-3">
        <span className="font-mono text-2xl font-semibold tabular-nums">{t.id}</span>
        <Badge
          data-testid="ticket-status"
          data-status={t.status}
          className={cn(toneBadge({ tone: STATUS_TONE[t.status] }), "h-9 px-4 text-lg font-semibold transition-colors duration-300")}
        >
          {t.status}
        </Badge>
        <TypeBadge type={t.ticket_type} />
        <PriorityBadge priority={t.priority} />
        {t.path && <Badge data-testid="ticket-path" className={cn(chip, "font-mono")}>{t.path}</Badge>}
        {t.assigned_team && <Badge variant="outline" className={chip}>Team {t.assigned_team}</Badge>}
        <Badge data-testid="resolved-by" variant="outline" className={cn(chip, !t.resolved_by && "text-muted-foreground")}>
          {t.resolved_by ? <>Resolved by <span className="font-mono font-semibold">{t.resolved_by}</span></> : "Unresolved"}
        </Badge>
        {incident && (
          <Badge data-testid="incident-chip" asChild className={toneBadge({ tone: "incident", className: "h-7 px-3 hover:underline" })}>
            {/* (decision: FIX4) no /incidents/[id] route; the list page shows all */}
            <Link href="/incidents">
              <LinkSimpleIcon data-icon="inline-start" />
              Incident {incident.title ?? incident.signature}
            </Link>
          </Badge>
        )}
        <Button data-testid="rerun-button" variant="outline" size="lg" disabled={busy} onClick={rerun} className="ml-auto">
          {busy ? <Spinner data-icon="inline-start" /> : <ArrowClockwiseIcon data-icon="inline-start" />}
          {busy ? "Running" : "Re-run"}
        </Button>
      </div>

      <div className="grid gap-6 xl:grid-cols-12">
        <div className="flex min-w-0 flex-col gap-6 xl:col-span-5">
          <Card>
            <CardHeader>
              <CardTitle>Customer message</CardTitle>
              <CardDescription>
                via <span className="font-mono">{t.channel}</span>{t.language ? <>, <span className="font-mono">{t.language}</span></> : null}, PII masked
              </CardDescription>
            </CardHeader>
            <CardContent>
              <blockquote data-testid="ticket-masked-text" className="border-l-2 border-primary/40 pl-4 text-lg leading-relaxed">
                {t.masked_text}
              </blockquote>
            </CardContent>
          </Card>
          <ContextCard context={ctx} candidateTxnId={t.candidate_txn_id} />
          <RegulatoryClock clock={obj(ctx?.regulatory_clock)} />
          {pending && <ApprovalActions approval={pending} onDone={refresh} />}
          <OverrideForm ticketId={t.id} onDone={refresh} />
        </div>
        <Card className="min-w-0 xl:col-span-7 xl:self-start">
          <CardHeader>
            <CardTitle>Agent timeline</CardTitle>
            <CardDescription>Every step Resolv took, oldest first</CardDescription>
            <CardAction>
              <Badge variant="secondary" className="h-6 px-2.5 font-mono text-sm tabular-nums">{timeline.length} events</Badge>
            </CardAction>
          </CardHeader>
          <CardContent>
            {timeline.length === 0
              ? <p className="text-muted-foreground">No events yet. Re-run the agent to start one.</p>
              : <Timeline events={timeline} />}
          </CardContent>
        </Card>
      </div>
    </>
  );
}

function NotFound({ id }: { id?: string }) {
  return (
    <Empty className="border">
      <EmptyHeader>
        <EmptyMedia variant="icon"><MagnifyingGlassIcon /></EmptyMedia>
        <EmptyTitle>Ticket not found</EmptyTitle>
        <EmptyDescription>
          No ticket with id <span className="font-mono">{id}</span>. It may have been cleared by a demo reset.
        </EmptyDescription>
      </EmptyHeader>
      <EmptyContent>
        <Button asChild variant="outline"><Link href="/">Back to the queue</Link></Button>
      </EmptyContent>
    </Empty>
  );
}

function TicketSkeleton() {
  return (
    <>
      <div className="flex flex-wrap items-center gap-3">
        <Skeleton className="h-8 w-36" />
        <Skeleton className="h-9 w-32 rounded-full" />
        <Skeleton className="h-6 w-44 rounded-full" />
        <Skeleton className="h-6 w-12 rounded-full" />
        <Skeleton className="ml-auto h-9 w-24" />
      </div>
      <div className="grid gap-6 xl:grid-cols-12">
        <div className="flex flex-col gap-6 xl:col-span-5">
          <Skeleton className="h-36 rounded-xl" />
          <Skeleton className="h-64 rounded-xl" />
          <Skeleton className="h-52 rounded-xl" />
        </div>
        <div className="flex flex-col gap-6 rounded-xl p-4 ring-1 ring-foreground/10 xl:col-span-7">
          {Array.from({ length: 6 }, (_, i) => (
            <div key={i} className="flex gap-3">
              <Skeleton className="size-8 shrink-0 rounded-full" />
              <div className="flex flex-1 flex-col gap-2">
                <Skeleton className="h-5 w-48" />
                <Skeleton className="h-12 w-full" />
              </div>
            </div>
          ))}
        </div>
      </div>
    </>
  );
}

// Back to wherever the user came from (queue, approvals, incident filter); falls back to the
// queue when the ticket was opened directly (no in-app history). (decision: UI back button)
function BackButton() {
  const router = useRouter();
  function goBack() {
    const sameOrigin = typeof document !== "undefined" && document.referrer.startsWith(window.location.origin);
    if (sameOrigin && window.history.length > 1) router.back();
    else router.push("/");
  }
  return (
    <Button data-testid="back-button" variant="ghost" size="sm" onClick={goBack} className="-ml-2 w-fit text-muted-foreground">
      <ArrowLeftIcon data-icon="inline-start" />
      Back
    </Button>
  );
}
