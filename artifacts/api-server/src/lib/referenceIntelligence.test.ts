import assert from "node:assert/strict";
import test from "node:test";
import type { MusicalNote, SongModelData, TrackModel } from "@workspace/db";
import { getInstrumentDefinition } from "./musicEngines";
import {
  ProducerChatError,
  createInMemoryProducerChatStore,
  createProducerChatService,
  type InMemoryProducerChatSeed,
} from "./producerChat";
import { FIXED_NOW, makeTestSongModel } from "./producerIntelligence/testSongModel";
import { extractUserIntentSync } from "./producerIntelligence/intentExtraction";
import {
  applyReferenceScopes,
  describeReferenceContributions,
  explainReferenceComparison,
  intakeReferencesFromRows,
  isReferenceClosenessQuestion,
  namedReferenceRecord,
  normalizeScopes,
  parseReferenceScopes,
  referenceForClosenessQuestion,
  referenceInputProblem,
  referenceKnowledge,
  referenceRowsToCreate,
  referenceScopeAnswers,
  scopesAspect,
  type ReferenceTrackRecord,
} from "./referenceIntelligence";
import { assertContentFree, compareFingerprints, deriveStyleFingerprint } from "./styleFingerprint";

const PROJECT = "project-1";
const OWNER = "owner-1";
const REFERENCE_SOURCE = "src-ref";

function clock(start = FIXED_NOW) {
  let t = start.getTime();
  return () => new Date((t += 1_000));
}
function ids() {
  let n = 0;
  return () => `id-${String(++n).padStart(3, "0")}`;
}

/** 16 bars of swung eighths at 120 BPM: a reference that measurably swings (ratio ≈ 0.66). */
function swungMelody(): SongModelData["melody"] {
  const out: SongModelData["melody"] = [];
  for (let i = 0; i < 16 * 8; i += 1) {
    const beat = Math.floor(i / 2);
    const start = (beat + (i % 2 ? 0.66 : 0)) * 0.5;
    out.push({ start, end: start + 0.2, pitch: 67 + [0, 2, 4, 5, 4, 2, 0, -1][i % 8], velocity: 90, confidence: 1, source: "test" });
  }
  return out;
}
const swungReferenceModel = (): SongModelData => makeTestSongModel({ melody: swungMelody() });

function track(id: string, role: string, instrument: string, notes: MusicalNote[]): TrackModel {
  return {
    id, instrument, role, instrumentDefinition: getInstrumentDefinition(instrument, role), notes,
    cc: [], articulations: [], automation: [], source: "TEST", version: 1,
    provenance: { model: "TEST", version: "1.0.0", parameters: {}, parentIds: [], createdBy: "test" },
  };
}
function straightEighths(pitch: (i: number) => number, duration = 0.2): MusicalNote[] {
  return Array.from({ length: 64 }, (_, i) => ({ id: `n${i}`, start: i * 0.25, duration, pitch: pitch(i), velocity: 90 }));
}
const straightArrangement = () => ({
  id: "arr-1", version: 1, bpm: 120, meter: "4/4", songModel: null,
  trackModels: [
    track("lead", "LEAD", "flute", straightEighths((i) => 67 + [0, 2, 4, 5, 4, 2, 0, -1][i % 8])),
    track("bass", "BASS", "Electric Bass", straightEighths((i) => 40 + (i % 4 === 0 ? 0 : 7), 0.4)),
  ],
});

function setup(extra: Partial<InMemoryProducerChatSeed> = {}) {
  const store = createInMemoryProducerChatStore({
    songModel: { version: 1, model: makeTestSongModel() },
    projectSources: [
      { id: REFERENCE_SOURCE, projectId: "my-demo-project", ownerId: OWNER, name: "my-demo.wav", status: "ready" },
      { id: "src-pending", projectId: "my-demo-project", ownerId: OWNER, name: "still-analysing.wav", status: "analyzing" },
      { id: "src-theirs", projectId: "someone-elses", ownerId: "owner-2", name: "not-mine.wav", status: "ready" },
    ],
    sourceSongModels: { [REFERENCE_SOURCE]: { version: 2, model: swungReferenceModel(), bpm: 120, meter: "4/4" } },
    ...extra,
  });
  const service = createProducerChatService(store, { now: clock(), newId: ids() });
  return { store, service };
}

