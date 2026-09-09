/**
 * Listening benchmark V2 — the session that proves its own sensitivity
 * (Wave Q — PR-72).
 *
 * The decision-pack rule (§15.6, "still missing" item 9): a quality test may
 * serve as a training gate only after it proves it can detect known quality
 * differences. A V2 session therefore carries **positive controls** — a human
 * part against degraded copies of itself at graded strengths — beside the
 * calibration pair (HUMAN vs REFERENCE) and the two platform comparisons
 * (HUMAN vs CA2+CTX, CA2+CTX vs REFERENCE). The controls are what
 * `listeningSensitivity.ts` reads; the rest is what the session is for once
 * the gate is open.
 *
 * Composition, stated in advance for a 50-pair sitting (scaled by largest
 * remainder for 40–60):
 *
 *   pitch_shift 60 %   10   the strongest rung: the gate needs ≥ 90 % detection here
 *   pitch_shift 30 %   10   the moderate rung: above chance with p < 0.05
 *   pitch_shift 10 %    4   where a listener stops hearing it
 *   onset_jitter 30 %   3   timing damage
 *   note_deletion 50 %  3   missing notes
 *   random_pitch 30 %   3   wrong notes
 *   HUMAN vs REFERENCE  8   the calibration pair (5–5 in PR-71)
 *   HUMAN vs CA2+CTX    5
 *   CA2+CTX vs REF      4
 *
 * The rater sees none of this: the same "Part n of N · family" line, two
 * token-addressed players, the same primary question. Control ids, strengths
 * and window kinds live in owner-only columns, and `raterLeakProbes` lists
 * every string the leak test must fail to find.
 */
import { CONTROL_COMPARISON_TYPES, DEGRADED_PREFIX, DEGRADATION_LADDER, degradedProviderId, strengthPercent } from "./listeningDegradations";
import { LISTENING_RENDERER_V2 } from "./listeningRendererV2";
import { COMPARISON_TYPES, selectTournamentPairs, type AnyComparisonType, type SelectedPair, type SelectedSide, type TournamentReportLike } from "./tournamentListening";
import { CA2_CONTEXT_SUT, CA2_SUT, CONTEXT_AWARE_SUT, HUMAN_SUT, REFERENCE_SUT } from "./tournamentProviders";

export const LISTENING_BENCHMARK_V2_VERSION = "2.0" as const;

/** Weights per comparison id for a 50-pair sitting. */
export const V2_COMPOSITION_WEIGHTS: Readonly<Record<string, number>> = {
  human_vs_degraded_pitch_shift_60: 10,
  human_vs_degraded_pitch_shift_30: 10,
  human_vs_degraded_pitch_shift_10: 4,
  human_vs_degraded_onset_jitter_30: 3,
  human_vs_degraded_note_deletion_50: 3,
  human_vs_degraded_random_pitch_30: 3,
  human_vs_reference: 8,
  human_vs_ca2ctx: 5,
  ca2ctx_vs_reference: 4,
};

/** The comparison types a V2 session draws, in weight order. */
export const V2_COMPARISON_TYPES: readonly AnyComparisonType[] = [
  ...CONTROL_COMPARISON_TYPES,
  ...COMPARISON_TYPES.filter((t) => t.id === "human_vs_reference" || t.id === "human_vs_ca2ctx" || t.id === "ca2ctx_vs_reference"),
];

/** Largest-remainder allocation of `size` pairs over the weights. Deterministic; sums to `size`. */
export function v2Quotas(size: number, weights: Readonly<Record<string, number>> = V2_COMPOSITION_WEIGHTS): Record<string, number> {
  const ids = V2_COMPARISON_TYPES.map((t) => t.id);
  const total = ids.reduce((s, id) => s + (weights[id] ?? 0), 0) || 1;
  const exact = ids.map((id) => ((weights[id] ?? 0) * size) / total);
  const floors = exact.map((x) => Math.floor(x));
  let remainder = size - floors.reduce((s, x) => s + x, 0);
  const order = ids.map((_, i) => i).sort((a, b) => (exact[b] - floors[b]) - (exact[a] - floors[a]) || a - b);
  for (const i of order) { if (remainder <= 0) break; floors[i] += 1; remainder -= 1; }
  return Object.fromEntries(ids.map((id, i) => [id, floors[i]]));
}

export type WindowKind = "bars8" | "bars16" | "section";

