/**
 * A minimal Standard MIDI File reader and writer (Wave Q, Q-05).
 *
 * The analyser already parses SMF into a Song Model. This reads it into
 * something flatter — notes with the program that played them, plus tempo and
 * time-signature changes — because a tokenizer needs the instrument and the
 * arrangement needs the metre, and it needs to write SMF back out for the
 * round-trip proof the training plan requires before any model is trained.
 *
 * Supported: format 0 and 1, tick division (not SMPTE), note on/off (including
 * note-on velocity 0 as note-off), program change, set-tempo, time-signature.
 * Everything else in a track is skipped rather than guessed at.
 */

export type MidiNote = {
  /** 0-based track index in the file. */
  track: number;
  channel: number;
  /** General MIDI program 0-127. Channel 9 is percussion regardless. */
  program: number;
  isPercussion: boolean;
  pitch: number;
  velocity: number;
  startTick: number;
  endTick: number;
};

export type MidiTempo = { tick: number; usPerQuarter: number; bpm: number };
export type MidiTimeSignature = { tick: number; numerator: number; denominator: number };
/**
 * A written key signature (meta 0x59). `fifths` is the sharps (+) / flats (−)
 * count; `minorFlag` is the file's mode byte, which notation exporters set
 * to 0 (major) regardless of the actual mode — read it, never trust it.
 */
export type MidiKeySignature = { tick: number; fifths: number; minorFlag: boolean };
/** A marker (meta 0x06) — a rehearsal mark or section label where an exporter wrote one. */
export type MidiMarker = { tick: number; text: string };

export type ParsedMidi = {
  ticksPerQuarter: number;
  format: number;
  trackCount: number;
  notes: MidiNote[];
  tempos: MidiTempo[];
  timeSignatures: MidiTimeSignature[];
  /** Last tick with any event, for bar-count maths. */
  endTick: number;
  /** Written key signatures, in tick order; absent from MIDI built in memory. */
  keySignatures?: MidiKeySignature[];
  /** Markers, in tick order; absent from MIDI built in memory. */
  markers?: MidiMarker[];
};

function readVarInt(bytes: Buffer, offset: number): [value: number, next: number] {
  let value = 0;
  let position = offset;
  for (let i = 0; i < 4; i += 1) {
    if (position >= bytes.length) throw new Error("truncated variable-length quantity");
    const byte = bytes[position];
    position += 1;
    value = (value << 7) | (byte & 0x7f);
    if (!(byte & 0x80)) return [value, position];
  }
  throw new Error("variable-length quantity longer than 4 bytes");
}

/**
 * Parse a Standard MIDI File. Throws on anything it does not understand rather
 * than returning a partial parse that looks complete.
 */