const rejects = (promise: Promise<unknown>, status: number, pattern?: RegExp) =>
  assert.rejects(promise, (e: unknown) => e instanceof ProducerChatError && e.status === status && (!pattern || pattern.test(e.message)));

// ---------------------------------------------------------------------------
// Pure pieces
// ---------------------------------------------------------------------------

test("scopes: only the scope words are read out of an aspect, in canonical order; nothing is guessed from an instrument", () => {
  assert.deepEqual(parseReferenceScopes("groove"), ["groove"]);
  assert.deepEqual(parseReferenceScopes("the mood and the groove"), ["groove", "mood"]);
  assert.deepEqual(parseReferenceScopes("הגרוב"), ["groove"]);
  assert.deepEqual(parseReferenceScopes("הסאונד"), ["sound"]);
  assert.deepEqual(parseReferenceScopes("vibe"), ["mood"]);
  assert.deepEqual(parseReferenceScopes("the drums"), [], "an instrument is not a scope: nothing is invented");
  assert.deepEqual(parseReferenceScopes(undefined), []);
  assert.deepEqual(normalizeScopes(["mood", "groove", "mood", "loudness"]), ["groove", "mood"]);
  assert.equal(scopesAspect(["mood", "groove"]), "groove, mood");
});

test("rights are recorded, not assumed: an uploaded reference needs its source and a rights note; a named one carries no upload", () => {
  assert.equal(referenceInputProblem({ kind: "named", label: "Yosef Karduner" }), null);
  assert.match(referenceInputProblem({ kind: "named", label: "  " })!, /needs a label/);
  assert.match(referenceInputProblem({ kind: "uploaded_audio", label: "my demo", sourceId: "s" })!, /rights note/);
  assert.match(referenceInputProblem({ kind: "uploaded_audio", label: "my demo", rightsNote: "my own demo" })!, /sourceId/);
  assert.equal(referenceInputProblem({ kind: "uploaded_audio", label: "my demo", sourceId: "s", rightsNote: "my own demo" }), null);
  assert.match(referenceInputProblem({ kind: "named", label: "x", sourceId: "s" })!, /named reference carries no upload/);
  assert.match(referenceInputProblem({ kind: "named", label: "x", allowedScopes: ["lyrics"] })!, /groove \/ sound \/ arrangement \/ mood/);
});

test("rows ↔ intent: a stored scope becomes the reference's aspect; new references get named rows once, never twice", () => {
  const intent = extractUserIntentSync("a ballad like Yosef Karduner, and the groove of \"Shwekey Live\"", { now: FIXED_NOW });
  assert.equal(intent.references.length, 2);
  const karduner = intent.references.find((r) => /karduner/i.test(r.label))!;
  const shwekey = intent.references.find((r) => /shwekey/i.test(r.label))!;
  assert.equal(karduner.aspect, undefined);
  const ctx = { projectId: PROJECT, now: FIXED_NOW, newId: ids() };
  const rows = referenceRowsToCreate(intent.references, [], ctx);
  assert.equal(rows.length, 2);
  assert.ok(rows.every((r) => r.kind === "named" && r.fingerprintId === null && r.sourceId === null), "named: no audio, no fingerprint");
  assert.deepEqual(referenceRowsToCreate(intent.references, rows, ctx), [], "already known: no duplicate row");
  const shwekeyRow = rows.find((r) => /shwekey/i.test(r.label))!;
  assert.deepEqual(shwekeyRow.allowedScopes, parseReferenceScopes(shwekey.aspect), "a stated scope word seeds the row's scopes");

  const scoped: ReferenceTrackRecord = { ...rows.find((r) => /karduner/i.test(r.label))!, allowedScopes: ["mood", "groove"] };
  const applied = applyReferenceScopes(intent, [scoped]);
  assert.equal(applied.references.find((r) => r.id === karduner.id)!.aspect, "groove, mood");
  assert.equal(applied.references.find((r) => r.id === shwekey.id)!.aspect, shwekey.aspect, "a reference without stored scopes keeps the aspect the user said");
  assert.deepEqual(intakeReferencesFromRows([scoped, shwekeyRow]).map((r) => r.aspect), ["groove, mood", undefined].map((a) => a));
});

