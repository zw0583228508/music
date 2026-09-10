/**
 * Density dimension (B-05a): notes per bar and simultaneous voices per
 * section and part, judged against the section's planned energy/density and
 * against its neighbours — a chorus thinner than the verse before it, a bed
 * that is a single line, a comping part with fewer than one onset a bar in a
 * dense section, a part far busier than its family ever is, holes in the
 * foundation (bass/drums bars with no onset inside an active section), and a
 * song whose density never moves while the plan's energy does.
 *
 * Suspected origin: when the plan's own targets are flat the arc is the
 * cause (`arc`); when the plan varies and the notes do not, the composer or
 * the density multiplier is (`compose`).
 */
import type { CriticDimension, CriticInput } from "../types";
import {
  buildContext,
  buildReport,
  confidenceFromCount,
  mean,
  notApplicable,
  onsetClusters,
  roleInSection,
  round,
  stddev,
  type CriticContext,
  type ObservationDraft,
  type PartInfo,
} from "./shared";

export const DENSITY_DIMENSION = "density";
export const DENSITY_VERSION = "1.0";

const COMPING_ROLES = new Set(["RHYTHMIC_HARMONY", "OSTINATO", "GROOVE"]);
const BED_ROLES = new Set(["HARMONIC_BED", "PAD", "CLIMAX_LAYER"]);

export type SectionDensity = {
  onsetsPerBar: number;
  pitchedOnsetsPerBar: number;
  meanVoices: number;
  activeParts: number;
  perPart: Array<{ part: PartInfo; onsetsPerBar: number; meanVoices: number; emptyBars: number; bars: number }>;
};

export function sectionDensity(context: CriticContext, startBar: number, endBar: number): SectionDensity {
  const bars = Math.max(1, endBar - startBar + 1);
  const perPart = context.parts.map((part) => {
    const notes = context.notesInBars(part, startBar, endBar);
    const clusters = onsetClusters(notes);
    // A bar counts as covered when a note sounds in it: an onset or a sustain.
    const covered = new Set<number>();
    for (const n of part.notes) {
      const last = context.barAt(Math.max(n.start, n.end - 1e-3));
      for (let b = Math.max(startBar, n.bar); b <= Math.min(endBar, last); b += 1) covered.add(b);
    }
    return { part, onsetsPerBar: clusters.length / bars, meanVoices: clusters.length ? mean(clusters.map((c) => c.length)) : 0, emptyBars: notes.length ? bars - covered.size : bars, bars };
  }).filter((p) => p.onsetsPerBar > 0);
  return {
    onsetsPerBar: perPart.reduce((s, p) => s + p.onsetsPerBar, 0),
    pitchedOnsetsPerBar: perPart.filter((p) => !p.part.percussive).reduce((s, p) => s + p.onsetsPerBar, 0),
    meanVoices: perPart.length ? mean(perPart.map((p) => p.meanVoices)) : 0,
    activeParts: perPart.length,
    perPart,
  };
}