export function parseMidiFile(bytes: Buffer): ParsedMidi {
  if (bytes.length < 14 || bytes.toString("ascii", 0, 4) !== "MThd") {
    throw new Error("not a Standard MIDI File (no MThd)");
  }
  const headerLength = bytes.readUInt32BE(4);
  const format = bytes.readUInt16BE(8);
  const division = bytes.readUInt16BE(12);
  if (division & 0x8000) throw new Error("SMPTE-timed MIDI is not supported");
  if (!division) throw new Error("zero tick division");

  const notes: MidiNote[] = [];
  const tempos: MidiTempo[] = [];
  const timeSignatures: MidiTimeSignature[] = [];
  const keySignatures: MidiKeySignature[] = [];
  const markers: MidiMarker[] = [];
  let endTick = 0;
  let trackIndex = 0;
  let offset = 8 + headerLength;

  while (offset + 8 <= bytes.length && bytes.toString("ascii", offset, offset + 4) === "MTrk") {
    const trackLength = bytes.readUInt32BE(offset + 4);
    const trackEnd = Math.min(bytes.length, offset + 8 + trackLength);
    offset += 8;
    const currentTrack = trackIndex;
    trackIndex += 1;

    let tick = 0;
    let runningStatus = 0;
    // program per channel, so a note knows which instrument played it.
    const programByChannel = new Array(16).fill(0);
    const held = new Map<string, { startTick: number; velocity: number }>();

    while (offset < trackEnd) {
      const [delta, afterDelta] = readVarInt(bytes, offset);
      offset = afterDelta;
      tick += delta;
      endTick = Math.max(endTick, tick);

      let status = bytes[offset];
      if (status & 0x80) {
        offset += 1;
        if (status < 0xf0) runningStatus = status;
      } else {
        if (!runningStatus) throw new Error("running status with no prior status byte");
        status = runningStatus;
      }

      if (status === 0xff) {
        const metaType = bytes[offset];
        offset += 1;
        const [length, afterLength] = readVarInt(bytes, offset);
        offset = afterLength;
        const data = bytes.subarray(offset, offset + length);
        offset += length;
        if (metaType === 0x51 && length === 3) {
          const usPerQuarter = (data[0] << 16) | (data[1] << 8) | data[2];
          tempos.push({ tick, usPerQuarter, bpm: 60_000_000 / usPerQuarter });
        } else if (metaType === 0x58 && length >= 2) {
          timeSignatures.push({ tick, numerator: data[0], denominator: 2 ** data[1] });
        } else if (metaType === 0x59 && length >= 2) {
          keySignatures.push({ tick, fifths: data.readInt8(0), minorFlag: data[1] === 1 });
        } else if (metaType === 0x06 && length > 0) {
          markers.push({ tick, text: data.toString("latin1") });
        }
        // Other meta events (track name, lyrics, text) are ignored.
        continue;
      }

      if (status === 0xf0 || status === 0xf7) {
        const [length, afterLength] = readVarInt(bytes, offset);
        offset = afterLength + length;
        continue;
      }

      const command = status >> 4;
      const channel = status & 0x0f;
      const dataLength = command === 0xc || command === 0xd ? 1 : 2;
      const d0 = bytes[offset];
      const d1 = dataLength === 2 ? bytes[offset + 1] : 0;
      offset += dataLength;

      if (command === 0xc) {
        programByChannel[channel] = d0;
        continue;
      }
      if (command === 0x9 && d1 > 0) {
        held.set(`${channel}:${d0}`, { startTick: tick, velocity: d1 });
        continue;
      }
      if (command === 0x8 || (command === 0x9 && d1 === 0)) {
        const key = `${channel}:${d0}`;
        const start = held.get(key);
        if (!start) continue;
        held.delete(key);
        notes.push({
          track: currentTrack,
          channel,
          program: channel === 9 ? 0 : programByChannel[channel],
          isPercussion: channel === 9,
          pitch: d0,
          velocity: start.velocity,
          startTick: start.startTick,
          endTick: Math.max(start.startTick + 1, tick),
        });
      }
    }
    // A note still held at end-of-track ends there.
    for (const [key, start] of held) {
      const pitch = Number(key.split(":")[1]);
      const channel = Number(key.split(":")[0]);
      notes.push({
        track: currentTrack, channel,
        program: channel === 9 ? 0 : programByChannel[channel],
        isPercussion: channel === 9,
        pitch, velocity: start.velocity,
        startTick: start.startTick, endTick: Math.max(start.startTick + 1, tick),
      });
    }
    offset = trackEnd;
  }

  notes.sort((a, b) => a.startTick - b.startTick || a.pitch - b.pitch || a.track - b.track);
  if (!tempos.length) tempos.push({ tick: 0, usPerQuarter: 500_000, bpm: 120 });
  if (!timeSignatures.length) timeSignatures.push({ tick: 0, numerator: 4, denominator: 4 });

  return {
    ticksPerQuarter: division,
    format,
    trackCount: trackIndex,
    notes,
    tempos: tempos.sort((a, b) => a.tick - b.tick),
    timeSignatures: timeSignatures.sort((a, b) => a.tick - b.tick),
    endTick,
    keySignatures: keySignatures.sort((a, b) => a.tick - b.tick),
    markers: markers.sort((a, b) => a.tick - b.tick),
  };
}

