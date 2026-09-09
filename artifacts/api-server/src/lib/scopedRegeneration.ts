/**
 * Scope-aware regeneration (Wave U, PR-U5).
 *
 * A chat edit turn carries an `EditPlan` (PR-U1): locks to preserve and scopes
 * to regenerate, on the PR-17 vocabulary. This module executes it against the
 * project's current arrangement:
 *
 *   EditPlan → locks/scopes resolved to the arrangement's own tracks
 *            → `resolveRegenerationScopes` (what the locks still allow)
 *            → the Arrangement Brain composes ≥3 whole-song candidates with the
 *              current brief's planner hints and performance style
 *            → every candidate is merged into the previous version over the
 *              allowed scopes only (`applyPartialRegeneration`), its locked
 *              material verified (`verifyLocksHonoured`), and the *merged*
 *              result critiqued and constraint-checked
 *            → the best merged candidate that honours the locks is accepted
 *              (never the first one), persisted as a new arrangement version
 *              with a `ScopedRegenerationReport` on its plan and in the chat.
 *
 * Deterministic and model-free; the orchestrator is injectable so the logic
 * is tested without the real brain, and the store is injectable so it is
 * tested without a database (`scopedRegenerationDbStore.ts` is Drizzle's).
 */
import type {
  ArrangementLock,
  ArrangementLockSet,
  ArrangementPlan,
  ArtifactProvenance,
  EditPlan,
  ProducerChatTurnStructured,
  ProductionBrief,
  RegenerationScope,
  ScopedRegenerationCandidate,
  ScopedRegenerationReport,
  SongModelData,
  StyleProfile,
  TrackModel,
} from "@workspace/db";
import {
  orchestrateArrangement,
  type OrchestratedCandidate,
  type OrchestrateInput,
  type OrchestrationResult,
} from "./arrangementOrchestrator";
import { checkArrangementConstraints } from "./musicalConstraints";
import { critiqueArrangement } from "./musicCritic";
import { performedMaterialSha256 } from "./musicEngines";
import { performanceStyleFromProfile } from "./performanceEngine";
import {
  LOCK_SET_VERSION,
  applyPartialRegeneration,
  barOf,
  resolveRegenerationScopes,
  verifyLocksHonoured,
  type BarGeometry,
} from "./regenerationLocks";
import { briefPlannerHints, stampBriefOnPlan } from "./producerIntelligence/briefToPlanner";
import { instrumentFamily } from "./producerIntelligence/vocabulary";
import {
  ProducerChatError,
  type ProducerBriefRecord,
  type ProducerChatTurnRecord,
} from "./producerChat";

export const SCOPED_REGENERATION_METHOD = "scope-aware-regeneration/v1";
export const DEFAULT_REGENERATION_CANDIDATES = 3;
const MIN_CANDIDATES = 3;
const MAX_CANDIDATES = 5;

// ---------------------------------------------------------------------------
// Bar geometry
// ---------------------------------------------------------------------------

/** Seconds → bars the way the planners see the song: explicit bar times when analysed, the first tempo otherwise. */
export function barGeometryFromSongModel(songModel: SongModelData): BarGeometry {
  const bpm = songModel.tempoMap?.[0]?.bpm ?? 120;
  const meter = songModel.meterMap?.[0]?.meter ?? "4/4";
  const beatsPerBar = Number(meter.split("/")[0]) || 4;
  const nominal = (60 / (bpm > 0 ? bpm : 120)) * beatsPerBar;
  const bars = (songModel.bars ?? []).slice().sort((a, b) => a.bar - b.bar);
  const contiguous = bars.length > 0 && bars[0].bar === 1 && bars.every((b, i) => b.bar === i + 1 && Number.isFinite(b.start));
  if (contiguous) {
    const span = bars.length > 1 ? (bars[bars.length - 1].start - bars[0].start) / (bars.length - 1) : nominal;
    return { barSeconds: span > 0 ? span : nominal, originSeconds: bars[0].start, barStarts: bars.map((b) => b.start) };
  }
  return { barSeconds: nominal, originSeconds: songModel.timebase?.originSeconds ?? 0 };
}

// ---------------------------------------------------------------------------
// EditPlan → this arrangement's tracks
// ---------------------------------------------------------------------------

const FAMILY_ALIASES: Record<string, string> = {
  synths: "synth", pad: "pads", piano: "keys", keyboard: "keys", vocal: "vocals", voice: "vocals",
};
const canonicalFamily = (family: string): string => FAMILY_ALIASES[family] ?? family;

