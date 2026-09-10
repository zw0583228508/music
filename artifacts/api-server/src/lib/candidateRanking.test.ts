import { strict as assert } from "node:assert";
import { test } from "node:test";
import type {
  CandidateCriticVerdict,
  CandidateEvaluation,
  CandidateEvaluationStatus,
} from "@workspace/db";
import { ListGenerationCandidatesResponse } from "@workspace/api-zod";
import {
  candidateEvidenceScore,
  candidateStatusAfterCriticJudge,
  criticJudgeRefusal,
  hasCompleteQualityEvidence,
  isSelectableCandidate,
  publicCandidateEvaluation,
  rankEvaluatedCandidates,
} from "./candidateRanking";

const supportedStatuses = {
  plan_received: true,
  rendering: true,
  render_succeeded: true,
  analyzing: true,
  evaluated: true,
  render_failed: true,
  analysis_failed: true,
  diversity_rejected: true,
  repair_not_improved: true,
  repair_scope_violated: true,
  provider_hard_rule_refused: true,
  critic_judge_refused: true,
} satisfies Record<CandidateEvaluationStatus, true>;

const musicCritic: CandidateEvaluation["musicCritic"] = {
  version: "music-critic-v1",
  score: 0.84,
  coverage: {
    availableDimensions: 0,
    totalDimensions: 8,
    sparse: true,
  },
  dimensions: {
    vocalFit: { status: "unavailable", score: null, evidence: [], explanation: "safe-vocal-summary", findings: [] },
    harmony: { status: "unavailable", score: null, evidence: [], explanation: "safe-harmony-summary", findings: [] },
    development: { status: "unavailable", score: null, evidence: [], explanation: "safe-development-summary", findings: [] },
    contrastAndTransitions: { status: "unavailable", score: null, evidence: [], explanation: "safe-transition-summary", findings: [] },
    registerCollisions: { status: "unavailable", score: null, evidence: [], explanation: "safe-register-summary", findings: [] },
    playability: { status: "unavailable", score: null, evidence: [], explanation: "safe-playability-summary", findings: [] },
    repetition: { status: "unavailable", score: null, evidence: [], explanation: "safe-repetition-summary", findings: [] },
    styleAndControlAdherence: { status: "unavailable", score: null, evidence: [], explanation: "safe-style-summary", findings: [] },
  },
};

const privateFingerprintSentinels = [
  "private-active-track",
  "private-harmony",
  "private-track-role",
  987654321,
] as const;
const futurePrivateSentinel = "future-private-evaluation-sentinel";

for (const status of Object.keys(supportedStatuses) as CandidateEvaluationStatus[]) {
  test(`public candidate evaluation sanitizes ${status} status`, () => {
    const evaluation: CandidateEvaluation & {
      futureInternalEvaluation: { detail: string };
    } = {
      status,
      providerScore: 0.77,
      futureInternalEvaluation: { detail: futurePrivateSentinel },
      renderArtifactIds: [],
      artifacts: [],
      qualityReport: null,
      musicCritic,
      audioCritic: null,
      error: null,
      diversity: {
        fingerprint: {
          activeTracks: [privateFingerprintSentinels[0]],
          densityEnergy: [{ density: privateFingerprintSentinels[3], energy: 0.25 }],
          harmonySequence: [privateFingerprintSentinels[1]],
          trackRoleInstruments: [privateFingerprintSentinels[2]],
          noteShape: [privateFingerprintSentinels[3]],
        },
        comparedToCandidateId: "producer-safe-baseline",
        distance: 0.17,
        threshold: 0.25,
        rejected: status === "diversity_rejected",
        reason: status === "diversity_rejected"
          ? "near_duplicate"
          : "sufficiently_distinct",
      },
      repair: {
        sourceCandidateId: "archived-source-candidate",
        sourceCandidateLabel: "Original Groove",
        findingId: "critic-groove",
        seed: 42,
        attempt: 1,
        maxAttempts: 2,
        scope: {
          affectedSections: ["Chorus"],
          startBar: 9,
          endBar: 16,
          affectedTrackIds: ["drums"],
        },
        musicalReason: "The chorus rushes the backbeat.",
        outsideScopePreserved: true,
        changedScopes: [],
        sourceQualityScore: 0.7,
        repairedQualityScore: 0.84,
        improved: true,
      },
    };

    const publicEvaluation = publicCandidateEvaluation(evaluation);
    assert.deepEqual(publicEvaluation.musicCritic, musicCritic);
    assert.deepEqual(publicEvaluation.diversity, {
      comparedToCandidateId: "producer-safe-baseline",
      distance: 0.17,
      threshold: 0.25,
      rejected: status === "diversity_rejected",
      reason: status === "diversity_rejected"
        ? "near_duplicate"
        : "sufficiently_distinct",
    });
    assert.equal(publicEvaluation.repair?.sourceCandidateLabel, "Original Groove");

    const serialized = JSON.stringify(publicEvaluation);
    assert.equal(serialized.includes('"fingerprint"'), false);
    assert.equal(serialized.includes(futurePrivateSentinel), false);
    assert.equal("futureInternalEvaluation" in publicEvaluation, false);
    for (const sentinel of privateFingerprintSentinels) {
      assert.equal(serialized.includes(String(sentinel)), false);
    }
  });
}

