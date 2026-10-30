'use client';
import Link from "next/link";
import { useEffect, useState } from "react";
import { useTickets } from "@/lib/api";
import { slaCountdown } from "@/lib/format";
import PriorityBadge from "./PriorityBadge";
import StatusBadge from "./StatusBadge";
import TypeBadge from "./TypeBadge";

export default function TicketTable() {
  const { data, error } = useTickets({ limit: 50 });
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, []);

  if (!data) {
    return <p className="text-lg text-ink/60">{error ? "Backend unreachable." : "Loading..."}</p>;
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
          {data.items.map((t) => {
            const sla = slaCountdown(t.sla_due_at, now);
            return (
              <tr key={t.id} data-testid="ticket-row" data-ticket-id={t.id} data-status={t.status} className="border-t border-light hover:bg-light">
                <td className="px-3 py-2 font-semibold">
                  <Link href={`/tickets/${t.id}`} className="text-navy underline decoration-cyan">{t.id}</Link>
                  <div className="max-w-xs truncate text-sm font-normal text-ink/60">{t.masked_text}</div>
                </td>
                <td className="px-3 py-2"><TypeBadge type={t.ticket_type} /></td>
                <td className="px-3 py-2"><PriorityBadge priority={t.priority} /></td>
                <td className="px-3 py-2"><StatusBadge status={t.status} /></td>
                <td data-testid="ticket-path" className="px-3 py-2">{t.path ?? "-"}</td>
                <td data-testid="sla-countdown" className={`px-3 py-2 font-mono text-lg font-bold ${sla.overdue ? "text-red-600" : ""}`}>{sla.text}</td>
                <td className="px-3 py-2">
                  {t.incident_id && (
                    <span data-testid="incident-badge" className="inline-block rounded bg-purple-600 px-2 py-0.5 text-sm font-semibold text-white">{t.incident_id}</span>
                  )}
                </td>
                <td data-testid="resolved-by" className="px-3 py-2">{t.resolved_by ?? "-"}</td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
