/**
 * Per-condition routing for beat tracking: which tracker to lead with on which
 * kind of music, as typed data, with the evidence behind every row.
 *
 * Two things this module refuses to do.
 *
 * It will not recommend a provider the platform is not allowed to ship.
 * **madmom leads several conditions on measured accuracy and is still not
 * routable**: its source is BSD-2-Clause but the model files
 * `RNNDownBeatProcessor` loads are CC BY-NC-SA 4.0, and their licence requires
 * written permission from the authors before they, "or technology which
 * utilises them", enter a commercial product. `leadProviderFor` therefore
 * returns the best *routable* provider by default and reports the blocked
 * leader separately, so the cost of the licence is visible instead of silently
 * absorbed.
 *
 * It will not dress up a coin toss as a decision. Every row carries the margin
 * over the runner-up and a `decisive` flag; four cases per condition cannot
 * separate providers below about 0.05 F, and `decisive: false` says so.
 */
import type { RhythmCondition } from "./rhythmCorpus";

export const RHYTHM_ROUTING_EVIDENCE = "docs/evidence/rhythm-tournament-live.json";

/** The image every row below was measured on; see `modal_config.image_evidence`. */
export const RHYTHM_ROUTING_IMAGE_EVIDENCE =
  "sha256:9d1aabd2e917c62f6f228f2044166c9fdfb26adce6b989d4921fb901bab14740";

export type RhythmProviderId =
  | "BEAT_THIS"
  | "MADMOM"
  | "LIBROSA"
  | "BEATNET"
  | "ALL_IN_ONE";

/**
 * Providers that may be measured but not routed to.
 *
 * This is a licence fact, not a quality judgement, and it is deliberately a
 * separate set from the scores so that improving madmom's numbers can never
 * quietly make it shippable.
 */
export const LICENCE_BLOCKED_RHYTHM_PROVIDERS: ReadonlySet<RhythmProviderId> =
  new Set<RhythmProviderId>(["MADMOM"]);

/** Providers that were not available in the measured run at all. */
export const UNAVAILABLE_RHYTHM_PROVIDERS: ReadonlySet<RhythmProviderId> =
  new Set<RhythmProviderId>(["ALL_IN_ONE"]);

export type RhythmRoutingRow = {
  condition: RhythmCondition;
  /** Best measured provider, licence ignored. */
  measuredLeader: RhythmProviderId;
  measuredLeaderBeatF: number;
  measuredLeaderDownbeatF: number | null;
  /** Best provider the platform is actually allowed to ship. */
  routableLeader: RhythmProviderId;
  routableLeaderBeatF: number;
  routableLeaderDownbeatF: number | null;
  runnerUp: RhythmProviderId | null;
  runnerUpBeatF: number | null;
  /** measuredLeader − runnerUp, on beat F. */
  margin: number | null;
  /** False when the margin is inside the noise of four cases. */
  decisive: boolean;
  cases: number;
  note: string;
};

export type RhythmRoutingDecision = {
  provider: RhythmProviderId;
  beatF: number;
  decisive: boolean;
  /** Set when a better provider exists but cannot be shipped. */
  blockedLeader: { provider: RhythmProviderId; beatF: number; reason: string } | null;
  note: string;
};

/**
 * The measured table.
 *
 * Generated from `docs/evidence/rhythm-tournament-live.json` by
 * `scripts/rhythm-tournament-entry.ts` (`report` phase) and pasted in rather
 * than imported, so a reviewer reads the recommendation and the number that
 * justifies it in the same place. Regenerate both together or neither.
 */
