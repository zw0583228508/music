import assert from "node:assert/strict";
import test from "node:test";
import type { LockScope, SongModelData } from "@workspace/db";
import { deriveGlobalArrangementPlan } from "../globalArrangementPlanner";
import { resolveRegenerationScopes } from "../regenerationLocks";
import { deriveSectionPhrasePlan } from "../sectionPhrasePlanner";
import { compileProductionBrief } from "./briefCompiler";
import { EDIT_PLAN_VERSION, interpretEditRequest } from "./editPlan";
import { extractUserIntentSync } from "./intentExtraction";
import { resolveStyleProfile } from "./styleResolution";
import { FIXED_NOW, makeTestSongModel } from "./testSongModel";

const SIX_SECTIONS: SongModelData["sections"] = [
  { name: "Verse 1", startBar: 1, endBar: 4, energy: 0.35 },
  { name: "Chorus 1", startBar: 5, endBar: 8, energy: 0.75 },
  { name: "Verse 2", startBar: 9, endBar: 12, energy: 0.4 },
  { name: "Chorus 2", startBar: 13, endBar: 16, energy: 0.8 },
  { name: "Bridge", startBar: 17, endBar: 20, energy: 0.6 },
  { name: "Final Chorus", startBar: 21, endBar: 24, energy: 0.95 },
];
const LOCK_SCOPES: LockScope[] = ["global", "section", "track", "phrase", "event"];

function setup(sections = SIX_SECTIONS) {
  const model = makeTestSongModel({ sections });
  const intent = extractUserIntentSync("a warm song", { now: FIXED_NOW });
  const brief = compileProductionBrief(intent, resolveStyleProfile(intent, { now: FIXED_NOW }), model, [], { now: FIXED_NOW });
  const globalPlan = deriveGlobalArrangementPlan(model, { now: FIXED_NOW });
  const sectionPlan = deriveSectionPhrasePlan(model, globalPlan, { now: FIXED_NOW });
  return { model, brief, plan: { globalPlan, sectionPlan } };
}

test("'הפזמון השני עמוס מדי' → reduce density in Chorus 2 only, everything else locked", () => {
  const { brief, plan } = setup();
  const edit = interpretEditRequest("הפזמון השני עמוס מדי", brief, plan, { now: FIXED_NOW });
  assert.equal(edit.version, EDIT_PLAN_VERSION);
  assert.equal(edit.intent, "reduce_density");
  assert.deepEqual(edit.scope, { kind: "section", sectionName: "Chorus 2" });
  assert.ok(edit.modify.length >= 3, "every palette instrument in the section is regenerated");
  assert.ok(edit.modify.every((s) => s.sectionName === "Chorus 2" && s.startBar === 13 && s.endBar === 16));
  const lockedSections = edit.preserve.filter((l) => l.scope === "section").map((l) => l.sectionName).sort();
  assert.deepEqual(lockedSections, ["Bridge", "Chorus 1", "Final Chorus", "Verse 1", "Verse 2"]);
  const { allowed, blocked } = resolveRegenerationScopes(edit.modify, { version: "1.0", locks: edit.preserve });
  assert.equal(blocked.length, 0, "the plan's own locks never block its own scopes");
  assert.equal(allowed.length, edit.modify.length);
  assert.deepEqual(edit.briefDeltas, [{ kind: "section_intention", section: { function: "chorus", ordinal: 2 }, densityBias: -0.35, rationale: 'edit: "הפזמון השני עמוס מדי"' }]);
  assert.ok(edit.confidence >= 0.8);
});

test("'the last chorus still doesn't feel like a climax' → raise the climax of the final chorus", () => {
  const { brief, plan } = setup();
  const edit = interpretEditRequest("the last chorus still doesn't feel like a climax", brief, plan, { now: FIXED_NOW });
  assert.equal(edit.intent, "raise_climax");
  assert.deepEqual(edit.scope, { kind: "section", sectionName: "Final Chorus" });
  assert.ok(edit.modify.every((s) => s.sectionName === "Final Chorus"));
  const delta = edit.briefDeltas[0];
  assert.ok(delta.kind === "section_intention" && delta.climax === "primary" && delta.energyBias === 0.3);
  assert.match(edit.rationale, /raise climax on section "Final Chorus"/);
});

