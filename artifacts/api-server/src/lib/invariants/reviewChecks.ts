/**
 * Brain B-12b: the checkers behind the invariants the two independent R-1
 * reviews isolated (`scratchpad/brain/r1a-engineering-attack.md`,
 * `r1b-musical-attack.md`).
 *
 * Each one states the review's finding as a property of the output, measures
 * it where the review located the loss - between the composer and the shipped
 * track, not against a number this file invents - and is paired in its suite
 * with the control that separates "the brain did it" from "the checker is
 * measuring itself". Nothing here changes any input.
 */
import type { ArrangementArcSection, MusicalNote, SongModelData } from "@workspace/db";
import type { OrchestrationResult, OrchestratedCandidate } from "../arrangementOrchestrator";
import type { CandidateProvenance } from "../decisionProvenance";
import {
  familyOfTrack, geometryOf, isDrumTrack, isPerformanceAddition, notesInBars, provenanceOf,
  type ComposedSong, type Violation,
} from "./analysis";

// ---------------------------------------------------------------------------
// Shared measurements
// ---------------------------------------------------------------------------

/** Notes grouped into gestures: onsets within `windowSeconds` of the first are one chord. */
export function onsetClusters(notes: readonly MusicalNote[], windowSeconds = 0.03): MusicalNote[][] {
  const ordered = [...notes].sort((a, b) => a.start - b.start || a.pitch - b.pitch);
  const out: MusicalNote[][] = [];
  for (const note of ordered) {
    const last = out[out.length - 1];
    if (last && note.start - last[0].start <= windowSeconds) last.push(note);
    else out.push([note]);
  }
  return out;
}

/** Mean notes per gesture: what a listener hears as the thickness of a part. */
export const meanVoices = (notes: readonly MusicalNote[], windowSeconds = 0.03): number => {
  const clusters = onsetClusters(notes, windowSeconds);
  return clusters.length ? clusters.reduce((sum, c) => sum + c.length, 0) / clusters.length : 0;
};

const meanVelocity = (notes: readonly MusicalNote[]): number =>
  (notes.length ? notes.reduce((sum, n) => sum + n.velocity, 0) / notes.length : 0);

const pitchedTracks = (candidate: OrchestratedCandidate) => candidate.trackModels.filter((t) => !isDrumTrack(t));

// ---------------------------------------------------------------------------
// bed_keeps_its_voices (R-1b P0-1)
// ---------------------------------------------------------------------------

/** Roles whose whole point is a chord under the song: a bed is not a line. */
export const BED_ROLES = new Set(["HARMONIC_BED", "PAD", "RHYTHMIC_HARMONY", "CLIMAX_LAYER"]);

export type BedRow = {
  taskId: string;
  sectionName: string;
  instrument: string;
  role: string;
  composedVoices: number;
  shippedVoices: number;
  composedNotes: number;
  shippedNotes: number;
};

/**
 * A part the plan gave a bed role and the composer wrote as three or four
 * voices is still three or four voices when it ships. The composed part is the
 * reference, so the loss is measured exactly where the review located it -
 * between the composer and the shipped track.
 */
export function bedVoicesKept(
  candidate: OrchestratedCandidate, model: SongModelData, composed: ComposedSong,
  options: { minComposedVoices?: number; tolerance?: number } = {},
): { violations: Violation[]; rows: BedRow[] } {
  const minComposed = options.minComposedVoices ?? 2.5;
  const tolerance = options.tolerance ?? 0.8;
  const geometry = geometryOf(model);
  const violations: Violation[] = [];
  const rows: BedRow[] = [];
  for (const part of composed.parts) {
    const role = String(part.request.role ?? part.request.task);
    if (!BED_ROLES.has(role) || part.notes.length < 4) continue;
    const composedVoices = meanVoices(part.notes);
    if (composedVoices < minComposed) continue;
    const family = part.request.instrument.toLowerCase();
    const track = candidate.trackModels.find((t) => familyOfTrack(t) === family);
    if (!track) continue;
    const shippedNotes = notesInBars(track, geometry, part.request.section.startBar, part.request.section.endBar);
    const shippedVoices = meanVoices(shippedNotes);
    rows.push({
      taskId: part.request.taskId, sectionName: part.request.section.sectionName, instrument: family, role,
      composedVoices: Number(composedVoices.toFixed(2)), shippedVoices: Number(shippedVoices.toFixed(2)),
      composedNotes: part.notes.length, shippedNotes: shippedNotes.length,
    });
    if (shippedVoices < composedVoices * tolerance) {
      violations.push({
        code: "bed_lost_its_voices", trackId: track.id, sectionName: part.request.section.sectionName,
        detail: `${part.request.taskId}: composed ${composedVoices.toFixed(2)} voices per gesture over ${part.notes.length} notes, shipped ${shippedVoices.toFixed(2)} over ${shippedNotes.length}`,
      });
    }
  }
  return { violations, rows };
}