test("the reference_aspect answers of one call are a multi-select; unknown options and other questions are ignored", () => {
  const intent = extractUserIntentSync("something like Yosef Karduner", { now: FIXED_NOW });
  const ref = intent.references[0];
  const question = { id: `reference_aspect_${ref.id}`, options: [{ id: "aspect_groove" }, { id: "aspect_mood" }] } as never;
  const answers = referenceScopeAnswers([question], [
    { questionId: `reference_aspect_${ref.id}`, optionId: "aspect_mood" },
    { questionId: `reference_aspect_${ref.id}`, optionId: "aspect_groove" },
    { questionId: `reference_aspect_${ref.id}`, optionId: "aspect_lyrics" },
    { questionId: "world_of_tradition", optionId: "era_band" },
    { questionId: "reference_aspect_ref-99", optionId: "aspect_sound" },
  ], intent);
  assert.equal(answers.length, 1);
  assert.equal(answers[0].label, ref.label);
  assert.deepEqual(answers[0].scopes, ["groove", "mood"]);
});

test("referenceKnowledge: only allowed scopes contribute, as inferred with reference:<fp> refs; sound contributes nothing; a stated implication withholds", () => {
  const fingerprint = deriveStyleFingerprint({ source: { kind: "reference_upload", id: REFERENCE_SOURCE, version: 2 }, songModel: swungReferenceModel(), now: FIXED_NOW });
  assert.doesNotThrow(() => assertContentFree(fingerprint));
  const row = (scopes: ReferenceTrackRecord["allowedScopes"]): ReferenceTrackRecord => ({
    ...namedReferenceRecord({ kind: "song", label: "my demo" }, { projectId: PROJECT, now: FIXED_NOW, newId: () => "ref-row" }),
    kind: "uploaded_audio", sourceId: REFERENCE_SOURCE, fingerprintId: "fp-1", songModelVersion: 2, allowedScopes: scopes,
  });
  const fps = new Map([["fp-1", fingerprint]]);
  const plain = extractUserIntentSync("a song for the wedding video", { now: FIXED_NOW });

  const groove = referenceKnowledge([row(["groove"])], fps, plain);
  assert.deepEqual(groove.sources.map((s) => s.id), ["reference:fp-1"]);
  const findings = groove.sources[0].lookup({ intent: plain, terms: [] });
  assert.ok(findings.some((f) => f.dimension === "swingRatio" && Number(f.value) >= 0.62), `swing offered: ${JSON.stringify(findings.map((f) => [f.dimension, f.value]))}`);
  assert.ok(findings.every((f) => f.provenance === "inferred" && f.sourceRefs.includes("reference:fp-1") && f.confidence < 0.9));
  assert.equal(findings.some((f) => f.dimension === "harmonicRhythm"), false, "arrangement scope not allowed");
  assert.deepEqual(groove.contributions[0].withheld, []);

  assert.deepEqual(referenceKnowledge([row(["sound"])], fps, plain).sources[0].lookup({ intent: plain, terms: [] }), [], "no audio features yet: sound offers nothing");
  assert.deepEqual(referenceKnowledge([row([])], fps, plain).sources, [], "no allowed scope: not even listed as a source");
  assert.deepEqual(referenceKnowledge([{ ...row(["groove"]), fingerprintId: null }], fps, plain).sources, [], "no fingerprint: nothing");

  // "slow" is the user's word; the vocabulary implies tempoBehavior=slow from
  // it, and the fingerprint's strict_grid must not outrank that.
  const slow = extractUserIntentSync("a slow song", { now: FIXED_NOW });
  const guarded = referenceKnowledge([row(["groove"])], fps, slow);
  const offered = guarded.sources[0].lookup({ intent: slow, terms: [] });
  assert.equal(offered.some((f) => f.dimension === "tempoBehavior"), false);
  assert.ok(guarded.contributions[0].withheld.some((w) => w.dimension === "tempoBehavior" && /what the user said/.test(w.reason)));
  assert.match(describeReferenceContributions(guarded.contributions)!, /From your reference "my demo" \(groove allowed\): .*withheld tempo behavior/);
});

