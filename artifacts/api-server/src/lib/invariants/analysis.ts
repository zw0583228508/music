/**
 * Brain B-12: pure checkers behind the metamorphic invariants.
 *
 * Each checker takes arrangement output (and, where needed, the Song Model)
 * and returns a list of violations. The property tests run the checkers over
 * many seeds and, separately, over deliberately broken input so every
 * invariant is shown to fail when it should. Nothing here changes any input.
 */
import { createHash } from "node:crypto";
import type { MusicalNote, SongModelData, TrackModel } from "@workspace/db";
import { orchestrateArrangement, type OrchestrateInput, type OrchestrationResult, type OrchestratedCandidate } from "../arrangementOrchestrator";
import { chordTonesOf, meterParts } from "./generators";

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
  if (result.candidates.length && !result.selected) violations.push({ code: "nothing_selected", detail: `${result.candidates.length} candidates, none selected` });
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
