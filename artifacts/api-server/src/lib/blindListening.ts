/**
 * Listening room (Gate C, PR-34).
 *
 * The plan's central KPI is how often the new Arrangement Brain beats the
 * previous one in *blind* musical evaluation, and until now nobody could
 * listen: the blind sheet existed as an API over benchmark case ids, with no
 * audio and no vote. A listening session takes two generation candidates of
 * the same song (each standing for a system under test — the ranked winner vs
 * the first candidate, the brain with a brief vs without, V1 vs V2
 * performance, reference vs YOUR_ARRANGER_MODEL), serves their existing
 * evaluation renders as anonymised A/B with the PR-18 questions, records
 * votes, and computes Elo (PR-18) and an explicit Gate C verdict.
 *
 * Pure: the routes own persistence. Token scheme identical to the benchmark's
 * sheet so a session's votes and a benchmark sheet's votes feed the same Elo.
 */
import { createHash } from "node:crypto";
import type { BlindListeningPair, BlindListeningSides } from "@workspace/db";
import { BLIND_QUESTIONS, updateEloRatings, type BlindVote, type EloRating } from "./arrangementBenchmark";
import { summariseComparisons, type ComparisonSummary } from "./tournamentListening";

export const LISTENING_ROOM_VERSION = "1.0" as const;
/** Gate C is a human verdict; below this many independent raters it is an anecdote. */
export const GATE_C_MIN_RATERS = 5;
/** The challenger must take at least this share of the "which would you release?" votes. */
export const GATE_C_MIN_WIN_SHARE = 0.6;
export const RELEASE_QUESTION = BLIND_QUESTIONS[BLIND_QUESTIONS.length - 1];

export type ListeningSessionLike = {
  id: string;
  ownerId: string;
  sides: BlindListeningSides;
  pairs: BlindListeningPair[];
  keyBySide: Record<string, string>;
};

export type ListeningVoteInput = { pairId: string; question: string; winnerToken: string };
export type ListeningVoteLike = ListeningVoteInput & { raterId: string; isOwner: boolean };

export type RaterPair = {
  pairId: string;
  caseId: string;
  questions: string[];
  a: { token: string; audioUrl: string };
  b: { token: string; audioUrl: string };
};

export type ListeningResults = {
  version: typeof LISTENING_ROOM_VERSION;
  /** Distinct raters other than the owner. */
  raters: number;
  ownerVotesExcluded: number;
  votesCounted: number;
  perQuestion: Array<{ question: string; votes: number; bySystem: Record<string, number>; leader: string | null }>;
  elo: EloRating[];
  /** The question the gate reads: PR-18's release question, or a tournament session's primary question. */
  primaryQuestion: string;
  /** Tournament sessions only: per-comparison tallies, independent raters and the owner apart. */
  comparisons: ComparisonSummary[];
  gateC: {
    passed: boolean;
    challenger: string;
    incumbent: string;
    releaseVotes: number;
    releaseShare: number | null;
    minRaters: number;
    minWinShare: number;
    reason: string;
  };
};

const digest = (seed: string) => createHash("sha256").update(seed).digest("hex");
const token = (seed: string) => digest(seed).slice(0, 8);

/** One pair per session — the song itself — with the benchmark sheet's token scheme. */
export function buildListeningPairs(
  sessionId: string,
  sides: Pick<BlindListeningSides, "left" | "right">,
): { pairs: BlindListeningPair[]; keyBySide: Record<string, string> } {
  const pairId = `${sessionId}:song`;
  const left = token(`${pairId}:L`);
  const right = token(`${pairId}:R`);
  return {
    pairs: [{
      pairId,
      caseId: "song",
      left: { token: left, systemUnderTest: sides.left.label },
      right: { token: right, systemUnderTest: sides.right.label },
      questions: [...BLIND_QUESTIONS],
    }],
    keyBySide: { [left]: sides.left.label, [right]: sides.right.label },
  };
}

/** The audio behind a token is served by the session itself: the URL names no candidate and needs no project ownership. */
export const listeningAudioPath = (sessionId: string, token: string) => `/api/listening-sessions/${sessionId}/audio/${token}`;

/** The stored render behind a token, or null for a token that is not a side of this session. */
export function audioUrlForToken(session: ListeningSessionLike, token: string): string | null {
  // Tournament sessions: every token has its own render.
  const own = session.sides.audioByToken?.[token];
  if (own) return own;
  if (session.sides.kind === "tournament") return null;
  for (const pair of session.pairs) {
    if (pair.left.token === token) return session.sides.left.audioUrl;
    if (pair.right.token === token) return session.sides.right.audioUrl;
  }
  return null;
}

/**
 * What a rater receives: tokens and token-addressed audio, never a system
 * name, a candidate id or a storage path, with the A/B order decided per rater
 * so a shared link does not share an order.
 */
export function raterView(session: ListeningSessionLike, raterId: string): { pairs: RaterPair[] } {
  return {
    pairs: session.pairs.map((pair) => {
      const flip = Number.parseInt(digest(`${session.id}:${pair.pairId}:${raterId}`).slice(0, 2), 16) % 2 === 1;
      const first = flip ? pair.right : pair.left;
      const second = flip ? pair.left : pair.right;
      return {
        pairId: pair.pairId,
        caseId: pair.caseId,
        questions: pair.questions,
        a: { token: first.token, audioUrl: listeningAudioPath(session.id, first.token) },
        b: { token: second.token, audioUrl: listeningAudioPath(session.id, second.token) },
      };
    }),
  };
}

