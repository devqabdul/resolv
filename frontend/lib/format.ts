// (decision: T13) client-side SLA countdown helper.
export function slaCountdown(due: string | null, now: number): { text: string; overdue: boolean } {
  if (!due) return { text: "-", overdue: false };
  const s = Math.round((new Date(due).getTime() - now) / 1000);
  const a = Math.abs(s);
  const mm = String(Math.floor(a / 60)).padStart(2, "0");
  const ss = String(a % 60).padStart(2, "0");
  return { text: `${s < 0 ? "-" : ""}${mm}:${ss}`, overdue: s < 0 };
}
