'use client';
import { useState } from "react";
import { useSWRConfig } from "swr";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Spinner } from "@/components/ui/spinner";
import { Drawer, DrawerClose, DrawerContent, DrawerDescription, DrawerHeader, DrawerTitle, DrawerTrigger } from "@/components/ui/drawer";
import { ArrowClockwiseIcon, ChartLineUpIcon, CheckCircleIcon, DatabaseIcon, InfoIcon, ListBulletsIcon, PaperPlaneTiltIcon, PlayIcon, WarningCircleIcon, WaveformIcon, XIcon } from "@phosphor-icons/react";
import { demoReset, demoSeed, demoSpike, demoTicket } from "@/lib/api";
import { cn } from "@/lib/utils";

const SCENARIOS = [
  { id: "d1_failed_upi", text: "Creates a ticket for Riya - UPI payment failed (₹2,499, 3 days ago). Agent should resolve with ₹200 compensation." },
  { id: "d3_over_limit", text: "Creates a ticket for Arjun - UPI payment of ₹12,000 debited but not credited. Reversal is above the ₹5,000 auto limit, so it waits for human approval." },
  { id: "hinglish_refund_status", text: "Creates a Hinglish ticket from Riya asking about an earlier refund. Agent should reply with the refund status." },
  { id: "merchant_settlement", text: "Creates a ticket for merchant Chai Point - settlement on hold for KYC. Agent should re-trigger KYC." },
  { id: "kyc_rejected", text: "Creates a ticket for Meera - KYC rejected for address mismatch. Agent explains and asks for resubmission." },
  { id: "mandate_email", text: "Creates an email from Meera to cancel her Netflix mandate. Cancelling by email needs human approval." },
  { id: "dispute", text: "Creates a chargeback dispute. Agent routes it to the risk team with no money action." },
];
const BANKS = ["AXIS", "HDFC", "ICICI", "SBI"];
// Native <select> styled like Input: verify recipes drive these with select_option.
const select = "h-9 w-full min-w-0 rounded-lg border border-input bg-background px-2.5 text-sm outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50 dark:bg-input/30";
const TONES = {
  primary: "bg-primary/10 text-primary",
  info: "bg-status-processing/10 text-status-processing",
  ok: "bg-status-resolved/10 text-status-resolved",
  bad: "bg-status-failed/10 text-status-failed",
};

function Tile({ tone, children }: { tone: keyof typeof TONES; children: React.ReactNode }) {
  return <div className={cn("flex size-10 shrink-0 items-center justify-center rounded-lg text-xl", TONES[tone])}>{children}</div>;
}

function Panel({ tone, icon, title, text, children }: { tone: keyof typeof TONES; icon: React.ReactNode; title: string; text: string; children: React.ReactNode }) {
  return (
    <section className="flex min-w-0 flex-col gap-4 rounded-xl border bg-card p-4">
      <div className="flex items-start gap-3">
        <Tile tone={tone}>{icon}</Tile>
        <div className="flex flex-col gap-0.5">
          <h3 className="text-sm font-semibold">{title}</h3>
          <p className="text-sm text-muted-foreground">{text}</p>
        </div>
      </div>
      {children}
    </section>
  );
}

function Callout({ tone, icon, children }: { tone: keyof typeof TONES; icon: React.ReactNode; children: React.ReactNode }) {
  return (
    <div className={cn("flex items-start gap-2 rounded-lg p-3 text-sm text-muted-foreground", TONES[tone].split(" ")[0])}>
      <span className={cn("mt-0.5 shrink-0 text-base", TONES[tone].split(" ")[1])}>{icon}</span>
      <p>{children}</p>
    </div>
  );
}

