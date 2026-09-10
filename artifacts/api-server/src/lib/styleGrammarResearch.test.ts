import assert from "node:assert/strict";
import test from "node:test";
import {
  FIXTURE_STYLE_RESEARCH_PROVIDER_ID,
  LIVE_STYLE_RESEARCH_REQUIRED_ENV,
  createFixtureStyleResearchProvider,
  gateStyleEvidence,
  liveStyleResearchProvider,
  runStyleResearch,
  styleCandidatesFromEvidence,
  type StructuredStyleEvidence,
} from "./styleGrammarResearch";
import { assembleStyleGrammar, type StyleCandidate } from "./styleGrammar";
import { resolveStyle, resolveStyleWithResearch } from "./styleResolver";

const cited = (over: Partial<StructuredStyleEvidence>): StructuredStyleEvidence => ({
  path: "groove.family", value: "compound_6_8", confidence: 0.8, rationale: "test",
  citations: [{ title: "FIXTURE: test source", locator: "p. 1" }], providerId: "test", ...over,
});

test("the gate: uncited claims are hearsay, weak claims are discarded, the middle band is weak, 0.7 and above is a fact, and invalid paths or values never pass", () => {
  assert.equal(gateStyleEvidence(cited({})).gate, "fact");
  assert.equal(gateStyleEvidence(cited({ confidence: 0.55 })).gate, "weak");
  assert.deepEqual(gateStyleEvidence(cited({ confidence: 0.3 })), { gate: "discarded", reason: "confidence 0.3 is below 0.4" });
  assert.deepEqual(gateStyleEvidence(cited({ citations: [] })), { gate: "discarded", reason: "uncited research is hearsay" });
  assert.equal(gateStyleEvidence(cited({ value: "groovy" })).gate, "discarded");
  assert.equal(gateStyleEvidence(cited({ path: "groove.vibe" as never })).gate, "discarded");
  const converted = styleCandidatesFromEvidence([cited({}), cited({ confidence: 0.5 }), cited({ citations: [] })]);
  assert.deepEqual(converted.counts, { evidence: 3, facts: 1, weak: 1, discarded: 1 });
  assert.ok(converted.candidates.every((c) => c.provenance === "research" && c.sourceRefs![0].startsWith("research:test/FIXTURE")));
});

test("merge policy: research never overrides a stated brief value; a fact overrides the knowledge base; a weak finding only fills unknowns and lowers the template's confidence", () => {
  const template: StyleCandidate = { path: "groove.family", value: "straight", confidence: 0.6, provenance: "template", sourceRefs: ["knowledge:ballad/groove.family"] };
  const brief: StyleCandidate = { path: "groove.family", value: "backbeat", confidence: 0.7, provenance: "brief", sourceRefs: ["text:backbeat"] };
  const fact = styleCandidatesFromEvidence([cited({ confidence: 0.85 })]).candidates;
  const weak = styleCandidatesFromEvidence([cited({ confidence: 0.5 })]).candidates;

  assert.equal(assembleStyleGrammar([template, brief, ...fact]).groove.family?.value, "backbeat", "the brief stands");
  const overridden = assembleStyleGrammar([template, ...fact]);
  assert.equal(overridden.groove.family?.value, "compound_6_8", "a fact beats the knowledge base");
  assert.equal(overridden.groove.family?.provenance, "research");
  assert.ok(overridden.conflicts.some((c) => c.path === "groove.family" && c.alternatives[0].value === "straight"), "the template's dissent is kept");
  const kept = assembleStyleGrammar([template, ...weak]);
  assert.equal(kept.groove.family?.value, "straight", "a weak finding does not overturn the knowledge base");
  assert.ok(kept.groove.family!.confidence < 0.6, "but it lowers the confidence");
  const filled = assembleStyleGrammar([...weak]);
  assert.equal(filled.groove.family?.value, "compound_6_8", "a weak finding fills an unknown");
  const corroborated = assembleStyleGrammar([template, ...styleCandidatesFromEvidence([cited({ value: "straight", confidence: 0.75 })]).candidates]);
  assert.ok(corroborated.groove.family!.confidence > 0.85, "agreement raises confidence");
});

