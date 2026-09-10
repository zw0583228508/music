import assert from "node:assert/strict";
import test from "node:test";
import type { StyleFingerprint } from "@workspace/db";
import {
  MIN_RULE_WEIGHT,
  RULE_KIND_LEDGER,
  STYLE_FIELDS,
  STYLE_GRAMMAR_VERSION,
  STYLE_PATHS,
  assembleStyleGrammar,
  deriveStyleGrammar,
  effectiveRank,
  styleGrammarSlot,
  validateStyleValue,
  type StyleCandidate,
} from "./styleGrammar";

/** A deliberately neutral reference: every measurement sits at its default. */
function neutralFingerprint(over: Partial<StyleFingerprint> = {}): StyleFingerprint {
  return {
    version: "1.0",
    method: "test",
    derivedAt: "2026-09-09T00:00:00.000Z",
    inputsDigestSha256: "0".repeat(64),
    source: { kind: "song_model", id: "test", version: null },
    contentFree: true,
    tempo: { bpm: 100, stability: 0.9, meter: "4/4", behavior: "moderate" },
    groove: {
      swingRatio: 0.5, microtimingMs: 0, microtiming: "quantized",
      syncopation: 0.2, subdivisions: [] as unknown as StyleFingerprint["groove"]["subdivisions"],
      onsetDensity: 2,
    },
    harmony: {
      chordsPerBar: 1, harmonicRhythm: "moderate", extensionShare: 0.15,
      chordExtensions: "sevenths", keyChanges: 0, functionalMotion: 0.35,
    },
    melodicShape: {
      rangeSemitones: 12, stepwiseRatio: 0.65, leapRatio: 0.35,
      meanIntervalSemitones: 2.2, phraseLengthBeats: 4, phraseLength: "regular",
      ornamentDensity: 0.05, ornamentation: "light",
    },
    register: { low: 0.3, mid: 0.5, high: 0.2, tendency: "mid" },
    dynamics: { velocityP10: 60, velocityP90: 90, rangeClass: "moderate" },
    energyArc: [0.5, 0.5, 0.5, 0.5, 0.5, 0.5, 0.5, 0.5],
    density: { notesPerBarMean: 8, notesPerBarP10: 6, notesPerBarP90: 10, arcShape: "flat" },
    instrumentation: { hierarchy: ["keys"], familyShare: { keys: 1 }, trackCount: 1 },
    sectionCount: 4,
    durationSeconds: 180,
    ...over,
  } as StyleFingerprint;
}

const swungGroove = {
  swingRatio: 0.66, microtimingMs: 22, microtiming: "behind" as const,
  syncopation: 0.55, subdivisions: [] as unknown as StyleFingerprint["groove"]["subdivisions"],
  onsetDensity: 4.5,
};

test("a neutral reference produces no rules and no values, and says which measurements it dropped", () => {
  const grammar = deriveStyleGrammar(neutralFingerprint());
  assert.deepEqual(grammar.rules, [], "nothing about this reference is worth imitating");
  assert.equal(grammar.unknown.length, STYLE_PATHS.length, "a neutral measurement is not a value either");
  assert.ok(grammar.omitted.length >= 10, "every neutral measurement is listed, not silently skipped");
  assert.ok(grammar.omitted.some((line) => line.startsWith("swing:")), "a 0.5 swing ratio is straight, not subtly swung");
  assert.ok(grammar.omitted.some((line) => line.startsWith("register:")), "sitting mid is where music sits by default");
});

test("a strongly swung, syncopated reference produces the two slot rules and the section values behind them", () => {
  const grammar = deriveStyleGrammar(neutralFingerprint({ groove: swungGroove }));
  const byId = new Map(grammar.rules.map((r) => [r.id, r]));
  const swing = byId.get("swing")!;
  assert.ok(swing, "a 0.66 ratio is a triplet swing and must be stated");
  assert.ok(swing.weight > 0.9, `a full triplet swing is not a weak suggestion: ${swing.weight}`);
  assert.deepEqual(swing.directive, { kind: "swing", ratio: 0.66 });
  assert.match(byId.get("microtiming")!.description, /behind the grid by 22 ms/);
  // The slot carries only what a composer pass reads; the rest are values.
  assert.deepEqual([...byId.keys()].sort(), ["microtiming", "swing"]);
  assert.equal(grammar.groove.family?.value, "swung");
  assert.equal(grammar.groove.family?.provenance, "fingerprint");
  assert.ok(grammar.groove.syncopation!.confidence > 0.5);
  assert.ok(grammar.groove.onsetsPerBeat, "onsets per beat is a value StyleSpec reads");
  const weights = grammar.rules.map((r) => r.weight);
  assert.deepEqual(weights, [...weights].sort((a, b) => b - a));
});

