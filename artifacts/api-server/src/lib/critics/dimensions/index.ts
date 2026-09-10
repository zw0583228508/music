/**
 * The note-level critic dimensions (B-05a). Each is a pure function of a
 * `CriticInput`; `evaluateAllDimensions` runs them in a fixed order. Nothing
 * here aggregates across dimensions: the judge layer (B-05b) reads these
 * reports and preserves their disagreement.
 *
 * NOT INTEGRATED: no production path calls these yet (B-00 / B-06 wire them).
 */
import type { CriticDimension, CriticDimensionReport, CriticInput } from "../types";
import { harmonyDimension } from "./harmony";
import { voiceLeadingDimension } from "./voiceLeading";
import { melodyAndCounterlineDimension } from "./melodyAndCounterline";
import { motifDimension } from "./motifRecurrenceAndDevelopment";
import { grooveDimension } from "./groove";
import { rhythmicInteractionDimension } from "./rhythmicInteraction";
import { orchestrationDimension } from "./orchestration";
import { idiomaticityDimension } from "./idiomaticity";
import { registerDimension } from "./register";
import { densityDimension } from "./density";
import { transitionsDimension } from "./transitions";
import { repetitionVsVariationDimension } from "./repetitionVsVariation";
import { sectionDevelopmentDimension } from "./sectionDevelopment";
import { playabilityDimension } from "./playability";
import { performanceRealisationDimension } from "./performanceRealisation";
import { emotionalArcAndTensionDimension } from "./emotionalArcAndTension";

export const CRITIC_DIMENSIONS_VERSION = "B05A_CRITIC_DIMENSIONS_v1" as const;

export const ALL_DIMENSIONS: readonly CriticDimension[] = [
  harmonyDimension,
  voiceLeadingDimension,
  melodyAndCounterlineDimension,
  motifDimension,
  grooveDimension,
  rhythmicInteractionDimension,
  orchestrationDimension,
  idiomaticityDimension,
  registerDimension,
  densityDimension,
  transitionsDimension,
  repetitionVsVariationDimension,
  sectionDevelopmentDimension,
  playabilityDimension,
  performanceRealisationDimension,
  emotionalArcAndTensionDimension,
];

export const DIMENSION_NAMES: readonly string[] = ALL_DIMENSIONS.map((d) => d.dimension);

export function dimensionByName(name: string): CriticDimension | null {
  return ALL_DIMENSIONS.find((d) => d.dimension === name) ?? null;
}

export function evaluateAllDimensions(input: CriticInput): CriticDimensionReport[] {
  return ALL_DIMENSIONS.map((d) => d.evaluate(input));
}

export {
  harmonyDimension, voiceLeadingDimension, melodyAndCounterlineDimension, motifDimension, grooveDimension,
  rhythmicInteractionDimension, orchestrationDimension, idiomaticityDimension, registerDimension, densityDimension,
  transitionsDimension, repetitionVsVariationDimension, sectionDevelopmentDimension, playabilityDimension,
  performanceRealisationDimension, emotionalArcAndTensionDimension,
};
