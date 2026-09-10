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
 *
 * Brain B-00 (honest provider evidence):
 *   - `confidence` is derived from evidence (hard-rule pass, playability errors,
 *     the critic's per-dimension evidence coverage, composition→shipped score
 *     drift, how much the playability repair had to rewrite); see
 *     `brainConfidence` for the formula and its inputs. No `0.5 + score/200`.
 *   - `smokeTested` is true only after a real, tiny orchestration ran in this
 *     process (on the first health call), with its latency.
 *   - The brain's own plan, stage records with evidence, every critique it
 *     computed, the repair passes and the playability-repair counts per track
 *     are persisted on `parameters.arrangementBrain` instead of a string.
 *   - When the brain selected nothing (every candidate failed the hard-rule
 *     gate) the provider refuses with the reasons; a candidate that failed the
 *     gate while others passed is returned labelled `selectable: false`.
 */
import type {
  ArrangementBrainCandidateEvidence,
  ArrangementPlan,
  CandidatePlan,
  GenerationParameters,
  SongModelData,
  StyleProfile,
  TrackModel,
} from "@workspace/db";
import {
  ORCHESTRATOR_VERSION,
  orchestrateArrangement,
  type OrchestratedCandidate,
  type OrchestrateInput,
  type OrchestrationResult,
} from "./arrangementOrchestrator";
import { performanceStyleFromProfile } from "./performanceEngine";
import { BENCHMARK_CORPUS, buildBenchmarkSongModel } from "./benchmarkCorpus";
import { buildCandidateProvenance, type CandidateProvenance } from "./decisionProvenance";
import { classifyBrainFinding, countFailureCodes } from "./findingClassification";

/** A StyleProfile travels in `parameters.styleProfile`; anything else is ignored. */
function readStyleProfile(parameters: GenerationParameters | undefined): StyleProfile | null {
  const candidate = parameters?.styleProfile;
  if (!candidate || typeof candidate !== "object") return null;
  const profile = candidate as Partial<StyleProfile>;
  return profile.dimensions && typeof profile.dimensions === "object" ? (profile as StyleProfile) : null;
}

/**
 * PR-U5: a brief's planner hints travel in `parameters.plannerHints` as
 * `{ global?, section? }` (what `briefPlannerHints` derives). Junk is ignored.
 */
function readPlannerHints(parameters: GenerationParameters | undefined): OrchestrateInput["plannerHints"] | null {
  const candidate = parameters?.plannerHints;
  if (!candidate || typeof candidate !== "object" || Array.isArray(candidate)) return null;
  const hints = candidate as { global?: unknown; section?: unknown };
  const global = hints.global && typeof hints.global === "object" && !Array.isArray(hints.global) ? hints.global as NonNullable<OrchestrateInput["plannerHints"]>["global"] : undefined;
  const section = hints.section && typeof hints.section === "object" && !Array.isArray(hints.section) ? hints.section as NonNullable<OrchestrateInput["plannerHints"]>["section"] : undefined;
  return global || section ? { ...(global ? { global } : {}), ...(section ? { section } : {}) } : null;
}

