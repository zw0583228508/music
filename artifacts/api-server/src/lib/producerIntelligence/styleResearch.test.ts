import assert from "node:assert/strict";
import test from "node:test";
import type { StyleProfile } from "@workspace/db";
import type { IntentChatClient } from "./openAiIntentModel";
import { CLARIFICATION_THRESHOLD, MAX_CLARIFICATIONS, allClarificationCandidates, applyClarificationAnswers, planClarifications, worldsFor } from "./clarification";
import { compileProductionBrief } from "./briefCompiler";
import { extractUserIntentSync } from "./intentExtraction";
import {
  CURATED_WORLD_NOTES,
  CURATED_WORLD_NOTES_PROVIDER,
  CURATED_WORLD_NOTES_PROVIDER_ID,
  RESEARCHABLE_DIMENSIONS,
  RESEARCH_FACT_THRESHOLD,
  RESEARCH_QUESTION_THRESHOLD,
  createLlmResearchProvider,
  createStyleResearchAgent,
  gateResearchFindings,
  llmResearchProviderSelected,
  normaliseResearchValue,
  researchKnowledgeSources,
  researchQuestions,
  researchWorldOf,
  resolveStyleProfileWithResearch,
  selectLlmResearchProvider,
  selectResearchProviders,
  settledIdentityFromBrief,
  statedImpliedValues,
  type ResearchFinding,
  type ResearchKnowledgeProvider,
} from "./styleResearch";
import { UNIVERSAL_VOCABULARY_RULES, UNIVERSAL_VOCABULARY_SOURCE, resolveStyleProfile } from "./styleResolution";

const NOW = new Date("2026-01-01T00:00:00.000Z");
const intentOf = (text: string) => extractUserIntentSync(text, { now: NOW });
const CONFIGURED = { AI_INTEGRATIONS_OPENAI_BASE_URL: "https://mock-openai.test/v1", AI_INTEGRATIONS_OPENAI_API_KEY: "test-key" };

const HEBREW_BALLAD = "בלדה חסידית מודרנית, איטית, לא פופית מדי";

function fakeProvider(id: string, findings: Array<Partial<ResearchFinding> & { dimension: string; value: unknown; confidence: number }>): ResearchKnowledgeProvider {
  return {
    id,
    async describe() {
      return findings.map((f) => ({
        rationale: f.rationale ?? `${id} says so`, sourceRefs: f.sourceRefs ?? [`research:${id}/note`],
        ...f,
      })) as ResearchFinding[];
    },
  };
}

// ---------------------------------------------------------------------------

test("a Hebrew intake yields researched dimensions with provenance and sourceRefs, and at most two questions", async () => {
  const intent = intentOf(HEBREW_BALLAD);
  assert.equal(intent.language, "he");
  const { profile, report } = await resolveStyleProfileWithResearch(intent, createStyleResearchAgent(), { now: NOW });

  assert.deepEqual(report.providers, [CURATED_WORLD_NOTES_PROVIDER_ID]);
  assert.deepEqual(profile.sources, [UNIVERSAL_VOCABULARY_SOURCE.id, CURATED_WORLD_NOTES_PROVIDER_ID], "the research providers consulted, in order");
  assert.deepEqual(profile.research?.world, ["tradition=hasidic", "genre=ballad", "era=modern"]);

  const researched = Object.entries(profile.dimensions).filter(([, d]) => d.provenance === "researched");
  assert.ok(researched.length >= 5, `researched dimensions: ${researched.map(([k]) => k).join(", ")}`);
  for (const [name, dim] of researched) {
    assert.ok(dim.confidence >= RESEARCH_FACT_THRESHOLD, `${name} is a fact only above the threshold (${dim.confidence})`);
    assert.ok(dim.sourceRefs?.some((r) => r.startsWith(`research:${CURATED_WORLD_NOTES_PROVIDER_ID}/`)), `${name} cites its research source`);
    assert.ok(dim.sourceRefs?.some((r) => r.startsWith("curated: ")), `${name} carries a descriptive reference`);
  }
  // What the user said stays stated; research never relabels it.
  assert.equal(profile.dimensions.tradition?.provenance, "stated");
  assert.equal(profile.dimensions.genre?.provenance, "stated");
  assert.equal(profile.dimensions.era?.provenance, "stated");
  assert.equal(profile.dimensions.tempoBehavior?.value, "slow", "agrees with 'איטית'");
  assert.deepEqual(profile.exclusions.map((x) => x.value), ["pop"], "the ruled-out word is still an exclusion");

  const questions = planClarifications(intent, profile);
  assert.ok(questions.length <= MAX_CLARIFICATIONS && questions.length > 0, `questions: ${questions.map((q) => q.id).join(",")}`);
  for (const q of questions) {
    assert.ok(q.id.startsWith("research_"));
    assert.ok(q.informationGain >= CLARIFICATION_THRESHOLD);
    assert.ok(q.questionHe, "Hebrew wording is present");
    assert.ok(q.options.every((o) => o.labelHe && o.briefDeltas.length === 1 && o.briefDeltas[0].kind === "set_dimension"));
  }
  // Every finding was accounted for: a dimension, a candidate or a discard.
  const summary = profile.research!;
  assert.ok(summary.candidates.length > 0);
  for (const c of summary.candidates) {
    assert.ok(c.confidence >= RESEARCH_QUESTION_THRESHOLD && c.confidence < RESEARCH_FACT_THRESHOLD, `${c.dimension}@${c.confidence} sits in the question band`);
    assert.equal(profile.dimensions[c.dimension], undefined, `${c.dimension} is offered, not populated`);
  }
});

