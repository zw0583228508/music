/**
 * Brain B-12: pure checkers behind the metamorphic invariants.
 *
 * Each checker takes arrangement output (and, where needed, the Song Model)
 * and returns a list of violations. The property tests run the checkers over
 * many seeds and, separately, over deliberately broken input so every
 * invariant is shown to fail when it should. Nothing here changes any input.
 */
import { createHash } from "node:crypto";
import type { ArrangementArcSection, GroovePlan, GroovePlanSection, MusicalNote, PartTask, SongModelData, TrackModel } from "@workspace/db";
import { orchestrateArrangement, type OrchestrateInput, type OrchestrationResult, type OrchestratedCandidate } from "../arrangementOrchestrator";
import { barTiming, type BarTiming } from "../composer/frame";
import { chordEventsIn, type HarmonyChordEvent } from "../harmonyPlan/shared";
import { composeReferencePart } from "../referencePartComposer";
import { buildPartGenerationRequest, planPartComposition, type PartGenerationRequest } from "../partComposer";
import { deriveGroovePlan, styleFamilyOf } from "../groovePlan";
import { critiqueArrangement } from "../musicCritic";
import { buildCandidateProvenance, barOfSeconds, type CandidateProvenance } from "../decisionProvenance";
import { cellOf, classifyTransformation, buildMotifLedger, type MotifLedger } from "../motifLedger";
import { chordTonesOf, meterParts, transposeSongModel } from "./generators";

export type Violation = {
  code: string;
  detail: string;
  trackId?: string;
  sectionName?: string;
  count?: number;
};

// ---------------------------------------------------------------------------
// Running the brain
// ---------------------------------------------------------------------------

export function runBrain(songModel: SongModelData, options: Partial<OrchestrateInput> = {}): OrchestrationResult {
  return orchestrateArrangement({ songModel, candidateCount: 3, render: false, now: new Date(0), ...options });
}

// ---------------------------------------------------------------------------
// Bar geometry from the Song Model's own bars (never the composer's grid)
// ---------------------------------------------------------------------------

export type BarGeometry = {
  numerator: number;
  denominator: number;
  bars: Array<{ bar: number; start: number; end: number }>;
  barOf(seconds: number): number;
  /** Position inside the bar in notated beats (0 = downbeat; a quarter in x/4, an eighth in x/8). */
  beatInBar(seconds: number): number;
  /** Absolute position in notated beats from the song start. */
  absoluteBeat(seconds: number): number;
  barBounds(bar: number): { start: number; end: number };
};

export function geometryOf(model: SongModelData): BarGeometry {
  const meter = model.meterMap?.[0]?.meter ?? "4/4";
  const { numerator, denominator } = meterParts(meter);
  const bpm = model.tempoMap?.[0]?.bpm ?? 120;
  const nominalBar = (60 / bpm) * (4 / denominator) * numerator;
  const bars = (model.bars ?? []).slice().sort((a, b) => a.bar - b.bar).map((b) => ({ bar: b.bar, start: b.start, end: b.end }));
  const barBounds = (bar: number) => {
    const explicit = bars[bar - 1];
    if (explicit && explicit.bar === bar) return { start: explicit.start, end: explicit.end };
    return { start: (bar - 1) * nominalBar, end: bar * nominalBar };
  };
  const barOf = (seconds: number): number => {
    if (bars.length) {
      for (const b of bars) if (seconds >= b.start - 1e-6 && seconds < b.end - 1e-6) return b.bar;
      const last = bars[bars.length - 1];
      if (seconds >= last.end - 1e-6) {
        const span = last.end - last.start || nominalBar;
        return last.bar + Math.floor((seconds - last.end) / span) + 1;
      }
      return 1;
    }
    return Math.floor(seconds / nominalBar) + 1;
  };
  const beatInBar = (seconds: number): number => {
    const bar = barOf(seconds);
    const { start, end } = barBounds(bar);
    const span = end - start || nominalBar;
    return ((seconds - start) / span) * numerator;
  };
  const absoluteBeat = (seconds: number): number => (barOf(seconds) - 1) * numerator + beatInBar(seconds);
  return { numerator, denominator, bars, barOf, beatInBar, absoluteBeat, barBounds };
}

// ---------------------------------------------------------------------------
// Track helpers
// ---------------------------------------------------------------------------

/**
 * A drum track is one the *planner* wrote as drums or percussion. The track's
 * own instrument definition is deliberately not consulted: the first sweep
 * found keys parts carrying a drum-kit definition (see
 * `definitionFamilyMismatches`), and a checker that trusted the definition
 * would have judged a piano part as a kit.
 */
export const isDrumTrack = (track: Pick<TrackModel, "instrument">): boolean =>
  /^(drums?|percussion)$/i.test(track.instrument) || /\bdrum|percussion/i.test(track.instrument);

export const isPitchedTrack = (track: Pick<TrackModel, "instrument">): boolean => !isDrumTrack(track);

/** The planner family a brain track answers to: the orchestrator names tracks by family. */
export const familyOfTrack = (track: Pick<TrackModel, "instrument">): string => track.instrument.toLowerCase();

/** Notes the performance engine adds on top of the composition (ghosts, flams, grace notes, fills). */
export const isPerformanceAddition = (note: MusicalNote): boolean => /-(ghost|flam|grace|fill-\d+)$/.test(note.id);

/** Ghost notes and flams are added by the performance engine at low velocity; the accent pattern is the rest. */
export const isAccentHit = (note: MusicalNote): boolean => note.velocity >= 45 && !isPerformanceAddition(note);

/** Planner family -> the instrument-definition family it must resolve to. */
const EXPECTED_DEFINITION_FAMILY: Record<string, string[]> = {
  drums: ["drums"], percussion: ["drums"], bass: ["strings"], keys: ["keys"], piano: ["keys"], guitar: ["guitar"],
  strings: ["strings"], pads: ["synth"], synth: ["synth"], brass: ["brass"], winds: ["winds"], ensemble: ["keys"],
};

/**
 * Every shipped track's instrument definition must belong to the family the
 * planner assigned; a piano part with a drum-kit definition is composed into
 * the kit's range, performed with ghosts and flams, and routed to a kit.
 */
export function definitionFamilyMismatches(tracks: TrackModel[]): Violation[] {
  const violations: Violation[] = [];
  for (const track of tracks) {
    const expected = EXPECTED_DEFINITION_FAMILY[familyOfTrack(track)];
    if (!expected) continue;
    if (!expected.includes(track.instrumentDefinition.family)) {
      violations.push({
        code: "definition_family_mismatch", trackId: track.id,
        detail: `${track.id} (role ${track.role}) carries the ${track.instrumentDefinition.id} definition (family ${track.instrumentDefinition.family}); expected ${expected.join("/")}`,
      });
    }
  }
  return violations;
}

export function notesInBars(track: TrackModel, geometry: BarGeometry, startBar: number, endBar: number): MusicalNote[] {
  return track.notes.filter((note) => {
    const bar = geometry.barOf(note.start);
    return bar >= startBar && bar <= endBar;
  });
}

export function stableStringify(value: unknown): string {
  return JSON.stringify(value, (_key, item) => {
    if (item && typeof item === "object" && !Array.isArray(item)) {
      return Object.keys(item as Record<string, unknown>).sort().reduce<Record<string, unknown>>((acc, key) => {
        acc[key] = (item as Record<string, unknown>)[key];
        return acc;
      }, {});
    }
    return item;
  });
}

export const sha256 = (value: unknown): string =>
  createHash("sha256").update(typeof value === "string" ? value : stableStringify(value)).digest("hex");

export function trackDigest(track: TrackModel): { id: string; instrument: string; notes: number; sha256: string } {
  return {
    id: track.id, instrument: track.instrument, notes: track.notes.length,
    sha256: sha256(track.notes.map((n) => [n.id, n.start, n.duration, n.pitch, n.velocity])),
  };
}

export function candidateDigest(candidate: OrchestratedCandidate) {
  return {
    candidateId: candidate.candidateId,
    strategy: candidate.strategy,
    noteCount: candidate.noteCount,
    trackModelsSha256: sha256(candidate.trackModels),
    tracks: candidate.trackModels.map(trackDigest),
  };
}

// ---------------------------------------------------------------------------
// Pitch-class content
// ---------------------------------------------------------------------------

export function pitchClassHistogram(notes: readonly MusicalNote[]): number[] {
  const histogram = new Array<number>(12).fill(0);
  for (const note of notes) histogram[((note.pitch % 12) + 12) % 12] += 1;
  return histogram;
}

export const rotateHistogram = (histogram: number[], semitones: number): number[] =>
  histogram.map((_, index) => histogram[(((index - semitones) % 12) + 12) % 12]);

// ---------------------------------------------------------------------------
// Transposition
// ---------------------------------------------------------------------------

export type TranspositionReport = {
  violations: Violation[];
  octaveFolds: number;
  matchedNotes: number;
  rhythmChangedFamilies: string[];
  /** Onsets that moved by less than a chord-roll/strum gesture (benign: the roll order follows pitch order). */
  gestureShifts: number;
};

/** Chord-roll / strum spread ceiling in the performance engine (guitar: 8 + 2.5n + 6 ms; keys: 4 + 1.8n ms). */
export const GESTURE_SPREAD_CEILING_SECONDS = 0.04;

/** `part-Verse-keys-RHYTHMIC_HARMONY-c17.01-1` -> `part-Verse-keys-RHYTHMIC_HARMONY-c17.01` (the chord the voice belongs to). */
const chordKeyOf = (noteId: string): string => noteId.replace(/-\d+$/, "");

/**
 * The arrangement of T_k(song) must be T_k(arrangement of song) at the
 * pitch-class level, note for note (ids match: the composer names notes by
 * task and position), with identical onsets/durations; a whole-octave
 * difference on a matched note is a fold forced by range and is counted, not
 * failed. Families, roles and playability are compared on the plans.
 */
