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
 *
 * B-05c adds the two register findings R-1b §4 says the set was blind to:
 *
 *  - `top_line_above_comfortable_ceiling` — the *audible top voice* of a part
 *    parked above the ceiling its own profile gives it in the role it holds.
 *    `part_outside_comfortable_range` reads every note against the absolute
 *    comfortable band (60–86 for a violin section), so a bed sitting at 79–84
 *    for a hundred bars is "in range"; a section bed's PAD register in the
 *    profile stops far lower, which is why an arranger calls the same notes
 *    shrill. The ceiling is read from `instrumentProfile.ts`, never invented.
 *  - `climax_all_treble` — the climax with a hole where the music lives: no
 *    note-seconds between C3 and C5 while the top voice sits above C6
 *    (R-1b P0-4: "bass C2, keys 93 % ≥ C5, strings 100 % ≥ C6 — the climax is
 *    the thinnest-textured, shrillest section of the song").
 *
 * B-26 adds the **arbitration** between the two constraints this dimension
 * carries, because B-21 made them collide. Since B-21's D4 the writers place a
 * part inside `roleRegisterFor(profile, role)`; this dimension has always also
 * asked the part to stay off the singer's pitches. Both are right and neither
 * is negotiable on its own, and until now nothing said what to do when they
 * disagree — `vocal_masking` simply told the writer to "move out of the vocal
 * band" whether or not the band it is allowed to occupy had anywhere to move
 * to. `vocalRegisterConflict` answers that with a number instead of an
 * instruction (see its own comment), and every `vocal_masking` observation now
 * carries the window, the sung band, the room on each side and which of the
 * two constraints has to give. Where the Song Model carries no melody at all
 * the dimension says so in the report (`vocal_masking_not_measured`) rather
 * than scoring as if there were room — the owner's song is exactly that case.
 */
import { profileForDefinition, roleRegisterFor } from "../../instrumentProfile";
import type { InstrumentArrangementRole, InstrumentDefinition } from "@workspace/db";
import type { CriticDimension, CriticInput } from "../types";
import {
  buildContext,
  buildReport,
  confidenceFromCount,
  mean,
  notApplicable,
  pitchBand,
  roleInSection,
  round,
  severityFromShare,
  soundingAt,
  topVoice,
  type CriticContext,
  type ObservationDraft,
  type PartInfo,
} from "./shared";

export const REGISTER_DIMENSION = "register";
/**
 * 1.1 (B-05c): `top_line_above_comfortable_ceiling` and `climax_all_treble`.
 * 1.2 (B-26): the role-register / vocal arbitration on `vocal_masking`, and
 * `vocal_masking_not_measured` where the model carries no melody.
 */
export const REGISTER_VERSION = "1.2";

/**
 * The middle register a climax must not vacate. C3 (48) to C5 (72) is where a
 * left hand, a viola/cello line and a tenor sit; an arrangement whose loudest
 * section has nothing there is thin however many notes it has.
 */
export const MIDDLE_REGISTER: [number, number] = [48, 72];
/** C6: above this the top voice is unambiguously in the shrill octave for a pop/ballad ensemble. */
export const TREBLE_TOP_PITCH = 84;
/** Share of a section's beats the top voice must spend above the ceiling before it is a finding (not one high note). */
export const TOP_LINE_CEILING_SHARE: [number, number, number] = [0.4, 0.7, 1.01];
/** Bars a section must have before its register occupancy is worth a claim. */
export const MIN_SECTION_BARS_FOR_REGISTER = 4;

/**
 * The ceiling this part's own profile gives it in the role it holds: the
 * role register's high bound when `instrumentProfile.ts` has one for the role,
 * else the profile's comfortable maximum, else the effective comfortable
 * maximum the context derived. The source is carried into the evidence so a
 * reader can check the number against the profile table.
 */
export function comfortableCeilingFor(part: PartInfo, role: string): { ceiling: number; source: string } {
  const window = roleWindowForDefinition(part.track.instrumentDefinition, role, part.comfortableRange);
  return { ceiling: window.hi, source: window.source };
}

/**
 * The same answer read from an instrument definition and a role alone, for
 * callers that do not build a `PartInfo` — the adversarial critics
 * (`critics/adversarial/instrumentReality.ts`) among them.
 *
 * This exists so that there is exactly **one** function in the repository that
 * answers "how high may this instrument sit in this role". Before B-26 the
 * adversarial `string_bed_too_high` rule carried its own constant 79 while
 * this dimension asked the profile, and the two disagreed about a violin
 * section `CLIMAX_LAYER` (profile 67-91, constant 79) — the lead's F15 ruling,
 * and the third recurrence of the program's standing two-sources-of-truth bug.
 */
export function roleWindowForDefinition(
  definition: Pick<InstrumentDefinition, "id" | "profile"> | null | undefined,
  role: string,
  fallback: { min: number; max: number },
): { lo: number; hi: number; source: string; fromRole: boolean } {
  const profile = definition ? profileForDefinition(definition) : null;
  if (profile) {
    const roleRegister = roleRegisterFor(profile, role as InstrumentArrangementRole);
    if (roleRegister.fromRole) {
      return { lo: roleRegister.lo, hi: roleRegister.hi, source: `instrumentProfile ${profile.id} roleRegisters.${role}`, fromRole: true };
    }
    const comfortable = profile.range.comfortable.value;
    return { lo: comfortable[0], hi: comfortable[1], source: `instrumentProfile ${profile.id} range.comfortable`, fromRole: false };
  }
  return { lo: fallback.min, hi: fallback.max, source: "family fallback comfortable range", fromRole: false };
}

/** Semitones within which a sounding note masks the sung pitch (the `vocal_masking` rule's own distance). */
export const VOCAL_MASK_SEMITONES = 2;

/**
 * Roles a professional writes above the lead. A counter-line or a climax
 * layer over the voice is normal orchestration; a bed or a comping part over
 * it is the defect `vocal_masking` is named for. This is why the arbitration
 * below does not simply take whichever side has more room.
 */
export const ROLES_WRITTEN_ABOVE_THE_LEAD: ReadonlySet<string> = new Set(["LEAD", "COUNTER_MELODY", "CALL_RESPONSE", "CLIMAX_LAYER"]);

export type VocalRegisterConflict = {
  /** The register this part's own profile gives it in the role it holds — the table B-21's D4 gave the writers. */
  window: [number, number];
  windowSource: string;
  /** The band the singer occupies over this section's sung notes, widened by the masking distance. */
  vocalBand: [number, number];
  /** The part's own span in this section. */
  partSpan: [number, number];
  /** Semitones of the window lying clear below / above the singer. */
  roomBelow: number;
  roomAbove: number;
  resolution: "clear_below" | "clear_above" | "no_room";
  reason: string;
};

/**
 * **The arbitration.** Two rules of this dimension pull in opposite
 * directions once the writers obey the first:
 *
 *   (A) a part stays inside the register its own profile gives it in the role
 *       it holds — `roleRegisterFor`, the number B-21's D4 gave the writers
 *       and the number `top_line_above_comfortable_ceiling` judges by;
 *   (B) a part does not sound within `VOCAL_MASK_SEMITONES` of the sung pitch.
 *
 * Neither yields to the other by taste. They are compatible exactly when the
 * window has, on one side of the singer, at least as many semitones as the
 * part's own voicing spans — so that is what this function measures, and it
 * reports which side, or that there is none.
 *
 * *Below* is the resolution for an accompaniment: a bed, a comping part or a
 * pad belongs under the voice. *Above* is admitted only for the roles a
 * professional writes over the lead (`ROLES_WRITTEN_ABOVE_THE_LEAD`).
 *
 * When neither side has room the two constraints cannot both be satisfied by
 * **any** placement of this voicing, and the decision is no longer the
 * writer's: the plan gave this part a role whose register the singer occupies.
 * That is reported as `no_room`, and `vocal_masking` attributes it to
 * `orchestration` rather than telling the composer to move a part that has
 * nowhere to go.
 *
 * Measured on the anchors at B-26 (window / sung band / part span / room):
 *   pop-full   keys RHYTHMIC_HARMONY [48,72] sung 60-67 span 12  below 9  above 2  -> no_room
 *   rock-full  keys RHYTHMIC_HARMONY [48,72] sung 64-71 span 10  below 13 above -2 -> clear_below
 *   orchestral strings CLIMAX_LAYER  [67,91] sung 62-73 span 13  below -8 above 15 -> clear_above
 */
export function vocalRegisterConflict(input: {
  window: { lo: number; hi: number; source: string };
  role: string;
  vocalLow: number;
  vocalHigh: number;
  partLow: number;
  partHigh: number;
}): VocalRegisterConflict {
  const { window, role, vocalLow, vocalHigh, partLow, partHigh } = input;
  const span = partHigh - partLow;
  const maskedFrom = vocalLow - VOCAL_MASK_SEMITONES;
  const maskedTo = vocalHigh + VOCAL_MASK_SEMITONES;
  const roomBelow = (maskedFrom - 1) - window.lo;
  const roomAbove = window.hi - (maskedTo + 1);
  const fitsBelow = roomBelow >= span;
  const fitsAbove = roomAbove >= span && ROLES_WRITTEN_ABOVE_THE_LEAD.has(role.toUpperCase());
  const base = {
    window: [window.lo, window.hi] as [number, number],
    windowSource: window.source,
    vocalBand: [maskedFrom, maskedTo] as [number, number],
    partSpan: [partLow, partHigh] as [number, number],
    roomBelow,
    roomAbove,
  };
  if (fitsBelow) {
    return { ...base, resolution: "clear_below", reason: `${window.lo}-${maskedFrom - 1} is ${roomBelow} semitones of this part's own ${role} register clear below the singer, and the voicing spans ${span}: it can be seated under the voice without leaving the register` };
  }
  if (fitsAbove) {
    return { ...base, resolution: "clear_above", reason: `${role} is written above the lead and ${maskedTo + 1}-${window.hi} is ${roomAbove} semitones clear above the singer for a voicing spanning ${span}` };
  }
  return {
    ...base,
    resolution: "no_room",
    reason: `the singer occupies ${maskedFrom}-${maskedTo} and this part's ${role} register is ${window.lo}-${window.hi}, leaving ${roomBelow} semitones below and ${roomAbove} above for a voicing spanning ${span}: no placement satisfies both the register and the voice, so the role or the band is the plan's decision to revisit, not the writer's`,
  };
}

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

    // Vocal masking per part, arbitrated against the part's own role register (B-26).
    if (context.vocal) {
      const sectionStart = context.barInfo(section.startBar)?.start ?? 0;
      const sectionEnd = context.barInfo(section.endBar)?.end ?? context.songEnd;
      const sungHere = context.vocal.notes.filter((n) => n.end > sectionStart && n.start < sectionEnd).map((n) => n.pitch);
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
          if (s.some((n) => Math.abs(n.pitch - sung) <= VOCAL_MASK_SEMITONES)) masked += 1;
        }
        if (sungBeats < 8) continue;
        const share = masked / sungBeats;
        const sev = severityFromShare(share, [0.2, 0.35, 1.01]);
        if (sev) {
          const planned = p.plannedRoles.find((r) => r.sectionName === section.name);
          const vocalBand = context.vocal.range ? pitchBand(Math.round((context.vocal.range.low + context.vocal.range.high) / 2)) : null;
          const plannedIntoVocalBand = Boolean(planned && vocalBand && planned.register === vocalBand);
          const notes = context.notesInBars(p, section.startBar, section.endBar);
          const role = roleInSection(p, section.name);
          const window = roleWindowForDefinition(p.track.instrumentDefinition, role, p.comfortableRange);
          // The arbitration: can this part be placed clear of the singer at
          // all, inside the register its own profile gives it in this role?
          const conflict = sungHere.length && notes.length
            ? vocalRegisterConflict({
              window, role,
              vocalLow: Math.min(...sungHere), vocalHigh: Math.max(...sungHere),
              partLow: Math.min(...notes.map((n) => n.pitch)), partHigh: Math.max(...notes.map((n) => n.pitch)),
            })
            : null;
          // Who owns it. When no placement satisfies both constraints the
          // writer has nowhere to move the part to, and the decision that has
          // to be revisited is the plan's (which role, which band), not the
          // composer's. When there is room, it is the composer's.
          const origin = conflict?.resolution === "no_room" ? "orchestration" : plannedIntoVocalBand ? "register" : "compose";
          const repair = conflict?.resolution === "no_room"
            ? { operation: "replan_register_band", scope: "plan" as const, detail: `${p.instrument} masks the singer on ${Math.round(share * 100)} % of the sung beats in ${section.name} and cannot be moved clear of the voice inside its own ${role} register (${conflict.reason}, ${window.source}). Give the part a different role, narrow its voicing, or replan the band.` }
            : conflict?.resolution === "clear_above"
              ? { operation: "lift_line_above_vocal", scope: "section" as const, detail: `${p.instrument} sounds within ${VOCAL_MASK_SEMITONES} semitones of the sung pitch on ${Math.round(share * 100)} % of the sung beats in ${section.name}; ${conflict.reason}` }
              : { operation: "open_voicing_below_vocal", scope: "section" as const, detail: `${p.instrument} sounds within ${VOCAL_MASK_SEMITONES} semitones of the sung pitch on ${Math.round(share * 100)} % of the sung beats in ${section.name}; ${conflict ? conflict.reason : `seat the voicing under the singer inside ${window.lo}-${window.hi} (${window.source})`}` };
          drafts.push({
            kind: "vocal_masking",
            severity: sev,
            location: { startBar: section.startBar, endBar: section.endBar, sectionName: section.name, trackIds: [p.id] },
            evidence: {
              maskedBeatShare: share, sungBeats, plannedRegister: planned?.register ?? "", vocalBand: vocalBand ?? "",
              leadIsVocal: context.vocal.isVocal,
              // B-26: the two constraints and the room between them, so the
              // reader sees the conflict rather than inferring it.
              leadEvidence: context.vocal.isVocal ? "vocal_detected" : "lead_line_without_vocal_evidence",
              role,
              roleRegisterLo: window.lo, roleRegisterHi: window.hi, roleRegisterSource: window.source,
              // `-1` is "not measurable here", the sentinel this dimension set
              // already uses (`motifRecurrenceAndDevelopment.recurrenceShare`):
              // it can only appear when the section has no sung note or the
              // part no note, which the `sungBeats >= 8` guard above excludes.
              sungLow: conflict ? conflict.vocalBand[0] + VOCAL_MASK_SEMITONES : -1,
              sungHigh: conflict ? conflict.vocalBand[1] - VOCAL_MASK_SEMITONES : -1,
              partLow: conflict ? conflict.partSpan[0] : -1,
              partHigh: conflict ? conflict.partSpan[1] : -1,
              roomBelowVocal: conflict ? conflict.roomBelow : -1,
              roomAboveVocal: conflict ? conflict.roomAbove : -1,
              resolution: conflict?.resolution ?? "not_measurable",
            },
            suspectedOrigin: origin,
            originConfidence: confidenceFromCount(masked, 6, conflict?.resolution === "no_room" ? 0.85 : plannedIntoVocalBand ? 0.85 : 0.7),
            recommendedRepair: repair,
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

    // B-05c: the audible top voice against the ceiling this part's own profile
    // gives it in the role it holds. A bed at 79-84 is inside a violin
    // section's absolute comfortable band and far above its PAD register.
    const sectionBars = section.endBar - section.startBar + 1;
    if (sectionBars >= MIN_SECTION_BARS_FOR_REGISTER) {
      for (const p of active) {
        if (p.family === "bass") continue;
        const notes = context.notesInBars(p, section.startBar, section.endBar);
        if (notes.length < 6) continue;
        const role = roleInSection(p, section.name);
        const { ceiling, source } = comfortableCeilingFor(p, role);
        const line = topVoice(notes);
        if (line.length < 6) continue;
        // Note-seconds, not note counts: one long high note colours a section more than four short ones.
        const totalSeconds = line.reduce((s, n) => s + Math.max(0.05, n.duration), 0);
        const aboveSeconds = line.filter((n) => n.pitch > ceiling).reduce((s, n) => s + Math.max(0.05, n.duration), 0);
        const share = totalSeconds > 0 ? aboveSeconds / totalSeconds : 0;
        const sev = severityFromShare(share, TOP_LINE_CEILING_SHARE);
        if (!sev) continue;
        const excess = Math.round(Math.max(...line.map((n) => n.pitch)) - ceiling);
        drafts.push({
          kind: "top_line_above_comfortable_ceiling",
          severity: sev,
          location: { startBar: section.startBar, endBar: section.endBar, sectionName: section.name, trackIds: [p.id] },
          evidence: {
            topLineSecondsAboveCeilingShare: share, ceiling, ceilingSource: source, role,
            highestTopVoicePitch: Math.max(...line.map((n) => n.pitch)),
            medianTopVoicePitch: Math.round(mean(line.map((n) => n.pitch))),
            semitonesAboveCeiling: excess,
            topLineNotes: line.length,
          },
          suspectedOrigin: "compose",
          originConfidence: confidenceFromCount(line.filter((n) => n.pitch > ceiling).length, 6, 0.8),
          recommendedRepair: {
            operation: "lower_top_voice_to_ceiling", scope: "section",
            detail: `${p.instrument}'s top voice spends ${Math.round(share * 100)} % of its sounding time above ${ceiling} in ${section.name} (${source}); the highest note is ${excess} semitones over. Open the voicing downward instead of lifting it.`,
          },
          confidence: confidenceFromCount(line.length, 10),
        });
      }
    }

    // B-05c: the climax with no middle register. Note-seconds per octave band
    // across the whole ensemble; a section that is loudest by plan and empty
    // between C3 and C5 while its top voice sits above C6 is the shrill climax.
    const isClimax = context.plan.globalPlan?.climax?.sectionName === section.name ||
      section.energy >= Math.max(...context.sections.map((s) => s.energy)) - 1e-9;
    if (isClimax && sectionBars >= MIN_SECTION_BARS_FOR_REGISTER && active.length >= 2) {
      let middleSeconds = 0;
      let totalSeconds = 0;
      let topSeconds = 0;
      for (const p of active) {
        for (const n of context.notesInBars(p, section.startBar, section.endBar)) {
          const seconds = Math.max(0.05, n.duration);
          totalSeconds += seconds;
          if (n.pitch >= MIDDLE_REGISTER[0] && n.pitch < MIDDLE_REGISTER[1]) middleSeconds += seconds;
          if (n.pitch >= TREBLE_TOP_PITCH) topSeconds += seconds;
        }
      }
      const middleShare = totalSeconds > 0 ? middleSeconds / totalSeconds : 0;
      const trebleShare = totalSeconds > 0 ? topSeconds / totalSeconds : 0;
      if (totalSeconds > 0 && middleShare <= 0.05 && trebleShare >= 0.15) {
        drafts.push({
          kind: "climax_all_treble",
          severity: "major",
          location,
          evidence: {
            middleRegisterSecondsShare: middleShare, trebleSecondsShare: trebleShare,
            middleRegisterFrom: MIDDLE_REGISTER[0], middleRegisterTo: MIDDLE_REGISTER[1],
            trebleFrom: TREBLE_TOP_PITCH, noteSeconds: totalSeconds, parts: active.length,
            plannedClimax: context.plan.globalPlan?.climax?.sectionName === section.name,
          },
          suspectedOrigin: "orchestration",
          originConfidence: confidenceFromCount(active.length, 3, 0.8),
          recommendedRepair: {
            operation: "fill_middle_register_at_climax", scope: "section",
            detail: `${section.name} is the loudest section and has ${Math.round(middleShare * 100)} % of its note-seconds between C3 and C5 while ${Math.round(trebleShare * 100)} % sit above C6 — add left-hand octaves and open the bed downward rather than lifting the top`,
          },
          confidence: confidenceFromCount(Math.round(totalSeconds), 20),
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

  // B-26: say when the masking check did not run. Without this a model with no
  // melody scores exactly like a model whose parts leave the singer room, and
  // the report cannot tell the two apart. The owner's song is the case that
  // matters: `vocals.status` is `not_available`, so `register` scores 100 with
  // no masking observation at all — not because the arrangement leaves room
  // for him but because the platform does not know where his voice sits.
  if (!context.vocal) {
    drafts.push({
      kind: "vocal_masking_not_measured",
      severity: "info",
      location: { startBar: 1, endBar: context.totalBars, trackIds: context.pitched.map((p) => p.id).sort() },
      evidence: {
        reason: "the Song Model carries no melody, so there is no sung pitch to measure against",
        pitchedParts: context.pitched.length,
        maskingChecked: false,
      },
      suspectedOrigin: "unknown",
      originConfidence: 0,
      recommendedRepair: null,
      confidence: 0,
    });
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
