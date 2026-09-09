/**
 * Instrument scorecard (Wave Q — Model Discovery, Workstream K).
 *
 * The tournament reports one scorecard per arm. This turns the same entries
 * into **one scorecard per instrument family × arm**, so the question the
 * architecture decision needs — *is one model good at everything, or is each
 * arm good somewhere and weak elsewhere?* — is answered with the numbers per
 * family rather than an average that hides them.
 *
 * Per family × arm: mean proxy score, playability errors per entry, playable
 * range share (the judge's), idiomatic register share (share of notes inside
 * the instrument's *standard* range from `GM_REFERENCE`, when the notes are
 * available), chord-tone share, coverage, onset density vs the human part,
 * verbatim bar repetition, semitone clashes with the context, and the
 * collapse rate; each as a delta from the human arm on the same family.
 *
 * `design` states what the per-family picture says about a "global arranger
 * + instrument-expert adapters" design vs one model for everything: the gain
 * from choosing the best machine arm per family (an oracle router) over the
 * best single machine arm, and how many families change hands. It is a
 * number on a small tournament, and the `caveats` say how small.
 */
import { judgePlayability, type PartMetrics } from "./partJudge";
import type { ConstraintNote } from "./musicalConstraints";
import { gmReference } from "./judgeCalibration";

export const INSTRUMENT_SCORECARD_VERSION = "1.0" as const;

export const HUMAN_ARM = "HUMAN_ORIGIN_REFERENCE";
export const REFERENCE_ARM = "REFERENCE_PART_COMPOSER";

export type ScorecardEntry = {
  taskId: string;
  targetFamily: string;
  targetInst: number;
  providerId: string;
  seed: number;
  score: number;
  metrics: PartMetrics;
  failure: string | null;
  /** Pitches of the candidate's notes in the window, when the caller could recover them (from the entry MIDI). */
  pitches?: number[] | null;
  /**
   * The candidate's notes, when the caller could recover them. The tournament's
   * own `playabilityErrors` were produced by judge 1.0; with the notes in hand
   * the card re-judges the same part under the calibrated judge (PR-61), which
   * is the number a reader should compare arms on.
   */
  notes?: readonly ConstraintNote[] | null;
  /** Tempo of the task, for the re-judgement (breath and re-articulation are in seconds). */
  tempoBpm?: number | null;
  /** Which tournament run the entry came from, when several are merged. */
  source?: string;
};

export type ArmFamilyCard = {
  providerId: string;
  entries: number;
  failures: number;
  meanScore: number | null;
  /** As the tournament judged it (judge 1.0 in the live run). */
  playabilityErrorsPerEntry: number | null;
  /** The same parts re-judged under the calibrated judge, when the notes were recoverable; null otherwise. */
  playabilityErrorsCalibrated: number | null;
  playableRangeShare: number | null;
  idiomaticRegisterShare: number | null;
  chordToneShare: number | null;
  coverage: number | null;
  /** Mean signed log2 onset-density ratio vs the human part (+ = denser). */
  densityLogRatio: number | null;
  /** Mean |log2 ratio| — how far from the human's density in either direction. */
  densityDistance: number | null;
  barRepetitionShare: number | null;
  contextClashShare: number | null;
  collapseRate: number | null;
  meanNoteCount: number | null;
  /** Share of (task, seed) cells where this arm out-scores the human / the reference on this family. */
  winRateVsHuman: number | null;
  winRateVsReference: number | null;
  /** Metric deltas vs the human arm on the same family (arm − human). */
  vsHuman: Partial<Record<"meanScore" | "playabilityErrorsPerEntry" | "idiomaticRegisterShare" | "chordToneShare" | "coverage" | "barRepetitionShare" | "contextClashShare", number>>;
  strengths: string[];
  weaknesses: string[];
};

export type FamilyCard = {
  family: string;
  tasks: number;
  programs: number[];
  arms: ArmFamilyCard[];
  /** Best machine arm by mean score, and its margin over the runner-up machine arm. */
  bestMachineArm: { providerId: string; meanScore: number; marginOverNext: number | null } | null;
};