export function checkTransposition(
  original: OrchestrationResult,
  transposed: OrchestrationResult,
  semitones: number,
): TranspositionReport {
  const violations: Violation[] = [];
  let octaveFolds = 0;
  let matchedNotes = 0;
  let gestureShifts = 0;
  const rhythmChanged = new Set<string>();
  const planA = original.plan.sectionPlan;
  const planB = transposed.plan.sectionPlan;
  for (const section of planA?.sections ?? []) {
    const twin = planB?.sections.find((s) => s.sectionName === section.sectionName);
    if (!twin) { violations.push({ code: "section_missing", detail: section.sectionName, sectionName: section.sectionName }); continue; }
    if (stableStringify(section.activeInstrumentFamilies) !== stableStringify(twin.activeInstrumentFamilies)) {
      violations.push({ code: "active_families_changed", sectionName: section.sectionName, detail: `${section.activeInstrumentFamilies.join(",")} -> ${twin.activeInstrumentFamilies.join(",")}` });
    }
  }
  const rolesA = (planA?.roleAssignments ?? []).map((r) => `${r.sectionName}|${r.instrument}|${r.role}`).sort();
  const rolesB = (planB?.roleAssignments ?? []).map((r) => `${r.sectionName}|${r.instrument}|${r.role}`).sort();
  if (stableStringify(rolesA) !== stableStringify(rolesB)) {
    violations.push({ code: "roles_changed", detail: `${rolesA.filter((r) => !rolesB.includes(r)).join("; ")} vs ${rolesB.filter((r) => !rolesA.includes(r)).join("; ")}` });
  }
  if (original.candidates.length !== transposed.candidates.length) {
    violations.push({ code: "candidate_count_changed", detail: `${original.candidates.length} vs ${transposed.candidates.length}` });
  }
  for (const candidate of original.candidates) {
    const twin = transposed.candidates.find((c) => c.candidateId === candidate.candidateId);
    if (!twin) { violations.push({ code: "candidate_missing", detail: candidate.candidateId }); continue; }
    if (candidate.constraintErrors !== twin.constraintErrors) {
      violations.push({ code: "playability_changed", detail: `${candidate.candidateId}: ${candidate.constraintErrors} -> ${twin.constraintErrors} constraint errors` });
    }
    for (const track of candidate.trackModels) {
      const other = twin.trackModels.find((t) => t.id === track.id);
      if (!other) { violations.push({ code: "track_missing", trackId: track.id, detail: `${candidate.candidateId}/${track.id} absent after transposition` }); continue; }
      const byId = new Map(other.notes.map((n) => [n.id, n]));
      const lostIds: string[] = [];
      let pitchWrong = 0;
      let rhythmWrong = 0;
      for (const note of track.notes) {
        const match = byId.get(note.id);
        if (!match) { lostIds.push(note.id); continue; }
        byId.delete(note.id);
        matchedNotes += 1;
        const startShift = Math.abs(match.start - note.start);
        const durationShift = Math.abs(match.duration - note.duration);
        if (startShift > GESTURE_SPREAD_CEILING_SECONDS || durationShift > GESTURE_SPREAD_CEILING_SECONDS) rhythmWrong += 1;
        else if (startShift > 1e-4 || durationShift > 1e-4) gestureShifts += 1;
        if (isDrumTrack(track)) {
          if (match.pitch !== note.pitch) pitchWrong += 1;
          continue;
        }
        const delta = match.pitch - note.pitch;
        if (delta === semitones) continue;
        if ((((delta - semitones) % 12) + 12) % 12 === 0) octaveFolds += 1;
        else pitchWrong += 1;
      }
      const gainedIds = [...byId.keys()];
      // A lost voice and a gained voice of the same chord: the repair or the
      // dedupe kept a different member of the same voicing in the other key.
      const gainedChords = new Set(gainedIds.map(chordKeyOf));
      const voiceSwaps = lostIds.filter((id) => gainedChords.has(chordKeyOf(id))).length;
      const missing = lostIds.length - voiceSwaps;
      const extra = gainedIds.length - voiceSwaps;
      if (voiceSwaps) {
        violations.push({ code: "voice_choice_changed", trackId: track.id, count: voiceSwaps, detail: `${candidate.candidateId}/${track.id}: ${voiceSwaps} chord(s) ship a different voice after transposition (a repair/dedupe tie broken on pitch)` });
      }
      if (missing || extra) {
        violations.push({ code: "note_set_changed", trackId: track.id, count: missing + extra, detail: `${candidate.candidateId}/${track.id}: ${missing} note(s) lost, ${extra} gained` });
      }
      if (pitchWrong) {
        violations.push({ code: isDrumTrack(track) ? "drum_pitches_changed" : "pitch_not_transposed", trackId: track.id, count: pitchWrong, detail: `${candidate.candidateId}/${track.id}: ${pitchWrong} note(s) not at +${semitones} (mod 12)` });
      }
      if (rhythmWrong) {
        rhythmChanged.add(familyOfTrack(track));
        violations.push({ code: "rhythm_changed", trackId: track.id, count: rhythmWrong, detail: `${candidate.candidateId}/${track.id}: ${rhythmWrong} onset/duration change(s) beyond ${GESTURE_SPREAD_CEILING_SECONDS * 1000} ms` });
      }
    }
  }
  return { violations, octaveFolds, matchedNotes, rhythmChangedFamilies: [...rhythmChanged].sort(), gestureShifts };
}

// ---------------------------------------------------------------------------
// Tempo
// ---------------------------------------------------------------------------

/**
 * V1 performance offsets, from `performanceEngine.ts`: family jitter up to
 * 14 ms x 1.3, feel up to 5 + 8 ms, rubato breathing 12 ms, chord roll /
 * strum spread up to ~29 ms, left-hand lead 4 ms. Everything except swing
 * (which scales with the beat) is an absolute millisecond quantity, so the
 * documented ceiling per note is about 60 ms. The invariant allows exactly
 * that and reports the largest deviation it saw.
 */
export const PERFORMANCE_OFFSET_CEILING_MS = 60;

export type TempoReport = {
  violations: Violation[];
  matchedNotes: number;
  maxGridDeviationMs: number;
  rhythmChangedFamilies: string[];
};

const GRID = 12; // composer grid: 1/12 of a notated beat covers 16ths and swung 8ths.

/**
 * Retiming must keep every part's onset structure in bar/beat terms. Note ids
 * embed seconds, so notes are matched by pitch: for each pitch the two beat
 * lists are matched greedily in order within twice the engine's jitter
 * allowance at the faster tempo. Unmatched notes are onsets that moved (or
 * appeared / vanished).
 */
export function checkTempo(
  original: OrchestrationResult, originalModel: SongModelData,
  retimed: OrchestrationResult, retimedModel: SongModelData,
): TempoReport {
  const violations: Violation[] = [];
  const gA = geometryOf(originalModel);
  const gB = geometryOf(retimedModel);
  const bpmA = originalModel.tempoMap[0].bpm;
  const bpmB = retimedModel.tempoMap[0].bpm;
  const beatSecondsA = (60 / bpmA) * (4 / gA.denominator);
  const beatSecondsB = (60 / bpmB) * (4 / gB.denominator);
  const allowanceBeats = (PERFORMANCE_OFFSET_CEILING_MS / 1000) * (1 / Math.min(beatSecondsA, beatSecondsB)) * 2;
  let matchedNotes = 0;
  let maxGridDeviationMs = 0;
  const rhythmChanged = new Set<string>();

  const planA = original.plan.sectionPlan;
  const planB = retimed.plan.sectionPlan;
  const rolesA = (planA?.roleAssignments ?? []).map((r) => `${r.sectionName}|${r.instrument}|${r.role}`).sort();
  const rolesB = (planB?.roleAssignments ?? []).map((r) => `${r.sectionName}|${r.instrument}|${r.role}`).sort();
  if (stableStringify(rolesA) !== stableStringify(rolesB)) violations.push({ code: "roles_changed", detail: `${rolesA.length} vs ${rolesB.length} assignments differ` });
  for (const section of planA?.sections ?? []) {
    const twin = planB?.sections.find((s) => s.sectionName === section.sectionName);
    if (!twin || stableStringify(section.activeInstrumentFamilies) !== stableStringify(twin.activeInstrumentFamilies)) {
      violations.push({ code: "active_families_changed", sectionName: section.sectionName, detail: `${section.activeInstrumentFamilies.join(",")} -> ${twin?.activeInstrumentFamilies.join(",") ?? "missing"}` });
    }
  }

  const beatsByPitch = (notes: MusicalNote[], g: BarGeometry, beatSeconds: number) => {
    const map = new Map<number, number[]>();
    for (const note of notes) {
      const beat = g.absoluteBeat(note.start);
      const grid = Math.round(beat * GRID) / GRID;
      maxGridDeviationMs = Math.max(maxGridDeviationMs, Math.abs(beat - grid) * beatSeconds * 1000);
      map.set(note.pitch, [...(map.get(note.pitch) ?? []), beat]);
    }
    for (const list of map.values()) list.sort((x, y) => x - y);
    return map;
  };

  for (const candidate of original.candidates) {
    const twin = retimed.candidates.find((c) => c.candidateId === candidate.candidateId);
    if (!twin) { violations.push({ code: "candidate_missing", detail: candidate.candidateId }); continue; }
    for (const track of candidate.trackModels) {
      const other = twin.trackModels.find((t) => t.id === track.id);
      if (!other) { violations.push({ code: "track_missing", trackId: track.id, detail: `${candidate.candidateId}/${track.id}` }); continue; }
      // Performance additions (ghosts, flams) are placed relative to the
      // composed notes and would only restate the same comparison.
      const notesA = track.notes.filter((n) => !isPerformanceAddition(n));
      const notesB = other.notes.filter((n) => !isPerformanceAddition(n));
      const a = beatsByPitch(notesA, gA, beatSecondsA);
      const b = beatsByPitch(notesB, gB, beatSecondsB);
      if (notesA.length !== notesB.length) {
        rhythmChanged.add(familyOfTrack(track));
        violations.push({ code: "note_count_changed", trackId: track.id, count: Math.abs(notesA.length - notesB.length), detail: `${candidate.candidateId}/${track.id}: ${notesA.length} -> ${notesB.length} notes` });
      }
      let unmatched = 0;
      let countDelta = 0;
      for (const pitch of new Set([...a.keys(), ...b.keys()])) {
        const listA = a.get(pitch) ?? [];
        const listB = b.get(pitch) ?? [];
        countDelta += Math.abs(listA.length - listB.length);
        let i = 0;
        let j = 0;
        while (i < listA.length && j < listB.length) {
          const delta = listA[i] - listB[j];
          if (Math.abs(delta) <= allowanceBeats) { matchedNotes += 1; i += 1; j += 1; continue; }
          unmatched += 1;
          if (delta < 0) i += 1; else j += 1;
        }
        unmatched += (listA.length - i) + (listB.length - j);
      }
      if (countDelta && notesA.length === notesB.length) {
        violations.push({ code: "pitch_content_changed", trackId: track.id, count: countDelta / 2, detail: `${candidate.candidateId}/${track.id}: ${countDelta / 2} note(s) changed pitch` });
      }
      // Notes unaccounted for by the per-pitch count difference had a partner in count but not in time.
      const moved = Math.max(0, unmatched - countDelta);
      if (moved) {
        rhythmChanged.add(familyOfTrack(track));
        violations.push({ code: "onset_moved", trackId: track.id, count: moved, detail: `${candidate.candidateId}/${track.id}: ${moved} onset(s) have no partner within ${allowanceBeats.toFixed(3)} beats at the same pitch` });
      }
    }
  }
  if (maxGridDeviationMs > PERFORMANCE_OFFSET_CEILING_MS + 1) {
    violations.push({ code: "performance_offset_out_of_range", detail: `largest deviation from the 1/${GRID}-beat grid ${maxGridDeviationMs.toFixed(1)} ms > ${PERFORMANCE_OFFSET_CEILING_MS} ms` });
  }
  return { violations, matchedNotes, maxGridDeviationMs, rhythmChangedFamilies: [...rhythmChanged].sort() };
}

