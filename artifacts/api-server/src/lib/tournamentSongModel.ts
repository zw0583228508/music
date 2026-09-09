/**
 * A Song Model from a tournament task (Wave Q — Model Discovery, item 13).
 *
 * The platform's own composers do not read MIDI; they read a Song Model and a
 * `PartGenerationRequest` built by the real planners. To put
 * `REFERENCE_PART_COMPOSER` and `CONTEXT_AWARE_ARRANGER` into the tournament
 * on equal terms with an external model, the task is turned into the Song
 * Model the platform would have produced had it analysed these bars: the
 * shared estimated chords, the context tracks as melody/bass evidence, the
 * file's tempo and metre, and a key from the context notes.
 *
 * The model spans **only the window**, origin 0, so the planners see one
 * section and the composers write bars 1..n; the provider shifts the result
 * to absolute time. Everything the analysis cannot know here is marked
 * `not_available`, never faked — the same discipline as the benchmark corpus.
 */
import type { ChordHarmonyEvent, MusicalNote, SongModelData } from "@workspace/db";
import { keyFromNotes } from "./keyFromNotes";
import { canonicalizeSongModelCoordinates } from "./songModelValidation";
import { deriveMusicalMap } from "./songMusicalMap";
import type { TournamentTask, TournamentTrack } from "./tournamentTask";

export const TOURNAMENT_SONG_MODEL_SOURCE = "TOURNAMENT_TASK" as const;

/** Shift a note into window-relative time, clipping to the window. */
export function toWindowTime(note: MusicalNote, task: TournamentTask): MusicalNote | null {
  const start = Math.max(note.start, task.window.start);
  const end = Math.min(note.start + note.duration, task.window.end);
  if (end - start <= 1e-6) return null;
  return {
    ...note,
    start: Number((start - task.window.start).toFixed(4)),
    duration: Number((end - start).toFixed(4)),
  };
}

export function toAbsoluteTime(note: MusicalNote, task: TournamentTask): MusicalNote {
  return { ...note, start: Number((note.start + task.window.start).toFixed(4)) };
}

/** The context track that behaves most like a lead: highest median pitch among non-percussion tracks. */
export function leadContextTrack(task: TournamentTask): TournamentTrack | null {
  const pitched = task.contextTracks.filter((t) => !t.isPercussion && t.family !== "bass");
  if (!pitched.length) return null;
  const median = (t: TournamentTrack): number => {
    const p = t.notes.filter((n) => n.start < task.window.end && n.start + n.duration > task.window.start).map((n) => n.pitch).sort((a, b) => a - b);
    return p.length ? p[p.length >> 1] : -1;
  };
  return [...pitched].sort((a, b) => median(b) - median(a))[0];
}