/** The family names a track answers to: its own instrument name and the planner family behind it. */
export function trackFamilies(track: Pick<TrackModel, "instrument">): string[] {
  return [...new Set([track.instrument, canonicalFamily(instrumentFamily(track.instrument))])];
}

const matchesFamily = (track: Pick<TrackModel, "instrument">, family: string): boolean =>
  trackFamilies(track).includes(canonicalFamily(family));

const WHOLE_SECTION_INTENTS = new Set<EditPlan["intent"]>([
  "reduce_density", "raise_density", "lower_energy", "raise_energy", "raise_climax",
  "regenerate_part", "change_groove", "change_harmony", "change_aesthetic",
]);

export type ResolvedEditPlan = {
  locks: ArrangementLockSet;
  requested: RegenerationScope[];
  /** Families the EditPlan named that no track of this arrangement carries. */
  unmatchedFamilies: string[];
};

/**
 * The EditPlan speaks in planner families ("keys", "strings"); the arrangement
 * has tracks ("drums", "bass", "strings", "ensemble"). Expand every family
 * lock and scope onto the matching tracks. A section- or song-wide edit that
 * is not about one instrument covers every track in its bars — the ensemble's
 * transitions included — because "the chorus is too busy" is about the chorus.
 */
export function resolveEditPlanToTracks(editPlan: EditPlan, tracks: TrackModel[]): ResolvedEditPlan {
  const unmatched = new Set<string>();
  const locks: ArrangementLock[] = [];
  for (const lock of editPlan.preserve) {
    if (!lock.instrument) { locks.push(lock); continue; }
    const matching = tracks.filter((t) => matchesFamily(t, lock.instrument!));
    if (!matching.length) { unmatched.add(lock.instrument); locks.push(lock); continue; }
    // Identity is the instrument (one physical instrument is one track in the
    // brain's output, and PR-17 merges by instrument); a `trackId` on the lock
    // would make scope resolution — which sees no track ids — skip it.
    for (const track of matching) {
      locks.push({ ...lock, id: `${lock.id}:${track.instrument}`, instrument: track.instrument });
    }
  }

  const requested: RegenerationScope[] = [];
  const seen = new Set<string>();
  const push = (scope: RegenerationScope) => {
    const key = `${scope.instrument}|${scope.sectionName}|${scope.startBar}|${scope.endBar}`;
    if (seen.has(key)) return;
    seen.add(key);
    requested.push(scope);
  };
  for (const scope of editPlan.modify) {
    const matching = tracks.filter((t) => matchesFamily(t, scope.instrument));
    if (!matching.length) { unmatched.add(scope.instrument); continue; }
    for (const track of matching) push({ ...scope, instrument: track.instrument });
  }
  const wholeSection = (editPlan.scope.kind === "section" || editPlan.scope.kind === "global") &&
    !editPlan.scope.instrument && WHOLE_SECTION_INTENTS.has(editPlan.intent);
  if (wholeSection) {
    const ranges = new Map<string, RegenerationScope>();
    for (const scope of editPlan.modify) ranges.set(`${scope.sectionName}|${scope.startBar}|${scope.endBar}`, scope);
    for (const range of ranges.values()) {
      for (const track of tracks) {
        push({ ...range, instrument: track.instrument, reason: `${range.reason} (every track of ${range.sectionName})` });
      }
    }
  }
  return { locks: { version: LOCK_SET_VERSION, locks }, requested, unmatchedFamilies: [...unmatched].sort() };
}

// ---------------------------------------------------------------------------
// Merging one candidate
// ---------------------------------------------------------------------------

export type MergedCandidate = {
  candidate: OrchestratedCandidate;
  trackModels: TrackModel[];
  keptNotes: number;
  replacedNotes: number;
  /** Replaced notes identical (id and content) to the note they replaced — no audible change. */
  identicalReplacedNotes: number;
  verification: ReturnType<typeof verifyLocksHonoured>;
  feasible: boolean;
  score: number;
  constraintErrors: number;
};

/** Re-check playability and re-seal the performance evidence of a track whose material changed. */
function resealTrack(track: TrackModel, tempoBpm: number): TrackModel {
  if (!track.performanceEvidence) return track;
  const playability = checkArrangementConstraints([{
    id: track.id, instrument: track.instrument, role: track.role,
    instrumentDefinition: track.instrumentDefinition, notes: track.notes, articulations: track.articulations,
  }], { tempoBpm }).byTrack[0];
  return {
    ...track,
    performanceEvidence: {
      ...track.performanceEvidence,
      playability: {
        valid: playability ? playability.feasible : true,
        checkedNotes: track.notes.length,
        violations: (playability?.violations ?? []).map((v) =>
          typeof (v as { message?: unknown }).message === "string" ? (v as { message: string }).message : JSON.stringify(v)),
      },
      performedMaterialSha256: performedMaterialSha256(track),
    },
  };
}

