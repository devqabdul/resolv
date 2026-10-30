'use client';
export default function TypeBadge({ type }: { type: string | null }) {
  return (
    <span data-testid="ticket-type" className="inline-block text-sm font-semibold px-2 py-0.5 rounded bg-cyan/15 text-navy">
      {type ?? "-"}
    </span>
  );
}
