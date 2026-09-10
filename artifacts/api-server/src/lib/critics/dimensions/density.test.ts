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
    // B-05c renamed `bed_single_voice` (minor) to `single_voice_bed` and raised
    // it to major/blocking — a bed that is a solo line is not a nuance.
    const single = d.newObservations.find((o) => o.kind === "single_voice_bed" || o.kind === "comping_below_role_floor");
    assert.ok(single, `${anchor.id}: ${d.newObservations.map((o) => o.kind).join(",")}`);
    assert.deepEqual(single!.location.trackIds, worsened.targetTrackIds);
  }
});

test("positive control: choruses thinned to a third are caught, and only dance-full is caught by `louder_section_thinner` — the reason is the anchors", () => {
  // Re-anchored (B-05c), with the cause.
  //
  // `louder_section_thinner` fires when the planned energy rises by >= 0.25,
  // the onsets-per-bar ratio falls below 0.85, and either no part is added or
  // the ratio falls below 0.6. Measured at `origin/main` 31b9443 with the
  // choruses thinned to a third:
  //
  //   pop-full   verse 5.00 -> chorus 4.50 onsets/bar, ratio 0.90, drums enter
  //   rock-full  verse 5.00 -> chorus 4.50, ratio 0.90, drums enter
  //   dance-full verse 11.88 -> chorus 5.88, ratio 0.50            <- caught
  //
  // Since B-01 the pop and rock verses have no drums, so thinning the chorus to
  // a third still leaves it at 90 % of the verse's onsets per bar *with an
  // extra part playing*, and the dimension is right not to call that a thinner
  // arrival. It detects the control on those anchors through the other kinds
  // named below. What the review actually asked for — an arrival measured in
  // onsets *and voices and dynamics* — is `arrival_thinner_than_setup`, tested
  // separately with its own transform.
  const expected: Record<string, string[]> = {
    "pop-full": ["quieter_section_denser"],
    "rock-full": ["density_flat_against_plan"],
    "dance-full": ["louder_section_thinner"],
    "acoustic-demo": ["density_flat_against_plan", "foundation_gaps"],
  };
  for (const anchor of anchors(["pop-full", "rock-full", "dance-full", "acoustic-demo"])) {
    const worsened = applyPurposeBuilt(anchor, "chorus_thinner_than_verse")!;
    const d = detect(densityDimension, anchor.input, worsened);
    assert.ok(d.detected, anchor.id);
    const kinds = [...new Set(d.newObservations.map((o) => o.kind))].sort();
    assert.deepEqual(kinds, [...expected[anchor.id]].sort(), `${anchor.id}: ${kinds.join(",")}`);
  }
  const dance = anchors(["dance-full"])[0];
  const thinner = detect(densityDimension, dance.input, applyPurposeBuilt(dance, "chorus_thinner_than_verse")!)
    .newObservations.find((o) => o.kind === "louder_section_thinner")!;
  assert.equal(thinner.severity, "major");
  assert.ok(/chorus/i.test(thinner.location.sectionName ?? ""));
  assert.ok((thinner.evidence.onsetsRatio as number) < 0.85, String(thinner.evidence.onsetsRatio));
});

