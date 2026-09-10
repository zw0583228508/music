/**
 * Bass-line planner (Brain B-02, D2).
 *
 * The bass is planned before the upper voices, over the real harmonic rhythm
 * of the part's window. Two stages:
 *
 *  1. `planBassSkeleton` - one pitch per chord event, chosen by the exact
 *     chain solver: the root (or the slash bass, or an inversion when the
 *     style tolerates it and the line asks), in the octave that keeps every
 *     leap within the instrument's limit, with contrary motion against a
 *     top-voice guide rewarded, and a pedal held under a `setup` / `afterglow`
 *     when the style allows. Seed-free, so a keys part can recompute the same
 *     skeleton and voice itself above it without seeing the bass part.
 *  2. `realiseBassLine` - the notes: density from the arc's intended level
 *     (pp = whole notes on the skeleton, mp = roots and fifths, f = a moving
 *     line), approach tones into changes at the style's rate, every duration
 *     clipped to its chord (never lapping the next), every pitch chosen inside
 *     the leap limit of both neighbours - so no fold is ever needed afterwards.
 */
import type { ArcTensionRole } from "@workspace/db";
import { solveChain } from "../voiceLeading";
import { approachToneChoice, tonalCentreOf, type HarmonyStyleParams } from "./styleParams";
import { nearestPitch, nearestPitchWithin, pc, pitchesOf, seededUnit, type HarmonyChordEvent } from "./shared";

export type BassSkeletonEntry = {
  index: number;
  pitch: number;
  pitchClass: number;
  kind: "root" | "slash" | "inversion" | "pedal";
  reason: string;
};

export type BassPlanInput = {
  /** Chord events of the part's window, clipped and in order. */
  events: HarmonyChordEvent[];
  /** Chord events before the window (the previous bars), solved for continuity and then dropped. */
  warmup?: HarmonyChordEvent[];
  window: { start: number; end: number };
  range: { lo: number; hi: number };
  maxLeap: number;
  style: HarmonyStyleParams;
  arc: { level: number; tensionRole: ArcTensionRole | null };
  timing: { beatSeconds: number; barSeconds: number; beatsPerBar: number; origin: number };
  density: number;
  seed: number;
  /** The instrument's shortest note; no two onsets are placed closer than this (default 0.08 s). */
  minNoteDuration?: number;
  /** A guide top-voice pitch per window event, for contrary motion; entries may be null. */
  topGuide?: ReadonlyArray<number | null>;
  /** The previous section's last bass pitch, when known. */
  startPitch?: number | null;
};

export type BassNote = {
  start: number;
  duration: number;
  pitch: number;
  kind: "chord_tone" | "fifth" | "octave" | "third" | "approach" | "pedal";
  /** Index into `events`. */
  eventIndex: number;
  /** Added to the part's base velocity. */
  velocityOffset: number;
};

export type BassPlan = {
  skeleton: BassSkeletonEntry[];
  notes: BassNote[];
  pattern: "whole" | "per_bar" | "roots_fifths" | "moving" | "walking";
  approaches: number;
  pedalEvents: number;
  notes_: string[];
};

const LEAP_WEIGHT = 0.6;
const COMFORTABLE_LEAP = 7;
const WIDE_LEAP_WEIGHT = 1.5;
// Contrary motion against the top voice buys up to five semitones of extra leap.
const CONTRARY_REWARD = 3;
const SIMILAR_COST = 1;
const REPEAT_COST = 0.3;
const OCTAVE_HOP_COST = 1;
const REGISTER_WEIGHT = 0.25;
const INVERSION_COST = 9;

/** Which events the bass holds a pedal under, if the arc and the style ask for one. */
function pedalEvents(events: HarmonyChordEvent[], input: BassPlanInput): { pitchClass: number; indices: Set<number> } | null {
  const role = input.arc.tensionRole;
  if (!events.length || input.style.pedalTolerance <= 0 || (role !== "setup" && role !== "afterglow")) return null;
  const pedalPc = events[0].chord.bass;
  const maxBars = input.style.pedalTolerance >= 0.7 ? 8 : 4;
  const limit = input.window.start + maxBars * input.timing.barSeconds;
  const indices = new Set<number>();
  for (let i = 0; i < events.length; i += 1) {
    const event = events[i];
    if (event.start >= limit - 1e-6) break;
    const chordTone = event.chord.pitchClasses.includes(pedalPc);
    if (!chordTone && input.style.pedalTolerance < 0.8) break;
    indices.add(i);
  }
  // One chord is not a pedal.
  if (indices.size < 2) return null;
  return { pitchClass: pedalPc, indices };
}

