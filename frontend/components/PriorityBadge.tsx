'use client';
import { Badge } from "@/components/ui/badge";
import { PRIORITY_TONE, toneBadge } from "@/components/status-tone";

export default function PriorityBadge({ priority }: { priority: string | null }) {
  return (
    <Badge data-testid="ticket-priority" className={toneBadge({ tone: PRIORITY_TONE[priority ?? ""], className: "font-mono" })}>
      {priority ?? "-"}
    </Badge>
  );
}
