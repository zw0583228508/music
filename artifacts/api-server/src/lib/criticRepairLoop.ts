/**
 * Critic → Repair loop (PR-12).
 *
 * Don't just pick a winner. When a candidate is *almost* good, the Music Critic
 * (PR-11) names the problem ("bars 42-44 too dense"), this module turns each
 * weakness into a **bounded** repair request (one dimension, one scope), applies
 * it, and re-critiques — up to 3 passes before a full regeneration is worth it.
 *
 * `applyRepair` is injected: in production it regenerates only the flagged
 * scope via the Part Composer / a provider; the built-in default performs
 * deterministic plan-level repairs so the loop is useful (and testable) with no
 * model workers online.
 *
 * Brain B-00: the result carries the plan (and, when the applier recomposed,
 * the notes) that `finalCritique` was computed on, and every pass records
 * whether it changed the plan or the notes, separately from what it claimed
 * to apply. A pass that changed nothing is not a repair and stops the loop.
 * The orchestrator injects an applier that recomposes from the repaired plan,
 * so the loop's re-critique judges notes that exist.
 */
import type {
  ArrangementCritique,
  ArrangementFailureCode,
  ArrangementPlan,
  CritiqueDimension,
  CriticRepairLoopResult,
  CriticRepairPass,
  CriticRepairRequest,
  RepairCriticSummary,
  RepairOperationScope,
  RepairOperationSpec,
  RepairPlan,
  SongModelData,
  TrackModel,
} from "@workspace/db";
import { critiqueArrangement } from "./musicCritic";
import type { CriticDimensionReport, CriticInput, CriticObservation } from "./critics/types";
import { evaluateAllDimensions } from "./critics/dimensions";
import { runAdversarialCritics, type ControlLedger } from "./critics/adversarial";
import { judge, judgeContextFromInput, type JudgeVerdict } from "./critics/judge";
import { buildRepairPlan, observationPersists, DEFAULT_EXCLUDED_DIMENSIONS, DEFAULT_MAX_REPAIR_PASSES, type SeededRepairTarget } from "./repairPlanner";

export const MAX_CRITIC_REPAIR_PASSES = 3;
const METHOD = "critic-repair-loop/v1";

/** Score band where a bounded repair is worth trying rather than regenerating. */
const REPAIR_LOWER = 50;
const REPAIR_UPPER = 80;
/** Minimum overall-score gain for a pass to count as progress. */
const MIN_IMPROVEMENT = 1.5;

export function shouldAttemptRepair(
  critique: ArrangementCritique,
): { attempt: boolean; reason: string } {
  if (critique.overallScore >= REPAIR_UPPER) {
    return { attempt: false, reason: "already strong" };
  }
  const hardErrors = critique.hardRuleFindings.filter((f) => f.severity === "error");
  const fixableHardErrors = hardErrors.every((f) =>
    /gap|no instruments|unplayable|out of range|octave|voicing/i.test(f.message));
  if (hardErrors.length > 0 && !fixableHardErrors) {
    return { attempt: false, reason: "hard-rule failure needs a full regeneration" };
  }
  if (critique.overallScore < REPAIR_LOWER && critique.weaknesses.length > 4) {
    return { attempt: false, reason: "too many weaknesses — regenerate instead" };
  }
  if (critique.recommendedRepairs.length === 0) {
    return { attempt: false, reason: "nothing concrete to repair" };
  }
  return { attempt: true, reason: "near-miss with targeted repairs available" };
}

