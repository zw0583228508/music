/**
 * Adversarial critic — arbitrariness (Brain B-05b).
 *
 * Changes without musical cause: a register that jumps an octave mid-phrase,
 * a family that enters or leaves in the middle of a phrase, texture density
 * that doubles or halves off the form - and the plan's own arbitrariness: a
 * family the plan assigned that never wrote a note.
 */
import type { CriticDimensionReport, CriticInput, CriticObservation } from "../types";
import {
  buildReport, cellCoverage, confidenceFromEvidence, effectPast, makeObservation, mean, mergeRuns, notApplicable,
  prepare, type BarGrid, type SectionInfo, type ControlStatus,
} from "./shared";

export const ARBITRARINESS_DIMENSION = "adversarial.arbitrariness" as const;
export const ARBITRARINESS_VERSION = "ADVERSARIAL_ARBITRARINESS_v1" as const;

export const ARBITRARINESS_KINDS = [
  "unmotivated_register_jump", "mid_phrase_entry", "mid_phrase_exit", "density_change_off_form", "planned_family_silent",
] as const;

/** Semitones of mean-pitch change between consecutive bars that reads as a jump. */
const JUMP_SEMITONES = 12;
/** Bars per phrase when the plan has no phrase list. */
const DEFAULT_PHRASE_BARS = 4;
/** Ratio between consecutive bars' onset totals that reads as a density jump. */
const DENSITY_RATIO = 2;
const MIN_ONSETS_FOR_DENSITY = 6;
const DENSITY_SHARE_MINOR = 0.1;

/** Bars on which a change is expected: section starts and phrase starts. */
function formBoundaries(input: CriticInput, sections: readonly SectionInfo[], grid: BarGrid): Set<number> {
  const out = new Set<number>();
  for (const s of sections) {
    out.add(s.startBar);
    out.add(s.endBar + 1);
    for (let b = s.startBar; b <= s.endBar; b += DEFAULT_PHRASE_BARS) out.add(b);
  }
  for (const phrase of input.plan.sectionPlan?.phrases ?? []) out.add(phrase.startBar);
  out.add(grid.bars[grid.bars.length - 1].bar + 1);
  return out;
}

