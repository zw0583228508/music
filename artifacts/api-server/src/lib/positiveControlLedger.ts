/**
 * Positive-control ledger (Brain B-08, evaluation audit §7.4).
 *
 * The repo's standing rule: a metric may gate a decision only after a positive
 * control — a deliberately worsened arrangement it is shown to catch. This
 * module is that ledger. It takes anchor arrangements (the benchmark's nine
 * selected candidates, and real PDMX parts in their ensemble context), applies
 * every corruption family of `symbolicCorruptions.ts` at its three severities
 * and every rung of the listening degradations, runs each available metric on
 * the original and on the corrupted copy, and records **per metric, per
 * family, per rung** how often the metric moved in the right direction, with
 * an exact binomial interval.
 *
 * The rule, mirroring the listening sensitivity gate (`SENSITIVITY_GATE`):
 *
 *  - a metric may **gate** a family only if it detects it at ≥ 90 % at the
 *    strongest rung, on at least `minTrials` trials;
 *  - it may **inform** where it is above chance (one-sided exact p < 0.05) at
 *    the strongest rung;
 *  - otherwise it is **demoted** for that family — reported, never tuned.
 *
 * "Detected" means strictly worse than the original in the metric's own
 * direction; a metric that does not move at all is a metric that did not see
 * the damage. Nothing here is fitted: the metrics are called as production
 * calls them, and the anchors are what the pipeline actually wrote.
 */
import type { ArrangementPlan, MusicalNote, SongModelData, TrackModel } from "@workspace/db";
import {
  barSpansOf,
  coherenceOfTracks,
  currentMetricVersions,
  isPercussionTrack,
  measureCandidateHarmony,
  remiFamilyForTrack,
  songModelChords,
  taskFromArrangement,
  trackAsTournamentTrack,
  type MetricVersions,
} from "./benchmarkMeasures";
import { evaluateCandidateMusicalFit } from "./candidateQuality";
import { measureCoherence, type CoherenceReport } from "./coherenceMetric";
import { formInputFromSecondsTracks } from "./formSegmentation";
import {
  DEGRADATION_LADDER,
  LISTENING_CONTROL_VERSION,
  degradeNotes,
  type DegradationRung,
} from "./listeningDegradations";
import { exactBinomialCi, oneSidedPVsChance, SENSITIVITY_GATE } from "./listeningSensitivity";
import type { MidiNote } from "./midiFile";
import { critiqueArrangement } from "./musicCritic";
import { chordToneShare, contextClashShare, judgePart } from "./partJudge";
import {
  CORRUPTION_FAMILIES,
  CORRUPTION_FAMILY_NAMES,
  SEVERITIES,
  SYMBOLIC_CORRUPTIONS_VERSION,
  applyCorruption,
  corruptionContextFromTask,
  type CorruptionContext,
  type CorruptionFamily,
  type CorruptionSeverity,
  type MusicalKey,
} from "./symbolicCorruptions";
import type { TournamentTask } from "./tournamentTask";

export const POSITIVE_CONTROL_LEDGER_VERSION = "1.0" as const;

export const LEDGER_RULE = {
  /** Detection rate at the strongest rung at or above which a metric may gate the family. */
  gateMinDetection: SENSITIVITY_GATE.strongestMinDetection,
  /** One-sided exact p against chance below which a metric informs on the family. */
  informMaxP: SENSITIVITY_GATE.alpha,
  /** Fewer trials than this at the strongest rung: insufficient data, no verdict. */
  minTrials: SENSITIVITY_GATE.minVotesPerRung,
  /** A metric must move by more than this, in its own units, to count as having seen the damage. */
  epsilon: 1e-6,
} as const;

// ---------------------------------------------------------------------------
// Metrics
// ---------------------------------------------------------------------------

export type MetricDirection = "higher_better" | "lower_better";
export type MetricGroup = "musicCritic" | "benchmarkHarmony" | "partJudge" | "coherence" | "candidateQuality";

