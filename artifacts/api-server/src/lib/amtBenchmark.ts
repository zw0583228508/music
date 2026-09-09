/**
 * Instrument-aware transcription metrics and the SYNTHETIC_EXACT benchmark
 * (PR-83, Wave ANALYSIS ENGINE — stream C).
 *
 * Why this module exists at all: the 2025 AMT Challenge leaderboard is a
 * number measured on *their* 76 held-out pieces with *their* grader. It ranks
 * systems; it does not tell this platform what a model will do to a user's
 * song. So nothing here reads a published score. Everything here is measured
 * on one fixed audio set, with every model given byte-identical input.
 *
 * Two things this module is deliberately honest about.
 *
 * 1. **The ground truth is exact, the timbre is not real.** The benchmark
 *    renders admitted PDMX scores through `referenceRenderWorker`'s
 *    deterministic synth, so the MIDI *is* the truth — no alignment, no
 *    annotator, no doubt. But `REFERENCE_SYNTH_V1` is band-limited oscillators
 *    and filtered noise, and every model here was trained on sampled or
 *    recorded instruments. That is **out of distribution**, and the brief's
 *    assumption that synthetic audio is "easier" is wrong for transcription:
 *    exact onsets make the *labels* easy and the unfamiliar timbre makes the
 *    *audio* hard. Absolute F1 on this tier is therefore a floor, not an
 *    estimate of production accuracy. What transfers is the **ranking**, and
 *    only because every model hears the identical file.
 *
 * 2. **Instrument-aware means our instrument taxonomy, stated out loud.** A
 *    match needs the same drum flag and the same GM family (`familyOf`), not
 *    the same GM program number: no transcription model is asked to tell
 *    "Acoustic Grand" from "Bright Acoustic", and scoring as if it were would
 *    measure the soundfont, not the model. The program-agnostic score is
 *    reported next to it so the cost of instrument detection is visible rather
 *    than buried — which is the challenge organisers' own stated conclusion
 *    about where the remaining difficulty lives.
 *
 * Matching is maximum bipartite matching, as `mir_eval.transcription` does it,
 * not greedy nearest-onset: greedy over-counts when two references sit inside
 * one tolerance window, and the difference is not small on dense material.
 */
import { createHash } from "node:crypto";
import type { MusicalNote } from "@workspace/db";
import { familyOf } from "./arrangerRemi";
import { parseMidiFile, type MidiNote, type ParsedMidi } from "./midiFile";
import { encodeWavPcm, renderStem } from "./referenceRenderWorker";
import { rendererFamily } from "./tournamentAudio";

/** mir_eval's default, and the tolerance the 2025 AMT Challenge graded on. */
export const ONSET_TOLERANCE_SECONDS = 0.05;
/** mir_eval's default offset rule, and the challenge's: the later of 50 ms or 20 % of the reference duration. */
export const OFFSET_MIN_TOLERANCE_SECONDS = 0.05;
export const OFFSET_RATIO = 0.2;
/** 16 kHz mono is what every model in the sweep resamples to; rendering there removes one resampler from the comparison. */
export const BENCHMARK_SAMPLE_RATE = 16_000;

/**
 * One transcribed or reference note. `program` is General MIDI 0-127 and is
 * ignored when `isDrum`, exactly as GM channel 10 works.
 */
export type AmtNote = {
  onset: number;
  offset: number;
  pitch: number;
  program: number;
  isDrum: boolean;
};

export type AmtMatchMode =
  /** Same family, pitch, onset within tolerance. */
  | "instrument_onset"
  /** As above, plus offset within the mir_eval offset rule. */
  | "instrument_onset_offset"
  /** Pitch and onset only — what the model heard, ignoring what it called it. */
  | "onset";

export type AmtScore = {
  mode: AmtMatchMode;
  precision: number;
  recall: number;
  f1: number;
  matched: number;
  referenceNotes: number;
  estimateNotes: number;
};

const round4 = (value: number): number => Number(value.toFixed(4));

/**
 * A tolerance is a measurement, not an exact real. Without this, `1 + 0.05`
 * lands at 1.0500000000000000444 and a note exactly on the 50 ms boundary is
 * refused for a reason that has nothing to do with transcription. One
 * nanosecond is far below any onset any model can resolve.
 */
const FLOAT_SLACK = 1e-9;

