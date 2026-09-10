/**
 * Brain B-10 evidence generator and test harness (not a test; run through
 * `scripts/brain-b10-motif-evidence.mjs`, imported by `brainB10Motif.test.ts`).
 *
 * Three things live here because the tests and the evidence must measure with
 * the same code:
 *
 *   1. `motifLedgerForPlan` — the ledger the orchestrator should build once per
 *      candidate from the plan it already has (the lead's two-line wiring in
 *      `composeCandidate`: build it, then `compose({ ...request, motifLedger })`).
 *      `motifAwareComposeParts` is the injectable equivalent for a run.
 *   2. `legacyComposeParts` — the pre-B-10 counter-melody writer, byte-faithful,
 *      so "before" is the figure that shipped, not a reconstruction.
 *   3. The measurements: the adversarial `boredom` and `copiedRepeat` critics
 *      on the melodic tracks, interval-bigram entropy, the copy share between
 *      repeated sections, motion against the bass, vocal overlap and clearance.
 *
 * Nothing here renders or listens; every number is symbolic.
 */
import type {
  ArrangementPlan, ChordHarmonyEvent, GlobalArrangementPlan, MusicalNote, SongModelData, TrackModel,
} from "@workspace/db";
import { BENCHMARK_CORPUS, buildBenchmarkSongModel, type BenchmarkCase } from "./benchmarkCorpus";
import { buildPartGenerationRequest, planPartComposition, type PartGenerationRequest } from "./partComposer";
import { composeReferencePart, type ComposeContext } from "./referencePartComposer";
import { registerBounds, voiceNear } from "./composer/registers";
import { chordPitchClasses } from "./composer/harmonyParts";
import { buildMotifLedger, summariseMotifLedger, type MotifLedger, type TimedPitch } from "./motifLedger";
import { chordRootsAsBass, motionRateVsBass, overlapsVocal, vocalClearance, MELODIC_ENGINE_VERSION } from "./melodicEngine";
import { getInstrumentDefinition } from "./musicEngines";
import { critiqueBoredom } from "./critics/adversarial/boredom";
import { critiqueCopiedRepeat } from "./critics/adversarial/copiedRepeat";
import { ngrams, normalisedEntropy, topLine } from "./critics/adversarial/shared";
import type { CriticInput, CriticDimensionReport } from "./critics/types.b05b";
import { orchestrateArrangement, type OrchestrationResult } from "./arrangementOrchestrator";
import { rachemNaSongModel, RACHEM_NA_FIXED_NOW } from "./__fixtures__/rachemNaSongModelV3";
import { compileProductionBrief } from "./producerIntelligence/briefCompiler";
import { briefPlannerHints } from "./producerIntelligence/briefToPlanner";
import { extractUserIntentSync } from "./producerIntelligence/intentExtraction";
import { resolveStyleProfile } from "./producerIntelligence/styleResolution";

export const OWNER_BRIEF = "intimate ballad; piano, soft strings, gentle bass, light percussion; big final chorus";
const NOW = new Date(0);

// ---------------------------------------------------------------------------
// 1. The ledger from the plan (what the orchestrator wiring calls)
// ---------------------------------------------------------------------------

/** Sections in form order with functions and tension roles, from the plan's arc (B-01) or its targets. */
export function ledgerSectionsFromPlan(globalPlan: GlobalArrangementPlan, barSeconds: number, originSeconds = 0) {
  const seconds = (bar: number) => originSeconds + (bar - 1) * barSeconds;
  if (globalPlan.arc?.sections?.length) {
    return globalPlan.arc.sections.map((s) => ({
      sectionName: s.sectionName, startBar: s.startBar, endBar: s.endBar, function: s.function,
      tensionRole: s.tensionRole.value, startSeconds: seconds(s.startBar), endSeconds: seconds(s.endBar + 1),
    }));
  }
  return globalPlan.sectionTargets.map((t) => ({
    sectionName: t.sectionName, startBar: t.startBar, endBar: t.endBar, function: t.role, tensionRole: undefined,
    startSeconds: seconds(t.startBar), endSeconds: seconds(t.endBar + 1),
  }));
}

