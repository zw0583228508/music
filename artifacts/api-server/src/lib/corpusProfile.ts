/**
 * Corpus profile (Wave Q, Q-05 — the data factory's first honest inventory).
 *
 * PR-53 found that only 9 % of a 5,000-score PDMX sample yields an arranger
 * task, and the foundation decision leans on that number. This module makes
 * it precise and richer: **one record per admitted work**, from the MIDI
 * itself — track count, GM programs and ARRANGER_REMI families, solo vs
 * multitrack, bars, metres, tempi, key, harmonic complexity, note density per
 * family, a phrase-length proxy, the CSV's genre columns, a content
 * fingerprint for duplicate detection and the count of every Tier B task type
 * the score offers — plus the aggregation over all records that answers the
 * owner's questions as numbers.
 *
 * Definitions (so a number here means one thing):
 *
 *  - **multitrack** — at least two pitched ARRANGER_REMI families, or one
 *    pitched family plus drums. Two MIDI tracks of piano (right hand, left
 *    hand) are one family and therefore *solo*. This is the definition the
 *    task extractor implies, made explicit.
 *  - **bar count** — as the tokenizer counts it: last note's bar + 1 on the
 *    grid, under the file's first metre.
 *  - **harmonic complexity** — per-bar chord estimates (`chordsFromNotes`,
 *    pitched notes only): distinct chord symbols over the piece, and the
 *    chord-change rate = changes between consecutive named bars ÷ (named
 *    bars − 1). Bars with no clear chord are simply not named.
 *  - **phrase length proxy** — within each pitched family, a run of notes
 *    ends when the next onset comes at least one quarter note after the
 *    previous sounding ended; run length in beats. Median over all runs.
 *  - **key** — Krumhansl-Kessler over duration-weighted pitched notes, or
 *    null when the material is too thin (the estimator refuses).
 *  - **genre family** — the first token of the CSV's hyphen-joined `genres`
 *    field, folded onto a short list; `unknown` when the row says `NA`.
 */
import { FAMILIES, familyOf, toGridNotes, tokenize, type TokenizeOptions } from "./arrangerRemi";
import { analyseScoreCells, enumerateExtendedTasks, ARRANGER_TASK_TYPES, type ArrangerTaskType } from "./arrangerTaskTypes";
import { estimateChords, type BarSpan, type ChordCandidateNote } from "./chordsFromNotes";
import { keyFromNotes } from "./keyFromNotes";
import type { ParsedMidi } from "./midiFile";
import { fingerprintMidi, type WorkFingerprint } from "./nearDuplicate";

export const CORPUS_PROFILE_VERSION = "CORPUS_PROFILE_v1" as const;

export type EnsembleClass = "empty" | "solo" | "multitrack";

export type GenreFamily =
  | "classical" | "folk" | "soundtrack" | "rock" | "pop" | "jazz_blues" | "electronic"
  | "rnb_funk_soul" | "religious" | "world" | "hiphop" | "country" | "other" | "unknown";

const GENRE_TOKEN_FAMILY: Record<string, GenreFamily> = {
  classical: "classical",
  folk: "folk",
  soundtrack: "soundtrack",
  rock: "rock", metal: "rock", darkwave: "rock",
  pop: "pop", disco: "pop",
  jazz: "jazz_blues", blues: "jazz_blues",
  electronic: "electronic",
  rbfunksoul: "rnb_funk_soul",
  religiousmusic: "religious",
  worldmusic: "world", reggaeska: "world",
  hiphop: "hiphop",
  country: "country",
  experimental: "other", newage: "other", comedy: "other",
};

/** The CSV's `genres` field ("rock-pop", "classical", "NA") onto a genre family. */
export function genreFamilyOf(genres: string | undefined): GenreFamily {
  const text = genres?.trim();
  if (!text || text === "NA") return "unknown";
  const first = text.split("-")[0].toLowerCase();
  return GENRE_TOKEN_FAMILY[first] ?? "other";
}

export type WorkCsvMeta = {
  genres?: string;
  tags?: string;
  groups?: string;
  complexity?: number;
  nTracksCsv?: number;
  /** PDMX's own version-group key (`best_unique_arrangement`), for validating dedup. */
  versionGroup?: string;
  /** Digest of the normalised (song_name | composer_name); equal keys name the same song. */
  titleKey?: string;
};

