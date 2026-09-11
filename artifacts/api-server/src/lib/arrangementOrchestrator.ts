/**
 * End-to-end arrangement orchestrator (PR-16).
 *
 * Runs the whole chain the master plan describes, in order, with per-stage
 * evidence:
 *
 *   plan → parts → candidates → compose → constraints → critique → repair →
 *   perform → render → audio critique → select
 *
 * Every stage is recorded (ok / skipped / failed) so the result is traceable
 * and repeatable. The note generator is injected: without one the built-in
 * reference composer runs, so the chain completes locally with no workers.
 *
 * Brain B-00 (integrity):
 *   - The score that ranks a candidate is the critique of the notes that ship
 *     (performed + playability-repaired). The critique of the composed notes
 *     is kept as `compositionCritique`; the one before repair as `initialCritique`.
 *   - The repair loop recomposes from its repaired plan; a candidate carries
 *     the plan its notes were written from. A pass that changed nothing is
 *     never reported as a repair.
 *   - An empty part, an assumed tempo or meter, a constraint the performed
 *     notes break and a playability check that did not run are findings on
 *     the candidate. `error` findings fail the hard-rule gate, and a candidate
 *     that fails the gate is never `selected` — `selected` is null with the
 *     reason, and every candidate's findings are on the result.
 *   - `traceable` means every canonical stage produced a record and no stage
 *     was skipped or failed without a stated reason.
 */
import type {
  ArrangementBrainFinding,
  ArrangementCritique,
  ArrangementFailureCode,
  ArrangementPlan,
  AudioCritique,
  CandidateStrategyId,
  CriticRepairLoopResult,
  DecisionOriginLayer,
  MusicalNote,
  PartCompositionTelemetry,
  RepairOperationScope,
  SongModelData,
  TrackModel,
  TrackPerformanceTelemetry,
  PerformanceStyle,
} from "@workspace/db";
import { DecisionRegistry, decisionId } from "./decisionProvenance";
import {
  canonicalPerformancePhraseIds,
  canonicalPerformanceTimelineSha256,
  getInstrumentDefinition,
  getInstrumentPerformanceCapability,
  performedMaterialSha256,
} from "./musicEngines";
import { deriveGlobalArrangementPlan, type GlobalPlannerHints } from "./globalArrangementPlanner";
import { deriveSectionPhrasePlan, type SectionPlannerHints } from "./sectionPhrasePlanner";
import { deriveOrchestrationBudget } from "./orchestrationBudget";
import { deriveTransitionPlan } from "./transitionEngine";
import { buildPartComposerPlan, buildPartGenerationRequest, type PartGenerationRequest } from "./partComposer";
import { planCandidateGeneration } from "./candidateStrategies";
import { deriveGroovePlan } from "./groovePlan";
import { agogicsFor } from "./transitionRealisation";
import { applyTextureAfterWriting, isMotifProtected, textureIntentFor, type TextureIntent } from "./composer/texture";
import { checkArrangementConstraints } from "./musicalConstraints";
import { critiqueArrangement } from "./musicCritic";
import { applyPlanRepairs, runBacktrackingRepairLoop, runCriticRepairLoop, type RepairApplier, type RepairExecution } from "./criticRepairLoop";
import {
  applyRepairOperationToPlan,
  familiesSilencedByPass,
  mergeDecisionRegistries,
  planWithLayers,
  sectionWindows,
  spliceTracks,
} from "./repairExecutor";
import { notesOutsideScopePreserved } from "./candidateRepair";
import type { SeededRepairTarget } from "./repairPlanner";
import { repairPlayability, type PlayabilityRepairReport } from "./playabilityRepair";
import { applyPerformance } from "./performanceEngine";
import { renderArrangementStems, renderStem, type StemRenderOptions } from "./referenceRenderWorker";
import { abCompareCandidates, critiqueRenderedAudio, type AudioAbResult, type AudioStem } from "./audioCritic";
import { composeReferencePart, REFERENCE_PART_COMPOSER } from "./referencePartComposer";
import { upgradePartGenerationRequest, type HarmonyPlanSlot, type StyleGrammarSlot } from "./partGenerationContextV2";
import { composeWithContext, type ComposePass } from "./contextAwareComposer";
import { harmonyPlanSlot, solveVoiceLeading } from "./voiceLeading";
import { deriveStyleGrammar, styleGrammarSlot } from "./styleGrammar";
import { deriveStyleFingerprint } from "./styleFingerprint";
import { barTiming } from "./composer/frame";

export const ORCHESTRATOR_VERSION = "1.0" as const;
const METHOD = "arrangement-orchestrator/v1";

export type OrchestratorStage =
  | "plan" | "parts" | "candidates" | "compose" | "constraints"
  | "critique" | "repair" | "perform" | "render" | "audio_critique" | "select"
  | "context";

/** The stages every run must record, in order. `context` is optional and does not break traceability. */
export const CANONICAL_STAGES: readonly OrchestratorStage[] = [
  "plan", "parts", "candidates", "compose", "constraints",
  "critique", "repair", "perform", "render", "audio_critique", "select",
];

export type StageRecord = {
  stage: OrchestratorStage;
  status: "ok" | "skipped" | "failed";
  detail: string;
  evidence?: Record<string, number | string | boolean>;
};

export type CandidateFinding = ArrangementBrainFinding;

export type OrchestratedCandidate = {
  candidateId: string;
  label: string;
  strategy: CandidateStrategyId;
  seed: number;
  /** The plan these notes were composed from: the run's plan, or the repaired plan when a repair pass recomposed. */
  plan: ArrangementPlan;
  /** The notes that ship: performed and playability-repaired. */
  trackModels: TrackModel[];
  noteCount: number;
  /** Composition errors + errors remaining in the performed notes. */
  constraintErrors: number;
  /** Errors remaining in the performed, playability-repaired notes — the ones that would ship. */
  performedConstraintErrors: number;
  /** Critique of the composed notes before any repair pass. */
  initialCritique: ArrangementCritique;
  /** Critique of the composed notes that went to performance (after repair when it recomposed). */
  compositionCritique: ArrangementCritique;
  /** Critique of the shipped notes. This is what ranks. */
  critique: ArrangementCritique;
  repair: CriticRepairLoopResult | null;
  /** True only when a repair pass changed the plan or the notes. */
  repairApplied: boolean;
  findings: CandidateFinding[];
  /** The critic's hard rules plus the orchestrator's `error` findings. */
  hardRule: { feasible: boolean; reasons: string[] };
  playabilityRepairs: Array<{ trackId: string } & PlayabilityRepairReport>;
  audioCritique: AudioCritique | null;
  renderFeasible: boolean | null;
  finalScore: number;
  // --- Brain B-11 (observability): what each layer decided, kept, not summarised ---
  // Optional so that hand-built candidates in older tests stay valid; the orchestrator always fills them.
  /** What each part task composed for this candidate and what density thinning kept (the plan its notes came from). */
  parts?: PartCompositionTelemetry[];
  /** The performance layer's decisions per shipped track: the engine's reasoned sample plus measured deltas for every note. */
  performance?: TrackPerformanceTelemetry[];
  /** Decisions the composing layers registered while writing this candidate's notes (the B-02 / B-04 / B-10 contract). */
  composerDecisions?: DecisionRegistry;
};

export type OrchestrationResult = {
  version: "1.0";
  method: string;
  composer: string;
  stages: StageRecord[];
  plan: ArrangementPlan;
  candidates: OrchestratedCandidate[];
  abComparison: AudioAbResult | null;
  selected: {
    candidateId: string;
    reason: string;
    symbolicScore: number;
    audioScore: number | null;
    combinedScore: number;
  } | null;
  /** Why the winner won, or why nobody did; every rejected candidate with its reasons. */
  selection: {
    reason: string;
    eligible: string[];
    rejected: Array<{ candidateId: string; reasons: string[] }>;
  };
  /** The tempo and meter the run composed at, and whether they were read or assumed. */
  timing: { tempoBpm: number; tempoAssumed: boolean; meter: string; meterAssumed: boolean };
  traceable: boolean;
  /** B-11: the context passes that changed notes (context-aware path); empty when the path was off. Previously collected and dropped. */
  contextPasses: ComposePass[];
};