test("gating: ≥0.7 becomes a researched dimension, 0.4–0.7 a question option, <0.4 is discarded with a reason", async () => {
  const provider = fakeProvider("fake/v1", [
    { dimension: "roomSize", value: "hall", confidence: 0.9 },
    { dimension: "melodicOrnamentation", value: "heavy", confidence: 0.55 },
    { dimension: "doublingRules", value: "octaves", confidence: 0.2 },
  ]);
  const intent = intentOf("a balkan tune");
  const { profile, report } = await resolveStyleProfileWithResearch(intent, createStyleResearchAgent({ providers: [provider] }), { now: NOW });

  assert.equal(profile.dimensions.roomSize?.value, "hall");
  assert.equal(profile.dimensions.roomSize?.provenance, "researched");
  assert.deepEqual(profile.dimensions.roomSize?.sourceRefs, ["research:fake/v1/note"]);

  assert.equal(profile.dimensions.melodicOrnamentation, undefined, "a 0.55 finding is not a fact");
  assert.deepEqual(report.candidates.map((c) => [c.dimension, c.value]), [["melodicOrnamentation", "heavy"]]);
  const questions = researchQuestions(profile);
  assert.equal(questions.length, 1);
  assert.equal(questions[0].id, "research_melodicOrnamentation");
  assert.deepEqual(questions[0].settlesDimensions, ["melodicOrnamentation"]);
  assert.match(questions[0].trigger.reason, /enough to ask, not enough to assume/);
  const option = questions[0].options[0];
  assert.equal(option.id, "melodicOrnamentation_heavy");
  assert.deepEqual(option.briefDeltas, [{ kind: "set_dimension", dimension: "melodicOrnamentation", value: "heavy", confidence: 0.85, rationale: "chosen after research: heavy ornamentation" }]);

  assert.equal(profile.dimensions.doublingRules, undefined);
  assert.deepEqual(report.discarded.map((d) => [d.dimension, d.reason]), [["doublingRules", `below the question threshold (${RESEARCH_QUESTION_THRESHOLD})`]]);
  assert.deepEqual(profile.research?.discarded.map((d) => d.dimension), ["doublingRules"], "the discard is stored with the profile, with its reason");
  assert.equal("providerId" in (profile.research!.discarded[0] as object), false, "the stored summary carries no provider-internal fields");

  // Answering the question applies the option's delta as an answer, like any PR-U1 question.
  const brief = compileProductionBrief(intent, profile, undefined, [{ questionId: "research_melodicOrnamentation", optionId: "melodicOrnamentation_heavy" }], { now: NOW });
  const decision = brief.dimensionDecisions.find((d) => d.dimension === "melodicOrnamentation");
  assert.equal(decision?.styleValue, "heavy");
  assert.equal(decision?.decidedBy, "answer");
  assert.deepEqual(brief.answeredQuestionIds, ["research_melodicOrnamentation"]);
});

