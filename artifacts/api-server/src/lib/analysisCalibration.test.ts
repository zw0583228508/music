import assert from "node:assert/strict";
import test from "node:test";
import {
  DEFAULT_ENGINE_POINT,
  acceptableTempos,
  classifyOutcome,
  metricallyRelated,
  reliabilityDiagram,
  scoreEngine,
  splitByHash,
  tempoFromOnsets,
  tuneEngine,
  type CalibrationItem,
} from "./analysisCalibration";
import { buildCorpus, buildCorpusItem, CORPUS_FAMILIES } from "./analysisCalibrationCorpus";
import { judgeDomain } from "./analysisDisagreement";

test("reliability diagram: a perfectly calibrated analyser has ECE 0; an over-confident one has a positive gap", () => {
  const calibrated = [
    ...Array.from({ length: 7 }, () => ({ confidence: 0.7, correct: true })),
    ...Array.from({ length: 3 }, () => ({ confidence: 0.7, correct: false })),
  ];
  const diagram = reliabilityDiagram(calibrated, 10);
  assert.equal(diagram.count, 10);
  assert.equal(diagram.ece, 0);
  assert.equal(diagram.accuracy, 0.7);
  const overconfident = reliabilityDiagram(Array.from({ length: 10 }, () => ({ confidence: 0.9, correct: false })), 10);
  assert.equal(overconfident.ece, 0.9);
  assert.equal(overconfident.overconfidence, 0.9);
  assert.equal(reliabilityDiagram([]).count, 0);
});

test("the split is a deterministic function of the id and the salt", () => {
  const ids = Array.from({ length: 200 }, (_, index) => `item-${index}`);
  const first = splitByHash(ids, 0.4);
  const second = splitByHash(ids, 0.4);
  assert.deepEqual(first, second);
  assert.ok(first.heldOut.length > 50 && first.heldOut.length < 110, `held-out ${first.heldOut.length}`);
  assert.equal(first.train.length + first.heldOut.length, 200);
  assert.notDeepEqual(splitByHash(ids, 0.4, "other-salt"), first);
});

test("outcomes: correct, wrong, contested, unknown — with a tempo tolerance and ambiguous truths", () => {
  const clear = { acceptable: [120], ambiguousByConstruction: false };
  const ambiguous = { acceptable: [120, 60], ambiguousByConstruction: true };
  const right = judgeDomain("tempo", [{ provider: "BEAT_THIS", value: 121, confidence: 0.9 }]);
  assert.equal(classifyOutcome("tempo", right, clear), "resolved_correct");
  const half = judgeDomain("tempo", [{ provider: "BEAT_THIS", value: 60, confidence: 0.9 }]);
  assert.equal(classifyOutcome("tempo", half, clear), "resolved_wrong");
  assert.equal(classifyOutcome("tempo", half, ambiguous), "resolved_correct");
  const contested = judgeDomain("tempo", [
    { provider: "BEAT_THIS", value: 120, confidence: 0.9 },
    { provider: "MADMOM", value: 60, confidence: 0.9 },
  ]);
  assert.equal(classifyOutcome("tempo", contested, clear), "contested");
  assert.equal(classifyOutcome("tempo", judgeDomain("tempo", []), clear), "unknown");
  const metrics = scoreEngine([
    { id: "a", outcome: "resolved_correct", ambiguousByConstruction: false },
    { id: "b", outcome: "resolved_wrong", ambiguousByConstruction: false },
    { id: "c", outcome: "contested", ambiguousByConstruction: true },
    { id: "d", outcome: "contested", ambiguousByConstruction: false },
  ]);
  assert.equal(metrics.contestRateOnAmbiguous, 1);
  assert.equal(metrics.contestRateOnClear, round3(1 / 3));
  assert.equal(metrics.wrongRate, 0.25);
  assert.equal(metrics.utility, round3((1 - 3 + 1 - 0.5) / 4));
});

const round3 = (value: number) => Number(value.toFixed(4));

