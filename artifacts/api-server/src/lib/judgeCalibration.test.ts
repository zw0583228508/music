import assert from "node:assert/strict";
import test from "node:test";
import {
  CALIBRATED_FAMILIES, GATE_THRESHOLDS, calibrateWindow, classifyViolation, fingerable, gmReference, humanWindows,
  sampleCases, summariseCalibration, type CalibrationWindow, type WindowCalibration,
} from "./judgeCalibration";
import { judgePlayability } from "./partJudge";
import { fixtureScore } from "./tournamentFixture";
import type { ConstraintNote } from "./musicalConstraints";

const n = (start: number, duration: number, pitch: number, id?: string): ConstraintNote =>
  ({ id: id ?? `n${start}-${pitch}`, start, duration, pitch, velocity: 90 });

function windowFor(program: number, family: string, notes: ConstraintNote[], tempoBpm = 120): CalibrationWindow {
  return {
    workId: "w", track: 1, program, family, isPercussion: program === 128, barStart: 0, barEnd: 8, tempoBpm,
    meter: { numerator: 4, denominator: 4 }, barSeconds: 2, window: { start: 0, end: 16 }, notes, tempoEvents: 1,
  };
}

function classify(program: number, family: string, notes: ConstraintNote[], code: string, noteIds: string[], tempoBpm = 120) {
  const window = windowFor(program, family, notes, tempoBpm);
  const verdict = judgePlayability({ targetInst: program, targetFamily: family, tempoBpm, notes });
  return classifyViolation({ code, noteIds }, { window, verdict, reference: gmReference(program), allNotes: notes });
}

// ---------------------------------------------------------------------------
// Human windows
// ---------------------------------------------------------------------------

test("every judgeable part of a score becomes human windows under the tournament's target rules", () => {
  const score = fixtureScore(16);
  const { windows, refusal } = humanWindows(score, "fixture", { windowBars: 8 });
  assert.equal(refusal, null);
  // Three parts (piano, bass, trumpet) × two aligned 8-bar windows.
  assert.equal(windows.length, 6);
  assert.deepEqual([...new Set(windows.map((w) => w.program))].sort((a, b) => a - b), [0, 33, 56]);
  assert.deepEqual([...new Set(windows.map((w) => w.family))].sort(), ["bass", "brass", "keys"]);
  const bass = windows.find((w) => w.program === 33 && w.barStart === 8)!;
  assert.equal(bass.notes.length, 32, "four notes a bar for eight bars");
  assert.equal(bass.window.start, 16);
  assert.ok(bass.notes.every((x) => x.start >= 16 && x.start < 32));
  assert.ok(CALIBRATED_FAMILIES.includes("chromatic_perc"));
});

test("a window with too few notes, or one that rests through most of its bars, is not a part; a metre change refuses the file", () => {
  const score = fixtureScore(8);
  const sparse = { ...score, notes: score.notes.filter((x) => x.track !== 2 || x.startTick < 3 * 1920) };
  const { windows } = humanWindows(sparse, "fixture");
  assert.ok(!windows.some((w) => w.program === 56), "a trumpet that plays only the first half of the window is a cue, not a part");
  const capped = humanWindows(fixtureScore(32), "fixture", { maxWindowsPerTrack: 1 });
  assert.equal(capped.windows.length, 3);
  const changing = { ...score, timeSignatures: [...score.timeSignatures, { tick: 1920 * 4, numerator: 3, denominator: 4 }] };
  assert.match(humanWindows(changing, "fixture").refusal ?? "", /changes metre/);
});

// ---------------------------------------------------------------------------
// Fingerability
// ---------------------------------------------------------------------------

test("open-string voicings are fingerable however wide they are; a piano cluster is not", () => {
  // E major open chord: E2 B2 E3 G#3 B3 E4 — a 24-semitone spread, frets 0/2/2/1/0/0.
  assert.equal(fingerable([40, 47, 52, 56, 59, 64], [40, 45, 50, 55, 59, 64]), true);
  // A minor tenth on two strings: A2 (fret 5 on E) and C#4 (fret 6 on G) — fingerable.
  assert.equal(fingerable([45, 61], [40, 45, 50, 55, 59, 64]), true);
  // Seven distinct pitches need seven strings.
  assert.equal(fingerable([40, 45, 50, 55, 59, 64, 67], [40, 45, 50, 55, 59, 64]), false);
  // A chromatic cluster with no open string to lean on cannot sit under one hand.
  assert.equal(fingerable([60, 61, 62], [40, 45, 50, 55, 59, 64]), false);
});

// ---------------------------------------------------------------------------
// Classification by evidence
// ---------------------------------------------------------------------------

