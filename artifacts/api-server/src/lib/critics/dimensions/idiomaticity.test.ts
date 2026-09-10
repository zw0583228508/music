import assert from "node:assert/strict";
import test from "node:test";
import { anchors, applyPurposeBuilt, CLEAN_ANCHOR_IDS, detect } from "./anchors";
import { handSpans, idiomaticityDimension, longestPhraseSeconds } from "./idiomaticity";
import type { NoteRef } from "./shared";

const ref = (pitch: number, start: number, duration = 0.4): NoteRef => ({
  note: { id: `n${pitch}-${start}`, start, duration, pitch, velocity: 80 },
  start, end: start + duration, duration, pitch, velocity: 80, pc: pitch % 12, bar: 1 + Math.floor(start / 2), beat: (start % 2) / 0.5, beatSeconds: 0.5,
});

test("hand spans split a voicing at its widest gap", () => {
  const close = handSpans([48, 52, 55, 60, 64, 67].map((p) => ref(p, 0)));
  assert.ok(close.left <= 12 && close.right <= 12);
  const wide = handSpans([48, 60, 72, 84].map((p) => ref(p, 0)));
  assert.ok(wide.left > 12 || wide.right > 12);
  assert.equal(wide.total, 36);
});

test("the longest phrase counts gaps shorter than a breath as continuous", () => {
  const notes = [ref(60, 0, 1), ref(62, 1.1, 1), ref(64, 2.2, 1), ref(65, 4, 1)];
  const phrase = longestPhraseSeconds(notes);
  assert.ok(Math.abs(phrase.seconds - 3.2) < 1e-6);
});

test("positive control: voicings spread by an octave per voice exceed the hands", () => {
  for (const anchor of anchors(["ballad-piano-vocal", "acoustic-demo", "jazz-full"])) {
    const worsened = applyPurposeBuilt(anchor, "piano_wide_voicing")!;
    const d = detect(idiomaticityDimension, anchor.input, worsened);
    assert.ok(d.detected, anchor.id);
    const span = d.newObservations.find((o) => o.kind === "hand_span_exceeded" || o.kind === "guitar_voicing_unfingerable");
    assert.ok(span, anchor.id);
    assert.deepEqual(span!.location.trackIds, worsened.targetTrackIds);
    assert.ok((span!.evidence.share as number) >= 0.5);
  }
});

test("positive control: brass sustained without a breath is flagged with the bars of the longest phrase", () => {
  for (const anchor of anchors(["orchestral-midi", "cinematic-midi"])) {
    const worsened = applyPurposeBuilt(anchor, "brass_hold_forever")!;
    const d = detect(idiomaticityDimension, anchor.input, worsened);
    assert.ok(d.detected, anchor.id);
    const breath = d.newObservations.find((o) => o.kind === "phrase_too_long_for_breath");
    assert.ok(breath, anchor.id);
    assert.ok((breath!.evidence.longestPhraseSeconds as number) > 10);
    assert.ok(breath!.location.endBar >= breath!.location.startBar);
  }
});

test("null control: no blocking idiomaticity observation on any clean anchor", () => {
  for (const anchor of anchors(CLEAN_ANCHOR_IDS)) {
    const report = idiomaticityDimension.evaluate(anchor.input);
    assert.ok(report.applicable);
    assert.equal(report.observations.filter((o) => o.severity === "blocking").length, 0, anchor.id);
  }
});
