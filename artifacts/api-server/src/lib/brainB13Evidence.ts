/**
 * Evidence builder for `docs/evidence/brain-b13-playability-and-wiring.json`
 * (Brain B-13, D4): the same measurements taken before and after the stream,
 * from one metric implementation, so every before / after in the tracker is a
 * comparison of two runs of this module and never two readings.
 *
 * Measured:
 *   - validator agreement on the B-12 seeds (24 seeds x 3 candidates, plus the
 *     keys -> guitar instrument swap): per shipped track the verdict of the
 *     provider contract, the constraint engine (errors) and the repair's own
 *     rule set; a disagreement is a track on which the three do not agree;
 *   - the audit's Probe 4 controls (a 30-semitone bass leap, a legato bass
 *     with 10 ms overlaps, piano C2 + E4 struck apart) under the three;
 *   - playability repair counts of the shipped candidate per corpus case and
 *     on the owner's song (B-02's own builder, so the 118 / 320 / 199 the
 *     tracker quotes are the same measurement);
 *   - kick / bass onset agreement: composed parts (B-04's `interlocking`) and
 *     the shipped tracks of the orchestrator, split by the groove plan's
 *     kick/bass relation (lock / complement / pedal);
 *   - the adversarial critic's causality penalty per case (B-04's measure);
 *   - the production diversity gate's mean pairwise candidate distance over
 *     five candidates per case, with its note-level components.
 *
 * Run through `scripts/brain-b13-playability-evidence.mjs`; `B13_MODE=measure`
 * prints the raw measures, `--before <capture.json>` folds a capture taken on
 * the base tree into the document.
 */
import type { MusicalNote, SongModelData, TrackModel } from "@workspace/db";
import { BENCHMARK_CORPUS, buildBenchmarkSongModel } from "./benchmarkCorpus";
import { orchestrateArrangement, type OrchestrationResult } from "./arrangementOrchestrator";
import { checkArrangementConstraints } from "./musicalConstraints";
import { validateCanonicalTrackModels } from "./musicProviders";
import { checkPlayabilityRules } from "./playabilityRepair";
import { getInstrumentDefinition } from "./musicEngines";
import { generateSongModel, swapInstrument } from "./invariants/generators";
import { seedsUpTo } from "./invariants/evidence";
import { buildB02Evidence } from "./brainB02Evidence";
import { B04_EVIDENCE_NOW, corpusSongs, interlocking, orchestratedMeasure } from "./brainB04Evidence";
import { deriveGroovePlan } from "./groovePlan";
import { candidateDistance, fingerprintCandidate } from "./candidateDiversity";
import { compileProductionBrief } from "./producerIntelligence/briefCompiler";
import { briefPlannerHints } from "./producerIntelligence/briefToPlanner";
import { extractUserIntentSync } from "./producerIntelligence/intentExtraction";
import { resolveStyleProfile } from "./producerIntelligence/styleResolution";
import { RACHEM_NA_FIXED_NOW, rachemNaSongModel } from "./__fixtures__/rachemNaSongModelV3";
import { composeReferencePart } from "./referencePartComposer";
import { maxSimultaneousVoices, polyphonyClusters } from "./musicalConstraints";
import { chordEventsIn } from "./harmonyPlan/shared";
import { barTiming } from "./composer/frame";

const r3 = (v: number) => Number(v.toFixed(3));
const mean = (xs: ReadonlyArray<number>): number | null => (xs.length ? r3(xs.reduce((a, b) => a + b, 0) / xs.length) : null);
const OWNER_BRIEF = "intimate ballad; piano, soft strings, gentle bass, light percussion; big final chorus";
const SEEDS = seedsUpTo(24, 1000);
const TOLERANCE = 0.03;

// ---------------------------------------------------------------------------
// The three validators on one track
// ---------------------------------------------------------------------------

export type TrackVerdict = {
  trackId: string;
  contract: string[];
  engine: string[];
  repairRules: string[];
  agree: boolean;
};

/** The three verdicts on every track of a shipped candidate. */
export function threeVerdicts(trackModels: TrackModel[], tempoBpm: number): TrackVerdict[] {
  const contract = validateCanonicalTrackModels(trackModels, trackModels.map((t) => t.id));
  const engine = checkArrangementConstraints(
    trackModels.map((t) => ({ id: t.id, instrument: t.instrument, role: t.role, instrumentDefinition: t.instrumentDefinition, notes: t.notes, articulations: t.articulations })),
    { tempoBpm },
  );
  return trackModels.map((track) => {
    const contractFor = contract.filter((e) => e.startsWith(`${track.id} `));
    const engineFor = engine.byTrack.find((t) => t.trackId === track.id)?.violations.filter((v) => v.severity === "error").map((v) => v.code) ?? [];
    const repairRules = checkPlayabilityRules(track.notes, track.instrumentDefinition);
    const verdicts = [contractFor.length > 0, engineFor.length > 0, repairRules.length > 0];
    return { trackId: track.id, contract: contractFor, engine: engineFor, repairRules, agree: new Set(verdicts).size === 1 };
  });
}

function controlTrack(instrument: string, role: string, notes: MusicalNote[]): TrackModel {
  return {
    id: `${instrument}-${role}`.toLowerCase(), instrument, role, instrumentDefinition: getInstrumentDefinition(instrument, role), notes,
    cc: [], articulations: [], automation: [], source: "control", version: 1,
    provenance: { model: "control", version: "1", parameters: {}, parentIds: [], createdBy: "b13" },
  };
}

