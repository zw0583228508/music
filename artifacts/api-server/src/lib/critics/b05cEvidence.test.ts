import assert from "node:assert/strict";
import { mkdirSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import test from "node:test";
import { buildB05cEvidence } from "./b05cEvidence";

test("the B-05c evidence is built from the same runs the tests assert on, and is written when asked", { timeout: 5 * 60 * 1000 }, () => {
  const evidence = buildB05cEvidence({ now: new Date("2026-09-10T12:00:00.000Z") });

  // R-1b §4: every row is accounted for, and the ones that are still open say so.
  assert.equal(evidence.section4Table.length, 14);
  for (const row of evidence.section4Table) {
    assert.ok(row.observedDefect.length > 10);
    assert.ok(["closed", "partly_closed", "open"].includes(row.status));
    assert.ok(row.measuredOnTheOwnersSong.length > 10, row.observedDefect);
    if (row.status !== "open") assert.ok(row.caughtBy.length >= 1, row.observedDefect);
    else assert.equal(row.caughtBy.length, 0, row.observedDefect);
  }
  const open = evidence.section4Table.filter((r) => r.status === "open");
  assert.ok(open.length >= 2, "the rows this stream does not close are named, not quietly dropped");

  // The isolation, re-anchored at the B-21 merge (B-25). The finding is closed
  // in the writers, so what is asserted is the fix plus each control's
  // demonstrated sensitivity on a constructed case - never a deleted control.
  const iso = evidence.grooveIsolation;
  assert.ok(iso.reproduced.score! > 60, `groove on the owner's song: ${iso.reproduced.score} (B-05c 0, B-13 8.85)`);
  assert.equal(iso.reproduced.offGridObservations, 0, "the observation the finding was made of is not raised at all");
  assert.match(iso.reproduced.closedBy, /B-13/);
  assert.match(iso.reproduced.closedBy, /B-21/);
  // A null result is only a fix if the dimension still has sensitivity: the
  // constructed case puts it straight back on its floor.
  assert.equal(iso.reproducedOnAConstructedCase.score, 0);
  assert.ok(iso.reproducedOnAConstructedCase.offGridObservations >= 20);

  const a = iso.controls.find((c) => c.id === "A_remove_performance_timing")!;
  const b = iso.controls.find((c) => c.id === "B_quantise_to_the_composer_grid")!;
  assert.equal(a.moves, "no_finding_to_move", "neither layer carries an off_grid finding any more");
  assert.equal(b.moves, "no_finding_to_move", "and there is nothing on the bass for the grid control to remove");
  assert.equal(a.onTheOwnersSong.offGridObservations, 0);
  assert.equal(b.onTheOwnersSong.bassOffGridBeforeTheControl, 0);
  // Control A still tells the layers apart: the same displacement, applied
  // after composition and in the writing, is attributed the opposite way round.
  const performed = a.sensitivityDemonstratedOn.displacedAfterComposition;
  const written = a.sensitivityDemonstratedOn.displacedInTheWriting;
  assert.ok(performed && written, "control A reports both constructed cases");
  assert.equal(performed.total, written.total, "the same findings in both cases");
  assert.ok(performed.perform > performed.compose, `${performed.perform}/${performed.total} to perform when only the shipped notes moved`);
  assert.ok(written.compose > written.perform, `${written.compose}/${written.total} to compose when both layers moved`);
  assert.equal(performed.worstComposedShare, 0, "the composed notes are exactly on the grid in the performance-stage case");
  // Control B is still isolating: it removes the bass's findings and no others.
  const isolating = b.sensitivityDemonstratedOn.bassOnlyToSixteenths;
  assert.ok(isolating, "control B reports the bass-only isolation");
  assert.ok(isolating.bassBefore >= 5 && isolating.bassAfter === 0, `bass ${isolating.bassBefore} -> ${isolating.bassAfter}`);
  assert.ok(isolating.keysUnchanged && isolating.stringsUnchanged, "the parts it did not touch report what they reported before");
  const sixteenths = b.sensitivityDemonstratedOn.allHarmonyToSixteenths;
  const eighths = b.sensitivityDemonstratedOn.allHarmonyToEighths;
  assert.ok(sixteenths && eighths, "control B reports both grids");
  assert.ok(eighths.score! > sixteenths.score!, "on a grid and with the kit are still not the same claim");
  assert.equal(sixteenths.offGrid, 0);
  assert.ok(sixteenths.harmonyOffGrid >= 1);

  assert.match(iso.cause.named, /closed/);
  assert.ok(iso.cause.ruledOut.length >= 3);
  assert.equal(iso.cause.attributionAfterTheFix.total, 0, "there is nothing left to attribute on the owner's song");
  assert.ok(iso.cause.attributionOnTheConstructedCase.displacedInTheWriting.compose
    > iso.cause.attributionOnTheConstructedCase.displacedInTheWriting.perform,
    "and where there is, the attribution still names the layer that moved the notes");
  assert.equal(iso.cause.whatIsLeft.length, 1, "one harmony_off_grid major on the strings, named rather than dropped");

  // The judge, before and after.
  const j = evidence.judgeOnTheOwnersSong;
  assert.equal(j.after.releasable, false, "the owner's output is still refused - one blocking harmony finding on the bed the brief asks for");
  assert.ok(j.after.refusals.length >= 1);
  assert.equal(j.after.topProblems.length, 3);
  // B-25: three of the four findings R-1b ranked here are closed in the
  // writers, so their positions are `null` rather than a rank - and `null` is
  // asserted, because a 0 would read as "first".
  for (const key of ["emptyIntro", "stringBed", "offGridHarmony"] as const) {
    assert.equal(j.after.positions[key], null, `${key} is not raised on the owner's song at all`);
    assert.equal(j.before.positions[key], null, `${key}: the v1 ordering has nothing to rank either`);
  }
  assert.ok(j.after.closedInTheWriters.emptyIntro.includes("B-21"));
  // The ordering R-1b P0-5 asked for is demonstrated where the findings exist.
  const constructed = j.after.onTheConstructedCase;
  assert.equal(constructed.built, true, "the constructed case builds from the anchor set's own transforms");
  assert.equal(constructed.releasable, false);
  for (const kind of ["off_grid", "single_voice_bed", "top_line_above_comfortable_ceiling", "planned_family_silent"]) {
    assert.ok(constructed.refusalKinds.includes(kind), `${kind} refuses on the constructed case`);
  }
  const pos = constructed.positions;
  assert.ok(pos.emptyIntro! > pos.stringBed!, `the empty intro (#${pos.emptyIntro}) does not outrank the string bed (#${pos.stringBed})`);
  assert.ok(pos.emptyIntro! > pos.offGridHarmony!, `…or the off-grid harmony (#${pos.offGridHarmony})`);
  assert.equal(pos.aboveTheIntroAllBlocking, true, "everything above the intro is blocking");

  // The ranking on the corpus.
  assert.equal(evidence.rankingOnTheCorpus.length, 4);
  for (const c of evidence.rankingOnTheCorpus) {
    assert.equal(c.selected, "reference", `${c.case}: the reference composer is preferred to both probes`);
    assert.equal(c.order.length, 3);
    assert.ok(c.order.every((o) => o.why.length > 10));
  }

  // The ledger diff, with every demotion.
  assert.equal(evidence.ledgerDiff.length, 16);
  assert.ok(evidence.ledgerDiffSummary.demoted.length >= 3, "the demotions are reported, not hidden");
  assert.ok(evidence.ledgerDiffSummary.demoted.every((d) => d.includes("(")), "each demotion carries its reason");
  for (const row of evidence.ledgerDiff) {
    if (row.after === "gated") assert.ok(row.gatingTransforms.length >= 2, `${row.dimension}: two independent transforms`);
    else assert.ok(row.reason.length > 10, `${row.dimension}: a non-gated dimension says why`);
  }
  assert.equal(evidence.sensitivityRule.rule.minTransformsToGate, 2);
  assert.equal(evidence.sensitivityRule.rule.preparedMayGate, false);

  assert.ok(evidence.honestLimits.length >= 8);
  assert.equal(evidence.retiredFromRanking.musicCritic.dimensions.length, 11);
  assert.equal(evidence.redSuites.length, 12, "the twelve red tests, each with its cause");

  const out = process.env.B05C_WRITE_EVIDENCE;
  if (out) {
    const path = resolve(out);
    mkdirSync(resolve(path, ".."), { recursive: true });
    writeFileSync(path, `${JSON.stringify(evidence, null, 2)}\n`, "utf8");
    console.log(`evidence written to ${path}`);
  }
});
