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
 */
import type {
  ArrangementCritique,
  ArrangementPlan,
  AudioCritique,
  CandidateStrategyId,
  CriticRepairLoopResult,
  MusicalNote,
  SongModelData,
  TrackModel,
  PerformanceStyle,
} from "@workspace/db";
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
import { checkArrangementConstraints } from "./musicalConstraints";
import { critiqueArrangement } from "./musicCritic";
import { runCriticRepairLoop } from "./criticRepairLoop";
import { applyPerformance } from "./performanceEngine";
import { renderArrangementStems, renderStem, type StemRenderOptions } from "./referenceRenderWorker";
import { abCompareCandidates, critiqueRenderedAudio, type AudioAbResult, type AudioStem } from "./audioCritic";
import { composeReferencePart, REFERENCE_PART_COMPOSER } from "./referencePartComposer";
import { upgradePartGenerationRequest, type HarmonyPlanSlot, type StyleGrammarSlot } from "./partGenerationContextV2";
import { composeWithContext, type ComposePass } from "./contextAwareComposer";
import { harmonyPlanSlot, solveVoiceLeading } from "./voiceLeading";
import { deriveStyleGrammar, styleGrammarSlot } from "./styleGrammar";
import { deriveStyleFingerprint } from "./styleFingerprint";

export const ORCHESTRATOR_VERSION = "1.0" as const;
const METHOD = "arrangement-orchestrator/v1";

export type OrchestratorStage =
  | "plan" | "parts" | "candidates" | "compose" | "constraints"
  | "critique" | "repair" | "perform" | "render" | "audio_critique" | "select"
  | "context";

export type StageRecord = {
  stage: OrchestratorStage;
  status: "ok" | "skipped" | "failed";
  detail: string;
  evidence?: Record<string, number | string | boolean>;
};

export type OrchestratedCandidate = {
  candidateId: string;
  label: string;
  strategy: CandidateStrategyId;
  seed: number;
  trackModels: TrackModel[];
  noteCount: number;
  constraintErrors: number;
  critique: ArrangementCritique;
  repair: CriticRepairLoopResult | null;
  audioCritique: AudioCritique | null;
  renderFeasible: boolean | null;
  finalScore: number;
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
  traceable: boolean;
};