// ---------------------------------------------------------------------------
// Meter accents
// ---------------------------------------------------------------------------

export type MeterReport = {
  violations: Violation[];
  bars: number;
  kickOnDownbeatShare: number;
  snareOnDownbeatBars: number;
  offPulseHits: number;
  /** Per bar, the snapped kick/snare positions, for the evidence. */
  patternSamples: string[];
};

const KICK = new Set([35, 36]);
const SNARE = new Set([38, 40]);
const HAT = new Set([42, 44, 46]);

/**
 * Drum accents must belong to the Song Model's metre. The checks are the
 * ones a drummer would fail an audition on: no kick missing from the
 * downbeat, no snare on a downbeat, compound metres accented on their
 * dotted pulses (eighths 1 and 4 in 6/8), and in odd simple metres no 4/4
 * backbeat padded with a dead beat or drifting across the bar line.
 */
export function checkMeterAccents(drums: TrackModel | undefined, model: SongModelData): MeterReport {
  const violations: Violation[] = [];
  const g = geometryOf(model);
  const meter = model.meterMap?.[0]?.meter ?? "4/4";
  if (!drums) return { violations: [{ code: "no_drum_track", detail: "no drum track to judge" }], bars: 0, kickOnDownbeatShare: 0, snareOnDownbeatBars: 0, offPulseHits: 0, patternSamples: [] };
  const hits = drums.notes.filter(isAccentHit).filter((n) => KICK.has(n.pitch) || SNARE.has(n.pitch));
  const perBar = new Map<number, { kicks: number[]; snares: number[] }>();
  const snap = (beat: number): number | null => {
    const nearest = Math.round(beat);
    return Math.abs(beat - nearest) <= 0.2 ? ((nearest % g.numerator) + g.numerator) % g.numerator : null;
  };
  let offPulseHits = 0;
  for (const hit of hits) {
    const bar = g.barOf(hit.start);
    const entry = perBar.get(bar) ?? { kicks: [], snares: [] };
    const position = snap(g.beatInBar(hit.start));
    if (position === null) { offPulseHits += 1; perBar.set(bar, entry); continue; }
    (KICK.has(hit.pitch) ? entry.kicks : entry.snares).push(position);
    perBar.set(bar, entry);
  }
  const bars = [...perBar.entries()].sort((a, b) => a[0] - b[0]);
  if (!bars.length) return { violations: [{ code: "no_drum_hits", detail: "drum track has no kick or snare" }], bars: 0, kickOnDownbeatShare: 0, snareOnDownbeatBars: 0, offPulseHits, patternSamples: [] };

  const kickOnDownbeat = bars.filter(([, b]) => b.kicks.includes(0)).length;
  const kickOnDownbeatShare = kickOnDownbeat / bars.length;
  if (kickOnDownbeatShare < 0.9) violations.push({ code: "kick_missing_downbeat", count: bars.length - kickOnDownbeat, detail: `${meter}: kick on the downbeat in only ${(kickOnDownbeatShare * 100).toFixed(0)}% of ${bars.length} bars` });
  const snareOnDownbeatBars = bars.filter(([, b]) => b.snares.includes(0)).length;
  if (snareOnDownbeatBars > 0) violations.push({ code: "snare_on_downbeat", count: snareOnDownbeatBars, detail: `${meter}: a backbeat snare lands on beat 1 in ${snareOnDownbeatBars} of ${bars.length} bars` });

  const { numerator, denominator } = g;
  const compound = denominator === 8 && numerator % 3 === 0;
  if (compound) {
    let offPulse = 0;
    for (const [, b] of bars) offPulse += [...b.kicks, ...b.snares].filter((p) => p % 3 !== 0).length;
    if (offPulse) violations.push({ code: "compound_pulse_ignored", count: offPulse, detail: `${meter}: ${offPulse} kick/snare hit(s) on eighths other than 1 and 4 (dotted pulses)` });
  }
  const patternOf = (b: { kicks: number[]; snares: number[] }) => `k${[...new Set(b.kicks)].sort((x, y) => x - y).join("")}|s${[...new Set(b.snares)].sort((x, y) => x - y).join("")}`;
  const patterns = bars.map(([, b]) => patternOf(b));
  const counts = new Map<string, number>();
  for (const p of patterns) counts.set(p, (counts.get(p) ?? 0) + 1);
  const dominant = [...counts.entries()].sort((a, b) => b[1] - a[1])[0];
  const periodShare = dominant[1] / bars.length;
  if (meter !== "4/4" && periodShare < 0.6) {
    violations.push({ code: "pattern_period_not_bar", detail: `${meter}: the most common per-bar kick/snare pattern (${dominant[0]}) covers only ${(periodShare * 100).toFixed(0)}% of bars - the groove does not repeat with the bar` });
  }
  if (!compound && numerator !== 4) {
    const padded = bars.filter(([, b]) => {
      const snares = new Set(b.snares);
      const beyond = [...b.kicks, ...b.snares].some((p) => p >= 4);
      return snares.has(1) && snares.has(3) && !beyond;
    }).length;
    if (numerator > 4 && padded / bars.length > 0.5) {
      violations.push({ code: "backbeat_44_padded", count: padded, detail: `${meter}: snare on beats 2 and 4 with beat(s) ${Array.from({ length: numerator - 4 }, (_, i) => i + 5).join("/")} dead in ${padded} of ${bars.length} bars` });
    }
    if (numerator === 3) {
      // A 4/4 backbeat run across 3/4 bars puts the snare every two quarters regardless of the bar line.
      const snareBeats = hits.filter((h) => SNARE.has(h.pitch)).map((h) => Math.round(g.absoluteBeat(h.start))).sort((a, b) => a - b);
      let twoBeatIois = 0;
      for (let i = 1; i < snareBeats.length; i += 1) if (snareBeats[i] - snareBeats[i - 1] === 2) twoBeatIois += 1;
      if (snareBeats.length > 3 && twoBeatIois / (snareBeats.length - 1) > 0.6) {
        violations.push({ code: "backbeat_44_in_three", count: twoBeatIois, detail: `3/4: snares every two beats across the bar line (${twoBeatIois} of ${snareBeats.length - 1} intervals)` });
      }
    }
  }
  return {
    violations, bars: bars.length, kickOnDownbeatShare: Number(kickOnDownbeatShare.toFixed(3)),
    snareOnDownbeatBars, offPulseHits, patternSamples: patterns.slice(0, 4),
  };
}

export type CompoundAccentReport = { violations: Violation[]; strongMean: number | null; weakMean: number | null };

/** In compound metre the hi-hat's dynamic accent must sit on the dotted pulses (eighths 1 and 4), not every other eighth. */
export function checkCompoundHatAccents(drums: TrackModel | undefined, model: SongModelData): CompoundAccentReport {
  const g = geometryOf(model);
  if (!drums || !(g.denominator === 8 && g.numerator % 3 === 0)) return { violations: [], strongMean: null, weakMean: null };
  const hats = drums.notes.filter((n) => HAT.has(n.pitch));
  const strong: number[] = [];
  const weak: number[] = [];
  for (const hat of hats) {
    const beat = g.beatInBar(hat.start);
    const nearest = Math.round(beat);
    if (Math.abs(beat - nearest) > 0.2) continue;
    (nearest % 3 === 0 ? strong : weak).push(hat.velocity);
  }
  if (strong.length < 4 || weak.length < 4) return { violations: [], strongMean: null, weakMean: null };
  const mean = (v: number[]) => v.reduce((a, b) => a + b, 0) / v.length;
  const strongMean = mean(strong);
  const weakMean = mean(weak);
  const violations: Violation[] = strongMean - weakMean >= 3 ? [] : [{
    code: "compound_accent_missing",
    detail: `${g.numerator}/8: hats on eighths 1/4 average ${strongMean.toFixed(1)} vs ${weakMean.toFixed(1)} on the others - no dotted-pulse accent`,
  }];
  return { violations, strongMean: Number(strongMean.toFixed(2)), weakMean: Number(weakMean.toFixed(2)) };
}

// ---------------------------------------------------------------------------
// Section treatment (naming invariance)
// ---------------------------------------------------------------------------

export type SectionTreatment = {
  index: number;
  name: string;
  function: string;
  activeFamilies: string[];
  roles: Record<string, string>;
  climaxLayer: boolean;
  taskCount: number;
  notesPerFamily: Record<string, number>;
  transitionDevicesIn: number;
};