const repairEvidence = {
  sourceCandidateId: "source",
  sourceCandidateLabel: "Original Groove",
  findingId: "finding",
  seed: 10,
  attempt: 1,
  maxAttempts: 2,
  scope: {
    affectedSections: ["chorus"],
    startBar: 5,
    endBar: 6,
    affectedTrackIds: ["piano"],
  },
  musicalReason: "Repair the chorus accompaniment.",
  outsideScopePreserved: true,
  changedScopes: [
    { level: "bar" as const, id: "bar:section:chorus:2:5" },
    { level: "event" as const, id: "event:section:chorus:2:5:piano" },
  ],
  sourceQualityScore: .5,
  repairedQualityScore: .7,
  improved: true,
};

const repairedCandidateResponse = (evaluation: ReturnType<typeof publicCandidateEvaluation>) => ({
  id: "candidate",
  jobId: "job",
  provider: "ACE_STEP",
  modelVersion: "1",
  reportedModelVersion: null,
  providerRequestId: null,
  seed: 10,
  rank: 1,
  label: "Repaired",
  score: .7,
  confidence: .8,
  summary: "Repaired candidate",
  status: "validated",
  parameters: {},
  harmonyDecisions: [],
  parentArtifactIds: [],
  plan: { sections: [] },
  trackModels: [],
  evaluation,
  createdAt: "2026-09-08T00:00:00.000Z",
});

test("candidate response parser retains new repair changed scopes", () => {
  const evaluation: CandidateEvaluation = {
    status: "evaluated",
    providerScore: .7,
    renderArtifactIds: [],
    artifacts: [],
    qualityReport: null,
    musicCritic: null,
    audioCritic: null,
    error: null,
    repair: repairEvidence,
  };
  const parsed = ListGenerationCandidatesResponse.parse([
    repairedCandidateResponse(publicCandidateEvaluation(evaluation)),
  ]);
  assert.deepEqual(parsed[0].evaluation.repair?.changedScopes, repairEvidence.changedScopes);
  assert.equal(parsed[0].evaluation.repair?.sourceCandidateLabel, "Original Groove");
});

test("candidate response parser upgrades historical repair evidence with empty changed scopes", () => {
  const { changedScopes: _removed, ...legacyRepair } = repairEvidence;
  const evaluation = {
    status: "evaluated",
    providerScore: .7,
    renderArtifactIds: [],
    artifacts: [],
    qualityReport: null,
    musicCritic: null,
    error: null,
    repair: legacyRepair,
  } as unknown as CandidateEvaluation;
  const parsed = ListGenerationCandidatesResponse.parse([
    repairedCandidateResponse(publicCandidateEvaluation(evaluation)),
  ]);
  assert.deepEqual(parsed[0].evaluation.repair?.changedScopes, []);
});