export function mergeCandidateIntoArrangement(input: {
  previous: TrackModel[];
  candidate: OrchestratedCandidate;
  allowed: RegenerationScope[];
  locks: ArrangementLockSet;
  geometry: BarGeometry;
  songModel: SongModelData;
  plan: ArrangementPlan;
  projectId: string;
}): MergedCandidate {
  const tempoBpm = input.songModel.tempoMap?.[0]?.bpm ?? 120;
  const previousByInstrument = new Map(input.previous.map((t) => [t.instrument, t]));
  // Track ids are a project-wide key; a regenerated part keeps the row it had.
  const next = input.candidate.trackModels.map((track) => {
    const existing = previousByInstrument.get(track.instrument);
    return { ...track, id: existing?.id ?? `${input.projectId}--${track.id}` };
  });
  const merged = applyPartialRegeneration({
    previous: input.previous, next, allowed: input.allowed, locks: input.locks, geometry: input.geometry,
  });
  const previousObjects = new Set<TrackModel>(input.previous);
  const trackModels = merged.trackModels.map((track) => (previousObjects.has(track) ? track : resealTrack(track, tempoBpm)));
  const verification = verifyLocksHonoured({
    previous: input.previous, merged: trackModels, locks: input.locks, geometry: input.geometry,
  });
  // A deterministic composer given the same plan writes the same part: count
  // the fresh notes that merely reproduce what they replaced, so the ranking
  // and the report can tell a real change from a re-performance of the same one.
  const previousNoteObjects = new Set(input.previous.flatMap((t) => t.notes));
  const previousByKey = new Map(input.previous.flatMap((t) => t.notes.map((n) => [`${t.instrument} ${n.id}`, JSON.stringify(n)] as const)));
  let identicalReplacedNotes = 0;
  for (const track of trackModels) {
    if (previousObjects.has(track)) continue;
    for (const note of track.notes) {
      if (previousNoteObjects.has(note)) continue;
      if (previousByKey.get(`${track.instrument} ${note.id}`) === JSON.stringify(note)) identicalReplacedNotes += 1;
    }
  }
  const critique = critiqueArrangement({ songModel: input.songModel, plan: input.plan, trackModels });
  const constraints = checkArrangementConstraints(
    trackModels.map((t) => ({
      id: t.id, instrument: t.instrument, role: t.role, instrumentDefinition: t.instrumentDefinition,
      notes: t.notes, articulations: t.articulations,
    })),
    { tempoBpm },
  );
  return {
    candidate: input.candidate,
    trackModels,
    keptNotes: merged.report.keptNotes,
    replacedNotes: merged.report.replacedNotes,
    identicalReplacedNotes,
    verification,
    feasible: critique.feasible,
    score: critique.overallScore,
    constraintErrors: constraints.errorCount,
  };
}

/** Which way the edit wants the regenerated material to move; 0 when it says nothing about density. */
export function densityDirection(intent: EditPlan["intent"]): -1 | 0 | 1 {
  switch (intent) {
    case "reduce_density": case "lower_energy": return -1;
    case "raise_density": case "raise_energy": case "raise_climax": return 1;
    default: return 0;
  }
}

/** Fresh notes that actually differ from what they replaced (0..1; 1 when nothing was replaced). */
const changeRatio = (m: MergedCandidate): number =>
  m.replacedNotes === 0 ? 1 : (m.replacedNotes - m.identicalReplacedNotes) / m.replacedNotes;

/**
 * Locks first, then the critic's hard rules, then playability, then score.
 * The symbolic critic scores the whole song and often cannot separate three
 * candidates that differ only inside the edited bars, so equal scores are
 * broken in the edit's own direction — "too busy" prefers the thinner
 * rewrite, "more energy" the fuller one — then by how much of the replaced
 * material really changed (an edit is a request for change; a deterministic
 * composer handed the same plan writes the same part), and only then by id.
 * Never "the first one".
 */
