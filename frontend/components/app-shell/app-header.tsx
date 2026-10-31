'use client';
// Sticky page header: sidebar toggle, page title, backend health (llm_mode) and theme toggle.
import { usePathname } from "next/navigation";
import { useTheme } from "next-themes";
import { MoonIcon, SunIcon } from "@phosphor-icons/react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Separator } from "@/components/ui/separator";
import { SidebarTrigger } from "@/components/ui/sidebar";
import { useHealth } from "@/lib/api";
import { cn } from "@/lib/utils";

const TITLES: Record<string, string> = { "": "Queue", approvals: "Approvals", incidents: "Incidents", evidence: "Evidence", tickets: "Ticket" };

export default function AppHeader() {
  const path = usePathname();
  const { data: health, error } = useHealth();
  const { resolvedTheme, setTheme } = useTheme();
  const title = TITLES[path.split("/")[1] ?? ""] ?? "Resolv";
  const up = !!health?.ok && !error;
  return (
    <header className="sticky top-0 z-10 flex h-14 shrink-0 items-center gap-3 border-b bg-background/95 px-4 backdrop-blur-sm">
      <SidebarTrigger />
      <Separator orientation="vertical" className="data-[orientation=vertical]:h-5" />
      <h1 className="text-base font-semibold">{title}</h1>
      <div className="ml-auto flex items-center gap-2">
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
