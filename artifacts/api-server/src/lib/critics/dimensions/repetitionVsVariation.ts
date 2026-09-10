/**
 * Repetition-vs-variation dimension (B-05a): copy detection at two grains.
 * Inside a part, bar-to-bar identity (position + pitch) over a section — a
 * pitched part looping one bar for eight bars is flagged; drums are allowed
 * their loop. Between sections, aligned bar-signature identity per part:
 * same-type sections copied verbatim in every part (identity kept, zero
 * variation — the interpretation belongs to `sectionDevelopment`),
 * same-type sections that share nothing, and *different*-type sections that
 * are indistinguishable (a chorus that is the verse).
 *
 * Suspected origin: section-level copies come from per-section independence
 * in the planner (`form`); one-bar loops inside a part are the composer's
 * (`compose`).
 */
import type { CriticDimension, CriticInput } from "../types";
import {
  barSignature,
  buildContext,
  buildReport,
  confidenceFromCount,
  notApplicable,
  round,
  type CriticContext,
  type ObservationDraft,
  type PartInfo,
  type SectionInfo,
} from "./shared";

export const REPETITION_DIMENSION = "repetitionVsVariation";
export const REPETITION_VERSION = "1.0";

export type SectionPairIdentity = {
  part: PartInfo;
  comparedBars: number;
  exactShare: number;
  /** Identical after a constant transposition (includes exact). */
  transposedShare: number;
  rhythmShare: number;
};

function rhythmOnly(sig: string): string {
  return sig.split(",").filter(Boolean).map((s) => s.split(":")[0]).join(",");
}

function transposedEqual(a: string, b: string): boolean {
  if (!a || !b) return false;
  const pa = a.split(",").map((s) => s.split(":").map(Number));
  const pb = b.split(",").map((s) => s.split(":").map(Number));
  if (pa.length !== pb.length) return false;
  const delta = pb[0][1] - pa[0][1];
  return pa.every((x, i) => pb[i][0] === x[0] && pb[i][1] - x[1] === delta);
}

export function sectionPairIdentity(context: CriticContext, a: SectionInfo, b: SectionInfo): SectionPairIdentity[] {
  const bars = Math.min(a.endBar - a.startBar, b.endBar - b.startBar) + 1;
  const out: SectionPairIdentity[] = [];
  for (const part of context.parts) {
    let compared = 0;
    let exact = 0;
    let transposed = 0;
    let rhythm = 0;
    for (let k = 0; k < bars; k += 1) {
      const sa = barSignature(part.notes, a.startBar + k);
      const sb = barSignature(part.notes, b.startBar + k);
      if (!sa && !sb) continue;
      compared += 1;
      if (sa === sb) exact += 1;
      if (sa === sb || transposedEqual(sa, sb)) transposed += 1;
      if (rhythmOnly(sa) === rhythmOnly(sb)) rhythm += 1;
    }
    if (compared) out.push({ part, comparedBars: compared, exactShare: exact / compared, transposedShare: transposed / compared, rhythmShare: rhythm / compared });
  }
  return out;
}

