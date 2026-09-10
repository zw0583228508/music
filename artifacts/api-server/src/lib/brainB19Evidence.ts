/**
 * Brain B-19 evidence — "the critics decide what ships".
 *
 * Until this stream the release judge (`critics/judge.ts`, B-05b/B-05c) and the
 * candidate ranking (`critics/rank.ts`, B-05c) were called by nobody on the
 * production path: `arrangementGeneration.ts` selected on the conservative
 * score `(musicCritic + audioCritic) / 2`. The owner's v7a arrangement carries
 * a *blocking* `clash_share` (the string bed clashes for 48.6 % of its time in
 * the Outro) and five refusals under the B-05c release rules, and it was
 * selected, mixed, mastered and exported anyway.
 *
 * This module measures the wiring rather than describing it. Everything here is
 * computed from real arrangements built by the real orchestrator:
 *
 *  - **Null control.** The nine clean corpus anchors, judged. A gate that
 *    refuses everything gates nothing, so the evidence records how many of them
 *    the judge passes *today* — and it is not nine.
 *  - **Positive control.** A real candidate, deliberately worsened with the
 *    critic harness's own `chord_tone_to_non_chord_tone` corruption (the bed
 *    revoiced off the chord, which is exactly the defect that shipped on the
 *    owner's song), against the same candidate untouched: the new selection
 *    path refuses the worsened one, and the old conservative score prefers it.
 *  - **The owner's song**, rebuilt from the stored Song Model v3 fixture the
 *    way B-05c's anchor builds it, with the verdict, the refusals and the
 *    repair operators the critics ask for.
 *  - **The operator hand-off to B-20**: which repair operators the critics name
 *    on these findings, and which of them `repairExecutor.ts` can execute.
 */
import { anchors, applyFamilyCorruption, eligibleParts, ownerAnchor, CLEAN_ANCHOR_IDS } from "./critics/dimensions/anchors";
import { evaluateAllDimensions } from "./critics/dimensions/index";
import { runAdversarialCritics } from "./critics/adversarial/index";
import { judge, judgeContextFromInput, type JudgeVerdict } from "./critics/judge";
import { rankCandidates, constructiveScoreOf } from "./critics/rank";
import { evaluateCandidateMusicalFit } from "./candidateQuality";
import { candidateStatusAfterCriticJudge, criticVerdictsFromRanking } from "./candidateRanking";
import type { CriticDimensionReport, CriticInput } from "./critics/types";
import type { CandidateCriticVerdict } from "@workspace/db";

export const B19_EVIDENCE_VERSION = "B19_CRITICS_DECIDE_v1" as const;

/**
 * The anchors the positive control is run on: the two clean anchors the judge
 * passes untouched. A worsening control is only a control on material the gate
 * would otherwise let through — worsening something already refused proves
 * nothing about the gate.
 */
export const CONTROL_ANCHOR_IDS = ["acoustic-demo", "orchestral-midi"] as const;

/**
 * The corruption the control uses: the critic harness's own
 * `chord_tone_to_non_chord_tone` at severity 3, seed 1 — a part revoiced off
 * the chord. It is the harness's, not this module's, so the worsening and the
 * dimension that catches it were not written together by one author.
 */
export const CONTROL_FAMILY = "chord_tone_to_non_chord_tone" as const;
export const CONTROL_SEVERITY = 3;
export const CONTROL_SEED = 1;

/**
 * The operators `repairExecutor.ts` implements, read from its own dispatch at
 * base sha `3b9ace3` (`repairExecutor.ts` is another stream's file and is not
 * imported here; this list is a *review finding* recorded for the hand-off, and
 * nothing in the production path reads it).
 */
export const EXECUTABLE_REPAIR_OPERATIONS: readonly string[] = [
  "arc.restate_climax", "arc.restate_dynamics", "arc.widen_dynamics", "arc.set_texture_level",
  "form.change_development_operator", "groove.change_comping_subdivision",
  "form.add_transition_device", "groove.add_fill",
  "orchestration.change_role", "register.shift_section_band",
  "compose.recompose_part",
];

const r4 = (value: number) => Number(value.toFixed(4));

export function reportsFor(input: CriticInput): CriticDimensionReport[] {
  return [...evaluateAllDimensions(input), ...runAdversarialCritics(input)];
}