// ---------------------------------------------------------------------------
// harmony_on_the_grid (R-1b P0-2)
// ---------------------------------------------------------------------------

export type GridRow = { trackId: string; onsets: number; medianMs: number; p90Ms: number; overToleranceShare: number };

export type GridReport = { violations: Violation[]; rows: GridRow[]; medianMs: number; p90Ms: number; onsets: number; overTolerance: number };

/**
 * The pitched parts and the kit play on one grid. The kit is written on the
 * bar grid by construction, so the measurement is how far each pitched onset
 * sits from the nearest subdivision of the *Song Model's own* bars - never the
 * composer's assumed bar, which B-12 already showed can be a different length.
 */
export function harmonyOnTheGrid(
  candidate: OrchestratedCandidate, model: SongModelData,
  options: { toleranceMs?: number; subdivision?: number; maxMedianMs?: number } = {},
): GridReport {
  const toleranceMs = options.toleranceMs ?? 50;
  const subdivision = options.subdivision ?? 2; // eighths of the notated beat
  const maxMedianMs = options.maxMedianMs ?? toleranceMs;
  const geometry = geometryOf(model);
  const beatSeconds = (60 / Math.max(1, model.tempoMap?.[0]?.bpm ?? 120)) * (4 / geometry.denominator);
  const step = 1 / subdivision;
  const rows: GridRow[] = [];
  const violations: Violation[] = [];
  const all: number[] = [];
  for (const track of pitchedTracks(candidate)) {
    const deviations: number[] = [];
    for (const cluster of onsetClusters(track.notes)) {
      const note = cluster[0];
      if (isPerformanceAddition(note)) continue;
      const beat = geometry.absoluteBeat(note.start);
      deviations.push(Math.abs(beat - Math.round(beat / step) * step) * beatSeconds * 1000);
    }
    if (deviations.length < 4) continue;
    all.push(...deviations);
    const sorted = [...deviations].sort((a, b) => a - b);
    const median = sorted[Math.floor(sorted.length / 2)];
    const p90 = sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * 0.9))];
    const over = deviations.filter((d) => d > toleranceMs).length;
    rows.push({ trackId: track.id, onsets: deviations.length, medianMs: Number(median.toFixed(1)), p90Ms: Number(p90.toFixed(1)), overToleranceShare: Number((over / deviations.length).toFixed(3)) });
    if (median > maxMedianMs) {
      violations.push({ code: "harmony_off_the_grid", trackId: track.id, count: over, detail: `${track.id}: median onset deviation ${median.toFixed(0)} ms (p90 ${p90.toFixed(0)} ms), ${over} of ${deviations.length} onsets over ${toleranceMs} ms` });
    }
  }
  const sortedAll = [...all].sort((a, b) => a - b);
  const at = (q: number) => (sortedAll.length ? Number(sortedAll[Math.min(sortedAll.length - 1, Math.floor(sortedAll.length * q))].toFixed(1)) : 0);
  return { violations, rows, medianMs: at(0.5), p90Ms: at(0.9), onsets: all.length, overTolerance: all.filter((d) => d > toleranceMs).length };
}

// ---------------------------------------------------------------------------
// performance_respects_section_dynamics (R-1b P0-3)
// ---------------------------------------------------------------------------

export type DynamicsRow = { sectionName: string; level: number; marking: string; composedVelocity: number; shippedVelocity: number; ratio: number | null };

/**
 * The arc says which section is loud; the shipped velocities order the
 * sections the same way. For every pair whose intended levels differ by more
 * than `levelGap`, the shipped mean velocity must not invert the order.
 *
 * The composed-to-shipped ratio is reported per section because one dynamic
 * shape applied to the whole track shows up as one ratio - but the assertion
 * is the ordering, which is the claim the arc actually makes; a performance
 * layer is entitled to rescale, not to reorder.
 */