type Candidate = { pitch: number; kind: BassSkeletonEntry["kind"]; cost: number; reason: string };

function candidatesFor(event: HarmonyChordEvent, input: BassPlanInput, pedal: { pitchClass: number; indices: Set<number> } | null, index: number): Candidate[] {
  const { lo, hi } = input.range;
  const chord = event.chord;
  const out: Candidate[] = [];
  if (pedal && pedal.indices.has(index)) {
    for (const pitch of pitchesOf(pedal.pitchClass, lo, hi)) out.push({ pitch, kind: "pedal", cost: 0, reason: `pedal under ${input.arc.tensionRole}` });
    if (out.length) return out;
  }
  if (chord.bass !== chord.root) {
    for (const pitch of pitchesOf(chord.bass, lo, hi)) out.push({ pitch, kind: "slash", cost: 0, reason: `slash bass ${chord.symbol}` });
    if (out.length) return out;
  }
  for (const pitch of pitchesOf(chord.root, lo, hi)) out.push({ pitch, kind: "root", cost: 0, reason: "root" });
  const tolerance = input.style.inversionTolerance;
  if (tolerance > 0) {
    const third = chord.pitchClasses.find((klass) => chord.roles.get(klass) === "third");
    const fifth = chord.pitchClasses.find((klass) => chord.roles.get(klass) === "fifth");
    // An inversion is worth taking when it saves the line more than it costs:
    // at tolerance 0.3 (a ballad) a third in the bass costs what a ten-semitone
    // root leap would; at 0.7 (classical) what a four-semitone one would.
    if (third !== undefined) for (const pitch of pitchesOf(third, lo, hi)) out.push({ pitch, kind: "inversion", cost: INVERSION_COST * (1 - tolerance), reason: "third in the bass for the line" });
    if (fifth !== undefined) for (const pitch of pitchesOf(fifth, lo, hi)) out.push({ pitch, kind: "inversion", cost: (INVERSION_COST + 1.5) * (1 - tolerance), reason: "fifth in the bass for the line" });
  }
  if (!out.length) {
    // The range holds no octave of the root: take the nearest chord tone that fits rather than nothing.
    for (const klass of chord.pitchClasses) for (const pitch of pitchesOf(klass, lo, hi)) out.push({ pitch, kind: "inversion", cost: 8, reason: "no root in range" });
  }
  return out;
}

