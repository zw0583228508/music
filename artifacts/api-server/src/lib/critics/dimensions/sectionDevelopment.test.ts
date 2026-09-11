import assert from "node:assert/strict";
import test from "node:test";
import { anchors, applyPreparation, applyPurposeBuilt, CLEAN_ANCHOR_IDS, detect } from "./anchors";
import { buildContext } from "./shared";
import { readDevelopment, sectionDevelopmentDimension } from "./sectionDevelopment";

test("re-anchored (B-05c): at the planned climax the composer develops but does not keep identity — variation without a recurring identity", () => {
  // Re-anchored, with the cause.
  //
  // Before B-01 this test pinned "chorus 2 is chorus 1 note for note"
  // (`repeat_without_development`). At the B-01 merge it was re-anchored to the
  // opposite claim: identity kept AND developed. Measured on `origin/main`
  // 31b9443 after B-02 (harmony chain), B-04 (groove plan) and B-10 (motif
  // engine) changed the composer again, neither half of that claim holds:
  //
  //   pop-full        identityShare 0.333  developed in register, dynamics, rhythm
  //   rock-full       identityShare 0.375  developed in instrumentation, register, dynamics, rhythm
  //   dance-full      identityShare 0.219  developed in register
  //   acoustic-demo   identityShare 0.000  developed in register, dynamics — and `repeat_without_identity`
  //
  // The cause is the composer, not the dimension: chorus 2 is now written from
  // a different groove cell and a different voicing set, so nothing recurs
  // bar-for-bar. R-1b §5 measured the same thing on the owner's song ("identity
  // share with Chorus 1 is 0.15: nothing recurs, nothing is developed; it is a
  // different section with the same chords") and lists it as the *new* problem
  // B-01 introduced while fixing the literal repeat. The dimension is right and
  // the test now pins what it reads.
  //
  // Re-anchored again at the B-13 merge, and the news is partly good. Measured
  // here (identity share, then the axes the dimension reads as developed):
  //
  //   pop-full        0.458 (was 0.333)  register, dynamics, rhythm
  //   rock-full       0.458 (was 0.375)  instrumentation, register, dynamics, texture
  //                                      — and `identityKept` is now **true**
  //   dance-full      0.188 (was 0.219)  register, dynamics — and `repeat_without_identity`
  //   acoustic-demo   0.250 (was 0.000)  register, dynamics — and the finding is gone
  //
  // B-13's writers give chorus 2 more in common with chorus 1 than B-01..B-10
  // left it: the identity share rises on three of the four anchors, rock-full
  // crosses the threshold into "identity kept *and* developed" — the claim
  // B-01 made and could not hold — and acoustic-demo, which had 0, is no longer
  // reported as a repeat without identity. dance-full moves the other way and
  // is the one anchor that now carries the finding, which the table pins.
  //
  // **Re-anchored at the B-21 merge (B-26): a STALE PIN, and every number in it
  // moved.** Measured on this tree against `3b9ace3` (identity share at the
  // planned climax, then the axes the dimension reads as developed):
  //
  //   anchor         identity B-13 -> B-21   developed in
  //   pop-full       0.458 -> 0.458          register,dynamics,rhythm -> dynamics,rhythm
  //   rock-full      0.458 -> 0.375          instrumentation,register,dynamics,texture -> instrumentation,dynamics,rhythm
  //                                          — `identityKept` true -> FALSE
  //   dance-full     0.188 -> 0.219          register,dynamics (unchanged) — `repeat_without_identity` GONE
  //   acoustic-demo  0.250 -> 0.125          register,dynamics (unchanged) — `repeat_without_identity` NEW
  //
  // Two things are going on and both are B-21's D4. `register` disappears from
  // pop-full's and rock-full's developed axes because the writers no longer
  // lift chorus 2 out of the role register the profile gives it — a piano
  // HARMONIC_BED is 48-67 and a chorus that was developed by rising above it
  // now develops in dynamics and rhythm instead. And which anchor sits at the
  // identity floor changes hands: dance-full crosses up over the threshold
  // (0.188 -> 0.219) and acoustic-demo falls under it (0.250 -> 0.125).
  //
  // The same event on **main** (7c14ecf, without B-21) is the first half of it
  // only — dance-full at 0.25 no longer reports `repeat_without_identity`, and
  // that is the one of main's own two red tests in these nine suites. It is the
  // same class and the same treatment; the numbers here are measured with B-21
  // on top, which is what will be merged.
  //
  // Whether "develops in dynamics and rhythm but not register" is worse than
  // "develops in register too" is a musical question this suite cannot settle
  // — the register axis was being earned by writing above the instrument's own
  // ceiling, which is the defect B-21 was sent to fix. Recorded as measured.
  const expected: Record<string, { identityKept: boolean; developed: string[] }> = {
    "pop-full": { identityKept: false, developed: ["dynamics", "rhythm"] },
    "rock-full": { identityKept: false, developed: ["instrumentation", "dynamics", "rhythm"] },
    // Re-measured at the B-20 merge (the anchors no longer run the repair
    // stage): dance-full develops in dynamics and rhythm where it developed in
    // register and dynamics before. The repair pass had been changing the
    // register of that chorus, and the anchor was recording the repair's work
    // as the composer's.
    "dance-full": { identityKept: false, developed: ["dynamics", "rhythm"] },
    "acoustic-demo": { identityKept: false, developed: ["register", "dynamics"] },
  };
  /** The anchors whose climax the dimension reports as a repeat without identity, measured. */
  const withoutIdentity = new Set(["acoustic-demo"]);
  for (const anchor of anchors(["pop-full", "rock-full", "dance-full", "acoustic-demo"])) {
    const report = sectionDevelopmentDimension.evaluate(anchor.input);
    const climax = anchor.input.plan.globalPlan!.climax!.sectionName;
    const measured = report.observations.find((x) => x.kind === "measured" && x.location.sectionName === climax);
    assert.ok(measured, `${anchor.id}: ${report.observations.map((x) => `${x.kind}@${x.location.sectionName}`).join(",")}`);
    assert.equal(measured!.evidence.plannedClimax, true);
    const want = expected[anchor.id];
    assert.equal(measured!.evidence.identityKept, want.identityKept, `${anchor.id}: identityShare ${measured!.evidence.identityShare}`);
    for (const axis of want.developed) {
      assert.ok(String(measured!.evidence.developedIn).includes(axis), `${anchor.id}: developed in ${measured!.evidence.developedIn}, expected ${axis}`);
    }
    // The pre-B-01 finding stays gone: the composer does develop the climax.
    assert.equal(report.observations.find((x) => x.kind === "repeat_without_development" && x.location.sectionName === climax), undefined,
      `${anchor.id}: the pre-merge finding must not come back`);
    // …and the dimension reports the loss of identity where it reads one.
    // B-05c could tie this to `identityShare === 0` because acoustic-demo was
    // the only anchor at the floor; at B-13 no anchor is at 0 and dance-full
    // (0.188) is the one the dimension reports, so the anchors are named.
    const lost = report.observations.find((x) => x.kind === "repeat_without_identity" && x.location.sectionName === climax);
    assert.equal(Boolean(lost), withoutIdentity.has(anchor.id), `${anchor.id}: identityShare ${measured!.evidence.identityShare}`);
  }
});

