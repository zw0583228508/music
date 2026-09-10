/**
 * Running the benchmark on real music (Wave Q, Q-00; Tier H task in Brain B-08).
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
 *
 * B-08 adds the **Tier H task** (`TIER_H_TASK`): on a rights-cleared human
 * multitrack work, strip one family (optionally more), have the pipeline write
 * that part against the remaining human ensemble, and judge the written part
 * against the human original **at the part level** with the tournament judge.
 * That gives a human anchor on day one without a commissioned "gold
 * arrangement"; the full-song `PROFESSIONAL_HUMAN_GOLD` level stays blocked and
 * its `levelBlocker` stays honest.
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
import { currentMetricVersions, type MetricVersions } from "./benchmarkMeasures";
import { parseMidiFile, type ParsedMidi } from "./midiFile";
import { runModelTournament, type TournamentEntry } from "./modelTournament";
import { PART_JUDGE_VERSION } from "./partJudge";
import { HUMAN_SUT, humanProvider, referenceProvider, type TournamentProvider } from "./tournamentProviders";
import { buildTournamentTask, enumerateTaskSpecs, type TournamentTask } from "./tournamentTask";

export const REAL_BENCHMARK_VERSION = "1.1" as const;

/** The Tier H benchmark task, stated once so a run cannot drift from it. */
export const TIER_H_TASK = {
  id: "strip-families-and-arrange",
  version: "1.0",
  text:
    "On a rights-cleared human multitrack work, strip N families (N = 1 by default; further families removed from the context, never from the anchor), " +
    "have the system write the stripped part against the remaining human ensemble on the shared estimated chords, and judge the written part against the " +
    "human original at the part level with the tournament judge (playability, range, register, chord-tone share, coverage, repetition, density and interval " +
    "shape vs the human, clash with the context). The human part is the anchor, never an answer key; a system out-scoring the human on a task marks the judge suspect there.",
  shape: "tournamentTask.buildTournamentTask — one task per (work, GM program, bar window)",
} as const;