test("tuning picks the point that stops a systematically wrong provider from winning, on the train split only", () => {
  // A spectral key reader that is wrong on half the items with confidence
  // 0.6, against a transcription key that is right with confidence 0.5. With
  // the registry weights the spectrum (0.45) and the transcription (0.5)
  // tie into contests; the tuner should learn to trust the transcription.
  const items: CalibrationItem[] = Array.from({ length: 40 }, (_, index) => ({
    id: `k-${index}`,
    domain: "key",
    observations: [
      { provider: "LOCAL_SIGNAL_ANALYZER_V1", value: index % 2 ? "C major" : "G major", confidence: 0.6 },
      { provider: "TRANSCRIPTION_KEY_V1", value: "C major", confidence: 0.5 },
    ],
    truth: { acceptable: ["C major"], ambiguousByConstruction: false },
  }));
  const defaults = DEFAULT_ENGINE_POINT("key", ["LOCAL_SIGNAL_ANALYZER_V1", "TRANSCRIPTION_KEY_V1"]);
  const result = tuneEngine(items, {
    contestFloor: [0.15, 0.25],
    contestRatio: [0.4, 0.6],
    weights: { LOCAL_SIGNAL_ANALYZER_V1: [0.2, 0.45], TRANSCRIPTION_KEY_V1: [0.5, 0.8] },
  }, defaults);
  assert.ok(result.improved);
  assert.ok(result.bestUtility > result.defaultUtility);
  assert.ok(result.best.weights.TRANSCRIPTION_KEY_V1! > result.best.weights.LOCAL_SIGNAL_ANALYZER_V1!);
  assert.equal(result.trials, 16);
  // Ties break toward the defaults: an all-equal corpus keeps them.
  const flat = tuneEngine([], { contestFloor: [0.15, 0.25], contestRatio: [0.4], weights: {} }, defaults);
  assert.deepEqual(flat.best, defaults);
  assert.equal(flat.improved, false);
});

test("tempoFromOnsets reads a uniform pulse at its own rate and folds eighths to the quarter", () => {
  const quarters = Array.from({ length: 64 }, (_, index) => index * 0.5); // 120 BPM quarters
  const quarterRead = tempoFromOnsets(quarters);
  assert.ok(quarterRead && Math.abs(quarterRead.bpm - 120) < 1, JSON.stringify(quarterRead));
  const eighths = Array.from({ length: 128 }, (_, index) => index * 0.25);
  const eighthRead = tempoFromOnsets(eighths);
  assert.ok(eighthRead && Math.abs(eighthRead.bpm - 120) < 1, "240 folds to 120");
  assert.equal(tempoFromOnsets([0, 1, 2]), null);
});

test("truth helpers: compound metres accept the quarter reading; metrical relatives are recognised", () => {
  assert.deepEqual(acceptableTempos({ bpm: 80, quarterBpm: 120 }), [80, 120]);
  assert.deepEqual(acceptableTempos({ bpm: 120, quarterBpm: 120 }), [120]);
  assert.equal(metricallyRelated(60, [120]), true);
  assert.equal(metricallyRelated(180, [120]), true);
  assert.equal(metricallyRelated(97, [120]), false);
});

test("the synthetic corpus is deterministic, truthful about its own ambiguity, and never mixes tiers", () => {
  const corpus = buildCorpus(2);
  assert.equal(corpus.length, CORPUS_FAMILIES.length * 2);
  assert.deepEqual(buildCorpusItem("clear_four_four", 0), buildCorpusItem("clear_four_four", 0));
  const byFamily = Object.fromEntries(corpus.map((item) => [item.family, item]));
  assert.deepEqual(byFamily.half_double_trap!.acceptable.tempo, [byFamily.half_double_trap!.tempo.bpm, byFamily.half_double_trap!.tempo.bpm / 2]);
  assert.equal(byFamily.half_double_trap!.ambiguous.tempo, true);
  assert.deepEqual(byFamily.six_eight_vs_three_four!.acceptable.meter, ["6/8", "3/4"]);
  assert.equal(byFamily.six_eight_vs_three_four!.tempo.quarterBpm, byFamily.six_eight_vs_three_four!.tempo.bpm * 1.5);
  assert.equal(byFamily.relative_key_trap!.acceptable.key.length, 2);
  assert.equal(byFamily.relative_key_trap!.ambiguous.key, true);
  assert.equal(byFamily.clear_minor!.ambiguous.key, false);
  assert.deepEqual(byFamily.uniform_energy!.truth.sectionStartBars, [1]);
  assert.deepEqual(byFamily.clear_four_four!.truth.sectionStartBars, [1, 9, 17]);
  for (const item of corpus) {
    assert.equal(item.truth.chords.length, 24);
    assert.equal(item.truth.bars.length, 24);
    assert.ok(item.truth.notes.length > 100, item.id);
    assert.ok(item.midi.notes.every((note) => note.endTick > note.startTick), item.id);
    assert.equal(item.midi.timeSignatures[0]!.numerator, Number(item.meter.split("/")[0]));
    assert.ok(item.durationSeconds > 20 && item.durationSeconds < 130, `${item.id} ${item.durationSeconds}`);
  }
  // The relative-key trap's progression never lands on either tonic as a cadence chord at phrase end.
  const trap = byFamily.relative_key_trap!;
  assert.equal(trap.truth.chords[3]!.symbol, trap.truth.chords[23]!.symbol);
});
