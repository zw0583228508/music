/**
 * Evidence builder for `docs/evidence/brain-b02-harmony-realisation.json`
 * (Brain B-02, D6): the same measurements taken of the composer before and
 * after harmony realisation, on the nine synthetic benchmark cases and on the
 * owner's song fixture, so the tracker's before / after tables come from one
 * metric implementation rather than two readings.
 *
 * Measured per case:
 *   - playability repair counts of the shipped candidate (the orchestrator's
 *     own `playabilityRepairs`), with the bass singled out;
 *   - voice-leading metrics of the composed chordal parts (before performance):
 *     per-chord-change motion, common-tone share, parallel perfect intervals,
 *     root-position share, distinct voicing shapes;
 *   - bass-line metrics: max leap, leaps over the instrument limit, notes that
 *     lap into the next chord, approach-tone share (the B-05b definition),
 *     contrary-motion share against the keys' top voice at chord changes;
 *   - the B-05b adversarial `professionalWouldChange` and `machineMade`
 *     reports (score, penalty, kinds) on the shipped candidate.
 *
 * Run through `scripts/brain-b02-harmony-evidence.mjs`; pass a `--before`
 * capture of the same document taken at the base commit to fold it in.
 */
import type { MusicalNote, SongModelData } from "@workspace/db";
import { BENCHMARK_CORPUS, buildBenchmarkSongModel } from "./benchmarkCorpus";
import { orchestrateArrangement } from "./arrangementOrchestrator";
import { composeReferencePart } from "./referencePartComposer";
import { deriveGlobalArrangementPlan } from "./globalArrangementPlanner";
import { deriveSectionPhrasePlan } from "./sectionPhrasePlanner";
import { deriveOrchestrationBudget } from "./orchestrationBudget";
import { deriveTransitionPlan } from "./transitionEngine";
import { buildPartComposerPlan, buildPartGenerationRequest, type PartGenerationRequest } from "./partComposer";
import { runAdversarialCritics } from "./critics/adversarial/index";
import { penaltyOf } from "./critics/adversarial/shared";
import { compileProductionBrief } from "./producerIntelligence/briefCompiler";
import { briefPlannerHints } from "./producerIntelligence/briefToPlanner";
import { extractUserIntentSync } from "./producerIntelligence/intentExtraction";
import { resolveStyleProfile } from "./producerIntelligence/styleResolution";
import { RACHEM_NA_FIXED_NOW, rachemNaSongModel } from "./__fixtures__/rachemNaSongModelV3";
import { parseChord } from "./chordSymbols";

const NOW = new Date(0);
const OWNER_BRIEF = "intimate ballad; piano, soft strings, gentle bass, light percussion; big final chorus";
const CHORDAL_TASKS = new Set(["PIANO", "KEYS", "ACOUSTIC_GUITAR", "ELECTRIC_GUITAR", "STRINGS", "PAD", "BRASS", "WOODWINDS"]);
const r3 = (v: number) => Number(v.toFixed(3));
const pc = (p: number) => ((p % 12) + 12) % 12;

type Chord = { start: number; end: number; symbol: string; root?: string; quality?: string; bass?: string };

export type PartMetrics = {
  taskId: string; task: string; instrument: string; role: string; section: string; notes: number;
  chordal?: {
    changes: number; meanMotionPerVoice: number; commonToneShare: number;
    parallelPerfect: number; rootPositionShare: number; distinctShapes: number; shapesPerChordSymbol: number;
  };
  bass?: {
    maxLeap: number; leapsOverLimit: number; maxLeapAllowed: number; overlapsIntoNextChord: number;
    changesLandingOnRoot: number; approachedByStep: number; approachShare: number;
    contraryVsKeysTop: number; contraryShare: number | null;
    slashChordsUnderPart: number; slashBassHonoured: number;
  };
};

function clustersOf(notes: readonly MusicalNote[], tolerance = 0.03): MusicalNote[][] {
  const sorted = [...notes].sort((a, b) => a.start - b.start || a.pitch - b.pitch);
  const out: MusicalNote[][] = [];
  for (const n of sorted) {
    const last = out[out.length - 1];
    if (last && n.start - last[0].start <= tolerance) last.push(n);
    else out.push([n]);
  }
  return out;
}

function chordAt(chords: readonly Chord[], t: number): Chord | null {
  return chords.find((c) => c.start <= t + 0.03 && c.end > t + 0.03) ?? null;
}

function chordPcs(chord: Chord): Set<number> {
  const parsed = parseChord(chord.symbol, chord);
  return new Set(parsed ? parsed.pitchClasses : []);
}