test("a developed chorus 2 (bed up an octave, +10 velocity) reads as developed in register and dynamics", () => {
  const anchor = anchors(["pop-full"])[0];
  const prepared = applyPreparation(anchor, "develop_chorus_2")!;
  const context = buildContext(prepared.input);
  const c1 = context.sections.find((s) => s.name === "Chorus")!;
  const c2 = context.sections.find((s) => s.name === "Chorus 2")!;
  const reading = readDevelopment(context, c1, c2)!;
  // Re-anchored (B-05c): the `identityKept` assertion is dropped for the cause
  // above — the preparation lifts the bed an octave *on top of* a chorus 2 that
  // already shares only 0.33 of its bars with chorus 1, so identity is 0.29 and
  // the reading is right to say so. What the preparation is for is the two axes
  // it moves, and those are what the test pins.
  assert.equal(reading.identityKept, false, `identityShare ${reading.identityShare}`);
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
    // Re-anchored (B-05c): the drop is smaller on acoustic-demo, and the cause
    // is in the anchor, not the control. Its prepared chorus 2 already carries
    // `repeat_without_identity` (identityShare 0), so pasting chorus 1 over it
    // trades one major finding for another instead of adding one: 4.95 points
    // against 7.8-8.0 on the three anchors whose chorus 2 still has an identity
    // to lose. Asserting one threshold for all four would either hide that or
    // require loosening the threshold for every anchor.
    //
    // Re-anchored again at the B-13 merge: the *shape* of that reasoning is
    // unchanged and so is the rule below, but three anchors now sit at the
    // floor instead of one. The preparation lifts the bed an octave on top of a
    // chorus 2 that B-13 writes from the groove plan's cells, and on rock-full
    // (prepared identity 0.167), dance-full (0.188) and acoustic-demo (0.000)
    // that is already a repeat without identity; only pop-full (0.208) still
    // has an identity left to lose, and only it drops the full 7.8. Measured
    // drops: pop-full 7.80, acoustic-demo 4.95, rock-full 4.80, dance-full
    // 4.68. The floors are untouched; which anchor sits at which is measured.
    //
    // **Re-anchored at the B-21 merge (B-26): a STALE PIN, and it moved the
    // right way.** The floors and the rule are again untouched; three of the
    // four anchors now have an identity to lose where only one did:
    //
    //   anchor         prepared identity B-13 -> B-21   already without identity   drop
    //   pop-full       0.208 -> 0.208                   no  -> no                  7.80 -> 7.80
    //   rock-full      0.167 -> 0.208                   yes -> NO                  4.80 -> 8.00
    //   dance-full     0.188 -> 0.219                   yes -> NO                  4.68 -> 7.80
    //   acoustic-demo  0.000 -> 0.000                   yes -> yes                 4.95 -> 4.95
    //
    // B-21's writers give chorus 2 more in common with chorus 1 on rock-full
    // and dance-full, so the prepared anchor is no longer already at the floor
    // and pasting chorus 1 over it costs the full 7.8-8.0 instead of trading
    // one finding for another. Only acoustic-demo still starts at 0.
    const anchorReport = sectionDevelopmentDimension.evaluate(prepared.input);
    const alreadyWithoutIdentity = anchorReport.observations.some((x) => x.kind === "repeat_without_identity" && x.location.sectionName === "Chorus 2");
    const floor = alreadyWithoutIdentity ? 4.5 : 7;
    assert.ok(d.scoreDrop! >= floor, `${anchor.id}: ${d.scoreDrop} (identity already lost: ${alreadyWithoutIdentity})`);
    assert.equal(alreadyWithoutIdentity, anchor.id === "acoustic-demo", `${anchor.id}: which anchors sit at the dimension's floor`);
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