export type WorkProfile = {
  version: typeof CORPUS_PROFILE_VERSION;
  workId: string;
  /** MIDI tracks that carry at least one note. */
  trackCount: number;
  noteCount: number;
  /** Distinct GM programs; 128 stands for the drum kit. */
  programs: number[];
  families: string[];
  pitchedFamilyCount: number;
  hasDrums: boolean;
  ensemble: EnsembleClass;
  barCount: number;
  /** Every distinct metre in the file, in order of first appearance. */
  meters: string[];
  /** The metre that covers the most ticks. The tokenizer grid uses the *first* metre; where they differ the grid is wrong for most of the piece. */
  dominantMeter: string;
  meterChanges: number;
  /** The first metre lasts at most one bar and is shorter than the next: an anacrusis exported as a metre change. */
  pickupBar: boolean;
  meterApproximated: boolean;
  tempos: number[];
  key: string | null;
  keyConfidence: number | null;
  harmony: { namedBars: number; distinctChords: number; chordChangeRate: number | null; namedShare: number };
  /** Notes per bar over the piece, per family. */
  densityByFamily: Record<string, number>;
  /** Highest-register pitched family sounding in ≥ half the bars, when ≥ 2 pitched families exist. */
  melodyFamily: string | null;
  phrase: { runs: number; medianBeats: number | null; meanBeats: number | null; melodyMedianBeats: number | null };
  /** Full ARRANGER_REMI stream length under the bar cap. */
  tokenCount: number;
  fingerprint: WorkFingerprint;
  taskCounts: Partial<Record<ArrangerTaskType, number>>;
  /** Per type, tasks whose target includes each family. */
  taskFamilyCounts: Partial<Record<ArrangerTaskType, Record<string, number>>>;
  genreFamily: GenreFamily;
  csv: WorkCsvMeta;
};

export type ProfileOptions = {
  tokenize?: TokenizeOptions;
  /** Cap the bars the chord estimator walks. */
  maxChordBars?: number;
};

export const DEFAULT_PROFILE_OPTIONS = { tokenize: { maxBars: 512 }, maxChordBars: 512 } as const;

export function ensembleClassOf(families: readonly string[]): EnsembleClass {
  if (!families.length) return "empty";
  const pitched = families.filter((f) => f !== "drums").length;
  const drums = families.includes("drums");
  return pitched >= 2 || (pitched >= 1 && drums) ? "multitrack" : "solo";
}

const round = (value: number, places = 3): number => Number(value.toFixed(places));

function median(values: number[]): number | null {
  if (!values.length) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
}

/**
 * Which metre covers most of the piece, how often it changes, and whether the
 * first metre is a pickup bar (lasts at most one of its bars and is shorter
 * than what follows — how notation editors export an anacrusis).
 */
export function meterSpans(midi: Pick<ParsedMidi, "timeSignatures" | "ticksPerQuarter" | "endTick">): { dominant: string; changes: number; pickup: boolean } {
  const sigs = [...midi.timeSignatures].sort((a, b) => a.tick - b.tick);
  if (!sigs.length) return { dominant: "4/4", changes: 0, pickup: false };
  const barTicks = (s: { numerator: number; denominator: number }) => s.numerator * (4 / s.denominator) * midi.ticksPerQuarter;
  const covered = new Map<string, number>();
  let changes = 0;
  for (let i = 0; i < sigs.length; i += 1) {
    const s = sigs[i];
    const next = sigs[i + 1]?.tick ?? Math.max(midi.endTick, s.tick);
    const label = `${s.numerator}/${s.denominator}`;
    if (i > 0) {
      const prev = sigs[i - 1];
      if (prev.numerator !== s.numerator || prev.denominator !== s.denominator) changes += 1;
    }
    covered.set(label, (covered.get(label) ?? 0) + Math.max(0, next - s.tick));
  }
  let dominant = `${sigs[0].numerator}/${sigs[0].denominator}`;
  let best = -1;
  for (const [label, ticks] of covered) {
    if (ticks > best) {
      best = ticks;
      dominant = label;
    }
  }
  const pickup =
    sigs.length > 1 &&
    sigs[1].tick - sigs[0].tick <= barTicks(sigs[0]) + 1 &&
    barTicks(sigs[0]) < barTicks(sigs[1]);
  return { dominant, changes, pickup };
}

