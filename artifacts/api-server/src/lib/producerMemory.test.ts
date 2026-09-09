import assert from "node:assert/strict";
import test from "node:test";
import type { BriefDelta, ProducerBriefDecision } from "@workspace/db";
import {
  deltaForDecision,
  describeMemoryApplied,
  memoryCompileInputs,
  memoryDecisionsIn,
  memoryRefusalReason,
  memoryRuleFromDecision,
  memorySourceRef,
  ProducerMemoryError,
} from "./producerMemory";

const delta: BriefDelta = { kind: "instrumentation", remove: ["strings"], rationale: "no high strings, ever" };

function decision(over: Partial<ProducerBriefDecision> = {}): ProducerBriefDecision {
  return {
    id: "dec-1",
    scope: { kind: "global" },
    topic: "instrumentation",
    statement: "no high strings",
    strength: "hard",
    provenance: "stated",
    confidence: 0.9,
    sourceRefs: ["text:no high strings"],
    supersedes: [],
    createdBy: "chat",
    createdAt: "2026-09-09T00:00:00.000Z",
    ...over,
  } as ProducerBriefDecision;
}

test("only the producer's own statements become standing rules", () => {
  assert.equal(memoryRefusalReason(decision(), delta), null);
  assert.match(memoryRefusalReason(decision({ provenance: "inferred" }), delta)!, /Only what you said yourself/);
  assert.match(memoryRefusalReason(decision({ provenance: "researched" }), delta)!, /is researched, not stated/);
  assert.match(memoryRefusalReason(decision({ provenance: "default" }), delta)!, /is default, not stated/);
  assert.equal(memoryRefusalReason(decision(), null), null, "a decision read from the intake text has no stored delta and is still keepable");
  assert.match(memoryRefusalReason(decision({ topic: "reference" }), delta)!, /belongs to this song/);
  assert.throws(
    () => memoryRuleFromDecision({ id: "mem-1", decision: decision({ provenance: "inferred" }), delta, projectId: "p1", briefId: "b1" }),
    (error: unknown) => error instanceof ProducerMemoryError && error.status === 409,
  );
});

test("a rule carries the statement verbatim, its delta and where it was stated", () => {
  const rule = memoryRuleFromDecision({
    id: "mem-1", decision: decision(), delta, projectId: "p1", briefId: "b1", now: new Date("2026-09-09T10:00:00Z"),
  });
  assert.equal(rule.statement, "no high strings", "the producer's own words, not a paraphrase");
  assert.equal(rule.strength, "hard");
  assert.deepEqual(rule.delta, delta);
  assert.deepEqual(rule.source, { projectId: "p1", briefId: "b1", decisionId: "dec-1" });
  assert.equal(rule.createdAt, "2026-09-09T10:00:00.000Z");
  // A section-scoped rule keeps its section reference in the delta; a later
  // project without that section resolves nothing rather than guessing.
  const sectionDelta: BriefDelta = { kind: "section_intention", section: { function: "chorus", ordinal: "last" }, densityBias: -0.3, rationale: "leave the last chorus for the singer" };
  const sectionRule = memoryRuleFromDecision({ id: "mem-2", decision: decision({ id: "dec-2", topic: "density", scope: { kind: "section", sectionName: "Chorus 2" }, statement: "leave the last chorus for the singer" }), delta: sectionDelta, projectId: "p1", briefId: "b1" });
  assert.deepEqual(sectionRule.delta, sectionDelta);
  assert.equal(sectionRule.scope.kind, "section");
});

test("a decision with no stored delta is carried as a decision delta that reproduces it", () => {
  // Intake decisions are read out of the text and never stored as rows; the
  // producer can still keep them, and the compiler re-creates them exactly.
  const intakeDecision = decision({ id: "dec-intake", topic: "aesthetic", statement: "mood: warm", value: "warm", strength: "soft" });
  assert.deepEqual(deltaForDecision(intakeDecision, null), {
    kind: "decision",
    scope: { kind: "global" },
    topic: "aesthetic",
    statement: "mood: warm",
    strength: "soft",
    value: "warm",
    rationale: "mood: warm",
  });
  // A stored delta is richer (it can exclude a family, nudge a section): it wins.
  assert.deepEqual(deltaForDecision(intakeDecision, delta), delta);
  const rule = memoryRuleFromDecision({ id: "mem-3", decision: intakeDecision, delta: null, projectId: "p1", briefId: "b1" });
  assert.equal(rule.delta.kind, "decision");
  assert.equal(rule.statement, "mood: warm");
});

test("rules compile as deltas whose source ref names the rule", () => {
  const rules = [
    memoryRuleFromDecision({ id: "mem-1", decision: decision(), delta, projectId: "p1", briefId: "b1" }),
    memoryRuleFromDecision({ id: "mem-2", decision: decision({ id: "dec-2", topic: "energy", statement: "keep it intimate" }), delta: { kind: "set_dimension", dimension: "dynamics", value: "narrow", confidence: 0.8, rationale: "keep it intimate" }, projectId: "p1", briefId: "b1" }),
  ];
  const inputs = memoryCompileInputs(rules);
  assert.deepEqual(inputs.deltas, [rules[0].delta, rules[1].delta]);
  assert.deepEqual(inputs.deltaSourceRefs, ["producer_memory:mem-1", "producer_memory:mem-2"]);
  assert.equal(memorySourceRef("mem-1"), "producer_memory:mem-1");
  assert.deepEqual(memoryCompileInputs([]), { deltas: [], deltaSourceRefs: [] });
});

test("a brief's memory-sourced decisions are identifiable, and say so in words", () => {
  const rules = [memoryRuleFromDecision({ id: "mem-1", decision: decision(), delta, projectId: "p1", briefId: "b1" })];
  const fromMemory = decision({ id: "dec-9", sourceRefs: [memorySourceRef("mem-1")], createdBy: "producer" });
  const ownWords = decision({ id: "dec-10", sourceRefs: ["text:make it warmer"] });
  const applied = memoryDecisionsIn([ownWords, fromMemory], rules);
  assert.equal(applied.length, 1);
  assert.equal(applied[0].decision.id, "dec-9");
  assert.equal(applied[0].rule?.statement, "no high strings");
  assert.match(describeMemoryApplied(applied)!, /"no high strings" was applied to this project/);
  assert.match(describeMemoryApplied(applied)!, /revoke it/);
  assert.equal(describeMemoryApplied([]), null);
  // A rule revoked after it shaped a brief still identifies its decision.
  const orphan = memoryDecisionsIn([fromMemory], []);
  assert.equal(orphan[0].rule, null);
  assert.equal(orphan[0].ruleId, "mem-1");
  assert.match(describeMemoryApplied(orphan)!, /"mem-1"/);
});