export type MetricProbe = {
  id: string;
  group: MetricGroup;
  direction: MetricDirection;
  /** Anchor kinds the metric can run on. */
  anchors: Array<LedgerAnchor["kind"]>;
  description: string;
};

const MUSIC_CRITIC_DIMENSIONS = [
  "harmony", "groove", "voiceLeading", "leadCompatibility", "orchestration", "sectionDevelopment",
  "motifCoherence", "contrast", "transitions", "playability", "performancePotential",
] as const;

const CANDIDATE_QUALITY_DIMENSIONS = [
  "vocalFit", "harmony", "development", "contrastAndTransitions", "registerCollisions", "playability",
  "repetition", "styleAndControlAdherence", "roleDuplication", "orchestralBalance", "grooveCoordination", "voiceLeading",
  "countermelodyShape", "dramaticTrajectory", "motifContinuityAndDevelopment", "phraseIntent", "vocalInteraction",
] as const;

const COHERENCE_COMPONENTS = [
  "seamArtefacts", "harmonicAgreement", "instrumentationContinuity", "trajectorySmoothness", "motifRecurrence",
] as const;

export const METRIC_PROBES: readonly MetricProbe[] = [
  { id: "musicCritic.overall", group: "musicCritic", direction: "higher_better", anchors: ["arrangement"], description: "critiqueArrangement overallScore on the arrangement with the target part replaced" },
  ...MUSIC_CRITIC_DIMENSIONS.map((d): MetricProbe => ({ id: `musicCritic.${d}`, group: "musicCritic", direction: "higher_better", anchors: ["arrangement"], description: `critiqueArrangement dimension ${d}` })),
  { id: "benchmarkHarmony.harmonyScore", group: "benchmarkHarmony", direction: "higher_better", anchors: ["arrangement", "task"], description: "B-08 benchmark harmonyScore: 100 x (chord-tone share - clash share) of the target part" },
  { id: "benchmarkHarmony.chordToneShare", group: "benchmarkHarmony", direction: "higher_better", anchors: ["arrangement", "task"], description: "duration-weighted chord-tone share of the target part vs the shared chords (partJudge.chordToneShare)" },
  { id: "benchmarkHarmony.clashShare", group: "benchmarkHarmony", direction: "lower_better", anchors: ["arrangement", "task"], description: "share of the target part's sounding time a semitone from a sounding context note (partJudge.contextClashShare)" },
  { id: "partJudge.score", group: "partJudge", direction: "higher_better", anchors: ["arrangement", "task"], description: "judgePart total (anchor-relative components included; see limits)" },
  { id: "partJudge.playabilityErrors", group: "partJudge", direction: "lower_better", anchors: ["arrangement", "task"], description: "physical constraint errors of the target part (judge 1.1 GM tables)" },
  { id: "partJudge.rangeShare", group: "partJudge", direction: "higher_better", anchors: ["arrangement", "task"], description: "share of notes inside the GM program's playable range" },
  { id: "partJudge.registerShare", group: "partJudge", direction: "higher_better", anchors: ["arrangement", "task"], description: "share of notes inside the idiomatic register" },
  { id: "partJudge.coverage", group: "partJudge", direction: "higher_better", anchors: ["arrangement", "task"], description: "share of bars in which the part plays" },
  { id: "partJudge.barRepetitionShare", group: "partJudge", direction: "lower_better", anchors: ["arrangement", "task"], description: "share of bars identical to the previous bar" },
  { id: "coherence.score", group: "coherence", direction: "higher_better", anchors: ["arrangement", "task"], description: "COHERENCE_METRIC_v1 total on the ensemble with the target part replaced" },
  ...COHERENCE_COMPONENTS.map((c): MetricProbe => ({ id: `coherence.${c}`, group: "coherence", direction: "higher_better", anchors: ["arrangement", "task"], description: `coherence component ${c}` })),
  { id: "candidateQuality.score", group: "candidateQuality", direction: "higher_better", anchors: ["arrangement"], description: "evaluateCandidateMusicalFit score (the production job-runner critic; harmonyDecisions absent as on brain output)" },
  ...CANDIDATE_QUALITY_DIMENSIONS.map((d): MetricProbe => ({ id: `candidateQuality.${d}`, group: "candidateQuality", direction: "higher_better", anchors: ["arrangement"], description: `evaluateCandidateMusicalFit dimension ${d} (null when the dimension reports unavailable)` })),
];

