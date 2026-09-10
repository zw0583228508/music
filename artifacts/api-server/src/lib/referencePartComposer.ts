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
import { barTiming, type ComposeFrame, type PartWriter } from "./composer/frame";
import { registerBounds } from "./composer/registers";
import {
  writeBassLine, writeBrassAccents, writeKeysVoicing, writeStringBed,
  type HarmonyFrame, type SiblingPart,
} from "./composer/harmonyParts";
import { writeCounterMelody } from "./composer/melodyParts";
import { writeDrumKit, writeOstinato, writePercussion } from "./composer/rhythmParts";
import { writeIntroOrEnding, writeTransitionFigure } from "./composer/transitions";

export const REFERENCE_PART_COMPOSER = "REFERENCE_PART_COMPOSER_V1" as const;

export type ComposeContext = {
  tempoBpm: number;
  meter?: string;
  /** Absolute seconds of bar 1's downbeat. */
  originSeconds?: number;
  /**
   * Brain B-02: parts already composed for this candidate, with their notes.
   * The harmony writers voice above the bass part's actual notes and away from
   * sibling voicings when these are present; without them the bass is
   * re-planned deterministically from the same inputs (same skeleton).
   */
  siblings?: SiblingPart[];
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

/**
 * Tasks whose writers place their figure at a section boundary (B-04) or in
 * the singer's gaps (B-10) rather than across the part's bars. They keep the
 * section bounds until their writers read `partWindow`; listed so the
 * exemption is visible, not implicit.
 */
export const WINDOW_EXEMPT_TASKS: ReadonlySet<PartGenerationRequest["task"]> =
  new Set(["COUNTER_MELODY", "CALL_RESPONSE", "FILL", "TRANSITION", "INTRO", "ENDING"]);

// ---------------------------------------------------------------------------

export function composeReferencePart(
  request: PartGenerationRequest,
  context: ComposeContext,
): MusicalNote[] {
  // B-04: a bar is numerator × one denominator unit (7/8 at 104 BPM is 2.02 s, not 4.04 s).
  const timing = barTiming(context.tempoBpm, context.meter);
  const { beats, beatSeconds, barSeconds } = timing;
  const origin = context.originSeconds ?? 0;
  const startSeconds = origin + (request.section.startBar - 1) * barSeconds;
  const endSeconds = origin + request.section.endBar * barSeconds;
  // B-02: the part's own window inside the section (a family may enter late or leave early).
  const partWindow = request.partWindow ?? { startBar: request.section.startBar, endBar: request.section.endBar };
  const windowStart = Math.max(startSeconds, origin + (partWindow.startBar - 1) * barSeconds);
  const windowEnd = Math.max(windowStart, Math.min(endSeconds, origin + partWindow.endBar * barSeconds));
  const { lo, hi } = registerBounds(request);
  const chords = (request.context.currentBars.chords ?? [])
    .filter((c) => c.end > startSeconds && c.start < endSeconds)
    .sort((a, b) => a.start - b.start);
  const notes: MusicalNote[] = [];
  const seed = request.seed;
  const id = (suffix: string) => `${request.taskId}-${suffix}`;
  const minDur = request.constraints.minNoteDuration;

  // Boundary figures and the singer's answers are anchored by their own writers
  // (B-04 / B-10) to the section's bars; until those writers read the window
  // they keep the section bounds, and the arc's window applies to every
  // sustained or rhythmic part.
  const windowed = !WINDOW_EXEMPT_TASKS.has(request.task);
  const clipEnd = windowed ? windowEnd : endSeconds;
  const push = (start: number, duration: number, pitch: number, velocity: number, suffix: string, motif?: MusicalNote["motif"]) => {
    if (start < startSeconds - 1e-6 || start >= endSeconds - 1e-6) return;
    if (windowed && (start < windowStart - 1e-6 || start >= windowEnd - 1e-6)) return;
    notes.push({
      id: id(suffix),
      start: Number(start.toFixed(4)),
      duration: Number(Math.max(minDur, Math.min(duration, clipEnd - start)).toFixed(4)),
      pitch: Math.max(0, Math.min(127, Math.round(pitch))),
      velocity: Math.max(1, Math.min(127, Math.round(velocity))),
      ...(motif ? { motif } : {}),
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

  const frame: HarmonyFrame = {
    request, ...timing, origin, startSeconds, endSeconds,
    lo, hi, chords, seed, density, energy, baseVelocity, push,
    window: { start: windowStart, end: windowEnd },
    siblings: context.siblings,
  };
  WRITERS[request.task]?.(frame);

  notes.sort((a, b) => a.start - b.start || a.pitch - b.pitch);
  return notes;
}