export function motifLedgerForPlan(songModel: SongModelData, globalPlan: GlobalArrangementPlan, context: ComposeContext): MotifLedger {
  const beats = Number((context.meter ?? "4/4").split("/")[0]) || 4;
  const beatSeconds = 60 / Math.max(1, context.tempoBpm);
  return buildMotifLedger({
    songModel, sections: ledgerSectionsFromPlan(globalPlan, beatSeconds * beats, context.originSeconds ?? 0), beatSeconds,
    barStart: (bar) => (context.originSeconds ?? 0) + (bar - 1) * beatSeconds * beats,
  });
}

/**
 * An injectable `composeParts` that threads one ledger per candidate. The
 * orchestrator composes each candidate's tasks in the same order, so a fresh
 * ledger starts when the first task id comes round again.
 */
export function motifAwareComposeParts(songModel: SongModelData, context: ComposeContext): {
  compose: (request: PartGenerationRequest) => MusicalNote[];
  ledgers: MotifLedger[];
} {
  const ledgers: MotifLedger[] = [];
  let firstTaskId: string | null = null;
  return {
    ledgers,
    compose(request) {
      if (firstTaskId === null) firstTaskId = request.taskId;
      if (request.taskId === firstTaskId || !ledgers.length) ledgers.push(motifLedgerForPlan(songModel, request.globalPlan, context));
      return composeReferencePart({ ...request, motifLedger: ledgers[ledgers.length - 1] }, context);
    },
  };
}

// ---------------------------------------------------------------------------
// 2. The pre-B-10 writer, byte-faithful (the "before")
// ---------------------------------------------------------------------------

/** The counter-melody the reference composer shipped before B-10: `[0, 1, 2, 1]` on chord tones where `vocalAttention < 0.3`, else the last bar. */
export function legacyCounterMelody(request: PartGenerationRequest, context: ComposeContext): MusicalNote[] {
  const beats = Number((context.meter ?? "4/4").split("/")[0]) || 4;
  const beatSeconds = 60 / Math.max(1, context.tempoBpm);
  const barSeconds = beatSeconds * beats;
  const origin = context.originSeconds ?? 0;
  const startSeconds = origin + (request.section.startBar - 1) * barSeconds;
  const endSeconds = origin + request.section.endBar * barSeconds;
  const { lo, hi } = registerBounds(request);
  const chords = (request.context.currentBars.chords ?? []).filter((c) => c.end > startSeconds && c.start < endSeconds).sort((a, b) => a.start - b.start);
  const notes: MusicalNote[] = [];
  const minDur = request.constraints.minNoteDuration;
  const push = (start: number, duration: number, pitch: number, velocity: number, suffix: string) => {
    if (start < startSeconds - 1e-6 || start >= endSeconds - 1e-6) return;
    notes.push({
      id: `${request.taskId}-${suffix}`, start: Number(start.toFixed(4)),
      duration: Number(Math.max(minDur, Math.min(duration, endSeconds - start)).toFixed(4)),
      pitch: Math.max(0, Math.min(127, Math.round(pitch))), velocity: Math.max(1, Math.min(127, Math.round(velocity))),
    });
  };
  const budget = request.budgetWindows[0];
  const baseVelocity = 52 + request.section.energy * 55;
  void budget;
  const gaps = request.budgetWindows.filter((w) => w.vocalAttention < 0.3);
  const windows = gaps.length ? gaps : [{ startBar: request.section.endBar, endBar: request.section.endBar }];
  for (const [index, window] of windows.entries()) {
    const gapStart = origin + (window.startBar - 1) * barSeconds;
    const gapEnd = origin + window.endBar * barSeconds;
    const chord = chords.find((c) => c.end > gapStart && c.start < gapEnd) ?? chords[0];
    if (!chord) continue;
    const tones = chordPitchClasses(chord);
    const figure = [0, 1, 2, 1];
    const span = Math.min(gapEnd, endSeconds) - gapStart;
    if (span <= 0) continue;
    const stepCount = Math.min(figure.length, Math.max(2, Math.round(span / (beatSeconds * 0.75))));
    for (let s = 0; s < stepCount; s += 1) {
      const pc = tones[figure[s % figure.length] % tones.length];
      push(gapStart + s * beatSeconds * 0.75, beatSeconds * 0.6, voiceNear(pc, hi - 8, lo, hi), baseVelocity - 4, `cm${index}-${s}`);
    }
  }
  return notes.sort((a, b) => a.start - b.start || a.pitch - b.pitch);
}

