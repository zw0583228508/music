/**
 * Sensitivity report for a listening session (Wave Q — PR-72).
 *
 * Given a session's votes, this says whether the *experiment* can hear: for
 * every positive-control rung, the detection rate (how often the human
 * original beat its degraded copy on the primary question) with an exact
 * binomial confidence interval and an exact one-sided p against chance; the
 * minimum detectable effect at the session's n; and a **gate verdict** whose
 * thresholds are constants in this file, not in prose.
 *
 * The gate (`SENSITIVITY_GATE`): `may_judge_training` only when the rater
 * detects the strongest rung (pitch_shift 60 %) at ≥ 90 % and the moderate
 * rung (pitch_shift 30 %) above chance with one-sided p < 0.05, each on at
 * least `minVotesPerRung` votes. Fewer votes → `insufficient_data`; enough
 * votes and a threshold missed → `not_sensitive`. A session with no control
 * pairs (the owner's PR-71 session) is `insufficient_data` by construction.
 *
 * The decision table is written before any vote so the reading of the
 * calibration pair (HUMAN vs REFERENCE) is fixed in advance: it names what
 * each outcome establishes and what it leaves as a candidate cause to test,
 * never a cause a control has not isolated.
 */
import type { BlindListeningPair } from "@workspace/db";
import { CONTROL_COMPARISON_TYPES, DEGRADATION_DESCRIPTIONS, type DegradationRung } from "./listeningDegradations";
import { COMPARISON_TYPES } from "./tournamentListening";
import { HUMAN_SUT } from "./tournamentProviders";

export const LISTENING_SENSITIVITY_VERSION = "1.0" as const;

export const SENSITIVITY_GATE = {
  strongest: { kind: "pitch_shift", strength: 0.6 } as DegradationRung,
  strongestMinDetection: 0.9,
  moderate: { kind: "pitch_shift", strength: 0.3 } as DegradationRung,
  moderateMaxP: 0.05,
  minVotesPerRung: 8,
  alpha: 0.05,
  power: 0.8,
} as const;

export type GateVerdict = "insufficient_data" | "not_sensitive" | "may_judge_training";

// ---------------------------------------------------------------------------
// Exact binomial arithmetic (n is at most a few dozen; log-space is enough)
// ---------------------------------------------------------------------------

function logChoose(n: number, k: number): number {
  let v = 0;
  for (let i = 1; i <= k; i += 1) v += Math.log(n - k + i) - Math.log(i);
  return v;
}

export function binomialPmf(k: number, n: number, p: number): number {
  if (k < 0 || k > n) return 0;
  if (p <= 0) return k === 0 ? 1 : 0;
  if (p >= 1) return k === n ? 1 : 0;
  return Math.exp(logChoose(n, k) + k * Math.log(p) + (n - k) * Math.log(1 - p));
}

/** P(X >= k) for X ~ Binomial(n, p). */
export function binomialUpperTail(k: number, n: number, p: number): number {
  let s = 0;
  for (let i = Math.max(0, k); i <= n; i += 1) s += binomialPmf(i, n, p);
  return Math.min(1, s);
}
/** P(X <= k). */
export function binomialLowerTail(k: number, n: number, p: number): number {
  let s = 0;
  for (let i = 0; i <= Math.min(n, k); i += 1) s += binomialPmf(i, n, p);
  return Math.min(1, s);
}

/** One-sided exact p: P(X >= k | p = 0.5). */
export const oneSidedPVsChance = (k: number, n: number): number => (n ? binomialUpperTail(k, n, 0.5) : 1);
/** Two-sided exact p: 2 × the smaller tail, capped at 1 — the PR-71 convention. */
export function twoSidedPVsChance(k: number, n: number): number {
  if (!n) return 1;
  return Math.min(1, 2 * Math.min(binomialLowerTail(k, n, 0.5), binomialUpperTail(k, n, 0.5)));
}

/** Clopper–Pearson exact 95 % interval by bisection on the tails. */
export function exactBinomialCi(k: number, n: number, confidence = 0.95): [number, number] {
  if (!n) return [0, 1];
  const alpha = 1 - confidence;
  const solve = (target: (p: number) => number): number => {
    let lo = 0;
    let hi = 1;
    for (let i = 0; i < 60; i += 1) {
      const mid = (lo + hi) / 2;
      if (target(mid) > 0) hi = mid; else lo = mid;
    }
    return (lo + hi) / 2;
  };
  const lower = k === 0 ? 0 : solve((p) => binomialUpperTail(k, n, p) - alpha / 2);
  const upper = k === n ? 1 : solve((p) => -(binomialLowerTail(k, n, p) - alpha / 2));
  return [Number(lower.toFixed(4)), Number(upper.toFixed(4))];
}