test("a push of a few milliseconds is grid noise, not a feel", () => {
  const grammar = deriveStyleGrammar(neutralFingerprint({
    groove: { ...swungGroove, swingRatio: 0.5, microtimingMs: -6, microtiming: "ahead", syncopation: 0.2, onsetDensity: 2 },
  }));
  assert.equal(grammar.rules.find((r) => r.id === "microtiming"), undefined);
  assert.equal(grammar.groove.microtiming, undefined);
  assert.ok(grammar.omitted.some((line) => line.startsWith("microtiming:")));

  const audible = deriveStyleGrammar(neutralFingerprint({
    groove: { ...swungGroove, swingRatio: 0.5, microtimingMs: -20, microtiming: "ahead", syncopation: 0.2, onsetDensity: 2 },
  }));
  assert.match(audible.rules.find((r) => r.id === "microtiming")!.description, /ahead of the grid by 20 ms/);
  assert.equal(audible.groove.microtiming?.value, "ahead");
});

test("triads are stated as a value when the reference has almost no extensions", () => {
  const plain = deriveStyleGrammar(neutralFingerprint({
    harmony: { chordsPerBar: 1, harmonicRhythm: "moderate", extensionShare: 0.02, chordExtensions: "triads", keyChanges: 0, functionalMotion: 0.35 },
  }));
  assert.equal(plain.harmony.extensions?.value, "triads");
  assert.ok(plain.harmony.extensions!.confidence > 0.8, "writing sevenths into a triadic style is the classic mistake");
  assert.match(plain.harmony.extensions!.rationale!, /sevenths and extensions are foreign here/);
  const extended = deriveStyleGrammar(neutralFingerprint({
    harmony: { chordsPerBar: 1, harmonicRhythm: "moderate", extensionShare: 0.7, chordExtensions: "extended", keyChanges: 0, functionalMotion: 0.35 },
  }));
  assert.equal(extended.harmony.extensions?.value, "extended");
});

test("absent evidence is unknown, not zero: a fingerprint with no notes yields no melodic, dynamic or groove values", () => {
  const empty = deriveStyleGrammar(neutralFingerprint({
    groove: { swingRatio: 0.5, microtimingMs: 0, microtiming: "quantized", syncopation: 0, subdivisions: [] as unknown as StyleFingerprint["groove"]["subdivisions"], onsetDensity: 0 },
    melodicShape: { rangeSemitones: 0, stepwiseRatio: 0, leapRatio: 0, meanIntervalSemitones: 0, phraseLengthBeats: 0, phraseLength: "short", ornamentDensity: 0, ornamentation: "none" },
    dynamics: { velocityP10: 0, velocityP90: 0, rangeClass: "narrow" },
    density: { notesPerBarMean: 0, notesPerBarP10: 0, notesPerBarP90: 0, arcShape: "arch" },
    instrumentation: { hierarchy: [], familyShare: {}, trackCount: 1 },
    harmony: { chordsPerBar: 0.65, harmonicRhythm: "slow", extensionShare: 0, chordExtensions: "triads", keyChanges: 0, functionalMotion: 0.66 },
  }));
  // Before B-09 these zeros became weight-1 rules ("write in phrases of 0 beats").
  assert.deepEqual(empty.rules, []);
  assert.equal(empty.melodic.phraseLengthBeats, undefined);
  assert.equal(empty.melodic.stepwiseRatio, undefined);
  assert.equal(empty.performance.dynamics, undefined);
  assert.equal(empty.groove.onsetsPerBeat, undefined);
  assert.ok(empty.omitted.some((line) => /no onset evidence/.test(line)));
  assert.ok(empty.omitted.some((line) => /no melodic evidence/.test(line)));
  // What was measured is kept.
  assert.equal(empty.harmony.extensions?.value, "triads");
  assert.equal(empty.harmony.functionalMotion?.value, 0.66);
});

test("thin evidence weakens every value and says so in the basis", () => {
  const full = deriveStyleGrammar(neutralFingerprint({ groove: swungGroove }));
  const thin = deriveStyleGrammar(neutralFingerprint({ groove: swungGroove, durationSeconds: 20, sectionCount: 1 }));
  assert.equal(full.basis.thinEvidence, false);
  assert.equal(thin.basis.thinEvidence, true);
  assert.match(thin.basis.caveat, /describes a passage, not a style/);
  assert.ok(thin.rules.find((r) => r.id === "swing")!.weight < full.rules.find((r) => r.id === "swing")!.weight);
  assert.ok(thin.groove.syncopation!.confidence < full.groove.syncopation!.confidence);
});

