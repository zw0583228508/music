/**
 * The production evaluation loop (Brain B-07 D1): the brain hears what it ships.
 *
 * Until now the provider called `orchestrateArrangement({ render: false })` and
 * the persisted stage trace said `render: skipped` / `audio_critique: skipped`
 * on every job a user could reach — the audio half of `finalScore` existed only
 * in the benchmark, on renders the pipeline's own attestation rejected (B-08's
 * `renderFailures = 5`, R-1 P1-5). This module renders every candidate the
 * brain produced **once**, with one renderer and one loudness
 * (`evaluationRender.ts`), off the API's event loop
 * (`renderOffThread.ts` — a worker thread where the built server has one),
 * critiques the result with audio-critic/v1 **and** the four located audio
 * dimensions, and hands back:
 *
 *   - `ArrangementBrainAudioEvidence` per candidate (renderer, loudness,
 *     duration, spectrum, per-stem levels, both critiques, the ranks);
 *   - the two stage records the trace was missing, naming renderer, loudness,
 *     duration and where the render ran;
 *   - the combined ranking (`0.6 × symbolic + 0.4 × audio`, the orchestrator's
 *     own blend) so the provider's order is the order the audio produced.
 *
 * Nothing here decides anything by ear: the renderer is chosen by
 * `evaluationRendererDecision()` from objective checks, the family balance is
 * a measurement, and every audio dimension's `controlStatus` comes from the
 * audio control ledger, which `critics/audioControls.ts` regenerates from a
 * rendered anchors × controls run.
 */
import type {
  ArrangementBrainAudioEvidence,
  ArrangementPlan,
  SongModelData,
  TrackModel,
} from "@workspace/db";
import type { OrchestratedCandidate, OrchestrationResult } from "./arrangementOrchestrator";
import {
  AUDIO_SCORE_WEIGHT,
  EVALUATION_CHANNELS,
  EVALUATION_LOUDNESS,
  EVALUATION_RENDERER,
  EVALUATION_RENDERER_VERSION,
  EVALUATION_RENDER_VERSION,
  critiqueEvaluationRender,
  evaluationDurationSeconds,
  rememberEvaluationRender,
  type EvaluationRender,
} from "./evaluationRender";
import { renderEvaluationOffThread, renderLocation, type RenderLocation } from "./renderOffThread";
import { evaluateAudioDimensions, toBrainAudioDimensions } from "./critics/dimensions/audioDimensions";
import type { AudioRenderLike } from "./critics/dimensions/audioShared";

/** One stage record in the shape the orchestrator's trace uses. */
export type EvaluationStageRecord = {
  stage: "render" | "audio_critique";
  status: "ok" | "skipped" | "failed";
  detail: string;
  evidence?: Record<string, string | number | boolean>;
};

export type CandidateAudioEvaluation = {
  candidateId: string;
  audio: ArrangementBrainAudioEvidence;
  /** `0.6 × symbolic + 0.4 × audio`, the orchestrator's blend. */
  finalScore: number;
};

export type EvaluationCritiqueResult = {
  /** Keyed by `candidateId`; empty when the render could not run (the reason is in `stages`). */
  byCandidate: Map<string, CandidateAudioEvaluation>;
  stages: EvaluationStageRecord[];
  location: RenderLocation;
  totalRenderMs: number;
  totalCritiqueMs: number;
  /** The order the combined score produces, best first. */
  rankedIds: string[];
};

export type EvaluationCritiqueInput = {
  songModel: SongModelData;
  plan: ArrangementPlan;
  timing: OrchestrationResult["timing"];
  candidates: ReadonlyArray<Pick<OrchestratedCandidate, "candidateId" | "trackModels" | "critique" | "hardRule">>;
  /** Cancellation: checked between candidates. */
  signal?: { aborted: boolean };
  /** Render at most this many seconds per candidate (0 or undefined: the whole song). */
  maxSeconds?: number;
};

/** The render as the audio dimensions read it. */
export function audioRenderLike(render: EvaluationRender): AudioRenderLike {
  return {
    sampleRate: render.sampleRate,
    channels: EVALUATION_CHANNELS,
    durationSeconds: render.durationSeconds,
    stems: render.stems.map((s) => ({
      trackId: s.trackId, instrument: s.instrument, role: s.role, family: s.family,
      samples: s.samples, noteCount: s.noteCount,
    })),
    mix: render.mix,
  };
}

const round2 = (value: number): number => Number(value.toFixed(2));

/**
 * Render and critique every candidate. Failure of one candidate's render does
 * not fail the job: the candidate keeps its symbolic score and the stage record
 * says how many renders failed and why — a fallback that carries its reason
 * (charter rule 10), never one that scores as if the render had happened.
 */
