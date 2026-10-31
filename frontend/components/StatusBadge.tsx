'use client';
// Visible text stays the raw enum (recipes read `RESOLVED`); colour eases between states.
import { Badge } from "@/components/ui/badge";
import { STATUS_TONE, toneBadge } from "@/components/status-tone";

export default function StatusBadge({ status, className }: { status: string; className?: string }) {
  return (
    <Badge data-testid="ticket-status" className={toneBadge({ tone: STATUS_TONE[status], className })}>
      {status}
    </Badge>
  );
}
