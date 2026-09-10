/**
 * Register arithmetic for the reference composer (Brain B-00 split; B-03 owns
 * the musical rules that will replace these).
 *
 * Moved verbatim from `referencePartComposer.ts`: which octave a pitch class
 * lands in, and which band of an instrument's range a part is steered into.
 */
import type { PartGenerationRequest } from "../partComposer";

/** Nearest pitch of `pitchClass` to `target`, clamped into [lo, hi]. */
export function voiceNear(pitchClass: number, target: number, lo: number, hi: number): number {
  let pitch = pitchClass + 12 * Math.round((target - pitchClass) / 12);
  while (pitch < lo) pitch += 12;
  while (pitch > hi) pitch -= 12;
  return Math.max(lo, Math.min(hi, pitch));
}

export function registerBounds(request: PartGenerationRequest): { lo: number; hi: number } {
  const playable = request.constraints.playableRange;
  const comfortable = request.constraints.comfortableRange;
  const lo = Math.max(playable.min, comfortable.min);
  const hi = Math.min(playable.max, comfortable.max);
  const bandShift: Record<string, number> = {
    low: -12, low_mid: -6, mid: 0, upper_mid: 6, high: 12,
  };
  const shift = bandShift[registerOf(request)] ?? 0;
  return {
    lo: Math.max(playable.min, lo + Math.min(0, shift)),
    hi: Math.min(playable.max, hi + Math.max(0, shift)),
  };
}

export function registerOf(request: PartGenerationRequest): string {
  const assignment = request.section.registerDistribution;
  const entries = Object.entries(assignment ?? {});
  if (!entries.length) return "mid";
  return entries.sort((a, b) => (b[1] ?? 0) - (a[1] ?? 0))[0][0];
}
