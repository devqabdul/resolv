'use client';
import Link from "next/link";
import { useState } from "react";
import { toast } from "sonner";
import {
  ArrowCounterClockwiseIcon,
  ChatCircleIcon,
  CheckIcon,
  ClockIcon,
  CoinsIcon,
  CopyIcon,
  IdentificationCardIcon,
  LightningIcon,
  PhoneIcon,
  SparkleIcon,
  UserIcon,
  WalletIcon,
  WarningIcon,
  XIcon,
  type Icon,
} from "@phosphor-icons/react";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardAction, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from "@/components/ui/card";
import { Field, FieldError, FieldGroup, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Separator } from "@/components/ui/separator";
import { Spinner } from "@/components/ui/spinner";
import { GATE_TONE, toneBadge } from "@/components/status-tone";
import {
  actionLabel,
  actionParts,
  channelLabel,
  inr,
  reasonList,
  runView,
  stamp,
  tatDays,
} from "@/components/approvals/parts";
import { useTicket, type ApprovalItem } from "@/lib/api";
import { cn } from "@/lib/utils";
import PriorityBadge from "./PriorityBadge";

const ACTION_ICON: Record<string, Icon> = {
  initiate_reversal: ArrowCounterClockwiseIcon,
  credit_compensation: CoinsIcon,
  send_reply: ChatCircleIcon,
};

function Info({ icon: I, label, value, mono }: { icon: Icon; label: string; value: string; mono?: boolean }) {
  return (
    <div className="flex min-w-0 items-start gap-2">
      <I className="mt-0.5 size-4 shrink-0 text-muted-foreground" />
      <div className="flex min-w-0 flex-col">
        <span className="text-xs text-muted-foreground">{label}</span>
        <span className={cn("truncate", mono && "font-mono tabular-nums")}>{value}</span>
      </div>
    </div>
  );
}