export function legacyComposeParts(context: ComposeContext): (request: PartGenerationRequest) => MusicalNote[] {
  return (request) => request.task === "COUNTER_MELODY" || request.task === "CALL_RESPONSE"
    ? legacyCounterMelody(request, context)
    : composeReferencePart(request, context);
}

// ---------------------------------------------------------------------------
// 3. Measurements
// ---------------------------------------------------------------------------

export function trackModelFor(id: string, instrument: string, role: string, notes: MusicalNote[]): TrackModel {
  return {
    id, instrument, instrumentDefinition: getInstrumentDefinition(instrument, ""), role,
    notes: [...notes].sort((a, b) => a.start - b.start || a.pitch - b.pitch), cc: [], articulations: [], automation: [],
    source: "b10-harness", version: 1,
    provenance: { model: "brain-b10-harness", version: "1.0.0", parameters: {}, parentIds: [], createdBy: "brain-b10" },
  } as TrackModel;
}

export function criticInputFor(songModel: SongModelData, globalPlan: GlobalArrangementPlan, trackModels: TrackModel[]): CriticInput {
  const plan = {
    id: "b10-harness-plan", version: 1, sections: [], style: {}, songModelVersion: 1, parameters: {},
    provenance: { model: "brain-b10-harness", version: "1.0.0", parameters: {}, parentIds: [], createdBy: "brain-b10" },
    hierarchy: {}, globalPlan,
  } as unknown as ArrangementPlan;
  return { songModel, plan, trackModels };
}

const timed = (notes: ReadonlyArray<MusicalNote>): TimedPitch[] => notes.map((n) => ({ start: n.start, end: n.start + n.duration, pitch: n.pitch }));

/** Normalised entropy of the top line's interval bigrams (the boredom critic's `pitch_predictable` statistic). */
export function intervalBigramEntropy(notes: readonly MusicalNote[]): { entropy: number | null; intervals: number; distinctBigrams: number } {
  const line = topLine(notes);
  const intervals: string[] = [];
  for (let i = 1; i < line.length; i += 1) intervals.push(String(line[i].pitch - line[i - 1].pitch));
  if (intervals.length < 2) return { entropy: null, intervals: intervals.length, distinctBigrams: 0 };
  const bigrams = ngrams(intervals, 2);
  return { entropy: Number(normalisedEntropy(bigrams).toFixed(3)), intervals: intervals.length, distinctBigrams: new Set(bigrams).size };
}

/** Share of the earlier section's notes that recur in the later one at the same relative onset (+-45 ms) and pitch - the copiedRepeat critic's note-copy statistic. */
export function noteCopyShare(
  notes: readonly MusicalNote[], earlier: { start: number; end: number }, later: { start: number; end: number },
): { share: number | null; earlierNotes: number; laterNotes: number } {
  const a = notes.filter((n) => n.start >= earlier.start - 1e-6 && n.start < earlier.end - 1e-6).map((n) => ({ on: n.start - earlier.start, pitch: n.pitch }));
  const b = notes.filter((n) => n.start >= later.start - 1e-6 && n.start < later.end - 1e-6).map((n) => ({ on: n.start - later.start, pitch: n.pitch }));
  if (!a.length || !b.length) return { share: null, earlierNotes: a.length, laterNotes: b.length };
  const used = new Array<boolean>(b.length).fill(false);
  let matched = 0;
  for (const x of a) {
    const k = b.findIndex((y, i) => !used[i] && Math.abs(y.on - x.on) <= 0.045 && y.pitch === x.pitch);
    if (k >= 0) { used[k] = true; matched += 1; }
  }
  return { share: Number((matched / Math.max(a.length, b.length)).toFixed(3)), earlierNotes: a.length, laterNotes: b.length };
}

