'use client';
import Link from "next/link";
import { useState } from "react";
import { CaretRightIcon, WarningIcon } from "@phosphor-icons/react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from "@/components/ui/card";
import { Field, FieldError, FieldGroup, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Spinner } from "@/components/ui/spinner";
import { Textarea } from "@/components/ui/textarea";
import { toneBadge } from "@/components/status-tone";
import { ago } from "@/lib/format";
import type { ApprovalItem } from "@/lib/api";
import PriorityBadge from "./PriorityBadge";
import TypeBadge from "./TypeBadge";

const inr = (n: number) => `₹${n.toLocaleString("en-IN")}`;
const REF_KEYS = ["txn_id", "settlement_id", "mandate_id", "kyc_id", "refund_id"];

function actionParts(a: ApprovalItem["action_json"]) {
  const p = (a.params ?? {}) as Record<string, unknown>;
  const refKey = REF_KEYS.find((k) => typeof p[k] === "string");
  return {
    name: String(a.name ?? "action"),
    amount: typeof p.amount_inr === "number" ? p.amount_inr : null,
    ref: refKey ? String(p[refKey]) : null,
  };
}

function reasonList(r: unknown): string[] {
  if (Array.isArray(r)) return r.map((x) => (typeof x === "string" ? x : JSON.stringify(x)));
  return r ? [typeof r === "string" ? r : JSON.stringify(r)] : [];
}

export default function ApprovalCard({
  item,
  now,
  onDecide,
}: {
  item: ApprovalItem;
  now: number;
  onDecide: (item: ApprovalItem, approve: boolean, note: string, by: string) => Promise<void>;
}) {
  const [note, setNote] = useState("");
  const [by, setBy] = useState("");
  const [busy, setBusy] = useState<"approve" | "reject" | null>(null);
  const [nameErr, setNameErr] = useState(false);
  const t = item.ticket;
  const act = actionParts(item.action_json);
  const reasons = reasonList(item.reasons_json);

  async function go(approve: boolean) {
    if (!by.trim()) {
      setNameErr(true);
      return;
    }
    setNameErr(false);
    setBusy(approve ? "approve" : "reject");
    try {
      // On success the page removes the card; on failure it restores it and toasts.
      await onDecide(item, approve, note.trim(), by.trim());
    } finally {
      setBusy(null);
    }
  }

  return (
    <Card data-testid="approval-card" data-approval-id={item.id} data-ticket-id={item.ticket_id}>
      <CardHeader>
        <CardTitle className="flex flex-wrap items-center gap-2">
          <Link href={`/tickets/${item.ticket_id}`} className="font-mono text-sm underline-offset-4 hover:underline">
            {item.ticket_id}
          </Link>
          <TypeBadge type={t?.ticket_type ?? null} />
          <PriorityBadge priority={t?.priority ?? null} />
          <Badge className={toneBadge({ tone: "awaiting" })}>Awaiting approval</Badge>
        </CardTitle>
        <CardDescription className="font-mono tabular-nums">Requested {ago(item.requested_at, now)}</CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-4">
        {t?.masked_text && <p className="line-clamp-2 text-muted-foreground">{t.masked_text}</p>}
        <div data-testid="approval-action" className="flex flex-wrap items-baseline justify-between gap-x-6 gap-y-1 rounded-lg bg-muted px-4 py-3">
          <span className="font-mono text-base font-medium">{act.name}</span>
          {act.amount !== null && <span className="font-mono text-3xl font-semibold tabular-nums">{inr(act.amount)}</span>}
          {act.ref && <span className="w-full font-mono text-sm text-muted-foreground sm:w-auto">{act.ref}</span>}
        </div>
        {reasons.length > 0 && (
          <ul data-testid="approval-reasons" className="flex flex-col gap-1.5">
            {reasons.map((r, i) => (
              <li key={i} className="flex items-start gap-2">
                <WarningIcon weight="fill" className="mt-0.5 size-4 shrink-0 text-status-awaiting" />
                <span>{r}</span>
              </li>
            ))}
          </ul>
        )}
        <p data-testid="approval-reasoning" className="text-muted-foreground">{item.reasoning}</p>
        {item.customer_reply_draft && (
          <details className="group">
            <summary className="flex cursor-pointer list-none items-center gap-1 text-sm font-medium">
              <CaretRightIcon className="size-4 transition-transform group-open:rotate-90" />
              Reply draft
            </summary>
            <blockquote className="mt-2 border-l-2 pl-3 text-muted-foreground">{item.customer_reply_draft}</blockquote>
          </details>
        )}
      </CardContent>
      <CardFooter>
        <FieldGroup>
          <div className="grid gap-4 sm:grid-cols-2">
            <Field>
              <FieldLabel htmlFor={`note-${item.id}`}>Note</FieldLabel>
              <Textarea id={`note-${item.id}`} data-testid="approval-note" rows={2} value={note} onChange={(e) => setNote(e.target.value)} placeholder="Optional" />
            </Field>
            <Field data-invalid={nameErr}>
              <FieldLabel htmlFor={`by-${item.id}`}>Your name</FieldLabel>
              <Input
                id={`by-${item.id}`}
                data-testid="approval-decided-by"
                required
                aria-invalid={nameErr}
                value={by}
                onChange={(e) => {
                  setBy(e.target.value);
                  setNameErr(false);
                }}
              />
              {nameErr && <FieldError>Enter your name first.</FieldError>}
            </Field>
          </div>
          <Field orientation="horizontal" data-testid="approval-actions">
            <Button data-testid="approval-approve" disabled={busy !== null} onClick={() => go(true)}>
              {busy === "approve" && <Spinner data-icon="inline-start" />}
              Approve
            </Button>
            <Button data-testid="approval-reject" variant="outline" className="text-destructive" disabled={busy !== null} onClick={() => go(false)}>
              {busy === "reject" && <Spinner data-icon="inline-start" />}
              Reject
            </Button>
          </Field>
        </FieldGroup>
      </CardFooter>
    </Card>
  );
}
