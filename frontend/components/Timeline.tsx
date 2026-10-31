'use client';
import { useState } from "react";
import type { AuditEvent } from "@/lib/api";
import TimelineEvent, { str } from "./TimelineEvent";

const MAX_STAGGER = 12;

// API order is ascending (newest last). reply_sent carries no text, so it shows the latest
// preceding decision's customer_reply_draft. Ids present on mount stagger in (first 12 only);
// ids that arrive later through polling get the "fresh" slide-in highlight.
export default function Timeline({ events }: { events: AuditEvent[] }) {
  const [initial] = useState(() => new Set(events.map((e) => e.id)));
  let draft: string | undefined;
  return (
    <ol data-testid="timeline" className="relative flex flex-col before:absolute before:top-4 before:bottom-4 before:left-4 before:w-px before:-translate-x-1/2 before:bg-border">
      {events.map((e, i) => {
        if (e.kind === "decision") draft = str(e.payload.customer_reply_draft) ?? draft;
        const fresh = !initial.has(e.id);
        return (
          <TimelineEvent
            key={e.id}
            e={e}
            replyDraft={e.kind === "reply_sent" ? draft : undefined}
            fresh={fresh}
            enter={!fresh && i < MAX_STAGGER ? i : undefined}
          />
        );
      })}
    </ol>
  );
}