export function treatmentSummary(result: OrchestrationResult, model: SongModelData, candidateIndex = 0): SectionTreatment[] {
  const g = geometryOf(model);
  const candidate = result.candidates[candidateIndex];
  const plan = result.plan;
  return (plan.globalPlan?.sectionTargets ?? []).map((target, index) => {
    const section = plan.sectionPlan?.sections.find((s) => s.sectionName === target.sectionName);
    const roles = (plan.sectionPlan?.roleAssignments ?? []).filter((r) => r.sectionName === target.sectionName);
    const notesPerFamily: Record<string, number> = {};
    for (const track of candidate?.trackModels ?? []) {
      const count = notesInBars(track, g, target.startBar, target.endBar).length;
      if (count) notesPerFamily[familyOfTrack(track)] = count;
    }
    return {
      index,
      name: target.sectionName,
      function: target.role,
      activeFamilies: [...(section?.activeInstrumentFamilies ?? [])].sort(),
      roles: Object.fromEntries(roles.map((r) => [r.instrument, r.role])),
      climaxLayer: roles.some((r) => r.role === "CLIMAX_LAYER"),
      taskCount: (plan.partComposerPlan?.tasks ?? []).filter((t) => t.sectionName === target.sectionName).length,
      notesPerFamily,
      transitionDevicesIn: (plan.transitionPlan?.transitions ?? []).filter((t) => t.toSection === target.sectionName).reduce((s, t) => s + t.devices.length, 0),
    };
  });
}

/** Differences in treatment between two structurally identical songs, by section index. */
export function compareTreatment(a: SectionTreatment[], b: SectionTreatment[]): Violation[] {
  const violations: Violation[] = [];
  if (a.length !== b.length) return [{ code: "section_count", detail: `${a.length} vs ${b.length}` }];
  for (let i = 0; i < a.length; i += 1) {
    const x = a[i];
    const y = b[i];
    const where = `#${i + 1} ${x.name} / ${y.name}`;
    if (x.function !== y.function) violations.push({ code: "function_changed", sectionName: where, detail: `${x.function} -> ${y.function}` });
    if (stableStringify(x.activeFamilies) !== stableStringify(y.activeFamilies)) violations.push({ code: "families_changed", sectionName: where, detail: `${x.activeFamilies.join(",")} -> ${y.activeFamilies.join(",")}` });
    if (stableStringify(x.roles) !== stableStringify(y.roles)) violations.push({ code: "roles_changed", sectionName: where, detail: `${JSON.stringify(x.roles)} -> ${JSON.stringify(y.roles)}` });
    if (x.climaxLayer !== y.climaxLayer) violations.push({ code: "climax_layer_changed", sectionName: where, detail: `${x.climaxLayer} -> ${y.climaxLayer}` });
    if (x.taskCount !== y.taskCount) violations.push({ code: "task_count_changed", sectionName: where, detail: `${x.taskCount} -> ${y.taskCount}` });
    if (stableStringify(x.notesPerFamily) !== stableStringify(y.notesPerFamily)) violations.push({ code: "notes_changed", sectionName: where, detail: `${JSON.stringify(x.notesPerFamily)} -> ${JSON.stringify(y.notesPerFamily)}` });
    if (x.transitionDevicesIn !== y.transitionDevicesIn) violations.push({ code: "transition_changed", sectionName: where, detail: `${x.transitionDevicesIn} -> ${y.transitionDevicesIn} devices` });
  }
  return violations;
}

// ---------------------------------------------------------------------------
// Empty parts
// ---------------------------------------------------------------------------

export type SilentPart = { sectionName: string; family: string; role: string; leadRole: string };

/** Every family the plan declares active in a section must have written at least one note inside that section. */
export function plannedButSilent(candidate: OrchestratedCandidate, result: OrchestrationResult, model: SongModelData): SilentPart[] {
  const g = geometryOf(model);
  const silent: SilentPart[] = [];
  for (const section of result.plan.sectionPlan?.sections ?? []) {
    for (const family of section.activeInstrumentFamilies) {
      const tracks = candidate.trackModels.filter((t) => familyOfTrack(t) === family);
      const notes = tracks.reduce((sum, t) => sum + notesInBars(t, g, section.startBar, section.endBar).length, 0);
      if (notes === 0) {
        const role = result.plan.sectionPlan?.roleAssignments.find((r) => r.sectionName === section.sectionName && r.instrument === family)?.role ?? "?";
        silent.push({ sectionName: section.sectionName, family, role, leadRole: section.leadRole });
      }
    }
  }
  return silent;
}

// ---------------------------------------------------------------------------
// Note sanity (fuzz)
// ---------------------------------------------------------------------------

export function checkNoteSanity(result: OrchestrationResult): Violation[] {
  const violations: Violation[] = [];
  const finite = (v: unknown) => typeof v === "number" && Number.isFinite(v);
  for (const candidate of result.candidates) {
    if (!finite(candidate.finalScore) || !finite(candidate.critique.overallScore)) violations.push({ code: "score_not_finite", detail: candidate.candidateId });
    for (const track of candidate.trackModels) {
      const ids = new Set<string>();
      let duplicates = 0;
      for (const note of track.notes) {
        if (ids.has(note.id)) duplicates += 1;
        ids.add(note.id);
        if (!finite(note.start) || note.start < 0) violations.push({ code: "bad_start", trackId: track.id, detail: `${candidate.candidateId}/${track.id}/${note.id} start ${note.start}` });
        if (!finite(note.duration) || note.duration <= 0) violations.push({ code: "bad_duration", trackId: track.id, detail: `${candidate.candidateId}/${track.id}/${note.id} duration ${note.duration}` });
        if (!Number.isInteger(note.pitch) || note.pitch < 0 || note.pitch > 127) violations.push({ code: "bad_pitch", trackId: track.id, detail: `${candidate.candidateId}/${track.id}/${note.id} pitch ${note.pitch}` });
        if (!Number.isInteger(note.velocity) || note.velocity < 1 || note.velocity > 127) violations.push({ code: "bad_velocity", trackId: track.id, detail: `${candidate.candidateId}/${track.id}/${note.id} velocity ${note.velocity}` });
      }
      if (duplicates) violations.push({ code: "duplicate_note_ids", trackId: track.id, count: duplicates, detail: `${candidate.candidateId}/${track.id}: ${duplicates} duplicate id(s)` });
      for (const event of track.cc) if (!finite(event.time) || !finite(event.value)) violations.push({ code: "bad_cc", trackId: track.id, detail: `${candidate.candidateId}/${track.id}` });
    }
  }
  // B-00: a run may legitimately select nothing when every candidate failed the hard-rule gate - but then
  // the selection must say so. A missing selection with no reason is the malformed case.
  const reason = (result as { selection?: { reason?: string } }).selection?.reason;
  if (result.candidates.length && !result.selected && !(typeof reason === "string" && reason.trim())) violations.push({ code: "nothing_selected", detail: `${result.candidates.length} candidates, none selected and no reason given` });
  return violations;
}

// ---------------------------------------------------------------------------
// Reference scorers used as controls for the critic-sanity invariant
// ---------------------------------------------------------------------------

/** Share of pitched notes that are chord tones of the chord sounding at their onset (0..1). */
export function chordToneShare(trackModels: TrackModel[], model: SongModelData): number {
  const chords = model.chords ?? [];
  let compared = 0;
  let inChord = 0;
  for (const track of trackModels) {
    if (!isPitchedTrack(track)) continue;
    for (const note of track.notes) {
      const chord = chords.find((c) => c.start <= note.start + 1e-6 && c.end > note.start + 1e-6);
      if (!chord) continue;
      compared += 1;
      if (chordTonesOf(chord).includes(((note.pitch % 12) + 12) % 12)) inChord += 1;
    }
  }
  return compared ? inChord / compared : 1;
}

/** Share of planned (section, family) pairs that have at least one note. */
export function plannedCoverage(candidate: OrchestratedCandidate, result: OrchestrationResult, model: SongModelData): number {
  const planned = (result.plan.sectionPlan?.sections ?? []).reduce((s, section) => s + section.activeInstrumentFamilies.length, 0);
  if (!planned) return 1;
  return 1 - plannedButSilent(candidate, result, model).length / planned;
}

// ===========================================================================
// B-12b: checkers for the layers merged after B-12 (arc, harmony plan, groove
// plan, motif engine, style grammar, provenance, selection). Every checker is
// pure; each suite shows it rejecting a deliberately broken input.
// ===========================================================================

export const NOW = new Date(0);

// ---------------------------------------------------------------------------
// Arc: intent, not RMS (B-01)
// ---------------------------------------------------------------------------

export type ArcIntentRow = {
  sectionName: string;
  marking: string;
  level: number;
  levelSource: string;
  texture: string;
  textureSource: string;
  tension: string;
  operator: string;
  /** Families the section plan activates (what the composer is asked to write). */
  families: string[];
  arcFamilies: string[];
};

/** The arc's decision per section, joined with the section plan's active families. */
export function arcIntentOf(result: OrchestrationResult): ArcIntentRow[] | null {
  const arc = result.plan.globalPlan?.arc;
  if (!arc || arc.status !== "available") return null;
  return arc.sections.map((s: ArrangementArcSection) => {
    const planned = result.plan.sectionPlan?.sections.find((p) => p.sectionName === s.sectionName && p.startBar === s.startBar);
    return {
      sectionName: s.sectionName,
      marking: s.intendedDynamic.value.marking, level: s.intendedDynamic.value.level, levelSource: s.intendedDynamic.source,
      texture: s.textureLevel.value, textureSource: s.textureLevel.source,
      tension: s.tensionRole.value, operator: s.developmentOperator.value,
      families: [...(planned?.activeInstrumentFamilies ?? [])].sort(),
      arcFamilies: [...s.activeFamilies].sort(),
    };
  });
}

/** The arc's documented source-prior bound on a level (arrangementArc.ts: "at most +-0.05"), plus the +-0.03 contrast nudge. */
export const ARC_PRIOR_BOUND = 0.05 + 0.03;

/**
 * Two arcs of the same song under two source loudnesses. Markings, textures,
 * tension roles, operators and families must be identical; the level may
 * differ only within the prior bound (each run's nudge is bounded, so the
 * difference is bounded by twice the bound) - and when the brief stated the
 * dynamic, not at all.
 */
