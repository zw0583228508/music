/**
 * Reference part composer (PR-16 support).
 *
 * A deterministic, idiomatic note generator that turns a `PartGenerationRequest`
 * (PR-09) into actual notes. It is the local stand-in for a model provider: it
 * reads the same contract — chords, section plan, instrument role, orchestration
 * budgets, transitions and physical constraints — and writes parts that respect
 * them, so the whole chain is runnable and testable with no workers online.
 *
 * It is deliberately conservative and idiomatic rather than inventive; a real
 * provider is expected to beat it (that is the PR-18 benchmark's job).
 *
 * Brain B-00 split: this file computes the shared frame (window, register,
 * density, velocity) and dispatches each task to the module that owns its
 * family — `composer/harmonyParts.ts` (B-02), `composer/rhythmParts.ts` and
 * `composer/transitions.ts` (B-04), `composer/registers.ts` (B-03). The split
 * is mechanical and pinned byte-identical by `referencePartComposer.golden.test.ts`.
 */
import type { MusicalNote } from "@workspace/db";
import type { PartGenerationRequest } from "./partComposer";
import type { ComposeFrame, PartWriter } from "./composer/frame";
import { registerBounds } from "./composer/registers";
import {
  writeBassLine, writeBrassAccents, writeCounterMelody, writeKeysVoicing, writeStringBed,
} from "./composer/harmonyParts";
import { writeDrumKit, writeOstinato, writePercussion } from "./composer/rhythmParts";
import { writeIntroOrEnding, writeTransitionFigure } from "./composer/transitions";

export const REFERENCE_PART_COMPOSER = "REFERENCE_PART_COMPOSER_V1" as const;

export type ComposeContext = {
  tempoBpm: number;
  meter?: string;
  /** Absolute seconds of bar 1's downbeat. */
  originSeconds?: number;
};

/** Which module writes which task. A task without a writer produces no notes (as the original switch did). */
const WRITERS: Partial<Record<PartGenerationRequest["task"], PartWriter>> = {
  DRUMS: writeDrumKit,
  BASS: writeBassLine,
  PIANO: writeKeysVoicing,
  KEYS: writeKeysVoicing,
  ACOUSTIC_GUITAR: writeKeysVoicing,
  ELECTRIC_GUITAR: writeKeysVoicing,
  STRINGS: writeStringBed,
  PAD: writeStringBed,
  BRASS: writeBrassAccents,
  WOODWINDS: writeBrassAccents,
  OSTINATO: writeOstinato,
  COUNTER_MELODY: writeCounterMelody,
  CALL_RESPONSE: writeCounterMelody,
  FILL: writeTransitionFigure,
  TRANSITION: writeTransitionFigure,
  INTRO: writeIntroOrEnding,
  ENDING: writeIntroOrEnding,
  PERCUSSION: writePercussion,
};

// ---------------------------------------------------------------------------

export function composeReferencePart(
  request: PartGenerationRequest,
  context: ComposeContext,
): MusicalNote[] {
  const beats = Number((context.meter ?? "4/4").split("/")[0]) || 4;
  const beatSeconds = 60 / Math.max(1, context.tempoBpm);
  const barSeconds = beatSeconds * beats;
  const origin = context.originSeconds ?? 0;
  const startSeconds = origin + (request.section.startBar - 1) * barSeconds;
  const endSeconds = origin + request.section.endBar * barSeconds;
  const { lo, hi } = registerBounds(request);
  const chords = (request.context.currentBars.chords ?? [])
    .filter((c) => c.end > startSeconds && c.start < endSeconds)
    .sort((a, b) => a.start - b.start);
  const notes: MusicalNote[] = [];
  const seed = request.seed;
  const id = (suffix: string) => `${request.taskId}-${suffix}`;
  const minDur = request.constraints.minNoteDuration;

  const push = (start: number, duration: number, pitch: number, velocity: number, suffix: string) => {
    if (start < startSeconds - 1e-6 || start >= endSeconds - 1e-6) return;
    notes.push({
      id: id(suffix),
      start: Number(start.toFixed(4)),
      duration: Number(Math.max(minDur, Math.min(duration, endSeconds - start)).toFixed(4)),
      pitch: Math.max(0, Math.min(127, Math.round(pitch))),
      velocity: Math.max(1, Math.min(127, Math.round(velocity))),
    });
  };

  // Density from the section plan and the orchestration budget for this window.
  const budget = request.budgetWindows[0];
  const density = Math.max(
    0.15,
    Math.min(1, request.section.density * (budget ? budget.budgets.totalDensity : 1)),
  );
  const energy = request.section.energy;
  const baseVelocity = 52 + energy * 55;

  const frame: ComposeFrame = {
    request, beats, beatSeconds, barSeconds, origin, startSeconds, endSeconds,
    lo, hi, chords, seed, density, energy, baseVelocity, push,
  };
  WRITERS[request.task]?.(frame);

  notes.sort((a, b) => a.start - b.start || a.pitch - b.pitch);
  return notes;
}