export function performanceFollowsTheArc(
  candidate: OrchestratedCandidate, result: OrchestrationResult, model: SongModelData, composed: ComposedSong,
  options: { levelGap?: number } = {},
): { violations: Violation[]; rows: DynamicsRow[] } {
  const levelGap = options.levelGap ?? 0.15;
  const arc = result.plan.globalPlan?.arc;
  if (!arc || arc.status !== "available") return { violations: [], rows: [] };
  const geometry = geometryOf(model);
  const rows: DynamicsRow[] = [];
  for (const section of arc.sections as ArrangementArcSection[]) {
    const shipped = pitchedTracks(candidate).flatMap((track) => notesInBars(track, geometry, section.startBar, section.endBar));
    if (shipped.length < 4) continue;
    const composedHere = composed.parts
      .filter((p) => p.request.section.sectionName === section.sectionName && !/^(drums|percussion)$/i.test(p.request.instrument))
      .flatMap((p) => p.notes);
    const composedVelocity = meanVelocity(composedHere);
    const shippedVelocity = meanVelocity(shipped);
    rows.push({
      sectionName: section.sectionName, level: section.intendedDynamic.value.level, marking: section.intendedDynamic.value.marking,
      composedVelocity: Number(composedVelocity.toFixed(1)), shippedVelocity: Number(shippedVelocity.toFixed(1)),
      ratio: composedVelocity > 0 ? Number((shippedVelocity / composedVelocity).toFixed(3)) : null,
    });
  }
  const violations: Violation[] = [];
  for (let i = 0; i < rows.length; i += 1) {
    for (let j = i + 1; j < rows.length; j += 1) {
      const [a, b] = [rows[i], rows[j]];
      if (Math.abs(a.level - b.level) <= levelGap) continue;
      const louder = a.level > b.level ? a : b;
      const quieter = a.level > b.level ? b : a;
      if (louder.shippedVelocity <= quieter.shippedVelocity) {
        violations.push({
          code: "shipped_dynamics_invert_the_arc", sectionName: louder.sectionName,
          detail: `${louder.sectionName} (${louder.marking}, level ${louder.level}) ships at velocity ${louder.shippedVelocity} while ${quieter.sectionName} (${quieter.marking}, level ${quieter.level}) ships at ${quieter.shippedVelocity}`,
        });
      }
    }
  }
  return { violations, rows };
}

// ---------------------------------------------------------------------------
// arrival_not_thinner_than_setup (R-1b P0-4)
// ---------------------------------------------------------------------------

export type ArrivalRow = {
  arrival: string; setup: string; setupRole: string;
  arrivalOnsetsPerSecond: number; setupOnsetsPerSecond: number;
  arrivalVoices: number; setupVoices: number;
  arrivalMidRegisterShare: number;
};

/**
 * The section the arc calls an arrival is not thinner than the section that
 * set it up - not in onsets per second, not in voices per gesture - and it is
 * not hollow: something sounds between C3 and C5, the register a listener
 * hears an arrangement's body in.
 */
