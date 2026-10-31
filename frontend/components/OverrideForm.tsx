'use client';
// D4: a human picks a different path; the backend audits `override` and re-runs via the gate.
import { useState } from "react";
import { toast } from "sonner";
import { ArrowBendUpRightIcon } from "@phosphor-icons/react";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Field, FieldError, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Spinner } from "@/components/ui/spinner";
import { overrideTicket, type BlockedAction, type OverridePath } from "@/lib/api";

const PATHS: OverridePath[] = ["RESOLVE", "ROUTE", "ESCALATE"];

export default function OverrideForm({ ticketId, onDone }: { ticketId: string; onDone: () => void }) {
  const [path, setPath] = useState<OverridePath>("ROUTE");
  const [note, setNote] = useState("");
  const [by, setBy] = useState("");
  const [busy, setBusy] = useState(false);
  const [missingName, setMissingName] = useState(false);
  const [missingNote, setMissingNote] = useState(false);
  const [blocked, setBlocked] = useState<BlockedAction[]>([]);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setMissingNote(!note.trim());
    setMissingName(!by.trim());
    if (!note.trim() || !by.trim()) return;
    setBusy(true);
    try {
      const r = await overrideTicket(ticketId, { path, note: note.trim(), decided_by: by.trim() });
      setBlocked(r.blocked);
      setNote("");
      if (r.blocked.length) toast.warning(`Override saved, ${r.blocked.length} action${r.blocked.length > 1 ? "s" : ""} blocked by the gate`);
      else toast.success(`Overridden to ${path}`, { description: `Ticket is now ${r.ticket.status}` });
      onDone();
    } catch (x) {
      toast.error("Override failed", { description: x instanceof Error ? x.message : undefined });
    } finally {
      setBusy(false);
    }
  }

  return (
    <form data-testid="override-form" onSubmit={submit}>
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2"><ArrowBendUpRightIcon className="text-muted-foreground" />Override / Re-route</CardTitle>
          <CardDescription>Pick a different path. The gate still checks every action.</CardDescription>
        </CardHeader>
        <CardContent className="@container flex flex-col gap-4">
          <div className="grid grid-cols-2 items-start gap-3 @xl:grid-cols-[7rem_minmax(0,1fr)_minmax(0,9rem)_auto]">
            <Field>
              <FieldLabel htmlFor="override-path">Path</FieldLabel>
              {/* Native select on purpose: verify recipes drive it with Playwright select_option. */}
              <select
                id="override-path"
                data-testid="override-path"
                value={path}
                onChange={(e) => setPath(e.target.value as OverridePath)}
                className="h-9 w-full rounded-lg border border-input bg-transparent px-2.5 font-mono text-sm outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50 dark:bg-input/30 dark:[color-scheme:dark]"
              >
                {PATHS.map((p) => <option key={p} value={p}>{p}</option>)}
              </select>
            </Field>
            <Field data-invalid={missingNote || undefined}>
              <FieldLabel htmlFor="override-note">Note <span className="font-normal text-muted-foreground">(required)</span></FieldLabel>
              <Input
                id="override-note"
                data-testid="override-note"
                value={note}
                aria-invalid={missingNote || undefined}
                onChange={(e) => { setNote(e.target.value); setMissingNote(false); }}
                placeholder="Why the change"
                className="h-9"
              />
              {missingNote && <FieldError>Add a note.</FieldError>}
            </Field>
            <Field data-invalid={missingName || undefined}>
              <FieldLabel htmlFor="override-decided-by">Your name</FieldLabel>
              <Input
                id="override-decided-by"
                data-testid="override-decided-by"
                value={by}
                aria-invalid={missingName || undefined}
                onChange={(e) => { setBy(e.target.value); setMissingName(false); }}
                className="h-9"
              />
              {missingName && <FieldError>Enter your name first.</FieldError>}
            </Field>
            <Button data-testid="override-submit" type="submit" size="lg" disabled={busy} className="self-end @xl:self-start @xl:mt-[1.375rem]">
              {busy ? <Spinner data-icon="inline-start" /> : <ArrowBendUpRightIcon data-icon="inline-start" />}
              Submit override
            </Button>
          </div>
          {blocked.length > 0 && (
            <Alert data-testid="override-blocked" variant="destructive">
              <AlertTitle>Blocked by the gate, not executed</AlertTitle>
              <AlertDescription>
                <ul className="list-disc pl-5">
                  {blocked.map((b, i) => (
                    <li key={i}><span className="font-mono">{b.action.name}</span> {b.outcome}: {b.reasons.join("; ")}</li>
                  ))}
                </ul>
              </AlertDescription>
            </Alert>
          )}
        </CardContent>
      </Card>
    </form>
  );
}
