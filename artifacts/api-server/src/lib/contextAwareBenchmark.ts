/**
 * The `vs-reference-part-composer` measurement (Wave Q).
 *
 * PR-47 put the context passes behind `contextAware`. This runs the arrangement
 * benchmark **twice on the identical corpus** — once with the flag off, once
 * with it on — and compares the two. That comparison is the only thing that
 * justifies turning the flag on for real, and Wave Q's first rule is that a new
 * path ships when the benchmark says it is better, not when it exists.
 *
 * What this is honest about:
 *
 *  - The corpus is still PR-18's synthesised one. A synthesised song is the
 *    kind of music this pipeline finds easy, so a *small* improvement here is
 *    weak evidence and a *regression* here is strong evidence. Q-00's real
 *    corpus is where a real verdict comes from.
 *  - The critic score is the pipeline grading itself. It is a proxy, not a
 *    listener. `buildBlindComparisonSheet` from the two runs is the real test,
 *    and this produces that sheet rather than declaring a winner.
 *  - "Not measurably better" is a full result. It means: do not turn the flag
 *    on, and go get the real corpus.
 */
import {
  BENCHMARK_VERSION,
  buildBlindComparisonSheet,
  compareBenchmarkRuns,
  runArrangementBenchmark,
  type BenchmarkRun,
  type BenchmarkVerdict,
  type BlindPair,
} from "./arrangementBenchmark";
import { orchestrateArrangement, type OrchestrateInput, type OrchestrationResult } from "./arrangementOrchestrator";
import type { StyleGrammarSlot } from "./partGenerationContextV2";
import type { BenchmarkCase } from "./benchmarkCorpus";

export const CONTEXT_AWARE_BENCHMARK_VERSION = "1.0" as const;

export const REFERENCE_SUT = "REFERENCE_PART_COMPOSER";
export const CONTEXT_AWARE_SUT = "CONTEXT_AWARE_ARRANGER";

export type ContextAwareBenchmarkResult = {
  version: typeof CONTEXT_AWARE_BENCHMARK_VERSION;
  benchmarkVersion: typeof BENCHMARK_VERSION;
  /** Stated in the result so a reader never has to guess whether it was real. */
  corpus: "synthesised" | "real";
  baseline: BenchmarkRun;
  candidate: BenchmarkRun;
  verdict: BenchmarkVerdict;
  /** The pairs a human would actually judge. This, not `verdict`, decides. */
  blindSheet: { pairs: BlindPair[]; keyBySide: Record<string, string> };
  /** The one-line answer to "should the flag be turned on?". */
  recommendation:
    | { action: "do_not_promote"; reason: string }
    | { action: "run_blind_evaluation"; reason: string };
};

/**
 * Run both arms and compare. `orchestrate` is injectable so a test can drive a
 * deterministic clock; production passes the real one.
 */
export function runContextAwareBenchmark(options: {
  corpus?: BenchmarkCase[];
  /** Q-02 grammar for the context arm. Absent = no groove pass, which is fine. */
  styleGrammar?: StyleGrammarSlot;
  candidateCount?: number;
  now?: Date;
  clock?: () => number;
  orchestrate?: (input: OrchestrateInput) => OrchestrationResult;
  corpusKind?: "synthesised" | "real";
} = {}): ContextAwareBenchmarkResult {
  const orchestrate = options.orchestrate ?? orchestrateArrangement;
  const shared = {
    corpus: options.corpus,
    candidateCount: options.candidateCount,
    now: options.now,
    clock: options.clock,
    render: false,
  } as const;

  const baseline = runArrangementBenchmark({
    ...shared,
    systemUnderTest: REFERENCE_SUT,
    orchestrate: (input) => orchestrate({ ...input, contextAware: false }),
  });
  const candidate = runArrangementBenchmark({
    ...shared,
    systemUnderTest: CONTEXT_AWARE_SUT,
    orchestrate: (input) =>
      orchestrate({ ...input, contextAware: true, styleGrammar: options.styleGrammar }),
  });

  const verdict = compareBenchmarkRuns(baseline, candidate);
  const blindSheet = buildBlindComparisonSheet([baseline, candidate]);

  const recommendation = verdict.regressed.filter((m) => m !== "latencyMs" && m !== "noteCount").length
    ? {
        action: "do_not_promote" as const,
        reason: `${CONTEXT_AWARE_SUT} regresses ${verdict.regressed.join(", ")} on the synthesised corpus; a regression here is strong evidence.`,
      }
    : verdict.beatsBaseline
      ? {
          action: "run_blind_evaluation" as const,
          reason: `${CONTEXT_AWARE_SUT} improves ${verdict.improved.join(", ")} on the synthesised corpus without regressing anything; the critic is a proxy, so a blind listening comparison decides.`,
        }
      : {
          action: "do_not_promote" as const,
          reason: `${CONTEXT_AWARE_SUT} is not measurably better than ${REFERENCE_SUT} on the synthesised corpus; get the real corpus before turning the flag on.`,
        };

  return {
    version: CONTEXT_AWARE_BENCHMARK_VERSION,
    benchmarkVersion: BENCHMARK_VERSION,
    corpus: options.corpusKind ?? "synthesised",
    baseline,
    candidate,
    verdict,
    blindSheet,
    recommendation,
  };
}
