import assert from "node:assert/strict";
import test from "node:test";
import {
  DEFAULT_DISAGREEMENT_THRESHOLDS,
  boundaryAgreement,
  judgeChordBars,
  judgeDomain,
  judgeSections,
  normalizeKeyLabel,
  parseChordLabel,
  relationBetween,
  whatWouldSettleIt,
} from "./analysisDisagreement";
import { reconcileAnalysisDomains, reconcileAnalysisField } from "./analysisReconciliation";

// ---------------------------------------------------------------------------
// The four statuses
// ---------------------------------------------------------------------------

test("UNKNOWN: no observations, and nothing to choose between", () => {
  const empty = judgeDomain("tempo", []);
  assert.equal(empty.status, "unknown");
  assert.equal(empty.value, null);
  assert.deepEqual(empty.candidates, []);
  assert.ok(empty.whatWouldSettleIt?.includes("beat tracker"));

  // Two weak observations that disagree: neither carries enough weight to be a
  // candidate, so this is not a contest either.
  const weak = judgeDomain("key", [
    { provider: "LOCAL_SIGNAL_ANALYZER_V1", value: "G minor", confidence: 0.2 },
    { provider: "TRANSCRIPTION_KEY_V1", value: "Eb major", confidence: 0.2 },
  ]);
  assert.equal(weak.status, "unknown");
  assert.deepEqual(weak.candidates, []);
});

test("CONTESTED: two weighty candidates, no usable margin, value null, both carried", () => {
  const verdict = judgeDomain("tempo", [
    { provider: "BEAT_THIS", value: 120, confidence: 0.9 },
    { provider: "MADMOM", value: 60, confidence: 0.9 },
  ]);
  assert.equal(verdict.status, "contested");
  assert.equal(verdict.value, null);
  assert.equal(verdict.confidence, null);
  assert.deepEqual(verdict.candidates.map((item) => item.value), [120, 60]);
  assert.equal(verdict.candidates[0]!.relationToLeader, null);
  assert.equal(verdict.candidates[1]!.relationToLeader, "half_double_tempo");
  assert.equal(verdict.relation, "half_double_tempo");
  assert.ok(verdict.message?.includes("half double tempo"));
  assert.ok(verdict.whatWouldSettleIt?.includes("bar length"));
});

test("LOW_CONFIDENCE: one usable observation, carried as a value and flagged", () => {
  const verdict = judgeDomain("key", [
    { provider: "ESSENTIA", value: "D major", confidence: 0.95 },
    { provider: "LOCAL_SIGNAL_ANALYZER_V1", value: "A major", confidence: 0.1 },
  ]);
  assert.equal(verdict.status, "low_confidence");
  assert.equal(verdict.value, "D major");
  // The noise beside it is not a candidate.
  assert.deepEqual(verdict.candidates.map((item) => item.value), ["D major"]);
  assert.ok(verdict.whatWouldSettleIt);
});

test("DETECTED: two providers agree with a margin; the runner-up is still carried with its relation", () => {
  const verdict = judgeDomain("tempo", [
    { provider: "BEAT_THIS", value: 120, confidence: 0.9 },
    { provider: "MADMOM", value: 121, confidence: 0.9 },
    { provider: "ALL_IN_ONE", value: 60, confidence: 0.9 },
  ]);
  assert.equal(verdict.status, "detected");
  // The cluster reads as its first member in provider order (ALL_IN_ONE,
  // BEAT_THIS, MADMOM), the same determinism rule PR-86 relies on.
  assert.equal(verdict.value, 120);
  assert.equal(verdict.whatWouldSettleIt, null);
  assert.deepEqual(verdict.candidates.map((item) => item.value), [120, 60]);
  assert.equal(verdict.candidates[1]!.relationToLeader, "half_double_tempo");

  // A weak local runner-up far below the contest ratio is not a candidate at all.
  const noisy = judgeDomain("tempo", [
    { provider: "BEAT_THIS", value: 120, confidence: 0.9 },
    { provider: "MADMOM", value: 121, confidence: 0.9 },
    { provider: "LOCAL_SIGNAL_ANALYZER_V1", value: 60, confidence: 0.7 },
  ]);
  assert.equal(noisy.status, "detected");
  assert.deepEqual(noisy.candidates.map((item) => item.value), [120]);
});

