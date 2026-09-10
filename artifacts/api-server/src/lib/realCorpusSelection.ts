/**
 * Tier H selection (Brain B-08, evaluation audit §7.2): which PDMX works enter
 * `REAL_BENCHMARK_CORPUS`, and on what measured evidence.
 *
 * The corpus plan's rule is "coverage is measured, not assumed". PDMX.csv
 * carries no time signature and no feel, so every attribute that decides
 * coverage is read from the MIDI itself here: the metre (one per work, or the
 * work is refused — bar numbers must mean one thing), the first tempo, the
 * bar count, the families present, the total onsets per bar, the ensemble
 * size, and a swing ratio measured on off-beat onset phases. What the CSV does
 * carry (rights, title, genre, pitch-class entropy) is read through
 * `pdmxCsv.ts` / `pdmxIngest.ts` exactly as the ingest reads it.
 *
 * Selection is deterministic: the works the repo already used as tournament
 * anchors come first, then each required coverage value is filled to
 * `MIN_PER_VALUE` from the scan in a stable order. A value the scan cannot
 * fill is left short, and `corpusCoverage` reports it in `gaps[]` — never
 * filled synthetically.
 */
import { familyOf } from "./arrangerRemi";
import {
  MIN_PER_VALUE,
  REQUIRED_COVERAGE,
  type CorpusDensity,
  type CorpusEnsemble,
  type CorpusEntry,
  type CorpusFeel,
  type CorpusHarmony,
  type CorpusIdiom,
  type CorpusTempoBand,
} from "./benchmarkCorpusPlan";
import type { ParsedMidi } from "./midiFile";
import { classifyPdmxGenre, type PdmxGenre } from "./pdmxGenre";
import type { PdmxCsvRow } from "./pdmxCsv";
import { pdmxRightsBasis } from "./pdmxIngest";

export const REAL_CORPUS_SELECTION_VERSION = "1.0" as const;

/** Off-beat onsets whose phase sits in the triplet band, over all off-beat onsets, at or above this: swung. */
export const SWING_RATIO_THRESHOLD = 0.6;
/** Fewer off-beat onsets than this and the swing ratio is an anecdote. */
export const SWING_MIN_OFFBEATS = 24;
/** Notes a (track, program) group needs to count as a part. */
export const MIN_PART_NOTES = 8;

export type PdmxMeasurement = {
  meter: string;
  tempoBpm: number | null;
  tempoChanges: number;
  bars: number;
  /** Parts: (track, program) groups with at least MIN_PART_NOTES notes. */
  tracks: number;
  families: string[];
  notesPerBar: number;
  /** Share of off-beat onsets in the triplet band; null when there are too few off-beat onsets to say. */
  swingRatio: number | null;
  offbeatOnsets: number;
  notes: number;
};

export type MeasuredWork =
  | { ok: true; measurement: PdmxMeasurement }
  | { ok: false; refusal: string };

/** Everything the coverage attributes rest on, read from the parsed MIDI. */
export function measurePdmxWork(midi: ParsedMidi): MeasuredWork {
  if (!midi.notes.length) return { ok: false, refusal: "no notes" };
  const metres = new Set(midi.timeSignatures.map((t) => `${t.numerator}/${t.denominator}`));
  if (metres.size > 1) return { ok: false, refusal: `metre changes (${[...metres].join(", ")}); bar numbers would not mean one thing` };
  const ts = midi.timeSignatures[0] ?? { numerator: 4, denominator: 4 };
  const meter = midi.timeSignatures.length ? `${ts.numerator}/${ts.denominator}` : "unknown";
  if (ts.numerator <= 0 || ts.denominator <= 0) return { ok: false, refusal: "unreadable time signature" };
  const ticksPerBeat = midi.ticksPerQuarter * (4 / ts.denominator);
  const ticksPerBar = ticksPerBeat * ts.numerator;
  const bars = Math.max(1, Math.ceil(midi.endTick / ticksPerBar));

  const groups = new Map<string, number>();
  const familySet = new Set<string>();
  for (const note of midi.notes) {
    const key = `${note.track}:${note.isPercussion ? 128 : note.program}`;
    groups.set(key, (groups.get(key) ?? 0) + 1);
  }
  let tracks = 0;
  for (const [key, count] of groups) {
    if (count < MIN_PART_NOTES) continue;
    tracks += 1;
    const program = Number(key.split(":")[1]);
    familySet.add(program === 128 ? "drums" : familyOf({ program, isPercussion: false }));
  }

  // Swing: the phase of every onset inside its beat. Straight eighths sit at
  // 0.5, swung (triplet) eighths at 0.667; only off-beat onsets are read.
  let straight = 0;
  let triplet = 0;
  let offbeat = 0;
  for (const note of midi.notes) {
    const phase = (note.startTick % ticksPerBeat) / ticksPerBeat;
    if (phase < 0.4 || phase > 0.75) continue;
    offbeat += 1;
    if (phase >= 0.45 && phase <= 0.55) straight += 1;
    else if (phase >= 0.62 && phase <= 0.72) triplet += 1;
  }
  const swingRatio = offbeat >= SWING_MIN_OFFBEATS && straight + triplet > 0 ? Number((triplet / (straight + triplet)).toFixed(4)) : null;

  const tempo = midi.tempos[0]?.bpm;
  return {
    ok: true,
    measurement: {
      meter,
      tempoBpm: tempo && tempo >= 20 && tempo <= 400 ? Number(tempo.toFixed(2)) : null,
      tempoChanges: Math.max(0, midi.tempos.length - 1),
      bars,
      tracks,
      families: [...familySet].sort(),
      notesPerBar: Number((midi.notes.length / bars).toFixed(2)),
      swingRatio,
      offbeatOnsets: offbeat,
      notes: midi.notes.length,
    },
  };
}

