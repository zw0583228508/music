/**
 * Orchestration dimension (B-05a): who leads, supports, pulses, answers and
 * accents in every section — read from the notes, not from the plan — then
 * compared with what the plan promised: families planned (a role assignment
 * or a part task) that never sound, families that sound without a plan,
 * notes written outside the song, and a tutti that never rests.
 *
 * Suspected origin, per silent family: a part *task* existed and produced no
 * notes → the composer (`compose`, high confidence: the audit's Probe 5); a
 * role was assigned but no task was ever built → the section planner /
 * part-composer plan (`orchestration`). The drums-only probe is the
 * dimension's blocking case: every pitched planned family silent.
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
  type PartInfo,
} from "./shared";

export const ORCHESTRATION_DIMENSION = "orchestration";
export const ORCHESTRATION_VERSION = "1.0";

export type FunctionFromNotes = "lead" | "support" | "pulse" | "answer" | "accent" | "silent";

const FOUNDATION_ROLES = new Set(["LEAD", "BASS", "FOUNDATION", "GROOVE"]);
const INCIDENTAL_ROLES = new Set(["TRANSITION", "FILL"]);

export function functionFromNotes(context: CriticContext, part: PartInfo, startBar: number, endBar: number): { fn: FunctionFromNotes; onsetsPerBar: number; activeBarShare: number; meanVoices: number; distinctPitches: number; meanDurationBeats: number } {
  const notes = context.notesInBars(part, startBar, endBar);
  const bars = Math.max(1, endBar - startBar + 1);
  if (!notes.length) return { fn: "silent", onsetsPerBar: 0, activeBarShare: 0, meanVoices: 0, distinctPitches: 0, meanDurationBeats: 0 };
  const clusters = onsetClusters(notes);
  const onsetsPerBar = clusters.length / bars;
  const activeBars = new Set(notes.map((n) => n.bar)).size;
  const meanVoices = mean(clusters.map((c) => c.length));
  const distinctPitches = new Set(notes.map((n) => n.pitch)).size;
  const meanDurationBeats = mean(notes.map((n) => n.duration / n.beatSeconds));
  let fn: FunctionFromNotes;
  if (part.percussive) fn = onsetsPerBar >= 2 ? "pulse" : "accent";
  else if (part.family === "bass") fn = onsetsPerBar >= 2 ? "pulse" : "support";
  // An answer is a *line* that speaks where the singer does not. B-13 at the
  // merge: this branch had no texture guard at all, so any pitched part whose
  // onsets mostly fell outside the vocal phrases was called an answer -
  // including a chord. Since B-13 gave the beds the groove plan's bed cell
  // they hold three or four voices for two or three beats and rest between
  // them, which lands their onsets off the vocal: pop-full's Chorus keys
  // (1.00 onsets/bar, 3.25 voices, 2.84 beats held) read as `answer` when it is
  // plainly a pad. Requiring an answer to be close to monophonic is what the
  // word means; it is not a threshold moved to make a number look better, and
  // the `support` branch below already describes exactly this part.
  else if (context.vocal && notes.length >= 4 && meanVoices <= 1.5 &&
    notes.filter((n) => !context.vocalActiveAt(n.start)).length / notes.length >= 0.7 &&
    context.vocal.phrases.some((p) => p.start < (context.barInfo(endBar)?.end ?? Infinity) && p.end > (context.barInfo(startBar)?.start ?? 0))) fn = "answer";
  else if (meanVoices <= 1.3 && distinctPitches >= 5 && onsetsPerBar >= 1.5) fn = "lead";
  else if (onsetsPerBar < 1 && meanDurationBeats <= 2) fn = "accent";
  else if (meanVoices >= 1.8 || meanDurationBeats >= 1.5) fn = "support";
  else fn = onsetsPerBar >= 2 ? "pulse" : "support";
  return { fn, onsetsPerBar, activeBarShare: activeBars / bars, meanVoices, distinctPitches, meanDurationBeats };
}

export function evaluateOrchestration(input: CriticInput) {
  const context = buildContext(input);
  if (!context.parts.length && !(context.plan.sectionPlan || context.plan.partComposerPlan)) {
    return notApplicable(ORCHESTRATION_DIMENSION, ORCHESTRATION_VERSION, context, "no parts and no plan");
  }
  const drafts: ObservationDraft[] = [];
  const assignments = context.plan.sectionPlan?.roleAssignments ?? [];
  const tasks = context.plan.partComposerPlan?.tasks ?? [];
  const planned = assignments.length > 0 || tasks.length > 0;
  const instrumentOf = (name: string) => name.toLowerCase();
  const partsByInstrument = new Map<string, PartInfo[]>();
  for (const p of context.parts) {
    const list = partsByInstrument.get(instrumentOf(p.instrument)) ?? [];
    list.push(p);
    partsByInstrument.set(instrumentOf(p.instrument), list);
  }

  // Notes outside the song.
  for (const part of context.parts) {
    const outside = part.notes.filter((n) => n.start >= context.songEnd - 1e-3 || n.end <= context.songStart + 1e-3);
    if (outside.length) {
      drafts.push({
        kind: "notes_outside_song",
        severity: outside.length / part.notes.length >= 0.5 ? "blocking" : "major",
        location: { startBar: context.totalBars, endBar: context.totalBars, trackIds: [part.id] },
        evidence: { notesOutside: outside.length, notes: part.notes.length, songEndSeconds: context.songEnd, firstOutsideOnset: outside[0].start },
        suspectedOrigin: "compose",
        originConfidence: confidenceFromCount(outside.length, 2, 0.9),
        recommendedRepair: { operation: "drop_or_move_notes_into_song", scope: "part", detail: `${outside.length} of ${part.instrument}'s notes start after the song ends (${context.songEnd.toFixed(2)} s)` },
        confidence: confidenceFromCount(outside.length, 2),
      });
    }
  }

  for (const section of context.sections) {
    const bars = section.endBar - section.startBar + 1;
    const functions = context.parts.map((p) => ({ p, ...functionFromNotes(context, p, section.startBar, section.endBar) }));
    const sounding = functions.filter((f) => f.fn !== "silent");
    const leads = sounding.filter((f) => f.fn === "lead");
    drafts.push({
      kind: "measured",
      severity: "info",
      location: { startBar: section.startBar, endBar: section.endBar, sectionName: section.name, trackIds: sounding.map((f) => f.p.id).sort() },
      evidence: {
        soundingParts: sounding.length,
        lead: leads.map((f) => f.p.instrument).join(",") || "none",
        support: sounding.filter((f) => f.fn === "support").map((f) => f.p.instrument).join(","),
        pulse: sounding.filter((f) => f.fn === "pulse").map((f) => f.p.instrument).join(","),
        answer: sounding.filter((f) => f.fn === "answer").map((f) => f.p.instrument).join(","),
        accent: sounding.filter((f) => f.fn === "accent").map((f) => f.p.instrument).join(","),
      },
      suspectedOrigin: "orchestration",
      originConfidence: 0,
      recommendedRepair: null,
      confidence: confidenceFromCount(sounding.reduce((s, f) => s + f.onsetsPerBar * bars, 0), 24),
    });

    if (!planned) continue;
    const plannedHere = new Map<string, { roles: Set<string>; task: boolean; assignment: boolean }>();
    for (const a of assignments.filter((a) => a.sectionName === section.name)) {
      const key = instrumentOf(a.instrument);
      const entry = plannedHere.get(key) ?? { roles: new Set(), task: false, assignment: false };
      entry.roles.add(a.role);
      entry.assignment = true;
      plannedHere.set(key, entry);
    }
    for (const t of tasks.filter((t) => t.sectionName === section.name)) {
      const key = instrumentOf(t.instrument);
      const entry = plannedHere.get(key) ?? { roles: new Set(), task: false, assignment: false };
      entry.roles.add(t.role);
      entry.task = true;
      plannedHere.set(key, entry);
    }
    const plannedInstruments = [...plannedHere.keys()].sort();
    const silent = plannedInstruments.filter((key) => {
      const parts = partsByInstrument.get(key) ?? [];
      return !parts.some((p) => context.notesInBars(p, section.startBar, section.endBar).length > 0);
    });
    const mandatory = section.function === "verse" || section.function === "chorus" || section.function === "bridge" || section.function === "prechorus";
    const nonIncidental = plannedInstruments.filter((k) => [...plannedHere.get(k)!.roles].some((r) => !INCIDENTAL_ROLES.has(r)));
    const silentNonIncidental = silent.filter((k) => nonIncidental.includes(k));
    for (const key of silent) {
      const entry = plannedHere.get(key)!;
      const roles = [...entry.roles].sort();
      const incidental = roles.every((r) => INCIDENTAL_ROLES.has(r));
      const foundation = roles.some((r) => FOUNDATION_ROLES.has(r));
      const massSilence = mandatory && nonIncidental.length > 0 && silentNonIncidental.length / nonIncidental.length >= 0.5;
      const severity = incidental ? "minor" : foundation || massSilence ? "blocking" : "major";
      const origin = entry.task ? "compose" : "orchestration";
      drafts.push({
        kind: "planned_family_silent",
        severity,
        location: { startBar: section.startBar, endBar: section.endBar, sectionName: section.name, trackIds: [] },
        evidence: { instrument: key, plannedRoles: roles.join(","), taskPlanned: entry.task, roleAssigned: entry.assignment, plannedInstruments: plannedInstruments.length, silentPlannedInstruments: silent.length, sectionFunction: section.function },
        suspectedOrigin: origin,
        originConfidence: confidenceFromCount(bars, 2, entry.task ? 0.9 : 0.8),
        recommendedRepair: entry.task
          ? { operation: "compose_missing_part", scope: "part", detail: `${key} (${roles.join("/")}) has a part task in ${section.name} and wrote no notes` }
          : { operation: "build_part_task_for_assigned_role", scope: "plan", detail: `${key} is assigned ${roles.join("/")} in ${section.name} but the part plan never built a task for it` },
        confidence: confidenceFromCount(bars, 2, 0.95),
      });
    }
    // Unplanned entries.
    for (const f of sounding) {
      const key = instrumentOf(f.p.instrument);
      if (plannedHere.has(key)) continue;
      drafts.push({
        kind: "unplanned_entry",
        severity: f.fn === "lead" && context.vocal ? "minor" : "info",
        location: { startBar: section.startBar, endBar: section.endBar, sectionName: section.name, trackIds: [f.p.id] },
        evidence: { instrument: key, functionFromNotes: f.fn, onsetsPerBar: f.onsetsPerBar },
        suspectedOrigin: "compose",
        originConfidence: confidenceFromCount(Math.round(f.onsetsPerBar * bars), 4, 0.6),
        recommendedRepair: { operation: "confirm_or_remove_unplanned_part", scope: "section", detail: `${key} plays in ${section.name} without a role assignment or task` },
        confidence: confidenceFromCount(Math.round(f.onsetsPerBar * bars), 4),
      });
    }
  }

  // Continuous tutti: three or more parts, none of which ever rests a bar.
  const substantial = context.parts.filter((p) => p.notes.length >= 16);
  if (substantial.length >= 3 && context.totalBars >= 8) {
    const activeShares = substantial.map((p) => {
      const bars = new Set<number>();
      for (const n of p.notes) {
        const endBar = context.barAt(Math.max(n.start, n.end - 1e-3));
        for (let b = n.bar; b <= endBar; b += 1) bars.add(b);
      }
      return { p, share: bars.size / context.totalBars };
    });
    if (activeShares.every((a) => a.share >= 0.95)) {
      drafts.push({
        kind: "continuous_tutti",
        severity: substantial.length >= 4 ? "major" : "minor",
        location: { startBar: 1, endBar: context.totalBars, trackIds: substantial.map((p) => p.id).sort() },
        evidence: { parts: substantial.length, minActiveBarShare: Math.min(...activeShares.map((a) => a.share)) },
        suspectedOrigin: "orchestration",
        originConfidence: confidenceFromCount(substantial.length, 3, 0.7),
        recommendedRepair: { operation: "plan_entries_and_exits", scope: "plan", detail: `all ${substantial.length} substantial parts sound in at least 95 % of the bars; nothing enters, nothing leaves` },
        confidence: confidenceFromCount(context.totalBars, 12),
      });
    }
  }

  return buildReport({
    dimension: ORCHESTRATION_DIMENSION,
    version: ORCHESTRATION_VERSION,
    context,
    drafts,
    coverage: planned ? 1 : 0.5,
  });
}

export const orchestrationDimension: CriticDimension = {
  dimension: ORCHESTRATION_DIMENSION,
  version: ORCHESTRATION_VERSION,
  evaluate: evaluateOrchestration,
};
