'use client';
import { Badge } from "@/components/ui/badge";
import { cn } from "cn";

export default function TypeBadge({ type, className }: { type: string | null; className?: string }) {
  return (
    <Badge data-testid="ticket-type" variant="outline" className={cn("h-6 px-2.5 font-mono text-sm font-normal", className)}>
      {type ?? "-"}
    </Badge>
  );
}
