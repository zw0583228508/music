/**
 * The evaluation renderer (Brain B-07): one renderer and one loudness for
 * every render the platform *judges* — the Arrangement Brain's audio critique
 * where users generate, and the job runner's evaluation artifact.
 *
 * What it is: the `LISTENING_SYNTH_V2` voices, seats, kit and reverb of
 * `listeningRendererV2.ts` (the renderer the Listening Room plays to humans),
 * rendered per stem from TrackModels directly (no MIDI round trip, no
 * "candidate forward" gain), with two things added, both measured, neither
 * chosen by ear:
 *
 *   1. `EVALUATION_FAMILY_TRIMS_DB` — a static per-family gain that makes every
 *      family equally loud at equal velocity (`measureFamilyNeutrality`). The
 *      V2 voices are not neutral: at velocity 90 the kit sits 16 dB above the
 *      keys and the bass 5.5 dB above them, so an untrimmed V2 mix carries
 *      75–90 % of its power below 150 Hz on every Tier S case (measured
 *      2026-09-10; see `docs/evidence/brain-b07-render-loop.json`). A judge
 *      that imposes its own balance cannot judge balance: with the trims the
 *      level of each part is what the performance layer's velocities and the
 *      composer's density asked for. `evaluationRender.test.ts` asserts the
 *      table equals the measurement, so it cannot drift by hand.
 *   2. one loudness normalisation of the *mix* (V2's own: −18 dBFS RMS with a
 *      0.95 peak ceiling), whose gain is applied to every stem as well, so
 *      stem levels are comparable across candidates and with the mix.
 *
 * Why V2 and not the job runner's `LOCAL_EXPRESSIVE_SYNTH` or the
 * orchestrator's `REFERENCE_SYNTH_V1`: `evaluationRendererDecision()` runs
 * PR-72's objective `rendererCheck` on all three. V2 passes all 9 checks;
 * V1 fails 4 (indistinct family voices, no struck/sustained envelopes,
 * indistinct kit pieces, no stereo image); the preview synth fails 5 (the
 * same plus clipping a fortissimo ensemble at +4.6 dBFS) and puts 0 % of its
 * energy above 5 kHz. The decision is recorded from those numbers.
 *
 * Pure and deterministic. `renderOffThread.ts` runs it in a worker thread
 * where the built server has one.
 */
import { createHash } from "node:crypto";
import type { AudioCritique, ArrangementPlan, MusicalNote, TrackModel } from "@workspace/db";
import { critiqueRenderedAudio, type AudioStem } from "./audioCritic";
import { gmProgramFor } from "./gmPrograms";
import {
  drumPieceV2,
  fftMagnitudes,
  LISTENING_RENDERER_V2,
  LISTENING_RENDERER_V2_VERSION,
  normaliseStereo,
  panGains,
  renderDrumNote,
  renderPitchedNote,
  rendererCheck,
  rendererFamilyV2,
  schroederReverb,
  stereoPeak,
  stereoRms,
  toDbfs,
  v2Adapter,
  V2_PEAK_CEILING,
  V2_REVERB_WET,
  V2_SAMPLE_RATE,
  V2_TARGET_RMS_DBFS,
  voiceFor,
  type NoteEvent,
  type RendererAdapter,
  type RendererCheck,
} from "./listeningRendererV2";
import { getInstrumentDefinition, LocalExpressiveRenderer, secondsPerBar } from "./musicEngines";
import { parseMidiFile } from "./midiFile";
import { v1RendererAdapter } from "./tournamentAudio";

export const EVALUATION_RENDERER = LISTENING_RENDERER_V2;
export const EVALUATION_RENDERER_VERSION = LISTENING_RENDERER_V2_VERSION;
/** The contract of this module: trims + loudness + stem layout. Bump when either changes. */
export const EVALUATION_RENDER_VERSION = "1.0" as const;
export const EVALUATION_SAMPLE_RATE = V2_SAMPLE_RATE;
export const EVALUATION_CHANNELS = 2 as const;
export const EVALUATION_LOUDNESS = { targetRmsDbfs: V2_TARGET_RMS_DBFS, peakCeiling: V2_PEAK_CEILING } as const;
/** The orchestrator's blend (`finalScore = 0.6 × symbolic + 0.4 × audio`), mirrored so the provider ranks the same way. */
export const AUDIO_SCORE_WEIGHT = 0.4;

