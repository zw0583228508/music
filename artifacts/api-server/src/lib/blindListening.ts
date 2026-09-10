/**
 * Listening room (Gate C, PR-34; positive controls in Brain B-08).
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
 * B-08 (evaluation audit §7.5): a Gate C verdict from a room that cannot hear
 * a 60 % pitch-shifted copy of a part would be a coin flip dressed as a
 * verdict. Every candidate session therefore carries **positive-control
 * pairs** — the challenger's own render against deliberately degraded copies
 * of it, built with the listening benchmark's `degradeSideMidi` — and
 * `sessionResults` withholds the Gate C verdict unless the session's
 * sensitivity report (`listeningSensitivity.ts`) says `may_judge_training`.
 * The rater sees the same six questions on every pair and nothing that names
 * a control.
 *
 * Pure: the routes own persistence. Token scheme identical to the benchmark's
 * sheet so a session's votes and a benchmark sheet's votes feed the same Elo.
 */
import { createHash } from "node:crypto";
import type { BlindListeningPair, BlindListeningSides, TrackModel } from "@workspace/db";
import { BLIND_QUESTIONS, updateEloRatings, type BlindVote, type EloRating } from "./arrangementBenchmark";
import { gmProgramForTrack, isPercussionTrack } from "./benchmarkMeasures";
import {
  controlComparisonId,
  degradeSideMidi,
  degradedProviderId,
  isControlComparison,
  type DegradationRung,
} from "./listeningDegradations";
import { sensitivityReport, type GateVerdict, type SensitivityReport } from "./listeningSensitivity";
import { writeMidiFile, type MidiNote } from "./midiFile";
import { summariseComparisons, type ComparisonSummary } from "./tournamentListening";
import { HUMAN_SUT } from "./tournamentProviders";

export const LISTENING_ROOM_VERSION = "1.1" as const;
/** Gate C is a human verdict; below this many independent raters it is an anecdote. */
export const GATE_C_MIN_RATERS = 5;
/** The challenger must take at least this share of the "which would you release?" votes. */
export const GATE_C_MIN_WIN_SHARE = 0.6;
export const RELEASE_QUESTION = BLIND_QUESTIONS[BLIND_QUESTIONS.length - 1];

/**
 * The control pairs every candidate session carries: two of the strongest
 * rung the sensitivity gate reads (pitch_shift 60 %) and one moderate
 * (pitch_shift 30 %). Each rung needs `SENSITIVITY_GATE.minVotesPerRung` (8)
 * primary-question votes before the gate can read it, so with three pairs a
 * session needs eight independent raters who answer every pair; that is a
 * property of the gate's thresholds, reported in the verdict's reason.
 */
export const CANDIDATE_CONTROL_RUNGS: readonly DegradationRung[] = [
  { kind: "pitch_shift", strength: 0.6 },
  { kind: "pitch_shift", strength: 0.3 },
  { kind: "pitch_shift", strength: 0.6 },
];

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
    /**
     * B-08: what the session's positive controls say. A verdict is withheld
     * unless `verdict` is `may_judge_training`; `controlPairs` is 0 on a
     * session built before controls existed, which is also a withheld verdict.
     */
    sensitivity: {
      verdict: GateVerdict;
      controlPairs: number;
      reasons: string[];
      controls: Array<{ comparison: string; pairs: number; votes: number; detected: number; detectionRate: number | null }>;
    };
  };
};

const digest = (seed: string) => createHash("sha256").update(seed).digest("hex");
const token = (seed: string) => digest(seed).slice(0, 8);

/** Whether a pair is a positive control (owner-only meta; a rater never receives `meta`). */
export function isControlPair(pair: Pick<BlindListeningPair, "meta">): boolean {
  return Boolean(pair.meta?.comparison && isControlComparison(pair.meta.comparison));
}

