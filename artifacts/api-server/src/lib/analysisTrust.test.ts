import assert from "node:assert/strict";
import test from "node:test";
import type { SongModelField, SongModelFieldStatus } from "@workspace/db";
import { analysisTrustReport, describeFieldsToConfirm } from "./analysisTrust";

const detected = (providers: string[], confidence = 0.9): SongModelFieldStatus => ({
  status: "detected", confidence, providers, message: null, edited: false,
});
const notAvailable = (message: string): SongModelFieldStatus => ({
  status: "not_available", confidence: null, providers: [], message, edited: false,
});

const allDetected: Record<SongModelField, SongModelFieldStatus> = {
  energy: detected(["LOCAL_SIGNAL_ANALYZER_V1"]),
  tempo: detected(["BEAT_THIS", "MADMOM"]),
  meter: detected(["ALL_IN_ONE"]),
  key: detected(["ESSENTIA", "TRANSCRIPTION_KEY_V1"]),
  harmony: detected(["SHEETSAGE"]),
  sections: detected(["ALL_IN_ONE"]),
  melody: detected(["BASIC_PITCH"]),
  bass: notAvailable("No bass provider returned observed bass evidence."),
};

test("every core domain detected: trusted automatically, nothing to confirm; a missing bass is reported, not blocking", () => {
  const report = analysisTrustReport({ fieldStatus: allDetected });
  assert.equal(report.verdict, "trusted_automatically");
  assert.deepEqual(report.fieldsToConfirm, []);
  assert.equal(report.domains.bass.status, "unknown");
  assert.deepEqual(report.reasons, ["bass: unknown — No bass provider returned observed bass evidence."]);
  assert.equal(report.domains.tempo.whatWouldSettleIt, null);
});

test("the owner's second upload: a contested key needs confirmation, the report names both keys, their relation and what settles it", () => {
  const report = analysisTrustReport({
    fieldStatus: {
      ...allDetected,
      tempo: { status: "low_confidence", confidence: 0.374, providers: ["LOCAL_SIGNAL_ANALYZER_V1"], message: "Estimated locally at 64.8 BPM from the onset envelope; no provider corroborated it.", edited: false },
      meter: { status: "low_confidence", confidence: 0.3, providers: ["LOCAL_SIGNAL_ANALYZER_V1"], message: "4/4 assumed: no structure provider returned a verified meter.", edited: false },
      key: {
        status: "contested", confidence: null,
        providers: ["LOCAL_SIGNAL_ANALYZER_V1", "TRANSCRIPTION_KEY_V1"],
        message: "Independent analyses disagree: Eb major (TRANSCRIPTION_KEY_V1) vs G minor (LOCAL_SIGNAL_ANALYZER_V1). Confirm one before it is used.",
        edited: false,
        candidates: [
          { value: "Eb major", confidence: 0.345, providers: ["TRANSCRIPTION_KEY_V1"] },
          { value: "G minor", confidence: 0.32, providers: ["LOCAL_SIGNAL_ANALYZER_V1"] },
        ],
      },
      harmony: notAvailable("No harmony provider returned chord events."),
      sections: { status: "low_confidence", confidence: 0.35, providers: ["LOCAL_SIGNAL_ANALYZER_V1"], message: "Estimated locally.", edited: false },
      melody: notAvailable("1769 transcribed events did not meet the canonical melody threshold."),
    },
  });
  assert.equal(report.verdict, "needs_confirmation");
  assert.deepEqual(report.fieldsToConfirm, ["tempo", "meter", "key", "sections"]);
  assert.equal(describeFieldsToConfirm(report), "tempo, metre, key, sections");
  assert.equal(report.domains.key.status, "contested");
  assert.equal(report.domains.key.candidates.length, 2);
  // The relation is derived from the candidates when the stored status predates PR-89.
  assert.equal(report.domains.key.relation, "mediant");
  assert.ok(report.domains.key.whatWouldSettleIt?.toLowerCase().includes("cadence"));
  assert.ok(report.reasons.some((reason) => reason.startsWith("key: contested — Eb major (TRANSCRIPTION_KEY_V1) vs G minor (LOCAL_SIGNAL_ANALYZER_V1), mediant")));
  assert.ok(report.domains.tempo.whatWouldSettleIt?.includes("beat tracker"));
});

