/**
 * Shared analysis layer for the note-level critic dimensions (B-05a).
 *
 * Everything here is derived from the notes, the Song Model's timeline and
 * the plan — once per evaluation — so that each dimension reads one
 * `CriticContext` instead of re-deriving bars, chords, sections and parts.
 *
 * Conventions every dimension follows:
 *  - observations are located to bars (1-based, inclusive) and track ids;
 *  - `confidence` and `originConfidence` come from `confidenceFromCount`
 *    (evidence quantity), optionally scaled by evidence quality — never typed;
 *  - the score is `scoreFromObservations` — a documented, monotone summary of
 *    the observations, never an independent judgement;
 *  - `controlStatus` is read from the generated ledger, never written by hand.
 */
import type {
  ArrangementPlan,
  InstrumentRoleAssignment,
  MusicalNote,
  SongModelData,
  TrackModel,
} from "@workspace/db";
import { parseChordTones, type ChordTones } from "../../voiceLeading";
import { parseKeyName } from "../../symbolicCorruptions";
import { classifySectionFunction } from "../../globalArrangementPlanner";
import type {
  ControlStatus,
  CriticDimensionReport,
  CriticInput,
  CriticObservation,
  ObservationLocation,
  OriginLayer,
  RecommendedRepair,
  Severity,
} from "../types";
import { SEVERITY_ORDER } from "../types";
import { CONTROL_LEDGER } from "./controlLedger";

// ---------------------------------------------------------------------------
// Numbers
// ---------------------------------------------------------------------------

export const round = (v: number, digits = 4): number => Number(v.toFixed(digits));
export const clamp01 = (v: number): number => (v < 0 ? 0 : v > 1 ? 1 : v);
export const mean = (values: readonly number[]): number =>
  values.length ? values.reduce((a, b) => a + b, 0) / values.length : 0;
export const stddev = (values: readonly number[]): number => {
  if (values.length < 2) return 0;
  const m = mean(values);
  return Math.sqrt(mean(values.map((v) => (v - m) ** 2)));
};
export const median = (values: readonly number[]): number => {
  if (!values.length) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
};
export const pc = (pitch: number): number => ((Math.round(pitch) % 12) + 12) % 12;

/**
 * Confidence from evidence quantity: 1 − e^(−n / saturation), capped at 0.95.
 * `saturation` is the count at which the critic is ~63 % sure; a dimension
 * states it per claim (e.g. 24 notes for a chord-tone share, 6 bars for a
 * texture claim). Zero evidence is zero confidence.
 */
export function confidenceFromCount(n: number, saturation: number, quality = 1): number {
  if (n <= 0 || saturation <= 0) return 0;
  return round(Math.min(0.95, (1 - Math.exp(-n / saturation)) * clamp01(quality)), 3);
}

// ---------------------------------------------------------------------------
// Context
// ---------------------------------------------------------------------------

export type PartFamily =
  | "drums" | "percussion" | "bass" | "keys" | "guitar" | "strings" | "brass" | "winds" | "synth" | "voice" | "other";

export type SectionFunction =
  | "intro" | "verse" | "prechorus" | "chorus" | "bridge" | "breakdown" | "outro" | "instrumental" | "neutral";

export type BarInfo = { bar: number; start: number; end: number; beats: number; beatSeconds: number };

export type SectionInfo = {
  name: string;
  startBar: number;
  endBar: number;
  function: SectionFunction;
  /** Planned targets when the plan carries them; the Song Model's energy otherwise. */
  energy: number;
  density: number | null;
  tension: number | null;
  /** Section-type occurrence index (Chorus = 1, Chorus 2 = 2 …). */
  occurrence: number;
};

export type ChordInfo = {
  index: number;
  start: number;
  end: number;
  startBar: number;
  endBar: number;
  symbol: string;
  tones: ChordTones | null;
  pitchClasses: Set<number>;
  rootPc: number | null;
  confidence: number;
};

export type NoteRef = {
  note: MusicalNote;
  start: number;
  end: number;
  duration: number;
  pitch: number;
  velocity: number;
  pc: number;
  /** 1-based bar of the onset. */
  bar: number;
  /** Onset position inside the bar, in beats (0-based, fractional). */
  beat: number;
  beatSeconds: number;
};

