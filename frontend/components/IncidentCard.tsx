'use client';
import Link from "next/link";
import { useState } from "react";
import { notifyIncident, type Incident } from "@/lib/api";

const PILL: Record<Incident["status"], string> = {
  OPEN: "bg-amber-400 text-navy",
  COMMUNICATED: "bg-cyan text-navy",
  RESOLVED: "bg-green-500 text-white",
};
const fmt = (iso: string) => new Date(iso).toLocaleTimeString();

export default function IncidentCard({ incident: inc, onChanged }: { incident: Incident; onChanged: () => void }) {
  const [draft, setDraft] = useState(inc.proactive_notice_draft ?? ""); // seeded once; edits stay local
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  async function send() {
    setBusy(true);
    setErr(null);
    try {
      await notifyIncident(inc.id);
      onChanged();
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }

  return (
    <section data-testid="incident-card" data-incident-id={inc.id} data-status={inc.status} className="overflow-hidden rounded-xl bg-white shadow-sm">
      <header className="flex items-center justify-between bg-navy px-5 py-3 text-white">
        <h2 data-testid="incident-title" className="text-2xl font-bold">{inc.title}</h2>
        <span className={`rounded-full px-4 py-1 text-lg font-bold ${PILL[inc.status]}`}>{inc.status}</span>
      </header>
      <div className="flex flex-col gap-4 p-5 text-ink">
        <div className="flex items-end justify-between gap-4">
          <p data-testid="incident-signature" className="font-mono text-lg">{inc.signature}</p>
          <p className="text-right">
            <span data-testid="incident-ticket-count" className="text-6xl font-bold text-navy">{inc.ticket_count}</span>
            <span className="ml-2 text-lg text-ink/60">tickets</span>
          </p>
        </div>
        <p className="text-lg">
          First seen {fmt(inc.first_seen)} · Last seen {fmt(inc.last_seen)} · Owner {inc.owner_team ?? "-"}
        </p>
        <p data-testid="incident-slack-status" className="text-lg font-semibold">
          Notice: {inc.notified_at ? `sent at ${fmt(inc.notified_at)}` : "not sent"}
        </p>
        <textarea data-testid="incident-notice-draft" rows={4} value={draft} onChange={(e) => setDraft(e.target.value)} className="w-full rounded-lg border border-navy/30 p-3 text-lg" />
        <div className="flex items-center gap-4">
          <button data-testid="incident-notify" disabled={busy || inc.status !== "OPEN"} onClick={send} className="rounded-lg bg-cyan px-5 py-3 text-lg font-bold text-navy disabled:opacity-50">
            Send proactive notice
          </button>
          <Link data-testid="incident-tickets-link" href={`/?incident_id=${inc.id}`} className="text-lg font-semibold text-navy underline decoration-cyan">
            Open linked tickets
          </Link>
          {err && <span className="text-lg text-red-600">{err}</span>}
        </div>
      </div>
    </section>
  );
}