export type TrackMeasure = {
  track: string; notes: number; motifNotes: number;
  transformations: Record<string, number>;
  entropy: ReturnType<typeof intervalBigramEntropy>;
  motionVsBass: ReturnType<typeof motionRateVsBass>;
  overlapsVocal: boolean;
  vocalClearance: number | null;
  copyShares: Array<{ earlier: string; later: string } & ReturnType<typeof noteCopyShare>>;
};

function summariseReport(report: CriticDimensionReport, trackIds: string[]) {
  const mine = report.observations.filter((o) => o.location.trackIds.some((t) => trackIds.includes(t)));
  return {
    applicable: report.applicable, reasonIfNot: report.reasonIfNot ?? null, controlStatus: report.summary.controlStatus,
    observations: report.observations.length, onMelodicTracks: mine.length,
    kinds: mine.map((o) => ({ kind: o.kind, severity: o.severity, tracks: o.location.trackIds, bars: [o.location.startBar, o.location.endBar], evidence: o.evidence })),
  };
}

export function measureTracks(
  songModel: SongModelData, globalPlan: GlobalArrangementPlan, tracks: TrackModel[], barSeconds: number,
): { tracks: TrackMeasure[]; boredom: ReturnType<typeof summariseReport>; copiedRepeat: ReturnType<typeof summariseReport> } {
  const vocal = (songModel.melody ?? []).filter((n) => n.confidence >= 0.6).map((n) => ({ start: n.start, end: n.end, pitch: n.pitch }));
  const bass = chordRootsAsBass(songModel.chords ?? []);
  const sections = globalPlan.sectionTargets.map((t) => ({ name: t.sectionName, start: (t.startBar - 1) * barSeconds, end: t.endBar * barSeconds }));
  const base = (name: string) => name.toLowerCase().replace(/\s*\d+$/, "").trim();
  const pairs: Array<[typeof sections[number], typeof sections[number]]> = [];
  for (let i = 0; i < sections.length; i += 1) for (let j = i + 1; j < sections.length; j += 1) if (base(sections[i].name) === base(sections[j].name)) pairs.push([sections[i], sections[j]]);
  const measures: TrackMeasure[] = tracks.map((t) => {
    const transformations: Record<string, number> = {};
    for (const n of t.notes) if (n.motif) transformations[n.motif.transformation] = (transformations[n.motif.transformation] ?? 0) + 1;
    const line = timed(t.notes);
    return {
      track: t.id, notes: t.notes.length, motifNotes: t.notes.filter((n) => n.motif).length, transformations,
      entropy: intervalBigramEntropy(t.notes), motionVsBass: motionRateVsBass(line, bass),
      overlapsVocal: overlapsVocal(line, vocal), vocalClearance: vocalClearance(line, vocal),
      copyShares: pairs.map(([a, b]) => ({ earlier: a.name, later: b.name, ...noteCopyShare(t.notes, a, b) })),
    };
  });
  const input = criticInputFor(songModel, globalPlan, tracks);
  const ids = tracks.map((t) => t.id);
  return {
    tracks: measures,
    boredom: summariseReport(critiqueBoredom(input), ids),
    copiedRepeat: summariseReport(critiqueCopiedRepeat(input), ids),
  };
}

// ---------------------------------------------------------------------------
// The synthetic engine-on harness
// ---------------------------------------------------------------------------

export type HarnessResult = {
  id: string;
  tempoBpm: number; meter: string;
  sungSections: string[];
  before: ReturnType<typeof measureTracks>;
  after: ReturnType<typeof measureTracks>;
  ledger: ReturnType<typeof summariseMotifLedger>;
  recalls: number;
  tracksBefore: TrackModel[];
  tracksAfter: TrackModel[];
  productionTaskKinds: Record<string, number>;
};

/**
 * The planners rarely assign COUNTER_MELODY / CALL_RESPONSE on the nine
 * synthetic cases (none does today). To measure the engine the harness adds,
 * per sung section, a strings COUNTER_MELODY and a brass CALL_RESPONSE task
 * with the real request builder, composes them before (legacy figure) and
 * after (engine, one ledger for the run), and measures both.
 */