/**
 * The smallest true detection rate a one-sided exact test at `alpha` rejects
 * chance for with probability `power`, given n votes — the session's minimum
 * detectable effect. Also returns the critical count.
 */
export function minimumDetectableRate(n: number, alpha = SENSITIVITY_GATE.alpha, power = SENSITIVITY_GATE.power): { n: number; criticalWins: number | null; detectionRate: number | null } {
  if (n <= 0) return { n, criticalWins: null, detectionRate: null };
  let critical: number | null = null;
  for (let k = 0; k <= n; k += 1) if (binomialUpperTail(k, n, 0.5) <= alpha) { critical = k; break; }
  if (critical === null) return { n, criticalWins: null, detectionRate: null };
  let lo = 0.5;
  let hi = 1;
  for (let i = 0; i < 60; i += 1) {
    const mid = (lo + hi) / 2;
    if (binomialUpperTail(critical, n, mid) >= power) hi = mid; else lo = mid;
  }
  return { n, criticalWins: critical, detectionRate: Number(hi.toFixed(4)) };
}

// ---------------------------------------------------------------------------
// The report
// ---------------------------------------------------------------------------

export type ControlSensitivity = {
  comparison: string;
  kind: DegradationRung["kind"];
  strength: number;
  description: string;
  pairs: number;
  votes: number;
  detected: number;
  detectionRate: number | null;
  ci95: [number, number] | null;
  pOneSidedVsChance: number | null;
  aboveChance: boolean;
  gateRole: "strongest" | "moderate" | null;
};

export type CalibrationSummary = {
  comparison: string;
  a: string;
  b: string;
  pairs: number;
  votes: number;
  aWins: number;
  aShare: number | null;
  ci95: [number, number] | null;
  pTwoSidedVsCoinFlip: number | null;
};

export type DecisionRow = {
  id: string;
  when: string;
  establishes: string;
  candidateCausesToTest: string[];
  gate: GateVerdict;
};

export type SensitivityReport = {
  version: typeof LISTENING_SENSITIVITY_VERSION;
  sessionId: string;
  primaryQuestion: string;
  raters: { counted: "all" | "owner" | "independent"; distinct: number; ownerVotes: number; independentVotes: number };
  votesConsidered: number;
  controls: ControlSensitivity[];
  minimumDetectableEffect: { atGateRungN: number; criticalWins: number | null; detectionRate: number | null; note: string };
  calibration: CalibrationSummary[];
  gate: { verdict: GateVerdict; rule: string; thresholds: typeof SENSITIVITY_GATE; reasons: string[] };
  decisionTable: DecisionRow[];
  interpretation: { row: string | null; text: string };
};

export type SessionLike = { id: string; pairs: BlindListeningPair[]; keyBySide: Record<string, string>; sides?: { tournament?: { primaryQuestion?: string } } };
export type VoteLike = { pairId: string; question: string; winnerToken: string; raterId: string; isOwner: boolean };

export const GATE_RULE_TEXT =
  `may_judge_training only when the strongest rung (${SENSITIVITY_GATE.strongest.kind} ${Math.round(SENSITIVITY_GATE.strongest.strength * 100)} %) is detected at >= ${Math.round(SENSITIVITY_GATE.strongestMinDetection * 100)} % ` +
  `and the moderate rung (${SENSITIVITY_GATE.moderate.kind} ${Math.round(SENSITIVITY_GATE.moderate.strength * 100)} %) beats chance with one-sided exact p < ${SENSITIVITY_GATE.moderateMaxP}, ` +
  `each on >= ${SENSITIVITY_GATE.minVotesPerRung} primary-question votes; fewer votes on either rung is insufficient_data; a missed threshold is not_sensitive.`;