// ---------------------------------------------------------------------------
// Writing
// ---------------------------------------------------------------------------

function writeVarInt(value: number): number[] {
  if (value < 0) throw new Error("cannot encode a negative delta");
  const bytes = [value & 0x7f];
  let remaining = value >> 7;
  while (remaining > 0) {
    bytes.unshift((remaining & 0x7f) | 0x80);
    remaining >>= 7;
  }
  return bytes;
}

type TrackEvent = { tick: number; bytes: number[]; order: number };

/**
 * Write a format-1 SMF: one tempo/metre track, then one track per source
 * track, each note as a channel-0..15 on/off pair. Deterministic — the same
 * ParsedMidi produces the same bytes — so the round-trip proof compares like
 * with like.
 */
export function writeMidiFile(midi: Pick<ParsedMidi, "ticksPerQuarter" | "notes" | "tempos" | "timeSignatures">): Buffer {
  const trackIds = [...new Set(midi.notes.map((note) => note.track))].sort((a, b) => a - b);
  const chunks: Buffer[] = [];

  const metaEvents: TrackEvent[] = [];
  for (const tempo of midi.tempos) {
    const us = tempo.usPerQuarter;
    metaEvents.push({
      tick: tempo.tick, order: 0,
      bytes: [0xff, 0x51, 0x03, (us >> 16) & 0xff, (us >> 8) & 0xff, us & 0xff],
    });
  }
  for (const ts of midi.timeSignatures) {
    metaEvents.push({
      tick: ts.tick, order: 0,
      bytes: [0xff, 0x58, 0x04, ts.numerator, Math.round(Math.log2(ts.denominator)), 24, 8],
    });
  }
  chunks.push(encodeTrack(metaEvents));

  for (const trackId of trackIds) {
    const trackNotes = midi.notes.filter((note) => note.track === trackId);
    const events: TrackEvent[] = [];
    const program = trackNotes.find((note) => !note.isPercussion)?.program ?? 0;
    const channel = trackNotes.every((note) => note.isPercussion) ? 9 : 0;
    events.push({ tick: 0, order: 0, bytes: [0xc0 | channel, program] });
    for (const note of trackNotes) {
      // order: note-off before note-on at the same tick, so a repeated pitch
      // does not swallow itself.
      events.push({ tick: note.startTick, order: 2, bytes: [0x90 | channel, note.pitch, note.velocity] });
      events.push({ tick: note.endTick, order: 1, bytes: [0x80 | channel, note.pitch, 0] });
    }
    chunks.push(encodeTrack(events));
  }

  const header = Buffer.alloc(14);
  header.write("MThd", 0, "ascii");
  header.writeUInt32BE(6, 4);
  header.writeUInt16BE(1, 8);
  header.writeUInt16BE(trackIds.length + 1, 10);
  header.writeUInt16BE(midi.ticksPerQuarter, 12);

  return Buffer.concat([header, ...chunks]);
}

function encodeTrack(events: TrackEvent[]): Buffer {
  const sorted = [...events].sort((a, b) => a.tick - b.tick || a.order - b.order);
  const body: number[] = [];
  let lastTick = 0;
  for (const event of sorted) {
    body.push(...writeVarInt(event.tick - lastTick));
    body.push(...event.bytes);
    lastTick = event.tick;
  }
  body.push(...writeVarInt(0), 0xff, 0x2f, 0x00); // end of track

  const chunk = Buffer.alloc(8 + body.length);
  chunk.write("MTrk", 0, "ascii");
  chunk.writeUInt32BE(body.length, 4);
  Buffer.from(body).copy(chunk, 8);
  return chunk;
}
