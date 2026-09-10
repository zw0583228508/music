/**
 * Rhythm parts of the reference composer (Brain B-00 split; Brain B-04 owns
 * the groove rules here).
 *
 * Everything in this file reads one `GroovePlanSection` derived from the part
 * request's plan layers - never from the part's seed - so the drum kit, the
 * percussion, the ostinato and (through `compingRhythmFor` / `bassRhythmFor`,
 * which stream B-02's harmony writers call) the bass and the comping agree on
 * the pulse, the subdivision, the anticipations and the fills by construction:
 *
 *   - the kit template comes from the plan (kick / snare / side-stick / hats /
 *     ghosts per meter and pulse), hats follow the subdivision under the tempo
 *     ceiling, velocities follow the meter's accent weights;
 *   - anticipations are one shared slot list per bar (`anticipationSlots`):
 *     the kick joins when the plan says so, the bass and the comping always,
 *     and the pushed downbeat is tied (not restruck) by every part;
 *   - fills come from the plan's vocabulary at the plan's placements only;
 *   - transition devices reach the kit as rest windows, thin bars and gesture
 *     notes from `transitionRealisation`;
 *   - parts honour their `partWindow` (arc entries and exits) and rest for a
 *     beat at phrase ends when nothing pushes there.
 */
import type { ChordHarmonyEvent, GrooveCompingCell, GrooveFillPlacement, GroovePlanSection } from "@workspace/db";
import type { ComposeFrame } from "./frame";
import { accentWeight } from "./frame";
import { chordPitchClasses, rootPitchClass } from "./harmonyParts";
import { voiceNear } from "./registers";
import {
  anticipationSlots, cellUnits, chordAtTime, grooveSectionForRequest, phraseEndBarsOf, stepUnitsFor, type AnticipationSlot,
} from "../groovePlan";
import { inRest, transitionGesturesFor, type FamilyKey, type RestWindow } from "../transitionRealisation";
import { quantiseChordsToGrid } from "../harmonyPlan/shared";

// GM kit map.
const KICK = 36;
const SIDE_STICK = 37;
const SNARE = 38;
const CLOSED_HAT = 42;
const PEDAL_HAT = 44;
const OPEN_HAT = 46;
const CRASH = 49;
const RIDE = 51;
const TAMBOURINE = 54;
const SHAKER = 82;
const TOMS_UP = [45, 47, 48, 50];

const r4 = (v: number) => Number(v.toFixed(4));
const near = (a: number, b: number) => Math.abs(a - b) < 1e-3;

/** The section's groove as this part sees it (identical for every part of the section). */
export function grooveOf(frame: ComposeFrame): GroovePlanSection {
  return grooveSectionForRequest(frame.request, frame);
}

export type BarSlot = {
  bar: number;
  barStart: number;
  isSectionStart: boolean;
  isSectionEnd: boolean;
  /** The song's last bar (the ending). */
  isLastOfSong: boolean;
  /** A phrase of the section ends here. */
  phraseEnd: boolean;
  /** The previous bar anticipated this bar's downbeat: no part restrikes it. */
  tiedDownbeat: boolean;
  slots: Array<AnticipationSlot<ChordHarmonyEvent>>;
};

/**
 * All chords the part can see, in start order (current bars, then the next bars
 * for the last anticipation), **on the grid the writers place notes on**.
 *
 * B-21: these were the analysed times while the voicing solver worked from
 * `chordEventsIn(..., { grid })`, whose onsets B-13 snapped to the beat or the
 * eighth they push to (P0-2). Two sources of truth for *where the chord
 * changes*: on the owner's Outro the analysed Cm began at 238.06 s and the
 * solved event at 238.29, so the comping onset at 238.06 asked for a voicing
 * of the chord before it and the piano played an F minor triad for 1.95 s
 * under a C minor chord. The harmony critic reported `clash_share` 0.42-0.58
 * on the Outro keys and strings, blocking the release. One grid now, the
 * solver's.
 */
export function visibleChords(frame: ComposeFrame): ChordHarmonyEvent[] {
  const seen = new Map<number, ChordHarmonyEvent>();
  for (const c of [...frame.request.context.previousBars.chords, ...frame.request.context.currentBars.chords, ...frame.request.context.nextBars.chords]) {
    seen.set(Math.round(c.start * 1000), c);
  }
  const grid = { origin: frame.origin, beat: frame.beatSeconds, subdivision: frame.beatSeconds / 2 };
  return quantiseChordsToGrid([...seen.values()], grid).sort((a, b) => a.start - b.start);
}

/**
 * The bars this part plays (its arc window inside the section), each with the
 * shared anticipation slots and the tie state of its downbeat.
 */
