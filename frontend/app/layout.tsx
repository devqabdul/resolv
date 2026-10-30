'use client';
// Client layout: nav highlights the active link and the KPI strip polls /api/metrics (D16).
import Link from "next/link";
import { usePathname } from "next/navigation";
import KpiTile from "@/components/KpiTile";
import { useMetrics } from "@/lib/api";
import "./globals.css";

const NAV = [
  { href: "/", label: "Queue" },
  { href: "/approvals", label: "Approvals" },
  { href: "/incidents", label: "Incidents" },
  { href: "/evidence", label: "Evidence" },
];

function KpiStrip() {
  const { data: m } = useMetrics(); // undefined on 404 / network error -> dashes
  const v = (x: number | undefined, f: (n: number) => string = String) => (x === undefined ? "-" : f(x));
  return (
    <div data-testid="kpi-strip" className="flex flex-wrap gap-3 pb-4">
      <KpiTile id="auto_resolution_rate" label="Auto-resolved" value={v(m?.auto_resolution_rate, (n) => `${Math.round(n * 100)}%`)} />
      <KpiTile id="avg_first_response_sec" label="Avg first response" value={v(m?.avg_first_response_sec, (n) => `${Math.round(n)}s`)} />
      <KpiTile id="open" label="Open" value={v(m?.open)} />
      <KpiTile id="awaiting_approval" label="Awaiting approval" value={v(m?.awaiting_approval)} />
      <KpiTile id="incidents_open" label="Incidents open" value={v(m?.incidents_open)} />
    </div>
  );
}

export default function RootLayout({ children }: { children: React.ReactNode }) {
  const path = usePathname();
  return (
    <html lang="en">
      <head><title>Resolv cockpit</title></head>
      <body className="min-h-screen bg-light text-ink">
        <header className="bg-navy px-6 py-3 text-2xl font-bold text-white">
          Resolv <span className="text-cyan">cockpit</span>
        </header>
        <div className="flex">
          <nav className="w-48 shrink-0 bg-navy px-3 py-4 text-lg font-semibold text-white" style={{ minHeight: "calc(100vh - 3.5rem)" }}>
            {NAV.map((n) => {
              const active = n.href === "/" ? path === "/" : path.startsWith(n.href);
              return (
                <Link key={n.href} href={n.href} className={`mb-1 block rounded px-3 py-2 ${active ? "bg-cyan text-navy" : "hover:bg-white/10"}`}>
                  {n.label}
                </Link>
              );
            })}
          </nav>
          <main className="min-w-0 flex-1 p-6">
            <KpiStrip />
            {children}
          </main>
        </div>
      </body>
    </html>
  );
}