/** The audit's Probe 4 controls and B-12's documented controls, under the three validators. */
export function documentedControls(): Array<{ id: string; description: string; verdict: TrackVerdict }> {
  const legato: MusicalNote[] = [];
  for (let i = 0; i < 8; i += 1) legato.push({ id: `n${i}`, start: i * 0.5, duration: 0.51, pitch: 40 + (i % 4), velocity: 90 });
  const cases = [
    { id: "bass_30_semitone_leap", description: "a 30-semitone bass leap (must fail under all three)", track: controlTrack("bass", "BASS", [
      { id: "a", start: 0, duration: 0.4, pitch: 36, velocity: 90 }, { id: "b", start: 0.5, duration: 0.4, pitch: 66, velocity: 90 },
    ]) },
    { id: "bass_legato_10ms", description: "a legato bass line whose notes overlap the next by 10 ms (must pass under all three)", track: controlTrack("bass", "BASS", legato) },
    { id: "piano_c2_e4_apart", description: "piano C2 and E4 struck apart, twice (a two-hand figure; must pass under all three)", track: controlTrack("piano", "HARMONIC_BED", [
      { id: "a", start: 0, duration: 0.4, pitch: 36, velocity: 90 }, { id: "b", start: 0.5, duration: 0.4, pitch: 64, velocity: 90 },
      { id: "c", start: 1.0, duration: 0.4, pitch: 36, velocity: 90 }, { id: "d", start: 1.5, duration: 0.4, pitch: 64, velocity: 90 },
    ]) },
    { id: "piano_c2_e4_chord", description: "piano C2 + E4 struck together (a legal two-hand chord; must pass under all three)", track: controlTrack("piano", "HARMONIC_BED", [
      { id: "a", start: 0, duration: 1, pitch: 36, velocity: 90 }, { id: "b", start: 0, duration: 1, pitch: 64, velocity: 90 },
      { id: "c", start: 1, duration: 1, pitch: 38, velocity: 90 }, { id: "d", start: 1, duration: 1, pitch: 65, velocity: 90 },
    ]) },
    { id: "strings_bed_top_to_bottom", description: "a four-voice string bed whose chord A top lies 14 semitones above chord B's bottom (voice-led; must pass under all three)", track: controlTrack("strings", "PAD", [
      ...[60, 64, 67, 72].map((p, i) => ({ id: `a${i}`, start: 0, duration: 1.98, pitch: p, velocity: 70 })),
      ...[58, 62, 65, 70].map((p, i) => ({ id: `b${i}`, start: 2, duration: 1.98, pitch: p, velocity: 70 })),
    ]) },
    { id: "plain_piano", description: "a plain playable piano line (must pass under all three)", track: controlTrack("piano", "HARMONIC_BED", Array.from({ length: 8 }, (_, i) => ({ id: `n${i}`, start: i * 0.5, duration: 0.4, pitch: 60 + (i % 3) * 2, velocity: 90 }))) },
  ];
  return cases.map((c) => ({ id: c.id, description: c.description, verdict: threeVerdicts([c.track], 120)[0] }));
}

export function validatorAgreementOnSeeds(): {
  seeds: number; candidates: number; tracks: number; agreeingTracks: number;
  disagreements: Array<{ seed: number; candidate: string; trackId: string; contract: string[]; engine: string[]; repairRules: string[] }>;
  contractErrors: number; engineErrorCodes: Record<string, number>; repairRuleCodes: Record<string, number>;
  swap: { swaps: number; tracks: number; disagreements: string[]; engineErrorCodes: Record<string, number> };
} {
  const disagreements: ReturnType<typeof validatorAgreementOnSeeds>["disagreements"] = [];
  const engineErrorCodes: Record<string, number> = {};
  const repairRuleCodes: Record<string, number> = {};
  let candidates = 0;
  let tracks = 0;
  let agreeingTracks = 0;
  let contractErrors = 0;
  for (const seed of SEEDS) {
    const { model } = generateSongModel(seed);
    const result = orchestrateArrangement({ songModel: model, candidateCount: 3, render: false, now: new Date(0) });
    for (const candidate of result.candidates) {
      candidates += 1;
      for (const verdict of threeVerdicts(candidate.trackModels, model.tempoMap[0].bpm)) {
        tracks += 1;
        if (verdict.agree) agreeingTracks += 1;
        else disagreements.push({ seed, candidate: candidate.candidateId, ...verdict });
        contractErrors += verdict.contract.length;
        for (const code of verdict.engine) engineErrorCodes[code] = (engineErrorCodes[code] ?? 0) + 1;
        for (const code of verdict.repairRules) repairRuleCodes[code] = (repairRuleCodes[code] ?? 0) + 1;
      }
    }
  }
  // The swap B-12 recorded as a disagreement: keys -> guitar on the swap generator's stem set.
  const swapDisagreements: string[] = [];
  const swapCodes: Record<string, number> = {};
  let swaps = 0;
  let swapTracks = 0;
  for (const seed of SEEDS) {
    const { model } = generateSongModel(seed, { stems: ["vocals", "drums", "bass", "keys", "guitar", "strings", "pads", "brass"].filter((_, i) => i < 3 || (seed + i) % 2 === 0) });
    if (!model.stems.some((s) => s.role === "keys")) continue;
    const swapped = swapInstrument(model, "keys", "guitar");
    const result = orchestrateArrangement({ songModel: swapped, candidateCount: 2, render: false, now: new Date(0) });
    swaps += 1;
    for (const candidate of result.candidates) {
      for (const verdict of threeVerdicts(candidate.trackModels.filter((t) => t.instrument === "guitar"), swapped.tempoMap[0].bpm)) {
        swapTracks += 1;
        for (const code of verdict.engine) swapCodes[code] = (swapCodes[code] ?? 0) + 1;
        if (!verdict.agree) swapDisagreements.push(`seed ${seed} keys->guitar ${candidate.candidateId} ${verdict.trackId}: contract [${verdict.contract.join("; ")}] engine [${verdict.engine.join(",")}] repair [${verdict.repairRules.join(",")}]`);
      }
    }
  }
  return {
    seeds: SEEDS.length, candidates, tracks, agreeingTracks, disagreements, contractErrors, engineErrorCodes, repairRuleCodes,
    swap: { swaps, tracks: swapTracks, disagreements: swapDisagreements, engineErrorCodes: swapCodes },
  };
}