export type PartComposerFn = (request: PartGenerationRequest) => MusicalNote[];

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
};

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
function harmonyPlanFor(songModel: SongModelData): HarmonyPlanSlot {
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
function styleGrammarFor(
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
 * Deterministically thin/boost a part to match a strategy's density multiplier.
 * Thinning is proportional (an evenly-spaced stride keeps the musical shape)
 * rather than "every Nth note", so a 0.95 multiplier really does write 5% less.
 */
function applyDensity(notes: MusicalNote[], multiplier: number): MusicalNote[] {
  if (notes.length === 0) return notes;
  const velocityScale = multiplier > 1
    ? Math.min(1.18, multiplier)
    : 0.78 + multiplier * 0.22;
  const scale = (list: MusicalNote[]) =>
    list.map((n) => ({
      ...n,
      velocity: Math.max(1, Math.min(127, Math.round(n.velocity * velocityScale))),
    }));
  const target = Math.max(1, Math.round(notes.length * Math.min(1, multiplier)));
  if (target >= notes.length) return scale(notes);
  const stride = notes.length / target;
  const kept: MusicalNote[] = [];
  for (let i = 0; i < target; i += 1) kept.push(notes[Math.floor(i * stride)]);
  return scale(kept);
}

/** Drop duplicate onsets of the same pitch, keeping the loudest. */
function dedupeSimultaneous(notes: MusicalNote[]): MusicalNote[] {
  const best = new Map<string, MusicalNote>();
  for (const note of notes.slice().sort((a, b) => a.start - b.start || a.pitch - b.pitch)) {
    const key = `${Math.round(note.start * 200)}:${note.pitch}`;
    const held = best.get(key);
    if (!held || note.velocity > held.velocity) best.set(key, note);
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

// ---------------------------------------------------------------------------

export function orchestrateArrangement(input: OrchestrateInput): OrchestrationResult {
  const now = input.now ?? new Date(0);
  const stages: StageRecord[] = [];
  const record = (
    stage: OrchestratorStage, status: StageRecord["status"], detail: string,
    evidence?: StageRecord["evidence"],
  ) => stages.push({ stage, status, detail, evidence });

  const songModel = input.songModel;
  const tempoBpm = songModel.tempoMap?.[0]?.bpm ?? 120;
  const meter = songModel.meterMap?.[0]?.meter ?? "4/4";
  const compose = input.composeParts ??
    ((request: PartGenerationRequest) => composeReferencePart(request, { tempoBpm, meter }));
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
  record("plan", "ok", `${globalPlan.sectionTargets.length} sections planned`, {
    style: globalPlan.style,
    climaxBar: globalPlan.climax?.atBar ?? 0,
    confidence: globalPlan.confidence,
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

  const layers = {
    globalPlan, sectionPlan,
    budgetWindows: orchestrationBudget.windows,
    transitions: transitionPlan.transitions,
  };

  // Solved once for the arrangement, not once per part: two parts voicing the
  // same chord differently are not voicing the same chord.
  const beatSeconds = 60 / Math.max(1, tempoBpm);
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

  const composed: OrchestratedCandidate[] = [];
  let totalNotes = 0;
  let totalConstraintErrors = 0;
  let renderedAny = false;

  for (const candidate of candidatePlan.candidates) {
    // --- 4. compose ---------------------------------------------------
    // One physical instrument is one performer: parts for the same instrument
    // merge into a single track even when their section roles differ, so the
    // constraint engine sees the real simultaneous load (limbs, hands, strings).
    const byTrack = new Map<string, { instrument: string; role: string; notes: MusicalNote[] }>();
    const existing: Array<{ instrument: string; role: string; noteCount: number }> = [];
    // The same parts again, with their notes. V1 carries only counts, and a
    // count is not something a later part can arrange against.
    const siblings: Array<{ instrument: string; role: string; notes: MusicalNote[] }> = [];
    for (const task of partPlan.tasks) {
      const adjustment = candidate.partAdjustments.find((a) => a.taskId === task.id);
      const request = buildPartGenerationRequest(
        songModel, { ...task, seed: adjustment?.seed ?? task.seed }, layers, existing,
      );
      const raw = compose(request);
      let notes = applyDensity(raw, adjustment?.densityMultiplier ?? 1);
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
      if (notes.length === 0) continue;
      const key = task.instrument;
      const entry = byTrack.get(key) ?? { instrument: task.instrument, role: task.role, notes: [] };
      entry.notes.push(...notes);
      byTrack.set(key, entry);
      existing.push({ instrument: task.instrument, role: task.role, noteCount: notes.length });
      siblings.push({ instrument: task.instrument, role: task.role, notes });
    }
    // Merged parts can now double the same pitch at the same instant; keep the
    // loudest and drop the duplicate rather than asking for a third hand.
    for (const entry of byTrack.values()) {
      entry.notes = dedupeSimultaneous(entry.notes);
    }
    const trackModels = [...byTrack.values()]
      .map((entry, index) => trackModelFor(entry.instrument, entry.role, entry.notes.sort((a, b) => a.start - b.start), index + 1))
      .filter((track) => track.notes.length > 0);
    const noteCount = trackModels.reduce((sum, t) => sum + t.notes.length, 0);
    totalNotes += noteCount;

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
    const repair = runCriticRepairLoop({ songModel, plan, trackModels });
    const critique = repair.finalCritique;

    // --- 8. perform ----------------------------------------------------
    const performed = trackModels.map((track) => {
      const assignment = sectionPlan.roleAssignments.find(
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
        groove: globalPlan.grooveStrategy,
        style: globalPlan.style,
        dynamicShape: assignment?.dynamicShape,
        phrases: sectionPlan.phrases,
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
      const performedTrack: TrackModel = {
        ...track,
        notes: result.notes,
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
          valid: playability ? playability.feasible : true,
          checkedNotes: performedTrack.notes.length,
          violations: (playability?.violations ?? []).map((violation) =>
            typeof (violation as { message?: unknown }).message === "string"
              ? (violation as { message: string }).message
              : JSON.stringify(violation)),
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

    const symbolic = critique.overallScore;
    const audio = audioCritique?.overallScore ?? null;
    composed.push({
      candidateId: candidate.candidateId,
      label: candidate.label,
      strategy: candidate.strategy,
      seed: candidate.seed,
      trackModels: performed,
      noteCount,
      // Composition errors and performance errors both count; a candidate is
      // only clean if what reaches the renderer is clean.
      constraintErrors: constraintReport.errorCount + performedConstraints.errorCount,
      critique,
      repair: repair.passes.length ? repair : null,
      audioCritique,
      renderFeasible,
      finalScore: audio === null ? symbolic : Number((symbolic * 0.6 + audio * 0.4).toFixed(2)),
    });
    void initialCritique;
  }

  record("compose", composed.length ? "ok" : "failed",
    `${totalNotes} notes across ${composed.length} candidate(s) via ${composerName}`,
    { notes: totalNotes, composer: composerName });
  record("constraints", totalConstraintErrors === 0 ? "ok" : "failed",
    `${totalConstraintErrors} playability error(s)`, { errors: totalConstraintErrors });
  record("critique", composed.length ? "ok" : "skipped",
    composed.length ? `mean symbolic ${(composed.reduce((s, c) => s + c.critique.overallScore, 0) / composed.length).toFixed(1)}` : "no candidates");
  const repaired = composed.filter((c) => c.repair && c.repair.passes.length > 0).length;
  record("repair", repaired ? "ok" : "skipped", `${repaired} candidate(s) repaired`);
  record("perform", composed.length ? "ok" : "skipped", "performance humanisation applied");
  record("render", renderedAny ? "ok" : "skipped",
    renderedAny ? "stems rendered with attestations" : "rendering disabled");
  record("audio_critique", renderedAny ? "ok" : "skipped",
    renderedAny ? "audio critique complete" : "no rendered audio");

  // --- 11. select --------------------------------------------------------
  const abComparison = renderedAny
    ? abCompareCandidates(composed
        .filter((c) => c.audioCritique)
        .map((c) => ({ candidateId: c.candidateId, label: c.label, critique: c.audioCritique! })))
    : null;

  const ranked = [...composed].sort((a, b) =>
    Number(b.critique.feasible) - Number(a.critique.feasible) ||
    b.finalScore - a.finalScore ||
    a.candidateId.localeCompare(b.candidateId));
  const winner = ranked[0] ?? null;
  const selected = winner
    ? {
        candidateId: winner.candidateId,
        reason: winner.critique.feasible
          ? `highest combined score (${winner.strategy})`
          : "no candidate passed the hard-rule gate; best available",
        symbolicScore: winner.critique.overallScore,
        audioScore: winner.audioCritique?.overallScore ?? null,
        combinedScore: winner.finalScore,
      }
    : null;
  record("select", winner ? "ok" : "failed",
    winner ? `${winner.candidateId} (${winner.strategy})` : "nothing to select",
    winner ? { candidateId: winner.candidateId, combinedScore: winner.finalScore } : undefined);

  return {
    version: ORCHESTRATOR_VERSION,
    method: METHOD,
    composer: composerName,
    stages,
    plan,
    candidates: composed,
    abComparison,
    selected,
    traceable: stages.length === 11,
  };
}
