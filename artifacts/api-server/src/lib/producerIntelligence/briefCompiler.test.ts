import assert from "node:assert/strict";
import test from "node:test";
import type { SongModelData } from "@workspace/db";
import {
  PRODUCTION_BRIEF_VERSION,
  activeDecisions,
  briefDimensionValue,
  compileProductionBrief,
  isProductionBriefStale,
  resolveSectionRef,
} from "./briefCompiler";
import { extractUserIntentSync } from "./intentExtraction";
import { resolveStyleProfile } from "./styleResolution";
import { FIXED_NOW, makeTestSongModel } from "./testSongModel";

const LATER = new Date("2027-06-01T00:00:00.000Z");

/** Six 4-bar sections so "second chorus" and "last chorus" are different sections. */
const SIX_SECTIONS: SongModelData["sections"] = [
  { name: "Verse 1", startBar: 1, endBar: 4, energy: 0.35 },
  { name: "Chorus 1", startBar: 5, endBar: 8, energy: 0.75 },
  { name: "Verse 2", startBar: 9, endBar: 12, energy: 0.4 },
  { name: "Chorus 2", startBar: 13, endBar: 16, energy: 0.8 },
  { name: "Bridge", startBar: 17, endBar: 20, energy: 0.6 },
  { name: "Final Chorus", startBar: 21, endBar: 24, energy: 0.95 },
];

const compile = (text: string, model = makeTestSongModel(), answers: Parameters<typeof compileProductionBrief>[3] = [], options = {}) => {
  const intent = extractUserIntentSync(text, { now: FIXED_NOW });
  const profile = resolveStyleProfile(intent, { now: FIXED_NOW });
  return { intent, profile, brief: compileProductionBrief(intent, profile, model, answers, { now: FIXED_NOW, ...options }) };
};

test("section references resolve by function and ordinal against real sections", () => {
  const sections = SIX_SECTIONS.map((s) => ({ name: s.name, startBar: s.startBar, endBar: s.endBar }));
  assert.deepEqual(resolveSectionRef({ function: "chorus", ordinal: 2 }, sections), ["Chorus 2"]);
  assert.deepEqual(resolveSectionRef({ function: "chorus", ordinal: "last" }, sections), ["Final Chorus"]);
  assert.deepEqual(resolveSectionRef({ function: "chorus", ordinal: "all" }, sections), ["Chorus 1", "Chorus 2", "Final Chorus"]);
  assert.deepEqual(resolveSectionRef({ function: "bridge", ordinal: "all" }, sections), ["Bridge"]);
  assert.deepEqual(resolveSectionRef({ function: "outro", ordinal: "all" }, sections), []);
  assert.deepEqual(resolveSectionRef({ function: "chorus", ordinal: 7 }, sections), []);
});

test("the brief digest is stable across time and changes with answers or sections", () => {
  const model = makeTestSongModel();
  const intent = extractUserIntentSync("חסידי ישן", { now: FIXED_NOW });
  const profile = resolveStyleProfile(intent, { now: FIXED_NOW });
  const a = compileProductionBrief(intent, profile, model, [], { now: FIXED_NOW });
  const b = compileProductionBrief(intent, profile, model, [], { now: LATER });
  assert.equal(a.version, PRODUCTION_BRIEF_VERSION);
  assert.equal(a.inputsDigestSha256, b.inputsDigestSha256);
  assert.equal(a.id, b.id);
  assert.notEqual(a.derivedAt, b.derivedAt);
  assert.deepEqual({ ...a, derivedAt: null, producerDecisions: a.producerDecisions.map((d) => ({ ...d, createdAt: null })) },
    { ...b, derivedAt: null, producerDecisions: b.producerDecisions.map((d) => ({ ...d, createdAt: null })) });
  assert.equal(isProductionBriefStale(a, intent, profile, model), false);

  const answered = compileProductionBrief(intent, profile, model, [{ questionId: "world_of_tradition", optionId: "arranged_orchestral" }], { now: FIXED_NOW });
  assert.notEqual(answered.inputsDigestSha256, a.inputsDigestSha256);
  assert.equal(isProductionBriefStale(a, intent, profile, model, [{ questionId: "world_of_tradition", optionId: "arranged_orchestral" }]), true);
  const otherSong = compileProductionBrief(intent, profile, makeTestSongModel({ sections: SIX_SECTIONS }), [], { now: FIXED_NOW });
  assert.notEqual(otherSong.inputsDigestSha256, a.inputsDigestSha256);
});

