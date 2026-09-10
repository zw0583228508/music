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
  assert.ok(evidence.judgeExamples.some((e) => e.withMeasuredLedger.disagreements.length >= 1), "at least one anchor produces a recorded disagreement");
  assert.ok(evidence.honestLimits.length >= 5);

  const out = process.env.B05B_WRITE_EVIDENCE;
  if (out) {
    const path = resolve(out);
    mkdirSync(resolve(path, ".."), { recursive: true });
    writeFileSync(path, `${JSON.stringify(evidence, null, 2)}\n`, "utf8");
    console.log(`evidence written to ${path}`);
  }
});