// Demo controls in a shadcn Drawer (bottom sheet) opened from the sidebar (user, 31 Oct): nothing docks on the page.
export default function DemoDrawer({ trigger, open, onOpenChange }: { trigger: React.ReactNode; open?: boolean; onOpenChange?: (open: boolean) => void }) {
  const { mutate } = useSWRConfig();
  const [scenario, setScenario] = useState(SCENARIOS[0].id);
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

  const action = (label: string, testid: string, text: string, fn: () => Promise<string>, variant: "default" | "outline" = "default", icon?: React.ReactNode, className?: string) => (
    <Button data-testid={testid} variant={variant} size="lg" disabled={busy !== null} className={className} onClick={() => run(label, fn)}>
      {busy === label ? <Spinner data-icon="inline-start" /> : icon}
      {text}
    </Button>
  );

  const failed = msg.includes("failed") || msg === "not ok";
  const idle = msg === "Ready.";
  const sel = SCENARIOS.find((s) => s.id === scenario);

  return (
    <Drawer open={open} onOpenChange={onOpenChange}>
      <DrawerTrigger asChild>{trigger}</DrawerTrigger>
      <DrawerContent data-testid="demo-drawer">
        <div className="mx-auto flex w-full max-w-6xl flex-col gap-5 px-4 pb-6">
          <DrawerHeader className="flex-row items-start gap-3 px-0 text-left">
            <Tile tone="primary"><PlayIcon weight="fill" /></Tile>
            <div className="flex flex-1 flex-col gap-1">
              <DrawerTitle className="text-lg">Demo Controls</DrawerTitle>
              <DrawerDescription>Reset data, inject a scenario or fire a spike. Results update the queue live.</DrawerDescription>
            </div>
            <DrawerClose asChild>
              <Button variant="ghost" size="icon" aria-label="Close"><XIcon /></Button>
            </DrawerClose>
          </DrawerHeader>
          <div className="grid gap-4 md:grid-cols-3">
            <Panel tone="info" icon={<DatabaseIcon />} title="Data" text="Reset or seed the database with canonical demo data.">
              <div className="grid grid-cols-2 gap-3">
                <div className="flex flex-col gap-2">
                  {action("Reset", "demo-reset", "Reset", async () => ((await demoReset()).ok ? "Reset done" : "not ok"), "outline", <ArrowClockwiseIcon data-icon="inline-start" />)}
                  <p className="text-xs text-muted-foreground">Clear all data and start fresh</p>
                </div>
                <div className="flex flex-col gap-2">
                  {action("Seed", "demo-seed", "Seed", async () => `Seeded ${(await demoSeed()).kb_docs} KB docs`, "default", <DatabaseIcon data-icon="inline-start" />)}
                  <p className="text-xs text-muted-foreground">Load canonical demo scenarios</p>
                </div>
              </div>
            </Panel>
            <Panel tone="ok" icon={<ListBulletsIcon />} title="Inject a scenario" text="Add a single ticket from predefined scenarios.">
              <div className="flex flex-col gap-2">
                <Label htmlFor="demo-scenario">Scenario</Label>
                <select id="demo-scenario" data-testid="demo-scenario-select" value={scenario} onChange={(e) => setScenario(e.target.value)} className={cn(select, "font-mono")}>
                  {SCENARIOS.map((s) => <option key={s.id} value={s.id}>{s.id}</option>)}
                </select>
              </div>
              <Callout tone="info" icon={<InfoIcon />}>{sel?.text}</Callout>
              {action("Scenario", "demo-inject-scenario", "Inject", async () => `Created ${(await demoTicket(scenario)).id}`, "default", <PaperPlaneTiltIcon data-icon="inline-start" />, "w-full")}
            </Panel>
            <Panel tone="bad" icon={<ChartLineUpIcon />} title="Inject a spike" text="Create multiple tickets to simulate an issuer bank outage.">
              <div className="grid grid-cols-2 gap-3">
                <div className="flex flex-col gap-2">
                  <Label htmlFor="demo-bank">Issuer bank</Label>
                  <select id="demo-bank" data-testid="demo-spike-bank" value={bank} onChange={(e) => setBank(e.target.value)} className={select}>
                    {BANKS.map((b) => <option key={b} value={b}>{b}</option>)}
                  </select>
                </div>
                <div className="flex flex-col gap-2">
                  <Label htmlFor="demo-count">Number of tickets</Label>
                  <Input id="demo-count" data-testid="demo-spike-count" type="number" min={1} value={count} onChange={(e) => setCount(Number(e.target.value))} className="h-9 font-mono tabular-nums" />
                </div>
              </div>
              <Callout tone="bad" icon={<WaveformIcon />}>
                <span className="font-medium text-foreground">Spike scenario</span>
                <br />
                Creates {count} tickets for {bank} bank with UPI_SWITCH_DOWN failures within the last 60 minutes.
              </Callout>
              {action("Spike", "demo-inject-spike", "Inject spike", async () => `Spike: ${(await demoSpike({ issuer_bank: bank, count, minutes: 20 })).created} tickets`, "default", undefined, "w-full")}
            </Panel>
          </div>
          <div className={cn("flex items-center gap-3 rounded-lg px-4 py-3", failed ? TONES.bad : TONES.ok)}>
            {failed ? <WarningCircleIcon weight="fill" className="size-5 shrink-0 text-status-failed" /> : <CheckCircleIcon weight="fill" className="size-5 shrink-0 text-status-resolved" />}
            <div className="flex flex-col">
              <p data-testid="demo-status" className="text-sm font-semibold text-foreground" aria-live="polite">{msg}</p>
              {idle && <p className="text-sm text-muted-foreground">Use the controls above to generate demo data.</p>}
            </div>
          </div>
        </div>
      </DrawerContent>
    </Drawer>
  );
}
