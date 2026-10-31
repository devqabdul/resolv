'use client';
// One incident as a table row on /incidents; the whole row opens /incidents/<id>.
import Link from "next/link";
import { useRouter } from "next/navigation";
import { SirenIcon } from "@phosphor-icons/react";
import AnimatedNumber from "@/components/animated-number";
import { toneBadge, type Tone } from "@/components/status-tone";
import { Badge } from "@/components/ui/badge";
import { TableCell, TableRow } from "@/components/ui/table";
import type { Incident } from "@/lib/api";

export const INCIDENT_TONE: Record<Incident["status"], Tone> = { OPEN: "awaiting", COMMUNICATED: "processing", RESOLVED: "resolved" };

// signature = "<ticket_type>|<issuer_bank>|<failure_reason>" (CLAUDE.md decision 30 Oct).
export const sigParts = (sig: string) => {
  const [type, bank, reason] = sig.split("|");
  return { type: type || null, bank: bank || null, reason: reason || null };
};

export const fmtDate = (iso: string, year = false) =>
  new Date(iso).toLocaleString("en-IN", {
    day: "numeric", month: "short", ...(year && { year: "numeric" }), hour: "2-digit", minute: "2-digit", hour12: false,
  });

export function IncidentStatus({ status }: { status: Incident["status"] }) {
  return <Badge className={toneBadge({ tone: INCIDENT_TONE[status] })}>{status}</Badge>;
}

export default function IncidentCard({ incident: inc }: { incident: Incident }) {
  const router = useRouter();
  const href = `/incidents/${inc.id}`;
  return (
    <TableRow
      data-testid="incident-card"
      data-incident-id={inc.id}
      data-status={inc.status}
      onClick={() => router.push(href)}
      className="cursor-pointer hover:bg-muted/50"
    >
      <TableCell className="w-full max-w-0 min-w-48 px-2 py-3">
        <div className="flex items-start gap-3">
          <span className="mt-0.5 flex size-8 shrink-0 items-center justify-center rounded-md bg-status-failed/12 text-status-failed">
            <SirenIcon aria-hidden />
          </span>
          <div className="flex min-w-0 flex-col gap-0.5">
            <Link href={href} onClick={(e) => e.stopPropagation()} className="w-fit font-mono text-sm font-semibold hover:underline">
              {inc.id}
            </Link>
            <span data-testid="incident-title" className="truncate font-semibold">{inc.title}</span>
            <span data-testid="incident-signature" className="truncate font-mono text-sm text-muted-foreground">{inc.signature}</span>
          </div>
        </div>
      </TableCell>
      <TableCell className="px-2 font-mono text-sm whitespace-nowrap tabular-nums">{fmtDate(inc.first_seen)}</TableCell>
      <TableCell className="px-2 font-mono text-base font-semibold tabular-nums">
        <span data-testid="incident-ticket-count"><AnimatedNumber value={inc.ticket_count} /></span>
      </TableCell>
      <TableCell className="px-2">
        <Badge variant="outline" className="h-6 px-2.5 font-mono text-sm font-normal">{sigParts(inc.signature).type ?? "-"}</Badge>
      </TableCell>
      <TableCell className="px-2"><IncidentStatus status={inc.status} /></TableCell>
    </TableRow>
  );
}
