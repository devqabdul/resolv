'use client';
import IncidentCard from "@/components/IncidentCard";
import { useIncidents } from "@/lib/api";

export default function Incidents() {
  const { data, error, mutate } = useIncidents();
  const open = data?.filter((i) => i.status === "OPEN").length ?? 0;
  return (
    <>
      <h1 className="mb-4 text-3xl font-bold text-navy">
        Incidents <span data-testid="incident-open-count" className="ml-2 text-xl text-ink/60">{open} open</span>
      </h1>
      {!data ? (
        <p className="text-lg text-ink/60">{error ? "Backend unreachable." : "Loading..."}</p>
      ) : data.length === 0 ? (
        <p className="text-lg text-ink/60">No incidents.</p>
      ) : (
        <div className="flex flex-col gap-5">
          {data.map((i) => <IncidentCard key={i.id} incident={i} onChanged={() => void mutate()} />)}
        </div>
      )}
    </>
  );
}
