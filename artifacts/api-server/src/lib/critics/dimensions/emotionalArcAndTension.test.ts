import assert from "node:assert/strict";
import test from "node:test";
import { anchors, applyPurposeBuilt, CLEAN_ANCHOR_IDS, detect } from "./anchors";
import { buildContext } from "./shared";
import { barTrajectory, emotionalArcAndTensionDimension } from "./emotionalArcAndTension";

test("the energy proxy rises from the pop anchor's verse to its chorus, where the keys enter", () => {
  const anchor = anchors(["pop-full"])[0];
  const context = buildContext(anchor.input);
  const bars = barTrajectory(context);
  const meanOver = (name: string) => {
    const s = context.sections.find((x) => x.name === name)!;
    const cells = bars.filter((b) => b.bar >= s.startBar && b.bar <= s.endBar);
    return cells.reduce((a, b) => a + b.energy, 0) / cells.length;
  };
  assert.ok(meanOver("Chorus") > meanOver("Verse"));
  assert.ok(bars.every((b) => b.energy >= 0 && b.energy <= 1 && b.tension >= 0 && b.tension <= 1));
});

test("positive control: the climax's notes swapped with the quietest section's put the peak in the wrong place", () => {
  for (const anchor of anchors(["pop-full", "ballad-piano-vocal", "acoustic-demo"])) {
    const worsened = applyPurposeBuilt(anchor, "swap_climax_with_quietest")!;
    const d = detect(emotionalArcAndTensionDimension, anchor.input, worsened);
    assert.ok(d.detected, anchor.id);
    const misplaced = d.newObservations.find((o) => o.kind === "climax_misplaced");
    assert.ok(misplaced, `${anchor.id}: ${d.newObservations.map((o) => o.kind).join(",")}`);
    assert.equal(misplaced!.severity, "major");
    assert.equal(misplaced!.evidence.plannedClimax, anchor.input.plan.globalPlan!.climax!.sectionName);
    assert.notEqual(misplaced!.evidence.actualPeak, misplaced!.evidence.plannedClimax);
  }
});

test("positive control: a flattened arc (mean velocity everywhere, climax thinned to the quietest section's parts)", () => {
  let detected = 0;
  for (const anchor of anchors(["pop-full", "ballad-piano-vocal", "dance-full", "acoustic-demo"])) {
    const worsened = applyPurposeBuilt(anchor, "flatten_arc")!;
    const d = detect(emotionalArcAndTensionDimension, anchor.input, worsened);
    if (d.detected) detected += 1;
  }
  assert.ok(detected >= 3, `detected ${detected}/4`);
});

test("the jazz anchor peaks in its second verse, not in its planned chorus: a real finding with the numbers behind it", () => {
  const report = emotionalArcAndTensionDimension.evaluate(anchors(["jazz-full"])[0].input);
  const misplaced = report.observations.find((o) => o.kind === "climax_misplaced");
  assert.ok(misplaced);
  assert.equal(misplaced!.evidence.plannedClimax, "Chorus");
  assert.equal(misplaced!.evidence.actualPeak, "Verse 2");
  assert.ok((misplaced!.evidence.actualPeakEnergy as number) > (misplaced!.evidence.plannedClimaxEnergy as number));
});

test("null control: no blocking arc observation on any clean anchor", () => {
  for (const anchor of anchors(CLEAN_ANCHOR_IDS)) {
    const report = emotionalArcAndTensionDimension.evaluate(anchor.input);
    assert.ok(report.applicable);
    assert.equal(report.observations.filter((o) => o.severity === "blocking").length, 0, anchor.id);
  }
});
