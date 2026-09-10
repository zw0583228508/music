import assert from "node:assert/strict";
import test from "node:test";
import type { ArrangementPlan, EditPlan, SongModelData, TrackModel } from "@workspace/db";
import { orchestrateArrangement } from "./arrangementOrchestrator";
import { performedMaterialSha256 } from "./musicEngines";
import { barOf } from "./regenerationLocks";
import type { ProducerBriefRecord, ProducerChatTurnRecord } from "./producerChat";
import { ProducerChatError } from "./producerChat";
import { compileProductionBrief } from "./producerIntelligence/briefCompiler";
import { interpretEditRequest } from "./producerIntelligence/editPlan";
import { extractUserIntentSync } from "./producerIntelligence/intentExtraction";
import { resolveStyleProfile } from "./producerIntelligence/styleResolution";
import { FIXED_NOW, makeTestSongModel } from "./producerIntelligence/testSongModel";
import {
  SCOPED_REGENERATION_METHOD,
  barGeometryFromSongModel,
  createInMemoryRegenerationStore,
  createScopedRegenerationService,
  densityDirection,
  describeRegeneration,
  rankMergedCandidates,
  regenerateWithinScopes,
  resolveEditPlanToTracks,
  trackFamilies,
  type MergedCandidate,
} from "./scopedRegeneration";

const PROJECT = "project-1";
/** Previous notes are re-identified with this prefix: a surviving old note is unmistakable, whatever the composer writes. */
const PREVIOUS = "prev:";
const isPrevious = (note: { id: string }): boolean => note.id.startsWith(PREVIOUS);

const SIX_SECTIONS: SongModelData["sections"] = [
  { name: "Verse 1", startBar: 1, endBar: 4, energy: 0.35 },
  { name: "Chorus 1", startBar: 5, endBar: 8, energy: 0.75 },
  { name: "Verse 2", startBar: 9, endBar: 12, energy: 0.4 },
  { name: "Chorus 2", startBar: 13, endBar: 16, energy: 0.8 },
  { name: "Bridge", startBar: 17, endBar: 20, energy: 0.6 },
  { name: "Final Chorus", startBar: 21, endBar: 24, energy: 0.95 },
];

/**
 * A previous arrangement exactly as the studio would hold one: the brain's
 * own output, ids scoped to the project. Every note id is prefixed so "kept
 * verbatim" and "freshly composed" are told apart with certainty.
 */
function previousArrangement(model: SongModelData, candidateIndex = 0): { trackModels: TrackModel[]; plan: ArrangementPlan } {
  const result = orchestrateArrangement({ songModel: model, candidateCount: 3, render: false, now: new Date(0) });
  const candidate = result.candidates[candidateIndex];
  const trackModels = candidate.trackModels.map((track) => {
    const notes = track.notes.map((n) => ({ ...n, id: `${PREVIOUS}${n.id}` }));
    const scoped: TrackModel = { ...track, id: `${PROJECT}--${track.id}`, notes };
    if (scoped.performanceEvidence) {
      scoped.performanceEvidence = { ...scoped.performanceEvidence, performedMaterialSha256: performedMaterialSha256(scoped) };
    }
    return scoped;
  });
  return { trackModels, plan: { ...result.plan, id: "plan-prev", version: 1 } };
}

function briefFor(text: string, model: SongModelData, options: { deltasFrom?: EditPlan } = {}) {
  const intent = extractUserIntentSync(text, { now: FIXED_NOW });
  const profile = resolveStyleProfile(intent, { now: FIXED_NOW });
  return compileProductionBrief(intent, profile, model, [], { now: FIXED_NOW, deltas: options.deltasFrom?.briefDeltas ?? [] });
}

function setup(editText: string, sections = SIX_SECTIONS) {
  const model = makeTestSongModel({ sections });
  const previous = previousArrangement(model);
  const baseBrief = briefFor("a warm song", model);
  const editPlan = interpretEditRequest(editText, baseBrief, { globalPlan: previous.plan.globalPlan, sectionPlan: previous.plan.sectionPlan }, { now: FIXED_NOW });
  // The chat already compiled the edit's deltas into the current brief (PR-U2); the regeneration reads that brief.
  const brief = briefFor("a warm song", model, { deltasFrom: editPlan });
  return { model, previous, editPlan, brief };
}

