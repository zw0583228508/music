/**
 * Judge calibration (Wave Q — Model Discovery, Workstream C).
 *
 * A judge that flags real human parts is a judge with false positives, and a
 * promotion gate may rest only on constraints proven reliable. This module
 * runs the tournament's playability judge (`judgePlayability`: the constraint
 * engine plus the GM range table) over **real human parts** — every pitched
 * and drum track of admitted PDMX multitrack works, in the same 8-bar windows
 * and under the same rules the tournament uses for a target part — and
 * records every violation with the facts a reader needs to see the case:
 * code, severity, GM program, ARRANGER_REMI family, the platform instrument
 * the judge mapped it to, the notes involved, tempo and metre.
 *
 * Each violation is then **classified by evidence**, never by assumption:
 * the classifier looks at the notes (is the pitch inside the instrument's
 * standard range? did the "chord" contain the same pitch twice? was the
 * previous note still sounding when the "leap" happened? can the voicing be
 * fingered on six strings once open strings are allowed?) and names the
 * class with the reason. Where only an ear can decide, it says
 * `ambiguous_case`.
 *
 * The reference physics here (`GM_REFERENCE`) is compiled from standard
 * orchestration ranges at concert pitch and is deliberately independent of
 * the judge's own tables, so the judge can be measured against it. It is a
 * reference, not ground truth; the report says so.
 */
import { familyOf } from "./arrangerRemi";
import { TUNINGS, fingerable, type ConstraintNote, type ConstraintViolation } from "./musicalConstraints";

export { TUNINGS, fingerable };
import type { MidiNote, ParsedMidi } from "./midiFile";
import { judgePlayability, type PlayabilityVerdict } from "./partJudge";
import { DRUMS_PROGRAM, MIN_TARGET_NOTES, TARGET_FAMILIES } from "./tournamentTask";
import { gmReference, type GmReference } from "./instrumentReference";

export { GM_REFERENCE, gmReference, type GmReference } from "./instrumentReference";

export const JUDGE_CALIBRATION_VERSION = "1.0" as const;

export const VIOLATION_CLASSES = [
  "actual_impossible_playing",
  "unusual_but_valid_technique",
  "instrument_mapping_error",
  "register_model_error",
  "family_classification_error",
  "articulation_technique_exception",
  "judge_false_positive",
  "data_problem",
  "ambiguous_case",
] as const;
export type ViolationClass = (typeof VIOLATION_CLASSES)[number];

/** Families the judge can map to a platform instrument; the calibration measures exactly these. */
export const CALIBRATED_FAMILIES: readonly string[] = [...TARGET_FAMILIES, "chromatic_perc"];

// ---------------------------------------------------------------------------
// Human windows
// ---------------------------------------------------------------------------

export type CalibrationWindow = {
  workId: string;
  track: number;
  program: number;
  family: string;
  isPercussion: boolean;
  barStart: number;
  barEnd: number;
  tempoBpm: number;
  meter: { numerator: number; denominator: number };
  barSeconds: number;
  window: { start: number; end: number };
  /** The human's notes sounding in the window, in seconds under the file's first tempo. */
  notes: ConstraintNote[];
  /** A guard for the reader: the file has tempo changes, seconds follow the first tempo. */
  tempoEvents: number;
};

export type WindowOptions = { windowBars?: number; minNotes?: number; maxWindowsPerTrack?: number };

const inWindow = (start: number, end: number, window: { start: number; end: number }): boolean =>
  start < window.end - 1e-6 && end > window.start + 1e-6;

/**
 * Every human part of a score in aligned bar windows, under the tournament's
 * target rules (≥ `MIN_TARGET_NOTES` notes, sounding in at least half the
 * bars, one metre per file, seconds under the first tempo). Refuses a file
 * the tournament would refuse, for the same reasons, so the population here
 * is the population the judge meets there.
 */