/** The error to return, or null when every vote names a real pair, question and token, once. */
export function validateVotes(session: ListeningSessionLike, votes: ListeningVoteInput[]): string | null {
  if (!votes.length) return "At least one vote is required";
  const pairs = new Map(session.pairs.map((pair) => [pair.pairId, pair]));
  const seen = new Set<string>();
  for (const vote of votes) {
    const pair = pairs.get(vote.pairId);
    if (!pair) return `Unknown pair ${vote.pairId}`;
    if (!pair.questions.includes(vote.question)) return `Unknown question for pair ${vote.pairId}: ${vote.question}`;
    if (vote.winnerToken !== pair.left.token && vote.winnerToken !== pair.right.token) return `Token ${vote.winnerToken} is not a side of pair ${vote.pairId}`;
    const key = `${vote.pairId}|${vote.question}`;
    if (seen.has(key)) return `Duplicate vote for ${vote.question} on pair ${vote.pairId}`;
    seen.add(key);
  }
  return null;
}

const round = (value: number) => Number(value.toFixed(4));

/** Elo over the counted votes plus the explicit Gate C verdict. Owner votes are excluded. */
export function sessionResults(session: ListeningSessionLike, votes: ListeningVoteLike[]): ListeningResults {
  const counted = votes.filter((vote) => !vote.isOwner && vote.raterId !== session.ownerId);
  const ownerVotesExcluded = votes.length - counted.length;
  const raters = new Set(counted.map((vote) => vote.raterId)).size;
  const systemOf = (winnerToken: string) => session.keyBySide[winnerToken] ?? null;

  // The questions are the pairs' own: the six PR-18 questions on a candidate
  // session, the tournament's primary + secondary questions on a tournament one.
  const questions = session.pairs.length
    ? [...new Set(session.pairs.flatMap((pair) => pair.questions))]
    : [...BLIND_QUESTIONS];
  const releaseQuestion = session.sides.tournament?.primaryQuestion ?? RELEASE_QUESTION;

  const perQuestion = questions.map((question) => {
    const bySystem: Record<string, number> = {};
    let total = 0;
    for (const vote of counted) {
      if (vote.question !== question) continue;
      const system = systemOf(vote.winnerToken);
      if (!system) continue;
      bySystem[system] = (bySystem[system] ?? 0) + 1;
      total += 1;
    }
    const ranked = Object.entries(bySystem).sort((a, b) => b[1] - a[1]);
    const leader = ranked.length && (ranked.length === 1 || ranked[0][1] > ranked[1][1]) ? ranked[0][0] : null;
    return { question, votes: total, bySystem, leader };
  });

  const eloVotes: BlindVote[] = counted.map((vote) => ({ pairId: vote.pairId, winnerToken: vote.winnerToken }));
  const elo = updateEloRatings(eloVotes, session.pairs);

  const challenger = session.sides[session.sides.challenger].label;
  const incumbent = session.sides[session.sides.challenger === "left" ? "right" : "left"].label;
  // On a tournament session only the pairs that put the challenger against the
  // incumbent decide the gate; the other comparisons inform, they do not gate.
  const gatePairs = new Set(
    session.pairs
      .filter((pair) => {
        const arms = [pair.left.systemUnderTest, pair.right.systemUnderTest];
        return session.sides.kind !== "tournament" || (arms.includes(challenger) && arms.includes(incumbent));
      })
      .map((pair) => pair.pairId),
  );
  const releaseCounted = counted.filter((vote) => vote.question === releaseQuestion && gatePairs.has(vote.pairId));
  const releaseVotes = releaseCounted.length;
  const challengerWins = releaseCounted.filter((vote) => systemOf(vote.winnerToken) === challenger).length;
  const releaseShare = releaseVotes ? round(challengerWins / releaseVotes) : null;
  const percent = (value: number) => `${Math.round(value * 100)} %`;
  let reason: string;
  let passed = false;
  if (raters < GATE_C_MIN_RATERS) {
    reason = `${raters} independent rater(s) so far; Gate C needs at least ${GATE_C_MIN_RATERS}.`;
  } else if (releaseShare === null) {
    reason = `No one has answered "${releaseQuestion}" yet.`;
  } else if (releaseShare < GATE_C_MIN_WIN_SHARE) {
    reason = `${challenger} won ${percent(releaseShare)} of ${releaseVotes} release votes; Gate C needs ${percent(GATE_C_MIN_WIN_SHARE)}.`;
  } else {
    passed = true;
    reason = `${challenger} won ${percent(releaseShare)} of ${releaseVotes} release votes from ${raters} independent raters.`;
  }

  return {
    version: LISTENING_ROOM_VERSION,
    raters,
    ownerVotesExcluded,
    votesCounted: counted.length,
    perQuestion,
    elo,
    primaryQuestion: releaseQuestion,
    comparisons: session.sides.kind === "tournament"
      ? summariseComparisons(session, votes.map((vote) => ({ ...vote, isOwner: vote.isOwner || vote.raterId === session.ownerId })), releaseQuestion)
      : [],
    gateC: {
      passed,
      challenger,
      incumbent,
      releaseVotes,
      releaseShare,
      minRaters: GATE_C_MIN_RATERS,
      minWinShare: GATE_C_MIN_WIN_SHARE,
      reason,
    },
  };
}