export const RHYTHM_ROUTING: readonly RhythmRoutingRow[] = [
  {
    condition: "steady_pop",
    measuredLeader: "MADMOM",
    measuredLeaderBeatF: 0.9979,
    measuredLeaderDownbeatF: 1,
    routableLeader: "LIBROSA",
    routableLeaderBeatF: 0.9916,
    routableLeaderDownbeatF: null,
    runnerUp: "LIBROSA",
    runnerUpBeatF: 0.9916,
    margin: 0.0063,
    decisive: false,
    cases: 4,
    note: "MADMOM leads at 0.9979 beat F over LIBROSA at 0.9916; the reconciled reading scored 0.9979.",
  },
  {
    condition: "live_band",
    measuredLeader: "MADMOM",
    measuredLeaderBeatF: 0.9976,
    measuredLeaderDownbeatF: 0.99,
    routableLeader: "BEAT_THIS",
    routableLeaderBeatF: 0.9905,
    routableLeaderDownbeatF: 0.963,
    runnerUp: "BEAT_THIS",
    runnerUpBeatF: 0.9905,
    margin: 0.0071,
    decisive: false,
    cases: 4,
    note: "MADMOM leads at 0.9976 beat F over BEAT_THIS at 0.9905; the reconciled reading scored 0.9976.",
  },
  {
    condition: "classical",
    measuredLeader: "BEAT_THIS",
    measuredLeaderBeatF: 0.5212,
    measuredLeaderDownbeatF: 0.2468,
    routableLeader: "BEAT_THIS",
    routableLeaderBeatF: 0.5212,
    routableLeaderDownbeatF: 0.2468,
    runnerUp: "MADMOM",
    runnerUpBeatF: 0.4854,
    margin: 0.0358,
    decisive: false,
    cases: 4,
    note: "BEAT_THIS leads at 0.5212 beat F over MADMOM at 0.4854; the reconciled reading scored 0.3269.",
  },
  {
    condition: "rubato",
    measuredLeader: "BEAT_THIS",
    measuredLeaderBeatF: 0.763,
    measuredLeaderDownbeatF: 0.5642,
    routableLeader: "BEAT_THIS",
    routableLeaderBeatF: 0.763,
    routableLeaderDownbeatF: 0.5642,
    runnerUp: "MADMOM",
    runnerUpBeatF: 0.5876,
    margin: 0.1754,
    decisive: true,
    cases: 4,
    note: "BEAT_THIS leads at 0.763 beat F over MADMOM at 0.5876; the reconciled reading scored 0.6941.",
  },
  {
    condition: "swing",
    measuredLeader: "MADMOM",
    measuredLeaderBeatF: 0.9944,
    measuredLeaderDownbeatF: 1,
    routableLeader: "LIBROSA",
    routableLeaderBeatF: 0.9888,
    routableLeaderDownbeatF: null,
    runnerUp: "LIBROSA",
    runnerUpBeatF: 0.9888,
    margin: 0.0056,
    decisive: false,
    cases: 4,
    note: "MADMOM leads at 0.9944 beat F over LIBROSA at 0.9888; the reconciled reading scored 0.9944.",
  },
  {
    condition: "odd_meter",
    measuredLeader: "BEAT_THIS",
    measuredLeaderBeatF: 0.9781,
    measuredLeaderDownbeatF: 0.6343,
    routableLeader: "BEAT_THIS",
    routableLeaderBeatF: 0.9781,
    routableLeaderDownbeatF: 0.6343,
    runnerUp: "LIBROSA",
    runnerUpBeatF: 0.9587,
    margin: 0.0194,
    decisive: false,
    cases: 4,
    note: "BEAT_THIS leads at 0.9781 beat F over LIBROSA at 0.9587; the reconciled reading scored 0.9854.",
  },
  {
    condition: "meter_changes",
    measuredLeader: "BEAT_THIS",
    measuredLeaderBeatF: 0.9654,
    measuredLeaderDownbeatF: 0.6303,
    routableLeader: "BEAT_THIS",
    routableLeaderBeatF: 0.9654,
    routableLeaderDownbeatF: 0.6303,
    runnerUp: "LIBROSA",
    runnerUpBeatF: 0.9654,
    margin: 0,
    decisive: false,
    cases: 4,
    note: "BEAT_THIS leads at 0.9654 beat F over LIBROSA at 0.9654; the reconciled reading scored 0.9703.",
  },
  {
    condition: "pickup",
    measuredLeader: "BEATNET",
    measuredLeaderBeatF: 0.9908,
    measuredLeaderDownbeatF: 1,
    routableLeader: "BEATNET",
    routableLeaderBeatF: 0.9908,
    routableLeaderDownbeatF: 1,
    runnerUp: "BEAT_THIS",
    runnerUpBeatF: 0.9908,
    margin: 0,
    decisive: false,
    cases: 4,
    note: "BEATNET leads at 0.9908 beat F over BEAT_THIS at 0.9908; the reconciled reading scored 0.9908.",
  },
  {
    condition: "fast_dance",
    measuredLeader: "MADMOM",
    measuredLeaderBeatF: 0.9949,
    measuredLeaderDownbeatF: 1,
    routableLeader: "LIBROSA",
    routableLeaderBeatF: 0.9914,
    routableLeaderDownbeatF: null,
    runnerUp: "LIBROSA",
    runnerUpBeatF: 0.9914,
    margin: 0.0035,
    decisive: false,
    cases: 4,
    note: "MADMOM leads at 0.9949 beat F over LIBROSA at 0.9914; the reconciled reading scored 0.9949.",
  },
  {
    condition: "slow_ballad",
    measuredLeader: "LIBROSA",
    measuredLeaderBeatF: 0.9563,
    measuredLeaderDownbeatF: null,
    routableLeader: "LIBROSA",
    routableLeaderBeatF: 0.9563,
    routableLeaderDownbeatF: null,
    runnerUp: "BEAT_THIS",
    runnerUpBeatF: 0.9124,
    margin: 0.0439,
    decisive: false,
    cases: 4,
    note: "LIBROSA leads at 0.9563 beat F over BEAT_THIS at 0.9124; the reconciled reading scored 0.6596.",
  },
  {
    condition: "syncopated",
    measuredLeader: "LIBROSA",
    measuredLeaderBeatF: 0.8592,
    measuredLeaderDownbeatF: null,
    routableLeader: "LIBROSA",
    routableLeaderBeatF: 0.8592,
    routableLeaderDownbeatF: null,
    runnerUp: "MADMOM",
    runnerUpBeatF: 0.8431,
    margin: 0.0161,
    decisive: false,
    cases: 4,
    note: "LIBROSA leads at 0.8592 beat F over MADMOM at 0.8431; the reconciled reading scored 0.8431.",
  },
];

