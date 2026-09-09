import assert from "node:assert/strict";
import test from "node:test";
import type { StyleFingerprint } from "@workspace/db";
import {
  MIN_RULE_WEIGHT,
  STYLE_GRAMMAR_VERSION,
  deriveStyleGrammar,
  styleGrammarSlot,
} from "./styleGrammar";

/** A deliberately neutral reference: every measurement sits at its default. */
function neutralFingerprint(over: Partial<StyleFingerprint> = {}): StyleFingerprint {
  return {
    version: "1.0",
    method: "test",
    derivedAt: "2026-09-09T00:00:00.000Z",
    inputsDigestSha256: "0".repeat(64),
    source: "song_model",
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

test("a neutral reference produces no rules at all, and says which it dropped", () => {
  const grammar = deriveStyleGrammar(neutralFingerprint());
  assert.deepEqual(grammar.rules, [], "nothing about this reference is worth imitating");
  assert.ok(grammar.omitted.length >= 10, "every neutral measurement is listed, not silently skipped");
  assert.ok(grammar.omitted.some((line) => line.startsWith("swing:")), "a 0.5 swing ratio is straight, not subtly swung");
  assert.ok(grammar.omitted.some((line) => line.startsWith("register:")), "sitting mid is where music sits by default");
});

test("a strongly swung, syncopated reference produces strong rules", () => {
  const grammar = deriveStyleGrammar(neutralFingerprint({
    groove: {
      swingRatio: 0.66, microtimingMs: 22, microtiming: "behind",
      syncopation: 0.55, subdivisions: [] as unknown as StyleFingerprint["groove"]["subdivisions"],
      onsetDensity: 4.5,
    },
  }));
  const byId = new Map(grammar.rules.map((r) => [r.id, r]));
  const swing = byId.get("swing")!;
  assert.ok(swing, "a 0.66 ratio is a triplet swing and must be stated");
  assert.ok(swing.weight > 0.9, `a full triplet swing is not a weak suggestion: ${swing.weight}`);
  assert.deepEqual(swing.directive, { kind: "swing", ratio: 0.66 });

  assert.match(byId.get("microtiming")!.description, /behind the grid by 22 ms/);
  assert.ok(byId.get("syncopation")!.weight > 0.5);
  assert.ok(byId.get("onset-density"));

  // Rules come back strongest first, so a composer under pressure keeps the top.
  const weights = grammar.rules.map((r) => r.weight);
  assert.deepEqual(weights, [...weights].sort((a, b) => b - a));
});

test("a push of a few milliseconds is grid noise, not a feel", () => {
  const grammar = deriveStyleGrammar(neutralFingerprint({
    groove: {
      swingRatio: 0.5, microtimingMs: -6, microtiming: "ahead",
      syncopation: 0.2, subdivisions: [] as unknown as StyleFingerprint["groove"]["subdivisions"],
      onsetDensity: 2,
    },
  }));
  assert.equal(grammar.rules.find((r) => r.id === "microtiming"), undefined);
  assert.ok(grammar.omitted.some((line) => line.startsWith("microtiming:")));

  // At 20 ms it is a decision a listener can hear.
  const audible = deriveStyleGrammar(neutralFingerprint({
    groove: {
      swingRatio: 0.5, microtimingMs: -20, microtiming: "ahead",
      syncopation: 0.2, subdivisions: [] as unknown as StyleFingerprint["groove"]["subdivisions"],
      onsetDensity: 2,
    },
  }));
  const rule = audible.rules.find((r) => r.id === "microtiming")!;
  assert.match(rule.description, /ahead of the grid by 20 ms/);
});

test("triads are stated as an instruction when the reference has almost no extensions", () => {
  const plain = deriveStyleGrammar(neutralFingerprint({
    harmony: {
      chordsPerBar: 1, harmonicRhythm: "moderate", extensionShare: 0.02,
      chordExtensions: "triads", keyChanges: 0, functionalMotion: 0.35,
    },
  }));
  const rule = plain.rules.find((r) => r.id === "chord-extensions")!;
  assert.ok(rule, "writing sevenths into a triadic style is the classic mistake");
  assert.match(rule.description, /sevenths and extensions are foreign here/);
  assert.ok(rule.weight > 0.8);

  const extended = deriveStyleGrammar(neutralFingerprint({
    harmony: {
      chordsPerBar: 1, harmonicRhythm: "moderate", extensionShare: 0.7,
      chordExtensions: "extended", keyChanges: 0, functionalMotion: 0.35,
    },
  }));
  assert.equal(extended.rules.find((r) => r.id === "chord-extensions")!.directive.kind, "chordExtensions");
});

test("thin evidence weakens every rule and says so in the basis", () => {
  const options = {
    groove: {
      swingRatio: 0.66, microtimingMs: 22, microtiming: "behind" as const,
      syncopation: 0.55, subdivisions: [] as unknown as StyleFingerprint["groove"]["subdivisions"],
      onsetDensity: 4.5,
    },
  };
  const full = deriveStyleGrammar(neutralFingerprint(options));
  const thin = deriveStyleGrammar(neutralFingerprint({ ...options, durationSeconds: 20, sectionCount: 1 }));

  assert.equal(full.basis.thinEvidence, false);
  assert.equal(thin.basis.thinEvidence, true);
  assert.match(thin.basis.caveat, /describes a passage, not a style/);

  const fullSwing = full.rules.find((r) => r.id === "swing")!.weight;
  const thinSwing = thin.rules.find((r) => r.id === "swing")!.weight;
  assert.ok(thinSwing < fullSwing, `20 seconds must not sound as certain as 180: ${thinSwing} vs ${fullSwing}`);
});

test("even a full reference records that it is one reference, not a genre", () => {
  const grammar = deriveStyleGrammar(neutralFingerprint());
  assert.match(grammar.basis.caveat, /one reference/);
  assert.match(grammar.basis.caveat, /not how a genre behaves/);
});

test("the grammar is deterministic, so a change traces to the reference", () => {
  const fingerprint = neutralFingerprint({ register: { low: 0.6, mid: 0.3, high: 0.1, tendency: "low" } });
  assert.deepEqual(deriveStyleGrammar(fingerprint), deriveStyleGrammar(fingerprint));
});

test("no emitted rule is below the noise floor", () => {
  const grammar = deriveStyleGrammar(neutralFingerprint({
    groove: {
      swingRatio: 0.58, microtimingMs: 12, microtiming: "behind",
      syncopation: 0.35, subdivisions: [] as unknown as StyleFingerprint["groove"]["subdivisions"],
      onsetDensity: 3,
    },
  }));
  assert.ok(grammar.rules.length > 0);
  assert.ok(grammar.rules.every((r) => r.weight >= MIN_RULE_WEIGHT), "a rule under the floor is noise dressed as an instruction");
  assert.ok(grammar.rules.every((r) => r.weight <= 1));
});

test("an empty grammar fills the Q-02 slot with the reason, not with nothing", () => {
  const empty = styleGrammarSlot(deriveStyleGrammar(neutralFingerprint()));
  assert.equal(empty.status, "not_available");
  assert.match((empty as { reason: string }).reason, /far enough from neutral/);

  const full = styleGrammarSlot(deriveStyleGrammar(neutralFingerprint({
    groove: {
      swingRatio: 0.66, microtimingMs: 22, microtiming: "behind",
      syncopation: 0.55, subdivisions: [] as unknown as StyleFingerprint["groove"]["subdivisions"],
      onsetDensity: 4.5,
    },
  })));
  assert.equal(full.status, "available");
  if (full.status !== "available") return;
  assert.equal(full.version, `${STYLE_GRAMMAR_VERSION}:full`);
  assert.ok(full.rules.every((r) => typeof r.description === "string" && r.description.length > 0));

  const thin = styleGrammarSlot(deriveStyleGrammar(neutralFingerprint({
    durationSeconds: 20, sectionCount: 1,
    groove: {
      swingRatio: 0.66, microtimingMs: 22, microtiming: "behind",
      syncopation: 0.55, subdivisions: [] as unknown as StyleFingerprint["groove"]["subdivisions"],
      onsetDensity: 4.5,
    },
  })));
  assert.equal((thin as { version: string }).version, `${STYLE_GRAMMAR_VERSION}:thin`);
});
