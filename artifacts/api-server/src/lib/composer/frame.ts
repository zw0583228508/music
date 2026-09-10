/**
 * The frame every reference-composer part writes into (Brain B-00 split;
 * Brain B-04 gives it a meter).
 *
 * `composeReferencePart` computes the section's time window, register bounds,
 * density and base velocity once, then hands this frame to the family module
 * that owns the task. Nothing here decides music; it is the shared arithmetic
 * that used to live at the top of one 325-line switch.
 *
 * B-04: the bar is `numerator × one denominator unit`, not `numerator ×
 * quarter`. Before this a 7/8 bar at 104 BPM was 4.04 s instead of 2.02 s, so
 * every part was written over twice the song's length and the bass and keys of
 * later sections fell outside their windows (B-00's known failure). The same
 * module owns the metrical accent table for every meter the composer and the
 * performance engine share.
 */
import type { ChordHarmonyEvent, GrooveMeterFeel, MusicalNote } from "@workspace/db";
import type { PartGenerationRequest } from "../partComposer";

/** A meter read from "N/D": how many denominator units a bar has, and how they group. */
export type MeterSpec = {
  numerator: number;
  denominator: number;
  feel: GrooveMeterFeel;
  /** Beat groups in units; the sum is the numerator. */
  grouping: number[];
  /** Unit index of every group start. */
  pulses: number[];
  /** Why this grouping (the additive meters have more than one reading). */
  groupingReason: string;
};

export type BarTiming = {
  /** Quarter-note BPM, as the Song Model states it. */
  tempoBpm: number;
  meter: MeterSpec;
  /** Denominator units per bar (= numerator). Kept under the historical name the writers use. */
  beats: number;
  /** Seconds of one denominator unit. */
  beatSeconds: number;
  barSeconds: number;
};

export type ComposeFrame = BarTiming & {
  request: PartGenerationRequest;
  /** Absolute seconds of bar 1's downbeat. */
  origin: number;
  startSeconds: number;
  endSeconds: number;
  /** Register bounds for this part (playable ∩ comfortable, shifted by the section's register band). */
  lo: number;
  hi: number;
  /** Chords of the current bars that overlap the section window, in start order. */
  chords: ChordHarmonyEvent[];
  seed: number;
  density: number;
  energy: number;
  baseVelocity: number;
  /**
   * Append a note, clamped to the section window, the minimum duration and MIDI
   * ranges. Brain B-10: an optional motif provenance rides on the note
   * (`MusicalNote.motif`) so a melodic part can say which cell it states.
   */
  push: (start: number, duration: number, pitch: number, velocity: number, suffix: string, motif?: MusicalNote["motif"]) => void;
};

export type PartWriter = (frame: ComposeFrame) => void;

/** Deterministic hash → [0, 1) for a seed and a key; the composer's only randomness. */
export function seeded(seed: number, key: string): number {
  let h = seed >>> 0;
  for (let i = 0; i < key.length; i += 1) {
    h ^= key.charCodeAt(i);
    h = Math.imul(h, 16_777_619) >>> 0;
  }
  return (h % 10_000) / 10_000;
}

// ---------------------------------------------------------------------------
// Meter
// ---------------------------------------------------------------------------

/**
 * Read a meter string into units and groups. Compound meters (6/8, 9/8, 12/8)
 * group in threes; the additive ones (5/x, 7/x, 8/8 as 3+3+2, 11/8) take the
 * grouping a `hint` names or the most common one; 4/4 and 3/4 are one unit per
 * beat. An unreadable string is 4/4 with the reason recorded.
 */
export function meterOf(meter: string | undefined, hint?: "2+3" | "3+2" | "2+2+3" | "3+2+2" | "2+3+2"): MeterSpec {
  const m = /^(\d+)\s*\/\s*(\d+)$/.exec((meter ?? "").trim());
  const numerator = m ? Math.max(1, Number(m[1])) : 4;
  const denominator = m ? Math.max(1, Number(m[2])) : 4;
  const unreadable = !m;
  const build = (grouping: number[], feel: GrooveMeterFeel, reason: string): MeterSpec => {
    const pulses: number[] = [];
    let at = 0;
    for (const g of grouping) { pulses.push(at); at += g; }
    return { numerator, denominator, feel, grouping, pulses, groupingReason: unreadable ? `meter "${meter}" unreadable, 4/4 assumed; ${reason}` : reason };
  };
  if (denominator >= 8 && numerator % 3 === 0 && numerator >= 6) {
    return build(Array.from({ length: numerator / 3 }, () => 3), "compound", `${numerator}/${denominator} is compound: dotted pulses in threes`);
  }
  if (numerator === 5) {
    return hint === "2+3"
      ? build([2, 3], "additive", "5 as 2+3 (hint)")
      : build([3, 2], "additive", "5 as 3+2: the long group first, the convention of most 5/4 and 5/8 grooves");
  }
  if (numerator === 7) {
    return hint === "3+2+2"
      ? build([3, 2, 2], "additive", "7 as 3+2+2 (hint): the kalamatianos reading")
      : hint === "2+3+2"
        ? build([2, 3, 2], "additive", "7 as 2+3+2 (hint)")
        : build([2, 2, 3], "additive", "7 as 2+2+3: the short groups first, the long group closes the bar (the most common reading)");
  }
  if (numerator === 8 && denominator >= 8) return build([3, 3, 2], "additive", "8/8 as 3+3+2 (tresillo)");
  if (numerator === 11 && denominator >= 8) return build([2, 2, 3, 2, 2], "additive", "11 as 2+2+3+2+2");
  if (numerator === 10 && denominator >= 8) return build([3, 2, 3, 2], "additive", "10 as 3+2+3+2");
  if (denominator >= 8 && numerator >= 5) {
    // Any other x/8: threes at the end, twos before.
    const grouping: number[] = [];
    let rest = numerator;
    while (rest > 3) { grouping.push(2); rest -= 2; }
    grouping.push(rest);
    return build(grouping, "additive", `${numerator}/${denominator} read as ${grouping.join("+")}`);
  }
  return build(Array.from({ length: numerator }, () => 1), "simple", `${numerator}/${denominator}: one unit per beat`);
}

