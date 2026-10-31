'use client';
import type { AuditEvent } from "@/lib/api";
import TimelineEvent, { str } from "./TimelineEvent";

// API order is already ascending (newest last). reply_sent carries no text, so it shows the
// latest preceding decision's customer_reply_draft.
export default function Timeline({ events }: { events: AuditEvent[] }) {
  let draft: string | undefined;
  return (
    <ol data-testid="timeline" className="relative border-l-2 border-navy/20 pl-0">
      {events.map((e) => {
        if (e.kind === "decision") draft = str(e.payload.customer_reply_draft) ?? draft;
        return <TimelineEvent key={e.id} e={e} replyDraft={e.kind === "reply_sent" ? draft : undefined} />;
      })}
    </ol>
  );
}