/** Families the V2 voices know; `drums` is the kit. */
export const EVALUATION_FAMILIES = ["keys", "guitar", "bass", "strings", "brass", "winds", "synth", "voice", "drums"] as const;
export type EvaluationFamily = (typeof EVALUATION_FAMILIES)[number];

/**
 * Per-family gain (dB) that equalises RMS at equal velocity across the V2
 * voices — the output of `measureFamilyNeutrality()` at 44.1 kHz, rounded to
 * 0.1 dB. Regenerate with `measureFamilyNeutrality()` whenever a V2 voice
 * changes; the test fails when the table and the measurement disagree.
 */
export const EVALUATION_FAMILY_TRIMS_DB: Record<EvaluationFamily, number> = {
  keys: 6.3,
  guitar: 5.7,
  bass: -1.2,
  strings: 3,
  brass: 0,
  winds: -2.7,
  synth: 3.5,
  voice: -0.7,
  drums: -4.7,
};

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type EvaluationStem = {
  trackId: string;
  instrument: string;
  role: string;
  family: EvaluationFamily;
  /** Seat on the stage, −1..1 (the kit's pieces have their own; 0 is reported). */
  pan: number;
  trimDb: number;
  noteCount: number;
  /** Interleaved stereo, dry (no reverb), after the family trim and the mix gain. */
  samples: Float32Array;
  rmsDbfs: number;
  peakDbfs: number;
};

export type EvaluationLoudness = {
  targetRmsDbfs: number;
  peakCeiling: number;
  applied: "rms" | "peak";
  gainDb: number;
};

export type EvaluationSpectrum = {
  /** Percent of the mix's power below 150 Hz, 150 Hz–2 kHz, 2–5 kHz, above 5 kHz. */
  sub150: number;
  low2k: number;
  presence5k: number;
  air: number;
  frames: number;
};

export type EvaluationRender = {
  renderer: typeof EVALUATION_RENDERER;
  rendererVersion: typeof EVALUATION_RENDERER_VERSION;
  evaluationVersion: typeof EVALUATION_RENDER_VERSION;
  sampleRate: number;
  channels: typeof EVALUATION_CHANNELS;
  durationSeconds: number;
  loudness: EvaluationLoudness;
  familyTrimsDb: Record<string, number>;
  reverbWet: number;
  stems: EvaluationStem[];
  /** Interleaved stereo: the stems summed, V2's reverb added, normalised. */
  mix: Float32Array;
  mixRmsDbfs: number;
  mixPeakDbfs: number;
  spectrum: EvaluationSpectrum;
  elapsedMs: number;
  /** Digest of the notes rendered (cache key); the same notes always give the same bytes. */
  key: string;
};

export type EvaluationRenderOptions = {
  sampleRate?: number;
  durationSeconds?: number;
  /** Override for tests and the neutrality measurement; production uses the table. */
  familyTrimsDb?: Partial<Record<EvaluationFamily, number>>;
  reverbWet?: number;
};

// ---------------------------------------------------------------------------
// Family + duration
// ---------------------------------------------------------------------------

/** The V2 family of a track: the GM program the export MIDI would carry (B-11's table), mapped as V2 maps programs. */
export function evaluationFamilyOf(track: Pick<TrackModel, "instrument" | "instrumentDefinition">): EvaluationFamily {
  const gm = gmProgramFor({ instrument: track.instrument, definition: track.instrumentDefinition });
  const family = rendererFamilyV2(gm.program, gm.percussion);
  return (EVALUATION_FAMILIES as readonly string[]).includes(family) ? (family as EvaluationFamily) : "keys";
}

/**
 * The render length both the provider and the job runner use, so one render
 * serves both: the planned end of the last section plus a second, or the last
 * note-off plus a 1.2 s tail, whichever is later.
 */