/** The profile of one parsed, admitted score. Deterministic. */
export function profileWork(midi: ParsedMidi, workId: string, csv: WorkCsvMeta = {}, options: ProfileOptions = {}): WorkProfile {
  const tokenizeOptions = options.tokenize ?? DEFAULT_PROFILE_OPTIONS.tokenize;
  const maxChordBars = options.maxChordBars ?? DEFAULT_PROFILE_OPTIONS.maxChordBars;
  const grid = toGridNotes(midi, tokenizeOptions);

  const tracks = new Set<number>();
  const programs = new Set<number>();
  const familySet = new Set<string>();
  for (const note of midi.notes) {
    tracks.add(note.track);
    programs.add(note.isPercussion ? 128 : note.program);
    familySet.add(familyOf(note));
  }
  const families = FAMILIES.filter((f) => familySet.has(f));
  const hasDrums = familySet.has("drums");
  const pitchedFamilyCount = families.length - (hasDrums ? 1 : 0);

  const meters = [...new Set(midi.timeSignatures.map((t) => `${t.numerator}/${t.denominator}`))];
  const meterSpan = meterSpans(midi);
  const tempos = [...new Set(midi.tempos.map((t) => Math.round(t.bpm)))].filter((b) => b > 0).slice(0, 16);

  // Key from the pitched notes, duration in ticks (only relative weight matters).
  const pitched = midi.notes.filter((n) => !n.isPercussion);
  const key = keyFromNotes(pitched.map((n) => ({ start: n.startTick, end: n.endTick, pitch: n.pitch })));

  // Chords per bar, in seconds under the first tempo.
  const bpm = midi.tempos[0]?.bpm && midi.tempos[0].bpm >= 20 && midi.tempos[0].bpm <= 400 ? midi.tempos[0].bpm : 120;
  const secondsPerTick = 60 / (bpm * midi.ticksPerQuarter);
  const barSeconds = (grid.stepsPerBarValue / 12) * (60 / bpm);
  const chordBars = Math.min(grid.barCount, maxChordBars);
  const spans: BarSpan[] = Array.from({ length: chordBars }, (_, i) => ({ bar: i, start: i * barSeconds, end: (i + 1) * barSeconds }));
  const chordNotes: ChordCandidateNote[] = pitched
    .filter((n) => n.startTick * secondsPerTick < chordBars * barSeconds)
    .map((n) => ({ start: n.startTick * secondsPerTick, end: n.endTick * secondsPerTick, pitch: n.pitch }));
  const chords = chordBars ? estimateChords(chordNotes, spans) : [];
  let changes = 0;
  for (let i = 1; i < chords.length; i += 1) if (chords[i].symbol !== chords[i - 1].symbol) changes += 1;
  const harmony = {
    namedBars: chords.length,
    distinctChords: new Set(chords.map((c) => c.symbol)).size,
    chordChangeRate: chords.length > 1 ? round(changes / (chords.length - 1)) : null,
    namedShare: chordBars ? round(chords.length / chordBars) : 0,
  };

  // Density per family, notes per bar over the piece.
  const densityByFamily: Record<string, number> = {};
  if (grid.barCount) {
    const perFamily = new Map<string, number>();
    for (const note of grid.notes) perFamily.set(note.family, (perFamily.get(note.family) ?? 0) + 1);
    for (const [family, count] of perFamily) densityByFamily[family] = round(count / grid.barCount, 2);
  }

  // Phrase proxy: rest-delimited runs per pitched family, in beats.
  const runsByFamily = new Map<string, number[]>();
  const restSteps = 12; // one quarter note
  for (const family of families) {
    if (family === "drums") continue;
    const runs: number[] = [];
    const notes = grid.notes.filter((n) => n.family === family);
    let runStart = -1;
    let runEnd = -1;
    for (const note of notes) {
      const end = note.startStep + note.durationSteps;
      if (runStart < 0) {
        runStart = note.startStep;
        runEnd = end;
        continue;
      }
      if (note.startStep - runEnd >= restSteps) {
        runs.push((runEnd - runStart) / 12);
        runStart = note.startStep;
        runEnd = end;
      } else {
        runEnd = Math.max(runEnd, end);
      }
    }
    if (runStart >= 0) runs.push((runEnd - runStart) / 12);
    runsByFamily.set(family, runs);
  }
  const runs = [...runsByFamily.values()].flat();
  const melodyFamily = analyseScoreCells(midi, tokenizeOptions).melodyFamily;
  const melodyRuns = melodyFamily ? runsByFamily.get(melodyFamily) ?? [] : [];
  const phrase = {
    runs: runs.length,
    medianBeats: runs.length ? round(median(runs)!, 2) : null,
    meanBeats: runs.length ? round(runs.reduce((a, b) => a + b, 0) / runs.length, 2) : null,
    melodyMedianBeats: melodyRuns.length ? round(median(melodyRuns)!, 2) : null,
  };

  // Tasks of every type, uncapped.
  const taskCounts: Partial<Record<ArrangerTaskType, number>> = {};
  const taskFamilyCounts: Partial<Record<ArrangerTaskType, Record<string, number>>> = {};
  for (const spec of enumerateExtendedTasks(midi, workId, { maxPerType: Infinity, tokenize: tokenizeOptions })) {
    taskCounts[spec.type] = (taskCounts[spec.type] ?? 0) + 1;
    const byFamily = taskFamilyCounts[spec.type] ?? {};
    for (const family of spec.targetFamilies) byFamily[family] = (byFamily[family] ?? 0) + 1;
    taskFamilyCounts[spec.type] = byFamily;
  }

  return {
    version: CORPUS_PROFILE_VERSION,
    workId,
    trackCount: tracks.size,
    noteCount: midi.notes.length,
    programs: [...programs].sort((a, b) => a - b),
    families,
    pitchedFamilyCount,
    hasDrums,
    ensemble: ensembleClassOf(families),
    barCount: grid.barCount,
    meters,
    dominantMeter: meterSpan.dominant,
    meterChanges: meterSpan.changes,
    pickupBar: meterSpan.pickup,
    meterApproximated: grid.timeSigApproximated,
    tempos,
    key: key?.key ?? null,
    keyConfidence: key?.confidence ?? null,
    harmony,
    densityByFamily,
    melodyFamily,
    phrase,
    tokenCount: tokenize(midi, tokenizeOptions).length,
    fingerprint: fingerprintMidi(midi, workId, tokenizeOptions),
    taskCounts,
    taskFamilyCounts,
    genreFamily: genreFamilyOf(csv.genres),
    csv,
  };
}