export function barsOf(frame: ComposeFrame, groove: GroovePlanSection): BarSlot[] {
  const { request, origin, barSeconds, beatSeconds } = frame;
  const first = Math.max(request.section.startBar, request.partWindow.startBar);
  const last = Math.min(request.section.endBar, request.partWindow.endBar);
  const chords = visibleChords(frame);
  const phraseEnds = phraseEndBarsOf(request.phrases);
  const lastOfSong = Math.max(...request.globalPlan.sectionTargets.map((t) => t.endBar), request.section.endBar);
  const out: BarSlot[] = [];
  let previousPushedDownbeat = false;
  for (let bar = first; bar <= last; bar += 1) {
    const barStart = origin + (bar - 1) * barSeconds;
    const slots = anticipationSlots(groove, bar, barStart, beatSeconds, chords, phraseEnds)
      // Never push past the song's end.
      .filter((s) => !(bar === lastOfSong));
    out.push({
      bar, barStart,
      isSectionStart: bar === request.section.startBar,
      isSectionEnd: bar === request.section.endBar,
      isLastOfSong: bar === lastOfSong,
      phraseEnd: phraseEnds.has(bar),
      tiedDownbeat: previousPushedDownbeat && bar !== request.section.startBar,
      slots,
    });
    const nextDownbeat = barStart + barSeconds;
    previousPushedDownbeat = slots.some((s) => near(s.target, nextDownbeat));
  }
  return out;
}

type Directives = { rests: RestWindow[]; thinBars: Set<number> };

function directivesFor(frame: ComposeFrame, family: FamilyKey): Directives {
  const { outgoing } = transitionGesturesFor(frame, family);
  return {
    rests: outgoing.flatMap((g) => g.restWindows),
    thinBars: new Set(outgoing.flatMap((g) => g.thinBars)),
  };
}

/** Swing: an off-beat 8th (the half of a simple-meter unit) lands late by the plan's ratio. */
function swungUnit(groove: GroovePlanSection, unit: number): number {
  const ratio = groove.swing.value;
  if (ratio <= 0.5 || groove.meter.denominator >= 8) return unit;
  const fraction = unit - Math.floor(unit);
  if (Math.abs(fraction - 0.5) > 1e-6) return unit;
  return Math.floor(unit) + ratio;
}

/**
 * The approach crescendo: over the plan's approach bars (the last bars before a
 * build or a lift's arrival) every part's velocity ramps up to
 * `approach.crescendo`; 0 outside the approach.
 */
export function approachGainAt(groove: GroovePlanSection, frame: ComposeFrame, bar: number, unit: number): number {
  const approach = groove.approach.value;
  if (!approach || approach.bars <= 0) return 0;
  const endBar = frame.request.section.endBar;
  const firstApproachBar = endBar - approach.bars + 1;
  if (bar < firstApproachBar) return 0;
  const progress = ((bar - firstApproachBar) + unit / Math.max(1, frame.beats)) / approach.bars;
  // The ramp starts a third of the way up: the first approach bar already lifts.
  return approach.crescendo * (0.3 + 0.7 * Math.min(1, Math.max(0, progress)));
}

/** True when `bar` lies in the section's approach window. */
export function inApproach(groove: GroovePlanSection, frame: ComposeFrame, bar: number): boolean {
  const approach = groove.approach.value;
  return !!approach && approach.bars > 0 && bar > frame.request.section.endBar - approach.bars;
}

// ---------------------------------------------------------------------------
// Shared rhythm for the harmony writers (B-02 calls these)
// ---------------------------------------------------------------------------

export type GrooveOnset = {
  bar: number;
  /** Position in denominator units from the bar's downbeat (fractional for pushes). */
  unit: number;
  start: number;
  duration: number;
  /** Metrical accent 0..1 at this position. */
  accent: number;
  /** The chord sounding at the onset (the anticipated chord for a push). */
  chord: ChordHarmonyEvent | null;
  /** Set when this onset anticipates the next grid point's chord. */
  anticipates: ChordHarmonyEvent | null;
  /** Velocity to add in the approach to a build / lift arrival (0 elsewhere); every part shares the ramp. */
  crescendo: number;
};

export type CompingOnset = GrooveOnset & { cell: GrooveCompingCell };

function hitDuration(cell: GrooveCompingCell, unitSeconds: number, stepUnits: number, index: number): number {
  switch (cell) {
    case "quarter_pulses": return unitSeconds * 0.5;
    case "off_beat_chop": return unitSeconds * 0.35;
    case "charleston": return unitSeconds * (index === 0 ? 0.9 : 0.45);
    case "sparse_hits": return unitSeconds * 1.5;
    case "arpeggiated_8ths": return unitSeconds * stepUnits * 0.85;
    default: return unitSeconds;
  }
}

