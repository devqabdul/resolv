'use client';
// Sticky page header: title (or ticket breadcrumb), ⌘K search, backend health, notifications, demo, user menu.
import { useEffect, useState } from "react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useTheme } from "next-themes";
import {
  BellIcon, CaretDownIcon, FlaskIcon, MagnifyingGlassIcon, MoonIcon, SunIcon,
} from "@phosphor-icons/react";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import {
  Breadcrumb, BreadcrumbItem, BreadcrumbLink, BreadcrumbList, BreadcrumbPage, BreadcrumbSeparator,
} from "@/components/ui/breadcrumb";
import { Button } from "@/components/ui/button";
import {
  CommandDialog, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList,
} from "@/components/ui/command";
import {
  DropdownMenu, DropdownMenuCheckboxItem, DropdownMenuContent, DropdownMenuGroup, DropdownMenuItem, DropdownMenuLabel,
  DropdownMenuSeparator, DropdownMenuShortcut, DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Kbd } from "@/components/ui/kbd";
import { Separator } from "@/components/ui/separator";
import { SidebarTrigger, useSidebar } from "@/components/ui/sidebar";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { useLayoutState } from "@/components/app-shell/layout-state";
import NotificationsDrawer from "@/components/app-shell/notifications-drawer";
import DemoDrawer from "@/components/DemoDrawer";
import { useHealth, useNotifications, useTickets } from "@/lib/api";
import { cn } from "@/lib/utils";

const TITLES: Record<string, string> = { "": "Queue", dashboard: "Dashboard", approvals: "Approvals", incidents: "Incidents", evidence: "Evidence", tickets: "Ticket" };
const SUBTITLE = "AI-powered support operations for payments & fintech";
const PAGES = [
  { href: "/dashboard", label: "Dashboard" },
  { href: "/", label: "Queue" },
  { href: "/approvals", label: "Approvals" },
  { href: "/incidents", label: "Incidents" },
  { href: "/evidence", label: "Evidence" },
];

const typing = (t: EventTarget | null) =>
  t instanceof HTMLElement && (t.isContentEditable || ["INPUT", "TEXTAREA", "SELECT"].includes(t.tagName));

// ⌘K palette over the loaded tickets (same SWR key as the queue; mounted only while open) plus page links.
function SearchPalette({ open, onOpenChange }: { open: boolean; onOpenChange: (o: boolean) => void }) {
  const router = useRouter();
  const { data } = useTickets({ limit: 200 });
  const go = (href: string) => {
    onOpenChange(false);
    router.push(href);
  };
  return (
    <CommandDialog open={open} onOpenChange={onOpenChange} title="Search" description="Search tickets, customers, transactions or pages.">
      <CommandInput placeholder="Search tickets, customers, or transactions..." />
      <CommandList>
        <CommandEmpty>No results.</CommandEmpty>
        <CommandGroup heading="Tickets">
          {(data?.items ?? []).map((t) => (
            <CommandItem
              key={t.id}
              value={[t.id, t.customer_id, t.merchant_id, t.candidate_txn_id, t.masked_text].filter(Boolean).join(" ")}
              onSelect={() => go(`/tickets/${t.id}`)}
            >
              <span className="shrink-0 font-mono text-sm font-medium">{t.id}</span>
              <span className="truncate text-muted-foreground">{t.masked_text}</span>
            </CommandItem>
          ))}
        </CommandGroup>
        <CommandGroup heading="Pages">
          {PAGES.map((p) => (
            <CommandItem key={p.href} value={`page ${p.label}`} onSelect={() => go(p.href)}>
              {p.label}
            </CommandItem>
          ))}
        </CommandGroup>
      </CommandList>
    </CommandDialog>
  );
}