test("section requests land on the right section and leave the others alone", () => {
  const { brief } = compile("the second chorus is too busy, last chorus more cinematic", makeTestSongModel({ sections: SIX_SECTIONS }));
  assert.deepEqual(brief.sectionNames, SIX_SECTIONS.map((s) => s.name));
  const by = Object.fromEntries(brief.sectionIntentions.map((s) => [s.sectionName, s]));
  assert.ok(by["Chorus 2"].densityBias!.value < 0, "second chorus is asked to thin out");
  assert.equal(by["Chorus 2"].densityBias!.provenance, "stated");
  assert.equal(by["Chorus 2"].character.length, 0);
  assert.deepEqual(by["Final Chorus"].character.map((c) => c.value), ["cinematic"]);
  assert.ok(by["Final Chorus"].energyBias!.value > 0, "cinematic implies a little more energy");
  assert.equal(by["Final Chorus"].energyBias!.provenance, "inferred");
  for (const name of ["Verse 1", "Chorus 1", "Verse 2", "Bridge"]) {
    assert.equal(by[name].energyBias, undefined, `${name} untouched`);
    assert.equal(by[name].densityBias, undefined);
    assert.deepEqual(by[name].character, []);
  }
  assert.ok(by["Chorus 2"].decisionIds.length >= 1 && by["Final Chorus"].decisionIds.length >= 1);
  assert.deepEqual(brief.unresolvedSectionRequests, []);
});

test("a section request that matches no section is surfaced, never guessed", () => {
  const { brief } = compile("the bridge more cinematic");
  assert.equal(brief.unresolvedSectionRequests.length, 1);
  assert.equal(brief.unresolvedSectionRequests[0].section.function, "bridge");
  assert.ok(brief.sectionIntentions.every((s) => s.character.length === 0));
});

test("negated styles are rejected, never adopted", () => {
  const { brief } = compile("not too poppy, 80s");
  assert.equal(brief.dimensionDecisions.find((d) => d.dimension === "genre"), undefined);
  assert.equal(brief.dimensionDecisions.find((d) => d.dimension === "era")?.disposition, "adopt");
  const noPop = brief.producerDecisions.find((d) => d.topic === "style_dimension" && d.value === "pop");
  assert.ok(noPop && noPop.strength === "hard" && noPop.provenance === "stated");

  // A value the profile carried can still be rejected by a later delta.
  const rejected = compile("a pop ballad", makeTestSongModel(), [], {
    deltas: [{ kind: "exclude_value", dimension: "genre", value: "pop", rationale: "producer changed their mind" }],
  }).brief;
  assert.equal(rejected.dimensionDecisions.find((d) => d.dimension === "genre")?.disposition, "reject");
  assert.equal(briefDimensionValue(rejected, "genre"), undefined);
});

test("instrument requests build the hierarchy; exclusions leave it and become hard decisions", () => {
  const { brief } = compile("with piano and strings, no synth");
  assert.deepEqual(brief.instrumentation.hierarchy.map((h) => h.family), ["keys", "strings"]);
  assert.ok(brief.instrumentation.hierarchy.every((h) => h.provenance === "stated" && h.tier === "feature"));
  assert.deepEqual(brief.instrumentation.excludedFamilies, ["synth"]);
  const noSynth = brief.producerDecisions.find((d) => d.topic === "instrumentation" && d.value === "synth");
  assert.ok(noSynth && noSynth.strength === "hard");
  assert.equal(noSynth!.scope.kind, "global");
});

test("later decisions supersede earlier ones on the same scope and topic", () => {
  const first = compile("no synth").brief;
  const noSynth = first.producerDecisions.find((d) => d.value === "synth")!;
  const intent = extractUserIntentSync("add synth", { now: LATER });
  const profile = resolveStyleProfile(intent, { now: LATER });
  const second = compileProductionBrief(intent, profile, makeTestSongModel(), [], { now: LATER, decisions: first.producerDecisions });
  const addSynth = second.producerDecisions.find((d) => d.value === "synth" && d.id !== noSynth.id)!;
  assert.ok(addSynth, "the new decision exists");
  assert.deepEqual(addSynth.supersedes, [noSynth.id]);
  assert.ok(second.producerDecisions.some((d) => d.id === noSynth.id), "the old decision is kept for audit");
  assert.equal(activeDecisions(second).some((d) => d.id === noSynth.id), false, "but is no longer active");
  assert.ok(second.instrumentation.hierarchy.some((h) => h.family === "synth"));
});

