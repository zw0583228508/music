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

test("a long unbroken wind phrase of separate attacks is a warning; one note longer than a breath is the error", () => {
  // PR-61 changed the old expectation (a 15 s phrase of half-notes = error):
  // 4,772 of 4,772 such flags on human wind and brass parts were notation —
  // the player breathes by shortening a note, which score MIDI never shows.
  const notes = Array.from({ length: 30 }, (_, i) => n(i * 0.5, 0.5, 67 + (i % 3)));
  const phrase = checkInstrumentConstraints({ family: "winds", instrument: "flute", tempoBpm: 120, notes });
  assert.ok(!phrase.violations.some((v) => v.code === "breath_violation"));
  const warning = phrase.violations.find((v) => v.code === "long_phrase_no_rest");
  assert.ok(warning && warning.severity === "warning");
  assert.match(warning.suggestedFix, /rest/i);
  assert.equal(phrase.feasible, true);

  const held = checkInstrumentConstraints({ family: "winds", instrument: "flute", tempoBpm: 120, notes: [n(0, 9.5, 67)] });
  const violation = held.violations.find((v) => v.code === "breath_violation");
  assert.ok(violation && violation.severity === "error");
  assert.match(violation.message, /single 9\.5 s note/);
  assert.equal(held.feasible, false);
});

test("five simultaneous drum hits are a flam, six are too many limbs, and a fast hi-hat flip is flagged", () => {
  // PR-61: every one of 224 five-voice hits on human kit parts is notation a
  // drummer renders; the old expectation (five = error) was the bug.
  const five = checkInstrumentConstraints({
    family: "drums",
    instrument: "drums",
    tempoBpm: 120,
    notes: [n(0, 0.1, 36), n(0, 0.1, 38), n(0, 0.1, 42), n(0, 0.1, 46), n(0, 0.1, 49)],
    articulations: [
      { time: 0, name: "closed_hat" },
      { time: 0.03, name: "open_hat" },
    ],
  });
  assert.ok(five.violations.some((v) => v.code === "impossible_limb_count" && v.severity === "warning"));
  assert.ok(!five.violations.some((v) => v.code === "excess_polyphony"), "the kit is bounded by limbs, not by a voice count");
  assert.ok(five.violations.some((v) => v.code === "impossible_hat_state"));
  assert.equal(five.feasible, true);
  const six = checkInstrumentConstraints({
    family: "drums", instrument: "drums", tempoBpm: 120,
    notes: [n(0, 0.1, 36), n(0, 0.1, 38), n(0, 0.1, 42), n(0, 0.1, 46), n(0, 0.1, 49), n(0, 0.1, 51)],
  });
  assert.ok(six.violations.some((v) => v.code === "impossible_limb_count" && v.severity === "error"));
  assert.equal(six.feasible, false);
  // Kit pieces are not a melody: a "leap" from the kick to a crash is nothing.
  const kit = checkInstrumentConstraints({ family: "drums", instrument: "drums", tempoBpm: 120, notes: [n(0, 0.1, 36), n(0.25, 0.1, 81)] });
  assert.ok(!kit.violations.some((v) => /leap/.test(v.code)));
});