export default function AppHeader() {
  const path = usePathname();
  const { data: health, error } = useHealth();
  const { resolvedTheme, setTheme } = useTheme();
  const { open: sidebarOpen, setOpen: setSidebarOpen } = useSidebar();
  const { focus, enterFocus, exitFocus } = useLayoutState();
  const { data: notes } = useNotifications(50);
  const [searchOpen, setSearchOpen] = useState(false);
  const [demoOpen, setDemoOpen] = useState(false);
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
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        setSearchOpen((o) => !o);
        return;
      }
      if (e.metaKey || e.ctrlKey || e.altKey || typing(e.target)) return;
      if (e.key === "Escape" && focus) toggleFocus();
      else if (e.key.toLowerCase() === "f" && !e.repeat) toggleFocus();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  });

  const [section, ticketId] = path.split("/").slice(1);
  const title = TITLES[section ?? ""] ?? "Resolv";
  const up = !!health?.ok && !error;
  return (
    <header className="sticky top-0 z-10 flex h-16 shrink-0 items-center gap-3 border-b bg-background px-4">
      <SidebarTrigger />
      <Separator orientation="vertical" className="data-vertical:h-5 data-vertical:self-center" />
      {section === "tickets" && ticketId ? (
        <Breadcrumb>
          <BreadcrumbList className="text-base">
            <BreadcrumbItem>
              <BreadcrumbLink asChild><Link href="/">Queue</Link></BreadcrumbLink>
            </BreadcrumbItem>
            <BreadcrumbSeparator>/</BreadcrumbSeparator>
            <BreadcrumbItem>
              <BreadcrumbPage className="font-mono font-semibold">{decodeURIComponent(ticketId)}</BreadcrumbPage>
            </BreadcrumbItem>
          </BreadcrumbList>
        </Breadcrumb>
      ) : (
        <div className="flex min-w-0 flex-col">
          <h1 className="text-base leading-tight font-semibold">{title}</h1>
          <p className="truncate text-sm text-muted-foreground">{SUBTITLE}</p>
        </div>
      )}
      <div className="ml-auto flex items-center gap-2">
        <Button
          variant="outline"
          className="hidden w-90 justify-start gap-2 font-normal text-muted-foreground lg:flex"
          onClick={() => setSearchOpen(true)}
        >
          <MagnifyingGlassIcon data-icon="inline-start" />
          <span className="flex-1 truncate text-left">Search tickets, customers, or transactions...</span>
          <Kbd>⌘K</Kbd>
        </Button>
        <Tooltip>
          <TooltipTrigger asChild>
            <Button variant="ghost" size="icon" aria-label="Search" className="lg:hidden" onClick={() => setSearchOpen(true)}>
              <MagnifyingGlassIcon />
            </Button>
          </TooltipTrigger>
          <TooltipContent>Search <Kbd>⌘K</Kbd></TooltipContent>
        </Tooltip>
        {searchOpen && <SearchPalette open onOpenChange={setSearchOpen} />}

        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button variant="outline" className={cn("gap-2", !up && "text-destructive")}>
              <span className="relative flex size-2">
                {up && <span className="absolute inline-flex size-full rounded-full bg-status-resolved opacity-75 motion-safe:animate-ping" />}
                <span className={cn("relative inline-flex size-2 rounded-full", up ? "bg-status-resolved" : "bg-destructive")} />
              </span>
              {up ? "Live" : "Offline"}
              <CaretDownIcon data-icon="inline-end" />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="w-56">
            <DropdownMenuLabel>Backend health</DropdownMenuLabel>
            <DropdownMenuSeparator />
            {health && !error ? (
              <DropdownMenuGroup className="flex flex-col gap-1 px-2 py-1 font-mono text-sm">
                {[["llm mode", health.llm_mode], ["db", health.db], ["mock paytm", health.mock_paytm]].map(([k, v]) => (
                  <div key={k} className="flex justify-between gap-4">
                    <span className="text-muted-foreground">{k}</span>
                    <span>{v}</span>
                  </div>
                ))}
              </DropdownMenuGroup>
            ) : (
              <p className="px-2 py-1 text-sm text-destructive">Offline: /api/health unreachable.</p>
            )}
          </DropdownMenuContent>
        </DropdownMenu>

        <Tooltip>
          <TooltipTrigger asChild>
            <span className="inline-flex">
              <DemoDrawer
                open={demoOpen}
                onOpenChange={setDemoOpen}
                trigger={
                  <Button data-testid="demo-open" variant="ghost" size="icon" aria-label="Demo controls">
                    <FlaskIcon />
                  </Button>
                }
              />
            </span>
          </TooltipTrigger>
          <TooltipContent>Demo controls</TooltipContent>
        </Tooltip>
        <Tooltip>
          <TooltipTrigger asChild>
            <span className="inline-flex">
        <NotificationsDrawer
          trigger={
            <Button data-testid="notifications-toggle" variant="ghost" size="icon" aria-label="Notifications" className="relative">
              <BellIcon />
              {recent > 0 && (
                <span className="absolute -top-0.5 -right-0.5 flex min-w-4 items-center justify-center rounded-full bg-destructive px-1 font-mono text-[0.625rem] leading-4 text-white tabular-nums">
                  {recent > 99 ? "99+" : recent}
                </span>
              )}
            </Button>
          }
        />
            </span>
          </TooltipTrigger>
          <TooltipContent>Notifications</TooltipContent>
        </Tooltip>
        <Separator orientation="vertical" className="data-vertical:h-5 data-vertical:self-center" />
        <DropdownMenu modal={false}>
          <DropdownMenuTrigger asChild>
            <Button variant="ghost" className="gap-2 px-1.5">
              <Avatar className="size-7">
                <AvatarFallback className="bg-primary text-sm font-medium text-primary-foreground">A</AvatarFallback>
              </Avatar>
              <span className="hidden text-sm font-medium sm:inline">Abdul</span>
              <CaretDownIcon data-icon="inline-end" />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="w-56">
            <DropdownMenuLabel>Abdul Qureshi</DropdownMenuLabel>
            <DropdownMenuSeparator />
            <DropdownMenuGroup>
              <DropdownMenuItem onSelect={() => setTheme(resolvedTheme === "dark" ? "light" : "dark")}>
                <SunIcon className="hidden dark:block" />
                <MoonIcon className="dark:hidden" />
                {resolvedTheme === "dark" ? "Light theme" : "Dark theme"}
              </DropdownMenuItem>
              <DropdownMenuCheckboxItem data-testid="focus-toggle" checked={focus} onCheckedChange={toggleFocus}>
                Focus mode
                <DropdownMenuShortcut><Kbd>{focus ? "Esc" : "F"}</Kbd></DropdownMenuShortcut>
              </DropdownMenuCheckboxItem>
              <DropdownMenuItem onSelect={() => setDemoOpen(true)}>
                <FlaskIcon />
                Demo controls
              </DropdownMenuItem>
            </DropdownMenuGroup>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>
    </header>
  );
}
