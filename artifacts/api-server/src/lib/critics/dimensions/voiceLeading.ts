/**
 * Voice-leading dimension (B-05a): per-part motion between successive
 * voicings, parallel perfect intervals inside a part and between parts, voice
 * crossing between parts, common-tone retention across chord changes, and
 * the bass line's contour and leaps.
 *
 * The cost vocabulary follows `voiceLeading.ts` (COMFORTABLE_LEAP = 7,
 * perfect intervals 0/7 mod 12) so the critic and the DP solver disagree on
 * nothing but scope: the solver optimises one voicing plan; this reads what
 * the parts actually did.
 *
 * Suspected origin: voicing and line choices are the composer's (`compose`).
 * A part that moves in parallel octaves with another part for bars on end is
 * either an undeclared doubling (`orchestration`, if the plan gave both parts
 * the same role) or a composer that copied a sibling (`compose`).
 */
import { COMFORTABLE_LEAP } from "../../voiceLeading";
import type { CriticDimension, CriticInput } from "../types";
import {
  barRuns,
  buildContext,
  buildReport,
  confidenceFromCount,
  mean,
  notApplicable,
  onsetClusters,
  roleInSection,
  round,
  severityFromShare,
  soundingAt,
  topVoice,
  type CriticContext,
  type NoteRef,
  type ObservationDraft,
  type PartInfo,
} from "./shared";

export const VOICE_LEADING_DIMENSION = "voiceLeading";
export const VOICE_LEADING_VERSION = "1.0";

const PERFECT = new Set([0, 7]);
const INCIDENTAL = new Set(["TRANSITION", "FILL"]);

type VoicingMove = {
  fromBar: number;
  toBar: number;
  motions: number[];
  held: number;
  parallels: number;
  voicePairs: number;
  chordChanged: boolean;
  sharedPitchClasses: number;
  retainedCommonTone: boolean;
};

/** Match voices between two clusters: equal sizes by index, otherwise nearest pitch from the top down. */
function matchVoices(from: NoteRef[], to: NoteRef[]): Array<[number, number]> {
  if (from.length === to.length) return from.map((f, i) => [f.pitch, to[i].pitch]);
  const pairs: Array<[number, number]> = [];
  const used = new Set<number>();
  const shorter = from.length < to.length ? from : to;
  const longer = from.length < to.length ? to : from;
  for (let i = shorter.length - 1; i >= 0; i -= 1) {
    let best = -1;
    for (let j = 0; j < longer.length; j += 1) {
      if (used.has(j)) continue;
      if (best < 0 || Math.abs(longer[j].pitch - shorter[i].pitch) < Math.abs(longer[best].pitch - shorter[i].pitch)) best = j;
    }
    if (best >= 0) {
      used.add(best);
      pairs.push(from.length < to.length ? [shorter[i].pitch, longer[best].pitch] : [longer[best].pitch, shorter[i].pitch]);
    }
  }
  return pairs;
}

export function partMoves(context: CriticContext, part: PartInfo): VoicingMove[] {
  const clusters = onsetClusters(part.notes);
  const moves: VoicingMove[] = [];
  for (let i = 1; i < clusters.length; i += 1) {
    const from = clusters[i - 1];
    const to = clusters[i];
    // Only successive voicings within two bars (plus a beat of tolerance for the performance's timing) are a voice-leading relation.
    if (to[0].start - from[0].start > 2 * from[0].beatSeconds * (context.barInfo(from[0].bar)?.beats ?? 4) + from[0].beatSeconds) continue;
    const pairs = matchVoices(from, to);
    const motions = pairs.map(([a, b]) => Math.abs(b - a));
    let parallels = 0;
    let voicePairs = 0;
    for (let a = 0; a < pairs.length; a += 1) {
      for (let b = a + 1; b < pairs.length; b += 1) {
        voicePairs += 1;
        const before = Math.abs(pairs[a][0] - pairs[b][0]) % 12;
        const after = Math.abs(pairs[a][1] - pairs[b][1]) % 12;
        const movedA = pairs[a][1] - pairs[a][0];
        const movedB = pairs[b][1] - pairs[b][0];
        if (movedA !== 0 && movedB !== 0 && Math.sign(movedA) === Math.sign(movedB) && PERFECT.has(before) && before === after) parallels += 1;
      }
    }
    const chordFrom = context.chordAt(from[0].start);
    const chordTo = context.chordAt(to[0].start);
    const chordChanged = Boolean(chordFrom && chordTo && chordFrom.index !== chordTo.index);
    let shared = 0;
    if (chordChanged && chordFrom && chordTo) for (const p of chordFrom.pitchClasses) if (chordTo.pitchClasses.has(p)) shared += 1;
    moves.push({
      fromBar: from[0].bar,
      toBar: to[0].bar,
      motions,
      held: motions.filter((m) => m === 0).length,
      parallels,
      voicePairs,
      chordChanged,
      sharedPitchClasses: shared,
      retainedCommonTone: pairs.some(([a, b]) => a === b),
    });
  }
  return moves;
}

