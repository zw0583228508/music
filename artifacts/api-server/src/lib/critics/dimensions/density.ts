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
/** 1.1 (B-05c): `single_voice_bed` (was `bed_single_voice`, minor) and `arrival_thinner_than_setup`. */
export const DENSITY_VERSION = "1.1";

const COMPING_ROLES = new Set(["RHYTHMIC_HARMONY", "OSTINATO", "GROOVE"]);
const BED_ROLES = new Set(["HARMONIC_BED", "PAD", "CLIMAX_LAYER"]);

/** Mean voices per onset at or below which a bed is a solo line, not a chord. */
export const SINGLE_VOICE_BED_CEILING = 1.2;
/** Voices a bed is expected to have: the smallest triad. */
export const BED_MIN_VOICES = 3;

/**
 * `arrival_thinner_than_setup` (B-05c, R-1b P0-4 / item 5 of §7).
 *
 * An arrival is a section the plan makes louder than the one before it. A
 * professional's rule is not "more onsets": it is that an arrival is bigger in
 * *some* of onsets, voices and loudness and smaller in none of them. So the
 * finding needs two of the three ratios to fall and the combined ratio to fall
 * materially — that is why `louder_section_thinner`, which reads onsets alone
 * against one threshold, missed the owner's first chorus (onset ratio 0.80 with
 * a new part entering) and misses a chorus thinned in the harness while its
 * velocities stay put.
 */
export const ARRIVAL_ENERGY_STEP = 0.15;
/** A ratio below this counts as "the arrival is smaller in this respect". */
export const ARRIVAL_RATIO_FLOOR = 0.95;
/** Two of the three must fall, and their geometric mean must be at or below this. */
export const ARRIVAL_COMBINED_FLOOR = 0.92;
export const ARRIVAL_MAJOR_COMBINED = 0.85;

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
        if (BED_ROLES.has(role) && p.meanVoices <= SINGLE_VOICE_BED_CEILING && p.part.family !== "brass" && p.part.family !== "winds" && p.part.maxVoices >= BED_MIN_VOICES) {
          // B-05c: a bed is a chord. One voice is a solo line, and on the
          // owner's song it is a solo line the composer did not write: the
          // perform -> repair cascade dropped 200 of 304 string notes. When the
          // composed notes are in the input the finding says so and blocks;
          // without them it is still a major finding on the shipped notes,
          // because a single-voice "soft strings" bed is not what was asked for.
          const composedVoices = context.composedVoicesOf(p.part, section.startBar, section.endBar);
          const lostDownstream = composedVoices !== null && composedVoices >= BED_MIN_VOICES;
          drafts.push({
            kind: "single_voice_bed",
            severity: lostDownstream ? "blocking" : "major",
            location,
            evidence: {
              meanVoices: p.meanVoices, onsetsPerBar: p.onsetsPerBar, role,
              instrumentMaxVoices: p.part.maxVoices,
              composedMeanVoices: composedVoices ?? -1,
              composedNotesAvailable: composedVoices !== null,
              lostAfterCompose: lostDownstream,
            },
            suspectedOrigin: lostDownstream ? "perform" : "compose",
            originConfidence: confidenceFromCount(Math.round(p.onsetsPerBar * bars), 6, lostDownstream ? 0.9 : 0.75),
            recommendedRepair: lostDownstream
              ? { operation: "keep_the_composed_voices", scope: "part", detail: `${p.part.instrument} was composed with ${composedVoices!.toFixed(2)} voices per onset in ${section.name} and ships with ${p.meanVoices.toFixed(2)}: the voices are lost between the composer and the track, not missing from the writing` }
              : { operation: "voice_the_bed", scope: "section", detail: `${p.part.instrument} holds a bed role in ${section.name} and plays ${p.meanVoices.toFixed(2)} voices per onset; an instrument that can sound ${p.part.maxVoices} is writing a solo line` },
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

  // B-05c: the arrival against its setup, in onsets, voices and loudness at once.
  for (let i = 1; i < densities.length; i += 1) {
    const setup = densities[i - 1];
    const arrival = densities[i];
    if (!setup.d.activeParts || !arrival.d.activeParts) continue;
    const energyDelta = arrival.section.energy - setup.section.energy;
    const plannedArrival = energyDelta >= ARRIVAL_ENERGY_STEP;
    const isPlannedClimax = context.plan.globalPlan?.climax?.sectionName === arrival.section.name;
    if (!plannedArrival && !isPlannedClimax) continue;
    const meanVelocity = (d: typeof arrival.d, s: typeof arrival.section) => {
      const notes = d.perPart.flatMap((p) => context.notesInBars(p.part, s.startBar, s.endBar));
      return notes.length ? mean(notes.map((n) => n.velocity)) : 0;
    };
    const setupVelocity = meanVelocity(setup.d, setup.section);
    const arrivalVelocity = meanVelocity(arrival.d, arrival.section);
    if (!setupVelocity || !setup.d.meanVoices || !setup.d.onsetsPerBar) continue;
    const onsetsRatio = arrival.d.onsetsPerBar / setup.d.onsetsPerBar;
    const voicesRatio = arrival.d.meanVoices / setup.d.meanVoices;
    const velocityRatio = arrivalVelocity / setupVelocity;
    const ratios = [onsetsRatio, voicesRatio, velocityRatio];
    const fell = ratios.filter((r) => r < ARRIVAL_RATIO_FLOOR).length;
    const combined = Math.cbrt(ratios.reduce((a, b) => a * Math.max(0.01, b), 1));
    if (fell < 2 || combined > ARRIVAL_COMBINED_FLOOR) continue;
    drafts.push({
      kind: "arrival_thinner_than_setup",
      severity: combined <= ARRIVAL_MAJOR_COMBINED || isPlannedClimax ? "major" : "minor",
      location: { startBar: arrival.section.startBar, endBar: arrival.section.endBar, sectionName: arrival.section.name, trackIds: arrival.d.perPart.map((p) => p.part.id).sort() },
      evidence: {
        setupSection: setup.section.name, plannedEnergyDelta: energyDelta, plannedClimax: isPlannedClimax,
        onsetsRatio, voicesRatio, velocityRatio, combinedRatio: combined, respectsThatFell: fell,
        setupOnsetsPerBar: setup.d.onsetsPerBar, arrivalOnsetsPerBar: arrival.d.onsetsPerBar,
        setupMeanVoices: setup.d.meanVoices, arrivalMeanVoices: arrival.d.meanVoices,
        setupMeanVelocity: setupVelocity, arrivalMeanVelocity: arrivalVelocity,
      },
      suspectedOrigin: "compose",
      originConfidence: confidenceFromCount(arrival.section.endBar - arrival.section.startBar + 1, 6, 0.8),
      recommendedRepair: {
        operation: "make_the_arrival_arrive", scope: "section",
        detail: `${arrival.section.name} is planned ${energyDelta.toFixed(2)} louder than ${setup.section.name} and arrives with ${Math.round(onsetsRatio * 100)} % of its onsets per bar, ${Math.round(voicesRatio * 100)} % of its voices and ${Math.round(velocityRatio * 100)} % of its velocity`,
      },
      confidence: confidenceFromCount(Math.round((setup.d.onsetsPerBar + arrival.d.onsetsPerBar) * 4), 24),
    });
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