export type PartInfo = {
  id: string;
  track: TrackModel;
  instrument: string;
  role: string;
  family: PartFamily;
  percussive: boolean;
  notes: NoteRef[];
  plannedRoles: InstrumentRoleAssignment[];
  playableRange: { min: number; max: number };
  comfortableRange: { min: number; max: number };
  maxVoices: number;
};

export type VocalInfo = {
  notes: Array<{ start: number; end: number; pitch: number }>;
  phrases: Array<{ start: number; end: number }>;
  range: { low: number; high: number } | null;
  /** True when the Song Model's vocal evidence or phrase detection says the lead is sung; false when it is the source's lead line without vocal evidence. */
  isVocal: boolean;
};

export type CriticContext = {
  input: CriticInput;
  songModel: SongModelData;
  plan: ArrangementPlan;
  bars: BarInfo[];
  totalBars: number;
  songStart: number;
  songEnd: number;
  sections: SectionInfo[];
  chords: ChordInfo[];
  keyName: string | null;
  keyPcs: Set<number> | null;
  parts: PartInfo[];
  pitched: PartInfo[];
  percussive: PartInfo[];
  vocal: VocalInfo | null;
  barAt(time: number): number;
  barInfo(bar: number): BarInfo | null;
  sectionOfBar(bar: number): SectionInfo | null;
  chordsOverlapping(start: number, end: number): Array<{ chord: ChordInfo; overlap: number }>;
  chordAt(time: number): ChordInfo | null;
  notesInBars(part: PartInfo, startBar: number, endBar: number): NoteRef[];
  vocalPitchAt(time: number): number | null;
  vocalActiveAt(time: number): boolean;
  /**
   * Mean simultaneous voices per onset in the composed notes of a part over a
   * bar range — `null` when the caller passed no composed notes (B-05c). A
   * dimension that reads it must state in its evidence which case it is in.
   */
  composedVoicesOf(part: PartInfo, startBar: number, endBar: number): number | null;
  /**
   * The composed notes of a part over a bar range, as `NoteRef`s on the same
   * bar grid — `null` when the caller passed none. This is the isolating
   * control R-1a P1-1 asked for, available to any dimension: a defect present
   * in these notes did not come from the performance stage.
   */
  composedNotesInBars(part: PartInfo, startBar: number, endBar: number): NoteRef[] | null;
};

const MAJOR_SCALE = [0, 2, 4, 5, 7, 9, 11];
const MINOR_SCALE = [0, 2, 3, 5, 7, 8, 10];

/** Family from the palette/instrument *name* first: the definition can lie (see the lead notes: keys + RHYTHMIC_HARMONY resolves to a drum kit). */
export function partFamilyOf(track: Pick<TrackModel, "instrument" | "instrumentDefinition" | "role">): PartFamily {
  const name = track.instrument.toLowerCase();
  if (/drum|kit/.test(name)) return "drums";
  if (/perc/.test(name)) return "percussion";
  if (/bass/.test(name)) return "bass";
  if (/string|violin|cello|viola/.test(name)) return "strings";
  if (/brass|horn|trumpet|trombone|tuba/.test(name)) return "brass";
  if (/wind|flute|oboe|clarinet|bassoon|sax|reed|pipe/.test(name)) return "winds";
  if (/guitar/.test(name)) return "guitar";
  if (/synth|pad/.test(name)) return "synth";
  if (/voc|voice|choir/.test(name)) return "voice";
  if (/key|piano|organ|ensemble|rhodes|harp/.test(name)) return "keys";
  const family = track.instrumentDefinition?.family;
  if (family === "drums") return /rhythm/i.test(track.role) && !/drum/.test(name) ? "keys" : "drums";
  if (family === "keys" || family === "guitar" || family === "strings" || family === "brass" ||
    family === "winds" || family === "synth" || family === "voice") return family;
  return "other";
}