export async function evaluateCandidatesWithAudio(input: EvaluationCritiqueInput): Promise<EvaluationCritiqueResult> {
  const where = renderLocation();
  const byCandidate = new Map<string, CandidateAudioEvaluation>();
  const failures: string[] = [];
  let totalRenderMs = 0;
  let totalCritiqueMs = 0;
  let location: RenderLocation = where.location;
  let sampleRate = 0;
  let durationSeconds = 0;

  for (const candidate of input.candidates) {
    if (input.signal?.aborted) break;
    if (!candidate.trackModels.length) {
      failures.push(`${candidate.candidateId}: no tracks to render`);
      continue;
    }
    const planned = evaluationDurationSeconds(candidate.trackModels, input.plan, input.timing.tempoBpm, input.timing.meter);
    const seconds = input.maxSeconds && input.maxSeconds > 0 ? Math.min(planned, input.maxSeconds) : planned;
    let rendered: EvaluationRender;
    try {
      const off = await renderEvaluationOffThread(candidate.trackModels, { durationSeconds: seconds });
      rendered = off.result;
      location = off.location;
      totalRenderMs += off.elapsedMs;
    } catch (error) {
      failures.push(`${candidate.candidateId}: ${error instanceof Error ? error.message : String(error)}`);
      continue;
    }
    sampleRate = rendered.sampleRate;
    durationSeconds = Math.max(durationSeconds, rendered.durationSeconds);
    // The job runner's evaluation artifact reuses this render when the notes match.
    rememberEvaluationRender(rendered);

    const critiqueStarted = performance.now();
    const critique = critiqueEvaluationRender(rendered);
    const dimensions = toBrainAudioDimensions(evaluateAudioDimensions({
      songModel: input.songModel,
      plan: input.plan,
      trackModels: candidate.trackModels,
      render: audioRenderLike(rendered),
    }));
    const critiqueMs = Math.round(performance.now() - critiqueStarted);
    totalCritiqueMs += critiqueMs;

    const symbolicScore = candidate.critique.overallScore;
    const audioScore = critique.overallScore;
    const finalScore = Number((symbolicScore * (1 - AUDIO_SCORE_WEIGHT) + audioScore * AUDIO_SCORE_WEIGHT).toFixed(2));
    const audio: ArrangementBrainAudioEvidence = {
      version: "1.0",
      renderer: EVALUATION_RENDERER,
      rendererVersion: EVALUATION_RENDERER_VERSION,
      evaluationVersion: EVALUATION_RENDER_VERSION,
      location,
      sampleRate: rendered.sampleRate,
      channels: EVALUATION_CHANNELS,
      durationSeconds: rendered.durationSeconds,
      renderMs: rendered.elapsedMs,
      critiqueMs,
      loudness: rendered.loudness,
      familyTrimsDb: rendered.familyTrimsDb,
      spectrum: {
        sub150: rendered.spectrum.sub150, low2k: rendered.spectrum.low2k,
        presence5k: rendered.spectrum.presence5k, air: rendered.spectrum.air,
      },
      stems: rendered.stems.map((s) => ({
        trackId: s.trackId, instrument: s.instrument, family: s.family, trimDb: s.trimDb,
        rmsDbfs: s.rmsDbfs, peakDbfs: s.peakDbfs, noteCount: s.noteCount,
      })),
      critique,
      dimensions,
      symbolicScore: round2(symbolicScore),
      audioScore: round2(audioScore),
      audioWeight: AUDIO_SCORE_WEIGHT,
      finalScore,
      // Filled in below, once every candidate has a score.
      rankSymbolic: 0,
      rankCombined: 0,
      selectedWithAudio: false,
      renderKey: rendered.key,
    };
    byCandidate.set(candidate.candidateId, { candidateId: candidate.candidateId, audio, finalScore });
  }

  // --- ranks -------------------------------------------------------------
  const evaluated = [...byCandidate.values()];
  const eligible = new Set(input.candidates.filter((c) => c.hardRule.feasible).map((c) => c.candidateId));
  const bySymbolic = [...evaluated].sort((a, b) =>
    Number(eligible.has(b.candidateId)) - Number(eligible.has(a.candidateId)) ||
    b.audio.symbolicScore - a.audio.symbolicScore ||
    a.candidateId.localeCompare(b.candidateId));
  const byCombined = [...evaluated].sort((a, b) =>
    Number(eligible.has(b.candidateId)) - Number(eligible.has(a.candidateId)) ||
    b.finalScore - a.finalScore ||
    a.candidateId.localeCompare(b.candidateId));
  bySymbolic.forEach((entry, index) => { entry.audio.rankSymbolic = index + 1; });
  byCombined.forEach((entry, index) => { entry.audio.rankCombined = index + 1; });
  const winner = byCombined.find((entry) => eligible.has(entry.candidateId)) ?? null;
  if (winner) winner.audio.selectedWithAudio = true;

  // --- stage records -----------------------------------------------------
  const stages: EvaluationStageRecord[] = [];
  if (evaluated.length) {
    const meanAudio = round2(evaluated.reduce((s, e) => s + e.audio.audioScore, 0) / evaluated.length);
    const loudness = evaluated[0].audio.loudness;
    const rankChanged = evaluated.filter((e) => e.audio.rankSymbolic !== e.audio.rankCombined).length;
    stages.push({
      stage: "render",
      status: "ok",
      detail:
        `${evaluated.length} candidate(s) rendered once for evaluation with ${EVALUATION_RENDERER} ${EVALUATION_RENDERER_VERSION} ` +
        `(evaluation contract ${EVALUATION_RENDER_VERSION}) at ${sampleRate} Hz / ${EVALUATION_CHANNELS} ch, ` +
        `${durationSeconds.toFixed(1)} s, normalised to ${loudness.targetRmsDbfs} dBFS RMS with a ${loudness.peakCeiling} peak ceiling ` +
        `(${loudness.applied}, ${loudness.gainDb >= 0 ? "+" : ""}${loudness.gainDb} dB), ${location === "worker_thread" ? "in a worker thread" : "in-process"} ` +
        `(${where.reason})${failures.length ? `; ${failures.length} candidate render(s) failed: ${failures.join("; ")}` : ""}`,
      evidence: {
        renderer: EVALUATION_RENDERER, rendererVersion: EVALUATION_RENDERER_VERSION,
        evaluationVersion: EVALUATION_RENDER_VERSION, sampleRate, channels: EVALUATION_CHANNELS,
        durationSeconds: round2(durationSeconds), targetRmsDbfs: loudness.targetRmsDbfs, peakCeiling: loudness.peakCeiling,
        location, workers: where.workers, rendered: evaluated.length, failed: failures.length,
        renderMs: totalRenderMs,
      },
    });
    stages.push({
      stage: "audio_critique",
      status: "ok",
      detail:
        `audio-critic/v1 and ${evaluated[0].audio.dimensions.length} located audio dimension(s) ran on the evaluation render of ` +
        `${evaluated.length} candidate(s): mean audio ${meanAudio}/100, final = ${(1 - AUDIO_SCORE_WEIGHT).toFixed(1)}×symbolic + ${AUDIO_SCORE_WEIGHT}×audio; ` +
        `${rankChanged} candidate(s) rank differently with audio than without`,
      evidence: {
        meanAudioScore: meanAudio, audioWeight: AUDIO_SCORE_WEIGHT, critiqueMs: totalCritiqueMs,
        dimensions: evaluated[0].audio.dimensions.map((d) => `${d.dimension}=${d.score0to100 ?? "n/a"}/${d.controlStatus}`).join(","),
        blockingObservations: evaluated.reduce((s, e) => s + e.audio.dimensions.reduce((n, d) => n + d.observations.filter((o) => o.severity === "blocking").length, 0), 0),
        majorObservations: evaluated.reduce((s, e) => s + e.audio.dimensions.reduce((n, d) => n + d.observations.filter((o) => o.severity === "major").length, 0), 0),
        rankChanged,
      },
    });
  } else {
    const reason = input.signal?.aborted
      ? "cancelled before any candidate was rendered"
      : failures.length
        ? `every candidate render failed: ${failures.join("; ")}`
        : "no candidate had tracks to render";
    stages.push({ stage: "render", status: "failed", detail: reason, evidence: { rendered: 0, failed: failures.length, location } });
    stages.push({ stage: "audio_critique", status: "skipped", detail: `no evaluation render to critique (${reason})` });
  }

  return {
    byCandidate,
    stages,
    location,
    totalRenderMs,
    totalCritiqueMs,
    rankedIds: byCombined.map((e) => e.candidateId),
  };
}

/**
 * Merge the evaluation stage records into an orchestration's trace: the
 * orchestrator ran with `render: false` (rendering every candidate twice, once
 * with the reference synth and once with the evaluation renderer, would be
 * waste), so its own `render` / `audio_critique` records say "skipped". These
 * replace them with what actually happened, in place, keeping stage order.
 */
export function mergeEvaluationStages<T extends { stage: string; status: string; detail: string; evidence?: Record<string, string | number | boolean> }>(
  stages: readonly T[],
  evaluation: readonly EvaluationStageRecord[],
): T[] {
  const replacements = new Map<string, EvaluationStageRecord>(evaluation.map((s) => [s.stage as string, s]));
  const merged = stages.map((stage) => {
    const replacement = replacements.get(stage.stage);
    if (!replacement) return stage;
    replacements.delete(stage.stage);
    return { ...stage, status: replacement.status, detail: replacement.detail, ...(replacement.evidence ? { evidence: replacement.evidence } : {}) } as T;
  });
  // A trace that never had the stages at all still gets them.
  for (const stage of evaluation) if (replacements.has(stage.stage)) merged.push(stage as unknown as T);
  return merged;
}

export type { TrackModel };
