'use client';
// Ticket detail (T14). Sample response for layout work: frontend/fixtures/ticket_d1.json
// (a captured GET /api/tickets/tkt_48213 after a D1 run); not imported at runtime.
import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import { useState } from "react";
import { toast } from "sonner";
import {
  ArrowClockwiseIcon, ArrowLeftIcon, CaretRightIcon, ChatTextIcon, CodeIcon, CopyIcon, DotsThreeVerticalIcon,
  LinkSimpleIcon, ListChecksIcon, MagnifyingGlassIcon, QueueIcon, WarningOctagonIcon,
} from "@phosphor-icons/react";
import ApprovalActions from "@/components/ApprovalActions";
import ContextCard from "@/components/ContextCard";
import OverrideForm from "@/components/OverrideForm";
import PriorityBadge from "@/components/PriorityBadge";
import RegulatoryClock from "@/components/RegulatoryClock";
import Timeline from "@/components/Timeline";
import { Json, arr, fmtDateTime, obj, str } from "@/components/TimelineEvent";
import TypeBadge from "@/components/TypeBadge";
import { STATUS_TONE, toneBadge } from "@/components/status-tone";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardAction, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Empty, EmptyContent, EmptyDescription, EmptyHeader, EmptyMedia, EmptyTitle } from "@/components/ui/empty";
import { Skeleton } from "@/components/ui/skeleton";
import { Spinner } from "@/components/ui/spinner";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { rerunTicket, useTicket, useTickets } from "@/lib/api";
import { cn } from "@/lib/utils";

const pill = "h-6 rounded-full px-2.5 text-sm";

function IconTip({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <Tooltip>
      <TooltipTrigger asChild>{children}</TooltipTrigger>
      <TooltipContent>{label}</TooltipContent>
    </Tooltip>
  );
}

