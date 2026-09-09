import assert from "node:assert/strict";
import test from "node:test";
import type { ArrangementPlan, ProductionBrief } from "@workspace/db";
import { BENCHMARK_CORPUS, buildBenchmarkSongModel } from "./benchmarkCorpus";
import { deriveGlobalArrangementPlan } from "./globalArrangementPlanner";
import { deriveOrchestrationBudget } from "./orchestrationBudget";
import { deriveSectionPhrasePlan } from "./sectionPhrasePlanner";
import { deriveTransitionPlan } from "./transitionEngine";
import {
  ProducerChatError,
  classifyChatTurn,
  createInMemoryProducerChatStore,
  createProducerChatService,
  decisionsProducedBy,
  standingRuleDeltas,
} from "./producerChat";
import { activeDecisions } from "./producerIntelligence/briefCompiler";
import { extractUserIntentSync } from "./producerIntelligence/intentExtraction";
import { interpretEditRequest } from "./producerIntelligence/editPlan";
import { FIXED_NOW, makeTestSongModel } from "./producerIntelligence/testSongModel";
import { describeUnderstanding, intentDelta } from "./producerIntelligence/understanding";

const PROJECT = "project-1";
const HEBREW_INTAKE = "אני רוצה בלדה חסידית מודרנית, אבל לא פופית מדי. בית ראשון כמעט ישיבתי, פסנתר וחליל, פזמון רחב יותר עם מיתרים";

/** A clock that advances one second per call so turn order is deterministic. */
function clock(start = FIXED_NOW) {
  let t = start.getTime();
  return () => new Date((t += 1_000));
}

function ids() {
  let n = 0;
  return () => `id-${String(++n).padStart(3, "0")}`;
}

function setup(seed: Parameters<typeof createInMemoryProducerChatStore>[0] = { songModel: { version: 1, model: makeTestSongModel() } }) {
  const store = createInMemoryProducerChatStore(seed);
  const service = createProducerChatService(store, { now: clock(), newId: ids() });
  return { store, service };
}

/** A real plan from a benchmark song model, as an arrangement would store it. */
function benchmarkPlan(caseId = "pop-full"): { model: ReturnType<typeof buildBenchmarkSongModel>; plan: ArrangementPlan } {
  const spec = BENCHMARK_CORPUS.find((c) => c.id === caseId)!;
  const model = buildBenchmarkSongModel(spec);
  const globalPlan = deriveGlobalArrangementPlan(model, { now: FIXED_NOW });
  const sectionPlan = deriveSectionPhrasePlan(model, globalPlan, { now: FIXED_NOW });
  const orchestrationBudget = deriveOrchestrationBudget(model, sectionPlan, { now: FIXED_NOW });
  const transitionPlan = deriveTransitionPlan(model, globalPlan, sectionPlan, { now: FIXED_NOW });
  const plan = {
    id: "plan-1", version: 1, sections: [], style: {} as ArrangementPlan["style"], songModelVersion: 1, parameters: {},
    provenance: {} as ArrangementPlan["provenance"], hierarchy: {} as ArrangementPlan["hierarchy"],
    globalPlan, sectionPlan, orchestrationBudget, transitionPlan,
  } as unknown as ArrangementPlan;
  return { model, plan };
}

// ---------------------------------------------------------------------------