test("complete historical v1 critic remains rankable and parses through the public schema", () => {
  const checks = {
    silence: 1, clipping: 1, notePlayability: 1, timing: 1, sectionCoverage: 1, lineage: 1,
  };
  const evaluation = {
    status: "evaluated", providerScore: .7, renderArtifactIds: ["audio", "midi"],
    artifacts: [
      { id: "audio", type: "AUDIO_TRACK", label: "Audio", url: "/audio.wav" },
      { id: "midi", type: "MIDI", label: "MIDI", url: "/notes.mid" },
      { id: "quality", type: "QUALITY_REPORT", label: "Quality", url: "/quality.json" },
    ],
    qualityReport: {
      score: .8, checks, weights: checks, strengths: [], weaknesses: [], warnings: [],
      evaluatedAt: "2026-09-08T00:00:00.000Z", renderArtifactIds: ["audio", "midi"],
      lineageComplete: true,
    },
    musicCritic: { ...musicCritic, coverage: { availableDimensions: 0, totalDimensions: 8, sparse: true } },
    audioCritic: null, error: null,
  } as unknown as CandidateEvaluation;
  assert.equal(hasCompleteQualityEvidence(evaluation), true);
  const publicEvaluation = publicCandidateEvaluation(evaluation);
  assert.equal(publicEvaluation.musicCritic?.coverage.totalDimensions, 8);
  const parsed = ListGenerationCandidatesResponse.parse([
    repairedCandidateResponse(publicEvaluation),
  ]);
  assert.equal(parsed[0].evaluation.musicCritic?.version, "music-critic-v1");
  assert.equal(parsed[0].evaluation.musicCritic?.coverage.totalDimensions, 8);
});

test("populated v2 critic public serialization excludes observations fingerprints and evaluator details", () => {
  const privateValues = ["private-observation", "private-fingerprint", "private-evaluator-detail"];
  const result = {
    status: "available" as const, score: .4,
    evidence: [{
      source: "composition_intelligence" as const,
      summary: "Producer-safe summary",
      observations: { detail: privateValues[0], fingerprint: privateValues[1] },
    }],
    explanation: "Readable explanation",
    findings: [{
      id: "music-critic-v2:motif:chorus:5-5:piano", affectedSections: ["chorus"],
      startBar: 5, endBar: 5, affectedTrackIds: ["piano"], affectedRoles: ["harmony"],
      canonicalScope: { startBar: 5, endBar: 5 },
      evidenceReferences: [{ source: "composition_intelligence", summary: "Safe reference" }],
      permissibleRepairOperations: ["adjust_notes"], musicalReason: "Repair this phrase.",
    }],
    rawEvaluatorDetails: privateValues[2],
  };
  const dimensions = Object.fromEntries([
    "vocalFit", "harmony", "development", "contrastAndTransitions", "registerCollisions",
    "playability", "repetition", "styleAndControlAdherence", "motifContinuityAndDevelopment",
    "phraseIntent", "vocalInteraction", "roleDuplication", "orchestralBalance",
    "grooveCoordination", "voiceLeading", "countermelodyShape", "dramaticTrajectory",
  ].map((name) => [name, result]));
  const evaluation = {
    status: "evaluated", providerScore: .5, renderArtifactIds: [], artifacts: [],
    qualityReport: null, audioCritic: null, error: null,
    musicCritic: {
      version: "music-critic-v2", score: .4,
      coverage: { availableDimensions: 17, totalDimensions: 17, sparse: false },
      dimensions,
    },
  } as unknown as CandidateEvaluation;
  const publicEvaluation = publicCandidateEvaluation(evaluation);
  const serialized = JSON.stringify(publicEvaluation);
  for (const value of privateValues) assert.equal(serialized.includes(value), false);
  assert.deepEqual(
    publicEvaluation.musicCritic?.dimensions.motifContinuityAndDevelopment.evidence[0].observations,
    {},
  );
  const parsed = ListGenerationCandidatesResponse.parse([
    repairedCandidateResponse(publicEvaluation),
  ]);
  assert.equal(parsed[0].evaluation.musicCritic?.version, "music-critic-v2");
});
// ---------------------------------------------------------------------------
// Brain B-19: the critics decide what ships.
//
// Constructed verdicts here, so one decision path can be exercised at a time.
// The same paths are driven from real critic output on real arrangements in
// `brainB19CriticsDecide.test.ts`, where the verdicts are measured rather than
// written down.
// ---------------------------------------------------------------------------

