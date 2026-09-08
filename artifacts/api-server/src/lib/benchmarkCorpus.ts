/**
 * Arrangement benchmark corpus (PR-18).
 *
 * A fixed, licence-clean set of songs to measure every build against. The cases
 * are **synthesised from explicit musical specifications** — key, tempo, meter,
 * form, progression, melodic contour — rather than transcribed from recordings,
 * so the corpus carries no third-party rights and is byte-reproducible.
 *
 * Coverage follows the master plan: pop, ballad, rock, dance, acoustic,
 * orchestral, ethnic, jazz-oriented and cinematic, across the input types the
 * studio accepts (full song, piano+vocal, vocal only, rough demo, MIDI).
 */
import type { SongModelData } from "@workspace/db";
import { deriveMusicalMap } from "./songMusicalMap";
import { canonicalizeSongModelCoordinates } from "./songModelValidation";

export type BenchmarkInputType =
  | "full_song" | "piano_vocal" | "vocal_only" | "rough_demo" | "midi";

export type BenchmarkCase = {
  id: string;
  genre: string;
  inputType: BenchmarkInputType;
  tempoBpm: number;
  meter: string;
  key: string;
  /** Section name + bar count, in order. */
  form: Array<[string, number]>;
  /** Roman-ish chord symbols cycled across each 2-bar slot. */
  progression: string[];
  /** Semitone offsets from the key root for the lead melody figure. */
  melodyFigure: number[];
  /** Stem roles the analysis is assumed to have separated. */
  stems: string[];
  /** Section energies, indexed with `form`. */
  energies: number[];
};

const KEY_ROOTS: Record<string, number> = {
  C: 0, G: 7, D: 2, A: 9, E: 4, F: 5, Bb: 10, Eb: 3, Am: 9, Em: 4, Dm: 2, Cm: 0,
};

export const BENCHMARK_CORPUS: BenchmarkCase[] = [
  {
    id: "pop-full", genre: "pop", inputType: "full_song", tempoBpm: 120, meter: "4/4", key: "C",
    form: [["Intro", 4], ["Verse", 8], ["Chorus", 8], ["Verse", 8], ["Chorus", 8], ["Outro", 4]],
    progression: ["C", "G", "Am", "F"], melodyFigure: [0, 4, 7, 4],
    stems: ["vocals", "drums", "bass", "keys"],
    energies: [0.2, 0.4, 0.85, 0.45, 0.92, 0.25],
  },
  {
    id: "ballad-piano-vocal", genre: "ballad", inputType: "piano_vocal", tempoBpm: 68, meter: "4/4", key: "F",
    form: [["Verse", 8], ["Chorus", 8], ["Bridge", 4], ["Chorus", 8]],
    progression: ["F", "Dm", "Bb", "C"], melodyFigure: [0, 2, 4, 2],
    stems: ["vocals", "keys"],
    energies: [0.25, 0.6, 0.4, 0.75],
  },
  {
    id: "rock-full", genre: "rock", inputType: "full_song", tempoBpm: 148, meter: "4/4", key: "E",
    form: [["Intro", 4], ["Verse", 8], ["Chorus", 8], ["Bridge", 8], ["Chorus", 8]],
    progression: ["E", "A", "C", "D"], melodyFigure: [0, 3, 5, 7],
    stems: ["vocals", "drums", "bass", "guitar"],
    energies: [0.5, 0.6, 0.95, 0.55, 0.98],
  },
  {
    id: "dance-full", genre: "dance", inputType: "full_song", tempoBpm: 126, meter: "4/4", key: "Am",
    form: [["Intro", 8], ["Verse", 8], ["Chorus", 8], ["Breakdown", 8], ["Chorus", 8]],
    progression: ["Am", "F", "C", "G"], melodyFigure: [0, 5, 7, 12],
    stems: ["vocals", "drums", "bass", "synth"],
    energies: [0.35, 0.55, 0.95, 0.3, 0.98],
  },
  {
    id: "acoustic-demo", genre: "acoustic", inputType: "rough_demo", tempoBpm: 92, meter: "4/4", key: "G",
    form: [["Verse", 8], ["Chorus", 8], ["Verse", 8], ["Chorus", 8]],
    progression: ["G", "Em", "C", "D"], melodyFigure: [0, 2, 4, 7],
    stems: ["vocals", "guitar"],
    energies: [0.3, 0.6, 0.35, 0.7],
  },
  {
    id: "orchestral-midi", genre: "orchestral", inputType: "midi", tempoBpm: 76, meter: "3/4", key: "D",
    form: [["Intro", 6], ["Verse", 12], ["Chorus", 12], ["Outro", 6]],
    progression: ["D", "Bb", "G", "A"], melodyFigure: [0, 4, 7, 11],
    stems: ["strings", "brass", "keys"],
    energies: [0.25, 0.45, 0.9, 0.3],
  },
  {
    id: "ethnic-vocal", genre: "ethnic", inputType: "vocal_only", tempoBpm: 104, meter: "7/8", key: "Dm",
    form: [["Verse", 8], ["Chorus", 8], ["Verse", 8]],
    progression: ["Dm", "Gm", "A", "Dm"], melodyFigure: [0, 1, 3, 5],
    stems: ["vocals"],
    energies: [0.4, 0.8, 0.5],
  },
  {
    id: "jazz-full", genre: "jazz", inputType: "full_song", tempoBpm: 132, meter: "4/4", key: "Bb",
    form: [["Verse", 16], ["Chorus", 16], ["Verse", 16]],
    progression: ["Bb", "Gm7", "Cm7", "F7"], melodyFigure: [0, 3, 7, 10],
    stems: ["vocals", "drums", "bass", "keys"],
    energies: [0.45, 0.75, 0.5],
  },
  {
    id: "cinematic-midi", genre: "cinematic", inputType: "midi", tempoBpm: 60, meter: "4/4", key: "Cm",
    form: [["Intro", 8], ["Verse", 8], ["Chorus", 8], ["Outro", 8]],
    progression: ["Cm", "Ab", "Eb", "Bb"], melodyFigure: [0, 3, 7, 3],
    stems: ["strings", "brass", "keys", "percussion"],
    energies: [0.15, 0.4, 0.95, 0.2],
  },
];