export type DesignReading = {
  machineArms: string[];
  /** Mean over families of each machine arm's family mean (families weighted equally). */
  armMeanOverFamilies: Record<string, number | null>;
  bestSingleArm: { providerId: string; meanOverFamilies: number } | null;
  /** Mean over families of the best machine arm's family mean — what a perfect per-family router would get. */
  oraclePerFamilyMean: number | null;
  /** oracle − best single arm, in score points. */
  routerGainPoints: number | null;
  familiesWhereBestDiffers: Array<{ family: string; bestArm: string; bestScore: number; singleArmScore: number; gain: number }>;
  /** The same comparison on playability errors (lower is better). */
  playability: { bestSingleArm: string | null; singleArmErrors: number | null; oracleErrors: number | null; routerGainErrors: number | null };
  caveats: string[];
};

export type InstrumentScorecard = {
  version: typeof INSTRUMENT_SCORECARD_VERSION;
  sources: string[];
  entries: number;
  families: FamilyCard[];
  design: DesignReading;
};

const r2 = (v: number): number => Number(v.toFixed(2));
const r4 = (v: number): number => Number(v.toFixed(4));
const mean = (values: Array<number | null | undefined>): number | null => {
  const xs = values.filter((v): v is number => typeof v === "number" && Number.isFinite(v));
  return xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : null;
};

/** Share of pitches inside the instrument's standard range; null without notes or without a reference. */
export function idiomaticRegisterShare(pitches: readonly number[] | null | undefined, program: number): number | null {
  if (!pitches || !pitches.length) return null;
  const ref = gmReference(program);
  if (!ref?.range) return null;
  const [lo, hi] = ref.range.std;
  return r4(pitches.filter((p) => p >= lo && p <= hi).length / pitches.length);
}

/**
 * Playability errors for one entry under the calibrated judge, when the
 * caller recovered the notes. The tournament's stored number came from judge
 * 1.0, whose false positives the calibration measured (a human brass part
 * drew 2.5 errors per entry from rules that did not survive the calibration);
 * comparing arms on it compares judge bugs as much as parts.
 */
function recheckPlayability(entry: ScorecardEntry): number | null {
  if (!entry.notes || !entry.notes.length) return null;
  return judgePlayability({
    targetInst: entry.targetInst,
    targetFamily: entry.targetFamily,
    tempoBpm: entry.tempoBpm ?? 120,
    notes: entry.notes,
  }).playabilityErrors;
}

function winRate(entries: readonly ScorecardEntry[], all: readonly ScorecardEntry[], against: string): number | null {
  const opponent = new Map(all.filter((e) => e.providerId === against).map((e) => [`${e.taskId}:${e.seed}`, e.score]));
  let wins = 0;
  let cells = 0;
  for (const e of entries) {
    const other = opponent.get(`${e.taskId}:${e.seed}`);
    if (other === undefined) continue;
    cells += 1;
    if (e.score > other) wins += 1;
  }
  return cells ? r4(wins / cells) : null;
}

function armCard(providerId: string, entries: readonly ScorecardEntry[], familyEntries: readonly ScorecardEntry[]): ArmFamilyCard {
  const ok = entries.filter((e) => !e.failure);
  const m = (pick: (e: ScorecardEntry) => number | null | undefined) => mean(ok.map(pick));
  const registers = ok.map((e) => idiomaticRegisterShare(e.pitches, e.targetInst));
  const meanScore = m((e) => e.score);
  return {
    providerId,
    entries: entries.length,
    failures: entries.length - ok.length,
    meanScore: meanScore === null ? null : r2(meanScore),
    playabilityErrorsPerEntry: (() => { const v = m((e) => e.metrics.playabilityErrors); return v === null ? null : r2(v); })(),
    playabilityErrorsCalibrated: (() => { const v = mean(ok.map(recheckPlayability)); return v === null ? null : r2(v); })(),
    playableRangeShare: (() => { const v = m((e) => e.metrics.rangeShare); return v === null ? null : r4(v); })(),
    idiomaticRegisterShare: (() => { const v = mean(registers); return v === null ? null : r4(v); })(),
    chordToneShare: (() => { const v = m((e) => e.metrics.chordToneShare); return v === null ? null : r4(v); })(),
    coverage: (() => { const v = m((e) => e.metrics.coverage); return v === null ? null : r4(v); })(),
    densityLogRatio: (() => { const v = m((e) => e.metrics.densityLogRatio); return v === null ? null : r4(v); })(),
    densityDistance: (() => { const v = mean(ok.map((e) => (e.metrics.densityLogRatio === null ? null : Math.abs(e.metrics.densityLogRatio)))); return v === null ? null : r4(v); })(),
    barRepetitionShare: (() => { const v = m((e) => e.metrics.barRepetitionShare); return v === null ? null : r4(v); })(),
    contextClashShare: (() => { const v = m((e) => e.metrics.contextClashShare); return v === null ? null : r4(v); })(),
    collapseRate: ok.length ? r4(ok.filter((e) => e.metrics.singlePitch).length / ok.length) : null,
    meanNoteCount: (() => { const v = m((e) => e.metrics.noteCount); return v === null ? null : r2(v); })(),
    winRateVsHuman: providerId === HUMAN_ARM ? null : winRate(ok, familyEntries, HUMAN_ARM),
    winRateVsReference: providerId === REFERENCE_ARM ? null : winRate(ok, familyEntries, REFERENCE_ARM),
    vsHuman: {},
    strengths: [],
    weaknesses: [],
  };
}

