/**
 * Emotional arc & tension dimension (B-05a): the energy and tension
 * trajectory read from the notes — per bar, an energy proxy from onsets,
 * velocity, active parts and register spread; a tension proxy from
 * non-chord-tone share and the top voice's height — compared with the
 * plan's climax: does the peak land where the plan says, does anything build
 * toward it, is there a release after it, and does the arc move at all when
 * the plan's energies do.
 *
 * Suspected origin: when the plan's own energies peak elsewhere or stay flat
 * the arc is the cause (`arc`); when the plan is right and the notes are not,
 * the realisation is (`compose` / `orchestration`).
 */
import type { CriticDimension, CriticInput } from "../types";
import {
  buildContext,
  buildReport,
  confidenceFromCount,
  mean,
  notApplicable,
  onsetClusters,
  round,
  topVoice,
  type CriticContext,
  type ObservationDraft,
} from "./shared";
import { readPartHarmony } from "./harmony";

export const ARC_DIMENSION = "emotionalArcAndTension";
export const ARC_VERSION = "1.0";

export type BarEnergy = { bar: number; energy: number; tension: number; onsets: number; velocity: number; parts: number; spread: number; nctShare: number };

export function barTrajectory(context: CriticContext): BarEnergy[] {
  const totalParts = Math.max(1, context.parts.length);
  const nct = new Map<number, { nct: number; total: number }>();
  for (const part of context.pitched) {
    for (const r of readPartHarmony(context, part)) {
      const cell = nct.get(r.note.bar) ?? { nct: 0, total: 0 };
      cell.total += r.weight;
      if (r.cls === "clash" || r.cls === "appoggiatura" || r.cls === "suspension") cell.nct += r.weight;
      nct.set(r.note.bar, cell);
    }
  }
  const raw = context.bars.map((b) => {
    let onsets = 0;
    const velocities: number[] = [];
    const pitches: number[] = [];
    let parts = 0;
    for (const p of context.parts) {
      const notes = context.notesInBars(p, b.bar, b.bar);
      if (!notes.length) continue;
      parts += 1;
      onsets += onsetClusters(notes).length;
      velocities.push(...notes.map((n) => n.velocity));
      if (!p.percussive) pitches.push(...notes.map((n) => n.pitch));
    }
    const spread = pitches.length ? Math.max(...pitches) - Math.min(...pitches) : 0;
    const cell = nct.get(b.bar);
    const tops = context.pitched.flatMap((p) => topVoice(context.notesInBars(p, b.bar, b.bar)).map((n) => n.pitch));
    return { bar: b.bar, onsets, velocity: velocities.length ? mean(velocities) : 0, parts, spread, nctShare: cell && cell.total ? cell.nct / cell.total : 0, top: tops.length ? Math.max(...tops) : 0 };
  });
  const maxOnsets = Math.max(1, ...raw.map((r) => r.onsets));
  return raw.map((r) => ({
    bar: r.bar,
    energy: 0.3 * (r.onsets / maxOnsets) + 0.3 * (r.velocity / 127) + 0.25 * (r.parts / totalParts) + 0.15 * Math.min(1, r.spread / 48),
    tension: 0.5 * Math.min(1, r.nctShare * 2) + 0.5 * Math.min(1, Math.max(0, r.top - 48) / 48),
    onsets: r.onsets, velocity: r.velocity, parts: r.parts, spread: r.spread, nctShare: r.nctShare,
  }));
}

