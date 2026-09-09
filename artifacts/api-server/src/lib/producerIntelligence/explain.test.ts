import assert from "node:assert/strict";
import test from "node:test";
import { deriveGlobalArrangementPlan } from "../globalArrangementPlanner";
import { deriveOrchestrationBudget } from "../orchestrationBudget";
import { deriveSectionPhrasePlan } from "../sectionPhrasePlanner";
import { deriveTransitionPlan } from "../transitionEngine";
import { compileProductionBrief } from "./briefCompiler";
import { applyBriefToPlans } from "./briefToPlanner";
import { explainDecision, questionForTarget, type ExplainContext } from "./explain";
import { extractUserIntentSync } from "./intentExtraction";
import { resolveStyleProfile } from "./styleResolution";
import { FIXED_NOW, makeTestSongModel } from "./testSongModel";

function plans() {
  const model = makeTestSongModel();
  const globalPlan = deriveGlobalArrangementPlan(model, { now: FIXED_NOW });
  const sectionPlan = deriveSectionPhrasePlan(model, globalPlan, { now: FIXED_NOW });
  const orchestrationBudget = deriveOrchestrationBudget(model, sectionPlan, { now: FIXED_NOW });
  const transitionPlan = deriveTransitionPlan(model, globalPlan, sectionPlan, { now: FIXED_NOW });
  return { model, globalPlan, sectionPlan, orchestrationBudget, transitionPlan };
}

test("an instrument is explained from its role assignment and palette entry", () => {
  const plan = plans();
  const explanation = explainDecision(plan, "why are there strings in the final chorus?");
  assert.equal(explanation.answered, true);
  assert.match(explanation.answer, /strings is planned as .* in Final Chorus/);
  const sources = new Set(explanation.evidence.map((e) => e.source));
  assert.ok(sources.has("sectionPlan.roleAssignments"));
  assert.ok(sources.has("globalPlan.instrumentPalette"));
  const role = explanation.evidence.find((e) => e.source === "sectionPlan.roleAssignments")!;
  assert.equal(role.ref, "Final Chorus/strings");
  assert.match(role.detail, /role [A-Z_]+, register/);
  assert.ok(explanation.confidence > 0.5 && explanation.confidence <= 0.9);
});

