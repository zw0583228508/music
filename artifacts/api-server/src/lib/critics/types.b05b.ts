/**
 * Brain B-05 shared critic contract — B-05b copy.
 *
 * `critics/types.ts` is authored by stream B-05a. To avoid two streams editing
 * one file, B-05b carries an identical copy of the shared contract here and
 * imports from it; the lead unifies the two files at merge. Field names are
 * the contract and must not drift.
 */
import type { ArrangementPlan, SongModelData, TrackModel } from "@workspace/db";

export type OriginLayer =
  | "brief" | "arc" | "form" | "harmony" | "groove" | "orchestration" | "register"
  | "compose" | "perform" | "render" | "mix" | "unknown";

export type Severity = "info" | "minor" | "major" | "blocking";

export type CriticObservation = {
  id: string;
  dimension: string;
  kind: string;
  severity: Severity;
  location: { startBar: number; endBar: number; sectionName?: string; trackIds: string[] };
  evidence: Record<string, number | string | boolean>;
  suspectedOrigin: OriginLayer;
  originConfidence: number;
  recommendedRepair: { operation: string; scope: "note" | "part" | "section" | "plan"; detail: string } | null;
  confidence: number;
};

export type CriticDimensionReport = {
  dimension: string;
  version: string;
  applicable: boolean;
  reasonIfNot?: string;
  observations: CriticObservation[];
  summary: {
    score0to100: number | null;
    coverage: number;
    controlStatus: "gated" | "informing" | "demoted" | "uncalibrated";
  };
};

export type CriticInput = {
  songModel: SongModelData;
  plan: ArrangementPlan;
  trackModels: TrackModel[];
  arc?: unknown;
  groovePlan?: unknown;
};