export function evaluateRepetitionVsVariation(input: CriticInput) {
  const context = buildContext(input);
  if (!context.parts.length) return notApplicable(REPETITION_DIMENSION, REPETITION_VERSION, context, "no parts");
  const drafts: ObservationDraft[] = [];

  // Within-part loops.
  for (const part of context.pitched) {
    for (const section of context.sections) {
      const bars = section.endBar - section.startBar + 1;
      if (bars < 8) continue;
      let compared = 0;
      let repeated = 0;
      for (let bar = section.startBar + 1; bar <= section.endBar; bar += 1) {
        const prev = barSignature(part.notes, bar - 1);
        const cur = barSignature(part.notes, bar);
        if (!prev && !cur) continue;
        compared += 1;
        if (prev === cur) repeated += 1;
      }
      if (compared >= 7 && repeated / compared >= 0.9) {
        drafts.push({
          kind: "loop_without_variation",
          severity: "minor",
          location: { startBar: section.startBar, endBar: section.endBar, sectionName: section.name, trackIds: [part.id] },
          evidence: { barRepetitionShare: repeated / compared, comparedBars: compared },
          suspectedOrigin: "compose",
          originConfidence: confidenceFromCount(repeated, 6, 0.75),
          recommendedRepair: { operation: "vary_the_loop", scope: "section", detail: `${part.instrument} repeats the previous bar exactly in ${repeated} of ${compared} bar pairs across ${section.name}` },
          confidence: confidenceFromCount(compared, 8),
        });
      }
    }
  }

  // Between sections.
  let pairsExamined = 0;
  for (let i = 0; i < context.sections.length; i += 1) {
    for (let j = i + 1; j < context.sections.length; j += 1) {
      const a = context.sections[i];
      const b = context.sections[j];
      const identity = sectionPairIdentity(context, a, b);
      if (!identity.length) continue;
      pairsExamined += 1;
      const sameType = a.function === b.function;
      const allExact = identity.every((x) => x.exactShare >= 0.95) && identity.length >= 2;
      const meanTransposed = identity.reduce((s, x) => s + x.transposedShare, 0) / identity.length;
      const meanRhythm = identity.reduce((s, x) => s + x.rhythmShare, 0) / identity.length;
      const location = { startBar: b.startBar, endBar: b.endBar, sectionName: b.name, trackIds: identity.map((x) => x.part.id).sort() };
      if (sameType && b.function === a.function && j === context.sections.findIndex((s, k) => k > i && s.function === a.function)) {
        drafts.push({
          kind: "measured",
          severity: "info",
          location,
          evidence: { comparedWith: a.name, meanExactShare: identity.reduce((s, x) => s + x.exactShare, 0) / identity.length, meanTransposedShare: meanTransposed, meanRhythmShare: meanRhythm, parts: identity.length },
          suspectedOrigin: "form",
          originConfidence: 0,
          recommendedRepair: null,
          confidence: confidenceFromCount(identity.reduce((s, x) => s + x.comparedBars, 0), 16),
        });
        if (allExact) {
          drafts.push({
            kind: "section_verbatim_copy",
            severity: "minor",
            location,
            evidence: { comparedWith: a.name, parts: identity.length, comparedBars: identity[0].comparedBars },
            suspectedOrigin: "form",
            originConfidence: confidenceFromCount(identity.length, 2, 0.8),
            recommendedRepair: { operation: "apply_section_development", scope: "section", detail: `${b.name} repeats ${a.name} note for note in every part` },
            confidence: confidenceFromCount(identity.reduce((s, x) => s + x.comparedBars, 0), 12),
          });
        } else if (meanTransposed < 0.15 && meanRhythm < 0.3) {
          drafts.push({
            kind: "same_type_sections_unrelated",
            severity: "info",
            location,
            evidence: { comparedWith: a.name, meanTransposedShare: meanTransposed, meanRhythmShare: meanRhythm },
            suspectedOrigin: "form",
            originConfidence: confidenceFromCount(identity.length, 2, 0.6),
            recommendedRepair: null,
            confidence: confidenceFromCount(identity.reduce((s, x) => s + x.comparedBars, 0), 12),
          });
        }
      }
      if (!sameType && allExact) {
        drafts.push({
          kind: "sections_indistinguishable",
          severity: "major",
          location,
          evidence: { comparedWith: a.name, functionA: a.function, functionB: b.function, parts: identity.length },
          suspectedOrigin: "form",
          originConfidence: confidenceFromCount(identity.length, 2, 0.8),
          recommendedRepair: { operation: "differentiate_section_functions", scope: "section", detail: `${b.name} (${b.function}) is note for note ${a.name} (${a.function})` },
          confidence: confidenceFromCount(identity.reduce((s, x) => s + x.comparedBars, 0), 12),
        });
      }
    }
  }

  return buildReport({
    dimension: REPETITION_DIMENSION,
    version: REPETITION_VERSION,
    context,
    drafts,
    coverage: context.sections.length >= 2 ? round(Math.min(1, pairsExamined / ((context.sections.length * (context.sections.length - 1)) / 2))) : 0.5,
  });
}

export const repetitionVsVariationDimension: CriticDimension = {
  dimension: REPETITION_DIMENSION,
  version: REPETITION_VERSION,
  evaluate: evaluateRepetitionVsVariation,
};