export function humanWindows(
  midi: ParsedMidi,
  workId: string,
  options: WindowOptions = {},
): { windows: CalibrationWindow[]; refusal: string | null; skippedFamilies: Record<string, number> } {
  const windowBars = options.windowBars ?? 8;
  const minNotes = options.minNotes ?? MIN_TARGET_NOTES;
  const maxPerTrack = options.maxWindowsPerTrack ?? Number.POSITIVE_INFINITY;
  const skippedFamilies: Record<string, number> = {};
  if (!midi.notes.length) return { windows: [], refusal: "the score has no notes", skippedFamilies };
  const distinctMetres = new Set(midi.timeSignatures.map((t) => `${t.numerator}/${t.denominator}`));
  if (distinctMetres.size > 1) {
    return { windows: [], refusal: `the file changes metre (${[...distinctMetres].join(", ")})`, skippedFamilies };
  }
  const bpmRaw = midi.tempos[0]?.bpm;
  const tempoBpm = bpmRaw && bpmRaw >= 20 && bpmRaw <= 400 ? bpmRaw : 120;
  const ts = midi.timeSignatures[0] ?? { numerator: 4, denominator: 4 };
  if (ts.numerator <= 0 || ts.denominator <= 0) return { windows: [], refusal: "unreadable time signature", skippedFamilies };
  const secondsPerTick = 60 / (tempoBpm * midi.ticksPerQuarter);
  const barSeconds = (60 / tempoBpm) * (4 / ts.denominator) * ts.numerator;
  const ticksPerBar = ts.numerator * (4 / ts.denominator) * midi.ticksPerQuarter;
  const totalBars = Math.floor(midi.endTick / ticksPerBar);

  const groups = new Map<string, { track: number; program: number; isPercussion: boolean; notes: MidiNote[] }>();
  for (const note of midi.notes) {
    const program = note.isPercussion ? DRUMS_PROGRAM : note.program;
    const key = `${note.track}:${program}`;
    const group = groups.get(key) ?? { track: note.track, program, isPercussion: note.isPercussion, notes: [] };
    group.notes.push(note);
    groups.set(key, group);
  }

  const windows: CalibrationWindow[] = [];
  for (const group of groups.values()) {
    const family = group.isPercussion ? "drums" : familyOf({ program: group.program, isPercussion: false });
    if (!CALIBRATED_FAMILIES.includes(family)) {
      skippedFamilies[family] = (skippedFamilies[family] ?? 0) + 1;
      continue;
    }
    const seconds = group.notes
      .map((n, index) => ({
        id: `t${group.track}-${index}`,
        start: Number((n.startTick * secondsPerTick).toFixed(4)),
        duration: Number(Math.max(0.01, (n.endTick - n.startTick) * secondsPerTick).toFixed(4)),
        pitch: n.pitch,
        velocity: Math.max(1, Math.min(127, n.velocity || 80)),
      }))
      .sort((a, b) => a.start - b.start || a.pitch - b.pitch);
    let taken = 0;
    for (let barStart = 0; barStart + windowBars <= totalBars && taken < maxPerTrack; barStart += windowBars) {
      const window = {
        start: Number((barStart * barSeconds).toFixed(4)),
        end: Number(((barStart + windowBars) * barSeconds).toFixed(4)),
      };
      const notes = seconds.filter((n) => inWindow(n.start, n.start + n.duration, window));
      if (notes.length < minNotes) continue;
      const barsPlayed = new Set(notes.map((n) => Math.max(0, Math.floor((n.start - window.start) / barSeconds)))).size;
      if (barsPlayed * 2 < windowBars) continue;
      windows.push({
        workId, track: group.track, program: group.program, family, isPercussion: group.isPercussion,
        barStart, barEnd: barStart + windowBars, tempoBpm, meter: { numerator: ts.numerator, denominator: ts.denominator },
        barSeconds: Number(barSeconds.toFixed(6)), window, notes, tempoEvents: midi.tempos.length,
      });
      taken += 1;
    }
  }
  return { windows, refusal: null, skippedFamilies };
}

// ---------------------------------------------------------------------------
// Violation records
// ---------------------------------------------------------------------------

export type CaseNote = { id: string; pitch: number; start: number; duration: number };

export type ViolationFacts = {
  pitch?: number;
  judgeRange?: { min: number; max: number } | null;
  referenceRange?: { std: [number, number]; ext: [number, number] } | null;
  clusterSize?: number;
  distinctPitches?: number;
  attackedAtOnset?: number;
  heldFromBefore?: number;
  spread?: number;
  leap?: number;
  previousStillSounding?: boolean;
  phraseSeconds?: number;
  longestNoteSeconds?: number;
  attacks?: number;
  fingerable?: "standard" | "extended" | "no";
  /** The whole window fits the reference range when moved by this many semitones (see `octaveDisplacement`). */
  octaveShift?: 12 | -12;
  /** Lowest and highest pitch in the window, for the octave-displacement fact. */
  windowPitchSpan?: [number, number];
};

export type CalibrationViolation = {
  code: string;
  severity: "error" | "warning";
  /** Where the verdict came from: the constraint engine, or the judge's GM range table. */
  source: "engine" | "gm_table";
  workId: string;
  track: number;
  barStart: number;
  program: number;
  programName: string;
  family: string;
  platformInstrument: string;
  platformFamily: string;
  tempoBpm: number;
  meter: string;
  message: string;
  notes: CaseNote[];
  facts: ViolationFacts;
  classification: ViolationClass;
  reason: string;
};

export type WindowCalibration = {
  window: Pick<CalibrationWindow, "workId" | "track" | "program" | "family" | "barStart" | "tempoBpm" | "meter">;
  noteCount: number;
  pitchMin: number;
  pitchMax: number;
  verdict: Pick<PlayabilityVerdict, "range" | "rangeSource" | "rangeShare" | "playabilityErrors">;
  platformInstrument: string;
  violations: CalibrationViolation[];
};

const MAX_CASE_NOTES = 16;
const caseNotes = (notes: readonly ConstraintNote[]): CaseNote[] =>
  notes.slice(0, MAX_CASE_NOTES).map((n, i) => ({ id: n.id ?? `note-${i}`, pitch: n.pitch, start: n.start, duration: n.duration }));