/** Written before any vote. The reading of HUMAN vs REFERENCE depends on which row the controls select. */
export const DECISION_TABLE: DecisionRow[] = [
  {
    id: "no_controls_or_too_few_votes",
    when: "either gate rung has fewer votes than the minimum, or the session has no control pairs",
    establishes: "nothing about sensitivity; the session cannot be read for HUMAN vs REFERENCE either",
    candidateCausesToTest: [],
    gate: "insufficient_data",
  },
  {
    id: "strongest_not_detected",
    when: "the strongest rung is detected below the threshold",
    establishes: "the pipeline as a whole flattens a 60 % pitch-shifted copy of a real part into something a listener cannot separate from the original; every result on this session is uninterpretable, including HUMAN vs REFERENCE",
    candidateCausesToTest: [
      "the renderer (compare the same pairs under a second renderer)",
      "the excerpt length (compare 8-bar, 16-bar and section windows on the same task)",
      "the mix (candidate gain, loudness normalisation)",
      "the rater's listening conditions or fatigue (repeat a subset in a fresh sitting)",
    ],
    gate: "not_sensitive",
  },
  {
    id: "strongest_detected_moderate_not",
    when: "the strongest rung passes but the moderate rung is not above chance",
    establishes: "the experiment hears gross damage only; it can gate gross regressions, not the differences training is expected to make; a 50/50 HUMAN vs REFERENCE here means the difference between them is smaller than a 30 % pitch shift at this length, which is a fact about both composers and the experiment",
    candidateCausesToTest: [
      "excerpt length (longer passages give more evidence per pair)",
      "more pairs per comparison (the 30 % rung may be real but under-powered at this n)",
      "which kinds of damage are heard (compare the jitter, deletion and random-pitch rungs)",
    ],
    gate: "not_sensitive",
  },
  {
    id: "sensitive_reference_competitive",
    when: "both gate rungs pass and HUMAN vs REFERENCE is not distinguishable from a coin flip",
    establishes: "the experiment is sensitive and the reference is genuinely competitive with the human part at this excerpt length; the PR-71 5-5 was about the composers, not the pipeline",
    candidateCausesToTest: [
      "the reference's strength on these families and this genre slice (run the calibration pair on the non-classical slice)",
      "whether the difference appears at section length (compare window kinds on the same tasks)",
    ],
    gate: "may_judge_training",
  },
  {
    id: "sensitive_human_preferred",
    when: "both gate rungs pass and HUMAN vs REFERENCE favours the human (two-sided p < 0.05)",
    establishes: "the experiment is sensitive and the human anchor holds; the session may judge a training run on the platform comparisons",
    candidateCausesToTest: [],
    gate: "may_judge_training",
  },
];

