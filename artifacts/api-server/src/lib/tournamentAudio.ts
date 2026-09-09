/**
 * Audio for a tournament pair side (Wave Q — Workstream A, PR-68).
 *
 * A side's MIDI (context tracks + the candidate part, as the runner wrote it)
 * becomes one mono WAV through the platform's reference renderer — the same
 * deterministic synth for every arm, so a rater compares notes, not sound
 * design. The candidate part is mixed a little forward so the held-out
 * instrument is audible against the ensemble; the same gain applies to
 * every side, human or machine.
 */
import { createHash } from "node:crypto";
import type { MusicalNote } from "@workspace/db";
import { familyOf } from "./arrangerRemi";
import { LISTENING_RENDERER_V2, renderTournamentSideV2 } from "./listeningRendererV2";
import { parseMidiFile, type ParsedMidi } from "./midiFile";
import { REFERENCE_RENDERER, REFERENCE_RENDERER_VERSION, encodeWavPcm, renderStem } from "./referenceRenderWorker";

export const TOURNAMENT_AUDIO_SAMPLE_RATE = 44_100;
/** The channel the runner assigns the candidate part; informational — the writer folds channels, so the track order decides. */
export const CANDIDATE_CHANNEL = 15;
const CANDIDATE_GAIN = 1.35;
const TARGET_PEAK = 0.89;

/** Platform renderer family for a GM program / percussion flag. */
export function rendererFamily(program: number, isPercussion: boolean): string {
  if (isPercussion) return "drums";
  const family = familyOf({ program, isPercussion: false });
  switch (family) {
    case "keys": case "organ": case "chromatic_perc": return "keys";
    case "guitar": return "guitar";
    case "bass": return "bass";
    case "strings": case "ensemble": return "strings";
    case "brass": return "brass";
    case "reed": case "pipe": return "winds";
    case "synth": return "synth";
    default: return "keys";
  }
}

export type TournamentSideRender = {
  wav: Buffer;
  sha256: string;
  durationSeconds: number;
  tracks: number;
  notes: number;
  candidateNotes: number;
  /** Which renderer made the WAV (PR-72: the V1 default or LISTENING_SYNTH_V2), and its channel count. */
  renderer: string;
  rendererVersion: string;
  channels: 1 | 2;
};

/** The renderers a listening session may name. V1 stays the default so every existing caller is unchanged. */
export const TOURNAMENT_RENDERERS = [REFERENCE_RENDERER, LISTENING_RENDERER_V2] as const;
export type TournamentRenderer = (typeof TOURNAMENT_RENDERERS)[number];
export const DEFAULT_TOURNAMENT_RENDERER: TournamentRenderer = REFERENCE_RENDERER;

function secondsPerTick(midi: ParsedMidi): number {
  const bpm = midi.tempos[0]?.bpm ?? 120;
  return 60 / (bpm * midi.ticksPerQuarter);
}

/**
 * Render one side's MIDI. Pure and deterministic. The default is the V1
 * mono reference synth; `renderer: LISTENING_SYNTH_V2` renders the same
 * notes with the V2 stereo listening renderer (PR-72).
 */
export function renderTournamentSide(midiBytes: Buffer, options: { renderer?: TournamentRenderer } = {}): TournamentSideRender {
  if (options.renderer === LISTENING_RENDERER_V2) {
    const v2 = renderTournamentSideV2(midiBytes);
    return { wav: v2.wav, sha256: v2.sha256, durationSeconds: v2.durationSeconds, tracks: v2.tracks, notes: v2.notes, candidateNotes: v2.candidateNotes, renderer: v2.renderer, rendererVersion: v2.rendererVersion, channels: 2 };
  }
  const midi = parseMidiFile(midiBytes);
  const spt = secondsPerTick(midi);
  // The runner writes the candidate as the last track (the writer keeps track
  // order and folds channels to 0/9), so the highest track index is the part
  // under judgement whatever channel it was given.
  const candidateTrack = Math.max(...midi.notes.map((n) => n.track));
  const groups = new Map<string, { family: string; candidate: boolean; notes: MusicalNote[] }>();
  for (const note of midi.notes) {
    const key = `${note.track}:${note.channel}:${note.program}`;
    const group = groups.get(key) ?? {
      family: rendererFamily(note.program, note.isPercussion),
      candidate: note.track === candidateTrack,
      notes: [],
    };
    group.notes.push({
      id: `${key}:${group.notes.length}`,
      start: note.startTick * spt,
      duration: Math.max(0.02, (note.endTick - note.startTick) * spt),
      pitch: note.pitch,
      velocity: note.velocity || 80,
    });
    groups.set(key, group);
  }
  const end = Math.max(0.5, ...midi.notes.map((n) => n.endTick * spt));
  const durationSeconds = Number((end + 0.6).toFixed(3));
  const length = Math.ceil(durationSeconds * TOURNAMENT_AUDIO_SAMPLE_RATE);
  const mix = new Float32Array(length);
  let candidateNotes = 0;
  for (const [key, group] of groups) {
    const { samples } = renderStem(
      { id: key, instrument: group.family, role: group.candidate ? "candidate" : "context", notes: group.notes },
      { sampleRate: TOURNAMENT_AUDIO_SAMPLE_RATE, bitDepth: 16, durationSeconds },
    );
    const gain = group.candidate ? CANDIDATE_GAIN : 1;
    if (group.candidate) candidateNotes += group.notes.length;
    for (let i = 0; i < length && i < samples.length; i += 1) mix[i] += samples[i] * gain;
  }
  let peak = 0;
  for (let i = 0; i < length; i += 1) peak = Math.max(peak, Math.abs(mix[i]));
  if (peak > 0) {
    const norm = TARGET_PEAK / peak;
    for (let i = 0; i < length; i += 1) mix[i] *= norm;
  }
  const wav = encodeWavPcm(mix, TOURNAMENT_AUDIO_SAMPLE_RATE, 16);
  return {
    wav,
    sha256: createHash("sha256").update(wav).digest("hex"),
    durationSeconds,
    tracks: groups.size,
    notes: midi.notes.length,
    candidateNotes,
    renderer: REFERENCE_RENDERER,
    rendererVersion: REFERENCE_RENDERER_VERSION,
    channels: 1,
  };
}

/** REFERENCE_SYNTH_V1 behind the V2 check's adapter interface: mono, duplicated to both channels. */
export function v1RendererAdapter(): { id: string; version: string; render: (midi: Buffer) => { left: Float32Array; right: Float32Array; sampleRate: number } } {
  return {
    id: REFERENCE_RENDERER,
    version: REFERENCE_RENDERER_VERSION,
    render: (midi) => {
      const { wav } = renderTournamentSide(midi);
      const frames = (wav.length - 44) / 2;
      const left = new Float32Array(frames);
      for (let i = 0; i < frames; i += 1) left[i] = wav.readInt16LE(44 + i * 2) / 32_768;
      return { left, right: left, sampleRate: TOURNAMENT_AUDIO_SAMPLE_RATE };
    },
  };
}