const qualityChecks = {
  silence: 1, clipping: 1, notePlayability: 1, timing: 1, sectionCoverage: 1, lineage: 1,
};

/** A candidate that has everything the runner asks of it *except* a verdict. */
function completeEvaluation(over: Record<string, unknown> = {}): CandidateEvaluation {
  return {
    status: "evaluated",
    providerScore: 0.7,
    renderArtifactIds: ["audio", "midi"],
    artifacts: [
      { id: "audio", type: "AUDIO_TRACK", label: "Audio", url: "/audio.wav", artifactSha256: "a".repeat(64) },
      { id: "midi", type: "MIDI", label: "MIDI", url: "/notes.mid" },
      { id: "quality", type: "QUALITY_REPORT", label: "Quality", url: "/quality.json" },
    ],
    qualityReport: {
      score: 0.8, checks: qualityChecks, weights: qualityChecks, strengths: [], weaknesses: [], warnings: [],
      evaluatedAt: "2026-09-10T00:00:00.000Z", renderArtifactIds: ["audio", "midi"], lineageComplete: true,
    },
    musicCritic: { ...musicCritic, coverage: { availableDimensions: 0, totalDimensions: 8, sparse: true } },
    audioCritic: null,
    error: null,
    ...over,
  } as unknown as CandidateEvaluation;
}

function verdict(over: Partial<CandidateCriticVerdict> = {}): CandidateCriticVerdict {
  return {
    version: "CRITIC_JUDGE_v1",
    rankVersion: "B05C_RANK_v1",
    releasable: true,
    reasons: ["no blocking observation from any gated dimension and no release rule refused"],
    blockingCount: 0,
    refusalCount: 0,
    refusals: [],
    topProblems: [],
    contested: [],
    salienceWeightedMajors: 0,
    constructiveScore: 90,
    rank: 1,
    why: "no gated dimension blocks it and no release rule refuses it",
    tiedWith: [],
    tieGroup: 1,
    nearIdentical: null,
    gatedDimensions: ["harmony", "register"],
    dimensionsApplicable: 16,
    dimensionsTotal: 24,
    requestedRepairOperations: [],
    ...over,
  };
}

const clashRefusal = {
  observationId: "harmony:clash_share:strings:129-141",
  dimension: "harmony",
  kind: "clash_share",
  severity: "blocking" as const,
  rule: "blocking_from_gated_dimension",
  detail: "harmony is gated by measured positive controls and calls this blocking",
  startBar: 129,
  endBar: 141,
  sectionName: "Outro",
  repairOperation: "harmony.revoice_to_chord",
};

const refusedVerdict = (over: Partial<CandidateCriticVerdict> = {}) => verdict({
  releasable: false,
  blockingCount: 1,
  refusalCount: 1,
  refusals: [clashRefusal],
  requestedRepairOperations: ["harmony.revoice_to_chord"],
  reasons: ["1 blocking observation(s) from gated dimension(s): harmony:clash_share:strings:129-141"],
  ...over,
});