/** One pitch per chord event, leaps within `maxLeap` by construction. */
export function planBassSkeleton(input: BassPlanInput): BassSkeletonEntry[] {
  const warmup = input.warmup ?? [];
  const all = [...warmup, ...input.events];
  if (!all.length) return [];
  const pedal = pedalEvents(input.events, input);
  const { lo, hi } = input.range;
  const centre = lo + (hi - lo) * 0.4;
  const layers = all.map((event, i) => candidatesFor(event, input, pedal, i - warmup.length));
  const topGuide = input.topGuide ?? topVoiceGuide(input.events);
  const guide = (i: number): number | null => {
    const w = i - warmup.length;
    return w >= 0 ? topGuide[w] ?? null : null;
  };
  const solved = solveChain<Candidate>({
    layers,
    unary: (candidate) => candidate.cost + REGISTER_WEIGHT * Math.abs(candidate.pitch - centre),
    pairwise: (from, to, layer) => {
      const delta = to.pitch - from.pitch;
      const leap = Math.abs(delta);
      if (leap > input.maxLeap) return { cost: Infinity, reasons: ["beyond the leap limit"] };
      let cost = leap * LEAP_WEIGHT;
      const reasons: string[] = [];
      if (leap > COMFORTABLE_LEAP) { cost += (leap - COMFORTABLE_LEAP) * WIDE_LEAP_WEIGHT; reasons.push("wide leap"); }
      if (leap === 0 && to.kind !== "pedal") cost += REPEAT_COST;
      if (leap === 12) cost += OCTAVE_HOP_COST;
      const before = guide(layer - 1);
      const now = guide(layer);
      if (before !== null && now !== null && now !== before && delta !== 0) {
        if (Math.sign(now - before) !== Math.sign(delta)) { cost -= CONTRARY_REWARD; reasons.push("contrary to the top voice"); }
        else cost += SIMILAR_COST;
      }
      return { cost, reasons };
    },
    startFrom: typeof input.startPitch === "number"
      ? { pitch: input.startPitch, kind: "root", cost: 0, reason: "previous section" }
      : undefined,
  });
  if (!solved) {
    // Only possible when a chord's candidates cannot be reached within the leap limit from any
    // candidate of the previous chord, i.e. the range is narrower than the leap limit allows
    // for; fall back to the nearest chord tone chain, which is still within range.
    const out: BassSkeletonEntry[] = [];
    let previous: number | null = typeof input.startPitch === "number" ? input.startPitch : null;
    all.forEach((event, i) => {
      const pitch = nearestPitchWithin(event.chord.bass, previous ?? centre, previous === null ? [] : [previous], input.maxLeap, lo, hi)
        ?? nearestPitch(event.chord.bass, previous ?? centre, lo, hi) ?? Math.round(centre);
      previous = pitch;
      if (i >= warmup.length) out.push({ index: i - warmup.length, pitch, pitchClass: pc(pitch), kind: "root", reason: "fallback: nearest root" });
    });
    return out;
  }
  return all.map((_, i) => {
    const chosen = layers[i][solved.chosen[i]];
    return { index: i - warmup.length, pitch: chosen.pitch, pitchClass: pc(chosen.pitch), kind: chosen.kind, reason: [chosen.reason, ...solved.stepReasons[i]].join("; ") };
  }).filter((entry) => entry.index >= 0);
}

/**
 * A guide for contrary motion: where a smooth top voice would sit on each
 * chord (the third when the chord has one, else the root), walked from a
 * reference by nearest motion. The upper voices are solved later against the
 * bass; this is only the direction the bass should lean against.
 */
export function topVoiceGuide(events: ReadonlyArray<HarmonyChordEvent>, reference = 67): number[] {
  const out: number[] = [];
  let previous = reference;
  for (const event of events) {
    const chord = event.chord;
    const third = chord.pitchClasses.find((klass) => chord.roles.get(klass) === "third" || chord.roles.get(klass) === "suspension");
    const klass = third ?? chord.root;
    const pitch = nearestPitch(klass, previous, reference - 14, reference + 14) ?? previous;
    out.push(pitch);
    previous = pitch;
  }
  return out;
}

function patternFor(input: BassPlanInput): BassPlan["pattern"] {
  const level = input.arc.level;
  // The arc's intended level decides; the plan's density budget only bites when it is near silence.
  if (level < 0.25 || input.density < 0.15) return "whole";
  if (level < 0.45) return input.style.bassMotion === "walking" && level >= 0.4 ? "moving" : "per_bar";
  if (level < 0.65) return input.style.bassMotion === "walking" ? "walking" : "roots_fifths";
  return input.style.bassMotion === "walking" ? "walking" : "moving";
}