test("'make the violins more Jewish' → ornamentation on the strings track, other instruments locked", () => {
  const { brief, plan } = setup();
  const edit = interpretEditRequest("make the violins more Jewish", brief, plan, { now: FIXED_NOW });
  assert.equal(edit.intent, "change_ornamentation");
  assert.deepEqual(edit.scope, { kind: "track", instrument: "strings" });
  assert.ok(edit.modify.length === SIX_SECTIONS.length && edit.modify.every((s) => s.instrument === "strings"));
  const lockedTracks = edit.preserve.filter((l) => l.scope === "track").map((l) => l.instrument);
  assert.ok(lockedTracks.length >= 2 && !lockedTracks.includes("strings"));
  const ornament = edit.briefDeltas.find((d) => d.kind === "decision" && d.topic === "ornamentation");
  assert.ok(ornament && ornament.kind === "decision" && ornament.dimension === "melodicOrnamentation" && ornament.scope.kind === "track");
  const language = edit.briefDeltas.find((d) => d.kind === "decision" && d.dimension === "articulationLanguage");
  assert.ok(language && language.kind === "decision" && language.value === "jewish");
  assert.ok(edit.evidence.includes("more Jewish") && edit.evidence.includes("violins"));
});

test("'keep the drums, regenerate the bass' → a drum lock and bass scopes that the lock does not block", () => {
  const { brief, plan } = setup();
  const edit = interpretEditRequest("keep the drums, regenerate the bass", brief, plan, { now: FIXED_NOW });
  assert.equal(edit.intent, "regenerate_part");
  assert.deepEqual(edit.scope, { kind: "track", instrument: "bass" });
  assert.ok(edit.preserve.some((l) => l.scope === "track" && l.instrument === "drums"));
  assert.ok(edit.modify.length > 0 && edit.modify.every((s) => s.instrument === "bass"));
  const { allowed, blocked } = resolveRegenerationScopes(edit.modify, { version: "1.0", locks: edit.preserve });
  assert.equal(blocked.length, 0);
  assert.equal(allowed.length, edit.modify.length);
});

test("'add clarinet in the final chorus' → a new family that may only enter there", () => {
  const { brief, plan } = setup();
  const edit = interpretEditRequest("add clarinet in the final chorus", brief, plan, { now: FIXED_NOW });
  assert.equal(edit.intent, "add_instrument");
  assert.deepEqual(edit.modify, [{ instrument: "winds", sectionName: "Final Chorus", startBar: 21, endBar: 24, reason: "producer asked to regenerate winds" }]);
  assert.ok(edit.preserve.some((l) => l.scope === "section" && l.sectionName === "Chorus 1"));
  assert.deepEqual(edit.briefDeltas, [{ kind: "section_intention", section: { function: "chorus", ordinal: "last" }, add: ["winds"], rationale: 'edit: "add clarinet in the final chorus"' }]);
});

test("Hebrew add + keep in one sentence", () => {
  const { brief, plan } = setup();
  const edit = interpretEditRequest("תוסיף מיתרים בפזמון האחרון ותשאיר את התופים", brief, plan, { now: FIXED_NOW });
  assert.equal(edit.intent, "regenerate_part", "strings already exist in the plan");
  assert.ok(edit.preserve.some((l) => l.scope === "track" && l.instrument === "drums"));
  assert.ok(edit.modify.every((s) => s.instrument === "strings" && s.sectionName === "Final Chorus"));
});

test("a request the interpreter cannot map regenerates nothing", () => {
  const { brief, plan } = setup();
  const edit = interpretEditRequest("hello there, how are you", brief, plan, { now: FIXED_NOW });
  assert.equal(edit.intent, "unclear");
  assert.deepEqual(edit.modify, []);
  assert.deepEqual(edit.preserve, []);
  assert.ok(edit.confidence < 0.3);
  const noBridge = interpretEditRequest("the bridge is too busy", brief, setup(makeTestSongModel().sections).plan, { now: FIXED_NOW });
  assert.equal(noBridge.scope.kind, "global", "an unmatched section does not silently become a whole-song edit with high confidence");
  assert.ok(noBridge.confidence < 0.5);
  assert.match(noBridge.rationale, /could not be matched/);
});

test("edit plans reuse the existing lock and regeneration scopes verbatim", () => {
  const { brief, plan } = setup();
  for (const text of ["הפזמון השני עמוס מדי", "make the violins more Jewish", "keep the drums, regenerate the bass", "bars 3-4 of the piano"]) {
    const edit = interpretEditRequest(text, brief, plan, { now: FIXED_NOW });
    for (const lock of edit.preserve) {
      assert.ok(LOCK_SCOPES.includes(lock.scope), `${text}: lock scope ${lock.scope}`);
      assert.ok(lock.id && lock.createdAt);
    }
    for (const scope of edit.modify) {
      assert.ok(typeof scope.instrument === "string" && typeof scope.sectionName === "string");
      assert.ok(scope.startBar <= scope.endBar && typeof scope.reason === "string");
    }
  }
  const phrase = interpretEditRequest("bars 3-4 of the piano", brief, plan, { now: FIXED_NOW });
  assert.equal(phrase.scope.kind, "phrase");
  assert.ok(phrase.modify.every((s) => s.instrument === "keys" && s.startBar === 3 && s.endBar === 4));
});
