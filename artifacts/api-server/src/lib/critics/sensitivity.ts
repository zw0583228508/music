/**
 * ONE sensitivity rule and ONE ledger shape for every critic in this program
 * (Brain B-05c, D1 — the answer to R-1a P1-3 "three positive-control ledgers,
 * three rules, and `gated` statuses that rest on the author's own damage").
 *
 * Before this module there were three rules:
 *
 *  - B-05a (`critics/controls.ts`): gated = strongest claimed control ≥ 0.90
 *    with CI lower ≥ 0.60, `n ≥ 5`, no blocking on a clean anchor;
 *  - B-05b (`critics/adversarial/controls.ts`): gated = every anchor caught
 *    **and** CI lower > 0.5 — 7/7 gives a lower bound of 0.59, so the same
 *    evidence read "gated" under B-05b and "informing" under B-05a;
 *  - B-08 (`positiveControlLedger.ts`): gate = ≥ 90 % at the strongest rung on
 *    ≥ `minVotesPerRung` trials, derived from `SENSITIVITY_GATE`.
 *
 * The rule here is B-08's, i.e. the listening gate, and it takes its numbers
 * from `SENSITIVITY_GATE` itself rather than restating them — there is no
 * fourth set of constants in the repo. Two clauses are added, each answering a
 * specific finding of the review:
 *
 *  1. **A prepared control may inform; it may never gate.** A control that
 *     first *writes* the fills, pickups or development the composer never
 *     wrote and then erases them measures the harness's own gesture. That is a
 *     legitimate unit test of the detector and an illegitimate licence to
 *     block a candidate. (`transitions` was gated on
 *     `erase_boundary_events+realise_boundaries`; `playability` and
 *     `voiceLeading` shared the single transform `bass_roots_only_leaps`.)
 *  2. **Two independent transforms are required to gate.** One transform that
 *     is the detector's own definition inverted proves the code runs, not that
 *     the dimension hears music (R-1a §3: `flatten_arc` against an energy
 *     proxy that *is* velocity + onsets; `strip_cc_and_quantise` against a
 *     detector that counts CC events and velocity spread). Two transforms that
 *     damage different musical properties cannot both be the definition.
 *
 * Nothing here is fitted to an outcome: the thresholds are the listening
 * gate's, and the two added clauses only ever *lower* a status.
 */
import { exactBinomialCi, SENSITIVITY_GATE } from "../listeningSensitivity";
import type { ControlStatus } from "./types";

export const CRITIC_SENSITIVITY_VERSION = "B05C_SENSITIVITY_v1" as const;

/**
 * The one rule. `gateMinDetection`, `minTrials` and `alpha` are
 * `SENSITIVITY_GATE`'s own values (B-08 reads the same constants), so a change
 * to the listening gate moves every critic ledger with it.
 */
export const SENSITIVITY_RULE = {
  /** Detection rate at or above which a transform counts as a passed control. */
  gateMinDetection: SENSITIVITY_GATE.strongestMinDetection,
  /**
   * Lower bound of the exact (Clopper–Pearson) 95 % interval a gating
   * transform must clear. B-05a used 0.60; kept, because it is the stricter of
   * the two interval rules that were in the repo and it is the one that makes
   * "7 of 7 anchors" (lower bound 0.59) informing rather than gating.
   */
  gateMinCiLower: 0.6,
  /** Detection rate at or above which a transform informs. */
  informMinDetection: 0.5,
  /** Fewer items than this on a transform: it says nothing, in either direction. */
  minTrials: SENSITIVITY_GATE.minVotesPerRung,
  /** Independent transforms that must each pass before a dimension may gate. */
  minTransformsToGate: 2,
  /** A control that prepares the anchor with the gesture it then removes can inform, never gate. */
  preparedMayGate: false,
  alpha: SENSITIVITY_GATE.alpha,
} as const;

/** One transform's measurement against one dimension. */
export type TransformMeasurement = {
  /** The control name as the harness ran it (`family@severity`, or `control+preparation`). */
  control: string;
  /** The dimension's author claims to hear this damage. Unclaimed transforms are reported, never counted. */
  claimed: boolean;
  /** The control writes the gesture it then erases: `informing` at best. */
  prepared: boolean;
  n: number;
  detected: number;
  rate: number | null;
  ci95: [number, number] | null;
};

export type LedgerEntry = {
  status: ControlStatus;
  /** The transform with the highest detection rate among the dimension's claimed transforms. */
  strongestControl: string | null;
  detectionRate: number | null;
  ci95: [number, number] | null;
  n: number;
  /** Blocking observations raised on clean anchors, per anchor evaluated. */
  cleanAnchorBlockingRate: number | null;
  /** Independent, non-prepared transforms that passed the gate threshold. */
  gatingTransforms: string[];
  /** Why the dimension is not gated, when it is not. Always present for a non-gated dimension. */
  reason: string;
};

/** A transform that clears the gate thresholds on enough trials, and is allowed to gate. */
export function transformGates(m: TransformMeasurement): boolean {
  if (!m.claimed || m.rate === null || m.ci95 === null) return false;
  if (m.prepared && !SENSITIVITY_RULE.preparedMayGate) return false;
  return m.n >= SENSITIVITY_RULE.minTrials && m.rate >= SENSITIVITY_RULE.gateMinDetection && m.ci95[0] >= SENSITIVITY_RULE.gateMinCiLower;
}

/**
 * Two transforms are *independent* when they are not the same damage twice:
 * neither their base names nor their preparations coincide. `octave_displacement@3`
 * and `octave_displacement@2` are one transform; `bass_roots_only_leaps` and
 * `strings_up_two_octaves` are two.
 */
