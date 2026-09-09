/**
 * Part judge (Wave Q — Model Discovery, items 14 and 25).
 *
 * Scores **one written part against one tournament task**, identically for
 * every provider. It reads only what the task gave every provider — the
 * context tracks, the shared estimated chords, the instrument's constraints —
 * plus the human's part as an anchor for *density* and *interval shape*, never
 * as an answer key.
 *
 * What it measures, and why each is a proxy and not a listener:
 *
 *  - playabilityErrors      the platform's physical constraint engine (real).
 *  - rangeShare             notes inside the instrument's playable range (the
 *                           extreme of anything under the GM program).
 *  - registerShare          notes inside the idiomatic register (the named
 *                           instrument's standard range) — softer than range.
 *  - chordToneShare         time on chord tones of the shared chords. A
 *                           passing tone is not a mistake, so this is scored
 *                           around 0.6, not 1.0.
 *  - coverage               bars in which the part plays. Silence fails a
 *                           "write this part" task.
 *  - densityLogRatio        log2 of onsets-per-bar vs the human's. Far above
 *                           or below what a human wrote here is suspect.
 *  - barRepetitionShare     bars identical to the previous bar. Repetition is
 *                           idiomatic in moderation and a collapse beyond it.
 *  - intervalDistance       L1 distance between melodic-interval histograms,
 *                           candidate vs human — shape, not notes.
 *  - contextClashShare      candidate time spent a semitone from a sounding
 *                           context note (the one dissonance almost no style
 *                           sustains by accident).
 *  - singlePitch            the repetition collapse CA2 showed once in four.
 *
 * `score` combines these with weights stated in `WEIGHTS`. It is the
 * tournament's automated pre-filter; **the blind listening comparison decides**
 * (`buildTournamentBlindSheet`). If the human part ever scores below a
 * machine here, distrust the judge before trusting the machine — the runner
 * reports that case as `judgeSuspect`.
 */
import type { MusicalNote } from "@workspace/db";
import { checkInstrumentConstraints, type ConstraintNote, type ConstraintViolation } from "./musicalConstraints";
import { getInstrumentDefinition } from "./musicEngines";
import { GM_REFERENCE, gmReference } from "./instrumentReference";
import type { EstimatedChord } from "./chordsFromNotes";
import type { TournamentTask } from "./tournamentTask";

/**
 * 1.1 (PR-61, judge calibration on 30,570 human PDMX windows): range is the
 * extreme of anything exported under the GM program, not one instrument's
 * textbook range; the idiomatic register is a separate, softer metric; the
 * engine is told the program's polyphony and leap ceilings; drums have no
 * pitch range. See docs/model-discovery/judge-calibration.md.
 */
export const PART_JUDGE_VERSION = "1.1" as const;

/** ARRANGER_REMI family → the platform instrument the judge and the composers use for it. */
export const PLATFORM_INSTRUMENT: Record<string, { instrument: string; family: string; role: string }> = {
  drums: { instrument: "drums", family: "drums", role: "GROOVE" },
  keys: { instrument: "piano", family: "keys", role: "HARMONIC_BED" },
  organ: { instrument: "piano", family: "keys", role: "HARMONIC_BED" },
  chromatic_perc: { instrument: "piano", family: "keys", role: "ACCENT" },
  guitar: { instrument: "guitar", family: "guitar", role: "RHYTHMIC_HARMONY" },
  bass: { instrument: "bass", family: "bass", role: "BASS" },
  strings: { instrument: "strings", family: "strings", role: "HARMONIC_BED" },
  ensemble: { instrument: "strings", family: "strings", role: "PAD" },
  brass: { instrument: "brass", family: "brass", role: "CLIMAX_LAYER" },
  reed: { instrument: "winds", family: "winds", role: "COUNTER_MELODY" },
  pipe: { instrument: "winds", family: "winds", role: "COUNTER_MELODY" },
  synth: { instrument: "synth", family: "synth", role: "PAD" },
};