/** Turn a critique into tight, ranked repair requests (worst dimension first). */
export function buildRepairRequests(
  critique: ArrangementCritique,
  plan: ArrangementPlan,
): CriticRepairRequest[] {
  const scoreByDimension = new Map<CritiqueDimension, number>(
    critique.dimensions.map((d) => [d.dimension, d.score]),
  );
  const ops: Record<CritiqueDimension, string[]> = {
    harmony: ["reharmonise the flagged bars", "resolve non-chord tones onto the beat"],
    groove: ["align kick and bass onsets", "add a fill into each energy lift"],
    voiceLeading: ["re-voice for stepwise motion", "keep common tones"],
    leadCompatibility: ["reduce support density under the vocal", "move the answer phrase into the vocal gap"],
    orchestration: ["shift an overcrowded band by an octave", "thin the quiet sections"],
    sectionDevelopment: ["add one layer to the repeated section", "vary the final cadence"],
    motifCoherence: ["restate the motif in the intro", "develop the motif in the bridge"],
    contrast: ["widen the verse↔chorus dynamic gap"],
    transitions: ["add a transition device on the strong boundary", "add an ending gesture"],
    playability: ["apply the constraint-engine suggested fixes"],
    performancePotential: ["spread the section energies wider"],
  };

  return critique.recommendedRepairs
    .map((repair) => ({ repair, score: scoreByDimension.get(repair.dimension) ?? 100 }))
    .sort((a, b) => a.score - b.score)
    .map(({ repair }, index) => ({
      id: `repair-${index + 1}-${repair.dimension}`,
      dimension: repair.dimension,
      sectionName: repair.sectionName ??
        (repair.dimension === "sectionDevelopment"
          ? plan.globalPlan?.sectionTargets.find((t) => t.role === "chorus")?.sectionName
          : undefined),
      instrument: repair.instrument,
      startBar: repair.startBar,
      endBar: repair.endBar,
      operations: ops[repair.dimension],
      reason: repair.reason,
    }));
}

// ---------------------------------------------------------------------------
// Default: deterministic plan-level repairs
// ---------------------------------------------------------------------------

export type RepairApplier = (context: {
  pass: number;
  requests: CriticRepairRequest[];
  plan: ArrangementPlan;
  trackModels?: TrackModel[];
}) => { plan: ArrangementPlan; trackModels?: TrackModel[]; applied: string[] };

const COLOUR_LAYERS = ["strings", "pads", "percussion", "brass"];