test("closeness questions are recognised and explained in producer words, reference on the left", () => {
  const rows: ReferenceTrackRecord[] = [{ ...namedReferenceRecord({ kind: "song", label: "My Demo" }, { projectId: PROJECT, now: FIXED_NOW, newId: () => "r1" }), fingerprintId: "fp-1" }];
  assert.ok(isReferenceClosenessQuestion("how close is this to my reference?", rows));
  assert.ok(isReferenceClosenessQuestion("כמה זה קרוב לרפרנס?", rows));
  assert.ok(isReferenceClosenessQuestion("does it resemble my demo?", rows), "the label itself names the reference");
  assert.equal(isReferenceClosenessQuestion("why is there a clarinet here?", rows), false);
  assert.equal(referenceForClosenessQuestion("how close is this to my reference?", rows)?.id, "r1");
  assert.equal(referenceForClosenessQuestion("how close is this to my reference?", [...rows, { ...rows[0], id: "r2", label: "Other" }]), null, "two fingerprinted references and no name: ambiguous");

  const straight = deriveStyleFingerprint({ source: { kind: "arrangement", id: "arr-1", version: 1 }, trackModels: straightArrangement().trackModels, now: FIXED_NOW });
  const swung = deriveStyleFingerprint({ source: { kind: "reference_upload", id: REFERENCE_SOURCE, version: 2 }, songModel: swungReferenceModel(), now: FIXED_NOW });
  const explanation = explainReferenceComparison(rows[0], "arr-1", compareFingerprints(swung, straight, { leftId: "fp-1", rightId: "fp-2" }));
  assert.equal(explanation.answered, true);
  assert.match(explanation.answer, /Against "My Demo" this arrangement \(arr-1\) sits at distance 0\.\d+/);
  assert.doesNotMatch(explanation.answer, /the left|the right/);
  assert.ok(explanation.evidence.length > 0 && explanation.evidence.every((e) => e.source === "reference.fingerprint"));
  const swing = explanation.evidence.find((e) => e.ref === "groove.swingRatio");
  assert.ok(swing && /the reference swings harder/.test(swing.detail), `swing evidence in producer words: ${JSON.stringify(swing)}`);
});

// ---------------------------------------------------------------------------
// Through the producer service
// ---------------------------------------------------------------------------

test("a named reference from the intake is a durable label: no audio, no fingerprint, and the reference_aspect question until answered", async () => {
  const { store, service } = setup();
  const intake = await service.intake(PROJECT, { text: "a ballad like Yosef Karduner" });
  assert.equal(store.references.length, 1);
  const row = store.references[0];
  assert.equal(row.kind, "named");
  assert.equal(row.fingerprintId, null);
  assert.equal(row.sourceId, null);
  assert.deepEqual(row.allowedScopes, []);
  assert.match(row.label, /Yosef Karduner/);
  assert.equal(intake.state.references.length, 1);
  assert.deepEqual(intake.state.references[0].contributes, []);
  assert.equal(intake.state.styleProfile.sources.some((s) => s.startsWith("reference:")), false, "a label lends the profile nothing");

  const question = intake.state.clarifications.find((q) => q.id.startsWith("reference_aspect_"));
  assert.ok(question, `asked what to take from it: ${intake.state.clarifications.map((q) => q.id).join(", ")}`);
  assert.deepEqual(question!.options.map((o) => o.id), ["aspect_groove", "aspect_sound", "aspect_arrangement", "aspect_mood"]);

  // Multi-select through repeated answers: groove and mood.
  const answered = await service.answer(PROJECT, { answers: [{ questionId: question!.id, answerId: "aspect_groove" }, { questionId: question!.id, answerId: "aspect_mood" }] });
  assert.equal(answered.state.version, 2);
  assert.deepEqual(store.references[0].allowedScopes, ["groove", "mood"]);
  assert.equal(answered.state.clarifications.some((q) => q.id === question!.id), false, "answered: the question is gone");
  assert.equal(answered.state.intent.references[0].aspect, "groove, mood", "the scope rides on the intent");
  assert.ok(answered.state.brief.producerDecisions.some((d) => d.topic === "reference" && /\(groove, mood\)$/.test(d.statement)), "the brief records it");
  assert.match(answered.reply, /only groove and mood may be copied/);
  assert.match(answered.reply, /named reference lends nothing until one of your own recordings is attached/);
  assert.equal(store.turns.at(-1)?.structured?.referenceIds?.[0], store.references[0].id);
  await rejects(service.answer(PROJECT, { answers: [{ questionId: question!.id, answerId: "aspect_sound" }] }), 400);

  // The same label named again is not a second row; a reference the user
  // deleted does not come back on the next turn.
  await service.chat(PROJECT, { text: "still like Yosef Karduner, but warmer" });
  assert.equal(store.references.length, 1);
  await service.removeReference(PROJECT, row.id);
  await service.chat(PROJECT, { text: "and a little more intimate" });
  assert.equal(store.references.length, 0, "deleted stays deleted; the words stay a label in the intake");
});

