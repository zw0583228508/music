/**
 * Model tournament (Wave Q — Model Discovery, items 13–15 and 25).
 *
 * Every provider answers every task with every seed; every answer is judged
 * by the same `judgePart`; the result is a scorecard per provider, a blind
 * sheet for the Listening Room, and a recommendation that is deliberately
 * limited to two values — **do not promote** or **run the blind evaluation**.
 * Nothing here promotes a model: the judge is a proxy and the plan's rule is
 * that a listener decides.
 *
 * Two honesty devices are built in:
 *
 *  - `HUMAN_ORIGIN_REFERENCE` is an arm. When a machine out-scores the human
 *    part on a task, that task is listed under `judgeSuspect`, and a
 *    recommendation is never made on suspect tasks alone.
 *  - Failures are entries, scored zero, never dropped. A model that fails one
 *    task in five is a model that fails one task in five.
 */
import { createHash } from "node:crypto";
import type { MusicalNote } from "@workspace/db";
import { judgePart, type PartJudgement } from "./partJudge";
import type { ProviderAccount } from "./symbolicGenerationProvider";
import { HUMAN_SUT, REFERENCE_SUT, type TournamentProvider } from "./tournamentProviders";
import type { TournamentTask } from "./tournamentTask";

export const MODEL_TOURNAMENT_VERSION = "1.0" as const;
const METHOD = "model-tournament/v1";

export type TournamentEntry = {
  key: string;
  taskId: string;
  workId: string;
  targetFamily: string;
  targetInst: number;
  providerId: string;
  seed: number;
  judgement: PartJudgement;
  inferenceSeconds: number | null;
  failure: string | null;
  account: ProviderAccount | null;
  notes: MusicalNote[];
};

export type ProviderScorecard = {
  providerId: string;
  kind: TournamentProvider["kind"];
  entries: number;
  failures: number;
  meanScore: number | null;
  medianScore: number | null;
  meanPlayabilityErrors: number | null;
  meanChordToneShare: number | null;
  meanCoverage: number | null;
  collapseRate: number | null;
  meanInferenceSeconds: number | null;
  /** Share of (task, seed) cells where this provider out-scores the reference. */
  winRateVsReference: number | null;
  winRateVsHuman: number | null;
};

export type TournamentBlindPair = {
  pairId: string;
  taskId: string;
  seed: number;
  left: { token: string; entryKey: string };
  right: { token: string; entryKey: string };
  questions: string[];
};

export type TournamentRecommendation = {
  providerId: string;
  action: "do_not_promote" | "run_blind_evaluation";
  reason: string;
};

export type TournamentReport = {
  version: typeof MODEL_TOURNAMENT_VERSION;
  method: string;
  runId: string;
  ranAt: string;
  corpus: "pdmx" | "synthesised";
  seeds: number[];
  tasks: Array<{
    id: string; workId: string; targetFamily: string; targetInst: number;
    barStart: number; barEnd: number; tempoBpm: number; meter: string;
    contextFamilies: string[]; humanNotes: number; chordCoverage: number; limits: string[];
  }>;
  entries: TournamentEntry[];
  scorecards: ProviderScorecard[];
  /** Tasks on which some machine out-scored the human part — distrust the judge there. */
  judgeSuspect: Array<{ taskId: string; seed: number; providerId: string; machine: number; human: number }>;
  recommendations: TournamentRecommendation[];
  blindSheet: { pairs: TournamentBlindPair[]; keyByToken: Record<string, string> };
  honestLimits: string[];
};

export const TOURNAMENT_BLIND_QUESTIONS = [
  "Which part sounds like a professional wrote it?",
  "Which part fits the other instruments better?",
  "Which part would you keep in the arrangement?",
] as const;

const mean = (values: number[]): number | null =>
  values.length ? Number((values.reduce((a, b) => a + b, 0) / values.length).toFixed(2)) : null;
const median = (values: number[]): number | null => {
  if (!values.length) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = sorted.length >> 1;
  return Number((sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2).toFixed(2));
};
const notNull = (v: number | null): v is number => v !== null;