export function routingFor(condition: RhythmCondition): RhythmRoutingRow | null {
  return RHYTHM_ROUTING.find((row) => row.condition === condition) ?? null;
}

/**
 * Which tracker to send this condition to.
 *
 * `allowNonCommercial` exists for offline measurement and for the reconciler's
 * second opinion during development — never for a shipped path — and even then
 * the blocked leader is reported rather than silently substituted.
 */
export function leadProviderFor(
  condition: RhythmCondition,
  options: { allowNonCommercial?: boolean } = {},
): RhythmRoutingDecision | null {
  const row = routingFor(condition);
  if (!row) return null;
  const blocked = LICENCE_BLOCKED_RHYTHM_PROVIDERS.has(row.measuredLeader);
  if (options.allowNonCommercial || !blocked) {
    return {
      provider: row.measuredLeader,
      beatF: row.measuredLeaderBeatF,
      decisive: row.decisive,
      blockedLeader: null,
      note: row.note,
    };
  }
  return {
    provider: row.routableLeader,
    beatF: row.routableLeaderBeatF,
    decisive: row.decisive,
    blockedLeader: {
      provider: row.measuredLeader,
      beatF: row.measuredLeaderBeatF,
      reason:
        "madmom's model files are CC BY-NC-SA 4.0; commercial use needs written " +
        "permission from the authors. Measured, not routable.",
    },
    note: row.note,
  };
}

/**
 * Is per-condition routing worth its complexity at all?
 *
 * If one routable provider leads everywhere, the honest answer is no, and this
 * says so rather than shipping a table that always returns the same name.
 */
export function routingIsWorthwhile(): {
  worthwhile: boolean;
  singleRoutableLeader: RhythmProviderId | null;
  reason: string;
} {
  if (!RHYTHM_ROUTING.length) {
    return { worthwhile: false, singleRoutableLeader: null,
      reason: "No measured rows; the table has not been generated." };
  }
  const leaders = new Set(RHYTHM_ROUTING.map((row) => row.routableLeader));
  const decisive = RHYTHM_ROUTING.filter((row) => row.decisive);
  if (leaders.size === 1) {
    return {
      worthwhile: false,
      singleRoutableLeader: [...leaders][0],
      reason:
        `${[...leaders][0]} is the best routable provider on all ` +
        `${RHYTHM_ROUTING.length} measured conditions; a routing table would ` +
        `always return the same name and would only add a way to be wrong.`,
    };
  }
  return {
    worthwhile: decisive.length > 0,
    singleRoutableLeader: null,
    reason: decisive.length
      ? `${leaders.size} different routable providers lead, and ${decisive.length} ` +
        `of ${RHYTHM_ROUTING.length} conditions separate them decisively.`
      : `${leaders.size} providers lead nominally but no condition separates them ` +
        `by more than noise; routing on this evidence would be superstition.`,
  };
}