test("a range flag on a drum kit is a judge false positive; a tuba note inside the standard tuba range is a register error", () => {
  const drums = classify(128, "drums", [n(0, 0.2, 27), n(0.5, 0.2, 36)], "out_of_range", ["n0-27"]);
  assert.equal(drums.classification, "judge_false_positive");
  const tuba = classify(58, "brass", [n(0, 1, 63)], "out_of_range", ["n0-63"]);
  assert.equal(tuba.classification, "register_model_error");
  assert.match(tuba.reason, /inside the standard tuba range 26–65/);
  const clarinetLow = classify(71, "reed", [n(0, 1, 40)], "out_of_range", ["n0-40"]);
  assert.equal(clarinetLow.classification, "unusual_but_valid_technique", "a bass clarinet under the clarinet program");
  const octaveError = classify(56, "brass", [n(0, 1, 20)], "out_of_range", ["n0-20"]);
  assert.equal(octaveError.classification, "data_problem");
  const near = classify(56, "brass", [n(0, 1, 44)], "out_of_range", ["n0-44"]);
  assert.equal(near.classification, "ambiguous_case");
});

test("a whole part written an octave from the program's sounding pitch is a data problem, not an over-range note", () => {
  // A piccolo part at written pitch: every note an octave under the piccolo's
  // 74–108 floor. The calibration measured 346 such notes, all inside 62–73.
  const written = [n(0, 0.5, 62, "a"), n(0.5, 0.5, 66, "b"), n(1, 0.5, 69, "c"), n(1.5, 0.5, 73, "d")];
  const displaced = classify(72, "pipe", written, "out_of_range", ["a"]);
  assert.equal(displaced.classification, "data_problem");
  assert.equal(displaced.facts.octaveShift, 12);
  assert.deepEqual(displaced.facts.windowPitchSpan, [62, 73]);
  assert.match(displaced.reason, /moved up an octave/);
  // One note out of an otherwise in-range part is not a displaced part: the
  // shift would push the rest out, and the case stays ambiguous.
  const stray = [n(0, 0.5, 72, "a"), n(0.5, 0.5, 90, "b"), n(1, 0.5, 95, "c"), n(1.5, 0.5, 100, "d")];
  assert.equal(classify(72, "pipe", stray, "out_of_range", ["a"]).classification, "ambiguous_case");
});

test("a range flag from the wrong platform definition is an instrument mapping error", () => {
  // The 1.0 judge had no range entry for a choir (GM 52) and held it to the
  // platform's violin-shaped 'strings' (55–103): 16,762 human choir notes
  // flagged. The 1.1 judge holds it to the choir's own range; the classifier
  // still names the old case when a verdict comes from a definition.
  const notes = [n(0, 1, 40)];
  const window = windowFor(52, "ensemble", notes);
  const verdict = { ...judgePlayability({ targetInst: 52, targetFamily: "ensemble", tempoBpm: 120, notes }), range: { min: 55, max: 103 }, rangeSource: "definition" as const };
  const choir = classifyViolation({ code: "out_of_range", noteIds: ["n0-40"] }, { window, verdict, reference: gmReference(52), allNotes: notes });
  assert.equal(choir.classification, "instrument_mapping_error");
  assert.match(choir.reason, /violin section/);
  // With the 1.1 table the note is simply in range.
  assert.equal(calibrateWindow(window).verdict.playabilityErrors, 0);
});

test("breath: a phrase of separate attacks is notation, one note beyond a breath is not", () => {
  const phrase = Array.from({ length: 30 }, (_, i) => n(i * 0.5, 0.5, 67 + (i % 3), `p${i}`));
  const notation = classify(73, "pipe", phrase, "breath_violation", phrase.map((x) => x.id!));
  assert.equal(notation.classification, "judge_false_positive");
  assert.match(notation.reason, /encodes no breath/);
  const longTone = [n(0, 13, 60, "long")];
  assert.equal(classify(73, "pipe", longTone, "breath_violation", ["long"]).classification, "unusual_but_valid_technique");
  const drone = [n(0, 30, 60, "drone")];
  assert.equal(classify(73, "pipe", drone, "breath_violation", ["drone"]).classification, "ambiguous_case");
  const section = [n(0, 30, 60, "sec")];
  assert.equal(classify(61, "brass", section, "breath_violation", ["sec"]).classification, "instrument_mapping_error");
});