test("guitar fingering follows strings and frets, not pitch spread; the program's own ceilings override the definition", () => {
  // An open E major chord spans two octaves and is the first shape anyone learns.
  const openE = [n(0, 1, 40), n(0, 1, 47), n(0, 1, 52), n(0, 1, 56), n(0, 1, 59), n(0, 1, 64)];
  const open = checkInstrumentConstraints({ family: "guitar", instrument: "guitar", tempoBpm: 100, notes: openE });
  assert.ok(!open.violations.some((v) => /fingering/.test(v.code)), open.violations.map((v) => v.code).join(","));
  // Three chromatic notes below A2 have only the low E string to sit on, in any tuning tried.
  const cluster = checkInstrumentConstraints({ family: "guitar", instrument: "guitar", tempoBpm: 100, notes: [n(0, 1, 41), n(0, 1, 42), n(0, 1, 43)] });
  assert.ok(cluster.violations.some((v) => v.code === "impossible_fingering" && v.severity === "error"));
  // A shape that needs a low D is a warning (drop-D), not an impossibility.
  const dropD = checkInstrumentConstraints({ family: "guitar", instrument: "guitar", tempoBpm: 100, notes: [n(0, 1, 38), n(0, 1, 45), n(0, 1, 50)] });
  assert.ok(dropD.violations.some((v) => v.code === "hard_fingering" && v.severity === "warning"));
  assert.ok(!dropD.violations.some((v) => v.code === "impossible_fingering"));

  // A pitch no string can reach is a range fact, reported by the range rule; asking
  // whether it can be fingered reports the same note twice (PR-61: an octave doubling
  // written under a bass program, 22 + 34, where 22 is under a five-string bass's low B).
  const belowTheStrings = checkInstrumentConstraints({ family: "bass", instrument: "bass", tempoBpm: 100, notes: [n(0, 0.2, 22), n(0, 0.2, 34)] });
  assert.ok(!belowTheStrings.violations.some((v) => /fingering/.test(v.code)), belowTheStrings.violations.map((v) => v.code).join(","));
  // The reachable notes are still judged — and the finding names only them.
  const withCluster = [n(0, 0.2, 22, "low"), n(0, 0.2, 60, "a"), n(0, 0.2, 61, "b"), n(0, 0.2, 62, "c")];
  const reachable = checkInstrumentConstraints({ family: "bass", instrument: "bass", tempoBpm: 100, notes: withCluster });
  const finding = reachable.violations.find((v) => v.code === "impossible_fingering");
  assert.ok(finding && finding.severity === "error", reachable.violations.map((v) => v.code).join(","));
  assert.deepEqual(finding.noteIds.sort(), ["a", "b", "c"]);

  // A slap bass writes three-note chords; the caller who knows the GM program says so.
  const chord = [n(0, 1, 40), n(0, 1, 47), n(0, 1, 52)];
  const asDefined = checkInstrumentConstraints({ family: "strings", instrument: "bass", role: "BASS", tempoBpm: 100, notes: chord });
  assert.ok(asDefined.violations.some((v) => v.code === "excess_polyphony" && v.severity === "error"));
  const asProgram = checkInstrumentConstraints({ family: "strings", instrument: "bass", role: "BASS", tempoBpm: 100, notes: chord, polyphonyCeiling: 3 });
  assert.ok(!asProgram.violations.some((v) => v.code === "excess_polyphony"));

  // Two trumpet notes struck together: divisi on one staff — a warning, not an error; five is an error.
  const divisi = checkInstrumentConstraints({ family: "brass", instrument: "brass", tempoBpm: 100, notes: [n(0, 1, 64), n(0, 1, 67)] });
  const d = divisi.violations.find((v) => v.code === "excess_polyphony");
  assert.ok(d && d.severity === "warning" && /divisi/.test(d.message));
  const five = checkInstrumentConstraints({ family: "brass", instrument: "brass", tempoBpm: 100, notes: [n(0, 1, 55), n(0, 1, 59), n(0, 1, 62), n(0, 1, 67), n(0, 1, 71)] });
  assert.ok(five.violations.some((v) => v.code === "excess_polyphony" && v.severity === "error"));

  // A leap between two voices is not a melody: the earlier note is still sounding.
  const twoVoices = checkInstrumentConstraints({ family: "keys", tempoBpm: 100, notes: [n(0, 2, 84), n(0.5, 0.5, 36)] });
  assert.ok(!twoVoices.violations.some((v) => /leap/.test(v.code)));
  // The same 48-semitone jump as a single line is still impossible.
  const line = checkInstrumentConstraints({ family: "keys", tempoBpm: 100, notes: [n(0, 0.4, 84), n(0.5, 0.5, 36)] });
  assert.ok(line.violations.some((v) => v.code === "impossible_leap"));
  // The caller's leap ceiling replaces the definition's 1.5 × maxLeap.
  const brassLeap = [n(0, 0.4, 52), n(0.4, 0.4, 72)];
  assert.ok(checkInstrumentConstraints({ family: "brass", instrument: "brass", tempoBpm: 120, notes: brassLeap }).violations.some((v) => v.code === "impossible_leap"));
  assert.ok(!checkInstrumentConstraints({ family: "brass", instrument: "brass", tempoBpm: 120, notes: brassLeap, leapCeiling: 24 }).violations.some((v) => v.code === "impossible_leap"));
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