function fitsInHands(pitches: number[], hands: number, span: number): boolean {
  const sorted = [...new Set(pitches)].sort((a, b) => a - b);
  let groups = sorted.length ? 1 : 0;
  let anchor = sorted[0];
  for (const pitch of sorted) {
    if (pitch - anchor > span) { groups += 1; anchor = pitch; }
  }
  return groups <= hands;
}

type ClassifyContext = {
  window: CalibrationWindow;
  verdict: PlayabilityVerdict;
  reference: GmReference | null;
  allNotes: readonly ConstraintNote[];
};

const byId = (ctx: ClassifyContext, ids: readonly string[]): ConstraintNote[] => {
  const wanted = new Set(ids);
  return ctx.allNotes.filter((n) => n.id && wanted.has(n.id));
};

const within = (pitch: number, range: [number, number]): boolean => pitch >= range[0] && pitch <= range[1];
const distanceOutside = (pitch: number, range: [number, number]): number =>
  pitch < range[0] ? range[0] - pitch : pitch > range[1] ? pitch - range[1] : 0;

/**
 * Is this whole window written an octave away from the program's sounding pitch?
 *
 * PR-61 measured it: 2,304 of the 2,466 out-of-range errors that survived the
 * judge fixes sat within one octave of the range boundary, in compact bands
 * (every one of 346 "piccolo" over-range notes lay in 62–73, exactly one
 * octave under the piccolo's floor). When *every* note of the window lands
 * inside the reference range once the whole part is moved one octave, the
 * evidence is a written-pitch export of an octave-transposing program
 * (piccolo, glockenspiel and xylophone sound above what is written; guitar
 * and bass sound below) or an octave-displaced track — not a part played
 * over the instrument's ceiling. Strict on purpose: one note in the window
 * that the shift pushes out is enough to fall through to `ambiguous_case`.
 */
function octaveDisplacement(ctx: ClassifyContext, range: [number, number]): 12 | -12 | null {
  const pitches = ctx.allNotes.map((n) => n.pitch);
  if (pitches.length < 2) return null;
  if (pitches.every((p) => within(p, range))) return null;
  for (const shift of [12, -12] as const) {
    if (pitches.every((p) => within(p + shift, range))) return shift;
  }
  return null;
}

/** The instrument the platform definition models, for "was this the wrong instrument" questions. */
function definitionModels(platformInstrument: string): string {
  switch (platformInstrument) {
    case "brass": return "a trumpet-shaped single brass player (40–82, one voice, breath 10 s)";
    case "strings": return "a violin section (55–103, four voices)";
    case "bass": return "a four-string bass guitar (28–67, one voice)";
    case "guitar": return "a six-string guitar (40–88)";
    case "winds": return "the default piano definition (21–108, two hands, ten voices) — the platform has no winds definition — with wind breath rules";
    case "piano": return "a piano (21–108, two hands at 14 semitones, ten voices)";
    case "synth": return "a synth pad (24–108, eight voices)";
    case "drums": return "a four-limb drum kit";
    default: return platformInstrument;
  }
}

type Classified = { classification: ViolationClass; reason: string; facts: ViolationFacts };

function classifyRange(pitch: number, ctx: ClassifyContext): Classified {
  const { reference, verdict, window } = ctx;
  const judgeRange = verdict.range;
  const facts: ViolationFacts = { pitch, judgeRange, referenceRange: reference?.range ?? null };
  if (window.family === "drums") {
    return { classification: "judge_false_positive", facts,
      reason: `a drum kit addresses kit pieces, not a pitch range; the judge fell back to the platform kit map ${judgeRange?.min}–${judgeRange?.max} and flagged key ${pitch} (a GM2/MuseScore kit piece)` };
  }
  if (!reference?.range) return { classification: "ambiguous_case", facts, reason: "no reference range for this program" };
  const wrongInstrument = verdict.rangeSource === "definition";
  if (within(pitch, reference.range.std)) {
    if (wrongInstrument) {
      return { classification: "instrument_mapping_error", facts,
        reason: `pitch ${pitch} is inside the standard ${reference.name} range ${reference.range.std.join("–")}; the judge held it to ${definitionModels(verdict.platform.instrument)}` };
    }
    return { classification: "register_model_error", facts,
      reason: `pitch ${pitch} is inside the standard ${reference.name} range ${reference.range.std.join("–")}; the judge's table says ${judgeRange?.min}–${judgeRange?.max}` };
  }
  if (within(pitch, reference.range.ext)) {
    return { classification: "unusual_but_valid_technique", facts,
      reason: `pitch ${pitch} is outside the standard ${reference.name} range ${reference.range.std.join("–")} but inside the professional / sub-instrument extreme ${reference.range.ext.join("–")}` };
  }
  const shift = octaveDisplacement(ctx, reference.range.ext);
  if (shift) {
    const span: [number, number] = [Math.min(...ctx.allNotes.map((n) => n.pitch)), Math.max(...ctx.allNotes.map((n) => n.pitch))];
    return { classification: "data_problem", facts: { ...facts, octaveShift: shift, windowPitchSpan: span },
      reason: `the window spans ${span[0]}–${span[1]} and every note of it lies inside the ${reference.name} range ${reference.range.ext.join("–")} once the whole part is moved ${shift > 0 ? "up" : "down"} an octave: a written-pitch export of an octave-transposing program, or an octave-displaced track — not a note over the instrument's ceiling` };
  }
  const distance = distanceOutside(pitch, reference.range.ext);
  if (distance > 12) {
    return { classification: "data_problem", facts,
      reason: `pitch ${pitch} is ${distance} semitones beyond any ${reference.name} (${reference.range.ext.join("–")}): an octave error in the export or a mislabelled program` };
  }
  return { classification: "ambiguous_case", facts,
    reason: `pitch ${pitch} is ${distance} semitone(s) beyond the ${reference.name} extreme ${reference.range.ext.join("–")}: transposition, an octave-displaced export, or a real over-range note — an ear is needed` };
}

