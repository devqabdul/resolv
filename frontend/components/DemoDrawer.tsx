'use client';
import { useState } from "react";
import { useSWRConfig } from "swr";
import { demoReset, demoSeed, demoSpike, demoTicket } from "@/lib/api";

const SCENARIOS = ["d1_failed_upi", "d3_over_limit", "hinglish_refund_status", "merchant_settlement", "kyc_rejected", "mandate_email", "dispute"];
const BANKS = ["AXIS", "HDFC", "ICICI", "SBI"];
const btn = "rounded-lg bg-cyan px-4 py-3 text-lg font-bold text-navy disabled:opacity-50";
const field = "rounded-lg border border-navy/30 bg-white px-3 py-2 text-lg text-ink";

export default function DemoDrawer() {
  const { mutate } = useSWRConfig();
  const [scenario, setScenario] = useState(SCENARIOS[0]);
  const [bank, setBank] = useState("AXIS");
  const [count, setCount] = useState(120);
  const [msg, setMsg] = useState("Ready.");
  const [busy, setBusy] = useState(false);

  // Runs one action, shows a one-line result, refreshes every /api/tickets key.
  async function run(label: string, fn: () => Promise<string>) {
    setBusy(true);
    try {
      setMsg(`${label}: ${await fn()}`);
    } catch (e) {
      setMsg(`${label} failed: ${e instanceof Error ? e.message : String(e)}`);
    } finally {
      setBusy(false);
      void mutate((k) => typeof k === "string" && k.startsWith("/api/tickets"));
    }
  }

  return (
    <aside data-testid="demo-drawer" className="fixed right-0 top-0 z-50 flex h-full w-96 flex-col gap-5 overflow-y-auto bg-light shadow-2xl">
      <h2 className="bg-navy px-5 py-4 text-2xl font-bold text-white">Demo</h2>
      <div className="flex flex-col gap-5 px-5 pb-5">
        <div className="flex gap-3">
          <button data-testid="demo-reset" disabled={busy} className={btn} onClick={() => run("Reset", async () => ((await demoReset()).ok ? "done" : "not ok"))}>Reset</button>
          <button data-testid="demo-seed" disabled={busy} className={btn} onClick={() => run("Seed", async () => `${(await demoSeed()).kb_docs} kb docs`)}>Seed</button>
        </div>
        <div className="flex flex-col gap-2">
          <select data-testid="demo-scenario-select" value={scenario} onChange={(e) => setScenario(e.target.value)} className={field}>
            {SCENARIOS.map((s) => <option key={s} value={s}>{s}</option>)}
          </select>
          <button data-testid="demo-inject-scenario" disabled={busy} className={btn} onClick={() => run("Scenario", async () => `created ${(await demoTicket(scenario)).id}`)}>Inject scenario</button>
        </div>
        <div className="flex flex-col gap-2">
          <div className="flex gap-2">
            <select data-testid="demo-spike-bank" value={bank} onChange={(e) => setBank(e.target.value)} className={`${field} flex-1`}>
              {BANKS.map((b) => <option key={b} value={b}>{b}</option>)}
            </select>
            <input data-testid="demo-spike-count" type="number" min={1} value={count} onChange={(e) => setCount(Number(e.target.value))} className={`${field} w-28`} />
          </div>
          <button data-testid="demo-inject-spike" disabled={busy} className={btn} onClick={() => run("Spike", async () => `created ${(await demoSpike({ issuer_bank: bank, count, minutes: 20 })).created}`)}>Inject spike</button>
        </div>
        <p data-testid="demo-status" className="text-lg font-semibold text-ink">{msg}</p>
      </div>
    </aside>
  );
}
