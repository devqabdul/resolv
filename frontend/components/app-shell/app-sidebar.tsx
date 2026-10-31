'use client';
// Nav rail: collapses to icons. Live counts reuse the pages' SWR keys, so no extra polling.
import Link from "next/link";
import { usePathname } from "next/navigation";
import { BellIcon, FlaskIcon, ListChecksIcon, SealCheckIcon, SirenIcon, ChartBarIcon } from "@phosphor-icons/react";
import {
  Sidebar, SidebarContent, SidebarGroup, SidebarGroupContent, SidebarHeader, SidebarMenu,
  SidebarMenuBadge, SidebarMenuButton, SidebarMenuItem, SidebarRail,
} from "@/components/ui/sidebar";
import DemoDrawer from "@/components/DemoDrawer";
import { useNotificationFeed } from "@/components/app-shell/notifications-list";
import NotificationsDrawer from "@/components/app-shell/notifications-drawer";
import { useApprovals, useIncidents } from "@/lib/api";

export default function AppSidebar() {
  const path = usePathname();
  const { data: approvals } = useApprovals("PENDING");
  const { data: incidents } = useIncidents();
  const feed = useNotificationFeed();
  const nav = [
    { href: "/", label: "Queue", icon: ListChecksIcon, count: undefined },
    { href: "/approvals", label: "Approvals", icon: SealCheckIcon, count: approvals?.length },
    { href: "/incidents", label: "Incidents", icon: SirenIcon, count: incidents?.filter((i) => i.status === "OPEN").length },
    { href: "/evidence", label: "Evidence", icon: ChartBarIcon, count: undefined },
  ];
  return (
    <Sidebar collapsible="icon">
      <SidebarHeader className="h-14 justify-center border-b px-4 group-data-[collapsible=icon]:px-2">
        <Link href="/" className="text-xl font-semibold tracking-tight text-primary group-data-[collapsible=icon]:text-center">
          <span className="group-data-[collapsible=icon]:hidden">Resolv</span>
          <span className="hidden group-data-[collapsible=icon]:inline">R</span>
        </Link>
      </SidebarHeader>
      <SidebarContent>
        <SidebarGroup>
          <SidebarGroupContent>
            <SidebarMenu className="gap-1">
              {nav.map((n) => {
                const active = n.href === "/" ? path === "/" || path.startsWith("/tickets") : path.startsWith(n.href);
                return (
                  <SidebarMenuItem key={n.href}>
                    <SidebarMenuButton
                      asChild
                      isActive={active}
                      tooltip={n.label}
                      className="h-9 text-[0.9375rem] data-active:bg-highlight/12 data-active:shadow-[inset_2px_0_0_var(--highlight)] data-active:[&_svg]:text-highlight-text"
                    >
                      <Link href={n.href}>
                        <n.icon weight={active ? "fill" : "regular"} />
                        <span>{n.label}</span>
                      </Link>
                    </SidebarMenuButton>
                    {n.count !== undefined && n.count > 0 && (
                      <SidebarMenuBadge className="top-2! font-mono">{n.count}</SidebarMenuBadge>
                    )}
                  </SidebarMenuItem>
                );
              })}
              <SidebarMenuItem>
                <NotificationsDrawer
                  trigger={
                    <SidebarMenuButton data-testid="notifications-open" tooltip="Notifications" className="h-9 text-[0.9375rem]">
                      <BellIcon />
                      <span>Notifications</span>
                    </SidebarMenuButton>
                  }
                />
                {feed.recent > 0 && <SidebarMenuBadge className="top-2! font-mono">{feed.recent}</SidebarMenuBadge>}
              </SidebarMenuItem>
              <SidebarMenuItem>
                <DemoDrawer
                  trigger={
                    <SidebarMenuButton data-testid="demo-open" tooltip="Demo controls" className="h-9 text-[0.9375rem]">
                      <FlaskIcon />
                      <span>Demo controls</span>
                    </SidebarMenuButton>
                  }
                />
              </SidebarMenuItem>
            </SidebarMenu>
          </SidebarGroupContent>
        </SidebarGroup>
      </SidebarContent>
      <SidebarRail />
    </Sidebar>
  );
}
