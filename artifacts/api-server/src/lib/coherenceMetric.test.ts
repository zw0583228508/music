import assert from "node:assert/strict";
import test from "node:test";

import {
  measureCoherence,
  shuffleEnsembleWindows,
  shuffleTrackWindows,
  windowPermutation,
} from "./coherenceMetric";
import { formInputFromSecondsTracks, fractionalBar, segmentForm, type FormInput, type FormNote, type FormTrack } from "./formSegmentation";

const BEATS = 4;
const note = (start: number, end: number, pitch: number, velocity = 80): FormNote => ({ start, end, pitch, velocity });

/**
 * A piece that develops smoothly: the melody walks a scale and drifts up one
 * semitone every four bars, the chords cycle every bar, the bass follows the
 * chord, the drums are steady. Nothing in it changes at bar 8 more than at
 * bar 4, so there are no seams to find until windows are shuffled.
 */
function smoothPiece(bars: number, options: { dropout?: { track: number; from: number; to: number } } = {}): FormInput {
  const scale = [0, 2, 4, 5, 7, 9, 11];
  const roots = [0, 9, 5, 7]; // I vi IV V
  const tracks: FormTrack[] = [
    { id: "melody", family: "reed", isPercussion: false, notes: [] },
    { id: "keys", family: "keys", isPercussion: false, notes: [] },
    { id: "bass", family: "bass", isPercussion: false, notes: [] },
    { id: "drums", family: "drums", isPercussion: true, notes: [] },
  ];
  for (let bar = 0; bar < bars; bar += 1) {
    const t0 = bar * BEATS;
    const drift = Math.floor(bar / 4);
    const root = roots[bar % 4];
    for (let beat = 0; beat < BEATS; beat += 1) {
      const degree = (bar * BEATS + beat) % scale.length;
      tracks[0].notes.push(note(t0 + beat, t0 + beat + 1, 60 + drift + scale[degree]));
    }
    for (const interval of [0, 4, 7]) tracks[1].notes.push(note(t0, t0 + BEATS, 48 + root + interval, 70));
    tracks[2].notes.push(note(t0, t0 + 2, 36 + root), note(t0 + 2, t0 + 4, 36 + root + 7));
    for (let eighth = 0; eighth < 8; eighth += 1) tracks[3].notes.push(note(t0 + eighth / 2, t0 + eighth / 2 + 0.25, 42, 60));
  }
  if (options.dropout) {
    const { track, from, to } = options.dropout;
    tracks[track].notes = tracks[track].notes.filter((n) => n.start < from * BEATS || n.start >= to * BEATS);
  }
  return { tracks, barStarts: Array.from({ length: bars }, (_, i) => i * BEATS), end: bars * BEATS };
}

/** Four 8-bar blocks whose density rises: 1, 2, 4, 8 melody onsets per bar. */
function risingPiece(): FormInput {
  const tracks: FormTrack[] = [
    { id: "melody", family: "reed", isPercussion: false, notes: [] },
    { id: "keys", family: "keys", isPercussion: false, notes: [] },
  ];
  for (let bar = 0; bar < 32; bar += 1) {
    const t0 = bar * BEATS;
    const perBar = [1, 2, 4, 8][Math.floor(bar / 8)];
    for (let i = 0; i < perBar; i += 1) tracks[0].notes.push(note(t0 + (i * BEATS) / perBar, t0 + ((i + 1) * BEATS) / perBar, 60 + (i % 5) * 2));
    for (const p of [48, 52, 55]) tracks[1].notes.push(note(t0, t0 + BEATS, p, 70));
  }
  return { tracks, barStarts: Array.from({ length: 32 }, (_, i) => i * BEATS), end: 32 * BEATS };
}

