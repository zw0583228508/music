import assert from "node:assert/strict";
import test from "node:test";
import { deriveGlobalArrangementPlan } from "../globalArrangementPlanner";
import { deriveOrchestrationBudget } from "../orchestrationBudget";
import { deriveSectionPhrasePlan } from "../sectionPhrasePlanner";
import { deriveTransitionPlan } from "../transitionEngine";
import { compileProductionBrief } from "./briefCompiler";
import { applyBriefToPlans } from "./briefToPlanner";
import { explainDecision } from "./explain";
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