// ---------------------------------------------------------------------------
// Aggregation
// ---------------------------------------------------------------------------

export type NumericSummary = { n: number; min: number; p10: number; p50: number; p90: number; max: number; mean: number };

export function summarise(values: readonly number[]): NumericSummary | null {
  if (!values.length) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const at = (q: number) => sorted[Math.min(sorted.length - 1, Math.floor(q * sorted.length))];
  return {
    n: sorted.length,
    min: sorted[0],
    p10: at(0.1),
    p50: at(0.5),
    p90: at(0.9),
    max: sorted[sorted.length - 1],
    mean: round(sorted.reduce((a, b) => a + b, 0) / sorted.length),
  };
}

function bump(map: Record<string, number>, key: string, by = 1): void {
  map[key] = (map[key] ?? 0) + by;
}

/** Perplexity of a count distribution: how many equally likely categories it is worth. */
export function effectiveCount(counts: readonly number[]): number {
  const total = counts.reduce((a, b) => a + b, 0);
  if (!total) return 0;
  let entropy = 0;
  for (const c of counts) {
    if (!c) continue;
    const p = c / total;
    entropy -= p * Math.log2(p);
  }
  return round(2 ** entropy, 1);
}

function topN(map: Record<string, number>, n: number): Record<string, number> {
  return Object.fromEntries(Object.entries(map).sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0])).slice(0, n));
}

