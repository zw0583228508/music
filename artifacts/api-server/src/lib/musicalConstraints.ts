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
};

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
function simultaneousClusters(notes: ConstraintNote[]): ConstraintNote[][] {
  // A previous note whose tail laps a few milliseconds into the next onset is
  // legato connection, not a chord.
  const LEGATO_TOLERANCE_SECONDS = 0.03;
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
  const maxSimultaneous = definition?.constraints.maxSimultaneousNotes ?? 8;

  // 2. Polyphony ceiling.
  for (const cluster of clusters) {
    if (cluster.length > maxSimultaneous) {
      add("excess_polyphony", "error", cluster,
        `${cluster.length} notes sound together; the ${family} ceiling is ${maxSimultaneous}.`,
        `Drop ${cluster.length - maxSimultaneous} note(s) or move them to another track.`);
    }
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
  // Section writing spreads leaps across players; only solo lines are bound.
  for (let i = 1; !isSection && i < topLine.length; i += 1) {
    const gap = topLine[i].start - noteEnd(topLine[i - 1]);
    if (gap > 0.6) continue;
    const leap = Math.abs(topLine[i].pitch - topLine[i - 1].pitch);
    if (leap > maxLeap * 1.5) {
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

  // 6. Guitar / bass fret span.
  if (physical.maxFretSpanSemitones) {
    for (const cluster of clusters) {
      const pitches = cluster.map((n) => n.pitch);
      const spread = Math.max(...pitches) - Math.min(...pitches);
      const strings = definition?.constraints.strings ?? 6;
      if (new Set(pitches).size > strings) {
        add("impossible_fingering", "error", cluster,
          `${new Set(pitches).size} distinct notes need more than ${strings} strings.`,
          "Reduce the chord to the strings available.");
      } else if (spread > physical.maxFretSpanSemitones + 7) {
        add("impossible_fingering", "error", cluster,
          `A ${spread}-semitone chord shape is not fingerable on ${family}.`,
          "Use open strings, drop a voice, or split the chord.");
      } else if (spread > physical.maxFretSpanSemitones + 3) {
        add("hard_fingering", "warning", cluster,
          `A ${spread}-semitone chord shape is a stretch on ${family}.`,
          "Prefer a shape within a 4–5 fret span.");
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
  if (physical.breathCapacitySeconds) {
    const runs = phrases(notes);
    let previousLong = false;
    for (const run of runs) {
      const span = noteEnd(run[run.length - 1]) - run[0].start;
      if (span > physical.breathCapacitySeconds) {
        const breathAt = suggestedBreathPoint(run);
        add("breath_violation", "error", run,
          `A ${span.toFixed(1)} s continuous phrase exceeds the ${family} breath capacity ` +
          `of ${physical.breathCapacitySeconds} s.`,
          `Break for a breath near ${breathAt.toFixed(1)} s.`);
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
      if (cluster.length > limbs) {
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
