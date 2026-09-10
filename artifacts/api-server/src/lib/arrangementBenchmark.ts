/**
 * Arrangement quality benchmark (PR-18; measure fixed in Brain B-08).
 *
 * "Without a benchmark you won't know whether you actually improved." Every
 * build runs the fixed corpus and records the same metrics, so a change can be
 * shown to help or hurt — and a new model has to *earn* its place rather than
 * become the default because it is new.
 *
 * Version 2.0 (B-08, evaluation audit §7.1) changes what is measured, not how
 * the run is shaped:
 *
 *  - `harmonyScore` is now computed on the **selected candidate's own notes**
 *    against the Song Model chords (`benchmarkMeasures.measureCandidateHarmony`).
 *    The 1.0 number was the critic's `harmony` dimension, which reads only the
 *    Song Model and was 58.33 for every composer; it is kept as
 *    `sourceHarmonyScore` so the old table stays readable.
 *  - `shippedCriticScore` is the critic run on the **performed** tracks the
 *    candidate returns — what ships — beside the orchestrator's own
 *    `criticScore`, which was computed before performance and after a repair
 *    loop whose plan edits are discarded. The gap between the two is the
 *    inflation the audit describes, now a number.
 *  - `sectionConsistency` (always 100) and `candidateDiversity` (always 50.4)
 *    are replaced by the coherence metric's `trajectorySmoothness`,
 *    `seamArtefacts`, `motifRecurrence` and by the production diversity gate's
 *    own `candidateDistance`; the old two survive one release as `legacy*`.
 *  - Every run pins the metric versions it was measured under; a comparison
 *    across different pins is refused, not averaged.
 *  - Since the hard-rule gate (B-00) the orchestrator may return
 *    `selected: null` — no candidate was shippable. That is a legitimate
 *    outcome and the benchmark reports it, never skips it: the case carries
 *    `unselectable: true` with the orchestrator's reason, its selected-candidate
 *    metrics are null (there is no best hard-rule-passing candidate to measure),
 *    `unselectableShare` (0 or 100 per case) enters the aggregate as a quality
 *    metric where lower is better, and `aggregateCases` says how many cases each
 *    mean was taken over. Files written before this field lack it; a comparison
 *    against such a file shows the row as unavailable rather than inventing a 0.
 *
 * Two halves:
 *  - automated metrics (this module's `runArrangementBenchmark`), and
 *  - blind human evaluation (`buildBlindComparisonSheet` + Elo), which the plan
 *    names as the top-level measure.
 */
import { createHash } from "node:crypto";
import type { SongModelData } from "@workspace/db";
import { BENCHMARK_CORPUS, buildBenchmarkSongModel, type BenchmarkCase } from "./benchmarkCorpus";
import {
  coherenceOfTracks,
  currentMetricVersions,
  meanCandidateDistance,
  measureCandidateHarmony,
  metricVersionMismatch,
  songModelChords,
  type MetricVersions,
} from "./benchmarkMeasures";
import { orchestrateArrangement, type OrchestrateInput, type OrchestrationResult } from "./arrangementOrchestrator";
import { critiqueArrangement } from "./musicCritic";

export const BENCHMARK_VERSION = "2.0" as const;
const METHOD = "arrangement-benchmark/v2";

export type BenchmarkTier = "S" | "H" | "P";

export type BenchmarkMetric =
  | "criticScore" | "shippedCriticScore" | "audioScore" | "playabilityErrors"
  | "harmonyScore" | "chordToneShare" | "clashShare" | "sourceHarmonyScore"
  | "trajectorySmoothness" | "seamArtefacts" | "motifRecurrence" | "candidateDistance"
  | "legacySectionConsistency" | "legacyCandidateDiversity"
  | "renderFailures" | "unselectableShare" | "noteCount" | "latencyMs";

export const BENCHMARK_METRICS: readonly BenchmarkMetric[] = [
  "criticScore", "shippedCriticScore", "audioScore", "playabilityErrors",
  "harmonyScore", "chordToneShare", "clashShare", "sourceHarmonyScore",
  "trajectorySmoothness", "seamArtefacts", "motifRecurrence", "candidateDistance",
  "legacySectionConsistency", "legacyCandidateDiversity",
  "renderFailures", "unselectableShare", "noteCount", "latencyMs",
];

