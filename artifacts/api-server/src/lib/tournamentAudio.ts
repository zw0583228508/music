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
import { parseMidiFile, type ParsedMidi } from "./midiFile";
import { encodeWavPcm, renderStem } from "./referenceRenderWorker";

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
};

function secondsPerTick(midi: ParsedMidi): number {
  const bpm = midi.tempos[0]?.bpm ?? 120;
  return 60 / (bpm * midi.ticksPerQuarter);
}

/** Render one side's MIDI to a mixed mono WAV. Pure and deterministic. */
export function renderTournamentSide(midiBytes: Buffer): TournamentSideRender {
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
  };
}