function buildBars(songModel: SongModelData): BarInfo[] {
  const raw = (songModel.bars ?? []).filter((b) => b.end > b.start);
  if (raw.length) {
    return raw.map((b) => ({
      bar: b.bar,
      start: b.start,
      end: b.end,
      beats: Math.max(1, b.beats || 4),
      beatSeconds: (b.end - b.start) / Math.max(1, b.beats || 4),
    })).sort((a, b) => a.start - b.start);
  }
  // No bar map: derive from tempo + meter over the audio duration.
  const bpm = songModel.tempoMap?.[0]?.bpm ?? 120;
  const meter = songModel.meterMap?.[0]?.meter ?? "4/4";
  const num = Number(meter.split("/")[0]) || 4;
  const den = Number(meter.split("/")[1]) || 4;
  const beatSeconds = (60 / bpm) * (4 / den);
  const barSeconds = beatSeconds * num;
  const duration = songModel.audio?.durationSeconds ?? songModel.analysisDurationSeconds ?? 0;
  const count = Math.max(1, Math.ceil(duration / barSeconds));
  return Array.from({ length: count }, (_, i) => ({
    bar: i + 1, start: i * barSeconds, end: (i + 1) * barSeconds, beats: num, beatSeconds,
  }));
}

function buildSections(songModel: SongModelData, plan: ArrangementPlan, totalBars: number): SectionInfo[] {
  const planned = plan.sectionPlan?.sections ?? [];
  const targets = plan.globalPlan?.sectionTargets ?? [];
  const base: Array<Omit<SectionInfo, "occurrence">> = planned.length
    ? planned.map((s) => ({
        name: s.sectionName, startBar: s.startBar, endBar: s.endBar,
        function: s.function, energy: s.energy, density: s.density, tension: s.tension,
      }))
    : (songModel.sections ?? []).map((s) => {
        const target = targets.find((t) => t.sectionName === s.name);
        return {
          name: s.name, startBar: s.startBar, endBar: s.endBar,
          function: classifySectionFunction(s.name) as SectionFunction,
          energy: target?.energy ?? s.energy ?? 0.5,
          density: target?.density ?? null,
          tension: target?.tension ?? null,
        };
      });
  const sorted = base
    .filter((s) => s.endBar >= s.startBar)
    .map((s) => ({ ...s, startBar: Math.max(1, s.startBar), endBar: Math.min(totalBars, s.endBar) }))
    .sort((a, b) => a.startBar - b.startBar);
  if (!sorted.length) {
    sorted.push({ name: "Song", startBar: 1, endBar: totalBars, function: "neutral", energy: 0.5, density: null, tension: null });
  }
  const seen = new Map<SectionFunction, number>();
  return sorted.map((s) => {
    const occurrence = (seen.get(s.function) ?? 0) + 1;
    seen.set(s.function, occurrence);
    return { ...s, occurrence };
  });
}

function buildChords(songModel: SongModelData, bars: BarInfo[], barAt: (t: number) => number): ChordInfo[] {
  const list = (songModel.chords ?? []).filter((c) => c.end > c.start).slice().sort((a, b) => a.start - b.start);
  return list.map((c, index) => {
    const tones = parseChordTones(c.symbol) ?? (c.root ? parseChordTones(`${c.root}${qualitySuffix(c.quality)}`) : null);
    return {
      index,
      start: c.start,
      end: c.end,
      startBar: barAt(c.start),
      endBar: barAt(Math.max(c.start, c.end - 1e-3)),
      symbol: c.symbol,
      tones,
      pitchClasses: new Set(tones?.pitchClasses ?? []),
      rootPc: tones?.root ?? null,
      confidence: typeof c.confidence === "number" ? clamp01(c.confidence) : 0.5,
    };
  }).filter((c) => bars.length === 0 || c.start < bars[bars.length - 1].end);
}

function qualitySuffix(quality: string | undefined): string {
  const q = (quality ?? "").toLowerCase();
  if (q === "min" || q === "m" || q === "minor") return "m";
  if (q === "min7" || q === "m7") return "m7";
  if (q === "maj7") return "maj7";
  if (q === "7" || q === "dom7") return "7";
  if (q === "dim") return "dim";
  if (q.startsWith("sus")) return q;
  return "";
}