/** The sensitivity report on a session's votes. Pure. */
export function sensitivityReport(
  session: SessionLike,
  votes: readonly VoteLike[],
  options: { primaryQuestion?: string; raters?: "all" | "owner" | "independent" } = {},
): SensitivityReport {
  const primaryQuestion = options.primaryQuestion ?? session.sides?.tournament?.primaryQuestion ?? "";
  const counted = options.raters ?? "all";
  const pairs = new Map(session.pairs.map((p) => [p.pairId, p]));
  const primary = votes.filter((v) => v.question === primaryQuestion && pairs.has(v.pairId));
  const considered = primary.filter((v) => (counted === "all" ? true : counted === "owner" ? v.isOwner : !v.isOwner));
  const winnerArm = (v: VoteLike) => session.keyBySide[v.winnerToken];

  const controls: ControlSensitivity[] = CONTROL_COMPARISON_TYPES
    .filter((type) => session.pairs.some((p) => p.meta?.comparison === type.id))
    .map((type) => {
      const mine = considered.filter((v) => pairs.get(v.pairId)?.meta?.comparison === type.id);
      const detected = mine.filter((v) => winnerArm(v) === HUMAN_SUT).length;
      const n = mine.length;
      const p = n ? oneSidedPVsChance(detected, n) : null;
      const gateRole = type.control.kind === SENSITIVITY_GATE.strongest.kind && type.control.strength === SENSITIVITY_GATE.strongest.strength
        ? "strongest"
        : type.control.kind === SENSITIVITY_GATE.moderate.kind && type.control.strength === SENSITIVITY_GATE.moderate.strength ? "moderate" : null;
      return {
        comparison: type.id,
        kind: type.control.kind,
        strength: type.control.strength,
        description: DEGRADATION_DESCRIPTIONS[type.control.kind],
        pairs: session.pairs.filter((p) => p.meta?.comparison === type.id).length,
        votes: n,
        detected,
        detectionRate: n ? Number((detected / n).toFixed(4)) : null,
        ci95: n ? exactBinomialCi(detected, n) : null,
        pOneSidedVsChance: p === null ? null : Number(p.toFixed(4)),
        aboveChance: p !== null && p < SENSITIVITY_GATE.alpha,
        gateRole,
      };
    });

  const calibration: CalibrationSummary[] = COMPARISON_TYPES
    .filter((type) => session.pairs.some((p) => p.meta?.comparison === type.id))
    .map((type) => {
      const mine = considered.filter((v) => pairs.get(v.pairId)?.meta?.comparison === type.id);
      const aWins = mine.filter((v) => winnerArm(v) === type.a).length;
      const n = mine.length;
      return {
        comparison: type.id, a: type.a, b: type.b,
        pairs: session.pairs.filter((p) => p.meta?.comparison === type.id).length,
        votes: n, aWins,
        aShare: n ? Number((aWins / n).toFixed(4)) : null,
        ci95: n ? exactBinomialCi(aWins, n) : null,
        pTwoSidedVsCoinFlip: n ? Number(twoSidedPVsChance(aWins, n).toFixed(4)) : null,
      };
    });

  const strongest = controls.find((c) => c.gateRole === "strongest");
  const moderate = controls.find((c) => c.gateRole === "moderate");
  const reasons: string[] = [];
  let verdict: GateVerdict;
  let row: DecisionRow;
  if (!controls.length) {
    reasons.push("the session has no control pairs; it cannot demonstrate sensitivity");
    verdict = "insufficient_data";
    row = DECISION_TABLE[0];
  } else if (!strongest || !moderate || strongest.votes < SENSITIVITY_GATE.minVotesPerRung || moderate.votes < SENSITIVITY_GATE.minVotesPerRung) {
    reasons.push(`strongest rung has ${strongest?.votes ?? 0} vote(s) and moderate rung ${moderate?.votes ?? 0}; each needs at least ${SENSITIVITY_GATE.minVotesPerRung}`);
    verdict = "insufficient_data";
    row = DECISION_TABLE[0];
  } else if ((strongest.detectionRate ?? 0) < SENSITIVITY_GATE.strongestMinDetection) {
    reasons.push(`strongest rung detected ${strongest.detected}/${strongest.votes} = ${Math.round((strongest.detectionRate ?? 0) * 100)} %; the gate needs ${Math.round(SENSITIVITY_GATE.strongestMinDetection * 100)} %`);
    verdict = "not_sensitive";
    row = DECISION_TABLE[1];
  } else if (!(moderate.pOneSidedVsChance !== null && moderate.pOneSidedVsChance < SENSITIVITY_GATE.moderateMaxP)) {
    reasons.push(`strongest rung detected ${strongest.detected}/${strongest.votes}; moderate rung ${moderate.detected}/${moderate.votes} with one-sided p ${moderate.pOneSidedVsChance}, not below ${SENSITIVITY_GATE.moderateMaxP}`);
    verdict = "not_sensitive";
    row = DECISION_TABLE[2];
  } else {
    reasons.push(`strongest rung detected ${strongest.detected}/${strongest.votes}; moderate rung ${moderate.detected}/${moderate.votes} with one-sided p ${moderate.pOneSidedVsChance}`);
    verdict = "may_judge_training";
    const hvr = calibration.find((c) => c.comparison === "human_vs_reference");
    const humanPreferred = hvr && hvr.pTwoSidedVsCoinFlip !== null && hvr.pTwoSidedVsCoinFlip < 0.05 && (hvr.aShare ?? 0) > 0.5;
    row = humanPreferred ? DECISION_TABLE[4] : DECISION_TABLE[3];
  }

  const gateN = Math.min(strongest?.votes ?? 0, moderate?.votes ?? 0);
  const mde = minimumDetectableRate(gateN);
  const distinct = new Set(considered.map((v) => v.raterId)).size;
  return {
    version: LISTENING_SENSITIVITY_VERSION,
    sessionId: session.id,
    primaryQuestion,
    raters: {
      counted,
      distinct,
      ownerVotes: primary.filter((v) => v.isOwner).length,
      independentVotes: primary.filter((v) => !v.isOwner).length,
    },
    votesConsidered: considered.length,
    controls,
    minimumDetectableEffect: {
      atGateRungN: gateN,
      criticalWins: mde.criticalWins,
      detectionRate: mde.detectionRate,
      note: gateN
        ? `with ${gateN} votes on a rung, a one-sided exact test at alpha ${SENSITIVITY_GATE.alpha} rejects chance from ${mde.criticalWins} wins, and a true detection rate of ${mde.detectionRate === null ? "n/a" : Math.round(mde.detectionRate * 100)} % is caught with power ${SENSITIVITY_GATE.power}`
        : "no control votes yet; the minimum detectable effect is undefined until a rung has votes",
    },
    calibration,
    gate: { verdict, rule: GATE_RULE_TEXT, thresholds: SENSITIVITY_GATE, reasons },
    decisionTable: DECISION_TABLE,
    interpretation: { row: row.id, text: `${row.when}: ${row.establishes}` },
  };
}
