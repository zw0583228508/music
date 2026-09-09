/**
 * Running the benchmark on real music (Wave Q, Q-00).
 *
 * `runArrangementBenchmark` measures the pipeline against PR-18's synthesised
 * corpus: licence-clean, byte-reproducible, and — as the baseline has said
 * since it was recorded — exactly the kind of music this pipeline finds easy.
 * Wave Q's north star is the third benchmark: an AI arrangement against a
 * professional human arrangement of the same song.
 *
 * This module is the seam for that. It does not invent a corpus and it does not
 * lower the bar when one is missing: `planRealBenchmark` says whether the
 * corpus is a measure yet, and refuses to call a partial run a result. A
 * synthesised number and a real number are never reported as the same thing.
 */
import type { SongModelData } from "@workspace/db";
import {
  CORPUS_TARGET_HUMAN_GOLD,
  admitEntries,
  corpusCoverage,
  describeCoverage,
  type CorpusCoverage,
  type CorpusEntry,
} from "./benchmarkCorpusPlan";

export const REAL_BENCHMARK_VERSION = "1.0" as const;

export type RealBenchmarkReadiness = {
  /** Every required dimension covered, both targets met. */
  ready: boolean;
  coverage: CorpusCoverage;
  /** Entries that may be measured: rights-cleared and pointing at a stored source. */
  runnable: CorpusEntry[];
  /** Entries with a human gold arrangement to be judged against. */
  humanGold: CorpusEntry[];
  /** Why a run would not be a result, in the order to fix it. */
  blockers: string[];
  summary: string;
};

/**
 * What a real-corpus run could measure today, and what stops it being a
 * measure. Reported rather than thrown: a benchmark that cannot say what it is
 * missing is a benchmark that flatters the pipeline it measures.
 */
export function planRealBenchmark(entries: readonly CorpusEntry[]): RealBenchmarkReadiness {
  const coverage = corpusCoverage(entries);
  const { admitted } = admitEntries(entries);
  // A cleared entry with no stored source is a plan, not a song to measure.
  const runnable = admitted.filter((entry) => Boolean(entry.sourceId));
  const humanGold = runnable.filter((entry) => Boolean(entry.humanGold));
  const blockers = [...coverage.gaps];
  const missingSources = admitted.length - runnable.length;
  if (missingSources > 0) {
    blockers.push(`${missingSources} cleared song(s) have no uploaded source yet`);
  }
  if (humanGold.length < CORPUS_TARGET_HUMAN_GOLD) {
    // Already reported by coverage when the entry carries `humanGold`; this
    // catches gold arrangements that exist but whose song was never uploaded.
    const missingGoldSources = admitted.filter((e) => e.humanGold).length - humanGold.length;
    if (missingGoldSources > 0) {
      blockers.push(`${missingGoldSources} human gold arrangement(s) have no uploaded source`);
    }
  }
  return {
    ready: coverage.ready && missingSources === 0,
    coverage,
    runnable,
    humanGold,
    blockers,
    summary: describeCoverage(coverage),
  };
}

/** A song the benchmark can actually run: the entry plus the Song Model of its source. */
export type RealBenchmarkCase = {
  entry: CorpusEntry;
  songModel: SongModelData;
};

export type LoadSongModel = (sourceId: string) => Promise<SongModelData | null>;

/**
 * The cases a real run would use, and the ones that fell out. A song whose
 * analysis never produced a Song Model cannot be arranged, and is reported
 * rather than skipped silently.
 */
export async function loadRealBenchmarkCases(
  entries: readonly CorpusEntry[],
  loadSongModel: LoadSongModel,
): Promise<{ cases: RealBenchmarkCase[]; unavailable: Array<{ id: string; reason: string }> }> {
  const { runnable } = planRealBenchmark(entries);
  const cases: RealBenchmarkCase[] = [];
  const unavailable: Array<{ id: string; reason: string }> = [];
  for (const entry of runnable) {
    const songModel = await loadSongModel(entry.sourceId!);
    if (!songModel) {
      unavailable.push({ id: entry.id, reason: "no Song Model: the source has not been analysed" });
      continue;
    }
    cases.push({ entry, songModel });
  }
  return { cases, unavailable };
}

/**
 * The three benchmarks Wave Q binds every release to. Naming them in code keeps
 * a run from being reported against the wrong one.
 */
export const BENCHMARK_LEVELS = {
  /** A new composer against the reference part composer. Must win by a wide margin. */
  vsReference: "vs-reference-part-composer",
  /** A new version against the current production model. > 60 % blind preference to promote. */
  vsProduction: "vs-production-model",
  /** The north star: an AI arrangement against a professional human arrangement. */
  vsHumanGold: "vs-human-gold",
} as const;

export type BenchmarkLevel = typeof BENCHMARK_LEVELS[keyof typeof BENCHMARK_LEVELS];

/** Why this level cannot be run yet, or null when it can. */
export function levelBlocker(level: BenchmarkLevel, readiness: RealBenchmarkReadiness): string | null {
  if (level === BENCHMARK_LEVELS.vsHumanGold) {
    if (!readiness.humanGold.length) {
      return "No song in the corpus has a human gold arrangement with an uploaded source; the north-star benchmark cannot be run.";
    }
    if (readiness.humanGold.length < CORPUS_TARGET_HUMAN_GOLD) {
      return `${readiness.humanGold.length} of ${CORPUS_TARGET_HUMAN_GOLD} human gold arrangements — a result would be an anecdote.`;
    }
    return null;
  }
  if (!readiness.runnable.length) {
    return "The real corpus has no runnable song; only the synthesised corpus can be measured.";
  }
  if (!readiness.ready) {
    return `The corpus is not a measure yet: ${readiness.blockers.join("; ")}.`;
  }
  return null;
}
