import assert from "node:assert/strict";
import test from "node:test";
import type { StyleDimensionName } from "@workspace/db";
import { compileProductionBrief } from "./briefCompiler";
import { ARRANGEMENT_CONCEPTS_VERSION, generateArrangementConcepts, protectedDimensions } from "./conceptGenerator";
import { extractUserIntentSync } from "./intentExtraction";
import { resolveStyleProfile } from "./styleResolution";
import { FIXED_NOW, makeTestSongModel } from "./testSongModel";

const briefFor = (text: string) => {
  const intent = extractUserIntentSync(text, { now: FIXED_NOW });
  const profile = resolveStyleProfile(intent, { now: FIXED_NOW });
  return compileProductionBrief(intent, profile, makeTestSongModel(), [], { now: FIXED_NOW });
};

test("exactly three concepts, each a different world in named dimensions", () => {
  const set = generateArrangementConcepts(briefFor("a warm song"), { now: FIXED_NOW });
  assert.equal(set.version, ARRANGEMENT_CONCEPTS_VERSION);
  assert.equal(set.concepts.length, 3);
  assert.equal(new Set(set.concepts.map((c) => c.id)).size, 3);
  assert.equal(new Set(set.concepts.map((c) => c.candidateStrategy)).size, 3, "each maps to a different candidate strategy");
  for (const concept of set.concepts) {
    assert.ok(concept.differsIn.length >= 3, `${concept.id} differs from the brief in ${concept.differsIn.join(",")}`);
    assert.equal(concept.contrastsWith.length, 2);
    for (const contrast of concept.contrastsWith) {
      assert.ok(contrast.dimensions.length >= 2, `${concept.id} vs ${contrast.conceptId}: ${contrast.dimensions.join(",")}`);
    }
    // differsIn is exactly the set of dimensions the deltas set.
    const setDims = concept.deltas.filter((d) => d.kind === "set_dimension").map((d) => (d.kind === "set_dimension" ? d.dimension : "")).sort();
    assert.deepEqual(concept.differsIn, setDims);
  }
  const rooms = set.concepts.map((c) => c.deltas.find((d) => d.kind === "set_dimension" && d.dimension === "roomSize"));
  assert.equal(new Set(rooms.map((d) => (d && d.kind === "set_dimension" ? d.value : null))).size, 3, "three different rooms");
});

test("concepts never touch a dimension the user stated", () => {
  const brief = briefFor("80s wedding band, dry");
  const protectedDims = protectedDimensions(brief);
  assert.ok(protectedDims.has("era") && protectedDims.has("ensembleType") && protectedDims.has("soundAesthetic"));
  const set = generateArrangementConcepts(brief, { now: FIXED_NOW });
  for (const concept of set.concepts) {
    for (const delta of concept.deltas) {
      if (delta.kind !== "set_dimension") continue;
      assert.equal(protectedDims.has(delta.dimension), false, `${concept.id} does not change stated ${delta.dimension}`);
    }
    assert.ok(concept.differsIn.length >= 2, "and still differs from the brief");
  }
  // Vocabulary-inferred fine dimensions are fair game.
  const inferred: StyleDimensionName = "roomSize";
  assert.equal(protectedDims.has(inferred), false);
});

test("a direction the brief rules out falls back to a sibling that still differs", () => {
  const set = generateArrangementConcepts(briefFor("no strings, no brass, no winds, no pads"), { now: FIXED_NOW });
  const ids = set.concepts.map((c) => c.id);
  assert.ok(ids.includes("concept-textural_atmospheric"), `orchestral fell back: ${ids.join(",")}`);
  assert.equal(ids.includes("concept-hybrid_cinematic"), false);
  for (const concept of set.concepts) {
    assert.equal(concept.deltas.some((d) => d.kind === "instrumentation" && d.add?.includes("strings")), false);
    for (const contrast of concept.contrastsWith) assert.ok(contrast.dimensions.length >= 1);
  }
});

test("the concept set is digest-tracked against the brief", () => {
  const brief = briefFor("cinematic");
  const a = generateArrangementConcepts(brief, { now: FIXED_NOW });
  const b = generateArrangementConcepts(brief, { now: new Date("2027-01-01T00:00:00.000Z") });
  assert.equal(a.inputsDigestSha256, b.inputsDigestSha256);
  assert.equal(a.briefDigestSha256, brief.inputsDigestSha256);
  assert.notEqual(a.derivedAt, b.derivedAt);
  assert.notEqual(generateArrangementConcepts(briefFor("intimate"), { now: FIXED_NOW }).inputsDigestSha256, a.inputsDigestSha256);
  // A stated "cinematic" protects soundAesthetic; the cinematic concept still differs in room and dynamics.
  const cinematic = a.concepts.find((c) => c.id === "concept-hybrid_cinematic")!;
  assert.ok(!cinematic.deltas.some((d) => d.kind === "set_dimension" && d.dimension === "soundAesthetic"));
});
