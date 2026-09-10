/**
 * Performance-realisation dimension (B-05a): what the performance layer
 * actually left in the notes and controllers — velocity range and shape per
 * section, accent direction (downbeats vs off-beats), dynamic contrast between
 * sections against the plan's energies, timing profile (a part with zero
 * deviation everywhere is a sequencer, not a player), expression CC on
 * sustaining families, and the sustain pedal against the chord changes.
 *
 * Suspected origin: `perform` for everything the performance engine owns
 * (velocity shaping, timing, CC, pedal); `arc` when the plan's own energies
 * are flat and the notes merely follow them.
 */
import type { CriticDimension, CriticInput } from "../types";
import {
  buildContext,
  buildReport,
  confidenceFromCount,
  gridDeviation,
  mean,
  median,
  notApplicable,
  round,
  stddev,
  type ObservationDraft,
} from "./shared";

export const PERFORMANCE_DIMENSION = "performanceRealisation";
export const PERFORMANCE_VERSION = "1.0";

const SUSTAINING = new Set(["strings", "brass", "winds"]);

export function evaluatePerformanceRealisation(input: CriticInput) {
  const context = buildContext(input);
  if (!context.parts.length) return notApplicable(PERFORMANCE_DIMENSION, PERFORMANCE_VERSION, context, "no parts");
  const drafts: ObservationDraft[] = [];
  const sectionMeans: Array<{ name: string; energy: number; velocity: number }> = [];

  for (const part of context.parts) {
    const velocities = part.notes.map((n) => n.velocity);
    const deviations = part.notes.map((n) => Math.abs(gridDeviation(n, 4).deviationSeconds) * 1000);
    const cc = part.track.cc ?? [];
    const ccControllers = [...new Set(cc.map((c) => c.controller))].sort((a, b) => a - b);
    drafts.push({
      kind: "measured",
      severity: "info",
      location: { startBar: 1, endBar: context.totalBars, trackIds: [part.id] },
      evidence: {
        notes: part.notes.length,
        velocityMin: Math.min(...velocities),
        velocityMax: Math.max(...velocities),
        velocityStddev: stddev(velocities),
        medianAbsTimingMs: median(deviations),
        ccEvents: cc.length,
        ccControllers: ccControllers.join(",") || "none",
        articulations: (part.track.articulations ?? []).length,
        family: part.family,
      },
      suspectedOrigin: "perform",
      originConfidence: 0,
      recommendedRepair: null,
      confidence: confidenceFromCount(part.notes.length, 16),
    });

    let flatSections = 0;
    let sectionsWithNotes = 0;
    for (const section of context.sections) {
      const notes = context.notesInBars(part, section.startBar, section.endBar);
      if (notes.length < 8) continue;
      sectionsWithNotes += 1;
      const v = notes.map((n) => n.velocity);
      const sd = stddev(v);
      const location = { startBar: section.startBar, endBar: section.endBar, sectionName: section.name, trackIds: [part.id] };
      if (sd < 2.5) {
        flatSections += 1;
        drafts.push({
          kind: "flat_dynamics",
          severity: "minor",
          location,
          evidence: { velocityStddev: sd, velocityMin: Math.min(...v), velocityMax: Math.max(...v), notes: notes.length },
          suspectedOrigin: "perform",
          originConfidence: confidenceFromCount(notes.length, 8, 0.8),
          recommendedRepair: { operation: "shape_dynamics", scope: "section", detail: `${part.instrument}'s velocities in ${section.name} vary by ${sd.toFixed(1)} (std) over ${notes.length} notes` },
          confidence: confidenceFromCount(notes.length, 10),
        });
      }
      // Accent direction: downbeats vs off-beats.
      const downbeats = notes.filter((n) => Math.abs(n.beat - Math.round(n.beat)) < 0.1 && Math.round(n.beat) % 2 === 0).map((n) => n.velocity);
      const offbeats = notes.filter((n) => Math.abs(n.beat - Math.round(n.beat)) >= 0.4).map((n) => n.velocity);
      if (downbeats.length >= 6 && offbeats.length >= 6 && mean(offbeats) > mean(downbeats) + 4) {
        drafts.push({
          kind: "accents_inverted",
          severity: "minor",
          location,
          evidence: { downbeatMeanVelocity: mean(downbeats), offbeatMeanVelocity: mean(offbeats), downbeats: downbeats.length, offbeats: offbeats.length },
          suspectedOrigin: "perform",
          originConfidence: confidenceFromCount(Math.min(downbeats.length, offbeats.length), 6, 0.75),
          recommendedRepair: { operation: "restore_metrical_accent", scope: "section", detail: `${part.instrument}'s off-beats are louder than its strong beats in ${section.name}` },
          confidence: confidenceFromCount(Math.min(downbeats.length, offbeats.length), 8),
        });
      }
    }
    if (sectionsWithNotes >= 2 && flatSections === sectionsWithNotes) {
      drafts.push({
        kind: "no_dynamics_anywhere",
        severity: "major",
        location: { startBar: 1, endBar: context.totalBars, trackIds: [part.id] },
        evidence: { flatSections, sectionsWithNotes, velocityStddev: stddev(velocities) },
        suspectedOrigin: "perform",
        originConfidence: confidenceFromCount(part.notes.length, 16, 0.85),
        recommendedRepair: { operation: "apply_performance_dynamics", scope: "part", detail: `${part.instrument} has flat velocities in every section it plays` },
        confidence: confidenceFromCount(part.notes.length, 16),
      });
    }

    if (part.notes.length >= 16 && median(deviations) < 0.5 && Math.max(...deviations) < 0.5) {
      drafts.push({
        kind: "mechanical_timing",
        severity: "minor",
        location: { startBar: 1, endBar: context.totalBars, trackIds: [part.id] },
        evidence: { medianAbsTimingMs: 0, maxAbsTimingMs: 0, notes: part.notes.length },
        suspectedOrigin: "perform",
        originConfidence: confidenceFromCount(part.notes.length, 16, 0.85),
        recommendedRepair: { operation: "humanise_timing", scope: "part", detail: `every one of ${part.instrument}'s ${part.notes.length} onsets sits exactly on the grid` },
        confidence: confidenceFromCount(part.notes.length, 16),
      });
    }

    if (SUSTAINING.has(part.family) && cc.length === 0 && part.notes.length >= 4) {
      drafts.push({
        kind: "no_expression_cc",
        severity: "minor",
        location: { startBar: 1, endBar: context.totalBars, trackIds: [part.id] },
        evidence: { family: part.family, notes: part.notes.length },
        suspectedOrigin: "perform",
        originConfidence: confidenceFromCount(part.notes.length, 4, 0.85),
        recommendedRepair: { operation: "write_expression_curves", scope: "part", detail: `${part.instrument} (${part.family}) carries no CC1/CC11 expression` },
        confidence: confidenceFromCount(part.notes.length, 4),
      });
    }

    if (part.family === "keys") {
      const pedal = cc.filter((c) => c.controller === 64).sort((a, b) => a.time - b.time);
      if (!pedal.length) {
        drafts.push({
          kind: "no_sustain_pedal",
          severity: "info",
          location: { startBar: 1, endBar: context.totalBars, trackIds: [part.id] },
          evidence: { notes: part.notes.length },
          suspectedOrigin: "perform",
          originConfidence: 0,
          recommendedRepair: null,
          confidence: confidenceFromCount(part.notes.length, 8),
        });
      } else {
        const changes = context.chords.filter((c) => part.notes.some((n) => n.start < c.end && n.end > c.start)).map((c) => c.start);
        if (changes.length >= 4) {
          const lifted = changes.filter((t) => pedal.some((p) => p.value < 64 && p.time >= t - 0.15 && p.time <= t + 0.1)).length;
          const share = lifted / changes.length;
          if (share < 0.5) {
            drafts.push({
              kind: "pedal_ignores_chord_changes",
              severity: "minor",
              location: { startBar: 1, endBar: context.totalBars, trackIds: [part.id] },
              evidence: { pedalLiftAtChangeShare: share, chordChanges: changes.length, pedalEvents: pedal.length },
              suspectedOrigin: "perform",
              originConfidence: confidenceFromCount(changes.length, 6, 0.85),
              recommendedRepair: { operation: "pedal_on_chord_onsets", scope: "part", detail: `the sustain pedal lifts at only ${Math.round(share * 100)} % of the chord changes the keys play through` },
              confidence: confidenceFromCount(changes.length, 8),
            });
          }
        }
      }
    }
  }

  for (const section of context.sections) {
    const v = context.parts.flatMap((p) => context.notesInBars(p, section.startBar, section.endBar).map((n) => n.velocity));
    if (v.length >= 8) sectionMeans.push({ name: section.name, energy: section.energy, velocity: mean(v) });
  }
  if (sectionMeans.length >= 3) {
    const energies = sectionMeans.map((s) => s.energy);
    const vel = sectionMeans.map((s) => s.velocity);
    const plannedRange = Math.max(...energies) - Math.min(...energies);
    const velocityRange = Math.max(...vel) - Math.min(...vel);
    if (plannedRange >= 0.3 && velocityRange < 4) {
      drafts.push({
        kind: "no_dynamic_contrast_between_sections",
        severity: "major",
        location: { startBar: 1, endBar: context.totalBars, trackIds: context.parts.map((p) => p.id).sort() },
        evidence: { plannedEnergyRange: plannedRange, velocityRange, sections: sectionMeans.length, perSection: sectionMeans.map((s) => `${s.name}:${Math.round(s.velocity)}`).join(",") },
        suspectedOrigin: "perform",
        originConfidence: confidenceFromCount(sectionMeans.length, 3, 0.75),
        recommendedRepair: { operation: "scale_dynamics_per_section", scope: "plan", detail: `mean velocity moves ${velocityRange.toFixed(1)} across sections whose planned energy spans ${plannedRange.toFixed(2)}` },
        confidence: confidenceFromCount(sectionMeans.length, 4),
      });
    } else if (plannedRange < 0.15 && velocityRange < 4) {
      drafts.push({
        kind: "dynamics_flat_by_plan",
        severity: "minor",
        location: { startBar: 1, endBar: context.totalBars, trackIds: [] },
        evidence: { plannedEnergyRange: plannedRange, velocityRange, sections: sectionMeans.length },
        suspectedOrigin: "arc",
        originConfidence: confidenceFromCount(sectionMeans.length, 3, 0.75),
        recommendedRepair: { operation: "plan_an_arc", scope: "plan", detail: `the plan asks for near-constant energy and the performance follows it` },
        confidence: confidenceFromCount(sectionMeans.length, 4),
      });
    }
  }

  return buildReport({ dimension: PERFORMANCE_DIMENSION, version: PERFORMANCE_VERSION, context, drafts, coverage: round(context.parts.filter((p) => p.notes.length >= 8).length / Math.max(1, context.parts.length)) });
}

export const performanceRealisationDimension: CriticDimension = {
  dimension: PERFORMANCE_DIMENSION,
  version: PERFORMANCE_VERSION,
  evaluate: evaluatePerformanceRealisation,
};