export function compareArcIntent(a: ArcIntentRow[] | null, b: ArcIntentRow[] | null, options: { statedByBrief: boolean }): Violation[] {
  const violations: Violation[] = [];
  if (!a || !b) return [{ code: "arc_missing", detail: `arc ${a ? "present" : "missing"} vs ${b ? "present" : "missing"}` }];
  if (a.length !== b.length) return [{ code: "arc_section_count", detail: `${a.length} vs ${b.length} arc sections` }];
  const levelBound = options.statedByBrief ? 1e-9 : ARC_PRIOR_BOUND * 2;
  for (let i = 0; i < a.length; i += 1) {
    const x = a[i];
    const y = b[i];
    const where = x.sectionName;
    if (x.marking !== y.marking) violations.push({ code: "marking_followed_curve", sectionName: where, detail: `${where}: ${x.marking} -> ${y.marking} (${x.levelSource} -> ${y.levelSource})` });
    if (Math.abs(x.level - y.level) > levelBound) violations.push({ code: "level_followed_curve", sectionName: where, detail: `${where}: level ${x.level} -> ${y.level} (|d| ${Math.abs(x.level - y.level).toFixed(3)} > ${levelBound.toFixed(3)}; ${x.levelSource} -> ${y.levelSource})` });
    if (x.texture !== y.texture) violations.push({ code: "texture_followed_curve", sectionName: where, detail: `${where}: texture ${x.texture} -> ${y.texture} (${x.textureSource} -> ${y.textureSource})` });
    if (x.tension !== y.tension) violations.push({ code: "tension_followed_curve", sectionName: where, detail: `${where}: ${x.tension} -> ${y.tension}` });
    if (x.operator !== y.operator) violations.push({ code: "operator_followed_curve", sectionName: where, detail: `${where}: ${x.operator} -> ${y.operator}` });
    if (stableStringify(x.families) !== stableStringify(y.families)) violations.push({ code: "families_followed_curve", sectionName: where, detail: `${where}: ${x.families.join(",")} -> ${y.families.join(",")}` });
    if (stableStringify(x.arcFamilies) !== stableStringify(y.arcFamilies)) violations.push({ code: "arc_families_followed_curve", sectionName: where, detail: `${where}: ${x.arcFamilies.join(",")} -> ${y.arcFamilies.join(",")}` });
  }
  return violations;
}

// ---------------------------------------------------------------------------
// Sung by default (B-01): no accompaniment family leads a sung section
// ---------------------------------------------------------------------------

export function accompanimentLeadViolations(result: OrchestrationResult): Violation[] {
  const violations: Violation[] = [];
  const plan = result.plan.sectionPlan;
  for (const section of plan?.sections ?? []) {
    if (section.function === "instrumental") continue;
    if (section.leadRole.startsWith("instrument:")) {
      violations.push({ code: "accompaniment_leads_sung_section", sectionName: section.sectionName, detail: `${section.sectionName} (${section.function}): lead is ${section.leadRole} (source ${section.leadRoleSource ?? "?"})` });
    }
  }
  for (const assignment of plan?.roleAssignments ?? []) {
    const section = plan?.sections.find((s) => s.sectionName === assignment.sectionName);
    if (!section || section.function === "instrumental") continue;
    if (assignment.role === "LEAD" && assignment.instrument.toLowerCase() !== "vocals") {
      violations.push({ code: "lead_role_in_sung_section", sectionName: assignment.sectionName, detail: `${assignment.sectionName} (${section.function}): ${assignment.instrument} assigned LEAD` });
    }
  }
  return violations;
}

// ---------------------------------------------------------------------------
// Harmony (B-02): the composer's own parts, before performance and repair
// ---------------------------------------------------------------------------

export const CHORDAL_TASKS: readonly PartTask[] = ["PIANO", "KEYS", "ACOUSTIC_GUITAR", "ELECTRIC_GUITAR", "STRINGS", "PAD", "BRASS", "WOODWINDS"];

export type ComposedPart = {
  request: PartGenerationRequest;
  notes: MusicalNote[];
  timing: BarTiming;
  /** The part's window in seconds (section bounds intersected with the arc's part window). */
  window: { start: number; end: number };
  /** The chord events the harmony writers voice inside the window (the same reduction `harmonyParts.ts` applies). */
  events: HarmonyChordEvent[];
};

export type ComposedSong = {
  parts: ComposedPart[];
  tempoBpm: number;
  meter: string;
  layers: ReturnType<typeof planPartComposition>["layers"];
  plan: ReturnType<typeof planPartComposition>["plan"];
};

/**
 * Compose the part plan's tasks directly with the reference composer (no
 * candidate strategy, no performance, no repair): what B-02's planners wrote,
 * measured before anything else touches it.
 */
export function composeSong(
  model: SongModelData,
  options: { tasks?: readonly PartTask[]; patch?: (request: PartGenerationRequest) => PartGenerationRequest } = {},
): ComposedSong {
  const tempoBpm = model.tempoMap?.[0]?.bpm ?? 120;
  const meter = model.meterMap?.[0]?.meter ?? "4/4";
  const { plan, layers } = planPartComposition(model, { now: NOW });
  const timing = barTiming(tempoBpm, meter);
  const parts: ComposedPart[] = [];
  for (const task of plan.tasks) {
    if (options.tasks && !options.tasks.includes(task.task)) continue;
    let request = buildPartGenerationRequest(model, task, layers, []);
    if (options.patch) request = options.patch(request);
    const notes = composeReferencePart(request, { tempoBpm, meter });
    const sectionStart = (request.section.startBar - 1) * timing.barSeconds;
    const sectionEnd = request.section.endBar * timing.barSeconds;
    const partWindow = request.partWindow ?? { startBar: request.section.startBar, endBar: request.section.endBar };
    const start = Math.max(sectionStart, (partWindow.startBar - 1) * timing.barSeconds);
    const end = Math.max(start, Math.min(sectionEnd, partWindow.endBar * timing.barSeconds));
    const seen = new Set<string>();
    const known = [...request.context.previousBars.chords, ...request.context.currentBars.chords].filter((c) => {
      const key = `${c.start.toFixed(4)}|${c.end.toFixed(4)}|${c.symbol}`;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });
    const minEventSeconds = Math.max(0.15, request.constraints.minNoteDuration * 2);
    parts.push({ request, notes, timing, window: { start, end }, events: chordEventsIn(known, { start, end }, { minEventSeconds }) });
  }
  return { parts, tempoBpm, meter, layers, plan };
}

const ONSET_TOLERANCE = 0.03;
const pcOf = (pitch: number) => ((pitch % 12) + 12) % 12;

export const isChordalPart = (part: ComposedPart): boolean => CHORDAL_TASKS.includes(part.request.task);
export const isBassPart = (part: ComposedPart): boolean => part.request.task === "BASS";

/** Notes whose onset is at a chord event's onset (within the tolerance). */
export const notesAtOnset = (part: ComposedPart, event: HarmonyChordEvent): MusicalNote[] =>
  part.notes.filter((n) => Math.abs(n.start - event.start) <= ONSET_TOLERANCE);

export type ChordToneReport = { violations: Violation[]; eventsJudged: number; eventsWithoutOnset: number };

/** Per chord event: at least one chord tone among the notes struck at the event's onset. */
export function chordToneOnsets(part: ComposedPart): ChordToneReport {
  const violations: Violation[] = [];
  let eventsJudged = 0;
  let eventsWithoutOnset = 0;
  for (const event of part.events) {
    const onset = notesAtOnset(part, event);
    if (!onset.length) { eventsWithoutOnset += 1; continue; }
    eventsJudged += 1;
    const tones = new Set(event.chord.pitchClasses);
    if (!onset.some((n) => tones.has(pcOf(n.pitch)))) {
      violations.push({ code: "no_chord_tone_at_onset", trackId: part.request.taskId, detail: `${part.request.taskId} ${event.symbol} @${event.start.toFixed(2)}s: onset pitches ${onset.map((n) => n.pitch).join(",")} carry none of ${[...tones].join(",")}` });
    }
  }
  return { violations, eventsJudged, eventsWithoutOnset };
}

/** No composed note outside the instrument's playable range. */
export function rangeViolations(part: ComposedPart): Violation[] {
  const { min, max } = part.request.constraints.playableRange;
  const out = part.notes.filter((n) => n.pitch < min || n.pitch > max);
  return out.length ? [{ code: "out_of_range", trackId: part.request.taskId, count: out.length, detail: `${part.request.taskId}: ${out.length} note(s) outside ${min}-${max} (e.g. ${out[0].pitch})` }] : [];
}

/** Consecutive bass notes never leap beyond the instrument's limit (by construction, before repair). */
export function bassLeapViolations(part: ComposedPart): { violations: Violation[]; maxLeap: number } {
  const ordered = [...part.notes].sort((a, b) => a.start - b.start || a.pitch - b.pitch);
  let maxLeap = 0;
  let over = 0;
  let example = "";
  for (let i = 1; i < ordered.length; i += 1) {
    const leap = Math.abs(ordered[i].pitch - ordered[i - 1].pitch);
    maxLeap = Math.max(maxLeap, leap);
    if (leap > part.request.constraints.maxLeap) { over += 1; if (!example) example = `${ordered[i - 1].pitch}->${ordered[i].pitch} @${ordered[i].start.toFixed(2)}s`; }
  }
  return { maxLeap, violations: over ? [{ code: "bass_leap_over_limit", trackId: part.request.taskId, count: over, detail: `${part.request.taskId}: ${over} leap(s) over ${part.request.constraints.maxLeap} (${example})` }] : [] };
}

export type SlashReport = { violations: Violation[]; slashEventsJudged: number; slashEventsWithoutOnset: number };

/** Under a slash chord the bass opens on the slash note. */
export function slashBassHonoured(part: ComposedPart): SlashReport {
  const violations: Violation[] = [];
  let judged = 0;
  let withoutOnset = 0;
  for (const event of part.events) {
    if (event.chord.bass === event.chord.root) continue;
    const first = [...part.notes].sort((a, b) => a.start - b.start).find((n) => n.start >= event.start - 1e-3 && n.start < event.end - 1e-3);
    if (!first) { withoutOnset += 1; continue; }
    judged += 1;
    if (pcOf(first.pitch) !== event.chord.bass) {
      violations.push({ code: "slash_bass_ignored", trackId: part.request.taskId, detail: `${part.request.taskId} ${event.symbol} @${event.start.toFixed(2)}s: bass opens on pc ${pcOf(first.pitch)} (pitch ${first.pitch}), slash asks ${event.chord.bass}` });
    }
  }
  return { violations, slashEventsJudged: judged, slashEventsWithoutOnset: withoutOnset };
}