/** The instrument bucket a match is judged in. Drums are one bucket; pitched notes use the GM family. */
export function amtInstrumentClass(note: Pick<AmtNote, "program" | "isDrum">): string {
  return note.isDrum ? "drums" : familyOf({ program: note.program, isPercussion: false });
}

function offsetTolerance(reference: AmtNote): number {
  return Math.max(OFFSET_MIN_TOLERANCE_SECONDS, OFFSET_RATIO * (reference.offset - reference.onset));
}

/** May this estimate stand for this reference under `mode`? */
export function amtNotesMatch(reference: AmtNote, estimate: AmtNote, mode: AmtMatchMode): boolean {
  if (reference.pitch !== estimate.pitch) return false;
  if (Math.abs(reference.onset - estimate.onset) > ONSET_TOLERANCE_SECONDS + FLOAT_SLACK) return false;
  if (mode !== "onset" && amtInstrumentClass(reference) !== amtInstrumentClass(estimate)) return false;
  if (mode === "instrument_onset_offset") {
    // Drum "offsets" are a decoder artefact on both sides — MT3-family models
    // emit a fixed short tail and the reference synth's kick does not sustain.
    // Scoring them would measure two conventions agreeing, not a transcription.
    if (reference.isDrum) return true;
    if (Math.abs(reference.offset - estimate.offset) > offsetTolerance(reference) + FLOAT_SLACK) return false;
  }
  return true;
}

/**
 * Maximum bipartite matching (Kuhn's augmenting path). Each reference is used
 * at most once and each estimate at most once, which is what makes precision
 * and recall comparable across models that emit wildly different note counts.
 */
export function amtMatchNotes(
  reference: readonly AmtNote[],
  estimate: readonly AmtNote[],
  mode: AmtMatchMode,
): number {
  // Candidate edges, bucketed by pitch so the O(n*m) scan does not run over
  // every pair on a 3,000-note file.
  const byPitch = new Map<number, number[]>();
  estimate.forEach((note, index) => {
    const bucket = byPitch.get(note.pitch);
    if (bucket) bucket.push(index);
    else byPitch.set(note.pitch, [index]);
  });
  const edges: number[][] = reference.map((ref) =>
    (byPitch.get(ref.pitch) ?? []).filter((index) => amtNotesMatch(ref, estimate[index], mode)),
  );
  const estimateToReference = new Int32Array(estimate.length).fill(-1);
  let matched = 0;
  const seen = new Uint8Array(estimate.length);
  const augment = (referenceIndex: number): boolean => {
    for (const estimateIndex of edges[referenceIndex]) {
      if (seen[estimateIndex]) continue;
      seen[estimateIndex] = 1;
      const held = estimateToReference[estimateIndex];
      if (held === -1 || augment(held)) {
        estimateToReference[estimateIndex] = referenceIndex;
        return true;
      }
    }
    return false;
  };
  for (let i = 0; i < reference.length; i += 1) {
    seen.fill(0);
    if (augment(i)) matched += 1;
  }
  return matched;
}

export function amtScore(
  reference: readonly AmtNote[],
  estimate: readonly AmtNote[],
  mode: AmtMatchMode,
): AmtScore {
  const matched = amtMatchNotes(reference, estimate, mode);
  const precision = estimate.length === 0 ? 0 : matched / estimate.length;
  const recall = reference.length === 0 ? 0 : matched / reference.length;
  const f1 = precision + recall === 0 ? 0 : (2 * precision * recall) / (precision + recall);
  return {
    mode,
    precision: round4(precision),
    recall: round4(recall),
    f1: round4(f1),
    matched,
    referenceNotes: reference.length,
    estimateNotes: estimate.length,
  };
}

export type AmtPerInstrumentScore = AmtScore & { instrumentClass: string };

/**
 * Per-instrument-class F1. A class the reference does not contain is still
 * reported when the model invented notes in it, because a model that hears a
 * horn section in a piano score is failing in a way a mean F1 hides.
 */
export function amtScoreByInstrument(
  reference: readonly AmtNote[],
  estimate: readonly AmtNote[],
  mode: Exclude<AmtMatchMode, "onset"> = "instrument_onset",
): AmtPerInstrumentScore[] {
  const classes = new Set<string>();
  for (const note of reference) classes.add(amtInstrumentClass(note));
  for (const note of estimate) classes.add(amtInstrumentClass(note));
  return [...classes].sort().map((instrumentClass) => ({
    instrumentClass,
    ...amtScore(
      reference.filter((n) => amtInstrumentClass(n) === instrumentClass),
      estimate.filter((n) => amtInstrumentClass(n) === instrumentClass),
      mode,
    ),
  }));
}