function keyScale(songModel: SongModelData): { name: string | null; pcs: Set<number> | null } {
  const key = songModel.keyMap?.[0]?.key ?? null;
  if (!key) return { name: null, pcs: null };
  const parsed = parseKeyName(key);
  if (!parsed) return { name: key, pcs: null };
  const scale = parsed.mode === "minor" ? MINOR_SCALE : MAJOR_SCALE;
  return { name: key, pcs: new Set(scale.map((d) => (parsed.tonic + d) % 12)) };
}

function buildVocal(songModel: SongModelData): VocalInfo | null {
  const notes = (songModel.melody ?? [])
    .filter((n) => n.end > n.start)
    .map((n) => ({ start: n.start, end: n.end, pitch: n.pitch }))
    .sort((a, b) => a.start - b.start);
  if (!notes.length) return null;
  const events = songModel.vocalIntelligence?.phrases?.events ?? [];
  let phrases: Array<{ start: number; end: number }> = events
    .filter((e) => e.end > e.start)
    .map((e) => ({ start: e.start, end: e.end }));
  if (!phrases.length) {
    // Group sung notes into phrases at gaps longer than a second.
    phrases = [];
    for (const n of notes) {
      const last = phrases[phrases.length - 1];
      if (last && n.start - last.end < 1) last.end = Math.max(last.end, n.end);
      else phrases.push({ start: n.start, end: n.end });
    }
  }
  const pitches = notes.map((n) => n.pitch);
  const isVocal = songModel.vocalEvidence?.status === "detected" || songModel.vocalIntelligence?.phrases?.status === "detected";
  return { notes, phrases, range: { low: Math.min(...pitches), high: Math.max(...pitches) }, isVocal };
}

/** Comfortable / playable ranges by family, used when the instrument definition names a different family than the part (see the lead notes: keys + RHYTHMIC_HARMONY resolves to a drum kit). */
const FAMILY_RANGES: Record<PartFamily, { playable: [number, number]; comfortable: [number, number] }> = {
  drums: { playable: [35, 81], comfortable: [35, 81] },
  percussion: { playable: [35, 81], comfortable: [35, 81] },
  bass: { playable: [28, 67], comfortable: [36, 60] },
  keys: { playable: [21, 108], comfortable: [36, 96] },
  guitar: { playable: [40, 88], comfortable: [45, 84] },
  strings: { playable: [28, 103], comfortable: [36, 96] },
  brass: { playable: [40, 84], comfortable: [46, 79] },
  winds: { playable: [48, 96], comfortable: [55, 91] },
  synth: { playable: [24, 108], comfortable: [36, 96] },
  voice: { playable: [40, 84], comfortable: [48, 79] },
  other: { playable: [0, 127], comfortable: [0, 127] },
};

function effectiveRanges(track: TrackModel, family: PartFamily): { playable: { min: number; max: number }; comfortable: { min: number; max: number }; maxVoices: number } {
  const def = track.instrumentDefinition;
  const defFamily = def?.family;
  const agrees = Boolean(def) && (defFamily === family || (family === "bass" && defFamily === "strings") || (family === "percussion" && defFamily === "drums"));
  if (agrees && def) {
    return { playable: def.playableRange, comfortable: def.comfortableRange, maxVoices: def.maxVoices };
  }
  const fallback = FAMILY_RANGES[family];
  return {
    playable: { min: fallback.playable[0], max: fallback.playable[1] },
    comfortable: { min: fallback.comfortable[0], max: fallback.comfortable[1] },
    maxVoices: family === "bass" ? 2 : family === "drums" || family === "percussion" ? 4 : 8,
  };
}

/** The role a part holds in a section: the plan's assignment when it has one, else the track's role. */
export function roleInSection(part: PartInfo, sectionName: string): string {
  return (part.plannedRoles.find((r) => r.sectionName === sectionName)?.role ?? part.role).toUpperCase();
}