export type ParallelReport = { parallels: number; pairsJudged: number; examples: string[] };

/**
 * Parallel perfect fifths / octaves between the bass part and the top voice
 * of a chordal part, judged at consecutive chord onsets where both parts
 * strike a note and both voices move.
 */
export function parallelPerfects(bass: ComposedPart, upper: ComposedPart): ParallelReport {
  const examples: string[] = [];
  let parallels = 0;
  let pairsJudged = 0;
  const events = upper.events;
  const voiceAt = (part: ComposedPart, event: HarmonyChordEvent, pick: "low" | "high"): number | null => {
    const onset = notesAtOnset(part, event);
    if (!onset.length) return null;
    return pick === "low" ? Math.min(...onset.map((n) => n.pitch)) : Math.max(...onset.map((n) => n.pitch));
  };
  for (let i = 1; i < events.length; i += 1) {
    const b1 = voiceAt(bass, events[i - 1], "low");
    const b2 = voiceAt(bass, events[i], "low");
    const t1 = voiceAt(upper, events[i - 1], "high");
    const t2 = voiceAt(upper, events[i], "high");
    if (b1 === null || b2 === null || t1 === null || t2 === null) continue;
    pairsJudged += 1;
    if (b1 === b2 || t1 === t2) continue;
    const i1 = pcOf(t1 - b1);
    const i2 = pcOf(t2 - b2);
    if (i1 === i2 && (i1 === 0 || i1 === 7)) {
      parallels += 1;
      if (examples.length < 4) examples.push(`${upper.request.taskId}: ${events[i - 1].symbol}->${events[i].symbol} bass ${b1}->${b2}, top ${t1}->${t2} (parallel ${i1 === 0 ? "octaves" : "fifths"})`);
    }
  }
  return { parallels, pairsJudged, examples };
}

export type ComposedTranspositionReport = {
  violations: Violation[];
  matched: number;
  exact: number;
  octaveFolds: number;
  wrongPitchClass: number;
  lost: number;
  gained: number;
  perTask: Record<string, { exact: number; folds: number; wrong: number; lost: number; gained: number }>;
};

/**
 * The composer's own parts for T_k(song) against T_k(the composer's parts for
 * song), note id by note id (ids are position-based). With ranges respected
 * by construction there is no reason for a fold, so every matched pitched
 * note must sit exactly k semitones away; folds are counted and reported.
 */
export function composedTransposition(model: SongModelData, k: number, options: { tasks?: readonly PartTask[] } = {}): ComposedTranspositionReport {
  return compareComposedSongs(composeSong(model, options), composeSong(transposeSongModel(model, k), options), k);
}

/** `b` must be `a` transposed by `k`, task by task and note id by note id. */
export function compareComposedSongs(a: Pick<ComposedSong, "parts">, b: Pick<ComposedSong, "parts">, k: number): ComposedTranspositionReport {
  const violations: Violation[] = [];
  const perTask: ComposedTranspositionReport["perTask"] = {};
  let matched = 0, exact = 0, folds = 0, wrong = 0, lost = 0, gained = 0;
  for (const part of a.parts) {
    if (part.request.task === "DRUMS" || part.request.task === "PERCUSSION") continue;
    const twin = b.parts.find((p) => p.request.taskId === part.request.taskId);
    const row = { exact: 0, folds: 0, wrong: 0, lost: 0, gained: 0 };
    perTask[part.request.taskId] = row;
    if (!twin) { violations.push({ code: "task_missing", trackId: part.request.taskId, detail: `${part.request.taskId} not composed after transposition` }); continue; }
    const byId = new Map(twin.notes.map((n) => [n.id, n]));
    for (const note of part.notes) {
      const other = byId.get(note.id);
      if (!other) { row.lost += 1; continue; }
      byId.delete(note.id);
      matched += 1;
      const delta = other.pitch - note.pitch;
      if (delta === k) { row.exact += 1; exact += 1; }
      else if (pcOf(delta - k) === 0) { row.folds += 1; folds += 1; }
      else { row.wrong += 1; wrong += 1; }
    }
    row.gained = byId.size;
    lost += row.lost;
    gained += row.gained;
    if (row.wrong) violations.push({ code: "voicing_not_transposed", trackId: part.request.taskId, count: row.wrong, detail: `${part.request.taskId} (${part.request.task}): ${row.wrong} note(s) whose pitch class does not follow +${k}` });
    if (row.folds) violations.push({ code: "voicing_octave_folded", trackId: part.request.taskId, count: row.folds, detail: `${part.request.taskId} (${part.request.task}): ${row.folds} note(s) an octave off +${k}` });
    if (row.lost || row.gained) violations.push({ code: "voicing_note_set_changed", trackId: part.request.taskId, count: row.lost + row.gained, detail: `${part.request.taskId} (${part.request.task}): ${row.lost} note(s) lost, ${row.gained} gained` });
  }
  return { violations, matched, exact, octaveFolds: folds, wrongPitchClass: wrong, lost, gained, perTask };
}

// ---------------------------------------------------------------------------
// Groove (B-04): the shipped kit, bass and comping against the section's plan
// ---------------------------------------------------------------------------

const KICK_PITCHES = new Set([35, 36]);
const HAT_PITCHES = new Set([42, 44, 46, 51]);
/** One hand on a hi-hat (groovePlan.ts HAND_LIMIT); programmed kits are allowed 9. */
export const HAT_HAND_LIMIT = 7.5;
export const HAT_PROGRAMMED_LIMIT = 9;

/** The groove plan the composer derived per request, rebuilt whole from the run's plan layers (`deriveGroovePlan` agrees with `grooveSectionForRequest`, B-04). */
export function groovePlanOf(result: OrchestrationResult, model: SongModelData): GroovePlan | null {
  const { globalPlan, sectionPlan, transitionPlan } = result.plan;
  if (!globalPlan || !sectionPlan || !transitionPlan) return null;
  return deriveGroovePlan(model, { globalPlan, sectionPlan, transitions: transitionPlan.transitions }, { tempoBpm: result.timing.tempoBpm, meter: result.timing.meter, now: NOW });
}

export type LockSectionRow = { sectionName: string; relation: string; kicks: number; matched: number; share: number | null };

/**
 * On sections whose plan locks the bass to the kick, every accented kick
 * onset has a bass onset within the performance engine's jitter allowance.
 */
export function kickBassLock(candidate: OrchestratedCandidate, result: OrchestrationResult, model: SongModelData, toleranceSeconds = 0.06): { violations: Violation[]; rows: LockSectionRow[] } {
  const plan = groovePlanOf(result, model);
  const g = geometryOf(model);
  const drums = candidate.trackModels.find(isDrumTrack);
  const bass = candidate.trackModels.find((t) => familyOfTrack(t) === "bass");
  const rows: LockSectionRow[] = [];
  const violations: Violation[] = [];
  if (!plan || !drums || !bass) return { violations, rows };
  const bassOnsets = bass.notes.map((n) => n.start).sort((a, b) => a - b);
  for (const section of plan.sections) {
    if (section.kickBass.value !== "lock") continue;
    const kicks = notesInBars(drums, g, section.startBar, section.endBar).filter((n) => KICK_PITCHES.has(n.pitch) && isAccentHit(n));
    if (!notesInBars(bass, g, section.startBar, section.endBar).length) continue;
    const matched = kicks.filter((k) => bassOnsets.some((b) => Math.abs(b - k.start) <= toleranceSeconds)).length;
    const share = kicks.length ? matched / kicks.length : null;
    rows.push({ sectionName: section.sectionName, relation: section.kickBass.value, kicks: kicks.length, matched, share: share === null ? null : Number(share.toFixed(3)) });
    if (kicks.length >= 4 && share !== null && share < 0.9) {
      violations.push({ code: "kick_bass_not_locked", sectionName: section.sectionName, detail: `${section.sectionName}: plan says lock (${section.kickBass.reason}); ${matched}/${kicks.length} kicks have a bass onset within ${toleranceSeconds * 1000} ms` });
    }
  }
  return { violations, rows };
}

export type AnticipationRow = { sectionName: string; planned: number; kitPushes: number; compingAtPush: number; bassAtPush: number };

/**
 * Where the plan pushes an up-beat (the anticipation set), the kit's push and
 * the comping / bass onsets coincide. Measured on the kit's `ka` pushes
 * (the kit realises the plan's slots), asking whether the comping and the
 * bass strike with it.
 */
export function anticipationsShared(candidate: OrchestratedCandidate, result: OrchestrationResult, model: SongModelData, toleranceSeconds = 0.06): { violations: Violation[]; rows: AnticipationRow[] } {
  const plan = groovePlanOf(result, model);
  const g = geometryOf(model);
  const drums = candidate.trackModels.find(isDrumTrack);
  const rows: AnticipationRow[] = [];
  const violations: Violation[] = [];
  if (!plan || !drums) return { violations, rows };
  const comping = candidate.trackModels.filter((t) => ["keys", "piano", "guitar"].includes(familyOfTrack(t)));
  const bass = candidate.trackModels.find((t) => familyOfTrack(t) === "bass");
  for (const section of plan.sections) {
    const anticipation = section.anticipations.value;
    if (!anticipation.units.length || anticipation.when === "never") continue;
    const pushes = notesInBars(drums, g, section.startBar, section.endBar).filter((n) => /-ka\d+-/.test(n.id) && KICK_PITCHES.has(n.pitch));
    if (!pushes.length) continue;
    const compingNotes = comping.flatMap((t) => notesInBars(t, g, section.startBar, section.endBar));
    const bassNotes = bass ? notesInBars(bass, g, section.startBar, section.endBar) : [];
    const at = (notes: MusicalNote[], time: number) => notes.some((n) => Math.abs(n.start - time) <= toleranceSeconds);
    const compingAtPush = compingNotes.length ? pushes.filter((p) => at(compingNotes, p.start)).length : -1;
    const bassAtPush = bassNotes.length ? pushes.filter((p) => at(bassNotes, p.start)).length : -1;
    rows.push({ sectionName: section.sectionName, planned: anticipation.units.length, kitPushes: pushes.length, compingAtPush, bassAtPush });
    if (compingAtPush >= 0 && compingAtPush / pushes.length < 0.8) {
      violations.push({ code: "comping_misses_anticipation", sectionName: section.sectionName, detail: `${section.sectionName}: the kit pushes ${pushes.length} up-beat(s) (${section.anticipations.reason}); the comping strikes with ${compingAtPush}` });
    }
    if (bassAtPush >= 0 && bassAtPush / pushes.length < 0.8) {
      violations.push({ code: "bass_misses_anticipation", sectionName: section.sectionName, detail: `${section.sectionName}: the kit pushes ${pushes.length} up-beat(s); the bass strikes with ${bassAtPush}` });
    }
  }
  return { violations, rows };
}