/** The notes of a planned skeleton. */
export function realiseBassLine(skeleton: BassSkeletonEntry[], input: BassPlanInput): BassPlan {
  const { events } = input;
  const { beatSeconds, barSeconds, beatsPerBar, origin } = input.timing;
  const { lo, hi } = input.range;
  const pattern = patternFor(input);
  const notes: BassNote[] = [];
  const notes_: string[] = [];
  let approaches = 0;
  let pedalCount = 0;
  const gap = 0.005;

  const beatGrid = (from: number, to: number): number[] => {
    const out: number[] = [];
    const first = origin + Math.ceil((from - origin) / beatSeconds - 1e-6) * beatSeconds;
    for (let t = first; t < to - 1e-6; t += beatSeconds) out.push(Number(t.toFixed(6)));
    return out;
  };
  const barGrid = (from: number, to: number): number[] => {
    const out: number[] = [];
    const first = origin + Math.ceil((from - origin) / barSeconds - 1e-6) * barSeconds;
    for (let t = first; t < to - 1e-6; t += barSeconds) out.push(Number(t.toFixed(6)));
    return out;
  };
  const halfBar = Math.floor(beatsPerBar / 2) * beatSeconds;

  let previousPitch: number | null = typeof input.startPitch === "number" ? input.startPitch : null;
  for (let i = 0; i < events.length; i += 1) {
    const event = events[i];
    const entry = skeleton[i];
    if (!entry) continue;
    const s = Math.max(event.start, input.window.start);
    const e = Math.min(event.end, input.window.end);
    if (e - s <= 1e-6) continue;
    const anchor = entry.pitch;
    const next = skeleton[i + 1] ?? null;
    const isPedal = entry.kind === "pedal";
    if (isPedal) pedalCount += 1;

    // Onsets for this chord under the pattern.
    let onsets: number[];
    if (pattern === "whole") onsets = [s];
    else if (pattern === "per_bar") onsets = [s, ...barGrid(s + 1e-3, e)];
    else if (pattern === "roots_fifths") {
      onsets = [s];
      for (const bar of [s, ...barGrid(s + 1e-3, e)]) {
        if (bar !== s) onsets.push(bar);
        if (beatsPerBar >= 4 && halfBar > 0 && bar + halfBar < e - 1e-6 && bar + halfBar > s) onsets.push(bar + halfBar);
      }
    } else onsets = [s, ...beatGrid(s + 1e-3, e)];
    onsets = [...new Set(onsets.map((t) => Number(t.toFixed(6))))].sort((a, b) => a - b);
    // No onset closer to the previous one (or to the chord's end) than the
    // instrument can articulate: the chord's own start always wins, so a chord
    // that begins a few milliseconds before a bar line keeps its start and the
    // bar-line onset goes.
    const minNote = input.minNoteDuration ?? 0.08;
    if (e - s < minNote + gap) continue;
    const spaced: number[] = [];
    for (const t of onsets) {
      if (spaced.length && t - spaced[spaced.length - 1] < minNote + gap) continue;
      spaced.push(t);
    }
    while (spaced.length > 1 && e - spaced[spaced.length - 1] < minNote + gap) spaced.pop();
    onsets = spaced;

    // Pitches: the skeleton on the first onset; fifths / octaves / thirds after,
    // each inside the leap limit of the previous note and of the next chord's
    // skeleton pitch (so the change is always reachable).
    const fifth = event.chord.pitchClasses.find((klass) => event.chord.roles.get(klass) === "fifth");
    const third = event.chord.pitchClasses.find((klass) => event.chord.roles.get(klass) === "third");
    const reach = (klass: number, target: number, prev: number): number | null =>
      nearestPitchWithin(klass, target, next ? [prev, next.pitch] : [prev], input.maxLeap, lo, hi);
    const cycle: Array<{ klass: number | undefined; kind: BassNote["kind"] }> = pattern === "walking"
      ? [{ klass: pc(anchor), kind: "chord_tone" }, { klass: third, kind: "third" }, { klass: fifth, kind: "fifth" }, { klass: pc(anchor), kind: "octave" }]
      : [{ klass: pc(anchor), kind: "chord_tone" }, { klass: fifth, kind: "fifth" }, { klass: pc(anchor), kind: "octave" }, { klass: fifth, kind: "fifth" }];

    const planned: Array<{ start: number; pitch: number; kind: BassNote["kind"] }> = [];
    let prev = previousPitch;
    onsets.forEach((t, k) => {
      let pitch: number | null = null;
      let kind: BassNote["kind"] = isPedal ? "pedal" : "chord_tone";
      if (k === 0 || isPedal || pattern === "per_bar") {
        pitch = anchor;
      } else {
        const step = cycle[k % cycle.length];
        if (step.klass !== undefined) {
          const target = step.kind === "octave" ? anchor + 12 : anchor;
          pitch = reach(step.klass, target, prev ?? anchor);
          kind = step.kind;
        }
        if (pitch === null) { pitch = anchor; kind = "chord_tone"; }
      }
      planned.push({ start: t, pitch, kind });
      prev = pitch;
    });

    // Approach tone into the next change, on the last beat of this chord.
    // At pp (whole notes) a change is still led into now and then, at half the
    // style's rate and only when the chord lasted a bar or more.
    const approachRate = pattern === "whole"
      ? (e - s >= barSeconds - 1e-6 ? input.style.approachToneRate * 0.5 : 0)
      : input.style.approachToneRate;
    const wantsApproach = next !== null && !isPedal && next.kind !== "pedal" && next.pitch !== planned[planned.length - 1].pitch &&
      e - s >= beatSeconds * 2 - 1e-6 &&
      seededUnit(input.seed, `approach:${i}:${event.symbol}`) < approachRate;
    if (wantsApproach && next) {
      const lastBeat = Number((e - beatSeconds).toFixed(6));
      const previousChordPcs = new Set(event.chord.pitchClasses);
      const target = next.pitch;
      const before = planned.filter((n) => n.start < lastBeat - 1e-6);
      const prevPitch = before.length ? before[before.length - 1].pitch : (previousPitch ?? anchor);
      const above = seededUnit(input.seed, `side:${i}`) > 0.72;
      const order = input.style.chromaticApproach
        ? (above ? [1, 2, -1, -2] : [-1, -2, 1, 2])
        : (above ? [2, 1, -2, -1] : [-2, -1, 2, 1]);
      const admissible = order
        .map((offset) => target + offset)
        .filter((p) => p >= lo && p <= hi && Math.abs(p - prevPitch) <= input.maxLeap && Math.abs(p - target) <= input.maxLeap);
      // A passing or leading tone, not a tone of the chord being left; diatonic when the style is.
      const choice = approachToneChoice({ admissible, target, avoidPcs: previousChordPcs, style: input.style, centre: tonalCentreOf([...(input.warmup ?? []), ...events].map((e) => ({ ...e.chord, start: e.start, end: e.end }))) }); // B-18 (R-1b P1-6): the mode's own approach set, not the union of every chord's pitch classes
      if (choice !== null && lastBeat > s + 1e-6 && e - lastBeat >= (input.minNoteDuration ?? 0.08) + gap) {
        // The note before the approach must itself be long enough to play.
        const kept = planned.filter((n) => n.start <= lastBeat - ((input.minNoteDuration ?? 0.08) + gap));
        kept.push({ start: lastBeat, pitch: choice, kind: "approach" });
        planned.length = 0;
        planned.push(...kept);
        approaches += 1;
      }
    }

    // Durations: to the next onset or the chord's end, never lapping the next chord.
    planned.forEach((n, k) => {
      const until = k + 1 < planned.length ? planned[k + 1].start : e;
      const held = pattern === "whole" || pattern === "per_bar" || isPedal;
      const duration = Math.max(0.02, (until - n.start) * (held ? 0.95 : 0.85) - gap);
      const downbeat = Math.abs(((n.start - origin) / barSeconds) - Math.round((n.start - origin) / barSeconds)) < 1e-3;
      notes.push({
        start: n.start, duration: Math.min(duration, until - n.start - gap), pitch: n.pitch, kind: n.kind, eventIndex: i,
        velocityOffset: n.kind === "approach" ? -2 : downbeat ? 8 : k === 0 ? 6 : -4,
      });
    });
    previousPitch = planned.length ? planned[planned.length - 1].pitch : previousPitch;
  }
  if (pedalCount) notes_.push(`pedal held under ${pedalCount} chord(s) (${input.arc.tensionRole})`);
  return { skeleton, notes, pattern, approaches, pedalEvents: pedalCount, notes_ };
}

/** Plan and realise in one call. */
export function planBassLine(input: BassPlanInput): BassPlan {
  const guide = input.topGuide ?? topVoiceGuide(input.events);
  const skeleton = planBassSkeleton({ ...input, topGuide: guide });
  return realiseBassLine(skeleton, input);
}