/**
 * One note on the bar grid. Shared by the shipped tracks and (B-05c) by the
 * composed ones, so a dimension compares like with like.
 *
 * A downbeat the performance pushed a few milliseconds early is still the
 * downbeat: the onset belongs to the bar of its nearest sixteenth, not to the
 * bar the raw clock time falls in.
 */
function noteRefOn(
  barAt: (time: number) => number,
  barInfo: (bar: number) => BarInfo | null,
  bars: BarInfo[],
): (note: MusicalNote) => NoteRef {
  return (note: MusicalNote): NoteRef => {
    let bar = barAt(note.start);
    let info = barInfo(bar) ?? bars[0];
    if (info) {
      const step = Math.round((note.start - info.start) / (info.beatSeconds / 4));
      const next = barInfo(bar + 1);
      if (step >= info.beats * 4 && next) {
        bar = next.bar;
        info = next;
      }
    }
    const beatSeconds = info?.beatSeconds ?? 0.5;
    const duration = Math.max(0, note.duration);
    return {
      note,
      start: note.start,
      end: note.start + duration,
      duration,
      pitch: note.pitch,
      velocity: note.velocity,
      pc: pc(note.pitch),
      bar,
      beat: info ? (note.start - info.start) / beatSeconds : 0,
      beatSeconds,
    };
  };
}

const contextCache = new WeakMap<CriticInput, CriticContext>();

/** Derived once per input object (a pure function of it); every dimension reads the same context. */
export function buildContext(input: CriticInput): CriticContext {
  const cached = contextCache.get(input);
  if (cached) return cached;
  const built = deriveContext(input);
  contextCache.set(input, built);
  return built;
}

function deriveContext(input: CriticInput): CriticContext {
  const { songModel, plan } = input;
  const bars = buildBars(songModel);
  const totalBars = bars.length;
  const songStart = bars[0]?.start ?? 0;
  const songEnd = bars[bars.length - 1]?.end ?? 0;

  const barAt = (time: number): number => {
    if (!bars.length) return 1;
    if (time < bars[0].start) return bars[0].bar;
    let lo = 0;
    let hi = bars.length - 1;
    while (lo < hi) {
      const mid = (lo + hi + 1) >> 1;
      if (bars[mid].start <= time + 1e-6) lo = mid; else hi = mid - 1;
    }
    return bars[lo].bar;
  };
  const barInfo = (bar: number): BarInfo | null => bars.find((b) => b.bar === bar) ?? null;

  const sections = buildSections(songModel, plan, totalBars);
  const sectionOfBar = (bar: number): SectionInfo | null =>
    sections.find((s) => bar >= s.startBar && bar <= s.endBar) ?? null;

  const chords = buildChords(songModel, bars, barAt);
  const chordsOverlapping = (start: number, end: number) => {
    const out: Array<{ chord: ChordInfo; overlap: number }> = [];
    for (const chord of chords) {
      if (chord.end <= start) continue;
      if (chord.start >= end) break;
      const overlap = Math.min(end, chord.end) - Math.max(start, chord.start);
      if (overlap > 1e-6) out.push({ chord, overlap });
    }
    return out;
  };
  const chordAt = (time: number): ChordInfo | null =>
    chords.find((c) => c.start <= time + 1e-6 && c.end > time + 1e-6) ?? null;

  const { name: keyName, pcs: keyPcs } = keyScale(songModel);
  const roleAssignments = plan.sectionPlan?.roleAssignments ?? [];

  const parts: PartInfo[] = input.trackModels
    .filter((t) => t.notes.length > 0)
    .map((track) => {
      const family = partFamilyOf(track);
      const notes: NoteRef[] = track.notes
        .filter((n) => Number.isFinite(n.start) && Number.isFinite(n.pitch))
        .map(noteRefOn(barAt, barInfo, bars))
        .sort((a, b) => a.start - b.start || a.pitch - b.pitch);
      const instrumentKey = track.instrument.toLowerCase();
      const ranges = effectiveRanges(track, family);
      return {
        id: track.id,
        track,
        instrument: track.instrument,
        role: track.role,
        family,
        percussive: family === "drums" || family === "percussion",
        notes,
        plannedRoles: roleAssignments.filter((r) => r.instrument.toLowerCase() === instrumentKey),
        playableRange: ranges.playable,
        comfortableRange: ranges.comfortable,
        maxVoices: ranges.maxVoices,
      };
    })
    .sort((a, b) => a.id.localeCompare(b.id));

  // B-05c: the composed notes, when the caller has them, keyed by track id and
  // placed on the same bar grid as the shipped ones.
  const composedById = new Map<string, NoteRef[]>();
  for (const t of input.composedTrackModels ?? []) composedById.set(t.id, t.notes.map(noteRefOn(barAt, barInfo, bars)).sort((a, b) => a.start - b.start || a.pitch - b.pitch));
  const composedNotesInBars = (part: PartInfo, startBar: number, endBar: number): NoteRef[] | null => {
    const notes = composedById.get(part.id);
    if (!notes) return null;
    return notes.filter((n) => n.bar >= startBar && n.bar <= endBar);
  };
  const composedVoicesOf = (part: PartInfo, startBar: number, endBar: number): number | null => {
    const inRange = composedNotesInBars(part, startBar, endBar);
    if (!inRange || !inRange.length) return null;
    const clusters = onsetClusters(inRange);
    return clusters.length ? mean(clusters.map((c) => c.length)) : null;
  };

  const vocal = buildVocal(songModel);
  const vocalPitchAt = (time: number): number | null => {
    if (!vocal) return null;
    const hit = vocal.notes.find((n) => n.start <= time + 1e-6 && n.end > time + 1e-6);
    return hit ? hit.pitch : null;
  };
  const vocalActiveAt = (time: number): boolean =>
    Boolean(vocal && vocal.phrases.some((p) => p.start <= time + 1e-6 && p.end > time + 1e-6));

  return {
    input,
    songModel,
    plan,
    bars,
    totalBars,
    songStart,
    songEnd,
    sections,
    chords,
    keyName,
    keyPcs,
    parts,
    pitched: parts.filter((p) => !p.percussive),
    percussive: parts.filter((p) => p.percussive),
    vocal,
    barAt,
    barInfo,
    sectionOfBar,
    chordsOverlapping,
    chordAt,
    notesInBars: (part, startBar, endBar) => part.notes.filter((n) => n.bar >= startBar && n.bar <= endBar),
    vocalPitchAt,
    vocalActiveAt,
    composedVoicesOf,
    composedNotesInBars,
  };
}