test("a producer's confirmation makes a field authoritative and lifts the verdict", () => {
  const report = analysisTrustReport({
    fieldStatus: {
      ...allDetected,
      key: {
        status: "detected", confidence: 1, providers: ["LOCAL_SIGNAL_ANALYZER_V1", "TRANSCRIPTION_KEY_V1"],
        message: "User-verified value; the detected provider output remains in provenance.", edited: true,
        // Stale candidates from before the confirmation must not resurface.
        candidates: [
          { value: "Eb major", confidence: 0.345, providers: ["TRANSCRIPTION_KEY_V1"] },
          { value: "G minor", confidence: 0.32, providers: ["LOCAL_SIGNAL_ANALYZER_V1"] },
        ],
      },
    },
  });
  assert.equal(report.verdict, "trusted_automatically");
  assert.equal(report.domains.key.confirmedByProducer, true);
  assert.deepEqual(report.domains.key.candidates, []);
});

test("no grid or no tonality at all is not usable: nothing to confirm from", () => {
  const noGrid = analysisTrustReport({
    fieldStatus: { ...allDetected, tempo: notAvailable("No usable periodic tempo evidence was detected.") },
  });
  assert.equal(noGrid.verdict, "not_usable");
  assert.ok(noGrid.reasons[0]!.startsWith("not usable: the model has no measured grid"));
  const noTonality = analysisTrustReport({
    fieldStatus: {
      ...allDetected,
      key: notAvailable("No unambiguous tonal center was detected."),
      harmony: notAvailable("No harmony provider returned chord events."),
    },
  });
  assert.equal(noTonality.verdict, "not_usable");
  // A missing key beside detected harmony is confirmable, not unusable.
  const keyOnly = analysisTrustReport({
    fieldStatus: { ...allDetected, key: notAvailable("No unambiguous tonal center was detected.") },
  });
  assert.equal(keyOnly.verdict, "needs_confirmation");
  assert.deepEqual(keyOnly.fieldsToConfirm, ["key"]);
});

test("contested tempo carried over a provisional grid: the report shows the contest, not the grid value", () => {
  const report = analysisTrustReport({
    fieldStatus: {
      ...allDetected,
      tempo: {
        status: "contested", confidence: null, providers: ["BEAT_THIS", "MADMOM"],
        message: "Independent analyses disagree: 120 (BEAT_THIS) vs 60 (MADMOM) — half double tempo. Confirm one before it is used.",
        edited: false,
        candidates: [
          { value: "120", confidence: 0.74, providers: ["BEAT_THIS"] },
          { value: "60", confidence: 0.7, providers: ["MADMOM"], relationToLeader: "half_double_tempo" },
        ],
        relation: "half_double_tempo",
        provisional: true,
      },
    },
  });
  assert.equal(report.verdict, "needs_confirmation");
  assert.deepEqual(report.fieldsToConfirm, ["tempo"]);
  assert.equal(report.domains.tempo.relation, "half_double_tempo");
  assert.ok(report.domains.tempo.whatWouldSettleIt?.includes("bar length"));
});

test("contested harmony is a field to confirm even though it is not a core field", () => {
  const report = analysisTrustReport({
    fieldStatus: {
      ...allDetected,
      harmony: {
        status: "contested", confidence: null, providers: ["SHEETSAGE", "ESSENTIA"],
        message: "4 of 8 bars carry competing chords.", edited: false,
        candidates: [
          { value: "bars 2,4,6,8: Am", confidence: 0.49, providers: ["SHEETSAGE"] },
          { value: "bars 2,4,6,8: C", confidence: 0.47, providers: ["ESSENTIA"] },
        ],
      },
    },
  });
  assert.equal(report.verdict, "needs_confirmation");
  assert.deepEqual(report.fieldsToConfirm, ["harmony"]);
});

test("falls back to the reconciliation report's candidates when the field status carries none", () => {
  const report = analysisTrustReport({
    fieldStatus: {
      ...allDetected,
      key: { status: "contested", confidence: null, providers: ["A", "B"], message: null, edited: false },
    },
    reconciliation: {
      version: "1.0",
      domains: {
        key: {
          domain: "key", value: null, confidence: null, providers: [], status: "contested",
          message: null, margin: 0.02,
          candidates: [
            { value: "A minor", score: 0.4, providers: ["A"] },
            { value: "C major", score: 0.38, providers: ["B"], relationToLeader: "relative" },
          ],
          relation: "relative",
        },
      },
      consensusScore: 0,
      contestedDomains: ["key"],
    },
  });
  assert.equal(report.domains.key.candidates.length, 2);
  assert.equal(report.domains.key.relation, "relative");
  assert.ok(report.domains.key.whatWouldSettleIt?.includes("tonic"));
});
