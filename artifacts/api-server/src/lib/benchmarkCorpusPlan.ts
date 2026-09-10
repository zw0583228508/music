/**
 * The real benchmark corpus (Wave Q, Q-00).
 *
 * PR-18's corpus is synthesised from explicit musical specifications. It is
 * licence-clean and byte-reproducible, and it is also exactly the kind of music
 * this pipeline finds easy — the master plan has said so since the baseline was
 * recorded. Wave Q's first rule is that **nothing is trained before there is a
 * measure**, and the measure has to be real recorded music with, for a subset,
 * a professional human arrangement to be judged against.
 *
 * This module is the contract for that corpus and the gate in front of it. It
 * holds no music: adding a song is a data task (an entry plus its rights
 * basis), not an engineering one.
 *
 * Two rules, both inherited from what the platform already does elsewhere:
 *
 *  - **Fail closed on rights.** An entry without a proven, commercial-use
 *    rights basis is not in the corpus. A dataset's own licence is not proof of
 *    rights in the works inside it, which is why the basis names the work, not
 *    the collection it came from.
 *  - **Coverage is measured, not assumed.** A benchmark that is 80 % 4/4 pop
 *    flatters a pop-shaped pipeline. `corpusCoverage` reports what the corpus
 *    actually spans against Q-00's required spread, and says what is missing.
 */
import { REAL_CORPUS_TIER_H } from "./realCorpusTierH";

export type CorpusInputType =
  | "full_song" | "piano_vocal" | "vocal_only" | "solo_instrument" | "midi";

export type CorpusTempoBand = "slow" | "medium" | "fast";
export type CorpusFeel = "straight" | "swung" | "compound";
export type CorpusHarmony = "simple" | "moderate" | "complex";
export type CorpusDensity = "sparse" | "moderate" | "dense";
export type CorpusEnsemble = "solo" | "small" | "large";
export type CorpusIdiom = "western" | "non_western";
export type CorpusProduction = "acoustic" | "electronic" | "hybrid";

/**
 * Why this recording may be used to measure a commercial product. Mirrors the
 * PR-28 rule for learning data: the basis is recorded per work, with the
 * evidence that supports it.
 */
export type CorpusRightsBasis = {
  kind:
    | "public_domain"
    | "owned_by_operator"
    | "licensed_for_evaluation"
    | "written_permission";
  /** Where the claim can be checked: a licence URL, a contract reference, a permission record. */
  reference: string;
  /** The work itself, not the collection it was found in. */
  work: string;
  clearedAt: string;
  commercialUse: true;
};

export type CorpusEntry = {
  id: string;
  title: string;
  inputType: CorpusInputType;
  rights: CorpusRightsBasis;
  /** Musical facts the coverage report reasons over. Measured, not guessed. */
  attributes: {
    tempoBand: CorpusTempoBand;
    meter: string;
    feel: CorpusFeel;
    harmony: CorpusHarmony;
    density: CorpusDensity;
    ensemble: CorpusEnsemble;
    idiom: CorpusIdiom;
    production: CorpusProduction;
    tradition?: string;
  };
  /** The stored source this entry points at, once uploaded. */
  sourceId?: string;
  /**
   * Q-00's north star: a professional human arrangement of this song, to judge
   * the platform's arrangement against. Absent for most entries by design.
   */
  humanGold?: {
    arrangementId: string;
    arrangerCredit: string;
    rights: CorpusRightsBasis;
  };
  /**
   * Tier H (Brain B-08): the symbolic material behind a PDMX entry — the MIDI
   * inside the rights subset, by work id and path relative to the PDMX root,
   * with the digest and the measurements the attributes were derived from.
   * `sourceId` stays the platform's uploaded-source pointer; an entry may
   * carry either or both. The human parts of this work are the anchor for the
   * Tier H task (`realCorpusBenchmark.TIER_H_TASK`); they are not a
   * `humanGold` arrangement of a benchmark song and are never reported as one.
   */
  symbolicSource?: {
    kind: "pdmx_midi";
    workId: string;
    relativePath: string;
    sha256: string;
    /** Where the repo already admitted this work before B-08 selected it. */
    admittedBy: "tournament-classical" | "tournament-global" | "listening-v2" | "b08-csv-scan";
    measured: {
      bars: number;
      tracks: number;
      families: string[];
      meter: string;
      tempoBpm: number | null;
      tempoChanges: number;
      notesPerBar: number;
      swingRatio: number | null;
      effectivePitchClasses: number | null;
    };
    genre?: { primary: string; families: string[]; source: string };
  };
};

/** Q-00's required spread. A corpus that misses a row is not yet a measure. */
export const REQUIRED_COVERAGE = {
  inputType: ["full_song", "piano_vocal", "vocal_only", "midi"] as CorpusInputType[],
  tempoBand: ["slow", "medium", "fast"] as CorpusTempoBand[],
  meter: ["4/4", "3/4", "6/8"],
  feel: ["straight", "swung"] as CorpusFeel[],
  harmony: ["simple", "moderate", "complex"] as CorpusHarmony[],
  density: ["sparse", "dense"] as CorpusDensity[],
  ensemble: ["small", "large"] as CorpusEnsemble[],
  idiom: ["western", "non_western"] as CorpusIdiom[],
  production: ["acoustic", "electronic"] as CorpusProduction[],
} as const;

export const CORPUS_TARGET_SONGS = 100;
export const CORPUS_TARGET_HUMAN_GOLD = 30;
/** Below this, a dimension is represented but not measurable: one song is an anecdote. */
export const MIN_PER_VALUE = 3;