export function evaluateEmotionalArcAndTension(input: CriticInput) {
  const context = buildContext(input);
  if (context.sections.length < 2) return notApplicable(ARC_DIMENSION, ARC_VERSION, context, "a single section has no arc");
  if (!context.parts.length) return notApplicable(ARC_DIMENSION, ARC_VERSION, context, "no parts");
  const drafts: ObservationDraft[] = [];
  const bars = barTrajectory(context);
  const byBar = new Map(bars.map((b) => [b.bar, b]));
  const sectionEnergy = context.sections.map((s) => {
    const cells = bars.filter((b) => b.bar >= s.startBar && b.bar <= s.endBar);
    return { section: s, energy: mean(cells.map((c) => c.energy)), tension: mean(cells.map((c) => c.tension)) };
  });
  const planned = context.plan.globalPlan;
  const plannedClimax = planned?.climax?.sectionName ?? null;
  const plannedEnergies = context.sections.map((s) => s.energy);
  const plannedRange = Math.max(...plannedEnergies) - Math.min(...plannedEnergies);
  const plannedPeak = context.sections[plannedEnergies.indexOf(Math.max(...plannedEnergies))];
  const actualPeak = sectionEnergy.reduce((a, b) => (b.energy > a.energy ? b : a));
  const actualRange = Math.max(...sectionEnergy.map((s) => s.energy)) - Math.min(...sectionEnergy.map((s) => s.energy));

  drafts.push({
    kind: "measured",
    severity: "info",
    location: { startBar: 1, endBar: context.totalBars, trackIds: context.parts.map((p) => p.id).sort() },
    evidence: {
      perSectionEnergy: sectionEnergy.map((s) => `${s.section.name}:${s.energy.toFixed(3)}`).join(","),
      perSectionTension: sectionEnergy.map((s) => `${s.section.name}:${s.tension.toFixed(3)}`).join(","),
      plannedClimax: plannedClimax ?? "none",
      plannedPeak: plannedPeak.name,
      actualPeak: actualPeak.section.name,
      plannedEnergyRange: plannedRange,
      actualEnergyRange: actualRange,
    },
    suspectedOrigin: "arc",
    originConfidence: 0,
    recommendedRepair: null,
    confidence: confidenceFromCount(context.totalBars, 16),
  });

  const target = plannedClimax ? context.sections.find((s) => s.name === plannedClimax) ?? plannedPeak : plannedPeak;
  const targetEnergy = sectionEnergy.find((s) => s.section === target)!;
  if (actualPeak.section !== target && actualPeak.energy - targetEnergy.energy >= 0.05) {
    const planAgrees = plannedPeak === target;
    drafts.push({
      kind: "climax_misplaced",
      severity: "major",
      location: { startBar: actualPeak.section.startBar, endBar: actualPeak.section.endBar, sectionName: actualPeak.section.name, trackIds: context.parts.map((p) => p.id).sort() },
      evidence: { plannedClimax: target.name, actualPeak: actualPeak.section.name, actualPeakEnergy: actualPeak.energy, plannedClimaxEnergy: targetEnergy.energy, planPeaksAtClimax: planAgrees },
      suspectedOrigin: planAgrees ? "compose" : "arc",
      originConfidence: confidenceFromCount(context.totalBars, 12, planAgrees ? 0.75 : 0.85),
      recommendedRepair: { operation: "move_energy_peak_to_climax", scope: "plan", detail: `the notes peak in ${actualPeak.section.name} (${actualPeak.energy.toFixed(2)}) while the plan's climax is ${target.name} (${targetEnergy.energy.toFixed(2)})` },
      confidence: confidenceFromCount(context.totalBars, 16),
    });
  }

  // Build into the climax: the four bars before it vs the four before those.
  if (target.startBar > 8) {
    const window = (from: number, to: number) => mean(Array.from({ length: to - from + 1 }, (_, i) => byBar.get(from + i)?.energy ?? 0));
    const approach = window(target.startBar - 4, target.startBar - 1);
    const earlier = window(target.startBar - 8, target.startBar - 5);
    if (approach <= earlier + 0.01 && targetEnergy.energy > approach) {
      drafts.push({
        kind: "no_build_into_climax",
        severity: "minor",
        location: { startBar: target.startBar - 8, endBar: target.startBar - 1, trackIds: context.parts.map((p) => p.id).sort() },
        evidence: { approachEnergy: approach, earlierEnergy: earlier, climaxEnergy: targetEnergy.energy, climax: target.name },
        suspectedOrigin: "compose",
        originConfidence: confidenceFromCount(8, 6, 0.7),
        recommendedRepair: { operation: "write_a_build", scope: "section", detail: `energy does not rise across the eight bars before ${target.name} (${earlier.toFixed(2)} -> ${approach.toFixed(2)})` },
        confidence: confidenceFromCount(8, 8),
      });
    }
  }

  // Release after the climax (unless it closes the song).
  const climaxIndex = context.sections.indexOf(target);
  if (climaxIndex >= 0 && climaxIndex < context.sections.length - 1) {
    const after = sectionEnergy[climaxIndex + 1];
    if (after.energy >= targetEnergy.energy - 0.02 && after.tension >= targetEnergy.tension - 0.02) {
      drafts.push({
        kind: "no_release_after_climax",
        severity: "minor",
        location: { startBar: after.section.startBar, endBar: after.section.endBar, sectionName: after.section.name, trackIds: context.parts.map((p) => p.id).sort() },
        evidence: { climaxEnergy: targetEnergy.energy, afterEnergy: after.energy, climaxTension: targetEnergy.tension, afterTension: after.tension },
        suspectedOrigin: "arc",
        originConfidence: confidenceFromCount(after.section.endBar - after.section.startBar + 1, 6, 0.7),
        recommendedRepair: { operation: "release_after_climax", scope: "section", detail: `${after.section.name} keeps the climax's energy and tension instead of releasing` },
        confidence: confidenceFromCount(after.section.endBar - after.section.startBar + 1, 6),
      });
    }
  }

  if (actualRange < 0.08) {
    const planFlat = plannedRange < 0.15;
    drafts.push({
      kind: planFlat ? "flat_arc_by_plan" : "flat_arc",
      severity: planFlat ? "minor" : "major",
      location: { startBar: 1, endBar: context.totalBars, trackIds: context.parts.map((p) => p.id).sort() },
      evidence: { actualEnergyRange: actualRange, plannedEnergyRange: plannedRange, sections: context.sections.length },
      suspectedOrigin: planFlat ? "arc" : "compose",
      originConfidence: confidenceFromCount(context.sections.length, 3, 0.8),
      recommendedRepair: planFlat
        ? { operation: "plan_an_arc", scope: "plan", detail: `the plan's energies span ${plannedRange.toFixed(2)}; the notes follow` }
        : { operation: "realise_the_arc", scope: "plan", detail: `the notes' energy spans ${actualRange.toFixed(2)} across sections while the plan spans ${plannedRange.toFixed(2)}` },
      confidence: confidenceFromCount(context.totalBars, 16),
    });
  }

  return buildReport({ dimension: ARC_DIMENSION, version: ARC_VERSION, context, drafts, coverage: round(context.parts.length ? 1 : 0) });
}

export const emotionalArcAndTensionDimension: CriticDimension = {
  dimension: ARC_DIMENSION,
  version: ARC_VERSION,
  evaluate: evaluateEmotionalArcAndTension,
};
