import assert from "node:assert/strict";
import test from "node:test";
import {
  checkArrangementConstraints,
  checkInstrumentConstraints,
} from "./musicalConstraints";

const n = (start: number, duration: number, pitch: number, id?: string) => ({
  id: id ?? `n${start}-${pitch}`,
  start,
  duration,
  pitch,
  velocity: 90,
});

test("passes a plainly playable piano phrase", () => {
  const result = checkInstrumentConstraints({
    family: "keys",
    tempoBpm: 120,
    notes: [n(0, 0.5, 60), n(0.5, 0.5, 64), n(1, 0.5, 67), n(1.5, 1, 72)],
  });
  assert.equal(result.feasible, true);
  assert.equal(result.violations.filter((v) => v.severity === "error").length, 0);
});

test("flags an unplayable piano voicing spanning more than two hands", () => {
  const result = checkInstrumentConstraints({
    family: "keys",
    tempoBpm: 120,
    notes: [n(0, 2, 36), n(0, 2, 52), n(0, 2, 67), n(0, 2, 84)],
  });
  const violation = result.violations.find((v) => v.code === "unplayable_voicing");
  assert.ok(violation && violation.severity === "error");
  assert.equal(result.feasible, false);
  assert.match(violation.suggestedFix, /re-voice|arpeggiate/i);
});

test("flags an out-of-range bass note with an octave fix", () => {
  const result = checkInstrumentConstraints({
    family: "bass",
    instrument: "bass",
    tempoBpm: 100,
    notes: [n(0, 1, 24), n(1, 1, 40)],
  });
  const violation = result.violations.find((v) => v.code === "out_of_range");
  assert.ok(violation && violation.severity === "error");
  assert.match(violation.suggestedFix, /octave/i);
});

test("flags an impossible melodic leap on brass", () => {
  const result = checkInstrumentConstraints({
    family: "brass",
    instrument: "brass",
    tempoBpm: 120,
    notes: [n(0, 0.4, 52), n(0.4, 0.4, 79)],
  });
  assert.ok(result.violations.some((v) => v.code === "impossible_leap" || v.code === "wide_leap"));
});

test("flags a breath violation on a long unbroken wind phrase", () => {
  const notes = Array.from({ length: 30 }, (_, i) => n(i * 0.5, 0.5, 67 + (i % 3)));
  const result = checkInstrumentConstraints({
    family: "winds",
    instrument: "flute",
    tempoBpm: 120,
    notes,
  });
  const violation = result.violations.find((v) => v.code === "breath_violation");
  assert.ok(violation && violation.severity === "error");
  assert.match(violation.suggestedFix, /breath/i);
});

test("flags too many simultaneous drum hits and a fast hi-hat flip", () => {
  const result = checkInstrumentConstraints({
    family: "drums",
    instrument: "drums",
    tempoBpm: 120,
    notes: [n(0, 0.1, 36), n(0, 0.1, 38), n(0, 0.1, 42), n(0, 0.1, 46), n(0, 0.1, 49)],
    articulations: [
      { time: 0, name: "closed_hat" },
      { time: 0.03, name: "open_hat" },
    ],
  });
  assert.ok(result.violations.some((v) => v.code === "impossible_limb_count" && v.severity === "error"));
  assert.ok(result.violations.some((v) => v.code === "impossible_hat_state"));
  assert.equal(result.feasible, false);
});

test("solo strings cannot hold a triple stop; a section can", () => {
  const chord = [n(0, 2, 55), n(0, 2, 59), n(0, 2, 62)];
  // The cello definition models two voices — a single player, so a triple stop
  // is impossible. The violin definition models four (a section) and is fine.
  const solo = checkInstrumentConstraints({ family: "strings", instrument: "cello", tempoBpm: 90, notes: chord });
  assert.ok(solo.violations.some((v) => v.code === "triple_stop"));
  const inferredSection = checkInstrumentConstraints({ family: "strings", instrument: "violin", tempoBpm: 90, notes: chord });
  assert.ok(!inferredSection.violations.some((v) => v.code === "triple_stop"),
    "a 4-voice string definition is treated as a section");
  const explicitSection = checkInstrumentConstraints({
    family: "strings", instrument: "cello", role: "string section", tempoBpm: 90, notes: chord, isSection: true,
  });
  assert.ok(!explicitSection.violations.some((v) => v.code === "triple_stop"));
});

test("a legato line is not mistaken for one giant chord", () => {
  // Each note ends exactly where the next begins, with a hair of overlap.
  const line = Array.from({ length: 24 }, (_, i) => n(i * 0.5, 0.51, 40 + (i % 5)));
  const result = checkInstrumentConstraints({
    family: "strings", instrument: "bass", role: "BASS", tempoBpm: 120, notes: line,
  });
  assert.ok(
    !result.violations.some((v) => v.code === "excess_polyphony"),
    "a melodic line must not read as 24 simultaneous notes",
  );
});

test("a bass guitar is not judged as a bowed solo string player", () => {
  // A walking bass line: monophonic, so nothing here is a stop at all.
  const line = [n(0, 0.48, 40), n(0.5, 0.48, 45), n(1, 0.48, 43), n(1.5, 0.48, 47)];
  const result = checkInstrumentConstraints({
    family: "strings", instrument: "bass", role: "BASS", tempoBpm: 120, notes: line,
  });
  assert.equal(result.violations.some((v) => v.code === "triple_stop"), false);
  assert.equal(result.violations.filter((v) => v.severity === "error").length, 0);
  // Two genuinely sustained bass notes together still break the ceiling of one.
  const doubled = checkInstrumentConstraints({
    family: "strings", instrument: "bass", role: "BASS", tempoBpm: 120,
    notes: [n(0, 1, 40), n(0, 1, 47)],
  });
  assert.ok(doubled.violations.some((v) => v.code === "excess_polyphony"));
});

test("arrangement aggregate reports per-track feasibility", () => {
  const report = checkArrangementConstraints(
    [
      { id: "t-bass", instrument: "bass", role: "bass", notes: [n(0, 1, 40), n(1, 1, 43)] },
      { id: "t-keys", instrument: "keys", role: "keys", notes: [n(0, 2, 24), n(0, 2, 60), n(0, 2, 96)] },
    ],
    { tempoBpm: 110 },
  );
  assert.equal(report.byTrack.length, 2);
  const bass = report.byTrack.find((t) => t.trackId === "t-bass")!;
  const keys = report.byTrack.find((t) => t.trackId === "t-keys")!;
  assert.equal(bass.feasible, true);
  assert.equal(keys.feasible, false);
  assert.equal(report.feasible, false);
  assert.ok(report.errorCount >= 1);
});