// ---------------------------------------------------------------------------
// The benchmark set: admitted PDMX scores rendered to audio, MIDI kept as truth
// ---------------------------------------------------------------------------

/** Absolute seconds for every tick boundary, honouring every tempo change. */
export function tickToSecondsMapper(midi: ParsedMidi): (tick: number) => number {
  const tempos = [...midi.tempos].sort((a, b) => a.tick - b.tick);
  if (tempos.length === 0 || tempos[0].tick > 0) {
    tempos.unshift({ tick: 0, usPerQuarter: 500_000, bpm: 120 });
  }
  // Cumulative seconds at each tempo change, so a lookup is a binary search
  // rather than a walk. A score with a tempo ramp every bar is not rare.
  const secondsAt: number[] = [0];
  for (let i = 1; i < tempos.length; i += 1) {
    const span = tempos[i].tick - tempos[i - 1].tick;
    secondsAt.push(secondsAt[i - 1] + (span * tempos[i - 1].usPerQuarter) / (midi.ticksPerQuarter * 1e6));
  }
  return (tick: number): number => {
    let low = 0;
    let high = tempos.length - 1;
    while (low < high) {
      const mid = Math.ceil((low + high) / 2);
      if (tempos[mid].tick <= tick) low = mid;
      else high = mid - 1;
    }
    return secondsAt[low] + ((tick - tempos[low].tick) * tempos[low].usPerQuarter) / (midi.ticksPerQuarter * 1e6);
  };
}

export type BenchmarkClipOptions = {
  /** Hard cap on clip length. GPU minutes are the budget; 30 s of every work beats 30 works of 1 s. */
  maxSeconds?: number;
  sampleRate?: number;
};

export type BenchmarkClip = {
  /** Ground truth: the notes that were actually rendered, in the clip's own time base. */
  reference: AmtNote[];
  wav: Buffer;
  wavSha256: string;
  durationSeconds: number;
  sampleRate: number;
  instrumentClasses: string[];
  /** Distinct (program, isDrum) voices that were rendered. */
  voices: number;
};

const noteFamilyForRender = (note: MidiNote): string => rendererFamily(note.program, note.isPercussion);

/**
 * One benchmark clip from one Standard MIDI File.
 *
 * The reference notes are taken from the *same* array that is handed to the
 * synth, after the same truncation — so the truth cannot drift from the audio.
 * A note that starts inside the window and runs past it is kept and its offset
 * clamped, because the model will hear its attack and should be credited for
 * it; a note that starts after the window is dropped entirely.
 */
export function buildBenchmarkClip(midiBytes: Buffer, options: BenchmarkClipOptions = {}): BenchmarkClip {
  const sampleRate = options.sampleRate ?? BENCHMARK_SAMPLE_RATE;
  const maxSeconds = options.maxSeconds ?? 30;
  const midi = parseMidiFile(midiBytes);
  const at = tickToSecondsMapper(midi);

  const kept = midi.notes
    .map((note) => ({ note, onset: at(note.startTick), offset: at(note.endTick) }))
    .filter((entry) => entry.onset < maxSeconds && entry.offset > entry.onset)
    .sort((a, b) => a.onset - b.onset || a.note.pitch - b.note.pitch);
  if (kept.length === 0) throw new Error("no notes fall inside the benchmark window");

  const reference: AmtNote[] = kept.map(({ note, onset, offset }) => ({
    onset: Number(onset.toFixed(6)),
    offset: Number(Math.min(offset, maxSeconds).toFixed(6)),
    pitch: note.pitch,
    program: note.isPercussion ? 0 : note.program,
    isDrum: note.isPercussion,
  }));

  const durationSeconds = Number(
    Math.min(maxSeconds, Math.max(...reference.map((n) => n.offset)) + 0.4).toFixed(3),
  );
  const length = Math.ceil(durationSeconds * sampleRate);
  const mix = new Float32Array(length);

  // One stem per (renderer family, drum flag) so the synth voices each part
  // the way the score asks. Unlike `renderTournamentSide` there is no
  // candidate gain: nothing in this file is under judgement, so nothing is
  // mixed forward.
  const groups = new Map<string, MusicalNote[]>();
  kept.forEach(({ note, onset, offset }, index) => {
    const key = noteFamilyForRender(note);
    const bucket = groups.get(key) ?? [];
    bucket.push({
      id: `${key}:${index}`,
      start: onset,
      duration: Math.max(0.02, Math.min(offset, maxSeconds) - onset),
      pitch: note.pitch,
      velocity: note.velocity || 80,
    });
    groups.set(key, bucket);
  });
  for (const [family, notes] of groups) {
    const { samples } = renderStem(
      { id: family, instrument: family, role: "benchmark", notes },
      { sampleRate, bitDepth: 16, durationSeconds },
    );
    for (let i = 0; i < length && i < samples.length; i += 1) mix[i] += samples[i];
  }
  let peak = 0;
  for (let i = 0; i < length; i += 1) peak = Math.max(peak, Math.abs(mix[i]));
  if (peak > 0) {
    const norm = 0.89 / peak;
    for (let i = 0; i < length; i += 1) mix[i] *= norm;
  }
  const wav = encodeWavPcm(mix, sampleRate, 16);
  const voices = new Set(reference.map((n) => `${n.isDrum ? "d" : n.program}`)).size;
  return {
    reference,
    wav,
    wavSha256: createHash("sha256").update(wav).digest("hex"),
    durationSeconds,
    sampleRate,
    instrumentClasses: [...new Set(reference.map(amtInstrumentClass))].sort(),
    voices,
  };
}