export default function TicketPage() {
  const { id } = useParams<{ id: string }>();
  const router = useRouter();
  const { data, error, mutate } = useTicket(id ?? null);
  const { data: list } = useTickets({ limit: 200 });
  const [busy, setBusy] = useState(false);
  const [fullText, setFullText] = useState(false);
  const [raw, setRaw] = useState(false);

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
  const phone = str(obj(ctx?.customer)?.phone_masked);
  const txnAt = str(arr(ctx?.transactions).map(obj).find((x) => x?.id === t.candidate_txn_id)?.created_at);
  const meta = [phone && `From: ${phone}`, txnAt && `Txn: ${fmtDateTime(txnAt)}`].filter(Boolean).join(" • ");
  // Queue order: newest first. "Next" is the ticket just below this one.
  const queue = [...(list?.items ?? [])].sort((a, b) => b.created_at.localeCompare(a.created_at));
  const at = queue.findIndex((x) => x.id === t.id);
  const next = at >= 0 ? queue[at + 1] : undefined;

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

  function copyId() {
    navigator.clipboard.writeText(t.id).then(() => toast.success("Ticket id copied"), () => toast.error("Copy failed"));
  }

  return (
    <>
      <div className="flex flex-wrap items-start justify-between gap-x-6 gap-y-3">
        <div className="flex min-w-0 flex-1 flex-col gap-1">
          <div className="flex items-center gap-1.5">
            <BackButton />
            <span className="font-mono text-2xl font-semibold tabular-nums">{t.id}</span>
          </div>
          <p className="max-w-3xl truncate">{t.masked_text}</p>
          <p className="text-sm text-muted-foreground">
            {fmtDateTime(t.created_at)} • <span className="font-mono">{t.channel}</span> • <span className="font-mono">#{t.id.replace(/^tkt_/, "")}</span>
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <PriorityBadge priority={t.priority} />
          <Badge
            data-testid="ticket-status"
            data-status={t.status}
            className={cn(toneBadge({ tone: STATUS_TONE[t.status] }), "font-mono transition-colors duration-300")}
          >
            {t.status}
          </Badge>
          <TypeBadge type={t.ticket_type} />
          {t.path && (
            <Badge variant="outline" className={pill}>
              Path: <span data-testid="ticket-path" className="font-mono font-medium">{t.path}</span>
            </Badge>
          )}
          <span className="flex items-center gap-1.5 text-sm text-muted-foreground">
            {t.resolved_by && "Resolved by"}
            <Badge
              data-testid="resolved-by"
              className={cn(pill, "font-mono", t.resolved_by ? "bg-highlight/12 text-highlight-text" : "bg-muted text-muted-foreground")}
            >
              {t.resolved_by ?? "Unresolved"}
            </Badge>
          </span>
          {incident && (
            <Badge data-testid="incident-chip" asChild className={toneBadge({ tone: "incident", className: "hover:underline" })}>
              {/* (decision: FIX4) no /incidents/[id] route; the list page shows all */}
              <Link href="/incidents">
                <LinkSimpleIcon data-icon="inline-start" />
                Incident {incident.title ?? incident.signature}
              </Link>
            </Badge>
          )}
          <DropdownMenu>
            <IconTip label="More actions">
              <DropdownMenuTrigger asChild>
                <Button variant="outline" size="icon" aria-label="More actions"><DotsThreeVerticalIcon /></Button>
              </DropdownMenuTrigger>
            </IconTip>
            <DropdownMenuContent align="end">
              <DropdownMenuItem data-testid="rerun-button" disabled={busy} onSelect={rerun}>{busy ? <Spinner /> : <ArrowClockwiseIcon />}Re-run</DropdownMenuItem>
              <DropdownMenuItem onSelect={copyId}><CopyIcon />Copy ticket id</DropdownMenuItem>
              <DropdownMenuItem asChild><Link href="/"><QueueIcon />Open in queue</Link></DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
          <IconTip label={next ? `Next ticket: ${next.id}` : "No next ticket"}>
            {/* span keeps the tooltip working while the button is disabled */}
            <span tabIndex={next ? undefined : 0}>
              <Button variant="outline" size="icon" disabled={!next} onClick={() => next && router.push(`/tickets/${next.id}`)} aria-label="Next ticket">
                <CaretRightIcon />
              </Button>
            </span>
          </IconTip>
        </div>
      </div>

      <div className="grid gap-6 xl:grid-cols-12">
        <div className="flex min-w-0 flex-col gap-6 xl:col-span-5">
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2"><ChatTextIcon className="text-muted-foreground" />Customer message</CardTitle>
            </CardHeader>
            <CardContent className="flex flex-col gap-2">
              <p data-testid="ticket-masked-text" className={cn("rounded-lg bg-muted p-3 leading-relaxed", !fullText && "line-clamp-3")}>
                {t.masked_text}
              </p>
              {t.masked_text.length > 160 && (
                <Button variant="link" size="sm" className="h-auto w-fit p-0" onClick={() => setFullText((v) => !v)}>
                  {fullText ? "Show less" : "View full message"}
                </Button>
              )}
              {meta && <p className="font-mono text-xs text-muted-foreground">{meta}</p>}
            </CardContent>
          </Card>
          <ContextCard context={ctx} candidateTxnId={t.candidate_txn_id} />
          <RegulatoryClock clock={obj(ctx?.regulatory_clock)} />
          {pending && <ApprovalActions approval={pending} onDone={refresh} />}
          <OverrideForm ticketId={t.id} onDone={refresh} />
        </div>
        <Card className="min-w-0 xl:col-span-7 xl:self-start">
          <CardHeader>
            <CardTitle className="flex items-center gap-2"><ListChecksIcon className="text-muted-foreground" />Agent Timeline</CardTitle>
            <CardAction>
              <Button variant="outline" size="sm" onClick={() => setRaw((v) => !v)} aria-pressed={raw}>
                <CodeIcon data-icon="inline-start" />
                {raw ? "Hide raw logs" : "Show raw logs"}
              </Button>
            </CardAction>
          </CardHeader>
          <CardContent>
            {timeline.length === 0
              ? <p className="text-muted-foreground">No events yet. Re-run the agent to start one.</p>
              : raw ? <Json value={timeline} /> : <Timeline events={timeline} channel={t.channel} />}
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
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div className="flex flex-col gap-2">
          <Skeleton className="h-8 w-44" />
          <Skeleton className="h-5 w-96" />
          <Skeleton className="h-4 w-64" />
        </div>
        <div className="flex gap-2">
          {Array.from({ length: 5 }, (_, i) => <Skeleton key={i} className="h-6 w-20 rounded-full" />)}
        </div>
      </div>
      <div className="grid gap-6 xl:grid-cols-12">
        <div className="flex flex-col gap-6 xl:col-span-5">
          <Skeleton className="h-36 rounded-xl" />
          <Skeleton className="h-44 rounded-xl" />
          <Skeleton className="h-44 rounded-xl" />
          <Skeleton className="h-32 rounded-xl" />
        </div>
        <div className="flex flex-col gap-5 rounded-xl p-4 ring-1 ring-foreground/10 xl:col-span-7">
          {Array.from({ length: 8 }, (_, i) => (
            <div key={i} className="grid grid-cols-[6rem_1rem_minmax(0,1fr)] gap-3">
              <Skeleton className="h-4 w-20" />
              <Skeleton className="mt-1 size-2.5 rounded-full" />
              <div className="flex flex-col gap-2">
                <Skeleton className="h-5 w-48" />
                <Skeleton className="h-4 w-full" />
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
    <IconTip label="Back">
      <Button data-testid="back-button" variant="ghost" size="icon-sm" onClick={goBack} aria-label="Back" className="-ml-2 text-muted-foreground">
        <ArrowLeftIcon />
      </Button>
    </IconTip>
  );
}
