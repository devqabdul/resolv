import type { Metadata } from "next";
import { GeistSans } from "geist/font/sans";
import { GeistMono } from "geist/font/mono";
import { SidebarInset, SidebarProvider } from "@/components/ui/sidebar";
import Providers from "@/components/app-shell/providers";
import AppSidebar from "@/components/app-shell/app-sidebar";
import AppHeader from "@/components/app-shell/app-header";
import KpiStrip from "@/components/app-shell/kpi-strip";
import NotificationsRail from "@/components/app-shell/notifications-rail";
import "./globals.css";

export const metadata: Metadata = { title: "Resolv cockpit" };

// Server layout; the shell leaves are client components (D16: pages poll the API themselves).
export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className={`${GeistSans.variable} ${GeistMono.variable}`} suppressHydrationWarning>
      <body className="antialiased">
        <Providers>
          <SidebarProvider>
            <AppSidebar />
            <SidebarInset className="min-w-0">
              <div className="flex min-h-svh flex-col xl:flex-row">
                <div className="flex min-w-0 flex-1 flex-col">
                  <AppHeader />
                  <div className="flex flex-col gap-6 p-6">
                    <KpiStrip />
                    {children}
                  </div>
                </div>
                <NotificationsRail />
              </div>
            </SidebarInset>
          </SidebarProvider>
        </Providers>
      </body>
    </html>
  );
}
