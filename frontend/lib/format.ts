// (decision: T13) client-side SLA countdown helper.
export function slaCountdown(due: string | null, now: number): { text: string; overdue: boolean } {
  if (!due) return { text: "-", overdue: false };
  const s = Math.round((new Date(due).getTime() - now) / 1000);
  const a = Math.abs(s);
  const mm = String(Math.floor(a / 60)).padStart(2, "0");
  const ss = String(a % 60).padStart(2, "0");
  return { text: `${s < 0 ? "-" : ""}${mm}:${ss}`, overdue: s < 0 };
}

// (decision: UI-1) compact relative time for the notifications rail: "12s ago", "3m ago", "2h ago".
export function ago(ts: string, now: number): string {
  const s = Math.max(0, Math.round((now - new Date(ts).getTime()) / 1000));
  if (s < 60) return `${s}s ago`;
  if (s < 3600) return `${Math.floor(s / 60)}m ago`;
  if (s < 86400) return `${Math.floor(s / 3600)}h ago`;
  return `${Math.floor(s / 86400)}d ago`;
}
