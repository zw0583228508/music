/**
 * Brain B-01 on the owner's song "רחם נא" (slimmed Song Model v3 fixture).
 *
 * The verified facts this guards against (docs/brain/02-diagnosis-and-dag.md §0):
 * every section had `leadRole = instrument:keys` and the keys family wrote
 * nothing; the palette entry `mix` (the full-mix stem) played the piano; the
 * energy targets were the recording's RMS (Chorus 3 = 0.185) and two families
 * played almost everywhere.
 */
import assert from "node:assert/strict";
import test from "node:test";
import { DYNAMIC_LEVEL } from "./arrangementArc";
import { orchestrateArrangement } from "./arrangementOrchestrator";
import { deriveGlobalArrangementPlan } from "./globalArrangementPlanner";
import { buildPartComposerPlan, silentPlannedFamilyFindings } from "./partComposer";
import { deriveSectionPhrasePlan } from "./sectionPhrasePlanner";
import { deriveTransitionPlan } from "./transitionEngine";
import { compileProductionBrief } from "./producerIntelligence/briefCompiler";
import { briefPlannerHints } from "./producerIntelligence/briefToPlanner";
import { extractUserIntentSync } from "./producerIntelligence/intentExtraction";
import { resolveStyleProfile } from "./producerIntelligence/styleResolution";
import {
  RACHEM_NA_FIXED_NOW as NOW,
  RACHEM_NA_STORED_PALETTE_HINTS,
  RACHEM_NA_V3_SECTION_ENERGY,
  rachemNaSongModel,
} from "./__fixtures__/rachemNaSongModelV3";

export const OWNER_BRIEF = "intimate ballad; piano, soft strings, gentle bass, light percussion; big final chorus";

function ownerBrief(model = rachemNaSongModel()) {
  const intent = extractUserIntentSync(OWNER_BRIEF, { now: NOW });
  const profile = resolveStyleProfile(intent, { now: NOW });
  return compileProductionBrief(intent, profile, model, [], { now: NOW });
}

const CHORUSES = ["Chorus", "Chorus 2", "Chorus 3"];
const VERSES = ["Verse 1", "Verse 2", "Verse 3"];

test("the fixture reproduces the owner's stored measurements (positive control for the fixture itself)", () => {
  const model = rachemNaSongModel();
  assert.equal(model.sections.length, 9);
  assert.equal(model.chords.length, 92);
  assert.equal(model.tempoMap[0].bpm, 130.43);
  assert.equal(model.keyMap[0].key, "C minor");
  assert.equal(model.musicalMap?.vocals.status, "not_available");
  assert.deepEqual(model.musicalMap?.styleFingerprint.instrumentPaletteHints, RACHEM_NA_STORED_PALETTE_HINTS);
  assert.deepEqual(RACHEM_NA_STORED_PALETTE_HINTS, ["mix"]);
  // The re-derived RMS curve has the stored v3 shape: within 0.06 of every
  // stored target and the same two loudest sections.
  const curve = model.musicalMap!.energy.energyCurve;
  const measured = Object.fromEntries(model.sections.map((s) => {
    const spans = curve.filter((e) => e.endBar >= s.startBar && e.startBar <= s.endBar);
    return [s.name, spans.reduce((a, e) => a + e.energy, 0) / Math.max(1, spans.length)];
  }));
  for (const [name, stored] of Object.entries(RACHEM_NA_V3_SECTION_ENERGY)) {
    assert.ok(Math.abs(measured[name] - stored) < 0.06, `${name}: measured ${measured[name].toFixed(3)} vs stored ${stored}`);
  }
  const loudest = Object.entries(measured).sort((a, b) => b[1] - a[1]).slice(0, 2).map(([n]) => n);
  assert.deepEqual(loudest.sort(), ["Chorus", "Chorus 2"], "the recording peaks in the first two choruses, not the last");
});

test("the brief is read as the owner meant it: an intimate ballad with named families and a big final chorus", () => {
  const brief = ownerBrief();
  const hints = briefPlannerHints(brief);
  assert.equal(hints.global.arcTemplate, "intimate_ballad");
  assert.deepEqual(hints.global.paletteAdd, ["bass", "keys", "percussion", "strings"]);
  assert.deepEqual(new Set(hints.global.familyPriority), new Set(["bass", "keys", "percussion", "strings"]));
  assert.equal(hints.global.sectionDynamicSteps?.["Chorus 3"], 1, "\"big final chorus\" is one marking up");
  assert.equal(hints.global.textureSteps?.["Chorus 3"], 1);
  assert.ok(hints.evidence.some((e) => /arc template intimate_ballad/.test(e)));
});