// ---------------------------------------------------------------------------
// Anchors
// ---------------------------------------------------------------------------

export type ArrangementAnchor = {
  kind: "arrangement";
  id: string;
  tier: "S" | "P";
  songModel: SongModelData;
  plan: ArrangementPlan;
  trackModels: TrackModel[];
};

export type TaskAnchor = {
  kind: "task";
  id: string;
  tier: "H";
  task: TournamentTask;
};

export type LedgerAnchor = ArrangementAnchor | TaskAnchor;

// ---------------------------------------------------------------------------
// Control families
// ---------------------------------------------------------------------------

export type ControlSource = "symbolicCorruptions" | "listeningDegradations";

export type ControlRung = { rung: string; strength: number };

export type ControlFamilySpec = {
  id: string;
  source: ControlSource;
  breaks: string;
  description: string;
  /** Weakest first; the last is the strongest rung the gate reads. */
  rungs: ControlRung[];
};

export function controlFamilies(): ControlFamilySpec[] {
  const symbolic = CORRUPTION_FAMILY_NAMES.map((family): ControlFamilySpec => ({
    id: family,
    source: "symbolicCorruptions",
    breaks: CORRUPTION_FAMILIES[family].breaks,
    description: CORRUPTION_FAMILIES[family].description,
    rungs: SEVERITIES.map((s) => ({ rung: `severity_${s}`, strength: s })),
  }));
  const byKind = new Map<string, DegradationRung[]>();
  for (const rung of DEGRADATION_LADDER) byKind.set(rung.kind, [...(byKind.get(rung.kind) ?? []), rung]);
  const listening = [...byKind.entries()].map(([kind, rungs]): ControlFamilySpec => ({
    id: `listening_${kind}`,
    source: "listeningDegradations",
    breaks: kind === "onset_jitter" ? "rhythm" : kind === "note_deletion" ? "density" : "harmony",
    description: `Listening Benchmark V2 control ${kind}`,
    rungs: rungs.map((r) => ({ rung: `${kind}_${Math.round(r.strength * 100)}`, strength: r.strength })),
  }));
  return [...symbolic, ...listening];
}

// ---------------------------------------------------------------------------
// Measuring one target, original vs corrupted
// ---------------------------------------------------------------------------

type MetricVector = Record<string, number | null>;

const r4 = (v: number) => Number(v.toFixed(4));