const DELTA_KEYS = ["meanScore", "playabilityErrorsPerEntry", "idiomaticRegisterShare", "chordToneShare", "coverage", "barRepetitionShare", "contextClashShare"] as const;

/** Reads the deltas and ranks into one-line strengths and weaknesses. Thresholds stated in the strings. */
function annotate(card: ArmFamilyCard, human: ArmFamilyCard | undefined, machines: readonly ArmFamilyCard[]): void {
  if (human) {
    for (const key of DELTA_KEYS) {
      const a = card[key];
      const h = human[key];
      if (typeof a === "number" && typeof h === "number") card.vsHuman[key] = r4(a - h);
    }
  }
  if (card.providerId === HUMAN_ARM) return;
  const rank = (key: keyof ArmFamilyCard, lowerIsBetter = false): number | null => {
    const values = machines.map((m) => m[key]).filter((v): v is number => typeof v === "number");
    const mine = card[key];
    if (typeof mine !== "number" || values.length < 2) return null;
    const better = values.filter((v) => (lowerIsBetter ? v < mine : v > mine)).length;
    return better + 1;
  };
  const n = machines.length;
  const add = (list: string[], text: string) => { if (!list.includes(text)) list.push(text); };
  const scoreRank = rank("meanScore");
  if (scoreRank === 1 && n > 1) add(card.strengths, `highest proxy score among the ${n} machine arms (${card.meanScore})`);
  if (scoreRank === n && n > 1) add(card.weaknesses, `lowest proxy score among the ${n} machine arms (${card.meanScore})`);
  // Playability is read off the calibrated judge wherever the notes were
  // recoverable; the tournament's own number is judge 1.0 and carries its
  // false positives (PR-61).
  const errKey = card.playabilityErrorsCalibrated !== null ? "playabilityErrorsCalibrated" : "playabilityErrorsPerEntry";
  const errors = card[errKey] as number | null;
  const judged = errKey === "playabilityErrorsCalibrated" ? "calibrated judge" : "the tournament's judge 1.0";
  const errRank = rank(errKey, true);
  if (errors !== null && errors <= 0.1) add(card.strengths, `playable: ${errors} errors per entry (${judged})`);
  if (errors !== null && errors >= 0.5) add(card.weaknesses, `unplayable notes: ${errors} errors per entry (${judged})`);
  if (errRank === n && n > 1 && (errors ?? 0) > 0.1) add(card.weaknesses, `most playability errors of the ${n} machine arms`);
  if (card.idiomaticRegisterShare !== null && card.idiomaticRegisterShare >= 0.95) add(card.strengths, `idiomatic register: ${Math.round(card.idiomaticRegisterShare * 100)}% of notes inside the instrument's standard range`);
  if (card.idiomaticRegisterShare !== null && card.idiomaticRegisterShare < 0.85) add(card.weaknesses, `register: only ${Math.round(card.idiomaticRegisterShare * 100)}% of notes inside the instrument's standard range`);
  if (card.coverage !== null && card.coverage < 0.6) add(card.weaknesses, `thin: plays in ${Math.round(card.coverage * 100)}% of bars`);
  if (card.coverage !== null && card.coverage >= 0.85) add(card.strengths, `full: plays in ${Math.round(card.coverage * 100)}% of bars`);
  const dd = card.densityDistance;
  if (dd !== null && dd >= 1) add(card.weaknesses, `density ${dd.toFixed(2)} octave(s) from the human part (${(card.densityLogRatio ?? 0) > 0 ? "denser" : "sparser"})`);
  if (dd !== null && dd <= 0.35) add(card.strengths, `density within ${dd.toFixed(2)} octave(s) of the human part`);
  if (card.chordToneShare !== null && human?.chordToneShare != null && Math.abs(card.chordToneShare - human.chordToneShare) <= 0.1) add(card.strengths, `chord-tone share ${card.chordToneShare} ≈ human ${human.chordToneShare}`);
  if (card.chordToneShare !== null && card.chordToneShare >= 0.98) add(card.weaknesses, `chord tones only (${card.chordToneShare}): no passing or neighbour tones`);
  if (card.barRepetitionShare !== null && card.barRepetitionShare >= 0.5) add(card.weaknesses, `${Math.round(card.barRepetitionShare * 100)}% of bars repeat the previous bar verbatim`);
  if (card.contextClashShare !== null && card.contextClashShare >= 0.1) add(card.weaknesses, `${Math.round(card.contextClashShare * 100)}% of sounding time a semitone from the context`);
  if (card.contextClashShare !== null && card.contextClashShare <= 0.02) add(card.strengths, `clean against the context (${Math.round(card.contextClashShare * 100)}% clash)`);
  if (card.collapseRate !== null && card.collapseRate > 0) add(card.weaknesses, `repetition collapse in ${Math.round(card.collapseRate * 100)}% of entries`);
  if (card.winRateVsHuman !== null && card.winRateVsHuman >= 0.5) add(card.weaknesses, `out-scores the human on ${Math.round(card.winRateVsHuman * 100)}% of cells — distrust the judge here (judgeSuspect)`);
}