function clusterFacts(notes: ConstraintNote[]): { onset: number; attacked: ConstraintNote[]; held: ConstraintNote[]; distinct: number } {
  const onset = Math.max(...notes.map((n) => n.start));
  const attacked = notes.filter((n) => Math.abs(n.start - onset) < 1e-3);
  const held = notes.filter((n) => Math.abs(n.start - onset) >= 1e-3);
  return { onset, attacked, held, distinct: new Set(notes.map((n) => n.pitch)).size };
}

function classifyPolyphony(notes: ConstraintNote[], ctx: ClassifyContext): Classified {
  const { reference, verdict } = ctx;
  const { attacked, held, distinct } = clusterFacts(notes);
  const facts: ViolationFacts = { clusterSize: notes.length, distinctPitches: distinct, attackedAtOnset: attacked.length, heldFromBefore: held.length };
  if (distinct < notes.length) {
    return { classification: "data_problem", facts,
      reason: `${notes.length} notes sound together but only ${distinct} distinct pitches: the same pitch overlaps itself (a re-strike without note-off, or a doubled export) — no instrument sounds one pitch twice` };
  }
  if (!reference) return { classification: "ambiguous_case", facts, reason: "no reference polyphony for this program" };
  const mapped = definitionModels(verdict.platform.instrument);
  if (reference.polyphony.std === 1 && held.length && attacked.length <= 1) {
    // One player, one voice: an earlier note still sounding a little way into
    // the next attack is a tail the export never released, not a second voice.
    const shortest = Math.min(...notes.map((n) => n.duration));
    const overlap = Math.min(...held.map((h) => h.start + h.duration)) - attacked[0].start;
    if (overlap <= shortest * 0.5) {
      return { classification: "data_problem", facts,
        reason: `a ${reference.name} note is still sounding ${overlap.toFixed(2)} s into the next attack (a tail the export did not release); one player, one voice` };
    }
  }
  if (notes.length <= reference.polyphony.std) {
    if (reference.section) {
      return { classification: "instrument_mapping_error", facts,
        reason: `${notes.length} voices on a ${reference.name} (a section, ${reference.polyphony.std} standard); the judge held it to ${mapped}` };
    }
    return { classification: "instrument_mapping_error", facts,
      reason: `${notes.length} voices are standard for a ${reference.name} (up to ${reference.polyphony.std}); the judge held it to ${mapped}` };
  }
  if (notes.length <= reference.polyphony.ext) {
    return { classification: "unusual_but_valid_technique", facts,
      reason: `${notes.length} voices on a ${reference.name}: beyond the everyday ${reference.polyphony.std} but within the known extreme ${reference.polyphony.ext} (double stop, four mallets, a fifth kit voice)` };
  }
  if (reference.polyphony.std === 1) {
    const sameShape = attacked.length >= 2 && attacked.every((n) => Math.abs(n.duration - attacked[0].duration) < 1e-3);
    if (sameShape) {
      return { classification: "ambiguous_case", facts,
        reason: `${attacked.length} notes attacked together with the same length on a ${reference.name}: divisi written on one staff (a section plays it; one player cannot) — the file does not say which` };
    }
    return { classification: "ambiguous_case", facts,
      reason: `${notes.length} overlapping voices on a ${reference.name}: two voices on one staff or an export tail — an ear is needed` };
  }
  return { classification: "ambiguous_case", facts,
    reason: `${notes.length} voices exceed even the extreme ${reference.polyphony.ext} for a ${reference.name}: a merged part or a reduction, or written for more players than the program names` };
}