// ---------------------------------------------------------------------------
// Kick / bass agreement on the shipped tracks
// ---------------------------------------------------------------------------

function onsetsOf(notes: readonly MusicalNote[], filter?: (n: MusicalNote) => boolean): number[] {
  const set = new Set<number>();
  for (const n of notes) if (!filter || filter(n)) set.add(Math.round(n.start * 1000));
  return [...set].sort((a, b) => a - b).map((ms) => ms / 1000);
}

function matched(a: number[], b: number[]): number {
  let count = 0;
  for (const t of a) if (b.some((u) => Math.abs(u - t) <= TOLERANCE)) count += 1;
  return count;
}

export type ShippedInterlockRow = { song: string; section: string; relation: string; kicks: number; bassOnsets: number; kickToBass: number | null; bassToKick: number | null };

function ownerHints() {
  const model = rachemNaSongModel();
  const intent = extractUserIntentSync(OWNER_BRIEF, { now: RACHEM_NA_FIXED_NOW });
  const profile = resolveStyleProfile(intent, { now: RACHEM_NA_FIXED_NOW });
  const brief = compileProductionBrief(intent, profile, model, [], { now: RACHEM_NA_FIXED_NOW });
  return briefPlannerHints(brief);
}

function barSecondsOf(model: SongModelData): number {
  const bpm = model.tempoMap?.[0]?.bpm ?? 120;
  const meter = model.meterMap?.[0]?.meter ?? "4/4";
  const m = /^(\d+)\/(\d+)$/.exec(meter);
  const numerator = m ? Number(m[1]) : 4;
  const denominator = m ? Number(m[2]) : 4;
  return (60 / bpm) * (4 / denominator) * numerator;
}

export function shippedInterlocking(id: string, model: SongModelData, result: OrchestrationResult): ShippedInterlockRow[] {
  const candidate = result.selected ? result.candidates.find((c) => c.candidateId === result.selected!.candidateId) ?? result.candidates[0] : result.candidates[0];
  const layers = result.plan;
  if (!layers.globalPlan || !layers.sectionPlan || !layers.transitionPlan) return [];
  const groove = deriveGroovePlan(model, { globalPlan: layers.globalPlan, sectionPlan: layers.sectionPlan, transitions: layers.transitionPlan.transitions }, { tempoBpm: result.timing.tempoBpm, meter: result.timing.meter, now: B04_EVIDENCE_NOW });
  const barSeconds = barSecondsOf(model);
  const drums = candidate.trackModels.filter((t) => t.instrumentDefinition.family === "drums" && !/percussion/i.test(t.instrument)).flatMap((t) => t.notes);
  const bass = candidate.trackModels.filter((t) => /bass/i.test(t.instrument)).flatMap((t) => t.notes);
  const rows: ShippedInterlockRow[] = [];
  for (const section of layers.sectionPlan.sections) {
    const start = (section.startBar - 1) * barSeconds;
    const end = section.endBar * barSeconds;
    const within = (n: MusicalNote) => n.start >= start - 1e-3 && n.start < end - 1e-3;
    const kicks = onsetsOf(drums.filter(within), (n) => n.pitch === 36 || n.pitch === 35);
    const bassOn = onsetsOf(bass.filter(within));
    if (!kicks.length && !bassOn.length) continue;
    const relation = groove.sections.find((s) => s.sectionName === section.sectionName)?.kickBass.value ?? "unknown";
    rows.push({
      song: id, section: section.sectionName, relation, kicks: kicks.length, bassOnsets: bassOn.length,
      kickToBass: kicks.length && bassOn.length ? r3(matched(kicks, bassOn) / kicks.length) : null,
      bassToKick: kicks.length && bassOn.length ? r3(matched(bassOn, kicks) / bassOn.length) : null,
    });
  }
  return rows;
}

// ---------------------------------------------------------------------------
// Candidate distance (the production gate's own measure) with components
// ---------------------------------------------------------------------------

const jaccardDistance = (left: string[], right: string[]) => {
  const a = new Set(left);
  const b = new Set(right);
  const union = new Set([...a, ...b]);
  if (!union.size) return 0;
  let intersection = 0;
  for (const value of a) if (b.has(value)) intersection += 1;
  return 1 - intersection / union.size;
};

