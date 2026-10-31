'use client';
import { useState } from "react";
import { decideApproval, type Approval } from "@/lib/api";

// Approve / Reject for a PENDING approval on this ticket (D3).
export default function ApprovalActions({ approval, onDone }: { approval: Approval; onDone: () => void }) {
  const [note, setNote] = useState("");
  const [by, setBy] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const p = (approval.action_json.params ?? {}) as Record<string, unknown>;
  const amount = typeof p.amount_inr === "number" ? ` ₹${p.amount_inr.toLocaleString("en-IN")}` : "";

  async function go(approve: boolean) {
    if (!by.trim()) return setErr("Enter your name first.");
    setBusy(true);
    setErr(null);
    try {
      await decideApproval(approval.id, { approve, note: note.trim() || null, decided_by: by.trim() });
      onDone();
    } catch (x) {
      setErr(x instanceof Error ? x.message : "Decision failed.");
    } finally {
      setBusy(false);
    }
  }

  const field = "rounded-lg border border-navy/30 px-3 py-2 text-lg";
  const btn = "rounded-lg px-6 py-3 text-xl font-bold disabled:opacity-50";
  return (
    <section data-testid="approval-actions" data-approval-id={approval.id} className="space-y-3 rounded-xl bg-amber-50 p-5 shadow-sm ring-2 ring-amber-400">
      <h2 className="text-xl font-bold text-navy">Approval needed</h2>
      <div className="font-mono text-2xl font-bold text-navy">{String(approval.action_json.name ?? "action")}{amount}</div>
      <ul className="list-disc pl-6 text-base">
        {(Array.isArray(approval.reasons_json) ? approval.reasons_json : []).map((r, i) => <li key={i}>{String(r)}</li>)}
      </ul>
      <input data-testid="approval-note" value={note} onChange={(e) => setNote(e.target.value)} placeholder="Note" className={`${field} w-full`} />
      <input data-testid="approval-decided-by" value={by} onChange={(e) => setBy(e.target.value)} placeholder="Your name" className={`${field} w-full`} />
      <div className="flex gap-3">
        <button data-testid="approve-button" disabled={busy} onClick={() => go(true)} className={`${btn} bg-cyan text-navy`}>Approve</button>
        <button data-testid="reject-button" disabled={busy} onClick={() => go(false)} className={`${btn} border-2 border-navy text-navy`}>Reject</button>
      </div>
      {err && <p role="alert" className="font-semibold text-red-600">{err}</p>}
    </section>
  );
}
