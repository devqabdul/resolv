'use client';
import Markdown from "@/components/Markdown";
import { useEvalsReport } from "@/lib/api";

const pct = (x: number) => `${(x * 100).toFixed(1)}%`;

function Tile({ id, label, value, sub, tone = "text-navy" }: { id: string; label: string; value: string; sub?: string; tone?: string }) {
  return (
    <div className="min-w-40 flex-1 rounded-xl bg-white px-4 py-3 shadow-sm">
      <div className="text-sm font-semibold text-ink/60">{label}</div>
      <div data-testid={id} className={`text-3xl font-bold ${tone}`}>{value}</div>
      {sub && <div className="text-sm text-ink/60">{sub}</div>}
    </div>
  );
}

export default function EvidencePage() {
  const { data: r } = useEvalsReport(); // undefined on 404 / error -> empty state
  if (!r) {
    return (
      <div className="rounded-xl bg-white p-6 text-lg shadow-sm">
        <h1 className="text-2xl font-bold">Evidence</h1>
        <p className="mt-2">No eval report yet. Run <code className="rounded bg-light px-1">make evals</code> in the repo root, then reload.</p>
      </div>
    );
  }
  const j = r.json;
  const gateFull = j.gate_catch_core.caught === j.gate_catch_core.total;
  return (
    <div className="space-y-4">
      <h1 className="text-2xl font-bold">
        Evidence <span className="text-base font-normal text-ink/60">generated {r.generated_at} · mode {j.mode}</span>
      </h1>
      <div className="flex flex-wrap gap-3">
        <Tile id="evals-n" label="Labelled tickets (n)" value={String(j.n)} />
        <Tile id="evals-type-accuracy" label="Type accuracy" value={pct(j.type_accuracy)} />
        <Tile id="evals-resolve-precision" label="RESOLVE precision" value={pct(j.path_per_class.RESOLVE.precision)} />
        <Tile id="evals-false-action-rate" label="False-action rate" value={pct(j.false_action_rate)} tone={j.false_action_rate === 0 ? "text-green-600" : "text-amber-600"} />
        <Tile id="evals-gate-catch-rate" label="Gate catch (core)" value={`${j.gate_catch_core.caught}/${j.gate_catch_core.total}`} sub={`${j.gate_catch.caught}/${j.gate_catch.total} all`} tone={gateFull ? "text-green-600" : "text-amber-600"} />
        <Tile id="overrides-count" label="Human overrides" value={String(r.overrides_count)} />
      </div>
      <Markdown testId="evidence-report">{r.markdown}</Markdown>
    </div>
  );
}
