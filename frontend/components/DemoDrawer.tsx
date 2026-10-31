'use client';
import { useState } from "react";
import { useSWRConfig } from "swr";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Separator } from "@/components/ui/separator";
import { Spinner } from "@/components/ui/spinner";
import { Drawer, DrawerContent, DrawerDescription, DrawerHeader, DrawerTitle, DrawerTrigger } from "@/components/ui/drawer";
import { demoReset, demoSeed, demoSpike, demoTicket } from "@/lib/api";
import { cn } from "@/lib/utils";

const SCENARIOS = ["d1_failed_upi", "d3_over_limit", "hinglish_refund_status", "merchant_settlement", "kyc_rejected", "mandate_email", "dispute"];
const BANKS = ["AXIS", "HDFC", "ICICI", "SBI"];
// Native <select> styled like Input: verify recipes drive these with select_option.
const select = "h-9 w-full min-w-0 rounded-lg border border-input bg-background px-2.5 text-sm outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50 dark:bg-input/30";

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="flex min-w-0 flex-col gap-2">
      <h3 className="text-sm font-medium text-muted-foreground">{title}</h3>
      {children}
    </section>
  );
}

// Demo controls in a shadcn Drawer (bottom sheet) opened from the sidebar (user, 31 Oct): nothing docks on the page.
export default function DemoDrawer({ trigger }: { trigger: React.ReactNode }) {
  const { mutate } = useSWRConfig();
  const [scenario, setScenario] = useState(SCENARIOS[0]);
  const [bank, setBank] = useState("AXIS");
  const [count, setCount] = useState(120);
  const [msg, setMsg] = useState("Ready.");
  const [busy, setBusy] = useState<string | null>(null);

  // (decision: T24A, UI-1) sonner toast.custom keeps one data-testid="toast" per visible toast.
  function notify(text: string, err = false) {
    toast.custom(() => (
      <div
        data-testid="toast"
        role="status"
        className={cn(
          "w-(--width) rounded-lg border bg-popover px-4 py-3 text-sm font-medium text-popover-foreground shadow-lg",
          err && "border-destructive/40 text-destructive",
        )}
      >
        {text}
      </div>
    ), { duration: 4000 });
  }

  // Runs one action, shows a one-line result, refreshes every /api/tickets key.
  async function run(label: string, fn: () => Promise<string>) {
    setBusy(label);
    try {
      const r = await fn();
      setMsg(`${label}: ${r}`);
      notify(r);
    } catch (e) {
      const m = `${label} failed: ${e instanceof Error ? e.message : String(e)}`;
      setMsg(m);
      notify(m, true);
    } finally {
      setBusy(null);
      void mutate((k) => typeof k === "string" && k.startsWith("/api/tickets"));
    }
  }

  const action = (label: string, testid: string, text: string, fn: () => Promise<string>, className?: string) => (
    <Button data-testid={testid} disabled={busy !== null} className={className} onClick={() => run(label, fn)}>
      {busy === label && <Spinner data-icon="inline-start" />}
      {text}
    </Button>
  );

  return (
    <Drawer>
      <DrawerTrigger asChild>{trigger}</DrawerTrigger>
      <DrawerContent data-testid="demo-drawer">
        <div className="mx-auto flex w-full max-w-4xl flex-col gap-4 px-4 pb-6">
        <DrawerHeader className="px-0">
          <DrawerTitle>Demo controls</DrawerTitle>
          <DrawerDescription>Reset data, inject a scenario or fire a spike. Results update the queue live.</DrawerDescription>
        </DrawerHeader>
      <div className="grid gap-4 md:grid-cols-3">
        <Section title="Data">
          <div className="grid grid-cols-2 gap-2">
            {action("Reset", "demo-reset", "Reset", async () => ((await demoReset()).ok ? "Reset done" : "not ok"))}
            {action("Seed", "demo-seed", "Seed", async () => `Seeded ${(await demoSeed()).kb_docs} KB docs`)}
          </div>
        </Section>
        <Section title="Scenario">
          <Label htmlFor="demo-scenario" className="sr-only">Scenario</Label>
          <select id="demo-scenario" data-testid="demo-scenario-select" value={scenario} onChange={(e) => setScenario(e.target.value)} className={cn(select, "font-mono")}>
            {SCENARIOS.map((s) => <option key={s} value={s}>{s}</option>)}
          </select>
          {action("Scenario", "demo-inject-scenario", "Inject", async () => `Created ${(await demoTicket(scenario)).id}`)}
        </Section>
        <Section title="Spike">
          <div className="flex gap-2">
            <Label htmlFor="demo-bank" className="sr-only">Issuer bank</Label>
            <select id="demo-bank" data-testid="demo-spike-bank" value={bank} onChange={(e) => setBank(e.target.value)} className={select}>
              {BANKS.map((b) => <option key={b} value={b}>{b}</option>)}
            </select>
            <Label htmlFor="demo-count" className="sr-only">Ticket count</Label>
            <Input id="demo-count" data-testid="demo-spike-count" type="number" min={1} value={count} onChange={(e) => setCount(Number(e.target.value))} className="h-9 w-24 shrink-0 font-mono tabular-nums" />
          </div>
          {action("Spike", "demo-inject-spike", "Inject spike", async () => `Spike: ${(await demoSpike({ issuer_bank: bank, count, minutes: 20 })).created} tickets`)}
        </Section>
      </div>
      <Separator />
      <p data-testid="demo-status" className="text-sm font-medium" aria-live="polite">{msg}</p>
        </div>
      </DrawerContent>
    </Drawer>
  );
}
