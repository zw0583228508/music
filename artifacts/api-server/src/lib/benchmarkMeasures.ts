/**
 * Candidate-dependent benchmark measures (Brain B-08, audit §7.1).
 *
 * PR-18's benchmark reported three numbers that never looked at the notes it
 * was supposed to judge: `harmonyScore` was the critic's `harmony` dimension,
 * which grades the Song Model's own chords against its own melody (58.33 for
 * every composer ever measured); `sectionConsistency` counted the planner's
 * novelty values (100 on every run); `candidateDiversity` was a note-count
 * spread (50.4 on every run). This module holds the replacements, computed on
 * the **performed, repaired notes the selected candidate actually ships**:
 *
 *  - `measureCandidateHarmony` — duration-weighted chord-tone share of the
 *    pitched tracks against the Song Model chords, and the share of sounding
 *    time a semitone from another sounding part. Both reuse the tournament
 *    judge's functions (`partJudge.chordToneShare`, `contextClashShare`) so
 *    the benchmark and the judge cannot drift apart.
 *  - `coherenceOfTracks` — the whole-song coherence metric on the candidate's
 *    tracks, with the plan's section targets, so `trajectorySmoothness`,
 *    `seamArtefacts` and `motifRecurrence` replace the constant metrics.
 *  - `meanCandidateDistance` — the production diversity gate's own distance,
 *    averaged over candidate pairs, instead of a note-count spread.
 *  - `taskFromArrangement` — a tournament-shaped task around one track of an
 *    arrangement, so `judgePart` and the corruption library (built for the
 *    tournament's task shape) can run on orchestrator output. Shared with
 *    the positive-control ledger.
 *
 * Pure. Every function here is a measurement of what was written, never of
 * the plan or the source recording.
 */
import type { ArrangementPlan, MusicalNote, SongModelData, TrackModel } from "@workspace/db";
import { familyOf } from "./arrangerRemi";
import { AUDIO_CRITIC_VERSION } from "./audioCritic";
import { candidateDistance, fingerprintCandidate } from "./candidateDiversity";
import { chordCoverage, type BarSpan, type ChordQuality, type EstimatedChord } from "./chordsFromNotes";
import { COHERENCE_METRIC_VERSION, measureCoherence, type CoherenceReport, type SectionPlanTarget } from "./coherenceMetric";
import { formInputFromSecondsTracks } from "./formSegmentation";
import { MUSIC_CRITIC_VERSION } from "./musicCritic";
import { PART_JUDGE_VERSION, chordToneShare, contextClashShare } from "./partJudge";
import { TOURNAMENT_TASK_VERSION, type TournamentTask, type TournamentTrack } from "./tournamentTask";

export const BENCHMARK_MEASURES_VERSION = "1.0" as const;

/**
 * The metric versions a benchmark run or a control ledger is pinned to. A
 * change to any of them invalidates a comparison (audit §7.3): the numbers
 * would then measure the metric's change, not the music's.
 */
export type MetricVersions = {
  musicCritic: string;
  audioCritic: string;
  partJudge: string;
  coherenceMetric: string;
  benchmarkMeasures: string;
};

export function currentMetricVersions(): MetricVersions {
  return {
    musicCritic: MUSIC_CRITIC_VERSION,
    audioCritic: AUDIO_CRITIC_VERSION,
    partJudge: PART_JUDGE_VERSION,
    coherenceMetric: COHERENCE_METRIC_VERSION,
    benchmarkMeasures: BENCHMARK_MEASURES_VERSION,
  };
}

/** The versions that differ between two pins, as "name: a → b" lines. Empty when comparable. */
export function metricVersionMismatch(a: MetricVersions, b: MetricVersions): string[] {
  const names = new Set([...Object.keys(a), ...Object.keys(b)]) as Set<keyof MetricVersions>;
  const out: string[] = [];
  for (const name of [...names].sort()) {
    if (a[name] !== b[name]) out.push(`${name}: ${a[name] ?? "absent"} -> ${b[name] ?? "absent"}`);
  }
  return out;
}

// ---------------------------------------------------------------------------
// Track classification
// ---------------------------------------------------------------------------

const PERCUSSION_NAME = /drum|perc|kit/i;
const PITCHED_NAME = /keys|piano|bass|guitar|string|brass|synth|pad|ensemble|wind|organ|voice|lead/i;

/**
 * Whether a track is unpitched. The instrument *name* decides before the
 * definition's family: `getInstrumentDefinition` resolves a keys part in a
 * RHYTHMIC_HARMONY role to the drum kit (the role word "rhythm" matches the
 * kit), and a harmony measure that trusted that would silently drop the piano.
 */
