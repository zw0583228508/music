import assert from "node:assert/strict";
import test from "node:test";
import { anchors, applyPreparation, applyPurposeBuilt, CLEAN_ANCHOR_IDS, detect } from "./anchors";
import { buildContext } from "./shared";
import { readDevelopment, sectionDevelopmentDimension } from "./sectionDevelopment";

test("the reference composer's second chorus keeps its identity and develops nothing: a real finding at the planned climax", () => {
  for (const anchor of anchors(["pop-full", "rock-full", "dance-full", "acoustic-demo"])) {
    const report = sectionDevelopmentDimension.evaluate(anchor.input);
    const climax = anchor.input.plan.globalPlan!.climax!.sectionName;
    const o = report.observations.find((x) => x.kind === "repeat_without_development" && x.location.sectionName === climax);
    assert.ok(o, `${anchor.id}: ${report.observations.map((x) => `${x.kind}@${x.location.sectionName}`).join(",")}`);
    assert.equal(o!.severity, "major");
    assert.equal(o!.suspectedOrigin, "form");
    assert.equal(o!.evidence.plannedClimax, true);
  }
});

test("a developed chorus 2 (bed up an octave, +10 velocity) reads as developed in register and dynamics", () => {
  const anchor = anchors(["pop-full"])[0];
  const prepared = applyPreparation(anchor, "develop_chorus_2")!;
  const context = buildContext(prepared.input);
  const c1 = context.sections.find((s) => s.name === "Chorus")!;
  const c2 = context.sections.find((s) => s.name === "Chorus 2")!;
  const reading = readDevelopment(context, c1, c2)!;
  assert.ok(reading.identityKept);
  assert.ok(reading.changed.includes("register") && reading.changed.includes("dynamics"), reading.changed.join(","));
  const report = sectionDevelopmentDimension.evaluate(prepared.input);
  assert.ok(!report.observations.some((o) => o.kind === "repeat_without_development" && o.location.sectionName === "Chorus 2"));
});

test("positive control: pasting chorus 1 over the developed chorus 2 removes the development at the planned climax", () => {
  for (const anchor of anchors(["pop-full", "rock-full", "dance-full", "acoustic-demo"])) {
    const prepared = applyPreparation(anchor, "develop_chorus_2")!;
    const worsened = applyPurposeBuilt(prepared, "chorus_copy")!;
    const d = detect(sectionDevelopmentDimension, prepared.input, worsened);
    assert.ok(d.detected, anchor.id);
    const o = d.newObservations.find((x) => x.kind === "repeat_without_development");
    assert.ok(o, anchor.id);
    assert.equal(o!.severity, "major");
    assert.equal(o!.location.sectionName, "Chorus 2");
    assert.equal(o!.recommendedRepair?.operation, "apply_development_operator");
    assert.ok(d.scoreDrop! >= 7, `${anchor.id}: ${d.scoreDrop}`);
  }
});

test("null control: no blocking observation on any clean anchor; a form without repeats is not applicable", () => {
  for (const anchor of anchors(CLEAN_ANCHOR_IDS)) {
    const report = sectionDevelopmentDimension.evaluate(anchor.input);
    assert.equal(report.observations.filter((o) => o.severity === "blocking").length, 0, anchor.id);
  }
  const single = sectionDevelopmentDimension.evaluate(anchors(["cinematic-midi"])[0].input);
  assert.equal(single.applicable, false);
  assert.equal(single.summary.score0to100, null);
});
