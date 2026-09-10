import assert from "node:assert/strict";
import test from "node:test";
import { anchors, applyFamilyCorruption, applyPreparation, applyPurposeBuilt, CLEAN_ANCHOR_IDS, copySectionOver, detect, eligibleParts } from "./anchors";
import { buildContext } from "./shared";
import { repetitionVsVariationDimension, sectionPairIdentity } from "./repetitionVsVariation";

test("section identity: the pop anchor's second verse repeats half its first verse's keys, the bass none of it, and a chorus is not a verse", () => {
  // Recalibrated at the merge: before B-01 Verse 2 was Verse 1 in *every*
  // part (exactShare 1.0 on bass and keys). B-01's arc lets the bass exit
  // Verse 2 early (30 notes -> 4), so the bass shares nothing bar-for-bar
  // while the keys are still a verbatim copy — the metric reads both truths.
  //
  // Re-anchored at the B-13 merge, and the direction is the right one. The
  // keys' verbatim share has fallen **1.00 (pre-B-01) -> 0.75 (B-01) -> 0.50**:
  // B-13's bed reads the groove plan's bed cell, and the plan differs between
  // the two verses, so half the bars are no longer a copy. That is the defect
  // this block records getting smaller, so the assertion is written as the
  // band it is now in rather than as the old floor — a keys part that repeats
  // *more* than half its bars is still a real, partial repeat and still worth
  // the metric reading, and a drop below a quarter would mean the pair had
  // stopped being a repeat at all and should be looked at.
  const anchor = anchors(["pop-full"])[0];
  const context = buildContext(anchor.input);
  const verse = context.sections.find((s) => s.name === "Verse")!;
  const verse2 = context.sections.find((s) => s.name === "Verse 2")!;
  const chorus = context.sections.find((s) => s.name === "Chorus")!;
  const same = sectionPairIdentity(context, verse, verse2);
  console.log("pop verse identity:", JSON.stringify(same.map((x) => [x.part.id, x.exactShare, x.rhythmShare])));
  const keys = same.find((x) => x.part.family === "keys")!;
  const bass = same.find((x) => x.part.family === "bass")!;
  assert.ok(keys.exactShare >= 0.25 && keys.exactShare <= 0.6, `keys repeat verbatim: ${keys.exactShare} (1.00 pre-B-01, 0.75 at B-01, 0.50 at B-13)`);
  assert.ok(bass.exactShare < 0.5, `the bass does not (B-01 thins it in Verse 2): ${bass.exactShare}`);
  const different = sectionPairIdentity(context, verse, chorus);
  assert.ok(different.some((x) => x.exactShare < 0.5));
});

test("positive control: bars overwritten with their predecessor loop without variation", () => {
  let detected = 0;
  let total = 0;
  for (const anchor of anchors(["rock-full", "dance-full", "jazz-full"])) {
    for (const part of eligibleParts(anchor, "bar_copy_repetition").filter((p) => !p.percussive && p.notes.length >= 60)) {
      const worsened = applyFamilyCorruption(anchor, part.id, "bar_copy_repetition", 3, 1);
      if (!worsened) continue;
      total += 1;
      const d = detect(repetitionVsVariationDimension, anchor.input, worsened);
      if (!d.detected) continue;
      detected += 1;
      const loop = d.newObservations.find((o) => o.kind === "loop_without_variation");
      assert.ok(loop, `${anchor.id}/${part.id}: ${d.newObservations.map((o) => o.kind).join(",")}`);
      assert.deepEqual(loop!.location.trackIds, [part.id]);
      assert.ok((loop!.evidence.barRepetitionShare as number) >= 0.9);
    }
  }
  assert.ok(total >= 3 && detected / total >= 0.8, `detected ${detected}/${total}`);
});

test("positive control: chorus 1 pasted over a developed chorus 2 is a verbatim section copy", () => {
  let detected = 0;
  const ids: string[] = [];
  for (const anchor of anchors(["pop-full", "rock-full", "dance-full", "acoustic-demo"])) {
    const prepared = applyPreparation(anchor, "develop_chorus_2")!;
    const worsened = applyPurposeBuilt(prepared, "chorus_copy")!;
    const d = detect(repetitionVsVariationDimension, prepared.input, worsened);
    ids.push(`${anchor.id}:${d.scoreDrop}:${d.after.observations.filter((o) => o.kind === "section_verbatim_copy").map((o) => o.location.sectionName).join("/")}`);
    if (d.detected && d.newObservations.some((o) => o.kind === "section_verbatim_copy")) detected += 1;
  }
  assert.ok(detected >= 3, `detected ${detected}/4: ${ids.join(" ")}`);
});

test("re-anchored (B-05c): the dance breakdown is no longer its verse, and pasting the verse back over it is the control", () => {
  // Re-anchored, with the cause.
  //
  // At the B-01 merge the dance anchor's breakdown really was its verse note
  // for note, and this test pinned the finding. Measured at `origin/main`
  // 31b9443, after B-04 gave the breakdown its own groove cell, the two
  // sections share almost nothing: bass exactShare 0.25 / rhythmShare 0.375,
  // drums 0 / 0. The dimension is right not to raise
  // `sections_indistinguishable`, and a test that still demands it is testing
  // a composer defect that was fixed.
  //
  // A "real finding" test that stops finding anything is not a test any more,
  // so it becomes a positive control: paste the verse back over the breakdown
  // and the dimension must say so. That keeps the detector under test without
  // requiring the composer to stay broken.
  const anchor = anchors(["dance-full"])[0];
  const context = buildContext(anchor.input);
  const verse = context.sections.find((s) => s.name === "Verse")!;
  const breakdown = context.sections.find((s) => s.name === "Breakdown")!;
  const identity = sectionPairIdentity(context, verse, breakdown);
  assert.ok(identity.every((x) => x.exactShare < 0.5), `verse/breakdown identity: ${JSON.stringify(identity.map((x) => [x.part.id, x.exactShare]))}`);
  const report = repetitionVsVariationDimension.evaluate(anchor.input);
  assert.equal(report.observations.find((o) => o.kind === "sections_indistinguishable"), undefined, "the sections differ now");

  const worsened = copySectionOver(anchor, "Verse", "Breakdown")!;
  const d = detect(repetitionVsVariationDimension, anchor.input, worsened);
  assert.ok(d.detected, "pasting the verse over the breakdown is detected");
  const same = d.newObservations.find((o) => o.kind === "sections_indistinguishable");
  assert.ok(same, d.newObservations.map((o) => o.kind).join(","));
  assert.equal(same!.severity, "major");
  assert.equal(same!.location.sectionName, "Breakdown");
  assert.ok(d.scoreDrop! >= 5, String(d.scoreDrop));
});

test("null control: no blocking repetition observation on any clean anchor", () => {
  for (const anchor of anchors(CLEAN_ANCHOR_IDS)) {
    const report = repetitionVsVariationDimension.evaluate(anchor.input);
    assert.ok(report.applicable);
    assert.equal(report.observations.filter((o) => o.severity === "blocking").length, 0, anchor.id);
  }
});