/**
 * The comping rhythm for this part under the section's groove: the cell's
 * onsets per bar (rhythmic cell for RHYTHMIC_HARMONY / OSTINATO, bed cell for
 * HARMONIC_BED / PAD unless `which` says otherwise), the shared anticipations
 * (the pushed chord arrives early and its downbeat is tied), a breath at
 * phrase ends, the transitions' rests, and a held final chord at the song's
 * end. A harmony writer puts its voicing on each onset; `anticipates` names
 * the chord to voice when the onset is a push.
 */
export function compingRhythmFor(frame: ComposeFrame, which?: "rhythmic" | "bed", onsetCell?: GrooveCompingCell): CompingOnset[] {
  const groove = grooveOf(frame);
  const role = frame.request.role;
  const kind = which ?? (role === "RHYTHMIC_HARMONY" || role === "OSTINATO" ? "rhythmic" : "bed");
  const planned = kind === "rhythmic" ? groove.comping.rhythmic.value : groove.comping.bed.value;
  // B-21: the texture may ask this part for a different cell of the groove
  // plan's own vocabulary (a struck bed re-articulating on the pulse under an
  // arrival). The cells and their unit sets stay the plan's - `cellUnits` is
  // the plan's function - so this is which cell is read, never a private grid.
  const cell = onsetCell ?? planned;
  const units = cell === planned
    ? (kind === "rhythmic" ? groove.comping.rhythmicUnits : groove.comping.bedUnits)
    : cellUnits(cell, frame.meter, groove.comping.arpeggioStepUnits);
  const family = familyOf(frame);
  const { rests } = directivesFor(frame, family);
  const chords = visibleChords(frame);
  const n = frame.beats;
  const unitSeconds = frame.beatSeconds;
  const step = groove.comping.arpeggioStepUnits || stepUnitsFor("8ths", frame.meter);
  const isLift = frame.request.arcIntent?.tensionRole === "lift";
  const out: CompingOnset[] = [];
  for (const b of barsOf(frame, groove)) {
    if (b.isLastOfSong && groove.ending.value !== "none") {
      // B-21: the final chord is held to the end of the last bar (the frame
      // clamps it to the section window), not released 5 % early. R-1b P1-7
      // heard the owner's song end 1.06 s before its last bar.
      const chord = chordAtTime(chords, b.barStart);
      out.push({ bar: b.bar, unit: 0, start: b.barStart, duration: frame.barSeconds, accent: 1, chord, anticipates: null, crescendo: 0, cell });
      continue;
    }
    const slotUnits = new Set(b.slots.map((s) => s.unit));
    let barUnits: number[] = [...units];
    if (cell === "whole_note_bed") {
      // A bed re-attacks where a chord starts inside the bar.
      for (const c of chords) {
        const u = (c.start - b.barStart) / unitSeconds;
        if (u > 1e-6 && u < n - 1e-6 && !barUnits.some((x) => near(x, u))) barUnits.push(r4(u));
      }
      barUnits.sort((x, y) => x - y);
    }
    const breath = b.phraseEnd && !isLift && b.slots.length === 0 && cell !== "whole_note_bed" && cell !== "sparse_hits";
    barUnits.forEach((u, index) => {
      if (u === 0 && b.tiedDownbeat) return;
      if (breath && u >= n - 1) return;
      // A hit that the anticipation replaces (the slot's own unit or the grid point it pushes into).
      if (slotUnits.has(u)) return;
      if (b.slots.some((s) => near(s.target - b.barStart, u * unitSeconds))) return;
      const start = b.barStart + swungUnit(groove, u) * unitSeconds;
      if (inRest(rests, start)) return;
      const nextUnit = barUnits[index + 1] ?? n;
      const duration = cell === "whole_note_bed" ? (nextUnit - u) * unitSeconds * 0.98 : hitDuration(cell, unitSeconds, step, index);
      out.push({ bar: b.bar, unit: u, start, duration, accent: accentWeight(frame.meter, u), chord: chordAtTime(chords, start), anticipates: null, crescendo: approachGainAt(groove, frame, b.bar, u), cell });
    });
    for (const s of b.slots) {
      if (inRest(rests, s.time)) continue;
      out.push({ bar: b.bar, unit: s.unit, start: s.time, duration: (s.target - s.time) + unitSeconds * 0.5, accent: accentWeight(frame.meter, s.unit), chord: s.chord, anticipates: s.chord, crescendo: approachGainAt(groove, frame, b.bar, s.unit), cell });
    }
  }
  return out.sort((a, b) => a.start - b.start);
}

