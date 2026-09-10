/**
 * Rhythmic-interaction dimension (B-05a): how the parts fill the grid
 * *together* — locked (same onsets), interlocking (complementary onsets),
 * independent — per section and per pair, plus two ensemble failures:
 * a homorhythmic texture (every pitched part hitting the same onsets) and
 * grid saturation (everyone active on nearly every eighth, no air).
 *
 * Suspected origin: each part is composed against a request that carries
 * sibling onsets only as counts, so locked and saturated textures are the
 * composer contract's (`compose`); a texture the section plan asked to be
 * full in every part is the plan's (`orchestration`).
 */
import type { CriticDimension, CriticInput } from "../types";
import {
  buildContext,
  buildReport,
  confidenceFromCount,
  gridDeviation,
  mean,
  notApplicable,
  round,
  topVoice,
  type CriticContext,
  type NoteRef,
  type ObservationDraft,
  type PartInfo,
} from "./shared";

export const RHYTHMIC_INTERACTION_DIMENSION = "rhythmicInteraction";
export const RHYTHMIC_INTERACTION_VERSION = "1.0";

const STEPS_PER_BEAT = 2;

/** Eighth-note onset steps per bar for a part inside a bar range. */
function onsetSteps(context: CriticContext, notes: readonly NoteRef[], bar: number): Set<number> {
  const info = context.barInfo(bar);
  const steps = new Set<number>();
  if (!info) return steps;
  for (const n of notes) {
    if (n.bar !== bar) continue;
    const step = gridDeviation(n, STEPS_PER_BEAT).step;
    steps.add(Math.max(0, Math.min(info.beats * STEPS_PER_BEAT - 1, step)));
  }
  return steps;
}

function jaccard(a: Set<number>, b: Set<number>): number | null {
  if (!a.size && !b.size) return null;
  let inter = 0;
  for (const s of a) if (b.has(s)) inter += 1;
  return inter / (a.size + b.size - inter);
}

export type PairRelation = { a: PartInfo; b: PartInfo; jaccard: number; bars: number; registersOverlap: boolean; pitchDoublingShare: number; kind: "locked" | "interlocking" | "independent" };

/** Share of shared onsets whose top voices sit a unison or octaves apart. */
function pitchDoublingShare(context: CriticContext, a: PartInfo, b: PartInfo, startBar: number, endBar: number): number {
  const topA = topVoice(context.notesInBars(a, startBar, endBar));
  const topB = topVoice(context.notesInBars(b, startBar, endBar));
  let shared = 0;
  let doubled = 0;
  let j = 0;
  for (const na of topA) {
    while (j < topB.length && topB[j].start < na.start - 0.04) j += 1;
    if (j < topB.length && Math.abs(topB[j].start - na.start) <= 0.04) {
      shared += 1;
      if ((na.pitch - topB[j].pitch) % 12 === 0) doubled += 1;
    }
  }
  return shared >= 4 ? doubled / shared : 0;
}

export function pairRelations(context: CriticContext, parts: readonly PartInfo[], startBar: number, endBar: number): PairRelation[] {
  const out: PairRelation[] = [];
  for (let i = 0; i < parts.length; i += 1) {
    for (let j = i + 1; j < parts.length; j += 1) {
      const a = parts[i];
      const b = parts[j];
      const values: number[] = [];
      for (let bar = startBar; bar <= endBar; bar += 1) {
        const j1 = jaccard(onsetSteps(context, a.notes, bar), onsetSteps(context, b.notes, bar));
        if (j1 !== null) values.push(j1);
      }
      if (values.length < 2) continue;
      const jac = mean(values);
      const aPitches = context.notesInBars(a, startBar, endBar).map((n) => n.pitch);
      const bPitches = context.notesInBars(b, startBar, endBar).map((n) => n.pitch);
      const registersOverlap = aPitches.length > 0 && bPitches.length > 0 &&
        Math.min(...aPitches) <= Math.max(...bPitches) && Math.min(...bPitches) <= Math.max(...aPitches);
      out.push({ a, b, jaccard: jac, bars: values.length, registersOverlap, pitchDoublingShare: (a.percussive || b.percussive) ? 0 : pitchDoublingShare(context, a, b, startBar, endBar), kind: jac >= 0.75 ? "locked" : jac <= 0.25 ? "interlocking" : "independent" });
    }
  }
  return out;
}