test("a smoothly developing piece scores high with every component measured", () => {
  const report = measureCoherence(smoothPiece(64), { windowBars: 8 });
  assert.equal(report.barCount, 64);
  assert.ok(report.score !== null && report.score >= 60, `score ${report.score}`);
  const c = report.components;
  assert.ok(c.seamArtefacts.score !== null && c.seamArtefacts.score >= 80, `seam ${c.seamArtefacts.score}`);
  assert.equal(c.seamArtefacts.seamsMeasured, 7);
  assert.ok(c.seamArtefacts.tracksMeasured >= 3);
  assert.ok(c.harmonicAgreement.score !== null);
  assert.equal(c.instrumentationContinuity.score, 100);
  assert.ok(c.trajectorySmoothness.score !== null);
  assert.equal(c.trajectorySmoothness.planAdherence, null);
  assert.ok(report.limits.some((l) => l.includes("no section plan")));
});

test("window permutation is deterministic, complete and never the identity", () => {
  const a = windowPermutation(8, 17);
  const b = windowPermutation(8, 17);
  assert.deepEqual(a, b);
  assert.deepEqual([...a].sort((x, y) => x - y), [0, 1, 2, 3, 4, 5, 6, 7]);
  assert.ok(a.some((v, i) => v !== i));
  assert.notDeepEqual(windowPermutation(8, 18), a);
  assert.deepEqual(windowPermutation(1, 5), [0]);
});

test("shuffling one track's windows keeps every note inside its new window and preserves the count", () => {
  const original = smoothPiece(40);
  const { input, permutation } = shuffleTrackWindows(original, 0, 8, 17);
  assert.equal(permutation.length, 5);
  assert.equal(input.tracks[0].notes.length, original.tracks[0].notes.length);
  assert.deepEqual(input.tracks[1], original.tracks[1]);
  for (const n of input.tracks[0].notes) {
    const w = Math.floor(fractionalBar(input, n.start) / 8);
    assert.ok(fractionalBar(input, n.end) <= (w + 1) * 8 + 1e-6, "a note may not cross its window's end");
  }
  // Same seed, same result.
  assert.deepEqual(shuffleTrackWindows(original, 0, 8, 17).input, input);
});

test("pasted windows in one track raise the seam excess and lower the score", () => {
  const original = smoothPiece(64);
  const human = measureCoherence(original, { windowBars: 8 });
  const pasted = measureCoherence(shuffleTrackWindows(original, 0, 8, 17).input, { windowBars: 8 });
  const humanExcess = human.components.seamArtefacts.worstExcess ?? -Infinity;
  const pastedExcess = pasted.components.seamArtefacts.worstExcess ?? -Infinity;
  assert.ok(pastedExcess > humanExcess, `pasted ${pastedExcess} vs human ${humanExcess}`);
  assert.equal(pasted.components.seamArtefacts.worstTrack, "melody");
  assert.ok((pasted.score ?? 0) < (human.score ?? 0), `pasted ${pasted.score} vs human ${human.score}`);
});

test("pasted windows across the whole ensemble are caught too, and the melodic leap statistic sees them", () => {
  const original = smoothPiece(64);
  const human = measureCoherence(original, { windowBars: 8 });
  const pasted = measureCoherence(shuffleEnsembleWindows(original, 8, 23).input, { windowBars: 8 });
  assert.ok((pasted.components.seamArtefacts.excess ?? 0) > (human.components.seamArtefacts.excess ?? 0));
  const leap = pasted.components.seamArtefacts.statistics.leap;
  assert.ok(leap.seamIndex !== null && leap.seamIndex > (human.components.seamArtefacts.statistics.leap.seamIndex ?? 0));
  assert.ok((pasted.score ?? 0) < (human.score ?? 0));
});

