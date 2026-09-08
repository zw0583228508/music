/**
 * Arrangement quality benchmark (PR-18).
 *
 * "Without a benchmark you won't know whether you actually improved." Every
 * build runs the fixed corpus and records the same metrics, so a change can be
 * shown to help or hurt — and a new model has to *earn* its place rather than
 * become the default because it is new.
 *
 * Two halves:
 *  - automated metrics (this module's `runArrangementBenchmark`), and
 *  - blind human evaluation (`buildBlindComparisonSheet` + Elo), which the plan
 *    names as the top-level measure.
 */
import { createHash } from "node:crypto";
import { BENCHMARK_CORPUS, buildBenchmarkSongModel, type BenchmarkCase } from "./benchmarkCorpus";
import { orchestrateArrangement, type OrchestrateInput, type OrchestrationResult } from "./arrangementOrchestrator";

export const BENCHMARK_VERSION = "1.0" as const;
const METHOD = "arrangement-benchmark/v1";

export type BenchmarkMetric =
  | "criticScore" | "audioScore" | "playabilityErrors" | "harmonyScore"
  | "sectionConsistency" | "candidateDiversity" | "renderFailures"
  | "noteCount" | "latencyMs";

/** A metric the local run genuinely cannot measure is reported as null, not faked. */
export type BenchmarkCaseResult = {
  caseId: string;
  genre: string;
  inputType: string;
  metrics: Record<BenchmarkMetric, number | null>;
  selectedStrategy: string | null;
  feasible: boolean;
  notes: string[];
};

export type BenchmarkRun = {
  version: "1.0";
  method: string;
  runId: string;
  startedAt: string;
  corpusSize: number;
  /** Identifies what produced the arrangements, e.g. a composer/model name. */
  systemUnderTest: string;
  cases: BenchmarkCaseResult[];
  aggregate: Record<BenchmarkMetric, number | null>;
  unavailableMetrics: string[];
};

// ---------------------------------------------------------------------------

const mean = (values: number[]): number | null =>
  values.length ? Number((values.reduce((a, b) => a + b, 0) / values.length).toFixed(2)) : null;

function sectionConsistency(result: OrchestrationResult): number {
  // Repeated sections should differ (development) but the whole song should
  // still hold together: score the share of section boundaries where the plan
  // recorded a real novelty value in a sane band.
  const targets = result.plan.globalPlan?.sectionTargets ?? [];
  if (targets.length < 2) return 0;
  const novelties = targets.slice(1).map((t) => t.noveltyVsPrevious);
  const healthy = novelties.filter((n) => n >= 0.1 && n <= 0.9).length;
  return Number(((healthy / novelties.length) * 100).toFixed(2));
}

function candidateDiversity(result: OrchestrationResult): number {
  const counts = result.candidates.map((c) => c.noteCount);
  if (counts.length < 2) return 0;
  const distinct = new Set(counts).size;
  const spread = (Math.max(...counts) - Math.min(...counts)) / Math.max(1, Math.max(...counts));
  return Number((((distinct / counts.length) * 0.5 + spread * 0.5) * 100).toFixed(2));
}

function harmonyScore(result: OrchestrationResult): number | null {
  const selected = result.candidates.find((c) => c.candidateId === result.selected?.candidateId);
  const dimension = selected?.critique.dimensions.find((d) => d.dimension === "harmony");
  return dimension ? dimension.score : null;
}