export type BassFigure = "root" | "fifth" | "octave" | "approach" | "pedal";
export type BassOnset = GrooveOnset & { figure: BassFigure };

/**
 * The bass rhythm under the section's groove: onsets from the kick/bass
 * relationship (lock = the kick's onsets; complement = every pulse; pedal =
 * the chord onsets), the shared anticipations (the next chord's root arrives
 * early, its downbeat is tied), the last onset before a change marked as an
 * approach, and a held root at the song's end. Pitches are the harmony
 * writer's; `figure` says what each onset wants.
 */
export function bassRhythmFor(frame: ComposeFrame): BassOnset[] {
  const groove = grooveOf(frame);
  const { rests } = directivesFor(frame, "bass");
  const chords = visibleChords(frame);
  const n = frame.beats;
  const unitSeconds = frame.beatSeconds;
  const relation = groove.kickBass.value;
  const out: BassOnset[] = [];
  const pulses = groove.meter.pulses;
  const backbeat = groove.kit.snare[0] ?? groove.kit.sideStick[0] ?? pulses[1] ?? 0;
  for (const b of barsOf(frame, groove)) {
    if (b.isLastOfSong && groove.ending.value !== "none") {
      // B-21: held to the end of the last bar (see `compingRhythmFor`).
      out.push({ bar: b.bar, unit: 0, start: b.barStart, duration: frame.barSeconds, accent: 1, chord: chordAtTime(chords, b.barStart), anticipates: null, crescendo: 0, figure: "root" });
      continue;
    }
    let barUnits: number[] = [...groove.bassUnits];
    if (relation === "pedal") {
      // B-21: the plan's own onsets (`groove.bassUnits`, `[0]` for a pedal -
      // the downbeat of every bar) *plus* any chord start inside the bar.
      //
      // Before this the writer threw the plan's units away and rebuilt the
      // pedal's onsets from the chord starts alone, re-articulating only every
      // second bar when a bar had none. That is a second source of truth for
      // the bass's onsets against `bassUnitsFor` in `groovePlan.ts`, and it is
      // why the owner's bass had no note in 12 of Verse 3's 24 bars and 7 of
      // the Outro's 13 (`density:foundation_gaps`, major, twice) while the
      // plan said "a held root under every chord".
      for (const c of chords) {
        const u = (c.start - b.barStart) / unitSeconds;
        if (u > 1e-6 && u < n - 1e-6 && !barUnits.some((x) => near(x, u))) barUnits.push(r4(u));
      }
      barUnits.sort((x, y) => x - y);
    }
    const slotUnits = new Set(b.slots.map((s) => s.unit));
    barUnits.forEach((u, index) => {
      if (u === 0 && b.tiedDownbeat) return;
      if (slotUnits.has(u)) return;
      if (b.slots.some((s) => near(s.target - b.barStart, u * unitSeconds))) return;
      const start = b.barStart + swungUnit(groove, u) * unitSeconds;
      if (inRest(rests, start)) return;
      const chord = chordAtTime(chords, start);
      const nextUnit = barUnits[index + 1] ?? n;
      const nextStart = b.barStart + nextUnit * unitSeconds;
      const nextChord = chordAtTime(chords, nextStart);
      const changesNext = !!chord && !!nextChord && (nextChord.symbol !== chord.symbol || Math.abs(nextChord.start - chord.start) > 1e-6);
      const firstOfChord = !!chord && (Math.abs(chord.start - start) < 1e-3 || (index === 0 && !barUnits.slice(0, index).length && chord.start < b.barStart && b.isSectionStart));
      const figure: BassFigure = relation === "pedal" ? "pedal"
        : changesNext && index === barUnits.length - 1 && relation !== "lock" ? "approach"
        : firstOfChord || u === 0 ? "root"
        : pulses.includes(Math.floor(u)) && Math.floor(u) === backbeat ? "fifth"
        : index % 2 === 0 ? "octave" : "fifth";
      const duration = relation === "pedal" ? (nextUnit - u) * unitSeconds * 0.98 : (nextUnit - u) * unitSeconds * 0.85;
      out.push({ bar: b.bar, unit: u, start, duration, accent: accentWeight(frame.meter, u), chord, anticipates: null, crescendo: approachGainAt(groove, frame, b.bar, u), figure });
    });
    for (const s of b.slots) {
      if (inRest(rests, s.time)) continue;
      out.push({ bar: b.bar, unit: s.unit, start: s.time, duration: (s.target - s.time) + unitSeconds * 0.9, accent: accentWeight(frame.meter, s.unit), chord: s.chord, anticipates: s.chord, crescendo: approachGainAt(groove, frame, b.bar, s.unit), figure: "root" });
    }
  }
  return out.sort((a, b) => a.start - b.start);
}