export function evaluateDensity(input: CriticInput) {
  const context = buildContext(input);
  if (!context.parts.length) return notApplicable(DENSITY_DIMENSION, DENSITY_VERSION, context, "no parts");
  const drafts: ObservationDraft[] = [];
  const densities = context.sections.map((s) => ({ section: s, d: sectionDensity(context, s.startBar, s.endBar) }));

  for (const { section, d } of densities) {
    const bars = section.endBar - section.startBar + 1;
    const beats = context.barInfo(section.startBar)?.beats ?? 4;
    drafts.push({
      kind: "measured",
      severity: "info",
      location: { startBar: section.startBar, endBar: section.endBar, sectionName: section.name, trackIds: d.perPart.map((p) => p.part.id).sort() },
      evidence: {
        onsetsPerBar: d.onsetsPerBar,
        pitchedOnsetsPerBar: d.pitchedOnsetsPerBar,
        meanVoices: d.meanVoices,
        activeParts: d.activeParts,
        plannedEnergy: section.energy,
        plannedDensity: section.density ?? -1,
        perPart: d.perPart.map((p) => `${p.part.instrument}:${p.onsetsPerBar.toFixed(1)}`).join(","),
      },
      suspectedOrigin: "compose",
      originConfidence: 0,
      recommendedRepair: null,
      confidence: confidenceFromCount(Math.round(d.onsetsPerBar * bars), 24),
    });

    for (const p of d.perPart) {
      const role = roleInSection(p.part, section.name);
      const location = { startBar: section.startBar, endBar: section.endBar, sectionName: section.name, trackIds: [p.part.id] };
      const plannedDensity = section.density ?? section.energy;
      if (!p.part.percussive && bars >= 4) {
        if (COMPING_ROLES.has(role) && p.onsetsPerBar < 1 && plannedDensity >= 0.5) {
          drafts.push({
            kind: "part_sparse_in_dense_section",
            severity: "minor",
            location,
            evidence: { onsetsPerBar: p.onsetsPerBar, plannedDensity, role },
            suspectedOrigin: "compose",
            originConfidence: confidenceFromCount(bars, 6, 0.7),
            recommendedRepair: { operation: "restore_comping_rhythm", scope: "section", detail: `${p.part.instrument} (${role}) plays ${p.onsetsPerBar.toFixed(2)} onsets per bar in ${section.name}, planned density ${plannedDensity.toFixed(2)}` },
            confidence: confidenceFromCount(bars, 6),
          });
        }
        if (COMPING_ROLES.has(role) && p.onsetsPerBar >= 1 && p.onsetsPerBar < 0.5 * beats) {
          drafts.push({
            kind: "comping_below_role_floor",
            severity: "minor",
            location,
            evidence: { onsetsPerBar: p.onsetsPerBar, onsetsPerBeat: p.onsetsPerBar / beats, role },
            suspectedOrigin: "compose",
            originConfidence: confidenceFromCount(bars, 6, 0.65),
            recommendedRepair: { operation: "restore_comping_rhythm", scope: "section", detail: `${p.part.instrument} (${role}) strikes ${(p.onsetsPerBar / beats).toFixed(2)} times per beat in ${section.name}; a comping part states at least every other beat` },
            confidence: confidenceFromCount(Math.round(p.onsetsPerBar * bars), 8),
          });
        }
        if (BED_ROLES.has(role) && p.meanVoices > 1.2 && p.meanVoices < 2 && p.part.family !== "brass" && p.part.family !== "winds" && p.part.maxVoices >= 3) {
          drafts.push({
            kind: "bed_thin_voicing",
            severity: "minor",
            location,
            evidence: { meanVoices: p.meanVoices, onsetsPerBar: p.onsetsPerBar, role },
            suspectedOrigin: "compose",
            originConfidence: confidenceFromCount(Math.round(p.onsetsPerBar * bars), 6, 0.7),
            recommendedRepair: { operation: "voice_the_bed", scope: "section", detail: `${p.part.instrument} in a bed role averages ${p.meanVoices.toFixed(2)} voices per onset in ${section.name}` },
            confidence: confidenceFromCount(Math.round(p.onsetsPerBar * bars), 6),
          });
        }
        if (BED_ROLES.has(role) && p.meanVoices <= 1.2 && p.part.family !== "brass" && p.part.family !== "winds" && p.part.maxVoices >= 3) {
          drafts.push({
            kind: "bed_single_voice",
            severity: "minor",
            location,
            evidence: { meanVoices: p.meanVoices, onsetsPerBar: p.onsetsPerBar, role },
            suspectedOrigin: "compose",
            originConfidence: confidenceFromCount(Math.round(p.onsetsPerBar * bars), 6, 0.75),
            recommendedRepair: { operation: "voice_the_bed", scope: "section", detail: `${p.part.instrument} in a bed role plays ${p.meanVoices.toFixed(2)} voices per onset in ${section.name}` },
            confidence: confidenceFromCount(Math.round(p.onsetsPerBar * bars), 6),
          });
        }
        if (p.onsetsPerBar >= 3.5 * beats) {
          drafts.push({
            kind: "part_overdense",
            severity: p.onsetsPerBar >= 6 * beats ? "major" : "minor",
            location,
            evidence: { onsetsPerBar: p.onsetsPerBar, beatsPerBar: beats },
            suspectedOrigin: "compose",
            originConfidence: confidenceFromCount(Math.round(p.onsetsPerBar * bars), 16, 0.75),
            recommendedRepair: { operation: "thin_part", scope: "section", detail: `${p.part.instrument} attacks ${p.onsetsPerBar.toFixed(1)} times per bar in ${section.name} (${beats} beats)` },
            confidence: confidenceFromCount(Math.round(p.onsetsPerBar * bars), 16),
          });
        }
      }
      // Holes in the foundation.
      if ((p.part.family === "bass" || p.part.family === "drums") && bars >= 4 && p.emptyBars / bars >= 0.2 && p.emptyBars < bars) {
        drafts.push({
          kind: "foundation_gaps",
          severity: p.emptyBars / bars >= 0.4 ? "major" : "minor",
          location,
          evidence: { emptyBars: p.emptyBars, bars, onsetsPerBar: p.onsetsPerBar },
          suspectedOrigin: "compose",
          originConfidence: confidenceFromCount(p.emptyBars, 3, 0.8),
          recommendedRepair: { operation: "fill_foundation_gaps", scope: "section", detail: `${p.part.instrument} has no onset in ${p.emptyBars} of ${bars} bars of ${section.name} although it plays in the section` },
          confidence: confidenceFromCount(bars, 6),
        });
      }
    }
  }

  // Neighbour relations against the plan.
  for (let i = 1; i < densities.length; i += 1) {
    const prev = densities[i - 1];
    const cur = densities[i];
    if (!prev.d.activeParts || !cur.d.activeParts) continue;
    const energyDelta = cur.section.energy - prev.section.energy;
    const ratio = cur.d.onsetsPerBar / Math.max(0.01, prev.d.onsetsPerBar);
    const partsDelta = cur.d.activeParts - prev.d.activeParts;
    const location = { startBar: cur.section.startBar, endBar: cur.section.endBar, sectionName: cur.section.name, trackIds: cur.d.perPart.map((p) => p.part.id).sort() };
    if (energyDelta >= 0.25 && ratio < 0.85 && (partsDelta <= 0 || ratio < 0.6)) {
      drafts.push({
        kind: "louder_section_thinner",
        severity: "major",
        location,
        evidence: { plannedEnergyDelta: energyDelta, onsetsRatio: ratio, activePartsDelta: partsDelta, previousSection: prev.section.name },
        suspectedOrigin: "compose",
        originConfidence: confidenceFromCount(cur.section.endBar - cur.section.startBar + 1, 6, 0.75),
        recommendedRepair: { operation: "raise_density_to_plan", scope: "section", detail: `${cur.section.name} is planned ${energyDelta.toFixed(2)} louder than ${prev.section.name} but carries ${Math.round(ratio * 100)} % of its onsets per bar and no extra part` },
        confidence: confidenceFromCount(Math.round((prev.d.onsetsPerBar + cur.d.onsetsPerBar) * 4), 24),
      });
    } else if (energyDelta <= -0.25 && ratio > 1.3 && partsDelta >= 0) {
      drafts.push({
        kind: "quieter_section_denser",
        severity: "minor",
        location,
        evidence: { plannedEnergyDelta: energyDelta, onsetsRatio: ratio, activePartsDelta: partsDelta, previousSection: prev.section.name },
        suspectedOrigin: "compose",
        originConfidence: confidenceFromCount(cur.section.endBar - cur.section.startBar + 1, 6, 0.7),
        recommendedRepair: { operation: "thin_to_plan", scope: "section", detail: `${cur.section.name} is planned quieter than ${prev.section.name} yet ${Math.round(ratio * 100)} % as dense` },
        confidence: confidenceFromCount(Math.round((prev.d.onsetsPerBar + cur.d.onsetsPerBar) * 4), 24),
      });
    }
  }

  // Flat density across the song vs a moving plan.
  const withParts = densities.filter((x) => x.d.activeParts > 0);
  if (withParts.length >= 3) {
    const values = withParts.map((x) => x.d.onsetsPerBar);
    const cv = mean(values) ? stddev(values) / mean(values) : 0;
    const energies = withParts.map((x) => x.section.energy);
    const plannedRange = Math.max(...energies) - Math.min(...energies);
    if (cv < 0.1 && plannedRange >= 0.3) {
      drafts.push({
        kind: "density_flat_against_plan",
        severity: "major",
        location: { startBar: 1, endBar: context.totalBars, trackIds: context.parts.map((p) => p.id).sort() },
        evidence: { onsetsPerBarCv: cv, plannedEnergyRange: plannedRange, sections: withParts.length },
        suspectedOrigin: "compose",
        originConfidence: confidenceFromCount(withParts.length, 3, 0.7),
        recommendedRepair: { operation: "realise_density_arc", scope: "plan", detail: `onsets per bar vary by ${Math.round(cv * 100)} % across ${withParts.length} sections while the planned energy spans ${plannedRange.toFixed(2)}` },
        confidence: confidenceFromCount(withParts.length, 4),
      });
    } else if (cv < 0.1 && plannedRange < 0.15) {
      drafts.push({
        kind: "density_flat_by_plan",
        severity: "minor",
        location: { startBar: 1, endBar: context.totalBars, trackIds: [] },
        evidence: { onsetsPerBarCv: cv, plannedEnergyRange: plannedRange, sections: withParts.length },
        suspectedOrigin: "arc",
        originConfidence: confidenceFromCount(withParts.length, 3, 0.75),
        recommendedRepair: { operation: "plan_an_arc", scope: "plan", detail: `the plan itself asks for near-constant energy (range ${plannedRange.toFixed(2)}) and the notes follow it` },
        confidence: confidenceFromCount(withParts.length, 4),
      });
    }
  }

  return buildReport({
    dimension: DENSITY_DIMENSION,
    version: DENSITY_VERSION,
    context,
    drafts,
    coverage: round(withParts.length / Math.max(1, context.sections.length)),
  });
}

export const densityDimension: CriticDimension = {
  dimension: DENSITY_DIMENSION,
  version: DENSITY_VERSION,
  evaluate: evaluateDensity,
};
