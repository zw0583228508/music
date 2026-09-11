import assert from "node:assert/strict";
import { mkdirSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import test from "node:test";
import { buildB05bEvidence } from "./evidence";

test("the evidence file is built from the same runs the tests assert on, and is written when asked", () => {
  const evidence = buildB05bEvidence({ now: new Date("2026-09-10T12:00:00.000Z") });
  assert.equal(evidence.positiveControls.length, 8);
  for (const c of evidence.positiveControls) {
    assert.equal(c.detected, c.tried, `${c.dimension}: every applicable anchor detected (${c.detected}/${c.tried})`);
    assert.ok(c.tried >= 3);
    assert.ok(["gated", "informing"].includes(c.ledgerStatus));
  }
  assert.ok(evidence.referenceComposerUnderAdversarialCritic.axes.some((a) => a.anchorsWithMajorOrBlocking >= 2), "the reference composer is rejected on at least one axis");
  assert.ok(evidence.judgeExamples.length >= 2);
  for (const ex of evidence.judgeExamples) {
    assert.equal(ex.withoutLedger.blocking.length, 0, "without a ledger nothing blocks");
  }
  // Recalibrated at the merge (B-01): the intact orchestral anchor no longer
  // has silent planned keys; the injected variant carries that defect.
  const orchestral = evidence.judgeExamples.find((e) => e.anchor === "orchestral-midi")!;
  assert.equal(orchestral.withMeasuredLedger.blocking.length, 0, "since B-01 the intact orchestral anchor carries no blocking finding");
  const silenced = evidence.judgeExamples.find((e) => e.anchor === "orchestral-midi+keys_silenced")!;
  assert.equal(silenced.withMeasuredLedger.releasable, false, "with the measured ledger the silent planned keys block");
  assert.equal(silenced.withoutLedger.releasable, true, "without a ledger the same finding cannot block");
  // Re-anchored at the B-21 merge (B-26): **A CONTROL THAT LOST ITS LEVER.**
  // This line used to read "at least one *anchor* produces a recorded
  // disagreement", and it passed because one anchor happened to carry two
  // opposing findings at overlapping bars. Measured after B-21, **all ten
  // anchors produce zero** disagreements (6-20 agreements each) — so the
  // assertion was testing the composer's accidents, not the judge's
  // disagreement machinery, and the machinery had no demonstrated sensitivity
  // at all. It is re-pointed at a constructed case rather than deleted, exactly
  // as the register and density controls in this merge are: the fighting
  // module's **own** positive control (`same_register_offbeat`) puts two parts
  // into one register with clashing onsets, which makes
  // `adversarial.boredom:rhythm_predictable` and
  // `adversarial.fighting:register_fight` overlap on the same bars. That is the
  // "rhythmic independence" opposition, no `RESOLUTION_RULES` entry covers the
  // pair, and the judge therefore keeps it **open** — which is the documented
  // behaviour ("a disagreement no rule resolves stays open") and the thing the
  // evidence has to be able to show.
  const intactDisagreements = evidence.judgeExamples
    .filter((e) => !e.anchor.includes("+"))
    .flatMap((e) => e.withMeasuredLedger.disagreements);
  assert.deepEqual(intactDisagreements, [],
    "B-21: no intact anchor produces a disagreement of its own any more — which is why the case below is constructed");
  const constructed = evidence.judgeExamples.find((e) => e.anchor === "orchestral-midi+same_register_offbeat");
  assert.ok(constructed, "the constructed disagreement case is in the evidence");
  const disagreements = constructed!.withMeasuredLedger.disagreements;
  assert.ok(disagreements.length >= 1, "the constructed case produces a recorded disagreement");
  for (const d of disagreements) {
    assert.equal(d.topic, "rhythmic independence");
    assert.equal(d.resolution, "kept_open", d.rationale);
    assert.match(d.rationale, /no resolution rule covers/);
    assert.deepEqual(d.positions.map((p) => p.dimension).sort(), ["adversarial.boredom", "adversarial.fighting"]);
    // Both positions carry their own evidence, which is the point of keeping it open.
    for (const p of d.positions) assert.ok(p.evidenceRef.length > 0 && p.stance.length > 0);
  }
  assert.ok(evidence.honestLimits.length >= 5);

  const out = process.env.B05B_WRITE_EVIDENCE;
  if (out) {
    const path = resolve(out);
    mkdirSync(resolve(path, ".."), { recursive: true });
    writeFileSync(path, `${JSON.stringify(evidence, null, 2)}\n`, "utf8");
    console.log(`evidence written to ${path}`);
  }
});
