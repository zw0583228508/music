/**
 * One side of a listening pair as a Standard MIDI File (Wave Q — PR-72).
 *
 * A side is the full ensemble context plus one candidate part: the context
 * tracks first, in task order, and the candidate as the **last track**. That
 * is the layout `run-model-tournament.mjs` writes and `tournamentAudio.ts`
 * reads; this module makes it a library so the V2 runner, the controls and
 * the proof below all use one writer.
 *
 * The property the experiment rests on — *only the target part changes
 * between the two sides of a pair* — is checked, not assumed:
 * `contextDigest` hashes every MTrk chunk except the candidate's, so two
 * sides with identical context bytes have identical digests, and a session
 * records that every pair passed.
 */
import { createHash } from "node:crypto";
import type { MusicalNote } from "@workspace/db";
import { writeMidiFile, type MidiNote } from "./midiFile";
import { DRUMS_PROGRAM, type TournamentTask } from "./tournamentTask";

export const SIDE_MIDI_TICKS_PER_QUARTER = 480;

/** The task's window (context + candidate) as the runner writes it. Pure and deterministic. */
export function sideMidiForTask(task: TournamentTask, candidateNotes: readonly MusicalNote[]): Buffer {
  const TPQ = SIDE_MIDI_TICKS_PER_QUARTER;
  const ticks = (seconds: number) => Math.round(seconds * (task.tempoBpm / 60) * TPQ);
  const notes: MidiNote[] = [];
  task.contextTracks.forEach((ctx, i) => {
    const channel = ctx.isPercussion ? 9 : (i % 15 >= 9 ? (i % 15) + 1 : i % 15);
    for (const n of ctx.notes) {
      if (n.start >= task.window.end || n.start + n.duration <= task.window.start) continue;
      notes.push({
        track: i, channel, program: ctx.isPercussion ? 0 : ctx.program, isPercussion: ctx.isPercussion, pitch: n.pitch, velocity: n.velocity,
        startTick: ticks(Math.max(0, n.start - task.window.start)),
        endTick: ticks(Math.min(task.window.end, n.start + n.duration) - task.window.start),
      });
    }
  });
  const drums = task.targetInst === DRUMS_PROGRAM;
  const candTrack = task.contextTracks.length;
  for (const n of candidateNotes) {
    if (n.start >= task.window.end || n.start + n.duration <= task.window.start) continue;
    notes.push({
      track: candTrack, channel: drums ? 9 : 15, program: drums ? 0 : task.targetInst, isPercussion: drums, pitch: n.pitch, velocity: n.velocity,
      startTick: ticks(Math.max(0, n.start - task.window.start)),
      endTick: ticks(Math.min(task.window.end, n.start + n.duration) - task.window.start),
    });
  }
  return writeMidiFile({
    ticksPerQuarter: TPQ, notes,
    tempos: [{ tick: 0, usPerQuarter: Math.round(60e6 / task.tempoBpm), bpm: task.tempoBpm }],
    timeSignatures: [{ tick: 0, numerator: task.meter.numerator, denominator: task.meter.denominator }],
  });
}

/** The header and each MTrk chunk of an SMF as separate buffers. Throws on a malformed file. */
export function midiChunks(bytes: Buffer): { header: Buffer; tracks: Buffer[] } {
  if (bytes.length < 14 || bytes.toString("ascii", 0, 4) !== "MThd") throw new Error("not a Standard MIDI File");
  const headerLength = bytes.readUInt32BE(4);
  const header = bytes.subarray(0, 8 + headerLength);
  const tracks: Buffer[] = [];
  let offset = header.length;
  while (offset + 8 <= bytes.length) {
    const id = bytes.toString("ascii", offset, offset + 4);
    const length = bytes.readUInt32BE(offset + 4);
    const end = offset + 8 + length;
    if (end > bytes.length) throw new Error("truncated MIDI chunk");
    if (id === "MTrk") tracks.push(bytes.subarray(offset, end));
    offset = end;
  }
  return { header, tracks };
}

/**
 * sha256 over everything but the candidate track: the header's division, the
 * tempo/metre track and every context track's bytes. Two sides of a pair
 * must agree on this exactly.
 */
export function contextDigest(bytes: Buffer): { digest: string; contextTracks: number; candidateBytes: number } {
  const { header, tracks } = midiChunks(bytes);
  if (tracks.length < 2) throw new Error("a side needs a tempo track and at least one note track");
  const candidate = tracks[tracks.length - 1];
  const hash = createHash("sha256");
  hash.update(header.subarray(12, 14)); // ticks per quarter
  for (const track of tracks.slice(0, -1)) hash.update(track);
  // The tempo/metre track is tracks[0]; the rest are context tracks.
  return { digest: hash.digest("hex"), contextTracks: tracks.length - 2, candidateBytes: candidate.length };
}

export type ContextIdentityProof = {
  sides: number;
  identical: boolean;
  digest: string | null;
  contextTracks: number | null;
  /** Digests that disagreed with the first side's, when any did. */
  disagreeing: string[];
};

/** Prove that every side in the list shares one context. */
export function proveContextIdentity(sides: readonly Buffer[]): ContextIdentityProof {
  if (!sides.length) return { sides: 0, identical: false, digest: null, contextTracks: null, disagreeing: [] };
  const digests = sides.map((s) => contextDigest(s));
  const first = digests[0];
  const disagreeing = digests.filter((d) => d.digest !== first.digest).map((d) => d.digest);
  return {
    sides: sides.length,
    identical: disagreeing.length === 0,
    digest: first.digest,
    contextTracks: first.contextTracks,
    disagreeing: [...new Set(disagreeing)],
  };
}