test("stated intent always beats research — through the resolver, and the agent discards a contradiction before it gets there", async () => {
  // Through the resolver: a 0.99 researched aesthetic cannot outrank a stated one.
  const stated = resolveStyleProfile(intentOf("acoustic and warm"), {
    now: NOW,
    knowledge: [UNIVERSAL_VOCABULARY_SOURCE, { id: "raw/v1", lookup: () => [{ dimension: "soundAesthetic", value: "electronic", confidence: 0.99, provenance: "researched", sourceRefs: ["research:raw"] }] }],
  });
  assert.equal(stated.dimensions.soundAesthetic?.value, "acoustic");
  assert.equal(stated.dimensions.soundAesthetic?.provenance, "stated");

  // Through the agent: "slow" is the user's word; the world's usual "fast" is discarded, not merged.
  const provider = fakeProvider("fast-world/v1", [
    { dimension: "tempoBehavior", value: "fast", confidence: 0.95 },
    { dimension: "tempoBehavior", value: "slow", confidence: 0.8 },
    { dimension: "soundAesthetic", value: "electronic", confidence: 0.95 },
  ]);
  const intent = intentOf("a slow acoustic klezmer tune");
  const implied = statedImpliedValues(intent);
  assert.equal(implied.get("tempoBehavior"), "slow", "the vocabulary's implication of a stated word counts as said");
  assert.equal(implied.get("soundAesthetic"), "acoustic");
  const { profile, report } = await resolveStyleProfileWithResearch(intent, createStyleResearchAgent({ providers: [provider] }), { now: NOW });
  assert.equal(profile.dimensions.tempoBehavior?.value, "slow");
  assert.equal(profile.dimensions.soundAesthetic?.value, "acoustic");
  assert.equal(profile.dimensions.soundAesthetic?.provenance, "stated");
  const contradictions = report.discarded.filter((d) => /contradicts what the user said/.test(d.reason));
  assert.deepEqual(contradictions.map((d) => [d.dimension, d.value]), [["tempoBehavior", "fast"], ["soundAesthetic", "electronic"]]);
  assert.ok(profile.dimensions.tempoBehavior?.sourceRefs?.includes("research:fast-world/v1/note"), "an agreeing finding corroborates and is cited");
  assert.equal(profile.conflicts.some((c) => c.dimension === "tempoBehavior"), false, "a discarded contradiction is not a conflict");
});

test("named instruments are a stated hierarchy: research does not reorder them", async () => {
  const intent = intentOf("a modern hasidic ballad with piano and flute");
  const { profile, report } = await resolveStyleProfileWithResearch(intent, createStyleResearchAgent(), { now: NOW });
  assert.deepEqual(profile.dimensions.instrumentationHierarchy?.value, ["keys", "winds"]);
  assert.equal(profile.dimensions.instrumentationHierarchy?.provenance, "stated");
  const dropped = report.discarded.filter((d) => d.dimension === "instrumentationHierarchy");
  assert.ok(dropped.length >= 1);
  assert.match(dropped[0].reason, /the user named the instruments \(keys, winds\)/);
  assert.equal(planClarifications(intent, profile).some((q) => q.id === "research_instrumentationHierarchy"), false);
});

test("the ≤2 rule holds across PR-U1's questions and research's: the world question ranks first", async () => {
  const provider = fakeProvider("doubtful/v1", [
    { dimension: "dynamics", value: "wide", confidence: 0.45 },
    { dimension: "roomSize", value: "hall", confidence: 0.5 },
    { dimension: "chordExtensions", value: "sevenths", confidence: 0.42 },
    { dimension: "kickSnareLanguage", value: "brushes", confidence: 0.41 },
    { dimension: "melodicOrnamentation", value: "heavy", confidence: 0.6 },
  ]);
  const intent = intentOf("old hasidic");
  const { profile } = await resolveStyleProfileWithResearch(intent, createStyleResearchAgent({ providers: [provider] }), { now: NOW });
  const all = allClarificationCandidates(intent, profile);
  assert.ok(all.length >= 5, `candidates: ${all.map((q) => q.id).join(",")}`);
  const asked = planClarifications(intent, profile);
  assert.equal(asked.length, MAX_CLARIFICATIONS);
  assert.equal(asked[0].id, "world_of_tradition", "a structural PR-U1 question outranks a research doubt");
  assert.ok(asked[1].id.startsWith("research_"));
  assert.ok(asked[0].informationGain >= asked[1].informationGain);
  for (const q of asked) assert.ok(q.informationGain >= CLARIFICATION_THRESHOLD);
  // Research questions rank by how unsure the research was, weighted by the dimension.
  const gains = Object.fromEntries(all.map((q) => [q.id, q.informationGain]));
  assert.ok(gains.research_chordExtensions > gains.research_melodicOrnamentation - 0.2, "near-threshold doubts are worth asking");
});