/**
 * The song pair plus the control pairs, with the benchmark sheet's token
 * scheme. Control pairs put the challenger's undegraded render (labelled
 * `HUMAN_ORIGIN_REFERENCE` — the sensitivity report's name for "the original")
 * against a degraded copy of it (`HUMAN_DEGRADED:<kind>:<strength>`). Their
 * pair ids and case ids are indistinguishable from the song pair's; the
 * comparison lives in owner-only `meta`.
 */
export function buildListeningPairs(
  sessionId: string,
  sides: Pick<BlindListeningSides, "left" | "right">,
  options: { controlRungs?: readonly DegradationRung[] } = {},
): { pairs: BlindListeningPair[]; keyBySide: Record<string, string> } {
  const pairId = `${sessionId}:song`;
  const left = token(`${pairId}:L`);
  const right = token(`${pairId}:R`);
  const pairs: BlindListeningPair[] = [{
    pairId,
    caseId: "song",
    left: { token: left, systemUnderTest: sides.left.label },
    right: { token: right, systemUnderTest: sides.right.label },
    questions: [...BLIND_QUESTIONS],
  }];
  const keyBySide: Record<string, string> = { [left]: sides.left.label, [right]: sides.right.label };
  const rungs = options.controlRungs ?? CANDIDATE_CONTROL_RUNGS;
  rungs.forEach((rung, index) => {
    const controlPairId = `${sessionId}:pair-${index + 2}`;
    const original = token(`${controlPairId}:L`);
    const degraded = token(`${controlPairId}:R`);
    const degradedArm = degradedProviderId(rung);
    pairs.push({
      pairId: controlPairId,
      caseId: "song",
      left: { token: original, systemUnderTest: HUMAN_SUT },
      right: { token: degraded, systemUnderTest: degradedArm },
      questions: [...BLIND_QUESTIONS],
      meta: { comparison: controlComparisonId(rung), taskId: "song", seed: index, family: "arrangement" },
    });
    keyBySide[original] = HUMAN_SUT;
    keyBySide[degraded] = degradedArm;
  });
  return { pairs, keyBySide };
}

/** The audio behind a token is served by the session itself: the URL names no candidate and needs no project ownership. */
export const listeningAudioPath = (sessionId: string, token: string) => `/api/listening-sessions/${sessionId}/audio/${token}`;

/** The stored render behind a token, or null for a token that is not a side of this session. */
export function audioUrlForToken(session: ListeningSessionLike, token: string): string | null {
  // Tournament sessions, and the control pairs of a candidate session: every token has its own render.
  const own = session.sides.audioByToken?.[token];
  if (own) return own;
  if (session.sides.kind === "tournament") return null;
  for (const pair of session.pairs) {
    if (isControlPair(pair)) continue;
    if (pair.left.token === token) return session.sides.left.audioUrl;
    if (pair.right.token === token) return session.sides.right.audioUrl;
  }
  return null;
}

/**
 * What a rater receives: tokens and token-addressed audio, never a system
 * name, a candidate id or a storage path, with the A/B order decided per rater
 * so a shared link does not share an order. Control pairs are indistinguishable.
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

/** The sensitivity report of a session on its primary question, independent raters only. */
export function sessionSensitivity(session: ListeningSessionLike, votes: ListeningVoteLike[]): SensitivityReport {
  const primaryQuestion = session.sides.tournament?.primaryQuestion ?? RELEASE_QUESTION;
  return sensitivityReport(
    session,
    votes.map((vote) => ({ ...vote, isOwner: vote.isOwner || vote.raterId === session.ownerId })),
    { primaryQuestion, raters: "independent" },
  );
}

/**
 * Elo over the counted votes plus the explicit Gate C verdict. Owner votes are
 * excluded; control pairs feed the sensitivity report and nothing else; the
 * verdict is withheld while the controls do not demonstrate sensitivity.
 */
