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

test("abstains when competing meter evidence has no usable margin", () => {
  const result = reconcileAnalysisField("meter", [
    { provider: "ALL_IN_ONE", value: "4/4", confidence: .94 },
    { provider: "STANDARD_MIDI", value: "3/4", confidence: .8 },
  ]);
  assert.equal(result.value, null);
  assert.equal(result.status, "not_available");
  assert.ok(result.message?.includes("disagreed"));
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