test("with the brief: every section has >= 3 families, choruses are fuller than verses, Chorus 3 is the climax, keys never leads, mix is gone", () => {
  const model = rachemNaSongModel();
  const hints = briefPlannerHints(ownerBrief(model));
  const globalPlan = deriveGlobalArrangementPlan(model, { now: NOW, hints: hints.global });
  const sectionPlan = deriveSectionPhrasePlan(model, globalPlan, { now: NOW, hints: hints.section });

  const palette = globalPlan.instrumentPalette.map((p) => p.role);
  assert.ok(!palette.includes("mix"), `mix is not a family: ${palette.join(",")}`);
  assert.ok(globalPlan.excludedPaletteHints?.some((e) => e.hint === "mix" && /full-mix/.test(e.reason)), "the exclusion carries its reason");
  for (const family of ["keys", "strings", "bass", "percussion"]) assert.ok(palette.includes(family), `${family} in the palette`);

  const byName = new Map(sectionPlan.sections.map((s) => [s.sectionName, s]));
  const target = (name: string) => globalPlan.sectionTargets.find((t) => t.sectionName === name)!;
  for (const s of sectionPlan.sections) {
    assert.ok(s.activeInstrumentFamilies.length >= 3, `${s.sectionName}: ${s.activeInstrumentFamilies.join(",")}`);
    assert.notEqual(s.leadRole, "instrument:keys", `${s.sectionName}: keys is never LEAD`);
    assert.ok(!sectionPlan.roleAssignments.some((r) => r.sectionName === s.sectionName && r.role === "LEAD"), `${s.sectionName}: no accompaniment family is LEAD`);
    if (["verse", "chorus", "bridge"].includes(s.function)) {
      assert.equal(s.leadRole, "vocals", `${s.sectionName} is sung`);
      assert.equal(s.leadRoleSource, "sung_by_default");
    }
  }
  const families = (name: string) => byName.get(name)!.activeInstrumentFamilies.length;
  const level = (name: string) => target(name).energy;
  const maxVerse = Math.max(...VERSES.map(families));
  for (const chorus of CHORUSES) {
    assert.ok(families(chorus) >= maxVerse, `${chorus} has at least as many families as any verse`);
    for (const verse of VERSES) assert.ok(level(chorus) > level(verse), `${chorus} (${level(chorus)}) louder than ${verse} (${level(verse)})`);
  }
  assert.ok(Math.max(...CHORUSES.map(families)) > maxVerse, "at least one chorus is strictly fuller");

  // The climax is the last chorus, by the brief and the form - not the
  // recording's loudest bin (which was Chorus 2).
  assert.equal(globalPlan.climax?.sectionName, "Chorus 3");
  assert.ok(globalPlan.arc?.sections.find((s) => s.sectionName === "Chorus 3")?.isPrimaryClimax);
  assert.equal(target("Chorus 3").intendedDynamic, "f");
  assert.ok(level("Chorus 3") > level("Chorus 2") && level("Chorus 2") > level("Chorus"), "the choruses climb");
  // Family count follows the brief's dynamics, not the RMS: the recording's
  // loudest section (Chorus 2, RMS 0.37) is not fuller than the climax.
  assert.ok(families("Chorus 3") >= families("Chorus 2"));
  assert.ok(target("Chorus 3").sourceEnergy! < target("Chorus 2").sourceEnergy!, "the source is quieter in Chorus 3 (kept for the record)");
  // Texture, not the RMS, decides: Verse 3 (the quietest verse in the recording) still keeps the ballad's bed.
  assert.ok(families("Verse 3") >= 3);
});

test("with the brief: chorus 2 differs from chorus 1 by its operator, and every part request carries the form memory", () => {
  const model = rachemNaSongModel();
  const hints = briefPlannerHints(ownerBrief(model));
  const globalPlan = deriveGlobalArrangementPlan(model, { now: NOW, hints: hints.global });
  const sectionPlan = deriveSectionPhrasePlan(model, globalPlan, { now: NOW, hints: hints.section });
  const [c1, c2, c3] = CHORUSES.map((n) => sectionPlan.sections.find((s) => s.sectionName === n)!);
  assert.equal(c1.occurrenceIndex, 0);
  assert.equal(c1.developmentOperator, "identity");
  assert.equal(c2.occurrenceIndex, 1);
  assert.notEqual(c2.developmentOperator, "identity");
  assert.equal(c2.previousOccurrenceSummary?.sectionName, "Chorus");
  assert.notEqual(c3.developmentOperator, c2.developmentOperator);
  const roles = (name: string) => sectionPlan.roleAssignments.filter((r) => r.sectionName === name).map((r) => `${r.instrument}:${r.role}:${r.register}`).sort();
  assert.notDeepEqual(roles("Chorus 2"), roles("Chorus"), "the plan of chorus 2 is not the plan of chorus 1");
  assert.notDeepEqual(roles("Chorus 3"), roles("Chorus 2"));
  if (c2.developmentOperator === "add_layer") {
    assert.ok(c2.activeInstrumentFamilies.length > c1.activeInstrumentFamilies.length);
  }
  if (c3.developmentOperator === "raise_register") {
    const keys = sectionPlan.roleAssignments.find((r) => r.sectionName === "Chorus 3" && r.instrument === "keys")!;
    assert.equal(keys.register, "upper_mid", "the piano goes up a band in the climax");
  }
  // Staggered exits: the bridge breathes before the final chorus.
  const bridgePhrases = sectionPlan.phrases.filter((p) => p.sectionName === "Bridge");
  assert.ok(bridgePhrases.some((p) => p.leavesFamilies.length > 0), "leavesFamilies is not a constant []");
  const last = sectionPlan.phrases.filter((p) => p.sectionName === "Chorus 3")[0];
  assert.ok(last.entersFamilies.length >= 2, "families re-enter at the final chorus");
  // Form memory and intent reach the part contract.
  const transitions = deriveTransitionPlan(model, globalPlan, sectionPlan, { now: NOW }).transitions;
  const partPlan = buildPartComposerPlan(model, globalPlan, sectionPlan, transitions, { now: NOW });
  assert.ok(!partPlan.tasks.some((t) => t.instrument === "mix" || t.instrument === "ensemble"), "no fake instruments in the part plan");
  assert.ok(partPlan.tasks.some((t) => t.sectionName === "Verse 1" && t.instrument === "keys"), "the piano plays the first verse");
  for (const chorus of CHORUSES) assert.ok(partPlan.tasks.some((t) => t.sectionName === chorus && t.instrument === "keys"), `${chorus}: keys task`);
  assert.ok(partPlan.decisions?.some((d) => d.kind === "ensemble_resolved" || d.kind === "excluded_no_definition"), "ensemble figures are resolved or excluded with a reason");
});