export const applyPlanRepairs: RepairApplier = ({ requests, plan }) => {
  const next: ArrangementPlan = structuredClone(plan);
  const applied: string[] = [];

  for (const request of requests) {
    switch (request.dimension) {
      case "sectionDevelopment": {
        const section = next.sectionPlan?.sections.find(
          (s) => s.sectionName === request.sectionName,
        ) ?? next.sectionPlan?.sections.find((s) => s.function === "chorus");
        if (section) {
          const addable = COLOUR_LAYERS.find(
            (family) =>
              section.inactiveInstrumentFamilies.includes(family) &&
              !section.activeInstrumentFamilies.includes(family),
          );
          if (addable) {
            section.activeInstrumentFamilies = [...section.activeInstrumentFamilies, addable];
            section.inactiveInstrumentFamilies = section.inactiveInstrumentFamilies.filter(
              (f) => f !== addable,
            );
            next.sectionPlan!.roleAssignments.push({
              sectionName: section.sectionName, instrument: addable,
              role: addable === "percussion" ? "ACCENT" : "CLIMAX_LAYER",
              register: addable === "strings" ? "upper_mid" : "mid",
              density: 0.5, rhythmicActivity: 0.3, melodicActivity: 0.3,
              voicingStrategy: "open", articulationFamily: "sustain",
              dynamicShape: "mp->mf", interactionWithLead: "support",
              entryBar: section.startBar, exitBar: section.endBar,
            });
            applied.push(`${request.id}: added ${addable} to ${section.sectionName}`);
          }
        }
        break;
      }
      case "transitions": {
        for (const transition of next.transitionPlan?.transitions ?? []) {
          if (transition.strength > 0.5 && transition.devices.length === 0) {
            transition.devices.push({
              device: transition.kind === "drop" ? "break" : "drum_fill",
              instrument: "drums",
              startBar: Math.max(1, transition.atBar - 1),
              endBar: transition.atBar - 1,
              intensity: Math.min(1, 0.4 + transition.strength * 0.4),
              rationale: "Repair: strong boundary had no device.",
            });
            applied.push(`${request.id}: added a device to ${transition.fromSection}→${transition.toSection}`);
          }
        }
        break;
      }
      case "leadCompatibility": {
        // B-00: this used to report success unconditionally. Now it reports
        // only what it ducked, and nothing when there was nothing to duck.
        let ducked = 0;
        for (const window of next.orchestrationBudget?.windows ?? []) {
          if (window.vocalAttention >= 0.6) {
            window.instrumentAdjustments = window.instrumentAdjustments.map((a) => {
              if (a.densityMultiplier <= 0.85) return a;
              ducked += 1;
              return { ...a, densityMultiplier: 0.6, note: `${a.note}; repaired: duck under the vocal` };
            });
          }
        }
        if (ducked > 0) applied.push(`${request.id}: ducked ${ducked} support adjustment(s) under the vocal`);
        break;
      }
      case "orchestration": {
        for (const span of next.orchestrationBudget?.registerOccupancy ?? []) {
          if (span.overcrowdedBands.length > span.resolutions.length) {
            const band = span.overcrowdedBands.find(
              (b) => !span.resolutions.some((r) => r.band === b),
            );
            if (band) {
              span.resolutions.push({
                instrument: "keys",
                action: band === "high" || band === "upper_mid" ? "raise_octave" : "drop_octave",
                band,
              });
              applied.push(`${request.id}: cleared the ${band} band`);
            }
          }
        }
        break;
      }
      case "contrast": {
        const targets = next.globalPlan?.sectionTargets ?? [];
        for (const target of targets) {
          if (target.role === "verse") target.energy = Math.max(0, target.energy - 0.08);
          if (target.role === "chorus") target.energy = Math.min(1, target.energy + 0.08);
        }
        applied.push(`${request.id}: widened the verse↔chorus energy gap`);
        break;
      }
      default:
        // Dimensions that genuinely need note regeneration are left for the
        // injected applier; the plan cannot fix them on its own.
        break;
    }
  }

  return { plan: next, applied };
};

// ---------------------------------------------------------------------------
// Loop
// ---------------------------------------------------------------------------

/** Structural equality by canonical JSON; the loop's plans are small enough for this to be the honest check. */
function sameJson(left: unknown, right: unknown): boolean {
  return JSON.stringify(left) === JSON.stringify(right);
}

