/**
 * Motif ledger (Arrangement Brain, stream B-10, D1).
 *
 * The thematic memory the melodic engine writes from and writes into. Before
 * this stream the repo had two read-only motif lists (the musical map's
 * `melody.motifs`, `partGenerationContextV2.buildMotifMemory`) and no
 * consumer; the only "figure" a generated part carried was the constant
 * `[0, 1, 2, 1]` cell (diagnosis §4, §11).
 *
 * What the ledger knows:
 *   - **cells** — intervals + inter-onset ratios + span in beats. Ids are
 *     canonical under transposition, inversion, retrograde and
 *     retrograde-inversion, so a transformed statement is recognised as the
 *     same motif; a fragment or a sequence is a new id with a parent link.
 *   - **source motifs** — the singer's phrase cells (melody notes with
 *     confidence), segmented by the same gap rule the musical map uses; the
 *     most stated one is the hook. With no melody evidence the cell is
 *     *inferred* from a section's chord-root motion and the ledger says so
 *     (`status: "inferred"`); with nothing at all it is `empty`, never a
 *     pretended motif.
 *   - **occurrences** — every statement the arrangement makes: transformation,
 *     section, bars, instrument, intention, the notes, what earlier statement
 *     it develops, and how it was placed.
 *   - **withheld** — the hook's full statement is reserved until the arc's
 *     first `arrival` (fragments allowed before), so the climax states
 *     something the verse did not.
 *
 * Deterministic: no clock, no randomness; `digest()` is a sha256 of the data.
 */
import { createHash } from "node:crypto";
import type {
  ArcTensionRole,
  ChordHarmonyEvent,
  MotifCell,
  MotifLedgerData,
  MotifLedgerEntry,
  MotifOccurrenceRecord,
  MotifTransformation,
  MotifWithholding,
  SectionPlan,
  SongModelData,
} from "@workspace/db";

export const MOTIF_LEDGER_VERSION = "MOTIF_LEDGER_V1" as const;

export type TimedPitch = { start: number; end: number; pitch: number };

/** Melody notes below this confidence are not evidence of a sung cell. */
const MIN_MELODY_CONFIDENCE = 0.5;
/** A cell is at least three notes (two intervals) and at most five (the map's signature window). */
export const MIN_CELL_NOTES = 3;
export const MAX_CELL_NOTES = 5;
/** Rhythm ratios within this are "the same rhythm". */
const RHYTHM_TOLERANCE = 0.06;
/** Span ratios beyond these are augmentation / diminution rather than the same statement. */
const AUGMENTATION_RATIO = 1.5;
const DIMINUTION_RATIO = 1 / 1.5;

const r2 = (v: number) => Number(v.toFixed(2));
const r4 = (v: number) => Number(v.toFixed(4));

