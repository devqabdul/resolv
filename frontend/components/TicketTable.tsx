'use client';
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { useTickets } from "@/lib/api";
import { slaCountdown } from "@/lib/format";
import PriorityBadge from "./PriorityBadge";
import StatusBadge from "./StatusBadge";
import TypeBadge from "./TypeBadge";

// Green > 5 min left, amber <= 5 min, red once breached. (decision: FIX3: first-response SLA is 15 min, so amber at 15 showed on every new ticket)
function slaTone(due: string | null, now: number, overdue: boolean): string {
  if (!due) return "text-ink/60";
  if (overdue) return "bg-red-600 text-white";
  return new Date(due).getTime() - now <= 5 * 60_000 ? "bg-amber-400 text-navy" : "bg-green-600 text-white";
}

export default function TicketTable({ incidentId }: { incidentId?: string }) {
  const router = useRouter();
  const { data, error } = useTickets({ limit: 200, incident_id: incidentId });
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, []);

  if (!data) {
    return <p className="text-lg text-ink/60">{error ? "Backend unreachable." : "Loading..."}</p>;
  }
  // (decision: FIX5) stable sort: non-incident rows first so D1/D3 stay on top after a spike
  const items = [...data.items].sort((a, b) => Number(!!a.incident_id) - Number(!!b.incident_id));
  if (items.length === 0) {
    return (
      <div data-testid="queue-empty" className="mx-auto max-w-xl rounded-xl bg-white p-10 text-center text-2xl font-semibold text-navy shadow-sm">
        No tickets yet — open ?demo=1 and Seed, then inject a scenario
      </div>
    );
  }
  return (
    <div className="overflow-x-auto rounded-xl bg-white shadow-sm">
      <table data-testid="ticket-table" className="w-full text-left text-base text-ink">
        <thead className="bg-navy text-white">
          <tr>
            {["ID", "Type", "Priority", "Status", "Path", "SLA", "Incident", "Resolved by"].map((h) => (
              <th key={h} className="px-3 py-2 font-semibold">{h}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {items.map((t) => {
            const sla = slaCountdown(t.sla_due_at, now);
            return (
              <tr key={t.id} data-testid="ticket-row" data-ticket-id={t.id} data-status={t.status} className="cursor-pointer border-t border-light hover:bg-light" onClick={() => router.push(`/tickets/${t.id}`)}>
                <td className="px-3 py-2 font-semibold">
                  <Link href={`/tickets/${t.id}`} className="text-navy underline decoration-cyan">{t.id}</Link>
                  <div className="max-w-xs truncate text-sm font-normal text-ink/60">{t.masked_text}</div>
                </td>
                <td className="px-3 py-2"><TypeBadge type={t.ticket_type} /></td>
                <td className="px-3 py-2"><PriorityBadge priority={t.priority} /></td>
                <td className="px-3 py-2"><StatusBadge status={t.status} /></td>
                <td data-testid="ticket-path" className="px-3 py-2">{t.path ?? "-"}</td>
                <td data-testid="sla-countdown" className="px-3 py-2"><span className={`inline-block rounded-full px-3 py-1 font-mono text-lg font-bold ${slaTone(t.sla_due_at, now, sla.overdue)}`}>{sla.text}</span></td>
                <td className="px-3 py-2">
                  {t.incident_id && (
                    <Link href="/incidents" data-testid="incident-badge" title={t.incident_id} onClick={(e) => e.stopPropagation()} className="inline-block rounded-full bg-purple-600 px-3 py-1 text-base font-bold text-white">INCIDENT</Link>
                  )}
                </td>
                <td data-testid="resolved-by" className="px-3 py-2">
                  {t.resolved_by && (
                    <span className={`inline-block rounded-full px-3 py-1 text-base font-bold ${t.resolved_by === "resolv" ? "bg-cyan text-navy" : "bg-navy text-white"}`}>{t.resolved_by}</span>
                  )}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
