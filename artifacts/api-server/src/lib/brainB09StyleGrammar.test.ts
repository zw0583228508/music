/**
 * Brain B-09 on the owner's song "רחם נא" (Song Model v3 fixture, C minor,
 * 130.43 BPM, 92 chords) and the owner's brief. What this guards:
 *
 *   - the brief resolves to one StyleGrammar with confidence and provenance
 *     per value, the owner's world (chassidic ballad) when the tradition is
 *     named, the generic ballad when it is not;
 *   - "soft strings, gentle bass" is a *global* low-dynamic decision the
 *     grammar carries (B-01's request), and the planner reads it;
 *   - the planner's style / aesthetic / groove come from the grammar first:
 *     before B-09 the owner's ballad planned as style `unknown` and groove
 *     `four_on_floor` (130 BPM, no syncopation); now `ballad` / `steady_pulse`,
 *     and the plan records where each decision came from;
 *   - at most two questions, and they are the right ones (the felt pulse at
 *     130 BPM; narrow or wide dynamics for an "intimate" song with a
 *     "big final chorus");
 *   - the StyleSpec, PerformanceStyle and the Q-02 slot are projections of
 *     the same grammar.
 */
import assert from "node:assert/strict";
import test from "node:test";
import { deriveGlobalArrangementPlan } from "./globalArrangementPlanner";
import { createStyleSpec } from "./musicEngines";
import { performanceStyleFromGrammar, performanceStyleFromProfile } from "./performanceEngine";
import { compileProductionBrief } from "./producerIntelligence/briefCompiler";
import { briefPlannerHints, resolveBriefStyle } from "./producerIntelligence/briefToPlanner";
import { extractUserIntentSync } from "./producerIntelligence/intentExtraction";
import { resolveStyleProfile } from "./producerIntelligence/styleResolution";
import { deriveStyleFingerprint } from "./styleFingerprint";
import { STYLE_PATHS, deriveStyleGrammar, getStyleValue, styleGrammarSlot } from "./styleGrammar";
import { answerStyleQuestion, resolveStyle } from "./styleResolver";
import { RACHEM_NA_FIXED_NOW as NOW, rachemNaSongModel } from "./__fixtures__/rachemNaSongModelV3";

export const OWNER_BRIEF = "intimate ballad; piano, soft strings, gentle bass, light percussion; big final chorus";
export const OWNER_BRIEF_WITH_TRADITION = "intimate chassidic ballad; piano, soft strings, gentle bass, light percussion; big final chorus";

function ownerBrief(text: string, model = rachemNaSongModel()) {
  const intent = extractUserIntentSync(text, { now: NOW });
  const profile = resolveStyleProfile(intent, { now: NOW });
  return { brief: compileProductionBrief(intent, profile, model, [], { now: NOW }), profile };
}

test("the owner's brief resolves to one grammar: the brief's words are `brief`, the chassidic ballad's conventions `template`, the song's chords `fingerprint`; the era stays unknown", () => {
  const model = rachemNaSongModel();
  const { brief } = ownerBrief(OWNER_BRIEF_WITH_TRADITION, model);
  const res = resolveBriefStyle(brief, { songModel: model });
  assert.equal(res.knowledge.entry, "chassidic_ballad");
  assert.deepEqual(res.knowledge.chain, ["ballad", "chassidic_ballad"]);
  const g = res.grammar;
  assert.equal(g.identity.genre?.value, "ballad");
  assert.equal(g.identity.genre?.provenance, "brief");
  assert.equal(g.identity.tradition?.value, "hasidic");
  assert.equal(g.identity.tradition?.provenance, "brief");
  assert.equal(g.identity.era, undefined, "nobody said the era; the knowledge base does not guess it");
  assert.equal(g.harmony.extensions?.value, "triads");
  assert.ok(g.harmony.extensions!.sourceRefs!.some((r) => r.startsWith("fingerprint:")) && g.harmony.extensions!.sourceRefs!.some((r) => r.startsWith("knowledge:")), "the song's 92 chords corroborate the style's triads");
  assert.equal(g.harmony.modalFlavour?.value, "harmonic_minor");
  assert.equal(g.harmony.modalFlavour?.provenance, "template");
  assert.equal(g.groove.family?.value, "straight");
  assert.equal(g.strings.role?.value, "pad");
  assert.equal(g.sound.aesthetic?.value, "intimate");
  assert.equal(g.sound.aesthetic?.provenance, "brief");
  // "soft strings, gentle bass": a global low-dynamic decision the grammar owns.
  assert.equal(g.arrangement.globalDynamic?.value, "low");
  assert.equal(g.arrangement.globalDynamic?.provenance, "brief");
  // Absent evidence is unknown: the fixture has no transcribed notes, so no swing, no microtiming, no velocity range.
  for (const path of ["groove.swingRatio", "groove.microtimingMs", "performance.velocityRange", "melodic.stepwiseRatio"] as const) {
    assert.equal(getStyleValue(g, path), undefined, `${path} stays unknown`);
  }
  assert.ok(g.omitted.some((o) => /no onset evidence/.test(o)));
  const known = STYLE_PATHS.length - g.unknown.length;
  assert.ok(known >= 50, `most of the contract is filled for the owner's world: ${known} of ${STYLE_PATHS.length}`);
  for (const path of STYLE_PATHS) {
    const v = getStyleValue(g, path);
    if (v) assert.ok(v.confidence >= 0.15 && v.confidence <= 1 && v.provenance, path);
  }
});

