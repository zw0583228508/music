/**
 * The Arrangement Brain as a registry provider (PR-W1).
 *
 * PR-16's orchestrator ran only in tests and the benchmark; nothing a user could
 * reach called it. This adapter makes it a first-class `MusicGenerationProvider`,
 * so the existing generation job runner, candidate persistence, ranking, repair
 * and the studio's candidate UI all work with it unchanged. Zero special-casing
 * in the runner: the orchestrator is just another provider that happens to run
 * in-process on the CPU and have no weights.
 *
 * The one thing it asks of the runner is `materializesTrackModels`: its notes
 * have already been composed, constraint-checked, critiqued, repaired and
 * performed, so the legacy modulation/composition passes must not touch them.
 */
import type { CandidatePlan, GenerationParameters, SongModelData, StyleProfile, TrackModel } from "@workspace/db";
import {
  ORCHESTRATOR_VERSION,
  orchestrateArrangement,
  type OrchestratedCandidate,
  type OrchestrateInput,
} from "./arrangementOrchestrator";
import { performanceStyleFromProfile } from "./performanceEngine";

/** A StyleProfile travels in `parameters.styleProfile`; anything else is ignored. */
function readStyleProfile(parameters: GenerationParameters | undefined): StyleProfile | null {
  const candidate = parameters?.styleProfile;
  if (!candidate || typeof candidate !== "object") return null;
  const profile = candidate as Partial<StyleProfile>;
  return profile.dimensions && typeof profile.dimensions === "object" ? (profile as StyleProfile) : null;
}
import type {
  MusicGenerationProvider,
  ProviderCandidate,
  ProviderDefinition,
  ProviderGenerationInput,
  ProviderGenerationResult,
  ProviderProgress,
} from "./musicProviders";
import type { ProviderRuntimeSnapshot } from "@workspace/db";
import { performedMaterialSha256 } from "./musicEngines";

export const ARRANGEMENT_ORCHESTRATOR_ID = "ARRANGEMENT_ORCHESTRATOR" as const;

export const ARRANGEMENT_ORCHESTRATOR_DEFINITION: ProviderDefinition = {
  id: ARRANGEMENT_ORCHESTRATOR_ID,
  displayName: "Arrangement Brain (local orchestrator)",
  modelVersion: ORCHESTRATOR_VERSION,
  tasks: ["ARRANGEMENT", "ORCHESTRATION"],
  hardware: ["CPU"],
  speeds: ["FAST", "BALANCED", "QUALITY"],
  styles: [
    "pop", "rock", "ballad", "acoustic", "cinematic", "orchestral",
    "jazz", "electronic", "dance", "ethnic", "ambient", "folk",
  ],
  materializesTrackModels: true,
};

function healthySnapshot(): ProviderRuntimeSnapshot {
  return {
    availability: "ready",
    configurationReady: true,
    checkpointReady: true,
    runtimeReady: true,
    smokeTested: true,
    healthStatus: "healthy",
    checkedAt: new Date().toISOString(),
    latencyMs: 0,
    message: "In-process symbolic arrangement brain. No endpoint, no weights, no GPU.",
    reportedVersion: ORCHESTRATOR_VERSION,
    maximumCandidates: 5,
    reportedChecksum: null,
  };
}

function isSongModel(value: unknown): value is SongModelData {
  if (!value || typeof value !== "object") return false;
  const model = value as Record<string, unknown>;
  return Array.isArray(model["sections"]) &&
    Array.isArray(model["tempoMap"]) &&
    Array.isArray(model["chords"]) &&
    Array.isArray(model["melody"]);
}

function clampUnit(value: number): number {
  return Math.max(0, Math.min(1, Number.isFinite(value) ? value : 0));
}

/** Same ordering the orchestrator uses to pick its winner: feasible first, then score. */
function rankCandidates(candidates: OrchestratedCandidate[]): OrchestratedCandidate[] {
  return [...candidates].sort((a, b) =>
    Number(b.critique.feasible) - Number(a.critique.feasible) ||
    b.finalScore - a.finalScore ||
    a.candidateId.localeCompare(b.candidateId));
}

function candidatePlan(songModel: SongModelData, trackModels: TrackModel[], candidate: OrchestratedCandidate, sectionDensity: Map<string, number>): CandidatePlan {
  const instruments = trackModels.map((track) => track.instrument);
  return {
    sections: songModel.sections.map((section) => ({
      name: section.name,
      energy: clampUnit(section.energy ?? 0.5),
      density: clampUnit(sectionDensity.get(section.name.toLowerCase()) ?? 0.5),
      tracks: instruments,
    })),
    tracks: trackModels.map((track) => ({
      id: track.id,
      name: track.instrument,
      role: track.role,
      kind: "instrument",
    })),
  } as CandidatePlan;
}

/** What a subclass may add to one orchestration and to every candidate's parameters (PR-31). */
export type OrchestrateOverrides = {
  orchestrate?: Partial<Pick<OrchestrateInput, "plannerHints" | "performanceStyle">>;
  parameters?: Record<string, string | number | boolean | null>;
};

export class LocalArrangementOrchestratorProvider implements MusicGenerationProvider {
  readonly definition: ProviderDefinition;
  readonly available = true;
  readiness: ProviderRuntimeSnapshot;

  constructor(definition: ProviderDefinition = ARRANGEMENT_ORCHESTRATOR_DEFINITION) {
    this.definition = definition;
    this.readiness = this.snapshot();
  }

  protected snapshot(): ProviderRuntimeSnapshot {
    return healthySnapshot();
  }

  /** A learned policy (PR-31) or a brief may shape the orchestration; the base brain adds nothing. */
  protected async orchestrateOverrides(_input: ProviderGenerationInput, _songModel: SongModelData): Promise<OrchestrateOverrides> {
    return {};
  }