test("even a full reference records that it is one reference, not a genre", () => {
  const grammar = deriveStyleGrammar(neutralFingerprint());
  assert.match(grammar.basis.caveat, /one reference/);
  assert.match(grammar.basis.caveat, /not how a genre behaves/);
});

test("the grammar is deterministic, so a change traces to the reference", () => {
  const fingerprint = neutralFingerprint({ register: { low: 0.6, mid: 0.3, high: 0.1, tendency: "low" } });
  assert.deepEqual(deriveStyleGrammar(fingerprint), deriveStyleGrammar(fingerprint));
  assert.equal(deriveStyleGrammar(fingerprint).arrangement.registerTendency?.value, "low");
});

test("no emitted rule is below the noise floor", () => {
  const grammar = deriveStyleGrammar(neutralFingerprint({ groove: { ...swungGroove, swingRatio: 0.58, microtimingMs: 12, syncopation: 0.35, onsetDensity: 3 } }));
  assert.ok(grammar.rules.length > 0);
  assert.ok(grammar.rules.every((r) => r.weight >= MIN_RULE_WEIGHT), "a rule under the floor is noise dressed as an instruction");
  assert.ok(grammar.rules.every((r) => r.weight <= 1));
});

test("an empty grammar fills the Q-02 slot with the reason, not with nothing", () => {
  const empty = styleGrammarSlot(deriveStyleGrammar(neutralFingerprint()));
  assert.equal(empty.status, "not_available");
  assert.match((empty as { reason: string }).reason, /far enough from neutral/);
  const full = styleGrammarSlot(deriveStyleGrammar(neutralFingerprint({ groove: swungGroove })));
  assert.equal(full.status, "available");
  if (full.status !== "available") return;
  assert.equal(full.version, `${STYLE_GRAMMAR_VERSION}:full`);
  assert.ok(full.rules.every((r) => typeof r.description === "string" && r.description.length > 0));
  const thin = styleGrammarSlot(deriveStyleGrammar(neutralFingerprint({ durationSeconds: 20, sectionCount: 1, groove: swungGroove })));
  assert.equal((thin as { version: string }).version, `${STYLE_GRAMMAR_VERSION}:thin`);
});

// --- the contract itself ---------------------------------------------------

test("every field has a level, a kind that validates, and either a consumer or an honest empty list", () => {
  for (const path of STYLE_PATHS) {
    const spec = STYLE_FIELDS[path];
    assert.ok(spec.level, `${path} has a level`);
    assert.equal(validateStyleValue(path, undefined) === null, false, `${path} rejects undefined`);
    if (spec.kind === "enum") for (const v of spec.values!) assert.equal(validateStyleValue(path, v), null, `${path} accepts ${v}`);
    if (spec.question) assert.ok(spec.consumers.length > 0, `${path}: a question is only worth asking when someone reads the answer`);
  }
  assert.equal(validateStyleValue("groove.swingRatio", 0.9), "0.9 is not a number in [0.5, 0.8]");
  assert.equal(validateStyleValue("arrangement.textureLadder", { chorus: "full", intro: "duo" }), null);
  assert.match(validateStyleValue("arrangement.textureLadder", { chorus: "huge" })!, /not a texture level/);
});