export function evaluationDurationSeconds(
  trackModels: ReadonlyArray<Pick<TrackModel, "notes">>,
  plan: Pick<ArrangementPlan, "sections"> | null | undefined,
  bpm: number,
  meter: string,
): number {
  const noteEnd = Math.max(0, ...trackModels.flatMap((t) => t.notes.map((n) => n.start + n.duration)));
  const barSeconds = secondsPerBar(bpm, meter);
  const plannedEnd = Math.max(0, ...(plan?.sections ?? []).map((s) => (s.endBar ?? 0) * barSeconds));
  return Number(Math.max(1, plannedEnd > 0 ? plannedEnd + 1 : 0, noteEnd + 1.2).toFixed(3));
}

const dbToGain = (db: number): number => 10 ** (db / 20);

function noteEvents(track: Pick<TrackModel, "notes">): NoteEvent[] {
  return track.notes
    .filter((n) => Number.isFinite(n.start) && Number.isFinite(n.duration) && n.duration > 0 && Number.isFinite(n.pitch))
    .map((n) => ({ id: n.id, start: n.start, duration: n.duration, pitch: n.pitch, velocity: n.velocity || 96 }));
}

/** sha256 over what the render depends on: notes, families, sample rate, duration, trims. */
export function evaluationRenderKey(trackModels: ReadonlyArray<TrackModel>, options: { sampleRate: number; durationSeconds: number; familyTrimsDb: Record<string, number> }): string {
  const hash = createHash("sha256");
  hash.update(`${EVALUATION_RENDER_VERSION}|${options.sampleRate}|${options.durationSeconds}|${JSON.stringify(options.familyTrimsDb)}|`);
  for (const track of trackModels) {
    hash.update(`${track.id}|${track.instrument}|${track.role}|${evaluationFamilyOf(track)}|`);
    for (const n of track.notes) hash.update(`${n.start},${n.duration},${n.pitch},${n.velocity};`);
    hash.update("\n");
  }
  return hash.digest("hex");
}

// ---------------------------------------------------------------------------
// The render
// ---------------------------------------------------------------------------

function renderStemStereo(track: TrackModel, index: number, family: EvaluationFamily, frames: number, sampleRate: number): { left: Float32Array; right: Float32Array; pan: number } {
  const left = new Float32Array(frames);
  const right = new Float32Array(frames);
  const notes = noteEvents(track);
  if (family === "drums") {
    const byPiece = new Map<string, NoteEvent[]>();
    for (const n of notes) {
      const name = drumPieceV2(n.pitch).name;
      byPiece.set(name, [...(byPiece.get(name) ?? []), n]);
    }
    for (const [, pieceNotes] of byPiece) {
      const mono = new Float32Array(frames);
      for (const n of pieceNotes) renderDrumNote(mono, n, sampleRate);
      const [gl, gr] = panGains(drumPieceV2(pieceNotes[0].pitch).pan);
      for (let i = 0; i < frames; i += 1) { left[i] += mono[i] * gl; right[i] += mono[i] * gr; }
    }
    return { left, right, pan: 0 };
  }
  const voice = voiceFor(family);
  const mono = new Float32Array(frames);
  let pitchSum = 0;
  for (const n of notes) { renderPitchedNote(mono, n, voice, sampleRate); pitchSum += n.pitch; }
  const meanPitch = notes.length ? pitchSum / notes.length : 60;
  const trackOffset = ((index % 3) - 1) * 0.08;
  const pan = voice.pan + voice.registerSpread * Math.max(-1, Math.min(1, (meanPitch - 60) / 24)) + trackOffset;
  const [gl, gr] = panGains(pan);
  for (let i = 0; i < frames; i += 1) { left[i] += mono[i] * gl; right[i] += mono[i] * gr; }
  return { left, right, pan: Number(pan.toFixed(3)) };
}

function interleave(left: Float32Array, right: Float32Array): Float32Array {
  const out = new Float32Array(left.length * 2);
  for (let i = 0; i < left.length; i += 1) { out[2 * i] = left[i]; out[2 * i + 1] = right[i]; }
  return out;
}