function rootOf(chord: Chord): number | null {
  const parsed = parseChord(chord.symbol, chord);
  return parsed ? parsed.root : null;
}

function bassOf(chord: Chord): number | null {
  const parsed = parseChord(chord.symbol, chord);
  return parsed ? parsed.bass : null;
}

function chordalMetrics(notes: MusicalNote[], chords: Chord[]): PartMetrics["chordal"] {
  const clusters = clustersOf(notes).filter((c) => new Set(c.map((n) => n.pitch)).size >= 2);
  let changes = 0;
  let motion = 0;
  let voicesMoved = 0;
  let held = 0;
  let heldDenominator = 0;
  let parallel = 0;
  let rootPosition = 0;
  let withChord = 0;
  const shapes = new Set<string>();
  const bySymbol = new Map<string, Set<string>>();
  let previous: { pitches: number[]; chord: Chord | null } | null = null;
  for (const cluster of clusters) {
    const pitches = [...new Set(cluster.map((n) => n.pitch))].sort((a, b) => a - b);
    const chord = chordAt(chords, cluster[0].start);
    const shape = pitches.slice(1).map((p, i) => p - pitches[i]).join("-");
    shapes.add(shape);
    const key = chord ? chord.symbol : "?";
    bySymbol.set(key, (bySymbol.get(key) ?? new Set()).add(shape));
    if (chord) {
      const root = rootOf(chord);
      if (root !== null) {
        withChord += 1;
        if (pc(pitches[0]) === root) rootPosition += 1;
      }
    }
    if (previous && chord && previous.chord && chord !== previous.chord) {
      changes += 1;
      const n = Math.min(previous.pitches.length, pitches.length);
      const from = previous.pitches.slice(0, n);
      const to = pitches.slice(0, n);
      for (let i = 0; i < n; i += 1) {
        motion += Math.abs(to[i] - from[i]);
        voicesMoved += 1;
        heldDenominator += 1;
        if (previous.pitches.includes(to[i])) held += 1;
      }
      for (let a = 0; a < n; a += 1) {
        for (let b = a + 1; b < n; b += 1) {
          const before = Math.abs(from[a] - from[b]) % 12;
          const after = Math.abs(to[a] - to[b]) % 12;
          const dA = to[a] - from[a];
          const dB = to[b] - from[b];
          if (dA !== 0 && dB !== 0 && Math.sign(dA) === Math.sign(dB) && (before === 7 || before === 0) && before === after) parallel += 1;
        }
      }
    }
    previous = { pitches, chord };
  }
  const symbolShapes = [...bySymbol.values()].reduce((s, set) => s + set.size, 0);
  return {
    changes,
    meanMotionPerVoice: voicesMoved ? r3(motion / voicesMoved) : 0,
    commonToneShare: heldDenominator ? r3(held / heldDenominator) : 0,
    parallelPerfect: parallel,
    rootPositionShare: withChord ? r3(rootPosition / withChord) : 0,
    distinctShapes: shapes.size,
    shapesPerChordSymbol: bySymbol.size ? r3(symbolShapes / bySymbol.size) : 0,
  };
}

function bassMetrics(notes: MusicalNote[], chords: Chord[], maxLeap: number, keysNotes: MusicalNote[] | null): PartMetrics["bass"] {
  const line = clustersOf(notes).map((c) => c.reduce((m, n) => (n.pitch < m.pitch ? n : m), c[0]));
  let maxLeapSeen = 0;
  let over = 0;
  let overlaps = 0;
  let changes = 0;
  let approached = 0;
  let contraryChanges = 0;
  let contrary = 0;
  let slashUnder = 0;
  let slashHonoured = 0;
  for (const chord of chords) {
    const bass = bassOf(chord);
    const root = rootOf(chord);
    if (bass === null || root === null || bass === root) continue;
    const first = line.find((n) => n.start >= chord.start - 0.03 && n.start < chord.end - 0.03);
    if (!first) continue;
    slashUnder += 1;
    if (pc(first.pitch) === bass) slashHonoured += 1;
  }
  for (let i = 0; i < line.length; i += 1) {
    const n = line[i];
    const chord = chordAt(chords, n.start);
    if (chord) {
      const next = chords.find((c) => c.start > chord.start + 1e-6 && c.start >= chord.end - 1e-6);
      if (next && n.start + n.duration > next.start + 0.02) overlaps += 1;
    }
    if (i === 0) continue;
    const prev = line[i - 1];
    const leap = Math.abs(n.pitch - prev.pitch);
    maxLeapSeen = Math.max(maxLeapSeen, leap);
    if (leap > maxLeap) over += 1;
    const before = chordAt(chords, prev.start);
    if (!before || !chord || before === chord) continue;
    const root = rootOf(chord);
    if (root === null || pc(n.pitch) !== root) continue;
    changes += 1;
    const fromApproachTone = !chordPcs(before).has(pc(prev.pitch));
    if ((leap === 1 || leap === 2) && fromApproachTone) approached += 1;
    if (keysNotes) {
      const topAt = (t: number) => {
        const sounding = keysNotes.filter((k) => k.start <= t + 0.03 && k.start + k.duration > t + 0.03);
        return sounding.length ? Math.max(...sounding.map((k) => k.pitch)) : null;
      };
      const topBefore = topAt(prev.start);
      const topNow = topAt(n.start);
      if (topBefore !== null && topNow !== null && topNow !== topBefore) {
        contraryChanges += 1;
        if (Math.sign(topNow - topBefore) !== Math.sign(n.pitch - prev.pitch) && n.pitch !== prev.pitch) contrary += 1;
      }
    }
  }
  return {
    maxLeap: maxLeapSeen, leapsOverLimit: over, maxLeapAllowed: maxLeap, overlapsIntoNextChord: overlaps,
    changesLandingOnRoot: changes, approachedByStep: approached, approachShare: changes ? r3(approached / changes) : 0,
    contraryVsKeysTop: contrary, contraryShare: contraryChanges ? r3(contrary / contraryChanges) : null,
    slashChordsUnderPart: slashUnder, slashBassHonoured: slashHonoured,
  };
}

