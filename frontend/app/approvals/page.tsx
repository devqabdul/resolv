'use client';
import { useEffect, useState } from "react";
import { AnimatePresence, motion, useReducedMotion } from "motion/react";
import { toast } from "sonner";
import { CheckCircleIcon } from "@phosphor-icons/react";
import ApprovalCard from "@/components/ApprovalCard";
import AnimatedNumber from "@/components/animated-number";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Empty, EmptyDescription, EmptyHeader, EmptyMedia, EmptyTitle } from "@/components/ui/empty";
import { Skeleton } from "@/components/ui/skeleton";
import { decideApproval, useApprovals, type ApprovalItem } from "@/lib/api";

const EASE = [0.16, 1, 0.3, 1] as const;

function CardSkeleton() {
  return (
    <div className="flex flex-col gap-4 rounded-xl p-4 ring-1 ring-foreground/10">
      <Skeleton className="h-5 w-2/3" />
      <Skeleton className="h-4 w-full" />
      <Skeleton className="h-16 w-full" />
      <Skeleton className="h-9 w-48" />
    </div>
  );
}

export default function Approvals() {
  const { data, error, mutate } = useApprovals("PENDING");
  const reduce = useReducedMotion();
  const [dir, setDir] = useState(1); // exit direction: 1 = right (approve), -1 = left (reject)
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 5000);
    return () => clearInterval(t);
  }, []);

  // Optimistic removal; restore the list if the POST fails.
  async function onDecide(item: ApprovalItem, approve: boolean, note: string, by: string) {
    const prev = data ?? [];
    setDir(approve ? 1 : -1);
    await mutate(prev.filter((a) => a.id !== item.id), { revalidate: false });
    try {
      await decideApproval(item.id, { approve, note: note || null, decided_by: by });
      toast.success(`${approve ? "Approved" : "Rejected"} ${item.ticket_id}`);
    } catch (e) {
      await mutate(prev, { revalidate: false });
      toast.error(e instanceof Error ? e.message : "Decision failed.");
    }
  }

  const sorted = data ? [...data].sort((a, b) => b.requested_at.localeCompare(a.requested_at)) : null;

  return (
    <div className="flex max-w-4xl flex-col gap-4">
      {!sorted ? (
        error ? (
          <Alert variant="destructive"><AlertDescription>Backend unreachable.</AlertDescription></Alert>
        ) : (
          <>
            <CardSkeleton />
            <CardSkeleton />
          </>
        )
      ) : sorted.length === 0 ? (
        <Empty data-testid="approvals-empty">
          <EmptyHeader>
            <EmptyMedia variant="icon"><CheckCircleIcon /></EmptyMedia>
            <EmptyTitle>No approvals pending</EmptyTitle>
            <EmptyDescription>Money actions above the auto limit appear here.</EmptyDescription>
          </EmptyHeader>
        </Empty>
      ) : (
        <>
          <p className="text-muted-foreground">
            <span className="font-mono tabular-nums text-foreground"><AnimatedNumber value={sorted.length} /></span> pending
          </p>
          <AnimatePresence custom={dir} initial={false}>
            {sorted.map((a) => (
              <motion.div
                key={a.id}
                layout={!reduce}
                custom={dir}
                variants={{
                  in: { opacity: 1, x: 0 },
                  out: (d: number) => ({ opacity: 0, x: reduce ? 0 : d * 16 }),
                }}
                initial={reduce ? false : { opacity: 0 }}
                animate="in"
                exit="out"
                transition={reduce ? { duration: 0 } : { duration: 0.22, ease: EASE }}
              >
                <ApprovalCard item={a} now={now} onDecide={onDecide} />
              </motion.div>
            ))}
          </AnimatePresence>
        </>
      )}
    </div>
  );
}
