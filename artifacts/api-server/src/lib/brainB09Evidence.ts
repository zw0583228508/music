/**
 * Brain B-09 evidence generator (not a test; run through
 * `scripts/brain-b09-style-evidence.mjs`). Resolves the owner's brief (as
 * written, and with the tradition named) against the owner's song fixture,
 * prints the grammar with confidence and provenance per value, the ten-level
 * walk, the questions, the planner / StyleSpec / PerformanceStyle / slot
 * projections before and after, the fixture-research merge, the rule-kind
 * ledger, the consumer table and the knowledge-base coverage. Pure
 * TypeScript, no database, no live call; one JSON document to stdout.
 */
import { deriveGlobalArrangementPlan } from "./globalArrangementPlanner";
import { createStyleSpec } from "./musicEngines";
import { performanceStyleFromGrammar } from "./performanceEngine";
import { compileProductionBrief } from "./producerIntelligence/briefCompiler";
import { briefPlannerHints, resolveBriefStyle } from "./producerIntelligence/briefToPlanner";
import { extractUserIntentSync } from "./producerIntelligence/intentExtraction";
import { resolveStyleProfile } from "./producerIntelligence/styleResolution";
import { deriveStyleFingerprint } from "./styleFingerprint";
import { RULE_KIND_LEDGER, STYLE_FIELDS, STYLE_PATHS, deriveStyleGrammar, getStyleValue, styleGrammarSlot, type StyleGrammar } from "./styleGrammar";
import { STYLE_KNOWLEDGE_ENTRIES, knowledgeChain, unknownLevels } from "./styleKnowledge";
import { LIVE_STYLE_RESEARCH_REQUIRED_ENV, createFixtureStyleResearchProvider, liveStyleResearchProvider } from "./styleGrammarResearch";
import { answerStyleQuestion, resolveStyleWithResearch, styleCandidatesFromKnowledge, type StyleResolution } from "./styleResolver";
import { RACHEM_NA_FIXED_NOW as NOW, rachemNaSongModel } from "./__fixtures__/rachemNaSongModelV3";

const OWNER_BRIEF = process.env.B09_BRIEF ?? "intimate ballad; piano, soft strings, gentle bass, light percussion; big final chorus";
const OWNER_BRIEF_WITH_TRADITION = process.env.B09_BRIEF_TRADITION ?? "intimate chassidic ballad; piano, soft strings, gentle bass, light percussion; big final chorus";

const model = rachemNaSongModel();

function briefFor(text: string) {
  const intent = extractUserIntentSync(text, { now: NOW });
  const profile = resolveStyleProfile(intent, { now: NOW });
  return { brief: compileProductionBrief(intent, profile, model, [], { now: NOW }), profile };
}

function grammarTable(grammar: StyleGrammar) {
  const values: Record<string, { value: unknown; confidence: number; provenance: string; sourceRefs?: string[] }> = {};
  for (const path of STYLE_PATHS) {
    const v = getStyleValue(grammar, path);
    if (v) values[path] = { value: v.value, confidence: v.confidence, provenance: v.provenance, ...(v.sourceRefs ? { sourceRefs: v.sourceRefs.slice(0, 3) } : {}) };
  }
  return {
    version: grammar.version,
    inputsDigestSha256: grammar.inputsDigestSha256,
    known: STYLE_PATHS.length - grammar.unknown.length,
    total: STYLE_PATHS.length,
    values,
    unknown: grammar.unknown,
    conflicts: grammar.conflicts,
    rules: grammar.rules,
    slot: styleGrammarSlot(grammar),
    omitted: grammar.omitted,
    basis: grammar.basis,
  };
}

function resolutionSummary(res: StyleResolution) {
  return {
    terms: res.terms,
    knowledge: res.knowledge,
    flags: res.flags,
    walk: res.walk.map((w) => ({ level: w.level, status: w.status, from: w.from, resolved: w.resolved.length, unknown: w.unknown.length, contested: w.contested, ...(w.note ? { note: w.note } : {}) })),
    questions: res.questions.map((q) => ({ id: q.id, reason: q.reason, informationGain: q.informationGain, prompt: q.prompt, current: q.current ?? null, options: q.options.map((o) => ({ value: o.value, label: o.label, effect: o.changes[0].effect })) })),
    grammar: grammarTable(res.grammar),
  };
}

function planSummary(plan: ReturnType<typeof deriveGlobalArrangementPlan>) {
  return {
    style: plan.style, substyle: plan.substyle, productionAesthetic: plan.productionAesthetic, grooveStrategy: plan.grooveStrategy,
    arcTemplate: plan.arc?.template?.id ?? null, climax: plan.climax?.sectionName ?? null, styleDecisions: plan.styleDecisions ?? null,
    palette: plan.instrumentPalette.map((p) => p.role),
  };
}

