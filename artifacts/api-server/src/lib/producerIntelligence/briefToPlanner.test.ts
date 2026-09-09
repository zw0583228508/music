import assert from "node:assert/strict";
import test from "node:test";
import { deriveGlobalArrangementPlan, globalPlanInputsDigest } from "../globalArrangementPlanner";
import { deriveSectionPhrasePlan, sectionPhrasePlanInputsDigest } from "../sectionPhrasePlanner";
import { compileProductionBrief } from "./briefCompiler";
import { applyBriefToPlans, briefPlannerHints, plannerHintsForJob, stampBriefOnPlan } from "./briefToPlanner";
import { extractUserIntentSync } from "./intentExtraction";
import { resolveStyleProfile } from "./styleResolution";
import { FIXED_NOW, makeTestSongModel } from "./testSongModel";

const briefFor = (text: string, model = makeTestSongModel()) => {
  const intent = extractUserIntentSync(text, { now: FIXED_NOW });
  const profile = resolveStyleProfile(intent, { now: FIXED_NOW });
  return compileProductionBrief(intent, profile, model, [], { now: FIXED_NOW });
};

test("an empty brief produces no hints and byte-identical plans", () => {
  const model = makeTestSongModel();
  const brief = briefFor("");
  const hints = briefPlannerHints(brief);
  assert.deepEqual(hints.global, {});
  assert.deepEqual(hints.section, {});
  const applied = applyBriefToPlans(model, brief, { now: FIXED_NOW });
  assert.deepEqual(applied.globalPlan, deriveGlobalArrangementPlan(model, { now: FIXED_NOW }));
  assert.deepEqual(applied.sectionPlan, deriveSectionPhrasePlan(model, applied.globalPlan, { now: FIXED_NOW }));
  assert.equal(applied.planRef.productionBriefId, brief.id);
  assert.equal(applied.planRef.productionBriefDigestSha256, brief.inputsDigestSha256);
});

test("a plan is stamped with the brief it came from; a job carries the brief's hints as plain JSON (PR-U5)", () => {
  const brief = briefFor("not too busy");
  const plan = { id: "p", version: 1 } as { id: string; version: number; productionBriefId?: string; productionBriefDigestSha256?: string };
  const stamped = stampBriefOnPlan(plan, brief);
  assert.equal(stamped.productionBriefId, brief.id);
  assert.equal(stamped.productionBriefDigestSha256, brief.inputsDigestSha256);
  assert.equal(stamped.id, "p");
  assert.equal(plan.productionBriefId, undefined, "the input is not mutated");
  assert.deepEqual(stampBriefOnPlan(plan, { productionBriefId: "b", productionBriefDigestSha256: "d" }), { id: "p", version: 1, productionBriefId: "b", productionBriefDigestSha256: "d" });
  const hints = plannerHintsForJob(brief);
  assert.ok(hints && hints.section.activeFamilyBias! < 0, "'not too busy' thins the texture");
  assert.deepEqual(JSON.parse(JSON.stringify(hints)), hints, "plain JSON, as a job row stores it");
  assert.equal(plannerHintsForJob(briefFor("")), null, "an empty brief adds no hints to a job");
});

test("digests stay byte-identical without hints and change with them", () => {
  const model = makeTestSongModel();
  const plain = deriveGlobalArrangementPlan(model, { now: FIXED_NOW });
  assert.equal(plain.inputsDigestSha256, globalPlanInputsDigest(model));
  assert.equal(globalPlanInputsDigest(model, {}), globalPlanInputsDigest(model));
  assert.equal(globalPlanInputsDigest(model, { paletteAdd: [] }), globalPlanInputsDigest(model));
  const biased = deriveGlobalArrangementPlan(model, { now: FIXED_NOW, hints: { sectionEnergyBias: { Chorus: 1.1 } } });
  assert.notEqual(biased.inputsDigestSha256, plain.inputsDigestSha256);
  const section = deriveSectionPhrasePlan(model, plain, { now: FIXED_NOW });
  assert.equal(section.inputsDigestSha256, sectionPhrasePlanInputsDigest(model, plain));
  assert.equal(sectionPhrasePlanInputsDigest(model, plain, { activeFamilyBias: 0 }), sectionPhrasePlanInputsDigest(model, plain));
  assert.notEqual(sectionPhrasePlanInputsDigest(model, plain, { activeFamilyBias: 0.5 }), sectionPhrasePlanInputsDigest(model, plain));
});

test("a section energy request biases that section's target and leaves the others untouched", () => {
  const model = makeTestSongModel();
  const plain = deriveGlobalArrangementPlan(model, { now: FIXED_NOW });
  const brief = briefFor("the first chorus more powerful");
  const hints = briefPlannerHints(brief);
  assert.ok((hints.global.sectionEnergyBias?.Chorus ?? 1) > 1, "the first chorus gets a > 1 multiplier");
  assert.equal(hints.global.sectionEnergyBias?.Verse, undefined);
  assert.ok(hints.evidence.some((e) => e.startsWith("Chorus: energy bias")));
  const { globalPlan } = applyBriefToPlans(model, brief, { now: FIXED_NOW });
  const target = (name: string, plan = globalPlan) => plan.sectionTargets.find((t) => t.sectionName === name)!;
  assert.ok(target("Chorus").energy > target("Chorus", plain).energy, "chorus energy rises");
  assert.ok(target("Chorus").energy <= 1);
  assert.equal(target("Verse").energy, target("Verse", plain).energy);
  assert.equal(target("Final Chorus").energy, target("Final Chorus", plain).energy);
});