export type RealBenchmarkReadiness = {
  /** Every required dimension covered, both targets met. */
  ready: boolean;
  coverage: CorpusCoverage;
  /** Entries that may be measured: rights-cleared and pointing at stored or symbolic material. */
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
  // A cleared entry with neither a stored source nor symbolic material is a plan, not a song to measure.
  const runnable = admitted.filter((entry) => Boolean(entry.sourceId) || Boolean(entry.symbolicSource));
  const humanGold = runnable.filter((entry) => Boolean(entry.humanGold));
  const blockers = [...coverage.gaps];
  const missingSources = admitted.length - runnable.length;
  if (missingSources > 0) {
    blockers.push(`${missingSources} cleared song(s) have no uploaded source or symbolic material yet`);
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
    if (!entry.sourceId) {
      unavailable.push({ id: entry.id, reason: "no uploaded source: symbolic-only entries run through runRealCorpusBenchmark" });
      continue;
    }
    const songModel = await loadSongModel(entry.sourceId);
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

// ---------------------------------------------------------------------------
// The Tier H task on the symbolic corpus
// ---------------------------------------------------------------------------

/** The MIDI behind an entry's `symbolicSource`, or null when it is not on this machine. Sync: the caller reads files. */
export type LoadMidi = (entry: CorpusEntry) => Buffer | null;

export type TierHTaskResult = {
  taskId: string;
  targetFamily: string;
  targetInst: number;
  barStart: number;
  windowBars: number;
  contextFamilies: string[];
  strippedFromContext: string[];
  humanNotes: number;
  chordCoverage: number;
  /** judgePart on the human's own part — the anchor. */
  human: { score: number; playabilityErrors: number; chordToneShare: number | null; coverage: number };
  byProvider: Record<string, {
    score: number | null;
    playabilityErrors: number | null;
    chordToneShare: number | null;
    coverage: number | null;
    deltaVsHuman: number | null;
    failure: string | null;
  }>;
  limits: string[];
};

export type TierHWorkResult = {
  entryId: string;
  workId: string;
  title: string;
  attributes: CorpusEntry["attributes"];
  tasks: TierHTaskResult[];
  /** Why the work yielded no task, when it did not. */
  skipped: string | null;
};

export type TierHProviderAggregate = {
  providerId: string;
  tasks: number;
  failures: number;
  meanScore: number | null;
  meanHumanScore: number | null;
  meanDeltaVsHuman: number | null;
  /** Share of tasks where the provider scored at or above the human — the judge is suspect there, not the machine superior. */
  atOrAboveHumanShare: number | null;
  meanPlayabilityErrors: number | null;
  meanChordToneShare: number | null;
};

export type RealCorpusBenchmarkRun = {
  version: typeof REAL_BENCHMARK_VERSION;
  method: string;
  tier: "H";
  task: typeof TIER_H_TASK;
  ranAt: string;
  gitSha: string | null;
  metricVersions: MetricVersions;
  judgeVersion: typeof PART_JUDGE_VERSION;
  providers: string[];
  seeds: number[];
  options: { windowBars: number; maxTasksPerWork: number; stripAdditionalFamilies: number };
  corpus: { entries: number; runnable: number; withMaterial: number; coverage: CorpusCoverage; gaps: string[] };
  works: TierHWorkResult[];
  aggregate: TierHProviderAggregate[];
  unavailable: Array<{ id: string; reason: string }>;
  levelBlockers: Record<BenchmarkLevel, string | null>;
  honestLimits: string[];
};

const mean = (values: number[]): number | null =>
  values.length ? Number((values.reduce((a, b) => a + b, 0) / values.length).toFixed(2)) : null;

/**
 * Strip `count` further families from a task's context — the smallest by
 * note count, never the target and never the last context track — so the
 * system arranges against a thinner human ensemble. Returns null when the
 * context cannot lose that many families and still be a context.
 */
export function stripContextFamilies(task: TournamentTask, count: number): { task: TournamentTask; stripped: string[] } | null {
  if (count <= 0) return { task, stripped: [] };
  const byFamily = new Map<string, number>();
  for (const t of task.contextTracks) byFamily.set(t.family, (byFamily.get(t.family) ?? 0) + t.notes.length);
  const families = [...byFamily.entries()].sort((a, b) => a[1] - b[1] || a[0].localeCompare(b[0])).map(([f]) => f);
  if (families.length - count < 1) return null;
  const stripped = families.slice(0, count);
  const contextTracks = task.contextTracks.filter((t) => !stripped.includes(t.family));
  return {
    task: { ...task, contextTracks, limits: [...task.limits, `context stripped of ${stripped.join(", ")} (Tier H N = ${count + 1})`] },
    stripped,
  };
}

/** Tournament tasks for one work under the Tier H task definition. */
export function tierHTasksFor(
  midi: ParsedMidi,
  workId: string,
  options: { windowBars: number; maxTasksPerWork: number; stripAdditionalFamilies: number },
): { tasks: Array<{ task: TournamentTask; stripped: string[] }>; refusal: string | null } {
  let specs = enumerateTaskSpecs(midi, workId, { windowBars: options.windowBars, maxPerScore: options.maxTasksPerWork, maxPerProgram: 1 });
  if (!specs.length && options.windowBars > 8) {
    specs = enumerateTaskSpecs(midi, workId, { windowBars: 8, maxPerScore: options.maxTasksPerWork, maxPerProgram: 1 });
  }
  if (!specs.length) return { tasks: [], refusal: "no window of this work yields a task (no part plays enough against enough context)" };
  const tasks: Array<{ task: TournamentTask; stripped: string[] }> = [];
  for (const spec of specs) {
    const built = buildTournamentTask(midi, spec);
    if ("refusal" in built) continue;
    const stripped = stripContextFamilies(built, options.stripAdditionalFamilies);
    if (!stripped) continue;
    tasks.push(stripped);
  }
  return { tasks, refusal: tasks.length ? null : `every task refused after stripping ${options.stripAdditionalFamilies} further famil(ies)` };
}

/**
 * The Tier H benchmark: the reference composer (and any other provider) on
 * every entry whose symbolic material is present, judged part by part against
 * the human original. `loadMidi` is injected so the run is pure of the file
 * system; a missing file is reported in `unavailable`, never skipped silently.
 */
export async function runRealCorpusBenchmark(options: {
  entries: readonly CorpusEntry[];
  loadMidi: LoadMidi;
  providers?: TournamentProvider[];
  seeds?: number[];
  windowBars?: number;
  maxTasksPerWork?: number;
  stripAdditionalFamilies?: number;
  now?: Date;
  gitSha?: string | null;
  onProgress?: (done: number, total: number, label: string) => void;
}): Promise<RealCorpusBenchmarkRun> {
  const providers = options.providers ?? [humanProvider, referenceProvider];
  if (!providers.some((p) => p.id === HUMAN_SUT)) providers.unshift(humanProvider);
  const seeds = options.seeds ?? [7];
  const runOptions = {
    windowBars: options.windowBars ?? 16,
    maxTasksPerWork: options.maxTasksPerWork ?? 4,
    stripAdditionalFamilies: options.stripAdditionalFamilies ?? 0,
  };
  const now = options.now ?? new Date();
  const readiness = planRealBenchmark(options.entries);
  const unavailable: Array<{ id: string; reason: string }> = [];
  const works: TierHWorkResult[] = [];
  const allTasks: Array<{ entry: CorpusEntry; task: TournamentTask; stripped: string[] }> = [];

  const symbolic = readiness.runnable.filter((e) => e.symbolicSource);
  for (const entry of readiness.runnable.filter((e) => !e.symbolicSource)) {
    unavailable.push({ id: entry.id, reason: "no symbolic material: an uploaded-source entry runs through the Song Model path, not the Tier H task" });
  }
  let done = 0;
  for (const entry of symbolic) {
    done += 1;
    options.onProgress?.(done, symbolic.length, entry.id);
    const bytes = options.loadMidi(entry);
    if (!bytes) { unavailable.push({ id: entry.id, reason: "MIDI not present on this machine" }); continue; }
    let midi: ParsedMidi;
    try {
      midi = parseMidiFile(bytes);
    } catch (error) {
      unavailable.push({ id: entry.id, reason: `unparseable MIDI: ${error instanceof Error ? error.message : String(error)}` });
      continue;
    }
    const { tasks, refusal } = tierHTasksFor(midi, entry.symbolicSource!.workId, runOptions);
    works.push({ entryId: entry.id, workId: entry.symbolicSource!.workId, title: entry.title, attributes: entry.attributes, tasks: [], skipped: refusal });
    for (const t of tasks) allTasks.push({ entry, ...t });
  }

  const report = await runModelTournament({ tasks: allTasks.map((t) => t.task), providers, seeds, corpus: "pdmx", now });
  const entriesByTask = new Map<string, TournamentEntry[]>();
  for (const e of report.entries) entriesByTask.set(e.taskId, [...(entriesByTask.get(e.taskId) ?? []), e]);

  for (const { entry, task, stripped } of allTasks) {
    const work = works.find((w) => w.entryId === entry.id)!;
    const mine = entriesByTask.get(task.id) ?? [];
    const human = mine.find((e) => e.providerId === HUMAN_SUT);
    const humanScore = human?.judgement.score ?? null;
    const byProvider: TierHTaskResult["byProvider"] = {};
    for (const provider of providers) {
      if (provider.id === HUMAN_SUT) continue;
      const entriesFor = mine.filter((e) => e.providerId === provider.id);
      const scores = entriesFor.filter((e) => !e.failure).map((e) => e.judgement.score);
      const score = mean(scores);
      byProvider[provider.id] = {
        score,
        playabilityErrors: mean(entriesFor.filter((e) => !e.failure).map((e) => e.judgement.metrics.playabilityErrors)),
        chordToneShare: mean(entriesFor.map((e) => e.judgement.metrics.chordToneShare).filter((v): v is number => v !== null)),
        coverage: mean(entriesFor.filter((e) => !e.failure).map((e) => e.judgement.metrics.coverage)),
        deltaVsHuman: score === null || humanScore === null ? null : Number((score - humanScore).toFixed(2)),
        failure: entriesFor.find((e) => e.failure)?.failure ?? null,
      };
    }
    work.tasks.push({
      taskId: task.id,
      targetFamily: task.targetFamily,
      targetInst: task.targetInst,
      barStart: task.barStart,
      windowBars: task.barEnd - task.barStart,
      contextFamilies: [...new Set(task.contextTracks.map((t) => t.family))].sort(),
      strippedFromContext: stripped,
      humanNotes: task.humanTarget.length,
      chordCoverage: task.chordCoverage.share,
      human: {
        score: humanScore ?? 0,
        playabilityErrors: human?.judgement.metrics.playabilityErrors ?? 0,
        chordToneShare: human?.judgement.metrics.chordToneShare ?? null,
        coverage: human?.judgement.metrics.coverage ?? 0,
      },
      byProvider,
      limits: task.limits,
    });
  }

  const aggregate: TierHProviderAggregate[] = providers.filter((p) => p.id !== HUMAN_SUT).map((provider) => {
    const rows = works.flatMap((w) => w.tasks.map((t) => ({ t, p: t.byProvider[provider.id] })));
    const scored = rows.filter((r) => r.p && r.p.score !== null);
    return {
      providerId: provider.id,
      tasks: rows.length,
      failures: rows.filter((r) => r.p?.failure).length,
      meanScore: mean(scored.map((r) => r.p.score!)),
      meanHumanScore: mean(scored.map((r) => r.t.human.score)),
      meanDeltaVsHuman: mean(scored.map((r) => r.p.deltaVsHuman!).filter((v) => v !== null)),
      atOrAboveHumanShare: scored.length ? Number((scored.filter((r) => r.p.score! >= r.t.human.score).length / scored.length).toFixed(4)) : null,
      meanPlayabilityErrors: mean(scored.map((r) => r.p.playabilityErrors).filter((v): v is number => v !== null)),
      meanChordToneShare: mean(scored.map((r) => r.p.chordToneShare).filter((v): v is number => v !== null)),
    };
  });

  const levelBlockers = Object.fromEntries(
    Object.values(BENCHMARK_LEVELS).map((level) => [level, levelBlocker(level, readiness)]),
  ) as Record<BenchmarkLevel, string | null>;

  return {
    version: REAL_BENCHMARK_VERSION,
    method: "real-corpus-benchmark/v1.1",
    tier: "H",
    task: TIER_H_TASK,
    ranAt: now.toISOString(),
    gitSha: options.gitSha ?? null,
    metricVersions: currentMetricVersions(),
    judgeVersion: PART_JUDGE_VERSION,
    providers: providers.map((p) => p.id),
    seeds,
    options: runOptions,
    corpus: {
      entries: options.entries.length,
      runnable: readiness.runnable.length,
      withMaterial: symbolic.length - unavailable.filter((u) => symbolic.some((e) => e.id === u.id)).length,
      coverage: readiness.coverage,
      gaps: readiness.coverage.gaps,
    },
    works,
    aggregate,
    unavailable,
    levelBlockers,
    honestLimits: [
      "Part-level judging against the human's own part: the judge's density and interval-shape terms compare the written part to the human, so a different but good part is penalised; the human part is an anchor, not an answer key.",
      "The judge is a proxy calibrated on its physical half only (judge 1.1); a machine at or above the human marks the judge suspect on that task.",
      "One family is stripped per task; the rest of the ensemble is the human's, so this measures part writing in context, not whole-song arrangement.",
      "Tier H numbers are never pooled with Tier S or Tier P.",
      levelBlockers[BENCHMARK_LEVELS.vsHumanGold] ?? "",
    ].filter(Boolean),
  };
}
