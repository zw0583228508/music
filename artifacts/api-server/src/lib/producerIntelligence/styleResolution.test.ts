import assert from "node:assert/strict";
import test from "node:test";
import { extractUserIntentSync } from "./intentExtraction";
import {
  STYLE_PROFILE_VERSION,
  UNIVERSAL_VOCABULARY_RULES,
  UNIVERSAL_VOCABULARY_SOURCE,
  populatedDimensions,
  resolveStyleProfile,
  type StyleKnowledgeSource,
} from "./styleResolution";

const NOW = new Date("2026-01-01T00:00:00.000Z");
const profileOf = (text: string, options = {}) =>
  resolveStyleProfile(extractUserIntentSync(text, { now: NOW }), { now: NOW, ...options });

test("dimensions are independent: an era alone populates era and nothing about genre", () => {
  const profile = profileOf("80s");
  assert.equal(profile.version, STYLE_PROFILE_VERSION);
  assert.equal(profile.dimensions.era?.value, "1980s");
  assert.equal(profile.dimensions.era?.provenance, "stated");
  assert.equal(profile.dimensions.genre, undefined);
  assert.equal(profile.dimensions.tradition, undefined);
  assert.deepEqual(populatedDimensions(profile), ["era"]);
});

test("no dimension is fabricated: an empty intent yields an empty profile", () => {
  const profile = profileOf("");
  assert.deepEqual(profile.dimensions, {});
  assert.equal(profile.confidence, 0);
  assert.deepEqual(profile.sources, [UNIVERSAL_VOCABULARY_SOURCE.id]);
});

test("the vocabulary implies fine dimensions as inferred, citing the rule and the word", () => {
  const profile = profileOf("a cinematic ballad");
  assert.equal(profile.dimensions.genre?.value, "ballad");
  assert.equal(profile.dimensions.genre?.provenance, "stated");
  assert.equal(profile.dimensions.soundAesthetic?.value, "cinematic");
  const dynamics = profile.dimensions.dynamics;
  assert.equal(dynamics?.value, "wide");
  assert.equal(dynamics?.provenance, "inferred");
  assert.ok(dynamics!.sourceRefs!.includes("vocab:production.cinematic"));
  assert.ok(dynamics!.sourceRefs!.some((r) => r === "text:cinematic"));
  assert.equal(profile.dimensions.tempoBehavior?.value, "slow");
  assert.equal(profile.dimensions.roomSize?.value, "large");
  for (const dim of Object.values(profile.dimensions)) {
    assert.ok(dim.confidence > 0 && dim.confidence <= 1);
  }
});

test("a ruled-out value never populates a dimension", () => {
  const profile = profileOf("not too poppy, 80s");
  assert.equal(profile.dimensions.genre, undefined);
  assert.deepEqual(profile.exclusions, [{ dimension: "genre", value: "pop", sourceRefs: ["text:not too poppy"] }]);
  assert.equal(profile.dimensions.era?.value, "1980s");
});

test("researched findings never outrank stated intent, but do outrank vocabulary inference", () => {
  const research: StyleKnowledgeSource = {
    id: "fake-research/v1",
    lookup: () => [
      { dimension: "soundAesthetic", value: "electronic", confidence: 0.99, provenance: "researched", sourceRefs: ["research:doc-1"] },
      { dimension: "roomSize", value: "hall", confidence: 0.6, provenance: "researched", sourceRefs: ["research:doc-2"] },
    ],
  };
  const profile = profileOf("cinematic and acoustic", { knowledge: [UNIVERSAL_VOCABULARY_SOURCE, research] });
  assert.notEqual(profile.dimensions.soundAesthetic?.value, "electronic", "research cannot override a stated aesthetic");
  assert.equal(profile.dimensions.soundAesthetic?.provenance, "stated");
  assert.ok(profile.conflicts.find((c) => c.dimension === "soundAesthetic")?.values.includes("electronic"));
  assert.equal(profile.dimensions.roomSize?.value, "hall", "research beats the vocabulary's inferred 'large'");
  assert.equal(profile.dimensions.roomSize?.provenance, "researched");
  assert.deepEqual(profile.sources, [UNIVERSAL_VOCABULARY_SOURCE.id, "fake-research/v1"]);
});

test("pre-fetched findings (an async research agent) are merged the same way", () => {
  const profile = profileOf("80s", {
    findings: [{ dimension: "productionSchool", value: "gated_reverb_pop", confidence: 0.7, provenance: "researched", sourceRefs: ["research:x"] }],
  });
  assert.equal(profile.dimensions.productionSchool?.value, "gated_reverb_pop");
  assert.equal(profile.dimensions.productionSchool?.provenance, "researched");
});

test("a research summary rides with the profile and its digest; without one the field is absent", () => {
  const summary = {
    method: "style-research/v1", world: ["tradition=hasidic"], providers: ["fake-research/v1"],
    candidates: [{ dimension: "roomSize" as const, value: "hall", confidence: 0.5, sourceRefs: ["research:x"], rationale: "r" }],
    discarded: [],
  };
  const withResearch = profileOf("80s", { research: summary });
  assert.deepEqual(withResearch.research, summary);
  assert.equal(profileOf("80s").research, undefined);
  assert.notEqual(withResearch.inputsDigestSha256, profileOf("80s").inputsDigestSha256, "what research contributed is part of the profile's inputs");
});

test("the vocabulary is not a genre catalogue", () => {
  assert.ok(UNIVERSAL_VOCABULARY_RULES.length <= 40, `kept small: ${UNIVERSAL_VOCABULARY_RULES.length} rules`);
  assert.equal(UNIVERSAL_VOCABULARY_RULES.some((r) => r.when.slot === "tradition"), false, "no rule keyed on a tradition");
  const catalogue = ["pop", "rock", "jazz", "blues", "soul", "funk", "hip_hop", "edm", "trance", "house", "techno", "disco", "reggae", "country", "folk", "metal", "indie", "classical"];
  for (const r of UNIVERSAL_VOCABULARY_RULES) {
    if (r.when.slot === "genre_word") assert.equal(catalogue.includes(r.when.value), false, `no rule for genre "${r.when.value}"`);
  }
  // Genre and tradition words populate identity dimensions only.
  const profile = profileOf("hasidic jazz");
  assert.deepEqual(populatedDimensions(profile), ["genre", "tradition"]);
});

test("named instruments become a stated instrumentation hierarchy, in the order named", () => {
  const profile = profileOf("piano and cello with a little accordion");
  assert.deepEqual(profile.dimensions.instrumentationHierarchy?.value, ["keys", "strings"]);
  assert.equal(profile.dimensions.instrumentationHierarchy?.provenance, "stated");
});

test("bpm sets tempo behaviour; the digest is stable and ignores the timestamp", () => {
  const a = profileOf("at 68 bpm");
  assert.equal(a.dimensions.tempoBehavior?.value, "slow");
  const b = resolveStyleProfile(extractUserIntentSync("at 68 bpm", { now: NOW }), { now: new Date("2027-01-01T00:00:00.000Z") });
  assert.equal(a.inputsDigestSha256, b.inputsDigestSha256);
  assert.notEqual(a.derivedAt, b.derivedAt);
});
