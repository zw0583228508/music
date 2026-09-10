/**
 * The adversarial critic (Brain B-05b, D1): eight modules whose job is to
 * reject. `runAdversarialCritics` returns one `CriticDimensionReport` per
 * module. Every dimension is `uncalibrated` unless the caller passes a
 * control ledger measured by the positive-control run (see `controls.ts`
 * and the evidence file): a module never declares its own gating status.
 */
import type { CriticDimensionReport, CriticInput } from "../types";
import { ARBITRARINESS_DIMENSION, ARBITRARINESS_KINDS, critiqueArbitrariness } from "./arbitrariness";
import { BOREDOM_DIMENSION, BOREDOM_KINDS, critiqueBoredom } from "./boredom";
import { CAUSALITY_DIMENSION, CAUSALITY_KINDS, critiqueCausality } from "./causality";
import { COPIED_REPEAT_DIMENSION, COPIED_REPEAT_KINDS, critiqueCopiedRepeat } from "./copiedRepeat";
import { FIGHTING_DIMENSION, FIGHTING_KINDS, critiqueFighting } from "./fighting";
import { INSTRUMENT_REALITY_DIMENSION, INSTRUMENT_REALITY_KINDS, critiqueInstrumentReality } from "./instrumentReality";
import { MACHINE_MADE_DIMENSION, MACHINE_MADE_KINDS, critiqueMachineMade } from "./machineMade";
import { PROFESSIONAL_DIMENSION, PROFESSIONAL_KINDS, critiqueProfessionalWouldChange } from "./professionalWouldChange";
import type { ControlStatus } from "./shared";

export const ADVERSARIAL_CRITIC_VERSION = "ADVERSARIAL_CRITIC_v1" as const;

export type AdversarialModule = {
  dimension: string;
  kinds: readonly string[];
  run: (input: CriticInput, options?: { controlStatus?: ControlStatus }) => CriticDimensionReport;
};

export const ADVERSARIAL_MODULES: readonly AdversarialModule[] = [
  { dimension: BOREDOM_DIMENSION, kinds: BOREDOM_KINDS, run: critiqueBoredom },
  { dimension: MACHINE_MADE_DIMENSION, kinds: MACHINE_MADE_KINDS, run: critiqueMachineMade },
  { dimension: CAUSALITY_DIMENSION, kinds: CAUSALITY_KINDS, run: critiqueCausality },
  { dimension: ARBITRARINESS_DIMENSION, kinds: ARBITRARINESS_KINDS, run: critiqueArbitrariness },
  { dimension: INSTRUMENT_REALITY_DIMENSION, kinds: INSTRUMENT_REALITY_KINDS, run: critiqueInstrumentReality },
  { dimension: COPIED_REPEAT_DIMENSION, kinds: COPIED_REPEAT_KINDS, run: critiqueCopiedRepeat },
  { dimension: FIGHTING_DIMENSION, kinds: FIGHTING_KINDS, run: critiqueFighting },
  { dimension: PROFESSIONAL_DIMENSION, kinds: PROFESSIONAL_KINDS, run: critiqueProfessionalWouldChange },
];

/** Every kind any adversarial module can emit (the taxonomy test maps each one). */
export const ADVERSARIAL_KINDS: readonly string[] = ADVERSARIAL_MODULES.flatMap((m) => [...m.kinds]);

/** dimension → control status measured by a positive-control run. Absent dimensions stay uncalibrated. */
export type ControlLedger = Readonly<Record<string, ControlStatus>>;

export function runAdversarialCritics(input: CriticInput, options: { controlLedger?: ControlLedger } = {}): CriticDimensionReport[] {
  return ADVERSARIAL_MODULES.map((m) => m.run(input, { controlStatus: options.controlLedger?.[m.dimension] ?? "uncalibrated" }));
}

export {
  critiqueBoredom, critiqueMachineMade, critiqueCausality, critiqueArbitrariness, critiqueInstrumentReality,
  critiqueCopiedRepeat, critiqueFighting, critiqueProfessionalWouldChange,
};