export function rankMergedCandidates(candidates: MergedCandidate[], intent: EditPlan["intent"] = "regenerate_part"): MergedCandidate[] {
  const direction = densityDirection(intent);
  return [...candidates].sort((a, b) =>
    Number(b.verification.honoured) - Number(a.verification.honoured) ||
    Number(b.feasible) - Number(a.feasible) ||
    a.constraintErrors - b.constraintErrors ||
    b.score - a.score ||
    direction * (b.replacedNotes - a.replacedNotes) ||
    changeRatio(b) - changeRatio(a) ||
    a.candidate.candidateId.localeCompare(b.candidate.candidateId));
}

// ---------------------------------------------------------------------------
// The whole step, pure
// ---------------------------------------------------------------------------

export type PreviousArrangement = {
  id: string;
  version: number;
  trackModels: TrackModel[];
  plan: ArrangementPlan | null;
  songModelVersion: number | null;
};

export type RegenerateWithinScopesInput = {
  projectId: string;
  editTurnId: string;
  editPlan: EditPlan;
  previous: PreviousArrangement;
  songModel: SongModelData;
  songModelVersion: number;
  brief: ProductionBrief | null;
  styleProfile: StyleProfile | null;
  candidateCount?: number;
  now?: Date;
  /** Injected for tests; defaults to the Arrangement Brain. */
  orchestrate?: (input: OrchestrateInput) => OrchestrationResult;
};

export type RegenerateWithinScopesResult = {
  trackModels: TrackModel[];
  plan: ArrangementPlan;
  report: ScopedRegenerationReport;
  allowed: RegenerationScope[];
  ranked: MergedCandidate[];
};

/** The previous plan stays the base (its hierarchy and style are still true); the layers the brain re-planned replace theirs. */
function composePlan(input: {
  previous: ArrangementPlan | null;
  orchestrated: ArrangementPlan;
  version: number;
  parentArrangementId: string;
  editTurnId: string;
  brief: ProductionBrief | null;
  report: ScopedRegenerationReport;
}): ArrangementPlan {
  const base = input.previous ?? input.orchestrated;
  const provenance: ArtifactProvenance = {
    ...base.provenance,
    parameters: { ...base.provenance.parameters, regenerationMethod: SCOPED_REGENERATION_METHOD, regenerationOfTurnId: input.editTurnId },
    parentIds: [...new Set([...(base.provenance.parentIds ?? []), input.parentArrangementId])],
    createdBy: SCOPED_REGENERATION_METHOD,
  };
  const plan: ArrangementPlan = {
    ...base,
    version: input.version,
    provenance,
    globalPlan: input.orchestrated.globalPlan,
    sectionPlan: input.orchestrated.sectionPlan,
    orchestrationBudget: input.orchestrated.orchestrationBudget,
    transitionPlan: input.orchestrated.transitionPlan,
    partComposerPlan: input.orchestrated.partComposerPlan,
    candidateGenerationPlan: input.orchestrated.candidateGenerationPlan,
    regeneration: input.report,
  };
  return input.brief ? stampBriefOnPlan(plan, input.brief) : plan;
}

