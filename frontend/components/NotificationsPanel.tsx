'use client';
// Last 10 notifications, newest first; Slack mark when a slack row shares ticket/incident + ts.
import { useNotifications } from "@/lib/api";

export default function NotificationsPanel() {
  const { data } = useNotifications(50);
  const rows = data ?? [];
  const slack = (n: { ticket_id?: string | null; incident_id?: string | null; ts: string }) =>
    rows.find((r) => r.channel === "slack" && r.ts === n.ts && r.ticket_id === n.ticket_id && r.incident_id === n.incident_id);
  const items = rows.filter((r) => r.channel === "inapp").slice(0, 10);
  return (
    <section data-testid="notifications-panel" className="rounded bg-white p-4 shadow">
      <h2 className="mb-2 text-xl font-bold text-navy">Notifications</h2>
      {items.length === 0 && <p className="text-lg text-ink/60">No notifications yet.</p>}
      <ul className="space-y-1 text-lg">
        {items.map((n) => {
          const s = slack(n);
          return (
            <li key={n.id} data-testid="notification-item" data-channel={n.channel} className="flex gap-3">
              <span className="font-semibold text-navy">{n.target}</span>
              <span className="min-w-0 flex-1 truncate">{n.text}</span>
              <time className="shrink-0 text-ink/60">{new Date(n.ts).toLocaleTimeString()}</time>
              {s && (
                <span data-testid="slack-mark" title={s.delivered ? "Delivered to Slack" : "Slack failed"} className={s.delivered ? "font-bold text-green-700" : "font-bold text-red-700"}>
                  Slack {s.delivered ? "✓" : "✗"}
                </span>
              )}
            </li>
          );
        })}
      </ul>
    </section>
  );
}