/** What each metric is, in one line, so a reader of the JSON need not open this file. */
export const METRIC_NOTES: Record<BenchmarkMetric, string> = {
  criticScore: "the orchestrator's own critic score of the selected candidate (pre-performance notes, after the plan-only repair loop)",
  shippedCriticScore: "critiqueArrangement on the performed tracks the selected candidate returns — the notes that ship",
  audioScore: "audio critic on the reference-synth render; null when rendering is off",
  playabilityErrors: "constraint-engine errors summed over all candidates (composition + performance)",
  harmonyScore: "0..100 = 100 x (chordToneShare - clashShare) on the selected candidate's pitched tracks vs the Song Model chords",
  chordToneShare: "percent of pitched sounding time on a chord tone of the Song Model chords (selected candidate)",
  clashShare: "percent of pitched sounding time a semitone from another sounding pitched part (selected candidate); lower is better",
  sourceHarmonyScore: "1.0's harmonyScore: the critic's harmony dimension, a property of the Song Model, not of the arrangement (informational)",
  trajectorySmoothness: "coherence metric: register/density roughness inside sections + plan adherence (selected candidate)",
  seamArtefacts: "coherence metric: bar-line jumps at the 8-bar window grid beyond ordinary phrase structure (selected candidate)",
  motifRecurrence: "coherence metric: share of each section's melodic cells already heard earlier (selected candidate)",
  candidateDistance: "100 x mean pairwise candidateDiversity distance over the run's candidates (the production gate's own measure)",
  legacySectionConsistency: "1.0's sectionConsistency: planner novelty bookkeeping, 100 on every run (informational, one release)",
  legacyCandidateDiversity: "1.0's candidateDiversity: note-count spread, 50.4 on every run (informational, one release)",
  renderFailures: "candidates whose reference-synth render was infeasible; null when rendering is off",
  unselectableShare: "100 when no candidate passed the orchestrator's hard-rule gate (selected: null) or orchestration failed, else 0; the aggregate is the share of such cases in percent; lower is better",
  noteCount: "notes in the selected candidate (not a quality metric)",
  latencyMs: "wall time per case (not a quality metric)",
};

/** Metrics that decide promotion. The rest inform. */
export const QUALITY_METRICS: readonly BenchmarkMetric[] = [
  "criticScore", "shippedCriticScore", "audioScore", "playabilityErrors",
  "harmonyScore", "chordToneShare", "clashShare",
  "trajectorySmoothness", "seamArtefacts", "motifRecurrence", "candidateDistance",
  "renderFailures", "unselectableShare",
];

/** A metric the local run genuinely cannot measure is reported as null, not faked. */
export type BenchmarkCaseResult = {
  caseId: string;
  genre: string;
  inputType: string;
  metrics: Record<BenchmarkMetric, number | null>;
  selectedStrategy: string | null;
  feasible: boolean;
  /**
   * True when the orchestrator selected nothing — every candidate failed the
   * hard-rule gate (or orchestration threw). The selected-candidate metrics are
   * then null and `selectionReason` says why; the case still counts in
   * `unselectableShare`.
   */
  unselectable: boolean;
  /** The orchestrator's own `selection.reason` (why the winner won, or why nobody did). */
  selectionReason: string | null;
  /** The hard-rule gate's tally over the run's candidates. */
  hardRule: { eligible: number; rejected: number } | null;
  /** The critic's per-dimension scores on the shipped notes vs the orchestrator's, so a reader can see which dimensions move. */
  critique: {
    orchestrator: Record<string, number>;
    shipped: Record<string, number>;
  } | null;
  notes: string[];
};

/** A song the benchmark runs on: a synthesised spec (Tier S) or a prebuilt Song Model (Tier P / H). */
export type BenchmarkSong = {
  id: string;
  genre: string;
  inputType: string;
  songModel: SongModelData;
};