function familyOf(frame: ComposeFrame): FamilyKey {
  const task = frame.request.task;
  if (task === "DRUMS") return "drums";
  if (task === "PERCUSSION") return "percussion";
  if (task === "BASS") return "bass";
  if (task === "STRINGS") return "strings";
  if (task === "PAD") return "pads";
  if (task === "BRASS") return "brass";
  if (task === "WOODWINDS") return "winds";
  if (task === "ACOUSTIC_GUITAR" || task === "ELECTRIC_GUITAR") return "guitar";
  return "keys";
}

// ---------------------------------------------------------------------------
// Fills
// ---------------------------------------------------------------------------

export type KitNote = { start: number; duration: number; pitch: number; velocity: number; id: string };

/** The notes of one fill placement, from the vocabulary, over the last `lengthUnits` of the bar. */
export function fillNotes(placement: GrooveFillPlacement, barStart: number, frame: ComposeFrame, groove: GroovePlanSection): KitNote[] {
  const n = frame.beats;
  const unit = frame.beatSeconds;
  const length = Math.min(n, placement.lengthUnits);
  if (length <= 0) return [];
  const start = barStart + (n - length) * unit;
  const span = length * unit;
  // A fill is a burst, not sustained hat playing: 16ths up to ~12 strikes/s (two hands alternate), 8ths beyond.
  const sixteenthSeconds = unit * (frame.meter.denominator >= 8 ? 0.5 : 0.25);
  const sixteenthsAllowed = 1 / sixteenthSeconds <= 12;
  const perUnit = frame.meter.denominator >= 8 ? (sixteenthsAllowed ? 2 : 1) : (sixteenthsAllowed ? 4 : 2);
  const steps = Math.max(2, Math.round(length * perUnit));
  const base = frame.baseVelocity + (placement.intensity - 0.5) * 20;
  const vel = (v: number) => Math.max(1, Math.min(127, Math.round(v)));
  const id = (i: number) => `fill${placement.bar}-${placement.kind}-${i}`;
  const notes: KitNote[] = [];
  const stepSeconds = span / steps;
  const offBeat = frame.meter.denominator >= 8 ? unit : unit * 0.5;
  switch (placement.kind) {
    case "tom_run":
      for (let i = 0; i < steps; i += 1) {
        notes.push({ start: start + i * stepSeconds, duration: r4(Math.min(0.12, stepSeconds * 0.9)), pitch: TOMS_UP[Math.floor((i / steps) * TOMS_UP.length)], velocity: vel(base + 2 + (i / steps) * 14), id: id(i) });
      }
      break;
    case "snare_roll":
      for (let i = 0; i < steps; i += 1) {
        notes.push({ start: start + i * stepSeconds, duration: r4(Math.min(0.08, stepSeconds * 0.9)), pitch: SNARE, velocity: vel(base - 18 + (i / Math.max(1, steps - 1)) * 30), id: id(i) });
      }
      break;
    case "kick_snare_16ths":
      for (let i = 0; i < steps; i += 1) {
        notes.push({ start: start + i * stepSeconds, duration: r4(Math.min(0.1, stepSeconds * 0.9)), pitch: i % 2 === 0 ? KICK : SNARE, velocity: vel(base + 4 + (i / steps) * 10), id: id(i) });
      }
      break;
    case "open_hat_lift": {
      const last = barStart + n * unit;
      notes.push({ start: last - offBeat, duration: r4(offBeat * 0.9), pitch: OPEN_HAT, velocity: vel(base + 4), id: id(0) });
      if (length * unit > offBeat * 2 + 1e-6) notes.push({ start: last - offBeat * 3, duration: r4(offBeat * 0.9), pitch: OPEN_HAT, velocity: vel(base), id: id(1) });
      notes.push({ start: r4(last - unit * (frame.meter.denominator >= 8 ? 2 : 1)), duration: 0.16, pitch: KICK, velocity: vel(base + 6), id: id(2) });
      break;
    }
    case "snare_pickup": {
      const last = barStart + n * unit;
      notes.push({ start: last - offBeat, duration: 0.12, pitch: SNARE, velocity: vel(base + 6), id: id(0) });
      notes.push({ start: r4(last - unit * (frame.meter.denominator >= 8 ? 2 : 1)), duration: 0.16, pitch: KICK, velocity: vel(base + 2), id: id(1) });
      break;
    }
    case "crash_only":
    default: {
      const last = barStart + n * unit;
      notes.push({ start: last - offBeat, duration: r4(offBeat * 0.9), pitch: OPEN_HAT, velocity: vel(base + 2), id: id(0) });
      break;
    }
  }
  return notes;
}

