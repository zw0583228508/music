import assert from "node:assert/strict";
import test from "node:test";
import {
  alignedSegmentSimilarity,
  analyseAudioStructure,
  checkerboardNovelty,
  labelSegmentsByRepetition,
  magnitudeSpectrum,
  pickNoveltyPeaks,
} from "./audioStructure";

const SR = 8_000;

/** Deterministic LCG noise in [-1, 1). */
function noise(length: number, seed = 1): Float32Array {
  const out = new Float32Array(length);
  let state = seed >>> 0;
  for (let i = 0; i < length; i += 1) {
    state = (state * 1664525 + 1013904223) >>> 0;
    out[i] = state / 0x80000000 - 1;
  }
  return out;
}

type Material = { pitches: number[]; harmonics: number; noiseGain: number; gain: number };

/**
 * Render a "section" as a repeating two-chord loop: `pitches` (MIDI) with
 * `harmonics` partials, a little noise for timbre, one chord per second.
 */
function renderMaterial(material: Material, seconds: number, seed: number): Float32Array {
  const out = new Float32Array(Math.round(seconds * SR));
  const n = noise(out.length, seed);
  const half = Math.ceil(material.pitches.length / 2);
  for (let i = 0; i < out.length; i += 1) {
    const t = i / SR;
    const chordIndex = Math.floor(t) % 2;
    const chord = chordIndex === 0 ? material.pitches.slice(0, half) : material.pitches.slice(half);
    let v = 0;
    for (const pitch of chord) {
      const f0 = 440 * 2 ** ((pitch - 69) / 12);
      for (let h = 1; h <= material.harmonics; h += 1) v += Math.sin(2 * Math.PI * f0 * h * t) / (h * chord.length);
    }
    out[i] = material.gain * (v + material.noiseGain * n[i]);
  }
  return out;
}

const A: Material = { pitches: [48, 52, 55, 60, 53, 57, 60, 65], harmonics: 2, noiseGain: 0.02, gain: 0.5 };
const B: Material = { pitches: [45, 49, 52, 57, 50, 54, 57, 62], harmonics: 8, noiseGain: 0.08, gain: 0.5 };
const C: Material = { pitches: [43, 47, 50, 55, 41, 45, 48, 53], harmonics: 4, noiseGain: 0.15, gain: 0.35 };

function concat(parts: Float32Array[]): Float32Array {
  const out = new Float32Array(parts.reduce((n, p) => n + p.length, 0));
  let offset = 0;
  for (const p of parts) { out.set(p, offset); offset += p.length; }
  return out;
}

function boundaryHits(found: number[], truth: number[], tolerance: number): number {
  const used = new Set<number>();
  let hits = 0;
  for (const t of truth) {
    const index = found.findIndex((f, i) => !used.has(i) && Math.abs(f - t) <= tolerance);
    if (index >= 0) { used.add(index); hits += 1; }
  }
  return hits;
}

test("A B A B with 12 s sections: boundaries land within 1.5 s and the repeats share a letter", () => {
  const piece = concat([renderMaterial(A, 12, 1), renderMaterial(B, 12, 2), renderMaterial(A, 12, 3), renderMaterial(B, 12, 4)]);
  const result = analyseAudioStructure(piece, SR);
  assert.ok(result, "a 48 s piece is segmentable");
  const truth = [12, 24, 36];
  const found = result!.boundaries.map((b) => b.time);
  const hits = boundaryHits(found, truth, 1.5);
  assert.equal(hits, 3, `expected boundaries near ${truth.join(", ")}, found ${found.join(", ")}`);
  assert.ok(found.length <= 4, `over-segmented: ${found.join(", ")}`);
  const bases = result!.sections.map((s) => s.base);
  assert.equal(bases.length, found.length + 1);
  assert.equal(bases[0], "A");
  assert.equal(bases[1], "B");
  assert.equal(bases[2], "A", `third section should repeat the first: ${result!.formString}`);
  assert.equal(bases[3], "B", `fourth section should repeat the second: ${result!.formString}`);
  assert.ok(result!.sections[2].repeatsOf === 0 && result!.sections[3].repeatsOf === 1);
  assert.ok(result!.confidence > 0 && result!.confidence <= 0.55, "a sketch never claims provider-grade confidence");
  assert.equal(result!.provider, "LOCAL_SSM_STRUCTURE_V1");
});