export function runCriticRepairLoop(input: {
  songModel: SongModelData;
  plan: ArrangementPlan;
  trackModels?: TrackModel[];
  applyRepair?: RepairApplier;
  maxPasses?: number;
  /** B-00: the caller's critique of the same plan and notes, so it is not computed twice. */
  initialCritique?: ArrangementCritique;
}): CriticRepairLoopResult {
  const maxPasses = Math.max(1, Math.min(MAX_CRITIC_REPAIR_PASSES, input.maxPasses ?? MAX_CRITIC_REPAIR_PASSES));
  const applyRepair = input.applyRepair ?? applyPlanRepairs;

  let plan = input.plan;
  let trackModels = input.trackModels;
  let critique = input.initialCritique ?? critiqueArrangement({ songModel: input.songModel, plan, trackModels });
  const initialScore = critique.overallScore;
  const passes: CriticRepairPass[] = [];
  const changed = { plan: false, notes: false };
  const finish = (outcome: CriticRepairLoopResult["outcome"]): CriticRepairLoopResult => ({
    version: "1.0", method: METHOD, maxPasses, outcome,
    initialScore, finalScore: critique.overallScore, passes, finalCritique: critique,
    // B-00: the result carries what it critiqued. A caller that ranks on
    // `finalCritique` must ship `plan` and `trackModels`, or say the repair
    // was advisory; before this the repaired plan was discarded and its score kept.
    plan,
    ...(changed.notes && trackModels ? { trackModels } : {}),
    changed: { ...changed },
    appliedPasses: passes.filter((p) => p.applied.length > 0 && (p.planChanged || p.notesChanged)).length,
  });

  const decision = shouldAttemptRepair(critique);
  if (!decision.attempt) {
    return finish(critique.feasible ? "not_needed" : "infeasible");
  }

  let outcome: CriticRepairLoopResult["outcome"] = "exhausted";
  for (let pass = 1; pass <= maxPasses; pass += 1) {
    const requests = buildRepairRequests(critique, plan);
    if (requests.length === 0) { outcome = "plateau"; break; }

    const scoreBefore = critique.overallScore;
    const result = applyRepair({ pass, requests, plan, trackModels });
    // What a pass claims (`applied`) and what it did (`planChanged`,
    // `notesChanged`) are recorded separately; only the latter makes it a repair.
    const planChanged = !sameJson(result.plan, plan);
    const notesChanged = result.trackModels !== undefined && !sameJson(result.trackModels, trackModels);
    plan = result.plan;
    trackModels = result.trackModels ?? trackModels;
    changed.plan ||= planChanged;
    changed.notes ||= notesChanged;
    const nextCritique = critiqueArrangement({ songModel: input.songModel, plan, trackModels });

    passes.push({
      pass,
      requests,
      applied: result.applied,
      scoreBefore,
      scoreAfter: nextCritique.overallScore,
      feasibleAfter: nextCritique.feasible,
      planChanged,
      notesChanged,
    });
    critique = nextCritique;

    // A pass that changed nothing cannot have improved anything; stop rather
    // than re-critique the same material until the budget runs out.
    if (!planChanged && !notesChanged) { outcome = "plateau"; break; }
    if (nextCritique.overallScore - scoreBefore < MIN_IMPROVEMENT) {
      outcome = nextCritique.overallScore > initialScore + MIN_IMPROVEMENT ? "improved" : "plateau";
      break;
    }
    if (nextCritique.overallScore >= REPAIR_UPPER || !shouldAttemptRepair(nextCritique).attempt) {
      outcome = "improved";
      break;
    }
  }
  if (outcome === "exhausted" && critique.overallScore > initialScore + MIN_IMPROVEMENT) {
    outcome = "improved";
  }

  return finish(outcome);
}

// ===========================================================================
// Brain B-06: the backtracking loop over the note-level critics
//
// The legacy loop above turns the plan-graded critique's recommendations into
// plan edits keyed by dimension. This loop reads the note-level critics
// (B-05a dimensions + B-05b adversarial modules) and the judge, asks the
// repair planner which layer to reopen for each group of observations, lets
// the caller's executor apply the operation to the plan objects and recompose
// only the affected tasks, then re-runs the critics on the result and keeps
// the pass only if the targeted observations are gone and the verdict did not
// worsen. A rejected pass is reverted and recorded as tried / rejected; its
// fallback (the next voted layer, or a recompose) is tried next. After an
// accepted pass the plan is rebuilt from the new observations with the
// remaining budget. Deterministic for the same input and executor.
// ===========================================================================

export const BACKTRACKING_METHOD = "critic-repair-loop/v2-backtracking";
/** The hard cap on passes a caller may ask for; the planner's default is `DEFAULT_MAX_REPAIR_PASSES`. */
export const MAX_BACKTRACKING_PASSES = 5;

export type NoteEvaluation = {
  reports: CriticDimensionReport[];
  verdict: JudgeVerdict;
  observations: CriticObservation[];
  summary: RepairCriticSummary;
};