export type BenchmarkRun = {
  version: typeof BENCHMARK_VERSION;
  method: string;
  runId: string;
  startedAt: string;
  /** S = synthesised regression floor, P = the operator's own songs (per song), H = real works. Never mixed in one run. */
  tier: BenchmarkTier;
  corpusSize: number;
  corpusIds: string[];
  /** Identifies what produced the arrangements, e.g. a composer/model name. */
  systemUnderTest: string;
  /**
   * Whether the orchestrator rendered and audio-critiqued. Rendering changes
   * which candidate wins (the combined score weights audio 0.4), so a run with
   * rendering is compared only with another run with rendering.
   */
  render: boolean;
  /** The commit whose arrangement code was measured; null when not run from a checkout. */
  gitSha: string | null;
  /**
   * The checkout the run was taken from, when it differs from `gitSha` (a
   * measurement-only branch snapshotting the brain at its merge base records
   * the base as `gitSha` and its own HEAD here). Absent in older files.
   */
  headSha?: string | null;
  /** The metric versions the numbers were measured under. A comparison across different pins is refused. */
  metricVersions: MetricVersions;
  metricNotes: Record<BenchmarkMetric, string>;
  cases: BenchmarkCaseResult[];
  aggregate: Record<BenchmarkMetric, number | null>;
  /** How many cases each aggregate mean was taken over — an unselectable case contributes to `unselectableShare` and to nothing else. Absent in older files. */
  aggregateCases?: Record<BenchmarkMetric, number>;
  /** The cases where the orchestrator selected nothing, with its reasons. Absent in older files. */
  unselectable?: { count: number; caseIds: string[]; reasons: Record<string, string> };
  unavailableMetrics: string[];
};

// ---------------------------------------------------------------------------

const mean = (values: number[]): number | null =>
  values.length ? Number((values.reduce((a, b) => a + b, 0) / values.length).toFixed(2)) : null;

const r2 = (v: number | null): number | null => (v === null ? null : Number(v.toFixed(2)));

function legacySectionConsistency(result: OrchestrationResult): number {
  const targets = result.plan.globalPlan?.sectionTargets ?? [];
  if (targets.length < 2) return 0;
  const novelties = targets.slice(1).map((t) => t.noveltyVsPrevious);
  const healthy = novelties.filter((n) => n >= 0.1 && n <= 0.9).length;
  return Number(((healthy / novelties.length) * 100).toFixed(2));
}

function legacyCandidateDiversity(result: OrchestrationResult): number {
  const counts = result.candidates.map((c) => c.noteCount);
  if (counts.length < 2) return 0;
  const distinct = new Set(counts).size;
  const spread = (Math.max(...counts) - Math.min(...counts)) / Math.max(1, Math.max(...counts));
  return Number((((distinct / counts.length) * 0.5 + spread * 0.5) * 100).toFixed(2));
}

function sourceHarmonyScore(result: OrchestrationResult): number | null {
  const selected = result.candidates.find((c) => c.candidateId === result.selected?.candidateId);
  const dimension = selected?.critique.dimensions.find((d) => d.dimension === "harmony");
  return dimension ? dimension.score : null;
}

const nullMetrics = (latencyMs: number): Record<BenchmarkMetric, number | null> =>
  Object.fromEntries(BENCHMARK_METRICS.map((m) => [m, m === "latencyMs" ? latencyMs : m === "unselectableShare" ? 100 : null])) as Record<BenchmarkMetric, number | null>;

export function songsFromCorpus(corpus: readonly BenchmarkCase[]): BenchmarkSong[] {
  return corpus.map((spec) => ({ id: spec.id, genre: spec.genre, inputType: spec.inputType, songModel: buildBenchmarkSongModel(spec) }));
}

