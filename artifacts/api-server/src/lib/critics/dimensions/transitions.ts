/**
 * Transitions dimension (B-05a): what actually happens in the notes at every
 * section boundary — a drum fill (last-bar onset density vs the section, tom
 * hits), entries and exits, register moves, a break (a beat nobody plays),
 * pickups into the downbeat, a dynamic step — and, per planned device, whether
 * the notes realise it. Devices that live outside the notes (ritardando =
 * tempo map, cymbal_swell/riser = CC ramps) are reported as unverifiable, not
 * as failures.
 *
 * Suspected origin: a planned device the notes do not carry is the
 * composer's device table (`compose`); a strong boundary the plan left bare
 * is the transition plan's (`form`).
 */
import type { TransitionDevice } from "@workspace/db";
import type { CriticDimension, CriticInput } from "../types";
import {
  buildContext,
  buildReport,
  confidenceFromCount,
  mean,
  notApplicable,
  round,
  soundingAt,
  type CriticContext,
  type ObservationDraft,
  type PartInfo,
} from "./shared";

export const TRANSITIONS_DIMENSION = "transitions";
/** 1.1 (B-05c): `intro_empty` and `ending_cut` — how the song opens and how it stops. */
export const TRANSITIONS_VERSION = "1.1";

const TOMS = new Set([41, 43, 45, 47, 48, 50]);
const CRASH = new Set([49, 52, 55, 57]);

/**
 * `intro_empty` and `ending_cut` (B-05c, R-1b P1-7 and item 8 of §7).
 *
 * These are the two boundaries every arrangement has and this set never looked
 * at: the one before the first note and the one after the last. On the owner's
 * song bars 1–2 are silence because the chord sheet starts at bar 3 — the
 * arrangement opens with two bars of nothing — and the last piano stab ends
 * 1.06 s before the song ends, so the song stops rather than finishes. Both
 * are things a listener notices in the first and last second.
 *
 * `intro_empty` is a *minor* finding: two silent bars are two seconds, and the
 * judge must never rank them above a bed that is wrong for a hundred bars
 * (R-1b: "the judge's ordering would send an engineer to fix a 2-bar intro
 * first"). `ending_cut` is major when nothing is left sounding at the end,
 * because there is no listener who does not hear it.
 */
export const INTRO_SILENT_BEAT_SHARE = 0.75;
/** A final chord must still be sounding within this many seconds of the song's end. */
export const ENDING_TAIL_SECONDS = 0.5;
/** Below this many pitched parts sounding at the end, the ending is a cut rather than a chord. */
export const ENDING_MIN_SOUNDING_PARTS = 1;

export type BoundaryReading = {
  fromSection: string;
  toSection: string;
  lastBar: number;
  firstBar: number;
  fillRatio: number | null;
  tomHits: number;
  crashOnDownbeat: boolean;
  entries: string[];
  exits: string[];
  registerMoves: number;
  breakBeats: number;
  pickups: string[];
  velocityStep: number;
};

function activeIn(context: CriticContext, startBar: number, endBar: number): PartInfo[] {
  return context.parts.filter((p) => context.notesInBars(p, startBar, endBar).length > 0);
}