/** Mono downmix of an interleaved stereo buffer. */
export function monoOf(stereo: Float32Array): Float32Array {
  const out = new Float32Array(stereo.length >> 1);
  for (let i = 0; i < out.length; i += 1) out[i] = 0.5 * (stereo[2 * i] + stereo[2 * i + 1]);
  return out;
}

function rmsDbOfInterleaved(samples: Float32Array): number {
  let sum = 0;
  for (let i = 0; i < samples.length; i += 1) sum += samples[i] * samples[i];
  return Number(toDbfs(Math.sqrt(sum / Math.max(1, samples.length))).toFixed(2));
}
function peakDbOfInterleaved(samples: Float32Array): number {
  let p = 0;
  for (let i = 0; i < samples.length; i += 1) p = Math.max(p, Math.abs(samples[i]));
  return Number(toDbfs(p).toFixed(2));
}

/**
 * Percent of power in four bands, averaged over 8192-sample Hann frames taken
 * every 32768 samples of a mono signal (the measurement the renderer decision
 * and the stage trace use; hopped so it costs a few percent of the render).
 */
export const SPECTRUM_FRAME = 8_192;
export const SPECTRUM_HOP = 32_768;
export function bandShares(mono: Float32Array, sampleRate: number): EvaluationSpectrum {
  let n = SPECTRUM_FRAME;
  while (n > mono.length && n > 2) n >>= 1;
  if (n < 2) return { sub150: 0, low2k: 0, presence5k: 0, air: 0, frames: 0 };
  const acc = new Float64Array(n / 2 + 1);
  let frames = 0;
  for (let start = 0; start + n <= mono.length; start += SPECTRUM_HOP) {
    const mags = fftMagnitudes(mono.subarray(start, start + n));
    for (let i = 0; i < acc.length; i += 1) acc[i] += mags[i] * mags[i];
    frames += 1;
  }
  const binHz = sampleRate / n;
  let total = 0;
  for (let i = 1; i < acc.length; i += 1) total += acc[i];
  const share = (lo: number, hi: number) => {
    let e = 0;
    for (let i = 1; i < acc.length; i += 1) { const hz = i * binHz; if (hz >= lo && hz < hi) e += acc[i]; }
    return Number((100 * e / Math.max(1e-12, total)).toFixed(1));
  };
  return { sub150: share(0, 150), low2k: share(150, 2000), presence5k: share(2000, 5000), air: share(5000, sampleRate / 2), frames };
}