const notesOutside = (track: TrackModel, geometry: ReturnType<typeof barGeometryFromSongModel>, startBar: number, endBar: number) =>
  track.notes.filter((n) => { const bar = barOf(n.start, geometry); return bar < startBar || bar > endBar; });
const notesInside = (track: TrackModel, geometry: ReturnType<typeof barGeometryFromSongModel>, startBar: number, endBar: number) =>
  track.notes.filter((n) => { const bar = barOf(n.start, geometry); return bar >= startBar && bar <= endBar; });

// ---------------------------------------------------------------------------

test("bar geometry follows the Song Model's bar times when it has them, the first tempo otherwise", () => {
  const analysed = barGeometryFromSongModel(makeTestSongModel());
  assert.equal(analysed.barStarts?.length, 24);
  assert.equal(analysed.barSeconds, 2);
  assert.equal(analysed.originSeconds, 0);
  const plain = barGeometryFromSongModel({ ...makeTestSongModel(), bars: [] });
  assert.equal(plain.barStarts, undefined);
  assert.equal(plain.barSeconds, 2, "120 BPM in 4/4 is a two-second bar");
});

test("the EditPlan's families are resolved to the arrangement's own tracks; unknown families are reported, never guessed", () => {
  const { previous, editPlan } = setup("keep the drums, regenerate the bass");
  assert.deepEqual(trackFamilies({ instrument: "bass" }), ["bass"]);
  assert.deepEqual(trackFamilies({ instrument: "piano" }), ["piano", "keys"]);
  const resolved = resolveEditPlanToTracks(editPlan, previous.trackModels);
  assert.ok(resolved.requested.length > 0 && resolved.requested.every((s) => s.instrument === "bass"), "only the bass is requested");
  const drumLocks = resolved.locks.locks.filter((l) => l.instrument === "drums");
  assert.ok(drumLocks.length >= 1 && drumLocks.every((l) => l.scope === "track" && l.trackId === undefined), "the drum lock is by instrument, the identity PR-17 merges on");
  assert.deepEqual(resolved.unmatchedFamilies, ["keys"], "the palette lists keys but no track plays them");
});