export function runArrangementBenchmark(options: {
  /** Tier S specs; the default corpus when neither `corpus` nor `songs` is given. */
  corpus?: BenchmarkCase[];
  /** Prebuilt Song Models (Tier P / H). Takes precedence over `corpus`. */
  songs?: BenchmarkSong[];
  tier?: BenchmarkTier;
  systemUnderTest?: string;
  candidateCount?: number;
  render?: boolean;
  orchestrate?: (input: OrchestrateInput) => OrchestrationResult;
  now?: Date;
  clock?: () => number;
  gitSha?: string | null;
  headSha?: string | null;
} = {}): BenchmarkRun {
  const songs = options.songs ?? songsFromCorpus(options.corpus ?? BENCHMARK_CORPUS);
  const tier: BenchmarkTier = options.tier ?? (options.songs ? "P" : "S");
  const orchestrate = options.orchestrate ?? orchestrateArrangement;
  const clock = options.clock ?? (() => Date.now());
  const now = options.now ?? new Date(0);
  const render = options.render ?? false;

  const cases: BenchmarkCaseResult[] = songs.map((song) => {
    const songModel = song.songModel;
    const started = clock();
    let result: OrchestrationResult | null = null;
    const notes: string[] = [];
    try {
      result = orchestrate({
        songModel,
        candidateCount: options.candidateCount ?? 5,
        render,
        renderOptions: { sampleRate: 24_000, bitDepth: 16 },
        now,
      });
    } catch (error) {
      notes.push(`orchestration failed: ${error instanceof Error ? error.message : "unknown"}`);
    }
    const latencyMs = clock() - started;

    if (!result) {
      return {
        caseId: song.id, genre: song.genre, inputType: song.inputType,
        metrics: nullMetrics(latencyMs),
        selectedStrategy: null, feasible: false,
        unselectable: true, selectionReason: notes[0] ?? "orchestration failed", hardRule: null,
        critique: null, notes,
      };
    }

    const selected = result.candidates.find((c) => c.candidateId === result!.selected?.candidateId);
    const unselectable = !selected;
    const selectionReason = result.selection?.reason ?? (selected ? null : "the orchestrator selected no candidate and gave no reason");
    if (unselectable) notes.push(`unselectable: ${selectionReason}`);
    const hardRule = {
      eligible: result.candidates.filter((c) => c.hardRule?.feasible !== false).length,
      rejected: result.candidates.filter((c) => c.hardRule?.feasible === false).length,
    };
    const renderFailures = render
      ? result.candidates.filter((c) => c.renderFeasible === false).length
      : null;
    if (!render) notes.push("rendering disabled for this run");

    // --- the measure on what ships --------------------------------------
    let shippedCritique: ReturnType<typeof critiqueArrangement> | null = null;
    let harmony: ReturnType<typeof measureCandidateHarmony> | null = null;
    let coherence: ReturnType<typeof coherenceOfTracks> = null;
    if (selected) {
      try {
        shippedCritique = critiqueArrangement({ songModel, plan: result.plan, trackModels: selected.trackModels });
      } catch (error) {
        notes.push(`shipped critique failed: ${error instanceof Error ? error.message : "unknown"}`);
      }
      harmony = measureCandidateHarmony(selected.trackModels, songModelChords(songModel));
      if (harmony.tracksMeasured === 0) notes.push("no pitched track in the selected candidate; harmony not measurable");
      try {
        coherence = coherenceOfTracks(selected.trackModels, songModel, result.plan);
      } catch (error) {
        notes.push(`coherence failed: ${error instanceof Error ? error.message : "unknown"}`);
      }
      if (!coherence) notes.push("coherence not measurable (no bar grid or no notes)");
      for (const limit of coherence?.limits ?? []) if (/not measurable|needs/.test(limit)) notes.push(`coherence: ${limit}`);
    }
    const distance = meanCandidateDistance(result.plan, result.candidates);

    const dims = (critique: { dimensions: Array<{ dimension: string; score: number }> } | null | undefined) =>
      Object.fromEntries((critique?.dimensions ?? []).map((d) => [d.dimension, d.score]));

    return {
      caseId: song.id,
      genre: song.genre,
      inputType: song.inputType,
      metrics: {
        criticScore: selected?.critique.overallScore ?? null,
        shippedCriticScore: shippedCritique?.overallScore ?? null,
        audioScore: selected?.audioCritique?.overallScore ?? null,
        playabilityErrors: result.candidates.reduce((sum, c) => sum + c.constraintErrors, 0),
        harmonyScore: harmony?.harmonyScore ?? null,
        chordToneShare: harmony?.chordToneShare === null || harmony?.chordToneShare === undefined ? null : r2(harmony.chordToneShare * 100),
        clashShare: harmony?.clashShare === null || harmony?.clashShare === undefined ? null : r2(harmony.clashShare * 100),
        sourceHarmonyScore: sourceHarmonyScore(result),
        trajectorySmoothness: coherence?.components.trajectorySmoothness.score ?? null,
        seamArtefacts: coherence?.components.seamArtefacts.score ?? null,
        motifRecurrence: coherence?.components.motifRecurrence.score ?? null,
        candidateDistance: distance === null ? null : r2(distance * 100),
        legacySectionConsistency: legacySectionConsistency(result),
        legacyCandidateDiversity: legacyCandidateDiversity(result),
        renderFailures,
        unselectableShare: unselectable ? 100 : 0,
        noteCount: selected?.noteCount ?? null,
        latencyMs,
      },
      selectedStrategy: selected?.strategy ?? null,
      feasible: selected?.critique.feasible ?? false,
      unselectable,
      selectionReason,
      hardRule,
      critique: selected ? { orchestrator: dims(selected.critique), shipped: dims(shippedCritique) } : null,
      notes,
    };
  });

  const aggregate = Object.fromEntries(
    BENCHMARK_METRICS.map((name) => [
      name,
      mean(cases.map((c) => c.metrics[name]).filter((v): v is number => v !== null)),
    ]),
  ) as Record<BenchmarkMetric, number | null>;
  const aggregateCases = Object.fromEntries(
    BENCHMARK_METRICS.map((name) => [name, cases.filter((c) => c.metrics[name] !== null).length]),
  ) as Record<BenchmarkMetric, number>;
  const unselectableCases = cases.filter((c) => c.unselectable);
  const unselectable = {
    count: unselectableCases.length,
    caseIds: unselectableCases.map((c) => c.caseId),
    reasons: Object.fromEntries(unselectableCases.map((c) => [c.caseId, c.selectionReason ?? "no reason given"])),
  };

  const unavailableMetrics = [
    "analysisAccuracy (needs a labelled analysis set and live providers)",
    "gpuCost (no GPU worker in this run)",
    ...(render ? [] : ["audioScore / renderFailures (rendering disabled)"]),
  ];

  const corpusIds = songs.map((s) => s.id);
  return {
    version: BENCHMARK_VERSION,
    method: METHOD,
    runId: createHash("sha256")
      .update(`${BENCHMARK_VERSION}:${tier}:${corpusIds.join(",")}:${options.systemUnderTest ?? "default"}`)
      .digest("hex").slice(0, 12),
    startedAt: now.toISOString(),
    tier,
    corpusSize: songs.length,
    corpusIds,
    systemUnderTest: options.systemUnderTest ?? "REFERENCE_PIPELINE",
    render,
    gitSha: options.gitSha ?? null,
    headSha: options.headSha ?? null,
    metricVersions: currentMetricVersions(),
    metricNotes: METRIC_NOTES,
    cases,
    aggregate,
    aggregateCases,
    unselectable,
    unavailableMetrics,
  };
}

