import assert from "node:assert/strict";
import test from "node:test";

import {
  assertMatchingIsOptimal,
  beatsPerBarOf,
  boundaryDrift,
  compareMeter,
  downbeatPhaseOffset,
  fMeasure,
  matchEvents,
  meanTempoOf,
  scoreRhythm,
  tempoError,
} from "./rhythmMetrics";

const grid = (bpm: number, count: number, offset = 0): number[] =>
  Array.from({ length: count }, (_, i) => Number((offset + (i * 60) / bpm).toFixed(6)));

const everyNth = (beats: number[], n: number, from = 0): number[] =>
  beats.filter((_, index) => (index - from) % n === 0 && index >= from);

// ---------------------------------------------------------------------------
// F-measure
// ---------------------------------------------------------------------------

test("a perfect estimate scores 1 and an estimate outside the window scores 0", () => {
  const reference = grid(120, 20);
  assert.equal(fMeasure(reference, reference).fMeasure, 1);
  assert.equal(fMeasure(reference, reference.map((t) => t + 0.069)).fMeasure, 1);
  assert.equal(fMeasure(reference, reference.map((t) => t + 0.071)).fMeasure, 0);
});

test("matching is one-to-one: a doubled estimate cannot claim a beat twice", () => {
  // Offset from zero: a negative estimate time is discarded as unreal, and a
  // fixture that starts at 0 would silently lose one of its twenty estimates.
  const reference = grid(120, 10, 1);
  const doubled = reference.flatMap((t) => [t - 0.02, t + 0.02]);
  const result = fMeasure(reference, doubled);
  assert.equal(result.matched, 10);
  assert.equal(result.recall, 1);
  assert.equal(result.precision, 0.5);
  assert.ok(Math.abs(result.fMeasure - 2 / 3) < 1e-4);
});

test("a half-time estimate has perfect precision and half the recall", () => {
  const reference = grid(120, 20);
  const result = fMeasure(reference, everyNth(reference, 2));
  assert.equal(result.precision, 1);
  assert.equal(result.recall, 0.5);
});

test("the greedy-matching precondition holds at every tempo we measure", () => {
  for (const bpm of [60, 90, 120, 146, 200, 400]) {
    assert.equal(assertMatchingIsOptimal(grid(bpm, 20)), true, `${bpm} BPM`);
  }
  // 428 BPM is where a beat interval drops below 2 × 70 ms and greedy stops
  // being provably optimal. Documented, and outside anything we test.
  assert.equal(assertMatchingIsOptimal(grid(460, 20)), false);
});

test("matchEvents prefers the closer of two competing estimates", () => {
  const pairs = matchEvents([1.0], [0.95, 1.01]);
  assert.deepEqual(pairs, [[0, 1]]);
});

test("trimSeconds is opt-in, and named wherever it is used", () => {
  const reference = grid(120, 40);
  // 0.25 s, not 0.5: at 120 BPM a half-second shift lands exactly on the next
  // beat, and a "wrong" estimate would score a perfect 1.
  const estimate = reference.map((t, i) => (i < 10 ? t + 0.25 : t));
  assert.ok(fMeasure(reference, estimate).fMeasure < 0.8);
  assert.ok(fMeasure(reference, estimate, { trimSeconds: 5 }).fMeasure > 0.95);
});

// ---------------------------------------------------------------------------
// Tempo
// ---------------------------------------------------------------------------

test("octave confusion is reported as such, not as a large error", () => {
  const half = tempoError(120, 60);
  assert.ok(half.absoluteRelativeError! > 0.45);
  assert.ok(half.octaveTolerantError! < 0.01);
  assert.equal(half.bestRatio, 1 / 2);
  assert.equal(half.octaveConfusion, true);

  const doubled = tempoError(70, 140);
  assert.equal(doubled.bestRatio, 2);
  assert.equal(doubled.octaveConfusion, true);

  const triple = tempoError(60, 180);
  assert.equal(triple.bestRatio, 3);
});

test("a plainly wrong tempo is not rescued by the octave allowance", () => {
  const wrong = tempoError(120, 101);
  assert.equal(wrong.octaveConfusion, false);
  assert.ok(wrong.octaveTolerantError! > 0.1);
});

test("a correct tempo is not called an octave confusion", () => {
  const right = tempoError(120, 120.4);
  assert.equal(right.bestRatio, 1);
  assert.equal(right.octaveConfusion, false);
});

test("a missing tempo is null, never zero", () => {
  const missing = tempoError(120, null);
  assert.equal(missing.absoluteRelativeError, null);
  assert.equal(missing.octaveTolerantError, null);
  assert.equal(missing.octaveConfusion, false);
});

