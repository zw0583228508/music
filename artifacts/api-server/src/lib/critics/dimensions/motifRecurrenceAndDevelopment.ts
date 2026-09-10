/**
 * Motif recurrence & development dimension (B-05a): self-similarity of each
 * part's material across sections. Six-note cells (five intervals + five
 * quantised inter-onset intervals) are taken from the part's top voice; a
 * later section's cells are looked up among all earlier cells and classified
 * as an exact recurrence (same intervals, rhythm and starting pitch), a
 * transposition, a rhythmic variant or a contour-preserving development.
 * Identity ("the material returns") is distinguished from copy ("it returns
 * with nothing changed").
 *
 * Suspected origin: the composer writes each part from the same request
 * without a motif ledger, so absent recurrence is a composition-contract
 * failure (`compose`); recurrence that is *only* verbatim copy is the section
 * planner's lack of development operators (`form`).
 */
import type { CriticDimension, CriticInput } from "../types";
import {
  buildContext,
  buildReport,
  confidenceFromCount,
  notApplicable,
  round,
  topVoice,
  type NoteRef,
  type ObservationDraft,
} from "./shared";

export const MOTIF_DIMENSION = "motifRecurrenceAndDevelopment";
export const MOTIF_VERSION = "1.0";

export type Cell = {
  startBar: number;
  startPitch: number;
  intervals: string;
  rhythm: string;
  contour: string;
};

/**
 * Six notes, not four: under a uniform comping rhythm a four-note cell carries
 * so little information that random walks "recur" by chance (measured on the
 * random-pitch probe); five intervals do not.
 */
export const CELL_NOTES = 6;

export function extractCells(line: readonly NoteRef[]): Cell[] {
  const cells: Cell[] = [];
  for (let i = 0; i + CELL_NOTES - 1 < line.length; i += 1) {
    const w = line.slice(i, i + CELL_NOTES);
    // A cell spans at most four bars of music; longer gaps are not a motif.
    if (w[CELL_NOTES - 1].start - w[0].start > 16 * w[0].beatSeconds) continue;
    const intervals = w.slice(1).map((n, k) => n.pitch - w[k].pitch);
    const rhythm = w.slice(1).map((n, k) => Math.round(((n.start - w[k].start) / w[0].beatSeconds) * 4));
    cells.push({
      startBar: w[0].bar,
      startPitch: w[0].pitch,
      intervals: intervals.join(","),
      rhythm: rhythm.join(","),
      contour: intervals.map((d) => (d > 0 ? "+" : d < 0 ? "-" : "0")).join(""),
    });
  }
  return cells;
}

type Recurrence = "exact" | "transposed" | "rhythmic_variant" | "developed" | "none";

/** A development changes at most one interval, by at most two semitones; anything looser is coincidence. */
function nearIntervals(a: string, b: string): boolean {
  const pa = a.split(",").map(Number);
  const pb = b.split(",").map(Number);
  if (pa.length !== pb.length) return false;
  let changed = 0;
  for (let i = 0; i < pa.length; i += 1) {
    const d = Math.abs(pa[i] - pb[i]);
    if (d > 2) return false;
    if (d > 0) changed += 1;
  }
  return changed <= 1;
}

function classify(cell: Cell, earlier: readonly Cell[]): Recurrence {
  let best: Recurrence = "none";
  const rank: Record<Recurrence, number> = { none: 0, developed: 1, rhythmic_variant: 2, transposed: 3, exact: 4 };
  for (const e of earlier) {
    let r: Recurrence = "none";
    if (e.intervals === cell.intervals && e.rhythm === cell.rhythm) r = e.startPitch === cell.startPitch ? "exact" : "transposed";
    else if (e.intervals === cell.intervals) r = "rhythmic_variant";
    else if (e.rhythm === cell.rhythm && e.contour === cell.contour && nearIntervals(e.intervals, cell.intervals)) r = "developed";
    if (rank[r] > rank[best]) best = r;
    if (best === "exact") break;
  }
  return best;
}