test("'הפזמון השני עמוס מדי': only Chorus 2 is rewritten; every other bar of every track is byte-identical", () => {
  const { model, previous, editPlan, brief } = setup("הפזמון השני עמוס מדי");
  assert.equal(editPlan.intent, "reduce_density");
  const geometry = barGeometryFromSongModel(model);
  const result = regenerateWithinScopes({
    projectId: PROJECT, editTurnId: "turn-edit", editPlan,
    previous: { id: "arr-1", version: 1, trackModels: previous.trackModels, plan: previous.plan, songModelVersion: 1 },
    songModel: model, songModelVersion: 1, brief, styleProfile: null, now: FIXED_NOW,
  });
  const report = result.report;
  assert.equal(report.method, SCOPED_REGENERATION_METHOD);
  assert.equal(report.locksHonoured, true, report.verification.violations.join("; "));
  assert.equal(report.verification.honoured, true);
  assert.ok(report.verification.checkedLockedNotes > 0, "locked notes were actually checked");
  assert.equal(report.blockedByLock.length, 0, "the plan's own locks never block its own scopes");
  assert.ok(report.regenerated.length > 0 && report.regenerated.every((s) => s.sectionName === "Chorus 2" && s.startBar === 13 && s.endBar === 16));
  assert.ok(report.requested.some((s) => s.instrument === "ensemble"), "a section-wide edit covers the ensemble's transitions in that section too");
  assert.deepEqual(report.changed.sections, ["Chorus 2"]);
  assert.deepEqual(report.preserved.sections, ["Verse 1", "Chorus 1", "Verse 2", "Bridge", "Final Chorus"]);
  assert.ok(report.replacedNotes > 0, "fresh material entered the chorus");
  assert.ok(report.changed.instruments.length > 0);

  // The promise, checked note by note: outside bars 13–16 nothing moved.
  const before = new Map(previous.trackModels.map((t) => [t.id, t]));
  let merged = 0;
  for (const track of result.trackModels) {
    const prior = before.get(track.id);
    assert.ok(prior, `${track.id} existed before`);
    assert.deepEqual(notesOutside(track, geometry, 13, 16), notesOutside(prior!, geometry, 13, 16), `${track.instrument}: bars outside Chorus 2 are untouched`);
    const inside = notesInside(track, geometry, 13, 16);
    assert.ok(inside.every((n) => !isPrevious(n)), `${track.instrument}: nothing of the old chorus survived where regeneration was allowed`);
    merged += track.notes.length;
  }
  assert.equal(report.keptNotes + report.replacedNotes, merged, "every merged note is either kept or fresh");

  // Never the first candidate: three were ranked and the accepted one honours the locks.
  assert.equal(report.candidates.length, 3);
  assert.equal(report.candidates.filter((c) => c.selected).length, 1);
  const selected = report.candidates.find((c) => c.selected)!;
  assert.equal(selected.candidateId, report.selectedCandidateId);
  assert.equal(selected.locksHonoured, true);
  assert.ok(report.candidates.every((c) => c.score >= 0 && c.score <= 100));

  // The brief shaped the planners and is stamped on the plan, with the report.
  assert.ok(report.plannerHintEvidence.some((line) => /Chorus 2: density bias -0\.35/.test(line)), report.plannerHintEvidence.join("\n"));
  assert.equal(result.plan.productionBriefId, brief.id);
  assert.equal(result.plan.productionBriefDigestSha256, brief.inputsDigestSha256);
  assert.equal(result.plan.regeneration, report);
  assert.equal(result.plan.version, 2);
  assert.equal(result.plan.provenance.createdBy, SCOPED_REGENERATION_METHOD);
  assert.ok(result.plan.provenance.parentIds.includes("arr-1"));
  assert.equal(result.plan.globalPlan?.sectionTargets.find((s) => s.sectionName === "Chorus 2")?.density! <
    previous.plan.globalPlan!.sectionTargets.find((s) => s.sectionName === "Chorus 2")!.density, true, "the new plan is thinner in Chorus 2");
  // The palette lists keys but the brain composed none: said, not hidden.
  assert.deepEqual(report.warnings, ["No track of this arrangement plays keys; those parts of the edit had nothing to act on."]);
});

test("'keep the drums, regenerate the bass': the drum track is the same bytes; the bass is fresh, playable and re-sealed", () => {
  const { model, previous, editPlan, brief } = setup("keep the drums, regenerate the bass");
  const result = regenerateWithinScopes({
    projectId: PROJECT, editTurnId: "turn-edit", editPlan,
    previous: { id: "arr-1", version: 1, trackModels: previous.trackModels, plan: previous.plan, songModelVersion: 1 },
    songModel: model, songModelVersion: 1, brief, styleProfile: null, now: FIXED_NOW,
  });
  const report = result.report;
  const drumsBefore = previous.trackModels.find((t) => t.instrument === "drums")!;
  const bassBefore = previous.trackModels.find((t) => t.instrument === "bass")!;
  const drums = result.trackModels.find((t) => t.instrument === "drums")!;
  const bass = result.trackModels.find((t) => t.instrument === "bass")!;

  assert.equal(drums, drumsBefore, "the locked track is the very same object");
  assert.equal(JSON.stringify(drums), JSON.stringify(drumsBefore), "and therefore byte-identical, evidence included");
  assert.deepEqual(report.changed.instruments, ["bass"]);
  assert.deepEqual(report.preserved.instruments, ["drums", "ensemble", "strings"]);
  assert.ok(bass.notes.length > 0 && bass.notes.every((n) => !isPrevious(n)), "no old bass note survived");
  assert.equal(bass.id, bassBefore.id, "a regenerated part keeps its track row");
  assert.equal(bass.version, bassBefore.version + 1);
  assert.equal(bass.performanceEvidence?.performedMaterialSha256, performedMaterialSha256(bass), "the evidence seals the merged material");
  assert.notEqual(bass.performanceEvidence?.performedMaterialSha256, bassBefore.performanceEvidence?.performedMaterialSha256);
  assert.equal(bass.performanceEvidence?.playability.checkedNotes, bass.notes.length);
  assert.equal(report.locksHonoured, true);
  assert.deepEqual(report.unmatchedFamilies, ["keys"]);
  assert.match(report.warnings.join(" "), /No track of this arrangement plays keys/);
  assert.equal(report.keptNotes, drums.notes.length + result.trackModels.filter((t) => t.instrument === "strings" || t.instrument === "ensemble").reduce((s, t) => s + t.notes.length, 0));

  const words = describeRegeneration(report, { version: 2 });
  assert.match(words, /Applied "keep the drums, regenerate the bass" → arrangement v2 \(from v1\)/);
  assert.match(words, /Regenerated bass in/);
  assert.match(words, /drums, ensemble, strings untouched/);
  assert.match(words, /Locks verified: \d+ locked note\(s\) byte-identical/);
  assert.match(words, /3 candidates ranked/);
  assert.match(words, /The brief shaped the planners/);
});