export function buildInstrumentScorecard(entries: readonly ScorecardEntry[], options: { sources?: string[] } = {}): InstrumentScorecard {
  const families = [...new Set(entries.map((e) => e.targetFamily))].sort();
  const arms = [...new Set(entries.map((e) => e.providerId))];
  const machineArms = arms.filter((a) => a !== HUMAN_ARM);
  const familyCards: FamilyCard[] = families.map((family) => {
    const fe = entries.filter((e) => e.targetFamily === family);
    const cards = arms.map((arm) => armCard(arm, fe.filter((e) => e.providerId === arm), fe));
    const human = cards.find((c) => c.providerId === HUMAN_ARM);
    const machines = cards.filter((c) => c.providerId !== HUMAN_ARM);
    for (const c of cards) annotate(c, human, machines);
    const ranked = machines.filter((c) => c.meanScore !== null).sort((a, b) => (b.meanScore ?? 0) - (a.meanScore ?? 0));
    const best = ranked[0];
    return {
      family,
      tasks: new Set(fe.map((e) => e.taskId)).size,
      programs: [...new Set(fe.map((e) => e.targetInst))].sort((a, b) => a - b),
      arms: cards,
      bestMachineArm: best ? { providerId: best.providerId, meanScore: best.meanScore ?? 0, marginOverNext: ranked[1] ? r2((best.meanScore ?? 0) - (ranked[1].meanScore ?? 0)) : null } : null,
    };
  });

  // Design reading: oracle router vs best single arm, families weighted equally.
  const armMeanOverFamilies: Record<string, number | null> = {};
  for (const arm of machineArms) {
    const v = mean(familyCards.map((f) => f.arms.find((c) => c.providerId === arm)?.meanScore ?? null));
    armMeanOverFamilies[arm] = v === null ? null : r2(v);
  }
  const singleBest = machineArms
    .filter((a) => armMeanOverFamilies[a] !== null)
    .sort((a, b) => (armMeanOverFamilies[b] ?? 0) - (armMeanOverFamilies[a] ?? 0))[0] ?? null;
  const oracle = mean(familyCards.map((f) => f.bestMachineArm?.meanScore ?? null));
  const familiesWhereBestDiffers = familyCards
    .filter((f) => f.bestMachineArm && singleBest && f.bestMachineArm.providerId !== singleBest)
    .map((f) => {
      const single = f.arms.find((c) => c.providerId === singleBest)?.meanScore ?? 0;
      return { family: f.family, bestArm: f.bestMachineArm!.providerId, bestScore: f.bestMachineArm!.meanScore, singleArmScore: single, gain: r2(f.bestMachineArm!.meanScore - single) };
    })
    // A tie is not a different best arm.
    .filter((f) => f.gain > 0);
  const errorsOf = (c: ArmFamilyCard | undefined): number | null =>
    c ? c.playabilityErrorsCalibrated ?? c.playabilityErrorsPerEntry : null;
  const errorsBy: Record<string, number | null> = {};
  for (const arm of machineArms) errorsBy[arm] = mean(familyCards.map((f) => errorsOf(f.arms.find((c) => c.providerId === arm))));
  const bestErrArm = machineArms.filter((a) => errorsBy[a] !== null).sort((a, b) => (errorsBy[a] ?? 0) - (errorsBy[b] ?? 0))[0] ?? null;
  const oracleErrors = mean(familyCards.map((f) => {
    const vals = f.arms.filter((c) => c.providerId !== HUMAN_ARM).map((c) => errorsOf(c)).filter((v): v is number => v !== null);
    return vals.length ? Math.min(...vals) : null;
  }));
  const minTasks = Math.min(...familyCards.map((f) => f.tasks));
  const caveats = [
    `${familyCards.length} families, ${minTasks}–${Math.max(...familyCards.map((f) => f.tasks))} tasks each: a per-family mean rests on ${minTasks * 3}–${Math.max(...familyCards.map((f) => f.tasks)) * 3} entries; differences of a few points are within task-to-task spread.`,
    "The proxy judge decides these numbers; the blind pairs are unrated. A family the judge misreads (see judge-calibration) misreads every arm alike, so the ranking within a family is steadier than the absolute level.",
    "The oracle router picks the best arm per family with hindsight on the same tasks — an upper bound on what expert adapters could add, not a measurement of any adapter.",
  ];
  return {
    version: INSTRUMENT_SCORECARD_VERSION,
    sources: options.sources ?? [],
    entries: entries.length,
    families: familyCards,
    design: {
      machineArms,
      armMeanOverFamilies,
      bestSingleArm: singleBest ? { providerId: singleBest, meanOverFamilies: armMeanOverFamilies[singleBest] ?? 0 } : null,
      oraclePerFamilyMean: oracle === null ? null : r2(oracle),
      routerGainPoints: oracle === null || !singleBest ? null : r2(oracle - (armMeanOverFamilies[singleBest] ?? 0)),
      familiesWhereBestDiffers,
      playability: {
        bestSingleArm: bestErrArm,
        singleArmErrors: bestErrArm ? r2(errorsBy[bestErrArm] ?? 0) : null,
        oracleErrors: oracleErrors === null ? null : r2(oracleErrors),
        routerGainErrors: bestErrArm && oracleErrors !== null ? r2((errorsBy[bestErrArm] ?? 0) - oracleErrors) : null,
      },
      caveats,
    },
  };
}

