import assert from "node:assert/strict";
import test from "node:test";
import type { StyleProfile } from "@workspace/db";
import { compileProductionBrief } from "./producerIntelligence/briefCompiler";
import { extractUserIntentSync } from "./producerIntelligence/intentExtraction";
import { resolveStyleProfile } from "./producerIntelligence/styleResolution";
import { STYLE_FIELDS, STYLE_LEVELS, STYLE_PATHS, getStyleValue } from "./styleGrammar";
import {
  MAX_STYLE_QUESTIONS,
  answerStyleQuestion,
  grooveStrategyOfFamily,
  questionGain,
  resolveStyle,
  styleCandidatesFromBrief,
  styleCandidatesFromStyleText,
  styleQuestions,
} from "./styleResolver";

const NOW = new Date("2026-09-10T00:00:00.000Z");

function briefFor(text: string) {
  const intent = extractUserIntentSync(text, { now: NOW });
  const profile = resolveStyleProfile(intent, { now: NOW });
  return compileProductionBrief(intent, profile, undefined, [], { now: NOW });
}

test("resolution is deterministic: the same inputs give the same grammar, digest, walk and questions", () => {
  const brief = briefFor("a swinging jazz standard, piano trio with tenor sax");
  const a = resolveStyle({ brief, song: { tempoBpm: 140 } });
  const b = resolveStyle({ brief, song: { tempoBpm: 140 } });
  assert.deepEqual(a, b);
  assert.equal(a.inputsDigestSha256, a.grammar.inputsDigestSha256);
  assert.notEqual(a.inputsDigestSha256, resolveStyle({ brief: briefFor("a rock song") }).inputsDigestSha256);
});

test("the ten-level walk: what the brief said is `brief`, what the knowledge base added is `template`, what nobody knows is unknown", () => {
  const res = resolveStyle({ brief: briefFor("a swinging jazz standard, piano trio with tenor sax") });
  assert.equal(res.knowledge.entry, "jazz_standard");
  assert.deepEqual(res.walk.map((w) => w.level), [...STYLE_LEVELS]);
  const byLevel = new Map(res.walk.map((w) => [w.level, w]));
  assert.equal(byLevel.get("era")!.status, "unknown");
  assert.match(byLevel.get("era")!.note!, /does not guess/);
  assert.equal(byLevel.get("tradition")!.status, "unknown");
  assert.ok(byLevel.get("genre")!.from.includes("brief") && byLevel.get("rhythmic")!.from.includes("template"));
  assert.equal(res.grammar.groove.family?.value, "swung");
  // "swinging" reached the profile as a vocabulary implication, so it ranks with the knowledge base:
  // the more confident jazz entry wins the provenance and the brief's word corroborates it.
  assert.equal(res.grammar.groove.family?.provenance, "template");
  assert.ok(res.grammar.groove.family!.sourceRefs!.some((r) => r.startsWith("knowledge:jazz_standard")) && res.grammar.groove.family!.sourceRefs!.some((r) => r.startsWith("brief:")));
  assert.ok(res.grammar.groove.family!.confidence > 0.9, "two agreeing sources corroborate");
  assert.equal(res.grammar.bass.motion?.value, "walking");
  assert.equal(res.grammar.bass.motion?.provenance, "template");
  assert.equal(res.grammar.harmony.extensions?.value, "extended");
  assert.equal(res.grammar.identity.era, undefined);
  assert.ok(res.grammar.unknown.includes("identity.era"));
  // Every value of the grammar carries confidence and provenance.
  for (const path of STYLE_PATHS) {
    const v = getStyleValue(res.grammar, path);
    if (!v) continue;
    assert.ok(v.confidence > 0 && v.confidence <= 1, `${path} confidence`);
    assert.ok(["brief", "fingerprint", "template", "research", "default"].includes(v.provenance), `${path} provenance`);
  }
});

test("the brief's global energy words become the grammar's global dynamic; the instrumentation tiers become the family priority; rejected dimensions are skipped", () => {
  const brief = briefFor("quiet and gentle, piano and cello, not too busy");
  const { candidates, terms } = styleCandidatesFromBrief(brief);
  const dynamic = candidates.find((c) => c.path === "arrangement.globalDynamic")!;
  assert.equal(dynamic.value, "low");
  assert.equal(dynamic.provenance, "brief");
  const texture = candidates.find((c) => c.path === "arrangement.globalTexture")!;
  assert.equal(texture.value, "thin", "\"not too busy\" is a boundary: thinner, not fuller");
  const priority = candidates.find((c) => c.path === "arrangement.familyPriority")!;
  assert.deepEqual(priority.value, ["keys", "strings"]);
  assert.ok(terms.some((t) => t.slot === "word" && t.term === "energy=low"));
  assert.ok(terms.some((t) => t.slot === "word" && t.term === "instrument=keys"));
});