export function counterlineHarness(spec: BenchmarkCase): HarnessResult {
  const model = buildBenchmarkSongModel(spec);
  return counterlineHarnessOn(spec.id, model, model.tempoMap[0].bpm, model.meterMap[0].meter);
}

export function counterlineHarnessOn(id: string, model: SongModelData, tempoBpm: number, meter: string, hints?: Parameters<typeof planPartComposition>[1] & { hints?: unknown }): HarnessResult {
  void hints;
  const { plan, layers } = planPartComposition(model, { now: NOW });
  const context: ComposeContext = { tempoBpm, meter };
  const beats = Number(meter.split("/")[0]) || 4;
  const barSeconds = (60 / tempoBpm) * beats;
  const productionTaskKinds: Record<string, number> = {};
  for (const t of plan.tasks) productionTaskKinds[t.task] = (productionTaskKinds[t.task] ?? 0) + 1;
  const sung = layers.sectionPlan.sections.filter((s) => ["verse", "prechorus", "chorus", "bridge"].includes(s.function));
  const ledger = motifLedgerForPlan(model, layers.globalPlan, context);
  const before: Record<string, MusicalNote[]> = { strings: [], brass: [] };
  const after: Record<string, MusicalNote[]> = { strings: [], brass: [] };
  const requestLayers = { globalPlan: layers.globalPlan, sectionPlan: layers.sectionPlan, budgetWindows: layers.budgetWindows, transitions: layers.transitions };
  for (const section of sung) {
    for (const [instrument, task, role] of [["strings", "COUNTER_MELODY", "COUNTER_MELODY"], ["brass", "CALL_RESPONSE", "CALL_RESPONSE"]] as const) {
      const taskId = `b10-${section.sectionName}-${instrument}-${task}`.replace(/\s+/g, "_");
      const target = {
        id: taskId, task, sectionName: section.sectionName, instrument, role,
        startBar: section.startBar, endBar: section.endBar, seed: 1000 + section.startBar, dependsOn: [] as string[],
      };
      const request = buildPartGenerationRequest(model, target, requestLayers, []);
      before[instrument].push(...legacyCounterMelody(request, context));
      after[instrument].push(...composeReferencePart({ ...request, motifLedger: ledger }, context));
    }
  }
  const tracksBefore = [trackModelFor("strings", "strings", "COUNTER_MELODY", before.strings), trackModelFor("brass", "brass", "CALL_RESPONSE", before.brass)];
  const tracksAfter = [trackModelFor("strings", "strings", "COUNTER_MELODY", after.strings), trackModelFor("brass", "brass", "CALL_RESPONSE", after.brass)];
  return {
    id, tempoBpm, meter, sungSections: sung.map((s) => s.sectionName),
    before: measureTracks(model, layers.globalPlan, tracksBefore, barSeconds),
    after: measureTracks(model, layers.globalPlan, tracksAfter, barSeconds),
    ledger: summariseMotifLedger(ledger.data),
    recalls: ledger.data.occurrences.filter((o) => o.recallOf !== null).length,
    tracksBefore, tracksAfter, productionTaskKinds,
  };
}

// ---------------------------------------------------------------------------
// The owner's song
// ---------------------------------------------------------------------------

export function ownerBriefHints(model: SongModelData) {
  const intent = extractUserIntentSync(OWNER_BRIEF, { now: RACHEM_NA_FIXED_NOW });
  const profile = resolveStyleProfile(intent, { now: RACHEM_NA_FIXED_NOW });
  return briefPlannerHints(compileProductionBrief(intent, profile, model, [], { now: RACHEM_NA_FIXED_NOW }));
}

export type OwnerRun = {
  result: OrchestrationResult;
  ledgers: MotifLedger[];
};