// ---------------------------------------------------------------------------
// Note-level helpers shared by several dimensions
// ---------------------------------------------------------------------------

/** Onset clusters: notes starting within `window` seconds of each other (a chord, a strum). */
export function onsetClusters(notes: readonly NoteRef[], window = 0.03): NoteRef[][] {
  const clusters: NoteRef[][] = [];
  for (const n of notes) {
    const last = clusters[clusters.length - 1];
    if (last && n.start - last[0].start <= window) last.push(n);
    else clusters.push([n]);
  }
  return clusters.map((c) => c.slice().sort((a, b) => a.pitch - b.pitch));
}

/** The top voice of a part: the highest note of every onset cluster. */
export function topVoice(notes: readonly NoteRef[]): NoteRef[] {
  return onsetClusters(notes).map((c) => c[c.length - 1]);
}

/** The bottom voice of a part: the lowest note of every onset cluster. */
export function bottomVoice(notes: readonly NoteRef[]): NoteRef[] {
  return onsetClusters(notes).map((c) => c[0]);
}

/** Notes sounding at `time` (onset ≤ time < end). */
export function soundingAt(notes: readonly NoteRef[], time: number): NoteRef[] {
  return notes.filter((n) => n.start <= time + 1e-6 && n.end > time + 1e-6);
}

/** Nearest grid line at `stepsPerBeat` and the signed deviation in seconds. */
export function gridDeviation(n: NoteRef, stepsPerBeat: number): { step: number; deviationSeconds: number } {
  const stepBeats = 1 / stepsPerBeat;
  const step = Math.round(n.beat / stepBeats);
  const deviationSeconds = (n.beat - step * stepBeats) * n.beatSeconds;
  return { step, deviationSeconds };
}