// ---------------------------------------------------------------------------
// Regression gate
// ---------------------------------------------------------------------------

/** Metrics where lower is better. */
const LOWER_IS_BETTER = new Set<BenchmarkMetric>([
  "playabilityErrors", "clashShare", "renderFailures", "unselectableShare", "latencyMs",
]);

export type BenchmarkComparison = {
  metric: BenchmarkMetric;
  baseline: number | null;
  candidate: number | null;
  delta: number | null;
  verdict: "improved" | "regressed" | "unchanged" | "unavailable";
  /** Whether this metric counts towards promotion. */
  quality: boolean;
};

export type BenchmarkVerdict = {
  /** False when the two runs were measured under different metric versions or tiers; nothing else is then meaningful. */
  comparable: boolean;
  incomparableReasons: string[];
  comparisons: BenchmarkComparison[];
  improved: BenchmarkMetric[];
  regressed: BenchmarkMetric[];
  /** The plan's rule: a new system must beat the incumbent, not merely differ. */
  beatsBaseline: boolean;
  outcome: "promote" | "do_not_promote" | "unchanged" | "incomparable";
  summary: string;
  /** The cases each run could not select a candidate for (empty for a file written before the field existed). */
  unselectable: { baseline: string[]; candidate: string[] };
};

export function compareBenchmarkRuns(
  baseline: BenchmarkRun,
  candidate: BenchmarkRun,
  options: { tolerance?: number } = {},
): BenchmarkVerdict {
  const tolerance = options.tolerance ?? 1;
  const incomparableReasons: string[] = [];
  if (baseline.version !== candidate.version) {
    incomparableReasons.push(`benchmark version ${baseline.version} vs ${candidate.version}`);
  }
  if (baseline.tier !== candidate.tier) {
    incomparableReasons.push(`tier ${baseline.tier} vs ${candidate.tier}: tiers are never compared with each other`);
  }
  if (Boolean(baseline.render) !== Boolean(candidate.render)) {
    incomparableReasons.push(`rendering ${baseline.render ? "on" : "off"} vs ${candidate.render ? "on" : "off"}: rendering changes which candidate is selected, so the two runs measured different arrangements`);
  }
  for (const line of metricVersionMismatch(baseline.metricVersions ?? ({} as MetricVersions), candidate.metricVersions ?? ({} as MetricVersions))) {
    incomparableReasons.push(`metric version changed — ${line}`);
  }
  const baselineIds = [...(baseline.corpusIds ?? [])].sort().join(",");
  const candidateIds = [...(candidate.corpusIds ?? [])].sort().join(",");
  if (baselineIds !== candidateIds) {
    incomparableReasons.push("the two runs were measured on different corpora");
  }

  // The union of both runs' metrics: a metric one file lacks (written before it
  // existed) is shown as unavailable, never silently dropped or read as 0.
  const metrics = [...new Set([...Object.keys(baseline.aggregate), ...Object.keys(candidate.aggregate)])] as BenchmarkMetric[];
  const comparisons: BenchmarkComparison[] = metrics.map((metric) => {
    const b = baseline.aggregate[metric];
    const c = candidate.aggregate[metric];
    const quality = QUALITY_METRICS.includes(metric);
    if (b === null || b === undefined || c === null || c === undefined) {
      return { metric, baseline: b ?? null, candidate: c ?? null, delta: null, verdict: "unavailable", quality };
    }
    const delta = Number((c - b).toFixed(2));
    const better = LOWER_IS_BETTER.has(metric) ? delta < -tolerance : delta > tolerance;
    const worse = LOWER_IS_BETTER.has(metric) ? delta > tolerance : delta < -tolerance;
    return {
      metric, baseline: b, candidate: c, delta,
      verdict: better ? "improved" : worse ? "regressed" : "unchanged",
      quality,
    };
  });

  const improved = comparisons.filter((c) => c.verdict === "improved").map((c) => c.metric);
  const regressed = comparisons.filter((c) => c.verdict === "regressed").map((c) => c.metric);
  // Musical quality is what decides; latency alone never promotes a system.
  const qualityImproved = improved.filter((m) => QUALITY_METRICS.includes(m));
  const qualityRegressed = regressed.filter((m) => QUALITY_METRICS.includes(m));
  const comparable = incomparableReasons.length === 0;
  const beatsBaseline = comparable && qualityImproved.length > 0 && qualityRegressed.length === 0;
  const outcome: BenchmarkVerdict["outcome"] = !comparable
    ? "incomparable"
    : beatsBaseline ? "promote" : qualityRegressed.length ? "do_not_promote" : "unchanged";
  const unselectable = {
    baseline: baseline.unselectable?.caseIds ?? baseline.cases?.filter((c) => c.unselectable).map((c) => c.caseId) ?? [],
    candidate: candidate.unselectable?.caseIds ?? candidate.cases?.filter((c) => c.unselectable).map((c) => c.caseId) ?? [],
  };
  const unselectableNote = unselectable.candidate.length
    ? `; ${unselectable.candidate.length} case(s) unselectable in the candidate (${unselectable.candidate.join(", ")})${unselectable.baseline.length ? ` vs ${unselectable.baseline.length} in the baseline` : ""}`
    : "";

  return {
    comparable, incomparableReasons, comparisons, improved, regressed, beatsBaseline, outcome,
    summary: !comparable
      ? `runs are not comparable: ${incomparableReasons.join("; ")}`
      : beatsBaseline
        ? `${candidate.systemUnderTest} beats ${baseline.systemUnderTest} on ${qualityImproved.join(", ")}${unselectableNote}`
        : qualityRegressed.length
          ? `${candidate.systemUnderTest} regresses ${qualityRegressed.join(", ")} — do not promote${unselectableNote}`
          : `${candidate.systemUnderTest} is not measurably better — unchanged within tolerance ${tolerance}${unselectableNote}`,
    unselectable,
  };
}

