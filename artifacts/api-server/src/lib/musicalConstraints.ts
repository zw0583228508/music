/**
 * Musical Constraint Engine V2 (PR-07).
 *
 * Physical-playability checking on top of the existing `InstrumentDefinition`
 * (`musicEngines.ts`), which already carries playable/comfortable ranges,
 * `maxVoices`, articulations and `constraints` (maxLeap, minNoteDuration,
 * maxSimultaneousNotes, hands/feet/strings/frets/breathSeconds). This module
 * adds per-family physical reasoning — hand span, re-articulation limits,
 * breath capacity + recovery, fret span, string double-stops, drum limbs and
 * hi-hat state — and returns concrete violations with suggested fixes.
 *
 * Pure and deterministic. Consumed by the Hard-Rule critic (PR-11) and, later,
 * to gate Part Composer output (PR-09).
 *
 * PR-61 (judge calibration on 30,570 human PDMX windows) changed five rules
 * where the human corpus proved the old rule wrong; each is marked below with
 * the measured case that justified it.
 *
 * Brain B-13 (one playability truth): the predicates the engine judges with -
 * `simultaneousVoicesAt` / `polyphonyClusters` (who sounds together, under the
 * legato tolerance and the performance engine's own 12 ms chord-gesture
 * window), `melodicLeapViolations` (leaps judged per outer voice, never across
 * a chord's tones), `isSectionPart` - are exported, and the
 * provider contract validators (`musicProviders.ts`) and the playability
 * repair (`playabilityRepair.ts`) call them through `checkTrackConstraints` /
 * `contractPlayabilityErrors`. Before this the three held three definitions
 * of "simultaneous" and "leap" (audit §5.1, Probe 4) and the strictest, least
 * musical one won after the critic had scored.
 */
import type { InstrumentDefinition } from "@workspace/db";
import { getInstrumentDefinition } from "./musicEngines";

export type ConstraintNote = {
  id?: string;
  start: number;
  duration: number;
  pitch: number;
  velocity?: number;
};

export type ConstraintViolation = {
  code: string;
  severity: "error" | "warning";
  family: string;
  startSeconds: number;
  endSeconds: number | null;
  noteIds: string[];
  message: string;
  suggestedFix: string;
};

export type ConstraintCheckResult = {
  feasible: boolean;
  violations: ConstraintViolation[];
  checkedNotes: number;
};

export type ConstraintCheckInput = {
  family: string;
  instrument?: string;
  role?: string;
  tempoBpm: number;
  notes: ConstraintNote[];
  articulations?: Array<{ time: number; name: string }>;
  /** String families only: true = section (divisi allowed), false = solo. */
  isSection?: boolean;
  /**
   * The caller knows the actual instrument (a GM program) and the platform
   * definition does not: a brass section is not a trumpet, a slap bass is not
   * a bowed bass. Overrides the definition's polyphony ceiling.
   */
  polyphonyCeiling?: number;
  /** Semitones beyond which a leap in a solo line is an error (default 1.5 x the definition's maxLeap). */
  leapCeiling?: number;
  /**
   * B-13: the track's own definition (a remote provider's TrackModel carries
   * one; the orchestrator's tracks carry the one they were composed under).
   * When given, the rules judge against it instead of re-resolving the
   * instrument name, so the contract validator and the engine see one definition.
   */
  definition?: InstrumentDefinition | null;
};

/** Standard tunings the fingerability check tries, low to high (MIDI). */
export const TUNINGS: Record<string, { standard: number[]; extended: number[][] }> = {
  guitar: {
    standard: [40, 45, 50, 55, 59, 64],
    extended: [[38, 45, 50, 55, 59, 64], [35, 40, 45, 50, 55, 59, 64], [38, 43, 48, 53, 57, 62], [35, 42, 47, 52, 56, 61]],
  },
  bass: {
    standard: [28, 33, 38, 43],
    extended: [[23, 28, 33, 38, 43], [28, 33, 38, 43, 48], [23, 28, 33, 38, 43, 48], [26, 33, 38, 43]],
  },
};

/**
 * Can these pitches be fingered together on one instrument in this tuning?
 * Each string carries one pitch; a fretted note sits at fret = pitch - open
 * (0 < fret <= `frets`); the fretted notes must fit within `fretSpan` frets;
 * open strings cost nothing. Backtracking over the strings - tiny.
 *
 * PR-61: the 1.0 rule measured pitch spread and called a 16-semitone shape
 * unfingerable; 1,664 of 1,670 flagged human guitar chords (an open E major
 * spans 24 semitones) were fingerable in standard tuning.
 */
