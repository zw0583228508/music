/**
 * Section-development dimension (B-05a): for every repeated section type
 * (verse → verse 2, chorus → chorus 2 …) — is the identity kept, and in which
 * dimension does the later occurrence develop: instrumentation, density,
 * register, dynamics, rhythm, texture? A repeat with identity and no
 * development at the planned climax is the diagnosis's weakness #2 made
 * measurable; a repeat that develops by velocity alone is named as such.
 *
 * Suspected origin: `form` — the section planner has no memory of the
 * earlier occurrence and no development operator.
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
  type CriticContext,
  type ObservationDraft,
  type SectionInfo,
} from "./shared";
import { sectionPairIdentity } from "./repetitionVsVariation";

export const SECTION_DEVELOPMENT_DIMENSION = "sectionDevelopment";
export const SECTION_DEVELOPMENT_VERSION = "1.0";

export type DevelopmentReading = {
  identityShare: number;
  identityKept: boolean;
  changed: string[];
  instrumentationBefore: string[];
  instrumentationAfter: string[];
  densityRatio: number;
  maxRegisterShift: number;
  velocityShift: number;
  rhythmIdentity: number;
  textureRatio: number;
};

export function readDevelopment(context: CriticContext, prev: SectionInfo, cur: SectionInfo): DevelopmentReading | null {
  const identity = sectionPairIdentity(context, prev, cur);
  const before = context.parts.filter((p) => context.notesInBars(p, prev.startBar, prev.endBar).length > 0);
  const after = context.parts.filter((p) => context.notesInBars(p, cur.startBar, cur.endBar).length > 0);
  if (!before.length || !after.length) return null;
  const shared = identity.filter((x) => before.includes(x.part) && after.includes(x.part));
  const identityShare = shared.length ? mean(shared.map((x) => x.transposedShare)) : 0;
  const rhythmIdentity = shared.length ? mean(shared.map((x) => x.rhythmShare)) : 0;
  const barsPrev = prev.endBar - prev.startBar + 1;
  const barsCur = cur.endBar - cur.startBar + 1;
  const onsets = (sections: SectionInfo, parts: typeof before) => parts.reduce((s, p) => s + onsetClusters(context.notesInBars(p, sections.startBar, sections.endBar)).length, 0);
  const densityRatio = (onsets(cur, after) / barsCur) / Math.max(0.01, onsets(prev, before) / barsPrev);
  let maxRegisterShift = 0;
  for (const p of context.parts) {
    const a = context.notesInBars(p, prev.startBar, prev.endBar).map((n) => n.pitch);
    const b = context.notesInBars(p, cur.startBar, cur.endBar).map((n) => n.pitch);
    if (a.length && b.length) maxRegisterShift = Math.max(maxRegisterShift, Math.abs(mean(b) - mean(a)));
  }
  const vel = (s: SectionInfo, parts: typeof before) => mean(parts.flatMap((p) => context.notesInBars(p, s.startBar, s.endBar).map((n) => n.velocity)));
  const velocityShift = vel(cur, after) - vel(prev, before);
  const voices = (s: SectionInfo, parts: typeof before) => mean(parts.filter((p) => !p.percussive).flatMap((p) => onsetClusters(context.notesInBars(p, s.startBar, s.endBar)).map((c) => c.length)));
  const textureRatio = voices(cur, after) / Math.max(0.01, voices(prev, before));
  const changed: string[] = [];
  const instrumentationBefore = before.map((p) => p.instrument).sort();
  const instrumentationAfter = after.map((p) => p.instrument).sort();
  if (instrumentationBefore.join() !== instrumentationAfter.join()) changed.push("instrumentation");
  if (densityRatio < 0.87 || densityRatio > 1.15) changed.push("density");
  if (maxRegisterShift >= 3) changed.push("register");
  if (Math.abs(velocityShift) >= 5) changed.push("dynamics");
  if (shared.length && rhythmIdentity < 0.7 && identityShare >= 0.3) changed.push("rhythm");
  if (Number.isFinite(textureRatio) && (textureRatio < 0.8 || textureRatio > 1.25)) changed.push("texture");
  return {
    identityShare, identityKept: identityShare >= 0.5 || (rhythmIdentity >= 0.7 && identityShare >= 0.3), changed,
    instrumentationBefore, instrumentationAfter, densityRatio, maxRegisterShift, velocityShift, rhythmIdentity, textureRatio: Number.isFinite(textureRatio) ? textureRatio : 1,
  };
}

export function evaluateSectionDevelopment(input: CriticInput) {
  const context = buildContext(input);
  const repeated = context.sections.filter((s) => s.occurrence >= 2);
  if (!repeated.length) return notApplicable(SECTION_DEVELOPMENT_DIMENSION, SECTION_DEVELOPMENT_VERSION, context, "no section type occurs twice");
  if (!context.parts.length) return notApplicable(SECTION_DEVELOPMENT_DIMENSION, SECTION_DEVELOPMENT_VERSION, context, "no parts");
  const drafts: ObservationDraft[] = [];
  const climax = context.plan.globalPlan?.climax?.sectionName ?? null;
  let examined = 0;

  for (const cur of repeated) {
    const prev = context.sections.find((s) => s.function === cur.function && s.occurrence === cur.occurrence - 1);
    if (!prev) continue;
    const reading = readDevelopment(context, prev, cur);
    if (!reading) continue;
    examined += 1;
    const parts = context.parts.filter((p) => context.notesInBars(p, cur.startBar, cur.endBar).length > 0);
    const location = { startBar: cur.startBar, endBar: cur.endBar, sectionName: cur.name, trackIds: parts.map((p) => p.id).sort() };
    const isLast = cur === repeated.filter((s) => s.function === cur.function).slice(-1)[0];
    const important = cur.name === climax || isLast;
    drafts.push({
      kind: "measured",
      severity: "info",
      location,
      evidence: {
        comparedWith: prev.name,
        identityShare: reading.identityShare,
        identityKept: reading.identityKept,
        developedIn: reading.changed.join(",") || "nothing",
        densityRatio: reading.densityRatio,
        maxRegisterShift: reading.maxRegisterShift,
        velocityShift: reading.velocityShift,
        rhythmIdentity: reading.rhythmIdentity,
        textureRatio: reading.textureRatio,
        instrumentationBefore: reading.instrumentationBefore.join(","),
        instrumentationAfter: reading.instrumentationAfter.join(","),
        plannedClimax: cur.name === climax,
      },
      suspectedOrigin: "form",
      originConfidence: 0,
      recommendedRepair: null,
      confidence: confidenceFromCount(parts.length * (cur.endBar - cur.startBar + 1), 24),
    });
    if (reading.identityKept && reading.changed.length === 0) {
      drafts.push({
        kind: "repeat_without_development",
        severity: important ? "major" : "minor",
        location,
        evidence: { comparedWith: prev.name, identityShare: reading.identityShare, plannedClimax: cur.name === climax, lastOccurrence: isLast },
        suspectedOrigin: "form",
        originConfidence: confidenceFromCount(parts.length, 2, 0.85),
        recommendedRepair: { operation: "apply_development_operator", scope: "section", detail: `${cur.name} keeps ${prev.name}'s identity (${Math.round(reading.identityShare * 100)} %) and changes nothing in instrumentation, density, register, dynamics, rhythm or texture${cur.name === climax ? " — and it is the planned climax" : ""}` },
        confidence: confidenceFromCount(parts.length * (cur.endBar - cur.startBar + 1), 16),
      });
    } else if (reading.identityKept && reading.changed.length === 1 && reading.changed[0] === "dynamics") {
      drafts.push({
        kind: "development_by_dynamics_only",
        severity: "minor",
        location,
        evidence: { comparedWith: prev.name, velocityShift: reading.velocityShift, identityShare: reading.identityShare, plannedClimax: cur.name === climax },
        suspectedOrigin: "form",
        originConfidence: confidenceFromCount(parts.length, 2, 0.8),
        recommendedRepair: { operation: "add_a_layer_or_register_move", scope: "section", detail: `${cur.name} differs from ${prev.name} only by ${reading.velocityShift.toFixed(1)} velocity on average` },
        confidence: confidenceFromCount(parts.length * (cur.endBar - cur.startBar + 1), 16),
      });
    } else if (!reading.identityKept && reading.identityShare < 0.2) {
      drafts.push({
        kind: "repeat_without_identity",
        severity: "minor",
        location,
        evidence: { comparedWith: prev.name, identityShare: reading.identityShare, rhythmIdentity: reading.rhythmIdentity },
        suspectedOrigin: "form",
        originConfidence: confidenceFromCount(parts.length, 2, 0.7),
        recommendedRepair: { operation: "recall_section_material", scope: "section", detail: `${cur.name} shares ${Math.round(reading.identityShare * 100)} % of its bars with ${prev.name}; the section type is not recognisable` },
        confidence: confidenceFromCount(parts.length * (cur.endBar - cur.startBar + 1), 16),
      });
    }
  }

  return buildReport({
    dimension: SECTION_DEVELOPMENT_DIMENSION,
    version: SECTION_DEVELOPMENT_VERSION,
    context,
    drafts,
    coverage: round(examined / repeated.length),
  });
}

export const sectionDevelopmentDimension: CriticDimension = {
  dimension: SECTION_DEVELOPMENT_DIMENSION,
  version: SECTION_DEVELOPMENT_VERSION,
  evaluate: evaluateSectionDevelopment,
};
