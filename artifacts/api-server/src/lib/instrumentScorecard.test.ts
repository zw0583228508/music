import assert from "node:assert/strict";
import test from "node:test";
import type { PartMetrics } from "./partJudge";
import {
  HUMAN_ARM, REFERENCE_ARM, buildInstrumentScorecard, idiomaticRegisterShare, renderInstrumentScorecard, type ScorecardEntry,
} from "./instrumentScorecard";

const metrics = (over: Partial<PartMetrics> = {}): PartMetrics => ({
  noteCount: 20, playabilityErrors: 0, rangeShare: 1, registerShare: 1, chordToneShare: 0.8, coverage: 1, densityLogRatio: 0,
  barRepetitionShare: 0, intervalDistance: 0, contextClashShare: 0, distinctPitches: 8, singlePitch: false, ...over,
});

const entry = (family: string, program: number, provider: string, score: number, task = `${family}-1`, over: Partial<PartMetrics> = {}, pitches?: number[]): ScorecardEntry => ({
  taskId: task, targetFamily: family, targetInst: program, providerId: provider, seed: 7, score, metrics: metrics(over), failure: null, pitches: pitches ?? null,
});

/** Two families where a different machine arm wins each: the shape the design question is about. */
function fixture(): ScorecardEntry[] {
  const CA2 = "CA2";
  return [
    entry("brass", 58, HUMAN_ARM, 95, "brass-1", { playabilityErrors: 0 }, [40, 45, 50]),
    entry("brass", 58, REFERENCE_ARM, 70, "brass-1", { coverage: 0.4, chordToneShare: 1, densityLogRatio: -2 }),
    entry("brass", 58, CA2, 50, "brass-1", { playabilityErrors: 3, coverage: 1 }, [40, 45, 70, 72]),
    entry("bass", 33, HUMAN_ARM, 90, "bass-1"),
    entry("bass", 33, REFERENCE_ARM, 45, "bass-1", { coverage: 0.5, densityLogRatio: -2.5 }),
    entry("bass", 33, CA2, 80, "bass-1", { coverage: 1, densityLogRatio: 0.3 }, [40, 43, 45]),
  ];
}

test("idiomatic register share uses the instrument's standard range, not the judge's", () => {
  // Tuba standard range 26–65: 70 and 72 are outside it.
  assert.equal(idiomaticRegisterShare([40, 45, 70, 72], 58), 0.5);
  assert.equal(idiomaticRegisterShare([], 58), null);
  assert.equal(idiomaticRegisterShare(null, 58), null);
  // The drum kit has no pitch range.
  assert.equal(idiomaticRegisterShare([36, 38, 42], 128), null);
});

test("one card per family × arm, with deltas from the human and win rates against the human and the reference", () => {
  const card = buildInstrumentScorecard(fixture(), { sources: ["fixture"] });
  assert.deepEqual(card.families.map((f) => f.family), ["bass", "brass"]);
  const brass = card.families.find((f) => f.family === "brass")!;
  assert.equal(brass.tasks, 1);
  assert.deepEqual(brass.programs, [58]);
  const ca2 = brass.arms.find((a) => a.providerId === "CA2")!;
  assert.equal(ca2.meanScore, 50);
  assert.equal(ca2.playabilityErrorsPerEntry, 3);
  assert.equal(ca2.idiomaticRegisterShare, 0.5);
  assert.equal(ca2.vsHuman.meanScore, -45);
  assert.equal(ca2.vsHuman.playabilityErrorsPerEntry, 3);
  assert.equal(ca2.winRateVsHuman, 0);
  assert.equal(ca2.winRateVsReference, 0);
  const reference = brass.arms.find((a) => a.providerId === REFERENCE_ARM)!;
  assert.equal(reference.winRateVsReference, null);
  assert.equal(reference.winRateVsHuman, 0);
  const human = brass.arms.find((a) => a.providerId === HUMAN_ARM)!;
  assert.equal(human.winRateVsHuman, null);
  assert.equal(human.winRateVsReference, 1);
  assert.equal(brass.bestMachineArm?.providerId, REFERENCE_ARM);
  assert.equal(brass.bestMachineArm?.marginOverNext, 20);
});

test("strengths and weaknesses read the numbers, not the arm's name", () => {
  const card = buildInstrumentScorecard(fixture());
  const brass = card.families.find((f) => f.family === "brass")!;
  const ca2 = brass.arms.find((a) => a.providerId === "CA2")!;
  assert.ok(ca2.weaknesses.some((w) => /unplayable notes: 3/.test(w)), ca2.weaknesses.join("; "));
  assert.ok(ca2.weaknesses.some((w) => /register: only 50%/.test(w)));
  assert.ok(ca2.strengths.some((s) => /full: plays in 100%/.test(s)));
  const reference = brass.arms.find((a) => a.providerId === REFERENCE_ARM)!;
  assert.ok(reference.weaknesses.some((w) => /thin: plays in 40%/.test(w)));
  assert.ok(reference.weaknesses.some((w) => /chord tones only/.test(w)));
  assert.ok(reference.weaknesses.some((w) => /density 2\.00 octave/.test(w)));
  assert.ok(reference.strengths.some((s) => /highest proxy score/.test(s)));
  // The human arm is the anchor, never annotated.
  const human = brass.arms.find((a) => a.providerId === HUMAN_ARM)!;
  assert.deepEqual(human.strengths, []);
});

