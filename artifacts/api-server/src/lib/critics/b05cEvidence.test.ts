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

  // The isolation: one control moves the finding and the other does not.
  const iso = evidence.grooveIsolation;
  // The finding must still *reproduce* — that is what makes the isolation
  // meaningful — but its exact score is not the point and pinning it made this
  // suite red the moment B-13 improved the thing it measures (0 → 6.31 of 100,
  // with 12 off-grid observations still standing). Assert the property: the
  // dimension is still failing badly and the observations are still there.
  assert.equal(typeof iso.reproduced.score, "number", "the dimension scored the owner's song at all");
  assert.ok(iso.reproduced.score! < 25, `the off-grid finding still reproduces (score ${iso.reproduced.score}/100)`);
  assert.ok(iso.reproduced.offGridObservations >= 5, `and still carries its observations (${iso.reproduced.offGridObservations})`);
  const a = iso.controls.find((c) => c.id === "A_remove_performance_timing")!;
  const b = iso.controls.find((c) => c.id === "B_quantise_to_the_composer_grid")!;
  assert.equal(a.moves, false, "the composed notes carry the finding: the performance stage is not the cause");
  assert.equal(b.moves, true, "quantising to the composer's grid removes it");
  assert.equal(iso.cause.named, "the composer, through the analysed chord onsets");
  assert.ok(iso.cause.ruledOut.length >= 3);
  assert.ok(iso.cause.attributionAfterTheFix.compose > iso.cause.attributionAfterTheFix.perform);

  // The judge, before and after.
  const j = evidence.judgeOnTheOwnersSong;
  assert.equal(j.after.releasable, false, "the owner's R-1b output is refused");
  assert.ok(j.after.refusals.length >= 3);
  assert.equal(j.after.topProblems.length, 3);
  assert.ok(j.before.positions.emptyIntro === 1, "R-1b's finding reproduces: the empty two-bar intro led the v1 ordering");
  assert.ok(j.after.positions.emptyIntro > j.after.positions.stringBed, "and no longer outranks the string bed");
  // R-1b also had the empty intro ranked below the off-grid harmony. B-13 then
  // fixed the harmony's alignment, so that finding falls down the ordering
  // (position 4 → 6) and the intro rises above it — which is correct: the
  // harmony lands on the grid now and the two-bar intro is still silent. The
  // assertion is therefore on the *movement*, not on the pair's order.
  assert.ok(
    j.after.positions.offGridHarmony > j.before.positions.offGridHarmony,
    `the off-grid harmony falls down the ordering after B-13 (${j.before.positions.offGridHarmony} → ${j.after.positions.offGridHarmony})`,
  );

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