test("B-19: a candidate the judge refuses never reaches validated", () => {
  const gate = candidateStatusAfterCriticJudge("validated", refusedVerdict());
  assert.equal(gate.status, "critic_judge_refused");
  assert.match(gate.reason ?? "", /clash_share \[blocking\] in Outro \(bars 129-141\)/);
  assert.match(gate.reason ?? "", /refused by blocking_from_gated_dimension/);
  assert.match(gate.reason ?? "", /Repairs asked for: harmony\.revoice_to_chord\./);
});

test("B-19: a releasable candidate, and a candidate the judge never judged, are left alone", () => {
  assert.deepEqual(candidateStatusAfterCriticJudge("validated", verdict()), { status: "validated", reason: null });
  assert.deepEqual(candidateStatusAfterCriticJudge("validated", undefined), { status: "validated", reason: null });
  // A status that already says something truer than "refused" is not overwritten.
  assert.deepEqual(
    candidateStatusAfterCriticJudge("diversity_rejected", refusedVerdict()),
    { status: "diversity_rejected", reason: null },
  );
});

test("B-19: a refusal says plainly what blocked it and what repair was asked for", () => {
  const refusal = criticJudgeRefusal(refusedVerdict({
    refusals: [clashRefusal, {
      observationId: "register:top_line_above_comfortable_ceiling:strings:113-128",
      dimension: "register", kind: "top_line_above_comfortable_ceiling", severity: "major",
      rule: "major_on_a_bed", detail: "register calls the sustained texture wrong",
      startBar: 113, endBar: 128, sectionName: null, repairOperation: "register.revoice_below_ceiling",
    }],
    refusalCount: 2,
    requestedRepairOperations: ["harmony.revoice_to_chord", "register.revoice_below_ceiling"],
  }));
  assert.equal(refusal.refused, true);
  assert.match(refusal.reason ?? "", /nothing was releasable/);
  assert.match(refusal.reason ?? "", /top_line_above_comfortable_ceiling \[major\] in bars 113-128/);
  assert.match(refusal.reason ?? "", /register\.revoice_below_ceiling/);
});

test("B-19: a CONTESTED verdict is never collapsed into a pass", () => {
  // The judge keeps disagreements it has no rule for. A refusal carries them
  // forward rather than reading its own refusal as having settled them.
  const contested = refusedVerdict({
    contested: [{
      topic: "texture density", startBar: 41, endBar: 56,
      positions: ["density: no_rests", "orchestration: too_sparse"],
      rationale: "kept open: no resolution rule covers texture density between density and orchestration",
    }],
  });
  assert.match(criticJudgeRefusal(contested).reason ?? "", /1 disagreement\(s\) were kept open and are not resolved by this refusal/);
  // And a *releasable* verdict with an open disagreement stays releasable and
  // stays contested: the gate reads `releasable`, and the open disagreement
  // travels with the candidate for a human to read.
  const releasableButContested = verdict({ contested: contested.contested });
  assert.deepEqual(criticJudgeRefusal(releasableButContested), { refused: false, reason: null });
  assert.equal(publicCandidateEvaluation(
    completeEvaluation({ criticVerdict: releasableButContested }),
  ).criticVerdict?.contested.length, 1);
});

test("B-19 hard case: a releasable candidate ranked below an unreleasable one on the old score wins", () => {
  // The exact failure this stream exists to close. The refused candidate has
  // the better conservative score - 0.807 was the owner's v7a number - and the
  // old ranking selected it. The judge's order now comes first.
  const refused = {
    id: "cand-refused",
    score: 0.807,
    evaluation: completeEvaluation({
      musicCritic: { ...musicCritic, score: 0.9 },
      criticVerdict: refusedVerdict({ rank: 2, tieGroup: 2, why: "cand-releasable is releasable and this one is not" }),
    }),
  };
  const releasable = {
    id: "cand-releasable",
    score: 0.61,
    evaluation: completeEvaluation({
      musicCritic: { ...musicCritic, score: 0.61 },
      criticVerdict: verdict({ rank: 1, tieGroup: 1, constructiveScore: 72 }),
    }),
  };
  // The old score alone prefers the refused candidate...
  assert.ok(candidateEvidenceScore(refused) > candidateEvidenceScore(releasable));
  // ...and the judge's order overrules it, in both input orders.
  for (const rows of [[refused, releasable], [releasable, refused]]) {
    const ranked = rankEvaluatedCandidates(rows);
    assert.equal(ranked[0].id, "cand-releasable", "the releasable candidate ranks first");
    assert.equal(ranked[0].rank, 1);
  }
});

