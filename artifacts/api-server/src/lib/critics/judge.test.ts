import assert from "node:assert/strict";
import test from "node:test";
import type { CriticDimensionReport, CriticObservation, Severity } from "./types.b05b";
import { OPPOSITIONS, PRIORITY_RULES, RESOLUTION_RULES, judge, judgeContextFromInput, type JudgeContext } from "./judge";
import { anchorFor } from "./adversarial/anchors";
import { runAdversarialCritics } from "./adversarial/index";

function obs(dimension: string, kind: string, severity: Severity, startBar: number, endBar: number, confidence: number, trackIds: string[] = ["keys"], repair = "fix"): CriticObservation {
  return {
    id: `${dimension}:${kind}:${startBar}-${endBar}:${trackIds.join("+")}`,
    dimension, kind, severity,
    location: { startBar, endBar, trackIds },
    evidence: { measured: 1 },
    suspectedOrigin: "compose", originConfidence: 0.5,
    recommendedRepair: { operation: repair, scope: "part", detail: repair },
    confidence,
  };
}

function report(dimension: string, controlStatus: CriticDimensionReport["summary"]["controlStatus"], observations: CriticObservation[], coverage = 1): CriticDimensionReport {
  return { dimension, version: "test", applicable: true, observations, summary: { score0to100: 80, coverage, controlStatus } };
}

const CTX: JudgeContext = {
  sections: [
    { name: "Verse", startBar: 1, endBar: 8, role: "verse", isClimax: false, isSung: true },
    { name: "Chorus", startBar: 9, endBar: 16, role: "chorus", isClimax: true, isSung: true },
    { name: "Solo", startBar: 17, endBar: 24, role: "instrumental", isClimax: false, isSung: false },
  ],
};

test("rules are data: every priority, opposition and resolution rule is declarative and documented", () => {
  for (const r of PRIORITY_RULES) {
    assert.ok(r.id && r.description.length > 20 && r.boost > 1);
    assert.ok(Object.keys(r.when).length >= 1, `${r.id} matches on something`);
  }
  for (const o of OPPOSITIONS) assert.ok(o.topic && Object.keys(o.a).length && Object.keys(o.b).length);
  for (const r of RESOLUTION_RULES) {
    assert.ok(OPPOSITIONS.some((o) => o.topic === r.topic), `${r.id} resolves a declared opposition`);
    assert.ok(r.description.length > 20);
  }
});

test("conflicting stances at the same bars are kept open, both positions reported with their evidence", () => {
  const constructive = report("constructive.density", "informing", [obs("constructive.density", "too_sparse", "major", 9, 16, 0.7, ["keys"], "thicken")]);
  const adversarial = report("adversarial.machineMade", "informing", [obs("adversarial.machineMade", "no_rests", "minor", 9, 16, 0.6, ["keys"], "add_rests")]);
  const verdict = judge([constructive, adversarial], { sections: [{ name: "Bridge", startBar: 9, endBar: 16, role: "bridge", isClimax: false, isSung: false }] });
  assert.equal(verdict.disagreements.length, 1);
  const d = verdict.disagreements[0];
  assert.equal(d.topic, "texture density");
  assert.equal(d.resolution, "kept_open");
  assert.match(d.rationale, /kept open: no resolution rule/);
  assert.deepEqual(d.positions.map((p) => p.dimension).sort(), ["adversarial.machineMade", "constructive.density"]);
  assert.ok(d.positions.every((p) => p.evidenceRef.includes(":") && p.stance.includes("confidence")));
  // Both observations are still ranked; nothing was dropped to make a consensus.
  assert.equal(verdict.ranked.length, 2);
  assert.equal(verdict.agreements.length, 0);
  assert.ok(verdict.overall.reasons.some((r) => /1 disagreement\(s\) kept open/.test(r)));
});