test("the questions are the right two, and no more: the felt pulse at 130 BPM, and narrow-or-wide dynamics for an intimate song with a big final chorus", () => {
  const model = rachemNaSongModel();
  const named = resolveBriefStyle(ownerBrief(OWNER_BRIEF_WITH_TRADITION, model).brief, { songModel: model });
  assert.ok(named.questions.length <= 2, named.questions.map((q) => q.id).join(", "));
  assert.deepEqual(named.questions.map((q) => q.path).sort(), ["groove.feltPulse", "performance.dynamics"]);
  const dynamics = named.questions.find((q) => q.path === "performance.dynamics")!;
  assert.equal(dynamics.reason, "contested");
  assert.deepEqual(dynamics.options.map((o) => o.value).sort(), ["narrow", "wide"]);
  assert.ok(named.flags.includes("tempo_mismatch"));

  // Without the tradition the brief still asks about the pulse, and which world the ballad belongs to.
  const verbatim = resolveBriefStyle(ownerBrief(OWNER_BRIEF, model).brief, { songModel: model });
  assert.equal(verbatim.knowledge.entry, "ballad");
  assert.ok(verbatim.questions.length <= 2);
  assert.deepEqual(verbatim.questions.map((q) => q.path).sort(), ["groove.feltPulse", "identity.tradition"]);
  assert.ok(verbatim.questions.find((q) => q.path === "identity.tradition")!.options.some((o) => o.value === "hasidic"));
});

test("the planner reads the grammar first: the owner's ballad is `ballad` / `steady_pulse` / `intimate` with provenance, where the map's heuristic said `unknown` / `four_on_floor`", () => {
  const model = rachemNaSongModel();
  const legacy = deriveGlobalArrangementPlan(model, { now: NOW });
  assert.equal(legacy.style, "unknown");
  assert.equal(legacy.grooveStrategy, "four_on_floor", "130 BPM with no measured syncopation reads as four-on-the-floor to the map");
  assert.deepEqual(legacy.styleDecisions, { styleGrammarSha256: null, style: "map_heuristic", productionAesthetic: "map_heuristic", grooveStrategy: "map_heuristic" });

  const hints = briefPlannerHints(ownerBrief(OWNER_BRIEF, model).brief, { songModel: model });
  assert.ok(hints.global.styleGrammar, "the grammar rides on the hints");
  assert.equal(hints.global.globalDynamicSteps, -1, "soft / gentle: every section one marking down");
  assert.equal(hints.global.arcTemplate, "intimate_ballad");
  assert.deepEqual(hints.global.familyPriority, ["bass", "percussion", "keys", "strings"], "the brief's tiers, unchanged from B-01");
  assert.ok(hints.evidence.some((e) => /style grammar arrangement\.globalDynamic=low/.test(e)));
  assert.equal(hints.style?.knowledgeEntry, "ballad");

  const plan = deriveGlobalArrangementPlan(model, { now: NOW, hints: hints.global });
  assert.equal(plan.style, "ballad");
  assert.equal(plan.grooveStrategy, "steady_pulse");
  assert.equal(plan.productionAesthetic, "intimate");
  assert.equal(plan.styleDecisions?.style, "brief");
  assert.equal(plan.styleDecisions?.grooveStrategy, "template");
  assert.equal(plan.styleDecisions?.styleGrammarSha256, hints.global.styleGrammar!.inputsDigestSha256);
  assert.equal(plan.arc?.template?.id, "intimate_ballad");
  assert.equal(plan.climax?.sectionName, "Chorus 3", "B-01's climax decision is untouched");

  // Answering the pulse question moves the groove: 130 felt as 65 is a half-time feel.
  const answered = answerStyleQuestion({ brief: ownerBrief(OWNER_BRIEF, model).brief, song: { tempoBpm: 130.43 } }, { path: "groove.feltPulse" }, "half_time");
  const halfTime = deriveGlobalArrangementPlan(model, { now: NOW, hints: { ...hints.global, styleGrammar: answered.grammar } });
  assert.equal(halfTime.grooveStrategy, "half_time_feel");
  assert.equal(halfTime.styleDecisions?.grooveStrategy, "brief");
  assert.notEqual(halfTime.inputsDigestSha256, plan.inputsDigestSha256, "a different grammar is a different plan");
});