export function isPercussionTrack(track: Pick<TrackModel, "instrument" | "instrumentDefinition">): boolean {
  if (PERCUSSION_NAME.test(track.instrument)) return true;
  if (PITCHED_NAME.test(track.instrument)) return false;
  return track.instrumentDefinition?.family === "drums";
}

/** A representative GM program for a platform track, so the judge's GM tables apply. */
export function gmProgramForTrack(track: Pick<TrackModel, "instrument" | "instrumentDefinition">): number {
  if (isPercussionTrack(track)) return 128;
  const name = track.instrument.toLowerCase();
  if (/bass/.test(name)) return 33;
  if (/guitar/.test(name)) return 25;
  if (/string/.test(name)) return 48;
  if (/ensemble|choir|voice/.test(name)) return 52;
  if (/brass|horn|trumpet|trombone/.test(name)) return 61;
  if (/wind|flute|reed|sax|clarinet|oboe/.test(name)) return 73;
  if (/organ/.test(name)) return 19;
  if (/pad/.test(name)) return 88;
  if (/synth|lead/.test(name)) return 81;
  return 0;
}

/** The ARRANGER_REMI family the tournament judge and the corruption library reason in. */
export function remiFamilyForTrack(track: Pick<TrackModel, "instrument" | "instrumentDefinition">): string {
  const program = gmProgramForTrack(track);
  return program === 128 ? "drums" : familyOf({ program, isPercussion: false });
}

// ---------------------------------------------------------------------------
// Song Model chords in the judge's shape
// ---------------------------------------------------------------------------

/** The judge spells roots as C, C#, D, Eb, E, F, F#, G, Ab, A, Bb, B. */
const ROOT_SPELLING: Record<string, string> = {
  C: "C", "B#": "C", "C#": "C#", DB: "C#", D: "D", "D#": "Eb", EB: "Eb", E: "E", FB: "E", F: "F", "E#": "F",
  "F#": "F#", GB: "F#", G: "G", "G#": "Ab", AB: "Ab", A: "A", "A#": "Bb", BB: "Bb", B: "B", CB: "B",
};

const QUALITIES: readonly ChordQuality[] = ["maj", "min", "7", "maj7", "min7", "dim", "sus4", "sus2"];