/**
 * B-11: what the orchestrator hands every composer call besides the request.
 * A composing layer that makes a decision worth tracing registers it here
 * and tags the notes it wrote with the returned id (`note.decisionId`) or
 * attaches a bar range; see docs/brain/04-decision-provenance.md. Optional,
 * so every existing composer (and every test double) is unchanged.
 */
export type PartComposerContext = {
  decisions: DecisionRegistry;
  /**
   * B-13: parts already composed for this candidate, with their notes. The
   * harmony writers voice above the bass part's actual notes and away from
   * sibling voicings; without them the bass is re-planned deterministically
   * from the same inputs (the same skeleton, but not the same notes).
   */
  siblings?: Array<{ instrument: string; role: string; notes: MusicalNote[] }>;
  /** B-13: what the candidate strategy asks of this part's texture (`composer/texture.ts`). */
  texture?: TextureIntent;
};

export type PartComposerFn = (request: PartGenerationRequest, context?: PartComposerContext) => MusicalNote[];

/** `performanceEngine.ts` keeps reasons for this many notes per track (its MAX_DECISION_SAMPLE); B-11 measures the rest. */
export const PERFORMANCE_DECISION_SAMPLE_CAP = 64;
/** Per-note performance deltas are persisted up to this many notes per track; beyond it the counts stay and the arrays are cut. */
export const PERFORMANCE_TELEMETRY_NOTE_CAP = 4000;

export type OrchestrateInput = {
  songModel: SongModelData;
  candidateCount?: number;
  /** Injected note generator; defaults to the deterministic reference composer. */
  composeParts?: PartComposerFn;
  composerName?: string;
  render?: boolean;
  renderOptions?: StemRenderOptions;
  now?: Date;
  /**
   * PR-23: performance style resolved from the project's StyleProfile
   * (performanceStyleFromProfile). Absent keeps V1 performance behaviour.
   */
  performanceStyle?: PerformanceStyle;
  /**
   * PR-31: planner hints from a brief or a learned arranger policy. Absent
   * keeps the planners' own reading of the Song Model.
   */
  plannerHints?: { global?: GlobalPlannerHints; section?: SectionPlannerHints };
  /**
   * Wave Q: run each composed part through the context passes (PR-45) — the
   * vocal's gaps, the sibling parts' actual notes, the solved voicing, the
   * style grammar's groove.
   *
   * Off by default, and deliberately so. The shipped path must not change
   * because a new capability exists; it changes when the benchmark says the
   * new path is better. This flag is what lets the two be measured against
   * each other on the same song, which is the "vs-reference-part-composer"
   * level Wave Q binds every release to.
   */
  contextAware?: boolean;
  /**
   * Q-02. Absent means "derive one from this Song Model" on the context-aware
   * path — the song's own behaviour is the best available description of its
   * style, and leaving the slot empty silently disabled the groove pass.
   * Pass an explicit `not_available` slot to suppress that derivation.
   */
  styleGrammar?: StyleGrammarSlot;
  /**
   * B-00: the plan-level repair applier the repair loop runs before the
   * orchestrator recomposes from the returned plan. Defaults to the loop's
   * deterministic `applyPlanRepairs`; injectable (like `composeParts`) so the
   * recompose path can be exercised by a test or an experiment. Whatever it
   * returns, the orchestrator still recomposes and re-critiques the notes.
   */
  repairApplier?: RepairApplier;
  /**
   * B-06: passes the backtracking repair stage may take (default 3, at most
   * 5). `0` disables the stage — the composed notes go to performance as they
   * are, which is how the defect harness reads a candidate before repair.
   */
  repairMaxPasses?: number;
  /**
   * B-06 (D3): a producer-triggered bounded repair. The finding names its
   * failure code and origin layer; the repair stage plans it first and is
   * restricted to `scope` (sections, bars, track ids in the brain's own
   * naming) instead of re-orchestrating the whole song.
   */
  repair?: {
    finding: {
      id: string;
      kind?: string;
      failureCode?: ArrangementFailureCode;
      originLayer?: DecisionOriginLayer;
      musicalReason: string;
    };
    scope: { sections: string[]; startBar: number; endBar: number; trackIds: string[] };
  };
};

/** B-06: what a repair pass must carry along with the plan and the notes when it is accepted. */
type RepairExtra = { findings: CandidateFinding[]; parts: PartCompositionTelemetry[]; decisions: DecisionRegistry };

// ---------------------------------------------------------------------------

/**
 * One voicing plan for the whole arrangement (Q-04), solved from the Song
 * Model's own chords.
 *
 * Solved once and shared by every part rather than per part, because that is
 * what a voicing plan is: if the piano and the strings each solved their own,
 * they would not be voicing the same chord. One chord per bar — the first —
 * since the solver's unit is the bar; a second chord inside a bar is a
 * harmonic rhythm this plan does not yet express, and pretending otherwise
 * would put a voicing on a beat that never had one.
 */
export function harmonyPlanFor(songModel: SongModelData): HarmonyPlanSlot {
  const bars = songModel.bars ?? [];
  const chords = songModel.chords ?? [];
  if (!bars.length || !chords.length) {
    return {
      status: "not_available",
      reason: !chords.length
        ? "the Song Model has no chords to voice"
        : "the Song Model has no bars to place voicings on",
    };
  }
  const firstPerBar = new Map<number, string>();
  for (const chord of chords) {
    const bar = bars.find((b) => chord.start >= b.start - 1e-6 && chord.start < b.end - 1e-6);
    if (!bar || firstPerBar.has(bar.bar)) continue;
    firstPerBar.set(bar.bar, chord.symbol);
  }
  const progression = [...firstPerBar.entries()]
    .sort(([left], [right]) => left - right)
    .map(([bar, symbol]) => ({ bar, symbol }));
  if (!progression.length) {
    return { status: "not_available", reason: "no chord fell inside a bar of this Song Model" };
  }
  return harmonyPlanSlot(solveVoiceLeading({ chords: progression }));
}

/**
 * The style grammar for this song, derived from its own behaviour (Q-02).
 *
 * The fingerprint is content-free by construction, so nothing about the song's
 * actual notes travels into the grammar — only how it behaves. A song with no
 * strong behaviour yields an empty grammar, and the slot says so rather than
 * inventing a character the song never had.
 */
export function styleGrammarFor(
  songModel: SongModelData,
  tempoBpm: number,
  meter: string,
  sourceId: string,
): StyleGrammarSlot {
  try {
    const fingerprint = deriveStyleFingerprint({
      // The song being arranged is the reference for its own style.
      source: { kind: "song_model", id: sourceId, version: null },
      songModel,
      tempoBpm,
      meter,
    });
    return styleGrammarSlot(deriveStyleGrammar(fingerprint));
  } catch (error) {
    // A fingerprint that cannot be taken is a missing grammar, not a crash in
    // the middle of an arrangement.
    return {
      status: "not_available",
      reason: `no style fingerprint could be taken: ${error instanceof Error ? error.message : "unknown"}`,
    };
  }
}

/**
 * A strategy's density as a *velocity* reading (Brain B-13).
 *
 * `applyDensity` used to delete every Nth note of the time-sorted list to hit
 * a strategy's multiplier: kicks fell off downbeats (B-12, C7), a motif
 * statement lost half its notes (B-10, and R-1b P1-5 on the shipped bridge
 * counter-line: 10 composed -> 5 shipped on the *conservative* candidate), and
 * an inner voice vanished from a solved voicing. Which notes exist is now the
 * writers' decision, taken from the strategy's `TextureIntent`
 * (`composer/texture.ts`) while writing - a sustained bed, block chords on the
 * plan's cell, an arpeggio, roots only or the full figure set. What is left
 * here is the part of the multiplier that was always a dynamic reading: a
 * thinner strategy plays a little softer.
 */
function applyStrategyDynamics(notes: MusicalNote[], multiplier: number): MusicalNote[] {
  if (notes.length === 0 || multiplier === 1) return notes;
  const velocityScale = multiplier > 1 ? Math.min(1.18, multiplier) : 0.78 + multiplier * 0.22;
  return notes.map((n) => ({
    ...n,
    velocity: Math.max(1, Math.min(127, Math.round(n.velocity * velocityScale))),
  }));
}

