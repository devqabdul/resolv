'use client';
import { Suspense } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import DemoDrawer from "@/components/DemoDrawer";
import { useLayoutState } from "@/components/app-shell/layout-state";
import TicketTable from "@/components/TicketTable";

// Demo drawer docks right on wide screens and sits above the table below 2xl, never over it.
function QueueBody() {
  const sp = useSearchParams();
  const router = useRouter();
  const pathname = usePathname();
  const incidentId = sp.get("incident_id") ?? undefined;
  const demo = sp.get("demo") === "1";
  const { demoOpen } = useLayoutState();
  const clearIncident = () => {
    const q = new URLSearchParams(sp);
    q.delete("incident_id");
    router.push(q.size ? `${pathname}?${q}` : pathname);
  };
  return (
    <div
      className={
        demo
          ? `grid gap-6 2xl:items-start ${demoOpen ? "2xl:grid-cols-[minmax(0,1fr)_18rem]" : "2xl:grid-cols-[minmax(0,1fr)_2.5rem]"}`
          : undefined
      }
    >
      <div className="min-w-0">
        <TicketTable incidentId={incidentId} onClearIncident={clearIncident} />
      </div>
      {demo && (
        <div className="order-first 2xl:sticky 2xl:top-20 2xl:order-none">
          <DemoDrawer />
        </div>
      )}
    </div>
  );
}

export default function Queue() {
  return (
    <Suspense fallback={null}>
      <QueueBody />
    </Suspense>
  );
}