export function regenerateWithinScopes(input: RegenerateWithinScopesInput): RegenerateWithinScopesResult {
  const started = Date.now();
  const now = input.now ?? new Date();
  const orchestrate = input.orchestrate ?? orchestrateArrangement;
  const candidateCount = Math.max(MIN_CANDIDATES, Math.min(MAX_CANDIDATES, Math.round(input.candidateCount ?? DEFAULT_REGENERATION_CANDIDATES)));
  const previous = input.previous.trackModels;
  const warnings: string[] = [];

  const resolved = resolveEditPlanToTracks(input.editPlan, previous);
  const { allowed, blocked } = resolveRegenerationScopes(resolved.requested, resolved.locks);
  const geometry = barGeometryFromSongModel(input.songModel);
  if (!geometry.barStarts) warnings.push("The Song Model carries no bar times; bars were mapped from the first tempo and meter (a linear grid).");
  if (input.previous.songModelVersion !== null && input.previous.songModelVersion !== input.songModelVersion) {
    warnings.push(`The Song Model moved from v${input.previous.songModelVersion} (the arrangement's) to v${input.songModelVersion}; kept material is carried over as it was.`);
  }
  if (resolved.unmatchedFamilies.length) {
    warnings.push(`No track of this arrangement plays ${resolved.unmatchedFamilies.join(", ")}; those parts of the edit had nothing to act on.`);
  }

  // The brief shapes the planners and the performance; the edit's deltas are already in it.
  const hints = input.brief ? briefPlannerHints(input.brief) : null;
  const performanceStyle = input.styleProfile ? performanceStyleFromProfile(input.styleProfile) : undefined;
  const result = orchestrate({
    songModel: input.songModel,
    candidateCount,
    render: false,
    now: new Date(0),
    ...(hints ? { plannerHints: { global: hints.global, section: hints.section } } : {}),
    ...(performanceStyle ? { performanceStyle } : {}),
  });
  if (result.candidates.length < MIN_CANDIDATES) {
    throw new ProducerChatError(409, `The Arrangement Brain produced ${result.candidates.length} candidate(s); at least ${MIN_CANDIDATES} are ranked before one is accepted`);
  }

  const critiquePlan: ArrangementPlan = input.previous.plan
    ? { ...input.previous.plan, globalPlan: result.plan.globalPlan, sectionPlan: result.plan.sectionPlan }
    : result.plan;
  const merged = result.candidates.map((candidate) => mergeCandidateIntoArrangement({
    previous, candidate, allowed, locks: resolved.locks, geometry,
    songModel: input.songModel, plan: critiquePlan, projectId: input.projectId,
  }));
  const ranked = rankMergedCandidates(merged, input.editPlan.intent);
  const winner = ranked[0];
  if (!winner.verification.honoured) {
    throw new ProducerChatError(409, `No candidate could be merged without touching locked material: ${winner.verification.violations.slice(0, 3).join("; ")}`);
  }
  if (winner.replacedNotes > 0 && winner.identicalReplacedNotes === winner.replacedNotes) {
    warnings.push("Every candidate reproduced the previous material note for note: given this brief and plan the deterministic composer writes the same part again. Say what should be different (density, energy, an instrument, a feel) so the brief changes, then apply again.");
  }

  // What changed, by track and by section, from the accepted merge. Kept notes
  // are the previous note objects themselves (the merge never copies them), so
  // identity — not the composer's position-based ids — tells old from fresh.
  const previousById = new Map(previous.map((t) => [t.id, t]));
  const previousNotes = new Set(previous.flatMap((t) => t.notes));
  const changedInstruments = winner.trackModels.filter((t) => previousById.get(t.id) !== t).map((t) => t.instrument).sort();
  const barRanges = allowed.map((scope) => {
    const track = winner.trackModels.find((t) => t.instrument === scope.instrument);
    const replaced = (track?.notes ?? []).filter((n) => {
      const bar = barOf(n.start, geometry);
      return bar >= scope.startBar && bar <= scope.endBar && !previousNotes.has(n);
    }).length;
    return { instrument: scope.instrument, sectionName: scope.sectionName, startBar: scope.startBar, endBar: scope.endBar, replacedNotes: replaced };
  });
  const changedSections = [...new Set(barRanges.filter((r) => r.replacedNotes > 0 || changedInstruments.includes(r.instrument)).map((r) => r.sectionName))].sort();
  const sectionNames = (result.plan.globalPlan?.sectionTargets ?? []).map((s) => s.sectionName);
  const lockedNotes = previous.reduce((sum, t) => sum + t.notes.filter((n) => {
    const bar = barOf(n.start, geometry);
    return resolved.locks.locks.some((lock) =>
      lock.scope === "global" ||
      ((!lock.instrument || lock.instrument === t.instrument) && (!lock.trackId || lock.trackId === t.id) &&
        ((lock.startBar === undefined && lock.endBar === undefined) || ((lock.startBar ?? -Infinity) <= bar && bar <= (lock.endBar ?? Infinity)))));
  }).length, 0);

  const candidates: ScopedRegenerationCandidate[] = ranked.map((m) => ({
    candidateId: m.candidate.candidateId,
    label: m.candidate.label,
    strategy: m.candidate.strategy,
    seed: m.candidate.seed,
    feasible: m.feasible,
    score: m.score,
    constraintErrors: m.constraintErrors,
    locksHonoured: m.verification.honoured,
    violations: m.verification.violations.length,
    replacedNotes: m.replacedNotes,
    identicalReplacedNotes: m.identicalReplacedNotes,
    selected: m === winner,
  }));

  const report: ScopedRegenerationReport = {
    version: LOCK_SET_VERSION,
    method: SCOPED_REGENERATION_METHOD,
    requested: resolved.requested,
    blockedByLock: blocked,
    regenerated: allowed,
    keptNotes: winner.keptNotes,
    replacedNotes: winner.replacedNotes,
    locksHonoured: winner.verification.honoured,
    editTurnId: input.editTurnId,
    editIntent: input.editPlan.intent,
    editText: input.editPlan.rawText,
    parentArrangementId: input.previous.id,
    parentArrangementVersion: input.previous.version,
    songModelVersion: input.songModelVersion,
    productionBriefId: input.brief?.id ?? null,
    productionBriefDigestSha256: input.brief?.inputsDigestSha256 ?? null,
    locks: resolved.locks.locks,
    unmatchedFamilies: resolved.unmatchedFamilies,
    changed: { instruments: changedInstruments, sections: changedSections, barRanges },
    preserved: {
      instruments: previous.filter((t) => !changedInstruments.includes(t.instrument)).map((t) => t.instrument).sort(),
      sections: sectionNames.filter((s) => !changedSections.includes(s)),
      notes: winner.keptNotes,
    },
    verification: { ...winner.verification, checkedLockedNotes: lockedNotes },
    identicalReplacedNotes: winner.identicalReplacedNotes,
    candidates,
    selectedCandidateId: winner.candidate.candidateId,
    plannerHintEvidence: hints?.evidence ?? [],
    warnings,
    durationMs: Math.max(0, Date.now() - started),
  };
  void now;
  const plan = composePlan({
    previous: input.previous.plan, orchestrated: result.plan, version: input.previous.version + 1,
    parentArrangementId: input.previous.id, editTurnId: input.editTurnId, brief: input.brief, report,
  });
  return { trackModels: winner.trackModels, plan, report, allowed, ranked };
}