export function candidateDistances(result: OrchestrationResult): { mean: number | null; harmony: number | null; roleInstrument: number | null; noteShape: number | null; pairs: number; noteCounts: number[] } {
  const prints = result.candidates.map((c) => fingerprintCandidate(result.plan, c.trackModels));
  const total: number[] = [];
  const harmony: number[] = [];
  const roleInstrument: number[] = [];
  const noteShape: number[] = [];
  for (let i = 0; i < prints.length; i += 1) {
    for (let j = i + 1; j < prints.length; j += 1) {
      total.push(candidateDistance(prints[i], prints[j]));
      harmony.push(jaccardDistance(prints[i].harmonySequence, prints[j].harmonySequence));
      roleInstrument.push(jaccardDistance(prints[i].trackRoleInstruments, prints[j].trackRoleInstruments));
      noteShape.push(jaccardDistance(prints[i].noteShape.map(String), prints[j].noteShape.map(String)));
    }
  }
  return { mean: mean(total), harmony: mean(harmony), roleInstrument: mean(roleInstrument), noteShape: mean(noteShape), pairs: total.length, noteCounts: result.candidates.map((c) => c.noteCount) };
}

// ---------------------------------------------------------------------------
// R-1b P0-1 / P0-2 / P0-3: what the shipped notes say
// ---------------------------------------------------------------------------

const quantile = (xs: ReadonlyArray<number>, q: number): number | null => {
  if (!xs.length) return null;
  const sorted = [...xs].sort((a, b) => a - b);
  return r3(sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * q))]);
};

/**
 * One orchestrator run with the composed notes captured per part, through an
 * injected composer that *is* the reference composer. Composed vs shipped is
 * then a comparison of the same run's two stages, never of two runs.
 */
export function runWithComposedNotes(
  id: string, model: SongModelData, options: Parameters<typeof orchestrateArrangement>[0],
): { id: string; model: SongModelData; result: OrchestrationResult; composed: Map<string, MusicalNote[]> } {
  const composed = new Map<string, MusicalNote[]>();
  const tempoBpm = options.songModel.tempoMap?.[0]?.bpm ?? 120;
  const meter = options.songModel.meterMap?.[0]?.meter ?? "4/4";
  const result = orchestrateArrangement({
    ...options,
    composerName: "REFERENCE_PART_COMPOSER_V1 (captured)",
    composeParts: (request, context) => {
      const notes = composeReferencePart(request, {
        tempoBpm, meter, siblings: context?.siblings, texture: context?.texture,
      });
      // Keyed by the part's own seed as well as its task: the orchestrator
      // composes every candidate from the same task list, and a candidate's
      // seed is what tells its parts apart. Keying by task alone let the last
      // candidate composed overwrite the one that shipped.
      composed.set(`${request.seed}|${request.taskId}`, notes);
      return notes;
    },
  });
  return { id, model, result, composed };
}

type SectionWindow = { name: string; start: number; end: number };

function sectionWindows(result: OrchestrationResult, barSeconds: number): SectionWindow[] {
  return (result.plan.sectionPlan?.sections ?? []).map((s) => ({
    name: s.sectionName, start: (s.startBar - 1) * barSeconds, end: s.endBar * barSeconds,
  }));
}

const within = (window: SectionWindow) => (note: MusicalNote) =>
  note.start >= window.start - 1e-3 && note.start < window.end - 1e-3;

/**
 * Composed notes of one instrument for one candidate, merged the way the
 * orchestrator merges its tracks: the tasks of the part plan that name this
 * instrument, each looked up by the seed *this* candidate composed it with.
 */
function composedFor(
  run: { result: OrchestrationResult; composed: Map<string, MusicalNote[]> },
  candidateId: string,
  instrument: string,
): MusicalNote[] {
  const tasks = run.result.plan.partComposerPlan?.tasks ?? [];
  const adjustments = run.result.plan.candidateGenerationPlan?.candidates
    .find((c) => c.candidateId === candidateId)?.partAdjustments ?? [];
  const out: MusicalNote[] = [];
  for (const task of tasks) {
    if (task.instrument !== instrument) continue;
    const seed = adjustments.find((a) => a.taskId === task.id)?.seed ?? task.seed;
    out.push(...(run.composed.get(`${seed}|${task.id}`) ?? []));
  }
  return out.sort((a, b) => a.start - b.start);
}

/** Every note composed for one candidate, across its tasks. */
export function composedNoteCount(
  run: { result: OrchestrationResult; composed: Map<string, MusicalNote[]> },
  candidateId: string,
): number {
  const tasks = run.result.plan.partComposerPlan?.tasks ?? [];
  const adjustments = run.result.plan.candidateGenerationPlan?.candidates
    .find((c) => c.candidateId === candidateId)?.partAdjustments ?? [];
  let total = 0;
  for (const task of tasks) {
    const seed = adjustments.find((a) => a.taskId === task.id)?.seed ?? task.seed;
    total += (run.composed.get(`${seed}|${task.id}`) ?? []).length;
  }
  return total;
}

const selectedOf = (result: OrchestrationResult) => (result.selected
  ? result.candidates.find((c) => c.candidateId === result.selected!.candidateId) ?? result.candidates[0]
  : result.candidates[0]);

export type BedVoiceRow = {
  song: string; instrument: string; section: string;
  composedNotes: number; shippedNotes: number;
  composedMaxVoices: number; shippedMaxVoices: number;
  composedMeanVoices: number | null; shippedMeanVoices: number | null;
  shippedPitchRange: [number, number] | null;
};

