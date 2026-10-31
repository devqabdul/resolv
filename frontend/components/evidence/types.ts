// report.json carries more than lib/api.ts types; typed locally (api.ts is not ours to edit).
export type Miss = { id: string; expected_type: string; actual_type: string; expected_path: string; actual_path: string };
export type PerType = { n: number; type_accuracy: number; path_accuracy: number; correct?: number };
export type Extra = { misses?: Miss[]; per_type?: Record<string, PerType>; served_by?: Record<string, number> };

// Round half up to 1 decimal, like the report (Python round on the 4-dp ratio).
export const pct = (x: number) => Math.round(x * 1000) / 10;
export const pct1 = (x: number) => `${pct(x).toFixed(1)}%`;
export const f2 = (x: number) => x.toFixed(2);
