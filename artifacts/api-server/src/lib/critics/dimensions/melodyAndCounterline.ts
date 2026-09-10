/**
 * Melody & counter-line dimension (B-05a): the audible lines of the
 * arrangement — parts in melodic roles (LEAD, COUNTER_MELODY, CALL_RESPONSE,
 * OSTINATO) in full, and the *top voice* of every other pitched, non-bass part
 * (the ear follows the top of a bed too) — measured for contour, range,
 * phrase shape and their relation to the vocal register map when the Song
 * Model carries a sung melody.
 *
 * Suspected origin: a line that sits on the singer's pitches while the singer
 * sings is a register-plan failure when the plan put the part in that band
 * (`register`) and a composer failure otherwise (`compose`); contour defects
 * are the composer's (`compose`).
 */
import type { CriticDimension, CriticInput } from "../types";
import {
  buildContext,
  buildReport,
  confidenceFromCount,
  notApplicable,
  roleInSection,
  round,
  severityFromShare,
  topVoice,
  type CriticContext,
  type NoteRef,
  type ObservationDraft,
  type PartInfo,
} from "./shared";

export const MELODY_DIMENSION = "melodyAndCounterline";
export const MELODY_VERSION = "1.0";

const MELODIC_ROLES = new Set(["LEAD", "COUNTER_MELODY", "CALL_RESPONSE", "OSTINATO"]);

export type LineStats = {
  notes: number;
  rangeSemitones: number;
  distinctPitches: number;
  stepShare: number;
  leapShare: number;
  directionChangesPerNote: number;
  contour: "rising" | "falling" | "arch" | "valley" | "flat" | "mixed";
  peakPosition: number;
};

export function lineStats(line: readonly NoteRef[]): LineStats | null {
  if (line.length < 4) return null;
  const pitches = line.map((n) => n.pitch);
  const intervals: number[] = [];
  for (let i = 1; i < line.length; i += 1) intervals.push(line[i].pitch - line[i - 1].pitch);
  const moving = intervals.filter((d) => d !== 0);
  let changes = 0;
  for (let i = 1; i < moving.length; i += 1) if (Math.sign(moving[i]) !== Math.sign(moving[i - 1])) changes += 1;
  const lo = Math.min(...pitches);
  const hi = Math.max(...pitches);
  const peakIndex = pitches.indexOf(hi);
  const peakPosition = line.length > 1 ? peakIndex / (line.length - 1) : 0;
  const first = pitches[0];
  const last = pitches[pitches.length - 1];
  let contour: LineStats["contour"] = "mixed";
  if (hi - lo <= 2) contour = "flat";
  else if (peakPosition > 0.25 && peakPosition < 0.75 && hi > first + 2 && hi > last + 2) contour = "arch";
  else if (pitches.indexOf(lo) / Math.max(1, line.length - 1) > 0.25 && pitches.indexOf(lo) / Math.max(1, line.length - 1) < 0.75 && lo < first - 2 && lo < last - 2) contour = "valley";
  else if (last - first >= 4) contour = "rising";
  else if (first - last >= 4) contour = "falling";
  return {
    notes: line.length,
    rangeSemitones: hi - lo,
    distinctPitches: new Set(pitches).size,
    stepShare: intervals.length ? intervals.filter((d) => Math.abs(d) <= 2 && d !== 0).length / intervals.length : 0,
    leapShare: intervals.length ? intervals.filter((d) => Math.abs(d) > 7).length / intervals.length : 0,
    directionChangesPerNote: moving.length > 1 ? changes / (moving.length - 1) : 0,
    contour,
    peakPosition: round(peakPosition),
  };
}

function vocalRelation(context: CriticContext, line: readonly NoteRef[]): { active: number; masking: number; inRange: number } {
  let active = 0;
  let masking = 0;
  let inRange = 0;
  for (const n of line) {
    if (!context.vocalActiveAt(n.start)) continue;
    active += 1;
    const sung = context.vocalPitchAt(n.start);
    if (sung !== null && Math.abs(sung - n.pitch) <= 2) masking += 1;
    if (context.vocal?.range && n.pitch >= context.vocal.range.low - 2 && n.pitch <= context.vocal.range.high + 2) inRange += 1;
  }
  return { active, masking, inRange };
}