/** Judge's priorities summed over observations of severity minor or worse, plus the counts the pass records compare. */
export function criticSummary(verdict: JudgeVerdict, observations: readonly CriticObservation[], legacyScore: number | null): RepairCriticSummary {
  const counted = observations.filter((o) => o.severity !== "info");
  const burden = verdict.ranked
    .filter((r) => r.observation.severity !== "info")
    .reduce((sum, r) => sum + r.priority, 0);
  return {
    observations: counted.length,
    blocking: counted.filter((o) => o.severity === "blocking").length,
    major: counted.filter((o) => o.severity === "major").length,
    minor: counted.filter((o) => o.severity === "minor").length,
    burden: Number(burden.toFixed(4)),
    releasable: verdict.overall.releasable,
    legacyScore,
  };
}

/**
 * Every note-level critic on one set of notes, judged. The B-05a dimensions
 * carry their measured control status (`controlLedger.ts`); the adversarial
 * modules are `uncalibrated` unless a caller passes B-05b's measured ledger,
 * so on the production path they inform the ranking and never block.
 */
export function evaluateNotes(
  input: CriticInput,
  options: { legacyScore?: number | null; adversarialLedger?: ControlLedger; excludeDimensions?: readonly string[] } = {},
): NoteEvaluation {
  const excluded = new Set(options.excludeDimensions ?? []);
  const reports = [...evaluateAllDimensions(input), ...runAdversarialCritics(input, options.adversarialLedger ? { controlLedger: options.adversarialLedger } : {})]
    .filter((r) => !excluded.has(r.dimension));
  const verdict = judge(reports, judgeContextFromInput(input));
  const observations = reports.flatMap((r) => r.observations);
  return { reports, verdict, observations, summary: criticSummary(verdict, observations, options.legacyScore ?? null) };
}

/**
 * What the stage moved, by observation id: gone, new, or still there. An
 * observation whose id shifted because a track appeared or left counts as
 * resolved only if `observationPersists` cannot find it either — the same
 * test acceptance uses, so the summary and the pass records agree.
 */
export function observationDelta(
  allBefore: readonly CriticObservation[],
  allAfter: readonly CriticObservation[],
): { resolved: string[]; introduced: string[]; persisted: string[] } {
  // `info` observations are the critics' notes to a reader, not defects; the
  // stage neither targets them nor claims them.
  const before = allBefore.filter((o) => o.severity !== "info");
  const after = allAfter.filter((o) => o.severity !== "info");
  const afterIds = new Set(after.map((o) => o.id));
  const beforeIds = new Set(before.map((o) => o.id));
  const resolved: string[] = [];
  const persisted: string[] = [];
  for (const observation of before) {
    if (afterIds.has(observation.id) || observationPersists(observation, after)) persisted.push(observation.id);
    else resolved.push(observation.id);
  }
  const introduced = after
    .filter((o) => !beforeIds.has(o.id) && !observationPersists(o, before))
    .map((o) => o.id);
  return { resolved: resolved.sort(), introduced: introduced.sort(), persisted: persisted.sort() };
}

/** Why `after` is a worse verdict than `before`, or null when it is not. Strict: the burden may not rise at all. */
export function verdictWorsened(before: RepairCriticSummary, after: RepairCriticSummary): string | null {
  if (after.blocking > before.blocking) return `blocking observations rose ${before.blocking} -> ${after.blocking}`;
  if (after.burden > before.burden + 1e-6) return `the judge's burden rose ${before.burden} -> ${after.burden} (${before.major}/${before.minor} -> ${after.major}/${after.minor} major/minor)`;
  return null;
}

/** What the executor hands back: the candidate state after the operation, or why it could not apply it. */
export type RepairExecution<TExtra> =
  | {
      plan: ArrangementPlan;
      trackModels: TrackModel[];
      changed: { plan: boolean; notes: boolean };
      /** The scope the pass actually touched (the operation's, widened by propagation the executor allowed). */
      scope: RepairOperationScope;
      note: string;
      decisionIdsChanged: string[];
      /** Whatever else the caller must keep if the pass is accepted (findings, telemetry, registries). */
      extra: TExtra;
    }
  | { rejected: string };

