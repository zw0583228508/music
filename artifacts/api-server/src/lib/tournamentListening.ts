/**
 * Tournament pairs into the Listening Room (Wave Q — Workstream A, PR-68).
 *
 * The tournament writes 200+ blind pairs; a human cannot rate 200 in one
 * sitting, and a session that is all one comparison type answers one
 * question only. This module turns a tournament report into a **balanced,
 * stratified session of 40–60 pairs** across the five comparisons the owner
 * asked for, spread over instrument families and tasks, with the A/B
 * orientation decided by hash — so a rater never learns which arm is which
 * from position, seed, or family.
 *
 * What the rater sees: "Part 12 of 50 · bass", two players, one primary
 * question ("Overall: which version do you prefer?") and optional secondary
 * ratings. Nothing here names a model, a human, a baseline, a seed or an
 * incumbent; that key lives in the session's owner-only columns.
 *
 * Every vote is stored with enough structure (pair → entry keys → task, seed,
 * provider) to become a preference record for `MUSIC_REWARD_MODEL_V1` later —
 * see `preferenceRecords`.
 */
import { createHash } from "node:crypto";
import type { BlindListeningPair } from "@workspace/db";
import { CA2_CONTEXT_SUT, CA2_SUT, CONTEXT_AWARE_SUT, HUMAN_SUT, REFERENCE_SUT } from "./tournamentProviders";

export const TOURNAMENT_LISTENING_VERSION = "1.0" as const;

export const TOURNAMENT_PRIMARY_QUESTION = "Overall: which version do you prefer?";
export const TOURNAMENT_SECONDARY_QUESTIONS = [
  "Which is more musical?",
  "Which sounds like a professional arrangement?",
  "Which has the better harmony?",
  "Which sounds more natural for the instrument?",
  "Which is more interesting?",
  "Which is more coherent?",
  "Which is more original?",
  "Which fits the other parts better?",
] as const;

/** The five comparisons the owner asked for, in the order they are drawn. */
export const COMPARISON_TYPES = [
  { id: "human_vs_ca2ctx", a: HUMAN_SUT, b: CA2_CONTEXT_SUT },
  { id: "ca2ctx_vs_reference", a: CA2_CONTEXT_SUT, b: REFERENCE_SUT },
  { id: "ca2raw_vs_ca2ctx", a: CA2_SUT, b: CA2_CONTEXT_SUT },
  { id: "human_vs_reference", a: HUMAN_SUT, b: REFERENCE_SUT },
  { id: "contextaware_vs_ca2ctx", a: CONTEXT_AWARE_SUT, b: CA2_CONTEXT_SUT },
] as const;

export type ComparisonType = (typeof COMPARISON_TYPES)[number];

/** The subset of a tournament report entry this module reads. */
export type TournamentEntryLike = {
  key: string;
  taskId: string;
  seed: number;
  targetFamily: string;
  providerId: string;
  failure: string | null;
  midi: string | null;
  judgement: { metrics: { noteCount: number } };
};

export type TournamentReportLike = {
  runId: string;
  seeds: number[];
  tasks: Array<{ id: string; targetFamily: string; targetInst: number }>;
  entries: TournamentEntryLike[];
};

export type SelectedSide = { entryKey: string; providerId: string; midi: string };
export type SelectedPair = {
  comparison: string;
  taskId: string;
  seed: number;
  family: string;
  left: SelectedSide;
  right: SelectedSide;
};

const digest = (seed: string) => createHash("sha256").update(seed).digest("hex");
const token = (seed: string) => digest(seed).slice(0, 8);

/**
 * Draw a balanced session. `size` pairs are split as evenly as possible over
 * the comparison types; within a type, cells are taken round-robin over
 * families and tasks, rotating seeds, so no family or task dominates.
 * `isDistinct(a, b)` lets the caller refuse a pair whose two sides render
 * identically (e.g. CA2 raw and CA2+CTX when the passes changed nothing).
 * Deterministic for a given report and `salt`.
 */
