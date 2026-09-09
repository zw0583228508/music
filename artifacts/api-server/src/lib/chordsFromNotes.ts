/**
 * Chords from notes (Wave Q — tournament task preparation, and the Song Model's
 * missing chord track).
 *
 * Two places need chord symbols that no provider supplies:
 *
 *  1. **The tournament.** PDMX MIDI carries no chord symbols, and the
 *     platform's own composers cannot write against a bar with no harmony.
 *     A fair comparison gives every provider the same task, so the chords
 *     must come from **task preparation** applied identically to all of them —
 *     never from one provider's private advantage.
 *  2. **A real full-song analysis.** PR-46 ended with `chords: 0` on a real
 *     recording: Basic Pitch returned 1,876 note events and nothing turned
 *     them into harmony. This is that step.
 *
 * Method: per bar, a duration-weighted pitch-class histogram, matched against
 * chord templates (major, minor, dominant 7, major 7, minor 7, diminished,
 * suspended) at every root. The score rewards template tones present,
 * penalises non-chord tones proportionally to their weight, and prefers the
 * bass note as root when it is a chord tone. Confidence is the margin over the
 * runner-up. **A bar with too little material, or no clear winner, yields no
 * chord** — an invented chord is worse than an empty bar, because everything
 * downstream would voice against it.
 */

export type ChordCandidateNote = { start: number; end: number; pitch: number };
export type BarSpan = { bar: number; start: number; end: number };

export type EstimatedChord = {
  bar: number;
  start: number;
  end: number;
  symbol: string;
  root: string;
  quality: ChordQuality;
  /** 0..1 — margin over the runner-up, capped: this is an estimate, not a reading. */
  confidence: number;
  /** For the record: what the bar actually contained. */
  pitchClassWeights: number[];
  runnerUp: string | null;
};

export type ChordQuality = "maj" | "min" | "7" | "maj7" | "min7" | "dim" | "sus4" | "sus2";

const NAMES = ["C", "C#", "D", "Eb", "E", "F", "F#", "G", "Ab", "A", "Bb", "B"];

/** Interval sets, in semitones from the root. */
const TEMPLATES: Record<ChordQuality, number[]> = {
  maj: [0, 4, 7],
  min: [0, 3, 7],
  "7": [0, 4, 7, 10],
  maj7: [0, 4, 7, 11],
  min7: [0, 3, 7, 10],
  dim: [0, 3, 6],
  sus4: [0, 5, 7],
  sus2: [0, 2, 7],
};

/** The suffix a symbol carries for each quality. */
const SUFFIX: Record<ChordQuality, string> = {
  maj: "", min: "m", "7": "7", maj7: "maj7", min7: "m7", dim: "dim", sus4: "sus4", sus2: "sus2",
};

/** Below this much sounding time in a bar there is nothing to name. */
export const MIN_BAR_WEIGHT_SECONDS = 0.25;
/** Fewer distinct pitch classes than this cannot distinguish a chord from an interval. */
export const MIN_PITCH_CLASSES = 2;
/** A winner this close to the runner-up is a guess, and is not emitted. */
export const MIN_MARGIN = 0.08;
/** Estimated harmony never claims the certainty of a read chord symbol. */
export const MAX_CONFIDENCE = 0.85;

const pc = (pitch: number): number => ((Math.round(pitch) % 12) + 12) % 12;

/** Duration-weighted pitch-class histogram of the notes sounding inside a span. */
export function pitchClassWeights(notes: readonly ChordCandidateNote[], span: BarSpan): {
  weights: number[];
  total: number;
  bassPitchClass: number | null;
} {
  const weights = new Array(12).fill(0);
  let total = 0;
  let bassPitch: number | null = null;
  let bassWeight = 0;
  for (const note of notes) {
    const from = Math.max(note.start, span.start);
    const to = Math.min(note.end, span.end);
    const overlap = to - from;
    if (!(overlap > 0)) continue;
    weights[pc(note.pitch)] += overlap;
    total += overlap;
    // The bass is the lowest pitch that carries real weight in the bar, not
    // a stray low grace note.
    if (bassPitch === null || note.pitch < bassPitch || (note.pitch === bassPitch && overlap > bassWeight)) {
      if (overlap >= 0.1 * Math.max(overlap, 0.1)) {
        bassPitch = note.pitch;
        bassWeight = overlap;
      }
    }
  }
  return { weights, total, bassPitchClass: bassPitch === null ? null : pc(bassPitch) };
}

