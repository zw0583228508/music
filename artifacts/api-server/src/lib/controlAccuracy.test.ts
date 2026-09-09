import assert from "node:assert/strict";
import test from "node:test";
import type { MusicalNote } from "@workspace/db";
import {
  checkControls,
  densityDiversity,
  horizOnsetDensity,
  intervalShares,
  isOctaveCollapse,
  maxAutocorr,
  measureControls,
  onsetIrregularity,
  summariseControls,
  toClickGrid,
  vertOnsetDensity,
  vertPitchClassesAvg,
  type MeasurementWindow,
} from "./controlAccuracy";

// 120 BPM, 4/4, eight bars: a quarter is 0.5 s, a bar 2 s.
const W: MeasurementWindow = { start: 0, secondsPerQuarter: 0.5, quartersPerBar: 4, bars: 8 };
let id = 0;
const note = (start: number, pitch: number, duration = 0.4, velocity = 80): MusicalNote => ({ id: `n${id++}`, start, duration, pitch, velocity });
/** One note per quarter, eight bars: onset density exactly 1.0 (bin 2 by CA2's slices). */
const quarters = (pitch = 48): MusicalNote[] => Array.from({ length: 32 }, (_, i) => note(i * 0.5, pitch));

test("notes snap onto CA2's 24-click grid inside the window and nothing outside survives", () => {
  const cells = toClickGrid([note(0, 60), note(0.25, 62), note(2.0, 64), note(16.0, 65), note(-0.5, 66)], W);
  assert.deepEqual(cells.map((c) => [c.measure, c.click, c.pitch]), [[0, 0, 60], [0, 12, 62], [1, 0, 64]]);
});

test("horizontal onset density is onsets per quarter over the bars that have onsets, as _horiz_note_onset_density", () => {
  assert.equal(horizOnsetDensity(toClickGrid(quarters(), W), W), 1);
  // Two eighths in bar 0 only: 2 onsets over one bar of 4 quarters = 0.5; empty bars do not dilute.
  assert.equal(horizOnsetDensity(toClickGrid([note(0, 60), note(0.25, 60)], W), W), 0.5);
  assert.equal(horizOnsetDensity([], W), null);
  // A chord is one onset.
  assert.equal(horizOnsetDensity(toClickGrid([note(0, 60), note(0, 64), note(0, 67)], W), W), 0.25);
});

test("vertical density and pitch-class average follow the chord/onset definitions", () => {
  const triads = toClickGrid([note(0, 60), note(0, 64), note(0, 67), note(2, 62), note(2, 65), note(2, 69)], W);
  assert.equal(vertOnsetDensity(triads), 3);
  assert.equal(vertPitchClassesAvg(triads), 3);
  const octaves = toClickGrid([note(0, 48), note(0, 60), note(2, 50), note(2, 62)], W);
  assert.equal(vertOnsetDensity(octaves), 2, "two notes per onset");
  assert.equal(vertPitchClassesAvg(octaves), 1, "but one pitch class");
  assert.equal(vertOnsetDensity([]), null);
});

test("step and leap shares use the chord-distance rule: rep < eps, step ≤ 2, leap above", () => {
  const line = toClickGrid([note(0, 60), note(0.5, 62), note(1, 62), note(1.5, 67), note(2, 66)], W);
  const shares = intervalShares(line)!;
  // 60→62 step, 62→62 rep, 62→67 leap, 67→66 step
  assert.deepEqual(shares, { rep: 0.25, step: 0.5, leap: 0.25 });
  assert.equal(intervalShares(toClickGrid([note(0, 60)], W)), null, "one onset has no intervals");
});

test("irregularity: a regular pulse scores CA2's finite-window 1/32, a lone onset 0, an irregular pattern more", () => {
  // CA2's score_4 uses np.correlate over the finite window: 32 quarter onsets
  // autocorrelate at 31/32 at the one-quarter shift, so a perfect pulse is
  // 1 − 31/32, not 0 — the author's own "in need of refinement" remark.
  assert.ok(Math.abs(onsetIrregularity(toClickGrid(quarters(), W), W) - 1 / 32) < 1e-9);
  assert.equal(onsetIrregularity(toClickGrid([note(0, 60)], W), W), 0);
  const irregular = toClickGrid([note(0, 60), note(0.125, 60), note(0.875, 60), note(1.5, 60), note(2.25, 60), note(3.375, 60), note(3.5, 60)], W);
  assert.ok(onsetIrregularity(irregular, W) > 0);
  // CA2 takes |r| and mean-centres over the finite window: an alternating
  // vector's strongest lag is the anticorrelated shift of 1, 7/8 of r0.
  assert.equal(maxAutocorr([1, 0, 1, 0, 1, 0, 1, 0]), 0.875);
  assert.ok(maxAutocorr([1, 0, 1, 0, 1, 0, 1, 0]) > maxAutocorr([1, 0, 0, 1, 0, 1, 1, 0]), "a periodic vector autocorrelates more than an irregular one");
  assert.equal(maxAutocorr([0, 1]), 1, "a single onset is defined as 1");
});

