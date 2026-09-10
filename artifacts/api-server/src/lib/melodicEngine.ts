/**
 * Melodic engine (Arrangement Brain, stream B-10, D2).
 *
 * Writes the three kinds of melodic line the arrangement needs and that the
 * reference composer never had (diagnosis §4: "no melodic writing exists"):
 *
 *   answer      — in a vocal gap: a source motif transformed to answer the
 *                 cell the singer just sang (mirrored after a rising cell,
 *                 confirmed at an arrival), chord tones on strong beats,
 *                 passing tones between, a fifth clear of the voice, never
 *                 over a sung note.
 *   counterline — under the voice, phrase by phrase: motif cells whose form
 *                 (prime / inversion / retrograde / sequence / augmentation)
 *                 is chosen for contrary or oblique motion against the bass,
 *                 in a register away from the singer.
 *   lead        — an instrumental section's line stating the hook.
 *
 * Recall: a later statement of the same section function looks the ledger
 * up for what the earlier one said and develops it (a different
 * transformation, `recallOf` set) — `activate_counterline` is realised here
 * by quoting the previous occurrence's answers.
 *
 * Every note carries `MusicalNote.motif` filled from what was actually
 * emitted: the motif id, the fingerprint of the emitted cell, the detected
 * relation to the origin (re-classified after chord snapping; when the
 * intervals were bent the label is `harmonic_adaptation`, not the intent),
 * the phrase answered, the intention and a sha256 of the evidence the
 * decision rested on.
 *
 * Deterministic: the seed only breaks ties between equally scored forms.
 */
import type {
  ArcTensionRole,
  ChordHarmonyEvent,
  MotifCell,
  MotifLedgerEntry,
  MotifOccurrenceRecord,
  MotifTransformation,
  MusicalNote,
  PhraseIntention,
  SectionDevelopmentOperator,
} from "@workspace/db";
import { chordPitchClasses } from "./composer/harmonyParts";
import {
  cellOf, classifyTransformation, emittedFingerprint, motifIdOf, sha256, stableJson, transformCell,
  type MotifLedger, type TimedPitch,
} from "./motifLedger";

export const MELODIC_ENGINE_VERSION = "MELODIC_ENGINE_V1" as const;

export type EngineNote = MusicalNote & { motif: NonNullable<MusicalNote["motif"]> };

export type LineKind = "answer" | "counterline" | "lead";

export type MelodicSectionContext = {
  name: string;
  function: string | null;
  occurrenceIndex: number | null;
  developmentOperator: SectionDevelopmentOperator | null;
  tensionRole: ArcTensionRole | null;
};

export type MelodicLineRequest = {
  kind: LineKind;
  /** Seconds the line may occupy. */
  window: { start: number; end: number };
  /** Plan phrase units inside the window (counterline / lead); defaults to 2-bar units. */
  units?: Array<{ start: number; end: number; id?: string }>;
  beatSeconds: number;
  beatsPerBar: number;
  /** Absolute seconds of bar 1's downbeat. */
  originSeconds: number;
  chords: readonly ChordHarmonyEvent[];
  range: { lo: number; hi: number };
  maxLeap: number;
  minNoteDuration: number;
  /** Sung notes (evidence). Empty when the source has no melody evidence. */
  vocal: readonly TimedPitch[];
  /** Bass reference for contrary motion: the source bass, or the chord roots when there is none. */
  bass: readonly TimedPitch[];
  bassReference: "source_bass" | "chord_roots" | "sibling_part";
  ledger: MotifLedger;
  section: MelodicSectionContext;
  instrument: string;
  taskId: string | null;
  /** Prefix of the emitted note ids (`${prefix}-${i}`); the caller owns the id scheme. */
  idPrefix: string;
  phraseId: string;
  baseVelocity: number;
  density: number;
  seed: number;
  placement: MotifOccurrenceRecord["placement"];
  /** Which motif to state; defaults to the ledger's choice (the phrase just sung, else the hook). */
  motifId?: string;
};

export type MotionRate = { contrary: number; oblique: number; similar: number; parallel: number; pairs: number; rate: number };

export type MelodicLineResult = {
  notes: EngineNote[];
  occurrences: MotifOccurrenceRecord[];
  decisions: string[];
  metrics: {
    motionVsBass: MotionRate | null;
    /** Smallest |line pitch - sung pitch| over time-overlapping pairs; null when nothing overlaps. */
    vocalClearance: number | null;
    overlapsVocal: boolean;
    /** Share of the intended cell's intervals preserved after chord snapping, per unit. */
    intervalFidelity: number[];
  };
};

/** The legacy figure of the reference composer, kept only as the labelled fallback when the ledger is empty. */
export const FALLBACK_CELL: MotifCell = { intervals: [1, 1, -1], rhythm: [1, 1, 1], spanBeats: 2.25, contour: "arch" };

