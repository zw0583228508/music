/**
 * Shared arithmetic of the harmony planners (Brain B-02): chord events read
 * through the one parser and clipped to a time window, and the pitch helpers
 * that keep every choice inside a range and a leap limit *by construction*.
 */
import type { ChordHarmonyEvent } from "@workspace/db";
import { chordFromEvent, type ParsedChord } from "../chordSymbols";

export type HarmonyChordEvent = {
  /** Index in the source list, so a plan can be joined back to the Song Model's chords. */
  sourceIndex: number;
  start: number;
  end: number;
  symbol: string;
  chord: ParsedChord;
};

export const pc = (v: number): number => ((v % 12) + 12) % 12;

/**
 * The chord events overlapping `[start, end)`, clipped to it, parsed, in
 * start order. Unreadable symbols are dropped (and counted by the caller when
 * it cares); a zero-length event is dropped too.
 *
 * `minEventSeconds`: an event shorter than a part can articulate (an analysis
 * blip of 0.2 s between two real chords) is absorbed by its predecessor - the
 * held voicing continues through it - rather than written as a note the
 * instrument's minimum duration would stretch over the next chord.
 */
export function chordEventsIn(
  chords: ReadonlyArray<ChordHarmonyEvent>,
  window: { start: number; end: number },
  options: { minEventSeconds?: number } = {},
): HarmonyChordEvent[] {
  const out: HarmonyChordEvent[] = [];
  chords.forEach((event, sourceIndex) => {
    const start = Math.max(event.start, window.start);
    const end = Math.min(event.end, window.end);
    if (end - start <= 1e-6) return;
    const chord = chordFromEvent(event);
    if (!chord) return;
    out.push({ sourceIndex, start, end, symbol: event.symbol, chord });
  });
  out.sort((a, b) => a.start - b.start || a.sourceIndex - b.sourceIndex);
  const minEvent = options.minEventSeconds ?? 0;
  if (minEvent <= 0) return out;
  // Analysis timings jitter by a few milliseconds; "contiguous" allows for that.
  const CONTIGUOUS = 0.05;
  const merged: HarmonyChordEvent[] = [];
  let leading: HarmonyChordEvent | null = null;
  for (const event of out) {
    if (event.end - event.start >= minEvent) {
      const copy = { ...event };
      // A leading micro-event is absorbed by what follows.
      if (leading && copy.start - leading.end < CONTIGUOUS) copy.start = leading.start;
      leading = null;
      merged.push(copy);
      continue;
    }
    const previous = merged[merged.length - 1];
    if (previous && event.start - previous.end < CONTIGUOUS) {
      previous.end = Math.max(previous.end, event.end);
      continue;
    }
    // Nothing to absorb it yet: remembered for the next event, else dropped, never written.
    leading = merged.length ? null : event;
  }
  return merged;
}

/** Every pitch of `pitchClass` inside `[lo, hi]`, ascending. */
export function pitchesOf(pitchClass: number, lo: number, hi: number): number[] {
  const found: number[] = [];
  let pitch = pitchClass + 12 * Math.ceil((lo - pitchClass) / 12);
  for (; pitch <= hi; pitch += 12) found.push(pitch);
  return found;
}

/** The pitch of `pitchClass` nearest `target` within `[lo, hi]`, or null when none exists. */
export function nearestPitch(pitchClass: number, target: number, lo: number, hi: number): number | null {
  let best: number | null = null;
  for (const pitch of pitchesOf(pitchClass, lo, hi)) {
    if (best === null || Math.abs(pitch - target) < Math.abs(best - target)) best = pitch;
  }
  return best;
}

/**
 * The pitch of `pitchClass` nearest `target` that lies within `maxLeap` of
 * every anchor and inside `[lo, hi]`; null when no such pitch exists. This is
 * how a line stays inside its leap limit without a fold afterwards.
 */
export function nearestPitchWithin(
  pitchClass: number,
  target: number,
  anchors: ReadonlyArray<number>,
  maxLeap: number,
  lo: number,
  hi: number,
): number | null {
  let best: number | null = null;
  for (const pitch of pitchesOf(pitchClass, lo, hi)) {
    if (anchors.some((anchor) => Math.abs(pitch - anchor) > maxLeap)) continue;
    if (best === null || Math.abs(pitch - target) < Math.abs(best - target)) best = pitch;
  }
  return best;
}

/** Deterministic hash to [0, 1) for a seed and a key (the planners' only randomness). */
export function seededUnit(seed: number, key: string): number {
  let h = seed >>> 0;
  for (let i = 0; i < key.length; i += 1) {
    h ^= key.charCodeAt(i);
    h = Math.imul(h, 16_777_619) >>> 0;
  }
  return (h % 10_000) / 10_000;
}

/** The pitch classes any chord of the window uses: the section's working scale for diatonic approaches. */
export function scaleOf(events: ReadonlyArray<HarmonyChordEvent>): Set<number> {
  const set = new Set<number>();
  for (const event of events) for (const klass of event.chord.pitchClasses) set.add(klass);
  return set;
}

export const mean = (xs: ReadonlyArray<number>): number => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : 0);