test("an uploaded reference needs a rights note and one of the owner's own uploads; it is fingerprinted from the same analysis and lends only its allowed scopes", async () => {
  const { store, service } = setup();
  const intake = await service.intake(PROJECT, { text: "a song for the wedding video" });
  assert.equal(intake.state.styleProfile.dimensions.swingRatio, undefined);

  await rejects(service.addReference(PROJECT, { kind: "uploaded_audio", label: "my demo", sourceId: REFERENCE_SOURCE, ownerId: OWNER }), 400, /rights note/);
  await rejects(service.addReference(PROJECT, { kind: "uploaded_audio", label: "not mine", sourceId: "src-theirs", rightsNote: "found it online", ownerId: OWNER }), 404, /Upload not found/);
  await rejects(service.addReference(PROJECT, { kind: "uploaded_audio", label: "ghost", sourceId: "src-none", rightsNote: "x", ownerId: OWNER }), 404);

  const added = await service.addReference(PROJECT, { kind: "uploaded_audio", label: "my demo", sourceId: REFERENCE_SOURCE, rightsNote: "my own demo, recorded at home", allowedScopes: ["groove"], ownerId: OWNER });
  const row = added.reference!;
  assert.equal(row.kind, "uploaded_audio");
  assert.equal(row.rightsNote, "my own demo, recorded at home");
  assert.equal(row.songModelVersion, 2, "the upload's own Song Model version");
  assert.ok(row.fingerprintId, "analysed already: fingerprinted at once");
  assert.equal(added.fingerprint?.fingerprint.source.kind, "reference_upload");
  assert.equal(added.fingerprint?.fingerprint.source.id, REFERENCE_SOURCE);
  assert.doesNotThrow(() => assertContentFree(added.fingerprint!.fingerprint));
  assert.equal(JSON.stringify(store.fingerprints.get(row.fingerprintId!)).includes("\"melody\""), false, "the store holds statistics, never the notes");

  // The brief was recompiled with the reference's groove — as inferred, cited.
  assert.equal(added.turn?.kind, "reference");
  assert.equal(added.turn?.state.version, 2);
  const profile = added.turn!.state.styleProfile;
  assert.ok(profile.sources.includes(`reference:${row.fingerprintId}`), `sources: ${profile.sources.join(", ")}`);
  assert.ok(profile.dimensions.swingRatio && Number(profile.dimensions.swingRatio.value) >= 0.62, "the swing came from the reference");
  assert.equal(profile.dimensions.swingRatio!.provenance, "inferred");
  assert.deepEqual(profile.dimensions.swingRatio!.sourceRefs, [`reference:${row.fingerprintId}`]);
  assert.equal(profile.dimensions.harmonicRhythm, undefined, "arrangement scope not allowed: nothing from harmony");
  const summary = added.turn!.state.references.find((r) => r.id === row.id)!;
  assert.ok(summary.contributes.includes("swingRatio"));
  assert.match(added.turn!.reply, /From your reference "my demo" \(groove allowed\)/);
  assert.match(added.turn!.reply, /marked inferred in the brief, below anything you said/);
  const decision = added.turn!.state.brief.dimensionDecisions.find((d) => d.dimension === "swingRatio")!;
  assert.equal(decision.provenance, "inferred");
  assert.match(decision.rationale, /reference:/);

  // Widening the scope to arrangement recompiles and adds harmony; sound adds nothing.
  const widened = await service.updateReference(PROJECT, row.id, { allowedScopes: ["groove", "arrangement", "sound"] });
  assert.equal(widened.turn?.state.version, 3);
  assert.ok(widened.turn!.state.styleProfile.dimensions.harmonicRhythm?.sourceRefs?.includes(`reference:${row.fingerprintId}`));
  // A Song Model fingerprint knows only lead + bass families: no hierarchy is
  // invented from that (the live run caught an empty list winning the dimension).
  assert.equal(widened.turn!.state.styleProfile.dimensions.instrumentationHierarchy, undefined, "no empty instrumentation hierarchy is offered");
  for (const dim of Object.values(widened.turn!.state.styleProfile.dimensions)) {
    assert.ok(!Array.isArray(dim.value) || dim.value.length > 0, "no dimension carries an empty list");
  }
  const soundOnly = await service.updateReference(PROJECT, row.id, { allowedScopes: ["sound"] });
  assert.equal(soundOnly.turn?.state.version, 4);
  assert.equal(soundOnly.turn!.state.styleProfile.dimensions.swingRatio, undefined, "sound is allowed but the symbolic fingerprint has nothing for it");
  assert.equal(soundOnly.turn!.state.styleProfile.sources.some((s) => s.startsWith("reference:")), true, "consulted, nothing to offer");
  assert.deepEqual(soundOnly.turn!.state.references[0].contributes, []);

  // A rights-note-only change is recorded and recompiles nothing.
  const noted = await service.updateReference(PROJECT, row.id, { rightsNote: "my own demo (2024 session)" });
  assert.equal(noted.turn, undefined);
  assert.equal(noted.reference?.rightsNote, "my own demo (2024 session)");
  await rejects(service.updateReference(PROJECT, row.id, { rightsNote: null }), 400, /keeps a rights note/);
  await rejects(service.updateReference(PROJECT, "nope", { label: "x" }), 404);
});