function scoreTemplate(weights: number[], total: number, root: number, quality: ChordQuality, bass: number | null): number {
  const tones = new Set(TEMPLATES[quality].map((i) => (root + i) % 12));
  let inChord = 0;
  let outOfChord = 0;
  for (let k = 0; k < 12; k += 1) {
    if (tones.has(k)) inChord += weights[k];
    else outOfChord += weights[k];
  }
  // Coverage: how much of what sounded is explained. Completeness: how many of
  // the template's tones actually appear — a bare fifth should not read as a
  // seventh chord just because the seventh would be "allowed".
  const present = [...tones].filter((k) => weights[k] > 0).length;
  const completeness = present / tones.size;
  let score = (inChord - 0.6 * outOfChord) / Math.max(total, 1e-9);
  score *= 0.5 + 0.5 * completeness;
  // Root in the bass is how most real accompaniment states a chord.
  if (bass !== null && bass === root) score += 0.08;
  else if (bass !== null && tones.has(bass)) score += 0.02;
  // Simpler templates win ties: a triad over a seventh when the seventh is thin.
  score -= 0.01 * (tones.size - 3);
  return score;
}

/**
 * The best-fitting chord for one bar, or null when the bar does not support a
 * name. Deterministic.
 */
export function estimateBarChord(notes: readonly ChordCandidateNote[], span: BarSpan): EstimatedChord | null {
  const { weights, total, bassPitchClass } = pitchClassWeights(notes, span);
  if (total < MIN_BAR_WEIGHT_SECONDS) return null;
  if (weights.filter((w) => w > 0).length < MIN_PITCH_CLASSES) return null;

  const ranked: Array<{ root: number; quality: ChordQuality; score: number }> = [];
  for (let root = 0; root < 12; root += 1) {
    for (const quality of Object.keys(TEMPLATES) as ChordQuality[]) {
      ranked.push({ root, quality, score: scoreTemplate(weights, total, root, quality, bassPitchClass) });
    }
  }
  ranked.sort((a, b) => b.score - a.score || a.root - b.root);
  const [best, second] = ranked;
  if (!best || best.score <= 0) return null;
  const margin = best.score - (second?.score ?? 0);
  if (margin < MIN_MARGIN) return null;

  const symbol = `${NAMES[best.root]}${SUFFIX[best.quality]}`;
  return {
    bar: span.bar,
    start: span.start,
    end: span.end,
    symbol,
    root: NAMES[best.root],
    quality: best.quality,
    confidence: Number(Math.min(MAX_CONFIDENCE, margin * 2).toFixed(3)),
    pitchClassWeights: weights.map((w) => Number((w / total).toFixed(4))),
    runnerUp: second ? `${NAMES[second.root]}${SUFFIX[second.quality]}` : null,
  };
}

/**
 * Chords for every bar. Bars that do not support a chord are simply absent —
 * the caller sees the gap rather than a fabricated symbol.
 */
export function estimateChords(notes: readonly ChordCandidateNote[], bars: readonly BarSpan[]): EstimatedChord[] {
  const out: EstimatedChord[] = [];
  for (const span of bars) {
    const chord = estimateBarChord(notes, span);
    if (chord) out.push(chord);
  }
  return out;
}

/** How much of the piece the estimate covers — for the task record. */
export function chordCoverage(chords: readonly EstimatedChord[], bars: readonly BarSpan[]): {
  barsWithChord: number;
  bars: number;
  share: number;
  meanConfidence: number;
} {
  const mean = chords.length ? chords.reduce((s, c) => s + c.confidence, 0) / chords.length : 0;
  return {
    barsWithChord: chords.length,
    bars: bars.length,
    share: bars.length ? Number((chords.length / bars.length).toFixed(4)) : 0,
    meanConfidence: Number(mean.toFixed(3)),
  };
}
