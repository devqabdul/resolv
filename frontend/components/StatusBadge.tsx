'use client';
import type { TicketStatus } from "@/lib/api";
const COLOR: Record<TicketStatus, string> = {
  NEW: "bg-gray-500",
  PROCESSING: "bg-cyan",
  RESOLVED: "bg-green-600",
  AWAITING_APPROVAL: "bg-amber-500",
  ROUTED: "bg-navy",
  ESCALATED: "bg-navy",
  INCIDENT_LINKED: "bg-purple-600",
  CLOSED: "bg-slate-700",
  FAILED: "bg-red-600",
};

export default function StatusBadge({ status }: { status: string }) {
  return (
    <span data-testid="ticket-status" className={`inline-block text-sm font-semibold px-2 py-0.5 rounded-full text-white ${COLOR[status as TicketStatus] ?? "bg-gray-500"}`}>
      {status}
    </span>
  );
}
