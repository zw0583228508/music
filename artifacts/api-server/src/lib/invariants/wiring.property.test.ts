/**
 * Brain B-12b: two invariants the independent engineering review (R-1a)
 * isolated, about the seam between the brain and the path a user reaches.
 *
 *   - `selection_respects_selectable` - a candidate the brain refused is not
 *     selectable and does not rank first (R-1a P0-1);
 *   - `composer_receives_its_context` - the orchestrator's default compose
 *     lambda hands the writers the groove plan, the siblings and a decision
 *     registry, so B-02's, B-04's, B-03's and B-11's work is reachable on the
 *     production path (R-1a P0-2).
 *
 * Both fail today and run as `todo` with the observed behaviour and the
 * production line that causes it. Both carry a negative control: the ranking
 * invariant is shown rejecting a candidate whose evidence is genuinely
 * incomplete (so `isSelectableCandidate` is not a constant `true`), and the
 * context invariant is shown accepting provenance that does record the three
 * layers (so it is not a constant `false`).
 */
import assert from "node:assert/strict";
import test from "node:test";
import type { CandidateEvaluation } from "@workspace/db";
import { hasCompleteQualityEvidence, isSelectableCandidate, rankEvaluatedCandidates } from "../candidateRanking";
import type { CandidateProvenance } from "../decisionProvenance";
import { groovePlanOf, provenanceOf, runBrain, type Violation } from "./analysis";
import { composerContextWired } from "./reviewChecks";
import { recordEvidence, seedsUpTo, summarizeOutcomes, type SeedOutcome } from "./evidence";
import { generateSongModel } from "./generators";

const SEEDS = seedsUpTo(20, 1900);
const describe = (violations: Violation[]) => violations.slice(0, 4).map((v) => `${v.code}: ${v.detail}`).join(" | ");

// ---------------------------------------------------------------------------
// selection_respects_selectable
// ---------------------------------------------------------------------------

/**
 * A runner-shaped candidate: complete quality evidence (so it is rankable),
 * a critic score, and the provider's `parameters.arrangementBrain` block that
 * `arrangementOrchestratorProvider.ts:527-528` fills with `hardRuleFeasible`
 * and `selectable`.
 */
function runnerCandidate(id: string, score: number, brainSelectable: boolean) {
  const checks = { silence: 1, clipping: 1, notePlayability: 1, timing: 1, sectionCoverage: 1, lineage: 1 };
  const dimension = { status: "unavailable" as const, score: null, evidence: [], explanation: "not judged in this fixture", findings: [] };
  const evaluation = {
    status: "evaluated", providerScore: 0.7, renderArtifactIds: ["audio", "midi"],
    artifacts: [
      { id: "audio", type: "AUDIO_TRACK", label: "Audio", url: "/audio.wav" },
      { id: "midi", type: "MIDI", label: "MIDI", url: "/notes.mid" },
      { id: "quality", type: "QUALITY_REPORT", label: "Quality", url: "/quality.json" },
    ],
    qualityReport: {
      score: 0.8, checks, weights: checks, strengths: [], weaknesses: [], warnings: [],
      evaluatedAt: "2026-09-10T00:00:00.000Z", renderArtifactIds: ["audio", "midi"], lineageComplete: true,
    },
    musicCritic: {
      version: "music-critic-v1", score, coverage: { availableDimensions: 0, totalDimensions: 8, sparse: true },
      dimensions: {
        vocalFit: dimension, harmony: dimension, development: dimension, contrastAndTransitions: dimension,
        registerCollisions: dimension, playability: dimension, repetition: dimension, styleAndControlAdherence: dimension,
      },
    },
    audioCritic: null, error: null,
  } as unknown as CandidateEvaluation;
  return {
    id, score, status: "validated", evaluation,
    trackModels: [{ id: `${id}-track` }], evaluatedPlan: {}, evaluatedStyleSpec: {},
    parameters: { arrangementBrain: { hardRuleFeasible: brainSelectable, selectable: brainSelectable } },
  };
}

/**
 * Observed 2026-09-10 on main 4c5d967 (B-12b); the assertions are unchanged.
 *
 * `arrangementOrchestratorProvider.ts:513-517, 527-528` labels a candidate the
 * brain's hard-rule gate refused with `selectable: false`, and nothing reads
 * it: `isSelectableCandidate` (`candidateRanking.ts:261-285`) asks only about
 * the evaluation status, the quality evidence, the tracks, the plan and the
 * style spec, and `rankEvaluatedCandidates` (`:319-337`) orders on the critic
 * scores alone. A refused candidate with the better critic score is therefore
 * both selectable and rank 1 on the path a user reaches.
 */