test("requested families join the palette and excluded ones leave; section requests reach the section planner", () => {
  const model = makeTestSongModel();
  const brief = briefFor("with clarinet, no strings, and add percussion in the final chorus");
  const hints = briefPlannerHints(brief);
  assert.ok(hints.global.paletteAdd?.includes("winds"));
  assert.deepEqual(hints.global.paletteRemove, ["strings"]);
  assert.deepEqual(hints.section.sectionFamilies?.["Final Chorus"]?.add, ["percussion"]);
  const { globalPlan, sectionPlan } = applyBriefToPlans(model, brief, { now: FIXED_NOW });
  const roles = globalPlan.instrumentPalette.map((p) => p.role);
  assert.ok(roles.includes("winds"), "clarinet's family joined the palette");
  assert.equal(roles.includes("strings"), false, "strings were excluded");
  assert.equal(globalPlan.instrumentPalette.find((p) => p.role === "winds")?.rationale, "requested in the production brief");
  const finalChorus = sectionPlan.sections.find((s) => s.sectionName === "Final Chorus")!;
  assert.ok(finalChorus.activeInstrumentFamilies.includes("percussion"));
  assert.ok(sectionPlan.roleAssignments.some((r) => r.sectionName === "Final Chorus" && r.instrument === "percussion"));
});

test("a stated aesthetic is honoured only when the palette can carry it", () => {
  const withStrings = applyBriefToPlans(makeTestSongModel(), briefFor("cinematic"), { now: FIXED_NOW });
  assert.equal(withStrings.hints.global.productionAesthetic, "cinematic");
  assert.equal(withStrings.globalPlan.productionAesthetic, "cinematic");

  const bandOnly = makeTestSongModel({
    stems: [
      { name: "vocals", role: "vocals", source: "d", channels: 2, confidence: 0.9 },
      { name: "drums", role: "drums", source: "d", channels: 2, confidence: 0.9 },
      { name: "bass", role: "bass", source: "d", channels: 2, confidence: 0.9 },
      { name: "guitar", role: "guitar", source: "d", channels: 2, confidence: 0.9 },
    ],
  });
  const noCarriers = applyBriefToPlans(bandOnly, briefFor("cinematic, no strings, no pads, no brass, no winds"), { now: FIXED_NOW });
  assert.equal(noCarriers.hints.global.productionAesthetic, "cinematic", "the hint is still emitted");
  assert.notEqual(noCarriers.globalPlan.productionAesthetic, "cinematic", "but the planner will not claim an aesthetic the palette cannot carry");
});

test("a climax hint re-ranks the map's candidates and cannot invent one", () => {
  const model = makeTestSongModel();
  const plain = deriveGlobalArrangementPlan(model, { now: FIXED_NOW });
  const candidates = model.musicalMap!.structure.climaxCandidates;
  const inVerse = candidates.some((c) => c.atBar >= 1 && c.atBar <= 8);
  const hinted = deriveGlobalArrangementPlan(model, { now: FIXED_NOW, hints: { climaxSectionName: "Verse" } });
  if (!inVerse) assert.deepEqual(hinted.climax, plain.climax, "no candidate in the verse: the climax stays where the evidence put it");
  const brief = briefFor("the last chorus still doesn't feel like a climax");
  assert.equal(briefPlannerHints(brief).global.climaxSectionName, "Final Chorus");
  assert.equal(applyBriefToPlans(model, brief, { now: FIXED_NOW }).globalPlan.climax?.sectionName, "Final Chorus");
});

test("a global density request biases every section and how many families stay active", () => {
  const model = makeTestSongModel();
  const hints = briefPlannerHints(briefFor("sparse and quiet"));
  assert.ok((hints.section.activeFamilyBias ?? 0) < 0);
  for (const name of ["Verse", "Chorus", "Final Chorus"]) {
    assert.ok(hints.global.sectionDensityBias![name] < 1);
    assert.ok(hints.global.sectionEnergyBias![name] < 1);
  }
  const plain = deriveSectionPhrasePlan(model, undefined, { now: FIXED_NOW });
  const sparse = applyBriefToPlans(model, briefFor("sparse and quiet"), { now: FIXED_NOW }).sectionPlan;
  const count = (plan: typeof plain) => plan.sections.reduce((s, x) => s + x.activeInstrumentFamilies.length, 0);
  assert.ok(count(sparse) <= count(plain), "no section keeps more families than before");
  assert.ok(sparse.sections.every((s) => s.activeInstrumentFamilies.length >= 2), "the planner's floor still holds");
});

test("a global boundary ('not too busy' / 'לא עמוס מדי') thins the texture; it never thickens it", () => {
  for (const text of ["not too busy", "לא עמוס מדי"]) {
    const hints = briefPlannerHints(briefFor(text));
    for (const name of ["Verse", "Chorus", "Final Chorus"]) {
      assert.ok((hints.global.sectionDensityBias?.[name] ?? 1) < 1, `${text}: ${name} density multiplier < 1`);
    }
    assert.ok((hints.section.activeFamilyBias ?? 0) < 0, `${text}: fewer active families`);
    assert.ok(hints.evidence.some((line) => /global density not dense/.test(line)), `${text}: the evidence names the boundary`);
  }
  // The positive request still goes the other way.
  const dense = briefPlannerHints(briefFor("a dense, full texture"));
  assert.ok((dense.global.sectionDensityBias?.Chorus ?? 1) > 1);
  assert.ok((dense.section.activeFamilyBias ?? 0) > 0);
});
