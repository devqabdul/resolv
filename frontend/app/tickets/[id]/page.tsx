'use client';
// Ticket detail (T14). Sample response for layout work: frontend/fixtures/ticket_d1.json
// (a captured GET /api/tickets/tkt_48213 after a D1 run); not imported at runtime.
import Link from "next/link";
import { useParams } from "next/navigation";
import { useState } from "react";
import ApprovalActions from "@/components/ApprovalActions";
import ContextCard from "@/components/ContextCard";
import OverrideForm from "@/components/OverrideForm";
import PriorityBadge from "@/components/PriorityBadge";
import RegulatoryClock from "@/components/RegulatoryClock";
import Timeline from "@/components/Timeline";
import { obj } from "@/components/TimelineEvent";
import TypeBadge from "@/components/TypeBadge";
import { rerunTicket, useTicket } from "@/lib/api";

const STATUS: Record<string, string> = {
  RESOLVED: "bg-green-600 text-white", AWAITING_APPROVAL: "bg-amber-400 text-ink", PROCESSING: "bg-cyan text-navy",
  ROUTED: "bg-navy text-white", ESCALATED: "bg-navy text-white", INCIDENT_LINKED: "bg-purple-600 text-white",
  FAILED: "bg-red-600 text-white", CLOSED: "bg-slate-700 text-white",
};

export default function TicketPage() {
  const { id } = useParams<{ id: string }>();
  const { data, error, mutate } = useTicket(id ?? null);
  const [busy, setBusy] = useState(false);
  const [runErr, setRunErr] = useState<string | null>(null);

  if (!data) return <p className="text-lg text-ink/60">{error ? "Backend unreachable or ticket not found." : "Loading..."}</p>;

  const { ticket: t, run, timeline, approvals, incident } = data;
  const ctx = obj(run?.state?.context);
  const pending = approvals.find((a) => a.status === "PENDING");
  const refresh = () => void mutate();

  async function rerun() {
    setBusy(true);
    setRunErr(null);
    try {
      await mutate(await rerunTicket(t.id), { revalidate: false });
    } catch (x) {
      setRunErr(x instanceof Error ? x.message : "Re-run failed.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <header className="mb-6 flex flex-wrap items-center gap-3">
        <h1 className="text-3xl font-bold text-navy">{t.id}</h1>
        <span data-testid="ticket-status" data-status={t.status} className={`rounded-full px-4 py-1 text-2xl font-bold ${STATUS[t.status] ?? "bg-gray-500 text-white"}`}>{t.status}</span>
        <TypeBadge type={t.ticket_type} />
        <PriorityBadge priority={t.priority} />
        {t.path && <span data-testid="ticket-path" className="rounded bg-navy px-2 py-0.5 text-sm font-bold text-white">{t.path}</span>}
        {t.assigned_team && <span className="rounded bg-light px-2 py-0.5 text-sm font-bold text-navy ring-1 ring-navy/20">team: {t.assigned_team}</span>}
        <span data-testid="resolved-by" className="text-lg text-ink/70">{t.resolved_by ? <>resolved by <b className="text-navy">{t.resolved_by}</b></> : "unresolved"}</span>
        {incident && (
          <Link data-testid="incident-chip" href="/incidents" /* (decision: FIX4) no /incidents/[id] route; the list page shows all */ className="rounded bg-purple-600 px-3 py-1 text-base font-bold text-white">
            Incident {incident.title ?? incident.signature}
          </Link>
        )}
        <button data-testid="rerun-button" disabled={busy} onClick={rerun} className="ml-auto rounded-lg border-2 border-cyan px-5 py-2 text-lg font-bold text-navy disabled:opacity-50">
          {busy ? "Running..." : "Re-run"}
        </button>
        {runErr && <p role="alert" className="w-full font-semibold text-red-600">{runErr}</p>}
      </header>
      <div className="grid gap-6 lg:grid-cols-[minmax(0,2fr)_minmax(0,3fr)]">
        <div className="space-y-6">
          <section className="rounded-xl bg-white p-5 shadow-sm">
            <h2 className="mb-2 text-xl font-bold text-navy">Ticket ({t.channel})</h2>
            <p data-testid="ticket-masked-text" className="text-xl leading-relaxed">{t.masked_text}</p>
          </section>
          <ContextCard context={ctx} candidateTxnId={t.candidate_txn_id} />
          <RegulatoryClock clock={obj(ctx?.regulatory_clock)} />
          {pending && <ApprovalActions approval={pending} onDone={refresh} />}
          <OverrideForm ticketId={t.id} onDone={refresh} />
        </div>
        <div>
          <h2 className="mb-3 text-xl font-bold text-navy">Timeline ({timeline.length})</h2>
          <Timeline events={timeline} />
        </div>
      </div>
    </>
  );
}