test("plan adherence follows the rank agreement between planned and measured section density", () => {
  const input = risingPiece();
  const rising = [0.1, 0.3, 0.6, 1].map((density, i) => ({ startBar: i * 8, endBar: (i + 1) * 8, density }));
  const agreeing = measureCoherence(input, { windowBars: 8, plan: rising });
  assert.equal(agreeing.components.trajectorySmoothness.planAdherence?.spearman, 1);
  const reversed = measureCoherence(input, { windowBars: 8, plan: rising.map((t, i) => ({ ...t, density: rising[3 - i].density })) });
  assert.equal(reversed.components.trajectorySmoothness.planAdherence?.spearman, -1);
  assert.ok((reversed.components.trajectorySmoothness.score ?? 0) < (agreeing.components.trajectorySmoothness.score ?? 0));
});

test("a part that vanishes and returns mid-section, alone, is an unexplained re-entry", () => {
  const input = smoothPiece(32, { dropout: { track: 2, from: 10, to: 13 } });
  const report = measureCoherence(input, { windowBars: 8 });
  const c = report.components.instrumentationContinuity;
  assert.equal(c.reentries, 1);
  assert.equal(c.unexplained, 1);
  assert.equal(c.score, 0);
  assert.ok(report.limits.some((l) => l.includes("no form or plan given")));
});

test("a boundary explains a re-entry only when the caller supplied the form", () => {
  const input = smoothPiece(32, { dropout: { track: 2, from: 10, to: 13 } });
  // A form computed from the glitched notes itself would put a boundary at the glitch.
  const selfDerived = measureCoherence(input, { windowBars: 8, form: segmentForm(input) });
  const planned = measureCoherence(input, {
    windowBars: 8,
    plan: [{ startBar: 0, endBar: 13, density: 0.5 }, { startBar: 13, endBar: 24, density: 0.6 }, { startBar: 24, endBar: 32, density: 0.7 }],
  });
  assert.equal(planned.components.instrumentationContinuity.explainedByBoundary, 1);
  assert.equal(planned.components.instrumentationContinuity.unexplained, 0);
  // Whether the self-derived form found the glitch or not, it was given, so it counts as the caller's word.
  assert.equal(selfDerived.components.instrumentationContinuity.reentries, 1);
});

test("a re-entry where the rest of the ensemble also moves is explained", () => {
  const withEnsembleMove = smoothPiece(32, { dropout: { track: 2, from: 10, to: 13 } });
  // The drums also stop for a bar and restart at the same bar: an articulation point, not a glitch.
  withEnsembleMove.tracks[3].notes = withEnsembleMove.tracks[3].notes.filter((n) => n.start < 12 * BEATS || n.start >= 13 * BEATS);
  const c = measureCoherence(withEnsembleMove, { windowBars: 8 }).components.instrumentationContinuity;
  // The drums' one-bar rest is a rest, not a vanishing (minimum absence is two bars).
  assert.equal(c.reentries, 1);
  assert.equal(c.explainedByEnsemble, 1);
  assert.equal(c.unexplained, 0);
});

test("a piece too short for two window lines reports the seam component as unmeasurable", () => {
  const report = measureCoherence(smoothPiece(12), { windowBars: 8 });
  assert.equal(report.components.seamArtefacts.score, null);
  assert.ok(report.limits.some((l) => l.includes("seam artefacts not measurable")));
  assert.ok(report.score !== null, "the other components still produce a score");
});

test("platform tracks in seconds (start + duration) are accepted through the adapter", () => {
  const barSeconds = 2;
  const barStarts = Array.from({ length: 32 }, (_, i) => i * barSeconds);
  const tracks = [0, 1, 2].map((t) => ({
    id: `part-${t}`,
    family: ["keys", "bass", "strings"][t],
    isPercussion: false,
    notes: Array.from({ length: 128 }, (_, i) => ({ id: `n${t}-${i}`, start: i * 0.5, duration: 0.5, pitch: 48 + t * 12 + (i % 7), velocity: 80 })),
  }));
  const input = formInputFromSecondsTracks(tracks, barStarts, 64);
  const report = measureCoherence(input, { windowBars: 8 });
  assert.equal(report.trackCount, 3);
  assert.ok(report.score !== null);
  assert.equal(report.windowBars, 8);
});