function classifyVoicing(notes: ConstraintNote[], ctx: ClassifyContext): Classified {
  const { attacked, held, distinct } = clusterFacts(notes);
  const pitches = notes.map((n) => n.pitch);
  const spread = Math.max(...pitches) - Math.min(...pitches);
  const facts: ViolationFacts = { clusterSize: notes.length, distinctPitches: distinct, attackedAtOnset: attacked.length, heldFromBefore: held.length, spread };
  const attackedPitches = attacked.map((n) => n.pitch);
  const isOrgan = ctx.window.family === "organ";
  if (fitsInHands(attackedPitches, 2, 14)) {
    return { classification: "judge_false_positive", facts,
      reason: `the ${attacked.length} note(s) attacked at this onset fit two hands; the ${held.length} other note(s) were struck earlier and are held (sustain or finger pedal) — the engine counted every sounding note as needing a hand` };
  }
  if (isOrgan && fitsInHands(attackedPitches.filter((p) => p !== Math.min(...attackedPitches)), 2, 14)) {
    return { classification: "instrument_mapping_error", facts,
      reason: `organ: the lowest note (${Math.min(...attackedPitches)}) is a pedal note for the feet and the rest fits two hands; the judge applied the piano's two-hand model` };
  }
  if (fitsInHands(attackedPitches, 2, 16)) {
    return { classification: "unusual_but_valid_technique", facts,
      reason: "a tenth in one hand (rolled or a large hand); the engine allows a ninth (14 semitones)" };
  }
  if (fitsInHands(attackedPitches, 4, 14)) {
    return { classification: "ambiguous_case", facts,
      reason: `${attacked.length} notes attacked at once need three or four hands at a ninth each: a four-hand piece or a reduction on one track, or genuinely unplayable — an ear (and the score) is needed` };
  }
  return { classification: "data_problem", facts,
    reason: `${attacked.length} notes attacked at once across ${spread} semitones need more than four hands: a full-score reduction or several parts merged onto a keyboard program` };
}

function classifyLeap(notes: ConstraintNote[], ctx: ClassifyContext): Classified {
  const { reference } = ctx;
  const sorted = [...notes].sort((a, b) => a.start - b.start);
  const [from, to] = [sorted[0], sorted[sorted.length - 1]];
  const leap = Math.abs(to.pitch - from.pitch);
  const previousStillSounding = from.start + from.duration > to.start + 0.03;
  const othersAtOnset = ctx.allNotes.filter((n) => Math.abs(n.start - to.start) < 1e-3 && n !== to).length
    + ctx.allNotes.filter((n) => Math.abs(n.start - from.start) < 1e-3 && n !== from).length;
  const facts: ViolationFacts = { leap, previousStillSounding, attackedAtOnset: othersAtOnset + 1 };
  if (previousStillSounding || othersAtOnset > 0) {
    return { classification: "judge_false_positive", facts,
      reason: `the "leap" of ${leap} semitones is between two voices (${previousStillSounding ? "the earlier note is still sounding" : "another note is attacked at the same instant"}): the top-voice reduction of a polyphonic part is not a melody` };
  }
  if (!reference) return { classification: "ambiguous_case", facts, reason: "no reference leap for this program" };
  if (leap <= reference.leap.std) {
    return { classification: "register_model_error", facts,
      reason: `a ${leap}-semitone leap is routine on a ${reference.name} (up to ${reference.leap.std}); the judge's limit for the mapped instrument is lower` };
  }
  if (leap <= reference.leap.ext) {
    return { classification: "unusual_but_valid_technique", facts,
      reason: `a ${leap}-semitone leap on a ${reference.name}: beyond the routine ${reference.leap.std}, within the known ${reference.leap.ext}` };
  }
  if (leap > reference.leap.ext + 12) {
    return { classification: "data_problem", facts,
      reason: `a ${leap}-semitone leap in ${(to.start - (from.start + from.duration)).toFixed(2)} s on a ${reference.name} is beyond the extreme ${reference.leap.ext} by more than an octave: an octave-displaced export or two parts on one track` };
  }
  return { classification: "ambiguous_case", facts,
    reason: `a ${leap}-semitone leap on a ${reference.name}, beyond the known ${reference.leap.ext}: written as such, or an export artefact — an ear is needed` };
}

function classifyBreath(notes: ConstraintNote[], ctx: ClassifyContext): Classified {
  const { reference } = ctx;
  const sorted = [...notes].sort((a, b) => a.start - b.start);
  const phraseSeconds = Math.max(...sorted.map((n) => n.start + n.duration)) - sorted[0].start;
  const longest = Math.max(...sorted.map((n) => n.duration));
  const attacks = new Set(sorted.map((n) => n.start.toFixed(3))).size;
  const facts: ViolationFacts = { phraseSeconds: Number(phraseSeconds.toFixed(2)), longestNoteSeconds: Number(longest.toFixed(2)), attacks };
  const capacity = reference?.breathSeconds ?? 10;
  if (reference?.section) {
    return { classification: "instrument_mapping_error", facts,
      reason: `a ${reference.name} stagger-breathes; the judge applied one player's lungs to a ${phraseSeconds.toFixed(1)} s passage` };
  }
  if (longest <= capacity && attacks >= 2) {
    return { classification: "judge_false_positive", facts,
      reason: `${attacks} separate attacks over ${phraseSeconds.toFixed(1)} s, longest note ${longest.toFixed(1)} s: a player breathes by shortening the note before an attack; score-exported MIDI writes every note at its full value and encodes no breath` };
  }
  if (longest <= capacity * 1.5) {
    return { classification: "unusual_but_valid_technique", facts,
      reason: `one note held ${longest.toFixed(1)} s on a ${reference?.name ?? "wind"}: past the ${capacity} s reference, within a trained player's long tone at soft dynamics` };
  }
  return { classification: "ambiguous_case", facts,
    reason: `one note held ${longest.toFixed(1)} s on a ${reference?.name ?? "wind"}: a tie chain written for a section, circular breathing, or unplayable as written — an ear is needed` };
}

