import assert from "node:assert/strict";
import test from "node:test";
import type { ArrangementPlan, CandidatePlan } from "@workspace/db";
import {
  CANDIDATE_DIVERSITY_THRESHOLD,
  candidateDistance,
  fingerprintCandidate,
  type CandidateFingerprint,
} from "./candidateDiversity";
import { BRAIN_PLAN_SOURCE, adoptBrainPlan, readArrangementBrainEvidence } from "./brainPlanAdoption";

// ---------------------------------------------------------------------------
// The audit's arithmetic (§1.4): with activeTracks, densityEnergy and
// trackRoleInstruments shared, the largest distance two candidates can reach
// is 0.2·1 + 0.15·0.3·1 = 0.245 < 0.25 — every non-baseline candidate is a
// near-duplicate whatever its notes are.
// ---------------------------------------------------------------------------

function fingerprint(over: Partial<CandidateFingerprint>): CandidateFingerprint {
  return {
    activeTracks: ["0:drums", "0:bass", "1:drums", "1:bass", "1:keys"],
    densityEnergy: [{ density: 0.4, energy: 0.3 }, { density: 0.8, energy: 0.9 }],
    harmonySequence: ["0:0", "0.5:4", "1:7"],
    trackRoleInstruments: ["BASS:bass", "GROOVE:drums", "HARMONIC_BED:keys"],
    noteShape: [1, 2, 3],
    ...over,
  };
}

test("diversity arithmetic: shared plan sections cap the distance at 0.245, below the 0.25 gate", () => {
  const left = fingerprint({});
  // Completely different notes, same plan-derived components.
  const right = fingerprint({ harmonySequence: ["7:11", "7.5:2", "8:6"], noteShape: [9, 8, 7] });
  const distance = candidateDistance(left, right);
  assert.equal(Number(distance.toFixed(3)), 0.245, "the maximum reachable distance when three components are shared");
  assert.ok(distance < CANDIDATE_DIVERSITY_THRESHOLD, `${distance} is under the ${CANDIDATE_DIVERSITY_THRESHOLD} threshold: rejected as a near-duplicate`);
});

test("diversity arithmetic: per-candidate sections (active tracks or density) lift two different candidates over the gate", () => {
  const left = fingerprint({});
  const right = fingerprint({
    harmonySequence: ["7:11", "7.5:2", "8:6"], noteShape: [9, 8, 7],
    // The sparse candidate rests the keys in the verse and plays thinner.
    activeTracks: ["0:drums", "0:bass", "1:drums", "1:bass"],
    densityEnergy: [{ density: 0.25, energy: 0.3 }, { density: 0.55, energy: 0.9 }],
  });
  const distance = candidateDistance(left, right);
  assert.ok(distance >= CANDIDATE_DIVERSITY_THRESHOLD, `${distance} clears the gate once the plan sections are the candidate's own`);
});

// ---------------------------------------------------------------------------
// Adoption of the brain's plan
// ---------------------------------------------------------------------------

function legacyPlan(): ArrangementPlan {
  return {
    id: "legacy-1", version: 2,
    sections: [
      {
        section: "Verse", startBar: 1, endBar: 8, energy: 0.5, density: 0.5,
        tracks: { drums: "groove", bass: "root", keys: "pad" }, operations: [],
        activeTracks: ["t-drums", "t-bass", "t-keys"],
        trackDirectives: { "t-drums": { musicalFunction: "pulse" } as never, "t-keys": { musicalFunction: "texture" } as never },
      },
      {
        section: "Chorus", startBar: 9, endBar: 16, energy: 0.5, density: 0.5,
        tracks: { drums: "groove", bass: "root", keys: "pad" }, operations: [],
        activeTracks: ["t-drums", "t-bass", "t-keys"],
      },
    ],
    style: {} as ArrangementPlan["style"], songModelVersion: 1, parameters: { seed: 1 },
    provenance: { model: "legacy", version: "1", parameters: { seed: 1 }, parentIds: [], createdBy: "test" },
    hierarchy: {} as ArrangementPlan["hierarchy"],
    globalPlan: { inputsDigestSha256: "legacy-global" } as never,
    sectionPlan: { inputsDigestSha256: "legacy-section" } as never,
  } as ArrangementPlan;
}

const brainPlan = {
  id: "orchestrated-abc",
  globalPlan: { inputsDigestSha256: "brain-global", sectionTargets: [] },
  sectionPlan: { inputsDigestSha256: "brain-section", sections: [], roleAssignments: [], phrases: [] },
  orchestrationBudget: { windows: [] },
  transitionPlan: { transitions: [] },
  partComposerPlan: { tasks: [] },
} as unknown as ArrangementPlan;

const tracks = [
  { id: "t-drums", name: "drums", role: "GROOVE", instrument: "drums" },
  { id: "t-bass", name: "bass", role: "BASS", instrument: "bass" },
  { id: "t-keys", name: "keys", role: "HARMONIC_BED", instrument: "keys" },
];

