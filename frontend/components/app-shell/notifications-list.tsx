'use client';
// Notifications feed for the left sidebar: last 10 in-app notifications, newest first, with a Slack
// mark when a slack row shares ticket/incident + ts. `recent` counts in-app items from the last 10 minutes.
import { useEffect, useState } from "react";
import { BellIcon, CheckIcon, SlackLogoIcon, XIcon } from "@phosphor-icons/react";
import { Badge } from "@/components/ui/badge";
import { Empty, EmptyDescription, EmptyHeader, EmptyMedia, EmptyTitle } from "@/components/ui/empty";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Skeleton } from "@/components/ui/skeleton";
import { useNotifications, type Notification } from "@/lib/api";
import { ago } from "@/lib/format";
import { cn } from "@/lib/utils";

export function useNotificationFeed() {
  const { data, error } = useNotifications(50);
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 5000);
    return () => clearInterval(t);
  }, []);
  const rows = [...(data ?? [])].sort((a, b) => b.ts.localeCompare(a.ts));
  const inapp = rows.filter((r) => r.channel === "inapp");
  const slack = (n: Notification) =>
    rows.find((r) => r.channel === "slack" && r.ts === n.ts && r.ticket_id === n.ticket_id && r.incident_id === n.incident_id);
  const recent = inapp.filter((n) => now - new Date(n.ts).getTime() < 10 * 60 * 1000).length;
  return { loading: !data && !error, error: !!error, items: inapp.slice(0, 10), slack, recent, now };
}

export type NotificationFeed = ReturnType<typeof useNotificationFeed>;

export function NotificationsList({ feed, className }: { feed: NotificationFeed; className?: string }) {
  const { loading, error, items, slack, now } = feed;
  return (
    <ScrollArea data-testid="notifications-panel" className={cn("min-h-0 flex-1", className)}>
      {loading ? (
        <div className="flex flex-col gap-3 p-2">
          {[0, 1, 2].map((i) => <Skeleton key={i} className="h-12 w-full" />)}
        </div>
      ) : items.length === 0 ? (
        <Empty className="p-4">
          <EmptyHeader>
            <EmptyMedia variant="icon"><BellIcon /></EmptyMedia>
            <EmptyTitle>No notifications yet</EmptyTitle>
            <EmptyDescription>{error ? "Backend unreachable." : "Customer and team notices appear here."}</EmptyDescription>
          </EmptyHeader>
        </Empty>
      ) : (
        <ul className="flex flex-col">
          {items.map((n) => {
            const s = slack(n);
            return (
              <li key={n.id} data-testid="notification-item" data-channel={n.channel} className="flex flex-col gap-1 border-b px-2 py-2">
                <div className="flex items-center gap-2">
                  <span className="min-w-0 truncate font-mono text-xs font-medium">{n.target}</span>
                  {s && (
                    <Badge
                      data-testid="slack-mark"
                      variant="outline"
                      title={s.delivered ? "Delivered to Slack" : "Slack failed"}
                      className={cn("gap-1", s.delivered ? "text-status-resolved" : "text-status-failed")}
                    >
                      <SlackLogoIcon data-icon="inline-start" />
                      Slack
                      {s.delivered ? <CheckIcon data-icon="inline-end" /> : <XIcon data-icon="inline-end" />}
                    </Badge>
                  )}
                  <time dateTime={n.ts} className="ml-auto shrink-0 font-mono text-xs text-muted-foreground tabular-nums">
                    {ago(n.ts, now)}
                  </time>
                </div>
                <p className="line-clamp-2 text-sm wrap-anywhere text-muted-foreground">{n.text}</p>
              </li>
            );
          })}
        </ul>
      )}
    </ScrollArea>
  );
}