/**
 * Playable range by GM program: the floor and ceiling of anything commonly
 * exported under the program (`GM_REFERENCE[p].range.ext`). The 1.0 table
 * held one textbook instrument per program and the calibration measured what
 * that cost on human parts: 38 % of "flute" windows below the C flute's
 * floor (alto and bass flutes), tubas playing 61–65 (and euphoniums above),
 * bass clarinets under the clarinet program, and no entry at all for choirs,
 * timpani, harp and string sections — which then fell to the platform's
 * violin-shaped "strings" (55–103). Physics, not an answer key: nothing here
 * comes from a human part's notes; every entry is an instrument's range.
 */
export const GM_RANGE: Record<number, { min: number; max: number; name: string }> = Object.fromEntries(
  Object.entries(GM_REFERENCE)
    .filter(([, r]) => r.range !== null)
    .map(([p, r]) => [Number(p), { min: r.range!.ext[0], max: r.range!.ext[1], name: r.name }]),
);

/** The instrument's idiomatic register (`range.std`): where the part is expected to live, not where it may. */
export const IDIOMATIC_RANGE: Record<number, { min: number; max: number; name: string }> = Object.fromEntries(
  Object.entries(GM_REFERENCE)
    .filter(([, r]) => r.range !== null)
    .map(([p, r]) => [Number(p), { min: r.range!.std[0], max: r.range!.std[1], name: r.name }]),
);

export type PartMetrics = {
  noteCount: number;
  playabilityErrors: number;
  rangeShare: number | null;
  /** Share of notes inside the instrument's idiomatic register (null: drums, or no reference for the program). */
  registerShare: number | null;
  chordToneShare: number | null;
  coverage: number;
  densityLogRatio: number | null;
  barRepetitionShare: number | null;
  intervalDistance: number | null;
  contextClashShare: number | null;
  distinctPitches: number;
  singlePitch: boolean;
};

export type PartJudgement = {
  version: typeof PART_JUDGE_VERSION;
  metrics: PartMetrics;
  /** 0..100. A proxy; see the module comment. */
  score: number;
  /** The one-line reasons the score is what it is. */
  findings: string[];
};

/** Stated so a reader can argue with them. */
export const WEIGHTS = {
  playabilityErrorPenalty: 12,
  playabilityPenaltyCap: 60,
  rangePenalty: 30,
  /** Outside the idiomatic register but inside the playable range: a softer finding than a wrong note. */
  registerPenalty: 10,
  harmonyCentre: 0.6,
  harmonyGain: 40,
  harmonyMin: -20,
  harmonyMax: 16,
  coveragePenalty: 40,
  repetitionTolerance: 0.25,
  repetitionPenalty: 25,
  densityPenaltyPerOctave: 10,
  densityPenaltyCapOctaves: 2,
  intervalPenalty: 15,
  clashPenalty: 30,
  collapseCap: 20,
} as const;

const CHORD_TONES: Record<string, number[]> = {
  maj: [0, 4, 7], min: [0, 3, 7], "7": [0, 4, 7, 10], maj7: [0, 4, 7, 11], min7: [0, 3, 7, 10],
  dim: [0, 3, 6], sus4: [0, 5, 7], sus2: [0, 2, 7],
};
const ROOTS: Record<string, number> = { C: 0, "C#": 1, D: 2, Eb: 3, E: 4, F: 5, "F#": 6, G: 7, Ab: 8, A: 9, Bb: 10, B: 11 };

const pc = (pitch: number): number => ((Math.round(pitch) % 12) + 12) % 12;
const overlap = (a: { start: number; end: number }, b: { start: number; end: number }): number =>
  Math.max(0, Math.min(a.end, b.end) - Math.max(a.start, b.start));
const clamp = (v: number, lo: number, hi: number): number => Math.max(lo, Math.min(hi, v));
const r2 = (v: number): number => Number(v.toFixed(2));
const r4 = (v: number): number => Number(v.toFixed(4));

function chordTonesOf(chord: EstimatedChord): Set<number> {
  const root = ROOTS[chord.root] ?? 0;
  return new Set((CHORD_TONES[chord.quality] ?? [0, 4, 7]).map((i) => (root + i) % 12));
}