/**
 * Drop duplicate onsets of the same pitch, keeping the loudest.
 *
 * B-13 at the merge: a note carrying motif provenance outranks a louder one
 * that carries none (`isMotifProtected`). One instrument is one track, and
 * since B-13 wired the beds to the groove plan a bed and a motif statement can
 * now sound the same pitch at the same instant on the same track - the owner's
 * Bridge is exactly that shape. Keeping the loudest would silently delete a
 * note of the statement, which is the defect `applyDensity` was removed for.
 * Between two notes that are both motif notes, or neither, the loudest still
 * wins.
 */
function dedupeSimultaneous(notes: MusicalNote[]): MusicalNote[] {
  const best = new Map<string, MusicalNote>();
  for (const note of notes.slice().sort((a, b) => a.start - b.start || a.pitch - b.pitch)) {
    const key = `${Math.round(note.start * 200)}:${note.pitch}`;
    const held = best.get(key);
    if (!held) { best.set(key, note); continue; }
    const heldMotif = isMotifProtected(held);
    const noteMotif = isMotifProtected(note);
    if (heldMotif !== noteMotif) { if (noteMotif) best.set(key, note); continue; }
    if (note.velocity > held.velocity) best.set(key, note);
  }
  return [...best.values()].sort((a, b) => a.start - b.start || a.pitch - b.pitch);
}

function trackModelFor(
  instrument: string,
  role: string,
  notes: MusicalNote[],
  version: number,
): TrackModel {
  const definition = getInstrumentDefinition(instrument, role);
  return {
    id: `${instrument}-${role}`.toLowerCase().replace(/\s+/g, "_"),
    instrument,
    instrumentDefinition: definition,
    role,
    notes,
    cc: [],
    articulations: [],
    automation: [],
    source: REFERENCE_PART_COMPOSER,
    version,
    provenance: {
      model: REFERENCE_PART_COMPOSER,
      version: "1.0.0",
      parameters: { noteCount: notes.length },
      parentIds: [],
      createdBy: METHOD,
    },
  };
}

/** Tasks that decorate a section rather than carry a planned family; dropping one is a warning, not a failure. */
const DECORATIVE_TASKS = new Set<PartGenerationRequest["task"]>(["FILL", "TRANSITION", "INTRO", "ENDING"]);
/** Tasks that need no harmony to write. */
const UNPITCHED_TASKS = new Set<PartGenerationRequest["task"]>(["DRUMS", "PERCUSSION"]);

/**
 * `traceable` (B-00): every canonical stage has a record, and no record is
 * skipped or failed without saying why. An optional `context` stage neither
 * adds nor removes traceability.
 */
export function isTraceable(stages: StageRecord[]): boolean {
  return CANONICAL_STAGES.every((stage) => stages.some((record) => record.stage === stage)) &&
    stages.every((record) => record.status === "ok" || record.detail.trim().length > 0);
}

// ---------------------------------------------------------------------------

type PlanLayers = {
  globalPlan: NonNullable<ArrangementPlan["globalPlan"]>;
  sectionPlan: NonNullable<ArrangementPlan["sectionPlan"]>;
  orchestrationBudget: NonNullable<ArrangementPlan["orchestrationBudget"]>;
  transitionPlan: NonNullable<ArrangementPlan["transitionPlan"]>;
};

function layersOf(plan: ArrangementPlan): PlanLayers | null {
  if (!plan.globalPlan || !plan.sectionPlan || !plan.orchestrationBudget || !plan.transitionPlan) return null;
  return {
    globalPlan: plan.globalPlan,
    sectionPlan: plan.sectionPlan,
    orchestrationBudget: plan.orchestrationBudget,
    transitionPlan: plan.transitionPlan,
  };
}

