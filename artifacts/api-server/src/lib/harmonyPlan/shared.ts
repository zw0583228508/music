/**
 * Shared arithmetic of the harmony planners (Brain B-02): chord events read
 * through the one parser and clipped to a time window, and the pitch helpers
 * that keep every choice inside a range and a leap limit *by construction*.
 */
import type { ChordHarmonyEvent } from "@workspace/db";
import { chordFromEvent, type ParsedChord } from "../chordSymbols";

export const pc = (v: number): number => ((v % 12) + 12) % 12;

export type HarmonyChordEvent = {
  /** Index in the source list, so a plan can be joined back to the Song Model's chords. */
  sourceIndex: number;
  start: number;
  end: number;
  symbol: string;
  chord: ParsedChord;
  /** B-13: the analysed onset before quantisation, when the grid moved it (evidence, never a note position). */
  rawStart?: number;
  rawEnd?: number;
};

/**
 * The bar grid the harmony is written on (Brain B-13, R-1b P0-2).
 *
 * The kit is written on the bar grid and the harmony writers subdivided the
 * *analysed* chord span, so on the owner's song the piano, strings and bass
 * played 100-230 ms after the kick (median 136 ms; 79 of 92 chord events more
 * than 50 ms off the beat) while the kit was on it.
 *
 * A chord change belongs on a beat unless it is deliberately pushed, so the
 * snap tries the beat first and only then the subdivision (an 8th): an onset
 * within `toleranceSeconds` of a beat is a late or early reading of that beat;
 * one further out but within the tolerance of an 8th is a push, and keeps its
 * eighth; anything beyond both is telling us something the grid is not, and
 * keeps its analysed time. The analysed onset survives as `rawStart` /
 * `rawEnd` - evidence, never a note position.
 *
 * The tolerance is a fraction of the beat rather than a fixed millisecond
 * count: at 130 BPM the owner's 136 ms readings are a third of a beat late,
 * and at 68 BPM the same 136 ms would be a sixth of one.
 */
export type ChordGrid = {
  origin: number;
  /** Seconds per beat: the first grid a chord change is tried against. */
  beat: number;
  /** Seconds per subdivision (an 8th of the bar's beat); the second grid. */
  subdivision?: number;
  /** How far an onset may be from a grid point and still be read as that point (default 0.35 x beat). */
  toleranceSeconds?: number;
};

export const CHORD_GRID_BEAT_FRACTION = 0.35;

const snap = (t: number, grid: ChordGrid): number => {
  if (!(grid.beat > 0)) return t;
  const tolerance = grid.toleranceSeconds ?? grid.beat * CHORD_GRID_BEAT_FRACTION;
  for (const step of [grid.beat, grid.subdivision ?? grid.beat / 2]) {
    if (!(step > 0)) continue;
    const snapped = grid.origin + Math.round((t - grid.origin) / step) * step;
    if (Math.abs(snapped - t) <= tolerance) return Number(snapped.toFixed(4));
  }
  return t;
};

/**
 * The same snap applied to raw chord events, keeping their shape (B-13). Used
 * where a measurement has to ask "does this note lap the next chord?" of the
 * grid the writers actually wrote on, not of the analysed onsets they read.
 */
export function quantiseChordsToGrid<T extends { start: number; end: number }>(chords: ReadonlyArray<T>, grid: ChordGrid): T[] {
  return chords.map((chord) => {
    const start = snap(chord.start, grid);
    const end = snap(chord.end, grid);
    return end - start > 1e-6 ? { ...chord, start, end } : { ...chord };
  });
}

export function chordEventsIn(
  chords: ReadonlyArray<ChordHarmonyEvent>,
  window: { start: number; end: number },
  options: { minEventSeconds?: number; grid?: ChordGrid } = {},
): HarmonyChordEvent[] {
  const out: HarmonyChordEvent[] = [];
  chords.forEach((event, sourceIndex) => {
    const rawStart = Math.max(event.start, window.start);
    const rawEnd = Math.min(event.end, window.end);
    if (rawEnd - rawStart <= 1e-6) return;
    const chord = chordFromEvent(event);
    if (!chord) return;
    // The grid moves the onset the writers place notes from; the window still
    // bounds it, and an event the snap would empty keeps its analysed time.
    const grid = options.grid;
    let start = rawStart;
    let end = rawEnd;
    if (grid) {
      const snappedStart = Math.max(window.start, snap(rawStart, grid));
      const snappedEnd = Math.min(window.end, snap(rawEnd, grid));
      if (snappedEnd - snappedStart > 1e-6) {
        start = snappedStart;
        end = snappedEnd;
      }
    }
    out.push({
      sourceIndex, start, end, symbol: event.symbol, chord,
      ...(start !== rawStart ? { rawStart } : {}),
      ...(end !== rawEnd ? { rawEnd } : {}),
    });
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
