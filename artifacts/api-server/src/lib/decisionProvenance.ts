/**
 * Decision provenance (Brain B-11, D1).
 *
 * Every note group the brain writes can be traced to the decision that
 * authored it. The persisted form is compact: a registry of `DecisionRecord`s
 * per candidate (id, layer, kind, reason, refs) and, per track, bar ranges
 * that point at decision ids (`TrackModel.decisionProvenance`). Notes are not
 * annotated one by one; a layer that authors notes at a finer grain than a
 * bar range (a voicing per chord, a groove cell per bar) tags them with
 * `MusicalNote.decisionId` and `rangesFromTaggedNotes` folds the tags into
 * ranges.
 *
 * Contract for other layers (docs/brain/04-decision-provenance.md):
 *   - the orchestrator hands every composer call a `DecisionRegistry`
 *     (`compose(request, { decisions })`); a layer calls
 *     `decisions.register({ layer, kind, sectionName, instrument, startBar,
 *     endBar, source, reason, refs })` and receives the record with its id;
 *   - it then either tags the notes it wrote (`note.decisionId = record.id`)
 *     or calls `decisions.attach(instrument, startBar, endBar, [record.id])`;
 *   - ids are `<layer>:<kind>:<qualifier>`; registering the same id twice
 *     returns the first record (a chord voiced for two instruments is one
 *     decision), so ids must be deterministic for the same input.
 *
 * `buildCandidateProvenance` derives the records the plan layers already
 * state (arc, palette, role assignments, part tasks, exclusions, density,
 * repair passes, playability repairs, performance) from a finished
 * candidate, merges the composers' own registrations, and says per track
 * which layers recorded nothing - never inventing a reason for them.
 */
import type {
  ArrangementPlan,
  DecisionOriginLayer,
  DecisionProvenanceRange,
  DecisionRecord,
  MusicalNote,
  TrackDecisionProvenance,
} from "@workspace/db";

export const DECISION_PROVENANCE_VERSION = "1.0" as const;

const qualifier = (value: string | number): string => String(value).trim().replace(/\s+/g, "_").replace(/[:/]/g, "-");

/** `<layer>:<kind>:<q1>/<q2>...` - deterministic for the same qualifiers. */
export function decisionId(layer: DecisionOriginLayer, kind: string, ...qualifiers: Array<string | number>): string {
  return `${layer}:${qualifier(kind)}${qualifiers.length ? `:${qualifiers.map(qualifier).join("/")}` : ""}`;
}

export type RegisterDecisionInput = Omit<DecisionRecord, "id"> & { id?: string; qualifiers?: Array<string | number> };

export class DecisionRegistry {
  private readonly records = new Map<string, DecisionRecord>();
  private readonly attached: Array<{ instrument: string; startBar: number; endBar: number; decisionIds: string[] }> = [];

  /** Register a decision; the same id registered twice returns the first record unchanged. */
  register(input: RegisterDecisionInput): DecisionRecord {
    const { qualifiers, id: explicitId, ...rest } = input;
    const id = explicitId ?? decisionId(input.layer, input.kind, ...(qualifiers ?? [
      ...(input.sectionName ? [input.sectionName] : []),
      ...(input.instrument ? [input.instrument] : []),
      ...(input.startBar !== undefined && input.sectionName === undefined ? [input.startBar] : []),
    ]));
    const held = this.records.get(id);
    if (held) return held;
    const record: DecisionRecord = { id, ...rest };
    if (!record.refs?.length) delete record.refs;
    if (record.source === undefined) delete record.source;
    this.records.set(id, record);
    return record;
  }

  has(id: string): boolean {
    return this.records.has(id);
  }

  get(id: string): DecisionRecord | undefined {
    return this.records.get(id);
  }

  /** Attribute a bar range of an instrument's part to decisions (ids must be registered). */
  attach(instrument: string, startBar: number, endBar: number, decisionIds: string[]): void {
    const known = decisionIds.filter((id) => this.records.has(id));
    if (!known.length || !(endBar >= startBar)) return;
    this.attached.push({ instrument, startBar, endBar, decisionIds: known });
  }

  decisions(): DecisionRecord[] {
    return [...this.records.values()];
  }

  /** The attached ranges of one instrument, merged (identical bar spans share one range). */
  rangesFor(instrument: string): DecisionProvenanceRange[] {
    return mergeRanges(this.attached.filter((r) => r.instrument === instrument));
  }

  size(): number {
    return this.records.size;
  }
}