/** Parallel perfect motion between the top voices of two parts at shared onsets. */
function betweenPartParallels(a: PartInfo, b: PartInfo, tolerance = 0.04): { transitions: number; parallels: number; octaveLocked: number; bars: number[] } {
  const topA = topVoice(a.notes);
  const topB = topVoice(b.notes);
  const shared: Array<[NoteRef, NoteRef]> = [];
  let j = 0;
  for (const na of topA) {
    while (j < topB.length && topB[j].start < na.start - tolerance) j += 1;
    if (j < topB.length && Math.abs(topB[j].start - na.start) <= tolerance) shared.push([na, topB[j]]);
  }
  let transitions = 0;
  let parallels = 0;
  let octaveLocked = 0;
  const bars: number[] = [];
  for (let i = 1; i < shared.length; i += 1) {
    const [a0, b0] = shared[i - 1];
    const [a1, b1] = shared[i];
    transitions += 1;
    const before = Math.abs(a0.pitch - b0.pitch) % 12;
    const after = Math.abs(a1.pitch - b1.pitch) % 12;
    const movedA = a1.pitch - a0.pitch;
    const movedB = b1.pitch - b0.pitch;
    if (movedA !== 0 && movedB !== 0 && Math.sign(movedA) === Math.sign(movedB) && PERFECT.has(before) && before === after) {
      parallels += 1;
      bars.push(a1.bar);
      if (before === 0) octaveLocked += 1;
    }
  }
  return { transitions, parallels, octaveLocked, bars };
}