export function orchestrateArrangement(input: OrchestrateInput): OrchestrationResult {
  const now = input.now ?? new Date(0);
  const stages: StageRecord[] = [];
  const record = (
    stage: OrchestratorStage, status: StageRecord["status"], detail: string,
    evidence?: StageRecord["evidence"],
  ) => stages.push({ stage, status, detail, evidence });

  const songModel = input.songModel;
  // B-00: a missing tempo or meter is not silently 120 in 4/4. The run still
  // composes — at an *assumed* value, so the trace is inspectable — but every
  // candidate carries an `error` finding and none can pass the hard-rule gate.
  const readTempo = songModel.tempoMap?.[0]?.bpm;
  const readMeter = songModel.meterMap?.[0]?.meter;
  const tempoAssumed = !(typeof readTempo === "number" && Number.isFinite(readTempo) && readTempo > 0);
  const meterAssumed = !(typeof readMeter === "string" && /^\d+\/\d+$/.test(readMeter));
  const tempoBpm = tempoAssumed ? 120 : readTempo;
  const meter = meterAssumed ? "4/4" : readMeter;
  const timingFindings: CandidateFinding[] = [];
  if (tempoAssumed) {
    timingFindings.push({
      kind: "unknown_tempo", severity: "error",
      message: "Tempo is UNKNOWN: the Song Model has no tempo map, so the run composed at an assumed 120 BPM. Nothing composed at an assumed tempo may ship.",
    });
  }
  if (meterAssumed) {
    timingFindings.push({
      kind: "unknown_meter", severity: "error",
      message: "Meter is UNKNOWN: the Song Model has no meter map, so the run composed in an assumed 4/4. Nothing composed in an assumed meter may ship.",
    });
  }
  const compose = input.composeParts ??
    ((request: PartGenerationRequest, context?: PartComposerContext) =>
      composeReferencePart(request, {
        // B-21 left this line for the integration and named it: the
        // orchestrator builds a `DecisionRegistry` per candidate and hands it
        // to `compose(request, { decisions, ... })`, but this default lambda
        // forwarded only `siblings` and `texture`, so every writer decision
        // was dropped on the floor and `decisionTrace` answered "not recorded"
        // for groove. The registry is what makes "why is this note here"
        // answerable.
        tempoBpm, meter, siblings: context?.siblings, texture: context?.texture,
        decisions: context?.decisions,
      }));
  const composerName = input.composerName ??
    (input.composeParts ? "INJECTED_COMPOSER" : REFERENCE_PART_COMPOSER);

  // --- 1. plan ----------------------------------------------------------
  const globalPlan = deriveGlobalArrangementPlan(songModel, { now, hints: input.plannerHints?.global });
  const sectionPlan = deriveSectionPhrasePlan(songModel, globalPlan, { now, hints: input.plannerHints?.section });
  const orchestrationBudget = deriveOrchestrationBudget(songModel, sectionPlan, { now });
  const transitionPlan = deriveTransitionPlan(songModel, globalPlan, sectionPlan, { now });
  const plan: ArrangementPlan = {
    id: `orchestrated-${globalPlan.inputsDigestSha256.slice(0, 8)}`,
    version: 1,
    sections: [],
    style: {} as ArrangementPlan["style"],
    songModelVersion: 1,
    parameters: {},
    provenance: {
      model: METHOD, version: "1.0.0", parameters: {}, parentIds: [], createdBy: METHOD,
    },
    hierarchy: {} as ArrangementPlan["hierarchy"],
    globalPlan, sectionPlan, orchestrationBudget, transitionPlan,
  } as ArrangementPlan;
  // B-13: the GroovePlan is derived once for the song and persisted on the
  // plan. Every part already derived the identical section from its own
  // request (`grooveSectionForRequest`, B-04's parity test); persisting it is
  // what lets the performance stage, the critics and the evidence read the
  // groove the notes were written from instead of re-deriving it.
  plan.groovePlan = deriveGroovePlan(
    songModel,
    { globalPlan, sectionPlan, transitions: transitionPlan.transitions },
    { tempoBpm, meter, now },
  );
  record("plan", "ok", `${globalPlan.sectionTargets.length} sections planned`, {
    style: globalPlan.style,
    climaxBar: globalPlan.climax?.atBar ?? 0,
    confidence: globalPlan.confidence,
    tempoBpm,
    tempoAssumed,
    meter,
    meterAssumed,
  });

  // --- 2. parts ---------------------------------------------------------
  const partPlan = buildPartComposerPlan(songModel, globalPlan, sectionPlan, transitionPlan.transitions, { now });
  plan.partComposerPlan = partPlan;
  record("parts", "ok", `${partPlan.tasks.length} part tasks`, { tasks: partPlan.tasks.length });

  // --- 3. candidates ----------------------------------------------------
  const candidatePlan = planCandidateGeneration(songModel, input.candidateCount ?? 5, {
    now, partPlan,
  });
  plan.candidateGenerationPlan = candidatePlan;
  record("candidates", "ok", `${candidatePlan.candidates.length} strategies`, {
    strategies: candidatePlan.candidates.map((c) => c.strategy).join(","),
  });

  // Solved once for the arrangement, not once per part: two parts voicing the
  // same chord differently are not voicing the same chord.
  const beatSeconds = 60 / Math.max(1, tempoBpm);
  // B-13: one bar timing for the whole run (a bar is numerator x one denominator unit).
  const barTimingForPerformance = barTiming(tempoBpm, meter);
  const harmonyPlan = input.contextAware ? harmonyPlanFor(songModel) : undefined;
  // The song's own behaviour is the best available description of its style.
  // Deriving it here is what makes the groove pass run at all; before this the
  // slot arrived empty from every caller and the pass silently did nothing.
  const styleGrammar = input.contextAware
    ? input.styleGrammar ?? styleGrammarFor(songModel, tempoBpm, meter, plan.id)
    : undefined;
  const contextPasses: ComposePass[] = [];
  if (input.contextAware) {
    record(
      "context",
      harmonyPlan?.status === "available" ? "ok" : "skipped",
      [
        harmonyPlan?.status === "available"
          ? `voicing plan solved (${harmonyPlan.version})`
          : `no voicing plan: ${harmonyPlan?.status === "not_available" ? harmonyPlan.reason : "not requested"}`,
        styleGrammar?.status === "available"
          ? `style grammar ${styleGrammar.version} with ${styleGrammar.rules.length} rule(s)`
          : `no style grammar: ${styleGrammar?.status === "not_available" ? styleGrammar.reason : "not requested"}`,
      ].join("; "),
    );
  }

  /**
   * Compose every task of a part plan for one candidate against one set of
   * plan layers. Used for the first composition and again when a repair pass
   * changes the plan, so the repaired plan is what the shipped notes come from.
   *
   * One physical instrument is one performer: parts for the same instrument
   * merge into a single track even when their section roles differ, so the
   * constraint engine sees the real simultaneous load (limbs, hands, strings).
   * A part that writes nothing is a finding, not a silent `continue`.
   */
  const composeCandidate = (
    layers: PlanLayers,
    tasks: typeof partPlan.tasks,
    candidate: (typeof candidatePlan.candidates)[number],
  ): { trackModels: TrackModel[]; findings: CandidateFinding[]; parts: PartCompositionTelemetry[]; decisions: DecisionRegistry } => {
    const requestLayers = {
      globalPlan: layers.globalPlan, sectionPlan: layers.sectionPlan,
      budgetWindows: layers.orchestrationBudget.windows,
      transitions: layers.transitionPlan.transitions,
    };
    const byTrack = new Map<string, { instrument: string; role: string; notes: MusicalNote[] }>();
    const existing: Array<{ instrument: string; role: string; noteCount: number }> = [];
    // The same parts again, with their notes. V1 carries only counts, and a
    // count is not something a later part can arrange against.
    const siblings: Array<{ instrument: string; role: string; notes: MusicalNote[] }> = [];
    const findings: CandidateFinding[] = [];
    // B-11: one registry per composition; every composer call may register
    // the decisions it took, and every task records what it composed.
    const decisions = new DecisionRegistry();
    const parts: PartCompositionTelemetry[] = [];
    for (const task of tasks) {
      const adjustment = candidate.partAdjustments.find((a) => a.taskId === task.id);
      const request = buildPartGenerationRequest(
        songModel, { ...task, seed: adjustment?.seed ?? task.seed }, requestLayers, existing,
      );
      // B-13 (D3): the strategy reaches the writers as a texture, not as a
      // stride over their output. `siblings` reaches them too, so the keys
      // voice above the bass part's actual notes instead of a re-planned copy.
      const texture = textureIntentFor(candidate.strategy, {
        syncopationBias: Number(candidate.parameters.syncopationBias ?? 0),
        harmonicAdventurousness: Number(candidate.parameters.harmonicAdventurousness ?? 0.3),
        registerSpread: Number(candidate.parameters.registerSpread ?? 0.5),
        orchestrationSizeDelta: Number(candidate.parameters.orchestrationSizeDelta ?? 0),
      }, adjustment?.densityMultiplier ?? 1);
      const raw = compose(request, { decisions, siblings, texture });
      // The kit's writer is B-04's: its texture (hats on the pulses, ghosts
      // home) is applied to the notes it wrote, and never to a kick or a snare.
      const textured = applyTextureAfterWriting(task.task, raw, texture, barTimingForPerformance.meter);
      let notes = applyStrategyDynamics(textured.notes, adjustment?.densityMultiplier ?? 1);
      parts.push({
        taskId: task.id,
        decisionId: decisionId("compose", "part_task", task.id),
        task: task.task, instrument: task.instrument, role: task.role, sectionName: task.sectionName,
        startBar: task.startBar, endBar: task.endBar, seed: adjustment?.seed ?? task.seed,
        composedNotes: raw.length, keptNotes: notes.length, densityMultiplier: adjustment?.densityMultiplier ?? 1,
      });
      if (input.contextAware) {
        const upgraded = upgradePartGenerationRequest(request, {
          siblings,
          styleGrammar,
          harmonyPlan,
        });
        const result = composeWithContext(upgraded, notes, { beatSeconds });
        notes = result.notes;
        for (const pass of result.passes) {
          if (pass.changed > 0) contextPasses.push(pass);
        }
      }
      if (notes.length === 0) {
        const section = layers.sectionPlan.sections.find((s) => s.sectionName === task.sectionName);
        const planned = section?.activeInstrumentFamilies.includes(task.instrument) ?? false;
        const decorative = DECORATIVE_TASKS.has(task.task);
        const pitched = !UNPITCHED_TASKS.has(task.task);
        const harmonyUnder = request.context.currentBars.chords.length;
        // Severity names the cause, not a guess at it: a planned part that had
        // material and wrote nothing is an error; a pitched part with no chord
        // under its bars had nothing to write from — that is the plan's
        // defect (a family planned where there is no harmony), reported as a
        // warning with the missing harmony as the reason.
        const noMaterial = pitched && harmonyUnder === 0;
        const severity = planned && !decorative && !noMaterial ? "error" : "warning";
        findings.push({
          kind: "dropped_part",
          severity,
          instrument: task.instrument,
          taskId: task.id,
          sectionName: task.sectionName,
          startBar: task.startBar,
          endBar: task.endBar,
          message: severity === "error"
            ? `${task.instrument} (${task.task}) is planned in "${task.sectionName}" (bars ${task.startBar}-${task.endBar}) with ${harmonyUnder} chord(s) under it but wrote no notes; the section ships without it.`
            : noMaterial
              ? `${task.instrument} (${task.task}) wrote no notes for "${task.sectionName}" (bars ${task.startBar}-${task.endBar}): no chord lies under those bars, so a pitched part had no harmony to write from.`
              : `${task.instrument} (${task.task}) wrote no notes for "${task.sectionName}" (bars ${task.startBar}-${task.endBar}).`,
        });
        continue;
      }
      const key = task.instrument;
      const entry = byTrack.get(key) ?? { instrument: task.instrument, role: task.role, notes: [] };
      entry.notes.push(...notes);
      byTrack.set(key, entry);
      existing.push({ instrument: task.instrument, role: task.role, noteCount: notes.length });
      siblings.push({ instrument: task.instrument, role: task.role, notes });
    }
    // A family the section plan lists as active for which the part plan made
    // no task at all (the owner's song: `keys` was LEAD in every sung section
    // and `taskFor("LEAD")` returns nothing) wrote nothing and would have
    // shipped as silence with no record. The cause that can be read from the
    // plan — the role that produced no task — is named; the fix is B-01's.
    for (const section of layers.sectionPlan.sections) {
      for (const family of section.activeInstrumentFamilies) {
        const hasTask = tasks.some((t) => t.sectionName === section.sectionName && t.instrument === family);
        if (hasTask) continue;
        const role = layers.sectionPlan.roleAssignments.find(
          (r) => r.sectionName === section.sectionName && r.instrument === family,
        )?.role ?? null;
        findings.push({
          kind: "planned_family_silent",
          severity: "error",
          instrument: family,
          sectionName: section.sectionName,
          startBar: section.startBar,
          endBar: section.endBar,
          message: `${family} is an active family of "${section.sectionName}" (bars ${section.startBar}-${section.endBar}) but no part task exists for it` +
            (role ? ` (its role there is ${role}, which produced no task)` : " (it has no role assignment there)") +
            "; the section ships without it.",
        });
      }
    }
    // Merged parts can now double the same pitch at the same instant; keep the
    // loudest and drop the duplicate rather than asking for a third hand.
    for (const entry of byTrack.values()) {
      entry.notes = dedupeSimultaneous(entry.notes);
    }
    const trackModels = [...byTrack.values()]
      .map((entry, index) => trackModelFor(entry.instrument, entry.role, entry.notes.sort((a, b) => a.start - b.start), index + 1))
      .filter((track) => track.notes.length > 0);
    return { trackModels, findings, parts, decisions };
  };

  const composed: OrchestratedCandidate[] = [];
  let totalNotes = 0;
  let totalConstraintErrors = 0;
  let totalDroppedParts = 0;
  let renderedAny = false;
  const allPlayabilityRepairs: Array<{ candidate: string; trackId: string } & PlayabilityRepairReport> = [];
  const baseLayers = layersOf(plan)!;

  for (const candidate of candidatePlan.candidates) {
    // --- 4. compose ---------------------------------------------------
    const composition = composeCandidate(baseLayers, partPlan.tasks, candidate);
    let candidatePlanLayers: ArrangementPlan = plan;
    let trackModels = composition.trackModels;
    let findings: CandidateFinding[] = [...timingFindings, ...composition.findings];
    // B-11: the telemetry of the composition the shipped notes came from.
    let parts = composition.parts;
    let composerDecisions = composition.decisions;

    // --- 5. constraints ------------------------------------------------
    const constraintReport = checkArrangementConstraints(
      trackModels.map((t) => ({
        id: t.id, instrument: t.instrument, role: t.role,
        instrumentDefinition: t.instrumentDefinition, notes: t.notes,
      })),
      { tempoBpm },
    );

    // --- 6/7. critique + repair ---------------------------------------
    const initialCritique = critiqueArrangement({ songModel, plan, trackModels });
    let repair: CriticRepairLoopResult;
    if (input.repairApplier) {
      // B-00's plan-level applier path, kept for callers that inject one: the
      // applier edits the plan *and the orchestrator recomposes from it*, so
      // the loop's re-critique judges notes that exist. Deterministic: the
      // same repaired plan yields the same part plan, seeds and notes.
      const planApplier = input.repairApplier ?? applyPlanRepairs;
      const recomposeFromRepairedPlan: RepairApplier = (context) => {
        const planned = planApplier(context);
        if (planned.applied.length === 0 || JSON.stringify(planned.plan) === JSON.stringify(context.plan)) {
          // Nothing changed; say so rather than claim a repair.
          return { plan: context.plan, trackModels: context.trackModels, applied: [] };
        }
        const layers = layersOf(planned.plan);
        if (!layers) return { plan: context.plan, trackModels: context.trackModels, applied: [] };
        const repairedPartPlan = buildPartComposerPlan(
          songModel, layers.globalPlan, layers.sectionPlan, layers.transitionPlan.transitions, { now },
        );
        planned.plan.partComposerPlan = repairedPartPlan;
        const recomposed = composeCandidate(layers, repairedPartPlan.tasks, candidate);
        // Dropped parts of the recomposition replace the original composition's.
        findings = [...timingFindings, ...recomposed.findings];
        parts = recomposed.parts;
        composerDecisions = recomposed.decisions;
        return { plan: planned.plan, trackModels: recomposed.trackModels, applied: planned.applied };
      };
      repair = {
        ...runCriticRepairLoop({ songModel, plan, trackModels, initialCritique, applyRepair: recomposeFromRepairedPlan }),
        mode: "legacy_plan_applier",
      };
      if (repair.appliedPasses > 0) {
        candidatePlanLayers = repair.plan;
        if (repair.trackModels) trackModels = repair.trackModels;
      } else {
        // The recomposition never ran or changed nothing: the original findings stand.
        findings = [...timingFindings, ...composition.findings];
        parts = composition.parts;
        composerDecisions = composition.decisions;
      }
    } else {
      // B-06: repair that reopens the decision that caused it. The note-level
      // critics (B-05a / B-05b) and the judge read the composed notes; the
      // planner names, per group of observations, the layer to reopen and a
      // bounded operation on that layer's plan objects; the executor below
      // applies it, regenerates the plan below that layer, recomposes only the
      // tasks in scope and splices them over the candidate's notes; the loop
      // re-runs the critics and keeps the pass only if the targeted
      // observations are gone and the verdict did not worsen. Untouched notes
      // are verified byte-identical (`notesOutsideScopePreserved`).
      const producerScope: RepairOperationScope | null = input.repair
        ? {
            sections: [...input.repair.scope.sections],
            instruments: [...new Set(input.repair.scope.trackIds.map((id) => trackModels.find((t) => t.id === id)?.instrument).filter((i): i is string => !!i))].sort(),
            trackIds: [...input.repair.scope.trackIds],
            startBar: input.repair.scope.startBar,
            endBar: input.repair.scope.endBar,
          }
        : null;
      const producerSeed: SeededRepairTarget | null = input.repair && producerScope
        ? {
            id: input.repair.finding.id,
            failureCode: input.repair.finding.failureCode ?? "INPUT_UNKNOWN",
            originLayer: input.repair.finding.originLayer ?? "unknown",
            ...(input.repair.finding.kind ? { kind: input.repair.finding.kind } : {}),
            reason: input.repair.finding.musicalReason,
            scope: producerScope,
          }
        : null;
      const executorContext = { songModel, now, plannerHints: input.plannerHints };
      const backtracking = runBacktrackingRepairLoop<RepairExtra>({
        songModel, plan, trackModels, initialCritique,
        maxPasses: input.repairMaxPasses,
        scopeLimit: producerScope,
        seeded: producerSeed,
        // These notes came out of `composeCandidate` from this plan a moment
        // ago, so a bare recompose of a part would write them again: the
        // planner is told, and defers such a group with that reason instead of
        // spending a pass proving it (R-1a P1-4).
        notesAreFreshFromPlan: true,
        initialExtra: { findings: composition.findings, parts: composition.parts, decisions: composition.decisions },
        execute: (operation, state, pass, extra): RepairExecution<RepairExtra> => {
          const currentLayers = layersOf(state.plan) ?? baseLayers;
          const currentPartPlan = state.plan.partComposerPlan ?? partPlan;
          const edit = applyRepairOperationToPlan(operation, executorContext, currentLayers, currentPartPlan);
          if ("rejected" in edit) return edit;
          if (producerScope && edit.propagatedSections.some((s) => !producerScope.sections.includes(s))) {
            return { rejected: `the plan change propagated to ${edit.propagatedSections.filter((s) => !producerScope.sections.includes(s)).join(", ")}, outside the producer's repair scope` };
          }
          const scopeSections = new Set([...operation.scope.sections, ...edit.propagatedSections]);
          const scopedInstruments = operation.scope.instruments.length ? new Set(operation.scope.instruments) : null;
          const inScope = (task: { sectionName: string; instrument: string }) =>
            scopeSections.has(task.sectionName) && (!scopedInstruments || scopedInstruments.has(task.instrument));
          const tasksNow = edit.partPlan.tasks.filter(inScope);
          const tasksBefore = currentPartPlan.tasks.filter(inScope);
          if (!tasksNow.length && !tasksBefore.length) return { rejected: "no part task lies in the operation's scope" };
          const instruments = new Set([...tasksBefore.map((t) => t.instrument), ...tasksNow.map((t) => t.instrument)]);
          const windows = sectionWindows(songModel, edit.layers.sectionPlan.sections.filter((s) => scopeSections.has(s.sectionName)), { tempoBpm, meter });
          const recomposed = tasksNow.length
            ? composeCandidate(edit.layers, tasksNow, candidate)
            : { trackModels: [] as TrackModel[], findings: [] as CandidateFinding[], parts: [] as PartCompositionTelemetry[], decisions: new DecisionRegistry() };
          const spliced = spliceTracks(state.trackModels, recomposed.trackModels, { instruments, windows });
          const preserved = notesOutsideScopePreserved(state.trackModels, spliced, { instruments, windows });
          if (!preserved.preserved) return { rejected: `scope violation: ${preserved.violations.join("; ")}` };
          // A repair pass may not leave a family the plan still calls active
          // with nothing to play: that ships planned silence, which is the
          // defect the program started from, not a repair.
          const silenced = familiesSilencedByPass(state.trackModels, spliced, windows);
          if (silenced.length) return { rejected: `the pass silenced ${silenced.join(", ")} in ${[...scopeSections].join(", ")}, which the plan it wrote still plans there` };
          const notesChanged = JSON.stringify(spliced.map((t) => [t.instrument, t.notes])) !== JSON.stringify(state.trackModels.map((t) => [t.instrument, t.notes]));
          // Findings, part telemetry and decisions: keep what lies outside the
          // scope, replace what lies inside with the recomposition's own. The
          // recomposition saw only the scoped tasks, so its findings about other
          // families are not about this pass and are dropped.
          const findingInScope = (f: CandidateFinding) =>
            !!f.sectionName && scopeSections.has(f.sectionName) && (!scopedInstruments || !f.instrument || scopedInstruments.has(f.instrument));
          const previous = extra ?? { findings: composition.findings, parts: composition.parts, decisions: composition.decisions };
          const mergedFindings = [
            ...previous.findings.filter((f) => !findingInScope(f)),
            ...recomposed.findings.filter(findingInScope),
          ];
          const mergedParts = [
            ...previous.parts.filter((p) => !(scopeSections.has(p.sectionName) && (!scopedInstruments || scopedInstruments.has(p.instrument)))),
            ...recomposed.parts,
          ];
          const merged = mergeDecisionRegistries(
            previous.decisions, recomposed.decisions,
            { sections: scopeSections, instruments: scopedInstruments, startBar: operation.scope.startBar, endBar: operation.scope.endBar },
            [...new Set([...state.trackModels.map((t) => t.instrument), ...spliced.map((t) => t.instrument)])],
          );
          const reopened = merged.registry.register({
            layer: operation.layer === "compose" ? "compose" : operation.layer,
            kind: "repair_reopened",
            qualifiers: [candidate.candidateId, pass],
            startBar: operation.scope.startBar, endBar: operation.scope.endBar,
            reason: `repair pass ${pass} reopened the ${operation.layer} layer with ${operation.operation} on ${[...scopeSections].join(", ")}: ${operation.reason}. ${edit.note}`,
          });
          for (const instrument of instruments) merged.registry.attach(instrument, operation.scope.startBar, operation.scope.endBar, [reopened.id]);
          return {
            plan: planWithLayers(state.plan, edit.layers, edit.partPlan),
            trackModels: spliced,
            changed: { plan: edit.planChanged, notes: notesChanged },
            scope: { ...operation.scope, sections: [...scopeSections], instruments: [...instruments].sort() },
            note: `${edit.note}; ${tasksNow.length} task(s) recomposed (${tasksNow.map((t) => t.id).join(", ") || "none"})` +
              (edit.propagatedSections.length ? `; the plan change propagated to ${edit.propagatedSections.join(", ")}, recomposed as well` : ""),
            decisionIdsChanged: [...merged.changedIds, reopened.id],
            extra: { findings: mergedFindings, parts: mergedParts, decisions: merged.registry },
          };
        },
      });
      // The candidate keeps the pass records, the repair plan and the compact
      // critic summaries; the full critic reports and the accepted pass's
      // registries stay in this scope (they are megabytes and one of them is a
      // class instance — neither belongs on a persisted candidate).
      const { evaluationBefore: _before, evaluationAfter: _after, lastAccepted: _accepted, ...persistable } = backtracking;
      repair = persistable;
      if (backtracking.lastAccepted) {
        candidatePlanLayers = backtracking.plan;
        if (backtracking.trackModels) trackModels = backtracking.trackModels;
        findings = [...timingFindings, ...backtracking.lastAccepted.findings];
        parts = backtracking.lastAccepted.parts;
        composerDecisions = backtracking.lastAccepted.decisions;
      }
    }
    const repairApplied = repair.appliedPasses > 0;
    const compositionCritique = repairApplied ? repair.finalCritique : initialCritique;
    const planForPerformance = layersOf(candidatePlanLayers) ?? baseLayers;

    // --- 8. perform ----------------------------------------------------
    const playabilityRepairs: OrchestratedCandidate["playabilityRepairs"] = [];
    const performanceTelemetry: TrackPerformanceTelemetry[] = [];
    // B-13 (R-1b P0-3): a track is performed section by section. The first
    // assignment stays the fallback for a note outside every planned range.
    const barSecondsForPerformance = barTimingForPerformance.barSeconds;
    const sectionRangesFor = (instrument: string) =>
      planForPerformance.sectionPlan.sections.map((section) => {
        const assignment = planForPerformance.sectionPlan.roleAssignments.find(
          (r) => r.sectionName === section.sectionName && r.instrument === instrument,
        );
        return {
          sectionName: section.sectionName,
          start: (section.startBar - 1) * barSecondsForPerformance,
          end: section.endBar * barSecondsForPerformance,
          role: assignment?.role,
          dynamicShape: assignment?.dynamicShape,
          tensionRole: planForPerformance.globalPlan.sectionTargets
            .find((t) => t.sectionName === section.sectionName)?.tensionRole,
        };
      });
    // B-04's chord onsets and the plan's ritardando reach every track alike:
    // one harmonic rhythm for the pedal, one time warp for the ensemble.
    const performanceChordOnsets = [...new Set(
      (songModel.chords ?? []).map((c) => Number(c.start.toFixed(3))),
    )].sort((a, b) => a - b);
    // A ritardando is a time warp, and the warp carries a permanent offset into
    // everything after it: the parts stay together, but from there on the whole
    // song sits off the bar grid the plan and the kit were written on, and the
    // production export cannot carry a multi-segment tempo map to say the grid
    // moved (B-04's own note). So a planned ritardando is performed only when
    // it lands in the song's last bar - the ending, where nothing follows it.
    // A mid-song one stays in the plan and in the transition gesture's tempo
    // events, unperformed, and is named in B-13's honest limits.
    const lastBarStart = (Math.max(
      ...planForPerformance.sectionPlan.sections.map((s) => s.endBar), 1,
    ) - 1) * barSecondsForPerformance;
    const performanceAgogics = agogicsFor(
      planForPerformance.transitionPlan.transitions, barTimingForPerformance,
    ).filter((a) => a.end >= lastBarStart - 1e-6);
    const performed = trackModels.map((track) => {
      const ranges = sectionRangesFor(track.instrument);
      const assignment = planForPerformance.sectionPlan.roleAssignments.find(
        (r) => r.instrument === track.instrument,
      );
      const result = applyPerformance({
        trackId: track.id,
        instrument: track.instrument,
        family: track.instrumentDefinition.family,
        role: (assignment?.role ?? "HARMONIC_BED"),
        notes: track.notes,
        tempoBpm,
        meter,
        barSeconds: barSecondsForPerformance,
        groove: planForPerformance.globalPlan.grooveStrategy,
        style: planForPerformance.globalPlan.style,
        dynamicShape: assignment?.dynamicShape,
        sectionRanges: ranges,
        chordOnsets: performanceChordOnsets,
        agogics: performanceAgogics,
        phrases: planForPerformance.sectionPlan.phrases,
        seed: candidate.seed,
        // Only articulations this instrument can actually map are performed,
        // and a monophonic instrument stays monophonic after humanisation.
        articulationVocabulary: track.instrumentDefinition.articulations,
        maxSimultaneousNotes: track.instrumentDefinition.constraints.maxSimultaneousNotes,
        // PR-23: the project's performance style (from its StyleProfile) and
        // the track's articulation map, so keyswitches reach the renderer.
        performanceStyle: input.performanceStyle,
        articulationMap: track.mapping?.articulationMap,
        playableRange: track.instrumentDefinition.playableRange,
      });
      // PR-98: the performed part must satisfy the generation contract's
      // playability rules or the whole candidate is refused. A player takes an
      // impossible leap by the octave and releases a held note early; so does
      // this, and the trace records that it did.
      // B-11: the engine keeps reasons for its first PERFORMANCE_DECISION_SAMPLE_CAP
      // notes; the timing and velocity change of every composed note is
      // measured here (composed -> performed, before the playability repair),
      // so a 2,000-note part no longer has 64 explained notes and 1,936 silent ones.
      const composedById = new Map(track.notes.map((n) => [n.id, n]));
      const telemetry: TrackPerformanceTelemetry = {
        trackId: track.id,
        engine: result.evidence.engine,
        engineVersion: result.evidence.engineVersion ?? "1.0",
        profile: result.evidence.profile,
        sampleCap: PERFORMANCE_DECISION_SAMPLE_CAP,
        sample: result.evidence.decisions,
        noteIds: [], timingOffsetsMs: [], velocityDeltas: [],
        addedNotes: 0, removedNotes: 0,
      };
      let measured = 0;
      for (const note of result.notes) {
        const before = composedById.get(note.id);
        if (!before) { telemetry.addedNotes += 1; continue; }
        measured += 1;
        if (measured > PERFORMANCE_TELEMETRY_NOTE_CAP) { telemetry.truncatedAt = PERFORMANCE_TELEMETRY_NOTE_CAP; continue; }
        telemetry.noteIds.push(note.id);
        telemetry.timingOffsetsMs.push(Math.round((note.start - before.start) * 10_000) / 10);
        telemetry.velocityDeltas.push(note.velocity - before.velocity);
      }
      telemetry.removedNotes = Math.max(0, track.notes.length - measured);
      performanceTelemetry.push(telemetry);
      // B-13: the repair judges with the engine's rules (one playability truth)
      // and tags every note it rewrites with `perform:playability_repair:<trackId>`.
      const repaired = repairPlayability({
        notes: result.notes, definition: track.instrumentDefinition,
        trackId: track.id, instrument: track.instrument, role: track.role, tempoBpm,
      });
      if (repaired.report.rangeFolds || repaired.report.leapFolds || repaired.report.durationLengthened ||
        repaired.report.breathTruncated || repaired.report.polyphonyReleases || repaired.report.dropped) {
        playabilityRepairs.push({ trackId: track.id, ...repaired.report });
        allPlayabilityRepairs.push({ candidate: candidate.label, trackId: track.id, ...repaired.report });
      }
      const performedTrack: TrackModel = {
        ...track,
        notes: repaired.notes,
        cc: result.cc,
        articulations: result.articulations,
      };
      // Canonical performance evidence, in the exact shape the production
      // export verifies (exportEngine readiness): the timeline and phrase
      // digests of the Song Model, the post-performance playability result,
      // and a digest of the performed material itself. Without it a brain
      // arrangement can never be rendered through a licensed instrument --
      // the engine produced this evidence all along; it was being discarded.
      const capability = getInstrumentPerformanceCapability(track.instrumentDefinition);
      const playability = checkArrangementConstraints(
        [{
          id: track.id, instrument: track.instrument, role: track.role,
          instrumentDefinition: track.instrumentDefinition,
          notes: performedTrack.notes, articulations: performedTrack.articulations,
        }],
        { tempoBpm },
      ).byTrack[0];
      // B-00: a check that produced no report is a failed check, not a pass.
      if (!playability) {
        findings.push({
          kind: "playability_check_missing", severity: "error", instrument: track.instrument,
          message: `${track.instrument}: the post-performance playability check produced no report; the evidence cannot claim the part is playable.`,
        });
      }
      performedTrack.performanceEvidence = {
        version: "1.0",
        seed: candidate.seed,
        compositionSeed: candidate.seed,
        performanceSeed: candidate.seed,
        instrumentFamily: track.instrumentDefinition.family,
        articulationProfile: capability.articulationProfile,
        timingProfile: capability.timingProfile,
        dynamicsProfile: capability.dynamicsProfile,
        canonicalTimelineSha256: canonicalPerformanceTimelineSha256(songModel),
        phraseIds: canonicalPerformancePhraseIds(songModel),
        sectionRanges: (performedTrack.appliedDirectives ?? []).map((item) => ({
          section: item.section, startBar: item.startBar, endBar: item.endBar,
          start: item.start, end: item.end,
        })),
        playability: {
          valid: playability ? playability.feasible : false,
          checkedNotes: performedTrack.notes.length,
          violations: playability
            ? playability.violations.map((violation) =>
              typeof (violation as { message?: unknown }).message === "string"
                ? (violation as { message: string }).message
                : JSON.stringify(violation))
            : ["the post-performance playability check produced no report"],
        },
        // Computed last: it covers every field above that the renderer echoes.
        performedMaterialSha256: performedMaterialSha256(performedTrack),
      };
      return performedTrack;
    });

    // Constraints are judged on what will be rendered. The pre-performance
    // check above guards the composition; this one guards the performance,
    // which can lengthen and shift notes and must not break a rule the
    // composition satisfied.
    const performedConstraints = checkArrangementConstraints(
      performed.map((t) => ({
        id: t.id, instrument: t.instrument, role: t.role,
        instrumentDefinition: t.instrumentDefinition, notes: t.notes,
      })),
      { tempoBpm },
    );
    totalConstraintErrors += performedConstraints.errorCount;
    if (performedConstraints.errorCount > 0) {
      findings.push({
        kind: "performed_constraints", severity: "error",
        message: `${performedConstraints.errorCount} playability error(s) remain in the performed notes (${performedConstraints.byTrack.filter((t) => !t.feasible).map((t) => t.instrument).join(", ")}).`,
      });
    }

    // --- 6 again, on the shipped notes ---------------------------------
    // B-00: the score that ranks is the score of the notes that ship.
    const critique = critiqueArrangement({ songModel, plan: candidatePlanLayers, trackModels: performed });

    // --- 9/10. render + audio critique ---------------------------------
    let audioCritique: AudioCritique | null = null;
    let renderFeasible: boolean | null = null;
    if (input.render !== false && performed.length > 0) {
      const renderReport = renderArrangementStems(performed, input.renderOptions ?? { sampleRate: 48_000, bitDepth: 24 });
      renderFeasible = renderReport.feasible;
      const stems: AudioStem[] = performed.map((track) => {
        const rendered = renderStem(
          {
            id: track.id, instrument: track.instrument, role: track.role,
            instrumentDefinition: track.instrumentDefinition, notes: track.notes,
            articulations: track.articulations,
          },
          input.renderOptions ?? { sampleRate: 48_000, bitDepth: 24 },
        );
        return {
          trackId: track.id, instrument: track.instrument, role: track.role,
          family: track.instrumentDefinition.family, samples: rendered.samples,
          attestation: rendered.attestation,
        };
      });
      audioCritique = critiqueRenderedAudio({
        stems, sampleRate: input.renderOptions?.sampleRate ?? 48_000,
      });
      renderedAny = true;
    }

    const noteCount = performed.reduce((sum, t) => sum + t.notes.length, 0);
    totalNotes += noteCount;
    const droppedParts = findings.filter((f) => f.kind === "dropped_part" || f.kind === "planned_family_silent").length;
    totalDroppedParts += droppedParts;
    const errorFindings = findings.filter((f) => f.severity === "error");
    const hardRuleReasons = [
      ...critique.hardRuleFindings.filter((f) => f.severity === "error").map((f) => `critic: ${f.message}`),
      ...errorFindings.map((f) => `${f.kind}: ${f.message}`),
    ];
    const symbolic = critique.overallScore;
    const audio = audioCritique?.overallScore ?? null;
    composed.push({
      candidateId: candidate.candidateId,
      label: candidate.label,
      strategy: candidate.strategy,
      seed: candidate.seed,
      plan: candidatePlanLayers,
      trackModels: performed,
      noteCount,
      // Composition errors and performance errors both count; a candidate is
      // only clean if what reaches the renderer is clean.
      constraintErrors: constraintReport.errorCount + performedConstraints.errorCount,
      performedConstraintErrors: performedConstraints.errorCount,
      initialCritique,
      compositionCritique,
      critique,
      repair: repair.passes.length ? repair : null,
      repairApplied,
      findings,
      hardRule: { feasible: critique.feasible && errorFindings.length === 0, reasons: hardRuleReasons },
      playabilityRepairs,
      audioCritique,
      renderFeasible,
      finalScore: audio === null ? symbolic : Number((symbolic * 0.6 + audio * 0.4).toFixed(2)),
      parts,
      performance: performanceTelemetry,
      composerDecisions,
    });
  }

  record("compose", composed.length ? "ok" : "failed",
    `${totalNotes} notes across ${composed.length} candidate(s) via ${composerName}` +
      (totalDroppedParts ? `; ${totalDroppedParts} planned part(s) or families wrote no notes` : ""),
    { notes: totalNotes, composer: composerName, droppedParts: totalDroppedParts });
  record("constraints", totalConstraintErrors === 0 ? "ok" : "failed",
    `${totalConstraintErrors} playability error(s) in the performed notes`, { errors: totalConstraintErrors });
  record("critique", composed.length ? "ok" : "skipped",
    composed.length
      ? `mean shipped ${(composed.reduce((s, c) => s + c.critique.overallScore, 0) / composed.length).toFixed(1)} (composed ${(composed.reduce((s, c) => s + c.compositionCritique.overallScore, 0) / composed.length).toFixed(1)}); judged on the performed, repaired notes`
      : "no candidates",
    composed.length
      ? {
          meanShipped: Number((composed.reduce((s, c) => s + c.critique.overallScore, 0) / composed.length).toFixed(2)),
          meanComposed: Number((composed.reduce((s, c) => s + c.compositionCritique.overallScore, 0) / composed.length).toFixed(2)),
        }
      : undefined);
  const repairedCount = composed.filter((c) => c.repairApplied).length;
  const attempted = composed.filter((c) => c.repair && c.repair.passes.length > 0).length;
  // B-06: which layers the accepted passes reopened, and how many passes were tried and reverted.
  const layerCounts = new Map<string, number>();
  let rejectedPasses = 0;
  for (const c of composed) {
    for (const pass of c.repair?.passes ?? []) {
      if (pass.accepted) layerCounts.set(pass.layer ?? "plan", (layerCounts.get(pass.layer ?? "plan") ?? 0) + 1);
      else if (pass.accepted === false) rejectedPasses += 1;
    }
  }
  const layersReopened = [...layerCounts.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0])).map(([layer, n]) => `${layer} x${n}`).join(", ");
  record("repair", repairedCount ? "ok" : "skipped",
    repairedCount
      ? `${repairedCount} candidate(s) repaired (plan edited and recomposed${layersReopened ? `; layers reopened: ${layersReopened}` : ""}); ${attempted - repairedCount} attempted candidate(s) changed nothing` +
        (rejectedPasses ? `; ${rejectedPasses} pass(es) tried and reverted` : "")
      : attempted
        ? `${attempted} candidate(s) attempted a repair pass; none changed the plan or the notes, so nothing was repaired` +
          (rejectedPasses ? ` (${rejectedPasses} pass(es) tried and reverted: targets persisted, the verdict worsened or nothing changed)` : "")
        : "no candidate had an observation to repair",
    { repaired: repairedCount, attempted, rejectedPasses, ...(layersReopened ? { layersReopened } : {}) });
  record("perform", composed.length ? "ok" : "skipped",
    composed.length
      ? allPlayabilityRepairs.length
        ? `performance humanisation applied; ${allPlayabilityRepairs.length} part(s) repaired for playability (${allPlayabilityRepairs.reduce((s, r) => s + r.leapFolds, 0)} leap folds, ${allPlayabilityRepairs.reduce((s, r) => s + r.polyphonyReleases, 0)} releases, ${allPlayabilityRepairs.reduce((s, r) => s + r.dropped, 0)} dropped)`
        : "performance humanisation applied"
      : "no candidates to perform",
    allPlayabilityRepairs.length
      ? {
          repairedParts: allPlayabilityRepairs.length,
          leapFolds: allPlayabilityRepairs.reduce((s, r) => s + r.leapFolds, 0),
          rangeFolds: allPlayabilityRepairs.reduce((s, r) => s + r.rangeFolds, 0),
          polyphonyReleases: allPlayabilityRepairs.reduce((s, r) => s + r.polyphonyReleases, 0),
          dropped: allPlayabilityRepairs.reduce((s, r) => s + r.dropped, 0),
          residual: allPlayabilityRepairs.filter((r) => r.residual.length).length,
          parts: allPlayabilityRepairs.map((r) => `${r.candidate}:${r.trackId.split("--").pop()}`).join(","),
        }
      : undefined);
  record("render", renderedAny ? "ok" : "skipped",
    renderedAny ? "stems rendered with attestations" : "rendering disabled by the caller (render: false)");
  record("audio_critique", renderedAny ? "ok" : "skipped",
    renderedAny ? "audio critique complete" : "no rendered audio to critique");

  // --- 11. select --------------------------------------------------------
  const abComparison = renderedAny
    ? abCompareCandidates(composed
        .filter((c) => c.audioCritique)
        .map((c) => ({ candidateId: c.candidateId, label: c.label, critique: c.audioCritique! })))
    : null;

  // B-00: only candidates that pass the hard-rule gate compete. There is no
  // "best available" among the ones that failed it.
  const eligible = composed.filter((c) => c.hardRule.feasible);
  const rejected = composed
    .filter((c) => !c.hardRule.feasible)
    .map((c) => ({ candidateId: c.candidateId, reasons: c.hardRule.reasons }));
  const ranked = [...eligible].sort((a, b) =>
    b.finalScore - a.finalScore ||
    a.candidateId.localeCompare(b.candidateId));
  const winner = ranked[0] ?? null;
  const selectionReason = winner
    ? `highest combined score of ${eligible.length} candidate(s) that passed the hard-rule gate (${winner.strategy})` +
      (rejected.length ? `; ${rejected.length} rejected` : "")
    : composed.length
      ? `no candidate passed the hard-rule gate: ${rejected.map((r) => `${r.candidateId} [${r.reasons.join(" | ")}]`).join("; ")}`
      : "nothing to select";
  const selected = winner
    ? {
        candidateId: winner.candidateId,
        reason: selectionReason,
        symbolicScore: winner.critique.overallScore,
        audioScore: winner.audioCritique?.overallScore ?? null,
        combinedScore: winner.finalScore,
      }
    : null;
  record("select", winner ? "ok" : "failed",
    winner ? `${winner.candidateId} (${winner.strategy}); ${rejected.length} rejected by the hard-rule gate` : selectionReason,
    { eligible: eligible.length, rejected: rejected.length, ...(winner ? { candidateId: winner.candidateId, combinedScore: winner.finalScore } : {}) });

  return {
    version: ORCHESTRATOR_VERSION,
    method: METHOD,
    composer: composerName,
    stages,
    plan,
    candidates: composed,
    abComparison,
    selected,
    selection: { reason: selectionReason, eligible: eligible.map((c) => c.candidateId), rejected },
    timing: { tempoBpm, tempoAssumed, meter, meterAssumed },
    traceable: isTraceable(stages),
    contextPasses,
  };
}
