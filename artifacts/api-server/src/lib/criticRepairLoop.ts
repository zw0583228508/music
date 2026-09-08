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
 */
import type {
  ArrangementCritique,
  ArrangementPlan,
  CritiqueDimension,
  CriticRepairLoopResult,
  CriticRepairPass,
  CriticRepairRequest,
  SongModelData,
  TrackModel,
} from "@workspace/db";
import { critiqueArrangement } from "./musicCritic";

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
        for (const window of next.orchestrationBudget?.windows ?? []) {
          if (window.vocalAttention >= 0.6) {
            window.instrumentAdjustments = window.instrumentAdjustments.map((a) =>
              a.densityMultiplier > 0.85
                ? { ...a, densityMultiplier: 0.6, note: `${a.note}; repaired: duck under the vocal` }
                : a,
            );
          }
        }
        applied.push(`${request.id}: ducked support under the vocal`);
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

export function runCriticRepairLoop(input: {
  songModel: SongModelData;
  plan: ArrangementPlan;
  trackModels?: TrackModel[];
  applyRepair?: RepairApplier;
  maxPasses?: number;
}): CriticRepairLoopResult {
  const maxPasses = Math.max(1, Math.min(MAX_CRITIC_REPAIR_PASSES, input.maxPasses ?? MAX_CRITIC_REPAIR_PASSES));
  const applyRepair = input.applyRepair ?? applyPlanRepairs;

  let plan = input.plan;
  let trackModels = input.trackModels;
  let critique = critiqueArrangement({ songModel: input.songModel, plan, trackModels });
  const initialScore = critique.overallScore;
  const passes: CriticRepairPass[] = [];

  const decision = shouldAttemptRepair(critique);
  if (!decision.attempt) {
    return {
      version: "1.0", method: METHOD, maxPasses,
      outcome: critique.feasible ? "not_needed" : "infeasible",
      initialScore, finalScore: critique.overallScore, passes, finalCritique: critique,
    };
  }

  let outcome: CriticRepairLoopResult["outcome"] = "exhausted";
  for (let pass = 1; pass <= maxPasses; pass += 1) {
    const requests = buildRepairRequests(critique, plan);
    if (requests.length === 0) { outcome = "plateau"; break; }

    const scoreBefore = critique.overallScore;
    const result = applyRepair({ pass, requests, plan, trackModels });
    plan = result.plan;
    trackModels = result.trackModels ?? trackModels;
    const nextCritique = critiqueArrangement({ songModel: input.songModel, plan, trackModels });

    passes.push({
      pass,
      requests,
      applied: result.applied,
      scoreBefore,
      scoreAfter: nextCritique.overallScore,
      feasibleAfter: nextCritique.feasible,
    });
    critique = nextCritique;

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

  return {
    version: "1.0", method: METHOD, maxPasses, outcome,
    initialScore, finalScore: critique.overallScore, passes, finalCritique: critique,
  };
}