/** Render TrackModels with the evaluation renderer. Pure and deterministic. */
export function renderEvaluation(trackModels: ReadonlyArray<TrackModel>, options: EvaluationRenderOptions = {}): EvaluationRender {
  const started = performance.now();
  const sampleRate = options.sampleRate ?? EVALUATION_SAMPLE_RATE;
  const trims: Record<string, number> = { ...EVALUATION_FAMILY_TRIMS_DB, ...(options.familyTrimsDb ?? {}) };
  const wet = options.reverbWet ?? V2_REVERB_WET;
  const noteEnd = Math.max(0, ...trackModels.flatMap((t) => t.notes.map((n) => n.start + n.duration)));
  const durationSeconds = Number(Math.max(1, options.durationSeconds ?? noteEnd + 1.2).toFixed(3));
  const frames = Math.ceil(durationSeconds * sampleRate);
  const mixL = new Float32Array(frames);
  const mixR = new Float32Array(frames);
  const rendered = trackModels.map((track, index) => {
    const family = evaluationFamilyOf(track);
    const stem = renderStemStereo(track, index, family, frames, sampleRate);
    const trimDb = trims[family] ?? 0;
    const g = dbToGain(trimDb);
    if (g !== 1) for (let i = 0; i < frames; i += 1) { stem.left[i] *= g; stem.right[i] *= g; }
    for (let i = 0; i < frames; i += 1) { mixL[i] += stem.left[i]; mixR[i] += stem.right[i]; }
    return { track, family, trimDb, ...stem, noteCount: noteEvents(track).length };
  });
  if (wet > 0 && frames > 0) {
    const rl = schroederReverb(mixL, sampleRate, 0);
    const rr = schroederReverb(mixR, sampleRate, 23);
    for (let i = 0; i < frames; i += 1) { mixL[i] += rl[i] * wet; mixR[i] += rr[i] * wet; }
  }
  const loudness = normaliseStereo(mixL, mixR, EVALUATION_LOUDNESS.targetRmsDbfs, EVALUATION_LOUDNESS.peakCeiling);
  const gain = dbToGain(loudness.gainDb);
  const stems: EvaluationStem[] = rendered.map((r) => {
    if (gain !== 1) for (let i = 0; i < frames; i += 1) { r.left[i] *= gain; r.right[i] *= gain; }
    const samples = interleave(r.left, r.right);
    return {
      trackId: r.track.id, instrument: r.track.instrument, role: r.track.role, family: r.family, pan: r.pan, trimDb: r.trimDb,
      noteCount: r.noteCount, samples, rmsDbfs: rmsDbOfInterleaved(samples), peakDbfs: peakDbOfInterleaved(samples),
    };
  });
  const mix = interleave(mixL, mixR);
  return {
    renderer: EVALUATION_RENDERER,
    rendererVersion: EVALUATION_RENDERER_VERSION,
    evaluationVersion: EVALUATION_RENDER_VERSION,
    sampleRate,
    channels: EVALUATION_CHANNELS,
    durationSeconds,
    loudness,
    familyTrimsDb: trims,
    reverbWet: wet,
    stems,
    mix,
    mixRmsDbfs: Number(toDbfs(stereoRms(mixL, mixR)).toFixed(2)),
    mixPeakDbfs: Number(toDbfs(stereoPeak(mixL, mixR)).toFixed(2)),
    spectrum: bandShares(monoOf(mix), sampleRate),
    elapsedMs: Math.round(performance.now() - started),
    key: evaluationRenderKey(trackModels, { sampleRate, durationSeconds, familyTrimsDb: trims }),
  };
}

/** The render's stems in the shape `audioCritic.critiqueRenderedAudio` reads (mono, with the seat as pan). */
export function stemsForAudioCritic(render: EvaluationRender): AudioStem[] {
  return render.stems.map((stem) => ({
    trackId: stem.trackId, instrument: stem.instrument, role: stem.role, family: stem.family,
    samples: monoOf(stem.samples), pan: stem.pan,
  }));
}

/** audio-critic/v1 over the evaluation render (stems mono, mix as the movement source). */
export function critiqueEvaluationRender(render: EvaluationRender): AudioCritique {
  return critiqueRenderedAudio({ stems: stemsForAudioCritic(render), sampleRate: render.sampleRate, mix: monoOf(render.mix) });
}

// ---------------------------------------------------------------------------
// Render cache: the provider renders once; the job runner reuses it
// ---------------------------------------------------------------------------

const RENDER_CACHE_MAX = 24;
const RENDER_CACHE_TTL_MS = 30 * 60_000;
const renderCache = new Map<string, { render: EvaluationRender; at: number }>();

export function rememberEvaluationRender(render: EvaluationRender, now = Date.now()): void {
  for (const [key, entry] of renderCache) if (now - entry.at > RENDER_CACHE_TTL_MS) renderCache.delete(key);
  renderCache.set(render.key, { render, at: now });
  while (renderCache.size > RENDER_CACHE_MAX) {
    const oldest = renderCache.keys().next().value;
    if (oldest === undefined) break;
    renderCache.delete(oldest);
  }
}

/** The cached render for these notes, removed from the cache (one consumer), or null. */
export function takeEvaluationRender(key: string, now = Date.now()): EvaluationRender | null {
  const entry = renderCache.get(key);
  if (!entry) return null;
  renderCache.delete(key);
  return now - entry.at > RENDER_CACHE_TTL_MS ? null : entry.render;
}

export function evaluationRenderCacheSize(): number {
  return renderCache.size;
}

// ---------------------------------------------------------------------------
// Neutrality measurement (the trims) and the renderer decision
// ---------------------------------------------------------------------------