export class CorpusRightsError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "CorpusRightsError";
  }
}

/** Why this entry may not enter the corpus, or null when it may. */
export function corpusRefusalReason(entry: CorpusEntry): string | null {
  const { rights } = entry;
  if (!rights || rights.commercialUse !== true) {
    return `"${entry.title}" has no commercial-use rights basis; the benchmark measures a commercial product.`;
  }
  if (!rights.reference?.trim()) {
    return `"${entry.title}" claims ${rights.kind} with nothing to check it against.`;
  }
  if (!rights.work?.trim()) {
    return `"${entry.title}" names no work: a dataset's licence is not proof of rights in the works inside it.`;
  }
  if (Number.isNaN(Date.parse(rights.clearedAt))) {
    return `"${entry.title}" has no clearance date.`;
  }
  if (entry.humanGold && entry.humanGold.rights?.commercialUse !== true) {
    return `The human gold arrangement of "${entry.title}" has no commercial-use rights basis of its own.`;
  }
  return null;
}

/** Entries that may be used, and the reason each rejected one may not. */
export function admitEntries(entries: readonly CorpusEntry[]): {
  admitted: CorpusEntry[];
  refused: Array<{ id: string; reason: string }>;
} {
  const admitted: CorpusEntry[] = [];
  const refused: Array<{ id: string; reason: string }> = [];
  for (const entry of entries) {
    const reason = corpusRefusalReason(entry);
    if (reason) refused.push({ id: entry.id, reason });
    else admitted.push(entry);
  }
  return { admitted, refused };
}

export type CoverageDimension = {
  dimension: string;
  /** Value → how many admitted entries carry it. */
  counts: Record<string, number>;
  /** Required values with fewer than `MIN_PER_VALUE` entries. */
  missing: string[];
};

export type CorpusCoverage = {
  songs: number;
  humanGold: number;
  targetSongs: number;
  targetHumanGold: number;
  dimensions: CoverageDimension[];
  /** Every required value has at least `MIN_PER_VALUE`, and both targets are met. */
  ready: boolean;
  /** What still has to be true, in the order it should be fixed. */
  gaps: string[];
};

const ATTRIBUTE_OF: Record<string, (entry: CorpusEntry) => string> = {
  inputType: (entry) => entry.inputType,
  tempoBand: (entry) => entry.attributes.tempoBand,
  meter: (entry) => entry.attributes.meter,
  feel: (entry) => entry.attributes.feel,
  harmony: (entry) => entry.attributes.harmony,
  density: (entry) => entry.attributes.density,
  ensemble: (entry) => entry.attributes.ensemble,
  idiom: (entry) => entry.attributes.idiom,
  production: (entry) => entry.attributes.production,
};

/**
 * What the corpus actually spans, and what it is missing. Reported rather than
 * asserted: a benchmark that cannot say what it does not cover is a benchmark
 * that can flatter the pipeline it measures.
 */
export function corpusCoverage(entries: readonly CorpusEntry[]): CorpusCoverage {
  const { admitted } = admitEntries(entries);
  const dimensions: CoverageDimension[] = [];
  const gaps: string[] = [];

  for (const [dimension, required] of Object.entries(REQUIRED_COVERAGE)) {
    const read = ATTRIBUTE_OF[dimension];
    const counts: Record<string, number> = {};
    for (const entry of admitted) {
      const value = read(entry);
      counts[value] = (counts[value] ?? 0) + 1;
    }
    const missing = (required as readonly string[]).filter((value) => (counts[value] ?? 0) < MIN_PER_VALUE);
    dimensions.push({ dimension, counts, missing });
    for (const value of missing) {
      gaps.push(`${dimension} "${value}": ${counts[value] ?? 0} of ${MIN_PER_VALUE} songs`);
    }
  }

  const humanGold = admitted.filter((entry) => entry.humanGold).length;
  if (admitted.length < CORPUS_TARGET_SONGS) {
    gaps.unshift(`songs: ${admitted.length} of ${CORPUS_TARGET_SONGS}`);
  }
  if (humanGold < CORPUS_TARGET_HUMAN_GOLD) {
    gaps.push(`human gold arrangements: ${humanGold} of ${CORPUS_TARGET_HUMAN_GOLD}`);
  }

  return {
    songs: admitted.length,
    humanGold,
    targetSongs: CORPUS_TARGET_SONGS,
    targetHumanGold: CORPUS_TARGET_HUMAN_GOLD,
    dimensions,
    ready: gaps.length === 0,
    gaps,
  };
}

/** One sentence a person can act on. */
export function describeCoverage(coverage: CorpusCoverage): string {
  if (coverage.ready) {
    return `The benchmark corpus is ready: ${coverage.songs} rights-cleared songs, ${coverage.humanGold} with a human gold arrangement, every required dimension covered.`;
  }
  return `The benchmark corpus is not a measure yet — ${coverage.gaps.join("; ")}.`;
}

/**
 * The corpus itself. Tier H (Brain B-08): rights-cleared PDMX multitrack works
 * with measured attributes, selected and generated by
 * `scripts/select-real-corpus.mjs` into `realCorpusTierH.ts`; every gap the
 * required spread still has is reported by `corpusCoverage`, never filled
 * synthetically. PR-18's synthesised corpus stays where it is and keeps
 * guarding regressions; it is not this, and the two are never merged. Tier P
 * (the operator's own songs) lives in `benchmarkTierP.ts` and is reported per
 * song, never pooled with this list.
 */
export const REAL_BENCHMARK_CORPUS: CorpusEntry[] = [...REAL_CORPUS_TIER_H];