test("intake persists brief v1 and both turns, and replies with a reading the user can check", async () => {
  const { store, service } = setup();
  const outcome = await service.intake(PROJECT, { text: HEBREW_INTAKE });

  assert.equal(outcome.kind, "intake");
  assert.equal(store.briefs.length, 1);
  assert.equal(store.briefs[0].version, 1);
  assert.equal(store.briefs[0].projectId, PROJECT);
  assert.equal(store.briefs[0].intent.language, "he");
  assert.equal(store.briefs[0].intent.rawText, HEBREW_INTAKE);
  assert.equal(store.briefs[0].brief.inputsDigestSha256, store.briefs[0].inputsDigestSha256);

  assert.equal(store.turns.length, 2);
  const [user, producer] = store.turns;
  assert.equal(user.role, "user");
  assert.equal(user.text, HEBREW_INTAKE);
  assert.equal(user.id, outcome.turnId);
  assert.equal(producer.role, "producer");
  assert.equal(producer.id, outcome.producerTurnId);
  assert.equal(producer.text, outcome.reply);
  assert.equal(producer.briefId, store.briefs[0].id);
  assert.equal(producer.structured?.kind, "intake");
  assert.equal(producer.structured?.briefVersion, 1);
  assert.equal(producer.structured?.intentMethod, "intent-extraction/v1", "no model configured: the deterministic extractor");
  assert.ok(producer.createdAt > user.createdAt, "the producer's turn sorts after the user's");

  // What was read, in the brief the planners will use.
  const brief = outcome.state.brief;
  assert.equal(outcome.state.version, 1);
  assert.equal(outcome.state.styleProfile.dimensions.tradition?.value, "hasidic");
  assert.equal(outcome.state.styleProfile.dimensions.genre?.value, "ballad");
  assert.ok(brief.producerDecisions.some((d) => d.topic === "style_dimension" && /no pop/.test(d.statement)), "'לא פופית מדי' is a boundary, not a style");
  assert.ok(outcome.state.styleProfile.exclusions.some((x) => x.value === "pop"), "pop is an exclusion of the profile");
  const chorus = brief.sectionIntentions.find((s) => s.sectionName === "Chorus");
  assert.ok(chorus?.instrumentation?.add.includes("strings"), "strings are asked for in the chorus");
  assert.ok(brief.instrumentation.hierarchy.some((h) => h.family === "keys"), "piano → keys");
  assert.ok(brief.instrumentation.hierarchy.some((h) => h.family === "winds"), "חליל → winds");

  // The reply quotes the user's own words and lists nothing that was not said.
  assert.match(outcome.reply, /hasidic ballad/);
  assert.match(outcome.reply, /לא פופית מדי/);
  assert.match(outcome.reply, /Chorus/);
  assert.doesNotMatch(outcome.reply, /clarinet|jazz|1980s/);
  assert.equal(outcome.state.concepts.concepts.length, 3);
  assert.equal(outcome.state.planSource, "derived");
  assert.equal(outcome.state.songModelVersion, 1);

  // PR-U3: the named world was researched (seed corpus, no model), each
  // researched value carries provenance + sourceRefs and ranks below what
  // was said; the doubts became at most two questions, in Hebrew.
  const profile = outcome.state.styleProfile;
  assert.deepEqual(profile.sources, ["universal-vocabulary/v1", "curated-world-notes/v1"]);
  assert.deepEqual(profile.research?.providers, ["curated-world-notes/v1"]);
  const researched = brief.dimensionDecisions.filter((d) => d.provenance === "researched");
  assert.ok(researched.length >= 5, `researched decisions: ${researched.map((d) => d.dimension).join(", ")}`);
  for (const d of researched) {
    assert.ok(profile.dimensions[d.dimension]?.sourceRefs?.some((r) => r.startsWith("research:curated-world-notes/v1/")), `${d.dimension} cites its research source`);
    assert.match(d.rationale, /from the style profile \(researched/);
  }
  assert.equal(profile.dimensions.instrumentationHierarchy?.provenance, "stated", "piano + flute were named: research does not reorder them");
  assert.ok(profile.research!.discarded.some((d) => d.dimension === "instrumentationHierarchy"));
  assert.ok(outcome.state.clarifications.length >= 1 && outcome.state.clarifications.length <= 2);
  assert.ok(outcome.state.clarifications.every((q) => q.id.startsWith("research_") && q.questionHe));
  assert.match(outcome.reply, /From what is known of hasidic, ballad, modern \(curated-world-notes\/v1\)/);
  assert.match(outcome.reply, /קרעכץ ודריידלעך/, "the Hebrew question uses the tradition's own words");
  assert.match(outcome.reply, /marked researched in the brief, below anything you said/);
});

test("research is optional: with the agent off, the intake is PR-U2's exactly", async () => {
  const store = createInMemoryProducerChatStore({ songModel: { version: 1, model: makeTestSongModel() } });
  const service = createProducerChatService(store, { now: clock(), newId: ids(), researchAgent: null });
  const outcome = await service.intake(PROJECT, { text: HEBREW_INTAKE });
  assert.deepEqual(outcome.state.styleProfile.sources, ["universal-vocabulary/v1"]);
  assert.equal(outcome.state.styleProfile.research, undefined);
  assert.equal(outcome.state.clarifications.length, 0, "a modern, well-specified request needs no question of PR-U1's own");
  assert.doesNotMatch(outcome.reply, /From what is known/);
});

test("answering the world question researches the chosen world in the same version, not one version late", async () => {
  const { service } = setup();
  const intake = await service.intake(PROJECT, { text: "old hasidic" });
  assert.equal(intake.state.brief.dimensionDecisions.some((d) => d.provenance === "researched"), false, "a tradition alone matches no seed note");
  assert.deepEqual(intake.state.clarifications.map((q) => q.id), ["world_of_tradition"]);
  const answered = await service.answer(PROJECT, { answers: [{ questionId: "world_of_tradition", answerId: "communal_vocal" }] });
  assert.equal(answered.state.version, 2);
  assert.ok(answered.state.styleProfile.research?.world.includes("ensembleType=vocal_led_small (settled)"), `world: ${answered.state.styleProfile.research?.world.join(", ")}`);
  const hierarchy = answered.state.brief.dimensionDecisions.find((d) => d.dimension === "instrumentationHierarchy");
  assert.equal(hierarchy?.provenance, "researched");
  assert.deepEqual(hierarchy?.styleValue, ["vocals", "guitar", "keys", "percussion"], "the communal-singing note's conventions, researched in v2");
  assert.equal(answered.state.brief.dimensionDecisions.find((d) => d.dimension === "ensembleType")?.decidedBy, "answer");
  assert.equal(answered.state.brief.dimensionDecisions.find((d) => d.dimension === "roomSize")?.decidedBy, "answer", "the answer's own deltas still decide what they decide");
});

test("answering a research question settles the dimension as an answer and the question closes; the world stays researchable across versions", async () => {
  const { store, service } = setup();
  const intake = await service.intake(PROJECT, { text: "a slow modern hasidic ballad" });
  const question = intake.state.clarifications.find((q) => q.id === "research_melodicOrnamentation");
  assert.ok(question, `the ornamentation doubt is asked: ${intake.state.clarifications.map((q) => q.id).join(",")}`);
  assert.equal(intake.state.brief.dimensionDecisions.some((d) => d.dimension === "melodicOrnamentation"), false, "a doubt never populates the brief");
  const answered = await service.answer(PROJECT, { answers: [{ questionId: question!.id, answerId: question!.options[0].id }] });
  assert.equal(answered.state.version, 2);
  const decision = answered.state.brief.dimensionDecisions.find((d) => d.dimension === "melodicOrnamentation");
  assert.equal(decision?.decidedBy, "answer");
  assert.equal(decision?.styleValue, "moderate");
  assert.equal(answered.state.clarifications.some((q) => q.id === question!.id), false);
  assert.ok(answered.state.brief.dimensionDecisions.some((d) => d.provenance === "researched"), "the researched facts are carried into v2");
  assert.equal(store.briefs[1].styleProfile.research?.providers[0], "curated-world-notes/v1", "the stored profile keeps its research summary");
  await assert.rejects(service.answer(PROJECT, { answers: [{ questionId: question!.id, answerId: question!.options[0].id }] }), (e: unknown) => e instanceof ProducerChatError && e.status === 400);
});

test("English intake asks at most two information-gain questions and only those that change the arrangement", async () => {
  const { service } = setup();
  const outcome = await service.intake(PROJECT, { text: "an old hasidic song, warm and simple, like a Yosef Karduner song" });
  assert.equal(outcome.state.clarifications.length, 2);
  const [first, second] = outcome.state.clarifications;
  assert.equal(first.id, "world_of_tradition", "the biggest gain first");
  assert.ok(first.informationGain >= second.informationGain);
  assert.equal(first.options.length, 3);
  assert.match(outcome.reply, /Two things would change the arrangement materially/);
  assert.match(outcome.reply, /which world do you mean/);
  assert.ok(first.options.every((o) => o.briefDeltas.length > 0), "every option carries concrete brief deltas");
});

test("answering a clarification applies the chosen option's deltas in a new brief version and records both turns", async () => {
  const { store, service } = setup();
  const intake = await service.intake(PROJECT, { text: "חסידי ישן" });
  const question = intake.state.clarifications.find((q) => q.id === "world_of_tradition");
  assert.ok(question, "'חסידי ישן' is the owner's example: one question, three worlds");
  assert.equal(intake.state.brief.dimensionDecisions.some((d) => d.dimension === "ensembleType"), false);

  await assert.rejects(service.answer(PROJECT, { answers: [{ questionId: "no_such_question", answerId: "x" }] }), (e: unknown) => e instanceof ProducerChatError && e.status === 400);
  await assert.rejects(service.answer(PROJECT, { answers: [{ questionId: "world_of_tradition", answerId: "nope" }] }), (e: unknown) => e instanceof ProducerChatError && e.status === 400);

  const answered = await service.answer(PROJECT, { answers: [{ questionId: "world_of_tradition", answerId: "communal_vocal" }] });
  assert.equal(answered.kind, "answers");
  assert.equal(answered.state.version, 2);
  assert.equal(store.briefs.length, 2);
  assert.deepEqual(store.briefs[1].answers, [{ questionId: "world_of_tradition", optionId: "communal_vocal" }]);
  const brief = answered.state.brief;
  assert.deepEqual(brief.answeredQuestionIds, ["world_of_tradition"]);
  // PR-U3: the chosen world is researched in this same version, and the one
  // doubt the seed corpus has about it (ornamentation) is asked next — the
  // two-question budget counts the question just answered.
  assert.deepEqual(brief.openQuestionIds, ["research_melodicOrnamentation"]);
  assert.equal(answered.state.clarifications.length, 1);
  assert.ok(brief.dimensionDecisions.some((d) => d.provenance === "researched" && d.dimension === "tempoBehavior" && d.styleValue === "breathing"), "the communal-singing conventions were researched once the world was settled");
  const ensemble = brief.dimensionDecisions.find((d) => d.dimension === "ensembleType");
  assert.equal(ensemble?.styleValue, "vocal_led_small");
  assert.equal(ensemble?.decidedBy, "answer");
  assert.equal(brief.vocalSpace.underLead, "tight", "the communal world's vocal-space delta applied");
  assert.ok(brief.producerDecisions.some((d) => d.createdBy === "clarification" && d.dimension === "soundAesthetic" && d.value === "raw_intimate"));
  assert.match(answered.reply, /communal singing/);
  assert.match(answered.reply, /v2/);
  assert.equal(store.turns.length, 4);
  assert.equal(store.turns[3].structured?.kind, "answers");
  assert.deepEqual(store.turns[3].structured?.answers, [{ questionId: "world_of_tradition", optionId: "communal_vocal" }]);

  // The same answer again is "already answered".
  await assert.rejects(service.answer(PROJECT, { answers: [{ questionId: "world_of_tradition", answerId: "era_band" }] }), (e: unknown) => e instanceof ProducerChatError && e.status === 400);
});

test("a standing rule becomes a global decision; a scoped phrase becomes a scoped override; both are durable across versions", async () => {
  const { store, service } = setup();
  await service.intake(PROJECT, { text: "a modern hasidic ballad with piano and strings" });

  const rule = await service.chat(PROJECT, { text: "no strings in the whole song" });
  assert.equal(rule.kind, "edit");
  assert.equal(rule.editPlan?.intent, "remove_instrument");
  assert.equal(rule.editPlan?.scope.kind, "global");
  assert.equal(rule.state.version, 2);
  const global = store.decisions.find((r) => r.decision.scope.kind === "global" && r.decision.topic === "instrumentation");
  assert.ok(global, "a durable global decision row exists");
  assert.equal(global!.supersededBy, null);
  assert.equal(global!.delta?.kind, "instrumentation");
  assert.equal(global!.decision.strength, "hard");
  assert.ok(activeDecisions(rule.state.brief).some((d) => d.id === global!.decisionId));
  assert.deepEqual(rule.state.brief.instrumentation.excludedFamilies, ["strings"]);
  assert.equal(rule.state.brief.instrumentation.hierarchy.some((h) => h.family === "strings"), false, "the intake's 'feature strings' no longer wins");
  assert.match(rule.reply, /Standing rule for the whole song/);

  const scoped = await service.chat(PROJECT, { text: "only in the last chorus bring in strings" });
  assert.equal(scoped.kind, "edit");
  assert.equal(scoped.editPlan?.scope.sectionName, "Final Chorus");
  assert.equal(scoped.state.version, 3);
  const override = store.decisions.find((r) => r.decision.scope.kind === "section");
  assert.ok(override, "a scoped decision row exists");
  assert.deepEqual(override!.decision.scope, { kind: "section", sectionName: "Final Chorus" });
  assert.equal(override!.decision.topic, "instrumentation");
  const finalChorus = scoped.state.brief.sectionIntentions.find((s) => s.sectionName === "Final Chorus");
  assert.ok(finalChorus?.instrumentation?.add.includes("strings"), "the section asks strings back in");
  assert.deepEqual(scoped.state.brief.instrumentation.excludedFamilies, ["strings"], "the global rule still stands");
  assert.ok(activeDecisions(scoped.state.brief).some((d) => d.id === global!.decisionId), "the global rule is carried into v3");
  assert.match(scoped.reply, /Standing rule for "Final Chorus"/);

  // The owner's phrasing — a qualified dislike the lexicon cannot classify
  // ("high strings" is not a vocabulary entry; the negation captures the one
  // word "high") — is still kept verbatim as a global rule, and nothing
  // stronger: no "remove strings" is invented from it.
  const owner = await service.chat(PROJECT, { text: "in the whole song I don't like high strings" });
  assert.equal(owner.kind, "edit");
  const kept = store.decisions.filter((r) => r.decision.statement.includes("\"don't like high\""));
  assert.equal(kept.length, 1);
  assert.deepEqual(kept[0].decision.scope, { kind: "global" });
  assert.equal(kept[0].decision.strength, "hard");
  assert.equal(kept[0].delta?.kind, "decision");
  assert.equal(kept[0].decision.topic, "other", "'high' alone is not a vocabulary word: no topic is guessed for it");
  assert.deepEqual(owner.state.brief.instrumentation.excludedFamilies, ["strings"], "unchanged by the qualified dislike: the earlier rule, not a new exclusion");

  // Every turn recorded, in order.
  assert.equal(store.turns.filter((t) => t.role === "user").length, 4);
  assert.equal(store.turns.filter((t) => t.role === "producer").length, 4);
  const editTurn = store.turns.find((t) => t.structured?.kind === "edit");
  assert.ok(editTurn?.structured?.editPlan);
  assert.deepEqual(editTurn!.structured!.decisionIds, [global!.decisionId]);
  assert.equal(editTurn!.structured!.planSource, "derived", "no arrangement yet: the plan was derived from the Song Model");
});

test("a question is answered from the plan's own evidence — and honestly refused when the plan holds none", async () => {
  const { model, plan } = benchmarkPlan("pop-full");
  const { store, service } = setup({ songModel: { version: 3, model }, arrangementPlan: plan });
  await service.intake(PROJECT, { text: "a pop song" });

  const clarinet = await service.chat(PROJECT, { text: "why is there a clarinet here?" });
  assert.equal(clarinet.kind, "explanation");
  assert.equal(clarinet.explanation?.answered, false);
  assert.match(clarinet.explanation!.answer, /not in this plan's palette/);
  assert.ok(clarinet.explanation!.evidence.some((e) => e.source === "globalPlan.instrumentPalette"));
  assert.equal(clarinet.state.version, 1, "a question changes no state");

  const drums = await service.chat(PROJECT, { text: "why are the drums in the chorus?" });
  assert.equal(drums.kind, "explanation");
  assert.equal(drums.explanation?.answered, true);
  assert.match(drums.explanation!.answer, /drums is planned as/);
  assert.ok(drums.explanation!.evidence.some((e) => e.source === "sectionPlan.roleAssignments" && e.ref.startsWith("Chorus/")));
  assert.equal(drums.state.planSource, "arrangement", "the stored arrangement plan was read, not a derived one");
  assert.doesNotMatch(drums.reply, /derived from the current brief/);

  const hebrew = await service.chat(PROJECT, { text: "למה יש כאן קלרינט?" });
  assert.equal(hebrew.kind, "explanation");
  assert.equal(hebrew.explanation?.answered, false);

  const turns = store.turns.filter((t) => t.structured?.kind === "explanation");
  assert.equal(turns.length, 3);
  assert.equal(turns[0].structured?.planSource, "arrangement");
  assert.equal(turns[0].structured?.explanation?.answered, false);
  assert.equal(store.briefs.length, 1);
});

test("descriptive chat refines the intake: a new version reads the new words, and an empty refinement changes nothing", async () => {
  const { store, service } = setup();
  await service.intake(PROJECT, { text: "a hasidic ballad" });
  const refined = await service.chat(PROJECT, { text: "actually I want it more intimate and acoustic" });
  assert.equal(refined.kind, "refinement");
  assert.equal(refined.state.version, 2);
  assert.match(refined.reply, /Added to the brief \(v2\)/);
  assert.match(refined.reply, /intimate/);
  assert.ok(refined.state.styleProfile.dimensions.tradition, "the earlier reading is kept");
  assert.equal(refined.state.styleProfile.dimensions.soundAesthetic?.value, "acoustic");
  assert.ok(refined.state.intent.rawText.includes("a hasidic ballad\n"), "the intake text accumulates");

  const nothing = await service.chat(PROJECT, { text: "please send me the file tomorrow morning" });
  assert.equal(nothing.kind, "refinement");
  assert.equal(nothing.state.version, 2, "nothing new was read: no new version");
  assert.match(nothing.reply, /could not read a new musical direction/);
  assert.equal(store.briefs.length, 2);
  assert.equal(store.turns.length, 6, "the empty turn is still in the transcript");
});

test("chat before any intake is intake; turns are paged newest-last", async () => {
  const { service } = setup();
  const first = await service.chat(PROJECT, { text: "a warm acoustic ballad" });
  assert.equal(first.kind, "intake");
  assert.equal(first.state.version, 1);
  for (let i = 0; i < 3; i += 1) await service.chat(PROJECT, { text: `why is the verse so quiet? (${i})` });

  const page = await service.turns(PROJECT, { limit: 3 });
  assert.equal(page.turns.length, 3);
  assert.equal(page.hasMore, true);
  assert.equal(page.turns[2].role, "producer", "newest last");
  const older = await service.turns(PROJECT, { limit: 3, before: page.turns[0].id });
  assert.equal(older.turns.length, 3);
  assert.ok(older.turns.every((t) => t.createdAt < page.turns[0].createdAt));
  const oldest = await service.turns(PROJECT, { limit: 10, before: older.turns[0].id });
  assert.equal(oldest.turns.length, 2);
  assert.equal(oldest.hasMore, false);
  assert.equal(oldest.turns[0].text, "a warm acoustic ballad");
  assert.equal(await service.state("other-project"), null);
});

test("superseding a decision keeps the old row (marked), recompiles without it, and the replacement carries `supersedes`", async () => {
  const { store, service } = setup();
  await service.intake(PROJECT, { text: "a ballad with piano" });
  const rule = await service.chat(PROJECT, { text: "no strings in the whole song" });
  const oldRow = store.decisions.find((r) => r.delta?.kind === "instrumentation")!;
  assert.deepEqual(rule.state.brief.instrumentation.excludedFamilies, ["strings"]);

  await assert.rejects(service.supersedeDecision(PROJECT, "dec-nope", { scope: { kind: "global" }, topic: "other", statement: "x", strength: "soft" }), (e: unknown) => e instanceof ProducerChatError && e.status === 404);

  const replaced = await service.supersedeDecision(PROJECT, oldRow.decisionId, {
    scope: { kind: "global" }, topic: "instrumentation", statement: "strings only as colour, never doubled", strength: "soft", value: "strings",
  });
  assert.equal(replaced.kind, "supersede");
  assert.equal(replaced.state.version, 3);
  assert.deepEqual(replaced.state.brief.instrumentation.excludedFamilies, [], "the exclusion no longer applies");
  const oldAfter = store.decisions.find((r) => r.id === oldRow.id)!;
  assert.notEqual(oldAfter.supersededBy, null, "superseded, not deleted");
  const newRow = store.decisions.find((r) => r.id === oldAfter.supersededBy)!;
  assert.equal(newRow.decision.statement, "strings only as colour, never doubled");
  assert.ok(newRow.decision.supersedes.includes(oldRow.decisionId));
  const active = activeDecisions(replaced.state.brief);
  assert.ok(active.some((d) => d.id === newRow.decisionId));
  assert.equal(active.some((d) => d.id === oldRow.decisionId), false);
  assert.match(replaced.reply, /Replaced "/);
  assert.equal(store.turns.at(-1)?.structured?.kind, "supersede");

  // An intake-made decision can be superseded too: it stays in the brief, inactive.
  const intakeDecision = activeDecisions(replaced.state.brief).find((d) => d.createdBy === "intake" && d.topic === "instrumentation")!;
  const again = await service.supersedeDecision(PROJECT, intakeDecision.id, { scope: { kind: "global" }, topic: "instrumentation", statement: "keys lead, nothing else features", strength: "hard" });
  assert.equal(activeDecisions(again.state.brief).some((d) => d.id === intakeDecision.id), false);
  assert.ok(again.state.brief.producerDecisions.some((d) => d.id === intakeDecision.id), "still in the brief's history");
});

test("without a Song Model the intake still works: section wishes are kept unresolved, never guessed, and resolve once the song is analysed", async () => {
  const seed: Parameters<typeof createInMemoryProducerChatStore>[0] = { songModel: null };
  const { service } = setup(seed);
  const outcome = await service.intake(PROJECT, { text: "a modern hasidic ballad; the last chorus more cinematic" });
  assert.equal(outcome.state.planSource, "none");
  assert.equal(outcome.state.songModelVersion, null);
  assert.deepEqual(outcome.state.brief.sectionNames, []);
  assert.equal(outcome.state.brief.unresolvedSectionRequests.length, 1);
  assert.match(outcome.reply, /no Song Model to place it on yet/);
  const question = await service.chat(PROJECT, { text: "why is there a clarinet here?" });
  assert.equal(question.explanation?.answered, false);
  assert.match(question.reply, /no Song Model or arrangement to read yet/);

  // A scoped edit whose section cannot be matched is kept as a section wish,
  // not dropped and not guessed.
  const scoped = await service.chat(PROJECT, { text: "only in the last chorus bring in strings" });
  assert.equal(scoped.kind, "refinement");
  assert.equal(scoped.state.version, 2);
  assert.match(scoped.reply, /section wishes: "bring in strings" for the last chorus/);
  assert.equal(scoped.state.brief.unresolvedSectionRequests.length, 2);
  assert.equal(scoped.state.decisions.length, 0, "no durable decision is invented for an unmatched section");

  // Once the song is analysed, the next version resolves both wishes.
  seed.songModel = { version: 1, model: makeTestSongModel() };
  const resolved = await service.chat(PROJECT, { text: "keep the piano" });
  assert.equal(resolved.state.songModelVersion, 1);
  assert.deepEqual(resolved.state.brief.unresolvedSectionRequests, []);
  const finalChorus = resolved.state.brief.sectionIntentions.find((s) => s.sectionName === "Final Chorus");
  assert.ok(finalChorus?.instrumentation?.add.includes("strings"), "the kept wish now lands on Final Chorus");
  assert.ok(finalChorus?.character.some((c) => c.value === "cinematic"));
});

test("the owner's personal defaults (PR-30) enter the brief last: below what the words imply, filling only what nothing else says (PR-U5)", async () => {
  const personalDefaults = {
    id: "pap-1",
    profile: {
      version: "1.0" as const, method: "personal-arrangement-profile/v1", derivedAt: FIXED_NOW.toISOString(), inputsDigestSha256: "1".repeat(64),
      support: { events: 10, pairwise: 10, preferredSubjects: 10, dispreferredSubjects: 10 },
      dimensions: {
        tempoBehavior: { value: "fast" as const, confidence: 0.6, provenance: "default" as const, sourceRefs: ["personal:profile"] },
        swingRatio: { value: 0.62, confidence: 0.5, provenance: "default" as const, sourceRefs: ["personal:profile"] },
      },
      evidence: [], undecided: [],
    },
  };
  const store = createInMemoryProducerChatStore({ songModel: { version: 1, model: makeTestSongModel() }, personalDefaults });
  const service = createProducerChatService(store, { now: clock(), newId: ids(), researchAgent: null });
  const outcome = await service.intake(PROJECT, { text: "a ballad" });
  const profile = outcome.state.styleProfile;
  assert.deepEqual(profile.sources, ["universal-vocabulary/v1", "personal:pap-1"]);
  assert.equal(profile.dimensions.tempoBehavior?.value, "slow", "'ballad' implies slow through the vocabulary; the owner's fast default loses");
  assert.equal(profile.dimensions.tempoBehavior?.provenance, "inferred");
  assert.equal(profile.dimensions.swingRatio?.value, 0.62, "nothing was said about swing: the default fills it");
  assert.equal(profile.dimensions.swingRatio?.provenance, "default");
  assert.deepEqual(profile.dimensions.swingRatio?.sourceRefs, ["personal:pap-1"]);
  const decision = outcome.state.brief.dimensionDecisions.find((d) => d.dimension === "swingRatio");
  assert.equal(decision?.provenance, "default");
  // Without an active profile the sources are exactly PR-U4's.
  const plain = await createProducerChatService(createInMemoryProducerChatStore({ songModel: { version: 1, model: makeTestSongModel() } }), { now: clock(), newId: ids(), researchAgent: null }).intake(PROJECT, { text: "a ballad" });
  assert.deepEqual(plain.state.styleProfile.sources, ["universal-vocabulary/v1"]);
  assert.equal(plain.state.styleProfile.dimensions.swingRatio, undefined);
});

test("a standing rule (PR-U6) enters a new project at intake as a stated decision that names the rule, and this project can override it", async () => {
  const producerMemory = [{
    id: "mem-1",
    statement: "no high strings, ever",
    topic: "instrumentation" as const,
    scope: { kind: "global" as const },
    strength: "hard" as const,
    delta: { kind: "instrumentation" as const, remove: ["strings"], rationale: "no high strings, ever" },
    source: { projectId: "other-project", briefId: "brief-x", decisionId: "dec-x" },
    createdAt: FIXED_NOW.toISOString(),
  }];
  const store = createInMemoryProducerChatStore({ songModel: { version: 1, model: makeTestSongModel() }, producerMemory });
  const service = createProducerChatService(store, { now: clock(), newId: ids(), researchAgent: null });
  const outcome = await service.intake(PROJECT, { text: "a warm ballad" });
  const decisions = activeDecisions(outcome.state.brief);
  const remembered = decisions.find((d) => d.sourceRefs.includes("producer_memory:mem-1"));
  assert.ok(remembered, `no decision named the rule: ${decisions.map((d) => d.sourceRefs.join("+")).join(" | ")}`);
  assert.equal(remembered!.provenance, "stated", "a rule is the producer's own statement, so it outranks research and inference");
  assert.equal(remembered!.createdBy, "producer");
  assert.match(outcome.reply, /standing rule "no high strings, ever" was applied to this project/);
  assert.match(outcome.reply, /say otherwise here and this project will follow what you say/);
  assert.ok(outcome.state.brief.instrumentation.excludedFamilies.includes("strings"), "the rule reached the brief, not just the transcript");

  // Version 2 keeps the attribution: it travels as a decision row, not as "delta:0".
  const second = await service.intake(PROJECT, { text: "and make the chorus wide" });
  const still = activeDecisions(second.state.brief).find((d) => d.sourceRefs.includes("producer_memory:mem-1"));
  assert.ok(still, "the rule still names itself on later versions");
  assert.ok(!/standing rule/.test(second.reply), "and it is announced once, not on every turn");

  // A project without the rule is unaffected.
  const other = await createProducerChatService(createInMemoryProducerChatStore({ songModel: { version: 1, model: makeTestSongModel() } }), { now: clock(), newId: ids(), researchAgent: null }).intake("project-2", { text: "a warm ballad" });
  assert.ok(!activeDecisions(other.state.brief).some((d) => d.sourceRefs.some((r) => r.startsWith("producer_memory:"))));
});

test("explain (PR-U6) answers a pointed target from the plan and records nothing", async () => {
  const { store, service } = setup();
  await service.intake(PROJECT, { text: "a warm ballad with strings" });
  const turnsBefore = (await store.listTurns(PROJECT, { limit: 100 })).turns.length;
  const pointed = await service.explain(PROJECT, { target: { kind: "instrument", name: "strings" } });
  assert.equal(pointed.question, "why is there strings?");
  assert.equal(pointed.planSource, "derived", "no arrangement yet: the plan is derived from the brief");
  assert.equal(typeof pointed.explanation.answered, "boolean");
  const typed = await service.explain(PROJECT, { question: "why is there strings?" });
  assert.deepEqual(typed.explanation, pointed.explanation, "pointing and typing take the same path");
  assert.equal((await store.listTurns(PROJECT, { limit: 100 })).turns.length, turnsBefore, "asking why writes no turn");
  await assert.rejects(service.explain(PROJECT, {}), (e: unknown) => e instanceof ProducerChatError && e.status === 400);
  await assert.rejects(
    createProducerChatService(createInMemoryProducerChatStore({}), { now: clock(), newId: ids() }).explain("nope", { question: "why?" }),
    (e: unknown) => e instanceof ProducerChatError && e.status === 409,
  );
});

test("classification: questions, edits and refinements", () => {
  const model = makeTestSongModel();
  const intent = (text: string) => extractUserIntentSync(text, { now: FIXED_NOW });
  const brief = { inputsDigestSha256: "0".repeat(64) } as ProductionBrief;
  const globalPlan = deriveGlobalArrangementPlan(model, { now: FIXED_NOW });
  const sectionPlan = deriveSectionPhrasePlan(model, globalPlan, { now: FIXED_NOW });
  const classify = (text: string) => classifyChatTurn(text, interpretEditRequest(text, brief, { globalPlan, sectionPlan }, { now: FIXED_NOW }), intent(text));
  assert.equal(classify("why is there a clarinet here?"), "question");
  assert.equal(classify("למה יש כאן קלרינט?"), "question");
  assert.equal(classify("what makes the chorus so loud?"), "question");
  assert.equal(classify("the last chorus is too busy"), "edit");
  assert.equal(classify("הפזמון השני עמוס מדי"), "edit");
  assert.equal(classify("no strings in the whole song"), "edit");
  assert.equal(classify("make the violins more Jewish"), "edit");
  assert.equal(classify("keep the piano"), "edit");
  assert.equal(classify("also make it feel more cinematic"), "refinement", "a global descriptor with no boundary, section or instrument refines the world");
  assert.equal(classify("actually I want it more intimate and acoustic"), "refinement");
  assert.equal(classify("a modern hasidic ballad"), "refinement");
});

test("standing-rule deltas: PR-U1's own deltas win; otherwise constraints are kept verbatim and scoped honestly", () => {
  const model = makeTestSongModel();
  const globalPlan = deriveGlobalArrangementPlan(model, { now: FIXED_NOW });
  const sectionPlan = deriveSectionPhrasePlan(model, globalPlan, { now: FIXED_NOW });
  const brief = { inputsDigestSha256: "0".repeat(64) } as ProductionBrief;
  const deltasFor = (text: string) => {
    const plan = interpretEditRequest(text, brief, { globalPlan, sectionPlan }, { now: FIXED_NOW });
    return { plan, deltas: standingRuleDeltas(text, extractUserIntentSync(text, { now: FIXED_NOW }), plan) };
  };
  const busy = deltasFor("the last chorus is too busy");
  assert.deepEqual(busy.deltas, busy.plan.briefDeltas, "the edit plan's deltas are used as they are");
  assert.equal(busy.deltas[0].kind, "section_intention");

  const owner = deltasFor("in the whole song I don't like high strings");
  assert.equal(owner.plan.briefDeltas.length, 0, "PR-U1 maps this to regenerate_part with no delta");
  assert.equal(owner.deltas.length, 1);
  assert.equal(owner.deltas[0].kind, "decision");
  const d = owner.deltas[0] as Extract<typeof owner.deltas[number], { kind: "decision" }>;
  assert.deepEqual(d.scope, { kind: "global" }, "'in the whole song' → global");
  // The lexicon's negation captures one word, so the verbatim span is
  // "don't like high" — a PR-U1 limitation surfaced, not papered over.
  assert.match(d.statement, /^no high — "don't like high"$/, "verbatim");
  assert.equal(d.strength, "hard");

  const keep = deltasFor("keep the piano in the verse");
  assert.equal(keep.deltas.length, 1);
  const k = keep.deltas[0] as Extract<typeof keep.deltas[number], { kind: "decision" }>;
  assert.equal(k.topic, "instrumentation");
  assert.equal(k.value, "keys");
  assert.equal(k.scope.kind !== "global", true, "no whole-song marker: scoped by the edit plan");

  const nothing = deltasFor("hmm, interesting");
  assert.deepEqual(nothing.deltas, []);
});

test("decisionsProducedBy maps every delta kind onto the decisions the compiler creates for it", async () => {
  const { service, store } = setup();
  await service.intake(PROJECT, { text: "a ballad" });
  const edit = await service.chat(PROJECT, { text: "the last chorus is too busy" });
  const row = store.decisions[0];
  assert.equal(row.delta?.kind, "section_intention");
  const produced = decisionsProducedBy(edit.state.brief, row.delta!);
  assert.equal(produced.length, 1);
  assert.equal(produced[0].id, row.decisionId);
  assert.deepEqual(produced[0].scope, { kind: "section", sectionName: "Final Chorus" });
  assert.equal(produced[0].topic, "density");
  assert.equal(decisionsProducedBy(edit.state.brief, { kind: "instrumentation", remove: ["brass"], rationale: "never applied" }).length, 0);
});

test("the understanding text is built from the data only", () => {
  const intent = extractUserIntentSync(HEBREW_INTAKE, { now: FIXED_NOW });
  const delta = intentDelta(null, intent);
  assert.equal(delta.inferences.length, intent.inferences.length);
  const later = extractUserIntentSync(`${HEBREW_INTAKE}\nwith clarinet`, { now: FIXED_NOW });
  const added = intentDelta(intent, later);
  assert.equal(added.inferences.length, 1);
  assert.equal(added.inferences[0].value, "clarinet");
  const empty = describeUnderstanding({
    intent: extractUserIntentSync("", { now: FIXED_NOW }),
    profile: { version: "1.0", derivedAt: "", inputsDigestSha256: "", method: "", dimensions: {}, exclusions: [], conflicts: [], sources: [], confidence: 0 },
    brief: { sectionIntentions: [], unresolvedSectionRequests: [], sectionNames: [], instrumentation: { hierarchy: [], excludedFamilies: [] }, productionAesthetic: { descriptors: [] }, producerDecisions: [] } as unknown as ProductionBrief,
    questions: [], hasSongModel: false, version: 1,
  });
  assert.match(empty, /could not read a musical direction/);
  assert.match(empty, /write however is comfortable/);
});