/** The brief reference a job carries in its parameters (PR-U5), when it does. */
function readBriefRef(parameters: GenerationParameters | undefined): { productionBriefId: string; productionBriefDigestSha256: string } | null {
  const id = parameters?.productionBriefId;
  const digest = parameters?.productionBriefDigestSha256;
  return typeof id === "string" && id && typeof digest === "string" && digest ? { productionBriefId: id, productionBriefDigestSha256: digest } : null;
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

// ---------------------------------------------------------------------------
// Smoke test (B-00): readiness says what actually ran in this process
// ---------------------------------------------------------------------------

export type BrainSmokeResult = {
  passed: boolean;
  latencyMs: number;
  detail: string;
  ranAt: string;
};

/**
 * A tiny, deterministic orchestration: an 8-bar pop model, one candidate, no
 * render. Passes when the chain selects a candidate with notes, every stage is
 * traceable and every shipped track carries valid playability evidence.
 */
export function runBrainSmokeTest(now: () => number = () => performance.now()): BrainSmokeResult {
  const started = now();
  try {
    const spec = { ...BENCHMARK_CORPUS[0], id: "brain-smoke", form: [["Verse", 4], ["Chorus", 4]] as Array<[string, number]>, energies: [0.4, 0.9] };
    const songModel = buildBenchmarkSongModel(spec);
    const result = orchestrateArrangement({ songModel, candidateCount: 1, render: false, now: new Date(0) });
    const candidate = result.candidates[0];
    const checks: Array<[string, boolean]> = [
      ["selected", result.selected !== null],
      ["traceable", result.traceable],
      ["notes", (candidate?.noteCount ?? 0) > 0],
      ["playability evidence valid", Boolean(candidate) && candidate.trackModels.every((t) => t.performanceEvidence?.playability.valid === true)],
    ];
    const failed = checks.filter(([, ok]) => !ok).map(([name]) => name);
    const latencyMs = Math.max(0, Math.round(now() - started));
    return {
      passed: failed.length === 0,
      latencyMs,
      detail: failed.length
        ? `smoke orchestration failed: ${failed.join(", ")}${result.selected ? "" : `; ${result.selection.reason}`}`
        : `smoke orchestration: ${candidate.noteCount} notes across ${candidate.trackModels.length} track(s), shipped critique ${candidate.critique.overallScore}/100, ${latencyMs} ms`,
      ranAt: new Date().toISOString(),
    };
  } catch (error) {
    return {
      passed: false,
      latencyMs: Math.max(0, Math.round(now() - started)),
      detail: `smoke orchestration threw: ${error instanceof Error ? error.message : String(error)}`,
      ranAt: new Date().toISOString(),
    };
  }
}

function snapshotFor(smoke: BrainSmokeResult | null): ProviderRuntimeSnapshot {
  return {
    availability: smoke === null || smoke.passed ? "ready" : "unavailable",
    configurationReady: true,
    checkpointReady: true,
    runtimeReady: true,
    smokeTested: smoke?.passed ?? false,
    healthStatus: smoke === null ? "unknown" : smoke.passed ? "healthy" : "unhealthy",
    checkedAt: smoke?.ranAt ?? null,
    latencyMs: smoke?.latencyMs ?? null,
    message: smoke === null
      ? "In-process symbolic arrangement brain. No endpoint, no weights, no GPU. Smoke test not yet run (first health check runs it)."
      : `In-process symbolic arrangement brain. ${smoke.detail}`,
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

/** Same ordering the orchestrator uses to pick its winner: hard-rule pass first, then score. */
function rankCandidates(candidates: OrchestratedCandidate[]): OrchestratedCandidate[] {
  return [...candidates].sort((a, b) =>
    Number(b.hardRule.feasible) - Number(a.hardRule.feasible) ||
    b.finalScore - a.finalScore ||
    a.candidateId.localeCompare(b.candidateId));
}

// ---------------------------------------------------------------------------
// Confidence (B-00): derived from evidence, with the inputs on the record
// ---------------------------------------------------------------------------

export const BRAIN_CONFIDENCE_FORMULA =
  "hardRule ? 0.35*playability + 0.35*coverage + 0.15*agreement + 0.15*intact : min(0.2, 0.25*that); " +
  "playability = 1 - constraintErrors/tracks; coverage = weighted mean of the critic's per-dimension confidence " +
  "(plan-only dimensions capped at 0.4); agreement = 1 - |shipped - composed|/100; " +
  "intact = 1 - playabilityRepairedNotes/noteCount";

export function brainConfidence(candidate: OrchestratedCandidate): ArrangementBrainCandidateEvidence["confidence"] {
  const tracks = Math.max(1, candidate.trackModels.length);
  const playability = clampUnit(1 - candidate.constraintErrors / tracks);
  const weightSum = candidate.critique.dimensions.reduce((s, d) => s + d.weight, 0) || 1;
  const coverage = clampUnit(candidate.critique.dimensions.reduce((s, d) => s + d.weight * d.confidence, 0) / weightSum);
  const drift = Math.abs(candidate.critique.overallScore - candidate.compositionCritique.overallScore);
  const agreement = clampUnit(1 - drift / 100);
  const repairedNotes = candidate.playabilityRepairs.reduce(
    (s, r) => s + r.rangeFolds + r.leapFolds + r.polyphonyReleases + r.breathTruncated + r.dropped, 0);
  const intact = clampUnit(1 - repairedNotes / Math.max(1, candidate.noteCount));
  const base = 0.35 * playability + 0.35 * coverage + 0.15 * agreement + 0.15 * intact;
  const hardRule = candidate.hardRule.feasible ? 1 : 0;
  const value = Number((hardRule ? base : Math.min(0.2, base * 0.25)).toFixed(4));
  return {
    value: clampUnit(value),
    formula: BRAIN_CONFIDENCE_FORMULA,
    inputs: {
      hardRule, playability, coverage: Number(coverage.toFixed(4)), agreement: Number(agreement.toFixed(4)),
      intact: Number(intact.toFixed(4)), constraintErrors: candidate.constraintErrors, tracks,
      scoreDrift: drift, playabilityRepairedNotes: repairedNotes, noteCount: candidate.noteCount,
    },
  };
}

// ---------------------------------------------------------------------------
// Per-candidate plan (B-00): what this candidate actually plays, per section
// ---------------------------------------------------------------------------

function sectionSpans(songModel: SongModelData, timing: OrchestrationResult["timing"]): Array<{ name: string; startBar: number; endBar: number; start: number; end: number; sourceEnergy: number | null }> {
  const bars = songModel.bars ?? [];
  const beats = Number(timing.meter.split("/")[0]) || 4;
  const barSeconds = (60 / Math.max(1, timing.tempoBpm)) * beats;
  return songModel.sections.map((section) => {
    const first = bars.find((b) => b.bar === section.startBar);
    const last = bars.find((b) => b.bar === section.endBar);
    return {
      name: section.name,
      startBar: section.startBar,
      endBar: section.endBar,
      start: first?.start ?? (section.startBar - 1) * barSeconds,
      end: last?.end ?? section.endBar * barSeconds,
      sourceEnergy: typeof section.energy === "number" ? section.energy : null,
    };
  });
}

/**
 * The candidate's plan as the runner reads it: per section, the tracks that
 * actually have notes in it (from the shipped notes), the brain's planned
 * energy target, and the planned density scaled by this candidate's own
 * density multipliers for the section's tasks. These differ between
 * candidates, which is what lets the runner's diversity gate see them.
 */
function candidatePlan(
  songModel: SongModelData,
  trackModels: TrackModel[],
  candidate: OrchestratedCandidate,
  result: OrchestrationResult,
): CandidatePlan {
  const targets = new Map((candidate.plan.globalPlan?.sectionTargets ?? []).map((t) => [t.sectionName.toLowerCase(), t]));
  const adjustments = new Map(
    (candidate.plan.candidateGenerationPlan?.candidates.find((c) => c.candidateId === candidate.candidateId)?.partAdjustments ?? [])
      .map((a) => [a.taskId, a.densityMultiplier]),
  );
  const tasks = candidate.plan.partComposerPlan?.tasks ?? [];
  return {
    sections: sectionSpans(songModel, result.timing).map((span) => {
      const target = targets.get(span.name.toLowerCase());
      const multipliers = tasks
        .filter((t) => t.sectionName === span.name)
        .map((t) => adjustments.get(t.id) ?? 1);
      const meanMultiplier = multipliers.length ? multipliers.reduce((s, m) => s + m, 0) / multipliers.length : 1;
      const active = trackModels
        .filter((track) => track.notes.some((n) => n.start >= span.start - 1e-6 && n.start < span.end - 1e-6))
        .map((track) => track.instrument);
      return {
        name: span.name,
        energy: clampUnit(target?.energy ?? span.sourceEnergy ?? 0),
        density: clampUnit((target?.density ?? 0.5) * meanMultiplier),
        tracks: active,
        startBar: span.startBar,
        endBar: span.endBar,
      };
    }),
    tracks: trackModels.map((track) => ({
      id: track.id,
      name: track.instrument,
      role: track.role,
      kind: "instrument",
    })),
  } as CandidatePlan;
}

/** Seconds per bar of the run's (read or assumed) tempo and meter. */
export function barSecondsOf(timing: OrchestrationResult["timing"]): number {
  const beats = Number(timing.meter.split("/")[0]) || 4;
  return (60 / Math.max(1, timing.tempoBpm)) * beats;
}

/**
 * B-11: the decisions behind one candidate, derived from its plan layers and
 * the composers' own registrations, keyed by the brain's (unscoped) track ids.
 */
export function candidateProvenance(candidate: OrchestratedCandidate, result: OrchestrationResult): CandidateProvenance {
  return buildCandidateProvenance({
    candidateId: candidate.candidateId,
    strategy: candidate.strategy,
    seed: candidate.seed,
    plan: candidate.plan,
    trackModels: candidate.trackModels,
    composer: result.composer,
    barSeconds: barSecondsOf(result.timing),
    composerRegistry: candidate.composerDecisions ?? null,
    repairPasses: candidate.repair?.passes ?? [],
    playabilityRepairs: candidate.playabilityRepairs,
    performance: candidate.performance ?? [],
    contextPasses: result.contextPasses ?? [],
  });
}

function brainEvidence(
  candidate: OrchestratedCandidate,
  result: OrchestrationResult,
  confidence: ArrangementBrainCandidateEvidence["confidence"],
  telemetry: { provenance: CandidateProvenance; scopedId: (id: string) => string },
): ArrangementBrainCandidateEvidence {
  // B-11: every finding carries its failure code and origin layer.
  const findings = candidate.findings.map(classifyBrainFinding);
  return {
    version: "1.0",
    plan: candidate.plan as ArrangementPlan,
    stages: result.stages.map((s) => ({ stage: s.stage, status: s.status, detail: s.detail, ...(s.evidence ? { evidence: s.evidence } : {}) })),
    traceable: result.traceable,
    findings,
    hardRule: candidate.hardRule,
    initialCritique: candidate.initialCritique,
    compositionCritique: candidate.compositionCritique,
    shippedCritique: candidate.critique,
    scoreDriftCompositionToShipped: candidate.critique.overallScore - candidate.compositionCritique.overallScore,
    repair: candidate.repair
      ? {
          mode: "recompose",
          outcome: candidate.repair.outcome,
          passes: candidate.repair.passes,
          appliedPasses: candidate.repair.appliedPasses,
          planChanged: candidate.repair.changed.plan,
          notesChanged: candidate.repair.changed.notes,
        }
      : null,
    playabilityRepairs: candidate.playabilityRepairs.map((r) => ({
      trackId: r.trackId, rangeFolds: r.rangeFolds, leapFolds: r.leapFolds, durationLengthened: r.durationLengthened,
      breathTruncated: r.breathTruncated, polyphonyReleases: r.polyphonyReleases, dropped: r.dropped, residual: r.residual,
    })),
    confidence,
    selectable: candidate.hardRule.feasible,
    // --- B-11: decision provenance and telemetry, in the shape the trace reads ---
    decisions: telemetry.provenance.decisions,
    parts: candidate.parts ?? [],
    performance: (candidate.performance ?? []).map((track) => ({ ...track, trackId: telemetry.scopedId(track.trackId) })),
    contextPasses: (result.contextPasses ?? []).map((pass) => ({ id: pass.id, changed: pass.changed, note: pass.note })),
    timing: result.timing,
    failureCodes: countFailureCodes(findings),
  };
}

/** What a subclass may add to one orchestration and to every candidate's parameters (PR-31). */
export type OrchestrateOverrides = {
  orchestrate?: Partial<Pick<OrchestrateInput, "plannerHints" | "performanceStyle">>;
  parameters?: Record<string, string | number | boolean | null>;
};

let sharedSmoke: BrainSmokeResult | null = null;

export class LocalArrangementOrchestratorProvider implements MusicGenerationProvider {
  readonly definition: ProviderDefinition;
  readonly available = true;
  readiness: ProviderRuntimeSnapshot;

  constructor(definition: ProviderDefinition = ARRANGEMENT_ORCHESTRATOR_DEFINITION) {
    this.definition = definition;
    this.readiness = this.snapshot();
  }

  /** The readiness snapshot: `smokeTested` only after `checkHealth` ran the smoke orchestration in this process. */
  protected snapshot(): ProviderRuntimeSnapshot {
    return snapshotFor(sharedSmoke);
  }

  /** A learned policy (PR-31) or a brief may shape the orchestration; the base brain adds nothing. */
  protected async orchestrateOverrides(_input: ProviderGenerationInput, _songModel: SongModelData): Promise<OrchestrateOverrides> {
    return {};
  }

  async checkHealth(force = false): Promise<ProviderRuntimeSnapshot> {
    if (sharedSmoke === null || force) sharedSmoke = runBrainSmokeTest();
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
    // PR-U5: the project's brief reaches the planners the same way — as
    // hints in the parameters — so an ordinary Generate run plans from the
    // brief, not only a chat regeneration.
    const briefHints = readPlannerHints(input.parameters);
    const briefRef = readBriefRef(input.parameters);
    const overrides = await this.orchestrateOverrides(input, songModel);
    const policyHints = overrides.orchestrate?.plannerHints;
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
      // Likewise the brief's planner hints outrank a policy's, field by field.
      plannerHints: briefHints
        ? {
            global: { ...(policyHints?.global ?? {}), ...(briefHints.global ?? {}) },
            section: { ...(policyHints?.section ?? {}), ...(briefHints.section ?? {}) },
          }
        : policyHints,
    });
    if (signal?.aborted) throw new Error("Arrangement generation was cancelled");
    await onProgress?.({ progress: 60, stage: "composed" });

    // B-00: when the brain itself would ship nothing, the provider ships
    // nothing. Returning the rejected candidates as if they were a result
    // would be a fallback dressed as judgement.
    if (result.selected === null) {
      throw new Error(`The Arrangement Brain refused every candidate: ${result.selection.reason}`);
    }

    const ranked = rankCandidates(result.candidates);
    if (ranked.length !== input.candidates) {
      // Padding with duplicates would fake diversity; say what happened instead.
      throw new Error(
        `The Arrangement Brain produced ${ranked.length} candidate(s) for a request of ${input.candidates}`,
      );
    }

    // Track ids are a global primary key in the studio, and the brain names
    // tracks by instrument ("drums-groove"). Scope them to the project so two
    // projects' drum tracks never collide, and so a regeneration in the same
    // project reuses the same track rows.
    const scopedId = (id: string) => `${input.projectId}--${id}`;
    const candidates: ProviderCandidate[] = ranked.map((candidate) => {
      const shipped = candidate.critique.overallScore;
      const composedScore = candidate.compositionCritique.overallScore;
      // B-11: which decisions authored which bar ranges of each track. Built on
      // the brain's own ids, attached to the scoped tracks below; the digest
      // does not cover it, so the evidence stays sealed.
      const provenance = candidateProvenance(candidate, result);
      const trackModels: TrackModel[] = candidate.trackModels.map((track) => {
        const scoped: TrackModel = { ...track, id: scopedId(track.id) };
        const trackProvenance = provenance.byTrack[track.id];
        if (trackProvenance) scoped.decisionProvenance = trackProvenance;
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
      const confidence = brainConfidence(candidate);
      const evidence = brainEvidence(candidate, result, confidence, { provenance, scopedId });
      const strengths = candidate.critique.strengths.slice(0, 2).join("; ");
      const weaknesses = candidate.critique.weaknesses.slice(0, 1).join("; ");
      const errorFindings = candidate.findings.filter((f) => f.severity === "error").length;
      return {
        providerRequestId: null,
        label: candidate.label,
        score: clampUnit(candidate.finalScore / 100),
        confidence: confidence.value,
        summary: [
          `${candidate.strategy} · shipped ${shipped.toFixed(0)}/100` + (composedScore !== shipped ? ` (composed ${composedScore.toFixed(0)})` : ""),
          candidate.hardRule.feasible ? null : `FAILED the hard-rule gate (${candidate.hardRule.reasons.length} reason(s)) — not selectable`,
          `${candidate.constraintErrors} playability error(s)`,
          errorFindings ? `${errorFindings} error finding(s)` : null,
          candidate.repairApplied
            ? `repair applied (${candidate.repair?.appliedPasses ?? 0} pass(es) recomposed the plan)`
            : candidate.repair?.passes.length
              ? "repair attempted, nothing changed"
              : null,
          candidate.playabilityRepairs.length ? `${candidate.playabilityRepairs.length} part(s) playability-repaired` : null,
          strengths || null,
          weaknesses ? `weakest: ${weaknesses}` : null,
        ].filter(Boolean).join(" · "),
        seed: candidate.seed,
        plan: candidatePlan(songModel, trackModels, candidate, result),
        parameters: {
          orchestratorVersion: ORCHESTRATOR_VERSION,
          orchestratorMethod: result.method,
          composer: result.composer,
          strategy: candidate.strategy,
          symbolicScore: shipped,
          compositionScore: composedScore,
          hardRuleFeasible: candidate.hardRule.feasible,
          selectable: candidate.hardRule.feasible,
          constraintErrors: candidate.constraintErrors,
          repairApplied: candidate.repairApplied,
          traceable: result.traceable,
          confidenceFormula: BRAIN_CONFIDENCE_FORMULA,
          arrangementBrain: evidence,
          performanceEngineVersion: performanceStyle || overrides.orchestrate?.performanceStyle ? "2.0" : "1.0",
          ...(overrides.parameters ?? {}),
          ...(briefRef ? { ...briefRef, briefPlannerHints: briefHints !== null } : {}),
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