const VOCAL_CLEARANCE = 7;
const BASS_CLEARANCE = 7;
const r4 = (v: number) => Number(v.toFixed(4));
const sign = (v: number) => (v > 0 ? 1 : v < 0 ? -1 : 0);

// ---------------------------------------------------------------------------
// Metrics (exported: the tests and the evidence measure with the same code)
// ---------------------------------------------------------------------------

function soundingAt(notes: readonly TimedPitch[], time: number): TimedPitch | null {
  let best: TimedPitch | null = null;
  for (const n of notes) {
    if (n.start <= time + 1e-6 && n.end > time + 1e-6) return n;
    if (n.start <= time + 1e-6 && (!best || n.start > best.start)) best = n;
  }
  return best;
}

/** Motion classes between consecutive line notes and the bass sounding under each onset. Static pairs (both hold) are excluded. */
export function motionRateVsBass(line: readonly TimedPitch[], bass: readonly TimedPitch[]): MotionRate | null {
  const sorted = [...line].sort((a, b) => a.start - b.start);
  if (sorted.length < 2 || !bass.length) return null;
  let contrary = 0, oblique = 0, similar = 0, parallel = 0, pairs = 0;
  for (let i = 1; i < sorted.length; i += 1) {
    const a = sorted[i - 1];
    const b = sorted[i];
    const ba = soundingAt(bass, a.start);
    const bb = soundingAt(bass, b.start);
    if (!ba || !bb) continue;
    const dl = sign(b.pitch - a.pitch);
    const db = sign(bb.pitch - ba.pitch);
    if (dl === 0 && db === 0) continue;
    pairs += 1;
    if (dl === 0 || db === 0) oblique += 1;
    else if (dl !== db) contrary += 1;
    else if (((b.pitch - bb.pitch) - (a.pitch - ba.pitch)) === 0 && [0, 7].includes((((a.pitch - ba.pitch) % 12) + 12) % 12)) { parallel += 1; similar += 1; }
    else similar += 1;
  }
  return { contrary, oblique, similar, parallel, pairs, rate: pairs ? (contrary + oblique) / pairs : 0 };
}

const overlaps = (a: TimedPitch, b: TimedPitch) => a.start < b.end - 1e-3 && b.start < a.end - 1e-3;

export function vocalClearance(line: readonly TimedPitch[], vocal: readonly TimedPitch[]): number | null {
  let min: number | null = null;
  for (const n of line) for (const v of vocal) {
    if (!overlaps(n, v)) continue;
    const d = Math.abs(n.pitch - v.pitch);
    if (min === null || d < min) min = d;
  }
  return min;
}

export function overlapsVocal(line: readonly TimedPitch[], vocal: readonly TimedPitch[]): boolean {
  return line.some((n) => vocal.some((v) => overlaps(n, v)));
}

/** Merged sung spans (gaps under `mergeGap` seconds closed) — what "the singer is singing" means to the engine. */
export function sungSpans(vocal: readonly TimedPitch[], mergeGap: number): Array<{ start: number; end: number }> {
  const sorted = [...vocal].sort((a, b) => a.start - b.start);
  const spans: Array<{ start: number; end: number }> = [];
  for (const n of sorted) {
    const last = spans[spans.length - 1];
    if (last && n.start - last.end <= mergeGap) last.end = Math.max(last.end, n.end);
    else spans.push({ start: n.start, end: n.end });
  }
  return spans;
}

/** Free windows of at least `minSeconds` inside [start, end) not covered by a sung span. */
export function vocalGaps(
  vocal: readonly TimedPitch[], start: number, end: number, options: { mergeGap: number; minSeconds: number },
): Array<{ start: number; end: number }> {
  const spans = sungSpans(vocal, options.mergeGap);
  const gaps: Array<{ start: number; end: number }> = [];
  let cursor = start;
  for (const span of spans) {
    if (span.end <= start) continue;
    if (span.start >= end) break;
    if (span.start - cursor >= options.minSeconds) gaps.push({ start: cursor, end: span.start });
    cursor = Math.max(cursor, span.end);
  }
  if (end - cursor >= options.minSeconds) gaps.push({ start: cursor, end });
  return gaps;
}

// ---------------------------------------------------------------------------
// Harmony helpers
// ---------------------------------------------------------------------------

function chordAt(chords: readonly ChordHarmonyEvent[], time: number): ChordHarmonyEvent | null {
  let best: ChordHarmonyEvent | null = null;
  for (const c of chords) {
    if (c.start <= time + 1e-6 && c.end > time + 1e-6) return c;
    if (c.start <= time + 1e-6 && (!best || c.start > best.start)) best = c;
  }
  return best ?? chords[0] ?? null;
}