export type CorpusAggregate = {
  works: number;
  byEnsemble: Record<EnsembleClass, number>;
  /** Works in which each family appears, by ensemble class. */
  familyPresence: { all: Record<string, number>; multitrack: Record<string, number> };
  /** Distinct family combinations among multitrack works, top 40; `effective` = 2^entropy, the number of equally-likely ensembles the distribution is worth. */
  ensembles: { distinct: number; effective: number; top: Record<string, number> };
  programsPerWork: NumericSummary | null;
  familiesPerWork: { all: NumericSummary | null; multitrack: NumericSummary | null };
  trackCount: { all: NumericSummary | null; multitrack: NumericSummary | null };
  barCount: { all: NumericSummary | null; multitrack: NumericSummary | null; multitrackHistogram: Record<string, number> };
  meters: {
    /** Works in which each metre appears anywhere. */
    top: Record<string, number>;
    /** Works by the metre that covers most of the piece. */
    dominantTop: Record<string, number>;
    dominantMultitrackTop: Record<string, number>;
    worksWithMeterChange: number;
    worksWithPickupBar: number;
    /** Works whose first metre — the one the tokenizer grid uses — is not the dominant one. */
    worksWhereFirstMeterIsNotDominant: number;
    worksWithApproximatedMeter: number;
  };
  tempos: { histogram: Record<string, number>; worksWithTempoChange: number };
  keys: { top: Record<string, number>; worksWithoutKey: number; major: number; minor: number };
  harmony: {
    distinctChords: { all: NumericSummary | null; multitrack: NumericSummary | null };
    chordChangeRate: { all: NumericSummary | null; multitrack: NumericSummary | null };
    namedShare: NumericSummary | null;
  };
  densityByFamily: Record<string, NumericSummary | null>;
  phraseMedianBeats: { all: NumericSummary | null; multitrack: NumericSummary | null; melody: NumericSummary | null };
  melodyFamily: Record<string, number>;
  tokenCount: { all: NumericSummary | null; multitrack: NumericSummary | null; multitrackUnder: Record<string, number> };
  genres: { byFamily: Record<string, number>; multitrackByFamily: Record<string, number>; rawTop: Record<string, number> };
  tasks: {
    byType: Record<string, number>;
    worksYieldingByType: Record<string, number>;
    byTypeAndFamily: Record<string, Record<string, number>>;
    byGenreFamily: Record<string, number>;
    byTypeAndGenreFamily: Record<string, Record<string, number>>;
    /** Tasks by the ensemble class of the work they come from — solo scores carry most of the corpus. */
    byEnsemble: Record<EnsembleClass, number>;
    byTypeAndEnsemble: Record<string, Record<EnsembleClass, number>>;
    /** Works of each ensemble class that yield at least one task of any type. */
    worksYieldingByEnsemble: Record<EnsembleClass, number>;
    /** Sum over types, per work — the capped variant uses `cap` per (work, type). */
    total: number;
    totalCapped: number;
    cap: number;
    worksYieldingAny: number;
  };
};

