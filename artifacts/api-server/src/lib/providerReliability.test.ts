import assert from "node:assert/strict";
import test from "node:test";
import {
  ANALYSIS_DOMAINS,
  DEFAULT_UNKNOWN_RELIABILITY,
  PROVIDER_RELIABILITY,
  domainReliabilityProfile,
  reliabilityFor,
} from "./providerReliability";

test("every registered weight is a bounded competence estimate", () => {
  for (const profile of Object.values(PROVIDER_RELIABILITY)) {
    for (const [domain, weight] of Object.entries(profile.domains)) {
      assert.ok(
        ANALYSIS_DOMAINS.includes(domain as (typeof ANALYSIS_DOMAINS)[number]),
        `${profile.provider} references unknown domain ${domain}`,
      );
      assert.ok(
        typeof weight === "number" && weight >= 0 && weight <= 1,
        `${profile.provider}.${domain} = ${weight} is out of [0,1]`,
      );
    }
  }
});

test("preserves the legacy tempo / meter / key weights exactly", () => {
  assert.equal(reliabilityFor("STANDARD_MIDI", "tempo"), 0.99);
  assert.equal(reliabilityFor("ALL_IN_ONE", "tempo"), 0.84);
  assert.equal(reliabilityFor("BEAT_THIS", "tempo"), 0.82);
  assert.equal(reliabilityFor("MADMOM", "tempo"), 0.78);
  assert.equal(reliabilityFor("LOCAL_SIGNAL_ANALYZER_V1", "tempo"), 0.48);
  assert.equal(reliabilityFor("STANDARD_MIDI", "meter"), 0.99);
  assert.equal(reliabilityFor("ALL_IN_ONE", "meter"), 0.84);
  assert.equal(reliabilityFor("STANDARD_MIDI", "key"), 0.99);
  assert.equal(reliabilityFor("ESSENTIA", "key"), 0.82);
  assert.equal(reliabilityFor("LOCAL_SIGNAL_ANALYZER_V1", "key"), 0.45);
});

test("preserves the legacy transcription (melody) weights exactly", () => {
  assert.equal(reliabilityFor("BASIC_PITCH", "melody"), 1);
  assert.equal(reliabilityFor("MT3", "melody"), 0.98);
  assert.equal(reliabilityFor("MR_MT3", "melody"), 0.98);
  assert.equal(reliabilityFor("YOUR_MT3", "melody"), 0.98);
  assert.equal(reliabilityFor("SHEETSAGE", "melody"), 0.92);
});

test("unknown provider or domain falls back to the shared default", () => {
  assert.equal(reliabilityFor("NOT_A_PROVIDER", "tempo"), DEFAULT_UNKNOWN_RELIABILITY);
  assert.equal(reliabilityFor("BEAT_THIS", "melody"), DEFAULT_UNKNOWN_RELIABILITY);
});

test("domain profile is sorted strongest-first and deterministic", () => {
  const downbeats = domainReliabilityProfile("downbeats");
  assert.ok(downbeats.length >= 3);
  for (let i = 1; i < downbeats.length; i += 1) {
    assert.ok(downbeats[i - 1].reliability >= downbeats[i].reliability);
  }
  assert.deepEqual(domainReliabilityProfile("downbeats"), downbeats);
});
