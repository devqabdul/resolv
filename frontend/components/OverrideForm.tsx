'use client';
import { useState } from "react";
import { overrideTicket, type BlockedAction, type OverridePath } from "@/lib/api";

const PATHS: OverridePath[] = ["RESOLVE", "ROUTE", "ESCALATE"];

// D4: a human picks a different path; the backend audits `override` and re-runs via the gate.
export default function OverrideForm({ ticketId, onDone }: { ticketId: string; onDone: () => void }) {
  const [path, setPath] = useState<OverridePath>("ROUTE");
  const [note, setNote] = useState("");
  const [by, setBy] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [blocked, setBlocked] = useState<BlockedAction[]>([]);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!by.trim()) return setErr("Enter your name first.");
    setBusy(true);
    setErr(null);
    try {
      const r = await overrideTicket(ticketId, { path, note: note.trim() || undefined, decided_by: by.trim() });
      setBlocked(r.blocked);
      setNote("");
      onDone();
    } catch (x) {
      setErr(x instanceof Error ? x.message : "Override failed.");
    } finally {
      setBusy(false);
    }
  }

  const field = "rounded-lg border border-navy/30 px-3 py-2 text-lg";
  return (
    <form data-testid="override-form" onSubmit={submit} className="space-y-3 rounded-xl bg-white p-5 shadow-sm">
      <h2 className="text-xl font-bold text-navy">Override Resolv</h2>
      <select data-testid="override-path" value={path} onChange={(e) => setPath(e.target.value as OverridePath)} className={`${field} w-full font-bold`}>
        {PATHS.map((p) => <option key={p} value={p}>{p}</option>)}
      </select>
      <input data-testid="override-note" value={note} onChange={(e) => setNote(e.target.value)} placeholder="Why? (note)" className={`${field} w-full`} />
      <div className="flex gap-3">
        <input data-testid="override-decided-by" value={by} onChange={(e) => setBy(e.target.value)} placeholder="Your name" className={`${field} min-w-0 flex-1`} />
        <button data-testid="override-submit" disabled={busy} className="rounded-lg bg-navy px-6 py-2 text-lg font-bold text-white disabled:opacity-50">Override</button>
      </div>
      {err && <p role="alert" className="font-semibold text-red-600">{err}</p>}
      {blocked.length > 0 && (
        <div data-testid="override-blocked" className="rounded-lg bg-red-50 p-3 text-base">
          <b className="text-red-600">Blocked by the gate (not executed):</b>
          <ul className="list-disc pl-6">
            {blocked.map((b, i) => <li key={i}><span className="font-mono">{b.action.name}</span> {b.outcome}: {b.reasons.join("; ")}</li>)}
          </ul>
        </div>
      )}
    </form>
  );
}