export function scorecardFor(providerId: string, kind: TournamentProvider["kind"], entries: readonly TournamentEntry[]): ProviderScorecard {
  const mine = entries.filter((e) => e.providerId === providerId);
  const ok = mine.filter((e) => !e.failure);
  const cell = (e: TournamentEntry) => `${e.taskId}:${e.seed}`;
  const against = (other: string): number | null => {
    const theirs = new Map(entries.filter((e) => e.providerId === other).map((e) => [cell(e), e.judgement.score]));
    const comparable = mine.filter((e) => theirs.has(cell(e)));
    if (!comparable.length) return null;
    return Number((comparable.filter((e) => e.judgement.score > (theirs.get(cell(e)) ?? 0)).length / comparable.length).toFixed(4));
  };
  return {
    providerId,
    kind,
    entries: mine.length,
    failures: mine.length - ok.length,
    meanScore: mean(mine.map((e) => e.judgement.score)),
    medianScore: median(mine.map((e) => e.judgement.score)),
    meanPlayabilityErrors: mean(ok.map((e) => e.judgement.metrics.playabilityErrors)),
    meanChordToneShare: mean(ok.map((e) => e.judgement.metrics.chordToneShare).filter(notNull)),
    meanCoverage: mean(ok.map((e) => e.judgement.metrics.coverage)),
    collapseRate: ok.length ? Number((ok.filter((e) => e.judgement.metrics.singlePitch).length / ok.length).toFixed(4)) : null,
    meanInferenceSeconds: mean(ok.map((e) => e.inferenceSeconds).filter(notNull)),
    winRateVsReference: providerId === REFERENCE_SUT ? null : against(REFERENCE_SUT),
    winRateVsHuman: providerId === HUMAN_SUT ? null : against(HUMAN_SUT),
  };
}

/** Pairs every non-human, non-reference provider against the reference and against the human, per (task, seed). */
export function buildTournamentBlindSheet(entries: readonly TournamentEntry[]): TournamentReport["blindSheet"] {
  const pairs: TournamentBlindPair[] = [];
  const keyByToken: Record<string, string> = {};
  const byCell = new Map<string, TournamentEntry[]>();
  for (const e of entries) {
    if (e.failure || !e.notes.length) continue;
    const k = `${e.taskId}:${e.seed}`;
    byCell.set(k, [...(byCell.get(k) ?? []), e]);
  }
  for (const [, cellEntries] of [...byCell.entries()].sort(([a], [b]) => a.localeCompare(b))) {
    const anchors = cellEntries.filter((e) => e.providerId === REFERENCE_SUT || e.providerId === HUMAN_SUT);
    const challengers = cellEntries.filter((e) => e.providerId !== REFERENCE_SUT && e.providerId !== HUMAN_SUT);
    for (const anchor of anchors) {
      for (const challenger of challengers) {
        const pairId = createHash("sha256").update(`${anchor.key}|${challenger.key}`).digest("hex").slice(0, 12);
        // Side order from the hash, so the reference is not always on the left.
        const anchorLeft = parseInt(pairId.slice(0, 2), 16) % 2 === 0;
        const [left, right] = anchorLeft ? [anchor, challenger] : [challenger, anchor];
        const leftToken = createHash("sha256").update(`${pairId}:L`).digest("hex").slice(0, 8);
        const rightToken = createHash("sha256").update(`${pairId}:R`).digest("hex").slice(0, 8);
        keyByToken[leftToken] = left.providerId;
        keyByToken[rightToken] = right.providerId;
        pairs.push({
          pairId, taskId: anchor.taskId, seed: anchor.seed,
          left: { token: leftToken, entryKey: left.key },
          right: { token: rightToken, entryKey: right.key },
          questions: [...TOURNAMENT_BLIND_QUESTIONS],
        });
      }
    }
  }
  return { pairs, keyByToken };
}

/** The two-valued verdict per model provider. Never "promote". */
export function recommend(scorecards: readonly ProviderScorecard[], judgeSuspectCount: number, cells: number): TournamentRecommendation[] {
  const reference = scorecards.find((s) => s.providerId === REFERENCE_SUT);
  return scorecards
    .filter((s) => s.kind === "model")
    .map((s) => {
      const failureShare = s.entries ? s.failures / s.entries : 1;
      if (failureShare > 0.2) {
        return { providerId: s.providerId, action: "do_not_promote" as const, reason: `${s.failures} of ${s.entries} entries failed (${Math.round(failureShare * 100)}%); a provider that fails one task in five is not a candidate for routing.` };
      }
      if (s.collapseRate !== null && s.collapseRate > 0.1) {
        return { providerId: s.providerId, action: "do_not_promote" as const, reason: `repetition collapse on ${Math.round(s.collapseRate * 100)}% of outputs; a retry loop belongs in the worker before any listener hears it.` };
      }
      const wins = s.winRateVsReference ?? 0;
      const morePlayabilityErrors = reference && s.meanPlayabilityErrors !== null && reference.meanPlayabilityErrors !== null
        && s.meanPlayabilityErrors > reference.meanPlayabilityErrors;
      if (wins >= 0.6 && !morePlayabilityErrors) {
        const suspect = cells ? judgeSuspectCount / cells : 0;
        return {
          providerId: s.providerId,
          action: "run_blind_evaluation" as const,
          reason: `out-scores ${REFERENCE_SUT} on ${Math.round(wins * 100)}% of (task, seed) cells with no more playability errors${suspect > 0.25 ? `; note the judge ranked a machine above the human on ${Math.round(suspect * 100)}% of cells, so weigh the proxy lightly` : ""}. The critic is a proxy; the Listening Room decides.`,
        };
      }
      return {
        providerId: s.providerId,
        action: "do_not_promote" as const,
        reason: `out-scores ${REFERENCE_SUT} on ${Math.round(wins * 100)}% of cells${morePlayabilityErrors ? " and makes more playability errors" : ""}; not measurably better on the proxy, so there is nothing to send to a listener yet.`,
      };
    });
}