test("two providers disagree: the higher confidence wins the dimension and the conflict is recorded; a question-band loser is not asked", async () => {
  const a = fakeProvider("a/v1", [
    { dimension: "roomSize", value: "medium", confidence: 0.8 },
    { dimension: "saturation", value: "warm", confidence: 0.85 },
  ]);
  const b = fakeProvider("b/v1", [
    { dimension: "roomSize", value: "hall", confidence: 0.75 },
    { dimension: "saturation", value: "driven", confidence: 0.5 },
  ]);
  const intent = intentOf("a klezmer tune");
  const { profile, report } = await resolveStyleProfileWithResearch(intent, createStyleResearchAgent({ providers: [a, b] }), { now: NOW });
  assert.deepEqual(profile.sources, [UNIVERSAL_VOCABULARY_SOURCE.id, "a/v1", "b/v1"]);
  assert.equal(profile.dimensions.roomSize?.value, "medium");
  assert.equal(profile.dimensions.roomSize?.confidence, 0.8);
  assert.deepEqual(profile.conflicts.find((c) => c.dimension === "roomSize"), { dimension: "roomSize", values: ["medium", "hall"] });
  assert.deepEqual(report.conflicts.map((c) => c.dimension), ["roomSize", "saturation"]);
  assert.equal(profile.dimensions.saturation?.value, "warm");
  assert.deepEqual(profile.conflicts.find((c) => c.dimension === "saturation"), { dimension: "saturation", values: ["warm", "driven"] }, "the runner-up is recorded, not silently dropped");
  assert.equal(researchQuestions(profile).length, 0, "a dimension that has a fact is never also a question");
  const sources = researchKnowledgeSources(report);
  assert.deepEqual(sources.map((s) => s.id), ["a/v1", "b/v1"]);
  assert.deepEqual(sources[1].lookup({ intent, terms: [] }).map((f) => f.value), ["hall", "driven"], "each provider's source carries its own findings");
});

test("a failing provider is reported and the rest still count; provider answers are memoised per world", async () => {
  let calls = 0;
  const counting: ResearchKnowledgeProvider = { id: "counting/v1", async describe() { calls += 1; return [{ dimension: "roomSize", value: "small", confidence: 0.9, sourceRefs: ["research:counting"], rationale: "small" }]; } };
  const failing: ResearchKnowledgeProvider = { id: "failing/v1", async describe() { throw new Error("network down"); } };
  const agent = createStyleResearchAgent({ providers: [failing, counting] });
  const intent = intentOf("bossa nova");
  const first = await agent.research(intent);
  assert.deepEqual(first.providers, ["failing/v1", "counting/v1"]);
  assert.deepEqual(first.providerErrors, [{ providerId: "failing/v1", error: "network down" }]);
  assert.equal(first.findings.length, 1);
  await agent.research(intent);
  assert.equal(calls, 1, "the same world is not researched twice");
  await agent.research(intentOf("bossa nova, warm"));
  assert.equal(calls, 2, "a different world is");
  const none = await agent.research(intentOf("80s"));
  assert.deepEqual(none.providers, [], "a decade alone names no world: nothing is researched");
  assert.equal(none.summary, null);
});

