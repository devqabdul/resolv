'use client';
import { Badge } from "@/components/ui/badge";

export default function TypeBadge({ type }: { type: string | null }) {
  return (
    <Badge data-testid="ticket-type" variant="outline" className="h-6 px-2.5 font-mono text-sm font-normal">
      {type ?? "-"}
    </Badge>
  );
}