export function stableJson(value: unknown): string {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(stableJson).join(",")}]`;
  const record = value as Record<string, unknown>;
  const keys = Object.keys(record).filter((k) => record[k] !== undefined).sort();
  return `{${keys.map((k) => `${JSON.stringify(k)}:${stableJson(record[k])}`).join(",")}}`;
}

export const sha256 = (text: string): string => createHash("sha256").update(text).digest("hex");

// ---------------------------------------------------------------------------
// Cells
// ---------------------------------------------------------------------------

export function contourOf(intervals: readonly number[]): MotifCell["contour"] {
  if (!intervals.length || intervals.every((i) => i === 0)) return "flat";
  const ups = intervals.filter((i) => i > 0).length;
  const downs = intervals.filter((i) => i < 0).length;
  if (downs === 0) return "rising";
  if (ups === 0) return "falling";
  // Position of the extreme pitch along the cell decides arch / valley.
  let pitch = 0;
  const path = [0];
  for (const i of intervals) { pitch += i; path.push(pitch); }
  const max = Math.max(...path);
  const min = Math.min(...path);
  const peakAt = path.indexOf(max);
  const troughAt = path.indexOf(min);
  const inner = (at: number) => at > 0 && at < path.length - 1;
  if (inner(peakAt) && !inner(troughAt)) return "arch";
  if (inner(troughAt) && !inner(peakAt)) return "valley";
  return "mixed";
}

/** The cell of a note group (>= 3 notes), or null. Rhythm is IOI relative to the first IOI. */
export function cellOf(notes: readonly TimedPitch[], beatSeconds: number): MotifCell | null {
  const sorted = [...notes].sort((a, b) => a.start - b.start).slice(0, MAX_CELL_NOTES);
  if (sorted.length < MIN_CELL_NOTES) return null;
  const intervals: number[] = [];
  const iois: number[] = [];
  for (let i = 1; i < sorted.length; i += 1) {
    intervals.push(sorted[i].pitch - sorted[i - 1].pitch);
    iois.push(Math.max(1e-4, sorted[i].start - sorted[i - 1].start));
  }
  const rhythm = iois.map((v) => r2(v / iois[0]));
  const spanBeats = r2((sorted[sorted.length - 1].start - sorted[0].start) / Math.max(1e-6, beatSeconds));
  return { intervals, rhythm, spanBeats, contour: contourOf(intervals) };
}

const negate = (xs: readonly number[]) => xs.map((x) => -x);
const reverse = <T>(xs: readonly T[]) => [...xs].reverse();
/** IOI ratios read backwards, renormalised to the (new) first gap. */
function reverseRhythm(rhythm: readonly number[]): number[] {
  const rev = reverse(rhythm);
  const first = rev[0] || 1;
  return rev.map((v) => r2(v / first));
}

export type CellForm = "prime" | "inversion" | "retrograde" | "retrograde_inversion";

/** The four interval forms of a cell (retrograde of a melody reverses *and* negates its intervals). */
export function formsOf(cell: MotifCell): Array<{ form: CellForm; intervals: number[]; rhythm: number[] }> {
  return [
    { form: "prime", intervals: [...cell.intervals], rhythm: [...cell.rhythm] },
    { form: "inversion", intervals: negate(cell.intervals), rhythm: [...cell.rhythm] },
    { form: "retrograde", intervals: reverse(negate(cell.intervals)), rhythm: reverseRhythm(cell.rhythm) },
    { form: "retrograde_inversion", intervals: reverse(cell.intervals), rhythm: reverseRhythm(cell.rhythm) },
  ];
}

const formKey = (intervals: readonly number[], rhythm: readonly number[]) => `${intervals.join(",")}|${rhythm.join(",")}`;

/** Canonical fingerprint: the lexicographically smallest of the four forms. Equal for every transformation of the cell. */
export function fingerprintOf(cell: MotifCell): { fingerprint: string; canonicalForm: CellForm; key: string } {
  const forms = formsOf(cell).map((f) => ({ form: f.form, key: formKey(f.intervals, f.rhythm) }));
  forms.sort((a, b) => (a.key < b.key ? -1 : a.key > b.key ? 1 : 0));
  return { fingerprint: sha256(forms[0].key).slice(0, 12), canonicalForm: forms[0].form, key: forms[0].key };
}

export function motifIdOf(cell: MotifCell): string {
  return `motif-${fingerprintOf(cell).fingerprint.slice(0, 8)}`;
}

/** Cell fingerprint of a concrete note group as emitted (prime form only; what `MusicalNote.motif.fingerprint` carries). */
export function emittedFingerprint(cell: MotifCell): string {
  return sha256(formKey(cell.intervals, cell.rhythm)).slice(0, 12);
}

const sameIntervals = (a: readonly number[], b: readonly number[]) => a.length === b.length && a.every((v, i) => v === b[i]);
const sameRhythm = (a: readonly number[], b: readonly number[]) =>
  a.length === b.length && a.every((v, i) => Math.abs(v - b[i]) <= RHYTHM_TOLERANCE);

function isContiguousFragment(origin: readonly number[], candidate: readonly number[]): boolean {
  if (candidate.length < 2 || candidate.length >= origin.length) return false;
  for (let at = 0; at + candidate.length <= origin.length; at += 1) {
    if (candidate.every((v, i) => origin[at + i] === v)) return true;
  }
  return false;
}

function isSequenceOf(origin: readonly number[], candidate: readonly number[]): boolean {
  const n = origin.length;
  if (n === 0 || candidate.length <= n) return false;
  // k statements joined by k-1 joint intervals: length = k*n + (k-1).
  const k = (candidate.length + 1) / (n + 1);
  if (!Number.isInteger(k) || k < 2) return false;
  for (let s = 0; s < k; s += 1) {
    const at = s * (n + 1);
    if (!origin.every((v, i) => candidate[at + i] === v)) return false;
  }
  return true;
}

/**
 * How `candidate` relates to `origin`, or null when it is not the same motif.
 * Context refines the label: the same cell on another instrument is an
 * `orchestral_handoff`, under different harmony a `reharmonisation`.
 */
export function classifyTransformation(
  origin: MotifCell,
  candidate: MotifCell,
  context: { transposition?: number; sameInstrument?: boolean; sameHarmony?: boolean } = {},
): MotifTransformation | null {
  const o = origin.intervals;
  const c = candidate.intervals;
  const spanRatio = origin.spanBeats > 0 ? candidate.spanBeats / origin.spanBeats : 1;
  if (sameIntervals(o, c)) {
    if (sameRhythm(origin.rhythm, candidate.rhythm)) {
      if (spanRatio >= AUGMENTATION_RATIO) return "augmentation";
      if (spanRatio <= DIMINUTION_RATIO) return "diminution";
      if (context.sameInstrument === false) return "orchestral_handoff";
      if (context.sameHarmony === false) return "reharmonisation";
      return (context.transposition ?? 0) === 0 ? "repetition" : "transposition";
    }
    return "rhythmic_variation";
  }
  if (sameIntervals(negate(o), c)) return "inversion";
  if (sameIntervals(reverse(negate(o)), c)) return "retrograde";
  if (sameIntervals(reverse(o), c)) return "retrograde_inversion";
  if (isContiguousFragment(o, c)) return "fragmentation";
  if (isSequenceOf(o, c)) return "sequence";
  return null;
}

/** Apply a transformation to a cell (pitch-free: intervals and rhythm). */
export function transformCell(
  cell: MotifCell,
  transformation: MotifTransformation,
  options: { fragmentLength?: number; fragmentFrom?: "head" | "tail"; sequenceSteps?: number[]; factor?: number } = {},
): MotifCell {
  const done = (intervals: number[], rhythm: number[], spanBeats: number): MotifCell =>
    ({ intervals, rhythm, spanBeats: r2(spanBeats), contour: contourOf(intervals) });
  switch (transformation) {
    case "inversion":
      return done(negate(cell.intervals), [...cell.rhythm], cell.spanBeats);
    case "retrograde":
      return done(reverse(negate(cell.intervals)), reverseRhythm(cell.rhythm), cell.spanBeats);
    case "retrograde_inversion":
      return done(reverse(cell.intervals), reverseRhythm(cell.rhythm), cell.spanBeats);
    case "augmentation":
      return done([...cell.intervals], [...cell.rhythm], cell.spanBeats * (options.factor ?? 2));
    case "diminution":
      return done([...cell.intervals], [...cell.rhythm], cell.spanBeats / (options.factor ?? 2));
    case "fragmentation": {
      const length = Math.max(2, Math.min(cell.intervals.length - 1, options.fragmentLength ?? 2));
      const from = options.fragmentFrom ?? "head";
      const intervals = from === "head" ? cell.intervals.slice(0, length) : cell.intervals.slice(-length);
      const rhythmRaw = from === "head" ? cell.rhythm.slice(0, length) : cell.rhythm.slice(-length);
      const first = rhythmRaw[0] || 1;
      const rhythm = rhythmRaw.map((v) => r2(v / first));
      const share = rhythmRaw.reduce((s, v) => s + v, 0) / Math.max(1e-6, cell.rhythm.reduce((s, v) => s + v, 0));
      return done(intervals, rhythm, cell.spanBeats * share);
    }
    case "sequence": {
      const steps = options.sequenceSteps?.length ? options.sequenceSteps : [2];
      const intervals: number[] = [...cell.intervals];
      const rhythm: number[] = [...cell.rhythm];
      const total = cell.intervals.reduce((s, v) => s + v, 0);
      for (const step of steps) {
        // The joint: from the last note of one statement to the first of the next (a step above/below the start).
        intervals.push(step - total);
        rhythm.push(cell.rhythm[0] || 1);
        intervals.push(...cell.intervals);
        rhythm.push(...cell.rhythm);
      }
      return done(intervals, rhythm, cell.spanBeats * (steps.length + 1) + steps.length * (cell.spanBeats / Math.max(1, cell.intervals.length)));
    }
    case "repetition":
    case "transposition":
    case "reharmonisation":
    case "orchestral_handoff":
    case "register_displacement":
    case "answering_gesture":
    case "rhythmic_variation":
    default:
      return done([...cell.intervals], [...cell.rhythm], cell.spanBeats);
  }
}

// ---------------------------------------------------------------------------
// Source motifs
// ---------------------------------------------------------------------------

function median(values: number[]): number {
  if (!values.length) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
}

/** The musical map's phrase rule: a rest longer than max(0.6 s, 2.5 x median IOI) ends a phrase. */
export function segmentPhrases(notes: readonly TimedPitch[]): TimedPitch[][] {
  const sorted = [...notes].sort((a, b) => a.start - b.start);
  if (!sorted.length) return [];
  const iois: number[] = [];
  for (let i = 1; i < sorted.length; i += 1) iois.push(sorted[i].start - sorted[i - 1].start);
  const threshold = Math.max(0.6, median(iois.filter((v) => v > 0)) * 2.5);
  const phrases: TimedPitch[][] = [];
  let current: TimedPitch[] = [sorted[0]];
  for (let i = 1; i < sorted.length; i += 1) {
    if (sorted[i].start - sorted[i - 1].end > threshold) { phrases.push(current); current = [sorted[i]]; }
    else current.push(sorted[i]);
  }
  phrases.push(current);
  return phrases;
}

const NOTE_ROOTS: Record<string, number> = {
  C: 0, "C#": 1, DB: 1, D: 2, "D#": 3, EB: 3, E: 4, F: 5, "F#": 6, GB: 6, G: 7, "G#": 8, AB: 8, A: 9, "A#": 10, BB: 10, B: 11,
};
export function chordRootPitchClass(chord: Pick<ChordHarmonyEvent, "symbol" | "root">): number {
  const m = /^([A-Ga-g])([#b]?)/.exec((chord.root ?? chord.symbol).replace("♯", "#").replace("♭", "b").trim());
  if (!m) return 0;
  return NOTE_ROOTS[`${m[1].toUpperCase()}${m[2].toUpperCase()}`] ?? 0;
}

/** Root motion of the first distinct chords of a window as a cell: the harmonic contour, voiced by nearest motion from middle C. */
export function harmonicCell(chords: readonly ChordHarmonyEvent[], beatSeconds: number): { cell: MotifCell; symbols: string[]; notes: TimedPitch[] } | null {
  const distinct: ChordHarmonyEvent[] = [];
  for (const chord of [...chords].sort((a, b) => a.start - b.start)) {
    const last = distinct[distinct.length - 1];
    if (last && chordRootPitchClass(last) === chordRootPitchClass(chord)) continue;
    distinct.push(chord);
    if (distinct.length === MAX_CELL_NOTES) break;
  }
  if (distinct.length < MIN_CELL_NOTES) return null;
  let previous = 60;
  const notes: TimedPitch[] = distinct.map((chord) => {
    const pc = chordRootPitchClass(chord);
    let pitch = pc + 12 * Math.round((previous - pc) / 12);
    if (pitch - previous > 6) pitch -= 12;
    if (previous - pitch > 6) pitch += 12;
    previous = pitch;
    return { start: chord.start, end: chord.end, pitch };
  });
  const cell = cellOf(notes, beatSeconds);
  return cell ? { cell, symbols: distinct.map((c) => c.symbol), notes } : null;
}

// ---------------------------------------------------------------------------
// The ledger
// ---------------------------------------------------------------------------

export type MotifLedger = {
  readonly data: MotifLedgerData;
  /** Section names in form order (for withholding); empty when the builder had no sections. */
  readonly sectionOrder: readonly string[];
  entry(id: string): MotifLedgerEntry | undefined;
  hook(): MotifLedgerEntry | null;
  /** Source motifs sung inside [start, end), by first overlap. */
  sungIn(start: number, end: number): Array<{ entry: MotifLedgerEntry; occurrence: MotifLedgerEntry["sourceOccurrences"][number] }>;
  /** The source phrase that ended most recently before `time` (within `lookback` seconds). */
  lastSungBefore(time: number, lookback: number): { entry: MotifLedgerEntry; occurrence: MotifLedgerEntry["sourceOccurrences"][number] } | null;
  /** Why a full statement of `motifId` is not allowed in `sectionName` yet, or null. */
  withheldIn(motifId: string, sectionName: string, tensionRole?: ArcTensionRole | null): MotifWithholding | null;
  /** The latest arrangement statement an occurrence in (function, occurrenceIndex) may develop. */
  previousStatement(query: {
    sectionFunction: string | null; occurrenceIndex: number | null; intention?: MotifOccurrenceRecord["intention"]; motifId?: string;
  }): MotifOccurrenceRecord | null;
  /** Statements already made in a section by an instrument (so a second task does not restate the same cell at the same bars). */
  statementsIn(sectionName: string, instrument?: string): MotifOccurrenceRecord[];
  record(occurrence: Omit<MotifOccurrenceRecord, "index">): MotifOccurrenceRecord;
  /** Add an arrangement-born motif (an instrument's own statement) and return its entry. */
  adopt(cell: MotifCell, origin: Extract<MotifLedgerEntry["origin"], { kind: "instrument_statement" | "fallback_cell" }>): MotifLedgerEntry;
  note(text: string): void;
  digest(): string;
};

export function ledgerDigest(data: MotifLedgerData): string {
  return sha256(stableJson(data));
}

function wrap(data: MotifLedgerData, sectionOrder: string[], tensionRoles: Map<string, ArcTensionRole>): MotifLedger {
  const byId = new Map(data.entries.map((e) => [e.id, e]));
  const label = () => `Motif ${String.fromCharCode(65 + (data.entries.length % 26))}${data.entries.length >= 26 ? Math.floor(data.entries.length / 26) : ""}`;
  const ledger: MotifLedger = {
    data,
    sectionOrder,
    entry: (id) => byId.get(id),
    hook: () => (data.hookMotifId ? byId.get(data.hookMotifId) ?? null : null),
    sungIn(start, end) {
      const out: ReturnType<MotifLedger["sungIn"]> = [];
      for (const entry of data.entries) {
        for (const occurrence of entry.sourceOccurrences) {
          if (occurrence.endSeconds > start + 1e-6 && occurrence.startSeconds < end - 1e-6) out.push({ entry, occurrence });
        }
      }
      return out.sort((a, b) => a.occurrence.startSeconds - b.occurrence.startSeconds);
    },
    lastSungBefore(time, lookback) {
      let best: ReturnType<MotifLedger["lastSungBefore"]> = null;
      for (const entry of data.entries) {
        for (const occurrence of entry.sourceOccurrences) {
          if (occurrence.endSeconds <= time + 1e-6 && occurrence.endSeconds >= time - lookback &&
            (!best || occurrence.endSeconds > best.occurrence.endSeconds)) best = { entry, occurrence };
        }
      }
      return best;
    },
    withheldIn(motifId, sectionName, tensionRole) {
      const rule = data.withheld.find((w) => w.motifId === motifId);
      if (!rule) return null;
      if (rule.untilSectionName && sectionOrder.length) {
        const here = sectionOrder.indexOf(sectionName);
        const until = sectionOrder.indexOf(rule.untilSectionName);
        if (here >= 0 && until >= 0) return here < until ? rule : null;
      }
      // No section order (a local ledger): the arc's tension role decides.
      const role = tensionRole ?? tensionRoles.get(sectionName) ?? null;
      if (rule.untilTensionRole && role) return role === "setup" || role === "breath" ? rule : null;
      return null;
    },
    previousStatement(query) {
      const candidates = data.occurrences.filter((o) =>
        (query.motifId ? o.motifId === query.motifId : true) &&
        (query.intention ? o.intention === query.intention : true) &&
        o.sectionFunction === query.sectionFunction &&
        query.occurrenceIndex !== null && o.occurrenceIndex !== null && o.occurrenceIndex < query.occurrenceIndex);
      if (!candidates.length) return null;
      candidates.sort((a, b) => (b.occurrenceIndex ?? 0) - (a.occurrenceIndex ?? 0) || b.index - a.index);
      return candidates[0];
    },
    statementsIn: (sectionName, instrument) =>
      data.occurrences.filter((o) => o.sectionName === sectionName && (instrument ? o.instrument === instrument : true)),
    record(occurrence) {
      const full: MotifOccurrenceRecord = { ...occurrence, index: data.occurrences.length };
      data.occurrences.push(full);
      return full;
    },
    adopt(cell, origin) {
      const id = motifIdOf(cell);
      const existing = byId.get(id);
      if (existing) return existing;
      const entry: MotifLedgerEntry = {
        id, label: label(), fingerprint: fingerprintOf(cell).fingerprint, cell, origin, sourceOccurrences: [],
        rank: data.entries.length,
      };
      data.entries.push(entry);
      byId.set(id, entry);
      return entry;
    },
    note: (text) => { data.notes.push(text); },
    digest: () => ledgerDigest(data),
  };
  return ledger;
}

export type BuildMotifLedgerInput = {
  songModel: Pick<SongModelData, "melody" | "chords" | "sections">;
  /** The section plan's sections (form order, functions, tension roles). Falls back to the Song Model's sections. */
  sections?: ReadonlyArray<Pick<SectionPlan, "sectionName" | "startBar" | "endBar" | "function" | "tensionRole"> & { startSeconds?: number; endSeconds?: number }>;
  beatSeconds: number;
  /** Seconds of each bar's downbeat, when the caller has a bar grid (used to place the inferred harmonic cells). */
  barStart?: (bar: number) => number;
  minConfidence?: number;
};

/** Build the ledger from the source: melody evidence first, the chord structure as a labelled inference, else empty. */
export function buildMotifLedger(input: BuildMotifLedgerInput): MotifLedger {
  const beatSeconds = Math.max(1e-3, input.beatSeconds);
  const minConfidence = input.minConfidence ?? MIN_MELODY_CONFIDENCE;
  const sections: NonNullable<BuildMotifLedgerInput["sections"]> = input.sections ?? (input.songModel.sections ?? []).map((s) => ({
    sectionName: s.name, startBar: s.startBar, endBar: s.endBar, function: "neutral" as const, tensionRole: undefined,
  }));
  const sectionOrder = sections.map((s) => s.sectionName);
  const tensionRoles = new Map<string, ArcTensionRole>();
  for (const s of sections) if (s.tensionRole) tensionRoles.set(s.sectionName, s.tensionRole);

  const data: MotifLedgerData = {
    version: MOTIF_LEDGER_VERSION, status: "empty", source: "none", reason: "", entries: [], hookMotifId: null,
    withheld: [], occurrences: [], notes: [],
  };

  const melody = (input.songModel.melody ?? [])
    .filter((n) => (n.confidence ?? 0) >= minConfidence && Number.isFinite(n.pitch))
    .map((n) => ({ start: n.start, end: n.end, pitch: n.pitch }));
  const confidenceOf = new Map<number, number>();
  for (const n of input.songModel.melody ?? []) confidenceOf.set(n.start, n.confidence ?? 0);

  const grouped = new Map<string, MotifLedgerEntry>();
  const firstCellOf = new Map<string, { cell: MotifCell; firstPitch: number }>();

  if (melody.length >= MIN_CELL_NOTES) {
    const phrases = segmentPhrases(melody);
    phrases.forEach((phrase, index) => {
      const cell = cellOf(phrase, beatSeconds);
      if (!cell) return;
      const id = motifIdOf(cell);
      const phraseId = `src-phrase-${index + 1}`;
      const firstPitch = phrase[0].pitch;
      const conf = phrase.reduce((s, n) => s + (confidenceOf.get(n.start) ?? 0), 0) / phrase.length;
      let entry = grouped.get(id);
      if (!entry) {
        entry = {
          id, label: "", fingerprint: fingerprintOf(cell).fingerprint, cell,
          origin: { kind: "source_phrase", phraseId, startSeconds: r4(phrase[0].start), endSeconds: r4(phrase[phrase.length - 1].end), noteCount: phrase.length, confidence: r2(conf) },
          sourceOccurrences: [], rank: -1,
        };
        grouped.set(id, entry);
        firstCellOf.set(id, { cell, firstPitch });
      }
      const first = firstCellOf.get(id)!;
      const transposition = firstPitch - first.firstPitch;
      entry.sourceOccurrences.push({
        phraseId, startSeconds: r4(phrase[0].start), endSeconds: r4(phrase[phrase.length - 1].end), firstPitch, transposition,
        transformation: classifyTransformation(first.cell, cell, { transposition }) ?? "repetition",
      });
    });
    if (grouped.size) {
      data.status = "available";
      data.source = "melody_notes";
      data.reason = `${grouped.size} motif(s) from ${phrases.length} sung phrase(s) (${melody.length} melody notes at confidence >= ${minConfidence})`;
    }
  }

  if (!grouped.size) {
    // No sung cell: the chord structure, labelled as an inference.
    const chords = input.songModel.chords ?? [];
    const windows = sections.length
      ? sections.map((s) => ({
          name: s.sectionName,
          start: s.startSeconds ?? input.barStart?.(s.startBar) ?? null,
          end: s.endSeconds ?? input.barStart?.(s.endBar + 1) ?? null,
        }))
      : [];
    for (const window of windows) {
      const inside = window.start !== null && window.end !== null
        ? chords.filter((c) => c.end > window.start! + 1e-6 && c.start < window.end! - 1e-6)
        : [];
      const harmonic = harmonicCell(inside, beatSeconds);
      if (!harmonic) continue;
      const id = motifIdOf(harmonic.cell);
      const phraseId = `inferred-${window.name}`.replace(/\s+/g, "_");
      const firstPitch = harmonic.notes[0].pitch;
      let entry = grouped.get(id);
      if (!entry) {
        entry = {
          id, label: "", fingerprint: fingerprintOf(harmonic.cell).fingerprint, cell: harmonic.cell,
          origin: {
            kind: "harmonic_inference", sectionName: window.name, chordSymbols: harmonic.symbols,
            reason: "no melody evidence (vocal map not available, melody empty): the cell is the root motion of the section's first chords - an inference, not a heard motif",
          },
          sourceOccurrences: [], rank: -1,
        };
        grouped.set(id, entry);
        firstCellOf.set(id, { cell: harmonic.cell, firstPitch });
      }
      const first = firstCellOf.get(id)!;
      const transposition = firstPitch - first.firstPitch;
      entry.sourceOccurrences.push({
        phraseId, startSeconds: r4(harmonic.notes[0].start), endSeconds: r4(harmonic.notes[harmonic.notes.length - 1].end),
        firstPitch, transposition, transformation: classifyTransformation(first.cell, harmonic.cell, { transposition }) ?? "repetition",
      });
    }
    if (grouped.size) {
      data.status = "inferred";
      data.source = "harmonic_inference";
      data.reason = `no melody evidence: ${grouped.size} cell(s) inferred from the chord-root motion of ${windows.length} section(s)`;
    } else {
      data.reason = melody.length
        ? `melody has ${melody.length} note(s) but no phrase of >= ${MIN_CELL_NOTES} notes`
        : "no melody evidence and no section with >= 3 distinct chord roots: nothing to state";
    }
  }

  // Rank: most stated first, then earliest.
  const entries = [...grouped.values()].sort((a, b) =>
    b.sourceOccurrences.length - a.sourceOccurrences.length ||
    a.sourceOccurrences[0].startSeconds - b.sourceOccurrences[0].startSeconds);
  entries.forEach((entry, rank) => {
    entry.rank = rank;
    entry.label = `Motif ${String.fromCharCode(65 + (rank % 26))}${rank >= 26 ? Math.floor(rank / 26) : ""}`;
  });
  data.entries = entries;
  data.hookMotifId = entries[0]?.id ?? null;

  // Withholding: the hook's full statement waits for the arc's first arrival (or the first chorus).
  if (data.hookMotifId) {
    const arrival = sections.find((s) => s.tensionRole === "arrival") ?? sections.find((s) => s.function === "chorus");
    const before = sections.findIndex((s) => s.sectionName === arrival?.sectionName);
    if (arrival && before > 0) {
      data.withheld.push({
        motifId: data.hookMotifId, untilSectionName: arrival.sectionName,
        untilTensionRole: arrival.tensionRole ?? null, allowedBefore: ["fragmentation"],
        reason: `the hook (${entries[0].label}) is stated in full from "${arrival.sectionName}" (${arrival.tensionRole ?? arrival.function}); before it only a fragment, so the arrival says something the setup did not`,
      });
    } else if (!sections.length) {
      data.withheld.push({
        motifId: data.hookMotifId, untilSectionName: null, untilTensionRole: "arrival", allowedBefore: ["fragmentation"],
        reason: `no section order known: the hook (${entries[0].label}) is fragmented in setup / breath sections and stated in full elsewhere`,
      });
    }
  }
  return wrap(data, sectionOrder, tensionRoles);
}

/** Evidence-friendly summary. */
export function summariseMotifLedger(data: MotifLedgerData) {
  return {
    version: data.version, status: data.status, source: data.source, reason: data.reason, digest: ledgerDigest(data),
    hook: data.hookMotifId,
    motifs: data.entries.map((e) => ({
      id: e.id, label: e.label, rank: e.rank, intervals: e.cell.intervals, rhythm: e.cell.rhythm, spanBeats: e.cell.spanBeats,
      contour: e.cell.contour, origin: e.origin, sourceStatements: e.sourceOccurrences.length,
      sourceTransformations: [...new Set(e.sourceOccurrences.map((o) => o.transformation))],
    })),
    withheld: data.withheld,
    occurrences: data.occurrences.map((o) => ({
      index: o.index, motif: o.motifId, transformation: o.transformation, intended: o.intendedTransformation, transposition: o.transposition, section: o.sectionName,
      sectionFunction: o.sectionFunction, occurrenceIndex: o.occurrenceIndex, bars: [o.startBar, o.endBar], instrument: o.instrument,
      intention: o.intention, notes: o.noteIds.length, recallOf: o.recallOf, placement: o.placement, reason: o.reason,
    })),
    notes: data.notes,
  };
}