test("the LLM provider asks for conventions in the fixed vocabulary only, and drops out-of-vocabulary output instead of coercing it", async () => {
  const seen: Array<{ role: string; content: string }> = [];
  const dropped: Array<{ dimension: string; reason: string }> = [];
  const client: IntentChatClient = {
    chat: {
      completions: {
        async create(request) {
          seen.push(...request.messages);
          assert.equal(request.response_format.type, "json_object");
          return {
            choices: [{
              message: {
                content: JSON.stringify({
                  findings: [
                    { dimension: "melodicOrnamentation", value: "heavy", confidence: 0.9, rationale: "the lead ornaments constantly" },
                    { dimension: "melodicOrnamentation", value: "baroque", confidence: 0.9, rationale: "not a vocabulary value" },
                    { dimension: "roomSize", value: "cathedral", confidence: 0.9, rationale: "not a vocabulary value" },
                    { dimension: "tradition", value: "klezmer", confidence: 0.9, rationale: "identity dimensions are not researchable" },
                    { dimension: "swingRatio", value: 0.9, confidence: 0.8, rationale: "out of range" },
                    { dimension: "swingRatio", value: 0.55, confidence: 1.7, rationale: "confidence is clamped, the value is fine" },
                    { dimension: "instrumentationHierarchy", value: ["winds", "kazoo"], confidence: 0.8, rationale: "an unknown family drops the whole list" },
                    { dimension: "articulations", value: ["slides", "slides", "trills"], confidence: 0.8 },
                    { dimension: "notes", value: "C D E", confidence: 1, rationale: "never" },
                  ],
                }),
              },
            }],
          };
        },
      },
    },
  };
  const provider = createLlmResearchProvider({ model: "gpt-test", client: async () => client, onDiscard: (e) => dropped.push({ dimension: e.dimension, reason: e.reason }) });
  assert.equal(provider.id, "openai-research/gpt-test");
  const world = researchWorldOf(intentOf("klezmer freylekhs"));
  const findings = await provider.describe(world);
  assert.deepEqual(findings.map((f) => [f.dimension, f.value, f.confidence]), [
    ["melodicOrnamentation", "heavy", 0.9],
    ["swingRatio", 0.55, 1],
    ["articulations", ["slides", "trills"], 0.8],
  ]);
  assert.ok(findings.every((f) => f.sourceRefs[0].startsWith("research:openai-research/gpt-test#")));
  assert.equal(findings[2].rationale, "described by openai-research/gpt-test", "a missing rationale is named, not invented");
  assert.deepEqual(dropped.map((d) => d.dimension), ["melodicOrnamentation", "roomSize", "tradition", "swingRatio", "instrumentationHierarchy", "notes"]);

  assert.equal(seen[0].role, "system");
  assert.match(seen[0].content, /never write notes, chords, melodies, lyrics/);
  assert.match(seen[0].content, /melodicOrnamentation: one of none \| light \| moderate \| heavy/);
  assert.match(seen[0].content, /swingRatio: a number between 0.5 and 0.75/);
  assert.equal(seen[1].role, "user");
  assert.match(seen[1].content, /World: tradition=klezmer/);
  assert.doesNotMatch(seen[1].content, /C D E/);

  // Garbage and empty replies are empty findings, never an error.
  const broken = createLlmResearchProvider({ model: "gpt-test", client: async () => ({ chat: { completions: { async create() { return { choices: [{ message: { content: "not json" } }] }; } } } }) });
  assert.deepEqual(await broken.describe(world), []);
  const empty = createLlmResearchProvider({ model: "gpt-test", client: async () => ({ chat: { completions: { async create() { return { choices: [] }; } } } }) });
  assert.deepEqual(await empty.describe(world), []);
  // A world that names nothing is never sent to the model.
  const untouched = createLlmResearchProvider({ model: "gpt-test", client: async () => { throw new Error("must not be called"); } });
  assert.deepEqual(await untouched.describe(researchWorldOf(intentOf("80s"))), []);
});