test("the fixture provider is deterministic and its evidence flows through the resolver with citations", async () => {
  const provider = createFixtureStyleResearchProvider();
  const a = await provider.research({ world: ["tradition=hasidic", "genre=ballad"] });
  const b = await provider.research({ world: ["tradition=hasidic", "genre=ballad"] });
  assert.deepEqual(a, b);
  assert.ok(a.length >= 4);
  assert.ok(a.every((e) => e.providerId === FIXTURE_STYLE_RESEARCH_PROVIDER_ID));
  assert.deepEqual(await provider.research({ world: ["genre=polka"] }), []);

  const resolution = resolveStyle({ research: a });
  assert.equal(resolution.grammar.groove.feltPulse?.value, "half_time");
  assert.equal(resolution.grammar.groove.feltPulse?.provenance, "research");
  assert.ok(resolution.grammar.groove.feltPulse!.sourceRefs![0].includes("FIXTURE"));
  assert.equal(resolution.grammar.identity.era, undefined, "a 0.3 claim is discarded");
  assert.equal(resolution.grammar.keys.voicingWidth, undefined, "an uncited claim is discarded");
  assert.ok(resolution.grammar.omitted.some((o) => /uncited research is hearsay/.test(o)));
  assert.deepEqual(resolution.research, { evidence: 5, facts: 2, weak: 1, discarded: 2 });
});

test("runStyleResearch survives a failing provider and resolveStyleWithResearch asks for the unknowns and merges the answers", async () => {
  const broken = { id: "broken", research: async () => { throw new Error("model down"); } };
  const run = await runStyleResearch([createFixtureStyleResearchProvider(), broken], { world: ["genre=jazz"] });
  assert.equal(run.providers.find((p) => p.id === "broken")!.error, "model down");
  assert.ok(run.evidence.some((e) => e.path === "groove.swingRatio"));

  const research = await resolveStyleWithResearch({ styleProfile: jazzProfile() }, [createFixtureStyleResearchProvider()]);
  assert.ok(research.researchRun.providers[0].evidence >= 2);
  // The knowledge base said 0.62 (template); the fixture fact says 0.64: the fact wins and the template's dissent is kept.
  assert.equal(research.grammar.groove.swingRatio?.value, 0.64);
  assert.equal(research.grammar.groove.swingRatio?.provenance, "research");
});

test("the live provider is an explicit not_configured state naming its env vars; when configured it is still unwired and refuses rather than pretend", async () => {
  const off = liveStyleResearchProvider({});
  assert.equal(off.state, "not_configured");
  if (off.state !== "not_configured") return;
  assert.deepEqual(off.missing, [...LIVE_STYLE_RESEARCH_REQUIRED_ENV]);
  assert.deepEqual(off.requiredEnv, ["STYLE_RESEARCH_PROVIDER", "STYLE_RESEARCH_API_URL", "STYLE_RESEARCH_API_KEY"]);
  const on = liveStyleResearchProvider({ STYLE_RESEARCH_PROVIDER: "http", STYLE_RESEARCH_API_URL: "https://example.invalid", STYLE_RESEARCH_API_KEY: "x" });
  assert.equal(on.state, "configured_unwired");
  if (on.state !== "configured_unwired") return;
  await assert.rejects(on.provider.research({ world: ["genre=jazz"] }), /not wired/);
});

function jazzProfile() {
  return {
    version: "1.0" as const, derivedAt: "", inputsDigestSha256: "j".repeat(64), method: "t", exclusions: [], conflicts: [], sources: [], confidence: 0.8,
    dimensions: { genre: { value: "jazz", confidence: 0.9, provenance: "stated" as const, sourceRefs: ["text:jazz"] } },
  };
}