export function mergeRanges(ranges: ReadonlyArray<DecisionProvenanceRange>): DecisionProvenanceRange[] {
  const byKey = new Map<string, DecisionProvenanceRange>();
  for (const range of ranges) {
    const key = `${range.startBar}-${range.endBar}`;
    const held = byKey.get(key);
    if (held) {
      for (const id of range.decisionIds) if (!held.decisionIds.includes(id)) held.decisionIds.push(id);
    } else {
      byKey.set(key, { startBar: range.startBar, endBar: range.endBar, decisionIds: [...new Set(range.decisionIds)] });
    }
  }
  return [...byKey.values()].sort((a, b) => a.startBar - b.startBar || a.endBar - b.endBar);
}

/** 1-based bar of an onset in seconds on a constant grid. */
export function barOfSeconds(seconds: number, barSeconds: number, originSeconds = 0): number {
  if (!(barSeconds > 0)) return 1;
  return Math.max(1, Math.floor((seconds - originSeconds) / barSeconds + 1e-9) + 1);
}

/**
 * Fold notes tagged with `decisionId` into bar ranges: consecutive bars that
 * carry the same decision id become one range. Untagged notes contribute
 * nothing (the coarser plan-level ranges cover them).
 */
export function rangesFromTaggedNotes(notes: ReadonlyArray<MusicalNote>, barSeconds: number, originSeconds = 0): DecisionProvenanceRange[] {
  const barsByDecision = new Map<string, Set<number>>();
  for (const note of notes) {
    if (!note.decisionId) continue;
    const bars = barsByDecision.get(note.decisionId) ?? new Set<number>();
    bars.add(barOfSeconds(note.start, barSeconds, originSeconds));
    barsByDecision.set(note.decisionId, bars);
  }
  const ranges: DecisionProvenanceRange[] = [];
  for (const [id, bars] of barsByDecision) {
    const sorted = [...bars].sort((a, b) => a - b);
    let start = sorted[0];
    let previous = sorted[0];
    for (const bar of sorted.slice(1)) {
      if (bar === previous + 1) { previous = bar; continue; }
      ranges.push({ startBar: start, endBar: previous, decisionIds: [id] });
      start = bar; previous = bar;
    }
    ranges.push({ startBar: start, endBar: previous, decisionIds: [id] });
  }
  return mergeRanges(ranges);
}

/** Decision ids that cover a bar of a track, finest grain first (tagged ranges are listed before plan ranges by the builder). */
export function decisionsAtBar(provenance: TrackDecisionProvenance | undefined, bar: number): string[] {
  if (!provenance) return [];
  const ids: string[] = [];
  for (const range of provenance.ranges) {
    if (bar >= range.startBar && bar <= range.endBar) for (const id of range.decisionIds) if (!ids.includes(id)) ids.push(id);
  }
  return ids;
}

// ---------------------------------------------------------------------------
// Deriving the plan layers' decisions from a finished candidate
// ---------------------------------------------------------------------------

export type CandidateProvenanceInput = {
  candidateId: string;
  strategy: string;
  seed: number;
  plan: ArrangementPlan;
  trackModels: ReadonlyArray<{ id: string; instrument: string; role: string; notes: MusicalNote[] }>;
  composer: string;
  barSeconds: number;
  /** Composer registrations captured by the orchestrator during composition (B-02/B-04 contract). */
  composerRegistry?: DecisionRegistry | null;
  repairPasses?: ReadonlyArray<{ pass: number; requests: Array<{ id: string; dimension: string; sectionName?: string; instrument?: string; startBar?: number; endBar?: number; operations: string[]; reason: string }>; applied: string[]; planChanged?: boolean; notesChanged?: boolean; scoreBefore: number; scoreAfter: number }>;
  playabilityRepairs?: ReadonlyArray<{ trackId: string; rangeFolds: number; leapFolds: number; durationLengthened: number; breathTruncated: number; polyphonyReleases: number; dropped: number; residual: string[] }>;
  performance?: ReadonlyArray<{ trackId: string; engine: string; engineVersion: string; profile: string; sample: unknown[]; noteIds: string[]; addedNotes: number }>;
  contextPasses?: ReadonlyArray<{ id: string; changed: number; note: string }>;
  contextAware?: boolean;
};

export type CandidateProvenance = {
  decisions: DecisionRecord[];
  byTrack: Record<string, TrackDecisionProvenance>;
};

const LAYER_OF_CONTEXT_PASS = (id: string): DecisionOriginLayer =>
  /voic|harmon/i.test(id) ? "harmony" : /groove|rhythm|swing/i.test(id) ? "groove" : /register/i.test(id) ? "register" : "compose";