const meanVoices = (notes: MusicalNote[]): number | null => {
  const clusters = polyphonyClusters(notes);
  if (!clusters.length) return notes.length ? 1 : null;
  return r3(clusters.reduce((s, c) => s + c.length, 0) / clusters.length);
};

/**
 * P0-1's measurement: how many voices the bed families (strings, pads) were
 * *written* in and how many actually ship, per section. The review measured
 * 3.0-4.0 composed against 1.00 shipped in every section of the owner's song.
 */
export function bedVoices(run: ReturnType<typeof runWithComposedNotes>): BedVoiceRow[] {
  const { result } = run;
  const timing = barTiming(result.timing.tempoBpm, result.timing.meter);
  const windows = sectionWindows(result, timing.barSeconds);
  const candidate = selectedOf(result);
  const rows: BedVoiceRow[] = [];
  for (const track of candidate.trackModels) {
    const family: string = track.instrumentDefinition.family;
    if (family !== "strings" && family !== "pads" && family !== "synth") continue;
    if (/bass/i.test(track.instrument)) continue;
    const all = composedFor(run, candidate.candidateId, track.instrument);
    for (const window of windows) {
      const shipped = track.notes.filter(within(window));
      const written = all.filter(within(window));
      if (!shipped.length && !written.length) continue;
      rows.push({
        song: run.id, instrument: track.instrument, section: window.name,
        composedNotes: written.length, shippedNotes: shipped.length,
        composedMaxVoices: maxSimultaneousVoices(written), shippedMaxVoices: maxSimultaneousVoices(shipped),
        composedMeanVoices: meanVoices(written), shippedMeanVoices: meanVoices(shipped),
        shippedPitchRange: shipped.length ? [Math.min(...shipped.map((n) => n.pitch)), Math.max(...shipped.map((n) => n.pitch))] : null,
      });
    }
  }
  return rows;
}

export type VelocityRow = {
  song: string; instrument: string; section: string;
  composedMean: number | null; shippedMean: number | null; ratio: number | null;
};

/**
 * P0-3's measurement: the composed velocity already carries the arc; this is
 * what survives performance, per section. The review measured x0.58-0.60 in
 * every one of the owner's nine sections.
 */
export function velocityRatios(run: ReturnType<typeof runWithComposedNotes>): VelocityRow[] {
  const { result } = run;
  const timing = barTiming(result.timing.tempoBpm, result.timing.meter);
  const windows = sectionWindows(result, timing.barSeconds);
  const candidate = selectedOf(result);
  const rows: VelocityRow[] = [];
  for (const track of candidate.trackModels) {
    const all = composedFor(run, candidate.candidateId, track.instrument);
    for (const window of windows) {
      const shipped = track.notes.filter(within(window));
      const written = all.filter(within(window));
      if (!shipped.length || !written.length) continue;
      const composedMean = mean(written.map((n) => n.velocity));
      const shippedMean = mean(shipped.map((n) => n.velocity));
      rows.push({
        song: run.id, instrument: track.instrument, section: window.name,
        composedMean, shippedMean,
        ratio: composedMean && shippedMean ? r3(shippedMean / composedMean) : null,
      });
    }
  }
  return rows;
}

export type OnsetDeviation = { n: number; medianMs: number | null; p75Ms: number | null; overFiftyMs: number };

const deviationsFrom = (times: ReadonlyArray<number>, step: number): number[] =>
  times.map((t) => Math.abs(t - Math.round(t / step) * step) * 1000);

const summariseDeviation = (deviations: number[]): OnsetDeviation => ({
  n: deviations.length,
  medianMs: quantile(deviations, 0.5),
  p75Ms: quantile(deviations, 0.75),
  overFiftyMs: deviations.filter((d) => d > 50).length,
});

/**
 * P0-2's measurement: how far the chord events the harmony writers place their
 * onsets from sit from the beat, as analysed and as the writers now read them,
 * and how far the shipped harmony onsets sit from the 8th grid the kit shares.
 * The review measured chord onsets median 136 ms / p75 185 ms from the beat,
 * 79 of 92 over 50 ms, and keys onsets median 119 ms / p90 199 ms.
 */
export function gridAgreement(run: ReturnType<typeof runWithComposedNotes>): {
  song: string;
  chordEvents: { analysed: OnsetDeviation; asRead: OnsetDeviation };
  shippedHarmonyOnsets: OnsetDeviation;
  shippedKitOnsets: OnsetDeviation;
} {
  const { result, model } = run;
  const timing = barTiming(result.timing.tempoBpm, result.timing.meter);
  const beat = timing.beatSeconds;
  const grid = { origin: 0, beat, subdivision: beat / 2 };
  const window = { start: 0, end: Number.MAX_SAFE_INTEGER };
  const minEventSeconds = 0.2;
  const analysed = chordEventsIn(model.chords ?? [], window, { minEventSeconds });
  const asRead = chordEventsIn(model.chords ?? [], window, { minEventSeconds, grid });
  const candidate = selectedOf(result);
  const harmonyOnsets: number[] = [];
  const kitOnsets: number[] = [];
  for (const track of candidate.trackModels) {
    const target = track.instrumentDefinition.family === "drums" ? kitOnsets : harmonyOnsets;
    for (const t of new Set(track.notes.map((n) => Number(n.start.toFixed(3))))) target.push(t);
  }
  return {
    song: run.id,
    chordEvents: {
      analysed: summariseDeviation(deviationsFrom(analysed.map((e) => e.start), beat)),
      asRead: summariseDeviation(deviationsFrom(asRead.map((e) => e.start), beat)),
    },
    shippedHarmonyOnsets: summariseDeviation(deviationsFrom(harmonyOnsets, beat / 2)),
    shippedKitOnsets: summariseDeviation(deviationsFrom(kitOnsets, beat / 2)),
  };
}