// ---------------------------------------------------------------------------
// Blind human evaluation
// ---------------------------------------------------------------------------

export type BlindPair = {
  pairId: string;
  caseId: string;
  /** Anonymised labels — the rater must not know which system made which. */
  left: { token: string; systemUnderTest: string };
  right: { token: string; systemUnderTest: string };
  questions: string[];
};

export const BLIND_QUESTIONS = [
  "Which arrangement sounds more professional?",
  "Which has better development?",
  "Which leaves more room for the singer?",
  "Which has better orchestration?",
  "Which sounds more human?",
  "Which would you release?",
];

/** Anonymised A/B sheet: the rater sees tokens, never system names. */
export function buildBlindComparisonSheet(
  runs: BenchmarkRun[],
): { pairs: BlindPair[]; keyBySide: Record<string, string> } {
  const pairs: BlindPair[] = [];
  const keyBySide: Record<string, string> = {};
  for (let i = 0; i < runs.length; i += 1) {
    for (let j = i + 1; j < runs.length; j += 1) {
      for (const left of runs[i].cases) {
        const right = runs[j].cases.find((c) => c.caseId === left.caseId);
        if (!right) continue;
        const pairId = `${left.caseId}:${runs[i].runId}:${runs[j].runId}`;
        const leftToken = createHash("sha256").update(`${pairId}:L`).digest("hex").slice(0, 8);
        const rightToken = createHash("sha256").update(`${pairId}:R`).digest("hex").slice(0, 8);
        keyBySide[leftToken] = runs[i].systemUnderTest;
        keyBySide[rightToken] = runs[j].systemUnderTest;
        pairs.push({
          pairId, caseId: left.caseId,
          left: { token: leftToken, systemUnderTest: runs[i].systemUnderTest },
          right: { token: rightToken, systemUnderTest: runs[j].systemUnderTest },
          questions: BLIND_QUESTIONS,
        });
      }
    }
  }
  return { pairs, keyBySide };
}

