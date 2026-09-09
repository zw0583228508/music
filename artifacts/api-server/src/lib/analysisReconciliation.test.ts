import assert from "node:assert/strict";
import test from "node:test";
import { reconcileAnalysisField } from "./analysisReconciliation";

test("clusters nearby independent tempo observations deterministically", () => {
  const result = reconcileAnalysisField("tempo", [
    { provider: "MADMOM", value: 120, confidence: .9 },
    { provider: "BEAT_THIS", value: 122, confidence: .9 },
    { provider: "ALL_IN_ONE", value: 91, confidence: .95 },
  ]);
  // Cluster representatives follow stable provider ordering, rather than
  // response arrival order.
  assert.equal(result.value, 122);
  assert.equal(result.status, "detected");
  assert.deepEqual(result.providers, ["BEAT_THIS", "MADMOM"]);
  assert.ok((result.margin ?? 0) > .12);
});

test("does not count repeated evidence from one provider as corroboration", () => {
  const result = reconcileAnalysisField("key", [
    { provider: "ESSENTIA", value: "C major", confidence: .9 },
    { provider: "ESSENTIA", value: "C major", confidence: .8 },
  ]);
  assert.equal(result.value, "C major");
  assert.equal(result.status, "low_confidence");
  assert.deepEqual(result.providers, ["ESSENTIA"]);
});

test("marks competing meter evidence contested, carrying both candidates and no value", () => {
  const result = reconcileAnalysisField("meter", [
    { provider: "ALL_IN_ONE", value: "4/4", confidence: .94 },
    { provider: "STANDARD_MIDI", value: "3/4", confidence: .8 },
  ]);
  assert.equal(result.value, null);
  assert.equal(result.status, "contested");
  assert.deepEqual(result.providers, []);
  assert.deepEqual(result.candidates.map((item) => item.value).sort(), ["3/4", "4/4"]);
  assert.deepEqual(
    Object.fromEntries(result.candidates.map((item) => [item.value, item.providers])),
    { "4/4": ["ALL_IN_ONE"], "3/4": ["STANDARD_MIDI"] },
  );
  // Strongest first.
  assert.ok(result.candidates[0]!.score >= result.candidates[1]!.score);
  assert.ok(result.candidates.every((item) => item.score > 0 && item.score <= 1));
  assert.ok(result.message?.includes("disagree"));
});

test("the owner's second upload: spectral G minor vs transcription E-flat major is contested, not rejected", () => {
  // The real failure of 2026-09-09: LOCAL_SIGNAL_ANALYZER_V1 and the key read
  // off 1,769 transcribed notes disagreed, and the whole Song Model was refused.
  const result = reconcileAnalysisField("key", [
    { provider: "LOCAL_SIGNAL_ANALYZER_V1", value: "G minor", confidence: .6 },
    { provider: "TRANSCRIPTION_KEY_V1", value: "E♭ major", confidence: .69 },
  ]);
  assert.equal(result.status, "contested");
  assert.equal(result.value, null);
  assert.deepEqual(result.candidates.map((item) => item.value).sort(), ["Eb major", "G minor"]);
  // Strongest first, and neither candidate is promoted to the value.
  assert.ok(result.candidates[0]!.score >= result.candidates[1]!.score);
});

test("a single usable observation beside noise is low confidence, not a contest", () => {
  const result = reconcileAnalysisField("key", [
    { provider: "ESSENTIA", value: "D major", confidence: .95 },
    { provider: "LOCAL_SIGNAL_ANALYZER_V1", value: "A major", confidence: .1 },
  ]);
  assert.notEqual(result.status, "contested");
  assert.deepEqual(result.candidates, []);
});

test("two weak observations that disagree stay not available: nothing worth choosing between", () => {
  const result = reconcileAnalysisField("key", [
    { provider: "LOCAL_SIGNAL_ANALYZER_V1", value: "G minor", confidence: .2 },
    { provider: "TRANSCRIPTION_KEY_V1", value: "E♭ major", confidence: .2 },
  ]);
  assert.equal(result.status, "not_available");
  assert.deepEqual(result.candidates, []);
});

test("normalizes key aliases before clustering", () => {
  const result = reconcileAnalysisField("key", [
    { provider: "ESSENTIA", value: "f♯ min", confidence: .9 },
  ]);
  assert.equal(result.value, "F# minor");
});
test("reconcileAnalysisDomains scores agreement per domain", async () => {
  const { reconcileAnalysisDomains } = await import("./analysisReconciliation");
  const report = reconcileAnalysisDomains({
    tempo: [
      { provider: "BEAT_THIS", value: 120, confidence: 0.9 },
      { provider: "ALL_IN_ONE", value: 121, confidence: 0.9 },
    ],
    key: [
      { provider: "ESSENTIA", value: "C major", confidence: 0.9 },
      { provider: "LOCAL_SIGNAL_ANALYZER_V1", value: "A minor", confidence: 0.6 },
    ],
    sections: [],
  });
  assert.equal(report.version, "1.0");
  assert.equal(report.domains.tempo?.status, "detected");
  assert.equal(report.domains.tempo?.value, 121);
  assert.ok(!("sections" in report.domains), "domains with no observations are omitted");
  assert.ok(report.consensusScore > 0 && report.consensusScore <= 1);
  // Key disagreement with a weak second source stays contested.
  assert.ok(
    report.domains.key?.status !== "detected"
      ? report.contestedDomains.includes("key")
      : !report.contestedDomains.includes("key"),
  );
});

test("downbeats reconcile with a numeric tolerance like tempo", () => {
  const result = reconcileAnalysisField("downbeats", [
    { provider: "BEAT_THIS", value: 16, confidence: 0.9 },
    { provider: "MADMOM", value: 16, confidence: 0.9 },
    { provider: "ALL_IN_ONE", value: 8, confidence: 0.9 },
  ]);
  assert.equal(result.value, 16);
  assert.equal(result.status, "detected");
  assert.deepEqual(result.providers, ["BEAT_THIS", "MADMOM"]);
});