function qualityOf(chord: { symbol: string; quality?: string }): ChordQuality {
  const declared = (chord.quality ?? "").toLowerCase();
  if ((QUALITIES as readonly string[]).includes(declared)) return declared as ChordQuality;
  if (declared === "m" || declared === "minor") return "min";
  if (declared === "major") return "maj";
  if (declared === "m7" || declared === "min7") return "min7";
  if (declared === "dom7") return "7";
  const suffix = chord.symbol.replace(/^[A-G](#|b)?/, "").replace(/\/.*$/, "");
  if (/^maj7/.test(suffix)) return "maj7";
  if (/^m7|^min7|^-7/.test(suffix)) return "min7";
  if (/^dim|^°|^o/.test(suffix)) return "dim";
  if (/^sus4/.test(suffix)) return "sus4";
  if (/^sus2/.test(suffix)) return "sus2";
  if (/^7|^9|^13/.test(suffix)) return "7";
  if (/^m(?!aj)|^min|^-/.test(suffix)) return "min";
  return "maj";
}

function rootOf(chord: { symbol: string; root?: string }): string {
  const raw = (chord.root ?? /^[A-G](#|b)?/.exec(chord.symbol)?.[0] ?? "C").trim();
  const key = raw.length > 1 ? raw[0].toUpperCase() + raw.slice(1).toUpperCase() : raw.toUpperCase();
  return ROOT_SPELLING[key] ?? ROOT_SPELLING[raw[0]?.toUpperCase() ?? "C"] ?? "C";
}

/** The Song Model's chord events as the judge's `EstimatedChord`. Read, not estimated: confidence is the model's own. */
export function songModelChords(songModel: Pick<SongModelData, "chords" | "bars">): EstimatedChord[] {
  const bars = songModel.bars ?? [];
  return (songModel.chords ?? [])
    .filter((chord) => chord.end > chord.start)
    .map((chord) => {
      const bar = bars.find((b) => chord.start >= b.start - 1e-6 && chord.start < b.end - 1e-6);
      const root = rootOf(chord);
      const quality = qualityOf(chord);
      return {
        bar: bar?.bar ?? 0,
        start: chord.start,
        end: chord.end,
        symbol: chord.symbol,
        root,
        quality,
        confidence: Math.max(0, Math.min(1, chord.confidence ?? 0)),
        pitchClassWeights: [],
        runnerUp: null,
      };
    });
}

/** One span per Song Model bar, in the judge's `BarSpan` shape. */
export function barSpansOf(songModel: Pick<SongModelData, "bars">): BarSpan[] {
  return (songModel.bars ?? []).map((bar) => ({ bar: bar.bar, start: bar.start, end: bar.end }));
}

// ---------------------------------------------------------------------------
// Harmony on the candidate
// ---------------------------------------------------------------------------

export type HarmonyMeasure = {
  /** Duration-weighted share of pitched sounding time on a chord tone of the Song Model chords. */
  chordToneShare: number | null;
  /** Duration-weighted share of pitched sounding time a semitone from another sounding pitched part. */
  clashShare: number | null;
  /** 0..100: `100 × (chordToneShare − clashShare)`, clamped. Higher is better; stated so it can be argued with. */
  harmonyScore: number | null;
  tracksMeasured: number;
  perTrack: Array<{ trackId: string; chordToneShare: number | null; clashShare: number | null; soundingSeconds: number }>;
};

const r4 = (v: number) => Number(v.toFixed(4));
const r2 = (v: number) => Number(v.toFixed(2));
const sounding = (notes: readonly MusicalNote[]) => notes.reduce((s, n) => s + Math.max(0, n.duration), 0);

/** The minimal task the judge's clash function reads: the other pitched parts and the window. */
function clashTaskFor(context: TournamentTrack[], window: { start: number; end: number }): TournamentTask {
  // `contextClashShare` reads only `contextTracks` and `window`; the rest of
  // the task shape is filled honestly empty rather than invented.
  return {
    version: TOURNAMENT_TASK_VERSION, id: "clash", workId: "clash", targetInst: 0, targetFamily: "keys", targetTrack: -1,
    barStart: 0, barEnd: 0, tempoBpm: 120, meter: { numerator: 4, denominator: 4 }, beatSeconds: 0.5, barSeconds: 2,
    window, bars: [], contextTracks: context, humanTarget: [], chords: [],
    chordCoverage: { barsWithChord: 0, bars: 0, share: 0, meanConfidence: 0 }, limits: [],
  };
}

export function trackAsTournamentTrack(track: TrackModel, index: number): TournamentTrack {
  const percussion = isPercussionTrack(track);
  return {
    track: index,
    program: gmProgramForTrack(track),
    family: remiFamilyForTrack(track),
    isPercussion: percussion,
    notes: track.notes.map((n) => ({ ...n })),
  };
}

/**
 * Harmony of the arrangement as written: every pitched track against the
 * Song Model chords, and against the other pitched tracks. Drums are not
 * harmony and are excluded; a candidate with no pitched track measures null.
 */
export function measureCandidateHarmony(
  trackModels: readonly TrackModel[],
  chords: readonly EstimatedChord[],
): HarmonyMeasure {
  const pitched = trackModels.filter((t) => !isPercussionTrack(t) && t.notes.length > 0);
  const end = Math.max(0, ...trackModels.flatMap((t) => t.notes.map((n) => n.start + n.duration)), ...chords.map((c) => c.end));
  const window = { start: 0, end };
  const perTrack = pitched.map((track) => {
    const others = pitched
      .filter((t) => t !== track)
      .map((t, i) => trackAsTournamentTrack(t, i));
    return {
      trackId: track.id,
      chordToneShare: chordToneShare(track.notes, chords),
      clashShare: others.length ? contextClashShare(track.notes, clashTaskFor(others, window)) : null,
      soundingSeconds: r4(sounding(track.notes)),
    };
  });
  const weighted = (pick: (t: HarmonyMeasure["perTrack"][number]) => number | null): number | null => {
    let sum = 0;
    let weight = 0;
    for (const t of perTrack) {
      const v = pick(t);
      if (v === null || t.soundingSeconds <= 0) continue;
      sum += v * t.soundingSeconds;
      weight += t.soundingSeconds;
    }
    return weight > 0 ? r4(sum / weight) : null;
  };
  const chordTone = weighted((t) => t.chordToneShare);
  const clash = weighted((t) => t.clashShare);
  const harmonyScore = chordTone === null
    ? null
    : r2(Math.max(0, Math.min(100, 100 * (chordTone - (clash ?? 0)))));
  return { chordToneShare: chordTone, clashShare: clash, harmonyScore, tracksMeasured: pitched.length, perTrack };
}

// ---------------------------------------------------------------------------
// Coherence on the candidate
// ---------------------------------------------------------------------------

/** The plan's section targets as the coherence metric's 0-based, end-exclusive spans. */
export function planTargetsOf(plan: Pick<ArrangementPlan, "globalPlan"> | null | undefined): SectionPlanTarget[] | undefined {
  const targets = plan?.globalPlan?.sectionTargets;
  if (!targets?.length) return undefined;
  return targets.map((t) => ({ startBar: Math.max(0, t.startBar - 1), endBar: Math.max(t.startBar, t.endBar), density: t.density }));
}

/**
 * The whole-song coherence metric on an arrangement's tracks. Returns null
 * when the Song Model has no bar grid — the metric's unit is the bar and a
 * grid invented here would be a measurement of the invention.
 */
export function coherenceOfTracks(
  trackModels: readonly TrackModel[],
  songModel: Pick<SongModelData, "bars">,
  plan?: Pick<ArrangementPlan, "globalPlan"> | null,
  options: { windowBars?: number } = {},
): CoherenceReport | null {
  const bars = songModel.bars ?? [];
  if (bars.length < 2) return null;
  const barStarts = bars.map((b) => b.start);
  const end = bars[bars.length - 1].end;
  const input = formInputFromSecondsTracks(
    trackModels
      .filter((t) => t.notes.length > 0)
      .map((t) => ({ id: t.id, family: remiFamilyForTrack(t), isPercussion: isPercussionTrack(t), notes: t.notes })),
    barStarts,
    end,
  );
  if (!input.tracks.length) return null;
  return measureCoherence(input, { windowBars: options.windowBars ?? 8, plan: planTargetsOf(plan) });
}

// ---------------------------------------------------------------------------
// Diversity on the candidates
// ---------------------------------------------------------------------------

/**
 * Mean pairwise distance between the candidates' fingerprints — the very
 * distance the production diversity gate applies (`candidateDiversity.ts`),
 * so the benchmark reports the gate's own view. On orchestrator output the
 * plan's legacy `sections` are empty, so the plan-level components of the
 * fingerprint are identical across candidates and only the note-level
 * components (harmony sequence, role/instrument set, note shape) can move;
 * that is a fact about the gate, reported here rather than repaired.
 */
export function meanCandidateDistance(
  plan: ArrangementPlan,
  candidates: ReadonlyArray<{ trackModels: TrackModel[] }>,
): number | null {
  if (candidates.length < 2) return null;
  const prints = candidates.map((c) => fingerprintCandidate(plan, c.trackModels));
  let sum = 0;
  let pairs = 0;
  for (let i = 0; i < prints.length; i += 1) {
    for (let j = i + 1; j < prints.length; j += 1) {
      sum += candidateDistance(prints[i], prints[j]);
      pairs += 1;
    }
  }
  return pairs ? r4(sum / pairs) : null;
}

// ---------------------------------------------------------------------------
// A tournament task around one track of an arrangement
// ---------------------------------------------------------------------------

/**
 * The tournament task shape around one track: the other tracks are the
 * context, the Song Model chords are the shared harmony, the track's own
 * notes are the anchor (`humanTarget`). This lets `judgePart`, the corruption
 * library and the listening degradations — all written for the tournament's
 * one-part-in-context shape — run on an orchestrator arrangement.
 *
 * `humanTarget` is the arrangement's own part, not a human's: the judge's
 * anchor-relative metrics (`densityLogRatio`, `intervalDistance`) therefore
 * compare a candidate to *this* part and must not be read as a human anchor.
 */
export function taskFromArrangement(
  songModel: SongModelData,
  trackModels: readonly TrackModel[],
  targetTrackId: string,
  options: { workId?: string } = {},
): TournamentTask | null {
  const targetIndex = trackModels.findIndex((t) => t.id === targetTrackId);
  if (targetIndex < 0) return null;
  const target = trackModels[targetIndex];
  const bars = barSpansOf(songModel);
  if (!bars.length) return null;
  const tempoBpm = songModel.tempoMap?.[0]?.bpm ?? 120;
  const meterText = songModel.meterMap?.[0]?.meter ?? "4/4";
  const [num, den] = meterText.split("/").map((v) => Number(v) || 4);
  const beatSeconds = (60 / tempoBpm) * (4 / den);
  const window = { start: bars[0].start, end: bars[bars.length - 1].end };
  const contextTracks = trackModels
    .map((t, i) => ({ t, i }))
    .filter(({ t }) => t.id !== targetTrackId && t.notes.length > 0)
    .map(({ t, i }) => trackAsTournamentTrack(t, i));
  const chords = songModelChords(songModel);
  return {
    version: TOURNAMENT_TASK_VERSION,
    id: `${options.workId ?? "arrangement"}:${target.id}`,
    workId: options.workId ?? "arrangement",
    targetInst: gmProgramForTrack(target),
    targetFamily: remiFamilyForTrack(target),
    targetTrack: targetIndex,
    barStart: 0,
    barEnd: bars.length,
    tempoBpm,
    meter: { numerator: num, denominator: den },
    beatSeconds: Number(beatSeconds.toFixed(6)),
    barSeconds: Number((beatSeconds * num).toFixed(6)),
    window,
    bars,
    contextTracks,
    humanTarget: target.notes.map((n) => ({ ...n })),
    chords,
    chordCoverage: chordCoverage(chords, bars),
    limits: ["humanTarget is the arrangement's own part, not a human's; anchor-relative judge metrics compare the candidate to itself"],
  };
}