test("the design reading prices an oracle router against the best single arm, family by family", () => {
  const card = buildInstrumentScorecard(fixture());
  // CA2: (50 + 80) / 2 = 65; REFERENCE: (70 + 45) / 2 = 57.5 → CA2 is the best single arm.
  assert.equal(card.design.bestSingleArm?.providerId, "CA2");
  assert.equal(card.design.bestSingleArm?.meanOverFamilies, 65);
  // Oracle: brass → REFERENCE 70, bass → CA2 80 → 75.
  assert.equal(card.design.oraclePerFamilyMean, 75);
  assert.equal(card.design.routerGainPoints, 10);
  assert.deepEqual(card.design.familiesWhereBestDiffers, [
    { family: "brass", bestArm: REFERENCE_ARM, bestScore: 70, singleArmScore: 50, gain: 20 },
  ]);
  assert.equal(card.design.playability.bestSingleArm, REFERENCE_ARM);
  assert.equal(card.design.playability.oracleErrors, 0);
  assert.ok(card.design.caveats.length >= 3);
});

test("with the notes recovered, playability is re-judged under the calibrated judge, not read off judge 1.0", () => {
  // A trumpet phrase of separate attacks over 20 s: judge 1.0 called every
  // such phrase a breath violation (the calibration classified 4,772 of 4,772
  // as notation). The stored metric says 4 errors; the calibrated judge says 0.
  const phrase = Array.from({ length: 40 }, (_, i) => ({ id: `p${i}`, start: i * 0.5, duration: 0.5, pitch: 64 + (i % 3), velocity: 90 }));
  const rows: ScorecardEntry[] = [
    { ...entry("brass", 56, HUMAN_ARM, 90, "brass-2", { playabilityErrors: 4 }), notes: phrase, tempoBpm: 120 },
    { ...entry("brass", 56, REFERENCE_ARM, 60, "brass-2", { playabilityErrors: 0 }), notes: [{ id: "x", start: 0, duration: 1, pitch: 20, velocity: 90 }], tempoBpm: 120 },
  ];
  const card = buildInstrumentScorecard(rows);
  const brass = card.families.find((f) => f.family === "brass")!;
  const human = brass.arms.find((a) => a.providerId === HUMAN_ARM)!;
  assert.equal(human.playabilityErrorsPerEntry, 4, "as the tournament stored it");
  assert.equal(human.playabilityErrorsCalibrated, 0, "notation, not a breath violation");
  // And a note under any trumpet (20, floor 46) is still an error.
  const reference = brass.arms.find((a) => a.providerId === REFERENCE_ARM)!;
  assert.equal(reference.playabilityErrorsCalibrated, 1);
  assert.ok(reference.weaknesses.some((w) => /unplayable notes: 1 errors per entry \(calibrated judge\)/.test(w)), reference.weaknesses.join("; "));
});

test("a tie between arms is not a family that changes hands", () => {
  const rows = fixture().map((e) => (e.providerId === REFERENCE_ARM && e.targetFamily === "brass" ? { ...e, score: 50 } : e));
  const card = buildInstrumentScorecard(rows);
  assert.deepEqual(card.design.familiesWhereBestDiffers, []);
});

test("failed entries count as failures and do not enter the means", () => {
  const rows = [...fixture(), { ...entry("bass", 33, "CA2", 0, "bass-1"), failure: "timeout", seed: 11 }];
  const card = buildInstrumentScorecard(rows);
  const ca2 = card.families.find((f) => f.family === "bass")!.arms.find((a) => a.providerId === "CA2")!;
  assert.equal(ca2.entries, 2);
  assert.equal(ca2.failures, 1);
  assert.equal(ca2.meanScore, 80);
});

test("the markdown rendering carries one table per family and one line per machine arm", () => {
  const md = renderInstrumentScorecard(buildInstrumentScorecard(fixture()));
  assert.match(md, /### bass — 1 task\(s\), GM 33/);
  assert.match(md, /### brass — 1 task\(s\), GM 58/);
  assert.match(md, /\| CA2 \| 1 \| 50\.0 \| 3\.00 \|/);
  assert.ok(!/\*\*HUMAN_ORIGIN_REFERENCE\*\* — strong/.test(md), "the human is not scored for strengths");
  assert.match(md, /\*\*CA2\*\* — strong: .*Weak: .*unplayable notes/);
});