export function transformBase(control: string): string {
  return control.split("+")[0].split("@")[0];
}

export function independentTransforms(controls: readonly string[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const c of [...controls].sort()) {
    const base = transformBase(c);
    if (seen.has(base)) continue;
    seen.add(base);
    out.push(c);
  }
  return out;
}

export type LedgerInput = {
  dimension: string;
  measurements: readonly TransformMeasurement[];
  /** Share of clean anchors on which the dimension raised a blocking observation; null when none was evaluated. */
  cleanAnchorBlockingRate: number | null;
};

/**
 * The single derivation every critic ledger uses.
 *
 *   gated        ≥ `minTransformsToGate` independent, non-prepared, claimed
 *                transforms each detected at ≥ 90 % with an exact 95 % lower
 *                bound ≥ 0.60 on ≥ `minTrials` items, and no blocking
 *                observation on any clean anchor;
 *   informing    the strongest claimed transform reaches ≥ 50 %;
 *   demoted      claimed transforms were measured on enough items and none
 *                reaches 50 %;
 *   uncalibrated no claimed transform could be measured at all.
 */
export function deriveStatus(input: LedgerInput): LedgerEntry {
  const claimed = input.measurements.filter((m) => m.claimed && m.n >= SENSITIVITY_RULE.minTrials && m.rate !== null);
  if (!claimed.length) {
    const seen = input.measurements.filter((m) => m.claimed && m.n > 0);
    return {
      status: "uncalibrated",
      strongestControl: null, detectionRate: null, ci95: null, n: 0,
      cleanAnchorBlockingRate: input.cleanAnchorBlockingRate,
      gatingTransforms: [],
      reason: seen.length
        ? `no claimed transform reached ${SENSITIVITY_RULE.minTrials} items (best ${Math.max(...seen.map((m) => m.n))})`
        : "no claimed transform could be measured on the anchors",
    };
  }
  const strongest = [...claimed].sort((a, b) => (b.rate! - a.rate!) || (b.ci95![0] - a.ci95![0]) || a.control.localeCompare(b.control))[0];
  const gating = independentTransforms(claimed.filter(transformGates).map((m) => m.control));
  const cleanClear = input.cleanAnchorBlockingRate === 0;
  // Transforms the dimension catches but on too few items to count: named in
  // the reason so a `demoted` status is never read as "it heard nothing".
  const underPowered = input.measurements
    .filter((m) => m.claimed && m.n > 0 && m.n < SENSITIVITY_RULE.minTrials && m.rate !== null && m.rate >= SENSITIVITY_RULE.gateMinDetection)
    .map((m) => `${m.control} ${m.detected}/${m.n}`)
    .sort();
  const underPoweredNote = underPowered.length
    ? `; caught ${underPowered.join(", ")} but on fewer than ${SENSITIVITY_RULE.minTrials} items (the transform does not apply to every anchor)`
    : "";

  let status: ControlStatus;
  let reason: string;
  if (gating.length >= SENSITIVITY_RULE.minTransformsToGate && cleanClear) {
    status = "gated";
    reason = `${gating.length} independent non-prepared transforms passed (${gating.join(", ")}) and no clean anchor is blocked`;
  } else if (strongest.rate! >= SENSITIVITY_RULE.informMinDetection) {
    status = "informing";
    const why: string[] = [];
    if (!cleanClear) why.push(`blocks ${Math.round((input.cleanAnchorBlockingRate ?? 0) * 100)} % of clean anchors`);
    if (gating.length < SENSITIVITY_RULE.minTransformsToGate) {
      const prepared = claimed.filter((m) => m.prepared && m.rate! >= SENSITIVITY_RULE.gateMinDetection).map((m) => m.control);
      why.push(`${gating.length} of ${SENSITIVITY_RULE.minTransformsToGate} independent non-prepared transforms pass${prepared.length ? ` (${prepared.join(", ")} is prepared: it writes the gesture it then erases)` : ""}`);
    }
    reason = why.join("; ") + underPoweredNote;
  } else {
    status = "demoted";
    reason = `strongest claimed transform ${strongest.control} detected ${Math.round(strongest.rate! * 100)} % of ${strongest.n} items, below ${Math.round(SENSITIVITY_RULE.informMinDetection * 100)} %${underPoweredNote}`;
  }
  return {
    status,
    strongestControl: strongest.control,
    detectionRate: strongest.rate,
    ci95: strongest.ci95,
    n: strongest.n,
    cleanAnchorBlockingRate: input.cleanAnchorBlockingRate,
    gatingTransforms: gating,
    reason,
  };
}

/** `deriveStatus` for a harness that counts one transform over a set of anchors (the B-05b shape). */
export function statusFromDetection(options: {
  control: string;
  detected: number;
  anchorsTried: number;
  prepared?: boolean;
  /** A second, independent transform for the same dimension, when the harness ran one. */
  second?: { control: string; detected: number; anchorsTried: number; prepared?: boolean };
  cleanAnchorBlockingRate: number | null;
}): LedgerEntry {
  const measure = (control: string, detected: number, n: number, prepared: boolean): TransformMeasurement => ({
    control, claimed: true, prepared, n, detected,
    rate: n ? Number((detected / n).toFixed(4)) : null,
    ci95: n ? exactBinomialCi(detected, n) : null,
  });
  const measurements = [measure(options.control, options.detected, options.anchorsTried, options.prepared ?? false)];
  if (options.second) measurements.push(measure(options.second.control, options.second.detected, options.second.anchorsTried, options.second.prepared ?? false));
  return deriveStatus({ dimension: options.control, measurements, cleanAnchorBlockingRate: options.cleanAnchorBlockingRate });
}