test("vocal space is a labelled default until evidence or the user says otherwise", () => {
  // No Song Model at all: the policy is a default and says so.
  const intent = extractUserIntentSync("a warm song", { now: FIXED_NOW });
  const noModel = compileProductionBrief(intent, resolveStyleProfile(intent, { now: FIXED_NOW }), undefined, [], { now: FIXED_NOW });
  assert.equal(noModel.vocalSpace.provenance, "default");
  assert.equal(noModel.vocalSpace.underLead, "moderate");
  assert.deepEqual(noModel.sectionNames, []);
  // The fixture has a vocal stem but no vocal phrases: that is evidence of its
  // own, and the policy is labelled inferred rather than pretending a default.
  const fixture = compile("a warm song").brief.vocalSpace;
  assert.equal(fixture.provenance, "inferred");
  assert.equal(fixture.underLead, "open");
  assert.match(fixture.rationale, /no vocal evidence/);
  // A stated complaint wins over both.
  const busy = compile("too busy under the vocal").brief.vocalSpace;
  assert.equal(busy.underLead, "tight");
  assert.equal(busy.provenance, "stated");
});

test("the planner aesthetic comes only from stated descriptors", () => {
  assert.equal(compile("cinematic").brief.productionAesthetic.plannerAesthetic, "cinematic");
  const intent = extractUserIntentSync("80s", { now: FIXED_NOW });
  const researched = resolveStyleProfile(intent, {
    now: FIXED_NOW,
    findings: [{ dimension: "soundAesthetic", value: "electronic", confidence: 0.95, provenance: "researched", sourceRefs: ["research:x"] }],
  });
  const brief = compileProductionBrief(intent, researched, makeTestSongModel(), [], { now: FIXED_NOW });
  assert.equal(brief.productionAesthetic.descriptors[0]?.value, "electronic");
  assert.equal(brief.productionAesthetic.plannerAesthetic, undefined, "a researched aesthetic biases nothing on its own");
});

test("clarification answers apply their deltas and are recorded on the brief", () => {
  const open = compile("חסידי ישן").brief;
  assert.deepEqual(open.openQuestionIds, ["world_of_tradition"]);
  assert.equal(open.dimensionDecisions.find((d) => d.dimension === "ensembleType"), undefined);

  const { brief } = compile("חסידי ישן", makeTestSongModel(), [{ questionId: "world_of_tradition", optionId: "arranged_orchestral" }]);
  assert.deepEqual(brief.answeredQuestionIds, ["world_of_tradition"]);
  assert.deepEqual(brief.openQuestionIds, []);
  const ensemble = brief.dimensionDecisions.find((d) => d.dimension === "ensembleType");
  assert.equal(ensemble?.disposition, "adopt");
  assert.equal(ensemble?.decidedBy, "answer");
  assert.equal(briefDimensionValue(brief, "ensembleType"), "orchestral");
  assert.equal(briefDimensionValue(brief, "doublingRules"), "orchestral");
  const decision = brief.producerDecisions.find((d) => d.createdBy === "clarification" && d.dimension === "ensembleType");
  assert.ok(decision && decision.sourceRefs[0] === "answer:world_of_tradition/arranged_orchestral");
  assert.equal(brief.dimensionDecisions.find((d) => d.dimension === "tradition")?.disposition, "adopt");
});

test("global energy and density words become soft global decisions, not section edits", () => {
  const { brief } = compile("quiet and sparse");
  const energy = brief.producerDecisions.find((d) => d.topic === "energy");
  const density = brief.producerDecisions.find((d) => d.topic === "density");
  assert.ok(energy && energy.scope.kind === "global" && energy.value === "low" && energy.strength === "soft");
  assert.ok(density && density.scope.kind === "global" && density.value === "sparse");
  assert.ok(brief.sectionIntentions.every((s) => s.energyBias === undefined && s.densityBias === undefined));
  assert.equal(brief.vocalSpace.underLead, "tight");
});
