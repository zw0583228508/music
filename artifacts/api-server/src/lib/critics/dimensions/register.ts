/**
 * Register dimension (B-05a): pitch-band occupancy over time per part —
 * low-mid accumulation (several pitched parts stacked between E2 and B3 at
 * the same beat), melody masking (a part sounding on the singer's pitches
 * while she sings), each part against the band the plan gave it and against
 * its own comfortable range, and a sub-register proxy for bass/kick overlap.
 *
 * Suspected origin: two parts planned into the same band collide by plan
 * (`register`); a part that leaves the band the plan gave it is the
 * composer's (`compose`); a plan band the instrument cannot reach is the
 * orchestration plan's (`orchestration`).
 */
import type { CriticDimension, CriticInput } from "../types";
import {
  buildContext,
  buildReport,
  confidenceFromCount,
  mean,
  notApplicable,
  pitchBand,
  round,
  severityFromShare,
  soundingAt,
  type CriticContext,
  type ObservationDraft,
  type PartInfo,
} from "./shared";

export const REGISTER_DIMENSION = "register";
export const REGISTER_VERSION = "1.0";

/** Pitch range the plan's register bands denote (the budget engine's five bands). */
export const PLANNED_BAND_RANGE: Record<string, [number, number]> = {
  low: [28, 47], low_mid: [48, 59], mid: [60, 71], upper_mid: [72, 83], high: [84, 100],
};
const BAND_ORDER = ["low", "low_mid", "mid", "upper_mid", "high"];

function bandDistance(pitch: number, band: string): number {
  const range = PLANNED_BAND_RANGE[band];
  if (!range) return 0;
  if (pitch < range[0]) return Math.ceil((range[0] - pitch) / 12);
  if (pitch > range[1]) return Math.ceil((pitch - range[1]) / 12);
  return 0;
}

function beatTimes(context: CriticContext, startBar: number, endBar: number): number[] {
  const times: number[] = [];
  for (let bar = startBar; bar <= endBar; bar += 1) {
    const info = context.barInfo(bar);
    if (!info) continue;
    for (let b = 0; b < info.beats; b += 1) times.push(info.start + b * info.beatSeconds + 0.001);
  }
  return times;
}