test("the LLM provider is never selected unless opted in AND configured; the default agent is the seed corpus alone", () => {
  assert.equal(selectLlmResearchProvider({}), undefined);
  assert.equal(selectLlmResearchProvider({ PRODUCER_LLM: "openai" }), undefined, "opted in without the integration");
  assert.equal(selectLlmResearchProvider(CONFIGURED), undefined, "integration present but not opted in");
  assert.equal(llmResearchProviderSelected({ ...CONFIGURED, PRODUCER_LLM: "openai" }), true);
  const selected = selectLlmResearchProvider({ ...CONFIGURED, PRODUCER_LLM: "openai", PRODUCER_LLM_MODEL: "gpt-test" }, { client: async () => { throw new Error("not called at selection time"); } });
  assert.equal(selected?.id, "openai-research/gpt-test");
  assert.deepEqual(selectResearchProviders({}).map((p) => p.id), [CURATED_WORLD_NOTES_PROVIDER_ID]);
  assert.deepEqual(selectResearchProviders({ ...CONFIGURED, PRODUCER_LLM: "openai", PRODUCER_LLM_MODEL: "gpt-test" }, { client: async () => { throw new Error("not called"); } }).map((p) => p.id), [CURATED_WORLD_NOTES_PROVIDER_ID, "openai-research/gpt-test"]);
  assert.deepEqual(createStyleResearchAgent().providerIds, [CURATED_WORLD_NOTES_PROVIDER_ID]);
});

test("the agent re-validates every provider's output against the vocabulary, whoever wrote it", () => {
  const world = researchWorldOf(intentOf("a klezmer tune"));
  const gated = gateResearchFindings(world, [
    { providerId: "x", dimension: "roomSize", value: "cathedral" as never, confidence: 0.9, sourceRefs: [], rationale: "" },
    { providerId: "x", dimension: "tempoBehavior", value: "fast", confidence: 0.9, sourceRefs: [], rationale: "" },
  ], new Map());
  assert.deepEqual(gated.discarded.map((d) => [d.dimension, d.reason]), [["roomSize", "out of the research vocabulary"]]);
  assert.deepEqual(gated.findings.map((f) => f.dimension), ["tempoBehavior"]);
  assert.equal(normaliseResearchValue("swingRatio", "0.6"), 0.6, "a numeric string is a number");
  assert.equal(normaliseResearchValue("swingRatio", 0.8), null);
  assert.deepEqual(normaliseResearchValue("instrumentationHierarchy", ["keys", "keys", "strings"]), ["keys", "strings"]);
  assert.equal(normaliseResearchValue("genre", "pop"), null, "identity dimensions are not researchable");
});