test("B-19 hard case: when every candidate is refused, nothing is selectable", () => {
  const rows = ["a", "b", "c"].map((id, index) => ({
    id: `cand-${id}`,
    score: 0.8 - index * 0.1,
    status: "critic_judge_refused",
    trackModels: [{ id: "t" }],
    evaluatedPlan: { sections: [] },
    evaluatedStyleSpec: {},
    evaluation: completeEvaluation({
      status: "critic_judge_refused",
      error: criticJudgeRefusal(refusedVerdict()).reason,
      criticVerdict: refusedVerdict({ rank: index + 1, tieGroup: index + 1 }),
    }),
  }));
  for (const row of rows) {
    assert.equal(hasCompleteQualityEvidence(row.evaluation), false, "a refused candidate carries no complete evidence");
    assert.equal(isSelectableCandidate(row), false, "and cannot be selected");
    assert.match(row.evaluation.error ?? "", /the release judge refused this candidate/);
  }
  // Every rank is null: the runner has nothing to offer, and says so rather
  // than ranking the least-bad candidate first.
  assert.deepEqual(rankEvaluatedCandidates(rows).map((row) => row.rank), [null, null, null]);
});

test("B-19: rows the judge never judged keep the legacy order", () => {
  // Historical candidates carry no verdict. Ordering a judged candidate against
  // an unjudged one on the judge's rank would be inventing a decision, so the
  // reconciled evidence score still decides between them.
  const legacyHigh = { id: "legacy-high", score: 0.9, evaluation: completeEvaluation({ musicCritic: { ...musicCritic, score: 0.9 } }) };
  const legacyLow = { id: "legacy-low", score: 0.2, evaluation: completeEvaluation({ musicCritic: { ...musicCritic, score: 0.2 } }) };
  assert.equal(rankEvaluatedCandidates([legacyLow, legacyHigh])[0].id, "legacy-high");
  const judgedButWorseLegacy = {
    id: "judged", score: 0.1,
    evaluation: completeEvaluation({ musicCritic: { ...musicCritic, score: 0.1 }, criticVerdict: verdict({ rank: 1 }) }),
  };
  assert.equal(rankEvaluatedCandidates([judgedButWorseLegacy, legacyHigh])[0].id, "legacy-high",
    "one verdict does not order a candidate the judge never saw");
});

test("B-19: the verdict is public, bounded, and parses through the response schema", () => {
  const evaluation = completeEvaluation({ criticVerdict: refusedVerdict({
    topProblems: [{
      observationId: clashRefusal.observationId, dimension: "harmony", kind: "clash_share",
      severity: "blocking", bars: "129-141", section: "Outro", priority: 1204.5,
      whatToFix: "harmony.revoice_to_chord (part): move the bed onto chord tones in bars 129-141",
      repairOperation: "harmony.revoice_to_chord",
    }],
  }) });
  const publicEvaluation = publicCandidateEvaluation(evaluation);
  assert.equal(publicEvaluation.criticVerdict?.releasable, false);
  assert.equal(publicEvaluation.criticVerdict?.refusals[0].rule, "blocking_from_gated_dimension");
  assert.equal(publicEvaluation.criticVerdict?.topProblems[0].repairOperation, "harmony.revoice_to_chord");
  const parsed = ListGenerationCandidatesResponse.parse([repairedCandidateResponse(publicEvaluation)]);
  assert.equal(parsed[0].evaluation.criticVerdict?.refusals[0].kind, "clash_share");
  assert.equal(parsed[0].evaluation.criticVerdict?.tieGroup, 1);
});
