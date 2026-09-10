import assert from "node:assert/strict";
import test from "node:test";
import { anchors, applyFamilyCorruption, applyPurposeBuilt, CLEAN_ANCHOR_IDS, detect, eligibleParts } from "./anchors";
import { buildContext } from "./shared";
import { densityDimension, sectionDensity } from "./density";

test("section density counts onset clusters per bar and covered bars, sustains included", () => {
  const anchor = anchors(["pop-full"])[0];
  const context = buildContext(anchor.input);
  const verse = context.sections.find((s) => s.name === "Verse")!;
  const d = sectionDensity(context, verse.startBar, verse.endBar);
  const bass = d.perPart.find((p) => p.part.family === "bass")!;
  assert.ok(bass.onsetsPerBar > 0);
  assert.equal(bass.emptyBars, 0, "a sustained bass note covers its bars");
});

test("positive control: a bed thinned to one note per bar is no longer a chord", () => {
  for (const anchor of anchors(["pop-full", "ballad-piano-vocal", "acoustic-demo"])) {
    const worsened = applyPurposeBuilt(anchor, "piano_one_note_per_bar")!;
    const d = detect(densityDimension, anchor.input, worsened);
    assert.ok(d.detected, anchor.id);
    const single = d.newObservations.find((o) => o.kind === "bed_single_voice" || o.kind === "comping_below_role_floor");
    assert.ok(single, `${anchor.id}: ${d.newObservations.map((o) => o.kind).join(",")}`);
    assert.deepEqual(single!.location.trackIds, worsened.targetTrackIds);
  }
});

test("positive control: choruses thinned to a third are louder-planned sections that are thinner than the verse before them", () => {
  // Recalibrated at the merge: acoustic-demo dropped from this list. Since
  // B-01 its verse has no drums (they enter at the chorus), so a chorus thinned
  // to a third (3.1 onsets/bar) is still not thinner than the verse (4.5) — the
  // dimension is right not to call it `louder_section_thinner`; it detects the
  // control there through `foundation_gaps` on the thinned bass instead
  // (8/8 in the ledger). pop / rock / dance keep bass + keys in the verse.
  for (const anchor of anchors(["pop-full", "rock-full", "dance-full"])) {
    const worsened = applyPurposeBuilt(anchor, "chorus_thinner_than_verse")!;
    const d = detect(densityDimension, anchor.input, worsened);
    assert.ok(d.detected, anchor.id);
    const thinner = d.newObservations.find((o) => o.kind === "louder_section_thinner");
    assert.ok(thinner, anchor.id);
    assert.equal(thinner!.severity, "major");
    assert.ok(/chorus/i.test(thinner!.location.sectionName ?? ""));
    assert.ok((thinner!.evidence.onsetsRatio as number) < 0.85);
  }
});

test("positive control: random thinning of the bass leaves holes in the foundation", () => {
  let detected = 0;
  for (const anchor of anchors(["rock-full", "dance-full", "jazz-full", "acoustic-demo"])) {
    const bass = eligibleParts(anchor, "density_thinning").find((p) => p.family === "bass")!;
    const worsened = applyFamilyCorruption(anchor, bass.id, "density_thinning", 3, 1)!;
    const d = detect(densityDimension, anchor.input, worsened);
    if (d.detected && d.newObservations.some((o) => o.kind === "foundation_gaps" && o.location.trackIds[0] === bass.id)) detected += 1;
  }
  assert.ok(detected >= 3, `detected ${detected}/4`);
});

test("null control: no blocking density observation on any clean anchor", () => {
  for (const anchor of anchors(CLEAN_ANCHOR_IDS)) {
    const report = densityDimension.evaluate(anchor.input);
    assert.ok(report.applicable);
    assert.equal(report.observations.filter((o) => o.severity === "blocking").length, 0, anchor.id);
  }
});