export function fingerable(pitches: number[], tuning: number[], frets = 22, fretSpan = 5): boolean {
  const distinct = [...new Set(pitches)].sort((a, b) => b - a);
  if (distinct.length > tuning.length) return false;
  const strings = [...tuning].sort((a, b) => b - a);
  const used = new Array<boolean>(strings.length).fill(false);
  const search = (index: number, lo: number, hi: number): boolean => {
    if (index === distinct.length) return true;
    const pitch = distinct[index];
    for (let s = 0; s < strings.length; s += 1) {
      if (used[s]) continue;
      const fret = pitch - strings[s];
      if (fret < 0 || fret > frets) continue;
      const nlo = fret === 0 ? lo : Math.min(lo, fret);
      const nhi = fret === 0 ? hi : Math.max(hi, fret);
      if (nhi - nlo >= fretSpan) continue;
      used[s] = true;
      if (search(index + 1, nlo, nhi)) { used[s] = false; return true; }
      used[s] = false;
    }
    return false;
  };
  return search(0, Number.POSITIVE_INFINITY, Number.NEGATIVE_INFINITY);
}

// ---------------------------------------------------------------------------
// Per-family physical profiles
// ---------------------------------------------------------------------------

type PhysicalProfile = {
  handSpanSemitones?: number;
  hands?: number;
  /** Minimum gap (end→next start) to re-strike the same pitch. */
  reArticulationMinSeconds: number;
  breathCapacitySeconds?: number;
  breathRecoverySeconds?: number;
  maxFretSpanSemitones?: number;
  doubleStopMaxSemitones?: number;
  limbs?: number;
  hatFlipMinSeconds?: number;
};

const PHYSICAL: Record<string, PhysicalProfile> = {
  keys: { handSpanSemitones: 14, hands: 2, reArticulationMinSeconds: 0.055 },
  drums: { reArticulationMinSeconds: 0.03, limbs: 4, hatFlipMinSeconds: 0.06 },
  guitar: { reArticulationMinSeconds: 0.06, maxFretSpanSemitones: 6 },
  bass: { reArticulationMinSeconds: 0.09, maxFretSpanSemitones: 7 },
  strings: { reArticulationMinSeconds: 0.11, doubleStopMaxSemitones: 12 },
  brass: { reArticulationMinSeconds: 0.09, breathCapacitySeconds: 10, breathRecoverySeconds: 0.6 },
  winds: { reArticulationMinSeconds: 0.08, breathCapacitySeconds: 8, breathRecoverySeconds: 0.5 },
  voice: { reArticulationMinSeconds: 0.12, breathCapacitySeconds: 8, breathRecoverySeconds: 0.5 },
  synth: { reArticulationMinSeconds: 0.02 },
};

const physicalFor = (family: string): PhysicalProfile =>
  PHYSICAL[family] ?? { reArticulationMinSeconds: 0.05 };

/**
 * The physical family a part is judged as: a bass guitar lives in the
 * "strings" definition family but is not a bowed solo string player.
 */
export function physicalFamilyOf(instrument: string | undefined, family: string): string {
  return /bass/i.test(`${instrument ?? ""} ${family}`) ? "bass" : family;
}

/**
 * The longest single note a player of this family can hold: the stricter of
 * the physical breath and the definition's sourced `breathSeconds`. Null for
 * families that do not breathe (keys, strings, guitar, kit, synth).
 */