/** Is `time` a strong beat? Beat 1 always; the half-bar beat in even meters. */
export function isStrongBeat(time: number, originSeconds: number, beatSeconds: number, beatsPerBar: number): boolean {
  const beat = (time - originSeconds) / beatSeconds;
  const inBar = ((beat % beatsPerBar) + beatsPerBar) % beatsPerBar;
  const near = (target: number) => Math.abs(inBar - target) < 1 / 16 || Math.abs(inBar - target - beatsPerBar) < 1 / 16;
  if (near(0)) return true;
  return beatsPerBar % 2 === 0 && beatsPerBar >= 4 && near(beatsPerBar / 2);
}

function nearestOfClasses(pitch: number, classes: readonly number[], lo: number, hi: number, prefer: number): number | null {
  let best: number | null = null;
  let bestScore = Infinity;
  for (let p = lo; p <= hi; p += 1) {
    if (!classes.includes(((p % 12) + 12) % 12)) continue;
    const d = Math.abs(p - pitch);
    // Ties go the preferred direction (the interval's sign).
    const score = d * 2 + (sign(p - pitch) === prefer || prefer === 0 ? 0 : 1);
    if (score < bestScore) { bestScore = score; best = p; }
  }
  return best;
}

// ---------------------------------------------------------------------------
// Realisation of one cell in one window
// ---------------------------------------------------------------------------

type Realised = { notes: TimedPitch[]; fidelity: number; clearanceFailures: number };

function quantise(time: number, origin: number, grid: number): number {
  return origin + Math.round((time - origin) / grid) * grid;
}

function realiseCell(
  cell: MotifCell,
  window: { start: number; end: number },
  req: MelodicLineRequest,
  options: { spanShare: number; legato: number; holdLast: boolean; targetCentre: number; startDirection: number },
): Realised | null {
  const { beatSeconds, chords, range, maxLeap } = req;
  const n = cell.intervals.length + 1;
  const available = window.end - window.start;
  if (available < beatSeconds * 0.5) return null;
  // Onsets: the cell's IOI ratios scaled into the span, quantised to the beat grid the density allows.
  const grid = req.density > 0.6 || cell.rhythm.some((r) => r < 0.75) ? beatSeconds / 4 : beatSeconds / 2;
  const span = Math.max(grid * (n - 1), Math.min(available - grid, available * options.spanShare));
  const total = cell.rhythm.reduce((s, v) => s + v, 0) || 1;
  const onsets: number[] = [window.start];
  let cursor = window.start;
  for (let i = 0; i < cell.rhythm.length; i += 1) {
    cursor += (cell.rhythm[i] / total) * span;
    let q = quantise(cursor, req.originSeconds, grid);
    if (q <= onsets[onsets.length - 1] + 1e-6) q = onsets[onsets.length - 1] + grid;
    onsets.push(q);
  }
  if (onsets[onsets.length - 1] >= window.end - 1e-6) {
    // The last onset fell off the window: compress onto the grid from the end.
    const last = quantise(window.end - grid, req.originSeconds, grid);
    if (last <= window.start + grid * (n - 2)) return null;
    const step = (last - window.start) / (n - 1);
    for (let i = 1; i < n; i += 1) onsets[i] = Math.max(onsets[i - 1] + grid, quantise(window.start + step * i, req.originSeconds, grid));
    if (onsets[n - 1] >= window.end - 1e-6) return null;
  }
  const durations = onsets.map((on, i) => {
    const next = i + 1 < n ? onsets[i + 1] : window.end;
    const raw = i + 1 < n ? (next - on) * options.legato : options.holdLast ? Math.max(grid, next - on - grid / 2) : Math.min(beatSeconds, next - on) * options.legato;
    return Math.max(req.minNoteDuration, Math.min(raw, window.end - on));
  });

  // Pitches: the intervals from a starting chord tone, chord tones on strong beats, passing tones between.
  // The starting pitch is searched (chord tones of the first chord near the target centre) for the
  // realisation that keeps the most of the cell's intervals - the cell is bent only where the harmony insists.
  const first = chordAt(chords, onsets[0]);
  if (!first) return null;
  const firstTones = chordPitchClasses(first);
  const realisePitches = (start: number): { pitches: number[]; kept: number } | null => {
    const pitches: number[] = [start];
    let kept = 0;
    for (let i = 1; i < n; i += 1) {
      const interval = cell.intervals[i - 1];
      const chord = chordAt(chords, onsets[i]) ?? first;
      const tones = chordPitchClasses(chord);
      let raw = pitches[i - 1] + interval;
      // Leaps beyond the instrument's limit and range excursions fold by octave first.
      while (raw - pitches[i - 1] > maxLeap) raw -= 12;
      while (pitches[i - 1] - raw > maxLeap) raw += 12;
      while (raw > range.hi) raw -= 12;
      while (raw < range.lo) raw += 12;
      const strong = isStrongBeat(onsets[i], req.originSeconds, req.beatSeconds, req.beatsPerBar) || i === n - 1;
      const isChordTone = tones.includes(((raw % 12) + 12) % 12);
      let chosen = raw;
      if (!isChordTone) {
        const nearest = nearestOfClasses(raw, tones, range.lo, range.hi, sign(interval));
        if (nearest !== null && (strong || Math.abs(nearest - raw) > 2)) chosen = nearest;
      }
      if (chosen < range.lo || chosen > range.hi) {
        const inRange = nearestOfClasses(Math.max(range.lo, Math.min(range.hi, chosen)), tones, range.lo, range.hi, 0);
        if (inRange === null) return null;
        chosen = inRange;
      }
      if (chosen - pitches[i - 1] === interval) kept += 1;
      pitches.push(chosen);
    }
    return { pitches, kept };
  };
  const starts: number[] = [];
  for (let p = range.lo; p <= range.hi; p += 1) if (firstTones.includes(((p % 12) + 12) % 12)) starts.push(p);
  starts.sort((a, b) => Math.abs(a - options.targetCentre) - Math.abs(b - options.targetCentre) ||
    (sign(a - options.targetCentre) === options.startDirection ? -1 : 1));
  let best: { pitches: number[]; kept: number } | null = null;
  for (const start of starts.slice(0, 6)) {
    const attempt = realisePitches(start);
    if (attempt && (!best || attempt.kept > best.kept)) best = attempt;
    if (best && best.kept === n - 1) break;
  }
  if (!best) return null;
  const { pitches, kept } = best;

  // Register discipline: a fifth clear of a concurrently sung note and above the bass.
  let clearanceFailures = 0;
  const notes: TimedPitch[] = onsets.map((start, i) => ({ start, end: start + durations[i], pitch: pitches[i] }));
  for (let i = 0; i < notes.length; i += 1) {
    const note = notes[i];
    const chord = chordAt(chords, note.start) ?? first;
    const tones = chordPitchClasses(chord);
    const sung = req.vocal.filter((v) => overlaps(note, v));
    const bass = soundingAt(req.bass, note.start);
    const ok = (p: number) =>
      p >= range.lo && p <= range.hi &&
      sung.every((v) => Math.abs(p - v.pitch) >= VOCAL_CLEARANCE) &&
      (!bass || p >= bass.pitch + BASS_CLEARANCE) &&
      (i === 0 || Math.abs(p - notes[i - 1].pitch) <= maxLeap);
    if (ok(note.pitch)) continue;
    const candidates = [note.pitch + 12, note.pitch - 12, note.pitch + 24, note.pitch - 24]
      .concat(Array.from({ length: 25 }, (_, k) => note.pitch + (k - 12)).filter((p) => tones.includes(((p % 12) + 12) % 12)))
      .filter(ok)
      .sort((a, b) => Math.abs(a - note.pitch) - Math.abs(b - note.pitch));
    if (candidates.length) { note.pitch = candidates[0]; continue; }
    clearanceFailures += 1;
  }
  return { notes, fidelity: n > 1 ? kept / (n - 1) : 1, clearanceFailures };
}