export function buildCandidateProvenance(input: CandidateProvenanceInput): CandidateProvenance {
  const registry = new DecisionRegistry();
  const plan = input.plan;
  const globalPlan = plan.globalPlan;
  const sectionPlan = plan.sectionPlan;
  const partPlan = plan.partComposerPlan;
  const arc = globalPlan?.arc;
  const familyOf = (instrument: string) => instrument.toLowerCase();

  // --- arc + form -----------------------------------------------------------
  if (arc?.template) {
    registry.register({ layer: "arc", kind: "template", qualifiers: [arc.template.id], source: arc.template.source, reason: arc.template.reason });
  }
  if (arc?.primaryClimax) {
    registry.register({ layer: "arc", kind: "primary_climax", sectionName: arc.primaryClimax.sectionName, startBar: arc.primaryClimax.atBar, endBar: arc.primaryClimax.atBar, source: arc.primaryClimax.source, reason: arc.primaryClimax.reason });
  }
  const arcEntryIds = new Map<string, string>(); // `${section}|${family}` -> entry decision id
  const arcSectionIds = new Map<string, string[]>();
  for (const section of arc?.sections ?? []) {
    const ids: string[] = [];
    ids.push(registry.register({ layer: "arc", kind: "intended_dynamic", sectionName: section.sectionName, startBar: section.startBar, endBar: section.endBar, source: section.intendedDynamic.source, reason: `${section.intendedDynamic.value.marking} (${section.intendedDynamic.value.level}): ${section.intendedDynamic.reason}` }).id);
    ids.push(registry.register({ layer: "arc", kind: "texture_level", sectionName: section.sectionName, startBar: section.startBar, endBar: section.endBar, source: section.textureLevel.source, reason: `${section.textureLevel.value}: ${section.textureLevel.reason}` }).id);
    ids.push(registry.register({ layer: "arc", kind: "tension_role", sectionName: section.sectionName, startBar: section.startBar, endBar: section.endBar, source: section.tensionRole.source, reason: `${section.tensionRole.value}: ${section.tensionRole.reason}` }).id);
    ids.push(registry.register({ layer: "form", kind: "development_operator", sectionName: section.sectionName, startBar: section.startBar, endBar: section.endBar, source: section.developmentOperator.source, reason: `${section.developmentOperator.value} (occurrence ${section.occurrenceIndex + 1} of ${section.occurrenceCount}): ${section.developmentOperator.reason}` }).id);
    arcSectionIds.set(section.sectionName, ids);
    for (const entry of section.familyEntries) {
      const record = registry.register({
        layer: "arc", kind: "family_entry", sectionName: section.sectionName, instrument: entry.family,
        startBar: section.startBar + entry.barOffset, endBar: section.endBar, source: entry.source, reason: entry.reason,
      });
      arcEntryIds.set(`${section.sectionName}|${familyOf(entry.family)}`, record.id);
    }
    for (const exit of section.familyExits) {
      registry.register({
        layer: "arc", kind: "family_exit", sectionName: section.sectionName, instrument: exit.family,
        startBar: section.startBar + exit.barOffset, endBar: section.endBar, source: exit.source, reason: exit.reason,
      });
    }
  }

  // --- orchestration: palette, exclusions, role assignments -----------------
  const paletteIds = new Map<string, string>();
  for (const entry of globalPlan?.instrumentPalette ?? []) {
    paletteIds.set(familyOf(entry.role), registry.register({ layer: "orchestration", kind: "palette", instrument: entry.role, reason: `priority ${entry.priority}: ${entry.rationale}` }).id);
  }
  for (const excluded of globalPlan?.excludedPaletteHints ?? []) {
    registry.register({ layer: "orchestration", kind: "palette_excluded", instrument: excluded.hint, reason: excluded.reason });
  }
  const roleIds = new Map<string, string>();
  for (const assignment of sectionPlan?.roleAssignments ?? []) {
    const record = registry.register({
      layer: "orchestration", kind: "role_assignment", sectionName: assignment.sectionName, instrument: assignment.instrument,
      startBar: assignment.entryBar, endBar: assignment.exitBar,
      reason: `${assignment.role} in the ${assignment.register} register, ${assignment.dynamicShape}, ${assignment.voicingStrategy} voicing, ${assignment.articulationFamily}, ${assignment.interactionWithLead} the lead (bars ${assignment.entryBar}-${assignment.exitBar}); sectionPhrasePlanner records no reason for the role choice itself`,
      refs: [arcEntryIds.get(`${assignment.sectionName}|${familyOf(assignment.instrument)}`), paletteIds.get(familyOf(assignment.instrument))].filter((id): id is string => Boolean(id)),
    });
    roleIds.set(`${assignment.sectionName}|${familyOf(assignment.instrument)}`, record.id);
  }
  for (const decision of partPlan?.decisions ?? []) {
    registry.register({
      layer: "orchestration", kind: decision.kind, sectionName: decision.sectionName, instrument: decision.instrument,
      reason: decision.reason + (decision.resolvedTo ? ` (written by ${decision.resolvedTo})` : ""),
      refs: [roleIds.get(`${decision.sectionName}|${familyOf(decision.instrument)}`)].filter((id): id is string => Boolean(id)),
    });
  }

  // --- compose: strategy, part tasks, density ---------------------------------
  const strategyRecord = registry.register({ layer: "compose", kind: "strategy", qualifiers: [input.candidateId, input.strategy], reason: `candidate ${input.candidateId} composed with the ${input.strategy} strategy, seed ${input.seed}, by ${input.composer}` });
  const thisCandidate = plan.candidateGenerationPlan?.candidates.find((c) => c.candidateId === input.candidateId);
  const adjustments = new Map((thisCandidate?.partAdjustments ?? []).map((a) => [a.taskId, a]));
  const taskRanges = new Map<string, Array<DecisionProvenanceRange>>(); // instrument -> ranges
  for (const task of partPlan?.tasks ?? []) {
    const key = `${task.sectionName}|${familyOf(task.instrument)}`;
    const refs = [arcEntryIds.get(key), roleIds.get(key), strategyRecord.id].filter((id): id is string => Boolean(id));
    const taskRecord = registry.register({
      layer: "compose", kind: "part_task", qualifiers: [task.id], sectionName: task.sectionName, instrument: task.instrument,
      startBar: task.startBar, endBar: task.endBar,
      reason: `${task.task} part for ${task.instrument} as ${task.role} in "${task.sectionName}" (bars ${task.startBar}-${task.endBar}), seed ${task.seed}${task.dependsOn.length ? `, after ${task.dependsOn.join(", ")}` : ""}`,
      refs,
    });
    const ids = [taskRecord.id, ...refs.filter((id) => id !== strategyRecord.id)];
    const adjustment = adjustments.get(task.id);
    if (adjustment) {
      ids.push(registry.register({
        layer: "compose", kind: "density", qualifiers: [input.candidateId, task.id], sectionName: task.sectionName, instrument: task.instrument,
        startBar: task.startBar, endBar: task.endBar,
        reason: `density x${adjustment.densityMultiplier} (${adjustment.note}); seed ${adjustment.seed}`,
        refs: [taskRecord.id, strategyRecord.id],
      }).id);
    }
    const list = taskRanges.get(familyOf(task.instrument)) ?? [];
    list.push({ startBar: task.startBar, endBar: task.endBar, decisionIds: ids });
    taskRanges.set(familyOf(task.instrument), list);
  }

  // --- context passes (harmony / groove on the context-aware path) ------------
  const contextIds: string[] = [];
  for (const pass of input.contextPasses ?? []) {
    contextIds.push(registry.register({ layer: LAYER_OF_CONTEXT_PASS(pass.id), kind: "context_pass", qualifiers: [pass.id], reason: `${pass.note} (${pass.changed} note(s) changed)` }).id);
  }

  // --- repair passes ----------------------------------------------------------
  const repairRanges: Array<{ sectionName?: string; instrument?: string; startBar?: number; endBar?: number; id: string }> = [];
  for (const pass of input.repairPasses ?? []) {
    if (!pass.applied.length || !(pass.planChanged || pass.notesChanged)) continue;
    const record = registry.register({
      layer: "compose", kind: "repair_pass", qualifiers: [input.candidateId, pass.pass],
      reason: `pass ${pass.pass}: applied ${pass.applied.join("; ")} (score ${pass.scoreBefore} -> ${pass.scoreAfter}; plan ${pass.planChanged ? "changed" : "unchanged"}, notes recomposed ${pass.notesChanged ? "and changed" : "without change"})`,
      refs: pass.requests.map((request) => registry.register({
        layer: "compose", kind: "repair_request", qualifiers: [input.candidateId, pass.pass, request.id], sectionName: request.sectionName, instrument: request.instrument,
        startBar: request.startBar, endBar: request.endBar, reason: `${request.dimension}: ${request.reason} -> ${request.operations.join("; ")}`,
      }).id),
    });
    for (const request of pass.requests) {
      repairRanges.push({ sectionName: request.sectionName, instrument: request.instrument, startBar: request.startBar, endBar: request.endBar, id: record.id });
    }
  }

  // --- performance and playability repair, per track ---------------------------
  const sections = sectionPlan?.sections ?? globalPlan?.sectionTargets ?? [];
  const lastBar = Math.max(1, ...sections.map((s) => s.endBar));
  const byTrack: Record<string, TrackDecisionProvenance> = {};
  const composerDecisions = input.composerRegistry?.decisions() ?? [];
  const composerLayers = new Set(composerDecisions.map((d) => d.layer));
  const taggedLayers = new Set<DecisionOriginLayer>();
  for (const track of input.trackModels) {
    const instrument = familyOf(track.instrument);
    const ranges: DecisionProvenanceRange[] = [];
    // Finest grain first: notes tagged by a composing layer.
    const tagged = rangesFromTaggedNotes(track.notes, input.barSeconds);
    for (const range of tagged) {
      for (const id of range.decisionIds) {
        const record = registry.get(id) ?? input.composerRegistry?.get(id);
        if (record) taggedLayers.add(record.layer);
      }
    }
    ranges.push(...tagged.map((range) => ({ ...range, decisionIds: range.decisionIds.filter((id) => registry.has(id) || input.composerRegistry?.has(id)) })).filter((r) => r.decisionIds.length));
    ranges.push(...(input.composerRegistry?.rangesFor(track.instrument) ?? []));
    ranges.push(...(taskRanges.get(instrument) ?? []));
    for (const repair of repairRanges) {
      if (repair.instrument && familyOf(repair.instrument) !== instrument) continue;
      const section = repair.sectionName ? sections.find((s) => s.sectionName === repair.sectionName) : undefined;
      const startBar = repair.startBar ?? section?.startBar ?? 1;
      const endBar = repair.endBar ?? section?.endBar ?? lastBar;
      ranges.push({ startBar, endBar, decisionIds: [repair.id] });
    }
    const wholeTrack: string[] = [...contextIds];
    const performance = input.performance?.find((p) => p.trackId === track.id);
    if (performance) {
      wholeTrack.push(registry.register({
        layer: "perform", kind: "performance", qualifiers: [track.id], instrument: track.instrument,
        reason: `${performance.engine} ${performance.engineVersion}, profile ${performance.profile}: ${performance.sample.length} note(s) carry the engine's reasons, timing and velocity deltas measured for ${performance.noteIds.length} note(s), ${performance.addedNotes} note(s) added by the performance`,
      }).id);
    }
    const repair = input.playabilityRepairs?.find((r) => r.trackId === track.id);
    if (repair) {
      wholeTrack.push(registry.register({
        layer: "perform", kind: "playability_repair", qualifiers: [track.id], instrument: track.instrument,
        reason: `post-performance playability repair: ${repair.rangeFolds} range fold(s), ${repair.leapFolds} leap fold(s), ${repair.polyphonyReleases} polyphony release(s), ${repair.breathTruncated} breath truncation(s), ${repair.durationLengthened} lengthened, ${repair.dropped} dropped${repair.residual.length ? `; residual: ${repair.residual.join("; ")}` : ""}`,
      }).id);
    }
    if (wholeTrack.length) ranges.push({ startBar: 1, endBar: lastBar, decisionIds: wholeTrack });

    const notRecorded: TrackDecisionProvenance["notRecorded"] = [];
    const recordedHere = new Set<DecisionOriginLayer>([...taggedLayers, ...composerLayers]);
    if (!recordedHere.has("harmony") && !contextIds.some((id) => id.startsWith("harmony:"))) {
      notRecorded.push({ layer: "harmony", reason: `${input.composer} emits no voicing decisions; the voicing of each chord is not recorded (harmony realisation is stream B-02)` });
    }
    if (!recordedHere.has("groove") && !contextIds.some((id) => id.startsWith("groove:"))) {
      notRecorded.push({ layer: "groove", reason: `${input.composer} emits no groove decisions; the rhythm cell of each bar is not recorded (GroovePlan is stream B-04)` });
    }
    if (!recordedHere.has("register")) {
      notRecorded.push({ layer: "register", reason: "the register plan is applied through family counts only; no per-window register decision is recorded (instrument profiles are stream B-03)" });
    }
    byTrack[track.id] = {
      version: DECISION_PROVENANCE_VERSION,
      ranges: mergeRanges(ranges),
      ...(notRecorded.length ? { notRecorded } : {}),
    };
  }

  const decisions = [...registry.decisions()];
  for (const record of composerDecisions) if (!decisions.some((d) => d.id === record.id)) decisions.push(record);
  return { decisions, byTrack };
}