type GlobalHints = NonNullable<Parameters<typeof deriveGlobalArrangementPlan>[1]>["hints"];
type SectionHints = NonNullable<Parameters<typeof deriveSectionPhrasePlan>[2]>["hints"];

export function composedPartMetrics(model: SongModelData, tempoBpm: number, meter: string, hints?: GlobalHints, sectionHints?: SectionHints, now = NOW): PartMetrics[] {
  const globalPlan = deriveGlobalArrangementPlan(model, { now, hints });
  const sectionPlan = deriveSectionPhrasePlan(model, globalPlan, { now, hints: sectionHints });
  const budget = deriveOrchestrationBudget(model, sectionPlan, { now });
  const transitions = deriveTransitionPlan(model, globalPlan, sectionPlan, { now });
  const partPlan = buildPartComposerPlan(model, globalPlan, sectionPlan, transitions.transitions, { now });
  const layers = { globalPlan, sectionPlan, budgetWindows: budget.windows, transitions: transitions.transitions };
  const composed: Array<{ request: PartGenerationRequest; notes: MusicalNote[] }> = [];
  const existing: PartGenerationRequest["existingParts"] = [];
  const siblings: Array<{ instrument: string; role: string; notes: MusicalNote[] }> = [];
  for (const task of partPlan.tasks) {
    const request = buildPartGenerationRequest(model, task, layers, existing);
    const notes = composeReferencePart(request, { tempoBpm, meter, siblings });
    composed.push({ request, notes });
    if (notes.length) {
      existing.push({ instrument: task.instrument, role: task.role, noteCount: notes.length });
      siblings.push({ instrument: task.instrument, role: task.role, notes });
    }
  }
  const chords = model.chords as Chord[];
  return composed.map(({ request, notes }) => {
    const base: PartMetrics = {
      taskId: request.taskId, task: request.task, instrument: request.instrument, role: request.role,
      section: request.section.sectionName, notes: notes.length,
    };
    const sectionChords = chords.filter((c) => c.end > request.context.currentBars.chords[0]?.start && c.start < (request.context.currentBars.chords.at(-1)?.end ?? 0));
    if (CHORDAL_TASKS.has(request.task) && notes.length) base.chordal = chordalMetrics(notes, sectionChords.length ? sectionChords : chords);
    if (request.task === "BASS" && notes.length) {
      const keys = composed.find((p) => ["PIANO", "KEYS", "ACOUSTIC_GUITAR", "ELECTRIC_GUITAR"].includes(p.request.task) && p.request.section.sectionName === request.section.sectionName && p.notes.length);
      base.bass = bassMetrics(notes, chords, request.constraints.maxLeap, keys ? keys.notes : null);
    }
    return base;
  });
}