/** The producer's account of what happened, in words a musician can check. */
export function describeRegeneration(report: ScopedRegenerationReport, arrangement: { version: number }): string {
  const bars = (ranges: ScopedRegenerationReport["changed"]["barRanges"]) => {
    const lo = Math.min(...ranges.map((r) => r.startBar));
    const hi = Math.max(...ranges.map((r) => r.endBar));
    return Number.isFinite(lo) && Number.isFinite(hi) ? `bars ${lo}–${hi}` : "no bars";
  };
  const identical = report.identicalReplacedNotes > 0 ? ` (${report.identicalReplacedNotes} of them identical to before)` : "";
  const changed = report.changed.instruments.length
    ? `Regenerated ${report.changed.instruments.join(", ")} in ${report.changed.sections.join(", ") || "no section"} (${bars(report.changed.barRanges)}): ${report.replacedNotes} note(s) replaced${identical}, ${report.keptNotes} kept verbatim.`
    : `Nothing changed: the allowed scopes produced no new material (${report.keptNotes} note(s) kept).`;
  const preserved = report.preserved.instruments.length ? `${report.preserved.instruments.join(", ")} untouched.` : "Every track was touched somewhere.";
  const blocked = report.blockedByLock.length
    ? `Blocked by locks: ${[...new Set(report.blockedByLock.map((b) => `${b.scope.instrument} in ${b.scope.sectionName}`))].join(", ")}.`
    : "No requested scope was blocked by a lock.";
  const verified = report.verification.honoured
    ? `Locks verified: ${report.verification.checkedLockedNotes} locked note(s) byte-identical.`
    : `Lock verification FAILED: ${report.verification.violations.length} violation(s).`;
  const ranking = `${report.candidates.length} candidates ranked (${report.candidates.map((c) => `${c.strategy} ${c.score.toFixed(0)}${c.feasible ? "" : " ✗"}${c.locksHonoured ? "" : " locks✗"}${c.replacedNotes > 0 && c.identicalReplacedNotes === c.replacedNotes ? " =same" : ""}`).join(", ")}); "${report.candidates.find((c) => c.selected)?.label ?? report.selectedCandidateId}" accepted.`;
  const brief = report.productionBriefId
    ? `The brief shaped the planners (${report.plannerHintEvidence.length} hint(s)).`
    : "No brief: the planners read the Song Model alone.";
  return [
    `Applied "${report.editText}" → arrangement v${arrangement.version} (from v${report.parentArrangementVersion}).`,
    changed, preserved, blocked, verified, ranking, brief,
    ...report.warnings,
  ].join(" ");
}

// ---------------------------------------------------------------------------
// Service + store contract
// ---------------------------------------------------------------------------

export type RegenerableArrangement = PreviousArrangement & {
  projectId: string;
  name: string;
};

export type NewArrangementVersion = {
  projectId: string;
  parent: RegenerableArrangement;
  name: string;
  trackModels: TrackModel[];
  plan: ArrangementPlan;
  songModelVersion: number;
  provenance: ArtifactProvenance;
  parameters: Record<string, number | string | boolean>;
  activity: { title: string; detail: string };
};

