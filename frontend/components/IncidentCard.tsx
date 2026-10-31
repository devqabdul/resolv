'use client';
import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { AnimatePresence, motion, useReducedMotion } from "motion/react";
import { SlackLogoIcon } from "@phosphor-icons/react";
import { toast } from "sonner";
import AnimatedNumber from "@/components/animated-number";
import { toneBadge, type Tone } from "@/components/status-tone";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardFooter, CardHeader, CardTitle } from "@/components/ui/card";
import { Field, FieldLabel } from "@/components/ui/field";
import { Spinner } from "@/components/ui/spinner";
import { Textarea } from "@/components/ui/textarea";
import { ago } from "@/lib/format";
import { cn } from "@/lib/utils";
import { notifyIncident, type Incident } from "@/lib/api";

const TONE: Record<Incident["status"], Tone> = { OPEN: "awaiting", COMMUNICATED: "processing", RESOLVED: "resolved" };
const clock = (iso: string) => new Date(iso).toLocaleTimeString([], { hour12: false });

export default function IncidentCard({ incident: inc, onChanged }: { incident: Incident; onChanged: () => void }) {
  const reduce = useReducedMotion();
  const [draft, setDraft] = useState(inc.proactive_notice_draft ?? ""); // seeded once; edits stay local
  const [busy, setBusy] = useState(false);
  const [now, setNow] = useState(() => Date.now());
  const [flash, setFlash] = useState(false);
  const prev = useRef(inc.status);

  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, []);

  // OPEN -> COMMUNICATED: highlight the border for 1 s.
  useEffect(() => {
    if (prev.current === "OPEN" && inc.status === "COMMUNICATED" && !reduce) {
      setFlash(true);
      const t = setTimeout(() => setFlash(false), 1000);
      prev.current = inc.status;
      return () => clearTimeout(t);
    }
    prev.current = inc.status;
  }, [inc.status, reduce]);

  async function send() {
    setBusy(true);
    try {
      await notifyIncident(inc.id);
      toast.success("Notice sent");
      onChanged();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }

  return (
    <motion.div initial={reduce ? false : { opacity: 0, scale: 0.98 }} animate={{ opacity: 1, scale: 1 }} transition={{ duration: 0.25, ease: [0.16, 1, 0.3, 1] }}>
      <Card
        data-testid="incident-card"
        data-incident-id={inc.id}
        data-status={inc.status}
        className={cn("transition-shadow duration-300", flash && "ring-2 ring-highlight")}
      >
        <CardHeader className="flex flex-row items-center justify-between gap-4">
          <div className="flex min-w-0 flex-col gap-1">
            <CardTitle data-testid="incident-title" className="text-xl">{inc.title}</CardTitle>
            <p className="text-sm text-muted-foreground">Owner {inc.owner_team ?? "unassigned"}</p>
          </div>
          <AnimatePresence mode="wait" initial={false}>
            <motion.span
              key={inc.status}
              initial={reduce ? false : { opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={reduce ? undefined : { opacity: 0 }}
              transition={{ duration: 0.2 }}
            >
              <Badge className={toneBadge({ tone: TONE[inc.status] })}>{inc.status}</Badge>
            </motion.span>
          </AnimatePresence>
        </CardHeader>
        <CardContent className="flex flex-col gap-6">
          <div className="flex flex-wrap items-end justify-between gap-4">
            <div className="flex flex-col gap-1">
              <p className="font-mono text-5xl font-semibold tabular-nums">
                <span data-testid="incident-ticket-count"><AnimatedNumber value={inc.ticket_count} /></span>
              </p>
              <p className="text-sm text-muted-foreground">tickets linked</p>
            </div>
            <div className="flex flex-col gap-1 text-right font-mono text-sm tabular-nums text-muted-foreground">
              <p data-testid="incident-signature" className="text-foreground">{inc.signature}</p>
              <p>First seen {ago(inc.first_seen, now)}</p>
              <p>Last seen {ago(inc.last_seen, now)}</p>
            </div>
          </div>
          <Field>
            <FieldLabel htmlFor={`notice-${inc.id}`}>Notice draft</FieldLabel>
            <Textarea id={`notice-${inc.id}`} data-testid="incident-notice-draft" rows={4} value={draft} onChange={(e) => setDraft(e.target.value)} />
          </Field>
          <p data-testid="incident-slack-status" className="flex items-center gap-2 font-mono text-sm tabular-nums">
            {inc.notified_at && <SlackLogoIcon aria-hidden />}
            {inc.notified_at ? `Notice sent at ${clock(inc.notified_at)}` : "Notice not sent"}
          </p>
        </CardContent>
        <CardFooter className="flex flex-wrap items-center gap-3">
          <Button data-testid="incident-notify" disabled={busy || inc.status !== "OPEN"} onClick={send}>
            {busy && <Spinner data-icon="inline-start" />}
            Send notice
          </Button>
          <Button variant="outline" asChild>
            <Link data-testid="incident-tickets-link" href={`/?incident_id=${inc.id}`}>Open linked tickets</Link>
          </Button>
        </CardFooter>
      </Card>
    </motion.div>
  );
}
