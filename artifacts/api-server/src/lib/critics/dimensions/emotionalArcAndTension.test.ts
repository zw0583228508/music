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
  // Recalibrated at the merge: "plays in the quietest section" now means
  // sounding in more than a quarter of its bars (the B-01 anchors leave a
  // cymbal choke and a sparse bass in the quiet sections). dance-full left
  // this list: thinning its Chorus 2 to the Breakdown's parts leaves Chorus 1
  // ahead by less than the dimension's 0.05 margin (7/8 in the ledger).
  let detected = 0;
  for (const anchor of anchors(["pop-full", "ballad-piano-vocal", "rock-full", "acoustic-demo"])) {
    const worsened = applyPurposeBuilt(anchor, "flatten_arc")!;
    const d = detect(emotionalArcAndTensionDimension, anchor.input, worsened);
    if (d.detected) detected += 1;
  }
  assert.ok(detected >= 3, `detected ${detected}/4`);
});

test("the jazz anchor's second verse still matches its planned chorus in energy: the peak is not clearly at the climax, and the dimension says so in the numbers without over-claiming", () => {
  // Recalibrated at the merge. Before B-01 the jazz anchor peaked in Verse 2
  // by a clear margin (`climax_misplaced` major: the comping keys out-weighed
  // the chorus bed). B-01's arc brings the drums into the chorus (328 onsets)
  // and makes it the planned climax, but Verse 2 keeps drums (208) + the
  // 228-note comping keys, so the two sections now sit within the dimension's
  // 0.05 margin (Verse 2 0.751 vs Chorus 0.725 at the time of writing). The
  // real finding that remains: the notes do not make the planned climax the
  // clear peak; the dimension reports it in `measured` and withholds
  // `climax_misplaced` below its margin rather than inventing a certainty.
  const report = emotionalArcAndTensionDimension.evaluate(anchors(["jazz-full"])[0].input);
  const measured = report.observations.find((o) => o.kind === "measured")!;
  assert.equal(measured.evidence.plannedClimax, "Chorus");
  const energies = Object.fromEntries(String(measured.evidence.perSectionEnergy).split(",").map((cell) => cell.split(":")).map(([name, v]) => [name, Number(v)]));
  const margin = energies["Verse 2"] - energies.Chorus;
  assert.ok(margin > -0.05, `Verse 2 (${energies["Verse 2"]}) is not clearly below the planned climax Chorus (${energies.Chorus})`);
  const misplaced = report.observations.find((o) => o.kind === "climax_misplaced");
  if (margin >= 0.05) assert.ok(misplaced && misplaced.evidence.actualPeak === "Verse 2", "a clear peak elsewhere is named");
  else assert.equal(misplaced, undefined, "within the 0.05 margin the dimension does not claim a misplaced climax");
});

test("null control: no blocking arc observation on any clean anchor", () => {
  for (const anchor of anchors(CLEAN_ANCHOR_IDS)) {
    const report = emotionalArcAndTensionDimension.evaluate(anchor.input);
    assert.ok(report.applicable);
    assert.equal(report.observations.filter((o) => o.severity === "blocking").length, 0, anchor.id);
  }
});