export function sessionResults(session: ListeningSessionLike, votes: ListeningVoteLike[]): ListeningResults {
  const counted = votes.filter((vote) => !vote.isOwner && vote.raterId !== session.ownerId);
  const ownerVotesExcluded = votes.length - counted.length;
  const raters = new Set(counted.map((vote) => vote.raterId)).size;
  const systemOf = (winnerToken: string) => session.keyBySide[winnerToken] ?? null;
  const controlPairIds = new Set(session.pairs.filter(isControlPair).map((pair) => pair.pairId));
  const comparisonVotes = counted.filter((vote) => !controlPairIds.has(vote.pairId));

  // The questions are the pairs' own: the six PR-18 questions on a candidate
  // session, the tournament's primary + secondary questions on a tournament one.
  const questions = session.pairs.length
    ? [...new Set(session.pairs.flatMap((pair) => pair.questions))]
    : [...BLIND_QUESTIONS];
  const releaseQuestion = session.sides.tournament?.primaryQuestion ?? RELEASE_QUESTION;

  const perQuestion = questions.map((question) => {
    const bySystem: Record<string, number> = {};
    let total = 0;
    for (const vote of comparisonVotes) {
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

  const eloVotes: BlindVote[] = comparisonVotes.map((vote) => ({ pairId: vote.pairId, winnerToken: vote.winnerToken }));
  const elo = updateEloRatings(eloVotes, session.pairs.filter((pair) => !isControlPair(pair)));

  const challenger = session.sides[session.sides.challenger].label;
  const incumbent = session.sides[session.sides.challenger === "left" ? "right" : "left"].label;
  // On a tournament session only the pairs that put the challenger against the
  // incumbent decide the gate; the other comparisons inform, they do not gate.
  const gatePairs = new Set(
    session.pairs
      .filter((pair) => !isControlPair(pair))
      .filter((pair) => {
        const arms = [pair.left.systemUnderTest, pair.right.systemUnderTest];
        return session.sides.kind !== "tournament" || (arms.includes(challenger) && arms.includes(incumbent));
      })
      .map((pair) => pair.pairId),
  );
  const releaseCounted = comparisonVotes.filter((vote) => vote.question === releaseQuestion && gatePairs.has(vote.pairId));
  const releaseVotes = releaseCounted.length;
  const challengerWins = releaseCounted.filter((vote) => systemOf(vote.winnerToken) === challenger).length;
  const releaseShare = releaseVotes ? round(challengerWins / releaseVotes) : null;
  const percent = (value: number) => `${Math.round(value * 100)} %`;

  const sensitivity = sessionSensitivity(session, votes);
  const sensitivitySummary: ListeningResults["gateC"]["sensitivity"] = {
    verdict: sensitivity.gate.verdict,
    controlPairs: controlPairIds.size,
    reasons: sensitivity.gate.reasons,
    controls: sensitivity.controls.map((c) => ({ comparison: c.comparison, pairs: c.pairs, votes: c.votes, detected: c.detected, detectionRate: c.detectionRate })),
  };

  let reason: string;
  let passed = false;
  if (raters < GATE_C_MIN_RATERS) {
    reason = `${raters} independent rater(s) so far; Gate C needs at least ${GATE_C_MIN_RATERS}.`;
  } else if (releaseShare === null) {
    reason = `No one has answered "${releaseQuestion}" yet.`;
  } else if (releaseShare < GATE_C_MIN_WIN_SHARE) {
    reason = `${challenger} won ${percent(releaseShare)} of ${releaseVotes} release votes; Gate C needs ${percent(GATE_C_MIN_WIN_SHARE)}.`;
  } else if (!controlPairIds.size) {
    reason = `${challenger} won ${percent(releaseShare)} of ${releaseVotes} release votes, but the session carries no positive-control pairs; Gate C is withheld because the room has not shown it can hear a known difference.`;
  } else if (sensitivity.gate.verdict !== "may_judge_training") {
    reason = `${challenger} won ${percent(releaseShare)} of ${releaseVotes} release votes, but the positive controls do not demonstrate sensitivity (${sensitivity.gate.verdict}: ${sensitivity.gate.reasons.join("; ")}); Gate C is withheld.`;
  } else {
    passed = true;
    reason = `${challenger} won ${percent(releaseShare)} of ${releaseVotes} release votes from ${raters} independent raters; the positive controls were detected (${sensitivity.gate.reasons.join("; ")}).`;
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
      sensitivity: sensitivitySummary,
    },
  };
}

// ---------------------------------------------------------------------------
// Control material for a candidate session
// ---------------------------------------------------------------------------

export const CONTROL_MIDI_TICKS_PER_QUARTER = 480;

export type CandidateControl = {
  rung: DegradationRung;
  comparison: string;
  providerId: string;
  /** The candidate's tracks as one MIDI, the degraded part re-encoded as the last track; context tracks byte-identical to `original`. */
  midi: Buffer;
  totalNotes: number;
  changedNotes: number;
};

export type CandidateControlMaterial = {
  /** The whole candidate as MIDI, the target part last — what the "original" side of every control pair plays. */
  original: Buffer;
  /** The part the controls degrade: the pitched track with the most notes. */
  targetTrackId: string;
  controls: CandidateControl[];
  /** Why no control could be built, when none could. */
  refusal: string | null;
};

/**
 * The degraded copies of a candidate for its control pairs. The candidate's
 * tracks become one MIDI under the song's tempo and metre, the pitched track
 * with the most notes placed last; `degradeSideMidi` then rewrites only that
 * last track, so every control shares the context byte for byte with the
 * original — the property the V2 sessions prove with `contextDigest`.
 */
export function buildCandidateControls(
  candidate: { trackModels: readonly TrackModel[]; tempoBpm: number; meter?: string },
  sessionId: string,
  rungs: readonly DegradationRung[] = CANDIDATE_CONTROL_RUNGS,
): CandidateControlMaterial {
  const tracks = candidate.trackModels.filter((t) => t.notes.length > 0);
  const pitched = tracks.filter((t) => !isPercussionTrack(t));
  if (!pitched.length) return { original: Buffer.alloc(0), targetTrackId: "", controls: [], refusal: "the candidate has no pitched track to degrade" };
  const target = [...pitched].sort((a, b) => b.notes.length - a.notes.length || a.id.localeCompare(b.id))[0];
  const tempoBpm = candidate.tempoBpm > 0 ? candidate.tempoBpm : 120;
  const [numerator, denominator] = (candidate.meter ?? "4/4").split("/").map((v) => Number(v) || 4);
  const quarterSeconds = 60 / tempoBpm;
  const toTick = (seconds: number) => Math.round((seconds / quarterSeconds) * CONTROL_MIDI_TICKS_PER_QUARTER);
  const ordered = [...tracks.filter((t) => t !== target), target];
  const notes: MidiNote[] = ordered.flatMap((track, index) => {
    const percussion = isPercussionTrack(track);
    const program = percussion ? 0 : gmProgramForTrack(track);
    return track.notes.map((n) => ({
      track: index,
      channel: percussion ? 9 : 0,
      program,
      isPercussion: percussion,
      pitch: Math.max(0, Math.min(127, Math.round(n.pitch))),
      velocity: Math.max(1, Math.min(127, Math.round(n.velocity))),
      startTick: toTick(n.start),
      endTick: Math.max(toTick(n.start) + 1, toTick(n.start + n.duration)),
    }));
  });
  const original = writeMidiFile({
    ticksPerQuarter: CONTROL_MIDI_TICKS_PER_QUARTER,
    notes,
    tempos: [{ tick: 0, usPerQuarter: Math.round(60_000_000 / tempoBpm), bpm: tempoBpm }],
    timeSignatures: [{ tick: 0, numerator, denominator }],
  });
  const controls = rungs.map((rung, index): CandidateControl => {
    const degraded = degradeSideMidi(original, rung, `${sessionId}:control:${index}`);
    return {
      rung,
      comparison: controlComparisonId(rung),
      providerId: degradedProviderId(rung),
      midi: degraded.midi,
      totalNotes: degraded.totalNotes,
      changedNotes: degraded.changedNotes,
    };
  });
  return { original, targetTrackId: target.id, controls, refusal: null };
}
