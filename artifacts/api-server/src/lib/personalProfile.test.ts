import assert from "node:assert/strict";
import test from "node:test";
import type { PreferenceEvent } from "@workspace/db";
import { FEATURE_NAMES } from "./preferenceEvents";
import { derivePersonalProfile, personalStyleProfile } from "./personalProfile";

function features(overrides: Record<string, number>): Record<string, number> {
  const f: Record<string, number> = {};
  for (const name of FEATURE_NAMES) f[name] = 0;
  Object.assign(f, { "tempo.bpm": 120, "harmony.chordsPerBar": 1, "harmony.extensionShare": 0.3, "dynamics.velocityP10": 70, "dynamics.velocityP90": 95, "melodicShape.phraseLengthBeats": 4, "groove.syncopation": 0.2, "register.low": 0.2 }, overrides);
  return f;
}

/** An owner who keeps choosing swung, low-register, sparse arrangements. */
function events(count: number, seed = 3): PreferenceEvent[] {
  let state = seed >>> 0;
  const rand = () => { state = (state * 1664525 + 1013904223) >>> 0; return state / 0xffffffff; };
  const out: PreferenceEvent[] = [];
  for (let i = 0; i < count; i += 1) {
    const winner = features({ "groove.swingRatio": 0.6 + rand() * 0.08, "register.low": 0.5 + rand() * 0.2, "groove.onsetDensity": 1.5 + rand() });
    const loser = features({ "groove.swingRatio": 0.5 + rand() * 0.03, "register.low": 0.1 + rand() * 0.2, "groove.onsetDensity": 3 + rand() });
    const subjectWins = rand() > 0.5;
    out.push({
      id: `e${i}`, ownerId: "o", projectId: "p", decisionId: null, kind: "pairwise", source: "explicit_feedback", rightsBasis: "platform_generated",
      subject: { kind: "candidate", id: `s${i}`, fingerprintDigest: null, rankingScore: null, criticScore: null, modelVersion: null },
      compared: { kind: "candidate", id: `c${i}`, fingerprintDigest: null, rankingScore: null, criticScore: null, modelVersion: null },
      outcome: { preferred: subjectWins ? "subject" : "compared", rating: null, reasons: [] },
      features: { subject: subjectWins ? winner : loser, compared: subjectWins ? loser : winner, delta: null },
      createdAt: new Date(Date.UTC(2026, 0, 1, 0, i)).toISOString(),
    });
  }
  return out;
}

test("with enough consistent choices the owner's defaults appear, at default provenance, with human evidence", () => {
  const profile = derivePersonalProfile(events(12), { now: new Date(0) });
  assert.equal(profile.support.preferredSubjects, 12);
  assert.ok(profile.dimensions.swingRatio && profile.dimensions.swingRatio.value >= 0.6, `swing ${profile.dimensions.swingRatio?.value}`);
  assert.equal(profile.dimensions.swingRatio!.provenance, "default");
  assert.equal(profile.dimensions.registerTendencies?.value, "low");
  assert.ok(profile.dimensions.swingRatio!.confidence <= 0.6, "a learned default never claims more than 0.6");
  const swingEvidence = profile.evidence.find((e) => e.dimension === "swingRatio")!;
  assert.equal(swingEvidence.agreement, 1, "every choice agreed with the swing direction");
  assert.match(swingEvidence.summary, /swing at 0\.6/);
  assert.equal(profile.dimensions.harmonicRhythm?.value, "moderate");
  assert.equal(profile.dimensions.dynamics?.value, "moderate");
});

test("too few choices decide nothing; the profile says why", () => {
  const profile = derivePersonalProfile(events(3), { now: new Date(0) });
  assert.deepEqual(profile.dimensions, {});
  assert.ok(profile.undecided.length >= 5);
  assert.match(profile.undecided[0].reason, /only 3 preferred subject\(s\); 5 needed/);
  assert.deepEqual(derivePersonalProfile([]).dimensions, {});
});

test("a mixed direction is left undecided rather than averaged into a default", () => {
  // Half the time the owner picks the swung one, half the time the straight one.
  const mixed = events(12).map((e, i) => (i % 2 ? { ...e, outcome: { ...e.outcome, preferred: (e.outcome.preferred === "subject" ? "compared" : "subject") as "subject" | "compared" } } : e));
  const profile = derivePersonalProfile(mixed, { now: new Date(0) });
  assert.equal(profile.dimensions.swingRatio, undefined);
  const why = profile.undecided.find((u) => u.dimension === "swingRatio")!;
  assert.match(why.reason, /direction agreement 0\.50/);
});

test("the profile becomes a StyleProfile the generation path understands", () => {
  const profile = derivePersonalProfile(events(10), { now: new Date(0) });
  const style = personalStyleProfile(profile, "pap-1");
  assert.equal(style.method, "personal-arrangement-profile/v1");
  assert.deepEqual(style.sources, ["personal:pap-1"]);
  assert.deepEqual(style.dimensions.swingRatio!.sourceRefs, ["personal:pap-1"]);
  assert.ok(style.confidence > 0 && style.confidence <= 0.6);
});

test("derivation is deterministic", () => {
  assert.deepEqual(derivePersonalProfile(events(8), { now: new Date(0) }), derivePersonalProfile(events(8), { now: new Date(0) }));
});
