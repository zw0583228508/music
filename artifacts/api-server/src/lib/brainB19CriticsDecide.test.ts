/**
 * Brain B-19: the critics decide what ships — on real arrangements.
 *
 * `candidateRanking.test.ts` exercises the decision paths one at a time on
 * constructed verdicts. This file drives the same paths from critic output
 * measured on arrangements the real orchestrator wrote, and holds the two
 * controls the charter requires before a gate is allowed to gate:
 *
 *  - a **null control** (material the gate lets through, so "refused" means
 *    something), and
 *  - a **positive control** (the same material deliberately worsened, refused
 *    by the new path while the old conservative score prefers it).
 */
import assert from "node:assert/strict";
import { mkdirSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import test from "node:test";
import {
  B19_EVIDENCE_VERSION,
  CONTROL_ANCHOR_IDS,
  buildB19Evidence,
  conservativeScoreOf,
  storedVerdictFor,
  verdictFor,
} from "./brainB19Evidence";
import { anchors, applyFamilyCorruption, eligibleParts } from "./critics/dimensions/anchors";
import { candidateStatusAfterCriticJudge, criticJudgeRefusal, hasCompleteQualityEvidence, rankEvaluatedCandidates } from "./candidateRanking";
import type { CandidateCriticVerdict, CandidateEvaluation } from "@workspace/db";

const qualityChecks = { silence: 1, clipping: 1, notePlayability: 1, timing: 1, sectionCoverage: 1, lineage: 1 };

/** A production-shaped evaluation carrying a measured verdict and a measured old score. */
function evaluationFor(criticVerdict: CandidateCriticVerdict, conservativeScore: number): CandidateEvaluation {
  const evaluation = {
    status: "evaluated",
    providerScore: conservativeScore,
    renderArtifactIds: ["audio", "midi"],
    artifacts: [
      { id: "audio", type: "AUDIO_TRACK", label: "Audio", url: "/audio.wav", artifactSha256: "a".repeat(64) },
      { id: "midi", type: "MIDI", label: "MIDI", url: "/notes.mid" },
      { id: "quality", type: "QUALITY_REPORT", label: "Quality", url: "/quality.json" },
    ],
    qualityReport: {
      score: conservativeScore, checks: qualityChecks, weights: qualityChecks,
      strengths: [], weaknesses: [], warnings: [],
      evaluatedAt: "2026-09-11T00:00:00.000Z", renderArtifactIds: ["audio", "midi"], lineageComplete: true,
    },
    musicCritic: {
      version: "music-critic-v1", score: conservativeScore,
      coverage: { availableDimensions: 0, totalDimensions: 8, sparse: true },
      dimensions: Object.fromEntries([
        "vocalFit", "harmony", "development", "contrastAndTransitions",
        "registerCollisions", "playability", "repetition", "styleAndControlAdherence",
      ].map((name) => [name, { status: "unavailable", score: null, evidence: [], explanation: "n/a", findings: [] }])),
    },
    audioCritic: null,
    error: null,
    criticVerdict,
  } as unknown as CandidateEvaluation;
  const gate = candidateStatusAfterCriticJudge("validated", criticVerdict);
  return gate.status === "validated"
    ? evaluation
    : { ...evaluation, status: "critic_judge_refused", error: gate.reason };
}

test("null control: the gate is not a constant refusal — it passes real arrangements untouched", { timeout: 10 * 60 * 1000 }, () => {
  // A gate that refuses everything gates nothing (charter rule 3). Two of the
  // nine clean corpus anchors are releasable today, so a refusal below is a
  // measurement of the candidate and not of the gate.
  const passing = CONTROL_ANCHOR_IDS.map((id) => {
    const anchor = anchors([id])[0];
    const verdict = verdictFor(anchor.input);
    return { id, releasable: verdict.overall.releasable, refusals: verdict.refusals.length };
  });
  for (const row of passing) {
    assert.equal(row.releasable, true, `${row.id} is releasable untouched (${row.refusals} refusals)`);
    assert.equal(row.refusals, 0, row.id);
  }
  const stored = storedVerdictFor("clean", anchors([CONTROL_ANCHOR_IDS[0]])[0].input);
  assert.deepEqual(candidateStatusAfterCriticJudge("validated", stored), { status: "validated", reason: null });
  assert.equal(hasCompleteQualityEvidence(evaluationFor(stored, 0.808)), true, "and it stays selectable");
});

test("positive control: a bed revoiced off the chord is refused, and the old score prefers it", { timeout: 10 * 60 * 1000 }, () => {
  // The defect is the owner's: `clash_share` is exactly what blocks the string
  // bed in the v7a Outro. The corruption is the critic harness's own
  // `chord_tone_to_non_chord_tone`, so the worsening and the dimension that
  // catches it were not written together by one author.
  const anchor = anchors(["acoustic-demo"])[0];
  const bed = eligibleParts(anchor, "chord_tone_to_non_chord_tone")
    .find((part) => String(part.role ?? "").toUpperCase().includes("HARMONIC_BED"));
  assert.ok(bed, "the acoustic-demo anchor has a harmonic bed to revoice");
  const worsened = applyFamilyCorruption(anchor, bed.id, "chord_tone_to_non_chord_tone", 3, 1);
  assert.ok(worsened, "the bed can be revoiced off the chord");

  const cleanVerdict = storedVerdictFor("clean", anchor.input);
  const worsenedVerdict = storedVerdictFor("worsened", worsened.input);
  const cleanScore = conservativeScoreOf(anchor.input);
  const worsenedScore = conservativeScoreOf(worsened.input);

  // The judge hears it.
  assert.equal(cleanVerdict.releasable, true);
  assert.equal(worsenedVerdict.releasable, false, worsened.detail);
  assert.ok(worsenedVerdict.refusals.some((refusal) => refusal.kind === "clash_share"),
    `refusals: ${worsenedVerdict.refusals.map((refusal) => refusal.kind).join(", ")}`);

  // The old score does not: it goes *up* when the bed is moved off the chord,
  // so the ranking that shipped the owner's song would have preferred it.
  assert.ok(worsenedScore >= cleanScore,
    `the conservative score does not fall: clean ${cleanScore} -> worsened ${worsenedScore}`);

  // Old path: the worsened candidate wins on the score alone.
  const rowsWithoutVerdicts = [
    { id: "clean", score: cleanScore, evaluation: evaluationFor({ ...cleanVerdict, releasable: true, refusals: [], refusalCount: 0, blockingCount: 0 }, cleanScore) },
    { id: "worsened", score: worsenedScore, evaluation: evaluationFor({ ...worsenedVerdict, releasable: true, refusals: [], refusalCount: 0, blockingCount: 0 }, worsenedScore) },
  ];
  assert.equal(rankEvaluatedCandidates(rowsWithoutVerdicts)[0].id, "worsened",
    "with the verdicts neutralised, the conservative score alone selects the worsened candidate");

  // New path: it is refused, and the clean one is selected.
  const rows = [
    { id: "clean", score: cleanScore, evaluation: evaluationFor({ ...cleanVerdict, rank: 1, tieGroup: 1 }, cleanScore) },
    { id: "worsened", score: worsenedScore, evaluation: evaluationFor({ ...worsenedVerdict, rank: 2, tieGroup: 2 }, worsenedScore) },
  ];
  const ranked = rankEvaluatedCandidates(rows);
  assert.equal(ranked[0].id, "clean");
  assert.equal(ranked.find((row) => row.id === "worsened")?.rank, null, "a refused candidate is not ranked at all");
  assert.equal(rows[1].evaluation.status, "critic_judge_refused");
  assert.match(rows[1].evaluation.error ?? "", /clash_share/);
  assert.match(rows[1].evaluation.error ?? "", /Repairs asked for:/);
});

test("the owner's song is refused by the path that would now select it", { timeout: 10 * 60 * 1000 }, () => {
  const evidence = buildB19Evidence();
  const owner = evidence.ownerSong;
  assert.equal(owner.after.releasable, false, "the owner's arrangement is refused");
  assert.equal(owner.after.status, "critic_judge_refused");
  assert.ok(owner.after.refusalCount >= 1, "and the refusal names its observations");
  assert.ok(owner.after.refusals.every((refusal) => refusal.rule.length > 0));
  assert.ok(owner.after.topProblems.length >= 1);
  assert.match(owner.after.reason ?? "", /the release judge refused this candidate/);
  // Nothing is silently shipped: the runner has no releasable candidate to
  // offer, and the refusal reason is what a producer reads instead.
  assert.equal(hasCompleteQualityEvidence(evaluationFor(
    storedVerdictFor("owner", anchors(["acoustic-demo"])[0].input), 0.8,
  )), true, "sanity: the helper does not refuse everything");
  console.log(`OWNER v7a rebuild: releasable=${owner.after.releasable} blocking=${owner.after.blockingCount} refusals=${owner.after.refusalCount} conservativeScore=${owner.conservativeScore}`);
  console.log(`  refused by: ${[...new Set(owner.after.refusals.map((r) => `${r.kind}/${r.rule}`))].join(", ")}`);
  console.log(`  fix first: ${owner.after.topProblems.map((p) => `${p.kind} (${p.whatToFix})`).join(" | ")}`);
});

test("the B-19 evidence is built from those runs and is written when asked", { timeout: 20 * 60 * 1000 }, () => {
  const evidence = buildB19Evidence();
  assert.equal(evidence.version, B19_EVIDENCE_VERSION);

  // Null control: at least one anchor passes, or the gate proves nothing.
  assert.ok(evidence.nullControl.passed.length >= 1,
    "a gate that refuses every clean anchor has no demonstrated sensitivity");
  assert.equal(evidence.nullControl.rows.length, 9);
  // …and the refusals of the rest are reported rather than hidden.
  for (const row of evidence.nullControl.rows) {
    if (row.releasable) assert.equal(row.refusals, 0, row.anchorId);
    else assert.ok(row.refusalRules.length >= 1, row.anchorId);
  }

  // Positive control: every worsened candidate is refused, and the old score
  // failed to separate them on every case.
  assert.ok(evidence.positiveControl.cases >= 5, `cases ${evidence.positiveControl.cases}`);
  assert.equal(evidence.positiveControl.refusedEvery, true);
  assert.equal(evidence.positiveControl.oldScoreFailedOn, evidence.positiveControl.cases,
    "the conservative score never falls when a part is moved off the chord");
  for (const row of evidence.positiveControl.rows) {
    assert.equal(row.clean.releasable, true, `${row.anchorId}/${row.partId}`);
    assert.equal(row.worsened.releasable, false, `${row.anchorId}/${row.partId}`);
    assert.equal(row.newlySelected, "clean", `${row.anchorId}/${row.partId}`);
    assert.equal(row.worsenedStatus, "critic_judge_refused", `${row.anchorId}/${row.partId}`);
    assert.ok(row.worsened.refusalKinds.some((kind) => kind.startsWith("clash_share")),
      `${row.anchorId}/${row.partId}: ${row.worsened.refusalKinds.join(",")}`);
  }

  // The hand-off to B-20 is precise: every operator the critics ask for is
  // listed with the kinds that ask for it and whether it can be executed.
  assert.ok(evidence.operatorHandoff.rows.length >= 3);
  for (const row of evidence.operatorHandoff.rows) {
    assert.ok(row.kinds.length >= 1, row.operation);
    assert.ok(row.dimensions.length >= 1, row.operation);
    assert.equal(row.executable, evidence.operatorHandoff.executable.includes(row.operation));
  }

  assert.ok(evidence.honestLimits.length >= 6);
  console.log(`NULL CONTROL passed: ${evidence.nullControl.passed.join(", ") || "none"} | refused: ${evidence.nullControl.refused.join(", ") || "none"}`);
  console.log(`POSITIVE CONTROL: ${evidence.positiveControl.cases} cases, all refused, old score preferred the worsened candidate on ${evidence.positiveControl.oldScoreFailedOn}`);
  console.log(`OPERATORS asked for but not executable: ${evidence.operatorHandoff.unexecutable.join(", ") || "none"}`);

  const out = process.env.B19_WRITE_EVIDENCE;
  if (out) {
    const path = resolve(out);
    mkdirSync(resolve(path, ".."), { recursive: true });
    writeFileSync(path, `${JSON.stringify(evidence, null, 2)}\n`, "utf8");
    console.log(`evidence written to ${path}`);
  }
});