function classifyFingering(notes: ConstraintNote[], ctx: ClassifyContext): Classified {
  const { attacked, held, distinct } = clusterFacts(notes);
  const pitches = notes.map((n) => n.pitch);
  const spread = Math.max(...pitches) - Math.min(...pitches);
  const kind = ctx.window.family === "bass" ? "bass" : "guitar";
  const tunings = TUNINGS[kind];
  const facts: ViolationFacts = { clusterSize: notes.length, distinctPitches: distinct, attackedAtOnset: attacked.length, heldFromBefore: held.length, spread };
  if (distinct < notes.length) {
    return { classification: "data_problem", facts,
      reason: `${notes.length} notes but ${distinct} distinct pitches: a re-strike without note-off or a doubled export` };
  }
  if (fingerable(pitches, tunings.standard)) {
    facts.fingerable = "standard";
    return { classification: "judge_false_positive", facts,
      reason: `these ${distinct} pitches (spread ${spread}) sit on ${tunings.standard.length} strings in standard tuning within a five-fret hand once open strings count for nothing; the engine measured pitch spread, not fret span` };
  }
  if (tunings.extended.some((t) => fingerable(pitches, t))) {
    facts.fingerable = "extended";
    return { classification: "unusual_but_valid_technique", facts,
      reason: `not fingerable in standard tuning but fingerable in a common alternative (drop D, a seven-string, a five-string bass)` };
  }
  facts.fingerable = "no";
  if (held.length && fingerable(attacked.map((n) => n.pitch), tunings.standard)) {
    return { classification: "data_problem", facts,
      reason: `the ${attacked.length} note(s) attacked here are fingerable; ${held.length} earlier note(s) are still sounding because the export never released them (let-ring beyond the strings available)` };
  }
  return { classification: "ambiguous_case", facts,
    reason: `${distinct} pitches across ${spread} semitones cannot be fingered on one ${kind} in any tuning tried: a keyboard-written part on a ${kind} program, two players on one staff, or unplayable as written` };
}

function classifyLimbs(notes: ConstraintNote[]): Classified {
  const { attacked, held, distinct } = clusterFacts(notes);
  const facts: ViolationFacts = { clusterSize: notes.length, distinctPitches: distinct, attackedAtOnset: attacked.length, heldFromBefore: held.length };
  if (distinct < notes.length) {
    return { classification: "data_problem", facts, reason: `${notes.length} hits but ${distinct} distinct kit pieces: the same piece struck twice at one instant (a doubled export)` };
  }
  if (attacked.length <= 4 && held.length) {
    return { classification: "judge_false_positive", facts,
      reason: `only ${attacked.length} hits are attacked here; ${held.length} earlier hit(s) still "sound" (a cymbal or tom written long) — a struck drum needs no limb to keep ringing` };
  }
  if (notes.length === 5) {
    return { classification: "articulation_technique_exception", facts,
      reason: "five kit voices at one instant is standard drum-set notation that a player renders with a flam, a pedal hi-hat, or by dropping one voice; not a limb count" };
  }
  return { classification: "ambiguous_case", facts,
    reason: `${notes.length} kit voices at one instant: two drum staves on one track, or a notation a performer thins — an ear is needed` };
}

/**
 * Classify one engine violation by looking at the notes it names. Only
 * errors are classified — warnings do not gate anything and are counted, not
 * judged.
 */
export function classifyViolation(
  violation: Pick<ConstraintViolation, "code" | "noteIds">,
  ctx: ClassifyContext,
): Classified {
  const notes = byId(ctx, violation.noteIds);
  if (!notes.length) return { classification: "ambiguous_case", reason: "the violation names no notes", facts: {} };
  switch (violation.code) {
    case "out_of_range": return classifyRange(notes[0].pitch, ctx);
    case "excess_polyphony": return classifyPolyphony(notes, ctx);
    case "unplayable_voicing": return classifyVoicing(notes, ctx);
    case "impossible_leap": return classifyLeap(notes, ctx);
    case "breath_violation": return classifyBreath(notes, ctx);
    case "impossible_fingering": return classifyFingering(notes, ctx);
    case "impossible_limb_count": return classifyLimbs(notes);
    case "triple_stop": {
      const r = ctx.reference;
      return r && notes.length <= r.polyphony.ext
        ? { classification: "unusual_but_valid_technique", facts: { clusterSize: notes.length }, reason: `a ${notes.length}-note stop on a ${r.name} is a known (brief) technique` }
        : { classification: "ambiguous_case", facts: { clusterSize: notes.length }, reason: "a chord on a solo string program: divisi on one staff, or a chord broken in performance" };
    }
    default:
      return { classification: "ambiguous_case", reason: `no evidence rule for code ${violation.code}`, facts: {} };
  }
}

// ---------------------------------------------------------------------------
// One window through the judge
// ---------------------------------------------------------------------------