test("a stated value beats the reference, and so does a researched one; the reference is withheld or outranked, never silently applied", async () => {
  const { service } = setup();
  await service.intake(PROJECT, { text: "a slow modern hasidic ballad" });
  const added = await service.addReference(PROJECT, { kind: "uploaded_audio", label: "my demo", sourceId: REFERENCE_SOURCE, rightsNote: "my own demo", allowedScopes: ["groove", "arrangement"], ownerId: OWNER });
  const state = added.turn!.state;
  const tempo = state.brief.dimensionDecisions.find((d) => d.dimension === "tempoBehavior")!;
  assert.equal(tempo.styleValue, "slow", "the user said slow");
  const tempoRefs = state.styleProfile.dimensions.tempoBehavior!.sourceRefs ?? [];
  assert.ok(tempoRefs.some((r) => r.startsWith("vocab:") || r.startsWith("text:")), `decided by the user's own word: ${tempoRefs.join(", ")}`);
  assert.equal(tempoRefs.some((r) => r.startsWith("reference:")), false);
  const summary = state.references[0];
  assert.ok(summary.withheld.some((w) => w.dimension === "tempoBehavior" && String(w.value) !== "slow"), `withheld: ${JSON.stringify(summary.withheld)}`);
  assert.equal(summary.contributes.includes("tempoBehavior"), false);
  const harmonic = state.brief.dimensionDecisions.find((d) => d.dimension === "harmonicRhythm")!;
  assert.equal(harmonic.provenance, "researched", "research (0.85, researched) outranks the reference's inferred 0.6");
  assert.equal(harmonic.styleValue, "slow");
  assert.equal(state.styleProfile.dimensions.harmonicRhythm!.sourceRefs!.some((r) => r.startsWith("reference:")), false, "the reference disagreed (moderate): not even a corroborating cite");
  assert.ok(state.styleProfile.conflicts.some((c) => c.dimension === "harmonicRhythm"), "the disagreement is recorded");
  assert.ok(state.styleProfile.dimensions.swingRatio?.sourceRefs?.some((r) => r.startsWith("reference:")), "what nobody else decided, the reference may lend");
});

