'use client';
// Approve / Reject for a PENDING approval on this ticket (D3).
import { useState } from "react";
import { toast } from "sonner";
import { CheckIcon, GavelIcon, XIcon } from "@phosphor-icons/react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardAction, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from "@/components/ui/card";
import { Field, FieldError, FieldGroup, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Spinner } from "@/components/ui/spinner";
import { Textarea } from "@/components/ui/textarea";
import { toneBadge } from "@/components/status-tone";
import { decideApproval, type Approval } from "@/lib/api";
import { humanAction, inr, obj } from "./TimelineEvent";

export default function ApprovalActions({ approval, onDone }: { approval: Approval; onDone: () => void }) {
  const [note, setNote] = useState("");
  const [by, setBy] = useState("");
  const [busy, setBusy] = useState<"approve" | "reject" | null>(null);
  const [missingName, setMissingName] = useState(false);
  const name = String(approval.action_json.name ?? "action");
  const amount = obj(approval.action_json.params)?.amount_inr;
  const reasons = Array.isArray(approval.reasons_json) ? approval.reasons_json.map(String) : [];

  async function go(approve: boolean) {
    if (!by.trim()) return setMissingName(true);
    setBusy(approve ? "approve" : "reject");
    try {
      await decideApproval(approval.id, { approve, note: note.trim() || null, decided_by: by.trim() });
      toast.success(`${approve ? "Approved" : "Rejected"} ${name}`);
      onDone();
    } catch (x) {
      toast.error("Decision failed", { description: x instanceof Error ? x.message : undefined });
    } finally {
      setBusy(null);
    }
  }

  return (
    <Card data-testid="approval-actions" data-approval-id={approval.id} className="ring-2 ring-status-awaiting/40">
      <CardHeader>
        <CardTitle className="flex items-center gap-2"><GavelIcon className="text-status-awaiting" />Approval needed</CardTitle>
        <CardDescription className="font-mono">{approval.id}</CardDescription>
        <CardAction><Badge className={toneBadge({ tone: "awaiting" })}>PENDING</Badge></CardAction>
      </CardHeader>
      <CardContent className="flex flex-col gap-4">
        <div className="flex flex-wrap items-baseline justify-between gap-2 font-mono tabular-nums">
          <span className="font-sans text-base font-medium">{humanAction(name)} <span className="font-mono text-sm text-muted-foreground">{name}</span></span>
          {typeof amount === "number" && <span className="text-3xl font-semibold">{inr(amount)}</span>}
        </div>
        {reasons.length > 0 && (
          <ul className="list-disc pl-5 text-base text-muted-foreground">{reasons.map((r, i) => <li key={i}>{r}</li>)}</ul>
        )}
        <FieldGroup>
          <Field>
            <FieldLabel htmlFor="approval-note">Note</FieldLabel>
            <Textarea id="approval-note" data-testid="approval-note" value={note} onChange={(e) => setNote(e.target.value)} placeholder="Optional" rows={2} />
          </Field>
          <Field data-invalid={missingName || undefined}>
            <FieldLabel htmlFor="approval-decided-by">Your name</FieldLabel>
            <Input
              id="approval-decided-by"
              data-testid="approval-decided-by"
              value={by}
              aria-invalid={missingName || undefined}
              onChange={(e) => { setBy(e.target.value); setMissingName(false); }}
            />
            {missingName && <FieldError>Enter your name first.</FieldError>}
          </Field>
        </FieldGroup>
      </CardContent>
      <CardFooter className="gap-3">
        <Button data-testid="approve-button" size="lg" disabled={!!busy} onClick={() => go(true)}>
          {busy === "approve" ? <Spinner data-icon="inline-start" /> : <CheckIcon data-icon="inline-start" />}
          Approve
        </Button>
        <Button data-testid="reject-button" size="lg" variant="outline" disabled={!!busy} onClick={() => go(false)}>
          {busy === "reject" ? <Spinner data-icon="inline-start" /> : <XIcon data-icon="inline-start" />}
          Reject
        </Button>
      </CardFooter>
    </Card>
  );
}