// ---------------------------------------------------------------------------
// Choosing what to say
// ---------------------------------------------------------------------------

const DEVELOPMENT_RING: MotifTransformation[] = [
  "transposition", "inversion", "augmentation", "sequence", "fragmentation", "retrograde", "retrograde_inversion",
];

/** The next development after an earlier statement: never the same transformation again. */
export function developAfter(previous: MotifTransformation): MotifTransformation {
  const at = DEVELOPMENT_RING.indexOf(previous);
  if (at < 0) return "inversion";
  return DEVELOPMENT_RING[(at + 1) % DEVELOPMENT_RING.length];
}

/** How an answer relates to the cell the singer just sang. */
export function answerTransformationFor(
  vocalContour: MotifCell["contour"] | null,
  tensionRole: ArcTensionRole | null,
  occurrenceIndex: number | null,
): { transformation: MotifTransformation; reason: string } {
  const confirm = tensionRole === "arrival" || tensionRole === "lift";
  let base: MotifTransformation;
  let reason: string;
  if (confirm) {
    base = "transposition";
    reason = `${tensionRole}: the instrument confirms the singer's cell (transposed onto the chord)`;
  } else if (vocalContour === "rising" || vocalContour === "falling") {
    base = "inversion";
    reason = `the sung cell ${vocalContour === "rising" ? "rises" : "falls"}: the answer mirrors it (inversion)`;
  } else if (vocalContour === "arch" || vocalContour === "valley") {
    base = "retrograde";
    reason = `the sung cell is an ${vocalContour}: the answer comes back the way it went (retrograde)`;
  } else {
    base = "transposition";
    reason = vocalContour ? `the sung cell is ${vocalContour}: restated on the chord` : "no sung contour: the cell restated on the chord";
  }
  const occ = occurrenceIndex ?? 0;
  if (occ === 0) return { transformation: base, reason };
  // Later statements of the same section function develop the answer.
  const developed = occ === 1 ? "augmentation" : occ === 2 ? "sequence" : developAfter(base);
  return { transformation: developed, reason: `${reason}; statement ${occ + 1} of this section function develops it (${developed})` };
}

