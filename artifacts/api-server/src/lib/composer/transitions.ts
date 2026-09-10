/**
 * Boundary figures of the reference composer (Brain B-00 split; B-04 owns the
 * transition realisation that will replace these).
 *
 * Moved verbatim from `referencePartComposer.ts`: the three-note pickup that
 * serves both FILL and TRANSITION tasks (one shared body in the original
 * switch), and the INTRO / ENDING chord. The C-major fallback when no chord is
 * under the figure is here, unchanged, pinned by the golden test.
 */
import type { ComposeFrame } from "./frame";
import { chordPitchClasses } from "./harmonyParts";
import { voiceNear } from "./registers";

/** FILL / TRANSITION: three 16th-note chord tones into the last beat of the section's final bar. */
export function writeTransitionFigure(frame: ComposeFrame): void {
  const { request, chords, lo, hi, beats, beatSeconds, barSeconds, origin, baseVelocity, push } = frame;
  const barStart = origin + (request.section.endBar - 1) * barSeconds;
  const chord = chords.at(-1);
  const pcs = chord ? chordPitchClasses(chord) : [0, 4, 7];
  for (let s = 0; s < 3; s += 1) {
    push(barStart + (beats - 1) * beatSeconds + s * beatSeconds * 0.25, 0.18,
      voiceNear(pcs[s % pcs.length], (lo + hi) / 2, lo, hi), baseVelocity + s * 5, `t${s}`);
  }
}

/** INTRO / ENDING: one spread triad — on the first chord at the section start, or the last chord in the final bar. */
export function writeIntroOrEnding(frame: ComposeFrame): void {
  const { request, chords, lo, hi, barSeconds, origin, startSeconds, baseVelocity, push } = frame;
  const chord = request.task === "INTRO" ? chords[0] : chords.at(-1);
  if (chord) {
    const tones = chordPitchClasses(chord).slice(0, 3);
    const at = request.task === "INTRO"
      ? startSeconds
      : origin + (request.section.endBar - 1) * barSeconds;
    tones.forEach((pc, i) =>
      push(at, barSeconds * 0.9, voiceNear(pc, (lo + hi) / 2 + i * 4, lo, hi),
        baseVelocity + (request.task === "ENDING" ? 12 : -8), `${request.task}-${i}`));
  }
}