/** Pitch band of a MIDI pitch (octave bands from C). */
export type PitchBand = "sub" | "low" | "low_mid" | "mid" | "upper_mid" | "high" | "very_high";
export function pitchBand(pitch: number): PitchBand {
  if (pitch < 36) return "sub";
  if (pitch < 48) return "low";
  if (pitch < 60) return "low_mid";
  if (pitch < 72) return "mid";
  if (pitch < 84) return "upper_mid";
  if (pitch < 96) return "high";
  return "very_high";
}

/** Ghost notes (performance-added flams and ghosts: very short and very quiet) are not material: they are left out of signatures. A quiet but full-length hi-hat is material. */
export const GHOST_VELOCITY = 32;
export const GHOST_DURATION_SECONDS = 0.08;
export const isGhost = (n: NoteRef): boolean => n.velocity < GHOST_VELOCITY && n.duration < GHOST_DURATION_SECONDS;
const signatureStep = (n: NoteRef, stepsPerBeat: number): number => Math.max(0, Math.round(n.beat * stepsPerBeat));

/** Bar-signature of a part's bar: onset step + pitch pairs (order-free). */
export function barSignature(notes: readonly NoteRef[], bar: number, stepsPerBeat = 4, relativePitch = false): string {
  const inBar = notes.filter((n) => n.bar === bar && !isGhost(n));
  if (!inBar.length) return "";
  const base = relativePitch ? Math.min(...inBar.map((n) => n.pitch)) : 0;
  return inBar
    .map((n) => `${signatureStep(n, stepsPerBeat)}:${n.pitch - base}`)
    .sort()
    .join(",");
}

/** Rhythm-only signature of a bar. */
export function rhythmSignature(notes: readonly NoteRef[], bar: number, stepsPerBeat = 4): string {
  const steps = new Set(notes.filter((n) => n.bar === bar && !isGhost(n)).map((n) => signatureStep(n, stepsPerBeat)));
  return [...steps].sort((a, b) => a - b).join(",");
}

/** Merge contiguous bar numbers into [start, end] runs. */
export function barRuns(bars: readonly number[]): Array<[number, number]> {
  const sorted = [...new Set(bars)].sort((a, b) => a - b);
  const runs: Array<[number, number]> = [];
  for (const bar of sorted) {
    const last = runs[runs.length - 1];
    if (last && bar === last[1] + 1) last[1] = bar;
    else runs.push([bar, bar]);
  }
  return runs;
}

// ---------------------------------------------------------------------------
// Observations and reports
// ---------------------------------------------------------------------------

export type ObservationDraft = {
  kind: string;
  severity: Severity;
  location: ObservationLocation;
  evidence: Record<string, number | string | boolean>;
  suspectedOrigin: OriginLayer;
  originConfidence: number;
  recommendedRepair: RecommendedRepair | null;
  confidence: number;
};

export function observationId(dimension: string, draft: Pick<ObservationDraft, "kind" | "location">): string {
  const track = draft.location.trackIds.length ? draft.location.trackIds.join("+") : "*";
  return `${dimension}:${draft.kind}:${track}:${draft.location.startBar}-${draft.location.endBar}`;
}

/**
 * Score summary of the observations. Documented so the judge can invert it:
 *   penalty(o) = BASE[severity] × (0.4 + 0.6 × extent),  extent = bars(o) / totalBars
 *   score = max(0, 100 − Σ penalty), capped at 40 when any observation blocks.
 * `info` observations carry evidence and cost nothing.
 */
export const SEVERITY_PENALTY: Record<Severity, number> = { info: 0, minor: 6, major: 15, blocking: 35 };
export const BLOCKING_CAP = 40;

export function scoreFromObservations(observations: readonly CriticObservation[], totalBars: number): number {
  let penalty = 0;
  let blocking = false;
  for (const o of observations) {
    const bars = Math.max(1, o.location.endBar - o.location.startBar + 1);
    const extent = clamp01(bars / Math.max(1, totalBars));
    penalty += SEVERITY_PENALTY[o.severity] * (0.4 + 0.6 * extent);
    if (o.severity === "blocking") blocking = true;
  }
  const score = Math.max(0, 100 - penalty);
  return round(blocking ? Math.min(BLOCKING_CAP, score) : score, 2);
}

