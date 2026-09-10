/**
 * What changed between iteration N and N+1 (Brain B-11, D3 `candidateDiff`).
 *
 * Two persisted versions (a parent arrangement and the version derived from
 * it; a source candidate and its bounded repair) both keep full `trackModels`
 * and a plan, so the diff was always computable - offline, by hand. This is
 * the pure function that computes it, and the runner persists its result on
 * the new version (`generationProvenance.telemetry.candidateDiff`).
 *
 * Notes are matched per track by (onset, pitch) on a 10 ms grid; a matched
 * note whose duration or velocity differs is `changed`. Changes are reported
 * as bar ranges per track (contiguous bars that differ), never note by note.
 * Tracks are matched by id, then by instrument (the brain scopes ids to the
 * project, so the same instrument keeps its id across versions).
 *
 * Plan fields: the arc-facing targets per section (energy, intended dynamic,
 * texture level, tension role), each section's active families, the palette,
 * the climax and the part-task count. Anything else that differs is reported
 * under `plan.other` as a count, so nothing changes silently.
 */
import type { ArrangementPlan, CandidateDiff, CandidateDiffRange, CandidateDiffTrack, MusicalNote } from "@workspace/db";
import { barOfSeconds } from "./decisionProvenance";

export type DiffSide = {
  id: string;
  label: string;
  trackModels: ReadonlyArray<{ id: string; instrument: string; notes: ReadonlyArray<MusicalNote> }>;
  plan: ArrangementPlan | null | undefined;
};

const noteKey = (note: MusicalNote): string => `${Math.round(note.start * 100)}:${note.pitch}`;
const sameNote = (a: MusicalNote, b: MusicalNote): boolean =>
  Math.abs(a.duration - b.duration) < 0.005 && a.velocity === b.velocity;

function barRanges(barsOf: Map<number, { added: number; removed: number; changed: number }>): CandidateDiffRange[] {
  const bars = [...barsOf.keys()].sort((a, b) => a - b);
  const ranges: CandidateDiffRange[] = [];
  let current: CandidateDiffRange | null = null;
  for (const bar of bars) {
    const counts = barsOf.get(bar)!;
    if (current && bar === current.endBar + 1) {
      current.endBar = bar;
      current.added += counts.added; current.removed += counts.removed; current.changed += counts.changed;
    } else {
      current = { startBar: bar, endBar: bar, ...counts };
      ranges.push(current);
    }
  }
  return ranges;
}

function diffTrack(
  trackId: string,
  instrument: string,
  before: ReadonlyArray<MusicalNote> | null,
  after: ReadonlyArray<MusicalNote> | null,
  barSeconds: number | null,
): CandidateDiffTrack {
  const bar = (note: MusicalNote) => (barSeconds ? barOfSeconds(note.start, barSeconds) : 1);
  const barsOf = new Map<number, { added: number; removed: number; changed: number }>();
  const bump = (b: number, field: "added" | "removed" | "changed") => {
    const held = barsOf.get(b) ?? { added: 0, removed: 0, changed: 0 };
    held[field] += 1;
    barsOf.set(b, held);
  };
  const beforeByKey = new Map<string, MusicalNote>();
  for (const note of before ?? []) beforeByKey.set(noteKey(note), note);
  let added = 0, removed = 0, changed = 0;
  const seen = new Set<string>();
  for (const note of after ?? []) {
    const key = noteKey(note);
    const match = beforeByKey.get(key);
    if (!match || seen.has(key)) { added += 1; bump(bar(note), "added"); continue; }
    seen.add(key);
    if (!sameNote(match, note)) { changed += 1; bump(bar(note), "changed"); }
  }
  for (const [key, note] of beforeByKey) {
    if (!seen.has(key)) { removed += 1; bump(bar(note), "removed"); }
  }
  const status: CandidateDiffTrack["status"] = before === null ? "added" : after === null ? "removed"
    : added + removed + changed > 0 ? "changed" : "unchanged";
  return {
    trackId, instrument, status,
    notesBefore: before?.length ?? 0, notesAfter: after?.length ?? 0,
    added, removed, changed,
    ranges: barRanges(barsOf),
  };
}

type PlanField = { path: string; value: string | null };

