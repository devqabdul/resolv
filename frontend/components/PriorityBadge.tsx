'use client';
const COLOR: Record<string, string> = { P1: "bg-red-600 text-white", P2: "bg-amber-500 text-white", P3: "bg-gray-200 text-ink" };

export default function PriorityBadge({ priority }: { priority: string | null }) {
  return (
    <span data-testid="ticket-priority" className={`inline-block text-sm font-semibold px-2 py-0.5 rounded ${COLOR[priority ?? ""] ?? "bg-gray-200 text-ink"}`}>
      {priority ?? "-"}
    </span>
  );
}
