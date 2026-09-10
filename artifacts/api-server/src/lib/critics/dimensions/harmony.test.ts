import assert from "node:assert/strict";
import test from "node:test";
import { anchors, applyFamilyCorruption, applyPurposeBuilt, CLEAN_ANCHOR_IDS, detect, eligibleParts } from "./anchors";
import { buildContext } from "./shared";
import { harmonyDimension, readPartHarmony } from "./harmony";

test("reference parts state chord tones: the bass and the beds read as chord tones under the sounding chord", () => {
  for (const anchor of anchors(["pop-full", "rock-full", "jazz-full"])) {
    const context = buildContext(anchor.input);
    for (const part of context.pitched.filter((p) => p.family === "bass" || /bed/i.test(p.role))) {
      const readings = readPartHarmony(context, part);
      const weight = readings.reduce((s, r) => s + r.weight, 0);
      const chordTone = readings.filter((r) => r.chordTone).reduce((s, r) => s + r.weight, 0);
      assert.ok(chordTone / weight >= 0.9, `${anchor.id}/${part.id}: chord-tone share ${(chordTone / weight).toFixed(3)}`);
    }
  }
});

test("positive control: chord tones moved to non-chord tones (severity 3) are located to the damaged part and section", () => {
  let detected = 0;
  let total = 0;
  for (const anchor of anchors(["pop-full", "rock-full", "jazz-full"])) {
    for (const part of eligibleParts(anchor, "chord_tone_to_non_chord_tone")) {
      const worsened = applyFamilyCorruption(anchor, part.id, "chord_tone_to_non_chord_tone", 3, 1);
      if (!worsened) continue;
      total += 1;
      const d = detect(harmonyDimension, anchor.input, worsened);
      if (!d.detected) continue;
      detected += 1;
      const clash = d.newObservations.find((o) => o.kind === "clash_share" || o.kind === "bass_leaves_chord" || o.kind === "overhang_across_chord_change");
      assert.ok(clash, `${anchor.id}/${part.id}: kinds ${d.newObservations.map((o) => o.kind).join(",")}`);
      assert.deepEqual(clash!.location.trackIds, [part.id]);
      assert.ok(clash!.location.sectionName, "located to a section");
      assert.ok(typeof clash!.evidence.clashShare === "number" || typeof clash!.evidence.chordToneShare === "number");
      assert.equal(clash!.suspectedOrigin, "compose");
      assert.ok(clash!.originConfidence > 0 && clash!.confidence > 0);
    }
  }
  assert.ok(total >= 6, `eligible parts ${total}`);
  assert.equal(detected, total, `detected ${detected}/${total}`);
});

test("positive control: the audit's random-pitch composer is blocked (score <= 40) on three corpus cases", () => {
  for (const anchor of anchors(["pop-full", "dance-full", "jazz-full"])) {
    const worsened = applyPurposeBuilt(anchor, "random_pitch")!;
    const d = detect(harmonyDimension, anchor.input, worsened);
    assert.ok(d.detected, anchor.id);
    assert.ok(d.after.summary.score0to100! <= 40, `${anchor.id}: ${d.after.summary.score0to100}`);
    assert.ok(d.newObservations.some((o) => o.kind === "clash_share" && o.severity === "blocking"), anchor.id);
  }
});

test("non-chord tones are classified by context, not all called clashes", () => {
  // A passing tone between two chord tones on a keys part: C (chord tone) -> D (passing) -> E (chord tone) under C major.
  const anchor = anchors(["pop-full"])[0];
  const context = buildContext(anchor.input);
  const keys = context.pitched.find((p) => p.family === "keys" && /bed/i.test(p.role))!;
  const chord = context.chords.find((c) => c.symbol === "C" && c.startBar >= keys.notes[0].bar)!;
  const beat = context.barInfo(chord.startBar)!.beatSeconds;
  const notes = [60, 62, 64].map((pitch, i) => ({ id: `p${i}`, start: chord.start + i * beat * 0.5, duration: beat * 0.45, pitch, velocity: 80 }));
  const input = { ...anchor.input, trackModels: anchor.input.trackModels.map((t) => (t.id === keys.id ? { ...t, notes } : t)) };
  const part = buildContext(input).pitched.find((p) => p.id === keys.id)!;
  const readings = readPartHarmony(buildContext(input), part);
  assert.deepEqual(readings.map((r) => r.cls), ["chord_tone", "passing", "chord_tone"]);
});

test("null control: no blocking harmony observation on any clean anchor", () => {
  for (const anchor of anchors(CLEAN_ANCHOR_IDS)) {
    const report = harmonyDimension.evaluate(anchor.input);
    assert.ok(report.applicable);
    assert.equal(report.observations.filter((o) => o.severity === "blocking").length, 0, anchor.id);
    assert.ok(report.summary.score0to100! >= 90, `${anchor.id}: ${report.summary.score0to100}`);
  }
});