/** Aggregate work profiles into the distributions the corpus profile reports. */
export function aggregateProfiles(profiles: readonly WorkProfile[], options: { capPerType?: number } = {}): CorpusAggregate {
  const cap = options.capPerType ?? 4;
  const byEnsemble: Record<EnsembleClass, number> = { empty: 0, solo: 0, multitrack: 0 };
  const familyAll: Record<string, number> = {};
  const familyMulti: Record<string, number> = {};
  const ensembles: Record<string, number> = {};
  const meters: Record<string, number> = {};
  const dominantMeters: Record<string, number> = {};
  const dominantMultiMeters: Record<string, number> = {};
  const melodyFamilies: Record<string, number> = {};
  let pickup = 0;
  let firstNotDominant = 0;
  const phraseMelody: number[] = [];
  const tempoHist: Record<string, number> = {};
  const keys: Record<string, number> = {};
  const genreAll: Record<string, number> = {};
  const genreMulti: Record<string, number> = {};
  const genreRaw: Record<string, number> = {};
  const barHist: Record<string, number> = {};
  const tokenUnder: Record<string, number> = { "1024": 0, "2048": 0, "4096": 0, "8192": 0 };
  const density: Record<string, number[]> = {};
  const tasksByType: Record<string, number> = {};
  const worksByType: Record<string, number> = {};
  const tasksByTypeFamily: Record<string, Record<string, number>> = {};
  const tasksByGenre: Record<string, number> = {};
  const tasksByTypeGenre: Record<string, Record<string, number>> = {};
  const tasksByEnsemble: Record<EnsembleClass, number> = { empty: 0, solo: 0, multitrack: 0 };
  const tasksByTypeEnsemble: Record<string, Record<EnsembleClass, number>> = {};
  const yieldingByEnsemble: Record<EnsembleClass, number> = { empty: 0, solo: 0, multitrack: 0 };
  let meterChange = 0;
  let meterApprox = 0;
  let tempoChange = 0;
  let noKey = 0;
  let major = 0;
  let minor = 0;
  let total = 0;
  let totalCapped = 0;
  let yieldingAny = 0;

  const programsPer: number[] = [];
  const famAll: number[] = [];
  const famMulti: number[] = [];
  const trAll: number[] = [];
  const trMulti: number[] = [];
  const barsAll: number[] = [];
  const barsMulti: number[] = [];
  const chordsAll: number[] = [];
  const chordsMulti: number[] = [];
  const rateAll: number[] = [];
  const rateMulti: number[] = [];
  const named: number[] = [];
  const phraseAll: number[] = [];
  const phraseMulti: number[] = [];
  const tokAll: number[] = [];
  const tokMulti: number[] = [];

  for (const p of profiles) {
    const multi = p.ensemble === "multitrack";
    byEnsemble[p.ensemble] += 1;
    for (const f of p.families) {
      bump(familyAll, f);
      if (multi) bump(familyMulti, f);
    }
    if (multi) bump(ensembles, p.families.join("+"));
    programsPer.push(p.programs.length);
    famAll.push(p.families.length);
    trAll.push(p.trackCount);
    barsAll.push(p.barCount);
    if (multi) {
      famMulti.push(p.families.length);
      trMulti.push(p.trackCount);
      barsMulti.push(p.barCount);
      const bucket = p.barCount < 8 ? "<8" : p.barCount < 16 ? "8-15" : p.barCount < 32 ? "16-31" : p.barCount < 64 ? "32-63" : p.barCount < 128 ? "64-127" : p.barCount < 256 ? "128-255" : "256+";
      bump(barHist, bucket);
      for (const limit of Object.keys(tokenUnder)) if (p.tokenCount <= Number(limit)) tokenUnder[limit] += 1;
      tokMulti.push(p.tokenCount);
    }
    tokAll.push(p.tokenCount);
    for (const m of p.meters) bump(meters, m);
    bump(dominantMeters, p.dominantMeter);
    if (multi) bump(dominantMultiMeters, p.dominantMeter);
    if (p.pickupBar) pickup += 1;
    if (p.meters[0] !== undefined && p.meters[0] !== p.dominantMeter) firstNotDominant += 1;
    if (p.melodyFamily) bump(melodyFamilies, p.melodyFamily);
    if (p.phrase.melodyMedianBeats !== null) phraseMelody.push(p.phrase.melodyMedianBeats);
    if (p.meterChanges > 0) meterChange += 1;
    if (p.meterApproximated) meterApprox += 1;
    if (p.tempos.length > 1) tempoChange += 1;
    const t = p.tempos[0];
    if (t !== undefined) bump(tempoHist, t < 60 ? "<60" : t < 80 ? "60-79" : t < 100 ? "80-99" : t < 120 ? "100-119" : t < 140 ? "120-139" : t < 160 ? "140-159" : t < 200 ? "160-199" : "200+");
    if (p.key) {
      bump(keys, p.key);
      if (p.key.endsWith("major")) major += 1;
      else minor += 1;
    } else noKey += 1;
    chordsAll.push(p.harmony.distinctChords);
    if (p.harmony.chordChangeRate !== null) rateAll.push(p.harmony.chordChangeRate);
    if (multi) {
      chordsMulti.push(p.harmony.distinctChords);
      if (p.harmony.chordChangeRate !== null) rateMulti.push(p.harmony.chordChangeRate);
    }
    if (p.barCount) named.push(p.harmony.namedShare);
    for (const [f, d] of Object.entries(p.densityByFamily)) (density[f] ??= []).push(d);
    if (p.phrase.medianBeats !== null) {
      phraseAll.push(p.phrase.medianBeats);
      if (multi) phraseMulti.push(p.phrase.medianBeats);
    }
    bump(genreAll, p.genreFamily);
    if (multi) bump(genreMulti, p.genreFamily);
    bump(genreRaw, p.csv.genres?.trim() || "NA");

    let workTotal = 0;
    for (const type of ARRANGER_TASK_TYPES) {
      const n = p.taskCounts[type] ?? 0;
      if (!n) continue;
      workTotal += n;
      bump(tasksByType, type, n);
      bump(worksByType, type);
      totalCapped += Math.min(n, cap);
      const byFamily = (tasksByTypeFamily[type] ??= {});
      for (const [f, c] of Object.entries(p.taskFamilyCounts[type] ?? {})) bump(byFamily, f, c);
      bump(tasksByGenre, p.genreFamily, n);
      bump((tasksByTypeGenre[type] ??= {}), p.genreFamily, n);
      tasksByEnsemble[p.ensemble] += n;
      const byEns = (tasksByTypeEnsemble[type] ??= { empty: 0, solo: 0, multitrack: 0 });
      byEns[p.ensemble] += n;
    }
    total += workTotal;
    if (workTotal) {
      yieldingAny += 1;
      yieldingByEnsemble[p.ensemble] += 1;
    }
  }

  return {
    works: profiles.length,
    byEnsemble,
    familyPresence: { all: familyAll, multitrack: familyMulti },
    ensembles: { distinct: Object.keys(ensembles).length, effective: effectiveCount(Object.values(ensembles)), top: topN(ensembles, 40) },
    programsPerWork: summarise(programsPer),
    familiesPerWork: { all: summarise(famAll), multitrack: summarise(famMulti) },
    trackCount: { all: summarise(trAll), multitrack: summarise(trMulti) },
    barCount: { all: summarise(barsAll), multitrack: summarise(barsMulti), multitrackHistogram: barHist },
    meters: {
      top: topN(meters, 20),
      dominantTop: topN(dominantMeters, 20),
      dominantMultitrackTop: topN(dominantMultiMeters, 20),
      worksWithMeterChange: meterChange,
      worksWithPickupBar: pickup,
      worksWhereFirstMeterIsNotDominant: firstNotDominant,
      worksWithApproximatedMeter: meterApprox,
    },
    tempos: { histogram: tempoHist, worksWithTempoChange: tempoChange },
    keys: { top: topN(keys, 24), worksWithoutKey: noKey, major, minor },
    harmony: {
      distinctChords: { all: summarise(chordsAll), multitrack: summarise(chordsMulti) },
      chordChangeRate: { all: summarise(rateAll), multitrack: summarise(rateMulti) },
      namedShare: summarise(named),
    },
    densityByFamily: Object.fromEntries(FAMILIES.filter((f) => density[f]).map((f) => [f, summarise(density[f])])),
    phraseMedianBeats: { all: summarise(phraseAll), multitrack: summarise(phraseMulti), melody: summarise(phraseMelody) },
    melodyFamily: melodyFamilies,
    tokenCount: { all: summarise(tokAll), multitrack: summarise(tokMulti), multitrackUnder: tokenUnder },
    genres: { byFamily: genreAll, multitrackByFamily: genreMulti, rawTop: topN(genreRaw, 30) },
    tasks: {
      byType: tasksByType,
      worksYieldingByType: worksByType,
      byTypeAndFamily: tasksByTypeFamily,
      byGenreFamily: tasksByGenre,
      byTypeAndGenreFamily: tasksByTypeGenre,
      byEnsemble: tasksByEnsemble,
      byTypeAndEnsemble: tasksByTypeEnsemble,
      worksYieldingByEnsemble: yieldingByEnsemble,
      total,
      totalCapped,
      cap,
      worksYieldingAny: yieldingAny,
    },
  };
}