export type ScopedRegenerationStore = {
  loadTurn(projectId: string, turnId: string): Promise<ProducerChatTurnRecord | null>;
  /** The latest arrangement of the project that has persisted TrackModels. */
  loadLatestArrangement(projectId: string): Promise<RegenerableArrangement | null>;
  loadSongModel(projectId: string): Promise<{ version: number; model: SongModelData } | null>;
  currentBrief(projectId: string): Promise<ProducerBriefRecord | null>;
  /** Assigns the id and the next version number (stamped on the stored plan too); returns both. */
  insertArrangementVersion(input: NewArrangementVersion): Promise<{ id: string; version: number }>;
  insertTurns(records: ProducerChatTurnRecord[]): Promise<void>;
  transaction<T>(fn: (store: ScopedRegenerationStore) => Promise<T>): Promise<T>;
};

export type ScopedRegenerationOutcome = {
  turnId: string;
  producerTurnId: string;
  reply: string;
  report: ScopedRegenerationReport;
  arrangement: { id: string; version: number };
  briefVersion: number | null;
  structured: ProducerChatTurnStructured;
};

export type ScopedRegenerationServiceOptions = {
  now?: () => Date;
  newId?: () => string;
  orchestrate?: (input: OrchestrateInput) => OrchestrationResult;
};

