'use client';
import { useState } from "react";
import ToolCallGroup, { type ToolPair } from "@/components/ticket/ToolCallGroup";
import type { AuditEvent } from "@/lib/api";
import TimelineEvent, { str } from "./TimelineEvent";

const MAX_STAGGER = 12;
type Item = { kind: "event"; e: AuditEvent } | { kind: "tools"; pairs: ToolPair[] };

// Consecutive tool_call/tool_result events fold into one row; a result pairs with the
// preceding call of the same name.
function group(events: AuditEvent[]): Item[] {
  const items: Item[] = [];
  for (const e of events) {
    if (e.kind !== "tool_call" && e.kind !== "tool_result") { items.push({ kind: "event", e }); continue; }
    let last = items.at(-1);
    if (last?.kind !== "tools") items.push((last = { kind: "tools", pairs: [] }));
    const prev = last.pairs.at(-1);
    if (e.kind === "tool_result" && prev?.call && !prev.result && prev.call.payload.name === e.payload.name) prev.result = e;
    else last.pairs.push(e.kind === "tool_call" ? { call: e } : { result: e });
  }
  return items;
}

// API order is ascending (newest last). reply_sent carries no text, so it shows the latest
// preceding decision's customer_reply_draft. Rows present on mount stagger in (first 12 only);
// rows with an event that arrived later through polling get the "fresh" highlight.
export default function Timeline({ events, channel }: { events: AuditEvent[]; channel: string }) {
  const [initial] = useState(() => new Set(events.map((e) => e.id)));
  const items = group(events);
  let draft: string | undefined;
  let understood = false;
  return (
    <ol data-testid="timeline" className="flex flex-col">
      {items.map((it, i) => {
        const ids = it.kind === "event" ? [it.e.id] : it.pairs.flatMap((p) => [p.call?.id, p.result?.id]);
        const fresh = ids.some((id) => id && !initial.has(id));
        const enter = !fresh && i < MAX_STAGGER ? i : undefined;
        if (it.kind === "tools") {
          const first = it.pairs[0].call ?? it.pairs[0].result;
          return <ToolCallGroup key={first?.id ?? i} pairs={it.pairs} n={i + 1} beforeUnderstanding={!understood} enter={enter} fresh={fresh} />;
        }
        const e = it.e;
        if (e.kind === "understanding" || e.kind === "decision") understood = true;
        if (e.kind === "decision") draft = str(e.payload.customer_reply_draft) ?? draft;
        return (
          <TimelineEvent
            key={e.id}
            e={e}
            n={i + 1}
            channel={channel}
            replyDraft={e.kind === "reply_sent" ? draft : undefined}
            fresh={fresh}
            enter={enter}
          />
        );
      })}
    </ol>
  );
}