/** The Song Model's key in the corruption library's shape; null when unreadable. */
export function keyFromSongModel(songModel: Pick<SongModelData, "keyMap">): MusicalKey | null {
  const entry = songModel.keyMap?.[0];
  if (!entry) return null;
  const m = /^([A-G])([#b♯♭]?)m?\s+(major|minor)$/i.exec(entry.key.trim());
  if (!m) return null;
  const base: Record<string, number> = { C: 0, D: 2, E: 4, F: 5, G: 7, A: 9, B: 11 };
  const accidental = m[2] === "#" || m[2] === "♯" ? 1 : m[2] === "b" || m[2] === "♭" ? -1 : 0;
  const tonic = ((base[m[1].toUpperCase()] + accidental) % 12 + 12) % 12;
  return { tonic, mode: m[3].toLowerCase() as "major" | "minor", name: entry.key, confidence: entry.confidence ?? 0 };
}

function withTargetReplaced(tracks: readonly TrackModel[], targetId: string, notes: MusicalNote[]): TrackModel[] {
  return tracks.map((t) => (t.id === targetId ? { ...t, notes } : t));
}

function coherenceVector(report: CoherenceReport | null): MetricVector {
  const out: MetricVector = { "coherence.score": report?.score ?? null };
  for (const c of COHERENCE_COMPONENTS) out[`coherence.${c}`] = report?.components[c].score ?? null;
  return out;
}

function judgeVector(task: TournamentTask, notes: MusicalNote[]): MetricVector {
  const judgement = judgePart(task, notes);
  const m = judgement.metrics;
  return {
    "partJudge.score": judgement.score,
    "partJudge.playabilityErrors": m.playabilityErrors,
    "partJudge.rangeShare": m.rangeShare,
    "partJudge.registerShare": m.registerShare,
    "partJudge.coverage": m.coverage,
    "partJudge.barRepetitionShare": m.barRepetitionShare,
  };
}

function harmonyVectorForTask(task: TournamentTask, notes: MusicalNote[]): MetricVector {
  const chordTone = task.targetFamily === "drums" ? null : chordToneShare(notes, task.chords);
  const clash = task.targetFamily === "drums" ? null : contextClashShare(notes, task);
  return {
    "benchmarkHarmony.chordToneShare": chordTone,
    "benchmarkHarmony.clashShare": clash,
    "benchmarkHarmony.harmonyScore": chordTone === null ? null : r4(Math.max(0, Math.min(100, 100 * (chordTone - (clash ?? 0))))),
  };
}

/** Every metric on an arrangement anchor with the target part's notes replaced. */
export function measureArrangementTarget(anchor: ArrangementAnchor, task: TournamentTask, targetId: string, notes: MusicalNote[]): MetricVector {
  const tracks = withTargetReplaced(anchor.trackModels, targetId, notes);
  const out: MetricVector = {};
  const critique = critiqueArrangement({ songModel: anchor.songModel, plan: anchor.plan, trackModels: tracks });
  out["musicCritic.overall"] = critique.overallScore;
  for (const d of critique.dimensions) out[`musicCritic.${d.dimension}`] = d.score;

  const harmony = measureCandidateHarmony(tracks, songModelChords(anchor.songModel));
  const mine = harmony.perTrack.find((t) => t.trackId === targetId);
  const chordTone = mine?.chordToneShare ?? null;
  const clash = mine?.clashShare ?? null;
  out["benchmarkHarmony.chordToneShare"] = chordTone;
  out["benchmarkHarmony.clashShare"] = clash;
  out["benchmarkHarmony.harmonyScore"] = chordTone === null ? null : r4(Math.max(0, Math.min(100, 100 * (chordTone - (clash ?? 0)))));

  Object.assign(out, judgeVector(task, notes));
  Object.assign(out, coherenceVector(coherenceOfTracks(tracks, anchor.songModel, anchor.plan)));

  try {
    const report = evaluateCandidateMusicalFit({ songModel: anchor.songModel, plan: anchor.plan, tracks, harmonyDecisions: [] });
    out["candidateQuality.score"] = report.score;
    for (const d of CANDIDATE_QUALITY_DIMENSIONS) {
      const result = report.dimensions[d];
      out[`candidateQuality.${d}`] = result && result.status === "available" ? result.score : null;
    }
  } catch {
    out["candidateQuality.score"] = null;
    for (const d of CANDIDATE_QUALITY_DIMENSIONS) out[`candidateQuality.${d}`] = null;
  }
  return out;
}

/** Every metric that can run on a task anchor (a real part in its real context). */
export function measureTaskTarget(anchor: TaskAnchor, notes: MusicalNote[]): MetricVector {
  const task = anchor.task;
  const out: MetricVector = {};
  Object.assign(out, harmonyVectorForTask(task, notes));
  Object.assign(out, judgeVector(task, notes));
  const barStarts = task.bars.map((b) => b.start);
  const input = formInputFromSecondsTracks(
    [
      ...task.contextTracks.map((t) => ({ id: `ctx-${t.track}`, family: t.family, isPercussion: t.isPercussion, notes: t.notes.filter((n) => n.start < task.window.end && n.start + n.duration > task.window.start) })),
      { id: "target", family: task.targetFamily, isPercussion: task.targetFamily === "drums", notes },
    ],
    barStarts,
    task.window.end,
  );
  let report: CoherenceReport | null = null;
  try {
    report = barStarts.length >= 2 ? measureCoherence(input, { windowBars: 4 }) : null;
  } catch {
    report = null;
  }
  Object.assign(out, coherenceVector(report));
  return out;
}

// ---------------------------------------------------------------------------
// Corrupting one target
// ---------------------------------------------------------------------------

export function corruptionContextForArrangement(anchor: ArrangementAnchor, targetId: string): CorruptionContext | null {
  const target = anchor.trackModels.find((t) => t.id === targetId);
  if (!target) return null;
  const bars = barSpansOf(anchor.songModel);
  if (!bars.length) return null;
  const tempoBpm = anchor.songModel.tempoMap?.[0]?.bpm ?? 120;
  const den = Number((anchor.songModel.meterMap?.[0]?.meter ?? "4/4").split("/")[1]) || 4;
  return {
    targetFamily: remiFamilyForTrack(target),
    target: target.notes.map((n) => ({ ...n })),
    contextTracks: anchor.trackModels.filter((t) => t.id !== targetId && t.notes.length > 0).map((t, i) => trackAsTournamentTrack(t, i)),
    window: { start: bars[0].start, end: bars[bars.length - 1].end },
    bars,
    beatSeconds: (60 / tempoBpm) * (4 / den),
    chords: songModelChords(anchor.songModel),
    key: keyFromSongModel(anchor.songModel),
  };
}

const TICKS_PER_QUARTER = 480;

/** A listening rung on seconds-domain notes: through the tick-domain degradation the V2 sessions use. */
export function applyListeningRung(
  notes: readonly MusicalNote[],
  rung: DegradationRung,
  seed: string,
  tempoBpm: number,
  windowEnd: number,
): { notes: MusicalNote[]; changed: number } {
  const quarterSeconds = 60 / Math.max(1, tempoBpm);
  const toTick = (seconds: number) => Math.round((seconds / quarterSeconds) * TICKS_PER_QUARTER);
  const midi: MidiNote[] = notes.map((n) => ({
    track: 0, channel: 0, program: 0, isPercussion: false,
    pitch: n.pitch, velocity: n.velocity,
    startTick: toTick(n.start), endTick: Math.max(toTick(n.start) + 1, toTick(n.start + n.duration)),
  }));
  const degraded = degradeNotes(midi, rung, seed, { ticksPerQuarter: TICKS_PER_QUARTER, windowEndTick: Math.max(1, toTick(windowEnd)) });
  return {
    changed: degraded.changedNotes,
    notes: degraded.notes.map((n, i) => ({
      id: `${rung.kind}-${i}`,
      start: r4((n.startTick / TICKS_PER_QUARTER) * quarterSeconds),
      duration: r4(Math.max(0.01, ((n.endTick - n.startTick) / TICKS_PER_QUARTER) * quarterSeconds)),
      pitch: n.pitch,
      velocity: n.velocity,
    })),
  };
}

// ---------------------------------------------------------------------------
// The ledger
// ---------------------------------------------------------------------------

export type RungDetection = {
  rung: string;
  strength: number;
  trials: number;
  detected: number;
  detectionRate: number | null;
  ci95: [number, number] | null;
  pOneSidedVsChance: number | null;
  /** Trials the family could not apply to (nothing to damage); not counted. */
  notApplicable: number;
  /** Trials where the metric was null on either side; not counted. */
  unmeasurable: number;
};

export type FamilyVerdict = "gate" | "inform" | "demoted" | "insufficient_data";

export type MetricFamilyRow = {
  metric: string;
  family: string;
  source: ControlSource;
  breaks: string;
  strongestRung: string;
  verdict: FamilyVerdict;
  reason: string;
  rungs: RungDetection[];
  byTier: Record<string, { trials: number; detected: number }>;
};

export type MetricSummary = {
  metric: string;
  group: MetricGroup;
  direction: MetricDirection;
  description: string;
  gate: string[];
  inform: string[];
  demoted: string[];
  insufficient: string[];
  /** The metric detects no family at all — the audit's expected finding for most critic dimensions. */
  detectsNothing: boolean;
};

export type PositiveControlLedger = {
  version: typeof POSITIVE_CONTROL_LEDGER_VERSION;
  ranAt: string;
  gitSha: string | null;
  metricVersions: MetricVersions;
  controlVersions: { symbolicCorruptions: string; listeningDegradations: string };
  rule: typeof LEDGER_RULE & { text: string };
  anchors: Array<{ id: string; kind: LedgerAnchor["kind"]; tier: string; targets: string[] }>;
  families: ControlFamilySpec[];
  metrics: MetricSummary[];
  rows: MetricFamilyRow[];
  lists: {
    gate: Array<{ metric: string; families: string[] }>;
    inform: Array<{ metric: string; families: string[] }>;
    demoted: string[];
    insufficient: string[];
  };
  trials: { total: number; applicable: number; seconds: number };
  honestLimits: string[];
};

type Trial = {
  metric: string;
  family: string;
  rung: string;
  tier: string;
  outcome: "detected" | "missed" | "not_applicable" | "unmeasurable";
};

const worse = (direction: MetricDirection, original: number, corrupted: number): boolean =>
  direction === "higher_better" ? corrupted < original - LEDGER_RULE.epsilon : corrupted > original + LEDGER_RULE.epsilon;

/** Targets of an arrangement anchor: every track with notes (drums included — the unpitched families apply to them). */
export function anchorTargets(anchor: LedgerAnchor): string[] {
  return anchor.kind === "task" ? ["target"] : anchor.trackModels.filter((t) => t.notes.length > 0).map((t) => t.id);
}

export function buildPositiveControlLedger(
  anchors: readonly LedgerAnchor[],
  options: {
    seed?: number;
    gitSha?: string | null;
    now?: Date;
    families?: ControlFamilySpec[];
    onProgress?: (done: number, total: number, anchor: string) => void;
  } = {},
): PositiveControlLedger {
  const started = Date.now();
  const seed = options.seed ?? 7;
  const families = options.families ?? controlFamilies();
  const trials: Trial[] = [];
  const anchorSummary: PositiveControlLedger["anchors"] = [];
  const total = anchors.reduce((n, a) => n + anchorTargets(a).length, 0);
  let done = 0;

  for (const anchor of anchors) {
    const targets = anchorTargets(anchor);
    anchorSummary.push({ id: anchor.id, kind: anchor.kind, tier: anchor.tier, targets });
    for (const targetId of targets) {
      done += 1;
      options.onProgress?.(done, total, `${anchor.id}:${targetId}`);
      let context: CorruptionContext | null;
      let measure: (notes: MusicalNote[]) => MetricVector;
      let original: readonly MusicalNote[];
      let tempoBpm: number;
      if (anchor.kind === "task") {
        context = corruptionContextFromTask(anchor.task);
        measure = (notes) => measureTaskTarget(anchor, notes);
        original = context.target;
        tempoBpm = anchor.task.tempoBpm;
      } else {
        context = corruptionContextForArrangement(anchor, targetId);
        if (!context) continue;
        const task = taskFromArrangement(anchor.songModel, anchor.trackModels, targetId, { workId: anchor.id });
        if (!task) continue;
        measure = (notes) => measureArrangementTarget(anchor, task, targetId, notes);
        original = context.target;
        tempoBpm = anchor.songModel.tempoMap?.[0]?.bpm ?? 120;
      }
      const base = measure([...original]);
      const probes = METRIC_PROBES.filter((p) => p.anchors.includes(anchor.kind));

      const record = (family: ControlFamilySpec, rung: ControlRung, corrupted: MusicalNote[] | null) => {
        if (!corrupted) {
          for (const p of probes) trials.push({ metric: p.id, family: family.id, rung: rung.rung, tier: anchor.tier, outcome: "not_applicable" });
          return;
        }
        const after = measure(corrupted);
        for (const p of probes) {
          const a = base[p.id];
          const b = after[p.id];
          const outcome: Trial["outcome"] = a === null || a === undefined || b === null || b === undefined
            ? "unmeasurable"
            : worse(p.direction, a, b) ? "detected" : "missed";
          trials.push({ metric: p.id, family: family.id, rung: rung.rung, tier: anchor.tier, outcome });
        }
      };

      for (const family of families) {
        for (const rung of family.rungs) {
          if (family.source === "symbolicCorruptions") {
            const result = applyCorruption(context, family.id as CorruptionFamily, rung.strength as CorruptionSeverity, seed);
            record(family, rung, result.applicable ? result.notes : null);
          } else {
            const kind = family.id.replace(/^listening_/, "") as DegradationRung["kind"];
            if (!original.length) { record(family, rung, null); continue; }
            const degraded = applyListeningRung(original, { kind, strength: rung.strength }, `${seed}:${anchor.id}:${targetId}`, tempoBpm, context.window.end);
            record(family, rung, degraded.changed > 0 ? degraded.notes : null);
          }
        }
      }
    }
  }

  // --- aggregate -----------------------------------------------------------
  const rows: MetricFamilyRow[] = [];
  for (const probe of METRIC_PROBES) {
    for (const family of families) {
      const mine = trials.filter((t) => t.metric === probe.id && t.family === family.id);
      if (!mine.length) continue;
      const rungs: RungDetection[] = family.rungs.map((rung) => {
        const at = mine.filter((t) => t.rung === rung.rung);
        const counted = at.filter((t) => t.outcome === "detected" || t.outcome === "missed");
        const detected = counted.filter((t) => t.outcome === "detected").length;
        const n = counted.length;
        return {
          rung: rung.rung,
          strength: rung.strength,
          trials: n,
          detected,
          detectionRate: n ? r4(detected / n) : null,
          ci95: n ? exactBinomialCi(detected, n) : null,
          pOneSidedVsChance: n ? r4(oneSidedPVsChance(detected, n)) : null,
          notApplicable: at.filter((t) => t.outcome === "not_applicable").length,
          unmeasurable: at.filter((t) => t.outcome === "unmeasurable").length,
        };
      });
      const strongest = rungs[rungs.length - 1];
      let verdict: FamilyVerdict;
      let reason: string;
      if (strongest.trials < LEDGER_RULE.minTrials) {
        verdict = "insufficient_data";
        reason = `${strongest.trials} trial(s) at the strongest rung; the rule needs ${LEDGER_RULE.minTrials}`;
      } else if ((strongest.detectionRate ?? 0) >= LEDGER_RULE.gateMinDetection) {
        verdict = "gate";
        reason = `detected ${strongest.detected}/${strongest.trials} at ${strongest.rung} (CI ${strongest.ci95?.join("–")})`;
      } else if ((strongest.pOneSidedVsChance ?? 1) < LEDGER_RULE.informMaxP) {
        verdict = "inform";
        reason = `detected ${strongest.detected}/${strongest.trials} at ${strongest.rung}: above chance (p ${strongest.pOneSidedVsChance}) but below the ${Math.round(LEDGER_RULE.gateMinDetection * 100)} % gate floor`;
      } else {
        verdict = "demoted";
        reason = `detected ${strongest.detected}/${strongest.trials} at ${strongest.rung}: not above chance (p ${strongest.pOneSidedVsChance})`;
      }
      const byTier: MetricFamilyRow["byTier"] = {};
      for (const t of mine.filter((x) => x.rung === strongest.rung && (x.outcome === "detected" || x.outcome === "missed"))) {
        const cell = byTier[t.tier] ?? { trials: 0, detected: 0 };
        cell.trials += 1;
        if (t.outcome === "detected") cell.detected += 1;
        byTier[t.tier] = cell;
      }
      rows.push({ metric: probe.id, family: family.id, source: family.source, breaks: family.breaks, strongestRung: strongest.rung, verdict, reason, rungs, byTier });
    }
  }

  const metrics: MetricSummary[] = METRIC_PROBES.map((probe) => {
    const mine = rows.filter((r) => r.metric === probe.id);
    const of = (v: FamilyVerdict) => mine.filter((r) => r.verdict === v).map((r) => r.family);
    const gate = of("gate");
    const inform = of("inform");
    const demoted = of("demoted");
    const insufficient = of("insufficient_data");
    return {
      metric: probe.id, group: probe.group, direction: probe.direction, description: probe.description,
      gate, inform, demoted, insufficient,
      detectsNothing: gate.length === 0 && inform.length === 0 && demoted.length > 0,
    };
  });

  const applicable = trials.filter((t) => t.outcome === "detected" || t.outcome === "missed").length;
  return {
    version: POSITIVE_CONTROL_LEDGER_VERSION,
    ranAt: (options.now ?? new Date()).toISOString(),
    gitSha: options.gitSha ?? null,
    metricVersions: currentMetricVersions(),
    controlVersions: { symbolicCorruptions: SYMBOLIC_CORRUPTIONS_VERSION, listeningDegradations: LISTENING_CONTROL_VERSION },
    rule: {
      ...LEDGER_RULE,
      text: `a metric may gate a family only if it detects the strongest rung at >= ${Math.round(LEDGER_RULE.gateMinDetection * 100)} % on >= ${LEDGER_RULE.minTrials} trials; it informs where the strongest rung is above chance (one-sided exact p < ${LEDGER_RULE.informMaxP}); otherwise it is demoted for that family. Detected = strictly worse than the original in the metric's own direction.`,
    },
    anchors: anchorSummary,
    families,
    metrics,
    rows,
    lists: {
      gate: metrics.filter((m) => m.gate.length).map((m) => ({ metric: m.metric, families: m.gate })),
      inform: metrics.filter((m) => m.inform.length).map((m) => ({ metric: m.metric, families: m.inform })),
      demoted: metrics.filter((m) => m.detectsNothing).map((m) => m.metric),
      insufficient: metrics.filter((m) => !m.gate.length && !m.inform.length && !m.demoted.length).map((m) => m.metric),
    },
    trials: { total: trials.length, applicable, seconds: Number(((Date.now() - started) / 1000).toFixed(1)) },
    honestLimits: [
      "Detection is a strict inequality on a deterministic metric: a metric that moves in the right direction by any amount counts, so a gate verdict says the metric sees the damage, not that it sizes it.",
      "Arrangement anchors: the judge's anchor-relative metrics (densityLogRatio, intervalDistance) compare the corrupted part to the arrangement's own original and are excluded from the ledger; partJudge.score still contains them and is therefore biased towards detection on arrangement anchors — read its components.",
      "musicCritic and candidateQuality run on arrangement anchors only: they need a Song Model and a plan, which a PDMX task does not carry.",
      "coherence on task anchors is measured on the window's few bars with a 4-bar grid; most components are unmeasurable there and are reported as such.",
      "Synthetic anchors are the pipeline's own output on four-chord specifications; a detection rate there is a property of the metric on easy material.",
      "The families and rungs are the repo's existing corruption library and listening ladder; no corruption was designed to suit a metric and no metric was tuned on this ledger.",
    ],
  };
}

// ---------------------------------------------------------------------------
// Anchors from the repo's own material
// ---------------------------------------------------------------------------

/** The selected candidate of each synthetic benchmark case, as an arrangement anchor. */
export function tierSAnchorsFrom(
  results: ReadonlyArray<{ id: string; songModel: SongModelData; plan: ArrangementPlan; trackModels: TrackModel[] }>,
): ArrangementAnchor[] {
  return results.map((r) => ({ kind: "arrangement", id: r.id, tier: "S", songModel: r.songModel, plan: r.plan, trackModels: r.trackModels }));
}

/** Real PDMX passages as task anchors; percussion targets are kept so the unpitched families have real material. */
export function tierHAnchorsFrom(tasks: readonly TournamentTask[]): TaskAnchor[] {
  return tasks.map((task) => ({ kind: "task", id: task.id, tier: "H", task }));
}

/** Whether a track is one the pitched families can damage. Exported for the CLI's anchor summary. */
export const isPitchedTarget = (track: TrackModel): boolean => !isPercussionTrack(track);