export function breathCapacityFor(physicalFamily: string, definition: Pick<InstrumentDefinition, "constraints"> | null | undefined): number | null {
  const physical = physicalFor(physicalFamily).breathCapacitySeconds;
  if (!physical) return null;
  return Math.min(definition?.constraints.breathSeconds ?? Number.POSITIVE_INFINITY, physical);
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const noteEnd = (note: ConstraintNote): number => note.start + note.duration;
const idOf = (note: ConstraintNote, index: number): string => note.id ?? `note-${index}`;

/**
 * A previous note whose tail laps a few milliseconds into the next onset is
 * legato connection, not a chord. Shared with the provider contract validator
 * so the platform has one definition of "simultaneous", not two.
 */
export const LEGATO_TOLERANCE_SECONDS = 0.03;

// ---------------------------------------------------------------------------
// B-13: the shared playability predicates (one truth for engine, contract, repair)
// ---------------------------------------------------------------------------

/** Millisecond onset bucket: notes whose starts round to the same ms share an onset. */
export const onsetKey = (start: number): number => Math.round(start * 1000);

/**
 * One chord gesture: a player does not strike four notes at the same
 * microsecond, and the performance engine says so - it rolls a keyboard chord,
 * strums a guitar and staggers a string section's voices, grouping its own
 * clusters with `Math.abs(open[0].start - note.start) < 0.012`
 * (`performanceEngine.ts`). This is that same window, shared, so what the
 * engine performed as one chord every rule downstream also reads as one chord.
 *
 * Before B-13 the repair tested `o.start === n.start`: a string bed's three
 * voices, staggered 1.5 ms apart by the engine, became "earlier notes crowding
 * a later onset", the release computed for them was ~2 ms - under
 * `minNoteDuration` - and they were dropped. The owner's string bed shipped as
 * a single violin line (304 composed notes -> 91 shipped, 200 dropped;
 * review R-1b P0-1).
 */
export const GESTURE_WINDOW_SECONDS = 0.012;

/** Do these two onsets belong to one chord gesture? */
export const sameGesture = (a: number, b: number): boolean =>
  Math.abs(a - b) <= GESTURE_WINDOW_SECONDS + 1e-9;

/**
 * Onset identity per note under the gesture window: notes whose starts lie
 * within one window of the gesture's first onset share an onset key. The
 * anchor only moves when a note falls outside the open window, so a gesture
 * spans at most `GESTURE_WINDOW_SECONDS` and a run of 16ths never chains into
 * one giant "chord".
 */
export function gestureOnsets(
  notes: ReadonlyArray<ConstraintNote>,
  window = GESTURE_WINDOW_SECONDS,
): Map<ConstraintNote, number> {
  const sorted = [...notes].sort((a, b) => a.start - b.start);
  const out = new Map<ConstraintNote, number>();
  let anchor = Number.NEGATIVE_INFINITY;
  for (const note of sorted) {
    if (!(note.start <= anchor + window + 1e-9)) anchor = note.start;
    out.set(note, onsetKey(anchor));
  }
  return out;
}

/**
 * The notes sounding at instant `t`: started within a gesture of it or before,
 * and still sounding more than the legato tolerance after it. A tail that laps
 * a few milliseconds into the next onset is a connected line, not a second
 * voice; a voice struck 1.5 ms after the one below it is the same chord, not a
 * later note.
 */
export function simultaneousVoicesAt(notes: ReadonlyArray<ConstraintNote>, t: number): ConstraintNote[] {
  return notes
    .filter((note) =>
      note.start <= t + GESTURE_WINDOW_SECONDS + 1e-9 &&
      noteEnd(note) > t + LEGATO_TOLERANCE_SECONDS)
    .sort((a, b) => a.pitch - b.pitch || a.start - b.start);
}

/**
 * Groups of notes actually sounding together at a given onset.
 *
 * This deliberately does NOT chain by transitive overlap: a legato line where
 * each note ends as the next begins is a melody, not a 24-note chord. For every
 * distinct gesture we collect the notes sounding at its last onset (so every
 * voice of a rolled or staggered chord has arrived), then keep the distinct
 * groups of two or more.
 */
export function polyphonyClusters(notes: ReadonlyArray<ConstraintNote>): ConstraintNote[][] {
  const groups = gestureOnsets(notes);
  const lastStart = new Map<number, number>();
  for (const note of notes) {
    const key = groups.get(note)!;
    lastStart.set(key, Math.max(lastStart.get(key) ?? note.start, note.start));
  }
  const seen = new Set<string>();
  const clusters: ConstraintNote[][] = [];
  for (const t of [...lastStart.values()].sort((a, b) => a - b)) {
    const sounding = simultaneousVoicesAt(notes, t);
    if (sounding.length < 2) continue;
    const key = sounding.map((n) => `${n.pitch}@${n.start.toFixed(3)}`).join("|");
    if (seen.has(key)) continue;
    seen.add(key);
    clusters.push(sounding);
  }
  return clusters;
}

/** The most voices ever sounding together (1 for a line, 0 for an empty part). */
export function maxSimultaneousVoices(notes: ReadonlyArray<ConstraintNote>): number {
  if (!notes.length) return 0;
  return Math.max(1, ...polyphonyClusters(notes).map((c) => c.length));
}

/** Clusters wider than `ceiling` voices. */
export function polyphonyViolations(notes: ReadonlyArray<ConstraintNote>, ceiling: number): ConstraintNote[][] {
  return polyphonyClusters(notes).filter((cluster) => cluster.length > ceiling);
}

/**
 * The outer voices: the highest and the lowest note at every onset, in time
 * order. A chord contributes its top to the top line and its bottom to the
 * bottom line; a single note is both. Leaps are judged inside a line, never
 * from a chord's top to the next chord's bottom.
 */
export function outerVoices(notes: ReadonlyArray<ConstraintNote>): { top: ConstraintNote[]; bottom: ConstraintNote[]; onsetCounts: Map<number, number>; groupOf: Map<ConstraintNote, number> } {
  const top = new Map<number, ConstraintNote>();
  const bottom = new Map<number, ConstraintNote>();
  const onsetCounts = new Map<number, number>();
  // B-13: one chord gesture is one onset. The engine staggers a chord's voices
  // by 1.5-8 ms; without the window each staggered voice was its own "onset"
  // and the leap rule read a chord's tones as a melody.
  const groupOf = gestureOnsets(notes);
  for (const note of notes) {
    const key = groupOf.get(note)!;
    onsetCounts.set(key, (onsetCounts.get(key) ?? 0) + 1);
    const highest = top.get(key);
    if (!highest || note.pitch > highest.pitch) top.set(key, note);
    const lowest = bottom.get(key);
    if (!lowest || note.pitch < lowest.pitch) bottom.set(key, note);
  }
  const byStart = (a: ConstraintNote, b: ConstraintNote) => a.start - b.start;
  return { top: [...top.values()].sort(byStart), bottom: [...bottom.values()].sort(byStart), onsetCounts, groupOf };
}

export type LeapLine = "top" | "bottom";

export type LeapViolation = {
  from: ConstraintNote;
  to: ConstraintNote;
  leap: number;
  line: LeapLine;
  /** `error` above the ceiling (1.5 x maxLeap by default), `warning` above maxLeap. */
  severity: "error" | "warning";
};

export type LeapRuleOptions = {
  /** The instrument's comfortable leap (definition `maxLeap`); wider is a warning. */
  maxLeap: number;
  /** Beyond this a leap is an error; default 1.5 x `maxLeap` (PR-61 calibration). */
  leapCeiling?: number;
  /** A section spreads leaps across players: exempt. */
  isSection?: boolean;
  /** A kit has no melodic leaps (PR-61: 304 "leaps" between kit pieces): exempt. */
  family?: string;
  /** Polyphonic instruments are judged on both outer voices; a line on its one voice. */
  polyphonic?: boolean;
  /** A rest longer than this breaks the line (default 0.6 s). */
  restSeconds?: number;
  /**
   * `skip` (default, the PR-61 calibration): a pair in which either onset is a
   * chord is not judged - a top-voice reduction of two hands is not a melody
   * (46 of 83 flagged human keyboard leaps were between two voices). `judge`
   * compares outer voices across chords too (top to top, bottom to bottom);
   * not calibrated on the human corpus, offered for stricter callers.
   */
  chordOnsets?: "skip" | "judge";
};

/**
 * Melodic leaps judged per outer voice. Never across same-onset chord tones
 * (those are a voicing, not a melody), never from a chord's top to the next
 * chord's bottom, never when the earlier note is still sounding past the
 * legato tolerance (two voices), never across a rest longer than
 * `restSeconds`. Sections and kits are exempt.
 */
export function melodicLeapViolations(notes: ReadonlyArray<ConstraintNote>, options: LeapRuleOptions): LeapViolation[] {
  if (options.isSection || options.family === "drums") return [];
  const ceiling = options.leapCeiling ?? options.maxLeap * 1.5;
  const rest = options.restSeconds ?? 0.6;
  const mode = options.chordOnsets ?? "skip";
  const { top, bottom, onsetCounts, groupOf } = outerVoices(notes);
  const isChord = (note: ConstraintNote) => (onsetCounts.get(groupOf.get(note) ?? onsetKey(note.start)) ?? 1) > 1;
  const out: LeapViolation[] = [];
  const seen = new Set<string>();
  const judge = (line: ConstraintNote[], name: LeapLine) => {
    for (let i = 1; i < line.length; i += 1) {
      const from = line[i - 1];
      const to = line[i];
      const gap = to.start - noteEnd(from);
      if (gap > rest) continue;
      if (noteEnd(from) > to.start + LEGATO_TOLERANCE_SECONDS) continue;
      if (mode === "skip" && (isChord(from) || isChord(to))) continue;
      const leap = Math.abs(to.pitch - from.pitch);
      if (leap <= options.maxLeap) continue;
      // The same two notes seen from both lines (single notes) are one leap.
      const key = `${groupOf.get(from) ?? onsetKey(from.start)}:${from.pitch}>${groupOf.get(to) ?? onsetKey(to.start)}:${to.pitch}`;
      if (seen.has(key)) continue;
      seen.add(key);
      out.push({ from, to, leap, line: name, severity: leap > ceiling ? "error" : "warning" });
    }
  };
  judge(top, "top");
  if (options.polyphonic ?? true) judge(bottom, "bottom");
  return out.sort((a, b) => a.to.start - b.to.start || (a.line === "top" ? -1 : 1));
}

/**
 * Is this part a section (many players: divisi and independent leaps are
 * fine)? Forced by a role that says so; otherwise a string part whose
 * definition holds more than two voices is a section, solo writing is the
 * restrictive case. One inference for the engine, the contract and the repair.
 */
export function isSectionPart(family: string, role: string | undefined, definition: Pick<InstrumentDefinition, "constraints"> | null | undefined): boolean {
  if (/section|ensemble|divisi|pad|bed/i.test(role ?? "")) return true;
  return family === "strings" && (definition?.constraints.maxSimultaneousNotes ?? 1) > 2;
}

/** Can `pitches` be split into ≤ `hands` groups each within `span` semitones? */
function fitsInHands(pitches: number[], hands: number, span: number): boolean {
  const sorted = [...new Set(pitches)].sort((a, b) => a - b);
  if (sorted.length === 0) return true;
  let groups = 1;
  let anchor = sorted[0];
  for (const pitch of sorted) {
    if (pitch - anchor > span) {
      groups += 1;
      anchor = pitch;
    }
  }
  return groups <= hands;
}

/** Continuous phrases: runs of notes separated by rests shorter than `gap`. */
function phrases(notes: ConstraintNote[], gap = 0.15): ConstraintNote[][] {
  const sorted = [...notes].sort((a, b) => a.start - b.start);
  const out: ConstraintNote[][] = [];
  let current: ConstraintNote[] = [];
  for (const note of sorted) {
    const previous = current[current.length - 1];
    if (previous && note.start - noteEnd(previous) > gap) {
      out.push(current);
      current = [];
    }
    current.push(note);
  }
  if (current.length) out.push(current);
  return out;
}

// ---------------------------------------------------------------------------
// Engine
// ---------------------------------------------------------------------------

export function checkInstrumentConstraints(
  input: ConstraintCheckInput,
): ConstraintCheckResult {
  const definition = input.definition ?? safeDefinition(input.instrument ?? input.family, input.role ?? "");
  // A bass guitar lives in the "strings" definition family but is not a bowed
  // solo string player; give it its own physical rules.
  const family = /bass/i.test(`${input.instrument ?? ""} ${input.family}`)
    ? "bass"
    : input.family;
  const physical = physicalFor(family);
  // A string *section* has many players: divisi and independent leaps are fine.
  // Solo writing is the restrictive case.
  const isSection = input.isSection ?? isSectionPart(family, undefined, definition);
  const notes = input.notes
    .filter((note) =>
      Number.isFinite(note.start) && Number.isFinite(note.duration) &&
      note.duration > 0 && Number.isInteger(note.pitch))
    .sort((a, b) => a.start - b.start);
  const violations: ConstraintViolation[] = [];
  const add = (
    code: string, severity: "error" | "warning",
    at: ConstraintNote | ConstraintNote[], message: string, suggestedFix: string,
  ): void => {
    const group = Array.isArray(at) ? at : [at];
    const starts = group.map((n) => n.start);
    violations.push({
      code, severity, family,
      startSeconds: Math.min(...starts),
      endSeconds: Math.max(...group.map(noteEnd)),
      noteIds: group.map((n) => n.id ?? "").filter(Boolean),
      message, suggestedFix,
    });
  };

  // 1. Range (drums address kit pieces, not pitch).
  if (family !== "drums" && definition) {
    notes.forEach((note, index) => {
      if (note.pitch < definition.playableRange.min || note.pitch > definition.playableRange.max) {
        add("out_of_range", "error", { ...note, id: idOf(note, index) },
          `Pitch ${note.pitch} is outside the ${family} playable range ` +
          `${definition.playableRange.min}–${definition.playableRange.max}.`,
          "Transpose the note by an octave into the playable range.");
      } else if (
        note.pitch < definition.comfortableRange.min ||
        note.pitch > definition.comfortableRange.max
      ) {
        add("outside_comfortable_range", "warning", { ...note, id: idOf(note, index) },
          `Pitch ${note.pitch} is outside the comfortable ${family} range.`,
          "Prefer the comfortable register unless the extreme is deliberate.");
      }
    });
  }

  const clusters = polyphonyClusters(notes);
  const maxSimultaneous = input.polyphonyCeiling ?? definition?.constraints.maxSimultaneousNotes ?? 8;
  const oneVoiceBreath = maxSimultaneous === 1 && (family === "brass" || family === "winds" || family === "voice");

  // 2. Polyphony ceiling. The drum kit is bounded by limbs (rule 9), not by a
  // voice count - counting both flagged every five-piece hit twice.
  for (const cluster of clusters) {
    if (family === "drums" || cluster.length <= maxSimultaneous) continue;
    if (oneVoiceBreath && cluster.length <= 4) {
      // PR-61: 10.6 % of human brass windows carry two to four notes struck
      // together - divisi written on one staff ("a2"), which a section plays
      // and one player cannot. The file does not say which; a warning does.
      add("excess_polyphony", "warning", cluster,
        `${cluster.length} notes sound together on a one-voice ${family} part: divisi on one staff, or one player too many.`,
        "Mark the part as a section, or keep one voice per staff.");
      continue;
    }
    add("excess_polyphony", "error", cluster,
      `${cluster.length} notes sound together; the ${family} ceiling is ${maxSimultaneous}.`,
      `Drop ${cluster.length - maxSimultaneous} note(s) or move them to another track.`);
  }

  // 3. Piano/keys hand span.
  if (physical.handSpanSemitones && physical.hands) {
    for (const cluster of clusters) {
      const pitches = cluster.map((n) => n.pitch);
      if (!fitsInHands(pitches, physical.hands, physical.handSpanSemitones)) {
        add("unplayable_voicing", "error", cluster,
          `This voicing spans ${Math.max(...pitches) - Math.min(...pitches)} semitones — ` +
          `beyond ${physical.hands} hands at ${physical.handSpanSemitones} semitones each.`,
          "Re-voice closer, drop an inner voice, or arpeggiate.");
      }
    }
  }

  // 4. Melodic leaps, per outer voice (B-13: the shared predicate). Section
  // writing spreads leaps across players and a kit has no melodic leaps at all
  // (PR-61: 304 "leaps" between kit pieces); a pair in which either onset is a
  // chord, or whose earlier note still sounds past the legato tolerance, is
  // two voices, not a melody (PR-61: 46 of 83 flagged human keyboard leaps,
  // 18 of 45 bass, 14 of 49 brass).
  const maxLeap = definition?.constraints.maxLeap ?? 24;
  for (const v of melodicLeapViolations(notes, {
    maxLeap, leapCeiling: input.leapCeiling, isSection, family,
    polyphonic: (definition?.constraints.maxSimultaneousNotes ?? maxSimultaneous) > 1,
  })) {
    if (v.severity === "error") {
      add("impossible_leap", "error", [v.from, v.to],
        `A ${v.leap}-semitone leap exceeds the ${family} limit of ${maxLeap}.`,
        "Insert a passing note or re-voice into a nearer octave.");
    } else {
      add("wide_leap", "warning", [v.from, v.to],
        `A ${v.leap}-semitone leap is wide for ${family} (limit ${maxLeap}).`,
        "Consider a step-wise approach or an octave adjustment.");
    }
  }

  // 5. Re-articulation of the same pitch.
  const byPitch = new Map<number, ConstraintNote[]>();
  for (const note of notes) {
    const list = byPitch.get(note.pitch) ?? [];
    list.push(note);
    byPitch.set(note.pitch, list);
  }
  for (const list of byPitch.values()) {
    list.sort((a, b) => a.start - b.start);
    for (let i = 1; i < list.length; i += 1) {
      const gap = list[i].start - noteEnd(list[i - 1]);
      if (gap >= -1e-6 && gap < physical.reArticulationMinSeconds) {
        add("unrealistic_repetition", "warning", [list[i - 1], list[i]],
          `The same pitch is re-struck after ${(gap * 1000).toFixed(0)} ms; ` +
          `${family} needs about ${(physical.reArticulationMinSeconds * 1000).toFixed(0)} ms.`,
          "Lengthen the first note or thin the repeats.");
      }
    }
  }

  // 6. Guitar / bass fingering: one pitch per string, fretted notes within a
  // hand, open strings free (PR-61; the old pitch-spread rule is described
  // at `fingerable`).
  if (physical.maxFretSpanSemitones) {
    const tunings = TUNINGS[family === "bass" ? "bass" : "guitar"];
    const frets = definition?.constraints.frets ?? 22;
    // A pitch no string of any tuning tried can reach is a *range* fact and is
    // reported as one; asking whether it can be fingered reports the same note
    // twice. PR-61: 216 of 220 human bass "unfingerable shapes" contained a
    // pitch below the lowest string (an octave doubling written under a bass
    // program, e.g. 22 + 34, where 22 is under a five-string bass's low B).
    const reachLow = Math.min(...tunings.standard, ...tunings.extended.flat());
    const reachHigh = Math.max(...tunings.standard, ...tunings.extended.flat()) + frets;
    for (const cluster of clusters) {
      const reachable = cluster.filter((n) => n.pitch >= reachLow && n.pitch <= reachHigh);
      if (reachable.length < 2) continue;
      const pitches = reachable.map((n) => n.pitch);
      const distinct = new Set(pitches).size;
      if (distinct > tunings.standard.length + 1) {
        add("impossible_fingering", "error", reachable,
          `${distinct} distinct notes need more than ${tunings.standard.length} strings.`,
          "Reduce the chord to the strings available.");
      } else if (fingerable(pitches, tunings.standard, frets)) {
        continue;
      } else if (tunings.extended.some((t) => fingerable(pitches, t, frets))) {
        add("hard_fingering", "warning", reachable,
          `This ${distinct}-note shape needs an alternative tuning (drop D, a seventh string, a fifth bass string).`,
          "Prefer a shape fingerable in standard tuning.");
      } else {
        add("impossible_fingering", "error", reachable,
          `This ${distinct}-note shape cannot be fingered on ${family} within a five-fret hand in any common tuning.`,
          "Use open strings, drop a voice, or split the chord.");
      }
    }
  }

  // 7. String double stops (solo only).
  if (family === "strings" && physical.doubleStopMaxSemitones && !isSection) {
    for (const cluster of clusters) {
      if (cluster.length > 2) {
        add("triple_stop", "error", cluster,
          "A solo string player cannot sustain three or more notes together.",
          "Mark the part as a section (divisi) or arpeggiate.");
        continue;
      }
      const interval = Math.abs(cluster[0].pitch - cluster[1].pitch);
      if (interval > physical.doubleStopMaxSemitones) {
        add("unplayable_double_stop", "warning", cluster,
          `A ${interval}-semitone double stop is beyond a comfortable reach.`,
          "Keep double stops within an octave, on adjacent strings.");
      }
    }
  }

  // 8. Breath capacity + recovery (brass / winds / voice).
  //
  // PR-61: 4,771 of 4,772 human wind and brass "breath violations" were
  // phrases of separately attacked notes written at full value - a player
  // breathes by shortening the note before an attack, and score-exported
  // MIDI encodes no breath. Only a single note longer than a breath is a
  // physical impossibility; a long unbroken phrase is a warning.
  if (physical.breathCapacitySeconds) {
    // B-13: one capacity for the engine, the contract validator and the repair
    // - the stricter of the player's physical breath and the definition's
    // sourced value (a section's 12 s is staggered across players; a flute
    // holds about 8).
    const capacity = breathCapacityFor(family, definition) ?? physical.breathCapacitySeconds;
    const runs = phrases(notes);
    let previousLong = false;
    for (const run of runs) {
      const span = noteEnd(run[run.length - 1]) - run[0].start;
      const longest = run.reduce((best, note) => (note.duration > best.duration ? note : best), run[0]);
      if (longest.duration > capacity) {
        add("breath_violation", "error", longest,
          `A single ${longest.duration.toFixed(1)} s note exceeds the ${family} breath capacity ` +
          `of ${capacity} s.`,
          "Split the note, or write it for a section.");
      } else if (span > capacity) {
        const breathAt = suggestedBreathPoint(run);
        add("long_phrase_no_rest", "warning", run,
          `A ${span.toFixed(1)} s phrase with no rest; the player must steal a breath from a note.`,
          `Leave a rest near ${breathAt.toFixed(1)} s.`);
      }
      if (previousLong) {
        add("no_breath_recovery", "warning", run,
          "A demanding phrase follows another with no room to breathe.",
          `Leave at least ${physical.breathRecoverySeconds ?? 0.5} s before this phrase.`);
      }
      previousLong = span > capacity * 0.7;
    }
  }

  // 9. Drum limbs + hi-hat state.
  if (family === "drums") {
    const limbs = physical.limbs ?? definition?.constraints.hands ?? 4;
    for (const cluster of clusters) {
      if (cluster.length === limbs + 1) {
        // PR-61: every one of 224 flagged human kit hits had exactly five
        // voices - standard notation a drummer renders with a flam, a pedal
        // hi-hat, or by dropping one voice.
        add("impossible_limb_count", "warning", cluster,
          `${cluster.length} simultaneous hits on ${limbs} limbs: a flam, a pedal hi-hat, or one voice dropped.`,
          "Remove a voice or flam the hit.");
      } else if (cluster.length > limbs + 1) {
        add("impossible_limb_count", "error", cluster,
          `${cluster.length} simultaneous hits need more than ${limbs} limbs.`,
          "Remove a voice or flam the hit.");
      }
    }
    const hats = (input.articulations ?? [])
      .filter((a) => a.name === "open_hat" || a.name === "closed_hat")
      .sort((a, b) => a.time - b.time);
    for (let i = 1; i < hats.length; i += 1) {
      if (hats[i].name !== hats[i - 1].name &&
        hats[i].time - hats[i - 1].time < (physical.hatFlipMinSeconds ?? 0.06)) {
        violations.push({
          code: "impossible_hat_state", severity: "warning", family,
          startSeconds: hats[i - 1].time, endSeconds: hats[i].time, noteIds: [],
          message: "The hi-hat flips open/closed faster than the pedal can move.",
          suggestedFix: "Space hat-state changes at least 60 ms apart.",
        });
      }
    }
  }

  const errors = violations.filter((v) => v.severity === "error");
  return { feasible: errors.length === 0, violations, checkedNotes: notes.length };
}

function safeDefinition(instrument: string, role: string): InstrumentDefinition | null {
  try {
    return getInstrumentDefinition(instrument, role);
  } catch {
    return null;
  }
}

function suggestedBreathPoint(run: ConstraintNote[]): number {
  let bestGap = -1;
  let bestAt = run[Math.floor(run.length / 2)].start;
  for (let i = 1; i < run.length; i += 1) {
    const gap = run[i].start - noteEnd(run[i - 1]);
    if (gap > bestGap) {
      bestGap = gap;
      bestAt = noteEnd(run[i - 1]);
    }
  }
  return bestAt;
}

// ---------------------------------------------------------------------------
// Arrangement-level aggregate
// ---------------------------------------------------------------------------

export type ArrangementConstraintReport = {
  feasible: boolean;
  errorCount: number;
  warningCount: number;
  byTrack: Array<{
    trackId: string;
    instrument: string;
    family: string;
    feasible: boolean;
    violations: ConstraintViolation[];
  }>;
};

export type ConstraintTrack = {
  id: string;
  instrument: string;
  role?: string;
  /** The track's definition; a full `InstrumentDefinition` is judged against directly (B-13). */
  instrumentDefinition?: InstrumentDefinition | { family: string } | null;
  notes: ConstraintNote[];
  articulations?: Array<{ time: number; name: string }>;
};

const isFullDefinition = (value: ConstraintTrack["instrumentDefinition"]): value is InstrumentDefinition =>
  !!value && typeof value === "object" && "constraints" in value && "playableRange" in value;

/**
 * One track through the engine, the way `checkArrangementConstraints` has
 * always run it: the family from the track's definition, `section` forced only
 * when the role says so (else inferred from the definition's voice count), and
 * - B-13 - the track's own definition when it carries a full one, so a remote
 * provider's TrackModel is judged against the definition it declares.
 */
export function checkTrackConstraints(track: ConstraintTrack, context: { tempoBpm: number }): ArrangementConstraintReport["byTrack"][number] {
  const definition = isFullDefinition(track.instrumentDefinition) ? track.instrumentDefinition : null;
  const family = track.instrumentDefinition?.family ??
    safeDefinition(track.instrument, track.role ?? "")?.family ?? "keys";
  const result = checkInstrumentConstraints({
    family,
    instrument: track.instrument,
    role: track.role,
    tempoBpm: context.tempoBpm,
    notes: track.notes,
    articulations: track.articulations,
    definition,
    // Only force "section" when the role says so; otherwise let the engine
    // infer it from the instrument definition's voice count.
    isSection: /section|ensemble|divisi|pad|bed/i.test(track.role ?? "") || undefined,
  });
  return {
    trackId: track.id,
    instrument: track.instrument,
    family,
    feasible: result.feasible,
    violations: result.violations,
  };
}

/**
 * B-13: the provider contract's playability rules as one function over the
 * engine, so `validateArrangementProviderOutput`, `validateCanonicalTrackModels`
 * and `playabilityRepair` reject exactly what `checkInstrumentConstraints`
 * rejects: range (kits excepted: they address pieces, not pitches), voices
 * sounding together at an onset under the legato tolerance (with the engine's
 * fingering / hand-span / double-stop / limb rules), melodic leaps per outer
 * voice above the calibrated ceiling, a single note longer than a breath - plus
 * the one rule that is the renderer's, not the player's: a note shorter than
 * the instrument's minimum duration. Messages keep the historical wording so
 * callers that match on them still do.
 */
export const CONTRACT_PLAYABILITY_CODES = {
  range: ["out_of_range"],
  polyphony: ["excess_polyphony", "unplayable_voicing", "impossible_fingering", "triple_stop", "impossible_limb_count"],
  leap: ["impossible_leap"],
  breath: ["breath_violation"],
} as const;

export type ContractPlayabilityRule = keyof typeof CONTRACT_PLAYABILITY_CODES | "min_duration";

export type ContractPlayabilityError = { rule: ContractPlayabilityRule; code: string; message: string; noteIds: string[] };

export function contractPlayabilityErrors(
  track: ConstraintTrack & { instrumentDefinition: InstrumentDefinition },
  context: { tempoBpm?: number } = {},
): ContractPlayabilityError[] {
  // One entry per violation (the repair needs every one); callers that report
  // per track dedupe the messages.
  const errors: ContractPlayabilityError[] = [];
  const report = checkTrackConstraints(track, { tempoBpm: context.tempoBpm ?? 120 });
  const push = (rule: ContractPlayabilityRule, code: string, message: string, noteIds: string[]) => {
    errors.push({ rule, code, message, noteIds });
  };
  for (const violation of report.violations) {
    if (violation.severity !== "error") continue;
    const code = violation.code;
    if ((CONTRACT_PLAYABILITY_CODES.range as readonly string[]).includes(code)) {
      push("range", code, `${track.id} contains a note outside the instrument playable range`, violation.noteIds);
    } else if (code === "excess_polyphony") {
      push("polyphony", code, `${track.id} exceeds the instrument polyphony limit`, violation.noteIds);
    } else if ((CONTRACT_PLAYABILITY_CODES.polyphony as readonly string[]).includes(code)) {
      push("polyphony", code, `${track.id} contains a voicing the instrument cannot play (${code})`, violation.noteIds);
    } else if ((CONTRACT_PLAYABILITY_CODES.leap as readonly string[]).includes(code)) {
      push("leap", code, `${track.id} contains an unplayable melodic leap`, violation.noteIds);
    } else if ((CONTRACT_PLAYABILITY_CODES.breath as readonly string[]).includes(code)) {
      push("breath", code, `${track.id} contains a phrase longer than the instrument breath limit`, violation.noteIds);
    }
  }
  const minNoteDuration = track.instrumentDefinition.constraints.minNoteDuration;
  const short = track.notes.filter((note) => note.duration < minNoteDuration - 1e-9);
  if (short.length) {
    push("min_duration", "min_duration", `${track.id} contains notes shorter than the instrument can perform`, short.map((n, i) => n.id ?? `note-${i}`));
  }
  return errors;
}

export function checkArrangementConstraints(
  tracks: ConstraintTrack[],
  context: { tempoBpm: number },
): ArrangementConstraintReport {
  const byTrack = tracks.map((track) => checkTrackConstraints(track, context));
  const all = byTrack.flatMap((entry) => entry.violations);
  return {
    feasible: byTrack.every((entry) => entry.feasible),
    errorCount: all.filter((v) => v.severity === "error").length,
    warningCount: all.filter((v) => v.severity === "warning").length,
    byTrack,
  };
}