test("the curated corpus is seed knowledge in the vocabulary: every note names a world, every value validates, and nothing leaks into the universal vocabulary", () => {
  assert.ok(CURATED_WORLD_NOTES.length >= 6 && CURATED_WORLD_NOTES.length <= 12, `a handful: ${CURATED_WORLD_NOTES.length}`);
  const traditionOnly = CURATED_WORLD_NOTES.filter((n) => n.when.length < 2 && n.when[0].every((m) => "tradition" in m));
  assert.deepEqual(traditionOnly.map((n) => n.id), [], "no note fires on a tradition name alone");
  for (const note of CURATED_WORLD_NOTES) {
    assert.ok(note.label.en && note.label.he, `${note.id} is labelled in both languages`);
    for (const convention of note.conventions) {
      assert.notEqual(normaliseResearchValue(convention.dimension, convention.value), null, `${note.id}: ${convention.dimension}=${JSON.stringify(convention.value)} is in the vocabulary`);
      assert.ok(convention.confidence > 0 && convention.confidence <= 1);
      assert.ok(convention.rationale.length > 8 && convention.rationale.length <= 160, `${note.id}: one-line rationale`);
      assert.doesNotMatch(convention.rationale, /\b[A-G][#b]?\d\b|\b(?:verse|chorus) lyrics?\b/i, "no note names, no lyrics");
    }
  }
  // PR-U1's guarantee still holds: the universal vocabulary has no rule for
  // any tradition, and none of the corpus's world names has become a rule.
  assert.equal(UNIVERSAL_VOCABULARY_RULES.some((r) => r.when.slot === "tradition"), false);
  const worldWords = new Set(CURATED_WORLD_NOTES.flatMap((n) => n.when.flat().flatMap((m) => ("tradition" in m ? [m.tradition] : "genre" in m ? [m.genre] : "word" in m ? [m.word] : []))));
  for (const rule of UNIVERSAL_VOCABULARY_RULES) {
    if (rule.when.slot === "genre_word" || rule.when.slot === "tradition") {
      assert.equal(worldWords.has(rule.when.value) && !["ballad", "dance"].includes(rule.when.value), false, `no vocabulary rule for the world word "${rule.when.value}"`);
    }
  }
  assert.ok(UNIVERSAL_VOCABULARY_RULES.length <= 40);
  // A tradition alone researches nothing; the clarifier's world question comes first.
  assert.deepEqual(CURATED_WORLD_NOTES.filter((n) => n.when.every((g) => g.some((m) => matcherIsTradition(m, "hasidic")))).length, 0);
  const only = researchWorldOf(intentOf("old hasidic"));
  assert.ok(only.key, "a tradition names a world");
  assert.equal(CURATED_WORLD_NOTES_PROVIDER.id, CURATED_WORLD_NOTES_PROVIDER_ID);
});

const matcherIsTradition = (m: object, tradition: string): boolean => "tradition" in m && (m as { tradition: string }).tradition === tradition;

test("worldsFor: tradition-specific wording for the traditions the vocabulary knows, generic ids and deltas kept, null elsewhere", () => {
  const hasidic = worldsFor("hasidic")!;
  assert.deepEqual(hasidic.map((o) => o.id), ["era_band", "communal_vocal", "arranged_orchestral"], "ids are the generic ones, so an answer means the same thing");
  assert.match(hasidic[1].label, /niggun/);
  assert.match(hasidic[1].label, /communal singing/);
  assert.match(hasidic[1].labelHe!, /ניגון/);
  assert.match(hasidic[1].labelHe!, /קומזיץ/);
  assert.ok(hasidic[1].briefDeltas.some((d) => d.kind === "set_dimension" && d.dimension === "ensembleType" && d.value === "vocal_led_small"), "the generic deltas are untouched");
  const klezmer = worldsFor("klezmer")!;
  assert.match(klezmer[0].label, /kapelye/);
  assert.match(klezmer[0].labelHe!, /קאפליה/);
  assert.equal(worldsFor("balkan"), null, "unsure → generic wording");
  assert.equal(worldsFor("gospel"), null);

  // The default flows through planClarifications without options.
  const intent = intentOf("חסידי ישן");
  const profile = resolveStyleProfile(intent, { now: NOW });
  const [q] = planClarifications(intent, profile);
  assert.equal(q.id, "world_of_tradition");
  assert.match(q.options[1].labelHe!, /ניגון/);
  const generic = planClarifications(intentOf("old balkan"), resolveStyleProfile(intentOf("old balkan"), { now: NOW }))[0];
  assert.match(generic.options[0].label, /wedding \/ party-band balkan sound/);
});

test("the hasidic-ballad ornamentation question speaks of krekhts / dreydlekh in Hebrew and in English; an unknown tradition gets the generic wording", async () => {
  for (const text of [HEBREW_BALLAD, "a slow modern hasidic ballad"]) {
    const intent = intentOf(text);
    const { profile } = await resolveStyleProfileWithResearch(intent, createStyleResearchAgent(), { now: NOW });
    const q = planClarifications(intent, profile).find((x) => x.id === "research_melodicOrnamentation");
    assert.ok(q, `${text}: the ornamentation question is asked`);
    assert.match(q!.question, /krekhts and dreydlekh/);
    assert.match(q!.questionHe!, /קרעכץ ודריידלעך/);
    assert.match(q!.options[0].label, /krekhts/);
    assert.match(q!.options[0].labelHe!, /קרעכץ/);
  }
  const provider = fakeProvider("x/v1", [{ dimension: "melodicOrnamentation", value: "heavy", confidence: 0.5 }]);
  const intent = intentOf("a balkan wedding tune");
  const { profile } = await resolveStyleProfileWithResearch(intent, createStyleResearchAgent({ providers: [provider] }), { now: NOW });
  const q = researchQuestions(profile)[0];
  assert.equal(q.question, "How much ornamentation in the melody?");
  assert.equal(q.questionHe, "כמה קישוט במנגינה?");
  assert.equal(q.options[0].label, "heavy ornamentation");
  assert.equal(q.options[0].labelHe, "קישוט כבד");
});

test("a world settled by an earlier answer is researched on the next version", async () => {
  const intent = intentOf("old hasidic");
  const agent = createStyleResearchAgent();
  const before = await agent.research(intent);
  assert.equal(before.findings.length, 0, "'old hasidic' alone matches no note");
  const profile = resolveStyleProfile(intent, { now: NOW });
  const brief = compileProductionBrief(intent, profile, undefined, [{ questionId: "world_of_tradition", optionId: "communal_vocal" }], { now: NOW });
  const settled = settledIdentityFromBrief(brief);
  assert.equal(settled.ensembleType, "vocal_led_small");
  const after = await agent.research(intent, { settled });
  assert.ok(after.findings.length > 0, "the communal-singing note now applies");
  assert.ok(after.summary!.world.includes("ensembleType=vocal_led_small (settled)"));
  assert.ok(after.findings.some((f) => f.dimension === "instrumentationHierarchy" && Array.isArray(f.value) && f.value[0] === "vocals"));
});

test("questions and the summary are re-derivable from the stored profile alone; the digest tracks research", async () => {
  const intent = intentOf(HEBREW_BALLAD);
  const { profile } = await resolveStyleProfileWithResearch(intent, createStyleResearchAgent(), { now: NOW });
  const stored = JSON.parse(JSON.stringify(profile)) as StyleProfile;
  assert.deepEqual(planClarifications(intent, stored).map((q) => q.id), planClarifications(intent, profile).map((q) => q.id));
  const plain = resolveStyleProfile(intent, { now: NOW });
  assert.notEqual(plain.inputsDigestSha256, profile.inputsDigestSha256, "research is an input to the profile");
  assert.equal(plain.research, undefined);
  const again = await resolveStyleProfileWithResearch(intent, createStyleResearchAgent(), { now: new Date("2027-01-01T00:00:00.000Z") });
  assert.equal(again.profile.inputsDigestSha256, profile.inputsDigestSha256, "deterministic: same inputs, same digest, whatever the clock says");
  // Answers to research questions apply like any other answer.
  const questions = planClarifications(intent, profile);
  const applied = applyClarificationAnswers(questions, [{ questionId: questions[0].id, optionId: questions[0].options[0].id }]);
  assert.equal(applied.deltas.length, 1);
  assert.equal(applied.deltas[0].kind, "set_dimension");
});

test("every researchable dimension has a question in both languages and a weight", () => {
  for (const dimension of RESEARCHABLE_DIMENSIONS) {
    const profile = { dimensions: {}, research: { method: "x", world: [], providers: [], discarded: [], candidates: [{ dimension, value: sampleValue(dimension), confidence: 0.5, sourceRefs: [], rationale: "r" }] } } as unknown as StyleProfile;
    const [q] = researchQuestions(profile);
    assert.ok(q, dimension);
    assert.ok(q.question.endsWith("?") && q.questionHe!.endsWith("?"), `${dimension}: ${q.question} / ${q.questionHe}`);
    assert.ok(q.informationGain > 0 && q.informationGain <= 0.7, `${dimension} gain ${q.informationGain}`);
    assert.ok(q.options[0].label && q.options[0].labelHe);
  }
});

function sampleValue(dimension: string): unknown {
  if (dimension === "swingRatio") return 0.56;
  if (dimension === "subdivisionVocabulary") return ["eighths"];
  if (dimension === "articulations") return ["legato"];
  if (dimension === "instrumentationHierarchy") return ["keys"];
  if (dimension === "soundAesthetic") return "acoustic";
  if (dimension === "kickSnareLanguage") return "brushes";
  if (dimension === "cadenceLanguage") return "authentic";
  if (dimension === "transitionLanguage") return "drum_fills";
  return normaliseResearchValue(dimension, "regular") ?? normaliseResearchValue(dimension, "moderate") ?? normaliseResearchValue(dimension, "slow") ?? normaliseResearchValue(dimension, "none") ?? normaliseResearchValue(dimension, "open") ?? normaliseResearchValue(dimension, "mid") ?? normaliseResearchValue(dimension, "small") ?? normaliseResearchValue(dimension, "clean") ?? normaliseResearchValue(dimension, "natural") ?? normaliseResearchValue(dimension, "on_top") ?? normaliseResearchValue(dimension, "on_the_beat") ?? normaliseResearchValue(dimension, "sustained") ?? normaliseResearchValue(dimension, "triads") ?? normaliseResearchValue(dimension, "rare") ?? normaliseResearchValue(dimension, "occasional");
}