test("polyphony: a doubled pitch is a data problem, a tail is a data problem, a block chord on a trumpet is ambiguous, a harp chord is a mapping error", () => {
  const doubled = [n(0, 1, 60, "a"), n(0, 1, 60, "b")];
  assert.equal(classify(56, "brass", doubled, "excess_polyphony", ["a", "b"]).classification, "data_problem");
  const tail = [n(0, 0.5, 64, "a"), n(0.45, 0.5, 62, "b")];
  const tailClass = classify(56, "brass", tail, "excess_polyphony", ["a", "b"]);
  assert.equal(tailClass.classification, "data_problem");
  assert.match(tailClass.reason, /tail/);
  const divisi = [n(0, 1, 64, "a"), n(0, 1, 60, "b")];
  assert.equal(classify(56, "brass", divisi, "excess_polyphony", ["a", "b"]).classification, "ambiguous_case");
  const harp = [n(0, 1, 48, "a"), n(0, 1, 55, "b"), n(0, 1, 60, "c"), n(0, 1, 64, "d"), n(0, 1, 67, "e")];
  const harpClass = classify(46, "strings", harp, "excess_polyphony", ["a", "b", "c", "d", "e"]);
  assert.equal(harpClass.classification, "instrument_mapping_error");
  assert.match(harpClass.reason, /harp/);
});

test("voicing: held notes need no hand; organ pedals are feet; a tenth is a technique; a reduction is data", () => {
  const held = [n(0, 4, 36, "lo"), n(2, 1, 72, "a"), n(2, 1, 76, "b"), n(2, 1, 79, "c")];
  assert.equal(classify(0, "keys", held, "unplayable_voicing", ["lo", "a", "b", "c"]).classification, "judge_false_positive");
  const organ = [n(0, 2, 31, "ped"), n(0, 2, 55, "a"), n(0, 2, 60, "b"), n(0, 2, 67, "c"), n(0, 2, 72, "d")];
  assert.equal(classify(19, "organ", organ, "unplayable_voicing", ["ped", "a", "b", "c", "d"]).classification, "instrument_mapping_error");
  const tenth = [n(0, 2, 36, "a"), n(0, 2, 52, "b"), n(0, 2, 60, "c"), n(0, 2, 76, "d")];
  assert.equal(classify(0, "keys", tenth, "unplayable_voicing", ["a", "b", "c", "d"]).classification, "unusual_but_valid_technique");
  const reduction = [n(0, 2, 24, "a"), n(0, 2, 40, "b"), n(0, 2, 56, "c"), n(0, 2, 72, "d"), n(0, 2, 88, "e"), n(0, 2, 104, "f")];
  assert.equal(classify(0, "keys", reduction, "unplayable_voicing", ["a", "b", "c", "d", "e", "f"]).classification, "data_problem");
});

test("leap: between two voices it is not a melody; within the instrument's routine leap it is a register-model error", () => {
  const voices = [n(0, 2, 72, "a"), n(0.5, 0.5, 40, "b")];
  const twoVoices = classify(0, "keys", voices, "impossible_leap", ["a", "b"]);
  assert.equal(twoVoices.classification, "judge_false_positive");
  const octave = [n(0, 0.5, 40, "a"), n(0.5, 0.5, 52, "b")];
  assert.equal(classify(58, "brass", octave, "impossible_leap", ["a", "b"]).classification, "register_model_error");
  const wide = [n(0, 0.5, 40, "a"), n(0.5, 0.5, 60, "b")];
  assert.equal(classify(58, "brass", wide, "impossible_leap", ["a", "b"]).classification, "unusual_but_valid_technique");
  const absurd = [n(0, 0.5, 30, "a"), n(0.5, 0.5, 80, "b")];
  assert.equal(classify(58, "brass", absurd, "impossible_leap", ["a", "b"]).classification, "data_problem");
});

test("fingering: an open chord is a false positive; seven ringing notes with fingerable attacks are unreleased data", () => {
  const open = [n(0, 1, 40, "a"), n(0, 1, 47, "b"), n(0, 1, 52, "c"), n(0, 1, 56, "d"), n(0, 1, 59, "e"), n(0, 1, 64, "f")];
  const openClass = classify(24, "guitar", open, "impossible_fingering", open.map((x) => x.id!));
  assert.equal(openClass.classification, "judge_false_positive");
  assert.equal(openClass.facts.fingerable, "standard");
  const seven = [n(0, 4, 40, "r1"), n(0, 4, 45, "r2"), n(0, 4, 50, "r3"), n(0, 4, 55, "r4"), n(0, 4, 59, "r5"), n(0, 4, 64, "r6"), n(1, 1, 67, "x")];
  assert.equal(classify(24, "guitar", seven, "impossible_fingering", seven.map((x) => x.id!)).classification, "unusual_but_valid_technique", "a seventh string carries it");
  const ringing = [...seven, n(0, 4, 72, "r7")];
  assert.equal(classify(24, "guitar", ringing, "impossible_fingering", ringing.map((x) => x.id!)).classification, "data_problem");
});