export type BlindVote = { pairId: string; winnerToken: string };

export type EloRating = { systemUnderTest: string; rating: number; comparisons: number };

/**
 * Bradley–Terry / Elo update over blind votes. Ratings start at 1500; K falls
 * as a system accumulates comparisons, so early noise does not dominate.
 */
export function updateEloRatings(
  votes: BlindVote[],
  pairs: BlindPair[],
  existing: EloRating[] = [],
): EloRating[] {
  const ratings = new Map(existing.map((r) => [r.systemUnderTest, { ...r }]));
  const ensure = (system: string) => {
    if (!ratings.has(system)) ratings.set(system, { systemUnderTest: system, rating: 1500, comparisons: 0 });
    return ratings.get(system)!;
  };
  const pairById = new Map(pairs.map((p) => [p.pairId, p]));

  for (const vote of [...votes].sort((a, b) => a.pairId.localeCompare(b.pairId))) {
    const pair = pairById.get(vote.pairId);
    if (!pair) continue;
    const winnerIsLeft = vote.winnerToken === pair.left.token;
    const loserIsRight = vote.winnerToken === pair.right.token;
    if (!winnerIsLeft && !loserIsRight) continue;
    const winner = ensure(winnerIsLeft ? pair.left.systemUnderTest : pair.right.systemUnderTest);
    const loser = ensure(winnerIsLeft ? pair.right.systemUnderTest : pair.left.systemUnderTest);
    if (winner.systemUnderTest === loser.systemUnderTest) continue;

    const expectedWinner = 1 / (1 + 10 ** ((loser.rating - winner.rating) / 400));
    const k = (r: EloRating) => (r.comparisons < 10 ? 40 : r.comparisons < 30 ? 24 : 16);
    winner.rating += k(winner) * (1 - expectedWinner);
    loser.rating -= k(loser) * (1 - expectedWinner);
    winner.comparisons += 1;
    loser.comparisons += 1;
  }

  return [...ratings.values()]
    .map((r) => ({ ...r, rating: Number(r.rating.toFixed(1)) }))
    .sort((a, b) => b.rating - a.rating || a.systemUnderTest.localeCompare(b.systemUnderTest));
}
