/**
 * Boundary figures of the reference composer (Brain B-00 split; Brain B-04
 * realises them through `transitionRealisation`).
 *
 * FILL / TRANSITION tasks play the gestures the transition plan asked of this
 * instrument's family (a keys pickup, a string run, a bass approach, a
 * turnaround, a brass push, a riser ...); a kit plays the groove plan's fill.
 * When the plan named no device for the family, the old three-note pickup is
 * written - into the *next* section's first chord, which is what a pickup
 * leads to (it used to aim at the chord it was leaving). INTRO plays the first
 * chord, or the next bars' first chord when the section has none under it
 * (the owner's intro was silent for that reason); ENDING holds the final
 * chord over the song's last bar.
 */
import type { ComposeFrame } from "./frame";
import { chordPitchClasses } from "./harmonyParts";
import { voiceNear } from "./registers";
import { fillNotes, grooveOf } from "./rhythmParts";
import { endingGestureFor, familyOfInstrument, transitionGesturesFor } from "../transitionRealisation";

/** FILL / TRANSITION: the family's planned gestures at the section boundary, or a pickup into the next chord. */
export function writeTransitionFigure(frame: ComposeFrame): void {
  const { request, chords, lo, hi, beats, beatSeconds, barSeconds, origin, baseVelocity, push } = frame;
  const family = familyOfInstrument(request.instrument);
  if (family === "drums" || family === "percussion") {
    const groove = grooveOf(frame);
    const barStart = origin + (request.section.endBar - 1) * barSeconds;
    const placement = groove.fills.placements.find((p) => p.bar === request.section.endBar && p.lengthUnits > 0)
      ?? { bar: request.section.endBar, kind: groove.fills.vocabulary.value[0] ?? "snare_pickup", lengthUnits: 1, intensity: 0.5, source: "default" as const, reason: "FILL task with no planned placement" };
    for (const note of fillNotes(placement, barStart, frame, groove)) push(note.start, note.duration, note.pitch, note.velocity, note.id);
    return;
  }
  const { outgoing } = transitionGesturesFor(frame, family);
  const applied = outgoing.filter((g) => g.applies && g.notes.length);
  if (applied.length) {
    for (const gesture of applied) for (const note of gesture.notes) push(note.start, note.duration, note.pitch, note.velocity, note.id);
    return;
  }
  // Fallback: three 16th-note tones of the chord the pickup leads into.
  const barStart = origin + (request.section.endBar - 1) * barSeconds;
  const target = request.context.nextBars.chords[0] ?? chords.at(-1) ?? null;
  const pcs = target ? chordPitchClasses(target) : [0, 4, 7];
  for (let s = 0; s < 3; s += 1) {
    push(barStart + (beats - 1) * beatSeconds + s * beatSeconds * 0.25, 0.18,
      voiceNear(pcs[s % pcs.length], (lo + hi) / 2, lo, hi), baseVelocity + s * 5, `t${s}`);
  }
}

/** INTRO: one spread triad on the first chord (or the next bars' first). ENDING: the final chord held over the last bar. */
export function writeIntroOrEnding(frame: ComposeFrame): void {
  const { request, chords, lo, hi, barSeconds, origin, startSeconds, baseVelocity, push } = frame;
  if (request.task === "INTRO") {
    const chord = chords[0] ?? request.context.nextBars.chords[0] ?? null;
    if (!chord) return;
    chordPitchClasses(chord).slice(0, 3).forEach((pc, i) =>
      push(startSeconds, barSeconds * 0.9, voiceNear(pc, (lo + hi) / 2 + i * 4, lo, hi), baseVelocity - 8, `INTRO-${i}`));
    return;
  }
  const ending = endingGestureFor(frame);
  const at = ending?.barStart ?? origin + (request.section.endBar - 1) * barSeconds;
  const chord = ending?.chord ?? chords.at(-1) ?? null;
  if (!chord) return;
  const held = !ending || ending.kind === "held_hit";
  chordPitchClasses(chord).slice(0, held ? 4 : 3).forEach((pc, i) =>
    push(at, barSeconds * 0.95, voiceNear(pc, (lo + hi) / 2 + i * 4, lo, hi), baseVelocity + (held ? 12 : -4), `ENDING-${i}`));
}
