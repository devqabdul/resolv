'use client';
import { Suspense } from "react";
import { useSearchParams } from "next/navigation";
import DemoDrawer from "@/components/DemoDrawer";
import TicketTable from "@/components/TicketTable";

function QueueBody() {
  const sp = useSearchParams();
  const incidentId = sp.get("incident_id") ?? undefined;
  return (
    <>
      <h1 className="mb-4 text-3xl font-bold text-navy">
        Queue{incidentId && <span className="ml-3 font-mono text-xl text-ink/60">incident {incidentId}</span>}
      </h1>
      <TicketTable incidentId={incidentId} />
      {sp.get("demo") === "1" && <DemoDrawer />}
    </>
  );
}

export default function Queue() {
  return (
    <Suspense fallback={null}>
      <QueueBody />
    </Suspense>
  );
}