const NON_WESTERN = /(klezmer|mizrahi|arab|indian|raga|turkish|balkan|persian|chinese|japanese|gamelan|african|world)/i;

/** The corpus attributes from a measurement and the CSV row — the same thresholds `pdmxIngest.ts` states. */
export function attributesFromMeasurement(m: PdmxMeasurement, row: Pick<PdmxCsvRow, "n_pitch_classes" | "genres" | "tags" | "groups">): CorpusEntry["attributes"] & { genre: PdmxGenre } {
  const tempoBand: CorpusTempoBand = m.tempoBpm === null ? "medium" : m.tempoBpm < 76 ? "slow" : m.tempoBpm > 132 ? "fast" : "medium";
  const compound = /^(6|9|12)\/8$/.test(m.meter);
  const feel: CorpusFeel = compound ? "compound" : m.swingRatio !== null && m.swingRatio >= SWING_RATIO_THRESHOLD ? "swung" : "straight";
  const pcs = row.n_pitch_classes;
  const harmony: CorpusHarmony = pcs === undefined ? "moderate" : pcs <= 7 ? "simple" : pcs <= 9 ? "moderate" : "complex";
  const density: CorpusDensity = m.notesPerBar < 6 ? "sparse" : m.notesPerBar > 16 ? "dense" : "moderate";
  const ensemble: CorpusEnsemble = m.tracks <= 1 ? "solo" : m.tracks <= 5 ? "small" : "large";
  const genre = classifyPdmxGenre({ genres: typeof row.genres === "string" ? row.genres : row.genres?.join("-"), tags: row.tags, groups: row.groups });
  const text = [typeof row.genres === "string" ? row.genres : row.genres?.join(" "), row.tags, row.groups].filter(Boolean).join(" ");
  const idiom: CorpusIdiom = genre.families.includes("world_traditional") || NON_WESTERN.test(text) ? "non_western" : "western";
  return {
    tempoBand, meter: m.meter, feel, harmony, density, ensemble, idiom,
    // A score carries no production: calling it acoustic would be a guess.
    production: "acoustic",
    tradition: idiom === "non_western" ? genre.primary : undefined,
    genre,
  };
}

export type TierHCandidate = {
  row: PdmxCsvRow;
  measurement: PdmxMeasurement;
  relativePath: string;
  sha256: string;
  admittedBy: NonNullable<CorpusEntry["symbolicSource"]>["admittedBy"];
};

/** A corpus entry from a measured candidate. */
export function tierHEntry(candidate: TierHCandidate, clearedAt: string): CorpusEntry {
  const { genre, ...attributes } = attributesFromMeasurement(candidate.measurement, candidate.row);
  const m = candidate.measurement;
  return {
    id: `pdmx-${candidate.row.id}`,
    title: candidate.row.title?.trim() || `PDMX ${candidate.row.id}`,
    inputType: "midi",
    rights: pdmxRightsBasis(candidate.row, clearedAt),
    attributes,
    symbolicSource: {
      kind: "pdmx_midi",
      workId: candidate.row.id,
      relativePath: candidate.relativePath,
      sha256: candidate.sha256,
      admittedBy: candidate.admittedBy,
      measured: {
        bars: m.bars, tracks: m.tracks, families: m.families, meter: m.meter, tempoBpm: m.tempoBpm,
        tempoChanges: m.tempoChanges, notesPerBar: m.notesPerBar, swingRatio: m.swingRatio,
        effectivePitchClasses: candidate.row.n_pitch_classes === undefined ? null : Number(candidate.row.n_pitch_classes.toFixed(2)),
      },
      genre: { primary: genre.primary, families: [...genre.families], source: genre.source },
    },
  };
}