export type BacktrackingRepairInput<TExtra> = {
  songModel: SongModelData;
  plan: ArrangementPlan;
  trackModels: TrackModel[];
  /**
   * Apply one operation to a candidate state. Must not mutate `state`; a
   * rejected or reverted pass leaves it untouched. `extra` is the caller's
   * own state of the last accepted pass (`initialExtra` before the first).
   */
  execute: (operation: RepairOperationSpec, state: { plan: ArrangementPlan; trackModels: TrackModel[] }, pass: number, extra: TExtra | null) => RepairExecution<TExtra>;
  initialExtra?: TExtra;
  maxPasses?: number;
  /** A producer-triggered repair's scope (D3): planning and acceptance are restricted to it. */
  scopeLimit?: RepairOperationScope | null;
  /** The producer's finding, planned first. */
  seeded?: SeededRepairTarget | null;
  /**
   * True when `trackModels` came out of the same deterministic composer this
   * loop's executor recomposes with, from `plan` — the orchestrator's case.
   * The planner then does not offer `compose.recompose_part`, which would
   * write the same notes; the group is deferred with that reason instead.
   */
  notesAreFreshFromPlan?: boolean;
  /** The caller's legacy critique of the same plan and notes, so it is not computed twice. */
  initialCritique?: ArrangementCritique;
  adversarialLedger?: ControlLedger;
};

export type BacktrackingRepairResult<TExtra> = CriticRepairLoopResult & {
  repairPlan: RepairPlan;
  /** The `extra` of the last accepted pass, or null when nothing was accepted. */
  lastAccepted: TExtra | null;
  evaluationBefore: NoteEvaluation;
  evaluationAfter: NoteEvaluation;
  acceptedPasses: number;
  rejectedPasses: number;
};

/** The legacy critique dimension a failure code is closest to (the pass's `requests[]` keep the PR-12 shape). */
const LEGACY_DIMENSION: Record<ArrangementFailureCode, CritiqueDimension> = {
  GLOBAL_COHERENCE_FAILURE: "contrast", FORM_FAILURE: "sectionDevelopment", ENERGY_ARC_FAILURE: "contrast", MOTIF_FAILURE: "motifCoherence",
  HARMONY_FAILURE: "harmony", VOICE_LEADING_FAILURE: "voiceLeading", GROOVE_FAILURE: "groove", ORCHESTRATION_FAILURE: "orchestration",
  REGISTER_FAILURE: "orchestration", DENSITY_FAILURE: "orchestration", PLAYABILITY_FAILURE: "playability", IDIOM_FAILURE: "playability",
  STYLE_FAILURE: "performancePotential", TRANSITION_FAILURE: "transitions", REPETITION_FAILURE: "sectionDevelopment", PREDICTABILITY_FAILURE: "performancePotential",
  CAUSALITY_FAILURE: "sectionDevelopment", MASKING_FAILURE: "orchestration", VOCAL_SPACE_FAILURE: "leadCompatibility", PERFORMANCE_FAILURE: "performancePotential",
  RENDER_FAILURE: "performancePotential", AUDIO_BALANCE_FAILURE: "orchestration", PLAN_REALISATION_FAILURE: "orchestration", INPUT_UNKNOWN: "orchestration",
};

function legacyRequestFor(operation: RepairOperationSpec): CriticRepairRequest {
  return {
    id: operation.id,
    dimension: LEGACY_DIMENSION[operation.failureCode] ?? "orchestration",
    sectionName: operation.scope.sections[0],
    instrument: operation.scope.instruments[0],
    startBar: operation.scope.startBar,
    endBar: operation.scope.endBar,
    operations: [operation.operation],
    reason: operation.reason,
  };
}

const operationKey = (operation: RepairOperationSpec) =>
  `${operation.layer}|${operation.operation}|${JSON.stringify(operation.params)}|${operation.scope.sections.join(",")}|${operation.scope.instruments.join(",")}`;


