/**
 * The owner's learning consent, as one pure rule shared by the producer
 * decision ledger (PR-19) and the preference events (PR-28). Objective
 * evidence (measurements) may always be kept; explicit feedback needs
 * learning on; inferred behaviour needs both switches on.
 */
import type { ProducerDecisionSource } from "@workspace/db";

export type LearningControls = { learningEnabled: boolean; inferredBehaviorEnabled: boolean };

export function learningWriteAllowed(preferences: LearningControls, source: ProducerDecisionSource): boolean {
  return source === "objective_evidence" ||
    (preferences.learningEnabled &&
      (source !== "inferred_behavior" || preferences.inferredBehaviorEnabled));
}
