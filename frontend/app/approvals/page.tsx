'use client';
import { useState } from "react";
import ApprovalCard from "@/components/ApprovalCard";
import { decideApproval, useApprovals, type ApprovalItem } from "@/lib/api";

export default function Approvals() {
  const { data, error, mutate } = useApprovals("PENDING");
  const [errors, setErrors] = useState<Record<string, string>>({});

  // Optimistic removal; restore the list if the POST fails (card shows the error).
  async function onDecide(item: ApprovalItem, approve: boolean, note: string, by: string) {
    const prev = data ?? [];
    setErrors((x) => ({ ...x, [item.id]: "" }));
    await mutate(prev.filter((a) => a.id !== item.id), { revalidate: false });
    try {
      await decideApproval(item.id, { approve, note: note || null, decided_by: by });
    } catch (e) {
      await mutate(prev, { revalidate: false });
      setErrors((x) => ({ ...x, [item.id]: e instanceof Error ? e.message : "Decision failed." }));
    }
  }

  return (
    <>
      <h1 className="mb-4 text-3xl font-bold text-navy">Approvals{data ? ` (${data.length})` : ""}</h1>
      {!data ? (
        <p className="text-lg text-ink/60">{error ? "Backend unreachable." : "Loading..."}</p>
      ) : data.length === 0 ? (
        <p data-testid="approvals-empty" className="text-2xl text-ink/60">No approvals pending</p>
      ) : (
        <div className="space-y-6">
          {data.map((a) => <ApprovalCard key={a.id} item={a} onDecide={onDecide} error={errors[a.id] || undefined} />)}
        </div>
      )}
    </>
  );
}
