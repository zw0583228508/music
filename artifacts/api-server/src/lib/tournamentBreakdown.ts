/**
 * Slicing a tournament report (Wave Q — Model Discovery, global tournament).
 *
 * The scorecards answer "which arm" over the whole run. A run that spans genre
 * families and instrument families also has to answer "which arm, *where*":
 * a model that wins pop bass and loses jazz reeds is not described by one
 * mean. This slices the entries by any task attribute and recomputes the same
 * quantities the scorecards use — mean score, playability errors, coverage,
 * win rate against the reference and the human — per (slice, arm).
 *
 * Pure functions over the report's `tasks` and `entries`; nothing is re-judged.
 */
import type { TournamentEntry, TournamentReport } from "./modelTournament";
import { HUMAN_SUT, REFERENCE_SUT } from "./tournamentProviders";

export type SliceKey = "genre" | "targetFamily" | "genre×targetFamily";

export type SliceCard = {
  slice: string;
  providerId: string;
  tasks: number;
  entries: number;
  failures: number;
  meanScore: number | null;
  meanPlayabilityErrors: number | null;
  meanCoverage: number | null;
  meanChordToneShare: number | null;
  winRateVsReference: number | null;
  winRateVsHuman: number | null;
};

type ReportSlice = Pick<TournamentReport, "tasks"> & { entries: ReadonlyArray<Pick<TournamentEntry, "taskId" | "providerId" | "seed" | "failure" | "judgement">> };

const mean = (values: number[]): number | null =>
  values.length ? Number((values.reduce((a, b) => a + b, 0) / values.length).toFixed(2)) : null;
const notNull = (v: number | null): v is number => v !== null;

/** The slice label of one task summary. */
export function sliceOf(task: TournamentReport["tasks"][number], key: SliceKey): string {
  const genre = task.genre ?? "unlabelled";
  if (key === "genre") return genre;
  if (key === "targetFamily") return task.targetFamily;
  return `${genre}×${task.targetFamily}`;
}

/** One card per (slice, provider), slices in first-seen task order, providers in first-seen entry order. */
export function breakdown(report: ReportSlice, key: SliceKey): SliceCard[] {
  const sliceByTask = new Map(report.tasks.map((t) => [t.id, sliceOf(t, key)]));
  const providers = [...new Set(report.entries.map((e) => e.providerId))];
  const slices = [...new Set(report.tasks.map((t) => sliceOf(t, key)))];
  const cell = (e: { taskId: string; seed: number }) => `${e.taskId}:${e.seed}`;
  const cards: SliceCard[] = [];
  for (const slice of slices) {
    const inSlice = report.entries.filter((e) => sliceByTask.get(e.taskId) === slice);
    const reference = new Map(inSlice.filter((e) => e.providerId === REFERENCE_SUT).map((e) => [cell(e), e.judgement.score]));
    const human = new Map(inSlice.filter((e) => e.providerId === HUMAN_SUT).map((e) => [cell(e), e.judgement.score]));
    const against = (mine: typeof inSlice, theirs: Map<string, number>): number | null => {
      const comparable = mine.filter((e) => theirs.has(cell(e)));
      if (!comparable.length) return null;
      return Number((comparable.filter((e) => e.judgement.score > (theirs.get(cell(e)) ?? 0)).length / comparable.length).toFixed(4));
    };
    for (const providerId of providers) {
      const mine = inSlice.filter((e) => e.providerId === providerId);
      if (!mine.length) continue;
      const ok = mine.filter((e) => !e.failure);
      cards.push({
        slice,
        providerId,
        tasks: new Set(mine.map((e) => e.taskId)).size,
        entries: mine.length,
        failures: mine.length - ok.length,
        meanScore: mean(mine.map((e) => e.judgement.score)),
        meanPlayabilityErrors: mean(ok.map((e) => e.judgement.metrics.playabilityErrors)),
        meanCoverage: mean(ok.map((e) => e.judgement.metrics.coverage)),
        meanChordToneShare: mean(ok.map((e) => e.judgement.metrics.chordToneShare).filter(notNull)),
        winRateVsReference: providerId === REFERENCE_SUT ? null : against(mine, reference),
        winRateVsHuman: providerId === HUMAN_SUT ? null : against(mine, human),
      });
    }
  }
  return cards;
}

/** Cards as a slice → provider → card table, for a report or a doc. */
export function breakdownTable(cards: readonly SliceCard[]): Record<string, Record<string, SliceCard>> {
  const table: Record<string, Record<string, SliceCard>> = {};
  for (const card of cards) {
    table[card.slice] = table[card.slice] ?? {};
    table[card.slice][card.providerId] = card;
  }
  return table;
}

/**
 * The arm with the highest mean score per slice, excluding the human anchor,
 * with the margin over the runner-up. A slice with one arm has no margin.
 */
export function winnerPerSlice(cards: readonly SliceCard[]): Array<{ slice: string; winner: string; meanScore: number; margin: number | null }> {
  const table = breakdownTable(cards);
  return Object.entries(table).map(([slice, byProvider]) => {
    const ranked = Object.values(byProvider)
      .filter((c) => c.providerId !== HUMAN_SUT && c.meanScore !== null)
      .sort((a, b) => (b.meanScore ?? 0) - (a.meanScore ?? 0));
    const winner = ranked[0];
    const runnerUp = ranked[1];
    return {
      slice,
      winner: winner?.providerId ?? "(none)",
      meanScore: winner?.meanScore ?? 0,
      margin: winner && runnerUp ? Number(((winner.meanScore ?? 0) - (runnerUp.meanScore ?? 0)).toFixed(2)) : null,
    };
  });
}