// ---------------------------------------------------------------------------
// Relations
// ---------------------------------------------------------------------------

test("tempo relations: half/double, 3:2, near, unrelated", () => {
  assert.equal(relationBetween("tempo", 120, 60), "half_double_tempo");
  assert.equal(relationBetween("tempo", 60, 240), "half_double_tempo");
  assert.equal(relationBetween("tempo", 80, 120), "triple_ratio_tempo");
  assert.equal(relationBetween("tempo", 120, 127), "near_tempo");
  assert.equal(relationBetween("tempo", 120, 121), "same");
  assert.equal(relationBetween("tempo", 120, 97), "unrelated");
});

test("metre relations: 6/8 vs 3/4, 2/4 vs 4/4, 12/8 vs 4/4", () => {
  assert.equal(relationBetween("meter", "6/8", "3/4"), "triple_duple_meter");
  assert.equal(relationBetween("meter", "4/4", "2/4"), "same_pulse_regrouped");
  assert.equal(relationBetween("meter", "12/8", "4/4"), "compound_simple_meter");
  assert.equal(relationBetween("meter", "4/4", "4/4"), "same");
  assert.equal(relationBetween("meter", "5/4", "4/4"), "unrelated");
});

test("key relations: relative, parallel, dominant, subdominant, enharmonic spelling folds", () => {
  assert.equal(relationBetween("key", "Eb major", "C minor"), "relative");
  assert.equal(relationBetween("key", "C minor", "Eb major"), "relative");
  assert.equal(relationBetween("key", "C major", "C minor"), "parallel");
  assert.equal(relationBetween("key", "C major", "G major"), "dominant");
  assert.equal(relationBetween("key", "C major", "F major"), "subdominant");
  assert.equal(relationBetween("key", "C major", "G minor"), "dominant");
  assert.equal(relationBetween("key", "C# major", "Db major"), "same");
  assert.equal(normalizeKeyLabel("Db major"), "C# major");
  assert.equal(relationBetween("key", "C major", "F# major"), "unrelated");
});

test("the owner's second upload: Eb major vs G minor is mediant-related, and contested", () => {
  assert.equal(relationBetween("key", "Eb major", "G minor"), "mediant");
  const verdict = judgeDomain("key", [
    { provider: "LOCAL_SIGNAL_ANALYZER_V1", value: "G minor", confidence: 0.6 },
    { provider: "TRANSCRIPTION_KEY_V1", value: "E♭ major", confidence: 0.69 },
  ]);
  assert.equal(verdict.status, "contested");
  assert.equal(verdict.relation, "mediant");
  assert.ok(verdict.whatWouldSettleIt?.toLowerCase().includes("cadence"));
});

test("chord relations: same root other quality, relative chord, unrelated", () => {
  assert.deepEqual(parseChordLabel("Am7"), { root: 9, quality: "min" });
  assert.deepEqual(parseChordLabel("Cmaj7"), { root: 0, quality: "maj" });
  assert.deepEqual(parseChordLabel("G7"), { root: 7, quality: "maj" });
  assert.equal(relationBetween("chords", "C", "Cm"), "same_root_other_quality");
  assert.equal(relationBetween("chords", "C", "Am"), "relative_chord");
  assert.equal(relationBetween("chords", "C", "F#"), "unrelated");
  assert.equal(relationBetween("chords", "C", "C"), "same");
});