export function songModelFromTask(task: TournamentTask): SongModelData {
  const beatsPerBar = task.meter.numerator;
  const totalBars = task.bars.length;
  const duration = Number((totalBars * task.barSeconds).toFixed(4));
  const windowed = (notes: readonly MusicalNote[]): MusicalNote[] =>
    notes.map((n) => toWindowTime(n, task)).filter((n): n is MusicalNote => n !== null);

  const chords: ChordHarmonyEvent[] = task.chords.map((c) => ({
    start: Number((c.start - task.window.start).toFixed(4)),
    end: Number((c.end - task.window.start).toFixed(4)),
    symbol: c.symbol,
    roman: "?",
    root: c.root,
    quality: c.quality,
    function: "unknown",
    confidence: c.confidence,
  }));

  const lead = leadContextTrack(task);
  const melody: SongModelData["melody"] = lead
    ? windowed(lead.notes).map((n) => ({
        start: n.start, end: Number((n.start + n.duration).toFixed(4)), pitch: n.pitch,
        velocity: n.velocity, confidence: 0.8, source: TOURNAMENT_SONG_MODEL_SOURCE,
      }))
    : [];
  const bassTrack = task.contextTracks.find((t) => t.family === "bass") ?? null;
  const bass: NonNullable<SongModelData["bass"]> = bassTrack
    ? windowed(bassTrack.notes).map((n) => ({
        start: n.start, end: Number((n.start + n.duration).toFixed(4)), pitch: n.pitch,
        confidence: 0.8, provider: TOURNAMENT_SONG_MODEL_SOURCE,
      }))
    : [];

  const keyNotes = task.contextTracks
    .filter((t) => !t.isPercussion)
    .flatMap((t) => windowed(t.notes))
    .map((n) => ({ start: n.start, duration: n.duration, pitch: n.pitch }));
  const key = keyFromNotes(keyNotes);

  const bars = task.bars.map((b, i) => ({
    bar: i + 1,
    start: Number((b.start - task.window.start).toFixed(4)),
    end: Number((b.end - task.window.start).toFixed(4)),
    beats: beatsPerBar,
    confidence: 1,
  }));
  const beats = Array.from({ length: totalBars * beatsPerBar }, (_, i) => ({
    time: Number((i * task.beatSeconds).toFixed(4)),
    beat: (i % beatsPerBar) + 1,
    bar: Math.floor(i / beatsPerBar) + 1,
    confidence: 1,
  }));

  const families = [...new Set(task.contextTracks.map((t) => t.family))];
  const unavailable = (reason: string) => ({ status: "not_available" as const, reason, events: [] });

  const model: SongModelData = {
    contractVersion: "2.0",
    timebase: { ppq: 960, originSeconds: 0, coordinateSystem: "seconds+ticks" },
    audio: {
      name: `${task.workId}-${task.id}.mid`, contentType: "audio/midi", size: 0,
      durationSeconds: duration, sampleRate: 44_100, channels: 2,
      proxyObjectPath: null, proxyContentType: null,
      analysisStartSeconds: 0, analysisDurationSeconds: duration, analysisCoverage: "full",
    },
    analysisStartSeconds: 0, analysisDurationSeconds: duration, analysisCoverage: 1,
    tempoMap: [{ time: 0, bpm: task.tempoBpm, confidence: 0.95 }],
    meterMap: [{ bar: 1, meter: `${task.meter.numerator}/${task.meter.denominator}`, confidence: 0.95 }],
    keyMap: key
      ? [{ time: 0, key: key.key, confidence: key.confidence }]
      : [{ time: 0, key: "C major", confidence: 0.05 }],
    melody, bass, chords,
    sections: [{ name: "Window", startBar: 1, endBar: totalBars, energy: 0.6 }],
    energy: Array.from({ length: totalBars }, () => 0.6),
    beats, bars,
    dynamics: Array.from({ length: totalBars }, () => 0.55),
    waveform: [],
    stems: families.map((role) => ({ name: role, role, source: TOURNAMENT_SONG_MODEL_SOURCE, channels: 1, confidence: 0.9 })),
    sourceStems: [],
    vocalEvidence: {
      status: "not_available", reason: "A symbolic score has no vocal stem.",
      provenance: null, sampleRate: null, channels: null, frameSizeSamples: null,
      thresholds: null, observedVoicedWindows: [], observedSilentWindows: [],
    },
    vocalIntelligence: {
      version: "1.0",
      provenance: null,
      phrases: unavailable("No vocal in a symbolic tournament task."),
      breaths: unavailable("No vocal in a symbolic tournament task."),
      lyricAlignment: { status: "not_available", reason: "The task carries no lyrics.", alignments: [] },
      melodyAlignment: { status: "not_available", reason: "Alignment is not derived for a task.", alignments: [] },
      arrangementSpace: { status: "not_available", reason: "Derived downstream, not specified.", windows: [] },
    },
    lyrics: [],
    confidenceByField: {},
    providerProvenance: [],
    validation: { status: "accepted", issues: [] },
    fusion: {
      selectedProvider: TOURNAMENT_SONG_MODEL_SOURCE,
      confidence: 0.9,
      decisions: [{ provider: TOURNAMENT_SONG_MODEL_SOURCE, status: "selected", confidence: 0.9, compatibility: 1, issues: [] }],
    },
  };
  const canonical = canonicalizeSongModelCoordinates(model);
  canonical.musicalMap = deriveMusicalMap(canonical, { now: new Date(0) });
  return canonicalizeSongModelCoordinates(canonical);
}