test("positive control (B-05c): an arrival thinned, unvoiced and softened is smaller than its setup in two of three respects", () => {
  // The transform keeps one of every three onset clusters in every arrival
  // section, drops the top voice of what remains and plays it 20 % softer.
  // Unlike `chorus_thinner_than_verse` it damages voices and dynamics as well
  // as onsets, which is what an arrival that fails to arrive actually looks
  // like on the owner's song (chorus onsets 0.80 of the verse's, one voice in
  // the strings, velocities down).
  let caught = 0;
  const rows: string[] = [];
  for (const anchor of anchors(["pop-full", "rock-full", "acoustic-demo"])) {
    const worsened = applyPurposeBuilt(anchor, "arrival_thinned_and_softened")!;
    const d = detect(densityDimension, anchor.input, worsened);
    assert.ok(d.detected, anchor.id);
    const arrival = d.newObservations.find((o) => o.kind === "arrival_thinner_than_setup");
    rows.push(`${anchor.id}:${arrival ? "caught" : d.newObservations.map((o) => o.kind).join("/")}`);
    if (!arrival) continue;
    caught += 1;
    // Major at the planned climax or when the combined ratio falls below 0.85;
    // minor for a smaller arrival elsewhere in the form. The test pins the
    // rule rather than one severity, so a section that is merely a little
    // smaller than its setup is not reported as if it were the climax.
    const wantMajor = arrival.evidence.plannedClimax === true || (arrival.evidence.combinedRatio as number) <= 0.85;
    assert.equal(arrival.severity, wantMajor ? "major" : "minor",
      `${anchor.id}: plannedClimax ${arrival.evidence.plannedClimax}, combined ${arrival.evidence.combinedRatio}`);
    assert.ok((arrival.evidence.respectsThatFell as number) >= 2, `${anchor.id}: ${arrival.evidence.respectsThatFell}`);
    assert.ok((arrival.evidence.combinedRatio as number) <= 0.92, `${anchor.id}: ${arrival.evidence.combinedRatio}`);
    assert.equal(arrival.recommendedRepair?.operation, "make_the_arrival_arrive");
    assert.ok(arrival.location.sectionName);
    // Which two of the three fell is not fixed: the transform softens the
    // arrival's remaining notes, but where the setup section is itself an
    // arrival it is softened too, so the *ratio* can stay above 1 while onsets
    // and voices fall. That is exactly why the finding needs two of three
    // rather than any single quantity.
    const fell = [arrival.evidence.onsetsRatio, arrival.evidence.voicesRatio, arrival.evidence.velocityRatio]
      .filter((r) => (r as number) < 0.95).length;
    assert.equal(fell, arrival.evidence.respectsThatFell, `${anchor.id}: ${JSON.stringify(arrival.evidence)}`);
  }
  assert.equal(caught, 3, rows.join(" "));
});

test("positive control (B-05c): a bed reduced to its top voice is a single-voice bed, and the composed notes say which layer lost them", () => {
  for (const anchor of anchors(["pop-full", "rock-full", "dance-full"])) {
    const worsened = applyPurposeBuilt(anchor, "strip_bed_to_top_voice")!;
    const d = detect(densityDimension, anchor.input, worsened);
    assert.ok(d.detected, anchor.id);
    const single = d.newObservations.find((o) => o.kind === "single_voice_bed");
    assert.ok(single, `${anchor.id}: ${d.newObservations.map((o) => o.kind).join(",")}`);
    // Without composed notes the finding is major and attributed to the composer.
    assert.equal(single!.severity, "major");
    assert.equal(single!.suspectedOrigin, "compose");
    assert.equal(single!.evidence.composedNotesAvailable, false);
    assert.ok((single!.evidence.meanVoices as number) <= 1.2);
    // With the anchor's own (three-voice) notes given as the composed ones, the
    // same shipped notes are read as voices lost after composition: blocking,
    // origin `perform`. This is the isolating control R-1a P1-1 asked for,
    // available to any dimension through `CriticInput.composedTrackModels`.
    const withComposed = { ...worsened.input, composedTrackModels: anchor.input.trackModels };
    const located = densityDimension.evaluate(withComposed).observations
      .find((o) => o.kind === "single_voice_bed" && o.location.trackIds[0] === single!.location.trackIds[0]);
    assert.ok(located, anchor.id);
    assert.equal(located!.severity, "blocking");
    assert.equal(located!.suspectedOrigin, "perform");
    assert.equal(located!.evidence.lostAfterCompose, true);
    assert.ok((located!.evidence.composedMeanVoices as number) >= 3, `${anchor.id}: ${located!.evidence.composedMeanVoices}`);
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