test("whatWouldSettleIt names the evidence for each open relation, and nothing for a detected field", () => {
  assert.equal(whatWouldSettleIt("key", "detected", null), null);
  assert.ok(whatWouldSettleIt("key", "contested", "relative")?.includes("tonic"));
  assert.ok(whatWouldSettleIt("meter", "contested", "triple_duple_meter")?.includes("accent"));
  assert.ok(whatWouldSettleIt("tempo", "contested", "triple_ratio_tempo")?.includes("metre"));
  assert.ok(whatWouldSettleIt("sections", "unknown", null)?.includes("structure"));
});

// ---------------------------------------------------------------------------
// Thresholds and reliability are parameters (what the calibration tunes)
// ---------------------------------------------------------------------------

test("thresholds and the reliability lookup are injectable, and defaults are the exported ones", () => {
  const observations = [
    { provider: "LOCAL_SIGNAL_ANALYZER_V1", value: "G minor", confidence: 0.6 },
    { provider: "TRANSCRIPTION_KEY_V1", value: "Eb major", confidence: 0.69 },
  ];
  const withDefaults = judgeDomain("key", observations);
  assert.equal(withDefaults.status, "contested");
  // Trusting the transcription far more than the spectrum settles it.
  const trustingTranscription = judgeDomain("key", observations, {
    reliability: (provider) => (provider === "TRANSCRIPTION_KEY_V1" ? 0.95 : 0.2),
  });
  assert.equal(trustingTranscription.status, "low_confidence");
  assert.equal(trustingTranscription.value, "Eb major");
  // A floor above both weights makes the same pair unknown, never a pick.
  const strict = judgeDomain("key", observations, { thresholds: { contestFloor: 0.9 } });
  assert.equal(strict.status, "unknown");
  assert.equal(DEFAULT_DISAGREEMENT_THRESHOLDS.contestFloor > 0, true);
});

// ---------------------------------------------------------------------------
// Chords per bar
// ---------------------------------------------------------------------------

test("chords are judged per bar and never averaged: a contested bar keeps both symbols", () => {
  const verdict = judgeChordBars([
    { bar: 1, observations: [
      { provider: "SHEETSAGE", value: "C", confidence: 0.7 },
      { provider: "ESSENTIA", value: "C", confidence: 0.85 },
    ] },
    { bar: 2, observations: [
      { provider: "SHEETSAGE", value: "Am", confidence: 0.7 },
      { provider: "ESSENTIA", value: "C", confidence: 0.85 },
    ] },
    { bar: 3, observations: [{ provider: "SHEETSAGE", value: "F", confidence: 0.8 }] },
    { bar: 4, observations: [] },
  ]);
  assert.equal(verdict.summary.evidenced, 3);
  assert.equal(verdict.summary.detected, 1);
  assert.equal(verdict.summary.lowConfidence, 1);
  assert.equal(verdict.summary.contested, 1);
  assert.equal(verdict.contestedBars.length, 1);
  assert.equal(verdict.contestedBars[0]!.bar, 2);
  assert.deepEqual(verdict.contestedBars[0]!.candidates.map((item) => item.value).sort(), ["Am", "C"]);
  assert.equal(verdict.contestedBars[0]!.relation, "relative_chord");
  // One contested bar of three is below the track-level contest share, but the
  // track is not detected either.
  assert.equal(verdict.status, "low_confidence");
});

test("a chord track is contested as a whole when enough bars are", () => {
  const bars = Array.from({ length: 8 }, (_, index) => ({
    bar: index + 1,
    observations: [
      { provider: "SHEETSAGE", value: index % 2 ? "Am" : "C", confidence: 0.7 },
      { provider: "ESSENTIA", value: "C", confidence: 0.85 },
    ],
  }));
  const verdict = judgeChordBars(bars);
  assert.equal(verdict.summary.contested, 4);
  assert.equal(verdict.status, "contested");
  assert.ok(verdict.message?.includes("competing chords"));
  const none = judgeChordBars([{ bar: 1, observations: [] }]);
  assert.equal(none.status, "unknown");
});

// ---------------------------------------------------------------------------
// Sections as boundary sets
// ---------------------------------------------------------------------------

