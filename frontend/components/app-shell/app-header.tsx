'use client';
// Sticky page header: sidebar toggle, page title, backend health (llm_mode) and theme toggle.
import { useEffect, useState } from "react";
import { usePathname } from "next/navigation";
import { useTheme } from "next-themes";
import { ArrowsInIcon, ArrowsOutIcon, BellIcon, FlaskIcon, MoonIcon, SunIcon } from "@phosphor-icons/react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Separator } from "@/components/ui/separator";
import { Kbd } from "@/components/ui/kbd";
import { SidebarTrigger, useSidebar } from "@/components/ui/sidebar";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { useLayoutState } from "@/components/app-shell/layout-state";
import NotificationsDrawer from "@/components/app-shell/notifications-drawer";
import DemoDrawer from "@/components/DemoDrawer";
import { useHealth, useNotifications } from "@/lib/api";
import { cn } from "@/lib/utils";

const TITLES: Record<string, string> = { "": "Queue", approvals: "Approvals", incidents: "Incidents", evidence: "Evidence", tickets: "Ticket" };

// Icon-only header button with a tooltip (label plus optional shortcut).
function HeaderToggle({ label, kbd, ...props }: { label: string; kbd?: string } & React.ComponentProps<typeof Button>) {
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <Button variant="ghost" size="icon" aria-label={label} {...props} />
      </TooltipTrigger>
      <TooltipContent>
        {label}
        {kbd && <Kbd>{kbd}</Kbd>}
      </TooltipContent>
    </Tooltip>
  );
}

const typing = (t: EventTarget | null) =>
  t instanceof HTMLElement && (t.isContentEditable || ["INPUT", "TEXTAREA", "SELECT"].includes(t.tagName));

export default function AppHeader() {
  const path = usePathname();
  const { data: health, error } = useHealth();
  const { resolvedTheme, setTheme } = useTheme();
  const { open: sidebarOpen, setOpen: setSidebarOpen } = useSidebar();
  const { focus, enterFocus, exitFocus } = useLayoutState();
  const { data: notes } = useNotifications(50);
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 15000);
    return () => clearInterval(t);
  }, []);
  const recent = (notes ?? []).filter((n) => n.channel === "inapp" && now - new Date(n.ts).getTime() < 10 * 60 * 1000).length;

  const toggleFocus = () => {
    if (focus) setSidebarOpen(exitFocus());
    else {
      enterFocus(sidebarOpen);
      setSidebarOpen(false);
    }
  };
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.metaKey || e.ctrlKey || e.altKey || typing(e.target)) return;
      if (e.key === "Escape" && focus) toggleFocus();
      else if (e.key.toLowerCase() === "f" && !e.repeat) toggleFocus();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  });
  const title = TITLES[path.split("/")[1] ?? ""] ?? "Resolv";
  const up = !!health?.ok && !error;
  return (
    <header className="sticky top-0 z-10 flex h-14 shrink-0 items-center gap-3 border-b bg-background px-4">
      <SidebarTrigger />
      <Separator orientation="vertical" className="data-vertical:h-5 data-vertical:self-center" />
      <h1 className="text-base font-semibold">{title}</h1>
      <div className="ml-auto flex items-center gap-2">
        <HeaderToggle
          data-testid="focus-toggle"
          label={focus ? "Exit focus mode" : "Focus mode"}
          kbd={focus ? "Esc" : "F"}
          aria-pressed={focus}
          onClick={toggleFocus}
        >
          {focus ? <ArrowsInIcon /> : <ArrowsOutIcon />}
        </HeaderToggle>
        <DemoDrawer
          trigger={
            <Button data-testid="demo-open" variant="ghost" size="icon" aria-label="Demo controls" title="Demo controls">
              <FlaskIcon />
            </Button>
          }
        />
        <NotificationsDrawer
          trigger={
            <Button data-testid="notifications-toggle" variant="ghost" size="icon" aria-label="Notifications" className="relative">
              <BellIcon />
              {recent > 0 && (
                <span className="absolute -top-0.5 -right-0.5 flex min-w-4 items-center justify-center rounded-full bg-primary px-1 font-mono text-[0.625rem] leading-4 text-primary-foreground tabular-nums">
                  {recent > 99 ? "99+" : recent}
                </span>
              )}
            </Button>
          }
        />
        <Separator orientation="vertical" className="data-vertical:h-5 data-vertical:self-center" />
        <Badge
          variant="outline"
          className="h-7 gap-2 px-2.5 font-mono text-sm"
          title={health ? `db ${health.db}, mock paytm ${health.mock_paytm}` : "Backend unreachable"}
        >
          <span className={cn("size-2 rounded-full", up ? "bg-status-resolved" : "bg-destructive")} />
          {health && !error ? `llm ${health.llm_mode}` : "offline"}
        </Badge>
        <Button
          variant="ghost"
          size="icon"
          aria-label="Toggle dark mode"
          onClick={() => setTheme(resolvedTheme === "dark" ? "light" : "dark")}
        >
          <SunIcon className="hidden dark:block" />
          <MoonIcon className="dark:hidden" />
        </Button>
      </div>
    </header>
  );
}