export function controlStatusOf(dimension: string): ControlStatus {
  return CONTROL_LEDGER[dimension]?.status ?? "uncalibrated";
}

export function severityAtLeast(a: Severity, b: Severity): boolean {
  return SEVERITY_ORDER[a] >= SEVERITY_ORDER[b];
}

export function maxSeverity(observations: readonly Pick<CriticObservation, "severity">[]): Severity | null {
  let best: Severity | null = null;
  for (const o of observations) if (!best || SEVERITY_ORDER[o.severity] > SEVERITY_ORDER[best]) best = o.severity;
  return best;
}

export function buildReport(input: {
  dimension: string;
  version: string;
  context: CriticContext;
  drafts: ObservationDraft[];
  coverage: number;
  applicable?: boolean;
  reasonIfNot?: string;
}): CriticDimensionReport {
  const applicable = input.applicable ?? true;
  const sorted = [...input.drafts].sort((a, b) =>
    a.location.startBar - b.location.startBar ||
    a.location.endBar - b.location.endBar ||
    a.location.trackIds.join("+").localeCompare(b.location.trackIds.join("+")) ||
    a.kind.localeCompare(b.kind) ||
    SEVERITY_ORDER[b.severity] - SEVERITY_ORDER[a.severity]);
  const seen = new Map<string, number>();
  const observations: CriticObservation[] = sorted.map((draft) => {
    const base = observationId(input.dimension, draft);
    const n = (seen.get(base) ?? 0) + 1;
    seen.set(base, n);
    return {
      id: n === 1 ? base : `${base}#${n}`,
      dimension: input.dimension,
      kind: draft.kind,
      severity: draft.severity,
      location: {
        startBar: draft.location.startBar,
        endBar: draft.location.endBar,
        ...(draft.location.sectionName ? { sectionName: draft.location.sectionName } : {}),
        trackIds: [...draft.location.trackIds],
      },
      evidence: roundEvidence(draft.evidence),
      suspectedOrigin: draft.suspectedOrigin,
      originConfidence: round(clamp01(draft.originConfidence), 3),
      recommendedRepair: draft.recommendedRepair,
      confidence: round(clamp01(draft.confidence), 3),
    };
  });
  return {
    dimension: input.dimension,
    version: input.version,
    applicable,
    ...(applicable ? {} : { reasonIfNot: input.reasonIfNot ?? "not applicable" }),
    observations,
    summary: {
      score0to100: applicable ? scoreFromObservations(observations, input.context.totalBars) : null,
      coverage: round(clamp01(input.coverage), 3),
      controlStatus: controlStatusOf(input.dimension),
    },
  };
}

function roundEvidence(evidence: Record<string, number | string | boolean>): Record<string, number | string | boolean> {
  const out: Record<string, number | string | boolean> = {};
  for (const key of Object.keys(evidence).sort()) {
    const v = evidence[key];
    out[key] = typeof v === "number" && Number.isFinite(v) ? round(v, 4) : v;
  }
  return out;
}

export function notApplicable(dimension: string, version: string, context: CriticContext, reason: string): CriticDimensionReport {
  return buildReport({ dimension, version, context, drafts: [], coverage: 0, applicable: false, reasonIfNot: reason });
}

/** Section covering a bar range, if one section contains it all. */
export function sectionNameFor(context: CriticContext, startBar: number, endBar: number): string | undefined {
  const s = context.sectionOfBar(startBar);
  return s && endBar <= s.endBar ? s.name : undefined;
}

/** Severity from a share against graded thresholds (minor ≥ t0, major ≥ t1, blocking ≥ t2). */
export function severityFromShare(share: number, thresholds: [number, number, number]): Severity | null {
  if (share >= thresholds[2]) return "blocking";
  if (share >= thresholds[1]) return "major";
  if (share >= thresholds[0]) return "minor";
  return null;
}