test("drums: five voices at once is a notation a player renders; a doubled hit is data", () => {
  const five = [n(0, 0.1, 36, "k"), n(0, 0.1, 38, "s"), n(0, 0.1, 42, "h"), n(0, 0.1, 49, "c"), n(0, 0.1, 51, "r")];
  assert.equal(classify(128, "drums", five, "impossible_limb_count", five.map((x) => x.id!)).classification, "articulation_technique_exception");
  const doubled = [...five, n(0, 0.1, 36, "k2")];
  assert.equal(classify(128, "drums", doubled, "impossible_limb_count", doubled.map((x) => x.id!)).classification, "data_problem");
});

// ---------------------------------------------------------------------------
// The window through the judge, and the aggregate
// ---------------------------------------------------------------------------

test("calibrateWindow records every violation with its notes and facts, and the summary rates codes per family", () => {
  // Five trumpet notes struck together, every bar: beyond any one-staff divisi.
  const trumpetChords = Array.from({ length: 8 }, (_, bar) => [60, 64, 67, 72, 76].map((p) => n(bar * 2, 1, p, `${bar}-${p}`))).flat();
  const flagged = calibrateWindow(windowFor(56, "brass", trumpetChords));
  assert.ok(flagged.violations.some((v) => v.code === "excess_polyphony" && v.severity === "error"));
  const v = flagged.violations.find((x) => x.code === "excess_polyphony")!;
  assert.equal(v.program, 56);
  assert.equal(v.programName, "trumpet");
  assert.equal(v.platformInstrument, "brass");
  assert.equal(v.meter, "4/4");
  assert.equal(v.notes.length, 5);
  assert.equal(v.classification, "ambiguous_case");
  assert.equal(flagged.pitchMin, 60);
  assert.equal(flagged.pitchMax, 76);
  // Two notes struck together are divisi on one staff: a warning, counted but not classified.
  const divisi = calibrateWindow(windowFor(56, "brass", Array.from({ length: 8 }, (_, bar) => [n(bar * 2, 1, 64, `a${bar}`), n(bar * 2, 1, 60, `b${bar}`)]).flat()));
  assert.equal(divisi.verdict.playabilityErrors, 0);
  assert.ok(divisi.violations.some((x) => x.code === "excess_polyphony" && x.severity === "warning"));

  const clean = calibrateWindow(windowFor(56, "brass", Array.from({ length: 16 }, (_, i) => n(i, 0.9, 60 + (i % 5), `c${i}`))));
  assert.equal(clean.verdict.playabilityErrors, 0);

  const results: WindowCalibration[] = [flagged, clean, clean];
  const summary = summariseCalibration(results);
  assert.equal(summary.windows, 3);
  assert.equal(summary.windowsByFamily.brass, 3);
  assert.equal(summary.windowsWithErrors, 1);
  const cell = summary.codeFamily.find((c) => c.code === "excess_polyphony" && c.family === "brass")!;
  assert.equal(cell.flaggedWindows, 1);
  assert.equal(cell.flaggedShare, 0.3333);
  assert.equal(cell.byClass.ambiguous_case, 8);
  assert.equal(cell.verdict, "disable_for_family", "a third of human brass windows flagged is not a gate");
  assert.equal(summary.errorsByClass.ambiguous_case, 8);
  assert.equal(sampleCases(results, 2).length, 2, "at most two cases per code × family × class");
  const drums = calibrateWindow(windowFor(128, "drums", Array.from({ length: 16 }, (_, i) => n(i, 0.1, i % 2 ? 27 : 87, `d${i}`))));
  assert.equal(drums.verdict.range, null, "a kit has no pitch range");
  assert.equal(drums.verdict.playabilityErrors, 0);
});

test("gate verdicts follow the stated thresholds", () => {
  const clean = calibrateWindow(windowFor(56, "brass", Array.from({ length: 16 }, (_, i) => n(i, 0.9, 60 + (i % 5), `c${i}`))));
  const flagged = calibrateWindow(windowFor(56, "brass", [...Array.from({ length: 16 }, (_, i) => n(i, 0.9, 60 + (i % 5), `c${i}`)), n(0, 0.9, 20, "low")]));
  assert.ok(flagged.violations.some((v) => v.code === "out_of_range"));
  const many = Array.from({ length: 200 }, () => clean);
  const one = summariseCalibration([...many, flagged]);
  const cell = one.codeFamily.find((c) => c.code === "out_of_range")!;
  assert.ok(cell.flaggedShare <= GATE_THRESHOLDS.hardGateMaxFlaggedShare);
  assert.equal(cell.verdict, "hard_gate_ok");
  const warn = summariseCalibration([...many.slice(0, 40), flagged]);
  assert.equal(warn.codeFamily.find((c) => c.code === "out_of_range")!.verdict, "warning_only");
});
