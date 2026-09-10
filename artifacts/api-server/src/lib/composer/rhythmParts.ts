/**
 * Rhythm parts of the reference composer (Brain B-00 split; B-04 owns the
 * groove rules that will replace these).
 *
 * Moved verbatim from `referencePartComposer.ts`: the drum kit pattern (kick on
 * 1 and 3, backbeat on 2 and 4, hats in 8ths/16ths, one fill figure), the
 * off-beat percussion hit and the ostinato. The 4/4 assumptions the audit
 * names (numerator-only meter, fixed backbeat grid) are here, unchanged,
 * pinned by the golden test.
 */
import type { ComposeFrame } from "./frame";
import { seeded } from "./frame";
import { chordPitchClasses } from "./harmonyParts";
import { voiceNear } from "./registers";

/** DRUMS: kick / backbeat / hats per bar, a syncopated push when the groove asks, a fill before a transition. */
export function writeDrumKit(frame: ComposeFrame): void {
  const { request, beats, beatSeconds, barSeconds, origin, seed, density, baseVelocity, push } = frame;
  const swing = request.globalPlan.grooveStrategy === "swing";
  for (let bar = request.section.startBar; bar <= request.section.endBar; bar += 1) {
    const barStart = origin + (bar - 1) * barSeconds;
    for (let beat = 0; beat < beats; beat += 1) {
      const t = barStart + beat * beatSeconds;
      // Kick on 1 and 3 (plus a syncopated push when the groove asks).
      if (beat === 0 || beat === 2) push(t, 0.18, 36, baseVelocity + 12, `k${bar}-${beat}`);
      else if (request.globalPlan.grooveStrategy === "syncopated" && seeded(seed, `k${bar}${beat}`) > 0.6) {
        push(t + beatSeconds * 0.5, 0.16, 36, baseVelocity, `ks${bar}-${beat}`);
      }
      // Backbeat.
      if (beat === 1 || beat === 3) push(t, 0.2, 38, baseVelocity + 8, `s${bar}-${beat}`);
      // Hats: 8ths, 16ths when dense.
      const hatSteps = density > 0.6 ? 4 : 2;
      for (let step = 0; step < hatSteps; step += 1) {
        const swingOffset = swing && step % 2 === 1 ? beatSeconds * (2 / 3 - 0.5) : 0;
        push(t + (step / hatSteps) * beatSeconds + swingOffset, 0.09, 42,
          baseVelocity - (step % 2 ? 16 : 4), `h${bar}-${beat}-${step}`);
      }
    }
  }
  // Fill in the final bar when a transition asks for one.
  const wantsFill = request.transitions.some((t) =>
    t.toSection !== request.section.sectionName &&
    t.devices.some((d) => d.device === "drum_fill"));
  if (wantsFill) {
    const fillBar = request.section.endBar;
    const barStart = origin + (fillBar - 1) * barSeconds;
    for (let i = 0; i < 4; i += 1) {
      push(barStart + (beats - 1) * beatSeconds + (i / 4) * beatSeconds, 0.1,
        [45, 47, 48, 50][i], baseVelocity + 6 + i * 4, `fill${i}`);
    }
  }
}

/** PERCUSSION: one off-beat hit after every other beat. */
export function writePercussion(frame: ComposeFrame): void {
  const { request, beats, beatSeconds, barSeconds, origin, baseVelocity, push } = frame;
  for (let bar = request.section.startBar; bar <= request.section.endBar; bar += 1) {
    const barStart = origin + (bar - 1) * barSeconds;
    for (let beat = 1; beat < beats; beat += 2) {
      push(barStart + beat * beatSeconds + beatSeconds * 0.5, 0.1, 54,
        baseVelocity - 18, `pc${bar}-${beat}`);
    }
  }
}

/** OSTINATO: chord tones cycled in 8ths across each chord. */
export function writeOstinato(frame: ComposeFrame): void {
  const { chords, lo, hi, startSeconds, endSeconds, beatSeconds, baseVelocity, push } = frame;
  for (const chord of chords) {
    const tones = chordPitchClasses(chord);
    const start = Math.max(chord.start, startSeconds);
    const span = Math.min(chord.end, endSeconds) - start;
    const steps = Math.max(2, Math.round((span / beatSeconds) * 2));
    for (let s = 0; s < steps; s += 1) {
      const pc = tones[s % tones.length];
      push(start + (s / steps) * span, (span / steps) * 0.8,
        voiceNear(pc, (lo + hi) / 2, lo, hi), baseVelocity - 8, `o${start.toFixed(2)}-${s}`);
    }
  }
}