export type FamilyNeutrality = {
  sampleRate: number;
  /** RMS (dBFS) of each family's standard probe, untrimmed: a 2 s note at velocity 90 (bass at MIDI 40, others at 60); the kit on a one-bar pattern at 120 BPM. */
  rmsDbfs: Record<EvaluationFamily, number>;
  medianDbfs: number;
  /** `median − rms`, rounded to 0.1 dB: the gain that puts every family at the median. */
  trimsDb: Record<EvaluationFamily, number>;
  /** Spread (max − min) before and after the trims. */
  spreadBeforeDb: number;
  spreadAfterDb: number;
};

const PROBE_WINDOW_SECONDS = 3.2;

function probeStemRms(family: EvaluationFamily, sampleRate: number): number {
  const frames = Math.ceil(PROBE_WINDOW_SECONDS * sampleRate);
  const mono = new Float32Array(frames);
  if (family === "drums") {
    // One bar at 120 BPM: kick on 1 and 3, snare on 2 and 4, closed hat on every eighth — velocity 90 throughout.
    const beat = 0.5;
    const notes: NoteEvent[] = [];
    for (let b = 0; b < 4; b += 1) {
      notes.push({ id: `k${b}`, start: b * beat, duration: 0.25, pitch: b % 2 === 0 ? 36 : 38, velocity: 90 });
      notes.push({ id: `h${b}a`, start: b * beat, duration: 0.1, pitch: 42, velocity: 90 });
      notes.push({ id: `h${b}b`, start: b * beat + beat / 2, duration: 0.1, pitch: 42, velocity: 90 });
    }
    for (const n of notes) renderDrumNote(mono, n, sampleRate);
  } else {
    renderPitchedNote(mono, { id: `probe-${family}`, start: 0, duration: 2, pitch: family === "bass" ? 40 : 60, velocity: 90 }, voiceFor(family), sampleRate);
  }
  let sum = 0;
  for (let i = 0; i < mono.length; i += 1) sum += mono[i] * mono[i];
  return toDbfs(Math.sqrt(sum / mono.length));
}

/** Measure the V2 voices' loudness at equal velocity and derive the trims. */
export function measureFamilyNeutrality(sampleRate = EVALUATION_SAMPLE_RATE): FamilyNeutrality {
  const rms = {} as Record<EvaluationFamily, number>;
  for (const family of EVALUATION_FAMILIES) rms[family] = Number(probeStemRms(family, sampleRate).toFixed(2));
  const sorted = [...EVALUATION_FAMILIES].map((f) => rms[f]).sort((a, b) => a - b);
  const median = sorted.length % 2 ? sorted[(sorted.length - 1) / 2] : (sorted[sorted.length / 2 - 1] + sorted[sorted.length / 2]) / 2;
  const trims = {} as Record<EvaluationFamily, number>;
  for (const family of EVALUATION_FAMILIES) trims[family] = Number((Math.round((median - rms[family]) * 10) / 10).toFixed(1));
  const after = EVALUATION_FAMILIES.map((f) => rms[f] + trims[f]);
  return {
    sampleRate,
    rmsDbfs: rms,
    medianDbfs: Number(median.toFixed(2)),
    trimsDb: trims,
    spreadBeforeDb: Number((sorted[sorted.length - 1] - sorted[0]).toFixed(2)),
    spreadAfterDb: Number((Math.max(...after) - Math.min(...after)).toFixed(2)),
  };
}