export function evaluateRegister(input: CriticInput) {
  const context = buildContext(input);
  if (!context.pitched.length) return notApplicable(REGISTER_DIMENSION, REGISTER_VERSION, context, "no pitched part");
  const drafts: ObservationDraft[] = [];
  const drums = context.percussive.find((p) => p.family === "drums") ?? null;

  for (const section of context.sections) {
    const times = beatTimes(context, section.startBar, section.endBar);
    if (!times.length) continue;
    const active = context.pitched.filter((p) => context.notesInBars(p, section.startBar, section.endBar).length > 0);
    if (!active.length) continue;
    const location = { startBar: section.startBar, endBar: section.endBar, sectionName: section.name, trackIds: active.map((p) => p.id).sort() };

    // Per-beat occupancy.
    let lowMidPileups = 0;
    let lowCrowding = 0;
    const centroids = new Map<string, number[]>();
    for (const t of times) {
      let lowMidParts = 0;
      let lowParts = 0;
      for (const p of active) {
        const s = soundingAt(p.notes, t);
        if (!s.length) continue;
        const pitches = s.map((n) => n.pitch);
        const list = centroids.get(p.id) ?? [];
        list.push(mean(pitches));
        centroids.set(p.id, list);
        if (pitches.some((x) => x >= 36 && x < 60)) lowMidParts += 1;
        if (pitches.some((x) => x < 52)) lowParts += 1;
      }
      if (lowMidParts >= 3) lowMidPileups += 1;
      if (lowParts >= 2) lowCrowding += 1;
    }
    const pileupShare = lowMidPileups / times.length;
    const crowdingShare = lowCrowding / times.length;
    drafts.push({
      kind: "measured",
      severity: "info",
      location,
      evidence: {
        beats: times.length,
        lowMidPileupShare: pileupShare,
        lowCrowdingShare: crowdingShare,
        centroids: active.map((p) => `${p.instrument}:${Math.round(mean(centroids.get(p.id) ?? [0]))}`).join(","),
        bands: active.map((p) => `${p.instrument}:${pitchBand(Math.round(mean(centroids.get(p.id) ?? [60])))}`).join(","),
      },
      suspectedOrigin: "register",
      originConfidence: 0,
      recommendedRepair: null,
      confidence: confidenceFromCount(times.length, 16),
    });
    if (pileupShare >= 0.5 && active.length >= 3) {
      const plannedSame = active.filter((p) => p.plannedRoles.some((r) => r.sectionName === section.name && (r.register === "low" || r.register === "low_mid"))).length >= 3;
      drafts.push({
        kind: "low_mid_pileup",
        severity: "major",
        location,
        evidence: { lowMidPileupShare: pileupShare, parts: active.length, plannedIntoLowBands: plannedSame },
        suspectedOrigin: plannedSame ? "register" : "compose",
        originConfidence: confidenceFromCount(lowMidPileups, 8, plannedSame ? 0.85 : 0.7),
        recommendedRepair: { operation: "spread_registers", scope: "section", detail: `three or more pitched parts sound between E2 and B3 on ${Math.round(pileupShare * 100)} % of the beats in ${section.name}` },
        confidence: confidenceFromCount(times.length, 16),
      });
    } else if (crowdingShare >= 0.5 && active.length >= 2) {
      drafts.push({
        kind: "low_register_crowding",
        severity: "minor",
        location,
        evidence: { lowCrowdingShare: crowdingShare, parts: active.length },
        suspectedOrigin: "register",
        originConfidence: confidenceFromCount(lowCrowding, 8, 0.65),
        recommendedRepair: { operation: "raise_one_part", scope: "section", detail: `two or more pitched parts sound below E3 on ${Math.round(crowdingShare * 100)} % of the beats in ${section.name}` },
        confidence: confidenceFromCount(times.length, 16),
      });
    }

    // Vocal masking per part.
    if (context.vocal) {
      for (const p of active) {
        if (p.family === "bass") continue;
        let sungBeats = 0;
        let masked = 0;
        for (const t of times) {
          const sung = context.vocalPitchAt(t);
          if (sung === null) continue;
          const s = soundingAt(p.notes, t);
          if (!s.length) continue;
          sungBeats += 1;
          if (s.some((n) => Math.abs(n.pitch - sung) <= 2)) masked += 1;
        }
        if (sungBeats < 8) continue;
        const share = masked / sungBeats;
        const sev = severityFromShare(share, [0.2, 0.35, 1.01]);
        if (sev) {
          const planned = p.plannedRoles.find((r) => r.sectionName === section.name);
          const vocalBand = context.vocal.range ? pitchBand(Math.round((context.vocal.range.low + context.vocal.range.high) / 2)) : null;
          const plannedIntoVocalBand = Boolean(planned && vocalBand && planned.register === vocalBand);
          drafts.push({
            kind: "vocal_masking",
            severity: sev,
            location: { startBar: section.startBar, endBar: section.endBar, sectionName: section.name, trackIds: [p.id] },
            evidence: { maskedBeatShare: share, sungBeats, plannedRegister: planned?.register ?? "", vocalBand: vocalBand ?? "", leadIsVocal: context.vocal.isVocal },
            suspectedOrigin: plannedIntoVocalBand ? "register" : "compose",
            originConfidence: confidenceFromCount(masked, 6, plannedIntoVocalBand ? 0.85 : 0.7),
            recommendedRepair: { operation: "move_out_of_vocal_band", scope: "section", detail: `${p.instrument} sounds within two semitones of the sung pitch on ${Math.round(share * 100)} % of the sung beats in ${section.name}` },
            confidence: confidenceFromCount(sungBeats, 12),
          });
        }
      }
    }

    // Planned band vs actual, and comfortable range.
    for (const p of active) {
      const notes = context.notesInBars(p, section.startBar, section.endBar);
      if (notes.length < 4) continue;
      const planned = p.plannedRoles.find((r) => r.sectionName === section.name);
      if (planned && PLANNED_BAND_RANGE[planned.register]) {
        const far = notes.filter((n) => bandDistance(n.pitch, planned.register) >= 2).length / notes.length;
        const sev = severityFromShare(far, [0.5, 0.8, 1.01]);
        if (sev) {
          const reachable = p.playableRange.min <= PLANNED_BAND_RANGE[planned.register][1] && p.playableRange.max >= PLANNED_BAND_RANGE[planned.register][0];
          const actualBand = pitchBand(Math.round(mean(notes.map((n) => n.pitch))));
          drafts.push({
            kind: "part_outside_planned_band",
            severity: sev,
            location: { startBar: section.startBar, endBar: section.endBar, sectionName: section.name, trackIds: [p.id] },
            evidence: { shareTwoBandsAway: far, plannedRegister: planned.register, actualBand, meanPitch: mean(notes.map((n) => n.pitch)), plannedBandReachable: reachable },
            suspectedOrigin: reachable ? "compose" : "orchestration",
            originConfidence: confidenceFromCount(Math.round(far * notes.length), 6, reachable ? 0.8 : 0.85),
            recommendedRepair: reachable
              ? { operation: "transpose_into_planned_band", scope: "section", detail: `${p.instrument} was planned ${planned.register} in ${section.name} and plays ${actualBand} (mean pitch ${Math.round(mean(notes.map((n) => n.pitch)))})` }
              : { operation: "replan_register_band", scope: "plan", detail: `${p.instrument} cannot reach the ${planned.register} band it was planned into in ${section.name}` },
            confidence: confidenceFromCount(notes.length, 10),
          });
        }
      }
      const outsideComfort = notes.filter((n) => n.pitch < p.comfortableRange.min || n.pitch > p.comfortableRange.max).length / notes.length;
      const sevComfort = severityFromShare(outsideComfort, [0.5, 0.85, 1.01]);
      if (sevComfort) {
        drafts.push({
          kind: "part_outside_comfortable_range",
          severity: sevComfort,
          location: { startBar: section.startBar, endBar: section.endBar, sectionName: section.name, trackIds: [p.id] },
          evidence: { shareOutsideComfort: outsideComfort, comfortableMin: p.comfortableRange.min, comfortableMax: p.comfortableRange.max, lowest: Math.min(...notes.map((n) => n.pitch)), highest: Math.max(...notes.map((n) => n.pitch)) },
          suspectedOrigin: "compose",
          originConfidence: confidenceFromCount(Math.round(outsideComfort * notes.length), 6, 0.75),
          recommendedRepair: { operation: "return_to_comfortable_range", scope: "section", detail: `${Math.round(outsideComfort * 100)} % of ${p.instrument}'s notes in ${section.name} lie outside its comfortable range ${p.comfortableRange.min}-${p.comfortableRange.max}` },
          confidence: confidenceFromCount(notes.length, 10),
        });
      }
    }

    // Bass / kick sub-register overlap (a mix proxy, informational).
    const bass = active.find((p) => p.family === "bass");
    if (bass && drums) {
      const kicks = context.notesInBars(drums, section.startBar, section.endBar).filter((n) => n.pitch === 36 || n.pitch === 35);
      if (kicks.length >= 4) {
        const lowBassAtKick = kicks.filter((k) => soundingAt(bass.notes, k.start + 0.001).some((n) => n.pitch <= 40)).length / kicks.length;
        drafts.push({
          kind: "sub_register_overlap",
          severity: "info",
          location: { startBar: section.startBar, endBar: section.endBar, sectionName: section.name, trackIds: [bass.id, drums.id] },
          evidence: { lowBassAtKickShare: lowBassAtKick, kicks: kicks.length },
          suspectedOrigin: "mix",
          originConfidence: 0,
          recommendedRepair: null,
          confidence: confidenceFromCount(kicks.length, 8),
        });
      }
    }
  }

  return buildReport({
    dimension: REGISTER_DIMENSION,
    version: REGISTER_VERSION,
    context,
    drafts,
    coverage: round(context.pitched.length / Math.max(1, context.parts.length)) * (context.vocal ? 1 : 0.8),
  });
}

export const registerDimension: CriticDimension = {
  dimension: REGISTER_DIMENSION,
  version: REGISTER_VERSION,
  evaluate: evaluateRegister,
};

export type { PartInfo as RegisterPartInfo };
export const registerInternals = { bandDistance, BAND_ORDER } as const;