test("a resolution rule resolves a disagreement and names itself", () => {
  const a = report("adversarial.fighting", "informing", [obs("adversarial.fighting", "melody_masked", "major", 9, 16, 0.8, ["keys"], "clear_vocal_register")]);
  const b = report("adversarial.professionalWouldChange", "informing", [obs("adversarial.professionalWouldChange", "no_top_voice_line", "major", 9, 16, 0.8, ["keys", "strings"], "write_top_line")]);
  const verdict = judge([a, b], CTX);
  assert.equal(verdict.disagreements.length, 1);
  assert.equal(verdict.disagreements[0].resolution, "resolved");
  assert.match(verdict.disagreements[0].rationale, /resolved by rule singer_first/);
  assert.match(verdict.disagreements[0].rationale, /Winner: adversarial\.fighting:melody_masked/);
  // The same pair outside a sung section is not resolved by that rule.
  const solo = judge([
    report("adversarial.fighting", "informing", [obs("adversarial.fighting", "melody_masked", "major", 17, 24, 0.8)]),
    report("adversarial.professionalWouldChange", "informing", [obs("adversarial.professionalWouldChange", "no_top_voice_line", "major", 17, 24, 0.8)]),
  ], CTX);
  assert.equal(solo.disagreements[0].resolution, "kept_open");
});

test("a blocking observation from a gated dimension makes the verdict unreleasable", () => {
  const gated = report("adversarial.instrumentReality", "gated", [obs("adversarial.instrumentReality", "physically_unplayable", "blocking", 3, 5, 0.5, ["bass"])]);
  const verdict = judge([gated], CTX);
  assert.equal(verdict.overall.releasable, false);
  assert.equal(verdict.blocking.length, 1);
  assert.match(verdict.overall.reasons[0], /1 blocking observation\(s\) from gated dimension/);
  assert.equal(verdict.ranked[0].observation.kind, "physically_unplayable");
  assert.match(verdict.ranked[0].rationale, /boosted by playability_outranks_style/);
});

test("a demoted or uncalibrated dimension can inform but never block", () => {
  for (const status of ["demoted", "uncalibrated"] as const) {
    const r = report("adversarial.arbitrariness", status, [obs("adversarial.arbitrariness", "planned_family_silent", "blocking", 9, 16, 0.99, [])]);
    const verdict = judge([r], CTX);
    assert.equal(verdict.overall.releasable, true, `${status} cannot block`);
    assert.equal(verdict.blocking.length, 0);
    assert.equal(verdict.ranked.length, 1, "it still informs");
    assert.match(verdict.ranked[0].rationale, new RegExp(`cannot block: dimension adversarial.arbitrariness is ${status}`));
    assert.ok(verdict.overall.reasons.some((x) => /could not block because their dimension is not gated/.test(x)));
  }
});

test("priorities follow musical context: blocking playability outranks a confident style nuance; vocal space outranks density when sung; arrival outranks restraint at the climax", () => {
  const verdict = judge([
    report("adversarial.instrumentReality", "gated", [obs("adversarial.instrumentReality", "physically_unplayable", "blocking", 9, 12, 0.5, ["strings"])]),
    report("adversarial.boredom", "gated", [obs("adversarial.boredom", "identical_bars", "major", 9, 16, 0.99, ["strings"])]),
    report("adversarial.fighting", "gated", [obs("adversarial.fighting", "melody_masked", "major", 1, 8, 0.6, ["keys"])]),
    report("adversarial.machineMade", "gated", [obs("adversarial.machineMade", "no_rests", "major", 1, 8, 0.9, ["keys"])]),
    report("adversarial.causality", "gated", [obs("adversarial.causality", "climax_not_realised", "major", 9, 16, 0.5, [])]),
  ], CTX);
  const order = verdict.ranked.map((r) => r.observation.kind);
  assert.equal(order[0], "physically_unplayable", "blocking playability first even at confidence 0.5");
  assert.ok(order.indexOf("melody_masked") < order.indexOf("no_rests"), "in a sung verse the singer outranks density");
  assert.ok(order.indexOf("climax_not_realised") < order.indexOf("identical_bars"), "at the climax arrival outranks a repetition nuance");
  const styleRank = verdict.ranked.find((r) => r.observation.kind === "identical_bars")!;
  assert.match(styleRank.rationale, /outranked by .*physically_unplayable.* under playability_outranks_style/);
});