test("ranking: locks, hard rules, playability, score — then the edit's own direction breaks the critic's ties, never the id alone", () => {
  const merged = (candidateId: string, over: Partial<Omit<MergedCandidate, "candidate" | "verification">> & { honoured?: boolean }): MergedCandidate => ({
    candidate: {
      candidateId, label: candidateId, strategy: "conservative", seed: 1, plan: {} as never, trackModels: [], noteCount: 0, constraintErrors: 0, performedConstraintErrors: 0,
      initialCritique: {} as never, compositionCritique: {} as never, critique: {} as never, repair: null, repairApplied: false,
      findings: [], hardRule: { feasible: true, reasons: [] }, playabilityRepairs: [], audioCritique: null, renderFeasible: null, finalScore: 0,
    },
    trackModels: [], keptNotes: 0, replacedNotes: 100, identicalReplacedNotes: 0, feasible: true, score: 70, constraintErrors: 0,
    verification: { honoured: over.honoured ?? true, violations: over.honoured === false ? ["x"] : [] },
    ...over,
  });
  const a = merged("cand-A", { replacedNotes: 138 });
  const b = merged("cand-B", { replacedNotes: 148 });
  const sparse = merged("cand-D", { replacedNotes: 88 });
  const ids = (list: MergedCandidate[]) => list.map((m) => m.candidate.candidateId);
  assert.deepEqual(ids(rankMergedCandidates([a, b, sparse], "reduce_density")), ["cand-D", "cand-A", "cand-B"], "'too busy' takes the thinnest rewrite among equals");
  assert.deepEqual(ids(rankMergedCandidates([a, b, sparse], "raise_energy")), ["cand-B", "cand-A", "cand-D"], "'more energy' takes the fullest");
  assert.deepEqual(ids(rankMergedCandidates([a, b, sparse], "regenerate_part")), ["cand-A", "cand-B", "cand-D"], "no direction, all novel: deterministic by id");
  assert.deepEqual(ids(rankMergedCandidates([a, b, sparse])), ["cand-A", "cand-B", "cand-D"]);
  // A candidate that merely re-wrote the same notes loses to one that changed them, whatever its id.
  const same = merged("cand-A", { replacedNotes: 137, identicalReplacedNotes: 137 });
  const fresh = merged("cand-C", { replacedNotes: 146, identicalReplacedNotes: 0 });
  assert.deepEqual(ids(rankMergedCandidates([same, fresh], "regenerate_part")), ["cand-C", "cand-A"], "'regenerate the bass' must regenerate it");
  assert.deepEqual(ids(rankMergedCandidates([same, merged("cand-B", { replacedNotes: 137, identicalReplacedNotes: 100 })], "regenerate_part")), ["cand-B", "cand-A"]);
  assert.deepEqual(ids(rankMergedCandidates([same, merged("cand-B", { replacedNotes: 200, identicalReplacedNotes: 0 })], "reduce_density")), ["cand-A", "cand-B"], "the stated direction still comes before novelty");
  // Score beats direction; hard rules beat score; locks beat everything.
  assert.equal(ids(rankMergedCandidates([a, merged("cand-Z", { replacedNotes: 10, score: 71 })], "reduce_density"))[0], "cand-Z");
  assert.equal(ids(rankMergedCandidates([merged("cand-A", { score: 99, feasible: false }), merged("cand-B", { score: 40 })]))[0], "cand-B");
  assert.equal(ids(rankMergedCandidates([merged("cand-A", { score: 99, honoured: false }), merged("cand-B", { score: 40 })]))[0], "cand-B");
  assert.equal(ids(rankMergedCandidates([merged("cand-A", { constraintErrors: 2 }), merged("cand-B", { constraintErrors: 0, score: 60 })]))[0], "cand-B", "a playable merge outranks a higher-scoring one with playability errors");
  assert.deepEqual([densityDirection("reduce_density"), densityDirection("lower_energy"), densityDirection("raise_climax"), densityDirection("change_groove")], [-1, -1, 1, 0]);
});

