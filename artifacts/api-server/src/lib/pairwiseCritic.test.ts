import assert from "node:assert/strict";
import test from "node:test";
import type { PreferenceEvent } from "@workspace/db";
import { FEATURE_NAMES } from "./preferenceEvents";
import {
  PAIR_FEATURE_NAMES,
  buildPairs,
  preferenceProbability,
  preferenceScores,
  rerankNearTies,
  trainPairwiseCritic,
} from "./pairwiseCritic";

/** A deterministic owner who prefers more swing and slightly more onset density, whatever the critic says. */
function syntheticEvents(count: number, seed = 7): PreferenceEvent[] {
  let state = seed >>> 0;
  const rand = () => { state = (state * 1664525 + 1013904223) >>> 0; return state / 0xffffffff; };
  const features = (swing: number, density: number): Record<string, number> => {
    const f: Record<string, number> = {};
    for (const name of FEATURE_NAMES) f[name] = 0;
    f["tempo.bpm"] = 120; f["groove.swingRatio"] = swing; f["groove.onsetDensity"] = density; f["density.notesPerBarMean"] = density * 4;
    return f;
  };
  const events: PreferenceEvent[] = [];
  for (let i = 0; i < count; i += 1) {
    const a = { swing: 0.5 + rand() * 0.2, density: 1 + rand() * 4 };
    const b = { swing: 0.5 + rand() * 0.2, density: 1 + rand() * 4 };
    const criticA = 60 + rand() * 30; const criticB = 60 + rand() * 30; // the critic is indifferent to swing
    const taste = (a.swing - b.swing) * 10 + (a.density - b.density) * 0.3 + (rand() - 0.5) * 0.4;
    const preferred: "subject" | "compared" = taste > 0 ? "subject" : "compared";
    const fa = features(a.swing, a.density); const fb = features(b.swing, b.density);
    const delta: Record<string, number> = {}; for (const name of FEATURE_NAMES) delta[name] = fa[name] - fb[name];
    events.push({
      id: `e${String(i).padStart(3, "0")}`, ownerId: "o", projectId: "p", decisionId: null, kind: "pairwise", source: "explicit_feedback", rightsBasis: "platform_generated",
      subject: { kind: "candidate", id: `a${i}`, fingerprintDigest: null, rankingScore: 0.9, criticScore: criticA, modelVersion: null },
      compared: { kind: "candidate", id: `b${i}`, fingerprintDigest: null, rankingScore: 0.9, criticScore: criticB, modelVersion: null },
      outcome: { preferred, rating: null, reasons: [] },
      features: { subject: fa, compared: fb, delta },
      createdAt: new Date(Date.UTC(2026, 0, 1, 0, i)).toISOString(),
    });
  }
  return events;
}

test("pairs are mirrored and split chronologically; identical subjects teach nothing", () => {
  const events = syntheticEvents(20);
  const pairs = buildPairs(events, 0.25);
  assert.equal(pairs.length, 40, "every event gives a pair and its mirror");
  assert.equal(pairs.filter((p) => p.heldOut).length, 10, "the last 25 % of events are held out");
  assert.equal(pairs[0].x.length, PAIR_FEATURE_NAMES.length);
  assert.deepEqual(pairs[1].x, pairs[0].x.map((v) => -v));
  assert.equal(pairs[1].y, pairs[0].y === 1 ? 0 : 1);
  const same = { ...events[0], id: "same", compared: { ...events[0].compared!, criticScore: events[0].subject.criticScore }, features: { subject: events[0].features.subject, compared: events[0].features.subject, delta: {} } };
  assert.equal(buildPairs([same]).length, 0);
});

