import assert from "node:assert/strict";
import test from "node:test";
import { anchors, applyFamilyCorruption, applyPreparation, applyPurposeBuilt, CLEAN_ANCHOR_IDS, copySectionOver, detect, eligibleParts } from "./anchors";
import { buildContext } from "./shared";
import { repetitionVsVariationDimension, sectionPairIdentity } from "./repetitionVsVariation";

test("re-anchored (B-26): the pop anchor's second verse now repeats *nothing* of its first — measured, and no dimension reports it", () => {
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
  //
  // **Re-anchored at the B-21 merge (B-26). This is what the B-13 comment above
  // said should be looked at, and it happened.** Measured on this tree against
  // `3b9ace3`, Verse (bars 5-12) against Verse 2 (bars 21-28):
  //
  //   part                exactShare B-13 -> B-21   rhythmShare
  //   keys-harmonic_bed   0.500 -> 0.000            0.500 -> 0.000
  //   bass-bass           0.000 -> 0.000            0.000 -> 0.000
  //
  // The verbatim share has fallen 1.00 (pre-B-01) -> 0.75 (B-01) -> 0.50
  // (B-13) -> **0.00**. B-21's D2 writes the two verses from the arc's own
  // numeric level and the groove plan's differing cells, so Verse 2 does not
  // share a single bar with Verse 1 in any part, in pitch or in rhythm. The
  // metric is reading the arrangement correctly; what the arrangement now has
  // is a pair of sections with the same name and the same function that have
  // nothing in common bar-for-bar.
  //
  // Whether that is better or worse than a half-verbatim repeat is a musical
  // question, and it is a real one: it is the same shape as
  // `sectionDevelopment.repeat_without_identity`, which only looks at the
  // **climax** pair. There is no finding for it here — see the `todo` below —
  // so this test pins the measurement rather than a band, and the direction is
  // recorded rather than asserted away.
  const anchor = anchors(["pop-full"])[0];
  const context = buildContext(anchor.input);
  const verse = context.sections.find((s) => s.name === "Verse")!;
  const verse2 = context.sections.find((s) => s.name === "Verse 2")!;
  const chorus = context.sections.find((s) => s.name === "Chorus")!;
  const same = sectionPairIdentity(context, verse, verse2);
  console.log("pop verse identity:", JSON.stringify(same.map((x) => [x.part.id, x.exactShare, x.rhythmShare])));
  const keys = same.find((x) => x.part.family === "keys")!;
  const bass = same.find((x) => x.part.family === "bass")!;
  assert.equal(keys.exactShare, 0, `keys repeat verbatim: ${keys.exactShare} (1.00 pre-B-01, 0.75 at B-01, 0.50 at B-13, 0.00 at B-21)`);
  assert.equal(keys.rhythmShare, 0, `…and not even the rhythm: ${keys.rhythmShare} (0.50 at B-13)`);
  assert.equal(bass.exactShare, 0, `the bass does not either (B-01 thins it in Verse 2): ${bass.exactShare}`);
  const different = sectionPairIdentity(context, verse, chorus);
  assert.ok(different.some((x) => x.exactShare < 0.5));
  // The other half of the finding: the dimension raises nothing at all on this
  // anchor, so a reader of the report cannot see what the numbers above say.
  const report = repetitionVsVariationDimension.evaluate(anchor.input);
  assert.deepEqual(report.observations.filter((o) => o.severity !== "info"), [],
    "pop-full carries no repetition finding — which is the blind spot the todo below names");
});

test("B-26 finding: a repeated section that repeats nothing has no observation anywhere in the dimension set", { todo: "Owner: the form/section-development stream (the dimension that owns `repeat_without_identity`), after PR-B21, PR-B25 and PR-B26 merge. What: `repetitionVsVariation` can say a pair of sections is too *similar* (`sections_indistinguishable`, `section_verbatim_copy`, `loop_without_variation`) and nothing at all when a pair with the same name and function shares zero bars; `sectionDevelopment.repeat_without_identity` is the right finding but is computed only for the planned-climax pair. Measured on pop-full at B-21: Verse/Verse 2 exactShare 0.000 and rhythmShare 0.000 in every part (was 0.500/0.500 at B-13), and the dimension reports no non-info observation on the anchor. Why not fixed here: a new observation kind must be registered in `critics/failureTaxonomy.ts`, weighted in `critics/judge.ts` and classified in `findingClassification.ts`, all of which B-19 owns and this stream must not move under it." }, () => {
  // Intentionally empty: the finding is the statement above. The measurement it
  // rests on is asserted in the test before this one.
});

test("positive control: bars overwritten with their predecessor loop without variation", () => {
  // **Re-anchored at the B-21 merge (B-26): a STALE PIN caused by the
  // denominator growing, and the two new cases are a HARNESS defect rather than
  // a dimension miss.** B-21 gives two anchors a bed with enough notes to be
  // eligible for the first time — `rock-full/guitar-harmonic_bed` (91 notes,
  // Chorus 2 only, first bar 29 of 36) and `dance-full/keys-harmonic_bed` (152
  // notes, Chorus + Chorus 2, first bar 17 of 40) — so the control went 5/5 to
  // 5/7 without any detector changing.
  //
  // Measured cause: `bar_copy_repetition` copies the window's first bar over
  // every later bar, and for a part silent in that bar the copy is empty. Both
  // parts are taken to **0 notes**. A deleted part is not a loop without
  // variation, and this dimension is right to say nothing about it.
  // `applyFamilyCorruption` now refuses a corruption that empties its target
  // (see its comment), so the two cases are skipped rather than counted as
  // misses, and the ratio is 5/5 again on parts the transform actually loops.
  // The defect itself belongs to `symbolicCorruptions.ts` and is reported.
  let detected = 0;
  let total = 0;
  let emptied = 0;
  for (const anchor of anchors(["rock-full", "dance-full", "jazz-full"])) {
    for (const part of eligibleParts(anchor, "bar_copy_repetition").filter((p) => !p.percussive && p.notes.length >= 60)) {
      const worsened = applyFamilyCorruption(anchor, part.id, "bar_copy_repetition", 3, 1);
      if (!worsened) { emptied += 1; continue; }
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
  // The skipped cases are pinned rather than left implicit, so a change of that
  // set is visible: exactly the two beds B-21 added that do not start at bar 1.
  assert.equal(emptied, 2, `parts the corruption would delete instead of loop: ${emptied}`);
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