export function runBacktrackingRepairLoop<TExtra>(input: BacktrackingRepairInput<TExtra>): BacktrackingRepairResult<TExtra> {
  const maxPasses = Math.max(0, Math.min(MAX_BACKTRACKING_PASSES, input.maxPasses ?? DEFAULT_MAX_REPAIR_PASSES));
  let state = { plan: input.plan, trackModels: input.trackModels };
  let legacy = input.initialCritique ?? critiqueArrangement({ songModel: input.songModel, plan: state.plan, trackModels: state.trackModels });
  const initialScore = legacy.overallScore;
  // The full evaluation (every dimension) is what the pass records report;
  // the verdict that accepts or rejects a pass, like the plan, leaves out the
  // dimensions the stage cannot act on (pre-performance dynamics and timing),
  // so a pass is never rejected for a finding the perform stage owns.
  const excludeDimensions = DEFAULT_EXCLUDED_DIMENSIONS;
  const evaluate = (s: typeof state, legacyScore: number) =>
    evaluateNotes({ songModel: input.songModel, plan: s.plan, trackModels: s.trackModels }, { legacyScore, adversarialLedger: input.adversarialLedger, excludeDimensions });
  const evaluationBefore = evaluate(state, legacy.overallScore);
  let current = evaluationBefore;

  const planInput = (evaluation: NoteEvaluation, budget: number) => buildRepairPlan({
    observations: evaluation.observations, verdict: evaluation.verdict, plan: state.plan, trackModels: state.trackModels,
    maxPasses: budget, scopeLimit: input.scopeLimit ?? null, seeded: input.seeded ?? null, excludeDimensions,
    notesAreFreshFromPlan: input.notesAreFreshFromPlan === true,
  });
  const repairPlan = planInput(evaluationBefore, maxPasses);

  const passes: CriticRepairPass[] = [];
  const changed = { plan: false, notes: false };
  const tried = new Set<string>();
  let queue: RepairOperationSpec[] = [...repairPlan.operations];
  let lastAccepted: TExtra | null = null;
  let currentExtra: TExtra | null = input.initialExtra ?? null;
  let accepted = 0;
  let rejected = 0;
  let outcome: CriticRepairLoopResult["outcome"] = "plateau";

  const finish = (): BacktrackingRepairResult<TExtra> => ({
    version: "1.0", method: BACKTRACKING_METHOD, maxPasses, outcome,
    observationDelta: observationDelta(evaluationBefore.observations, current.observations),
    initialScore, finalScore: legacy.overallScore, passes, finalCritique: legacy,
    plan: state.plan,
    ...(changed.notes ? { trackModels: state.trackModels } : {}),
    changed: { ...changed },
    appliedPasses: accepted,
    mode: "backtracking",
    repairPlan,
    criticBefore: evaluationBefore.summary,
    criticAfter: current.summary,
    lastAccepted,
    evaluationBefore,
    evaluationAfter: current,
    acceptedPasses: accepted,
    rejectedPasses: rejected,
  });

  if (evaluationBefore.summary.observations === 0 && !input.seeded) { outcome = "not_needed"; return finish(); }
  if (maxPasses === 0 || !queue.length) { outcome = "plateau"; return finish(); }

  // An attempt that changed neither the plan nor the notes is recorded but
  // does not spend a pass (nothing was tried on the music - B-00's rule); the
  // number of attempts is capped so a queue of no-ops stays bounded.
  let counted = 0;
  let attempts = 0;
  const maxAttempts = maxPasses * 3;
  // The queue keeps the planner's order: the judge's priority decides what is
  // tried first. Two reorderings were measured on the seeded corpus - skipping
  // an operation shape whose targets had once survived it, and demoting such a
  // shape after two failures - and both moved the number of repaired defects
  // by the same amount in each direction on different anchors, i.e. they fit
  // this corpus's noise rather than a rule. Neither is shipped.
  while (counted < maxPasses && attempts < maxAttempts) {
    const operation = queue.find((op) => !tried.has(operationKey(op)));
    if (!operation) break;
    attempts += 1;
    const pass = passes.length + 1;
    tried.add(operationKey(operation));
    queue = queue.filter((op) => op !== operation);
    const before = current;
    const base: CriticRepairPass = {
      pass,
      requests: [legacyRequestFor(operation)],
      applied: [],
      scoreBefore: legacy.overallScore,
      scoreAfter: legacy.overallScore,
      feasibleAfter: legacy.feasible,
      planChanged: false,
      notesChanged: false,
      layer: operation.layer,
      operation: operation.operation,
      params: operation.params,
      scope: operation.scope,
      targets: operation.targets,
      expectedEffect: operation.expectedEffect,
      accepted: false,
      rejectionReason: null,
      attempted: { planChanged: false, notesChanged: false },
      criticBefore: before.summary,
      remainingTargets: [],
      decisionIdsChanged: [],
      leverAvailable: operation.leverAvailable,
    };
    const reject = (reason: string, extras: Partial<CriticRepairPass> = {}) => {
      rejected += 1;
      passes.push({ ...base, ...extras, accepted: false, rejectionReason: reason });
      if (operation.fallback && !tried.has(operationKey(operation.fallback))) queue = [operation.fallback, ...queue];
    };

    const result = input.execute(operation, state, pass, currentExtra);
    if ("rejected" in result) { reject(result.rejected); continue; }
    if (!result.changed.plan && !result.changed.notes) {
      reject("the operation changed neither the plan nor the notes (a deterministic recompose from an unchanged plan writes the same part)", { attempted: { planChanged: false, notesChanged: false }, note: result.note });
      continue;
    }
    const legacyAfter = critiqueArrangement({ songModel: input.songModel, plan: result.plan, trackModels: result.trackModels });
    const after = evaluate(result, legacyAfter.overallScore);
    const targets = operation.expectedEffect
      .map((id) => before.observations.find((o) => o.id === id))
      .filter((o): o is CriticObservation => !!o);
    const remaining = targets.filter((t) => observationPersists(t, after.observations)).map((t) => t.id);
    const worse = verdictWorsened(before.summary, after.summary);
    const attempted = { planChanged: result.changed.plan, notesChanged: result.changed.notes };
    counted += 1;
    if (remaining.length) {
      reject(`${remaining.length} of ${targets.length} targeted observation(s) persist after the pass`, { attempted, criticAfter: after.summary, remainingTargets: remaining, scope: result.scope, note: result.note });
      continue;
    }
    if (worse) {
      reject(`the verdict worsened: ${worse}`, { attempted, criticAfter: after.summary, scope: result.scope, note: result.note });
      continue;
    }
    // Accepted: the state moves, and the plan is rebuilt from what is left.
    accepted += 1;
    state = { plan: result.plan, trackModels: result.trackModels };
    legacy = legacyAfter;
    current = after;
    changed.plan ||= result.changed.plan;
    changed.notes ||= result.changed.notes;
    lastAccepted = result.extra;
    currentExtra = result.extra;
    passes.push({
      ...base,
      applied: [`${operation.id}: ${result.note}`],
      scoreAfter: legacyAfter.overallScore,
      feasibleAfter: legacyAfter.feasible,
      planChanged: result.changed.plan,
      notesChanged: result.changed.notes,
      accepted: true,
      attempted,
      criticAfter: after.summary,
      scope: result.scope,
      decisionIdsChanged: result.decisionIdsChanged,
      note: result.note,
    });
    const budget = maxPasses - counted;
    if (budget <= 0) break;
    const replanned = planInput(current, budget);
    queue = replanned.operations.map((op, i) => ({ ...op, id: `p${pass + 1}-${op.id}`.replace(/^p(\d+)-repair-\d+-/, `p$1-repair-${i + 1}-`) }));
    if (!queue.length) break;
  }

  outcome = accepted > 0 ? "improved" : counted >= maxPasses || attempts >= maxAttempts ? "exhausted" : "plateau";
  return finish();
}
