/**
 * The audio critic dimensions (Brain B-07): pure functions of a symbolic
 * `CriticInput` plus the evaluation render of the same notes, returning
 * `CriticDimensionReport`s in the B-05 contract — observations located to
 * bars through the timeline (the seconds travel in the evidence), numeric
 * evidence, a suspected origin layer, a repair in the repair vocabulary.
 *
 * `controlStatus` comes from `audioControlLedger.ts`, which
 * `audioControls.ts` regenerates from the anchors × controls run.
 */
import type { ArrangementBrainAudioDimension, ArrangementBrainAudioObservation } from "@workspace/db";
import type { CriticDimensionReport } from "../types";
import { audioBalanceDimension } from "./audioBalance";
import { audioDynamicsDimension } from "./audioDynamics";
import { audioMaskingDimension } from "./audioMasking";
import { audioRhythmDimension } from "./audioRhythm";
import { audioTransitionsDimension } from "./audioTransitions";
import type { AudioCriticInput } from "./audioShared";

export const AUDIO_DIMENSIONS_VERSION = "B07_AUDIO_DIMENSIONS_v1" as const;

export type AudioCriticDimension = {
  dimension: string;
  version: string;
  evaluate(input: AudioCriticInput): CriticDimensionReport;
};

export const ALL_AUDIO_DIMENSIONS: readonly AudioCriticDimension[] = [
  audioBalanceDimension,
  audioDynamicsDimension,
  audioMaskingDimension,
  audioRhythmDimension,
  audioTransitionsDimension,
];

export const AUDIO_DIMENSION_NAMES: readonly string[] = ALL_AUDIO_DIMENSIONS.map((d) => d.dimension);

export function audioDimensionByName(name: string): AudioCriticDimension | null {
  return ALL_AUDIO_DIMENSIONS.find((d) => d.dimension === name) ?? null;
}

export function evaluateAudioDimensions(input: AudioCriticInput): CriticDimensionReport[] {
  return ALL_AUDIO_DIMENSIONS.map((d) => d.evaluate(input));
}

/** The reports in the shape the brain persists on `parameters.arrangementBrain.audio.dimensions`. */
export function toBrainAudioDimensions(reports: readonly CriticDimensionReport[]): ArrangementBrainAudioDimension[] {
  return reports.map((report) => ({
    dimension: report.dimension,
    version: report.version,
    applicable: report.applicable,
    ...(report.reasonIfNot ? { reasonIfNot: report.reasonIfNot } : {}),
    score0to100: report.summary.score0to100,
    coverage: report.summary.coverage,
    controlStatus: report.summary.controlStatus,
    observations: report.observations.map((o): ArrangementBrainAudioObservation => {
      const { startSeconds, endSeconds, ...evidence } = o.evidence;
      return {
        id: o.id,
        dimension: o.dimension,
        kind: o.kind,
        severity: o.severity,
        startBar: o.location.startBar,
        endBar: o.location.endBar,
        ...(o.location.sectionName ? { sectionName: o.location.sectionName } : {}),
        trackIds: [...o.location.trackIds],
        startSeconds: typeof startSeconds === "number" ? startSeconds : 0,
        endSeconds: typeof endSeconds === "number" ? endSeconds : 0,
        evidence,
        suspectedOrigin: o.suspectedOrigin,
        originConfidence: o.originConfidence,
        recommendedRepair: o.recommendedRepair,
        confidence: o.confidence,
      };
    }),
  }));
}

/**
 * For B-06 (repair): the audio observations a repair planner should act on —
 * non-info, from dimensions whose control status is `gated` or `informing`,
 * most severe first, each naming its origin layer, bar range, tracks and
 * repair operation. Observations from an `uncalibrated` or `demoted`
 * dimension are returned separately so the planner can log, not act.
 */
export function audioObservationsForRepair(dimensions: readonly ArrangementBrainAudioDimension[]): { actionable: ArrangementBrainAudioObservation[]; advisory: ArrangementBrainAudioObservation[] } {
  const order = { blocking: 3, major: 2, minor: 1, info: 0 } as const;
  const actionable: ArrangementBrainAudioObservation[] = [];
  const advisory: ArrangementBrainAudioObservation[] = [];
  for (const dimension of dimensions) {
    const bucket = dimension.controlStatus === "gated" || dimension.controlStatus === "informing" ? actionable : advisory;
    for (const o of dimension.observations) if (o.severity !== "info") bucket.push(o);
  }
  const sort = (list: ArrangementBrainAudioObservation[]) => list.sort((a, b) => order[b.severity] - order[a.severity] || b.originConfidence - a.originConfidence || a.startBar - b.startBar || a.id.localeCompare(b.id));
  return { actionable: sort(actionable), advisory: sort(advisory) };
}

export { audioBalanceDimension, audioDynamicsDimension, audioMaskingDimension, audioRhythmDimension, audioTransitionsDimension };
export type { AudioCriticInput } from "./audioShared";