async function main() {
  const verbatim = briefFor(OWNER_BRIEF);
  const named = briefFor(OWNER_BRIEF_WITH_TRADITION);
  const resVerbatim = resolveBriefStyle(verbatim.brief, { songModel: model });
  const resNamed = resolveBriefStyle(named.brief, { songModel: model });

  // Planner before / after.
  const legacyPlan = deriveGlobalArrangementPlan(model, { now: NOW });
  const hintsVerbatim = briefPlannerHints(verbatim.brief, { songModel: model });
  const hintsNamed = briefPlannerHints(named.brief, { songModel: model });
  const planVerbatim = deriveGlobalArrangementPlan(model, { now: NOW, hints: hintsVerbatim.global });
  const planNamed = deriveGlobalArrangementPlan(model, { now: NOW, hints: hintsNamed.global });
  const answered = answerStyleQuestion({ brief: named.brief, song: { tempoBpm: model.tempoMap[0].bpm } }, { path: "groove.feltPulse" }, "half_time");
  const planAnswered = deriveGlobalArrangementPlan(model, { now: NOW, hints: { ...hintsNamed.global, styleGrammar: answered.grammar } });

  // Fingerprint-only grammar before / after (the "before" is what a751796's deriveStyleGrammar emitted on this fixture, captured in this session).
  const fp = deriveStyleFingerprint({ source: { kind: "song_model", id: "rachem-na", version: null }, songModel: model, tempoBpm: model.tempoMap[0].bpm, meter: "4/4" });
  const fpGrammar = deriveStyleGrammar(fp);

  // Projections.
  const sliders = { density: 0.4, harmonyComplexity: 3, energy: 0.4 };
  const specNamed = createStyleSpec(OWNER_BRIEF_WITH_TRADITION, sliders, null, resNamed.grammar);
  const specLegacyText = createStyleSpec("polka", sliders);
  const perfNamed = performanceStyleFromGrammar(resNamed.grammar);
  const perfVerbatim = performanceStyleFromGrammar(resVerbatim.grammar);

  // Research (fixture provider only; the live one is not configured).
  const researched = await resolveStyleWithResearch({ brief: named.brief, song: { tempoBpm: model.tempoMap[0].bpm } }, [createFixtureStyleResearchProvider()]);
  const live = liveStyleResearchProvider({});

  const consumers = STYLE_PATHS.map((path) => ({ path, level: STYLE_FIELDS[path].level, consumers: [...STYLE_FIELDS[path].consumers], question: !!STYLE_FIELDS[path].question }));
  const knowledge = STYLE_KNOWLEDGE_ENTRIES.map((entry) => ({
    id: entry.id, coverage: entry.coverage, extends: entry.extends ?? null,
    chain: knowledgeChain(entry, STYLE_KNOWLEDGE_ENTRIES).map((e) => e.id),
    unknownLevels: unknownLevels(entry, STYLE_KNOWLEDGE_ENTRIES),
    values: styleCandidatesFromKnowledge(entry, STYLE_KNOWLEDGE_ENTRIES).length,
    basis: entry.basis,
  }));

  const doc = {
    title: "Brain B-09: one style contract (StyleGrammar) - the owner's brief resolved with confidence and provenance, the planner / StyleSpec / PerformanceStyle / slot as projections, research as constraints",
    date: "2026-09-10",
    stream: "B-09 (style intelligence specialist)",
    baseCommit: "a751796 (origin/main)",
    regenerate: "node artifacts/api-server/scripts/brain-b09-style-evidence.mjs --out docs/evidence/brain-b09-style-grammar.json",
    fixture: "artifacts/api-server/src/lib/__fixtures__/rachemNaSongModelV3.ts (the owner's song, C minor, 130.43 BPM, 92 chords, 9 sections; no transcribed notes)",
    briefs: { verbatim: OWNER_BRIEF, withTradition: OWNER_BRIEF_WITH_TRADITION },
    ownerBrief: {
      verbatim: resolutionSummary(resVerbatim),
      withTradition: resolutionSummary(resNamed),
      globalLowDynamic: {
        claim: "\"soft strings, gentle bass\" is a global low-dynamic decision (B-01's request to B-09)",
        grammarValue: getStyleValue(resNamed.grammar, "arrangement.globalDynamic") ?? null,
        plannerLever: { globalDynamicSteps: hintsNamed.global.globalDynamicSteps ?? 0, evidence: hintsNamed.evidence.filter((e) => /globalDynamic/.test(e)) },
      },
    },
    planner: {
      before_noBrief_mapHeuristics: planSummary(legacyPlan),
      after_briefVerbatim: planSummary(planVerbatim),
      after_briefWithTradition: planSummary(planNamed),
      after_answeringFeltPulseHalfTime: planSummary(planAnswered),
      hintsEvidence: { verbatim: hintsVerbatim.evidence, withTradition: hintsNamed.evidence },
    },
    fingerprintGrammar: {
      before_a751796_onThisFixture: {
        note: "captured in this session by running a751796's deriveStyleGrammar on the fixture: eleven rules, five of them weight 1 from zero data (no transcribed notes)",
        rules: [["chord-extensions", 1], ["onset-density", 1, "target 0"], ["phrase-length", 1, "0 beats"], ["stepwise-motion", 1, "target 0"], ["functional-motion", 0.883], ["density", 0.8, "0 notes per bar"], ["syncopation", 0.667, "target 0"], ["energy-arc", 0.6], ["dynamic-range", 0.5, "0-0"], ["harmonic-rhythm", 0.233], ["ornamentation", 0.2, "target 0"]],
      },
      after: grammarTable(fpGrammar),
    },
    projections: {
      styleSpec_withTradition: { vocabulary: specNamed.grammar?.vocabulary, era: specNamed.era, rhythm: specNamed.rhythm, harmonyVoicing: specNamed.harmony.voicing, dynamicsRange: specNamed.dynamics.range, preferredFamilies: specNamed.instrumentation.preferredFamilies, styleResolution: specNamed.styleResolution },
      styleSpec_unknownStyleText: { vocabulary: specLegacyText.grammar?.vocabulary, styleResolution: specLegacyText.styleResolution },
      performanceStyle_withTradition: perfNamed,
      performanceStyle_verbatim: perfVerbatim,
      slot_withTradition: styleGrammarSlot(resNamed.grammar),
    },
    research: {
      fixtureProvider: {
        run: researched.researchRun,
        counts: researched.research,
        filled: ["groove.feltPulse", "harmony.modalFlavour", "bass.motion", "identity.era", "keys.voicingWidth"].map((path) => ({ path, before: getStyleValue(resNamed.grammar, path as never) ?? null, after: getStyleValue(researched.grammar, path as never) ?? null })),
        questionsAfter: researched.questions.map((q) => q.id),
        note: "every fixture citation is labelled FIXTURE; this exercises the gate and the merge, it is not research about the owner's world",
      },
      liveProvider: live.state === "not_configured" ? { state: live.state, missing: live.missing, requiredEnv: [...LIVE_STYLE_RESEARCH_REQUIRED_ENV], reason: live.reason } : { state: live.state },
    },
    ruleKindLedger: RULE_KIND_LEDGER,
    consumers,
    knowledgeBase: { entries: knowledge, fieldsFilledByAnyEntry: [...new Set(STYLE_KNOWLEDGE_ENTRIES.flatMap((e) => styleCandidatesFromKnowledge(e, STYLE_KNOWLEDGE_ENTRIES).map((c) => c.path)))].length, totalFields: STYLE_PATHS.length },
    capabilityLadder: {
      "Style intelligence as one contract (StyleGrammar)": "INTEGRATED + TESTED (unit): sectioned contract with confidence/provenance per value; read on the production path by briefPlannerHints -> plannerHintsForJob -> the planner's pickStyle/pickAesthetic/pickGroove, by createStyleSpec (materializeCandidate) and by performanceStyleFromProfile (provider, scoped regeneration). Not BENCHMARKED, not VALIDATED ON OUTPUT: no arrangement was rendered under it.",
      "Modular knowledge base (genres as data)": "IMPLEMENTED + TESTED (schema validation, matching): 14 entries; one owner-world entry; every era unknown.",
      "Resolver with ten-level walk and questions": "IMPLEMENTED + TESTED: deterministic; owner's brief yields two questions.",
      "Research -> constraints": "IMPLEMENTED + TESTED with the fixture provider only; the live provider is an explicit not_configured state (no transport, no live call).",
      "13 unconsumed rule kinds": "resolved: 2 consumed as slot rules, 11 re-homed as section values (7 of them with a production consumer), 2 deleted (energy-arc, density).",
    },
    changesNeededInFilesNotOwned: [
      { file: "artifacts/api-server/src/lib/arrangementOrchestrator.ts", where: "styleGrammarFor(...)", proposal: "merge the job's brief grammar with the song's fingerprint: `resolveStyle({ prior: plannerHints?.global?.styleGrammar, fingerprint })` instead of the fingerprint alone, so the composer slot and the planner read one grammar (today the slot is fingerprint-only, the planner brief-first)." },
      { file: "artifacts/api-server/src/lib/partGenerationContextV2.ts", where: "PartGenerationRequestV2", proposal: "carry the sectioned grammar (`style?: StyleGrammar`) beside the rule slot, so B-02 (harmony.*, keys.voicingWidth, harmony.parallelism), B-04 (groove.*, bass.*, arrangement.silenceConventions) and B-10 (melodic.*) read values instead of rules." },
      { file: "artifacts/api-server/src/lib/arrangementArc.ts", where: "templateForStyle / deriveArrangementArc", proposal: "one-line adapter: when `hints.styleGrammar?.arrangement.textureLadder` exists (template provenance), use it as the function -> texture defaults instead of the built-in template's ladder; `arrangement.arcTemplate` already reaches the arc through briefToPlanner." },
      { file: "artifacts/api-server/src/lib/arrangementGeneration.ts", where: "materializeCandidate / createStyleSpec call", proposal: "pass the job's brief grammar (`briefHints.global.styleGrammar`) as the fourth argument so the persisted StyleSpec is the brief's projection, not the style string's." },
      { file: "artifacts/api-server/src/lib/musicCritic.ts", where: "wantsHook whitelist", proposal: "read `grammar.melodic.hookExpectation` instead of `[\"pop\",\"rock\",\"dance\"].includes(style)`." },
      { file: "artifacts/api-server/src/lib/voiceLeading.ts", where: "cost table", proposal: "B-02: scale `parallelPerfect` by `harmony.parallelism` (avoid / tolerated / characteristic)." },
      { file: "artifacts/api-server/src/lib/soundSelectionBrain.ts", where: "sound selection", proposal: "read `sound.referenceInstruments` and `strings.*` / `brassWinds.*` roles when choosing assets (B-03)." },
      { file: "artifacts/api-server/scripts/run-focused-api-tests.mjs", where: "whole file", proposal: "REPAIRED IN THIS PR (not a proposal): main carried the file twice after #120 (node --check failed: 'spawn' declared twice); the pre-B-01 file was kept and B-01's two entries ported into it." },
    ],
    honestLimits: [
      "Knowledge base coverage: 14 entries written by the B-09 specialist from common practice, not measured from a corpus; one entry (chassidic ballad) is the owner's world by proximity to his own production, not reviewed line by line by him; the simcha entry is a sketch; era is unknown everywhere; genres outside the list (blues, country, reggae, funk, classical, klezmer...) resolve to no entry and stay unknown.",
      "Research is unwired: the live provider is an interface with a not_configured state and the env vars it would need; only the fixture provider ran, and its citations are labelled FIXTURE. No claim about a style was researched.",
      "Two grammars can exist on one job: the planner reads the brief's grammar (hints), the composer slot still comes from the fingerprint alone (arrangementOrchestrator.styleGrammarFor, not owned) - see changesNeededInFilesNotOwned.",
      "Consumers not yet reading some sections: strings.*, brassWinds.*, keys.chordRhythm/pedal/role, bass.motion/register/sustain/lockToKick, harmony.modalFlavour/parallelism/cadenceLanguage/passingChords/harmonicRhythm/chordsPerBar/functionalMotion, melodic.phraseLength/stepwiseRatio/pitchSystem/hookExpectation, arrangement.textureLadder/silenceConventions/registerTendency/doubling, performance.articulationVocabulary/velocityRange/humanise, sound.referenceInstruments/roomSize/saturation/stereo, identity.era/region/ensembleType carry values with nobody on the production path reading them (B-02/B-03/B-04/B-10).",
      "The owner's fixture has no transcribed notes, so every groove / melody / dynamics measurement is unknown there; the fingerprint path was exercised on synthetic fingerprints in styleGrammar.test.ts.",
      "Nothing was rendered or listened to under the new grammar; the plan-level change on the owner's song (style unknown -> ballad, groove four_on_floor -> steady_pulse) is a planner decision, not a validated musical result.",
      "createStyleSpec now resolves the style string against the knowledge base: for style strings the knowledge base knows, the legacy StyleSpec vocabulary (and therefore styleGrammarEvidenceSha256 and the legacy composer's deterministic seed) changes; for unknown strings it is byte-identical to before.",
      "performanceStyleFromProfile now resolves the profile with the knowledge base: a profile that names a known genre gains performance values it never stated (e.g. jazz -> swing 0.62, behind); each carries its provenance in `sources`.",
    ],
  };
  process.stdout.write(JSON.stringify(doc, null, 2));
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
