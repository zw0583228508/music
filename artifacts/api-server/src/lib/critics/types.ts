/**
 * Critic contract (Brain B-05, shared by B-05a — the note-level constructive
 * critic — and B-05b — the adversarial critic and the judge layer).
 *
 * A critic **diagnoses**; it does not score. Every claim is an observation
 * located to bars and tracks, carrying the numbers behind it, a suspected
 * origin layer with a confidence, and a repair the originating layer could
 * act on. A dimension's `score0to100` is only a summary of its observations
 * (the aggregation is documented in `dimensions/shared.ts`) and is `null`
 * when the dimension could not look — UNKNOWN is a valid answer.
 *
 * `controlStatus` is never typed by hand: it is read from the control ledger
 * that `critics/controls.ts` regenerates by running every dimension over the
 * anchors × corruption families (program charter rule 3: a critic may gate a
 * decision only after a positive control).
 */
import type { ArrangementPlan, SongModelData, TrackModel } from "@workspace/db";

/** The pipeline layer a finding most plausibly originates from. */
export type OriginLayer =
  | "brief"
  | "arc"
  | "form"
  | "harmony"
  | "groove"
  | "orchestration"
  | "register"
  | "compose"
  | "perform"
  | "render"
  | "mix"
  | "unknown";

export type Severity = "info" | "minor" | "major" | "blocking";

export const SEVERITY_ORDER: Record<Severity, number> = { info: 0, minor: 1, major: 2, blocking: 3 };

export type ControlStatus = "gated" | "informing" | "demoted" | "uncalibrated";

export type ObservationLocation = {
  startBar: number;
  endBar: number;
  sectionName?: string;
  /** Empty when the observation is about the whole arrangement (id uses "*"). */
  trackIds: string[];
};

export type RecommendedRepair = {
  operation: string;
  scope: "note" | "part" | "section" | "plan";
  detail: string;
};

export type CriticObservation = {
  /** Stable: `${dimension}:${kind}:${trackId|"*"}:${startBar}-${endBar}` (a `#n` suffix disambiguates collisions). */
  id: string;
  dimension: string;
  /** Machine-readable failure class; feeds the failure taxonomy. */
  kind: string;
  severity: Severity;
  location: ObservationLocation;
  /** The numbers behind the claim. */
  evidence: Record<string, number | string | boolean>;
  suspectedOrigin: OriginLayer;
  /** How sure the critic is about the layer, 0..1, computed from the evidence. */
  originConfidence: number;
  recommendedRepair: RecommendedRepair | null;
  /** 0..1, computed from evidence quantity/quality, never a literal. */
  confidence: number;
};

export type CriticDimensionSummary = {
  /** `null` when the dimension was not applicable. */
  score0to100: number | null;
  /** Share (0..1) of the arrangement the dimension actually examined. */
  coverage: number;
  controlStatus: ControlStatus;
};

export type CriticDimensionReport = {
  dimension: string;
  version: string;
  applicable: boolean;
  reasonIfNot?: string;
  observations: CriticObservation[];
  summary: CriticDimensionSummary;
};

export type CriticInput = {
  songModel: SongModelData;
  plan: ArrangementPlan;
  trackModels: TrackModel[];
  /**
   * The notes the *composer* wrote, before `applyPerformance` and
   * `playabilityRepair` (B-05c). Optional and read defensively: when it is
   * present a dimension can say which layer lost something (R-1b P0-1: a
   * three-voice string bed composed and shipped as one line), and when it is
   * absent the dimension falls back to what the shipped notes alone support
   * and says so in its evidence. Never required for a dimension to be
   * applicable.
   */
  composedTrackModels?: TrackModel[];
  /** ArrangementArc (B-01) once it exists; read defensively. */
  arc?: unknown;
  /** GroovePlan (B-03) once it exists; read defensively. */
  groovePlan?: unknown;
};

/** One critic dimension: a pure, deterministic function of its input. */
export type CriticDimension = {
  dimension: string;
  version: string;
  evaluate(input: CriticInput): CriticDimensionReport;
};