function planFields(plan: ArrangementPlan | null | undefined): PlanField[] {
  if (!plan) return [];
  const fields: PlanField[] = [];
  const show = (value: unknown): string | null => value === undefined || value === null ? null
    : typeof value === "number" ? String(Number(value.toFixed(3))) : typeof value === "string" ? value : JSON.stringify(value);
  const globalPlan = plan.globalPlan;
  if (globalPlan) {
    fields.push({ path: "globalPlan.style", value: show(globalPlan.style) });
    fields.push({ path: "globalPlan.instrumentPalette", value: show(globalPlan.instrumentPalette.map((p) => p.role)) });
    fields.push({ path: "globalPlan.climax", value: show(globalPlan.climax ? `${globalPlan.climax.sectionName}@${globalPlan.climax.atBar}` : null) });
    fields.push({ path: "globalPlan.grooveStrategy", value: show(globalPlan.grooveStrategy) });
    if (globalPlan.arc?.template) fields.push({ path: "globalPlan.arc.template", value: show(globalPlan.arc.template.id) });
    for (const target of globalPlan.sectionTargets) {
      const base = `globalPlan.sectionTargets[${target.sectionName}]`;
      fields.push({ path: `${base}.energy`, value: show(target.energy) });
      fields.push({ path: `${base}.density`, value: show(target.density) });
      if (target.intendedDynamic !== undefined) fields.push({ path: `${base}.intendedDynamic`, value: show(target.intendedDynamic) });
      if (target.textureLevel !== undefined) fields.push({ path: `${base}.textureLevel`, value: show(target.textureLevel) });
      if (target.tensionRole !== undefined) fields.push({ path: `${base}.tensionRole`, value: show(target.tensionRole) });
    }
  }
  for (const section of plan.sectionPlan?.sections ?? []) {
    const base = `sectionPlan.sections[${section.sectionName}]`;
    fields.push({ path: `${base}.activeInstrumentFamilies`, value: show([...section.activeInstrumentFamilies].sort()) });
    fields.push({ path: `${base}.leadRole`, value: show(section.leadRole) });
    if (section.developmentOperator !== undefined) fields.push({ path: `${base}.developmentOperator`, value: show(section.developmentOperator) });
  }
  for (const assignment of plan.sectionPlan?.roleAssignments ?? []) {
    fields.push({ path: `sectionPlan.roleAssignments[${assignment.sectionName}/${assignment.instrument}]`, value: show(`${assignment.role} ${assignment.register} ${assignment.entryBar}-${assignment.exitBar}`) });
  }
  if (plan.partComposerPlan) fields.push({ path: "partComposerPlan.tasks.length", value: show(plan.partComposerPlan.tasks.length) });
  if (plan.regeneration) fields.push({ path: "regeneration.editText", value: show(plan.regeneration.editText) });
  return fields;
}

export function candidateDiff(before: DiffSide, after: DiffSide, options: { barSeconds?: number | null } = {}): CandidateDiff {
  const barSeconds = options.barSeconds && options.barSeconds > 0 ? options.barSeconds : null;
  const beforeTracks = new Map(before.trackModels.map((t) => [t.id, t]));
  const afterTracks = new Map(after.trackModels.map((t) => [t.id, t]));
  const byInstrument = (list: DiffSide["trackModels"]) => new Map(list.map((t) => [t.instrument.toLowerCase(), t]));
  const beforeByInstrument = byInstrument(before.trackModels);
  const matchedBefore = new Set<string>();
  const tracks: CandidateDiffTrack[] = [];
  for (const track of after.trackModels) {
    const match = beforeTracks.get(track.id)
      ?? (!afterTracks.has(beforeByInstrument.get(track.instrument.toLowerCase())?.id ?? "") ? beforeByInstrument.get(track.instrument.toLowerCase()) : undefined);
    if (match) matchedBefore.add(match.id);
    tracks.push(diffTrack(track.id, track.instrument, match ? match.notes : null, track.notes, barSeconds));
  }
  for (const track of before.trackModels) {
    if (matchedBefore.has(track.id)) continue;
    tracks.push(diffTrack(track.id, track.instrument, track.notes, null, barSeconds));
  }
  tracks.sort((a, b) => a.trackId.localeCompare(b.trackId));

  const beforeFields = new Map(planFields(before.plan).map((f) => [f.path, f.value]));
  const afterFields = new Map(planFields(after.plan).map((f) => [f.path, f.value]));
  const plan: CandidateDiff["plan"] = [];
  for (const [path, value] of afterFields) {
    const previous = beforeFields.get(path) ?? null;
    if (previous !== value) plan.push({ path, before: previous, after: value });
  }
  for (const [path, value] of beforeFields) {
    if (!afterFields.has(path)) plan.push({ path, before: value, after: null });
  }
  plan.sort((a, b) => a.path.localeCompare(b.path));

  return {
    version: "1.0",
    before: { id: before.id, label: before.label },
    after: { id: after.id, label: after.label },
    barSeconds,
    tracks,
    plan,
    summary: {
      tracksChanged: tracks.filter((t) => t.status !== "unchanged").length,
      notesAdded: tracks.reduce((s, t) => s + t.added, 0),
      notesRemoved: tracks.reduce((s, t) => s + t.removed, 0),
      notesChanged: tracks.reduce((s, t) => s + t.changed, 0),
      planFieldsChanged: plan.length,
    },
  };
}