export function verdictFor(input: CriticInput): JudgeVerdict {
  return judge(reportsFor(input), judgeContextFromInput(input));
}

/**
 * The score the production path ranked on before this stream: the symbolic
 * critic's `score`, which is what `(musicCritic.score + (audioCritic.score ??
 * musicCritic.score)) / 2` reduces to exactly when no rendered audio is present
 * (`arrangementGeneration.ts`). It is computed here with no harmony decisions,
 * because an anchor carries none — the same shape R-1a measured, where 13 of
 * the 17 legacy dimensions read `insufficient data` on brain output.
 */
export function conservativeScoreOf(input: CriticInput): number {
  return r4(evaluateCandidateMusicalFit({
    songModel: input.songModel,
    plan: input.plan,
    tracks: input.trackModels,
    harmonyDecisions: [],
  }).score);
}

/** The stored verdict a single candidate would carry, through the production projection. */
export function storedVerdictFor(candidateId: string, input: CriticInput): CandidateCriticVerdict {
  const reports = reportsFor(input);
  const context = judgeContextFromInput(input);
  const ranking = rankCandidates([{ candidateId, reports, context }]);
  const verdicts = new Map([[candidateId, judge(reports, context)]]);
  return criticVerdictsFromRanking(ranking, verdicts).get(candidateId)!;
}

export type ControlRow = {
  anchorId: string;
  partId: string;
  role: string;
  detail: string;
  clean: { releasable: boolean; blocking: number; refusals: number; conservativeScore: number; constructiveScore: number };
  worsened: { releasable: boolean; blocking: number; refusals: number; conservativeScore: number; constructiveScore: number; refusalKinds: string[] };
  /** True when the *old* ranking signal did not prefer the clean candidate. */
  oldScoreWouldHaveShippedTheWorsened: boolean;
  /** What `rankCandidates` selects between the two. */
  newlySelected: string | null;
  /** The status the worsened candidate reaches under the production gate. */
  worsenedStatus: string;
};

export type B19Evidence = ReturnType<typeof buildB19Evidence>;