test("the critic learns the owner's taste where the critics were indifferent, and beats the critic-only baseline on held-out pairs", () => {
  const outcome = trainPairwiseCritic(syntheticEvents(80), { now: new Date(0) });
  assert.equal(outcome.status, "trained");
  if (outcome.status !== "trained") return;
  const { model } = outcome;
  const weight = (name: string) => model.weights[model.featureNames.indexOf(name)];
  assert.ok(weight("groove.swingRatio") > 0.3, `swing weight ${weight("groove.swingRatio")}`);
  assert.ok(weight("groove.onsetDensity") > 0, `density weight ${weight("groove.onsetDensity")}`);
  assert.ok(Math.abs(weight("score.criticDelta")) < weight("groove.swingRatio"), "the critic delta carries little weight for this owner");
  assert.ok(model.metrics.heldOutAccuracy >= 0.8, `held-out accuracy ${model.metrics.heldOutAccuracy}`);
  assert.ok(model.metrics.baselineAccuracy < 0.7, `critic-only baseline ${model.metrics.baselineAccuracy}`);
  assert.equal(model.promotable, true, model.promotionReason);
  assert.equal(model.influentialFeatures[0].name, "groove.swingRatio");
  assert.equal(model.trainedOn.events, 80);
});

test("training is deterministic and the model is antisymmetric", () => {
  const a = trainPairwiseCritic(syntheticEvents(40), { now: new Date(0) });
  const b = trainPairwiseCritic(syntheticEvents(40), { now: new Date(0) });
  assert.deepEqual(a, b);
  if (a.status !== "trained") return;
  const s1 = { id: "1", features: syntheticEvents(1)[0].features.subject, criticScore: 70, rankingScore: 0.9 };
  const s2 = { id: "2", features: syntheticEvents(1)[0].features.compared!, criticScore: 75, rankingScore: 0.9 };
  const p = preferenceProbability(a.model, s1, s2);
  assert.ok(Math.abs(p + preferenceProbability(a.model, s2, s1) - 1) < 1e-9);
  const scores = preferenceScores(a.model, [s1, s2]);
  assert.ok(Math.abs(scores.get("1")! + scores.get("2")! - 1) < 1e-6);
  assert.equal(preferenceScores(a.model, [s1]).get("1"), 0.5, "alone, no preference");
});

test("too little data is refused with the reason, and a model that does not beat the baseline is not promotable", () => {
  const few = trainPairwiseCritic(syntheticEvents(3));
  assert.equal(few.status, "insufficient");
  if (few.status === "insufficient") assert.match(few.reason, /need at least 8 training and 4 held-out pairs/);
  // An owner whose choices follow the critic exactly: the baseline is already right, nothing to beat.
  const followsCritic = syntheticEvents(60).map((e) => ({ ...e, outcome: { ...e.outcome, preferred: (e.subject.criticScore! >= e.compared!.criticScore! ? "subject" : "compared") as "subject" | "compared" } }));
  const outcome = trainPairwiseCritic(followsCritic, { now: new Date(0) });
  assert.equal(outcome.status, "trained");
  if (outcome.status === "trained") {
    assert.equal(outcome.model.metrics.baselineAccuracy, 1);
    assert.equal(outcome.model.promotable, false);
    assert.match(outcome.model.promotionReason, /does not beat/);
  }
});

test("re-ranking touches only near-ties: a clear critic verdict is never overturned by taste", () => {
  const items = [
    { id: "A", evidence: 0.80, pref: 0.2 },
    { id: "B", evidence: 0.79, pref: 0.9 },
    { id: "C", evidence: 0.60, pref: 0.99 },
    { id: "D", evidence: 0.59, pref: 0.1 },
  ];
  const out = rerankNearTies(items, (i) => i.evidence, (i) => i.pref, 0.03).map((i) => i.id);
  assert.deepEqual(out, ["B", "A", "C", "D"], "A/B is a near-tie where taste prefers B, so they swap; C/D is a near-tie where taste already prefers C, so it stays");
  const clear = rerankNearTies([{ id: "X", evidence: 0.9, pref: 0.1 }, { id: "Y", evidence: 0.7, pref: 0.9 }], (i) => i.evidence, (i) => i.pref).map((i) => i.id);
  assert.deepEqual(clear, ["X", "Y"], "0.2 apart is not a near-tie");
  const missing = rerankNearTies([{ id: "X", evidence: 0.9, pref: null }, { id: "Y", evidence: 0.89, pref: 0.9 }], (i) => i.evidence, (i) => i.pref).map((i) => i.id);
  assert.deepEqual(missing, ["X", "Y"], "no preference score, no swap");
});
