/**
 * Key from transcribed notes (Wave Q, Q-01 support).
 *
 * The local signal analyser estimates a key by picking the loudest pitch class
 * out of a raw spectrum. On a clean synthesised song that works. On a real
 * mixed recording it usually returns nothing at all — drums, bass harmonics and
 * reverb smear the spectrum until no pitch class stands out — and because the
 * Song Model requires a key, the whole analysis of a real song fails before a
 * single transcribed note is stored.
 *
 * A transcription answers the question far better than a spectrum does, because
 * the hard part is already done: these are notes, not energy. This estimates
 * the key from them by the standard Krumhansl-Kessler method — correlate the
 * duration-weighted pitch-class distribution against the twenty-four profiles
 * and take the best fit.
 *
 * Two deliberate limits keep it honest:
 *
 *  - It **refuses** rather than guesses when the material is too thin. A handful
 *    of notes over two pitch classes fits every profile equally badly, and a key
 *    invented from that is worse than no key, because the rest of the pipeline
 *    would trust it.
 *  - Its confidence is **capped below a dedicated key model's**. This is an
 *    inference from a transcription, not a key detector, and where a real key
 *    provider is configured that provider must win the reconciliation.
 */

export type KeyCandidateNote = {
  start: number;
  /** Either end or duration; whichever the caller has. */
  end?: number;
  duration?: number;
  pitch: number;
};

export type KeyFromNotes = {
  /** e.g. "E♭ minor", in the same spelling the analyser uses elsewhere. */
  key: string;
  confidence: number;
  /** Correlation with the winning profile, for the record. */
  correlation: number;
  /** How far ahead of the runner-up, 0..1. A tie is not an answer. */
  margin: number;
  notesUsed: number;
  pitchClassesUsed: number;
};

const NOTE_NAMES = ["C", "C♯", "D", "E♭", "E", "F", "F♯", "G", "A♭", "A", "B♭", "B"];

/** Krumhansl-Kessler probe-tone profiles. */
const MAJOR = [6.35, 2.23, 3.48, 2.33, 4.38, 4.09, 2.52, 5.19, 2.39, 3.66, 2.29, 2.88];
const MINOR = [6.33, 2.68, 3.52, 5.38, 2.60, 3.53, 2.54, 4.75, 3.98, 2.69, 3.34, 3.17];

/** Fewer notes than this and any key fits as well as any other. */
export const MIN_NOTES = 12;

/** A distribution over three pitch classes does not distinguish twenty-four keys. */
export const MIN_PITCH_CLASSES = 4;

/**
 * Never reaches a dedicated key model's confidence. This is an inference from a
 * transcription; where a real key provider exists, it must win.
 */
export const MAX_CONFIDENCE = 0.75;

function correlation(left: number[], right: number[]): number {
  const n = left.length;
  const meanLeft = left.reduce((a, b) => a + b, 0) / n;
  const meanRight = right.reduce((a, b) => a + b, 0) / n;
  let covariance = 0;
  let varianceLeft = 0;
  let varianceRight = 0;
  for (let i = 0; i < n; i += 1) {
    const dl = left[i] - meanLeft;
    const dr = right[i] - meanRight;
    covariance += dl * dr;
    varianceLeft += dl * dl;
    varianceRight += dr * dr;
  }
  const denominator = Math.sqrt(varianceLeft * varianceRight);
  return denominator === 0 ? 0 : covariance / denominator;
}

const rotate = (profile: number[], by: number): number[] =>
  profile.map((_, index) => profile[(index - by + 12 + 12) % 12]);

/**
 * The key these notes are in, or null with nothing claimed. Weighted by
 * duration, because a whole note in the melody says more about the key than a
 * passing sixteenth.
 */
export function keyFromNotes(notes: readonly KeyCandidateNote[]): KeyFromNotes | null {
  const weights = new Array(12).fill(0);
  let used = 0;
  for (const note of notes) {
    if (!Number.isFinite(note.pitch)) continue;
    const length = note.duration ?? (note.end !== undefined ? note.end - note.start : 0);
    // A zero-length note still happened; count it as a short one rather than
    // dropping evidence on a rounding artefact.
    const weight = Number.isFinite(length) && length > 0 ? length : 0.05;
    weights[((Math.round(note.pitch) % 12) + 12) % 12] += weight;
    used += 1;
  }
  const present = weights.filter((w) => w > 0).length;
  if (used < MIN_NOTES || present < MIN_PITCH_CLASSES) return null;

  let best: { index: number; minor: boolean; r: number } | null = null;
  let second = -Infinity;
  for (let tonic = 0; tonic < 12; tonic += 1) {
    for (const minor of [false, true]) {
      const r = correlation(weights, rotate(minor ? MINOR : MAJOR, tonic));
      if (!best || r > best.r) {
        if (best) second = Math.max(second, best.r);
        best = { index: tonic, minor, r };
      } else if (r > second) {
        second = r;
      }
    }
  }
  if (!best || best.r <= 0) return null;

  // A win by nothing is a tie, and a tie is not an answer.
  const margin = Math.max(0, Math.min(1, (best.r - second) / Math.max(1e-6, Math.abs(best.r))));
  const confidence = Math.max(
    0,
    Math.min(MAX_CONFIDENCE, 0.25 + best.r * 0.45 + margin * 0.6),
  );
  return {
    key: `${NOTE_NAMES[best.index]} ${best.minor ? "minor" : "major"}`,
    confidence: Number(confidence.toFixed(2)),
    correlation: Number(best.r.toFixed(4)),
    margin: Number(margin.toFixed(4)),
    notesUsed: used,
    pitchClassesUsed: present,
  };
}

/** Why no key could be inferred from these notes, for a provenance record. */
export function keyFromNotesRefusal(notes: readonly KeyCandidateNote[]): string | null {
  const distinct = new Set(
    notes.filter((n) => Number.isFinite(n.pitch)).map((n) => ((Math.round(n.pitch) % 12) + 12) % 12),
  );
  if (notes.length < MIN_NOTES) {
    return `only ${notes.length} transcribed note(s): fewer than ${MIN_NOTES} fits every key equally badly`;
  }
  if (distinct.size < MIN_PITCH_CLASSES) {
    return `only ${distinct.size} distinct pitch class(es): too few to tell twenty-four keys apart`;
  }
  return null;
}