export function runArrangementBenchmark(options: {
  corpus?: BenchmarkCase[];
  systemUnderTest?: string;
  candidateCount?: number;
  render?: boolean;
  orchestrate?: (input: OrchestrateInput) => OrchestrationResult;
  now?: Date;
  clock?: () => number;
} = {}): BenchmarkRun {
  const corpus = options.corpus ?? BENCHMARK_CORPUS;
  const orchestrate = options.orchestrate ?? orchestrateArrangement;
  const clock = options.clock ?? (() => Date.now());
  const now = options.now ?? new Date(0);
  const render = options.render ?? false;

  const cases: BenchmarkCaseResult[] = corpus.map((spec) => {
    const songModel = buildBenchmarkSongModel(spec);
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
        caseId: spec.id, genre: spec.genre, inputType: spec.inputType,
        metrics: {
          criticScore: null, audioScore: null, playabilityErrors: null,
          harmonyScore: null, sectionConsistency: null, candidateDiversity: null,
          renderFailures: null, noteCount: null, latencyMs,
        },
        selectedStrategy: null, feasible: false, notes,
      };
    }

    const selected = result.candidates.find((c) => c.candidateId === result!.selected?.candidateId);
    const renderFailures = render
      ? result.candidates.filter((c) => c.renderFeasible === false).length
      : null;
    if (!render) notes.push("rendering disabled for this run");

    return {
      caseId: spec.id,
      genre: spec.genre,
      inputType: spec.inputType,
      metrics: {
        criticScore: selected?.critique.overallScore ?? null,
        audioScore: selected?.audioCritique?.overallScore ?? null,
        playabilityErrors: result.candidates.reduce((sum, c) => sum + c.constraintErrors, 0),
        harmonyScore: harmonyScore(result),
        sectionConsistency: sectionConsistency(result),
        candidateDiversity: candidateDiversity(result),
        renderFailures,
        noteCount: selected?.noteCount ?? null,
        latencyMs,
      },
      selectedStrategy: selected?.strategy ?? null,
      feasible: selected?.critique.feasible ?? false,
      notes,
    };
  });

  const metricNames: BenchmarkMetric[] = [
    "criticScore", "audioScore", "playabilityErrors", "harmonyScore",
    "sectionConsistency", "candidateDiversity", "renderFailures",
    "noteCount", "latencyMs",
  ];
  const aggregate = Object.fromEntries(
    metricNames.map((name) => [
      name,
      mean(cases.map((c) => c.metrics[name]).filter((v): v is number => v !== null)),
    ]),
  ) as Record<BenchmarkMetric, number | null>;

  const unavailableMetrics = [
    "analysisAccuracy (needs a labelled analysis set and live providers)",
    "gpuCost (no GPU worker in this run)",
    ...(render ? [] : ["audioScore / renderFailures (rendering disabled)"]),
  ];

  return {
    version: BENCHMARK_VERSION,
    method: METHOD,
    runId: createHash("sha256")
      .update(`${corpus.map((c) => c.id).join(",")}:${options.systemUnderTest ?? "default"}`)
      .digest("hex").slice(0, 12),
    startedAt: now.toISOString(),
    corpusSize: corpus.length,
    systemUnderTest: options.systemUnderTest ?? "REFERENCE_PIPELINE",
    cases,
    aggregate,
    unavailableMetrics,
  };
}

// ---------------------------------------------------------------------------
// Regression gate
// ---------------------------------------------------------------------------

/** Metrics where lower is better. */
const LOWER_IS_BETTER = new Set<BenchmarkMetric>([
  "playabilityErrors", "renderFailures", "latencyMs",
]);

export type BenchmarkComparison = {
  metric: BenchmarkMetric;
  baseline: number | null;
  candidate: number | null;
  delta: number | null;
  verdict: "improved" | "regressed" | "unchanged" | "unavailable";
};

export type BenchmarkVerdict = {
  comparisons: BenchmarkComparison[];
  improved: BenchmarkMetric[];
  regressed: BenchmarkMetric[];
  /** The plan's rule: a new system must beat the incumbent, not merely differ. */
  beatsBaseline: boolean;
  summary: string;
};

export function compareBenchmarkRuns(
  baseline: BenchmarkRun,
  candidate: BenchmarkRun,
  options: { tolerance?: number } = {},
): BenchmarkVerdict {
  const tolerance = options.tolerance ?? 1;
  const metrics = Object.keys(baseline.aggregate) as BenchmarkMetric[];
  const comparisons: BenchmarkComparison[] = metrics.map((metric) => {
    const b = baseline.aggregate[metric];
    const c = candidate.aggregate[metric];
    if (b === null || c === null) {
      return { metric, baseline: b, candidate: c, delta: null, verdict: "unavailable" };
    }
    const delta = Number((c - b).toFixed(2));
    const better = LOWER_IS_BETTER.has(metric) ? delta < -tolerance : delta > tolerance;
    const worse = LOWER_IS_BETTER.has(metric) ? delta > tolerance : delta < -tolerance;
    return {
      metric, baseline: b, candidate: c, delta,
      verdict: better ? "improved" : worse ? "regressed" : "unchanged",
    };
  });

  const improved = comparisons.filter((c) => c.verdict === "improved").map((c) => c.metric);
  const regressed = comparisons.filter((c) => c.verdict === "regressed").map((c) => c.metric);
  // Musical quality is what decides; latency alone never promotes a system.
  const qualityImproved = improved.filter((m) => m !== "latencyMs" && m !== "noteCount");
  const qualityRegressed = regressed.filter((m) => m !== "latencyMs" && m !== "noteCount");
  const beatsBaseline = qualityImproved.length > qualityRegressed.length && qualityRegressed.length === 0;

  return {
    comparisons, improved, regressed, beatsBaseline,
    summary: beatsBaseline
      ? `${candidate.systemUnderTest} beats ${baseline.systemUnderTest} on ${qualityImproved.join(", ")}`
      : qualityRegressed.length
        ? `${candidate.systemUnderTest} regresses ${qualityRegressed.join(", ")} — do not promote`
        : `${candidate.systemUnderTest} is not measurably better — do not promote`,
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