const fallbackId = (): string => `pc-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;

export function createScopedRegenerationService(store: ScopedRegenerationStore, options: ScopedRegenerationServiceOptions = {}) {
  const now = options.now ?? (() => new Date());
  const newId = options.newId ?? fallbackId;

  return {
    /**
     * Apply the EditPlan of an edit turn to the project's current arrangement.
     * Persists a new arrangement version and a `regeneration` turn pair in one
     * transaction; throws `ProducerChatError` (400/404/409) when it cannot.
     */
    async apply(projectId: string, turnId: string, input: { candidates?: number } = {}): Promise<ScopedRegenerationOutcome> {
      return store.transaction(async (tx) => {
        const turn = await tx.loadTurn(projectId, turnId);
        if (!turn) throw new ProducerChatError(404, `No producer turn "${turnId}" in this project`);
        const editPlan = turn.structured?.kind === "edit" ? turn.structured.editPlan : undefined;
        if (!editPlan) throw new ProducerChatError(400, `Turn "${turnId}" is not an edit turn with an EditPlan — only edit turns can be applied`);
        if (editPlan.intent === "unclear" || editPlan.intent === "keep" || !editPlan.modify.length) {
          throw new ProducerChatError(409, `Nothing to regenerate: the edit "${editPlan.rawText}" was read as "${editPlan.intent.replace(/_/g, " ")}" with ${editPlan.modify.length} regeneration scope(s)`);
        }
        const previous = await tx.loadLatestArrangement(projectId);
        if (!previous || !previous.trackModels.length) {
          throw new ProducerChatError(409, "No arrangement with persisted TrackModels to regenerate within — generate a full arrangement first");
        }
        const songModel = await tx.loadSongModel(projectId);
        if (!songModel) throw new ProducerChatError(409, "No Song Model to compose against");
        const briefRecord = await tx.currentBrief(projectId);
        const at = now();

        const result = regenerateWithinScopes({
          projectId, editTurnId: turn.id, editPlan, previous,
          songModel: songModel.model, songModelVersion: songModel.version,
          brief: briefRecord?.brief ?? null, styleProfile: briefRecord?.styleProfile ?? null,
          candidateCount: input.candidates, now: at, orchestrate: options.orchestrate,
        });
        if (!result.allowed.length) {
          const blocked = [...new Set(result.report.blockedByLock.map((b) => b.lockId))];
          throw new ProducerChatError(409, `Every requested scope is covered by a lock (${blocked.join(", ") || "none named"}); nothing may be regenerated`);
        }

        const parameters: Record<string, number | string | boolean> = {
          regenerationMethod: SCOPED_REGENERATION_METHOD,
          regenerationOfTurnId: turn.id,
          regenerationIntent: editPlan.intent,
          regenerationKeptNotes: result.report.keptNotes,
          regenerationReplacedNotes: result.report.replacedNotes,
          regenerationLocksHonoured: result.report.locksHonoured,
          regenerationSelectedCandidate: result.report.selectedCandidateId,
          ...(briefRecord ? { productionBriefId: briefRecord.brief.id, productionBriefVersion: briefRecord.version } : {}),
        };
        const inserted = await tx.insertArrangementVersion({
          projectId,
          parent: previous,
          name: `${previous.name.replace(/ · edit v\d+$/u, "")} · edit v${previous.version + 1}`,
          trackModels: result.trackModels,
          plan: result.plan,
          songModelVersion: songModel.version,
          provenance: {
            model: SCOPED_REGENERATION_METHOD, version: "1.0", parameters,
            parentIds: [previous.id], createdBy: SCOPED_REGENERATION_METHOD,
          },
          parameters,
          activity: {
            title: "Chat edit applied to the arrangement",
            detail: `"${editPlan.rawText}" · ${result.report.replacedNotes} note(s) replaced, ${result.report.keptNotes} kept · locks ${result.report.locksHonoured ? "honoured" : "VIOLATED"}`,
          },
        });
        const reply = describeRegeneration(result.report, inserted);
        const structured: ProducerChatTurnStructured = {
          kind: "regeneration", briefVersion: briefRecord?.version ?? null,
          regeneration: result.report, arrangementId: inserted.id, arrangementVersion: inserted.version,
          planSource: "arrangement",
        };
        const later = new Date(at.getTime() + 1);
        const userTurn: ProducerChatTurnRecord = {
          id: newId(), projectId, briefId: briefRecord?.id ?? null, role: "user",
          text: `apply: "${editPlan.rawText}"`, structured: null, createdAt: at.toISOString(),
        };
        const producerTurn: ProducerChatTurnRecord = {
          id: newId(), projectId, briefId: briefRecord?.id ?? null, role: "producer",
          text: reply, structured, createdAt: later.toISOString(),
        };
        await tx.insertTurns([userTurn, producerTurn]);
        return {
          turnId: userTurn.id, producerTurnId: producerTurn.id, reply, report: result.report,
          arrangement: inserted, briefVersion: briefRecord?.version ?? null, structured,
        };
      });
    },
  };
}

export type ScopedRegenerationService = ReturnType<typeof createScopedRegenerationService>;

// ---------------------------------------------------------------------------
// In-memory store (tests)
// ---------------------------------------------------------------------------

export type InMemoryRegenerationSeed = {
  turns?: ProducerChatTurnRecord[];
  arrangements?: RegenerableArrangement[];
  songModel?: { version: number; model: SongModelData } | null;
  brief?: ProducerBriefRecord | null;
};

export type InMemoryRegenerationStore = ScopedRegenerationStore & {
  turns: ProducerChatTurnRecord[];
  arrangements: Array<RegenerableArrangement & { parentArrangementId: string | null; provenance: ArtifactProvenance; parameters: Record<string, number | string | boolean>; activity: { title: string; detail: string } | null }>;
};

export function createInMemoryRegenerationStore(seed: InMemoryRegenerationSeed = {}): InMemoryRegenerationStore {
  const turns = [...(seed.turns ?? [])];
  const arrangements: InMemoryRegenerationStore["arrangements"] = (seed.arrangements ?? []).map((a) => ({
    ...a, parentArrangementId: null, provenance: { model: "seed", version: "0", parameters: {}, parentIds: [], createdBy: "seed" }, parameters: {}, activity: null,
  }));
  let counter = 0;
  const self: InMemoryRegenerationStore = {
    turns, arrangements,
    async loadTurn(projectId, turnId) {
      return turns.find((t) => t.projectId === projectId && t.id === turnId) ?? null;
    },
    async loadLatestArrangement(projectId) {
      const candidates = arrangements.filter((a) => a.projectId === projectId && a.trackModels.length > 0);
      return candidates.sort((a, b) => b.version - a.version)[0] ?? null;
    },
    async loadSongModel() { return seed.songModel ?? null; },
    async currentBrief() { return seed.brief ?? null; },
    async insertArrangementVersion(input) {
      const version = Math.max(0, ...arrangements.filter((a) => a.projectId === input.projectId).map((a) => a.version)) + 1;
      const id = `arr-${++counter}`;
      arrangements.push({
        id, projectId: input.projectId, name: input.name, version, trackModels: input.trackModels, plan: { ...input.plan, version },
        songModelVersion: input.songModelVersion, parentArrangementId: input.parent.id, provenance: input.provenance,
        parameters: input.parameters, activity: input.activity,
      });
      return { id, version };
    },
    async insertTurns(records) { turns.push(...records); },
    async transaction(fn) { return fn(self); },
  };
  return self;
}