export function evaluateVoiceLeading(input: CriticInput) {
  const context = buildContext(input);
  if (!context.pitched.length) return notApplicable(VOICE_LEADING_DIMENSION, VOICE_LEADING_VERSION, context, "no pitched part");
  const drafts: ObservationDraft[] = [];
  let examinedParts = 0;

  for (const part of context.pitched) {
    const moves = partMoves(context, part);
    if (moves.length < 3) continue;
    examinedParts += 1;
    const allMotions = moves.flatMap((m) => m.motions);
    const leapMoves = allMotions.filter((m) => m > COMFORTABLE_LEAP).length;
    const parallelPairs = moves.reduce((s, m) => s + m.parallels, 0);
    const voicePairs = moves.reduce((s, m) => s + m.voicePairs, 0);
    const changes = moves.filter((m) => m.chordChanged && m.sharedPitchClasses > 0);
    const retained = changes.filter((m) => m.retainedCommonTone).length;
    drafts.push({
      kind: "measured",
      severity: "info",
      location: { startBar: 1, endBar: context.totalBars, trackIds: [part.id] },
      evidence: {
        moves: moves.length,
        meanMotionSemitones: mean(allMotions),
        leapShare: allMotions.length ? leapMoves / allMotions.length : 0,
        parallelPerfectShare: voicePairs ? parallelPairs / voicePairs : 0,
        commonToneRetention: changes.length ? retained / changes.length : -1,
        chordChangesWithCommonTone: changes.length,
        family: part.family,
      },
      suspectedOrigin: "compose",
      originConfidence: 0,
      recommendedRepair: null,
      confidence: confidenceFromCount(moves.length, 12),
    });

    for (const section of context.sections) {
      const inSection = moves.filter((m) => m.toBar >= section.startBar && m.toBar <= section.endBar);
      if (inSection.length < 3) continue;
      const location = { startBar: section.startBar, endBar: section.endBar, sectionName: section.name, trackIds: [part.id] };
      const motions = inSection.flatMap((m) => m.motions);
      const isBass = part.family === "bass";

      // Bass contour: leaps beyond a comfortable interval between successive bass notes.
      // Pickup figures (TRANSITION / FILL parts) leap by design and are not a line.
      if (!INCIDENTAL.has(roleInSection(part, section.name))) {
        const leapShare = motions.length ? motions.filter((m) => m > COMFORTABLE_LEAP).length / motions.length : 0;
        const octaveShare = motions.length ? motions.filter((m) => m >= 12).length / motions.length : 0;
        // Fewer than six moves: only a clear majority of leaps is a claim.
        const thresholds: [number, number, number] = inSection.length < 6 ? [0.6, 0.75, 1.01] : isBass ? [0.25, 0.45, 0.7] : [0.3, 0.55, 0.8];
        const sev = severityFromShare(leapShare, thresholds);
        if (sev) {
          const leapBars = inSection.filter((m) => m.motions.some((x) => x > COMFORTABLE_LEAP)).map((m) => m.toBar);
          drafts.push({
            kind: isBass ? "bass_leaps" : "voicing_leaps",
            severity: sev,
            location,
            evidence: { leapShare, octaveOrMoreShare: octaveShare, moves: inSection.length, meanMotionSemitones: mean(motions), leapBars: barRuns(leapBars).map((r) => (r[0] === r[1] ? `${r[0]}` : `${r[0]}-${r[1]}`)).join(",") },
            suspectedOrigin: "compose",
            originConfidence: confidenceFromCount(inSection.length, 6),
            recommendedRepair: isBass
              ? { operation: "plan_bass_contour", scope: "part", detail: `${Math.round(leapShare * 100)} % of bass moves in ${section.name} leap beyond a ${COMFORTABLE_LEAP}-semitone interval; choose inversions/octaves for a stepwise or arpeggiated contour` }
              : { operation: "revoice_for_smooth_motion", scope: "part", detail: `${part.instrument} voices leap in ${Math.round(leapShare * 100)} % of moves in ${section.name}; keep common tones and move the rest by step` },
            confidence: confidenceFromCount(inSection.length, 8),
          });
        }
      }

      // Parallel perfects inside a chordal part.
      const pairs = inSection.reduce((s, m) => s + m.voicePairs, 0);
      if (pairs >= 6) {
        const parallels = inSection.reduce((s, m) => s + m.parallels, 0);
        const share = parallels / pairs;
        const sev = severityFromShare(share, [0.2, 0.4, 1.01]);
        if (sev) {
          drafts.push({
            kind: "parallel_perfects_within_part",
            severity: sev,
            location,
            evidence: { parallelShare: share, parallels, voicePairTransitions: pairs },
            suspectedOrigin: "compose",
            originConfidence: confidenceFromCount(parallels, 4),
            recommendedRepair: { operation: "revoice_avoid_parallels", scope: "part", detail: `${parallels} parallel fifth/octave motions in ${part.instrument} across ${section.name}; use contrary or oblique motion between voices` },
            confidence: confidenceFromCount(pairs, 12),
          });
        }
      }

      // Common tones available but never kept in the same voice.
      const changesHere = inSection.filter((m) => m.chordChanged && m.sharedPitchClasses > 0);
      if (changesHere.length >= 4 && !isBass) {
        const kept = changesHere.filter((m) => m.retainedCommonTone).length / changesHere.length;
        if (kept < 0.3) {
          drafts.push({
            kind: "no_common_tone_retention",
            severity: "minor",
            location,
            evidence: { commonToneRetention: kept, chordChangesWithCommonTone: changesHere.length },
            suspectedOrigin: "compose",
            originConfidence: confidenceFromCount(changesHere.length, 5),
            recommendedRepair: { operation: "keep_common_tones", scope: "part", detail: `${part.instrument} keeps a shared tone in the same voice at only ${Math.round(kept * 100)} % of the chord changes in ${section.name} that offer one` },
            confidence: confidenceFromCount(changesHere.length, 6),
          });
        }
      }
    }
  }

  // Between parts: parallels / doubling, and voice crossing.
  const pitched = context.pitched;
  for (let i = 0; i < pitched.length; i += 1) {
    for (let j = i + 1; j < pitched.length; j += 1) {
      const a = pitched[i];
      const b = pitched[j];
      const rel = betweenPartParallels(a, b);
      if (rel.transitions >= 6) {
        const share = rel.parallels / rel.transitions;
        const runs = barRuns(rel.bars);
        const longest = runs.reduce((best, r) => Math.max(best, r[1] - r[0] + 1), 0);
        if (share >= 0.5 && longest >= 4) {
          const sameRole = a.plannedRoles.some((ra) => b.plannedRoles.some((rb) => rb.sectionName === ra.sectionName && rb.role === ra.role));
          const origin = sameRole ? "orchestration" : "compose";
          const longestRun = runs.find((r) => r[1] - r[0] + 1 === longest)!;
          drafts.push({
            kind: rel.octaveLocked / Math.max(1, rel.parallels) >= 0.7 ? "part_doubles_another" : "parallel_perfects_between_parts",
            severity: share >= 0.85 && longest >= 8 ? "major" : "minor",
            location: { startBar: longestRun[0], endBar: longestRun[1], trackIds: [a.id, b.id] },
            evidence: { parallelShare: share, sharedOnsetTransitions: rel.transitions, octaveOrUnisonShare: rel.parallels ? rel.octaveLocked / rel.parallels : 0, longestRunBars: longest, samePlannedRole: sameRole },
            suspectedOrigin: origin,
            originConfidence: confidenceFromCount(rel.parallels, 6, sameRole ? 0.8 : 0.7),
            recommendedRepair: { operation: "restore_part_independence", scope: "part", detail: `${a.instrument} and ${b.instrument} move in parallel perfect intervals for ${Math.round(share * 100)} % of their shared onsets (longest run ${longest} bars); declare a doubling or give one part its own line` },
            confidence: confidenceFromCount(rel.transitions, 10),
          });
        }
      }
      // Crossing: the planned-lower part sounding above the planned-higher part.
      if (INCIDENTAL.has(a.role.toUpperCase()) || INCIDENTAL.has(b.role.toUpperCase())) continue;
      const lowerFirst = mean(a.notes.map((n) => n.pitch)) <= mean(b.notes.map((n) => n.pitch));
      const low = lowerFirst ? a : b;
      const high = lowerFirst ? b : a;
      {
        let samples = 0;
        let crossed = 0;
        const crossedBars: number[] = [];
        for (const n of high.notes) {
          const lowSounding = soundingAt(low.notes, n.start);
          if (!lowSounding.length) continue;
          const highSounding = soundingAt(high.notes, n.start);
          samples += 1;
          const lowTop = Math.max(...lowSounding.map((x) => x.pitch));
          const highBottom = Math.min(...highSounding.map((x) => x.pitch));
          if (lowTop > highBottom) {
            crossed += 1;
            crossedBars.push(n.bar);
          }
        }
        if (samples >= 8) {
          const share = crossed / samples;
          const sev = severityFromShare(share, [0.2, 0.45, 1.01]);
          if (sev) {
            const runs = barRuns(crossedBars);
            const longestRun = runs.reduce((best, r) => (r[1] - r[0] > best[1] - best[0] ? r : best), runs[0]);
            drafts.push({
              kind: "voice_crossing_between_parts",
              severity: sev,
              location: { startBar: longestRun[0], endBar: longestRun[1], trackIds: [low.id, high.id] },
              evidence: { crossingShare: share, samples, lowerPart: low.instrument, higherPart: high.instrument },
              suspectedOrigin: low.family === "bass" ? "register" : "compose",
              originConfidence: confidenceFromCount(crossed, 6, 0.7),
              recommendedRepair: { operation: "separate_registers", scope: "part", detail: `${low.instrument} sounds above ${high.instrument}'s lowest voice at ${Math.round(share * 100)} % of the shared onsets` },
              confidence: confidenceFromCount(samples, 12),
            });
          }
        }
      }
    }
  }

  return buildReport({
    dimension: VOICE_LEADING_DIMENSION,
    version: VOICE_LEADING_VERSION,
    context,
    drafts,
    coverage: context.pitched.length ? round(examinedParts / context.pitched.length) : 0,
  });
}

export const voiceLeadingDimension: CriticDimension = {
  dimension: VOICE_LEADING_DIMENSION,
  version: VOICE_LEADING_VERSION,
  evaluate: evaluateVoiceLeading,
};
