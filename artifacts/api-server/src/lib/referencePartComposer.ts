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
 */
import type { ChordHarmonyEvent, MusicalNote } from "@workspace/db";
import type { PartGenerationRequest } from "./partComposer";

export const REFERENCE_PART_COMPOSER = "REFERENCE_PART_COMPOSER_V1" as const;

export type ComposeContext = {
  tempoBpm: number;
  meter?: string;
  /** Absolute seconds of bar 1's downbeat. */
  originSeconds?: number;
};

const NOTE_ROOTS: Record<string, number> = {
  C: 0, "C#": 1, DB: 1, D: 2, "D#": 3, EB: 3, E: 4, F: 5, "F#": 6, GB: 6,
  G: 7, "G#": 8, AB: 8, A: 9, "A#": 10, BB: 10, B: 11,
};

function rootPitchClass(symbol: string): number {
  const m = /^([A-Ga-g])([#b]?)/.exec(symbol.replace("♯", "#").replace("♭", "b").trim());
  if (!m) return 0;
  return NOTE_ROOTS[`${m[1].toUpperCase()}${m[2].toUpperCase()}`] ?? 0;
}

/** Chord tones as pitch classes, honouring quality/extensions when present. */
function chordPitchClasses(chord: ChordHarmonyEvent): number[] {
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

/** Nearest pitch of `pitchClass` to `target`, clamped into [lo, hi]. */
function voiceNear(pitchClass: number, target: number, lo: number, hi: number): number {
  let pitch = pitchClass + 12 * Math.round((target - pitchClass) / 12);
  while (pitch < lo) pitch += 12;
  while (pitch > hi) pitch -= 12;
  return Math.max(lo, Math.min(hi, pitch));
}

function seeded(seed: number, key: string): number {
  let h = seed >>> 0;
  for (let i = 0; i < key.length; i += 1) {
    h ^= key.charCodeAt(i);
    h = Math.imul(h, 16_777_619) >>> 0;
  }
  return (h % 10_000) / 10_000;
}

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

  switch (request.task) {
    case "DRUMS": {
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
      break;
    }

    case "BASS": {
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
      break;
    }

    case "PIANO":
    case "KEYS":
    case "ACOUSTIC_GUITAR":
    case "ELECTRIC_GUITAR": {
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
      break;
    }

    case "STRINGS":
    case "PAD": {
      for (const chord of chords) {
        const tones = chordPitchClasses(chord).slice(0, 4);
        const start = Math.max(chord.start, startSeconds);
        const span = Math.min(chord.end, endSeconds) - start;
        const centre = (lo + hi) / 2 + 4;
        tones.forEach((pc, i) =>
          push(start, span, voiceNear(pc, centre + i * 4, lo, hi), baseVelocity - 14 - i * 2, `p${start.toFixed(2)}-${i}`));
      }
      break;
    }

    case "BRASS":
    case "WOODWINDS": {
      // Accents on section downbeats and the climax bars.
      for (let bar = request.section.startBar; bar <= request.section.endBar; bar += 2) {
        const barStart = origin + (bar - 1) * barSeconds;
        const chord = chords.find((c) => c.start <= barStart && c.end > barStart) ?? chords[0];
        if (!chord) break;
        const tones = chordPitchClasses(chord);
        const pitch = voiceNear(tones[0], (lo + hi) / 2, lo, hi);
        push(barStart, beatSeconds * 1.2, pitch, baseVelocity + 10, `a${bar}`);
      }
      break;
    }

    case "OSTINATO": {
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
      break;
    }

    case "COUNTER_MELODY":
    case "CALL_RESPONSE": {
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
      break;
    }

    case "FILL":
    case "TRANSITION": {
      const barStart = origin + (request.section.endBar - 1) * barSeconds;
      const chord = chords.at(-1);
      const pcs = chord ? chordPitchClasses(chord) : [0, 4, 7];
      for (let s = 0; s < 3; s += 1) {
        push(barStart + (beats - 1) * beatSeconds + s * beatSeconds * 0.25, 0.18,
          voiceNear(pcs[s % pcs.length], (lo + hi) / 2, lo, hi), baseVelocity + s * 5, `t${s}`);
      }
      break;
    }

    case "INTRO":
    case "ENDING": {
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
      break;
    }

    case "PERCUSSION": {
      for (let bar = request.section.startBar; bar <= request.section.endBar; bar += 1) {
        const barStart = origin + (bar - 1) * barSeconds;
        for (let beat = 1; beat < beats; beat += 2) {
          push(barStart + beat * beatSeconds + beatSeconds * 0.5, 0.1, 54,
            baseVelocity - 18, `pc${bar}-${beat}`);
        }
      }
      break;
    }
  }

  notes.sort((a, b) => a.start - b.start || a.pitch - b.pitch);
  return notes;
}

function registerBounds(request: PartGenerationRequest): { lo: number; hi: number } {
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

function registerOf(request: PartGenerationRequest): string {
  const assignment = request.section.registerDistribution;
  const entries = Object.entries(assignment ?? {});
  if (!entries.length) return "mid";
  return entries.sort((a, b) => (b[1] ?? 0) - (a[1] ?? 0))[0][0];
}