test("when every candidate reproduces the previous part note for note, the report and the reply say so instead of pretending", () => {
  const model = makeTestSongModel({ sections: SIX_SECTIONS });
  // The previous arrangement IS the brain's own unprefixed output; the injected
  // brain returns exactly the same result, as a deterministic composer with an
  // unchanged plan would.
  const result = orchestrateArrangement({ songModel: model, candidateCount: 3, render: false, now: new Date(0) });
  const previousTracks = result.candidates[0].trackModels.map((t) => ({ ...t, id: `${PROJECT}--${t.id}` }));
  const baseBrief = briefFor("a warm song", model);
  const editPlan = interpretEditRequest("regenerate the bass", baseBrief, { globalPlan: result.plan.globalPlan, sectionPlan: result.plan.sectionPlan }, { now: FIXED_NOW });
  assert.equal(editPlan.intent, "regenerate_part");
  const out = regenerateWithinScopes({
    projectId: PROJECT, editTurnId: "turn-edit", editPlan,
    previous: { id: "arr-1", version: 1, trackModels: previousTracks, plan: result.plan, songModelVersion: 1 },
    songModel: model, songModelVersion: 1, brief: null, styleProfile: null, now: FIXED_NOW,
    orchestrate: () => result,
  });
  const bassBefore = previousTracks.find((t) => t.instrument === "bass")!;
  assert.ok(out.report.replacedNotes > 0);
  // Candidate A is the previous part itself; B and C differ, so one of them wins.
  const a = out.report.candidates.find((c) => c.candidateId === "cand-A")!;
  assert.equal(a.identicalReplacedNotes, a.replacedNotes, "candidate A re-wrote the same bass");
  assert.equal(a.identicalReplacedNotes, bassBefore.notes.length);
  assert.notEqual(out.report.selectedCandidateId, "cand-A", "the identical rewrite is not accepted over a real change");
  assert.ok(out.report.identicalReplacedNotes < out.report.replacedNotes);
  assert.ok(!out.report.warnings.some((w) => /reproduced the previous material/.test(w)));

  // With a single-candidate world where nothing differs, the warning is explicit.
  const only = { ...result, candidates: [result.candidates[0], { ...result.candidates[0], candidateId: "cand-A2" }, { ...result.candidates[0], candidateId: "cand-A3" }] };
  const flat = regenerateWithinScopes({
    projectId: PROJECT, editTurnId: "turn-edit", editPlan,
    previous: { id: "arr-1", version: 1, trackModels: previousTracks, plan: result.plan, songModelVersion: 1 },
    songModel: model, songModelVersion: 1, brief: null, styleProfile: null, now: FIXED_NOW,
    orchestrate: () => only,
  });
  assert.equal(flat.report.identicalReplacedNotes, flat.report.replacedNotes);
  assert.ok(flat.report.warnings.some((w) => /reproduced the previous material note for note/.test(w)), flat.report.warnings.join(" | "));
  assert.match(describeRegeneration(flat.report, { version: 2 }), /identical to before/);
  assert.match(describeRegeneration(flat.report, { version: 2 }), /=same/);
});