export function readBoundary(context: CriticContext, index: number): BoundaryReading | null {
  const from = context.sections[index];
  const to = context.sections[index + 1];
  if (!from || !to) return null;
  const lastBar = from.endBar;
  const firstBar = to.startBar;
  const drums = context.percussive.find((p) => p.family === "drums") ?? null;
  let fillRatio: number | null = null;
  let tomHits = 0;
  let crashOnDownbeat = false;
  if (drums) {
    const sectionNotes = context.notesInBars(drums, from.startBar, from.endBar);
    const bars = from.endBar - from.startBar + 1;
    const last = sectionNotes.filter((n) => n.bar === lastBar);
    if (sectionNotes.length >= 4 && bars >= 2) fillRatio = last.length / Math.max(1, sectionNotes.length / bars);
    tomHits = last.filter((n) => TOMS.has(n.pitch)).length;
    const downbeat = context.barInfo(firstBar)?.start ?? 0;
    crashOnDownbeat = context.notesInBars(drums, firstBar, firstBar).some((n) => CRASH.has(n.pitch) && Math.abs(n.start - downbeat) < 0.1);
  }
  const before = activeIn(context, Math.max(from.startBar, lastBar - 1), lastBar);
  const after = activeIn(context, firstBar, Math.min(to.endBar, firstBar + 1));
  const entries = after.filter((p) => !before.includes(p)).map((p) => p.instrument).sort();
  const exits = before.filter((p) => !after.includes(p)).map((p) => p.instrument).sort();
  let registerMoves = 0;
  for (const p of context.parts) {
    const a = context.notesInBars(p, lastBar, lastBar).map((n) => n.pitch);
    const b = context.notesInBars(p, firstBar, firstBar).map((n) => n.pitch);
    if (a.length && b.length && Math.abs(mean(a) - mean(b)) >= 5) registerMoves += 1;
  }
  const info = context.barInfo(lastBar);
  let breakBeats = 0;
  const pickups: string[] = [];
  if (info) {
    for (let b = 0; b < info.beats; b += 1) {
      const t = info.start + b * info.beatSeconds + 0.001;
      if (!context.parts.some((p) => soundingAt(p.notes, t).length)) breakBeats += 1;
    }
    const lastBeatStart = info.start + (info.beats - 1) * info.beatSeconds;
    for (const p of context.pitched) {
      const inLastBeat = p.notes.filter((n) => n.start >= lastBeatStart - 0.02 && n.start < info.end);
      if (inLastBeat.length >= 2) pickups.push(p.instrument);
    }
  }
  const velBefore = context.parts.flatMap((p) => context.notesInBars(p, Math.max(from.startBar, lastBar - 1), lastBar).map((n) => n.velocity));
  const velAfter = context.parts.flatMap((p) => context.notesInBars(p, firstBar, Math.min(to.endBar, firstBar + 1)).map((n) => n.velocity));
  return {
    fromSection: from.name, toSection: to.name, lastBar, firstBar, fillRatio, tomHits, crashOnDownbeat,
    entries, exits, registerMoves, breakBeats, pickups: pickups.sort(),
    velocityStep: velBefore.length && velAfter.length ? mean(velAfter) - mean(velBefore) : 0,
  };
}

type Realisation = "realised" | "unrealised" | "unverifiable";

function realised(context: CriticContext, reading: BoundaryReading, device: TransitionDevice, instrument: string): Realisation {
  const part = context.parts.find((p) => p.instrument.toLowerCase() === instrument.toLowerCase()) ?? null;
  const lastBarNotes = part ? context.notesInBars(part, reading.lastBar, reading.lastBar) : [];
  switch (device) {
    case "drum_fill": return (reading.fillRatio !== null && reading.fillRatio >= 1.15) || reading.tomHits > 0 ? "realised" : "unrealised";
    case "bass_pickup":
    case "keys_pickup":
    case "guitar_pickup": return part && reading.pickups.includes(part.instrument) ? "realised" : "unrealised";
    case "string_run": return lastBarNotes.length >= 3 ? "realised" : "unrealised";
    case "brass_push": return part && (lastBarNotes.length > 0 || context.notesInBars(part, reading.firstBar, reading.firstBar).some((n) => n.beat < 0.2)) ? "realised" : "unrealised";
    case "cymbal_swell":
    case "cymbal_choke":
    case "ending_hit": return reading.crashOnDownbeat || (device === "ending_hit" && reading.exits.length === 0 && reading.fillRatio !== null && reading.fillRatio >= 1.15) ? "realised" : "unrealised";
    case "break":
    case "stop": return reading.breakBeats > 0 ? "realised" : "unrealised";
    case "anticipation": return reading.pickups.length > 0 ? "realised" : "unrealised";
    case "build_up":
    case "riser":
    case "reverse":
    case "turnaround":
    case "breakdown":
    case "ritardando": return "unverifiable";
    default: return "unverifiable";
  }
}

