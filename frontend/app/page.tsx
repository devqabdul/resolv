'use client';
import { Suspense } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import TicketTable from "@/components/TicketTable";

function QueueBody() {
  const sp = useSearchParams();
  const router = useRouter();
  const pathname = usePathname();
  const incidentId = sp.get("incident_id") ?? undefined;
  const clearIncident = () => {
    const q = new URLSearchParams(sp);
    q.delete("incident_id");
    router.push(q.size ? `${pathname}?${q}` : pathname);
  };
  return (
    <div className="min-w-0">
      <TicketTable incidentId={incidentId} onClearIncident={clearIncident} />
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