test("the same inputs give the same regeneration", () => {
  const { model, previous, editPlan, brief } = setup("keep the drums, regenerate the bass");
  const run = () => regenerateWithinScopes({
    projectId: PROJECT, editTurnId: "turn-edit", editPlan,
    previous: { id: "arr-1", version: 1, trackModels: previous.trackModels, plan: previous.plan, songModelVersion: 1 },
    songModel: model, songModelVersion: 1, brief, styleProfile: null, now: FIXED_NOW,
  });
  const a = run();
  const b = run();
  assert.equal(JSON.stringify(a.trackModels.map((t) => t.notes)), JSON.stringify(b.trackModels.map((t) => t.notes)));
  assert.equal(a.report.selectedCandidateId, b.report.selectedCandidateId);
  assert.deepEqual(a.report.candidates.map((c) => [c.candidateId, c.score, c.replacedNotes]), b.report.candidates.map((c) => [c.candidateId, c.score, c.replacedNotes]));
});

test("a scope the locks cover entirely is blocked and reported; a partly covered one shrinks to its free bars", () => {
  const { model, previous, editPlan, brief } = setup("keep the drums, regenerate the bass");
  const geometry = barGeometryFromSongModel(model);
  const partlyLocked: EditPlan = {
    ...editPlan,
    preserve: [...editPlan.preserve, { id: "lock-bass-open", scope: "phrase", instrument: "bass", startBar: 1, endBar: 12, reason: "test", createdAt: FIXED_NOW.toISOString() }],
  };
  const partial = regenerateWithinScopes({
    projectId: PROJECT, editTurnId: "turn-edit", editPlan: partlyLocked,
    previous: { id: "arr-1", version: 1, trackModels: previous.trackModels, plan: previous.plan, songModelVersion: 1 },
    songModel: model, songModelVersion: 1, brief, styleProfile: null, now: FIXED_NOW,
  });
  assert.ok(partial.report.blockedByLock.length > 0);
  assert.ok(partial.report.blockedByLock.every((b) => b.lockId === "lock-bass-open:bass"));
  assert.ok(partial.allowed.every((s) => s.startBar >= 13), "only bars 13–24 of the bass may change");
  const bass = partial.trackModels.find((t) => t.instrument === "bass")!;
  const bassBefore = previous.trackModels.find((t) => t.instrument === "bass")!;
  assert.deepEqual(notesOutside(bass, geometry, 13, 24), notesOutside(bassBefore, geometry, 13, 24), "bars 1–12 of the bass survived verbatim");
  assert.ok(notesInside(bass, geometry, 13, 24).every((n) => !isPrevious(n)));
  assert.equal(partial.report.locksHonoured, true);

  const fullyLocked: EditPlan = {
    ...editPlan,
    preserve: [...editPlan.preserve, { id: "lock-bass-all", scope: "track", instrument: "bass", reason: "test", createdAt: FIXED_NOW.toISOString() }],
  };
  const blocked = regenerateWithinScopes({
    projectId: PROJECT, editTurnId: "turn-edit", editPlan: fullyLocked,
    previous: { id: "arr-1", version: 1, trackModels: previous.trackModels, plan: previous.plan, songModelVersion: 1 },
    songModel: model, songModelVersion: 1, brief, styleProfile: null, now: FIXED_NOW,
  });
  assert.equal(blocked.allowed.length, 0);
  assert.equal(blocked.report.replacedNotes, 0);
  assert.equal(JSON.stringify(blocked.trackModels), JSON.stringify(previous.trackModels), "nothing changed at all");
});

