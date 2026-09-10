/**
 * Melodic parts of the reference composer (Brain B-10).
 *
 * `writeCounterMelody` moved verbatim from `composer/harmonyParts.ts` (B-00
 * split) so the melody stream owns it; the golden test pins that this
 * relocation changed nothing.
 */
import type { ComposeFrame } from "./frame";
import { chordPitchClasses } from "./harmonyParts";
import { voiceNear } from "./registers";

/** COUNTER_MELODY / CALL_RESPONSE: a four-note answer figure where the singer leaves room. */
export function writeCounterMelody(frame: ComposeFrame): void {
  const { request, chords, lo, hi, origin, barSeconds, beatSeconds, endSeconds, baseVelocity, push } = frame;
  // Answer only where the singer leaves room.
  const gaps = request.budgetWindows.filter((w) => w.vocalAttention < 0.3);
  const windows = gaps.length
    ? gaps
    : [{ startBar: request.section.endBar, endBar: request.section.endBar, budgets: { melodic: 0.4 } }];
  for (const [index, window] of windows.entries()) {
    const gapStart = origin + (window.startBar - 1) * barSeconds;
    const gapEnd = origin + window.endBar * barSeconds;
    const chord = chords.find((c) => c.end > gapStart && c.start < gapEnd) ?? chords[0];
    if (!chord) continue;
    const tones = chordPitchClasses(chord);
    const figure = [0, 1, 2, 1];
    const span = Math.min(gapEnd, endSeconds) - gapStart;
    if (span <= 0) continue;
    const stepCount = Math.min(figure.length, Math.max(2, Math.round(span / (beatSeconds * 0.75))));
    for (let s = 0; s < stepCount; s += 1) {
      const pc = tones[figure[s % figure.length] % tones.length];
      push(gapStart + s * beatSeconds * 0.75, beatSeconds * 0.6,
        voiceNear(pc, hi - 8, lo, hi), baseVelocity - 4, `cm${index}-${s}`);
    }
  }
}