export function calibrateWindow(window: CalibrationWindow): WindowCalibration {
  const verdict = judgePlayability({
    targetInst: window.program,
    targetFamily: window.family,
    tempoBpm: window.tempoBpm,
    notes: window.notes,
  });
  const reference = gmReference(window.program);
  const ctx: ClassifyContext = { window, verdict, reference, allNotes: window.notes };
  const meter = `${window.meter.numerator}/${window.meter.denominator}`;
  const base = {
    workId: window.workId, track: window.track, barStart: window.barStart, program: window.program,
    programName: reference?.name ?? `program ${window.program}`, family: window.family,
    platformInstrument: verdict.platform.instrument, platformFamily: verdict.platform.family,
    tempoBpm: Number(window.tempoBpm.toFixed(2)), meter,
  };
  const violations: CalibrationViolation[] = [];
  for (const v of verdict.violations) {
    const notes = byId(ctx, v.noteIds);
    const classified = v.severity === "error"
      ? classifyViolation(v, ctx)
      : { classification: "ambiguous_case" as ViolationClass, reason: "warning: counted, not classified", facts: {} };
    violations.push({
      ...base, code: v.code, severity: v.severity, source: "engine", message: v.message,
      notes: caseNotes(notes), ...classified,
    });
  }
  for (const note of verdict.outsideRange) {
    const classified = classifyRange(note.pitch, ctx);
    violations.push({
      ...base, code: "out_of_range", severity: "error", source: "gm_table",
      message: `Pitch ${note.pitch} is outside the ${base.programName} range ${verdict.range?.min}–${verdict.range?.max} (GM table).`,
      notes: caseNotes([note]), ...classified,
    });
  }
  const pitches = window.notes.map((n) => n.pitch);
  return {
    window: { workId: window.workId, track: window.track, program: window.program, family: window.family, barStart: window.barStart, tempoBpm: window.tempoBpm, meter: window.meter },
    noteCount: window.notes.length,
    pitchMin: Math.min(...pitches),
    pitchMax: Math.max(...pitches),
    verdict: { range: verdict.range, rangeSource: verdict.rangeSource, rangeShare: verdict.rangeShare, playabilityErrors: verdict.playabilityErrors },
    platformInstrument: verdict.platform.instrument,
    violations,
  };
}

// ---------------------------------------------------------------------------
// Aggregation
// ---------------------------------------------------------------------------

export type CodeFamilyStats = {
  code: string;
  family: string;
  severity: "error" | "warning";
  windows: number;
  flaggedWindows: number;
  /** Share of this family's human windows the code flags. For an error, on a human part, this is the false-positive rate at window level. */
  flaggedShare: number;
  violations: number;
  byClass: Partial<Record<ViolationClass, number>>;
  byProgram: Record<string, number>;
  verdict: "hard_gate_ok" | "warning_only" | "disable_for_family";
  verdictReason: string;
};

export type CalibrationSummary = {
  version: typeof JUDGE_CALIBRATION_VERSION;
  windows: number;
  windowsByFamily: Record<string, number>;
  windowsWithErrors: number;
  windowsWithErrorsByFamily: Record<string, number>;
  /** Share of human windows the judge would penalise for range (rangeShare < 1). */
  rangePenalisedShare: number;
  rangePenalisedByFamily: Record<string, number>;
  errorsByClass: Record<string, number>;
  codeFamily: CodeFamilyStats[];
  meanPlayabilityErrorsPerWindow: number;
  meanPlayabilityErrorsByFamily: Record<string, number>;
};

/** Thresholds stated so a reader can argue with them. */
export const GATE_THRESHOLDS = {
  /** A code that flags fewer human windows than this may stay a hard gate. */
  hardGateMaxFlaggedShare: 0.01,
  /** Up to this share it is a warning; above it the code is wrong for the family. */
  warningMaxFlaggedShare: 0.05,
  /** A code whose flags are mostly evidence-classified as judge/mapping/register error is a judge bug, whatever the share. */
  judgeErrorMaxShareOfFlags: 0.5,
} as const;

const JUDGE_ERROR_CLASSES: ReadonlySet<ViolationClass> = new Set([
  "instrument_mapping_error", "register_model_error", "family_classification_error", "judge_false_positive",
]);