export function selectTournamentPairs(
  report: TournamentReportLike,
  options: { size?: number; salt?: string; isDistinct?: (a: SelectedSide, b: SelectedSide) => boolean } = {},
): { pairs: SelectedPair[]; perComparison: Array<{ id: string; a: string; b: string; pairs: number }>; skipped: string[] } {
  const size = Math.max(1, Math.min(60, options.size ?? 50));
  const salt = options.salt ?? report.runId;
  const isDistinct = options.isDistinct ?? (() => true);
  const usable = new Map<string, TournamentEntryLike>();
  for (const e of report.entries) {
    if (e.failure || !e.midi || e.judgement.metrics.noteCount <= 0) continue;
    usable.set(`${e.taskId}:${e.seed}:${e.providerId}`, e);
  }
  const families = [...new Set(report.tasks.map((t) => t.targetFamily))].sort();
  const tasksByFamily = new Map(families.map((f) => [f, report.tasks.filter((t) => t.targetFamily === f).map((t) => t.id).sort()]));
  const skipped: string[] = [];
  const chosen: SelectedPair[] = [];
  const usedCells = new Set<string>();

  const perType = COMPARISON_TYPES.map((type, index) => ({
    type,
    quota: Math.floor(size / COMPARISON_TYPES.length) + (index < size % COMPARISON_TYPES.length ? 1 : 0),
  }));

  for (const { type, quota } of perType) {
    // Candidate cells for this type, ordered family-round-robin, task-round-robin, seed-rotated.
    const cells: Array<{ taskId: string; seed: number; family: string }> = [];
    const maxTasks = Math.max(0, ...families.map((f) => tasksByFamily.get(f)!.length));
    for (let round = 0; round < maxTasks; round += 1) {
      for (const family of families) {
        const taskIds = tasksByFamily.get(family)!;
        const taskId = taskIds[round % taskIds.length];
        if (round >= taskIds.length) continue;
        for (let s = 0; s < report.seeds.length; s += 1) {
          // Rotate which seed comes first per (type, family) so seeds spread across the session.
          const seedIndex = (s + round + parseInt(digest(`${salt}:${type.id}:${family}`).slice(0, 2), 16)) % report.seeds.length;
          cells.push({ taskId, seed: report.seeds[seedIndex], family });
        }
      }
    }
    // Pass 1: one seed per task; pass 2+: further seeds only if the quota is still open.
    let taken = 0;
    for (let pass = 0; pass < report.seeds.length && taken < quota; pass += 1) {
      const seenTask = new Set<string>();
      for (const cell of cells) {
        if (taken >= quota) break;
        const cellKey = `${type.id}:${cell.taskId}:${cell.seed}`;
        if (usedCells.has(cellKey)) continue;
        if (pass === 0 && seenTask.has(cell.taskId)) continue;
        const a = usable.get(`${cell.taskId}:${cell.seed}:${type.a}`);
        const b = usable.get(`${cell.taskId}:${cell.seed}:${type.b}`);
        if (!a || !b) { skipped.push(`${cellKey}: a side is missing`); continue; }
        const sideA: SelectedSide = { entryKey: a.key, providerId: a.providerId, midi: a.midi! };
        const sideB: SelectedSide = { entryKey: b.key, providerId: b.providerId, midi: b.midi! };
        if (!isDistinct(sideA, sideB)) { skipped.push(`${cellKey}: both sides identical`); usedCells.add(cellKey); continue; }
        // Orientation by hash: the "a" arm of a comparison is not always on the left.
        const flip = parseInt(digest(`${salt}:${cellKey}:orientation`).slice(0, 2), 16) % 2 === 1;
        chosen.push({
          comparison: type.id, taskId: cell.taskId, seed: cell.seed, family: cell.family,
          left: flip ? sideB : sideA,
          right: flip ? sideA : sideB,
        });
        usedCells.add(cellKey);
        seenTask.add(cell.taskId);
        taken += 1;
      }
    }
  }

  // Shuffle the session order by hash so comparison types are interleaved, not blocked.
  chosen.sort((x, y) => digest(`${salt}:${x.comparison}:${x.taskId}:${x.seed}`).localeCompare(digest(`${salt}:${y.comparison}:${y.taskId}:${y.seed}`)));
  const perComparison = COMPARISON_TYPES.map((type) => ({ id: type.id, a: type.a, b: type.b, pairs: chosen.filter((p) => p.comparison === type.id).length }));
  return { pairs: chosen, perComparison, skipped };
}

/** The session's pair records, tokens and keys. Tokens follow the benchmark scheme. */
export function buildTournamentListeningPairs(
  sessionId: string,
  selected: readonly SelectedPair[],
): { pairs: BlindListeningPair[]; keyBySide: Record<string, string>; entryByToken: Record<string, string> } {
  const keyBySide: Record<string, string> = {};
  const entryByToken: Record<string, string> = {};
  const pairs = selected.map((pair, index) => {
    const pairId = `${sessionId}:${index + 1}`;
    const left = token(`${pairId}:L`);
    const right = token(`${pairId}:R`);
    keyBySide[left] = pair.left.providerId;
    keyBySide[right] = pair.right.providerId;
    entryByToken[left] = pair.left.entryKey;
    entryByToken[right] = pair.right.entryKey;
    return {
      pairId,
      // Shown to the rater: position and instrument family, nothing about the arms.
      caseId: `Part ${index + 1} of ${selected.length} · ${pair.family}`,
      left: { token: left, systemUnderTest: pair.left.providerId },
      right: { token: right, systemUnderTest: pair.right.providerId },
      questions: [TOURNAMENT_PRIMARY_QUESTION, ...TOURNAMENT_SECONDARY_QUESTIONS],
      meta: { comparison: pair.comparison, taskId: pair.taskId, seed: pair.seed, family: pair.family },
    } satisfies BlindListeningPair;
  });
  return { pairs, keyBySide, entryByToken };
}