/** The bar arithmetic every part shares: one denominator unit = (60 / BPM) × (4 / denominator). */
export function barTiming(tempoBpm: number, meter: string | undefined, hint?: Parameters<typeof meterOf>[1]): BarTiming {
  const spec = meterOf(meter, hint);
  const beatSeconds = (60 / Math.max(1, tempoBpm)) * (4 / spec.denominator);
  return { tempoBpm, meter: spec, beats: spec.numerator, beatSeconds, barSeconds: beatSeconds * spec.numerator };
}

// ---------------------------------------------------------------------------
// Metrical accent table (shared with the performance engine)
// ---------------------------------------------------------------------------

/**
 * Accent weight of every unit of a bar, 0..1. Simple 4/4 keeps the values the
 * performance engine has always used (1 / 0.68 / 0.82 / 0.68); 3/4 has no
 * secondary accent; compound meters accent every dotted pulse (the second one
 * a little less); additive meters accent every group start, the group that
 * carries the backbeat most, and the long (3-unit) group's start a touch more
 * than a short one's. Off-unit positions are handled by `accentWeight`.
 */
export function unitAccents(spec: MeterSpec): number[] {
  const weights = new Array<number>(spec.numerator).fill(0.4);
  const { grouping, pulses, feel, numerator } = spec;
  if (feel === "simple") {
    for (let u = 0; u < numerator; u += 1) weights[u] = u === 0 ? 1 : 0.68;
    if (numerator === 4) weights[2] = 0.82;
    if (numerator === 2) weights[1] = 0.72;
    if (numerator === 3) { weights[1] = 0.62; weights[2] = 0.66; }
    if (numerator === 6 && spec.denominator <= 4) { weights[3] = 0.82; }
    return weights;
  }
  if (feel === "compound") {
    pulses.forEach((p, i) => { weights[p] = i === 0 ? 1 : i % 2 === 1 ? 0.82 : 0.78; });
    for (let u = 0; u < numerator; u += 1) if (!pulses.includes(u)) weights[u] = 0.4;
    return weights;
  }
  // additive
  const backbeat = backbeatPulse(spec);
  pulses.forEach((p, i) => {
    const long = grouping[i] === 3;
    weights[p] = i === 0 ? 1 : p === backbeat ? 0.82 : long ? 0.78 : 0.74;
  });
  for (let u = 0; u < numerator; u += 1) if (!pulses.includes(u)) weights[u] = 0.42;
  return weights;
}

/** The group start that carries the backbeat: the pulse closest to the bar's midpoint (later on a tie). */
export function backbeatPulse(spec: MeterSpec): number {
  if (spec.feel === "simple") {
    if (spec.numerator === 4) return 1;
    if (spec.numerator === 3) return 1;
    if (spec.numerator === 2) return 1;
    return Math.floor(spec.numerator / 2);
  }
  if (spec.feel === "compound") return spec.pulses[1] ?? 0;
  const mid = spec.numerator / 2;
  let best = spec.pulses[1] ?? 0;
  let bestDistance = Infinity;
  for (const p of spec.pulses.slice(1)) {
    const d = Math.abs(p - mid);
    if (d < bestDistance || (d === bestDistance && p > best)) { best = p; bestDistance = d; }
  }
  return best;
}

/**
 * Accent weight of any position in the bar (units from the downbeat, fractional
 * allowed). On a unit: the table above; on the half of a unit: 0.46 (an
 * off-beat 8th in simple meters); elsewhere (16ths, triplet points): 0.34.
 */
export function accentWeight(spec: MeterSpec, positionUnits: number): number {
  const table = unitAccents(spec);
  const wrapped = ((positionUnits % spec.numerator) + spec.numerator) % spec.numerator;
  const unit = Math.round(wrapped);
  const fraction = wrapped - Math.floor(wrapped);
  const onUnit = fraction < 0.06 || fraction > 0.94;
  if (onUnit) return table[unit % spec.numerator] ?? 0.68;
  if (Math.abs(fraction - 0.5) < 0.06) return spec.denominator >= 8 ? 0.34 : 0.46;
  return 0.34;
}

export type { MusicalNote };