export function evaluateRhythmicInteraction(input: CriticInput) {
  const context = buildContext(input);
  if (context.parts.length < 2) return notApplicable(RHYTHMIC_INTERACTION_DIMENSION, RHYTHMIC_INTERACTION_VERSION, context, "fewer than two parts: no interaction to read");
  const drafts: ObservationDraft[] = [];
  let sectionsExamined = 0;

  for (const section of context.sections) {
    const bars = section.endBar - section.startBar + 1;
    const active = context.parts.filter((p) => context.notesInBars(p, section.startBar, section.endBar).length >= 4);
    if (active.length < 2) continue;
    sectionsExamined += 1;
    const relations = pairRelations(context, active, section.startBar, section.endBar);
    const location = { startBar: section.startBar, endBar: section.endBar, sectionName: section.name, trackIds: active.map((p) => p.id).sort() };
    const kinds = { locked: 0, interlocking: 0, independent: 0 };
    for (const r of relations) kinds[r.kind] += 1;
    drafts.push({
      kind: "measured",
      severity: "info",
      location,
      evidence: { pairs: relations.length, locked: kinds.locked, interlocking: kinds.interlocking, independent: kinds.independent, meanPairJaccard: relations.length ? mean(relations.map((r) => r.jaccard)) : -1 },
      suspectedOrigin: "compose",
      originConfidence: 0,
      recommendedRepair: null,
      confidence: confidenceFromCount(relations.length * bars, 24),
    });

    // A pitched part locked to another part in the same register.
    for (const r of relations) {
      if (r.a.percussive && r.b.percussive) continue;
      if (r.jaccard >= 0.85 && r.bars >= 4 && (r.registersOverlap || r.pitchDoublingShare >= 0.8) && !(r.a.percussive || r.b.percussive)) {
        drafts.push({
          kind: r.pitchDoublingShare >= 0.8 ? "part_doubles_part" : "part_locked_to_part",
          severity: r.jaccard >= 0.95 && r.bars >= 8 ? "major" : "minor",
          location: { startBar: section.startBar, endBar: section.endBar, sectionName: section.name, trackIds: [r.a.id, r.b.id].sort() },
          evidence: { jaccard: r.jaccard, bars: r.bars, registersOverlap: r.registersOverlap, pitchDoublingShare: r.pitchDoublingShare },
          suspectedOrigin: "compose",
          originConfidence: confidenceFromCount(r.bars, 4, 0.75),
          recommendedRepair: { operation: "differentiate_rhythms", scope: "section", detail: `${r.a.instrument} and ${r.b.instrument} share ${Math.round(r.jaccard * 100)} % of their eighth-note onsets in the same register across ${section.name}` },
          confidence: confidenceFromCount(r.bars, 6),
        });
      }
    }

    // Homorhythmic texture among pitched parts that actually move (at least one onset a bar).
    const pitchedActive = active.filter((p) => !p.percussive && context.notesInBars(p, section.startBar, section.endBar).length >= bars);
    if (pitchedActive.length >= 3) {
      const pitchedRelations = relations.filter((r) => !r.a.percussive && !r.b.percussive);
      const meanJ = mean(pitchedRelations.map((r) => r.jaccard));
      if (pitchedRelations.length && meanJ >= 0.7) {
        drafts.push({
          kind: "homorhythmic_texture",
          severity: bars >= 8 ? "major" : "minor",
          location: { startBar: section.startBar, endBar: section.endBar, sectionName: section.name, trackIds: pitchedActive.map((p) => p.id).sort() },
          evidence: { meanPairJaccard: meanJ, pitchedParts: pitchedActive.length, bars },
          suspectedOrigin: "compose",
          originConfidence: confidenceFromCount(pitchedRelations.length, 3, 0.7),
          recommendedRepair: { operation: "assign_complementary_rhythm_cells", scope: "section", detail: `${pitchedActive.length} pitched parts hit the same onsets (mean Jaccard ${meanJ.toFixed(2)}) throughout ${section.name}` },
          confidence: confidenceFromCount(bars * pitchedRelations.length, 12),
        });
      }
    }

    // Grid saturation: three or more parts each busy on most eighths of a bar, and nearly every eighth struck.
    if (active.length >= 3 && bars >= 4) {
      let saturatedBars = 0;
      for (let bar = section.startBar; bar <= section.endBar; bar += 1) {
        const info = context.barInfo(bar);
        if (!info) continue;
        const total = info.beats * STEPS_PER_BEAT;
        const union = new Set<number>();
        let busyParts = 0;
        for (const p of active) {
          const steps = onsetSteps(context, p.notes, bar);
          for (const s of steps) union.add(s);
          if (steps.size / total >= 0.6) busyParts += 1;
        }
        if (union.size / total >= 0.9 && busyParts >= 3) saturatedBars += 1;
      }
      if (saturatedBars / bars >= 0.5) {
        drafts.push({
          kind: "grid_saturation",
          severity: saturatedBars / bars >= 0.9 ? "major" : "minor",
          location,
          evidence: { saturatedBarShare: saturatedBars / bars, parts: active.length, bars },
          suspectedOrigin: "compose",
          originConfidence: confidenceFromCount(saturatedBars, 4, 0.7),
          recommendedRepair: { operation: "open_space", scope: "section", detail: `three or more parts are busy on most eighths in ${saturatedBars} of ${bars} bars of ${section.name}; thin or rest one layer` },
          confidence: confidenceFromCount(bars, 6),
        });
      }
    }
  }

  return buildReport({
    dimension: RHYTHMIC_INTERACTION_DIMENSION,
    version: RHYTHMIC_INTERACTION_VERSION,
    context,
    drafts,
    coverage: context.sections.length ? round(sectionsExamined / context.sections.length) : 0,
  });
}

export const rhythmicInteractionDimension: CriticDimension = {
  dimension: RHYTHMIC_INTERACTION_DIMENSION,
  version: RHYTHMIC_INTERACTION_VERSION,
  evaluate: evaluateRhythmicInteraction,
};