test("without a brief the planners read the Song Model alone and the plan carries no stamp", () => {
  const { model, previous, editPlan } = setup("keep the drums, regenerate the bass");
  const result = regenerateWithinScopes({
    projectId: PROJECT, editTurnId: "turn-edit", editPlan,
    previous: { id: "arr-1", version: 1, trackModels: previous.trackModels, plan: previous.plan, songModelVersion: 1 },
    songModel: model, songModelVersion: 1, brief: null, styleProfile: null, now: FIXED_NOW,
  });
  assert.equal(result.report.productionBriefId, null);
  assert.deepEqual(result.report.plannerHintEvidence, []);
  assert.equal(result.plan.productionBriefId, undefined);
  assert.match(describeRegeneration(result.report, { version: 2 }), /No brief: the planners read the Song Model alone/);
});

// ---------------------------------------------------------------------------
// The service, through the in-memory store
// ---------------------------------------------------------------------------

function clock(start = FIXED_NOW) {
  let t = start.getTime();
  return () => new Date((t += 1_000));
}
function ids() {
  let n = 0;
  return () => `id-${String(++n).padStart(3, "0")}`;
}

function serviceSetup(editText = "keep the drums, regenerate the bass", options: { arrangement?: boolean } = {}) {
  const { model, previous, editPlan, brief } = setup(editText);
  const briefRecord: ProducerBriefRecord = {
    id: "brief-row-2", projectId: PROJECT, version: 2, intent: extractUserIntentSync("a warm song", { now: FIXED_NOW }),
    styleProfile: resolveStyleProfile(extractUserIntentSync("a warm song", { now: FIXED_NOW }), { now: FIXED_NOW }),
    brief, answers: [], inputsDigestSha256: brief.inputsDigestSha256, createdAt: FIXED_NOW.toISOString(),
  };
  const turns: ProducerChatTurnRecord[] = [
    { id: "turn-user", projectId: PROJECT, briefId: "brief-row-2", role: "user", text: editText, structured: null, createdAt: FIXED_NOW.toISOString() },
    { id: "turn-edit", projectId: PROJECT, briefId: "brief-row-2", role: "producer", text: editPlan.rationale, structured: { kind: "edit", briefVersion: 2, editPlan, decisionIds: [], planSource: "arrangement" }, createdAt: new Date(FIXED_NOW.getTime() + 1).toISOString() },
    { id: "turn-question", projectId: PROJECT, briefId: "brief-row-2", role: "producer", text: "because", structured: { kind: "explanation", briefVersion: 2, explanation: { answered: true, answer: "because", evidence: [], confidence: 1 } }, createdAt: new Date(FIXED_NOW.getTime() + 2).toISOString() },
  ];
  const store = createInMemoryRegenerationStore({
    turns,
    arrangements: options.arrangement === false ? [] : [{ id: "arr-1", projectId: PROJECT, name: "Ballad · conservative", version: 1, trackModels: previous.trackModels, plan: previous.plan, songModelVersion: 1 }],
    songModel: { version: 1, model },
    brief: briefRecord,
  });
  const service = createScopedRegenerationService(store, { now: clock(), newId: ids() });
  return { store, service, previous, editPlan, brief, model };
}

