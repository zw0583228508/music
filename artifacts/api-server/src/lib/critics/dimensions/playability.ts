/**
 * Playability dimension (B-05a): a thin wrapper over the calibrated
 * constraint engine (`musicalConstraints.ts`, false positives measured on
 * 30,570 human windows in PR-61). Nothing is re-judged here: each violation
 * becomes an observation located to its bar, with the engine's suggested fix
 * as the repair. `unrealistic_repetition` is a documented false positive on
 * human parts and is carried as `info`.
 *
 * Suspected origin: `compose` for composition input; the caller that
 * evaluates performed notes should read the same observation as `perform`
 * (the wrapper cannot tell which notes it was given, and says so in the
 * evidence).
 */
import { checkArrangementConstraints } from "../../musicalConstraints";
import type { CriticDimension, CriticInput } from "../types";
import { buildContext, buildReport, confidenceFromCount, notApplicable, type ObservationDraft } from "./shared";

export const PLAYABILITY_DIMENSION = "playability";
export const PLAYABILITY_VERSION = "1.0";

const FALSE_POSITIVE_WARNINGS = new Set(["unrealistic_repetition"]);

export function evaluatePlayability(input: CriticInput) {
  const context = buildContext(input);
  if (!context.parts.length) return notApplicable(PLAYABILITY_DIMENSION, PLAYABILITY_VERSION, context, "no parts");
  const tempoBpm = context.songModel.tempoMap?.[0]?.bpm ?? 120;
  const report = checkArrangementConstraints(
    input.trackModels.filter((t) => t.notes.length > 0).map((t) => ({
      id: t.id, instrument: t.instrument, role: t.role, instrumentDefinition: t.instrumentDefinition,
      notes: t.notes, articulations: t.articulations,
    })),
    { tempoBpm },
  );
  const drafts: ObservationDraft[] = [];
  const performed = input.trackModels.some((t) => Boolean(t.performanceEvidence));
  for (const track of report.byTrack) {
    const byCode = new Map<string, number>();
    for (const v of track.violations) byCode.set(v.code, (byCode.get(v.code) ?? 0) + 1);
    drafts.push({
      kind: "measured",
      severity: "info",
      location: { startBar: 1, endBar: context.totalBars, trackIds: [track.trackId] },
      evidence: { feasible: track.feasible, errors: track.violations.filter((v) => v.severity === "error").length, warnings: track.violations.filter((v) => v.severity === "warning").length, family: track.family, codes: [...byCode.entries()].sort().map(([c, n]) => `${c}:${n}`).join(",") || "none", performedInput: performed },
      suspectedOrigin: performed ? "perform" : "compose",
      originConfidence: 0,
      recommendedRepair: null,
      confidence: confidenceFromCount(context.parts.find((p) => p.id === track.trackId)?.notes.length ?? 0, 16),
    });
    for (const v of track.violations) {
      const startBar = context.barAt(v.startSeconds);
      const endBar = v.endSeconds === null ? startBar : context.barAt(Math.max(v.startSeconds, v.endSeconds - 1e-3));
      const severity = v.severity === "error" ? "major" : FALSE_POSITIVE_WARNINGS.has(v.code) ? "info" : "minor";
      drafts.push({
        kind: v.code,
        severity,
        location: { startBar, endBar, sectionName: context.sectionOfBar(startBar)?.name, trackIds: [track.trackId] },
        evidence: { engineSeverity: v.severity, family: v.family, notes: v.noteIds.length, message: v.message, startSeconds: v.startSeconds },
        suspectedOrigin: performed ? "perform" : "compose",
        originConfidence: confidenceFromCount(v.noteIds.length, 2, 0.85),
        recommendedRepair: { operation: v.code, scope: "note", detail: v.suggestedFix },
        confidence: confidenceFromCount(v.noteIds.length, 2, 0.95),
      });
    }
    const errors = track.violations.filter((v) => v.severity === "error");
    if (errors.length >= 3) {
      const bars = errors.map((v) => context.barAt(v.startSeconds));
      drafts.push({
        kind: "part_unplayable",
        severity: "blocking",
        location: { startBar: Math.min(...bars), endBar: Math.max(...bars), trackIds: [track.trackId] },
        evidence: { errors: errors.length, codes: [...new Set(errors.map((v) => v.code))].sort().join(",") },
        suspectedOrigin: performed ? "perform" : "compose",
        originConfidence: confidenceFromCount(errors.length, 3, 0.9),
        recommendedRepair: { operation: "playability_repair", scope: "part", detail: `${track.instrument} carries ${errors.length} playability errors; run the playability repair and re-critique` },
        confidence: confidenceFromCount(errors.length, 3),
      });
    }
  }
  return buildReport({ dimension: PLAYABILITY_DIMENSION, version: PLAYABILITY_VERSION, context, drafts, coverage: 1 });
}

export const playabilityDimension: CriticDimension = {
  dimension: PLAYABILITY_DIMENSION,
  version: PLAYABILITY_VERSION,
  evaluate: evaluatePlayability,
};
