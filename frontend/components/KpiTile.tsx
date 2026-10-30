'use client';
export default function KpiTile({ id, label, value }: { id: string; label: string; value: string }) {
  return (
    <div data-testid={`kpi-${id}`} className="flex-1 min-w-36 rounded-xl bg-white px-4 py-3 shadow-sm">
      <div className="text-sm font-semibold text-ink/60">{label}</div>
      <div className="text-3xl font-bold text-navy">{value}</div>
    </div>
  );
}
