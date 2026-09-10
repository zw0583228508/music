import assert from "node:assert/strict";
import test from "node:test";
import { anchors, applyFamilyCorruption, applyPurposeBuilt, CLEAN_ANCHOR_IDS, detect, eligibleParts } from "./anchors";
import { performanceRealisationDimension } from "./performanceRealisation";

test("positive control: every velocity at 80 is flat dynamics in every section, no dynamics anywhere per part, no contrast between sections", () => {
  for (const anchor of anchors(["pop-full", "rock-full", "jazz-full"])) {
    const worsened = applyPurposeBuilt(anchor, "velocity_flatten_all")!;
    const d = detect(performanceRealisationDimension, anchor.input, worsened);
    assert.ok(d.detected, anchor.id);
    const kinds = new Set(d.newObservations.map((o) => o.kind));
    assert.ok(kinds.has("flat_dynamics") && kinds.has("no_dynamics_anywhere") && kinds.has("no_dynamic_contrast_between_sections"), [...kinds].join(","));
    const contrast = d.newObservations.find((o) => o.kind === "no_dynamic_contrast_between_sections")!;
    assert.equal(contrast.severity, "major");
    assert.equal(contrast.suspectedOrigin, "perform");
    assert.ok((contrast.evidence.velocityRange as number) < 4);
    assert.ok(d.after.summary.score0to100! <= 40, `${anchor.id}: ${d.after.summary.score0to100}`);
  }
});

test("positive control: controllers stripped and onsets snapped to the grid are a sequencer, not a player", () => {
  for (const anchor of anchors(["pop-full", "dance-full", "orchestral-midi"])) {
    const worsened = applyPurposeBuilt(anchor, "strip_cc_and_quantise")!;
    const d = detect(performanceRealisationDimension, anchor.input, worsened);
    assert.ok(d.detected, anchor.id);
    const mechanical = d.newObservations.filter((o) => o.kind === "mechanical_timing");
    assert.ok(mechanical.length >= 2, `${anchor.id}: ${mechanical.length} parts`);
    if (anchor.id === "orchestral-midi") assert.ok(d.newObservations.some((o) => o.kind === "no_expression_cc" && o.location.trackIds[0].startsWith("strings")));
  }
});

test("positive control: inverted accents on the drums (dynamics_flattening severity 3) are heard as inverted", () => {
  let detected = 0;
  for (const anchor of anchors(["pop-full", "rock-full", "dance-full", "jazz-full"])) {
    const drums = eligibleParts(anchor, "dynamics_flattening").find((p) => p.family === "drums")!;
    const worsened = applyFamilyCorruption(anchor, drums.id, "dynamics_flattening", 3, 1)!;
    const d = detect(performanceRealisationDimension, anchor.input, worsened);
    if (d.detected && d.newObservations.some((o) => o.kind === "accents_inverted" && o.location.trackIds[0] === drums.id)) detected += 1;
  }
  assert.ok(detected >= 3, `detected ${detected}/4`);
});

test("the keys' sustain pedal on the anchors lifts at the chord changes", () => {
  const report = performanceRealisationDimension.evaluate(anchors(["pop-full"])[0].input);
  assert.ok(!report.observations.some((o) => o.kind === "pedal_ignores_chord_changes"));
  const keys = report.observations.find((o) => o.kind === "measured" && o.location.trackIds[0].startsWith("keys"))!;
  assert.ok(String(keys.evidence.ccControllers).includes("64"));
});

test("null control: no blocking performance observation on any clean anchor", () => {
  for (const anchor of anchors(CLEAN_ANCHOR_IDS)) {
    const report = performanceRealisationDimension.evaluate(anchor.input);
    assert.ok(report.applicable);
    assert.equal(report.observations.filter((o) => o.severity === "blocking").length, 0, anchor.id);
  }
});