test("adoptBrainPlan: the candidate's own sections and the brain's layers replace the legacy ones; the skeleton stays", () => {
  const candidatePlan: CandidatePlan = {
    sections: [
      { name: "Verse", energy: 0.3, density: 0.2, tracks: ["drums", "bass"] },
      { name: "Chorus", energy: 0.9, density: 0.7, tracks: ["drums", "bass", "keys"] },
    ],
    tracks: tracks.map((t) => ({ id: t.id, name: t.name, role: t.role, kind: "instrument" })),
  };
  const adopted = adoptBrainPlan({ legacyPlan: legacyPlan(), candidatePlan, brainPlan, tracks });
  assert.equal(adopted.id, "legacy-1", "the plan keeps the runner's identity");
  assert.equal(adopted.version, 2);
  assert.deepEqual(adopted.sections.map((s) => [s.section, s.energy, s.density, s.activeTracks]), [
    ["Verse", 0.3, 0.2, ["t-bass", "t-drums"]],
    ["Chorus", 0.9, 0.7, ["t-bass", "t-drums", "t-keys"]],
  ]);
  assert.deepEqual(adopted.sections[0].tracks, { drums: "groove", bass: "root", keys: "none" }, "a resting track is 'none' in the role map");
  assert.deepEqual(Object.keys(adopted.sections[0].trackDirectives ?? {}), ["t-drums"], "directives of resting tracks are dropped");
  assert.equal((adopted.globalPlan as { inputsDigestSha256: string }).inputsDigestSha256, "brain-global");
  assert.equal((adopted.sectionPlan as { inputsDigestSha256: string }).inputsDigestSha256, "brain-section");
  assert.ok(adopted.orchestrationBudget && adopted.transitionPlan && adopted.partComposerPlan, "the brain's layers are carried");
  assert.equal(adopted.parameters["planSource"], BRAIN_PLAN_SOURCE);
  assert.equal(adopted.provenance.parameters["brainPlanId"], "orchestrated-abc");
  assert.equal(adopted.provenance.parameters["seed"], 1, "legacy provenance is kept, not replaced");
});

test("adoptBrainPlan: two candidates of one job now fingerprint apart, where the legacy plan made them near-duplicates", () => {
  const sparse: CandidatePlan = {
    sections: [
      { name: "Verse", energy: 0.3, density: 0.2, tracks: ["drums", "bass"] },
      { name: "Chorus", energy: 0.9, density: 0.6, tracks: ["drums", "bass", "keys"] },
    ],
  };
  const full: CandidatePlan = {
    sections: [
      { name: "Verse", energy: 0.3, density: 0.5, tracks: ["drums", "bass", "keys"] },
      { name: "Chorus", energy: 0.9, density: 0.9, tracks: ["drums", "bass", "keys"] },
    ],
  };
  const note = (id: string, start: number, pitch: number) => ({ id, start, duration: 0.5, pitch, velocity: 90 });
  const models = (pitches: number[]) => [
    { id: "t-bass", instrument: "bass", role: "BASS", notes: pitches.map((p, i) => note(`b${i}`, i, p)) },
  ] as never;
  const legacyA = fingerprintCandidate(legacyPlan(), models([36, 40, 43, 36]));
  const legacyB = fingerprintCandidate(legacyPlan(), models([41, 45, 48, 41]));
  const legacyDistance = candidateDistance(legacyA, legacyB);
  assert.ok(legacyDistance < CANDIDATE_DIVERSITY_THRESHOLD, `legacy plan shared by both: ${legacyDistance} < ${CANDIDATE_DIVERSITY_THRESHOLD}`);

  const adoptedA = fingerprintCandidate(adoptBrainPlan({ legacyPlan: legacyPlan(), candidatePlan: sparse, brainPlan, tracks }), models([36, 40, 43, 36]));
  const adoptedB = fingerprintCandidate(adoptBrainPlan({ legacyPlan: legacyPlan(), candidatePlan: full, brainPlan, tracks }), models([41, 45, 48, 41]));
  const adoptedDistance = candidateDistance(adoptedA, adoptedB);
  assert.ok(adoptedDistance >= CANDIDATE_DIVERSITY_THRESHOLD, `the brain's own sections: ${adoptedDistance} >= ${CANDIDATE_DIVERSITY_THRESHOLD}`);
});

test("readArrangementBrainEvidence: only the brain's evidence is adopted; junk and foreign providers are left alone", () => {
  assert.equal(readArrangementBrainEvidence(undefined), null);
  assert.equal(readArrangementBrainEvidence({}), null);
  assert.equal(readArrangementBrainEvidence({ arrangementBrain: "yes" }), null);
  assert.equal(readArrangementBrainEvidence({ arrangementBrain: { version: "0.9", plan: brainPlan } }), null);
  assert.equal(readArrangementBrainEvidence({ arrangementBrain: { version: "1.0", plan: { id: "x" } } }), null, "a plan without layers is not the brain's");
  const evidence = readArrangementBrainEvidence({ arrangementBrain: { version: "1.0", plan: brainPlan } });
  assert.ok(evidence);
  assert.equal(evidence.plan.id, "orchestrated-abc");
});