test("applying an edit turn persists a new arrangement version and a `regeneration` turn pair carrying the report", async () => {
  const { store, service, previous, brief } = serviceSetup();
  const outcome = await service.apply(PROJECT, "turn-edit");

  assert.equal(store.arrangements.length, 2);
  const created = store.arrangements[1];
  assert.equal(created.id, outcome.arrangement.id);
  assert.equal(created.version, 2);
  assert.equal(created.parentArrangementId, "arr-1");
  assert.equal(created.name, "Ballad · conservative · edit v2");
  assert.equal(created.plan?.version, 2);
  assert.equal(created.plan?.productionBriefId, brief.id);
  assert.equal(created.plan?.regeneration?.editTurnId, "turn-edit");
  assert.equal(created.plan?.regeneration?.parentArrangementId, "arr-1");
  assert.equal(created.provenance.createdBy, SCOPED_REGENERATION_METHOD);
  assert.deepEqual(created.provenance.parentIds, ["arr-1"]);
  assert.equal(created.parameters.regenerationOfTurnId, "turn-edit");
  assert.equal(created.parameters.regenerationLocksHonoured, true);
  assert.equal(created.parameters.productionBriefId, brief.id);
  assert.equal(created.songModelVersion, 1);
  assert.match(created.activity?.detail ?? "", /locks honoured/);
  const drums = created.trackModels.find((t) => t.instrument === "drums")!;
  assert.equal(JSON.stringify(drums), JSON.stringify(previous.trackModels.find((t) => t.instrument === "drums")));

  assert.equal(store.turns.length, 5);
  const [user, producer] = store.turns.slice(-2);
  assert.equal(user.id, outcome.turnId);
  assert.equal(user.role, "user");
  assert.equal(user.text, 'apply: "keep the drums, regenerate the bass"');
  assert.equal(user.briefId, "brief-row-2");
  assert.equal(producer.id, outcome.producerTurnId);
  assert.equal(producer.structured?.kind, "regeneration");
  assert.equal(producer.structured?.briefVersion, 2);
  assert.equal(producer.structured?.arrangementId, created.id);
  assert.equal(producer.structured?.arrangementVersion, 2);
  assert.equal(producer.structured?.regeneration, outcome.report);
  assert.equal(producer.text, outcome.reply);
  assert.match(outcome.reply, /^Applied "keep the drums, regenerate the bass" → arrangement v2 \(from v1\)\./);
  assert.match(outcome.reply, /Locks verified/);
  assert.equal(outcome.briefVersion, 2);

  // A second application regenerates from the new version: v3, parent v2.
  const again = await service.apply(PROJECT, "turn-edit");
  assert.equal(again.arrangement.version, 3);
  assert.equal(again.report.parentArrangementId, created.id);
  assert.equal(again.report.parentArrangementVersion, 2);
  assert.equal(store.arrangements[2].name, "Ballad · conservative · edit v3");
});

test("only edit turns can be applied; the failure modes are precise", async () => {
  const { service } = serviceSetup();
  await assert.rejects(service.apply(PROJECT, "no-such-turn"), (e: unknown) => e instanceof ProducerChatError && e.status === 404);
  await assert.rejects(service.apply(PROJECT, "turn-user"), (e: unknown) => e instanceof ProducerChatError && e.status === 400 && /not an edit turn/.test(e.message));
  await assert.rejects(service.apply(PROJECT, "turn-question"), (e: unknown) => e instanceof ProducerChatError && e.status === 400);
  await assert.rejects(service.apply("other-project", "turn-edit"), (e: unknown) => e instanceof ProducerChatError && e.status === 404);

  const { service: noArrangement } = serviceSetup("keep the drums, regenerate the bass", { arrangement: false });
  await assert.rejects(noArrangement.apply(PROJECT, "turn-edit"), (e: unknown) => e instanceof ProducerChatError && e.status === 409 && /No arrangement with persisted TrackModels/.test(e.message));

  // An edit read as "keep" alone has no scope to regenerate.
  const { service: keepOnly, store } = serviceSetup("keep the drums");
  const editTurn = store.turns.find((t) => t.id === "turn-edit")!;
  assert.equal(editTurn.structured?.editPlan?.intent, "keep");
  await assert.rejects(keepOnly.apply(PROJECT, "turn-edit"), (e: unknown) => e instanceof ProducerChatError && e.status === 409 && /Nothing to regenerate/.test(e.message));
});

test("when every requested scope is locked the service refuses and persists nothing", async () => {
  const { service, store } = serviceSetup();
  const editTurn = store.turns.find((t) => t.id === "turn-edit")!;
  const editPlan = editTurn.structured!.editPlan!;
  editTurn.structured = {
    ...editTurn.structured!,
    editPlan: { ...editPlan, preserve: [...editPlan.preserve, { id: "lock-all", scope: "global", createdAt: FIXED_NOW.toISOString() }] },
  };
  await assert.rejects(service.apply(PROJECT, "turn-edit"), (e: unknown) => e instanceof ProducerChatError && e.status === 409 && /covered by a lock/.test(e.message));
  assert.equal(store.arrangements.length, 1);
  assert.equal(store.turns.length, 3);
});
