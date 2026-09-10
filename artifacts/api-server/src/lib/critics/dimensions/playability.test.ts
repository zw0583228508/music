import assert from "node:assert/strict";
import test from "node:test";
import { anchors, applyPurposeBuilt, CLEAN_ANCHOR_IDS, detect } from "./anchors";
import { playabilityDimension } from "./playability";

test("positive control: a bass leaping an octave and more at every chord is unplayable (blocking), each leap located to its bar", () => {
  for (const anchor of anchors(["pop-full", "rock-full", "jazz-full"])) {
    const worsened = applyPurposeBuilt(anchor, "bass_roots_only_leaps")!;
    const d = detect(playabilityDimension, anchor.input, worsened);
    assert.ok(d.detected, anchor.id);
    const leaps = d.newObservations.filter((o) => o.kind === "impossible_leap" || o.kind === "wide_leap");
    assert.ok(leaps.length >= 3, anchor.id);
    assert.ok(leaps.every((o) => o.location.trackIds[0] === worsened.targetTrackIds[0] && o.location.startBar >= 1));
    const unplayable = d.newObservations.find((o) => o.kind === "part_unplayable");
    assert.ok(unplayable && unplayable.severity === "blocking", anchor.id);
    assert.ok(d.after.summary.score0to100! <= 40);
  }
});

test("positive control: a bed two octaves up leaves its range; the engine's suggested fix is the repair", () => {
  for (const anchor of anchors(["dance-full", "jazz-full", "cinematic-midi"])) {
    const worsened = applyPurposeBuilt(anchor, "strings_up_two_octaves")!;
    const d = detect(playabilityDimension, anchor.input, worsened);
    assert.ok(d.detected, anchor.id);
    const range = d.newObservations.find((o) => o.kind === "out_of_range" || o.kind === "outside_comfortable_range");
    assert.ok(range, anchor.id);
    assert.ok(range!.recommendedRepair && range!.recommendedRepair.scope === "note" && range!.recommendedRepair.detail.length > 0);
    assert.equal(range!.evidence.engineSeverity === "error" ? range!.severity : "minor", range!.severity);
  }
});

test("the wrapper judges nothing itself: the documented false-positive warning is carried as information", () => {
  for (const anchor of anchors(CLEAN_ANCHOR_IDS)) {
    const report = playabilityDimension.evaluate(anchor.input);
    for (const o of report.observations) {
      if (o.kind === "unrealistic_repetition") assert.equal(o.severity, "info");
      if (o.kind !== "measured" && o.kind !== "part_unplayable") assert.ok(["error", "warning"].includes(String(o.evidence.engineSeverity)));
    }
  }
});

test("null control: no blocking playability observation on any clean anchor", () => {
  for (const anchor of anchors(CLEAN_ANCHOR_IDS)) {
    const report = playabilityDimension.evaluate(anchor.input);
    assert.ok(report.applicable);
    assert.equal(report.observations.filter((o) => o.severity === "blocking").length, 0, anchor.id);
    assert.equal(report.summary.coverage, 1);
  }
});