type Chosen = { entry: MotifLedgerEntry; parent: MotifOccurrenceRecord | null; transformation: MotifTransformation; reason: string; phraseId: string; adopted: boolean };

function chooseMotif(req: MelodicLineRequest, window: { start: number; end: number }, unitIndex: number, decisions: string[]): Chosen | null {
  const { ledger, section } = req;
  const intention: PhraseIntention = req.kind === "answer" ? "response" : req.kind === "lead" ? "foreground" : "support";

  // 1. Recall: what did the earlier statement of this section function say?
  const previous = req.motifId
    ? null
    : ledger.previousStatement({ sectionFunction: section.function, occurrenceIndex: section.occurrenceIndex, intention })
      ?? (section.developmentOperator === "activate_counterline" && req.kind === "counterline"
        ? ledger.previousStatement({ sectionFunction: section.function, occurrenceIndex: section.occurrenceIndex, intention: "response" })
        : null);
  if (previous && unitIndex === 0) {
    const entry = ledger.entry(previous.motifId);
    if (entry) {
      const transformation = developAfter(previous.transformation);
      const reason = `recall of occurrence #${previous.index} (${previous.sectionName}, ${previous.instrument}, ${previous.transformation}) developed as ${transformation}` +
        (previous.intention !== intention ? `; the ${previous.intention} becomes the ${intention} (${section.developmentOperator ?? "form memory"})` : "");
      return { entry, parent: previous, transformation, reason, phraseId: previous.phraseId, adopted: false };
    }
  }

  // 2. A named motif, the cell the singer just sang, the cell sung inside the window, then the hook.
  let entry: MotifLedgerEntry | null = req.motifId ? ledger.entry(req.motifId) ?? null : null;
  let phraseId = req.phraseId;
  let vocalContour: MotifCell["contour"] | null = null;
  let how = entry ? "requested motif" : "";
  if (!entry) {
    const just = ledger.lastSungBefore(window.start, req.beatsPerBar * req.beatSeconds * 2);
    if (just) {
      entry = just.entry; phraseId = just.occurrence.phraseId; how = `the phrase that just ended (${phraseId})`;
      vocalContour = entry.cell.contour;
    }
  }
  if (!entry) {
    const inside = ledger.sungIn(window.start, window.end)[0];
    if (inside) { entry = inside.entry; phraseId = inside.occurrence.phraseId; how = `the cell sung inside the window (${phraseId})`; vocalContour = entry.cell.contour; }
  }
  if (!entry) {
    entry = ledger.hook();
    if (entry) how = `the hook (${entry.label})`;
  }
  if (!entry) return null;

  let transformation: MotifTransformation;
  let reason: string;
  if (req.kind === "answer") {
    const a = answerTransformationFor(vocalContour, section.tensionRole, section.occurrenceIndex);
    transformation = a.transformation; reason = `${how}; ${a.reason}`;
  } else if (req.kind === "lead") {
    const ring: MotifTransformation[] = ["transposition", "sequence", "inversion", "transposition"];
    transformation = ring[unitIndex % ring.length];
    reason = `${how}; lead statement unit ${unitIndex + 1}: ${transformation}`;
  } else {
    // Counterline: the caller scores the candidate forms; this is the preferred one.
    const ring: MotifTransformation[] = ["transposition", "sequence", "inversion", "augmentation"];
    transformation = ring[(unitIndex + (section.occurrenceIndex ?? 0)) % ring.length];
    reason = `${how}; counter-line unit ${unitIndex + 1}: ${transformation}`;
  }

  // 3. Withholding: the hook's full statement waits for the arrival.
  const withheld = ledger.withheldIn(entry.id, section.name, section.tensionRole);
  if (withheld && !withheld.allowedBefore.includes(transformation)) {
    const fallback = withheld.allowedBefore[0] ?? "fragmentation";
    decisions.push(`${entry.label} withheld in "${section.name}": ${withheld.reason} -> ${fallback}`);
    transformation = fallback;
    reason = `${reason}; withheld until "${withheld.untilSectionName ?? withheld.untilTensionRole}" -> ${fallback}`;
  }
  return { entry, parent: null, transformation, reason, phraseId, adopted: false };
}

/** Candidate forms a counter-line unit may take; the realised one with the best motion against the bass wins. */
function counterlineCandidates(preferred: MotifTransformation, recall: boolean): MotifTransformation[] {
  if (recall) return [preferred];
  const pool: MotifTransformation[] = [preferred, "inversion", "transposition", "retrograde", "sequence", "retrograde_inversion"];
  return [...new Set(pool)];
}

// ---------------------------------------------------------------------------
// The writer
// ---------------------------------------------------------------------------