/** Whether a measured work is Tier H material at all: a real ensemble of a benchmarkable length. */
export function tierHRefusal(m: PdmxMeasurement): string | null {
  const pitched = m.families.filter((f) => f !== "drums");
  if (!(pitched.length >= 2 || (pitched.length >= 1 && m.families.includes("drums")))) return "not multitrack: fewer than two pitched families and no drums";
  if (m.bars < 16) return `${m.bars} bars: shorter than a benchmark task`;
  if (m.bars > 256) return `${m.bars} bars: longer than the tournament task builder handles in one form`;
  if (m.tempoBpm === null) return "no usable tempo";
  return null;
}

const hash32 = (s: string): number => {
  let h = 2166136261;
  for (let i = 0; i < s.length; i += 1) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619) >>> 0; }
  return h;
};

/**
 * Deterministic quota fill. For every required value below `MIN_PER_VALUE`,
 * rarest value first, candidates that carry it are taken in a stable order —
 * the already-admitted tournament works (seeds) first, then genre-labelled
 * works of 3–8 families and 24–128 bars, then the rest by a hash of the id.
 * Remaining slots up to `max` go to seeds, then to the pool, in the same
 * order. Returns the chosen entries and what stayed short.
 */
export function selectTierH(
  seeds: readonly CorpusEntry[],
  pool: readonly CorpusEntry[],
  options: { max?: number; minPerValue?: number } = {},
): { chosen: CorpusEntry[]; short: Array<{ dimension: string; value: string; have: number }> } {
  const max = options.max ?? 40;
  const min = options.minPerValue ?? MIN_PER_VALUE;
  const chosen: CorpusEntry[] = [];
  const seen = new Set<string>();
  const add = (e: CorpusEntry) => { if (!seen.has(e.id) && chosen.length < max) { chosen.push(e); seen.add(e.id); } };
  const seedIds = new Set(seeds.map((s) => s.id));

  const readers: Record<string, (e: CorpusEntry) => string> = {
    inputType: (e) => e.inputType,
    tempoBand: (e) => e.attributes.tempoBand,
    meter: (e) => e.attributes.meter,
    feel: (e) => e.attributes.feel,
    harmony: (e) => e.attributes.harmony,
    density: (e) => e.attributes.density,
    ensemble: (e) => e.attributes.ensemble,
    idiom: (e) => e.attributes.idiom,
    production: (e) => e.attributes.production,
  };
  const preference = (e: CorpusEntry): number => {
    const m = e.symbolicSource?.measured;
    let score = seedIds.has(e.id) ? 8 : 0;
    if (e.symbolicSource?.genre && e.symbolicSource.genre.source !== "none") score += 2;
    if (m && m.families.length >= 3 && m.families.length <= 8) score += 1;
    if (m && m.bars >= 24 && m.bars <= 128) score += 1;
    return score;
  };
  const byId = new Map<string, CorpusEntry>();
  for (const e of [...seeds, ...pool]) if (!byId.has(e.id)) byId.set(e.id, e);
  const ordered = [...byId.values()].sort((a, b) => preference(b) - preference(a) || hash32(a.id) - hash32(b.id));
  const short: Array<{ dimension: string; value: string; have: number }> = [];
  // Hardest values first: the rarer the value in PDMX, the earlier it should claim its slots.
  const order: Array<[string, string]> = [
    ["idiom", "non_western"], ["feel", "swung"], ["meter", "6/8"], ["meter", "3/4"], ["density", "dense"], ["ensemble", "large"],
    ["density", "sparse"], ["tempoBand", "slow"], ["tempoBand", "fast"], ["harmony", "complex"], ["harmony", "simple"],
    ["ensemble", "small"], ["tempoBand", "medium"], ["harmony", "moderate"], ["feel", "straight"], ["meter", "4/4"],
  ];
  const requiredPairs = new Set(Object.entries(REQUIRED_COVERAGE).flatMap(([d, vs]) => (vs as readonly string[]).map((v) => `${d}:${v}`)));
  for (const [dimension, value] of order) {
    if (!requiredPairs.has(`${dimension}:${value}`)) continue;
    const have = () => chosen.filter((e) => readers[dimension](e) === value).length;
    for (const e of ordered) {
      if (have() >= min || chosen.length >= max) break;
      if (readers[dimension](e) === value) add(e);
    }
    if (have() < min) short.push({ dimension, value, have: have() });
  }
  // The remaining slots: seeds first (they are already-admitted anchors), then the pool.
  for (const e of ordered) {
    if (chosen.length >= max) break;
    add(e);
  }
  return { chosen, short };
}