/** Duration-weighted share of the part's time that sits on a chord tone, over covered bars. */
export function chordToneShare(notes: readonly MusicalNote[], chords: readonly EstimatedChord[]): number | null {
  if (!chords.length || !notes.length) return null;
  let on = 0;
  let total = 0;
  for (const chord of chords) {
    const tones = chordTonesOf(chord);
    for (const note of notes) {
      const w = overlap({ start: note.start, end: note.start + note.duration }, chord);
      if (w <= 0) continue;
      total += w;
      if (tones.has(pc(note.pitch))) on += w;
    }
  }
  return total > 0 ? r4(on / total) : null;
}

/** Bars whose (position, pitch) content equals the previous bar's. */
export function barRepetitionShare(notes: readonly MusicalNote[], task: TournamentTask): number | null {
  if (task.bars.length < 2) return null;
  const signature = (bar: { start: number; end: number }): string =>
    notes
      .filter((n) => n.start >= bar.start - 1e-6 && n.start < bar.end - 1e-6)
      .map((n) => `${Math.round(((n.start - bar.start) / task.beatSeconds) * 12)}:${n.pitch}`)
      .sort()
      .join(",");
  let repeated = 0;
  let compared = 0;
  for (let i = 1; i < task.bars.length; i += 1) {
    const prev = signature(task.bars[i - 1]);
    const cur = signature(task.bars[i]);
    if (!prev && !cur) continue;
    compared += 1;
    if (prev === cur) repeated += 1;
  }
  return compared ? r4(repeated / compared) : null;
}

/** Normalised histogram of |Δpitch| between successive onsets, bins 0..12 (12 = an octave or more). */
export function intervalHistogram(notes: readonly MusicalNote[]): number[] | null {
  const sorted = [...notes].sort((a, b) => a.start - b.start || a.pitch - b.pitch);
  const bins = new Array(13).fill(0);
  let count = 0;
  for (let i = 1; i < sorted.length; i += 1) {
    if (Math.abs(sorted[i].start - sorted[i - 1].start) < 1e-3) continue; // a chord, not a step
    const interval = Math.min(12, Math.abs(sorted[i].pitch - sorted[i - 1].pitch));
    bins[interval] += 1;
    count += 1;
  }
  if (count < 4) return null;
  return bins.map((b) => b / count);
}

export function intervalDistance(candidate: readonly MusicalNote[], human: readonly MusicalNote[]): number | null {
  const a = intervalHistogram(candidate);
  const b = intervalHistogram(human);
  if (!a || !b) return null;
  return r4(a.reduce((sum, v, i) => sum + Math.abs(v - b[i]), 0));
}

/** Share of the candidate's sounding time spent a semitone from a sounding pitched context note. */
export function contextClashShare(notes: readonly MusicalNote[], task: TournamentTask): number | null {
  if (!notes.length) return null;
  const context = task.contextTracks
    .filter((t) => !t.isPercussion)
    .flatMap((t) => t.notes.filter((n) => n.start < task.window.end && n.start + n.duration > task.window.start));
  if (!context.length) return null;
  let clash = 0;
  let total = 0;
  for (const note of notes) {
    const span = { start: note.start, end: note.start + note.duration };
    total += note.duration;
    let worst = 0;
    for (const other of context) {
      const diff = Math.abs(pc(other.pitch) - pc(note.pitch));
      if (diff !== 1 && diff !== 11) continue;
      worst = Math.max(worst, overlap(span, { start: other.start, end: other.start + other.duration }));
    }
    clash += Math.min(note.duration, worst);
  }
  return total > 0 ? r4(clash / total) : null;
}

export type PlayabilityInput = {
  /** GM program of the part (128 = drums). */
  targetInst: number;
  /** ARRANGER_REMI family of the part. */
  targetFamily: string;
  tempoBpm: number;
  notes: readonly ConstraintNote[];
};

export type PlayabilityVerdict = {
  platform: { instrument: string; family: string; role: string };
  /** The range the judge held the part to, and where it came from. */
  range: { min: number; max: number } | null;
  rangeSource: "gm_table" | "definition" | "none";
  /** Engine violations, every severity. Range verdicts are removed when the GM table overrode the range. */
  violations: ConstraintViolation[];
  /** Notes outside `range` — each is one playability error. */
  outsideRange: ConstraintNote[];
  playabilityErrors: number;
  rangeShare: number | null;
  registerShare: number | null;
};