// ---------------------------------------------------------------------------
// Rolling a per-model result up over the whole set
// ---------------------------------------------------------------------------

export type AmtClipResult = {
  clipId: string;
  genreFamily: string;
  reference: readonly AmtNote[];
  estimate: readonly AmtNote[];
};

export type AmtModelSummary = {
  model: string;
  clips: number;
  /** Note-weighted over the whole set: one long clip should count more than one short one. */
  micro: Record<AmtMatchMode, AmtScore>;
  /** Mean of the per-clip F1s, which is what a per-song user experience feels like. */
  macroF1: Record<AmtMatchMode, number>;
  perInstrument: AmtPerInstrumentScore[];
  perGenre: Array<{ genreFamily: string; clips: number } & AmtScore>;
  perClip: Array<{ clipId: string; genreFamily: string } & Record<"onsetF1" | "onsetOffsetF1" | "pitchOnlyF1", number>>;
};

const MODES: AmtMatchMode[] = ["instrument_onset", "instrument_onset_offset", "onset"];

/**
 * Roll per-clip transcriptions into the table the sweep reports.
 *
 * Micro scores pool the notes across clips before dividing, so precision and
 * recall stay real counts. Macro is the mean of per-clip F1. Both are given
 * because they disagree whenever a model is good at long dense clips and bad
 * at short sparse ones, and a single number would let that hide.
 */