// ---------------------------------------------------------------------------
// Writers
// ---------------------------------------------------------------------------

/** DRUMS: the plan's kit template per bar, shared anticipations, fills from the vocabulary, transition gestures, the ending. */
export function writeDrumKit(frame: ComposeFrame): void {
  const { request, baseVelocity, barSeconds, beatSeconds: unit, push } = frame;
  const groove = grooveOf(frame);
  const { rests, thinBars } = directivesFor(frame, "drums");
  const { outgoing } = transitionGesturesFor(frame, "drums");
  const n = frame.beats;
  const pulses = groove.meter.pulses;
  const notes: KitNote[] = [];
  const add = (start: number, duration: number, pitch: number, velocity: number, id: string) =>
    notes.push({ start, duration, pitch, velocity: Math.max(1, Math.min(127, Math.round(velocity))), id });
  const w = (u: number) => accentWeight(frame.meter, u);
  const isLift = request.arcIntent?.tensionRole === "lift";
  const stepSeconds = groove.kit.hatStepUnits > 0 ? groove.kit.hatStepUnits * unit : unit;
  const hatDuration = Math.min(0.09, stepSeconds * 0.45);

  const hatGrid = (step: number): number[] => {
    if (step <= 0) return [...pulses];
    const out: number[] = [];
    for (let u = 0; u < n - 1e-9; u += step) out.push(Number(u.toFixed(3)));
    return out;
  };
  const hatUnits = hatGrid(groove.kit.hatStepUnits);
  const approachHatUnits = groove.approach.value ? hatGrid(groove.approach.value.hatStepUnits) : hatUnits;

  for (const b of barsOf(frame, groove)) {
    const bs = b.barStart;
    const placement = groove.fills.placements.find((p) => p.bar === b.bar && p.lengthUnits > 0);
    const crashHere = groove.fills.placements.some((p) => p.bar === b.bar && p.lengthUnits === 0) ||
      groove.fills.placements.some((p) => p.bar === b.bar - 1 && p.lengthUnits > 0 && p.intensity >= 0.5);

    if (b.isLastOfSong && groove.ending.value !== "none") {
      // The song ends: kick and crash on the downbeat, held; nothing after.
      add(bs, Math.min(barSeconds, 1.5), KICK, baseVelocity + 14, `end-k${b.bar}`);
      add(bs, barSeconds * 0.95, CRASH, baseVelocity + (groove.ending.value === "held_hit" ? 16 : 6), `end-c${b.bar}`);
      if (groove.ending.value === "held_hit") add(bs, 0.2, SNARE, baseVelocity + 10, `end-s${b.bar}`);
      continue;
    }

    const fillStart = placement ? n - placement.lengthUnits : n;
    const thin = thinBars.has(b.bar);
    const slotUnits = b.slots.map((s) => s.unit);
    const before = (u: number) => u < fillStart - 1e-9;
    const approaching = inApproach(groove, frame, b.bar) && !thin;
    const gain = (u: number) => approachGainAt(groove, frame, b.bar, u);
    const hit = (start: number, duration: number, pitch: number, velocity: number, id: string, u: number) => add(start, duration, pitch, velocity + gain(u), id);

    // Kick.
    for (const u of groove.kit.kick) {
      if (!before(u)) continue;
      if (u === 0 && b.tiedDownbeat) continue;
      hit(bs + u * unit, 0.18, KICK, baseVelocity + 10 + (w(u) - 0.68) * 20, `k${b.bar}-${u}`, u);
    }
    if (groove.anticipations.value.kickAnticipates && !thin) {
      // The push lands even when a fill occupies the bar: the fill ends on it, as the bass and the comping do.
      for (const s of b.slots) hit(s.time, 0.16, KICK, baseVelocity + 4, `ka${b.bar}-${s.unit}`, s.unit);
    }
    if (thin) {
      // Breakdown: kick only, hats on the pulses.
      for (const u of pulses) if (before(u) && u !== 0) add(bs + u * unit, hatDuration, CLOSED_HAT, baseVelocity - 12, `h${b.bar}-${u}`);
    } else {
      // Backbeat / side-stick.
      for (const u of groove.kit.snare) if (before(u)) hit(bs + u * unit, 0.2, SNARE, baseVelocity + 8 + (w(u) - 0.68) * 10, `s${b.bar}-${u}`, u);
      for (const u of groove.kit.sideStick) if (before(u)) hit(bs + u * unit, 0.12, SIDE_STICK, baseVelocity - 6, `x${b.bar}-${u}`, u);
      // Hats (or ride): denser through the approach; a breath in the last unit of a phrase-final bar when nothing pushes there.
      const breath = b.phraseEnd && !placement && !isLift && !approaching && b.slots.length === 0;
      const grid = approaching ? approachHatUnits : hatUnits;
      const gridStep = approaching && groove.approach.value ? groove.approach.value.hatStepUnits : groove.kit.hatStepUnits;
      const hatLength = Math.min(0.09, (gridStep > 0 ? gridStep * unit : unit) * 0.45);
      for (const u of grid) {
        if (!before(u)) continue;
        if (breath && u >= n - 1) continue;
        const open = groove.kit.openHat.some((o) => near(o, u));
        const pitch = groove.kit.ride ? RIDE : open ? OPEN_HAT : CLOSED_HAT;
        hit(bs + swungUnit(groove, u) * unit, open ? hatLength * 2 : hatLength, pitch, baseVelocity - 6 + (w(u) - 0.68) * 28, `h${b.bar}-${u}`, u);
      }
      if (groove.kit.ride) {
        for (const u of groove.kit.snare.length ? groove.kit.snare : [pulses[1] ?? 0]) if (before(u)) add(bs + u * unit, 0.08, PEDAL_HAT, baseVelocity - 14, `ph${b.bar}-${u}`);
      }
      // Ghost notes on weak positions nothing else occupies.
      for (const u of groove.kit.ghost) {
        if (!before(u)) continue;
        if (groove.kit.kick.some((k) => near(k, u)) || groove.kit.snare.some((s) => near(s, u)) || slotUnits.some((s) => near(s, u))) continue;
        add(bs + swungUnit(groove, u) * unit, 0.06, SNARE, Math.max(20, baseVelocity * 0.38), `g${b.bar}-${u}`);
      }
    }
    if (placement) for (const note of fillNotes(placement, bs, frame, groove)) add(note.start, note.duration, note.pitch, note.velocity + gain((note.start - bs) / unit), note.id);
    if (crashHere && !thin) add(bs, Math.min(barSeconds, 1.2), CRASH, baseVelocity + 14, `cr${b.bar}`);
  }

  for (const g of outgoing) if (g.applies) for (const note of g.notes) notes.push({ ...note });

  for (const note of notes) {
    if (inRest(rests, note.start)) continue;
    push(note.start, note.duration, note.pitch, note.velocity, note.id);
  }
}