test("the judge never fabricates consensus: one dimension is never an agreement; two dimensions on the same code combine by noisy-OR, not a mean", () => {
  const single = judge([report("adversarial.boredom", "informing", [
    obs("adversarial.boredom", "identical_bars", "minor", 1, 8, 0.9, ["drums"]),
    obs("adversarial.boredom", "rhythm_predictable", "minor", 1, 8, 0.9, ["drums"]),
  ])], CTX);
  assert.equal(single.agreements.length, 0, "the same critic saying two things is not two critics agreeing");
  const two = judge([
    report("adversarial.boredom", "informing", [obs("adversarial.boredom", "everyone_always_playing", "major", 1, 16, 0.6, [])]),
    report("constructive.coherence", "informing", [obs("constructive.coherence", "ensemble_never_changes", "minor", 4, 20, 0.5, [])]),
  ], CTX);
  assert.equal(two.agreements.length, 1);
  assert.equal(two.agreements[0].code, "GLOBAL_COHERENCE_FAILURE");
  assert.deepEqual(two.agreements[0].dimensions, ["adversarial.boredom", "constructive.coherence"]);
  assert.equal(two.agreements[0].combinedConfidence, 0.8, "1 - (1-0.6)(1-0.5)");
  assert.equal(two.agreements[0].startBar, 4);
  assert.equal(two.agreements[0].endBar, 16);
  // Empty input: nothing agreed, nothing disagreed, releasable only in the weak sense and it says so.
  const empty = judge([], CTX);
  assert.equal(empty.agreements.length, 0);
  assert.equal(empty.disagreements.length, 0);
  assert.equal(empty.overall.releasable, true);
  assert.match(empty.overall.reasons[0], /no gated dimension was applicable/);
});

test("deterministic: the same reports in any order give the same verdict", () => {
  const reports = [
    report("adversarial.fighting", "informing", [obs("adversarial.fighting", "melody_masked", "major", 9, 16, 0.8)]),
    report("adversarial.professionalWouldChange", "informing", [obs("adversarial.professionalWouldChange", "no_top_voice_line", "major", 9, 16, 0.8)]),
    report("adversarial.machineMade", "demoted", [obs("adversarial.machineMade", "no_rests", "minor", 9, 16, 0.6)]),
    report("constructive.density", "informing", [obs("constructive.density", "too_sparse", "major", 9, 16, 0.7, ["keys"], "thicken")]),
  ];
  const a = judge(reports, CTX);
  const b = judge([...reports].reverse(), CTX);
  assert.deepEqual(a, b);
});

test("coverage is reported per dimension and weighted by control status", () => {
  const verdict = judge([
    report("a", "gated", [], 1),
    report("b", "demoted", [], 0),
    { dimension: "c", version: "t", applicable: false, reasonIfNot: "no repeats", observations: [], summary: { score0to100: null, coverage: 0, controlStatus: "informing" } },
  ], CTX);
  assert.equal(verdict.coverage.dimensionsTotal, 3);
  assert.equal(verdict.coverage.dimensionsApplicable, 2);
  assert.equal(verdict.coverage.byDimension.c.applicable, false);
  assert.equal(verdict.coverage.weighted, Number((1 / (1 + 0.25 + 0.6)).toFixed(4)));
});

test("on a real anchor: context comes from the plan and the vocal evidence, and the verdict on uncalibrated reports cannot block", () => {
  const a = anchorFor("orchestral-midi");
  const ctx = judgeContextFromInput(a.input);
  assert.ok(ctx.sections.length >= 3);
  assert.equal(ctx.sections.find((s) => s.isClimax)?.name, "Chorus");
  assert.ok(ctx.sections.every((s) => !s.isSung), "an instrumental anchor has no sung section");
  const pop = judgeContextFromInput(anchorFor("pop-full").input);
  assert.ok(pop.sections.some((s) => s.isSung), "a vocal anchor has sung sections");
  const verdict = judge(runAdversarialCritics(a.input), ctx);
  assert.equal(verdict.overall.releasable, true);
  assert.ok(verdict.ranked.some((r) => r.observation.kind === "planned_family_silent"));
  assert.ok(verdict.overall.reasons.some((r) => /could not block because their dimension is not gated/.test(r)));
  // With a measured ledger the same blocking finding blocks.
  const gated = judge(runAdversarialCritics(a.input, { controlLedger: { "adversarial.arbitrariness": "gated" } }), ctx);
  assert.equal(gated.overall.releasable, false);
  assert.ok(gated.blocking.every((b) => b.dimension === "adversarial.arbitrariness"));
});