/** Markdown table of the scorecard, family by family. */
export function renderInstrumentScorecard(card: InstrumentScorecard): string {
  const lines: string[] = [];
  const fmt = (v: number | null | undefined, digits = 2): string => (v === null || v === undefined ? "—" : v.toFixed(digits));
  for (const f of card.families) {
    lines.push(`### ${f.family} — ${f.tasks} task(s), GM ${f.programs.join(", ")}`);
    lines.push("");
    lines.push("| arm | n | score | play.err (1.0) | play.err (calibrated) | playable range | idiomatic register | chord-tone | coverage | density Δ (log2) | repetition | clash | wins vs human | wins vs ref |");
    lines.push("| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |");
    for (const a of f.arms) {
      lines.push(`| ${a.providerId} | ${a.entries} | ${fmt(a.meanScore, 1)} | ${fmt(a.playabilityErrorsPerEntry)} | ${fmt(a.playabilityErrorsCalibrated)} | ${fmt(a.playableRangeShare)} | ${fmt(a.idiomaticRegisterShare)} | ${fmt(a.chordToneShare)} | ${fmt(a.coverage)} | ${fmt(a.densityLogRatio)} | ${fmt(a.barRepetitionShare)} | ${fmt(a.contextClashShare)} | ${a.winRateVsHuman === null ? "—" : `${Math.round(a.winRateVsHuman * 100)} %`} | ${a.winRateVsReference === null ? "—" : `${Math.round(a.winRateVsReference * 100)} %`} |`);
    }
    lines.push("");
    for (const a of f.arms.filter((c) => c.providerId !== HUMAN_ARM)) {
      lines.push(`- **${a.providerId}** — strong: ${a.strengths.length ? a.strengths.join("; ") : "nothing stands out"}. Weak: ${a.weaknesses.length ? a.weaknesses.join("; ") : "nothing stands out"}.`);
    }
    lines.push("");
  }
  return lines.join("\n");
}