/** Hat / ride strikes per second never exceed the tempo ceiling the plan documents. */
export function hatCeiling(candidate: OrchestratedCandidate, result: OrchestrationResult, model: SongModelData): { violations: Violation[]; maxStrikesPerSecond: number; ceiling: number; barsJudged: number } {
  const g = geometryOf(model);
  const drums = candidate.trackModels.find(isDrumTrack);
  const style = result.plan.globalPlan?.style ?? "unknown";
  const family = styleFamilyOf(style, result.plan.globalPlan?.productionAesthetic ?? null);
  const ceiling = family === "dance" || family === "electronic" ? HAT_PROGRAMMED_LIMIT : HAT_HAND_LIMIT;
  const violations: Violation[] = [];
  let max = 0;
  let barsJudged = 0;
  if (!drums) return { violations, maxStrikesPerSecond: 0, ceiling, barsJudged };
  const perBar = new Map<number, Set<number>>();
  for (const note of drums.notes) {
    if (!HAT_PITCHES.has(note.pitch)) continue;
    const bar = g.barOf(note.start);
    const set = perBar.get(bar) ?? new Set<number>();
    set.add(Math.round(note.start * 1000));
    perBar.set(bar, set);
  }
  for (const [bar, onsets] of perBar) {
    const { start, end } = g.barBounds(bar);
    const seconds = Math.max(1e-3, end - start);
    const rate = onsets.size / seconds;
    barsJudged += 1;
    max = Math.max(max, rate);
    if (rate > ceiling + 0.01) violations.push({ code: "hat_rate_over_ceiling", detail: `bar ${bar}: ${onsets.size} hat strikes in ${seconds.toFixed(2)} s = ${rate.toFixed(2)}/s > ${ceiling} (${family})` });
  }
  return { violations, maxStrikesPerSecond: Number(max.toFixed(2)), ceiling, barsJudged };
}

// ---------------------------------------------------------------------------
// Motif (B-10): answers, ledger truth, recall
// ---------------------------------------------------------------------------

export const SUNG_FUNCTIONS = new Set(["verse", "prechorus", "chorus", "bridge"]);

/** The ledger the orchestrator wiring would thread: the plan's sections with their tension roles (brainB10Evidence.motifLedgerForPlan). */
export function ledgerForPlan(model: SongModelData, layers: ComposedSong["layers"], tempoBpm: number, meter: string): MotifLedger {
  // The *notated* beat, as `barTiming` and the melodic engine use it. Deriving
  // it as 60/bpm halves every span in x/8 and made the ledger's `spanBeats`
  // read as twice the emitted cell's - a checker artefact, not the brain's.
  const { beatSeconds, barSeconds } = barTiming(tempoBpm, meter);
  const seconds = (bar: number) => (bar - 1) * barSeconds;
  const arc = layers.globalPlan.arc;
  const sections = arc?.sections?.length
    ? arc.sections.map((s) => ({ sectionName: s.sectionName, startBar: s.startBar, endBar: s.endBar, function: s.function, tensionRole: s.tensionRole.value, startSeconds: seconds(s.startBar), endSeconds: seconds(s.endBar + 1) }))
    : layers.globalPlan.sectionTargets.map((t) => ({ sectionName: t.sectionName, startBar: t.startBar, endBar: t.endBar, function: t.role, tensionRole: undefined, startSeconds: seconds(t.startBar), endSeconds: seconds(t.endBar + 1) }));
  return buildMotifLedger({ songModel: model, sections, beatSeconds, barStart: seconds });
}

export type AnswerPart = { request: PartGenerationRequest; notes: MusicalNote[]; sectionName: string; instrument: string; occurrenceIndex: number; sectionFunction: string };

/**
 * The B-10 harness shape: per sung section a strings COUNTER_MELODY and a
 * brass CALL_RESPONSE task through the real request builder, composed with
 * one ledger for the song (`thread: true`) or a fresh local one per part.
 */
export function composeMelodicParts(model: SongModelData, options: { thread: boolean }): { parts: AnswerPart[]; ledger: MotifLedger | null; tempoBpm: number; meter: string; beatSeconds: number } {
  const tempoBpm = model.tempoMap?.[0]?.bpm ?? 120;
  const meter = model.meterMap?.[0]?.meter ?? "4/4";
  const { layers } = planPartComposition(model, { now: NOW });
  const ledger = options.thread ? ledgerForPlan(model, layers, tempoBpm, meter) : null;
  const parts: AnswerPart[] = [];
  const requestLayers = { globalPlan: layers.globalPlan, sectionPlan: layers.sectionPlan, budgetWindows: layers.budgetWindows, transitions: layers.transitions };
  for (const section of layers.sectionPlan.sections) {
    if (!SUNG_FUNCTIONS.has(section.function)) continue;
    for (const [instrument, task, role] of [["strings", "COUNTER_MELODY", "COUNTER_MELODY"], ["brass", "CALL_RESPONSE", "CALL_RESPONSE"]] as const) {
      const taskId = `b12b-${section.sectionName}-${instrument}-${task}`.replace(/\s+/g, "_");
      const target = { id: taskId, task, sectionName: section.sectionName, instrument, role, startBar: section.startBar, endBar: section.endBar, seed: 1000 + section.startBar, dependsOn: [] as string[] };
      const request = buildPartGenerationRequest(model, target, requestLayers, []);
      const notes = composeReferencePart(ledger ? { ...request, motifLedger: ledger } : request, { tempoBpm, meter });
      parts.push({ request, notes, sectionName: section.sectionName, instrument, occurrenceIndex: request.formMemory?.occurrenceIndex ?? 0, sectionFunction: section.function });
    }
  }
  return { parts, ledger, tempoBpm, meter, beatSeconds: barTiming(tempoBpm, meter).beatSeconds };
}

/** Sung notes the engine must respect: melody evidence at confidence >= 0.6. */
export const sungNotes = (model: SongModelData) => (model.melody ?? []).filter((n) => (n.confidence ?? 0) >= 0.6);

/** An answer (`intention: response`) never sounds over a sung note. */
export function answersOverVocal(part: AnswerPart, model: SongModelData): Violation[] {
  const sung = sungNotes(model);
  const answers = part.notes.filter((n) => n.motif?.intention === "response");
  const overlapping = answers.filter((n) => sung.some((m) => n.start < m.end - 1e-6 && n.start + n.duration > m.start + 1e-6));
  return overlapping.length ? [{ code: "answer_over_vocal", trackId: part.request.taskId, count: overlapping.length, detail: `${part.request.taskId}: ${overlapping.length} of ${answers.length} answer note(s) sound over a sung note (first at ${overlapping[0].start.toFixed(2)}s)` }] : [];
}

export type MotifLabelReport = { violations: Violation[]; groupsChecked: number; occurrences: number; notesNamed: number; notesMissing: number; cellMatches: number };

/**
 * The ledger's own claim, judged against the notes the ledger itself names.
 *
 * The occurrence record - not a regrouping of the notes by id prefix - is the
 * unit: it names its `noteIds`, its `cell` and its `transformation`. Three
 * things must hold, in this order, because the later ones are meaningless if
 * an earlier one fails:
 *
 *   1. every note the occurrence names is a note that shipped;
 *   2. the recorded `cell` is the cell of exactly those notes;
 *   3. the recorded transformation is the one `classifyTransformation` reads
 *      off that cell against the entry's own cell, in the same context the
 *      engine had (`harmonic_adaptation` is the honest label when the harmony
 *      bent the cell beyond recognition).
 *
 * Every motif-tagged note must also belong to an occurrence: a label carried
 * by notes the memory never recorded is a label nothing can check.
 */
export function motifLabelsTruthful(notes: readonly MusicalNote[], ledger: MotifLedger, beatSeconds: number, label: string): MotifLabelReport {
  const violations: Violation[] = [];
  const byId = new Map<string, MusicalNote>();
  for (const n of notes) byId.set(n.id, n);
  const named = new Set<string>();
  let checked = 0;
  let occurrences = 0;
  let notesNamed = 0;
  let notesMissing = 0;
  let cellMatches = 0;
  for (const occurrence of ledger.data.occurrences) {
    const ids = occurrence.noteIds ?? [];
    if (!ids.length || !ids.some((id) => byId.has(id))) continue;
    occurrences += 1;
    notesNamed += ids.length;
    const group: MusicalNote[] = [];
    const missing: string[] = [];
    for (const id of ids) {
      const note = byId.get(id);
      if (note) { group.push(note); named.add(id); } else missing.push(id);
    }
    if (missing.length) {
      notesMissing += missing.length;
      violations.push({ code: "ledger_names_a_note_that_never_shipped", detail: `${label}: occurrence ${occurrence.index} of ${occurrence.motifId} names ${missing.length} of ${ids.length} note(s) that are not in the part (e.g. ${missing[0]})` });
    }
    const entry = ledger.entry(occurrence.motifId);
    if (!entry) { violations.push({ code: "motif_not_in_ledger", detail: `${label}: occurrence ${occurrence.index} cites motif ${occurrence.motifId} with no ledger entry` }); continue; }
    const emitted = cellOf(group.map((n) => ({ start: n.start, end: n.start + n.duration, pitch: n.pitch })), beatSeconds);
    if (!emitted) continue;
    if (stableStringify(emitted) === stableStringify(occurrence.cell)) cellMatches += 1;
    else violations.push({ code: "ledger_cell_is_not_the_notes", detail: `${label}: occurrence ${occurrence.index} of ${occurrence.motifId} recorded ${stableStringify(occurrence.cell)} for notes whose cell is ${stableStringify(emitted)}` });
    checked += 1;
    const detected = classifyTransformation(entry.cell, emitted, {
      transposition: occurrence.transposition,
      sameInstrument: entry.origin.kind === "instrument_statement" ? entry.origin.instrument === occurrence.instrument : undefined,
    });
    const claimed = occurrence.transformation;
    const ok = detected === null
      ? claimed === "harmonic_adaptation"
      : claimed === detected || (detected === "transposition" && ["repetition", "orchestral_handoff", "reharmonisation"].includes(claimed));
    if (!ok) violations.push({ code: "motif_label_untrue", detail: `${label}: occurrence ${occurrence.index} of ${occurrence.motifId} labelled ${claimed}, its own notes read as ${detected ?? "nothing (not the cell)"}` });
    for (const note of group) {
      if (note.motif && note.motif.transformation !== claimed) {
        violations.push({ code: "motif_label_mixed", detail: `${label}: note ${note.id} carries ${note.motif.transformation} while its occurrence records ${claimed}` });
        break;
      }
    }
  }
  const orphans = notes.filter((n) => n.motif && !named.has(n.id));
  if (orphans.length) violations.push({ code: "motif_note_in_no_occurrence", count: orphans.length, detail: `${label}: ${orphans.length} motif-tagged note(s) belong to no ledger occurrence (e.g. ${orphans[0].id} labelled ${orphans[0].motif!.transformation})` });
  return { violations, groupsChecked: checked, occurrences, notesNamed, notesMissing, cellMatches };
}