/** A V2 report task: the tournament task fields plus how long the passage is and which arms could run at that length. */
export type V2TaskLike = {
  id: string;
  targetFamily: string;
  targetInst: number;
  windowKind: WindowKind;
  windowBars: number;
  /** Complete sections only; never a shorter window presented as one. */
  section?: { label: string; startBar: number; endBar: number } | null;
  /** Arms that could not run at this length, with the reason. */
  armsNotRun?: Array<{ providerId: string; reason: string }>;
};

export type V2ReportLike = Omit<TournamentReportLike, "tasks"> & { tasks: Array<TournamentReportLike["tasks"][number] & V2TaskLike> };

export type V2Selection = ReturnType<typeof selectTournamentPairs> & {
  quotas: Record<string, number>;
  byWindowKind: Record<string, number>;
  byComparisonAndWindowKind: Array<{ comparison: string; windowKind: string; pairs: number }>;
};

/**
 * Draw a V2 session from a V2 report. Same balanced cell walk as the
 * tournament draw, over the V2 comparison types with the stated quotas; the
 * report's own tasks decide which window kinds a comparison can use (a CA2
 * comparison only draws tasks where CA2 ran).
 */
export function selectBenchmarkV2Pairs(
  report: V2ReportLike,
  options: { size?: number; salt?: string; isDistinct?: (a: SelectedSide, b: SelectedSide) => boolean; weights?: Readonly<Record<string, number>> } = {},
): V2Selection {
  const size = Math.max(10, Math.min(60, options.size ?? 50));
  const quotas = v2Quotas(size, options.weights);
  const drawn = selectTournamentPairs(report, { size, salt: options.salt, isDistinct: options.isDistinct, types: V2_COMPARISON_TYPES, quotas });
  const kindOf = new Map(report.tasks.map((t) => [t.id, t.windowKind]));
  const byWindowKind: Record<string, number> = {};
  const cross = new Map<string, number>();
  for (const pair of drawn.pairs) {
    const kind = kindOf.get(pair.taskId) ?? "bars8";
    byWindowKind[kind] = (byWindowKind[kind] ?? 0) + 1;
    const key = `${pair.comparison}|${kind}`;
    cross.set(key, (cross.get(key) ?? 0) + 1);
  }
  return {
    ...drawn,
    quotas,
    byWindowKind,
    byComparisonAndWindowKind: [...cross.entries()].map(([key, pairs]) => {
      const [comparison, windowKind] = key.split("|");
      return { comparison, windowKind, pairs };
    }).sort((a, b) => a.comparison.localeCompare(b.comparison) || a.windowKind.localeCompare(b.windowKind)),
  };
}

/**
 * Every string a rater must never receive: arm names, control ids and
 * prefixes, degradation kinds, strengths as they are spelled in ids, window
 * kinds, the renderer, task ids and seeds. The leak test in
 * `listeningBenchmarkV2.test.ts` and the live probe in the evidence both read
 * this list, so a new secret is added in one place.
 */
export function raterLeakProbes(): string[] {
  return [
    HUMAN_SUT, REFERENCE_SUT, CONTEXT_AWARE_SUT, CA2_SUT, CA2_CONTEXT_SUT,
    DEGRADED_PREFIX, "degraded", "control",
    ...DEGRADATION_LADDER.map((r) => r.kind),
    ...DEGRADATION_LADDER.map((r) => degradedProviderId(r)),
    ...DEGRADATION_LADDER.map((r) => `_${strengthPercent(r.strength)}`),
    "strength", "pitch_shift", "jitter", "deletion", "random",
    "bars16", "section", "windowKind",
    LISTENING_RENDERER_V2, "REFERENCE_SYNTH", "renderer",
    "taskId", "seed", "/exports/", "comparison", "meta",
  ];
}

/** The sides a V2 session stores beside the tournament block: which renderer, which composition, which window kinds. */
export type V2SessionExtras = {
  benchmarkVersion: typeof LISTENING_BENCHMARK_V2_VERSION;
  renderer: string;
  rendererVersion: string;
  quotas: Record<string, number>;
  byWindowKind: Record<string, number>;
  contextIdentity: { pairsChecked: number; identical: boolean };
};

export function isV2Pair(pair: SelectedPair): boolean {
  return V2_COMPARISON_TYPES.some((t) => t.id === pair.comparison);
}