test("the whole orchestrator runs on the owner's song: feasible, and no planned family is silent in a sung section", () => {
  const model = rachemNaSongModel();
  const hints = briefPlannerHints(ownerBrief(model));
  const result = orchestrateArrangement({
    songModel: model, candidateCount: 2, render: false, now: NOW,
    plannerHints: { global: hints.global, section: hints.section },
  });
  assert.equal(result.stages.length, 11);
  const selected = result.candidates.find((c) => c.candidateId === result.selected?.candidateId)!;
  assert.ok(selected.critique.feasible, `hard rules: ${selected.critique.hardRuleFindings.map((f) => f.message).join("; ")}`);
  const instruments = new Set(selected.trackModels.map((t) => t.instrument));
  for (const family of ["keys", "bass", "strings", "percussion", "drums"]) assert.ok(instruments.has(family), `${family} wrote notes`);
  assert.ok(!instruments.has("mix") && !instruments.has("ensemble"));
  const findings = silentPlannedFamilyFindings(model, {
    sectionPlan: result.plan.sectionPlan!, partComposerPlan: result.plan.partComposerPlan,
  }, selected.trackModels);
  assert.deepEqual(findings.filter((f) => f.severity === "error"), [], "every planned family is heard in every sung section");
  // The keys part is no longer a section-long silence: it plays in every verse and chorus.
  const bars = model.bars!;
  const secondsOf = (bar: number, end = false) => { const b = bars.find((x) => x.bar === bar)!; return end ? b.end : b.start; };
  const keys = selected.trackModels.find((t) => t.instrument === "keys")!;
  for (const s of model.sections) {
    if (!["Verse 1", "Verse 2", "Verse 3", "Chorus", "Chorus 2", "Chorus 3", "Bridge"].includes(s.name)) continue;
    const start = secondsOf(s.startBar);
    const end = secondsOf(s.endBar, true);
    const count = keys.notes.filter((n) => n.start >= start - 1e-6 && n.start < end - 1e-6).length;
    assert.ok(count > 0, `${s.name}: keys notes`);
  }
});

test("without a brief the same song still gets a defensible ballad arc, never the RMS, and stays feasible", () => {
  const model = rachemNaSongModel();
  const result = orchestrateArrangement({ songModel: model, candidateCount: 2, render: false, now: NOW });
  const globalPlan = result.plan.globalPlan!;
  assert.equal(globalPlan.arc?.template?.id, "intimate_ballad", "a sparse full-mix upload reads as intimate");
  assert.ok(!globalPlan.instrumentPalette.some((p) => p.role === "mix"));
  const target = (name: string) => globalPlan.sectionTargets.find((t) => t.sectionName === name)!;
  // Intended levels are markings, not the recording's 0.005..0.43 curve.
  assert.equal(target("Chorus 3").energy >= DYNAMIC_LEVEL.f - 0.06, true);
  assert.ok(target("Intro").energy >= DYNAMIC_LEVEL.p - 0.06, "a 2-bar intro is p, not 0.009");
  for (const s of result.plan.sectionPlan!.sections) {
    assert.ok(s.activeInstrumentFamilies.length >= 2, `${s.sectionName}: no section is empty`);
    assert.notEqual(s.leadRole, "instrument:keys");
  }
  const selected = result.candidates.find((c) => c.candidateId === result.selected?.candidateId)!;
  assert.ok(selected.critique.feasible, `hard rules: ${selected.critique.hardRuleFindings.map((f) => f.message).join("; ")}`);
  assert.ok(selected.trackModels.some((t) => t.instrument === "keys" && t.notes.length > 300), "the piano actually plays");
});