test("boundary agreement at a one-bar tolerance", () => {
  assert.deepEqual(boundaryAgreement([1, 9, 17], [1, 10, 17]), { precision: 1, recall: 1, f1: 1 });
  const partial = boundaryAgreement([1, 9, 17, 25], [1, 17]);
  assert.equal(partial.precision, 0.5);
  assert.equal(partial.recall, 1);
});

test("sections: agreeing cuts are detected, a coarser vs finer cut is contested with that relation, labels never decide", () => {
  const agreed = judgeSections([
    { provider: "ALL_IN_ONE", boundaries: [1, 9, 17, 25], confidence: 0.9 },
    { provider: "SONGFORMER", boundaries: [1, 9, 18, 25], confidence: 0.9 },
  ]);
  assert.equal(agreed.status, "detected");
  assert.deepEqual(agreed.boundaries, [1, 9, 17, 25]);

  const split = judgeSections([
    { provider: "ALL_IN_ONE", boundaries: [1, 17], confidence: 0.9 },
    { provider: "SONGFORMER", boundaries: [1, 9, 17, 25], confidence: 0.9 },
  ]);
  assert.equal(split.status, "contested");
  assert.equal(split.relation, "coarser_finer");
  assert.equal(split.boundaries, null);
  assert.equal(split.candidates.length, 2);

  const local = judgeSections([
    { provider: "LOCAL_SIGNAL_ANALYZER_V1", boundaries: [1, 12], confidence: 0.35 },
  ]);
  assert.equal(local.status, "unknown", "a lone local energy cut is not evidence of structure");
});

// ---------------------------------------------------------------------------
// The PR-86 contract still holds through the wrapper
// ---------------------------------------------------------------------------

test("reconcileAnalysisField keeps the PR-86 shape and adds relation + whatWouldSettleIt", () => {
  const result = reconcileAnalysisField("key", [
    { provider: "LOCAL_SIGNAL_ANALYZER_V1", value: "G minor", confidence: 0.6 },
    { provider: "TRANSCRIPTION_KEY_V1", value: "E♭ major", confidence: 0.69 },
  ]);
  assert.equal(result.status, "contested");
  assert.equal(result.relation, "mediant");
  assert.equal(result.candidates[1]!.relationToLeader, "mediant");
  assert.ok(result.whatWouldSettleIt);
  const lone = reconcileAnalysisField("key", [{ provider: "ESSENTIA", value: "C major", confidence: 0.9 }]);
  assert.equal(lone.status, "low_confidence");
  assert.deepEqual(lone.candidates, [], "candidates stay empty unless contested, as PR-86 readers expect");
  const none = reconcileAnalysisField("key", []);
  assert.equal(none.status, "not_available");
});

test("reconcileAnalysisDomains reports the four-way verdicts and the engine thresholds", () => {
  const report = reconcileAnalysisDomains({
    tempo: [
      { provider: "BEAT_THIS", value: 120, confidence: 0.9 },
      { provider: "MADMOM", value: 60, confidence: 0.9 },
    ],
    key: [
      { provider: "LOCAL_SIGNAL_ANALYZER_V1", value: "G minor", confidence: 0.2 },
      { provider: "TRANSCRIPTION_KEY_V1", value: "Eb major", confidence: 0.2 },
    ],
    meter: [{ provider: "ALL_IN_ONE", value: "4/4", confidence: 0.9 }],
  });
  assert.deepEqual(report.verdicts, { tempo: "contested", key: "unknown", meter: "low_confidence" });
  assert.equal(report.domains.tempo?.status, "contested");
  assert.equal(report.domains.key?.status, "not_available");
  assert.equal(report.engine?.version, "disagreement-engine-1.0");
  assert.equal(report.engine?.thresholds.contestFloor, DEFAULT_DISAGREEMENT_THRESHOLDS.contestFloor);
  // The PR-86 meaning of contestedDomains (everything not detected) is kept.
  assert.deepEqual(report.contestedDomains.sort(), ["key", "meter", "tempo"]);
});