export async function runModelTournament(options: {
  tasks: TournamentTask[];
  providers: TournamentProvider[];
  seeds?: number[];
  corpus?: "pdmx" | "synthesised";
  now?: Date;
  onEntry?: (entry: TournamentEntry, done: number, total: number) => void;
}): Promise<TournamentReport> {
  const seeds = options.seeds ?? [7, 11, 13];
  const now = options.now ?? new Date();
  const entries: TournamentEntry[] = [];
  const total = options.tasks.length * seeds.length * options.providers.length;

  for (const task of options.tasks) {
    for (const seed of seeds) {
      for (const provider of options.providers) {
        let result: Awaited<ReturnType<TournamentProvider["generate"]>>;
        try {
          result = await provider.generate(task, seed);
        } catch (error) {
          result = { notes: [], account: null, inferenceSeconds: null, failure: error instanceof Error ? error.message : String(error) };
        }
        const judgement = judgePart(task, result.failure ? [] : result.notes);
        if (result.failure) judgement.findings.unshift(`provider failed: ${result.failure}`);
        const entry: TournamentEntry = {
          key: `${task.id}:${seed}:${provider.id}`,
          taskId: task.id,
          workId: task.workId,
          targetFamily: task.targetFamily,
          targetInst: task.targetInst,
          providerId: provider.id,
          seed,
          judgement,
          inferenceSeconds: result.inferenceSeconds === null ? null : Number(result.inferenceSeconds.toFixed(2)),
          failure: result.failure,
          account: result.account,
          notes: result.notes,
        };
        entries.push(entry);
        options.onEntry?.(entry, entries.length, total);
      }
    }
  }

  const scorecards = options.providers.map((p) => scorecardFor(p.id, p.kind, entries));
  const humanByCell = new Map(entries.filter((e) => e.providerId === HUMAN_SUT).map((e) => [`${e.taskId}:${e.seed}`, e.judgement.score]));
  const judgeSuspect = entries
    .filter((e) => e.providerId !== HUMAN_SUT && !e.failure)
    .filter((e) => (humanByCell.get(`${e.taskId}:${e.seed}`) ?? Infinity) < e.judgement.score)
    .map((e) => ({ taskId: e.taskId, seed: e.seed, providerId: e.providerId, machine: e.judgement.score, human: humanByCell.get(`${e.taskId}:${e.seed}`)! }));
  const cells = options.tasks.length * seeds.length;

  return {
    version: MODEL_TOURNAMENT_VERSION,
    method: METHOD,
    runId: createHash("sha256")
      .update(`${options.tasks.map((t) => t.id).join(",")}|${seeds.join(",")}|${options.providers.map((p) => p.id).join(",")}`)
      .digest("hex").slice(0, 12),
    ranAt: now.toISOString(),
    corpus: options.corpus ?? "pdmx",
    seeds,
    tasks: options.tasks.map((t) => ({
      id: t.id, workId: t.workId, targetFamily: t.targetFamily, targetInst: t.targetInst,
      barStart: t.barStart, barEnd: t.barEnd, tempoBpm: t.tempoBpm, meter: `${t.meter.numerator}/${t.meter.denominator}`,
      contextFamilies: [...new Set(t.contextTracks.map((c) => c.family))], humanNotes: t.humanTarget.length,
      chordCoverage: t.chordCoverage.share, limits: t.limits,
    })),
    entries,
    scorecards,
    judgeSuspect,
    recommendations: recommend(scorecards, new Set(judgeSuspect.map((s) => `${s.taskId}:${s.seed}`)).size, cells),
    blindSheet: buildTournamentBlindSheet(entries),
    honestLimits: [
      "The judge is a proxy (playability, range, chord tones, coverage, density, repetition, interval shape, clashes). It is not a listener; the blind sheet is the test that decides.",
      "The human part is an anchor for density and interval shape, not an answer key; a good arrangement of these bars is not unique.",
      "Chords are estimated from the context notes, identically for every provider; on bars the estimator left blank no harmony metric is taken.",
      "Seconds follow the file's first tempo and first time signature; tasks whose files carry more are listed with that limit.",
    ],
  };
}