test("an upload that is not analysed yet waits for its fingerprint; the explicit step takes it once the Song Model exists; a named reference has nothing to fingerprint", async () => {
  const seed: Partial<InMemoryProducerChatSeed> = { sourceSongModels: {} };
  const { store, service } = setup(seed);
  await service.intake(PROJECT, { text: "a song" });
  const added = await service.addReference(PROJECT, { kind: "uploaded_audio", label: "my demo", sourceId: "src-pending", rightsNote: "my own demo", allowedScopes: ["groove"], ownerId: OWNER });
  assert.equal(added.reference?.fingerprintId, null);
  assert.equal(added.fingerprint, undefined);
  assert.match(added.turn!.reply, /not analysed yet/);
  assert.equal(added.turn!.state.styleProfile.sources.some((s) => s.startsWith("reference:")), false);
  await rejects(service.fingerprintReference(PROJECT, added.reference!.id), 409, /not analysed yet/);

  // The analysis completes (the hook or the button does this).
  seed.sourceSongModels!["src-pending"] = { version: 1, model: swungReferenceModel() };
  const taken = await service.fingerprintReference(PROJECT, added.reference!.id);
  assert.ok(taken.reference?.fingerprintId);
  assert.equal(taken.reference?.songModelVersion, 1);
  assert.equal(taken.turn?.kind, "reference");
  assert.ok(taken.turn!.state.styleProfile.dimensions.swingRatio?.sourceRefs?.includes(`reference:${taken.reference!.fingerprintId}`));
  const again = await service.fingerprintReference(PROJECT, added.reference!.id);
  assert.equal(again.reference?.fingerprintId, taken.reference?.fingerprintId, "idempotent");
  assert.equal(again.turn, undefined, "nothing changed: no new version");

  const named = await service.addReference(PROJECT, { kind: "named", label: "Yosef Karduner", allowedScopes: ["mood"], ownerId: OWNER });
  assert.equal(named.reference?.kind, "named");
  await rejects(service.fingerprintReference(PROJECT, named.reference!.id), 409, /named reference/);
  await rejects(service.compareReference(PROJECT, named.reference!.id), 409, /no fingerprint yet/);
  await rejects(service.addReference(PROJECT, { kind: "named", label: "yosef karduner", ownerId: OWNER }), 409, /already/);
  assert.equal(store.references.length, 2);

  // Attaching an upload to that label upgrades the named row instead of duplicating it.
  const upgraded = await service.addReference(PROJECT, { kind: "uploaded_audio", label: "Yosef Karduner", sourceId: REFERENCE_SOURCE, rightsNote: "my own cover of it", ownerId: OWNER });
  assert.equal(upgraded.reference?.id, named.reference?.id);
  assert.equal(upgraded.reference?.kind, "uploaded_audio");
  assert.deepEqual(upgraded.reference?.allowedScopes, ["mood"], "the scope the user set stays");
  assert.equal(store.references.length, 2);
});

test("deleting a reference removes the row and its fingerprint, recompiles without it, and never touches the upload", async () => {
  const { store, service } = setup();
  await service.intake(PROJECT, { text: "a song" });
  const added = await service.addReference(PROJECT, { kind: "uploaded_audio", label: "my demo", sourceId: REFERENCE_SOURCE, rightsNote: "my own demo", allowedScopes: ["groove"], ownerId: OWNER });
  const fingerprintId = added.reference!.fingerprintId!;
  assert.ok(store.fingerprints.has(fingerprintId));
  assert.ok(added.turn!.state.styleProfile.dimensions.swingRatio);

  const removed = await service.removeReference(PROJECT, added.reference!.id);
  assert.equal(removed.reference, null);
  assert.deepEqual(removed.references, []);
  assert.equal(store.references.length, 0);
  assert.equal(store.fingerprints.has(fingerprintId), false, "the fingerprint was the only thing learned from it; it goes too");
  assert.ok(store.projectSources.some((s) => s.id === REFERENCE_SOURCE), "the upload is untouched");
  assert.equal(removed.turn?.state.version, 3);
  assert.equal(removed.turn!.state.styleProfile.dimensions.swingRatio, undefined, "recompiled without the reference");
  assert.equal(removed.turn!.state.styleProfile.sources.some((s) => s.startsWith("reference:")), false);
  assert.match(removed.turn!.reply, /removed together with its fingerprint; your upload, if any, is untouched/);
  await rejects(service.removeReference(PROJECT, added.reference!.id), 404);
});