export function evaluateMotif(input: CriticInput) {
  const context = buildContext(input);
  if (context.sections.length < 2) return notApplicable(MOTIF_DIMENSION, MOTIF_VERSION, context, "fewer than two sections: recurrence across sections cannot be measured");
  const parts = context.pitched;
  const lines = parts.map((part) => ({ part, line: topVoice(part.notes) })).filter((l) => l.line.length >= 12);
  if (!lines.length) return notApplicable(MOTIF_DIMENSION, MOTIF_VERSION, context, "no pitched part with twelve or more top-voice notes");
  const strategy = context.plan.globalPlan?.motifStrategy ?? null;
  const drafts: ObservationDraft[] = [];

  for (const { part, line } of lines) {
    const cells = extractCells(line);
    if (cells.length < 4) continue;
    const bySection = context.sections.map((s) => cells.filter((c) => c.startBar >= s.startBar && c.startBar <= s.endBar));
    const counts: Record<Recurrence, number> = { exact: 0, transposed: 0, rhythmic_variant: 0, developed: 0, none: 0 };
    let later = 0;
    let sectionsWithMaterial = 0;
    for (let s = 1; s < context.sections.length; s += 1) {
      const current = bySection[s];
      if (!current.length) continue;
      sectionsWithMaterial += 1;
      const earlier = bySection.slice(0, s).flat();
      if (!earlier.length) continue;
      const section = context.sections[s];
      const local: Record<Recurrence, number> = { exact: 0, transposed: 0, rhythmic_variant: 0, developed: 0, none: 0 };
      for (const cell of current) local[classify(cell, earlier)] += 1;
      for (const k of Object.keys(local) as Recurrence[]) counts[k] += local[k];
      later += current.length;
      const recurring = current.length - local.none;
      const recurrenceShare = recurring / current.length;
      const location = { startBar: section.startBar, endBar: section.endBar, sectionName: section.name, trackIds: [part.id] };
      if (recurrenceShare < 0.15 && current.length >= 4) {
        drafts.push({
          kind: "no_recurrence",
          severity: strategy === "through_composed" ? "info" : "major",
          location,
          evidence: { recurrenceShare, cells: current.length, earlierCells: earlier.length, motifStrategy: strategy ?? "" },
          suspectedOrigin: "compose",
          originConfidence: confidenceFromCount(current.length, 6, 0.8),
          recommendedRepair: { operation: "recall_earlier_material", scope: "section", detail: `${part.instrument} states ${current.length} six-note cells in ${section.name}; ${Math.round(recurrenceShare * 100)} % relate to anything it played before` },
          confidence: confidenceFromCount(current.length, 8),
        });
      } else if (recurring >= 4 && local.exact / recurring >= 0.9) {
        drafts.push({
          kind: "recurrence_is_copy_only",
          severity: "minor",
          location,
          evidence: { exactShare: local.exact / recurring, recurringCells: recurring, transposed: local.transposed, rhythmicVariants: local.rhythmic_variant, developed: local.developed },
          suspectedOrigin: "form",
          originConfidence: confidenceFromCount(recurring, 6, 0.7),
          recommendedRepair: { operation: "apply_development_operator", scope: "section", detail: `${part.instrument}'s material returns in ${section.name} only as a verbatim copy (${recurring} cells); transpose, re-rhythm or invert part of it` },
          confidence: confidenceFromCount(recurring, 8),
        });
      }
    }

    // A cell stated at least three times in the first section with material, never heard again.
    const firstIndex = bySection.findIndex((c) => c.length > 0);
    if (firstIndex >= 0 && firstIndex < context.sections.length - 1) {
      const first = bySection[firstIndex];
      const tally = new Map<string, number>();
      for (const c of first) tally.set(`${c.intervals}|${c.rhythm}`, (tally.get(`${c.intervals}|${c.rhythm}`) ?? 0) + 1);
      const motifs = [...tally.entries()].filter(([, n]) => n >= 3).map(([k]) => k);
      const rest = bySection.slice(firstIndex + 1).flat();
      const abandoned = motifs.filter((m) => !rest.some((c) => `${c.intervals}|${c.rhythm}` === m || c.intervals === m.split("|")[0]));
      if (motifs.length && abandoned.length === motifs.length && rest.length >= 4) {
        const section = context.sections[firstIndex];
        drafts.push({
          kind: "motif_abandoned",
          severity: "minor",
          location: { startBar: section.startBar, endBar: section.endBar, sectionName: section.name, trackIds: [part.id] },
          evidence: { motifsStated: motifs.length, laterCells: rest.length },
          suspectedOrigin: "compose",
          originConfidence: confidenceFromCount(rest.length, 8, 0.7),
          recommendedRepair: { operation: "recall_motif_later", scope: "plan", detail: `${part.instrument} repeats ${motifs.length} cell(s) at least three times in ${section.name} and never returns to them` },
          confidence: confidenceFromCount(rest.length, 10),
        });
      }
    }

    const recurring = later - counts.none;
    drafts.push({
      kind: "measured",
      severity: "info",
      location: { startBar: 1, endBar: context.totalBars, trackIds: [part.id] },
      evidence: {
        cells: cells.length,
        laterSectionCells: later,
        recurrenceShare: later ? recurring / later : -1,
        variationShare: recurring ? (counts.transposed + counts.rhythmic_variant + counts.developed) / recurring : -1,
        exact: counts.exact,
        transposed: counts.transposed,
        rhythmicVariants: counts.rhythmic_variant,
        developed: counts.developed,
        sectionsWithMaterial,
      },
      suspectedOrigin: "compose",
      originConfidence: 0,
      recommendedRepair: null,
      confidence: confidenceFromCount(later, 16),
    });
  }

  if (!drafts.length) return notApplicable(MOTIF_DIMENSION, MOTIF_VERSION, context, "no pitched part states enough six-note cells to compare across sections");
  return buildReport({
    dimension: MOTIF_DIMENSION,
    version: MOTIF_VERSION,
    context,
    drafts,
    coverage: parts.length ? round(lines.length / parts.length) : 0,
  });
}

export const motifDimension: CriticDimension = {
  dimension: MOTIF_DIMENSION,
  version: MOTIF_VERSION,
  evaluate: evaluateMotif,
};
