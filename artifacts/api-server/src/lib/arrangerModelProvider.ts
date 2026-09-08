/**
 * YOUR_ARRANGER_MODEL as a provider (PR-31).
 *
 * The Arrangement Brain with the active learned policy applied. Until a
 * version has been promoted — which requires beating the reference pipeline
 * on the PR-18 benchmark — the provider is shadow-only: it can be requested
 * explicitly, for comparison and blind evaluation, but the router never
 * picks it as the default. Without any active version it behaves exactly
 * like the reference brain and says so in every candidate's parameters.
 */
import type { ProviderRuntimeSnapshot, SongModelData } from "@workspace/db";
import {
  LocalArrangementOrchestratorProvider,
  type OrchestrateOverrides,
} from "./arrangementOrchestratorProvider";
import { ARRANGER_MODEL_ID, policyOrchestrateOptions } from "./arrangerTrainingPipeline";
import type { ProviderDefinition, ProviderGenerationInput } from "./musicProviders";
import { ORCHESTRATOR_VERSION } from "./arrangementOrchestrator";

import type { ActiveArrangerModel, ArrangerModelLoader } from "./arrangerModelRouting";
export type { ActiveArrangerModel, ArrangerModelLoader };

export const ARRANGER_MODEL_DEFINITION: ProviderDefinition = {
  id: ARRANGER_MODEL_ID,
  displayName: "Your Arranger Model (learned policy over the Arrangement Brain)",
  modelVersion: `${ORCHESTRATOR_VERSION}+policy-0.1`,
  tasks: ["ARRANGEMENT", "ORCHESTRATION"],
  hardware: ["CPU"],
  speeds: ["FAST", "BALANCED", "QUALITY"],
  styles: [
    "pop", "rock", "ballad", "acoustic", "cinematic", "orchestral",
    "jazz", "electronic", "dance", "ethnic", "ambient", "folk",
  ],
  materializesTrackModels: true,
};

export class LocalArrangerModelProvider extends LocalArrangementOrchestratorProvider {
  private active: ActiveArrangerModel = null;

  constructor(private readonly loadActive: ArrangerModelLoader, private readonly promoted: () => boolean) {
    super(ARRANGER_MODEL_DEFINITION);
  }

  protected override snapshot(): ProviderRuntimeSnapshot {
    const promoted = this.promoted?.() ?? false;
    return {
      availability: "ready",
      configurationReady: true,
      checkpointReady: true,
      runtimeReady: true,
      smokeTested: true,
      healthStatus: "healthy",
      checkedAt: new Date().toISOString(),
      latencyMs: 0,
      message: promoted
        ? "Promoted: a learned policy that beat the reference pipeline on the benchmark; routable as a default."
        : "SHADOW_ONLY: requestable for comparison, never the default until a version beats the reference pipeline on the PR-18 benchmark.",
      reportedVersion: this.active ? `policy-v${this.active.version}` : "policy-none",
      maximumCandidates: 5,
      reportedChecksum: this.active?.model.inputsDigestSha256 ?? null,
    };
  }

  protected override async orchestrateOverrides(_input: ProviderGenerationInput, songModel: SongModelData): Promise<OrchestrateOverrides> {
    this.active = await this.loadActive();
    if (!this.active) {
      return { parameters: { arrangerModelId: null, arrangerModelVersion: 0, arrangerPolicyNeutral: true, arrangerPolicyNote: "no active version: identical to the reference pipeline" } };
    }
    const options = policyOrchestrateOptions(this.active.model.policy, songModel);
    return {
      orchestrate: options,
      parameters: {
        arrangerModelId: this.active.id,
        arrangerModelVersion: this.active.version,
        arrangerPolicyNeutral: this.active.model.neutral,
        arrangerPolicyDensity: this.active.model.policy.plannerHints.densityMultiplier,
        arrangerPolicyFamilyBias: this.active.model.policy.plannerHints.activeFamilyBias,
      },
    };
  }
}
