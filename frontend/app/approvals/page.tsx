'use client';
import { useEffect, useState } from "react";
import { AnimatePresence, motion, useReducedMotion } from "motion/react";
import { toast } from "sonner";
import { CheckCircleIcon } from "@phosphor-icons/react";
import ApprovalCard from "@/components/ApprovalCard";
import { DecidedCard, RecentDecisions, Safeguards, StatCards, actionParts } from "@/components/approvals/parts";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Empty, EmptyDescription, EmptyHeader, EmptyMedia, EmptyTitle } from "@/components/ui/empty";
import { Skeleton } from "@/components/ui/skeleton";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { decideApproval, useApprovals, type ApprovalItem } from "@/lib/api";

const EASE = [0.16, 1, 0.3, 1] as const;

function CardSkeleton() {
  return (
    <div className="flex flex-col gap-4 rounded-xl p-4 ring-1 ring-foreground/10">
      <Skeleton className="h-5 w-1/3" />
      <div className="grid gap-4 lg:grid-cols-5">
        <Skeleton className="h-32 lg:col-span-3" />
        <Skeleton className="h-32 lg:col-span-2" />
      </div>
      <Skeleton className="h-24 w-full" />
      <Skeleton className="h-9 w-full" />
    </div>
  );
}

const byDecided = (a: ApprovalItem, b: ApprovalItem) => (b.decided_at ?? "").localeCompare(a.decided_at ?? "");

export default function Approvals() {
  const { data, error, mutate } = useApprovals("PENDING");
  const { data: approved, mutate: mutateApproved } = useApprovals("APPROVED");
  const { data: rejected, mutate: mutateRejected } = useApprovals("REJECTED");
  const reduce = useReducedMotion();
  const [tab, setTab] = useState("pending");
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
      void mutateApproved();
      void mutateRejected();
    } catch (e) {
      await mutate(prev, { revalidate: false });
      toast.error(e instanceof Error ? e.message : "Decision failed.");
    }
  }

  const sorted = data ? [...data].sort((a, b) => b.requested_at.localeCompare(a.requested_at)) : null;
  const approvedList = approved ? [...approved].sort(byDecided) : null;
  const rejectedList = rejected ? [...rejected].sort(byDecided) : null;
  const recent = approvedList && rejectedList ? [...approvedList, ...rejectedList].sort(byDecided).slice(0, 5) : null;
  const topTxn = sorted?.map((a) => actionParts(a.action_json)).find((p) => p.refKey === "txn_id")?.ref ?? null;
  const count = (l: ApprovalItem[] | null | undefined) => (l ? ` (${l.length})` : "");

  const decided = (list: ApprovalItem[] | null, empty: string) =>
    !list ? (
      <CardSkeleton />
    ) : list.length === 0 ? (
      <Empty>
        <EmptyHeader>
          <EmptyTitle>{empty}</EmptyTitle>
        </EmptyHeader>
      </Empty>
    ) : (
      list.map((a) => <DecidedCard key={a.id} item={a} />)
    );

  return (
    <div className="flex flex-col gap-6">
      <StatCards pending={data} approved={approved} rejected={rejected} now={now} />

      <div className="flex flex-col gap-1">
        <h2 className="text-2xl font-semibold tracking-tight">Human review required</h2>
        <p className="text-muted-foreground">Actions outside deterministic policy limits.</p>
      </div>

      <div className="grid items-start gap-6 xl:grid-cols-12">
        <Tabs value={tab} onValueChange={setTab} className="gap-4 xl:col-span-8">
          <TabsList variant="line">
            <TabsTrigger value="pending">Pending{count(sorted)}</TabsTrigger>
            <TabsTrigger value="approved">Approved{count(approvedList)}</TabsTrigger>
            <TabsTrigger value="rejected">Rejected{count(rejectedList)}</TabsTrigger>
          </TabsList>

          <TabsContent value="pending" className="flex flex-col gap-4">
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
                    <ApprovalCard item={a} onDecide={onDecide} />
                  </motion.div>
                ))}
              </AnimatePresence>
            )}
          </TabsContent>
          <TabsContent value="approved" className="flex flex-col gap-3">
            {decided(approvedList, "No approved actions yet")}
          </TabsContent>
          <TabsContent value="rejected" className="flex flex-col gap-3">
            {decided(rejectedList, "No rejected actions yet")}
          </TabsContent>
        </Tabs>

        <aside className="flex flex-col gap-4 xl:sticky xl:top-4 xl:col-span-4">
          <Safeguards txnRef={topTxn} />
          <RecentDecisions items={recent} now={now} onViewAll={() => setTab("approved")} />
        </aside>
      </div>
    </div>
  );
}