export default function ApprovalCard({
  item,
  onDecide,
}: {
  item: ApprovalItem;
  onDecide: (item: ApprovalItem, approve: boolean, note: string, by: string) => Promise<void>;
}) {
  const [note, setNote] = useState("");
  const [by, setBy] = useState("");
  const [busy, setBusy] = useState<"approve" | "reject" | null>(null);
  const [byErr, setByErr] = useState(false);
  const [noteErr, setNoteErr] = useState(false);
  const { data: detail } = useTicket(item.ticket_id);
  const run = runView(detail);
  const t = item.ticket;
  const act = actionParts(item.action_json);
  const reasons = reasonList(item.reasons_json);
  const txnId = act.refKey === "txn_id" ? act.ref : t?.candidate_txn_id ?? null;
  const txn = run?.txns.find((x) => x.id === txnId) ?? null;
  const cust = run?.customer ?? null;

  // Every gate row from the run; until it loads, just the action under approval.
  const rows = run?.gate.length
    ? run.gate
    : [{ action: item.action_json, outcome: "NEEDS_APPROVAL", reasons }];
  const primaryIdx = rows.findIndex((r) => r.outcome !== "AUTO_EXECUTE" && String(r.action.name) === act.name);

  async function go(approve: boolean) {
    const missBy = !by.trim();
    const missNote = !note.trim();
    setByErr(missBy);
    setNoteErr(missNote);
    if (missBy || missNote) return;
    setBusy(approve ? "approve" : "reject");
    try {
      // On success the page removes the card; on failure it restores it and toasts.
      await onDecide(item, approve, note.trim(), by.trim());
    } finally {
      setBusy(null);
    }
  }

  return (
    <Card data-testid="approval-card" data-approval-id={item.id} data-ticket-id={item.ticket_id} className="shadow-sm">
      <CardHeader>
        <CardTitle className="flex flex-wrap items-center gap-2">
          <Link href={`/tickets/${item.ticket_id}`} className="font-mono text-base underline-offset-4 hover:underline">
            {item.ticket_id}
          </Link>
          {t?.priority && <PriorityBadge priority={t.priority} />}
        </CardTitle>
        <CardDescription className="flex flex-col gap-0.5">
          {t?.ticket_type && <span className="text-base font-medium text-foreground">{actionLabel(t.ticket_type)}</span>}
          {t && (
            <span>
              <span className="font-mono tabular-nums">{stamp(t.created_at)}</span> • via {channelLabel(t.channel)}
            </span>
          )}
        </CardDescription>
        <CardAction>
          <Badge className={toneBadge({ tone: "awaiting" })}>
            <ClockIcon data-icon="inline-start" />
            Awaiting approval
          </Badge>
        </CardAction>
      </CardHeader>

      <CardContent className="flex flex-col gap-6">
        <div className="grid gap-4 lg:grid-cols-5">
          <div className="flex flex-col gap-4 lg:col-span-3">
            {t?.masked_text && <p className="rounded-lg bg-muted px-4 py-3">{t.masked_text}</p>}
            {cust && (
              <div className="flex flex-wrap items-stretch gap-x-4 gap-y-3">
                {cust.name && <Info icon={UserIcon} label="Customer" value={cust.name} />}
                <Separator orientation="vertical" className="hidden sm:block" />
                <Info icon={IdentificationCardIcon} label="Customer ID" value={cust.id} mono />
                {cust.vpa_masked && (
                  <>
                    <Separator orientation="vertical" className="hidden sm:block" />
                    <Info icon={WalletIcon} label="VPA" value={cust.vpa_masked} mono />
                  </>
                )}
                {cust.phone_masked && (
                  <>
                    <Separator orientation="vertical" className="hidden sm:block" />
                    <Info icon={PhoneIcon} label="Phone" value={cust.phone_masked} mono />
                  </>
                )}
              </div>
            )}
            {txn && (
              <div data-testid="approval-context" className="flex flex-col gap-3 rounded-lg border bg-muted/40 p-4">
                <span className="font-medium">Context from Paytm</span>
                <div className="grid grid-cols-2 gap-x-4 gap-y-3 sm:grid-cols-4">
                  <div className="flex min-w-0 flex-col">
                    <span className="text-xs text-muted-foreground">Transaction ID</span>
                    <span className="flex items-center gap-1">
                      <span className="truncate font-mono text-sm">{txn.id}</span>
                      <Button
                        variant="ghost"
                        size="icon-xs"
                        aria-label="Copy transaction id"
                        onClick={() => navigator.clipboard.writeText(txn.id).then(() => toast.success("Copied"))}
                      >
                        <CopyIcon />
                      </Button>
                    </span>
                  </div>
                  {txn.issuer_bank && (
                    <div className="flex flex-col">
                      <span className="text-xs text-muted-foreground">Bank</span>
                      <span>{txn.issuer_bank}</span>
                    </div>
                  )}
                  <div className="flex flex-col">
                    <span className="text-xs text-muted-foreground">Amount</span>
                    <span className="font-mono tabular-nums">{inr(txn.amount_inr)}</span>
                  </div>
                  <div className="flex flex-col items-start">
                    <span className="text-xs text-muted-foreground">Status</span>
                    <Badge className={toneBadge({ tone: txn.status === "SUCCESS" ? "resolved" : "failed", className: "font-mono text-xs" })}>
                      {txn.status}
                    </Badge>
                  </div>
                </div>
                {run?.clock && (
                  <div className="flex flex-wrap gap-x-4 gap-y-1 text-sm">
                    <span className="font-mono tabular-nums">
                      {run.clock.days_since_txn} {run.clock.days_since_txn === 1 ? "day" : "days"} since transaction
                    </span>
                    {run.clock.days_late > 0 && (
                      <span className="flex items-center gap-1 font-medium text-status-failed">
                        <WarningIcon weight="fill" className="size-4" />
                        RBI TAT Breached (TAT {tatDays(txn.method)} {tatDays(txn.method) === 1 ? "day" : "days"})
                      </span>
                    )}
                  </div>
                )}
              </div>
            )}
          </div>
          {item.customer_reply_draft && (
            <div className="flex flex-col gap-2 rounded-lg bg-highlight/10 p-4 lg:col-span-2">
              <span className="flex items-center gap-2 font-medium">
                <ChatCircleIcon weight="duotone" className="size-5 text-highlight-text" />
                Draft reply to customer
              </span>
              <p className="whitespace-pre-line">{item.customer_reply_draft}</p>
            </div>
          )}
        </div>

        <div className="flex flex-col gap-3">
          <span className="font-medium">Proposed actions by Resolv</span>
          <div className="flex flex-col rounded-lg border">
            {rows.map((r, i) => {
              const a = actionParts(r.action);
              const primary = i === primaryIdx;
              const I = ACTION_ICON[a.name] ?? LightningIcon;
              const rowReasons = primary ? reasons : r.reasons;
              return (
                <div
                  key={i}
                  data-testid={primary ? "approval-action" : undefined}
                  className={cn("flex flex-col gap-3 p-4", i > 0 && "border-t")}
                >
                  <div className="flex flex-wrap items-start gap-x-6 gap-y-3">
                    <div className="flex min-w-0 flex-1 basis-64 items-start gap-3">
                      <div className="flex size-9 shrink-0 items-center justify-center rounded-lg bg-primary/10 text-primary">
                        <I weight="duotone" className="size-5" />
                      </div>
                      <div className="flex min-w-0 flex-col gap-0.5">
                        <span className="flex flex-wrap items-center gap-2 font-medium">
                          {actionLabel(a.name)}
                          {primary && <Badge variant="outline" className="text-xs">PRIMARY</Badge>}
                          {r.outcome === "AUTO_EXECUTE" && <Badge variant="secondary" className="text-xs">AUTO</Badge>}
                        </span>
                        <span className="font-mono text-xs text-muted-foreground">{a.name}</span>
                        {a.rationale && <span className="text-muted-foreground">{a.rationale}</span>}
                      </div>
                    </div>
                    <div className="flex flex-col">
                      <span className="text-xs text-muted-foreground">Amount</span>
                      <span className="font-mono tabular-nums">{a.amount !== null ? inr(a.amount) : "-"}</span>
                    </div>
                    <div className="flex flex-col">
                      <span className="text-xs text-muted-foreground">{a.refKey === "txn_id" ? "Transaction" : "Reference"}</span>
                      <span className="font-mono text-sm">{a.ref ?? "-"}</span>
                    </div>
                    <div className="flex flex-col items-start" data-outcome={r.outcome}>
                      <span className="text-xs text-muted-foreground">Gate result</span>
                      <Badge className={toneBadge({ tone: GATE_TONE[r.outcome], className: "font-mono text-xs" })}>{r.outcome}</Badge>
                    </div>
                  </div>
                  {r.outcome !== "AUTO_EXECUTE" && rowReasons.length > 0 && (
                    <Alert variant="destructive" data-testid={primary ? "approval-reasons" : undefined} className="bg-destructive/5">
                      <WarningIcon weight="fill" />
                      <AlertDescription>
                        <ul className="flex flex-col gap-1">
                          {rowReasons.map((x, j) => <li key={j}>{x}</li>)}
                        </ul>
                      </AlertDescription>
                    </Alert>
                  )}
                </div>
              );
            })}
          </div>
        </div>

        {item.reasoning && (
          <div className="flex flex-col gap-2">
            <span className="flex items-center gap-2 font-medium">
              <SparkleIcon weight="duotone" className="size-5 text-highlight-text" />
              Resolv reasoning
            </span>
            <p data-testid="approval-reasoning" className="text-muted-foreground">{item.reasoning}</p>
          </div>
        )}
      </CardContent>

      <CardFooter className="border-t pt-4 pb-4">
        <FieldGroup>
          <div className="grid items-start gap-4 md:grid-cols-[1fr_1fr_auto]">
            <Field data-invalid={byErr}>
              <FieldLabel htmlFor={`by-${item.id}`}>Reviewer (required)</FieldLabel>
              <Input
                id={`by-${item.id}`}
                data-testid="approval-decided-by"
                list="approval-reviewers"
                placeholder="Select a reviewer"
                required
                aria-invalid={byErr}
                value={by}
                onChange={(e) => {
                  setBy(e.target.value);
                  setByErr(false);
                }}
              />
              {byErr && <FieldError>Enter the reviewer name.</FieldError>}
            </Field>
            <Field data-invalid={noteErr}>
              <FieldLabel htmlFor={`note-${item.id}`}>Decision note (required)</FieldLabel>
              <Input
                id={`note-${item.id}`}
                data-testid="approval-note"
                required
                aria-invalid={noteErr}
                value={note}
                onChange={(e) => {
                  setNote(e.target.value);
                  setNoteErr(false);
                }}
              />
              {noteErr && <FieldError>Enter a decision note.</FieldError>}
            </Field>
            <Field orientation="horizontal" data-testid="approval-actions" className="md:mt-6">
              <Button data-testid="approval-approve" disabled={busy !== null} onClick={() => go(true)}>
                {busy === "approve" ? <Spinner data-icon="inline-start" /> : <CheckIcon data-icon="inline-start" />}
                Approve & Execute
              </Button>
              <Button data-testid="approval-reject" variant="outline" className="text-destructive" disabled={busy !== null} onClick={() => go(false)}>
                {busy === "reject" ? <Spinner data-icon="inline-start" /> : <XIcon data-icon="inline-start" />}
                Reject
              </Button>
            </Field>
          </div>
        </FieldGroup>
      </CardFooter>
    </Card>
  );
}