test("\"how close is this to my reference?\" is answered from the fingerprint comparison — and honestly refused when there is nothing to compare", async () => {
  const { service } = setup({ arrangement: straightArrangement() });
  await service.intake(PROJECT, { text: "a song" });
  const none = await service.chat(PROJECT, { text: "how close is this to my reference?" });
  assert.equal(none.kind, "explanation");
  assert.equal(none.explanation?.answered, false);
  assert.match(none.explanation!.answer, /no reference on this project yet/);

  const named = await service.addReference(PROJECT, { kind: "named", label: "Yosef Karduner", ownerId: OWNER });
  const label = await service.chat(PROJECT, { text: "how close is this to my reference?" });
  assert.equal(label.explanation?.answered, false);
  assert.match(label.explanation!.answer, /named reference has no audio to compare/);
  await service.removeReference(PROJECT, named.reference!.id);

  const added = await service.addReference(PROJECT, { kind: "uploaded_audio", label: "my demo", sourceId: REFERENCE_SOURCE, rightsNote: "my own demo", allowedScopes: ["groove"], ownerId: OWNER });
  const close = await service.chat(PROJECT, { text: "how close is this to my reference?" });
  assert.equal(close.kind, "explanation");
  assert.equal(close.explanation?.answered, true);
  assert.match(close.explanation!.answer, /Against "my demo" this arrangement \(arr-1\) sits at distance 0\.\d+/);
  assert.doesNotMatch(close.explanation!.answer, /the left|the right/);
  assert.ok(close.explanation!.evidence.every((e) => e.source === "reference.fingerprint"));
  assert.ok(close.explanation!.evidence.some((e) => e.ref === "groove.swingRatio" && /the reference swings harder/.test(e.detail)), "the swing difference is among the evidence, in producer words");
  assert.equal(close.state.version, added.turn!.state.version, "a question changes no state");

  const direct = await service.compareReference(PROJECT, added.reference!.id);
  assert.equal(direct.arrangementId, "arr-1");
  assert.equal(direct.comparison.leftId, added.reference!.fingerprintId);
  assert.equal(direct.comparison.rightId, direct.arrangementFingerprintId);
  assert.ok(direct.comparison.distance > 0.05);
  await rejects(service.compareReference(PROJECT, added.reference!.id, "arr-404"), 409, /no persisted TrackModels/);

  const { service: bare } = setup();
  await bare.intake(PROJECT, { text: "a song" });
  await bare.addReference(PROJECT, { kind: "uploaded_audio", label: "my demo", sourceId: REFERENCE_SOURCE, rightsNote: "my own demo", ownerId: OWNER });
  const noArrangement = await bare.chat(PROJECT, { text: "how close is this to my reference?" });
  assert.equal(noArrangement.explanation?.answered, false);
  assert.match(noArrangement.explanation!.answer, /No arrangement with persisted TrackModels/);
});

test("references given to the intake API become rows too, and PR-U2's intake without references is unchanged", async () => {
  const { store, service } = setup();
  const outcome = await service.intake(PROJECT, { text: "a warm ballad", references: [{ kind: "artist", label: "Avraham Fried", aspect: "the groove" }] });
  assert.equal(store.references.length, 1);
  assert.deepEqual(store.references[0].allowedScopes, ["groove"], "a stated scope word seeds the scope");
  assert.equal(outcome.state.intent.references[0].aspect, "groove");
  assert.equal(outcome.state.clarifications.some((q) => q.id.startsWith("reference_aspect_")), false, "the aspect was said: no question");
  assert.equal((await service.references(PROJECT)).length, 1);

  const { store: plain, service: plainService } = setup();
  const noRefs = await plainService.intake(PROJECT, { text: "a warm ballad" });
  assert.equal(plain.references.length, 0);
  assert.deepEqual(noRefs.state.references, []);
  assert.equal(noRefs.state.styleProfile.sources.some((s) => s.startsWith("reference:")), false);
});