/**
 * PERCUSSION: the meter's weak units on the shaker, the groove's backbeat on
 * the tambourine, pulses only when the texture is thin, and a breath at phrase
 * ends.
 *
 * B-21: before this the whole part was **one pitch on the same units in every
 * bar** — measured on the owner's song, 120 notes on MIDI 54 across 30 bars
 * with a bar-rhythm entropy of exactly 0, which the critics reported as
 * `instrumentReality:single_pitch_percussion` (major, whole track) and
 * `adversarial.boredom:rhythm_predictable` (major). A percussionist holding a
 * shaker and a tambourine plays the backbeat on one and the subdivision on the
 * other, and lifts at the end of a phrase.
 */
export function writePercussion(frame: ComposeFrame): void {
  const { request, baseVelocity, beatSeconds: unit, push } = frame;
  const groove = grooveOf(frame);
  const { rests, thinBars } = directivesFor(frame, "percussion");
  const spec = frame.meter;
  const n = frame.beats;
  const level = request.arcIntent?.level ?? request.section.energy;
  const texture = request.arcIntent?.texture ?? null;
  const thinTexture = texture === "solo" || texture === "duo" || level < 0.3;
  const isLift = request.arcIntent?.tensionRole === "lift";
  const backbeat = groove.kit.snare.length ? groove.kit.snare : groove.kit.sideStick;
  const subdivision: number[] = thinTexture
    ? []
    : spec.feel === "simple"
      ? (spec.numerator === 3 ? [1, 2] : groove.subdivision.value === "quarters" ? [] : Array.from({ length: n }, (_, i) => i + 0.5))
      : spec.grouping.map((g, i) => spec.pulses[i] + g - 1);
  // Two hands, two sounds: the accent on the backbeat, the filler between.
  const struck: Array<{ unit: number; pitch: number; accentOffset: number }> = [
    ...backbeat.map((u) => ({ unit: u, pitch: TAMBOURINE, accentOffset: 6 })),
    ...subdivision.filter((u) => !backbeat.some((b) => near(b, u))).map((u) => ({ unit: u, pitch: SHAKER, accentOffset: 0 })),
  ].sort((a, b) => a.unit - b.unit);
  if (!struck.length) {
    for (const u of backbeat) struck.push({ unit: u, pitch: level >= 0.5 ? TAMBOURINE : SHAKER, accentOffset: 6 });
  }
  const phraseEnds = phraseEndBarsOf(request.phrases);
  for (const b of barsOf(frame, groove)) {
    if (b.isLastOfSong && groove.ending.value !== "none") continue;
    if (thinBars.has(b.bar)) continue;
    // A phrase ends: the filler hand stops and only the accent marks the bar.
    // The bar before it takes a pickup on the last off-beat, the way a
    // percussionist hands the phrase over. Three bar-rhythms instead of one.
    const closing = b.phraseEnd && !isLift;
    const handover = !closing && phraseEnds.has(b.bar + 1) && !isLift;
    // A hand percussionist plays a two-bar cell, not one bar over and over:
    // the second bar of each pair leaves the first off-beat out.
    const secondOfPair = Math.abs((b.bar - request.section.startBar) % 2) === 1;
    for (const s of struck) {
      if (closing && s.pitch === SHAKER) continue;
      if (secondOfPair && !closing && s.pitch === SHAKER && near(s.unit, subdivision[0] ?? -1)) continue;
      const start = b.barStart + swungUnit(groove, s.unit) * unit;
      if (inRest(rests, start)) continue;
      push(start, 0.1, s.pitch, baseVelocity - 18 + s.accentOffset + (accentWeight(spec, s.unit) - 0.46) * 10 + approachGainAt(groove, frame, b.bar, s.unit), `pc${b.bar}-${s.unit}`);
    }
    if (handover) {
      const at = n - 0.5;
      const start = b.barStart + swungUnit(groove, at) * unit;
      if (!inRest(rests, start) && !struck.some((s) => near(s.unit, at))) {
        push(start, 0.1, TAMBOURINE, baseVelocity - 14 + approachGainAt(groove, frame, b.bar, at), `pc${b.bar}-pick`);
      }
    }
  }
}