export type RecallRow = { sectionName: string; instrument: string; occurrenceIndex: number; statements: number; recalls: number; earlierStatements: number };

/**
 * A later statement of a section function develops what the earlier one
 * said: when the same instrument stated something in an earlier occurrence,
 * at least one of its statements in the later occurrence recalls it.
 */
export function recallAcrossRepeats(parts: AnswerPart[], ledger: MotifLedger): { violations: Violation[]; rows: RecallRow[] } {
  const violations: Violation[] = [];
  const rows: RecallRow[] = [];
  const occurrences = ledger.data.occurrences;
  for (const part of parts) {
    if (part.occurrenceIndex <= 0) continue;
    const mine = occurrences.filter((o) => o.sectionName === part.sectionName && o.instrument === part.instrument);
    if (!mine.length) continue;
    const earlier = occurrences.filter((o) => o.instrument === part.instrument && o.sectionFunction === part.sectionFunction && (o.occurrenceIndex ?? 0) < part.occurrenceIndex);
    if (!earlier.length) continue;
    const recalls = mine.filter((o) => o.recallOf !== null).length;
    rows.push({ sectionName: part.sectionName, instrument: part.instrument, occurrenceIndex: part.occurrenceIndex, statements: mine.length, recalls, earlierStatements: earlier.length });
    if (!recalls) violations.push({ code: "repeat_without_recall", sectionName: part.sectionName, detail: `${part.sectionName} (${part.sectionFunction} #${part.occurrenceIndex + 1}) ${part.instrument}: ${mine.length} statement(s), none recalls the ${earlier.length} earlier statement(s) of this function` });
  }
  return { violations, rows };
}

// ---------------------------------------------------------------------------
// Provenance (B-11): every shipped note group is accounted for
// ---------------------------------------------------------------------------

export function provenanceOf(candidate: OrchestratedCandidate, result: OrchestrationResult): CandidateProvenance {
  const beats = Number(result.timing.meter.split("/")[0]) || 4;
  return buildCandidateProvenance({
    candidateId: candidate.candidateId, strategy: candidate.strategy, seed: candidate.seed, plan: candidate.plan,
    trackModels: candidate.trackModels, composer: result.composer, barSeconds: (60 / Math.max(1, result.timing.tempoBpm)) * beats,
    composerRegistry: candidate.composerDecisions ?? null, repairPasses: candidate.repair?.passes ?? [],
    playabilityRepairs: candidate.playabilityRepairs, performance: candidate.performance ?? [], contextPasses: result.contextPasses ?? [],
  });
}

export type ProvenanceReport = { violations: Violation[]; notes: number; decisions: number; ranges: number; notRecordedLayers: string[] };

export function checkProvenance(candidate: OrchestratedCandidate, result: OrchestrationResult, provenance = provenanceOf(candidate, result)): ProvenanceReport {
  const violations: Violation[] = [];
  const ids = new Set(provenance.decisions.map((d) => d.id));
  const beats = Number(result.timing.meter.split("/")[0]) || 4;
  const barSeconds = (60 / Math.max(1, result.timing.tempoBpm)) * beats;
  let notes = 0;
  let ranges = 0;
  const notRecorded = new Set<string>();
  for (const d of provenance.decisions) {
    for (const ref of d.refs ?? []) if (!ids.has(ref)) violations.push({ code: "dangling_ref", detail: `${d.id} refs ${ref}, which is not a decision` });
  }
  for (const track of candidate.trackModels) {
    const own = provenance.byTrack[track.id];
    if (!own) { violations.push({ code: "track_without_provenance", trackId: track.id, detail: `${track.id} has no provenance` }); continue; }
    ranges += own.ranges.length;
    for (const layer of own.notRecorded ?? []) notRecorded.add(layer.layer);
    for (const range of own.ranges) for (const id of range.decisionIds) if (!ids.has(id)) violations.push({ code: "dangling_decision_id", trackId: track.id, detail: `${track.id} bars ${range.startBar}-${range.endBar} cite ${id}, which is not a decision` });
    let uncovered = 0;
    let example = "";
    for (const note of track.notes) {
      notes += 1;
      if (note.decisionId && !ids.has(note.decisionId)) violations.push({ code: "note_cites_unknown_decision", trackId: track.id, detail: `${track.id}/${note.id} cites ${note.decisionId}` });
      const bar = barOfSeconds(note.start, barSeconds);
      const covered = (note.decisionId && ids.has(note.decisionId)) || own.ranges.some((r) => bar >= r.startBar && bar <= r.endBar);
      if (!covered) { uncovered += 1; if (!example) example = `${note.id} @bar ${bar}`; }
    }
    if (uncovered) violations.push({ code: "note_without_decision", trackId: track.id, count: uncovered, detail: `${track.id}: ${uncovered} note(s) in no decision range (${example})` });
    // A layer that composed nothing traceable must be named, not silently absent.
    const layersHere = new Set<string>();
    for (const range of own.ranges) for (const id of range.decisionIds) layersHere.add(id.split(":")[0]);
    for (const layer of ["harmony", "groove", "register"]) {
      if (!layersHere.has(layer) && !(own.notRecorded ?? []).some((n) => n.layer === layer)) violations.push({ code: "layer_silently_missing", trackId: track.id, detail: `${track.id}: no ${layer} decision and no notRecorded entry for it` });
    }
  }
  return { violations, notes, decisions: provenance.decisions.length, ranges, notRecordedLayers: [...notRecorded].sort() };
}

// ---------------------------------------------------------------------------
// Selection integrity (B-00 / B-05): the gate, the reason, the score
// ---------------------------------------------------------------------------

export type SelectionReport = { violations: Violation[]; recomputed: number; nothingSelectedReasons: string[] };

/** The kind of every hard-rule reason on the rejected candidates, without ids or numbers - so causes can be grouped. */
export function rejectionKinds(result: OrchestrationResult): string[] {
  const kinds = new Set<string>();
  for (const rejected of result.selection.rejected) {
    for (const reason of rejected.reasons) {
      const head = reason.split(":")[0].trim();
      const body = reason.slice(head.length + 1).trim();
      kinds.add(head === "critic" ? `critic: ${body.replace(/\d+(\.\d+)?/g, "N").replace(/"[^"]*"/g, '"S"').slice(0, 90)}` : head);
    }
  }
  return [...kinds].sort();
}

export function checkSelectionIntegrity(result: OrchestrationResult, model: SongModelData, options: { recompute?: boolean } = {}): SelectionReport {
  const violations: Violation[] = [];
  let recomputed = 0;
  const infeasible = result.candidates.filter((c) => !c.hardRule.feasible).map((c) => c.candidateId);
  if (result.selected) {
    const winner = result.candidates.find((c) => c.candidateId === result.selected!.candidateId);
    if (!winner) violations.push({ code: "selected_unknown_candidate", detail: `${result.selected.candidateId} is not a candidate` });
    else if (!winner.hardRule.feasible) violations.push({ code: "selected_infeasible", detail: `${winner.candidateId} was selected with hard-rule reasons: ${winner.hardRule.reasons.slice(0, 2).join(" | ")}` });
    if (!result.selection.eligible.includes(result.selected.candidateId)) violations.push({ code: "selected_not_eligible", detail: `${result.selected.candidateId} is not in the eligible list` });
    if (!result.selected.reason.trim()) violations.push({ code: "selection_without_reason", detail: "selected but no reason" });
  } else {
    if (!result.selection.reason.trim()) violations.push({ code: "nothing_selected_no_reason", detail: `${result.candidates.length} candidates, nothing selected, no reason` });
    const feasible = result.candidates.filter((c) => c.hardRule.feasible);
    if (feasible.length) violations.push({ code: "feasible_candidate_unselected", detail: `${feasible.map((c) => c.candidateId).join(",")} pass the gate but nothing was selected` });
  }
  const rejectedIds = result.selection.rejected.map((r) => r.candidateId).sort();
  if (stableStringify(rejectedIds) !== stableStringify([...infeasible].sort())) violations.push({ code: "rejected_list_mismatch", detail: `rejected ${rejectedIds.join(",")} vs infeasible ${infeasible.join(",")}` });
  for (const rejected of result.selection.rejected) if (!rejected.reasons.length) violations.push({ code: "rejected_without_reason", detail: rejected.candidateId });
  if (options.recompute !== false) {
    for (const candidate of result.candidates) {
      const again = critiqueArrangement({ songModel: model, plan: candidate.plan, trackModels: candidate.trackModels });
      recomputed += 1;
      if (again.overallScore !== candidate.critique.overallScore) violations.push({ code: "score_not_reproducible", detail: `${candidate.candidateId}: shipped critique ${candidate.critique.overallScore}, recomputed on the shipped notes ${again.overallScore}` });
      if (again.feasible !== candidate.critique.feasible) violations.push({ code: "feasibility_not_reproducible", detail: `${candidate.candidateId}: critique.feasible ${candidate.critique.feasible} vs recomputed ${again.feasible}` });
    }
  }
  return { violations, recomputed, nothingSelectedReasons: result.selected ? [] : rejectionKinds(result) };
}