function aggregate(parts: PartMetrics[]) {
  const chordal = parts.filter((p) => p.chordal && p.chordal.changes > 0);
  const bass = parts.filter((p) => p.bass);
  const sum = (xs: number[]) => xs.reduce((a, b) => a + b, 0);
  const weightedMean = (pairs: Array<[number, number]>) => {
    const w = sum(pairs.map(([, n]) => n));
    return w ? r3(sum(pairs.map(([v, n]) => v * n)) / w) : null;
  };
  return {
    chordalParts: chordal.length,
    chordChanges: sum(chordal.map((p) => p.chordal!.changes)),
    meanMotionPerVoice: weightedMean(chordal.map((p) => [p.chordal!.meanMotionPerVoice, p.chordal!.changes])),
    commonToneShare: weightedMean(chordal.map((p) => [p.chordal!.commonToneShare, p.chordal!.changes])),
    parallelPerfect: sum(chordal.map((p) => p.chordal!.parallelPerfect)),
    rootPositionShare: weightedMean(chordal.map((p) => [p.chordal!.rootPositionShare, p.chordal!.changes + 1])),
    meanShapesPerChordSymbol: weightedMean(chordal.map((p) => [p.chordal!.shapesPerChordSymbol, 1])),
    bassParts: bass.length,
    bassMaxLeap: bass.length ? Math.max(...bass.map((p) => p.bass!.maxLeap)) : null,
    bassLeapsOverLimit: sum(bass.map((p) => p.bass!.leapsOverLimit)),
    bassOverlapsIntoNextChord: sum(bass.map((p) => p.bass!.overlapsIntoNextChord)),
    bassChangesLandingOnRoot: sum(bass.map((p) => p.bass!.changesLandingOnRoot)),
    bassApproachedByStep: sum(bass.map((p) => p.bass!.approachedByStep)),
    bassApproachShare: weightedMean(bass.map((p) => [p.bass!.approachShare, p.bass!.changesLandingOnRoot])),
    bassContraryShare: weightedMean(bass.filter((p) => p.bass!.contraryShare !== null).map((p) => [p.bass!.contraryShare!, 1])),
    slashChordsUnderBass: sum(bass.map((p) => p.bass!.slashChordsUnderPart)),
    slashBassHonoured: sum(bass.map((p) => p.bass!.slashBassHonoured)),
  };
}

function shippedMetrics(model: SongModelData, options: { hints?: Parameters<typeof orchestrateArrangement>[0]["plannerHints"]; candidateCount?: number; now?: Date }) {
  const run = orchestrateArrangement({ songModel: model, candidateCount: options.candidateCount ?? 1, render: false, now: options.now ?? NOW, plannerHints: options.hints });
  const candidate = run.selected ? run.candidates.find((c) => c.candidateId === run.selected!.candidateId) ?? run.candidates[0] : run.candidates[0];
  const repairs = candidate.playabilityRepairs;
  const sumOf = (key: "rangeFolds" | "leapFolds" | "durationLengthened" | "breathTruncated" | "polyphonyReleases" | "dropped", filter?: (trackId: string) => boolean) =>
    repairs.filter((r) => !filter || filter(r.trackId)).reduce((s, r) => s + r[key], 0);
  const bassTrack = (id: string) => /bass/i.test(id);
  const reports = runAdversarialCritics({ songModel: model, plan: run.plan, trackModels: candidate.trackModels });
  const pick = (dimension: string) => {
    const r = reports.find((x) => x.dimension === dimension)!;
    const kinds: Record<string, number> = {};
    for (const o of r.observations) kinds[o.kind] = (kinds[o.kind] ?? 0) + 1;
    return { applicable: r.applicable, score: r.summary.score0to100, penalty: penaltyOf(r.observations), kinds };
  };
  return {
    candidateId: candidate.candidateId, strategy: candidate.strategy, selected: Boolean(run.selected), feasible: candidate.hardRule.feasible,
    noteCount: candidate.noteCount,
    tracks: candidate.trackModels.map((t) => ({ id: t.id, instrument: t.instrument, definition: t.instrumentDefinition.id, notes: t.notes.length })),
    playabilityRepair: {
      tracksRepaired: repairs.length,
      leapFolds: sumOf("leapFolds"), bassLeapFolds: sumOf("leapFolds", bassTrack),
      rangeFolds: sumOf("rangeFolds"), polyphonyReleases: sumOf("polyphonyReleases"), dropped: sumOf("dropped"),
      durationLengthened: sumOf("durationLengthened"), breathTruncated: sumOf("breathTruncated"),
      perTrack: repairs.map((r) => ({ trackId: r.trackId, leapFolds: r.leapFolds, rangeFolds: r.rangeFolds, polyphonyReleases: r.polyphonyReleases, dropped: r.dropped, residual: r.residual })),
    },
    adversarial: {
      professionalWouldChange: pick("adversarial.professionalWouldChange"),
      machineMade: pick("adversarial.machineMade"),
    },
    hardRuleErrors: candidate.findings.filter((f) => f.severity === "error").map((f) => `${f.kind}: ${f.message}`),
  };
}