/** OSTINATO: chord tones cycled on the plan's arpeggio step, pushing with the shared anticipations. */
export function writeOstinato(frame: ComposeFrame): void {
  const { request, lo, hi, beatSeconds: unit, baseVelocity, push } = frame;
  const groove = grooveOf(frame);
  const { rests, thinBars } = directivesFor(frame, "keys");
  const chords = visibleChords(frame);
  const n = frame.beats;
  const ceilingStep = stepUnitsFor(groove.densityCeiling.value, frame.meter) || stepUnitsFor("8ths", frame.meter);
  const step = Math.max(groove.comping.arpeggioStepUnits || stepUnitsFor("8ths", frame.meter), ceilingStep);
  const isLift = request.arcIntent?.tensionRole === "lift";
  const centre = (lo + hi) / 2;
  let cycle = 0;
  let lastChord: ChordHarmonyEvent | null = null;
  for (const b of barsOf(frame, groove)) {
    if (thinBars.has(b.bar)) continue;
    if (b.isLastOfSong && groove.ending.value !== "none") {
      const chord = chordAtTime(chords, b.barStart);
      if (chord) chordPitchClasses(chord).slice(0, 3).forEach((pc, i) => push(b.barStart, frame.barSeconds * 0.95, voiceNear(pc, centre + i * 4, lo, hi), baseVelocity - 4, `o-end-${i}`));
      continue;
    }
    const breath = b.phraseEnd && !isLift && b.slots.length === 0;
    for (let u = 0; u < n - 1e-9; u += step) {
      const unitPos = Number(u.toFixed(3));
      if (unitPos === 0 && b.tiedDownbeat) continue;
      if (breath && unitPos >= n - 1) continue;
      if (b.slots.some((s) => near(s.target - b.barStart, unitPos * unit))) continue;
      const slot = b.slots.find((s) => near(s.unit, unitPos));
      const start = slot ? slot.time : b.barStart + swungUnit(groove, unitPos) * unit;
      if (inRest(rests, start)) continue;
      const chord = slot?.chord ?? chordAtTime(chords, start);
      if (!chord) continue;
      if (chord !== lastChord) { cycle = 0; lastChord = chord; }
      const tones = chordPitchClasses(chord);
      const pc = tones[cycle % tones.length];
      cycle += 1;
      push(start, step * unit * 0.8, voiceNear(pc, centre, lo, hi), baseVelocity - 8 + (accentWeight(frame.meter, unitPos) - 0.68) * 12 + approachGainAt(groove, frame, b.bar, unitPos), `o${b.bar}-${unitPos}`);
    }
  }
}

/** The root pitch class of a chord, for callers that want the bass figure's target. */
export function chordRootPc(chord: ChordHarmonyEvent): number {
  return rootPitchClass(chord.root ?? chord.symbol);
}