/** The owner's song through the orchestrator with the brief, before (legacy figure) and after (engine, ledger threaded). */
export function ownerProductionRuns(): { model: SongModelData; before: OrchestrationResult; after: OwnerRun; tempoBpm: number; meter: string } {
  const model = rachemNaSongModel();
  const hints = ownerBriefHints(model);
  const tempoBpm = model.tempoMap[0]?.bpm ?? 120;
  const meter = model.meterMap[0]?.meter ?? "4/4";
  const context: ComposeContext = { tempoBpm, meter };
  const common = { songModel: model, candidateCount: 1, render: false as const, now: RACHEM_NA_FIXED_NOW, plannerHints: { global: hints.global, section: hints.section } };
  const before = orchestrateArrangement({ ...common, composeParts: legacyComposeParts(context), composerName: "REFERENCE_PART_COMPOSER_pre_B10" });
  const aware = motifAwareComposeParts(model, context);
  const after = orchestrateArrangement({ ...common, composeParts: aware.compose, composerName: "REFERENCE_PART_COMPOSER_V1+B10" });
  return { model, before, after: { result: after, ledgers: aware.ledgers }, tempoBpm, meter };
}

export function notesIn(tracks: readonly TrackModel[], instrument: string, window: { start: number; end: number }): MusicalNote[] {
  return tracks.filter((t) => t.instrument === instrument).flatMap((t) => t.notes.filter((n) => n.start >= window.start - 1e-6 && n.start < window.end - 1e-6));
}

// ---------------------------------------------------------------------------
// The document
// ---------------------------------------------------------------------------