export function buildB19Evidence() {
  // -------------------------------------------------------------------------
  // Null control: what the gate does to material nobody worsened.
  // -------------------------------------------------------------------------
  const nullControl = anchors([...CLEAN_ANCHOR_IDS]).map((anchor) => {
    const verdict = verdictFor(anchor.input);
    return {
      anchorId: anchor.id,
      composer: anchor.composer,
      releasable: verdict.overall.releasable,
      blocking: verdict.blocking.length,
      refusals: verdict.refusals.length,
      refusalRules: [...new Set(verdict.refusals.map((refusal) => `${refusal.rule}/${refusal.kind}`))].sort(),
      conservativeScore: conservativeScoreOf(anchor.input),
      constructiveScore: constructiveScoreOf(reportsFor(anchor.input)),
    };
  });

  // -------------------------------------------------------------------------
  // Positive control: worsen a real candidate the gate passes, and watch it
  // refuse — while the old score does not.
  // -------------------------------------------------------------------------
  const positiveControl: ControlRow[] = [];
  for (const anchorId of CONTROL_ANCHOR_IDS) {
    const anchor = anchors([anchorId])[0];
    const cleanReports = reportsFor(anchor.input);
    const cleanContext = judgeContextFromInput(anchor.input);
    const cleanVerdict = judge(cleanReports, cleanContext);
    const cleanConservative = conservativeScoreOf(anchor.input);
    for (const part of eligibleParts(anchor, CONTROL_FAMILY)) {
      const worsened = applyFamilyCorruption(anchor, part.id, CONTROL_FAMILY, CONTROL_SEVERITY, CONTROL_SEED);
      if (!worsened) continue;
      const worsenedReports = reportsFor(worsened.input);
      const worsenedContext = judgeContextFromInput(worsened.input);
      const worsenedVerdict = judge(worsenedReports, worsenedContext);
      const worsenedConservative = conservativeScoreOf(worsened.input);
      const ranking = rankCandidates([
        { candidateId: "clean", reports: cleanReports, context: cleanContext },
        { candidateId: "worsened", reports: worsenedReports, context: worsenedContext },
      ]);
      const storedWorsened = criticVerdictsFromRanking(ranking, new Map([
        ["clean", cleanVerdict], ["worsened", worsenedVerdict],
      ])).get("worsened")!;
      positiveControl.push({
        anchorId,
        partId: part.id,
        role: String(part.role ?? "unknown"),
        detail: worsened.detail,
        clean: {
          releasable: cleanVerdict.overall.releasable,
          blocking: cleanVerdict.blocking.length,
          refusals: cleanVerdict.refusals.length,
          conservativeScore: cleanConservative,
          constructiveScore: constructiveScoreOf(cleanReports),
        },
        worsened: {
          releasable: worsenedVerdict.overall.releasable,
          blocking: worsenedVerdict.blocking.length,
          refusals: worsenedVerdict.refusals.length,
          conservativeScore: worsenedConservative,
          constructiveScore: constructiveScoreOf(worsenedReports),
          refusalKinds: [...new Set(worsenedVerdict.refusals.map((refusal) => `${refusal.kind}/${refusal.rule}`))].sort(),
        },
        // "Would have shipped it" is not a guess: the conservative score is the
        // *only* signal the old ranking had, so a worsened candidate that does
        // not score below the clean one outranks it or ties it on id.
        oldScoreWouldHaveShippedTheWorsened: worsenedConservative >= cleanConservative,
        newlySelected: ranking.selected,
        worsenedStatus: candidateStatusAfterCriticJudge("validated", storedWorsened).status,
      });
    }
  }

  // -------------------------------------------------------------------------
  // The owner's song, through the same path.
  // -------------------------------------------------------------------------
  const owner = ownerAnchor();
  const ownerStored = storedVerdictFor("owner-v7a-rebuild", owner.input);
  const ownerGate = candidateStatusAfterCriticJudge("validated", ownerStored);
  const ownerSong = {
    anchorId: owner.id,
    composer: owner.composer,
    conservativeScore: conservativeScoreOf(owner.input),
    before: "selected on the conservative score; the judge was consulted by nobody",
    after: {
      status: ownerGate.status,
      releasable: ownerStored.releasable,
      blockingCount: ownerStored.blockingCount,
      refusalCount: ownerStored.refusalCount,
      refusals: ownerStored.refusals.map((refusal) => ({
        kind: refusal.kind, dimension: refusal.dimension, severity: refusal.severity,
        rule: refusal.rule, section: refusal.sectionName, bars: `${refusal.startBar}-${refusal.endBar}`,
        repairOperation: refusal.repairOperation,
      })),
      topProblems: ownerStored.topProblems,
      requestedRepairOperations: ownerStored.requestedRepairOperations,
      contested: ownerStored.contested.length,
      reason: ownerGate.reason,
    },
  };

  // -------------------------------------------------------------------------
  // Hand-off to B-20: what the critics ask for, and what can be executed.
  // -------------------------------------------------------------------------
  const askedFor = new Map<string, { operation: string; kinds: Set<string>; dimensions: Set<string> }>();
  const collect = (verdict: JudgeVerdict) => {
    for (const ranked of verdict.ranked) {
      const operation = ranked.observation.recommendedRepair?.operation;
      if (!operation || ranked.observation.severity === "info") continue;
      const entry = askedFor.get(operation) ?? { operation, kinds: new Set<string>(), dimensions: new Set<string>() };
      entry.kinds.add(ranked.observation.kind);
      entry.dimensions.add(ranked.observation.dimension);
      askedFor.set(operation, entry);
    }
  };
  collect(verdictFor(owner.input));
  for (const anchor of anchors([...CONTROL_ANCHOR_IDS])) collect(verdictFor(anchor.input));
  const operatorHandoff = [...askedFor.values()]
    .map((entry) => ({
      operation: entry.operation,
      kinds: [...entry.kinds].sort(),
      dimensions: [...entry.dimensions].sort(),
      executable: EXECUTABLE_REPAIR_OPERATIONS.includes(entry.operation),
    }))
    .sort((left, right) => left.operation.localeCompare(right.operation));

  return {
    version: B19_EVIDENCE_VERSION,
    generatedBy: "artifacts/api-server/src/lib/brainB19Evidence.ts, asserted by brainB19CriticsDecide.test.ts",
    question: "Does the release judge decide what ships, and can it tell a good candidate from a worsened one?",
    wiring: {
      gate: "arrangementGeneration.ts: after the diversity pass, every candidate with symbolic notes and complete quality evidence is judged (evaluateAllDimensions + runAdversarialCritics + judge); rankCandidates orders them once; a candidate the judge refuses becomes critic_judge_refused and can never be selected.",
      ordering: "candidateRanking.rankEvaluatedCandidates places the judge's persisted rank ahead of the reconciled (musicCritic + audioCritic) / 2 score. The precedence itself lives only in critics/rank.ts.",
      allRefused: "job errorCode NO_RELEASABLE_CANDIDATE, stage no_releasable_candidate, retryable; the error names every refusing observation and the repair operators asked for, and the arrangement is not marked ready.",
      contested: "disagreements the judge kept open travel on the candidate as criticVerdict.contested; a refusal says how many are unresolved by it.",
      notJudged: "a provider candidate with no symbolic notes (audio-only) is not judged and not gated: the note-level critics have nothing to read.",
    },
    nullControl: {
      note: "A gate that refuses everything gates nothing. These are the nine clean corpus anchors, untouched, through the same judge.",
      passed: nullControl.filter((row) => row.releasable).map((row) => row.anchorId),
      refused: nullControl.filter((row) => !row.releasable).map((row) => row.anchorId),
      rows: nullControl,
    },
    positiveControl: {
      family: CONTROL_FAMILY,
      severity: CONTROL_SEVERITY,
      seed: CONTROL_SEED,
      note: "The bed (and every other eligible part) revoiced off the chord on the two anchors the judge passes untouched. `clash_share` is the same kind that blocks the owner's Outro.",
      rows: positiveControl,
      refusedEvery: positiveControl.every((row) => !row.worsened.releasable),
      oldScoreFailedOn: positiveControl.filter((row) => row.oldScoreWouldHaveShippedTheWorsened).length,
      cases: positiveControl.length,
    },
    ownerSong,
    operatorHandoff: {
      note: "kind -> operator the critic asked for -> whether repairExecutor.ts can execute it. An operator marked executable false is stream B-20's work; the executor's dispatch is the file that would implement it.",
      executorFile: "artifacts/api-server/src/lib/repairExecutor.ts",
      executable: EXECUTABLE_REPAIR_OPERATIONS,
      rows: operatorHandoff,
      unexecutable: operatorHandoff.filter((row) => !row.executable).map((row) => row.operation),
    },
    honestLimits: [
      `The gate is wired and it is strict: today it passes ${nullControl.filter((row) => row.releasable).length} of the ${nullControl.length} clean corpus anchors and refuses the owner's song. That is the measurement, not a target: with this brain, most generations now end in NO_RELEASABLE_CANDIDATE. Nothing here moves a threshold to make the number look better — the release rules are B-05c's and were not touched.`,
      "The refusals are dominated by one rule. `major_on_a_bed` on `top_line_above_comfortable_ceiling` refuses seven of the nine clean anchors on its own. Whether a bed a little over its comfortable ceiling should refuse a release, or should be a major finding the repair loop fixes, is a judgement for B-05c/B-20 and is not settled by this stream.",
      "The positive control is a corruption of the harness's own vocabulary, applied to the two anchors the judge passes. It shows the gate distinguishes worsened from clean on real material; it does not show the gate ranks two genuinely different *good* candidates correctly, because the corpus does not contain two good candidates for one song.",
      "The `conservativeScore` here is the symbolic critic alone. On the production path it is averaged with the PCM critic when a render exists; no audio is rendered in this harness, and `(m + (a ?? m)) / 2` is exactly `m` in that case. A rendered candidate could order differently on the old score - which is the point: nothing about the old score was ever the critics' judgement.",
      "The judge runs twice per candidate on the production path: once for the stored verdict and once inside `rankCandidates`. It is a pure, deterministic function of the same reports, so the two agree by construction; it is duplicated work, not a duplicated rule.",
      "A provider candidate with no symbolic notes (audio-only) is not judged and therefore not gated. The note-level critics read notes; refusing such a candidate would be a verdict nobody reached, and passing it is not a claim that it is good.",
      "The owner's row here is the *rebuild* of the owner's song from the stored Song Model v3 fixture, not the exported v7a bytes. The shipped candidate is measured separately, off the saved candidate JSON, in docs/evidence/brain-b19-owner-v7a-selection.json.",
      "Nobody listened to anything. Every number here is symbolic.",
    ],
  };
}