test("density diversity is the share of bars off the modal density bin, null with fewer than two played bars", () => {
  assert.equal(densityDiversity(toClickGrid(quarters(), W), W), 0);
  const mixed = [...quarters().filter((n) => n.start < 12), ...Array.from({ length: 16 }, (_, i) => note(12 + i * 0.25, 48))];
  // six bars at 1 onset/quarter (bin 2), two bars at 4/quarter (bin 4): 2/8 off the mode
  assert.equal(densityDiversity(toClickGrid(mixed, W), W), 0.25);
  assert.equal(densityDiversity(toClickGrid([note(0, 60)], W), W), null);
});

test("octave collapse: the same (click, pitch class) set as a context track in that bar", () => {
  const target = toClickGrid([note(0, 60), note(0.5, 64), note(2, 67)], W);
  const doubled = toClickGrid([note(0, 48), note(0.5, 52)], W); // bar 0 an octave down
  const other = toClickGrid([note(0, 50), note(0.5, 52)], W);
  assert.equal(isOctaveCollapse(target, [doubled], 0), true);
  assert.equal(isOctaveCollapse(target, [other], 0), false);
  assert.equal(isOctaveCollapse(target, [doubled], 1), false, "bar 1 of the context is empty and the target is not");
});

test("checkControls: hits and misses per instruction, bounds in semitones, loudness declared unmeasurable", () => {
  // Asked: horiz bin 2 (id 3), vert bin 0 (id 7), step bin 6 (id 18), lowest ≥ 40 (48), highest ≤ 72 (47), not-octave (39)
  const sent = [{ id: 3 }, { id: 7 }, { id: 18 }, { id: 48, note: 40 }, { id: 47, note: 72 }, { id: 39 }];
  const stepwise = Array.from({ length: 32 }, (_, i) => note(i * 0.5, 60 + (i % 2))); // 60,61,60,61… all steps
  const checks = checkControls(sent, [3, 3, 3, 3, 4, 4, 4, 4], stepwise, W, [Array.from({ length: 4 }, (_, i) => note(i * 0.5, 72))]);
  const by = Object.fromEntries(checks.map((c) => [c.kind, c]));
  assert.equal(by.horiz_note_onset_density.hit, true);
  assert.equal(by.horiz_note_onset_density.realised, 2);
  assert.equal(by.vert_note_onset_density.hit, true);
  assert.equal(by.pitch_step_prob.hit, true, "every move is a step: share 1.0 → bin 6");
  assert.equal(by.lowest_note_loose.hit, true);
  assert.equal(by.highest_note_loose.hit, true);
  assert.equal(by.is_not_octave_same.hit, true);
  assert.equal(by.loudness.hit, null);
  assert.match(by.loudness.note, /no velocities/);

  // The same request against a part that breaks it: chords, leaps, out of bounds.
  const wild = [note(0, 30), note(0, 34), note(0, 37), note(4, 90), note(4, 94), note(8, 30), note(8, 34)];
  const misses = Object.fromEntries(checkControls(sent, null, wild, W).map((c) => [c.kind, c]));
  assert.equal(misses.vert_note_onset_density.hit, false);
  assert.equal(misses.lowest_note_loose.hit, false);
  assert.equal(misses.lowest_note_loose.distance, -10, "ten semitones under the bound");
  assert.equal(misses.highest_note_loose.hit, false);
  assert.equal(misses.highest_note_loose.distance, 22);
  assert.equal(misses.loudness, undefined, "no loudness was sent, so no loudness row");

  // An empty output is measurable for nothing.
  const empty = checkControls(sent, null, [], W);
  assert.ok(empty.every((c) => c.hit === null));
});

test("summariseControls counts measurable checks, hits and mean absolute distance per kind", () => {
  const rows = summariseControls([
    { kind: "horiz_note_onset_density", requested: 2, realisedRaw: 1, realised: 2, hit: true, distance: 0, note: "" },
    { kind: "horiz_note_onset_density", requested: 2, realisedRaw: 4, realised: 4, hit: false, distance: 2, note: "" },
    { kind: "horiz_note_onset_density", requested: 2, realisedRaw: null, realised: null, hit: null, distance: null, note: "" },
    { kind: "loudness", requested: 3, realisedRaw: null, realised: null, hit: null, distance: null, note: "" },
  ]);
  const horiz = rows.find((r) => r.kind === "horiz_note_onset_density")!;
  assert.deepEqual([horiz.checks, horiz.measurable, horiz.hits, horiz.hitRate, horiz.meanAbsDistance], [3, 2, 1, 0.5, 1]);
  const loud = rows.find((r) => r.kind === "loudness")!;
  assert.deepEqual([loud.measurable, loud.hitRate], [0, null]);
});

test("measureControls returns every measurement at once, with nulls for what an empty part cannot give", () => {
  const m = measureControls([], W);
  assert.equal(m.horiz, null);
  assert.equal(m.lowest, null);
  assert.equal(m.irregularity, 0);
  const full = measureControls(quarters(48), W, [quarters(60)]);
  assert.equal(full.octaveCollapseShare, 1, "the part is an octave copy of the context in every bar");
  assert.equal(full.lowest, 48);
  assert.equal(full.highest, 48);
});