/**
 * The physical half of the judge, on its own so the calibration can run it
 * over real human parts and so `judgePart` cannot drift from what was
 * calibrated. Pure; identical for every provider.
 */
export function judgePlayability(input: PlayabilityInput): PlayabilityVerdict {
  const platform = PLATFORM_INSTRUMENT[input.targetFamily] ?? PLATFORM_INSTRUMENT.keys;
  const isDrums = input.targetFamily === "drums";
  const reference = gmReference(input.targetInst);
  const constraint = checkInstrumentConstraints({
    family: platform.family,
    instrument: platform.instrument,
    role: platform.role,
    tempoBpm: input.tempoBpm,
    notes: input.notes.map((n) => ({ id: n.id, start: n.start, duration: n.duration, pitch: n.pitch, velocity: n.velocity })),
    // The engine knows the platform instrument; the task knows the GM program.
    // A brass section is not a trumpet and a slap bass is not a bowed bass:
    // the program's own ceilings bound polyphony and leaps.
    polyphonyCeiling: reference?.polyphony.ext,
    leapCeiling: reference?.leap.ext,
  });
  // A drum kit addresses kit pieces, not a pitch range: the 1.0 judge fell
  // back to the platform kit map (35–81) and flagged GM2 kit pieces.
  const gmRange = isDrums ? null : GM_RANGE[input.targetInst] ?? null;
  let range: { min: number; max: number } | null = gmRange;
  let rangeSource: PlayabilityVerdict["rangeSource"] = gmRange ? "gm_table" : "none";
  if (!range && !isDrums) {
    try {
      range = getInstrumentDefinition(platform.instrument, platform.role).playableRange;
      rangeSource = "definition";
    } catch {
      range = null;
    }
  }
  // With a GM override the engine's range verdicts are for the wrong
  // instrument; keep its physical rules and take range from the override.
  const violations = gmRange || isDrums ? constraint.violations.filter((v) => !/range/.test(v.code)) : constraint.violations;
  const outsideRange = gmRange && range ? input.notes.filter((n) => n.pitch < range!.min || n.pitch > range!.max) : [];
  const playabilityErrors = violations.filter((v) => v.severity === "error").length + outsideRange.length;
  const rangeShare = range && input.notes.length
    ? r4(input.notes.filter((n) => n.pitch >= range!.min && n.pitch <= range!.max).length / input.notes.length)
    : null;
  const idiomatic = isDrums ? null : IDIOMATIC_RANGE[input.targetInst] ?? null;
  const registerShare = idiomatic && input.notes.length
    ? r4(input.notes.filter((n) => n.pitch >= idiomatic.min && n.pitch <= idiomatic.max).length / input.notes.length)
    : null;
  return { platform, range, rangeSource, violations, outsideRange, playabilityErrors, rangeShare, registerShare };
}

/**
 * Judge one part. `notes` may be empty — that is a real, scored outcome
 * (zero), not an error.
 */
