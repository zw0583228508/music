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
export const TRANSITIONS_VERSION = "1.0";

const TOMS = new Set([41, 43, 45, 47, 48, 50]);
const CRASH = new Set([49, 52, 55, 57]);

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