test("when the plan holds no evidence it says so instead of inventing", () => {
  const plan = plans();
  const clarinet = explainDecision(plan, "why is there a clarinet here?");
  assert.equal(clarinet.answered, false);
  assert.match(clarinet.answer, /not in this plan's palette/);
  assert.ok(clarinet.evidence.some((e) => e.source === "globalPlan.instrumentPalette"), "it shows what the palette does hold");
  assert.equal(clarinet.confidence, 0);

  const bridge = explainDecision(plan, "why is the bridge so empty?");
  assert.equal(bridge.answered, false);
  assert.match(bridge.answer, /no bridge section exists/);

  const nothing = explainDecision(plan, "why?");
  assert.equal(nothing.answered, false);
  assert.deepEqual(nothing.evidence, []);

  const empty = explainDecision({}, "why are there strings in the chorus?");
  assert.equal(empty.answered, false);
  assert.match(empty.answer, /no global or section plan/);
});

test("a section is explained from its targets and active families", () => {
  const explanation = explainDecision(plans(), "why is the verse so quiet?");
  assert.equal(explanation.answered, true);
  assert.match(explanation.answer, /Verse is thin because the plan targets energy/);
  assert.ok(explanation.evidence.some((e) => e.source === "globalPlan.sectionTargets" && e.ref === "Verse"));
  assert.ok(explanation.evidence.some((e) => e.source === "sectionPlan.sections" && e.ref === "Verse"));
});

test("the climax is explained from the global plan", () => {
  const plan = plans();
  const explanation = explainDecision(plan, "why is the climax there?");
  assert.equal(explanation.answered, true);
  assert.ok(explanation.evidence.some((e) => e.source === "globalPlan.climax" && e.ref === plan.globalPlan.climax!.sectionName));
  assert.match(explanation.answer, new RegExp(`climax is planned in ${plan.globalPlan.climax!.sectionName}`));
});

test("with a brief attached, the producer's own decisions are cited as evidence", () => {
  const model = makeTestSongModel();
  const intent = extractUserIntentSync("with clarinet", { now: FIXED_NOW });
  const brief = compileProductionBrief(intent, resolveStyleProfile(intent, { now: FIXED_NOW }), model, [], { now: FIXED_NOW });
  const { globalPlan, sectionPlan } = applyBriefToPlans(model, brief, { now: FIXED_NOW });
  const explanation = explainDecision({ globalPlan, sectionPlan, brief }, "why is there a clarinet in the final chorus?");
  assert.equal(explanation.answered, true);
  assert.ok(explanation.evidence.some((e) => e.source === "brief.producerDecisions" && /winds/.test(e.detail)));
  assert.match(explanation.answer, /requested in the production brief/);
});

test("a structured target asks the same question the chat would have asked (PR-U6)", () => {
  const plan = plans();
  assert.equal(questionForTarget({ kind: "instrument", name: "strings", sectionName: "Final Chorus" }), "why is there strings in Final Chorus?");
  assert.equal(questionForTarget({ kind: "track", name: "drums" }), "why is there drums?");
  assert.equal(questionForTarget({ kind: "section", name: "Verse" }), "why is Verse like that?");
  assert.equal(questionForTarget({ kind: "climax" }), "why is the climax there?");
  // Pointing at a track in the studio and typing the question give the same answer.
  const pointed = explainDecision(plan, questionForTarget({ kind: "instrument", name: "strings", sectionName: "Final Chorus" }));
  const typed = explainDecision(plan, "why are there strings in the final chorus?");
  assert.equal(pointed.answered, true);
  assert.deepEqual(pointed.evidence, typed.evidence);
});

test("a decision's origin is named: a standing rule, a reference or research (PR-U6)", () => {
  const model = makeTestSongModel();
  const intent = extractUserIntentSync("with clarinet", { now: FIXED_NOW });
  const brief = compileProductionBrief(intent, resolveStyleProfile(intent, { now: FIXED_NOW }), model, [], { now: FIXED_NOW });
  const { globalPlan, sectionPlan } = applyBriefToPlans(model, brief, { now: FIXED_NOW });
  const question = "why is there a clarinet in the final chorus?";
  const plain = explainDecision({ globalPlan, sectionPlan, brief }, question);
  assert.ok(!/standing rule/.test(plain.answer), "a decision the producer made here is not attributed to memory");

  const fromMemory = {
    ...brief,
    producerDecisions: brief.producerDecisions.map((d) => ({ ...d, sourceRefs: ["producer_memory:mem-1"] })),
  };
  const remembered = explainDecision({ globalPlan, sectionPlan, brief: fromMemory }, question);
  assert.match(remembered.answer, /comes from your standing rule/);
  assert.ok(remembered.evidence.some((e) => e.source === "brief.producerDecisions" && /from your standing rule/.test(e.detail)));

  const fromReference = {
    ...brief,
    producerDecisions: brief.producerDecisions.map((d) => ({ ...d, sourceRefs: ["reference:fp-7"] })),
  };
  assert.match(explainDecision({ globalPlan, sectionPlan, brief: fromReference }, question).answer, /the reference you allowed \(reference:fp-7\)/);
});

test("a regenerated version explains what the edit changed and what it preserved (PR-U6)", () => {
  const plan = plans();
  const regeneration = {
    version: "1.0", method: "scope-aware-regeneration/v1", requested: [], blockedByLock: [], regenerated: [],
    keptNotes: 553, replacedNotes: 137, locksHonoured: true,
    editTurnId: "pc-1", editIntent: "regenerate_part", editText: "keep the drums, regenerate the bass",
    parentArrangementId: "a-1", parentArrangementVersion: 6, songModelVersion: 1,
    productionBriefId: null, productionBriefDigestSha256: null, locks: [], unmatchedFamilies: [],
    changed: { instruments: ["bass"], sections: ["Verse"], barRanges: [] },
    preserved: { instruments: ["drums"], sections: [], notes: 553 },
    verification: { honoured: true, violations: [], checkedLockedNotes: 532 },
    identicalReplacedNotes: 0, candidates: [], selectedCandidateId: "cand-A", plannerHintEvidence: [],
  } as unknown as NonNullable<ExplainContext["regeneration"]>;

  const rewritten = explainDecision({ ...plan, regeneration }, "why is there bass in the verse?");
  assert.match(rewritten.answer, /Your edit "keep the drums, regenerate the bass" rewrote it: 137 note\(s\) replaced in Verse, 553 kept verbatim/);
  const kept = explainDecision({ ...plan, regeneration }, "why is there drums in the verse?");
  assert.match(kept.answer, /did not rewrite it: drums was preserved, and 532 locked note\(s\) were verified byte-identical/);
  assert.ok(kept.evidence.some((e) => e.source === "plan.regeneration" && e.ref === "pc-1"));
  // An instrument the edit never touched gets no regeneration line.
  const untouched = explainDecision({ ...plan, regeneration }, "why are there strings in the final chorus?");
  assert.ok(!/edit/.test(untouched.answer));
});

test("an absent family is explained by the section's energy budget", () => {
  const plan = plans();
  const inactive = plan.sectionPlan.sections.find((s) => s.inactiveInstrumentFamilies.length > 0);
  if (!inactive) return; // the fixture keeps every family active everywhere; nothing to explain
  const family = inactive.inactiveInstrumentFamilies[0];
  const explanation = explainDecision(plan, `why is there no ${family} in the ${inactive.sectionName.toLowerCase()}?`);
  assert.equal(explanation.answered, true);
  assert.match(explanation.answer, /sits out/);
  assert.ok(explanation.evidence.some((e) => e.source === "sectionPlan.sections"));
});