test("StyleSpec, PerformanceStyle and the Q-02 slot are projections of the same grammar", () => {
  const model = rachemNaSongModel();
  const { brief, profile } = ownerBrief(OWNER_BRIEF_WITH_TRADITION, model);
  const grammar = resolveBriefStyle(brief, { songModel: model }).grammar;

  const spec = createStyleSpec("intimate chassidic ballad", { density: 0.4, harmonyComplexity: 3, energy: 0.4 }, null, grammar);
  assert.equal(spec.grammar?.vocabulary.groove, "straight");
  assert.equal(spec.grammar?.vocabulary.articulation, "legato");
  assert.equal(spec.grammar?.vocabulary.instrumentation, "hybrid");
  assert.equal(spec.grammar?.vocabulary.transitions, "orchestral_swell");
  assert.equal(spec.grammar?.vocabulary.development, "additive");
  assert.equal(spec.grammar?.vocabulary.fills, "none", "rare fills under swells: none");
  assert.equal(spec.harmony.voicing, "open");
  assert.equal(spec.era, "unknown", "no source named an era, and the spec no longer says 'modern' by default");
  assert.equal(spec.styleResolution?.inputsDigestSha256, grammar.inputsDigestSha256);
  assert.equal(spec.styleResolution?.provenance.groove, "template");
  assert.equal(spec.styleResolution?.provenance.swing, "default", "no swing was measured or stated: the legacy 0 is labelled a default");
  // With no grammar passed, the style string alone reaches the same knowledge entry.
  const fromText = createStyleSpec("intimate chassidic ballad", { density: 0.4, harmonyComplexity: 3, energy: 0.4 });
  assert.equal(fromText.grammar?.vocabulary.groove, "straight");
  assert.ok(fromText.styleResolution?.sources.some((s) => s === "knowledge:chassidic_ballad"));
  // Legacy behaviour is preserved where the grammar knows nothing.
  const unknownStyle = createStyleSpec("polka", { density: 0.4, harmonyComplexity: 3, energy: 0.4 });
  assert.equal(unknownStyle.grammar?.vocabulary.groove, "straight");
  assert.ok(Object.values(unknownStyle.styleResolution!.provenance).every((p) => p === "default"));

  const perf = performanceStyleFromGrammar(grammar);
  assert.equal(perf.dynamics, "wide", "the chassidic ballad builds to its last chorus (the brief's 'intimate' only implied narrow)");
  assert.equal(perf.fillFrequency, "rare");
  assert.equal(perf.articulationLanguage, "legato");
  assert.equal(perf.melodicOrnamentation, "moderate");
  assert.equal(perf.bassAttackPosition, "sustained");
  assert.equal(perf.swingRatio, undefined, "nothing measured or stated a swing");
  assert.ok(perf.sources!.every((s) => ["brief", "template"].includes(s.provenance)));
  // The deprecated profile path is the same projection after resolving the profile.
  const viaProfile = performanceStyleFromProfile(profile);
  assert.equal(viaProfile.fillFrequency, "rare");
  assert.equal(viaProfile.dynamics, "wide", "the profile names the tradition, so it resolves to the chassidic ballad too");
  const viaVerbatimProfile = performanceStyleFromProfile(ownerBrief(OWNER_BRIEF, model).profile);
  assert.equal(viaVerbatimProfile.dynamics, "narrow", "without the tradition the generic ballad's knowledge does not contest the implied 'narrow'");
  assert.equal(viaVerbatimProfile.articulationLanguage, "legato", "the generic ballad still adds what it knows");

  const slot = styleGrammarSlot(grammar);
  assert.equal(slot.status, "not_available", "no measured swing or microtiming: the composer's groove pass has nothing to apply and is told so");
});

test("the fingerprint-only grammar of the owner's song no longer manufactures instructions out of missing notes", () => {
  const model = rachemNaSongModel();
  const fp = deriveStyleFingerprint({ source: { kind: "song_model", id: "rachem-na", version: null }, songModel: model, tempoBpm: 130.43, meter: "4/4" });
  const grammar = deriveStyleGrammar(fp);
  // Before B-09: eleven rules, five of them weight 1 from zero data ("phrases of 0 beats", "velocities 0-0").
  assert.deepEqual(grammar.rules, []);
  assert.equal(grammar.harmony.extensions?.value, "triads");
  assert.equal(grammar.harmony.functionalMotion?.value, 0.659);
  assert.equal(grammar.melodic.phraseLengthBeats, undefined);
  assert.equal(grammar.performance.dynamics, undefined);
  assert.equal(styleGrammarSlot(grammar).status, "not_available");
  // And the same measurements merge with the brief's grammar without changing what the brief decided.
  const merged = resolveStyle({ brief: ownerBrief(OWNER_BRIEF_WITH_TRADITION, model).brief, fingerprint: fp });
  assert.equal(merged.grammar.identity.genre?.value, "ballad");
  assert.equal(merged.grammar.harmony.extensions?.value, "triads");
});