export type PreferenceRecord = {
  version: typeof TOURNAMENT_LISTENING_VERSION;
  sessionId: string;
  pairId: string;
  comparison: string;
  taskId: string;
  seed: number;
  family: string;
  question: string;
  /** In the comparison's own order (a, b), independent of what the rater saw as A/B. */
  providerA: string;
  providerB: string;
  entryA: string;
  entryB: string;
  winner: string;
  loser: string;
  /** Salted hash of the rater id — a stable pseudonym, never the id itself. */
  rater: string;
  isOwner: boolean;
  createdAt: string;
};

/**
 * Votes as preference records for the reward model. One record per vote,
 * with the two arms named in comparison order and the winner named — the
 * shape a pairwise preference loss consumes directly.
 */
export function preferenceRecords(
  session: { id: string; pairs: BlindListeningPair[]; keyBySide: Record<string, string>; sides: { tournament?: { entryByToken: Record<string, string> } } },
  votes: ReadonlyArray<{ pairId: string; question: string; winnerToken: string; raterId: string; isOwner: boolean; createdAt: Date }>,
  raterSalt: string,
): PreferenceRecord[] {
  const pairs = new Map(session.pairs.map((p) => [p.pairId, p]));
  const entryByToken = session.sides.tournament?.entryByToken ?? {};
  const out: PreferenceRecord[] = [];
  for (const vote of votes) {
    const pair = pairs.get(vote.pairId);
    if (!pair?.meta) continue;
    const type = COMPARISON_TYPES.find((t) => t.id === pair.meta!.comparison);
    if (!type) continue;
    const sides = [pair.left, pair.right];
    const sideA = sides.find((s) => s.systemUnderTest === type.a);
    const sideB = sides.find((s) => s.systemUnderTest === type.b);
    if (!sideA || !sideB) continue;
    const winner = session.keyBySide[vote.winnerToken];
    if (!winner) continue;
    out.push({
      version: TOURNAMENT_LISTENING_VERSION,
      sessionId: session.id,
      pairId: vote.pairId,
      comparison: pair.meta.comparison,
      taskId: pair.meta.taskId,
      seed: pair.meta.seed,
      family: pair.meta.family,
      question: vote.question,
      providerA: type.a,
      providerB: type.b,
      entryA: entryByToken[sideA.token] ?? "",
      entryB: entryByToken[sideB.token] ?? "",
      winner,
      loser: winner === type.a ? type.b : type.a,
      rater: digest(`${raterSalt}:${vote.raterId}`).slice(0, 16),
      isOwner: vote.isOwner,
      createdAt: vote.createdAt.toISOString(),
    });
  }
  return out;
}

export type ComparisonSummary = {
  comparison: string;
  a: string;
  b: string;
  pairs: number;
  /** Primary-question votes from independent raters. */
  votes: number;
  aWins: number;
  bWins: number;
  aShare: number | null;
  /** The owner's own primary-question votes, kept apart: the owner is the first rater, not the verdict. */
  ownerVotes: number;
  ownerAWins: number;
  ownerAShare: number | null;
};

/** Per-comparison tallies on the primary question, independent raters and the owner apart. */
export function summariseComparisons(
  session: { pairs: BlindListeningPair[]; keyBySide: Record<string, string> },
  votes: ReadonlyArray<{ pairId: string; question: string; winnerToken: string; isOwner: boolean }>,
  primaryQuestion: string,
): ComparisonSummary[] {
  const pairs = new Map(session.pairs.map((p) => [p.pairId, p]));
  return COMPARISON_TYPES.map((type) => {
    const mine = votes.filter((v) => v.question === primaryQuestion && pairs.get(v.pairId)?.meta?.comparison === type.id);
    const winsFor = (subset: typeof mine, arm: string) => subset.filter((v) => session.keyBySide[v.winnerToken] === arm).length;
    const independent = mine.filter((v) => !v.isOwner);
    const owner = mine.filter((v) => v.isOwner);
    const share = (wins: number, total: number) => (total ? Number((wins / total).toFixed(4)) : null);
    return {
      comparison: type.id,
      a: type.a,
      b: type.b,
      pairs: session.pairs.filter((p) => p.meta?.comparison === type.id).length,
      votes: independent.length,
      aWins: winsFor(independent, type.a),
      bWins: winsFor(independent, type.b),
      aShare: share(winsFor(independent, type.a), independent.length),
      ownerVotes: owner.length,
      ownerAWins: winsFor(owner, type.a),
      ownerAShare: share(winsFor(owner, type.a), owner.length),
    };
  });
}