test("a free-text style string only contributes words the knowledge base knows; anything else stays unknown", () => {
  const known = styleCandidatesFromStyleText("cinematic jazz ballad");
  const terms = known.terms.map((t) => `${t.slot}:${t.term}`);
  for (const expected of ["aesthetic:cinematic", "genre:ballad", "genre:jazz"]) assert.ok(terms.includes(expected), `${expected} in ${terms.join(", ")}`);
  assert.equal(known.candidates.find((c) => c.path === "sound.aesthetic")?.value, "cinematic");
  // Synonyms and Hebrew go through the producer lexicon: "chassidic" and "חסידי" both name the tradition `hasidic`.
  assert.ok(styleCandidatesFromStyleText("intimate chassidic ballad").terms.some((t) => t.slot === "tradition" && t.term === "hasidic"));
  assert.ok(styleCandidatesFromStyleText("בלדה חסידית").terms.some((t) => t.slot === "tradition" && t.term === "hasidic"));
  assert.equal(resolveStyle({ styleText: "בלדה חסידית" }).knowledge.entry, "chassidic_ballad");
  assert.deepEqual(styleCandidatesFromStyleText("something nobody has heard of"), { candidates: [], terms: [] });
  const res = resolveStyle({ styleText: "gospel" });
  assert.equal(res.knowledge.entry, "gospel");
  assert.equal(res.grammar.identity.genre?.provenance, "brief");
  assert.equal(res.grammar.harmony.extensions?.value, "extended");
  assert.equal(resolveStyle({ styleText: "polka" }).knowledge.entry, null);
});

test("a bare StyleProfile resolves like a brief, and an out-of-vocabulary dimension value is dropped, not carried", () => {
  const profile = {
    version: "1.0", derivedAt: "", inputsDigestSha256: "p".repeat(64), method: "t", exclusions: [], conflicts: [], sources: [], confidence: 0.5,
    dimensions: {
      genre: { value: "rock", confidence: 0.9, provenance: "stated" },
      swingRatio: { value: 0.62, confidence: 0.8, provenance: "stated" },
      dynamics: { value: "nonsense", confidence: 0.9, provenance: "stated" },
    },
  } as unknown as StyleProfile;
  const res = resolveStyle({ styleProfile: profile });
  assert.equal(res.knowledge.entry, "rock");
  assert.equal(res.grammar.groove.swingRatio?.value, 0.62);
  assert.equal(res.grammar.performance.dynamics?.provenance, "template", "the profile's nonsense was dropped; rock's moderate stands");
  assert.ok(res.grammar.omitted.some((o) => /performance\.dynamics: nonsense/.test(o)));
});

test("questions: a well-specified brief yields none; an empty one asks what the music is, how it moves and how far its dynamics travel; never more than three", () => {
  const rock = resolveStyle({ brief: briefFor("a driving rock song, electric guitars, drums and bass, raw and loud") });
  assert.deepEqual(rock.questions, [], `rock asks nothing: ${rock.questions.map((q) => q.id).join(", ")}`);
  const jazz = resolveStyle({ brief: briefFor("a swinging jazz standard, piano trio with tenor sax"), song: { tempoBpm: 140 } });
  assert.deepEqual(jazz.questions, [], "no tempo mismatch, no tradition question for a world with no sub-worlds");

  const empty = resolveStyle({ brief: briefFor("make it nice") });
  assert.deepEqual(empty.questions.map((q) => q.path).sort(), ["groove.family", "identity.genre", "performance.dynamics"]);
  assert.ok(empty.questions.length <= MAX_STYLE_QUESTIONS);
  for (const q of empty.questions) {
    assert.ok(q.options.length >= 2);
    assert.ok(q.consumers.length > 0, "only consumed fields are asked about");
    assert.ok(q.prompt.en && q.prompt.he);
    for (const option of q.options) assert.ok(option.changes[0].consumers.length > 0 && option.changes[0].effect);
  }
  const genre = empty.questions.find((q) => q.path === "identity.genre")!;
  assert.ok(genre.options.some((o) => o.value === "ballad") && genre.options.some((o) => o.value === "jazz"), "the options are the worlds the knowledge base knows");
});

