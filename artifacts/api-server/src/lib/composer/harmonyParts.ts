/**
 * Harmony parts of the reference composer (Brain B-00 split; B-02 owns the
 * voicing rules that will replace these).
 *
 * Moved verbatim from `referencePartComposer.ts`: chord-tone parsing, the bass
 * line, keys/guitar voicings, string/pad beds, brass accents and the
 * counter-melody answer figure. The known defects the diagnosis names — root-
 * position close triads from the register centre, no common tones, the bass
 * root re-voiced per chord — are here, unchanged, pinned by the golden test.
 */
import type { ChordHarmonyEvent } from "@workspace/db";
import type { ComposeFrame } from "./frame";
import { voiceNear } from "./registers";

const NOTE_ROOTS: Record<string, number> = {
  C: 0, "C#": 1, DB: 1, D: 2, "D#": 3, EB: 3, E: 4, F: 5, "F#": 6, GB: 6,
  G: 7, "G#": 8, AB: 8, A: 9, "A#": 10, BB: 10, B: 11,
};

export function rootPitchClass(symbol: string): number {
  const m = /^([A-Ga-g])([#b]?)/.exec(symbol.replace("♯", "#").replace("♭", "b").trim());
  if (!m) return 0;
  return NOTE_ROOTS[`${m[1].toUpperCase()}${m[2].toUpperCase()}`] ?? 0;
}

/** Chord tones as pitch classes, honouring quality/extensions when present. */
export function chordPitchClasses(chord: ChordHarmonyEvent): number[] {
  const root = rootPitchClass(chord.root ?? chord.symbol);
  const q = (chord.quality ?? chord.symbol.replace(/^[A-Ga-g][#b]?/, "")).toLowerCase();
  const intervals = q.includes("dim") ? [0, 3, 6]
    : q.includes("aug") ? [0, 4, 8]
    : q.includes("sus2") ? [0, 2, 7]
    : q.includes("sus") ? [0, 5, 7]
    : q.startsWith("m") && !q.startsWith("maj") ? [0, 3, 7]
    : [0, 4, 7];
  if (/7|9|11|13/.test(q)) intervals.push(q.includes("maj7") ? 11 : 10);
  return intervals.map((i) => (root + i) % 12);
}

/** BASS: root on the chord; at density ≥ 0.4, chord tones per beat around that root. */
export function writeBassLine(frame: ComposeFrame): void {
  const { chords, lo, hi, startSeconds, endSeconds, beatSeconds, density, baseVelocity, push } = frame;
  for (const chord of chords) {
    const pc = rootPitchClass(chord.root ?? chord.symbol);
    const root = voiceNear(pc, 40, lo, hi);
    const span = Math.min(chord.end, endSeconds) - Math.max(chord.start, startSeconds);
    const start = Math.max(chord.start, startSeconds);
    if (density < 0.4) {
      push(start, span * 0.95, root, baseVelocity + 6, `b${start.toFixed(2)}`);
    } else {
      // Root on the chord, fifth or octave on the half, walking approach last beat.
      const steps = Math.max(1, Math.round(span / beatSeconds));
      const tones = chordPitchClasses(chord);
      for (let s = 0; s < steps; s += 1) {
        const t = start + s * beatSeconds;
        const pitchClass = s === 0 ? pc : tones[(s % tones.length)];
        push(t, beatSeconds * 0.85, voiceNear(pitchClass, root, lo, hi),
          baseVelocity + (s === 0 ? 8 : -4), `b${t.toFixed(2)}`);
      }
    }
  }
}

/** PIANO / KEYS / ACOUSTIC_GUITAR / ELECTRIC_GUITAR: a close voicing from the register centre, held or comped. */
export function writeKeysVoicing(frame: ComposeFrame): void {
  const { request, chords, lo, hi, startSeconds, endSeconds, beatSeconds, density, baseVelocity, push } = frame;
  const comping = request.role === "OSTINATO" || request.role === "RHYTHMIC_HARMONY";
  for (const chord of chords) {
    const tones = chordPitchClasses(chord).slice(0, request.constraints.maxSimultaneousNotes);
    const start = Math.max(chord.start, startSeconds);
    const span = Math.min(chord.end, endSeconds) - start;
    const centre = (lo + hi) / 2;
    const voicing = tones.map((pc, i) => voiceNear(pc, centre + i * 3, lo, hi));
    if (!comping) {
      voicing.forEach((pitch, i) => push(start, span * 0.95, pitch, baseVelocity - i * 3, `c${start.toFixed(2)}-${i}`));
    } else {
      const hits = Math.max(1, Math.round((span / beatSeconds) * (density > 0.6 ? 2 : 1)));
      for (let h = 0; h < hits; h += 1) {
        const t = start + (h / hits) * span;
        voicing.forEach((pitch, i) =>
          push(t, beatSeconds * 0.45, pitch, baseVelocity - 6 - i * 3, `c${t.toFixed(2)}-${i}`));
      }
    }
  }
}

/** STRINGS / PAD: up to four chord tones held for the chord, spread 4 semitones above the centre. */
export function writeStringBed(frame: ComposeFrame): void {
  const { chords, lo, hi, startSeconds, endSeconds, baseVelocity, push } = frame;
  for (const chord of chords) {
    const tones = chordPitchClasses(chord).slice(0, 4);
    const start = Math.max(chord.start, startSeconds);
    const span = Math.min(chord.end, endSeconds) - start;
    const centre = (lo + hi) / 2 + 4;
    tones.forEach((pc, i) =>
      push(start, span, voiceNear(pc, centre + i * 4, lo, hi), baseVelocity - 14 - i * 2, `p${start.toFixed(2)}-${i}`));
  }
}

/** BRASS / WOODWINDS: one accent on every other bar's downbeat, on the chord under it (or the section's first chord). */
export function writeBrassAccents(frame: ComposeFrame): void {
  const { request, chords, lo, hi, origin, barSeconds, beatSeconds, baseVelocity, push } = frame;
  // Accents on section downbeats and the climax bars.
  for (let bar = request.section.startBar; bar <= request.section.endBar; bar += 2) {
    const barStart = origin + (bar - 1) * barSeconds;
    const chord = chords.find((c) => c.start <= barStart && c.end > barStart) ?? chords[0];
    if (!chord) break;
    const tones = chordPitchClasses(chord);
    const pitch = voiceNear(tones[0], (lo + hi) / 2, lo, hi);
    push(barStart, beatSeconds * 1.2, pitch, baseVelocity + 10, `a${bar}`);
  }
}

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