function targetCentre(req: MelodicLineRequest, window: { start: number; end: number }, decisions: string[]): number {
  const { lo, hi } = req.range;
  const sung = req.vocal.filter((v) => v.end > window.start - req.beatSeconds * req.beatsPerBar && v.start < window.end + req.beatSeconds * req.beatsPerBar);
  if (!sung.length) return req.kind === "answer" ? hi - 6 : (lo + hi) / 2 + 3;
  const vLow = Math.min(...sung.map((v) => v.pitch));
  const vHigh = Math.max(...sung.map((v) => v.pitch));
  const above = vHigh + VOCAL_CLEARANCE + 3;
  const below = vLow - VOCAL_CLEARANCE - 3;
  if (above + 4 <= hi) return above;
  if (below - 4 >= lo) return below;
  decisions.push(`register: the instrument's range ${lo}-${hi} cannot sit a fifth clear of the voice (${vLow}-${vHigh}); the closest edge is used`);
  return Math.abs(hi - vHigh) >= Math.abs(vLow - lo) ? hi - 3 : lo + 3;
}

function evidenceDigest(req: MelodicLineRequest, chosen: Chosen, window: { start: number; end: number }): string {
  return sha256(stableJson({
    engine: MELODIC_ENGINE_VERSION, motif: chosen.entry.id, origin: chosen.entry.origin, cell: chosen.entry.cell,
    transformation: chosen.transformation, window, section: req.section, instrument: req.instrument,
    chords: req.chords.filter((c) => c.end > window.start && c.start < window.end).map((c) => [c.symbol, r4(c.start), r4(c.end)]),
    vocal: req.vocal.filter((v) => v.end > window.start - 4 && v.start < window.end + 4).map((v) => [r4(v.start), r4(v.end), v.pitch]),
    bassReference: req.bassReference, bassCount: req.bass.length, recallOf: chosen.parent?.index ?? null,
  }));
}

function toEngineNotes(
  req: MelodicLineRequest, realised: TimedPitch[], chosen: Chosen, transformationLabel: MotifTransformation,
  unitIndex: number, window: { start: number; end: number }, velocityShape: (i: number, n: number, peak: number) => number,
): EngineNote[] {
  const cell = cellOf(realised, req.beatSeconds);
  const fingerprint = cell ? emittedFingerprint(cell) : emittedFingerprint({ intervals: [], rhythm: [], spanBeats: 0, contour: "flat" });
  const peak = realised.reduce((best, n, i) => (n.pitch > realised[best].pitch ? i : best), 0);
  const evidence = evidenceDigest(req, chosen, window);
  const intention: PhraseIntention = req.kind === "answer" ? "response" : req.kind === "lead" ? "foreground" : "support";
  return realised.map((n, i) => ({
    id: `${req.idPrefix}-${unitIndex}-${i}`,
    start: r4(n.start),
    duration: r4(Math.max(req.minNoteDuration, n.end - n.start)),
    pitch: Math.max(0, Math.min(127, Math.round(n.pitch))),
    velocity: Math.max(1, Math.min(127, Math.round(velocityShape(i, realised.length, peak)))),
    motif: {
      id: chosen.entry.id,
      fingerprint,
      parentMotifId: chosen.parent ? chosen.parent.motifId : null,
      transformation: transformationLabel,
      phraseId: chosen.phraseId,
      intention,
      evidenceSha256: evidence,
      windowEndSeconds: r4(window.end),
    },
  }));
}

/** Tension-role offset on the dynamic (answers speak up at an arrival and step back in an afterglow). */
export function tensionVelocityOffset(role: ArcTensionRole | null): number {
  switch (role) {
    case "arrival": return 6;
    case "lift": return 3;
    case "release": return -4;
    case "afterglow": return -8;
    case "breath": return -10;
    default: return 0;
  }
}