const KNOWN_FAILURE_SELECTABLE =
  "arrangementOrchestratorProvider.ts:527-528 writes selectable: false; candidateRanking.ts:261-285 isSelectableCandidate and :319-337 rankEvaluatedCandidates never read it - the brain-refused candidate is selectable and ranks 1 ahead of the candidate the brain passed";

test("selection_respects_selectable: a candidate the brain refused is not selectable and does not rank ahead of one it passed", { todo: KNOWN_FAILURE_SELECTABLE || undefined }, (t) => {
  const refused = runnerCandidate("cand-refused", 0.91, false);
  const passed = runnerCandidate("cand-passed", 0.62, true);
  const violations: Violation[] = [];
  if (isSelectableCandidate(refused)) {
    violations.push({ code: "refused_candidate_is_selectable", detail: `${refused.id} carries parameters.arrangementBrain.selectable = false and isSelectableCandidate returns true` });
  }
  const ranked = rankEvaluatedCandidates([refused, passed]);
  const first = ranked.find((c) => c.rank === 1);
  if (first?.id === refused.id) {
    violations.push({ code: "refused_candidate_ranks_first", detail: `${refused.id} (critic ${refused.score}, brain-refused) ranks 1 ahead of ${passed.id} (critic ${passed.score}, brain-passed)` });
  }
  const record = summarizeOutcomes({
    invariant: "selection_respects_selectable",
    description: "A provider candidate labelled `selectable: false` by the brain's hard-rule gate is refused by isSelectableCandidate and never ranked above a candidate the brain passed, whatever the critic scores are.",
    outcomes: [{ seed: 1, passed: violations.length === 0, violations, notes: { refusedScore: refused.score, passedScore: passed.score, rankedFirst: first?.id ?? "none" } }],
    knownFailure: KNOWN_FAILURE_SELECTABLE || undefined,
    extra: { ranking: ranked.map((c) => `${c.id}:rank ${c.rank}`) },
  });
  recordEvidence(record);
  t.diagnostic(`selectable: isSelectableCandidate(refused) = ${isSelectableCandidate(refused)}; ranking ${ranked.map((c) => `${c.id}#${c.rank}`).join(", ")}`);
  assert.deepEqual(violations.map((v) => `${v.code}: ${v.detail}`), []);
});

test("negative control: the ranking gate is not a constant - a candidate whose evidence is incomplete is refused and left unranked, and two brain-passed candidates rank by their scores", () => {
  const good = runnerCandidate("cand-good", 0.8, true);
  const weaker = runnerCandidate("cand-weaker", 0.5, true);
  assert.equal(isSelectableCandidate(good), true, "a complete, brain-passed candidate is selectable");
  assert.equal(rankEvaluatedCandidates([weaker, good]).find((c) => c.rank === 1)?.id, "cand-good", "and the better score ranks first");

  const incomplete = { ...good, id: "cand-incomplete", evaluation: { ...good.evaluation, qualityReport: null } as CandidateEvaluation };
  assert.equal(hasCompleteQualityEvidence(incomplete.evaluation), false);
  assert.equal(isSelectableCandidate(incomplete), false, "a candidate without a quality report is refused");
  assert.equal(rankEvaluatedCandidates([incomplete, weaker]).find((c) => c.id === "cand-incomplete")?.rank, null, "and is left unranked");

  const unvalidated = { ...good, id: "cand-unvalidated", status: "pending" };
  assert.equal(isSelectableCandidate(unvalidated), false, "an unvalidated candidate is refused");

  const trackless = { ...good, id: "cand-trackless", trackModels: [] };
  assert.equal(isSelectableCandidate(trackless), false, "a candidate with no tracks is refused");
});

// ---------------------------------------------------------------------------
// composer_receives_its_context
// ---------------------------------------------------------------------------

/**
 * Observed 2026-09-10 on main 4c5d967 (B-12b); the assertion is unchanged.
 *
 * `arrangementOrchestrator.ts:425-426`: `compose = input.composeParts ??
 * ((request) => composeReferencePart(request, { tempoBpm, meter }))`. The
 * default lambda forwards no `context`, so no siblings, no decision registry,
 * no groove plan and no motif ledger reach a writer unless a composer is
 * injected - which the provider never does. The consequences are on the
 * output: the plan carries no `groovePlan`, and every track's provenance names
 * harmony, groove and register as `notRecorded`.
 */
const KNOWN_FAILURE_CONTEXT =
  "arrangementOrchestrator.ts:425-426 - the default compose lambda forwards no context, so no siblings, decision registry, groove plan or motif ledger reach a writer - 0/20 seeds pass: 0 of 20 candidates carry a groovePlan on the plan, and all 20 report harmony, groove and register as notRecorded while carrying only arc, compose, orchestration and perform decisions";

test("composer_receives_its_context: the shipped plan carries the groove plan and every candidate records a harmony, groove and register decision (20 seeds)", { todo: KNOWN_FAILURE_CONTEXT || undefined }, (t) => {
  const outcomes: SeedOutcome[] = [];
  let candidates = 0;
  let withGroovePlan = 0;
  const notRecorded = new Map<string, number>();
  const layersSeen = new Map<string, number>();
  for (const seed of SEEDS) {
    const model = generateSongModel(seed, { stems: ["drums", "bass", "keys", "strings"], vocals: seed % 2 === 0, naming: "english" }).model;
    const result = runBrain(model, { candidateCount: 1 });
    const violations: Violation[] = [];
    for (const candidate of result.candidates) {
      candidates += 1;
      const report = composerContextWired(candidate, result);
      if (report.groovePlanOnThePlan) withGroovePlan += 1;
      for (const layer of report.notRecordedLayers) notRecorded.set(layer, (notRecorded.get(layer) ?? 0) + 1);
      for (const layer of report.layersWithDecisions) layersSeen.set(layer, (layersSeen.get(layer) ?? 0) + 1);
      violations.push(...report.violations);
    }
    outcomes.push({ seed, passed: violations.length === 0, violations, notes: { candidates: result.candidates.length } });
  }
  const record = summarizeOutcomes({
    invariant: "composer_receives_its_context",
    description: "Through the orchestrator's own default compose lambda: the shipped ArrangementPlan carries a groovePlan, and every candidate carries at least one harmony, groove and register decision in its provenance.",
    outcomes, knownFailure: KNOWN_FAILURE_CONTEXT || undefined,
    extra: {
      candidatesJudged: candidates, candidatesWithGroovePlanOnThePlan: withGroovePlan,
      layersReportedNotRecorded: Object.fromEntries(notRecorded), layersCarryingDecisions: Object.fromEntries(layersSeen),
    },
  });
  recordEvidence(record);
  t.diagnostic(`composer context: ${record.passed}/${SEEDS.length} pass; ${withGroovePlan}/${candidates} candidates have a groovePlan on the plan; layers not recorded ${JSON.stringify(Object.fromEntries(notRecorded))}; layers with decisions ${JSON.stringify(Object.fromEntries(layersSeen))}`);
  assert.deepEqual(outcomes.filter((o) => !o.passed).map((o) => `${o.seed}: ${describe(o.violations)}`), []);
});

test("negative control: the context checker is not a constant - a plan carrying a groove plan and provenance carrying the three layers passes, and removing either is refused", () => {
  const model = generateSongModel(1901, { stems: ["drums", "bass", "keys", "strings"], vocals: true, naming: "english" }).model;
  const result = runBrain(model, { candidateCount: 1 });
  const candidate = result.candidates[0];
  const observed = composerContextWired(candidate, result);
  assert.ok(observed.violations.length > 0, "the untouched output is judged, not waved through");

  // Wire it by hand: a groove plan on the plan, and one decision of each layer per track.
  const base = provenanceOf(candidate, result);
  const range = (layer: string) => ({ startBar: 1, endBar: 9999, decisionIds: [`${layer}:control`], reason: "negative control" });
  const wiredProvenance = (layers: readonly string[]): CandidateProvenance => ({
    ...base,
    byTrack: Object.fromEntries(Object.entries(base.byTrack).map(([id, own]) => [id, {
      ...own, ranges: [...own.ranges, ...layers.map(range)], notRecorded: [],
    }])),
  });
  // A real GroovePlan, derived from this very run, so the control is what the
  // wiring would put there and not a shape that only satisfies a truthiness test.
  const groovePlan = groovePlanOf(result, model);
  assert.ok(groovePlan, "the plan's layers do derive a groove plan; only nothing puts it on the plan");
  const wiredResult = { ...result, plan: { ...result.plan, groovePlan } };
  const allLayers = ["harmony", "groove", "register"];
  assert.deepEqual(composerContextWired(candidate, wiredResult, wiredProvenance(allLayers)).violations, [], "a wired output passes");

  assert.ok(composerContextWired(candidate, result, wiredProvenance(allLayers)).violations.some((v) => v.code === "groove_plan_not_on_the_plan"), "removing the groove plan is refused");
  for (const layer of allLayers) {
    const violations = composerContextWired(candidate, wiredResult, wiredProvenance(allLayers.filter((l) => l !== layer))).violations;
    assert.ok(violations.some((v) => v.code === "layer_unreachable_from_the_composer" && v.detail.includes(layer)), `removing the ${layer} decisions is refused`);
  }
});