// ---------------------------------------------------------------------------

/** Build a deterministic Song Model from a benchmark specification. */
export function buildBenchmarkSongModel(spec: BenchmarkCase): SongModelData {
  const beatsPerBar = Number(spec.meter.split("/")[0]) || 4;
  const beatUnit = Number(spec.meter.split("/")[1]) || 4;
  const beatSeconds = (60 / spec.tempoBpm) * (4 / beatUnit);
  const barSeconds = beatSeconds * beatsPerBar;
  const totalBars = spec.form.reduce((sum, [, bars]) => sum + bars, 0);
  const duration = totalBars * barSeconds;
  const root = KEY_ROOTS[spec.key] ?? 0;

  const sections: SongModelData["sections"] = [];
  let cursor = 1;
  spec.form.forEach(([name, bars], index) => {
    sections.push({
      name: sections.some((s) => s.name === name) ? `${name} ${sections.filter((s) => s.name.startsWith(name)).length + 1}` : name,
      startBar: cursor,
      endBar: cursor + bars - 1,
      energy: spec.energies[index] ?? 0.5,
    });
    cursor += bars;
  });

  const bars = Array.from({ length: totalBars }, (_, i) => ({
    bar: i + 1, start: i * barSeconds, end: (i + 1) * barSeconds,
    beats: beatsPerBar, confidence: 1,
  }));
  const beats = Array.from({ length: totalBars * beatsPerBar }, (_, i) => ({
    time: i * beatSeconds,
    beat: (i % beatsPerBar) + 1,
    bar: Math.floor(i / beatsPerBar) + 1,
    confidence: 1,
  }));

  // Two bars per chord, cycling the progression.
  const chords: SongModelData["chords"] = [];
  for (let bar = 1; bar <= totalBars; bar += 2) {
    const symbol = spec.progression[Math.floor((bar - 1) / 2) % spec.progression.length];
    const quality = /m7/.test(symbol) ? "m7" : /7/.test(symbol) ? "7" : /m$/.test(symbol) ? "min" : "maj";
    chords.push({
      symbol,
      roman: "I",
      root: symbol.replace(/(m7|maj7|m|7)$/i, ""),
      quality,
      function: "tonic",
      start: (bar - 1) * barSeconds,
      end: Math.min(duration, (bar + 1) * barSeconds),
      confidence: 0.9,
    });
  }

  // A lead figure per 2-bar phrase, sitting in the singer's register.
  const melody: SongModelData["melody"] = [];
  const noteSeconds = beatSeconds * 0.9;
  for (let bar = 1; bar <= totalBars; bar += 2) {
    spec.melodyFigure.forEach((offset, k) => {
      const start = (bar - 1) * barSeconds + k * beatSeconds;
      if (start + noteSeconds > duration) return;
      melody.push({
        start, end: start + noteSeconds,
        pitch: 60 + root + offset,
        velocity: 92, confidence: 0.9, source: "BENCHMARK_SPEC",
      });
    });
  }

  const energy = Array.from({ length: totalBars }, (_, i) => {
    const section = sections.find((s) => i + 1 >= s.startBar && i + 1 <= s.endBar);
    return section?.energy ?? 0.5;
  });

  // Vocal evidence: for cases with a vocal stem, every melodic figure is one
  // sung phrase, with the gaps between them observed as silence. Cases without
  // a vocal stem stay explicitly unavailable rather than pretending.
  const hasVocals = spec.stems.includes("vocals");
  const phraseSpans: Array<{ start: number; end: number }> = [];
  if (hasVocals) {
    for (let i = 0; i < melody.length; i += spec.melodyFigure.length) {
      const group = melody.slice(i, i + spec.melodyFigure.length);
      if (!group.length) continue;
      const start = Number(group[0].start.toFixed(4));
      const end = Number(group[group.length - 1].end.toFixed(4));
      if (end > start) phraseSpans.push({ start, end });
    }
  }
  const silentSpans: Array<{ start: number; end: number }> = [];
  for (let i = 1; i < phraseSpans.length; i += 1) {
    const start = phraseSpans[i - 1].end;
    const end = phraseSpans[i].start;
    if (end - start > 0.05) silentSpans.push({ start, end });
  }
  const provenance = {
    sourceStemRole: "vocals",
    objectPath: `/objects/analysis/${spec.id}/vocals.wav`,
    provider: "BENCHMARK_SPEC",
  };
  const vocalEvidence: SongModelData["vocalEvidence"] = hasVocals && phraseSpans.length
    ? {
        status: "detected", reason: null, provenance,
        sampleRate: 44_100, channels: 1, frameSizeSamples: 2048,
        thresholds: { rms: 0.01, peak: 0.02, activitySample: 0.01, activityRatio: 0.2 },
        observedVoicedWindows: phraseSpans.map((s) => ({ ...s })),
        observedSilentWindows: silentSpans.map((s) => ({ ...s })),
      }
    : {
        status: "not_available",
        reason: "This benchmark case has no vocal stem.",
        provenance: null, sampleRate: null, channels: null, frameSizeSamples: null,
        thresholds: null, observedVoicedWindows: [], observedSilentWindows: [],
      };
  const unavailable = (reason: string) => ({ status: "not_available" as const, reason, events: [] });
  const vocalIntelligence: SongModelData["vocalIntelligence"] = {
    version: "1.0",
    provenance: hasVocals && phraseSpans.length ? provenance : null,
    phrases: hasVocals && phraseSpans.length
      ? {
          status: "detected" as const, reason: null,
          events: phraseSpans.map((s, i) => ({
            id: `phrase-${i + 1}`, start: s.start, end: s.end, confidence: 0.9,
          })),
        }
      : unavailable("No vocal stem in this benchmark case."),
    breaths: unavailable("Breath detection is not part of the synthesised corpus."),
    lyricAlignment: { status: "not_available", reason: "The corpus carries no lyrics.", alignments: [] },
    melodyAlignment: { status: "not_available", reason: "Alignment is not synthesised.", alignments: [] },
    arrangementSpace: {
      status: "not_available",
      reason: "Arrangement space is derived downstream, not specified.",
      windows: [],
    },
  };

  const model: SongModelData = {
    contractVersion: "2.0",
    timebase: { ppq: 960, originSeconds: 0, coordinateSystem: "seconds+ticks" },
    audio: {
      name: `${spec.id}.wav`, contentType: "audio/wav", size: 1_000_000,
      durationSeconds: duration, sampleRate: 44_100, channels: 2,
      proxyObjectPath: null, proxyContentType: null,
      analysisStartSeconds: 0, analysisDurationSeconds: duration, analysisCoverage: "full",
    },
    analysisStartSeconds: 0, analysisDurationSeconds: duration, analysisCoverage: 1,
    tempoMap: [{ time: 0, bpm: spec.tempoBpm, confidence: 0.95 }],
    meterMap: [{ bar: 1, meter: spec.meter, confidence: 0.95 }],
    keyMap: [{ time: 0, key: `${spec.key} ${spec.key.endsWith("m") ? "minor" : "major"}`, confidence: 0.9 }],
    melody, bass: [], chords, sections,
    energy, beats, bars,
    dynamics: energy.map((v) => v * 0.9),
    waveform: [],
    stems: spec.stems.map((role) => ({
      name: role, role, source: "benchmark", channels: 2, confidence: 0.9,
    })),
    sourceStems: [],
    vocalEvidence,
    vocalIntelligence,
    lyrics: [],
    confidenceByField: {},
    providerProvenance: [],
    validation: { status: "accepted", issues: [] },
    fusion: {
      selectedProvider: "BENCHMARK_SPEC",
      confidence: 0.9,
      decisions: [{
        provider: "BENCHMARK_SPEC", status: "selected",
        confidence: 0.9, compatibility: 1, issues: [],
      }],
    },
  };
  const canonical = canonicalizeSongModelCoordinates(model);
  canonical.musicalMap = deriveMusicalMap(canonical, { now: new Date(0) });
  return canonicalizeSongModelCoordinates(canonical);
}