test("meanTempoOf measures a clip end to end, so rubato averages honestly", () => {
  assert.ok(Math.abs(meanTempoOf(grid(120, 41))! - 120) < 0.01);
  assert.equal(meanTempoOf([1]), null);
});

// ---------------------------------------------------------------------------
// Metre
// ---------------------------------------------------------------------------

test("3/4 and 6/8 share a bar length but not a beat count", () => {
  const comparison = compareMeter("6/8", "3/4");
  assert.equal(comparison.exact, false);
  assert.equal(comparison.sameBarLength, true);
  assert.equal(comparison.sameBeatCount, false);
  assert.equal(beatsPerBarOf("6/8"), 2);
  assert.equal(beatsPerBarOf("3/4"), 3);
});

test("4/4 and 2/2 are the same bar written twice", () => {
  const comparison = compareMeter("4/4", "2/2");
  assert.equal(comparison.exact, false);
  assert.equal(comparison.sameBarLength, true);
});

test("9/8 counts three beats to the bar, 7/8 counts seven", () => {
  assert.equal(beatsPerBarOf("9/8"), 3);
  assert.equal(beatsPerBarOf("7/8"), 7);
  assert.equal(beatsPerBarOf("12/8"), 4);
  assert.equal(beatsPerBarOf("nonsense"), null);
});

// ---------------------------------------------------------------------------
// Drift
// ---------------------------------------------------------------------------

test("a tracker that starts on the beat and walks off is flagged as such", () => {
  const reference = grid(120, 60);
  const walking = reference.map((t, i) => t + i * 0.005);
  const drift = boundaryDrift(reference, walking);
  assert.ok(drift.driftSeconds! > 0.1, `drift was ${drift.driftSeconds}`);
  assert.equal(drift.walksOff, true);
  assert.ok(Math.abs(drift.earlyOffsetSeconds!) < 0.07);
});

test("a constant offset is not drift", () => {
  const reference = grid(120, 60);
  const drift = boundaryDrift(reference, reference.map((t) => t + 0.04));
  assert.ok(Math.abs(drift.driftSeconds!) < 0.005);
  assert.equal(drift.walksOff, false);
});

test("a tracker with nothing to match reports nulls rather than a comfortable zero", () => {
  const drift = boundaryDrift(grid(120, 60), [100, 101, 102]);
  assert.equal(drift.driftSeconds, null);
  assert.equal(drift.walksOff, false);
});

// ---------------------------------------------------------------------------
// The pickup diagnosis
// ---------------------------------------------------------------------------

test("downbeatPhaseOffset separates 'one beat out' from 'lost the pulse'", () => {
  const beats = grid(120, 40);
  const reference = { beats, downbeats: everyNth(beats, 4, 0), meter: "4/4" };
  assert.equal(downbeatPhaseOffset(reference, everyNth(beats, 4, 1)), 1);
  assert.equal(downbeatPhaseOffset(reference, everyNth(beats, 4, 0)), 0);
  // Downbeats that are nowhere near the grid are a different failure entirely.
  assert.equal(downbeatPhaseOffset(reference, [0.13, 3.71, 7.02]), null);
});

// ---------------------------------------------------------------------------
// The whole score
// ---------------------------------------------------------------------------

test("scoreRhythm reports each field separately, including the ones that are absent", () => {
  const beats = grid(120, 40);
  const reference = { beats, downbeats: everyNth(beats, 4), meter: "4/4" };
  const score = scoreRhythm(reference, {
    beats, downbeats: null, tempoBpm: 60, meter: null,
  });
  assert.equal(score.beat.fMeasure, 1);
  assert.equal(score.downbeat, null);
  assert.equal(score.meter, null);
  assert.equal(score.tempo.octaveConfusion, true);
  assert.equal(score.drift.walksOff, false);
});

test("a tracker that finds every beat but starts the bar late is not scored as lost", () => {
  const beats = grid(120, 40);
  const reference = { beats, downbeats: everyNth(beats, 4, 0), meter: "4/4" };
  const score = scoreRhythm(reference, {
    beats, downbeats: everyNth(beats, 4, 1), tempoBpm: 120, meter: "4/4",
  });
  assert.equal(score.beat.fMeasure, 1);
  assert.equal(score.downbeat!.fMeasure, 0);
  // The F-measure alone would read like total failure; the phase offset says
  // it is one rotation away from perfect, which is a completely different repair.
  assert.equal(score.downbeatPhaseOffset, 1);
});
