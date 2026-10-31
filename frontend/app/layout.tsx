import type { Metadata } from "next";
import { cookies } from "next/headers";
import { GeistSans } from "geist/font/sans";
import { GeistMono } from "geist/font/mono";
import { SidebarInset, SidebarProvider } from "@/components/ui/sidebar";
import Providers from "@/components/app-shell/providers";
import AppSidebar from "@/components/app-shell/app-sidebar";
import AppHeader from "@/components/app-shell/app-header";
import KpiStrip from "@/components/app-shell/kpi-strip";
import "./globals.css";

export const metadata: Metadata = { title: "Resolv cockpit" };

// Server layout; the shell leaves are client components (D16: pages poll the API themselves).
export default async function RootLayout({ children }: { children: React.ReactNode }) {
  // shadcn writes the sidebar_state cookie; reading it here avoids a flash of the wrong state on reload.
  const defaultOpen = (await cookies()).get("sidebar_state")?.value !== "false";
  return (
    <html lang="en" className={`${GeistSans.variable} ${GeistMono.variable}`} suppressHydrationWarning>
      <body className="antialiased">
        <Providers>
          <SidebarProvider defaultOpen={defaultOpen}>
            <AppSidebar />
            <SidebarInset className="min-w-0">
              <div className="flex min-h-svh min-w-0 flex-col">
                <AppHeader />
                <div className="flex flex-col gap-6 p-6">
                  <KpiStrip />
                  {children}
                </div>
              </div>
            </SidebarInset>
          </SidebarProvider>
        </Providers>
      </body>
    </html>
  );
}
