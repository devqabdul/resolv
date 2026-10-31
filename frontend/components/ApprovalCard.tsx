'use client';
import Link from "next/link";
import { useState } from "react";
import type { ApprovalItem } from "@/lib/api";
import PriorityBadge from "./PriorityBadge";
import TypeBadge from "./TypeBadge";

const inr = (n: number) => `₹${n.toLocaleString("en-IN")}`;

function actionLine(a: ApprovalItem["action_json"]): string {
  const p = (a.params ?? {}) as Record<string, unknown>;
  const parts = [String(a.name ?? "action")];
  if (typeof p.amount_inr === "number") parts.push(inr(p.amount_inr));
  const ref = ["txn_id", "settlement_id", "mandate_id", "kyc_id", "refund_id"].find((k) => typeof p[k] === "string");
  if (ref) parts.push(`on ${String(p[ref])}`);
  return parts.join(" ");
}

function reasonList(r: unknown): string[] {
  if (Array.isArray(r)) return r.map((x) => (typeof x === "string" ? x : JSON.stringify(x)));
  return r ? [typeof r === "string" ? r : JSON.stringify(r)] : [];
}

export default function ApprovalCard({
  item,
  onDecide,
  error,
}: {
  item: ApprovalItem;
  error?: string;
  onDecide: (item: ApprovalItem, approve: boolean, note: string, by: string) => Promise<void>;
}) {
  const [note, setNote] = useState("");
  const [by, setBy] = useState("");
  const [busy, setBusy] = useState(false);
  const [localErr, setErr] = useState<string | null>(null);
  const err = localErr ?? error ?? null;
  const t = item.ticket;

  async function go(approve: boolean) {
    if (!by.trim()) {
      setErr("Enter your name first.");
      return;
    }
    setBusy(true);
    setErr(null);
    // On success the card is removed optimistically; on failure the page re-adds it and shows `error`.
    await onDecide(item, approve, note.trim(), by.trim());
  }

  const btn = "rounded-lg px-6 py-3 text-xl font-bold disabled:opacity-50";
  return (
    <article data-testid="approval-card" data-approval-id={item.id} data-ticket-id={item.ticket_id} className="overflow-hidden rounded-xl bg-white shadow-sm">
      <header className="flex flex-wrap items-center gap-3 bg-navy px-5 py-3 text-white">
        <Link href={`/tickets/${item.ticket_id}`} className="text-2xl font-bold underline decoration-cyan">{item.ticket_id}</Link>
        <TypeBadge type={t?.ticket_type ?? null} />
        <PriorityBadge priority={t?.priority ?? null} />
        <span className="ml-auto rounded bg-amber-400 px-3 py-1 text-base font-bold text-ink">AWAITING APPROVAL</span>
      </header>
      <div className="space-y-4 p-5 text-lg text-ink">
        <p className="line-clamp-2 text-ink/70">{t?.masked_text}</p>
        <div data-testid="approval-action" className="rounded-lg bg-light px-4 py-3 font-mono text-2xl font-bold text-navy">{actionLine(item.action_json)}</div>
        <div>
          <h3 className="font-semibold text-navy">Gate reasons</h3>
          <ul data-testid="approval-reasons" className="list-disc pl-6">
            {reasonList(item.reasons_json).map((r, i) => <li key={i}>{r}</li>)}
          </ul>
        </div>
        <div>
          <h3 className="font-semibold text-navy">Resolv reasoning</h3>
          <p data-testid="approval-reasoning">{item.reasoning}</p>
        </div>
        {item.customer_reply_draft && (
          <blockquote className="border-l-4 border-cyan pl-4 italic text-ink/80">{item.customer_reply_draft}</blockquote>
        )}
        <div className="flex flex-wrap items-center gap-3">
          <input data-testid="approval-note" value={note} onChange={(e) => setNote(e.target.value)} placeholder="Note" className="min-w-48 flex-1 rounded-lg border border-navy/30 px-3 py-3 text-lg" />
          <input data-testid="approval-decided-by" required value={by} onChange={(e) => setBy(e.target.value)} placeholder="Your name" className="w-48 rounded-lg border border-navy/30 px-3 py-3 text-lg" />
          <button data-testid="approval-approve" disabled={busy} onClick={() => go(true)} className={`${btn} bg-cyan text-navy`}>Approve</button>
          <button data-testid="approval-reject" disabled={busy} onClick={() => go(false)} className={`${btn} border-2 border-navy text-navy`}>Reject</button>
        </div>
        {err && <p role="alert" className="text-base font-semibold text-red-600">{err}</p>}
      </div>
    </article>
  );
}