export function critiqueArbitrariness(input: CriticInput, options: { controlStatus?: ControlStatus } = {}): CriticDimensionReport {
  const prep = prepare(input);
  if ("reason" in prep) return notApplicable(ARBITRARINESS_DIMENSION, ARBITRARINESS_VERSION, prep.reason, options.controlStatus);
  const { grid, sections, parts } = prep;
  const observations: CriticObservation[] = [];
  const obs = (draft: Parameters<typeof makeObservation>[0]) => observations.push(makeObservation(draft, sections));
  const boundaries = formBoundaries(input, sections, grid);
  const assignments = input.plan.sectionPlan?.roleAssignments ?? [];
  const firstBar = grid.bars[0].bar;

  for (const part of parts) {
    // 1. Register jumps between consecutive active bars, off the form.
    if (!part.percussion) {
      const jumps: number[] = [];
      const deltas: number[] = [];
      for (let i = 1; i < part.activeBars.length; i += 1) {
        const bar = part.activeBars[i];
        const previous = part.activeBars[i - 1];
        if (bar !== previous + 1 || boundaries.has(bar)) continue;
        const delta = mean(part.byBar.get(bar)!.map((n) => n.pitch)) - mean(part.byBar.get(previous)!.map((n) => n.pitch));
        if (Math.abs(delta) >= JUMP_SEMITONES) { jumps.push(bar); deltas.push(delta); }
      }
      for (const [start, end] of mergeRuns(jumps)) {
        const runDeltas = deltas.filter((_, i) => jumps[i] >= start && jumps[i] <= end);
        const planned = assignments.filter((a) => a.instrument === part.track.instrument && start >= a.entryBar && start <= a.exitBar);
        obs({
          dimension: ARBITRARINESS_DIMENSION, kind: "unmotivated_register_jump", severity: "minor",
          startBar: start - 1, endBar: end, trackIds: [part.id],
          evidence: { meanPitchDeltaSemitones: mean(runDeltas.map(Math.abs)), jumps: runDeltas.length, offFormBoundary: true, plannedRegister: planned[0]?.register ?? "none" },
          confidence: confidenceFromEvidence(runDeltas.length, 2, effectPast(mean(runDeltas.map(Math.abs)), JUMP_SEMITONES / 2, JUMP_SEMITONES)),
          repair: { operation: "hold_register", detail: `${part.id} jumps ${Math.round(mean(runDeltas.map(Math.abs)))} semitones inside a phrase at bar ${start}; keep the register plan within the phrase and move register at phrase or section boundaries.` },
        });
      }
    }

    // 2./3. Entries and exits mid-phrase (on sounding bars; a held chord is not an exit).
    const runs = mergeRuns(part.soundingBars);
    for (const [start, end] of runs) {
      const exitBar = end + 1;
      const planned = assignments.find((a) => a.instrument === part.track.instrument && (a.entryBar === start || a.exitBar === end));
      // An entry in the bar before a boundary is a pickup, not an arbitrary entry.
      const pickup = boundaries.has(start + 1);
      if (start !== firstBar && !boundaries.has(start) && !pickup) {
        // A one-bar gap inside a run is a breath, not an entry.
        const previousRun = runs.find(([, e]) => e === start - 2);
        if (!previousRun) {
          obs({
            dimension: ARBITRARINESS_DIMENSION, kind: "mid_phrase_entry", severity: "minor",
            startBar: start, endBar: start, trackIds: [part.id],
            evidence: { entryBar: start, nearestBoundary: nearest(boundaries, start), plannedEntryBar: planned?.entryBar ?? -1 },
            confidence: confidenceFromEvidence(sections.length, 2, 1),
            repair: { operation: "align_entry", detail: `${part.id} enters at bar ${start}, ${Math.abs(nearest(boundaries, start) - start)} bar(s) from the nearest phrase boundary; move the entry to bar ${nearest(boundaries, start)} or write the pickup that justifies it.` },
            attribution: { layer: "orchestration", planExplains: planned && planned.entryBar === start ? 1 : 0 },
          });
        }
      }
      // Falling silent in the last bar of a phrase is a phrase-end rest, not a mid-phrase exit.
      const phraseEndRest = boundaries.has(exitBar + 1);
      if (exitBar <= grid.bars[grid.bars.length - 1].bar && !boundaries.has(exitBar) && !phraseEndRest) {
        const nextRun = runs.find(([s]) => s === exitBar + 1);
        if (!nextRun) {
          obs({
            dimension: ARBITRARINESS_DIMENSION, kind: "mid_phrase_exit", severity: "minor",
            startBar: end, endBar: exitBar, trackIds: [part.id],
            evidence: { exitBar, nearestBoundary: nearest(boundaries, exitBar), plannedExitBar: planned?.exitBar ?? -1 },
            confidence: confidenceFromEvidence(sections.length, 2, 1),
            repair: { operation: "align_exit", detail: `${part.id} stops after bar ${end}, mid-phrase; let it finish the phrase or make the stop a deliberate break shared by the ensemble.` },
            attribution: { layer: "orchestration", planExplains: planned && planned.exitBar === end ? 1 : 0 },
          });
        }
      }
    }
  }

  // 4. Density changes off the form (arrangement level).
  const totals = grid.bars.map((span) => ({ bar: span.bar, onsets: parts.reduce((s, p) => s + (p.byBar.get(span.bar) ?? []).length, 0) }));
  const offForm: number[] = [];
  const ratios: number[] = [];
  for (let i = 1; i < totals.length; i += 1) {
    const a = totals[i - 1].onsets;
    const b = totals[i].onsets;
    const bar = totals[i].bar;
    if (boundaries.has(bar) || boundaries.has(bar + 1) || Math.max(a, b) < MIN_ONSETS_FOR_DENSITY) continue;
    const ratio = a === 0 ? Infinity : b / a;
    if (ratio >= DENSITY_RATIO || ratio <= 1 / DENSITY_RATIO) { offForm.push(bar); ratios.push(Number.isFinite(ratio) ? ratio : DENSITY_RATIO * 4); }
  }
  const share = totals.length > 1 ? offForm.length / (totals.length - 1) : 0;
  if (share >= DENSITY_SHARE_MINOR) {
    const runs = mergeRuns(offForm);
    obs({
      dimension: ARBITRARINESS_DIMENSION, kind: "density_change_off_form", severity: share >= DENSITY_SHARE_MINOR * 3 ? "major" : "minor",
      startBar: runs[0][0] - 1, endBar: runs[runs.length - 1][1], trackIds: parts.map((p) => p.id),
      evidence: { offFormDensityJumps: offForm.length, shareOfBars: share, meanRatio: mean(ratios.map((r) => (r < 1 ? 1 / r : r))), firstBars: runs.slice(0, 4).map(([s]) => s).join(",") },
      confidence: confidenceFromEvidence(totals.length, 16, effectPast(share, DENSITY_SHARE_MINOR, 0.5)),
      repair: { operation: "align_density_to_form", detail: "Texture doubles or halves between bars inside a phrase; change density at phrase and section boundaries, and let fills be fills (one bar before a boundary)." },
    });
  }

  // 5. The plan assigned a family that never wrote a note (in that section).
  const seen = new Set<string>();
  for (const a of assignments) {
    const section = sections.find((s) => s.name === a.sectionName);
    if (!section) continue;
    const key = `${a.sectionName}:${a.instrument}`;
    if (seen.has(key)) continue;
    seen.add(key);
    const tracks = parts.filter((p) => p.track.instrument.toLowerCase() === a.instrument.toLowerCase());
    const notesInSection = tracks.reduce((s, p) => s + p.soundingBars.filter((b) => b >= section.startBar && b <= section.endBar).length, 0);
    if (notesInSection > 0) continue;
    const mandatory = (section.role === "chorus" || section.role === "verse" || section.role === "instrumental") && section.energy > 0.15;
    const severity = a.role === "LEAD" || mandatory ? "blocking" : "major";
    obs({
      dimension: ARBITRARINESS_DIMENSION, kind: "planned_family_silent", severity,
      startBar: section.startBar, endBar: section.endBar, trackIds: tracks.map((p) => p.id),
      evidence: { instrument: a.instrument, plannedRole: a.role, plannedEntryBar: a.entryBar, plannedExitBar: a.exitBar, activeBarsInSection: 0, trackExists: tracks.length > 0, mandatorySection: mandatory },
      confidence: confidenceFromEvidence(section.endBar - section.startBar + 1, 1, 1),
      repair: { operation: "compose_planned_part", detail: `The plan assigns ${a.instrument} as ${a.role} in "${a.sectionName}" (bars ${a.entryBar}-${a.exitBar}) and nothing was written; either compose it or remove it from the plan with a reason.` },
      attribution: { layer: "orchestration", planExplains: 0 },
    });
  }

  return buildReport({
    dimension: ARBITRARINESS_DIMENSION, version: ARBITRARINESS_VERSION, observations,
    coverage: cellCoverage(parts, grid), controlStatus: options.controlStatus,
  });
}

function nearest(boundaries: Set<number>, bar: number): number {
  let best = bar;
  let bestDistance = Infinity;
  for (const b of boundaries) {
    const d = Math.abs(b - bar);
    if (d < bestDistance || (d === bestDistance && b < best)) { best = b; bestDistance = d; }
  }
  return best;
}