/** The owner's song with the PR-98 brief, composed notes captured. */
export function ownerRun(): ReturnType<typeof runWithComposedNotes> {
  const model = rachemNaSongModel();
  const hints = ownerHints();
  return runWithComposedNotes("owner-rachem-na", model, {
    songModel: model, candidateCount: 3, render: false, now: RACHEM_NA_FIXED_NOW,
    plannerHints: { global: hints.global, section: hints.section },
  });
}

// ---------------------------------------------------------------------------
// The measures
// ---------------------------------------------------------------------------

export function measureB13() {
  const agreement = validatorAgreementOnSeeds();
  const controls = documentedControls();
  const b02 = buildB02Evidence();
  const repair = {
    corpus: b02.corpus.map((c) => ({ id: c.id, ...c.shipped.playabilityRepair, selected: c.shipped.selected, feasible: c.shipped.feasible, noteCount: c.shipped.noteCount })),
    owner: { id: b02.owner.id, ...b02.owner.shipped.playabilityRepair, selected: b02.owner.shipped.selected, feasible: b02.owner.shipped.feasible, noteCount: b02.owner.shipped.noteCount },
    totals: {
      corpusLeapFolds: b02.totals.corpusLeapFolds, corpusBassLeapFolds: b02.totals.corpusBassLeapFolds,
      corpusPolyphonyReleases: b02.totals.corpusPolyphonyReleases, corpusDropped: b02.totals.corpusDropped,
      ownerLeapFolds: b02.totals.ownerLeapFolds, ownerPolyphonyReleases: b02.totals.ownerPolyphonyReleases, ownerDropped: b02.totals.ownerDropped,
    },
    composedBass: { corpusComposedBassLeapsOverLimit: b02.totals.corpusComposedBassLeapsOverLimit, corpusComposedBassOverlaps: b02.totals.corpusComposedBassOverlaps },
  };

  const songs = corpusSongs();
  const composedRows = songs.flatMap((s) => interlocking(s));
  const runs = [
    ...BENCHMARK_CORPUS.map((spec) => ({ id: spec.id, model: buildBenchmarkSongModel(spec) })),
    { id: "owner-rachem-na", model: rachemNaSongModel() },
  ].map(({ id, model }) => ({ id, model, result: orchestrateArrangement({ songModel: model, candidateCount: 1, render: false, now: B04_EVIDENCE_NOW }) }));
  const shippedRows = runs.flatMap(({ id, model, result }) => shippedInterlocking(id, model, result));
  const byRelation = (rows: ShippedInterlockRow[], relation: string) => {
    const xs = rows.filter((r) => r.relation === relation && r.kickToBass !== null).map((r) => r.kickToBass!);
    return { sections: xs.length, meanKickToBass: mean(xs), minKickToBass: xs.length ? Math.min(...xs) : null };
  };
  const kickBass = {
    composed: { rows: composedRows.length, meanKickToBass: mean(composedRows.map((r) => r.kickToBass).filter((v): v is number => v !== null)) },
    shipped: {
      rows: shippedRows,
      meanKickToBass: mean(shippedRows.map((r) => r.kickToBass).filter((v): v is number => v !== null)),
      lock: byRelation(shippedRows, "lock"), complement: byRelation(shippedRows, "complement"), pedal: byRelation(shippedRows, "pedal"),
    },
  };

  const orchestrated = [
    ...BENCHMARK_CORPUS.map((spec) => orchestratedMeasure(spec.id, buildBenchmarkSongModel(spec))),
    orchestratedMeasure("owner-rachem-na", rachemNaSongModel()),
  ];
  const adversarial = {
    perCase: orchestrated.map((o) => ({ song: o.song, causality: o.causality.penalty, causalityKinds: o.causality.kinds, machineMade: o.machineMade.penalty, arbitrariness: o.arbitrariness.penalty, feasible: o.feasible })),
    totals: {
      causalityPenalty: r3(orchestrated.reduce((s, o) => s + o.causality.penalty, 0)),
      machineMadePenalty: r3(orchestrated.reduce((s, o) => s + o.machineMade.penalty, 0)),
      arbitrarinessPenalty: r3(orchestrated.reduce((s, o) => s + o.arbitrariness.penalty, 0)),
      feasible: orchestrated.filter((o) => o.feasible).length,
    },
  };

  const hints = ownerHints();
  const distanceRuns = [
    ...BENCHMARK_CORPUS.map((spec) => ({ id: spec.id, result: orchestrateArrangement({ songModel: buildBenchmarkSongModel(spec), candidateCount: 5, render: false, now: new Date(0) }) })),
    { id: "owner-rachem-na", result: orchestrateArrangement({ songModel: rachemNaSongModel(), candidateCount: 5, render: false, now: RACHEM_NA_FIXED_NOW, plannerHints: { global: hints.global, section: hints.section } }) },
  ];
  const distances = distanceRuns.map(({ id, result }) => ({ id, ...candidateDistances(result), selected: result.selected?.candidateId ?? null, eligible: result.selection.eligible.length }));
  const candidateDistance_ = {
    perCase: distances,
    meanOverCases: mean(distances.map((d) => d.mean).filter((v): v is number => v !== null)),
    meanHarmony: mean(distances.map((d) => d.harmony).filter((v): v is number => v !== null)),
    meanNoteShape: mean(distances.map((d) => d.noteShape).filter((v): v is number => v !== null)),
    meanRoleInstrument: mean(distances.map((d) => d.roleInstrument).filter((v): v is number => v !== null)),
    threshold: 0.25,
  };

  // The owner's song and the corpus with their composed notes captured, so
  // every composed -> shipped comparison below is two stages of one run.
  const owner = ownerRun();
  const ownerCandidate = selectedOf(owner.result);
  const withComposed = [
    ...BENCHMARK_CORPUS.map((spec) => {
      const model = buildBenchmarkSongModel(spec);
      return runWithComposedNotes(spec.id, model, { songModel: model, candidateCount: 1, render: false, now: B04_EVIDENCE_NOW });
    }),
    owner,
  ];
  const bedVoiceRows = withComposed.flatMap((r) => bedVoices(r));
  const velocityRows = withComposed.flatMap((r) => velocityRatios(r));
  const gridRows = withComposed.map((r) => gridAgreement(r));
  const ownerBed = bedVoiceRows.filter((r) => r.song === "owner-rachem-na");
  const shipped = {
    bedVoices: {
      rows: bedVoiceRows,
      sectionsWithABed: bedVoiceRows.length,
      sectionsShippedAsOneVoice: bedVoiceRows.filter((r) => r.shippedMaxVoices <= 1 && r.composedMaxVoices > 1).length,
      meanComposedVoices: mean(bedVoiceRows.map((r) => r.composedMeanVoices ?? 0)),
      meanShippedVoices: mean(bedVoiceRows.map((r) => r.shippedMeanVoices ?? 0)),
      composedNotes: bedVoiceRows.reduce((s, r) => s + r.composedNotes, 0),
      shippedNotes: bedVoiceRows.reduce((s, r) => s + r.shippedNotes, 0),
      owner: {
        sections: ownerBed.length,
        composedNotes: ownerBed.reduce((s, r) => s + r.composedNotes, 0),
        shippedNotes: ownerBed.reduce((s, r) => s + r.shippedNotes, 0),
        meanShippedVoices: mean(ownerBed.map((r) => r.shippedMeanVoices ?? 0)),
        minShippedMaxVoices: ownerBed.length ? Math.min(...ownerBed.map((r) => r.shippedMaxVoices)) : null,
      },
    },
    velocity: {
      rows: velocityRows,
      meanRatio: mean(velocityRows.map((r) => r.ratio ?? 0)),
      minRatio: velocityRows.length ? Math.min(...velocityRows.map((r) => r.ratio ?? 0)) : null,
      maxRatio: velocityRows.length ? Math.max(...velocityRows.map((r) => r.ratio ?? 0)) : null,
    },
    grid: gridRows,
    ownerPlayabilityRepairs: ownerCandidate.playabilityRepairs.map((p) => ({
      trackId: p.trackId, leapFolds: p.leapFolds, polyphonyReleases: p.polyphonyReleases,
      dropped: p.dropped, durationLengthened: p.durationLengthened, residual: p.residual,
      changedNoteIds: p.changedNoteIds.length, decisionId: p.decisionId,
    })),
    ownerTracks: ownerCandidate.trackModels.map((t) => ({
      id: t.id, instrument: t.instrument, role: t.role, notes: t.notes.length,
      maxVoices: maxSimultaneousVoices(t.notes),
      pitchRange: t.notes.length ? [Math.min(...t.notes.map((n) => n.pitch)), Math.max(...t.notes.map((n) => n.pitch))] : null,
    })),
    ownerSelected: owner.result.selected?.candidateId ?? null,
    ownerScore: ownerCandidate.critique.overallScore,
    ownerHardRuleFeasible: ownerCandidate.hardRule.feasible,
  };

  return { validatorAgreement: agreement, documentedControls: controls, playabilityRepair: repair, kickBass, adversarial, candidateDistance: candidateDistance_, shipped };

}