export function evaluateMelodyAndCounterline(input: CriticInput) {
  const context = buildContext(input);
  const candidates = context.pitched.filter((p) => p.family !== "bass");
  if (!candidates.length) return notApplicable(MELODY_DIMENSION, MELODY_VERSION, context, "no pitched non-bass part carries a line");
  const drafts: ObservationDraft[] = [];
  let examined = 0;

  const lines: Array<{ part: PartInfo; melodicRole: boolean; line: NoteRef[] }> = candidates.map((part) => {
    const melodicRole = MELODIC_ROLES.has(part.role.toUpperCase()) || part.plannedRoles.some((r) => MELODIC_ROLES.has(r.role));
    return { part, melodicRole, line: topVoice(part.notes) };
  });

  for (const { part, melodicRole, line } of lines) {
    const whole = lineStats(line);
    if (!whole) continue;
    examined += 1;
    const rel = vocalRelation(context, line);
    drafts.push({
      kind: "measured",
      severity: "info",
      location: { startBar: 1, endBar: context.totalBars, trackIds: [part.id] },
      evidence: {
        melodicRole,
        lineNotes: whole.notes,
        rangeSemitones: whole.rangeSemitones,
        distinctPitches: whole.distinctPitches,
        stepShare: whole.stepShare,
        leapShare: whole.leapShare,
        directionChangesPerNote: whole.directionChangesPerNote,
        contour: whole.contour,
        peakPosition: whole.peakPosition,
        notesWhileVocalActive: rel.active,
        vocalMaskingShare: rel.active ? rel.masking / rel.active : -1,
        vocalRegisterShare: rel.active ? rel.inRange / rel.active : -1,
        leadIsVocal: context.vocal?.isVocal ?? false,
      },
      suspectedOrigin: "compose",
      originConfidence: 0,
      recommendedRepair: null,
      confidence: confidenceFromCount(whole.notes, 16),
    });

    for (const section of context.sections) {
      const sectionLine = line.filter((n) => n.bar >= section.startBar && n.bar <= section.endBar);
      const stats = lineStats(sectionLine);
      if (!stats) continue;
      const sectionRole = roleInSection(part, section.name);
      if (sectionRole === "TRANSITION" || sectionRole === "FILL") continue;
      const bars = section.endBar - section.startBar + 1;
      const location = { startBar: section.startBar, endBar: section.endBar, sectionName: section.name, trackIds: [part.id] };

      if (melodicRole && stats.notes >= 8 && bars >= 4 && stats.distinctPitches <= 2) {
        drafts.push({
          kind: "line_static",
          severity: "minor",
          location,
          evidence: { distinctPitches: stats.distinctPitches, lineNotes: stats.notes, rangeSemitones: stats.rangeSemitones },
          suspectedOrigin: "compose",
          originConfidence: confidenceFromCount(stats.notes, 8),
          recommendedRepair: { operation: "write_a_contour", scope: "part", detail: `${part.instrument} is in a melodic role in ${section.name} but uses ${stats.distinctPitches} pitch(es) over ${stats.notes} notes` },
          confidence: confidenceFromCount(stats.notes, 10),
        });
      }

      if (stats.notes >= 7) {
        const sev = severityFromShare(stats.leapShare, melodicRole ? [0.45, 0.65, 1.01] : [0.5, 0.75, 1.01]);
        if (sev) {
          drafts.push({
            kind: "line_erratic",
            severity: sev,
            location,
            evidence: { leapShare: stats.leapShare, stepShare: stats.stepShare, directionChangesPerNote: stats.directionChangesPerNote, lineNotes: stats.notes, melodicRole },
            suspectedOrigin: "compose",
            originConfidence: confidenceFromCount(stats.notes, 8),
            recommendedRepair: { operation: "smooth_the_line", scope: "part", detail: `${Math.round(stats.leapShare * 100)} % of ${part.instrument}'s top-voice moves in ${section.name} are leaps larger than a fifth` },
            confidence: confidenceFromCount(stats.notes, 10),
          });
        }
      }

      if (melodicRole && stats.rangeSemitones > 24 && stats.notes >= 8) {
        drafts.push({
          kind: "line_range_extreme",
          severity: "minor",
          location,
          evidence: { rangeSemitones: stats.rangeSemitones, lineNotes: stats.notes },
          suspectedOrigin: "compose",
          originConfidence: confidenceFromCount(stats.notes, 8),
          recommendedRepair: { operation: "narrow_the_line", scope: "part", detail: `${part.instrument}'s line spans ${stats.rangeSemitones} semitones inside ${section.name}` },
          confidence: confidenceFromCount(stats.notes, 10),
        });
      }

      if (context.vocal) {
        const sectionRel = vocalRelation(context, sectionLine);
        if (sectionRel.active >= 4) {
          const masking = sectionRel.masking / sectionRel.active;
          const inRange = sectionRel.inRange / sectionRel.active;
          const planned = part.plannedRoles.find((r) => r.sectionName === section.name);
          const plannedInVocalBand = planned ? planned.register === "mid" || planned.register === "upper_mid" : false;
          const sev = severityFromShare(masking, [0.2, 0.35, 1.01]);
          if (sev) {
            drafts.push({
              kind: "line_masks_vocal",
              severity: sev,
              location,
              evidence: { vocalMaskingShare: masking, notesWhileVocalActive: sectionRel.active, vocalRegisterShare: inRange, plannedRegister: planned?.register ?? "", leadIsVocal: context.vocal!.isVocal },
              suspectedOrigin: plannedInVocalBand ? "register" : "compose",
              originConfidence: confidenceFromCount(sectionRel.masking, 4, plannedInVocalBand ? 0.75 : 0.65),
              recommendedRepair: { operation: "move_line_out_of_vocal_pitches", scope: "section", detail: `${part.instrument}'s top voice sits within two semitones of the sung pitch for ${Math.round(masking * 100)} % of its onsets while the vocal sings in ${section.name}` },
              confidence: confidenceFromCount(sectionRel.active, 8),
            });
          } else if (inRange >= 0.6 && melodicRole) {
            drafts.push({
              kind: "line_in_vocal_register",
              severity: "minor",
              location,
              evidence: { vocalRegisterShare: inRange, notesWhileVocalActive: sectionRel.active },
              suspectedOrigin: plannedInVocalBand ? "register" : "compose",
              originConfidence: confidenceFromCount(sectionRel.inRange, 6, 0.6),
              recommendedRepair: { operation: "answer_in_the_gaps_or_another_octave", scope: "section", detail: `${part.instrument}'s melodic line shares the vocal register for ${Math.round(inRange * 100)} % of its sung-time onsets in ${section.name}` },
              confidence: confidenceFromCount(sectionRel.active, 8),
            });
          }
        }
      }
    }
  }

  return buildReport({
    dimension: MELODY_DIMENSION,
    version: MELODY_VERSION,
    context,
    drafts,
    coverage: candidates.length ? round(examined / candidates.length) * (context.vocal ? 1 : 0.6) : 0,
  });
}

export const melodyAndCounterlineDimension: CriticDimension = {
  dimension: MELODY_DIMENSION,
  version: MELODY_VERSION,
  evaluate: evaluateMelodyAndCounterline,
};