export function summariseAmtModel(model: string, results: readonly AmtClipResult[]): AmtModelSummary {
  const allReference = results.flatMap((r) => [...r.reference]);
  const allEstimate = results.flatMap((r) => [...r.estimate]);
  const micro = {} as Record<AmtMatchMode, AmtScore>;
  const macroF1 = {} as Record<AmtMatchMode, number>;
  for (const mode of MODES) {
    // Pooling notes across clips would let a clip-1 estimate match a clip-2
    // reference at the same pitch and onset. Sum the per-clip matches instead.
    let matched = 0;
    let perClipF1 = 0;
    for (const result of results) {
      const score = amtScore(result.reference, result.estimate, mode);
      matched += score.matched;
      perClipF1 += score.f1;
    }
    const precision = allEstimate.length === 0 ? 0 : matched / allEstimate.length;
    const recall = allReference.length === 0 ? 0 : matched / allReference.length;
    micro[mode] = {
      mode,
      precision: round4(precision),
      recall: round4(recall),
      f1: round4(precision + recall === 0 ? 0 : (2 * precision * recall) / (precision + recall)),
      matched,
      referenceNotes: allReference.length,
      estimateNotes: allEstimate.length,
    };
    macroF1[mode] = round4(results.length === 0 ? 0 : perClipF1 / results.length);
  }

  const instrumentClasses = new Set<string>();
  for (const note of [...allReference, ...allEstimate]) instrumentClasses.add(amtInstrumentClass(note));
  const perInstrument: AmtPerInstrumentScore[] = [...instrumentClasses].sort().map((instrumentClass) => {
    let matched = 0;
    let referenceNotes = 0;
    let estimateNotes = 0;
    for (const result of results) {
      const reference = result.reference.filter((n) => amtInstrumentClass(n) === instrumentClass);
      const estimate = result.estimate.filter((n) => amtInstrumentClass(n) === instrumentClass);
      matched += amtMatchNotes(reference, estimate, "instrument_onset");
      referenceNotes += reference.length;
      estimateNotes += estimate.length;
    }
    const precision = estimateNotes === 0 ? 0 : matched / estimateNotes;
    const recall = referenceNotes === 0 ? 0 : matched / referenceNotes;
    return {
      instrumentClass,
      mode: "instrument_onset" as const,
      precision: round4(precision),
      recall: round4(recall),
      f1: round4(precision + recall === 0 ? 0 : (2 * precision * recall) / (precision + recall)),
      matched,
      referenceNotes,
      estimateNotes,
    };
  });

  const genres = [...new Set(results.map((r) => r.genreFamily))].sort();
  const perGenre = genres.map((genreFamily) => {
    const inGenre = results.filter((r) => r.genreFamily === genreFamily);
    let matched = 0;
    let referenceNotes = 0;
    let estimateNotes = 0;
    for (const result of inGenre) {
      matched += amtMatchNotes(result.reference, result.estimate, "instrument_onset");
      referenceNotes += result.reference.length;
      estimateNotes += result.estimate.length;
    }
    const precision = estimateNotes === 0 ? 0 : matched / estimateNotes;
    const recall = referenceNotes === 0 ? 0 : matched / referenceNotes;
    return {
      genreFamily,
      clips: inGenre.length,
      mode: "instrument_onset" as const,
      precision: round4(precision),
      recall: round4(recall),
      f1: round4(precision + recall === 0 ? 0 : (2 * precision * recall) / (precision + recall)),
      matched,
      referenceNotes,
      estimateNotes,
    };
  });

  return {
    model,
    clips: results.length,
    micro,
    macroF1,
    perInstrument,
    perGenre,
    perClip: results.map((result) => ({
      clipId: result.clipId,
      genreFamily: result.genreFamily,
      onsetF1: amtScore(result.reference, result.estimate, "instrument_onset").f1,
      onsetOffsetF1: amtScore(result.reference, result.estimate, "instrument_onset_offset").f1,
      pitchOnlyF1: amtScore(result.reference, result.estimate, "onset").f1,
    })),
  };
}

/**
 * The one sentence a promotion decision is allowed to rest on.
 *
 * A challenger is only "better" here if it beats the incumbent on the
 * instrument-aware onset F1 **and** does not do it by flooding the output with
 * notes — a model can buy recall with precision indefinitely, and a producer
 * has to delete every false note by hand.
 */
export function amtVerdict(
  incumbent: AmtModelSummary,
  challenger: AmtModelSummary,
  options: { minimumF1Gain?: number; maximumPrecisionLoss?: number } = {},
): { verdict: "better" | "not_better"; reasons: string[] } {
  const minimumF1Gain = options.minimumF1Gain ?? 0.02;
  const maximumPrecisionLoss = options.maximumPrecisionLoss ?? 0.05;
  const failures: string[] = [];
  const gain = challenger.micro.instrument_onset.f1 - incumbent.micro.instrument_onset.f1;
  const precisionDelta = challenger.micro.instrument_onset.precision - incumbent.micro.instrument_onset.precision;
  if (gain < minimumF1Gain) {
    failures.push(
      `instrument-aware onset F1 gain ${gain.toFixed(4)} is below the ${minimumF1Gain} bar (${incumbent.model} ${incumbent.micro.instrument_onset.f1} → ${challenger.model} ${challenger.micro.instrument_onset.f1})`,
    );
  }
  if (precisionDelta < -maximumPrecisionLoss) {
    failures.push(
      `precision falls ${(-precisionDelta).toFixed(4)}, past the ${maximumPrecisionLoss} bar — recall bought with false notes a producer has to delete`,
    );
  }
  if (failures.length > 0) return { verdict: "not_better", reasons: failures };
  return {
    verdict: "better",
    reasons: [
      `instrument-aware onset F1 ${incumbent.micro.instrument_onset.f1} → ${challenger.micro.instrument_onset.f1} (+${gain.toFixed(4)}) with precision ${precisionDelta >= 0 ? "+" : ""}${precisionDelta.toFixed(4)}`,
    ],
  };
}
