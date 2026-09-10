import assert from "node:assert/strict";
import test from "node:test";
import { anchors, applyFamilyCorruption, applyPurposeBuilt, CLEAN_ANCHOR_IDS, detect, eligibleParts } from "./anchors";
import { buildContext } from "./shared";
import { partMoves, voiceLeadingDimension } from "./voiceLeading";

test("positive control: a roots-only bass leaping octaves is flagged as bass_leaps on the bass track in every section", () => {
  for (const anchor of anchors(["pop-full", "rock-full", "jazz-full"])) {
    const worsened = applyPurposeBuilt(anchor, "bass_roots_only_leaps")!;
    const d = detect(voiceLeadingDimension, anchor.input, worsened);
    assert.ok(d.detected, anchor.id);
    const leaps = d.newObservations.filter((o) => o.kind === "bass_leaps");
    assert.ok(leaps.length >= 2, `${anchor.id}: ${leaps.length} sections`);
    for (const o of leaps) {
      assert.deepEqual(o.location.trackIds, worsened.targetTrackIds);
      assert.ok((o.evidence.leapShare as number) >= 0.6, JSON.stringify(o.evidence));
      assert.equal(o.recommendedRepair?.operation, "plan_bass_contour");
    }
    // Recalibrated at the merge: the B-01/B-03 reference bass already carries
    // minor `bass_leaps` in most sections (pop 78.5, rock 80.8 before the
    // control), so the roots-only bass upgrades minor -> major and the drop is
    // ~19 on pop/rock (63 on jazz, whose reference bass walks). The pre-merge
    // threshold of 20 assumed a leap-free anchor; every section is still
    // upgraded (asserted above), and the drop must stay clearly above one
    // major observation's worth.
    assert.ok(d.scoreDrop! >= 15, `${anchor.id}: drop ${d.scoreDrop}`);
    assert.ok(leaps.every((o) => o.severity === "major" || o.severity === "blocking"), `${anchor.id}: every section upgraded beyond minor`);
  }
});

test("positive control: a part replaced by a sibling's line at the octave is heard as doubling between parts", () => {
  let detected = 0;
  let total = 0;
  for (const anchor of anchors(["pop-full", "rock-full", "dance-full", "jazz-full"])) {
    for (const part of eligibleParts(anchor, "parallel_doubling").filter((p) => p.family !== "bass")) {
      const worsened = applyFamilyCorruption(anchor, part.id, "parallel_doubling", 3, 1);
      if (!worsened) continue;
      total += 1;
      const d = detect(voiceLeadingDimension, anchor.input, worsened);
      if (!d.detected) continue;
      const doubling = d.newObservations.find((o) => o.kind === "part_doubles_another" || o.kind === "parallel_perfects_between_parts");
      if (!doubling) continue;
      detected += 1;
      assert.ok(doubling.location.trackIds.includes(part.id));
      assert.ok((doubling.evidence.parallelShare as number) >= 0.5);
    }
  }
  assert.ok(total >= 6 && detected / total >= 0.6, `doubling heard on ${detected}/${total}`);
});

test("the reference bed keeps a common tone in the same voice at fewer than half the chord changes that offer one: a real finding, carried in the measured evidence and located to the section where it is worst", () => {
  // Recalibrated at the merge. Before B-00 the pop bed kept *no* common tone
  // at any of the changes that offered one (retention 0, diagnosis weakness
  // #4). B-00's composer split keeps some now (5 of 13 changes, 0.38 over the
  // song), still below the dimension's 0.3 floor in Verse 2, where the
  // `no_common_tone_retention` observation stays. The finding is partially
  // fixed and the test says by how much.
  const anchor = anchors(["pop-full"])[0];
  const context = buildContext(anchor.input);
  const keys = context.pitched.find((p) => /bed/i.test(p.role))!;
  const moves = partMoves(context, keys).filter((m) => m.chordChanged && m.sharedPitchClasses > 0);
  assert.ok(moves.length >= 4);
  const retained = moves.filter((m) => m.retainedCommonTone).length;
  assert.ok(retained / moves.length < 0.5, `retained ${retained}/${moves.length}: a shared tone is still dropped more often than kept`);
  const report = voiceLeadingDimension.evaluate(anchor.input);
  const measured = report.observations.find((o) => o.kind === "measured" && o.location.trackIds[0] === keys.id)!;
  assert.equal(measured.evidence.commonToneRetention, Number((retained / moves.length).toFixed(4)));
  const located = report.observations.filter((o) => o.kind === "no_common_tone_retention" && o.location.trackIds[0] === keys.id);
  assert.ok(located.length >= 1, "at least one section is below the 0.3 floor and is named");
  assert.ok(located.every((o) => (o.evidence.commonToneRetention as number) < 0.3 && o.location.sectionName));
});

test("null control: no blocking voice-leading observation on any clean anchor", () => {
  for (const anchor of anchors(CLEAN_ANCHOR_IDS)) {
    const report = voiceLeadingDimension.evaluate(anchor.input);
    assert.ok(report.applicable);
    assert.equal(report.observations.filter((o) => o.severity === "blocking").length, 0, anchor.id);
  }
});
