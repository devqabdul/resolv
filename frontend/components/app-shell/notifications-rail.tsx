'use client';
// Right rail (below content under xl), open on load on every page: last 10 in-app notifications,
// newest first, with a Slack mark when a slack row shares ticket/incident + ts.
import { useEffect, useState } from "react";
import { BellIcon, CaretDoubleLeftIcon, CaretDoubleRightIcon, CheckIcon, SlackLogoIcon, XIcon } from "@phosphor-icons/react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Empty, EmptyDescription, EmptyHeader, EmptyMedia, EmptyTitle } from "@/components/ui/empty";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Skeleton } from "@/components/ui/skeleton";
import { useNotifications, type Notification } from "@/lib/api";
import { ago } from "@/lib/format";
import { cn } from "@/lib/utils";

export default function NotificationsRail() {
  const { data, error } = useNotifications(50);
  const [open, setOpen] = useState(true);
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 5000);
    return () => clearInterval(t);
  }, []);
  const rows = [...(data ?? [])].sort((a, b) => b.ts.localeCompare(a.ts));
  const slack = (n: Notification) =>
    rows.find((r) => r.channel === "slack" && r.ts === n.ts && r.ticket_id === n.ticket_id && r.incident_id === n.incident_id);
  const items = rows.filter((r) => r.channel === "inapp").slice(0, 10);

  return (
    <aside
      data-testid="notifications-panel"
      className={cn(
        "flex shrink-0 flex-col border-t bg-card xl:sticky xl:top-0 xl:h-svh xl:border-t-0 xl:border-l",
        open ? "xl:w-72" : "xl:w-14",
      )}
    >
      <div className="flex h-14 shrink-0 items-center gap-2 border-b px-4">
        <BellIcon className="text-muted-foreground" />
        <h2 className={cn("text-base font-semibold", !open && "xl:hidden")}>Notifications</h2>
        <Button
          variant="ghost"
          size="icon-sm"
          className="ml-auto hidden xl:inline-flex"
          aria-label={open ? "Collapse notifications" : "Expand notifications"}
          onClick={() => setOpen(!open)}
        >
          {open ? <CaretDoubleRightIcon /> : <CaretDoubleLeftIcon />}
        </Button>
      </div>
      <ScrollArea className={cn("min-h-0 flex-1", !open && "xl:hidden")}>
        {!data && !error ? (
          <div className="flex flex-col gap-4 p-4">
            {[0, 1, 2].map((i) => <Skeleton key={i} className="h-12 w-full" />)}
          </div>
        ) : items.length === 0 ? (
          <Empty className="p-6">
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
                <li key={n.id} data-testid="notification-item" data-channel={n.channel} className="flex flex-col gap-1 border-b px-4 py-3">
                  <div className="flex items-center gap-2 text-sm">
                    <span className="min-w-0 truncate font-medium">{n.target}</span>
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
    </aside>
  );
}