/** Write one melodic line. Returns no notes (and says why) rather than inventing material. */
export function writeMelodicLine(req: MelodicLineRequest): MelodicLineResult {
  const decisions: string[] = [];
  const notes: EngineNote[] = [];
  const occurrences: MotifOccurrenceRecord[] = [];
  const fidelity: number[] = [];
  const barSeconds = req.beatSeconds * req.beatsPerBar;
  const empty = (why: string): MelodicLineResult => {
    decisions.push(why);
    return { notes, occurrences, decisions, metrics: { motionVsBass: null, vocalClearance: null, overlapsVocal: false, intervalFidelity: fidelity } };
  };
  if (req.window.end - req.window.start < req.beatSeconds) return empty("window shorter than a beat: nothing written");
  if (!req.chords.length) return empty("no chord under the window: a pitched line has nothing to write from");

  const units = req.kind === "answer"
    ? [{ start: req.window.start, end: req.window.end, id: req.phraseId }]
    : (req.units?.length ? req.units : splitUnits(req.window, barSeconds * 2)).map((u) => ({
        start: Math.max(u.start, req.window.start), end: Math.min(u.end, req.window.end), id: u.id,
      })).filter((u) => u.end - u.start >= req.beatSeconds);
  if (!units.length) return empty("no unit of at least a beat inside the window");

  const velocityBase = req.baseVelocity + tensionVelocityOffset(req.section.tensionRole) + (req.kind === "lead" ? 6 : req.kind === "answer" ? -2 : -6);
  const shape = (i: number, n: number, peak: number) => velocityBase + (i === peak ? 6 : 0) + (i === 0 ? 2 : 0) + (i === n - 1 && n > 1 ? -4 : 0) - (i > 0 && i < peak ? (peak - i) : 0);

  units.forEach((unit, unitIndex) => {
    const chosen = chooseMotif(req, unit, unitIndex, decisions);
    if (!chosen) {
      decisions.push(`unit ${unitIndex + 1}: the ledger is empty - nothing to state`);
      return;
    }
    const centre = targetCentre(req, unit, decisions);
    const bassDirection = (() => {
      const a = soundingAt(req.bass, unit.start);
      const b = soundingAt(req.bass, unit.end - 1e-3);
      return a && b ? sign(b.pitch - a.pitch) : 0;
    })();
    const sequenceSteps = [bassDirection > 0 ? -2 : 2];
    const spanShare = req.kind === "answer" ? 0.8 : req.kind === "lead" ? 0.75 : req.density < 0.4 ? 0.9 : 0.6;
    // A fragment varies with the statement: tail / head alternate by occurrence, and from the third
    // statement on it keeps one more interval - so a shortened recall is still a development, not a copy.
    const occ = req.section.occurrenceIndex ?? 0;
    const fragmentFrom: "head" | "tail" = ((occ + unitIndex) % 2 === 0) === (req.kind === "answer") ? "tail" : "head";
    const fragmentLength = Math.max(2, Math.min(chosen.entry.cell.intervals.length - 1, 2 + Math.floor(occ / 2)));
    const legato = req.kind === "counterline" ? 0.95 : 0.85;
    const forms = req.kind === "counterline"
      ? counterlineCandidates(chosen.transformation, chosen.parent !== null)
      : [chosen.transformation];
    type Scored = { form: MotifTransformation; cell: MotifCell; realised: Realised; score: number; motion: MotionRate | null };
    const scored: Scored[] = [];
    for (const form of forms) {
      const cell = transformCell(chosen.entry.cell, form, { sequenceSteps, fragmentFrom, fragmentLength });
      const realised = realiseCell(cell, unit, req, {
        spanShare, legato, holdLast: req.kind !== "answer", targetCentre: centre, startDirection: -sign(bassDirection),
      });
      if (!realised) continue;
      const motion = motionRateVsBass(realised.notes, req.bass);
      const score = (motion ? motion.rate : 0.5) * 2 + realised.fidelity - realised.clearanceFailures * 3 - (motion ? motion.parallel : 0);
      scored.push({ form, cell, realised, score, motion });
    }
    if (!scored.length) {
      // A short window gets a fragment of the answer rather than silence: the tail of the cell (2 intervals),
      // labelled as the fragment it is.
      const fragment = transformCell(chosen.entry.cell, "fragmentation", { fragmentLength: Math.min(fragmentLength, 2 + Math.floor(occ / 2)), fragmentFrom });
      const realised = realiseCell(fragment, unit, req, {
        spanShare, legato, holdLast: req.kind !== "answer", targetCentre: centre, startDirection: -sign(bassDirection),
      });
      if (realised) {
        const motion = motionRateVsBass(realised.notes, req.bass);
        scored.push({ form: "fragmentation", cell: fragment, realised, score: 0, motion });
        decisions.push(`unit ${unitIndex + 1}: ${r4(unit.end - unit.start)} s is too short for the full cell (${chosen.entry.cell.intervals.length + 1} notes) - a ${fragment.intervals.length + 1}-note fragment instead`);
      } else {
        decisions.push(`unit ${unitIndex + 1}: the cell does not fit ${r4(unit.end - unit.start)} s at this grid, nor does a fragment - nothing written`);
        return;
      }
    }
    scored.sort((a, b) => b.score - a.score || (seededTie(req.seed, unitIndex, a.form) - seededTie(req.seed, unitIndex, b.form)));
    const best = scored[0];
    if (best.form !== chosen.transformation) {
      decisions.push(`unit ${unitIndex + 1}: ${best.form} chosen over ${chosen.transformation} for motion against the bass (${best.motion ? best.motion.rate.toFixed(2) : "n/a"} vs ${scored.find((s) => s.form === chosen.transformation)?.motion?.rate.toFixed(2) ?? "unrealisable"})`);
    }
    // Label what was emitted, not what was intended.
    const emittedCell = cellOf(best.realised.notes, req.beatSeconds);
    const detected = emittedCell
      ? classifyTransformation(chosen.entry.cell, emittedCell, {
          transposition: best.realised.notes[0].pitch - (chosen.entry.sourceOccurrences[0]?.firstPitch ?? best.realised.notes[0].pitch),
          sameInstrument: chosen.entry.origin.kind === "instrument_statement" ? chosen.entry.origin.instrument === req.instrument : undefined,
        })
      : null;
    const label: MotifTransformation = detected ?? "harmonic_adaptation";
    if (detected === null) decisions.push(`unit ${unitIndex + 1}: intervals bent to chord tones at ${Math.round((1 - best.realised.fidelity) * (best.cell.intervals.length))} of ${best.cell.intervals.length} steps -> labelled harmonic_adaptation`);
    else if (detected !== best.form) decisions.push(`unit ${unitIndex + 1}: intended ${best.form}, emitted cell reads as ${detected}`);
    fidelity.push(Number(best.realised.fidelity.toFixed(3)));
    const unitNotes = toEngineNotes(req, best.realised.notes, chosen, label, unitIndex, unit, shape);
    notes.push(...unitNotes);
    const bar = (t: number) => Math.floor((t - req.originSeconds) / barSeconds + 1e-6) + 1;
    const occurrence = req.ledger.record({
      motifId: chosen.entry.id,
      transformation: label,
      intendedTransformation: best.form,
      transposition: best.realised.notes[0].pitch - (chosen.entry.sourceOccurrences[0]?.firstPitch ?? best.realised.notes[0].pitch),
      sectionName: req.section.name,
      sectionFunction: req.section.function,
      occurrenceIndex: req.section.occurrenceIndex,
      startBar: bar(unit.start), endBar: bar(unitNotes[unitNotes.length - 1].start),
      startSeconds: r4(unitNotes[0].start), endSeconds: r4(unitNotes[unitNotes.length - 1].start + unitNotes[unitNotes.length - 1].duration),
      instrument: req.instrument,
      taskId: req.taskId,
      phraseId: chosen.phraseId,
      intention: unitNotes[0].motif.intention,
      cell: emittedCell ?? best.cell,
      noteIds: unitNotes.map((n) => n.id),
      recallOf: chosen.parent?.index ?? null,
      placement: req.placement,
      reason: `${chosen.reason}` + (best.realised.clearanceFailures ? `; ${best.realised.clearanceFailures} note(s) could not clear the voice/bass by a fifth` : ""),
    });
    occurrences.push(occurrence);
  });

  const line = notes.map((n) => ({ start: n.start, end: n.start + n.duration, pitch: n.pitch }));
  return {
    notes, occurrences, decisions,
    metrics: {
      motionVsBass: motionRateVsBass(line, req.bass),
      vocalClearance: vocalClearance(line, req.vocal),
      overlapsVocal: overlapsVocal(line, req.vocal),
      intervalFidelity: fidelity,
    },
  };
}