export type B13Measures = ReturnType<typeof measureB13>;

/**
 * The before column. B-13 has no runnable "before" module: the defects it
 * fixes are in the perform -> repair cascade and in the wiring, and the
 * numbers that describe them were measured on the base tree by two prior
 * measurements, each named here with its source so a reader can re-run it:
 *
 *   - `r1b` - the independent musical review R-1 (round b), measured on
 *     `origin/main` = 4c5d967 with `orchestrateArrangement` exactly as the
 *     provider calls it and the composed notes captured through an injected
 *     `composeParts` wrapper (its Appendix B);
 *   - `b02` - `docs/evidence/brain-b02-harmony-realisation.json`, the
 *     committed `before` capture at a751796.
 *
 * Nothing here is re-derived from this tree: every "after" beside it is a
 * measurement of this tree by `measureB13()`.
 */
export const B13_BEFORE = {
  source: {
    r1b: "R-1 independent review, musical attack (round b), on origin/main 4c5d967; every figure below is from its Appendix B or the tables it cites.",
    b02: "docs/evidence/brain-b02-harmony-realisation.json (before capture at a751796).",
    b04: "docs/evidence/brain-b04-groove-and-transitions.json (this stream's base, 30041f5).",
    "b04/b08": "docs/evidence/brain-b04-groove-and-transitions.json and brain-b08-benchmark-measure.json, plus the candidate reading in the R-1b review's section 1.",
  },
  ownerStringBed: {
    source: "r1b",
    composedNotes: 304, shippedNotes: 91, polyphonyReleases: 323, dropped: 200,
    meanShippedVoicesPerSection: 1.0,
    verse1: { composedNotes: 45, composedVoices: 3, shippedNotes: 17, shippedVoices: 1, releases: 42, drops: 28 },
    controls: {
      repairOnComposedNotes: { releases: 0, drops: 0 },
      repairOnPerformedNotes: { releases: 42, drops: 28 },
      repairOnPerformedNotesWithoutTheStagger: { releases: 42, drops: 0 },
    },
    note: "playabilityRepair tested `o.start === n.start`; the performance engine staggers a chord's voices by ~1.5 ms (performanceEngine chord gesture, 12 ms window), so the lower voices read as earlier notes whose release fell under minNoteDuration and were dropped.",
  },
  ownerRepairCounts: { source: "b02", strings: { leapFolds: 118, polyphonyReleases: 320, dropped: 199 }, note: "the B-02 tracker's recorded numbers for the owner's strings track." },
  orchestralMidiStrings: { source: "r1b", composedNotes: 54, shippedNotes: 24, polyphonyReleases: 56, dropped: 30 },
  chordOnsets: {
    source: "r1b",
    fromNearestBeat: { medianMs: 136, p75Ms: 185, maxMs: 229, overFiftyMs: 79, n: 92 },
    shippedKeysOnsets: { medianMs: 119, p90Ms: 199 },
    control: "owner-q (chord onsets snapped to the beat, nothing else changed): groove critic 0 -> 97.57, off_grid 23 -> 0, keys onsets median 119 -> 9 ms, keys velocity Verse 1 30 -> 40 and Chorus 3 52 -> 66.",
  },
  velocityRatio: {
    source: "r1b",
    keysComposedToShipped: [
      { section: "Verse 1", composed: 51, shipped: 30 }, { section: "Verse 2", composed: 48, shipped: 29 },
      { section: "Chorus", composed: 70, shipped: 42 }, { section: "Chorus 2", composed: 74, shipped: 44 },
      { section: "Verse 3", composed: 53, shipped: 35 }, { section: "Bridge", composed: 66, shipped: 39 },
      { section: "Chorus 3", composed: 86, shipped: 52 }, { section: "Outro", composed: 50, shipped: 29 },
    ],
    ratioRange: [0.58, 0.6],
    strings: [0.64, 0.8], bass: [0.54, 0.76], percussion: 0.48,
    note: "the orchestrator resolved one role assignment per instrument - the first section's - and performed the whole track as the intro's pp.",
  },
  kickBass: { source: "b04", meanKickToBassOnShippedNotes: 0.617, note: "docs/evidence/brain-b04-groove-and-transitions.json, shipped interlocking mean." },
  candidateDistance: { source: "b04/b08", note: "three candidates scored 72/72/72 on the owner's song and differed by two bass notes (r1b section 1); the production diversity gate's threshold is 0.25." },
} as const;