/** `LOCAL_EXPRESSIVE_SYNTH` (the job runner's preview synth) behind the check's MIDI adapter, for the decision only. */
export function localExpressiveAdapter(): RendererAdapter {
  return {
    id: "LOCAL_EXPRESSIVE_SYNTH",
    version: "1.0.0",
    render: (midi: Buffer) => {
      const parsed = parseMidiFile(midi);
      const sampleRate = 44_100;
      const spt = 60 / ((parsed.tempos[0]?.bpm ?? 120) * parsed.ticksPerQuarter);
      const groups = new Map<string, { program: number; percussion: boolean; notes: MusicalNote[] }>();
      for (const n of parsed.notes) {
        const key = `${n.track}:${n.program}:${n.isPercussion}`;
        const group = groups.get(key) ?? { program: n.program, percussion: n.isPercussion, notes: [] };
        group.notes.push({ id: `${key}:${group.notes.length}`, start: n.startTick * spt, duration: Math.max(0.02, (n.endTick - n.startTick) * spt), pitch: n.pitch, velocity: n.velocity || 80 });
        groups.set(key, group);
      }
      const end = Math.max(0.5, ...parsed.notes.map((n) => n.endTick * spt)) + 1.2;
      const renderer = new LocalExpressiveRenderer();
      const left = new Float32Array(Math.ceil(sampleRate * end));
      const right = new Float32Array(left.length);
      for (const group of groups.values()) {
        const family = rendererFamilyV2(group.program, group.percussion);
        const definition = getInstrumentDefinition(family, family === "drums" ? "GROOVE" : "HARMONIC_BED");
        const track = { id: family, instrument: family, role: "x", instrumentDefinition: definition, notes: group.notes, articulations: [], cc: [], automation: [], version: 1, source: "TEST", provenance: { model: "p", version: "1", createdBy: "x", parentIds: [], parameters: {} } } as unknown as TrackModel;
        const samples = renderer.render(track, sampleRate, end);
        for (let i = 0; i < left.length; i += 1) { left[i] += samples[2 * i]; right[i] += samples[2 * i + 1]; }
      }
      return { left, right, sampleRate };
    },
  };
}

export type RendererCandidateRecord = {
  renderer: string;
  version: string;
  check: { passed: boolean; failed: string[]; checks: Array<{ name: string; passed: boolean; detail: string }> };
};

export type EvaluationRendererDecision = {
  version: typeof EVALUATION_RENDER_VERSION;
  rule: string;
  candidates: RendererCandidateRecord[];
  neutrality: FamilyNeutrality;
  chosen: { renderer: string; version: string; familyTrimsDb: Record<string, number>; loudness: typeof EVALUATION_LOUDNESS };
  reason: string;
};

/**
 * The renderer decision from the objective checks, recorded (it is not taken
 * by taste). Rule, pre-registered: a judgement renderer must pass every PR-72
 * `rendererCheck` item (distinguishable family voices, struck vs sustained
 * envelopes, distinguishable kit pieces, no clipping on a fortissimo
 * ensemble, a stereo image, loudness consistent across arms, velocity and
 * pitch sensitivity, determinism); among renderers that pass, the one the
 * Listening Room already plays to humans is preferred so machine and human
 * judgement hear the same voices; its family loudness is then equalised by
 * measurement (`measureFamilyNeutrality`), never by ear.
 */
export function evaluationRendererDecision(): EvaluationRendererDecision {
  const adapters: RendererAdapter[] = [v1RendererAdapter(), v2Adapter, localExpressiveAdapter()];
  const candidates = adapters.map((adapter): RendererCandidateRecord => {
    const check: RendererCheck = rendererCheck(adapter);
    return {
      renderer: adapter.id,
      version: adapter.version,
      check: { passed: check.passed, failed: check.checks.filter((c) => !c.passed).map((c) => c.name), checks: check.checks.map((c) => ({ name: c.name, passed: c.passed, detail: c.detail })) },
    };
  });
  const passing = candidates.filter((c) => c.check.passed);
  const neutrality = measureFamilyNeutrality();
  const chosen = passing.find((c) => c.renderer === LISTENING_RENDERER_V2) ?? passing[0] ?? null;
  return {
    version: EVALUATION_RENDER_VERSION,
    rule: "pass every rendererCheck item; among passing renderers prefer the Listening Room's (LISTENING_SYNTH_V2); equalise family loudness at equal velocity by measurement",
    candidates,
    neutrality,
    chosen: {
      renderer: chosen?.renderer ?? "none",
      version: chosen?.version ?? "none",
      familyTrimsDb: { ...EVALUATION_FAMILY_TRIMS_DB },
      loudness: EVALUATION_LOUDNESS,
    },
    reason: chosen
      ? `${passing.length} of ${candidates.length} renderers pass every check (${passing.map((c) => c.renderer).join(", ")}); ${candidates.filter((c) => !c.check.passed).map((c) => `${c.renderer} fails ${c.check.failed.join("/")}`).join("; ")}`
      : "no renderer passes every check",
  };
}