function ownerHints() {
  const model = rachemNaSongModel();
  const intent = extractUserIntentSync(OWNER_BRIEF, { now: RACHEM_NA_FIXED_NOW });
  const profile = resolveStyleProfile(intent, { now: RACHEM_NA_FIXED_NOW });
  const brief = compileProductionBrief(intent, profile, model, [], { now: RACHEM_NA_FIXED_NOW });
  return briefPlannerHints(brief);
}

export function buildB02Evidence() {
  const corpus = BENCHMARK_CORPUS.map((spec) => {
    const model = buildBenchmarkSongModel(spec);
    const parts = composedPartMetrics(model, spec.tempoBpm, spec.meter);
    return {
      id: spec.id, genre: spec.genre, meter: spec.meter, tempoBpm: spec.tempoBpm, key: spec.key, progression: spec.progression,
      composed: aggregate(parts),
      shipped: shippedMetrics(model, {}),
      parts: parts.filter((p) => p.chordal || p.bass),
    };
  });
  const owner = (() => {
    const model = rachemNaSongModel();
    const hints = ownerHints();
    const parts = composedPartMetrics(model, model.tempoMap[0].bpm, model.meterMap[0].meter, hints.global, hints.section, RACHEM_NA_FIXED_NOW);
    const bySection: Record<string, ReturnType<typeof aggregate>> = {};
    for (const section of model.sections) bySection[section.name] = aggregate(parts.filter((p) => p.section === section.name));
    return {
      id: "rachem-na-v3", brief: OWNER_BRIEF, bpm: model.tempoMap[0].bpm, meter: model.meterMap[0].meter, key: model.keyMap[0].key, chords: model.chords.length,
      composed: aggregate(parts),
      bySection,
      shipped: shippedMetrics(model, { hints: { global: hints.global, section: hints.section }, candidateCount: 2, now: RACHEM_NA_FIXED_NOW }),
      parts: parts.filter((p) => p.chordal || p.bass),
    };
  })();
  const totals = {
    corpusBassLeapFolds: corpus.reduce((s, c) => s + c.shipped.playabilityRepair.bassLeapFolds, 0),
    corpusLeapFolds: corpus.reduce((s, c) => s + c.shipped.playabilityRepair.leapFolds, 0),
    corpusPolyphonyReleases: corpus.reduce((s, c) => s + c.shipped.playabilityRepair.polyphonyReleases, 0),
    corpusDropped: corpus.reduce((s, c) => s + c.shipped.playabilityRepair.dropped, 0),
    corpusComposedBassLeapsOverLimit: corpus.reduce((s, c) => s + c.composed.bassLeapsOverLimit, 0),
    corpusComposedBassOverlaps: corpus.reduce((s, c) => s + c.composed.bassOverlapsIntoNextChord, 0),
    corpusParallelPerfect: corpus.reduce((s, c) => s + c.composed.parallelPerfect, 0),
    corpusMeanProfessionalScore: r3(corpus.reduce((s, c) => s + (c.shipped.adversarial.professionalWouldChange.score ?? 0), 0) / corpus.length),
    corpusMeanMachineMadeScore: r3(corpus.reduce((s, c) => s + (c.shipped.adversarial.machineMade.score ?? 0), 0) / corpus.length),
    corpusStaticBassObservations: corpus.reduce((s, c) => s + (c.shipped.adversarial.professionalWouldChange.kinds["static_bass_no_approach"] ?? 0), 0),
    corpusRootPositionOnlyObservations: corpus.reduce((s, c) => s + (c.shipped.adversarial.machineMade.kinds["root_position_only"] ?? 0), 0),
    corpusIdenticalShapeObservations: corpus.reduce((s, c) => s + (c.shipped.adversarial.machineMade.kinds["identical_voicing_shape"] ?? 0), 0),
    ownerBassLeapFolds: owner.shipped.playabilityRepair.bassLeapFolds,
    ownerLeapFolds: owner.shipped.playabilityRepair.leapFolds,
    ownerPolyphonyReleases: owner.shipped.playabilityRepair.polyphonyReleases,
    ownerDropped: owner.shipped.playabilityRepair.dropped,
    ownerProfessionalScore: owner.shipped.adversarial.professionalWouldChange.score,
    ownerMachineMadeScore: owner.shipped.adversarial.machineMade.score,
  };
  return { totals, corpus, owner };
}

if (process.argv[1] && /brain-b02-harmony-evidence/.test(process.argv[1])) {
  process.stdout.write(`${JSON.stringify(buildB02Evidence(), null, 2)}\n`);
}