export function runB10Evidence() {
  const owner = ownerProductionRuns();
  const beats = Number(owner.meter.split("/")[0]) || 4;
  const barSeconds = (60 / owner.tempoBpm) * beats;
  const plan = owner.after.result.plan;
  const globalPlan = plan.globalPlan!;
  const sectionSeconds = (name: string) => {
    const t = globalPlan.sectionTargets.find((s) => s.sectionName === name)!;
    return { start: (t.startBar - 1) * barSeconds, end: t.endBar * barSeconds, startBar: t.startBar, endBar: t.endBar };
  };
  const melodicTasks = (plan.partComposerPlan?.tasks ?? []).filter((t) => t.task === "COUNTER_MELODY" || t.task === "CALL_RESPONSE");
  const ownerMelodic = melodicTasks.map((t) => {
    const w = sectionSeconds(t.sectionName);
    const before = notesIn(owner.before.candidates[0].trackModels, t.instrument, w);
    const after = notesIn(owner.after.result.candidates[0].trackModels, t.instrument, w);
    const tracksBefore = [trackModelFor(`${t.instrument}`, t.instrument, t.role, before)];
    const tracksAfter = [trackModelFor(`${t.instrument}`, t.instrument, t.role, after)];
    return {
      task: t.id, section: t.sectionName, bars: [w.startBar, w.endBar], instrument: t.instrument,
      before: measureTracks(owner.model, globalPlan, tracksBefore, barSeconds).tracks[0],
      after: measureTracks(owner.model, globalPlan, tracksAfter, barSeconds).tracks[0],
    };
  });
  const wholeBefore = measureTracks(owner.model, globalPlan, owner.before.candidates[0].trackModels, barSeconds);
  const wholeAfter = measureTracks(owner.model, globalPlan, owner.after.result.candidates[0].trackModels, barSeconds);
  const ownerLedger = owner.after.ledgers[0] ? summariseMotifLedger(owner.after.ledgers[0].data) : null;

  // The owner's song with answers asked for: a CALL_RESPONSE strings task in every sung section (what a planner may decide).
  const ownerHarness = counterlineHarnessOn("rachem-na-v3", owner.model, owner.tempoBpm, owner.meter);

  const synthetic = BENCHMARK_CORPUS.map((spec) => {
    const h = counterlineHarness(spec);
    const strip = (m: ReturnType<typeof measureTracks>) => ({
      tracks: m.tracks.map((t) => ({ track: t.track, notes: t.notes, motifNotes: t.motifNotes, transformations: t.transformations, entropy: t.entropy, motionRate: t.motionVsBass?.rate ?? null, overlapsVocal: t.overlapsVocal, vocalClearance: t.vocalClearance, copyShares: t.copyShares })),
      boredom: m.boredom, copiedRepeat: m.copiedRepeat,
    });
    return {
      id: h.id, tempoBpm: h.tempoBpm, meter: h.meter, sungSections: h.sungSections, productionTaskKinds: h.productionTaskKinds,
      productionPathChanged: Boolean(h.productionTaskKinds.COUNTER_MELODY || h.productionTaskKinds.CALL_RESPONSE),
      before: strip(h.before), after: strip(h.after),
      ledger: { status: h.ledger.status, source: h.ledger.source, motifs: h.ledger.motifs.length, hook: h.ledger.hook, occurrences: h.ledger.occurrences.length, recalls: h.recalls, withheld: h.ledger.withheld, notes: h.ledger.notes.slice(0, 6) },
    };
  });

  const direction = (() => {
    let entropyUp = 0, entropyDown = 0, entropySame = 0, copyDown = 0, copyUp = 0, copySame = 0, overlapsBefore = 0, overlapsAfter = 0;
    for (const c of synthetic) {
      for (let i = 0; i < c.before.tracks.length; i += 1) {
        const b = c.before.tracks[i].entropy.entropy;
        const a = c.after.tracks[i].entropy.entropy;
        if (a !== null && b !== null) { if (a > b + 1e-9) entropyUp += 1; else if (a < b - 1e-9) entropyDown += 1; else entropySame += 1; }
        for (let k = 0; k < c.before.tracks[i].copyShares.length; k += 1) {
          const bs = c.before.tracks[i].copyShares[k].share;
          const as = c.after.tracks[i].copyShares[k].share;
          if (bs === null || as === null) continue;
          if (as < bs - 1e-9) copyDown += 1; else if (as > bs + 1e-9) copyUp += 1; else copySame += 1;
        }
        if (c.before.tracks[i].overlapsVocal) overlapsBefore += 1;
        if (c.after.tracks[i].overlapsVocal) overlapsAfter += 1;
      }
    }
    return { entropyUp, entropyDown, entropySame, copyDown, copyUp, copySame, tracksOverlappingVocalBefore: overlapsBefore, tracksOverlappingVocalAfter: overlapsAfter };
  })();

  return {
    generatedAt: RACHEM_NA_FIXED_NOW.toISOString(),
    versions: { ledger: "MOTIF_LEDGER_V1", engine: MELODIC_ENGINE_VERSION },
    method: "Symbolic only. 'before' = the pre-B-10 counter-melody figure re-run byte-faithfully on the same requests; 'after' = the melodic engine with one ledger per run. Critics: adversarial boredom and copiedRepeat (B-05b), uncalibrated status as they report it; plus the same statistics computed directly on the melodic tracks (interval-bigram entropy, note-copy share between repeated sections, motion against the chord-root bass, vocal overlap and clearance).",
    owner: {
      brief: OWNER_BRIEF,
      ledger: ownerLedger,
      productionMelodicTasks: ownerMelodic,
      productionPath: {
        selected: { before: Boolean(owner.before.selected), after: Boolean(owner.after.result.selected) },
        noteCount: { before: owner.before.candidates[0].noteCount, after: owner.after.result.candidates[0].noteCount },
        boredom: { before: wholeBefore.boredom, after: wholeAfter.boredom },
        copiedRepeat: { before: wholeBefore.copiedRepeat, after: wholeAfter.copiedRepeat },
      },
      answersHarness: {
        note: "the owner's song has no melody evidence (vocal map not_available): answers are placed at phrase ends inferred from the section plan and the motifs are the chord-root cells; both labelled as inference in the ledger",
        sungSections: ownerHarness.sungSections,
        before: { tracks: ownerHarness.before.tracks.map((t) => ({ track: t.track, notes: t.notes, entropy: t.entropy, motionRate: t.motionVsBass?.rate ?? null, copyShares: t.copyShares })), boredom: ownerHarness.before.boredom, copiedRepeat: ownerHarness.before.copiedRepeat },
        after: { tracks: ownerHarness.after.tracks.map((t) => ({ track: t.track, notes: t.notes, motifNotes: t.motifNotes, transformations: t.transformations, entropy: t.entropy, motionRate: t.motionVsBass?.rate ?? null, copyShares: t.copyShares })), boredom: ownerHarness.after.boredom, copiedRepeat: ownerHarness.after.copiedRepeat },
        ledger: ownerHarness.ledger,
        recalls: ownerHarness.recalls,
      },
    },
    synthetic,
    direction,
  };
}

export type { ChordHarmonyEvent };
