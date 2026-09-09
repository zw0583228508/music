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

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const noteEnd = (note: ConstraintNote): number => note.start + note.duration;
const idOf = (note: ConstraintNote, index: number): string => note.id ?? `note-${index}`;

/**
 * Groups of notes actually sounding together at a given onset.
 *
 * This deliberately does NOT chain by transitive overlap: a legato line where
 * each note ends as the next begins is a melody, not a 24-note chord. For every
 * distinct onset we collect the notes sounding at that instant, then keep the
 * distinct groups of two or more.
 */
/**
 * A previous note whose tail laps a few milliseconds into the next onset is
 * legato connection, not a chord. Shared with the provider contract validator
 * so the platform has one definition of "simultaneous", not two.
 */
export const LEGATO_TOLERANCE_SECONDS = 0.03;

function simultaneousClusters(notes: ConstraintNote[]): ConstraintNote[][] {
  const onsets = [...new Set(notes.map((note) => Math.round(note.start * 1000)))]
    .sort((a, b) => a - b);
  const seen = new Set<string>();
  const clusters: ConstraintNote[][] = [];
  for (const onsetMs of onsets) {
    const t = onsetMs / 1000;
    const sounding = notes
      .filter((note) =>
        note.start <= t + 1e-6 && noteEnd(note) > t + LEGATO_TOLERANCE_SECONDS)
      .sort((a, b) => a.pitch - b.pitch || a.start - b.start);
    if (sounding.length < 2) continue;
    const key = sounding.map((n) => `${n.pitch}@${n.start.toFixed(3)}`).join("|");
    if (seen.has(key)) continue;
    seen.add(key);
    clusters.push(sounding);
  }
  return clusters;
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
  const definition = safeDefinition(input.instrument ?? input.family, input.role ?? "");
  // A bass guitar lives in the "strings" definition family but is not a bowed
  // solo string player; give it its own physical rules.
  const family = /bass/i.test(`${input.instrument ?? ""} ${input.family}`)
    ? "bass"
    : input.family;
  const physical = physicalFor(family);
  // A string *section* has many players: divisi and independent leaps are fine.
  // Solo writing is the restrictive case.
  const isSection = input.isSection ??
    (family === "strings" && (definition?.constraints.maxSimultaneousNotes ?? 1) > 2);
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

  const clusters = simultaneousClusters(notes);
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

  // 4. Melodic leaps (top voice at each onset).
  const topLine = topVoice(notes);
  const maxLeap = definition?.constraints.maxLeap ?? 24;
  const impossibleLeap = input.leapCeiling ?? maxLeap * 1.5;
  const onsetCounts = new Map<number, number>();
  for (const note of notes) {
    const key = Math.round(note.start * 1000);
    onsetCounts.set(key, (onsetCounts.get(key) ?? 0) + 1);
  }
  // Section writing spreads leaps across players; only solo lines are bound.
  // A kit has no melodic leaps at all (PR-61: 304 "leaps" between kit pieces).
  for (let i = 1; !isSection && family !== "drums" && i < topLine.length; i += 1) {
    const gap = topLine[i].start - noteEnd(topLine[i - 1]);
    if (gap > 0.6) continue;
    // PR-61: a top-voice reduction of a polyphonic part is not a melody. When
    // the earlier note is still sounding past legato overlap, or either onset
    // is a chord, the "leap" is between two voices (46 of 83 flagged human
    // keyboard leaps, 18 of 45 bass, 14 of 49 brass).
    if (noteEnd(topLine[i - 1]) > topLine[i].start + LEGATO_TOLERANCE_SECONDS) continue;
    if ((onsetCounts.get(Math.round(topLine[i].start * 1000)) ?? 1) > 1 ||
      (onsetCounts.get(Math.round(topLine[i - 1].start * 1000)) ?? 1) > 1) continue;
    const leap = Math.abs(topLine[i].pitch - topLine[i - 1].pitch);
    if (leap > impossibleLeap) {
      add("impossible_leap", "error", [topLine[i - 1], topLine[i]],
        `A ${leap}-semitone leap exceeds the ${family} limit of ${maxLeap}.`,
        "Insert a passing note or re-voice into a nearer octave.");
    } else if (leap > maxLeap) {
      add("wide_leap", "warning", [topLine[i - 1], topLine[i]],
        `A ${leap}-semitone leap is wide for ${family} (limit ${maxLeap}).`,
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
    const runs = phrases(notes);
    let previousLong = false;
    for (const run of runs) {
      const span = noteEnd(run[run.length - 1]) - run[0].start;
      const longest = run.reduce((best, note) => (note.duration > best.duration ? note : best), run[0]);
      if (longest.duration > physical.breathCapacitySeconds) {
        add("breath_violation", "error", longest,
          `A single ${longest.duration.toFixed(1)} s note exceeds the ${family} breath capacity ` +
          `of ${physical.breathCapacitySeconds} s.`,
          "Split the note, or write it for a section.");
      } else if (span > physical.breathCapacitySeconds) {
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
      previousLong = span > physical.breathCapacitySeconds * 0.7;
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

/** Highest-sounding note at each onset — a monophonic reduction for leap checks. */
function topVoice(notes: ConstraintNote[]): ConstraintNote[] {
  const byStart = new Map<number, ConstraintNote>();
  for (const note of notes) {
    const key = Math.round(note.start * 1000);
    const held = byStart.get(key);
    if (!held || note.pitch > held.pitch) byStart.set(key, note);
  }
  return [...byStart.values()].sort((a, b) => a.start - b.start);
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

type ConstraintTrack = {
  id: string;
  instrument: string;
  role?: string;
  instrumentDefinition?: { family: string } | null;
  notes: ConstraintNote[];
  articulations?: Array<{ time: number; name: string }>;
};

export function checkArrangementConstraints(
  tracks: ConstraintTrack[],
  context: { tempoBpm: number },
): ArrangementConstraintReport {
  const byTrack = tracks.map((track) => {
    const family = track.instrumentDefinition?.family ??
      safeDefinition(track.instrument, track.role ?? "")?.family ?? "keys";
    const result = checkInstrumentConstraints({
      family,
      instrument: track.instrument,
      role: track.role,
      tempoBpm: context.tempoBpm,
      notes: track.notes,
      articulations: track.articulations,
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
  });
  const all = byTrack.flatMap((entry) => entry.violations);
  return {
    feasible: byTrack.every((entry) => entry.feasible),
    errorCount: all.filter((v) => v.severity === "error").length,
    warningCount: all.filter((v) => v.severity === "warning").length,
    byTrack,
  };
}