export function summariseCalibration(results: readonly WindowCalibration[]): CalibrationSummary {
  const windowsByFamily: Record<string, number> = {};
  const windowsWithErrorsByFamily: Record<string, number> = {};
  const rangePenalisedByFamily: Record<string, number> = {};
  const errorsByFamily: Record<string, number> = {};
  const errorsByClass: Record<string, number> = {};
  const cells = new Map<string, { code: string; family: string; severity: "error" | "warning"; flagged: Set<string>; violations: number; byClass: Partial<Record<ViolationClass, number>>; byProgram: Record<string, number> }>();
  let windowsWithErrors = 0;
  let rangePenalised = 0;
  let totalErrors = 0;
  for (const r of results) {
    const fam = r.window.family;
    windowsByFamily[fam] = (windowsByFamily[fam] ?? 0) + 1;
    const key = `${r.window.workId}:${r.window.track}:${r.window.barStart}`;
    if (r.verdict.playabilityErrors > 0) { windowsWithErrors += 1; windowsWithErrorsByFamily[fam] = (windowsWithErrorsByFamily[fam] ?? 0) + 1; }
    if (r.verdict.rangeShare !== null && r.verdict.rangeShare < 1) { rangePenalised += 1; rangePenalisedByFamily[fam] = (rangePenalisedByFamily[fam] ?? 0) + 1; }
    totalErrors += r.verdict.playabilityErrors;
    errorsByFamily[fam] = (errorsByFamily[fam] ?? 0) + r.verdict.playabilityErrors;
    for (const v of r.violations) {
      const cellKey = `${v.code}|${fam}`;
      const cell = cells.get(cellKey) ?? { code: v.code, family: fam, severity: v.severity, flagged: new Set<string>(), violations: 0, byClass: {}, byProgram: {} };
      cell.flagged.add(key);
      cell.violations += 1;
      cell.byProgram[`${v.program}:${v.programName}`] = (cell.byProgram[`${v.program}:${v.programName}`] ?? 0) + 1;
      if (v.severity === "error") {
        cell.byClass[v.classification] = (cell.byClass[v.classification] ?? 0) + 1;
        errorsByClass[v.classification] = (errorsByClass[v.classification] ?? 0) + 1;
      }
      cells.set(cellKey, cell);
    }
  }
  const r4 = (v: number) => Number(v.toFixed(4));
  const codeFamily: CodeFamilyStats[] = [...cells.values()].map((cell) => {
    const windows = windowsByFamily[cell.family] ?? 0;
    const flaggedShare = windows ? r4(cell.flagged.size / windows) : 0;
    const judgeErrorFlags = Object.entries(cell.byClass).filter(([c]) => JUDGE_ERROR_CLASSES.has(c as ViolationClass)).reduce((s, [, n]) => s + (n ?? 0), 0);
    const judgeErrorShare = cell.violations ? judgeErrorFlags / cell.violations : 0;
    let verdict: CodeFamilyStats["verdict"];
    let verdictReason: string;
    if (cell.severity === "warning") {
      verdict = "warning_only";
      verdictReason = "already a warning; never gates";
    } else if (judgeErrorShare > GATE_THRESHOLDS.judgeErrorMaxShareOfFlags && flaggedShare > GATE_THRESHOLDS.hardGateMaxFlaggedShare) {
      verdict = "disable_for_family";
      verdictReason = `${Math.round(judgeErrorShare * 100)}% of its flags on human parts are evidence-classified as judge, mapping or register errors, on ${Math.round(flaggedShare * 1000) / 10}% of ${cell.family} windows`;
    } else if (flaggedShare <= GATE_THRESHOLDS.hardGateMaxFlaggedShare) {
      verdict = "hard_gate_ok";
      verdictReason = `flags ${Math.round(flaggedShare * 1000) / 10}% of ${cell.family} human windows (≤ ${GATE_THRESHOLDS.hardGateMaxFlaggedShare * 100}%)`;
    } else if (flaggedShare <= GATE_THRESHOLDS.warningMaxFlaggedShare) {
      verdict = "warning_only";
      verdictReason = `flags ${Math.round(flaggedShare * 1000) / 10}% of ${cell.family} human windows: too many for a gate, useful as a warning`;
    } else {
      verdict = "disable_for_family";
      verdictReason = `flags ${Math.round(flaggedShare * 1000) / 10}% of ${cell.family} human windows`;
    }
    return {
      code: cell.code, family: cell.family, severity: cell.severity, windows, flaggedWindows: cell.flagged.size, flaggedShare,
      violations: cell.violations, byClass: cell.byClass, byProgram: cell.byProgram, verdict, verdictReason,
    };
  }).sort((a, b) => b.flaggedWindows - a.flaggedWindows || a.code.localeCompare(b.code) || a.family.localeCompare(b.family));
  const meanBy: Record<string, number> = {};
  for (const [fam, n] of Object.entries(windowsByFamily)) meanBy[fam] = r4((errorsByFamily[fam] ?? 0) / n);
  return {
    version: JUDGE_CALIBRATION_VERSION,
    windows: results.length,
    windowsByFamily,
    windowsWithErrors,
    windowsWithErrorsByFamily,
    rangePenalisedShare: results.length ? r4(rangePenalised / results.length) : 0,
    rangePenalisedByFamily: Object.fromEntries(Object.entries(rangePenalisedByFamily).map(([f, n]) => [f, r4(n / (windowsByFamily[f] ?? 1))])),
    errorsByClass,
    codeFamily,
    meanPlayabilityErrorsPerWindow: results.length ? r4(totalErrors / results.length) : 0,
    meanPlayabilityErrorsByFamily: meanBy,
  };
}

/** Up to `perCell` full cases per code × family × class, so a reader can see each class in the notes. */
export function sampleCases(results: readonly WindowCalibration[], perCell = 3): CalibrationViolation[] {
  const taken = new Map<string, number>();
  const out: CalibrationViolation[] = [];
  for (const r of results) {
    for (const v of r.violations) {
      if (v.severity !== "error") continue;
      const key = `${v.code}|${v.family}|${v.classification}`;
      const n = taken.get(key) ?? 0;
      if (n >= perCell) continue;
      taken.set(key, n + 1);
      out.push(v);
    }
  }
  return out;
}