export function arrivalNotThinner(
  candidate: OrchestratedCandidate, result: OrchestrationResult, model: SongModelData,
  options: { thinnerBy?: number; minMidRegisterShare?: number } = {},
): { violations: Violation[]; rows: ArrivalRow[] } {
  const thinnerBy = options.thinnerBy ?? 1;
  const minMid = options.minMidRegisterShare ?? 0.1;
  const arc = result.plan.globalPlan?.arc;
  if (!arc || arc.status !== "available") return { violations: [], rows: [] };
  const geometry = geometryOf(model);
  const sections = arc.sections as ArrangementArcSection[];
  const measure = (section: ArrangementArcSection) => {
    const notes = pitchedTracks(candidate).flatMap((track) => notesInBars(track, geometry, section.startBar, section.endBar));
    const seconds = Math.max(1e-6, geometry.barBounds(section.endBar).end - geometry.barBounds(section.startBar).start);
    const mid = notes.filter((n) => n.pitch >= 48 && n.pitch < 72).length;
    return {
      notes, seconds,
      onsetsPerSecond: onsetClusters(notes).length / seconds,
      voices: meanVoices(notes),
      midShare: notes.length ? mid / notes.length : 0,
    };
  };
  const violations: Violation[] = [];
  const rows: ArrivalRow[] = [];
  for (let i = 0; i < sections.length; i += 1) {
    if (sections[i].tensionRole.value !== "arrival") continue;
    // The setup is the nearest earlier section the arc marked as one; failing that, the section before.
    let setupIndex = -1;
    for (let j = i - 1; j >= 0; j -= 1) {
      const role = sections[j].tensionRole.value;
      if (role === "setup" || role === "lift") { setupIndex = j; break; }
    }
    if (setupIndex < 0) setupIndex = i - 1;
    if (setupIndex < 0) continue;
    const arrival = measure(sections[i]);
    const setup = measure(sections[setupIndex]);
    if (arrival.notes.length < 4 || setup.notes.length < 4) continue;
    rows.push({
      arrival: sections[i].sectionName, setup: sections[setupIndex].sectionName, setupRole: sections[setupIndex].tensionRole.value,
      arrivalOnsetsPerSecond: Number(arrival.onsetsPerSecond.toFixed(2)), setupOnsetsPerSecond: Number(setup.onsetsPerSecond.toFixed(2)),
      arrivalVoices: Number(arrival.voices.toFixed(2)), setupVoices: Number(setup.voices.toFixed(2)),
      arrivalMidRegisterShare: Number(arrival.midShare.toFixed(3)),
    });
    if (arrival.onsetsPerSecond < setup.onsetsPerSecond * thinnerBy) {
      violations.push({ code: "arrival_thinner_than_setup", sectionName: sections[i].sectionName, detail: `${sections[i].sectionName} (arrival) ${arrival.onsetsPerSecond.toFixed(2)} onsets/s against ${sections[setupIndex].sectionName} (${sections[setupIndex].tensionRole.value}) ${setup.onsetsPerSecond.toFixed(2)}` });
    }
    if (arrival.voices < setup.voices * thinnerBy) {
      violations.push({ code: "arrival_fewer_voices_than_setup", sectionName: sections[i].sectionName, detail: `${sections[i].sectionName} (arrival) ${arrival.voices.toFixed(2)} voices per gesture against ${sections[setupIndex].sectionName} ${setup.voices.toFixed(2)}` });
    }
    if (arrival.midShare < minMid) {
      violations.push({ code: "arrival_hollow_between_c3_and_c5", sectionName: sections[i].sectionName, detail: `${sections[i].sectionName} (arrival): ${(arrival.midShare * 100).toFixed(1)}% of ${arrival.notes.length} notes lie between C3 and C5` });
    }
  }
  return { violations, rows };
}

// ---------------------------------------------------------------------------
// composer_receives_its_context (R-1a P0-2)
// ---------------------------------------------------------------------------

export type ContextReport = {
  violations: Violation[];
  groovePlanOnThePlan: boolean;
  notRecordedLayers: string[];
  layersWithDecisions: string[];
};

/**
 * The orchestrator's default compose lambda hands the writers the context the
 * streams built. Two consequences are observable on the output and are what
 * this checks: the shipped plan carries the groove plan every part is supposed
 * to share, and no track's provenance names harmony, groove or register as
 * `notRecorded` - a writer that never receives a decision registry cannot
 * register a decision, so those layers are unreachable rather than merely
 * unwritten.
 */
export function composerContextWired(
  candidate: OrchestratedCandidate, result: OrchestrationResult,
  provenance: CandidateProvenance = provenanceOf(candidate, result),
): ContextReport {
  const violations: Violation[] = [];
  const groovePlanOnThePlan = Boolean((result.plan as { groovePlan?: unknown }).groovePlan);
  if (!groovePlanOnThePlan) {
    violations.push({ code: "groove_plan_not_on_the_plan", detail: "the shipped ArrangementPlan carries no groovePlan: every part re-derives its own section from its request instead of sharing one" });
  }
  const notRecorded = new Set<string>();
  const withDecisions = new Set<string>();
  for (const own of Object.values(provenance.byTrack)) {
    for (const layer of own.notRecorded ?? []) notRecorded.add(layer.layer);
    for (const range of own.ranges) {
      for (const id of range.decisionIds) withDecisions.add(id.split(":")[0]);
    }
  }
  for (const layer of ["harmony", "groove", "register"]) {
    if (!withDecisions.has(layer)) {
      violations.push({ code: "layer_unreachable_from_the_composer", detail: `no track carries a ${layer} decision${notRecorded.has(layer) ? " and every track reports it as notRecorded" : ""}: the default compose lambda forwards no decision registry, so a writer cannot register one` });
    }
  }
  return { violations, groovePlanOnThePlan, notRecordedLayers: [...notRecorded].sort(), layersWithDecisions: [...withDecisions].sort() };
}
