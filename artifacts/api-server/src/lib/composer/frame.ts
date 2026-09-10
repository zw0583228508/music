/**
 * The frame every reference-composer part writes into (Brain B-00 split).
 *
 * `composeReferencePart` computes the section's time window, register bounds,
 * density and base velocity once, then hands this frame to the family module
 * that owns the task. Nothing here decides music; it is the shared arithmetic
 * that used to live at the top of one 325-line switch.
 */
import type { ChordHarmonyEvent, MusicalNote } from "@workspace/db";
import type { PartGenerationRequest } from "../partComposer";

export type ComposeFrame = {
  request: PartGenerationRequest;
  /** Beats per bar as the composer reads the meter (numerator only — a documented limit). */
  beats: number;
  beatSeconds: number;
  barSeconds: number;
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
  /** Append a note, clamped to the section window, the minimum duration and MIDI ranges. */
  push: (start: number, duration: number, pitch: number, velocity: number, suffix: string) => void;
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

export type { MusicalNote };