export function evaluateTransitions(input: CriticInput) {
  const context = buildContext(input);
  if (context.sections.length < 2) return notApplicable(TRANSITIONS_DIMENSION, TRANSITIONS_VERSION, context, "a single section has no boundary");
  if (!context.parts.length) return notApplicable(TRANSITIONS_DIMENSION, TRANSITIONS_VERSION, context, "no parts");
  const drafts: ObservationDraft[] = [];
  const transitions = context.plan.transitionPlan?.transitions ?? [];
  let boundaries = 0;

  for (let i = 0; i + 1 < context.sections.length; i += 1) {
    const reading = readBoundary(context, i)!;
    boundaries += 1;
    const from = context.sections[i];
    const to = context.sections[i + 1];
    const planned = transitions.find((t) => t.atBar === to.startBar) ?? null;
    const location = { startBar: reading.lastBar, endBar: reading.firstBar, trackIds: [] as string[] };
    drafts.push({
      kind: "measured",
      severity: "info",
      location: { ...location, trackIds: activeIn(context, reading.lastBar, reading.firstBar).map((p) => p.id).sort() },
      evidence: {
        boundary: `${reading.fromSection}->${reading.toSection}`,
        fillRatio: reading.fillRatio ?? -1,
        tomHits: reading.tomHits,
        crashOnDownbeat: reading.crashOnDownbeat,
        entries: reading.entries.join(",") || "none",
        exits: reading.exits.join(",") || "none",
        registerMoves: reading.registerMoves,
        breakBeats: reading.breakBeats,
        pickups: reading.pickups.join(",") || "none",
        velocityStep: reading.velocityStep,
        plannedKind: planned?.kind ?? "none",
        plannedStrength: planned?.strength ?? 0,
      },
      suspectedOrigin: "compose",
      originConfidence: 0,
      recommendedRepair: null,
      confidence: confidenceFromCount(context.parts.length * 2, 6),
    });

    const marked = (reading.fillRatio !== null && reading.fillRatio >= 1.15) || reading.tomHits > 0 || reading.entries.length > 0 ||
      reading.exits.length > 0 || reading.registerMoves > 0 || reading.breakBeats > 0 || reading.pickups.length > 0 || Math.abs(reading.velocityStep) >= 6;
    const energyDelta = Math.abs(to.energy - from.energy);
    if (!marked) {
      const strong = energyDelta >= 0.2 || (planned !== null && planned.strength >= 0.5);
      drafts.push({
        kind: "boundary_unmarked",
        severity: strong ? "major" : "minor",
        location,
        evidence: { boundary: `${reading.fromSection}->${reading.toSection}`, plannedEnergyDelta: energyDelta, plannedKind: planned?.kind ?? "none", plannedDevices: planned?.devices.length ?? 0 },
        suspectedOrigin: planned && planned.devices.length ? "compose" : "form",
        originConfidence: confidenceFromCount(context.parts.length, 3, planned && planned.devices.length ? 0.8 : 0.7),
        recommendedRepair: { operation: "mark_the_boundary", scope: "section", detail: `nothing changes between bar ${reading.lastBar} (${from.name}) and bar ${reading.firstBar} (${to.name}): no fill, entry, exit, register move, break, pickup or dynamic step` },
        confidence: confidenceFromCount(context.parts.length * 2, 6),
      });
    }

    if (planned) {
      for (const device of planned.devices) {
        const state = realised(context, reading, device.device, device.instrument);
        if (state === "realised") continue;
        const part = context.parts.find((p) => p.instrument.toLowerCase() === device.instrument.toLowerCase());
        drafts.push({
          kind: state === "unverifiable" ? "device_unverifiable_from_notes" : "planned_device_unrealised",
          severity: state === "unverifiable" ? "info" : device.device === "drum_fill" && planned.kind === "build" && planned.strength >= 0.6 ? "major" : "minor",
          location: { startBar: Math.max(1, to.startBar - Math.max(1, planned.approachBars)), endBar: to.startBar, trackIds: part ? [part.id] : [] },
          evidence: { device: device.device, instrument: device.instrument, intensity: device.intensity, boundary: `${reading.fromSection}->${reading.toSection}`, transitionKind: planned.kind, transitionStrength: planned.strength },
          suspectedOrigin: "compose",
          originConfidence: state === "unverifiable" ? 0 : confidenceFromCount(context.parts.length, 3, part ? 0.85 : 0.6),
          recommendedRepair: state === "unverifiable"
            ? null
            : { operation: `realise_${device.device}`, scope: "note", detail: `${device.device} by ${device.instrument} is planned into ${to.name} at bar ${to.startBar}; the notes do not carry it` },
          confidence: confidenceFromCount(context.parts.length * 2, 6),
        });
      }
    }
  }

  // B-05c: how the song opens.
  const first = context.sections[0];
  if (first) {
    const bars = Math.min(first.endBar, first.startBar + 3);
    let silentBeats = 0;
    let beats = 0;
    for (let bar = first.startBar; bar <= bars; bar += 1) {
      const info = context.barInfo(bar);
      if (!info) continue;
      for (let b = 0; b < info.beats; b += 1) {
        beats += 1;
        const t = info.start + b * info.beatSeconds + 0.001;
        if (!context.parts.some((p) => soundingAt(p.notes, t).length > 0)) silentBeats += 1;
      }
    }
    const share = beats ? silentBeats / beats : 0;
    if (beats >= 4 && share >= INTRO_SILENT_BEAT_SHARE) {
      const plannedParts = (context.plan.sectionPlan?.roleAssignments ?? []).filter((r) => r.sectionName === first.name).length;
      const hasChord = context.chords.some((c) => c.startBar <= bars && c.endBar >= first.startBar);
      drafts.push({
        kind: "intro_empty",
        severity: "minor",
        location: { startBar: first.startBar, endBar: bars, sectionName: first.name, trackIds: [] },
        evidence: {
          silentBeatShare: share, beatsExamined: beats, silentBeats,
          plannedPartsInSection: plannedParts, chordUnderTheseBars: hasChord,
          barsSilent: bars - first.startBar + 1,
        },
        // A section the plan populated that sounds nothing is the composer's;
        // an opening with no chord under it is the harmony source's.
        suspectedOrigin: hasChord ? "compose" : "harmony",
        originConfidence: confidenceFromCount(silentBeats, 6, hasChord ? 0.8 : 0.85),
        recommendedRepair: {
          operation: "open_the_song", scope: "section",
          detail: hasChord
            ? `${first.name} (bars ${first.startBar}-${bars}) is planned for ${plannedParts} part(s) and sounds nothing for ${Math.round(share * 100)} % of its beats`
            : `${first.name} (bars ${first.startBar}-${bars}) has no chord under it, so every part rested; the opening bars are the tonic, not "no harmony"`,
        },
        confidence: confidenceFromCount(beats, 8),
      });
    }
  }

  // B-05c: how the song stops.
  const last = context.sections[context.sections.length - 1];
  const lastBarInfo = context.barInfo(context.totalBars);
  if (last && lastBarInfo && context.pitched.length) {
    const songEnd = lastBarInfo.end;
    const soundingAtEnd = context.pitched.filter((p) => p.notes.some((n) => n.end >= songEnd - ENDING_TAIL_SECONDS)).length;
    const lastEnd = Math.max(...context.parts.flatMap((p) => p.notes.map((n) => n.end)), context.songStart);
    const gapSeconds = songEnd - lastEnd;
    if (soundingAtEnd < ENDING_MIN_SOUNDING_PARTS || gapSeconds > ENDING_TAIL_SECONDS) {
      const longestFinal = Math.max(0, ...context.pitched.flatMap((p) => p.notes.filter((n) => n.bar >= last.startBar).map((n) => n.duration)));
      drafts.push({
        kind: "ending_cut",
        severity: soundingAtEnd < ENDING_MIN_SOUNDING_PARTS ? "major" : "minor",
        location: { startBar: last.startBar, endBar: context.totalBars, sectionName: last.name, trackIds: context.pitched.map((p) => p.id).sort() },
        evidence: {
          pitchedPartsSoundingAtEnd: soundingAtEnd, silenceBeforeEndSeconds: Math.max(0, gapSeconds),
          tailToleranceSeconds: ENDING_TAIL_SECONDS, longestFinalSectionNoteSeconds: longestFinal,
          lastNoteEndSeconds: lastEnd, songEndSeconds: songEnd,
        },
        suspectedOrigin: "compose",
        originConfidence: confidenceFromCount(context.pitched.length, 3, 0.85),
        recommendedRepair: {
          operation: "write_a_final_chord", scope: "section",
          detail: `the last note ends ${Math.max(0, gapSeconds).toFixed(2)} s before ${last.name} does and ${soundingAtEnd} pitched part(s) are still sounding at the end: the song stops rather than finishing. A held final chord on every pitched part, with the planned ritardando.`,
        },
        confidence: confidenceFromCount(context.pitched.length * 2, 6),
      });
    }
  }

  return buildReport({
    dimension: TRANSITIONS_DIMENSION,
    version: TRANSITIONS_VERSION,
    context,
    drafts,
    coverage: round(boundaries / Math.max(1, context.sections.length - 1)),
  });
}

export const transitionsDimension: CriticDimension = {
  dimension: TRANSITIONS_DIMENSION,
  version: TRANSITIONS_VERSION,
  evaluate: evaluateTransitions,
};