function splitUnits(window: { start: number; end: number }, unitSeconds: number): Array<{ start: number; end: number; id?: string }> {
  const out: Array<{ start: number; end: number; id?: string }> = [];
  for (let t = window.start; t < window.end - 1e-6; t += unitSeconds) out.push({ start: t, end: Math.min(window.end, t + unitSeconds) });
  return out;
}

function seededTie(seed: number, unit: number, form: string): number {
  let h = (seed ^ (unit * 2654435761)) >>> 0;
  for (let i = 0; i < form.length; i += 1) { h ^= form.charCodeAt(i); h = Math.imul(h, 16_777_619) >>> 0; }
  return h % 1000;
}

/** Chord roots as a bass reference (what the reference bass plays on every downbeat) when no bass evidence exists. */
export function chordRootsAsBass(chords: readonly ChordHarmonyEvent[], lo = 36, hi = 55): TimedPitch[] {
  return [...chords].sort((a, b) => a.start - b.start).map((c) => {
    const m = /^([A-Ga-g])([#b]?)/.exec((c.root ?? c.symbol).replace("♯", "#").replace("♭", "b").trim());
    const roots: Record<string, number> = { C: 0, "C#": 1, DB: 1, D: 2, "D#": 3, EB: 3, E: 4, F: 5, "F#": 6, GB: 6, G: 7, "G#": 8, AB: 8, A: 9, "A#": 10, BB: 10, B: 11 };
    const pc = m ? roots[`${m[1].toUpperCase()}${m[2].toUpperCase()}`] ?? 0 : 0;
    let pitch = pc + 12 * Math.round((40 - pc) / 12);
    while (pitch < lo) pitch += 12;
    while (pitch > hi) pitch -= 12;
    return { start: c.start, end: c.end, pitch };
  });
}

/** The cell id of the legacy fallback figure, so a ledger can say "the fixed cell was used". */
export const FALLBACK_MOTIF_ID = motifIdOf(FALLBACK_CELL);