export function judgePart(task: TournamentTask, notes: readonly MusicalNote[]): PartJudgement {
  const findings: string[] = [];
  const isDrums = task.targetFamily === "drums";
  const inWindow = notes.filter((n) => n.start < task.window.end - 1e-6 && n.start + n.duration > task.window.start + 1e-6);

  const { playabilityErrors, rangeShare, registerShare } = judgePlayability({
    targetInst: task.targetInst,
    targetFamily: task.targetFamily,
    tempoBpm: task.tempoBpm,
    notes: inWindow,
  });

  const chordTone = isDrums ? null : chordToneShare(inWindow, task.chords);
  const barsPlayed = task.bars.filter((b) => inWindow.some((n) => n.start >= b.start - 1e-6 && n.start < b.end - 1e-6)).length;
  const coverage = task.bars.length ? r4(barsPlayed / task.bars.length) : 0;

  const humanOnsets = new Set(task.humanTarget.map((n) => n.start.toFixed(3))).size;
  const candidateOnsets = new Set(inWindow.map((n) => n.start.toFixed(3))).size;
  const densityLogRatio = humanOnsets > 0 && candidateOnsets > 0
    ? r4(Math.log2(candidateOnsets / humanOnsets))
    : null;

  const repetition = barRepetitionShare(inWindow, task);
  const interval = isDrums ? null : intervalDistance(inWindow, task.humanTarget);
  const clash = isDrums ? null : contextClashShare(inWindow, task);
  const distinct = new Set(inWindow.map((n) => n.pitch)).size;
  const singlePitch = inWindow.length >= 8 && distinct === 1;

  const metrics: PartMetrics = {
    noteCount: inWindow.length,
    playabilityErrors,
    rangeShare,
    registerShare,
    chordToneShare: chordTone,
    coverage,
    densityLogRatio,
    barRepetitionShare: repetition,
    intervalDistance: interval,
    contextClashShare: clash,
    distinctPitches: distinct,
    singlePitch,
  };

  if (!inWindow.length) {
    findings.push("no notes in the window: the part was not written");
    return { version: PART_JUDGE_VERSION, metrics, score: 0, findings };
  }

  let score = 100;
  const playPenalty = Math.min(WEIGHTS.playabilityPenaltyCap, playabilityErrors * WEIGHTS.playabilityErrorPenalty);
  if (playPenalty) { score -= playPenalty; findings.push(`${playabilityErrors} playability error(s): −${playPenalty}`); }
  if (rangeShare !== null && rangeShare < 1) {
    const p = r2(WEIGHTS.rangePenalty * (1 - rangeShare));
    score -= p; findings.push(`${Math.round((1 - rangeShare) * 100)}% of notes outside the playable range: −${p}`);
  }
  if (registerShare !== null && registerShare < 1) {
    const p = r2(WEIGHTS.registerPenalty * (1 - registerShare));
    score -= p; findings.push(`${Math.round((1 - registerShare) * 100)}% of notes outside the idiomatic register: −${p}`);
  }
  if (chordTone !== null) {
    const p = r2(clamp((chordTone - WEIGHTS.harmonyCentre) * WEIGHTS.harmonyGain, WEIGHTS.harmonyMin, WEIGHTS.harmonyMax));
    score += p; findings.push(`chord-tone share ${chordTone}: ${p >= 0 ? "+" : ""}${p}`);
  }
  if (coverage < 1) {
    const p = r2(WEIGHTS.coveragePenalty * (1 - coverage));
    score -= p; findings.push(`plays in ${Math.round(coverage * 100)}% of bars: −${p}`);
  }
  if (repetition !== null && repetition > WEIGHTS.repetitionTolerance) {
    const p = r2(WEIGHTS.repetitionPenalty * (repetition - WEIGHTS.repetitionTolerance));
    score -= p; findings.push(`${Math.round(repetition * 100)}% of bars repeat the previous bar verbatim: −${p}`);
  }
  if (densityLogRatio !== null && Math.abs(densityLogRatio) > 0) {
    const p = r2(WEIGHTS.densityPenaltyPerOctave * Math.min(WEIGHTS.densityPenaltyCapOctaves, Math.abs(densityLogRatio)));
    score -= p; findings.push(`onset density ${densityLogRatio > 0 ? "above" : "below"} the human part by ${Math.abs(densityLogRatio).toFixed(2)} octave(s): −${p}`);
  }
  if (interval !== null) {
    const p = r2(WEIGHTS.intervalPenalty * interval);
    score -= p; findings.push(`interval-shape distance from the human part ${interval}: −${p}`);
  }
  if (clash !== null && clash > 0) {
    const p = r2(WEIGHTS.clashPenalty * clash);
    score -= p; findings.push(`${Math.round(clash * 100)}% of sounding time a semitone from a context note: −${p}`);
  }
  if (singlePitch) {
    score = Math.min(score, WEIGHTS.collapseCap);
    findings.push(`single pitch across ${inWindow.length} notes — repetition collapse; capped at ${WEIGHTS.collapseCap}`);
  }
  return { version: PART_JUDGE_VERSION, metrics, score: r2(clamp(score, 0, 100)), findings };
}