  async checkHealth(): Promise<ProviderRuntimeSnapshot> {
    this.readiness = this.snapshot();
    return this.readiness;
  }

  async generate(
    input: ProviderGenerationInput,
    onProgress?: (progress: ProviderProgress) => Promise<void>,
    signal?: AbortSignal,
  ): Promise<ProviderGenerationResult> {
    if (!isSongModel(input.songModel)) {
      throw new Error(
        "The Arrangement Brain needs a complete Song Model snapshot (sections, tempoMap, chords, melody); the job snapshot is missing one of them",
      );
    }
    const songModel = input.songModel;
    await onProgress?.({ progress: 10, stage: "planning" });

    // Rendering is left to the job runner, which already renders, quality-checks
    // and critiques every candidate it persists. Rendering here as well would
    // double the cost of each candidate for nothing. `now` is fixed so the
    // same Song Model and seed always give the same arrangement.
    // PR-23: a resolved StyleProfile in the generation parameters (the Wave U
    // brief pipeline puts it there) shapes the performance — swing ratio,
    // microtiming, dynamics width, ornaments, fills. Without one the
    // performance is V1, byte for byte.
    const styleProfile = readStyleProfile(input.parameters);
    const performanceStyle = styleProfile ? performanceStyleFromProfile(styleProfile) : undefined;
    const overrides = await this.orchestrateOverrides(input, songModel);
    const result = orchestrateArrangement({
      songModel,
      candidateCount: input.candidates,
      render: false,
      now: new Date(0),
      ...(overrides.orchestrate ?? {}),
      // The request's own style (a brief or a personal profile) outranks a learned policy's.
      performanceStyle: performanceStyle
        ? { ...(overrides.orchestrate?.performanceStyle ?? {}), ...performanceStyle }
        : overrides.orchestrate?.performanceStyle,
    });
    if (signal?.aborted) throw new Error("Arrangement generation was cancelled");
    await onProgress?.({ progress: 60, stage: "composed" });

    const ranked = rankCandidates(result.candidates);
    if (ranked.length !== input.candidates) {
      // Padding with duplicates would fake diversity; say what happened instead.
      throw new Error(
        `The Arrangement Brain produced ${ranked.length} candidate(s) for a request of ${input.candidates}`,
      );
    }

    const sectionDensity = new Map<string, number>();
    for (const target of result.plan.globalPlan?.sectionTargets ?? []) {
      sectionDensity.set(target.sectionName.toLowerCase(), target.density);
    }

    const stageSummary = result.stages.map((stage) => `${stage.stage}:${stage.status}`).join(",");
    // Track ids are a global primary key in the studio, and the brain names
    // tracks by instrument ("drums-groove"). Scope them to the project so two
    // projects' drum tracks never collide, and so a regeneration in the same
    // project reuses the same track rows.
    const scopedId = (id: string) => `${input.projectId}--${id}`;
    const candidates: ProviderCandidate[] = ranked.map((candidate) => {
      const symbolic = candidate.critique.overallScore;
      const trackModels: TrackModel[] = candidate.trackModels.map((track) => {
        const scoped: TrackModel = { ...track, id: scopedId(track.id) };
        // The performed-material digest covers the id, so re-scoping it must
        // re-seal the evidence or the export will reject it as stale.
        if (scoped.performanceEvidence) {
          scoped.performanceEvidence = {
            ...scoped.performanceEvidence,
            performedMaterialSha256: performedMaterialSha256(scoped),
          };
        }
        return scoped;
      });
      const strengths = candidate.critique.strengths.slice(0, 2).join("; ");
      const weaknesses = candidate.critique.weaknesses.slice(0, 1).join("; ");
      return {
        providerRequestId: null,
        label: candidate.label,
        score: clampUnit(candidate.finalScore / 100),
        // Confidence tracks the critic: a candidate that failed a hard rule is
        // reported as low-confidence however well it scored elsewhere.
        confidence: candidate.critique.feasible
          ? clampUnit(0.5 + symbolic / 200)
          : 0.3,
        summary: [
          `${candidate.strategy} · symbolic ${symbolic.toFixed(0)}/100`,
          `${candidate.constraintErrors} playability error(s)`,
          candidate.repair ? `${candidate.repair.passes.length} repair pass(es)` : null,
          strengths || null,
          weaknesses ? `weakest: ${weaknesses}` : null,
        ].filter(Boolean).join(" · "),
        seed: candidate.seed,
        plan: candidatePlan(songModel, trackModels, candidate, sectionDensity),
        parameters: {
          orchestratorVersion: ORCHESTRATOR_VERSION,
          orchestratorMethod: result.method,
          composer: result.composer,
          strategy: candidate.strategy,
          symbolicScore: symbolic,
          hardRuleFeasible: candidate.critique.feasible,
          constraintErrors: candidate.constraintErrors,
          repairPasses: candidate.repair?.passes.length ?? 0,
          stages: stageSummary,
          traceable: result.traceable,
          performanceEngineVersion: performanceStyle || overrides.orchestrate?.performanceStyle ? "2.0" : "1.0",
          ...(overrides.parameters ?? {}),
          ...(performanceStyle?.sources?.length
            ? { performanceStyleInputs: performanceStyle.sources.map((s) => `${s.dimension}=${s.value} (${s.provenance})`) }
            : {}),
        },
        parentArtifactIds: [],
        trackModels,
      };
    });

    await onProgress?.({ progress: 65, stage: "candidates_ready" });
    return {
      requestId: null,
      modelVersion: ORCHESTRATOR_VERSION,
      checkpointSha256: null,
      candidates,
    };
  }
}