test("the merge: a stated brief value is absolute; an implied one ranks with the knowledge base; a research fact beats a clear measurement beats the knowledge base beats a weak finding", () => {
  const c = (over: Partial<StyleCandidate>): StyleCandidate => ({ path: "groove.family", value: "straight", confidence: 0.6, provenance: "template", ...over });
  assert.ok(effectiveRank(c({ provenance: "brief", confidence: 0.3 })) > effectiveRank(c({ provenance: "research", confidence: 0.99 })));
  assert.equal(effectiveRank(c({ provenance: "brief", confidence: 0.3, sourceRefs: ["vocab:x", "text:y"] })), effectiveRank(c({ provenance: "template" })));
  assert.ok(effectiveRank(c({ provenance: "research", confidence: 0.75 })) > effectiveRank(c({ provenance: "fingerprint", confidence: 0.9 })));
  assert.ok(effectiveRank(c({ provenance: "fingerprint", confidence: 0.6 })) > effectiveRank(c({ provenance: "template", confidence: 0.9 })));
  assert.ok(effectiveRank(c({ provenance: "template", confidence: 0.5 })) > effectiveRank(c({ provenance: "research", confidence: 0.5 })));
  assert.ok(effectiveRank(c({ provenance: "research", confidence: 0.5 })) > effectiveRank(c({ provenance: "fingerprint", confidence: 0.3 })));
  // A measured chord vocabulary is a prior only (the analyzer reads triads + one seventh).
  assert.ok(effectiveRank(c({ path: "harmony.extensions", provenance: "fingerprint", confidence: 0.99 })) < effectiveRank(c({ path: "harmony.extensions", provenance: "template", confidence: 0.5 })));

  const grammar = assembleStyleGrammar([
    c({ provenance: "template", value: "straight", confidence: 0.6, sourceRefs: ["knowledge:ballad/groove.family"] }),
    c({ provenance: "fingerprint", value: "swung", confidence: 0.7, sourceRefs: ["fingerprint:x"] }),
    c({ provenance: "brief", value: "compound_6_8", confidence: 0.5, sourceRefs: ["text:6/8"] }),
    c({ path: "harmony.extensions", provenance: "template", value: "triads", confidence: 0.7 }),
    c({ path: "harmony.extensions", provenance: "fingerprint", value: "triads", confidence: 0.9 }),
    c({ path: "keys.voicingWidth", provenance: "brief", value: "close", confidence: 0.35, sourceRefs: ["vocab:production.intimate", "text:intimate"] }),
    c({ path: "keys.voicingWidth", provenance: "template", value: "open", confidence: 0.6 }),
    c({ path: "sound.roomSize", provenance: "default", value: "hall", confidence: 0.1 }),
    c({ path: "groove.swingRatio", provenance: "template", value: 0.95, confidence: 0.9 }),
  ]);
  assert.equal(grammar.groove.family?.value, "compound_6_8", "the producer's stated word wins over a measurement and the knowledge base");
  assert.equal(grammar.groove.family?.provenance, "brief");
  const familyConflict = grammar.conflicts.find((x) => x.path === "groove.family")!;
  assert.deepEqual(familyConflict.alternatives.map((a) => a.value), ["swung", "straight"], "the dissent is kept, strongest first");
  assert.ok(grammar.groove.family!.confidence < 0.5, "dissent lowers confidence");
  assert.equal(grammar.harmony.extensions?.provenance, "template");
  assert.ok(grammar.harmony.extensions!.confidence > 0.9, "agreeing sources corroborate (noisy-OR)");
  assert.equal(grammar.keys.voicingWidth?.value, "open", "an implied brief value loses to more confident knowledge");
  assert.equal(grammar.sound.roomSize, undefined, "a value under the confidence floor is not a value");
  assert.ok(grammar.omitted.some((o) => /sound\.roomSize: too weak/.test(o)));
  assert.ok(grammar.omitted.some((o) => /groove\.swingRatio: 0\.95 is not a number/.test(o)), "an invalid value is dropped with the reason");
  assert.ok(grammar.unknown.includes("identity.genre"));
  assert.equal(assembleStyleGrammar([]).inputsDigestSha256, assembleStyleGrammar([]).inputsDigestSha256);
});

test("every pre-B-09 rule kind has a consumer or a deletion, and the re-homed ones point at real fields", () => {
  const ids = RULE_KIND_LEDGER.map((r) => r.ruleId).sort();
  assert.deepEqual(ids, [
    "chord-extensions", "density", "dynamic-range", "energy-arc", "functional-motion", "harmonic-rhythm", "instrument-hierarchy",
    "microtiming", "onset-density", "ornamentation", "phrase-length", "register", "stepwise-motion", "swing", "syncopation",
  ]);
  for (const entry of RULE_KIND_LEDGER) {
    if (entry.fate === "deleted") { assert.equal(entry.consumers.length, 0); assert.ok(entry.why.length > 20); continue; }
    assert.ok(entry.path && STYLE_PATHS.includes(entry.path), `${entry.ruleId} names a contract field`);
    if (entry.fate === "consumed_as_rule") assert.ok(entry.consumers.some((c) => /applyGroove/.test(c)));
    // A re-homed value with production consumers lists them in the registry too.
    for (const consumer of entry.consumers) assert.ok(STYLE_FIELDS[entry.path!].consumers.includes(consumer as never), `${entry.ruleId}: ${consumer} is registered on ${entry.path}`);
  }
  const consumedAsRule = RULE_KIND_LEDGER.filter((r) => r.fate === "consumed_as_rule").map((r) => r.ruleId);
  assert.deepEqual(consumedAsRule, ["swing", "microtiming"], "the slot carries exactly what applyGroove reads");
});