export function buildB13Evidence(options: { now?: Date } = {}) {
  const measures = measureB13();
  return {
    title: "Brain B-13 - one playability truth, one groove for every part: validator agreement, the perform -> repair cascade, and the wiring the shipped notes were missing",
    generatedAt: (options.now ?? new Date()).toISOString(),
    method: [
      "measureB13(): the 24 B-12 seeds x 3 candidates through orchestrateArrangement (render false) with the provider contract, the constraint engine and the playability repair asked of every shipped track; the audit's Probe 4 controls; the nine synthetic benchmark cases and the owner's song fixture (PR-98 brief) with their composed notes captured through an injected composer that is the reference composer, so every composed -> shipped comparison is two stages of one run.",
      "`before` is not re-derived here: it carries the numbers the R-1 musical review (round b) and the B-02 evidence measured on the base tree, each row naming its source.",
      "Voices sounding together, chord gestures and melodic leaps are counted by `musicalConstraints` - the same predicates the contract validator and the repair now use.",
    ],
    before: B13_BEFORE,
    after: measures,
    gates: {
      validatorsAgreeOnTheB12Seeds: measures.validatorAgreement.tracks === measures.validatorAgreement.agreeingTracks,
      documentedControlsAgree: measures.documentedControls.every((c) => c.verdict.agree),
      noBedShipsAsOneVoice: measures.shipped.bedVoices.sectionsShippedAsOneVoice === 0,
      ownerBedKeepsThreeVoices: (measures.shipped.bedVoices.owner.minShippedMaxVoices ?? 0) >= 3,
      ownerBedDroppedNothing: measures.shipped.ownerPlayabilityRepairs.every((r) => r.dropped === 0),
      ownerRunIsSelectable: measures.shipped.ownerSelected !== null && measures.shipped.ownerHardRuleFeasible,
      noResidualPlayabilityRule: measures.shipped.ownerPlayabilityRepairs.every((r) => r.residual.length === 0),
    },
  };
}

export type B13Evidence = ReturnType<typeof buildB13Evidence>;


if (process.env.B13_MODE === "measure") {
  process.stdout.write(`${JSON.stringify(measureB13(), null, 2)}\n`);
}

if (process.env.B13_MODE === "document") {
  process.stdout.write(`${JSON.stringify(buildB13Evidence({ now: new Date("2026-09-10T12:00:00.000Z") }), null, 2)}\n`);
}