test("questions: a generic ballad with no tradition asks which world; the felt pulse is asked only when the measured tempo contradicts the style's felt tempo", () => {
  const ballad = briefFor("an intimate ballad with piano and strings");
  const noTempo = resolveStyle({ brief: ballad });
  assert.deepEqual(noTempo.questions.map((q) => q.path), ["identity.tradition"]);
  assert.deepEqual(noTempo.flags, ["generic_knowledge_entry"]);
  const fast = resolveStyle({ brief: ballad, song: { tempoBpm: 130 } });
  assert.deepEqual(fast.questions.map((q) => q.path).sort(), ["groove.feltPulse", "identity.tradition"]);
  assert.ok(fast.flags.includes("tempo_mismatch"));
  const slow = resolveStyle({ brief: ballad, song: { tempoBpm: 66 } });
  assert.ok(!slow.questions.some((q) => q.path === "groove.feltPulse"));
  const pulse = fast.questions.find((q) => q.path === "groove.feltPulse")!;
  assert.deepEqual(pulse.options.map((o) => o.value), ["as_written", "half_time"]);
  assert.match(pulse.options[1].changes[0].effect, /half_time_feel/);
});

test("answering a question settles the field as a stated brief value and removes the question", () => {
  const ballad = briefFor("an intimate ballad with piano and strings");
  const before = resolveStyle({ brief: ballad, song: { tempoBpm: 130 } });
  const after = answerStyleQuestion({ brief: ballad, song: { tempoBpm: 130 } }, { path: "groove.feltPulse" }, "half_time");
  assert.equal(after.grammar.groove.feltPulse?.value, "half_time");
  assert.equal(after.grammar.groove.feltPulse?.provenance, "brief");
  assert.ok(!after.questions.some((q) => q.path === "groove.feltPulse"));
  assert.ok(after.questions.length < before.questions.length);
  assert.equal(grooveStrategyOfFamily("swung"), "swing");
  assert.equal(grooveStrategyOfFamily("maqsum"), "syncopated");
  assert.equal(grooveStrategyOfFamily("backbeat"), "steady_pulse");
  // A bad answer changes nothing. B-18: "nothing" is now the ballad entry's own
  // pulse convention (130 BPM is outside a ballad's 50-108 written band, so the
  // style reads it as half time) rather than an absent value - the plan gets a
  // musical default and the producer is still asked.
  const bad = answerStyleQuestion({ brief: ballad, song: { tempoBpm: 130 } }, { path: "groove.feltPulse" }, "sideways").grammar.groove.feltPulse;
  assert.equal(bad?.value, "half_time");
  assert.equal(bad?.provenance, "template", "a rejected answer leaves the style's convention in place, never a stated value");
});

test("information gain: unknown consumed fields score by reach; a contested stated value is asked about only when the dissent is strong; an unconsumed field is never asked", () => {
  assert.equal(questionGain("groove.family", undefined, undefined), 0.8);
  assert.equal(questionGain("harmony.modalFlavour", undefined, undefined), 0, "no consumer, no question");
  const stated = { value: "intimate", confidence: 0.7, provenance: "brief" as const, sourceRefs: ["text:intimate"] };
  const implied = { ...stated, sourceRefs: ["vocab:production.intimate", "text:intimate"] };
  const conflict = { path: "sound.aesthetic" as const, chosen: { value: "intimate", confidence: 0.7, provenance: "brief" as const }, alternatives: [{ value: "polished_pop", confidence: 0.4, provenance: "template" as const }] };
  assert.ok(questionGain("sound.aesthetic", stated, conflict) < questionGain("sound.aesthetic", implied, conflict));
  assert.equal(questionGain("sound.aesthetic", stated, undefined), 0, "a settled value with no dissent is not a question");
  const none = styleQuestions({ grammar: resolveStyle({}).grammar, knowledge: { entry: null, chain: [], unknownLevels: [...STYLE_LEVELS], ranked: [] }, flags: [] });
  assert.ok(none.every((q) => STYLE_FIELDS[q.path].consumers.length > 0));
});