test("A A B C A: three distinct materials get three letters and the fifth returns to A", () => {
  const piece = concat([renderMaterial(A, 10, 1), renderMaterial(A, 10, 2), renderMaterial(B, 12, 3), renderMaterial(C, 12, 4), renderMaterial(A, 10, 5)]);
  const result = analyseAudioStructure(piece, SR);
  assert.ok(result);
  const found = result!.boundaries.map((b) => b.time);
  // The A|A join is a repeat, not a change: the segmenter may or may not cut
  // it. The three material changes must be found.
  assert.equal(boundaryHits(found, [20, 32, 44], 1.5), 3, `found ${found.join(", ")}`);
  const distinct = new Set(result!.sections.map((s) => s.base));
  assert.equal(distinct.size, 3, `expected A, B, C; got ${result!.formString}`);
  const last = result!.sections[result!.sections.length - 1];
  assert.equal(last.base, "A", `final section should return to A: ${result!.formString}`);
});

test("silence is trimmed, not sectioned; too little audible material returns null", () => {
  const quiet = new Float32Array(SR * 5);
  const piece = concat([quiet, renderMaterial(A, 12, 1), renderMaterial(B, 12, 2), quiet]);
  const result = analyseAudioStructure(piece, SR);
  assert.ok(result);
  assert.ok(result!.audibleStart >= 4.5 && result!.audibleStart <= 5.6, `audible start ${result!.audibleStart}`);
  assert.ok(result!.audibleEnd >= 28.4 && result!.audibleEnd <= 29.6, `audible end ${result!.audibleEnd}`);
  assert.ok(result!.sections[0].start >= 4.5, "the first section starts where the sound does");
  assert.equal(analyseAudioStructure(new Float32Array(SR * 30), SR), null, "pure silence has no structure");
  assert.equal(analyseAudioStructure(renderMaterial(A, 8, 1), SR), null, "8 s cannot hold two 6 s sections");
});

test("deterministic: the same buffer gives byte-identical results", () => {
  const piece = concat([renderMaterial(A, 12, 1), renderMaterial(B, 12, 2)]);
  const first = JSON.stringify(analyseAudioStructure(piece, SR));
  const second = JSON.stringify(analyseAudioStructure(piece, SR));
  assert.equal(first, second);
});

test("primitives: FFT peak, checkerboard novelty peaks at a block change, peak picking respects distance", () => {
  const frame = new Float64Array(1024);
  for (let i = 0; i < frame.length; i += 1) frame[i] = Math.sin((2 * Math.PI * 64 * i) / frame.length);
  const mags = magnitudeSpectrum(frame);
  let best = 0;
  for (let k = 1; k < mags.length; k += 1) if (mags[k] > mags[best]) best = k;
  assert.equal(best, 64);

  const n = 40;
  const ssm = Array.from({ length: n }, (_, i) => Float64Array.from({ length: n }, (_, j) => ((i < 20) === (j < 20) ? 1 : 0)));
  const novelty = checkerboardNovelty(ssm, 4);
  assert.equal(novelty.indexOf(Math.max(...novelty)), 20);
  const peaks = pickNoveltyPeaks(novelty, { minDistance: 6, maxPeaks: 5, peakSigma: 0.5 });
  assert.deepEqual(peaks.map((p) => p.frame), [20]);

  const same = alignedSegmentSimilarity(ssm, { start: 0, end: 10 }, { start: 10, end: 20 });
  const different = alignedSegmentSimilarity(ssm, { start: 0, end: 10 }, { start: 20, end: 30 });
  assert.ok(same > 0.9 && different < 0.1);
  const labels = labelSegmentsByRepetition(ssm, [{ start: 0, end: 10 }, { start: 10, end: 20 }, { start: 20, end: 30 }, { start: 30, end: 40 }], { sameThreshold: 0.72, variantThreshold: 0.6 });
  assert.deepEqual(labels.map((l) => l.label), ["A", "A", "B", "B"]);
});
