/**
 * ANALYSIS_GOLD_V1 — the truth set every analysis tournament scores against
 * (ANALYSIS ENGINE wave, Stream H, PR-81).
 *
 * Three truth tiers, never mixed:
 *
 *  - `SYNTHETIC_EXACT`: symbolic works rendered to audio; the truth is exact
 *    by construction for whatever the source carries (notes, tempo map, metre,
 *    beats; key/chords/sections where the work was composed from a chord
 *    sheet). A field the source does not carry is UNKNOWN, not estimated.
 *  - `REAL_AUDIO`: real recordings; truth only where a person verified it
 *    (`HUMAN_VERIFIED`), otherwise UNKNOWN.
 *  - `PROFESSIONAL_REAL_WORLD`: the owner's own uploads; registered with an
 *    empty truth and an annotation template. Nothing is invented.
 *
 * Coverage per domain is stated per item; the scorers refuse a domain whose
 * truth is UNKNOWN rather than scoring against a guess, and a score call that
 * mixes items from two tiers throws. Every partial credit (half/double tempo,
 * relative/parallel/fifth key, same-bar-length metre) is reported beside the
 * exact score, never folded into it.
 *
 * Pure TypeScript, no I/O: the build and score scripts wrap it.
 */

export const ANALYSIS_GOLD_VERSION = "ANALYSIS_GOLD_V1" as const;

export const GOLD_TIERS = ["SYNTHETIC_EXACT", "REAL_AUDIO", "PROFESSIONAL_REAL_WORLD"] as const;
export type GoldTier = (typeof GOLD_TIERS)[number];

export const GOLD_DOMAINS = ["tempo", "metre", "key", "chords", "notes", "beats", "downbeats", "sections"] as const;
export type GoldDomain = (typeof GOLD_DOMAINS)[number];

/**
 * How a domain's truth is known. `EXACT` is by construction (synthetic tier
 * only); `HUMAN_VERIFIED` is a person's annotation of a real recording (real
 * tiers only); `PARTIAL` is a constraint short of the answer (a written key
 * signature without the mode); `UNKNOWN` is no truth at all.
 */
export const COVERAGE_KINDS = ["EXACT", "HUMAN_VERIFIED", "PARTIAL", "UNKNOWN"] as const;
export type CoverageKind = (typeof COVERAGE_KINDS)[number];

// ---------------------------------------------------------------------------
// Truth types
// ---------------------------------------------------------------------------

export type TempoPoint = { time: number; bpm: number };
export type TempoTruth = {
  /** Beat-unit BPM in force for the longest time (the pulse `beats` ticks at). */
  bpm: number;
  /** Quarter-note BPM of the same segment; differs from `bpm` in compound metres (6/8: beat = dotted quarter). */
  quarterBpm: number;
  /** Step map in beat-unit BPM, from time 0; a single entry means constant tempo. */
  map: TempoPoint[];
  constant: boolean;
  durationSeconds: number;
  /** Deliberate traps a composed work sets (documentation, not scored). */
  traps?: string[];
};

export type MetreChange = { time: number; numerator: number; denominator: number };
export type MetreTruth = {
  numerator: number;
  denominator: number;
  /** Every written signature in force from time 0, including the first. */
  changes: MetreChange[];
  pickupBar: boolean;
  /** Beats in the anacrusis when `pickupBar` (beat units of the following metre). */
  pickupBeats?: number;
};

export type KeyMode = "major" | "minor";
export type KeyTruth = { tonic: string; pitchClass: number; mode: KeyMode };
export type KeySignatureTruth = { fifths: number };

export const CHORD_QUALITIES = ["maj", "min", "7", "maj7", "min7", "6", "min6", "dim", "dim7", "hdim7", "aug", "sus2", "sus4"] as const;
export type ChordQualityName = (typeof CHORD_QUALITIES)[number];
export type ChordTruth = {
  start: number;
  end: number;
  /** null with quality "N" is no chord. */
  root: string | null;
  quality: ChordQualityName | "N";
  /** Bass note name when it differs from the root (a slash chord); null means the root. */
  bass: string | null;
};

/** [start seconds, duration seconds, MIDI pitch, velocity] — compact, because a manifest carries tens of thousands. */
export type NoteTuple = [number, number, number, number];
export type NoteTrackTruth = { role: string; family: string; percussion: boolean; notes: NoteTuple[] };
export type NotesTruth = { tracks: NoteTrackTruth[] };

export type SectionTruth = { start: number; end: number; label: string };

export type GoldTruth = {
  tempo: TempoTruth | null;
  metre: MetreTruth | null;
  key: KeyTruth | null;
  keySignature: KeySignatureTruth | null;
  chords: ChordTruth[] | null;
  notes: NotesTruth | null;
  beats: number[] | null;
  downbeats: number[] | null;
  sections: SectionTruth[] | null;
};

export type TruthCoverage = Record<GoldDomain, CoverageKind>;

export type GoldStem = { role: string; family: string; path: string; sha256: string; bytes: number };
export type GoldAudio = {
  mix: { path: string; sha256: string; bytes: number };
  stems: GoldStem[];
  sampleRate: number;
  channels: number;
  durationSeconds: number;
  renderer: string;
};

export type GoldSource =
  | { kind: "composed"; generator: string; spec: string }
  | { kind: "pdmx"; pdmxId: string; midiPath: string; title?: string; composer?: string; license?: string; windowSeconds: number; trimmed: boolean }
  | { kind: "repo_fixture"; path: string; bytes: number; sha256: string; licenceNote: string }
  /** A public recording fetched for evaluation only (PR-90): the licence and the URL travel with the item; audio stays git-ignored. */
  | {
      kind: "public_recording";
      dataset: string;
      url: string | null;
      licence: string;
      path: string;
      bytes: number;
      sha256: string;
      durationSeconds: number;
      sampleRate?: number;
      channels?: number;
      /** Where each verified truth field came from and how it was produced. */
      truthSources?: Partial<Record<GoldDomain, { source: string; how: string }>>;
      /** For a re-upload of the owner's own material: the original rows. */
      ownerProjectId?: string;
      ownerSourceId?: string;
    }
  | {
      kind: "owner_upload";
      projectId: string;
      /** The `music_project_sources` row the annotation refers to; UNKNOWN when it could not be read. */
      sourceId: string | "UNKNOWN";
      fileName: string;
      /** Other rows of the same file in the same project (re-uploads); the truth applies to all of them. */
      duplicateSourceIds?: string[];
      bytes?: number;
      durationSeconds?: number;
      sampleRate?: number;
      channels?: number;
      /** The store keeps no checksum column and the object was not on this machine: UNKNOWN until someone hashes it. */
      sha256?: string | "UNKNOWN";
      /** The `music_song_models` row whose estimates the annotation template quotes. */
      songModelId?: string;
      registeredFrom?: string;
    };

export type GoldItem = {
  id: string;
  tier: GoldTier;
  title: string;
  genreFamily: string;
  source: GoldSource;
  audio: GoldAudio | null;
  truth: GoldTruth;
  coverage: TruthCoverage;
  /** Free text for what is and is not known about this item. */
  notes?: string;
  /** Real tiers: the fields a person is asked to fill, with what the platform currently estimates (never truth). */
  annotationTemplate?: AnnotationTemplate;
};

/**
 * Something the owner *said* about the recording without measuring it. It is
 * kept beside the platform estimate so the annotator knows what to check, and
 * it is never truth: a field with an owner claim still has status UNKNOWN
 * until a person verifies it against the recording.
 */
export type OwnerClaim = { value: unknown; status: "UNVERIFIED_OWNER_CLAIM"; statedOn: string; note: string };

export type AnnotationField = {
  /** null until HUMAN_VERIFIED. */
  value: unknown;
  status: "UNKNOWN" | "HUMAN_VERIFIED";
  /** What the platform currently outputs — never copied into `value`. */
  platformEstimate?: unknown;
  how?: string;
  ownerClaim?: OwnerClaim;
};

export type AnnotationTemplate = {
  instructions: string;
  fields: Record<string, AnnotationField>;
};

export type GoldManifest = {
  version: typeof ANALYSIS_GOLD_VERSION;
  builtAt: string;
  items: GoldItem[];
};

export type PredictionFile = {
  predictor: string;
  items: Record<string, GoldPrediction>;
};

export type GoldPrediction = {
  tempo?: unknown;
  metre?: unknown;
  key?: unknown;
  chords?: unknown;
  notes?: unknown;
  beats?: unknown;
  downbeats?: unknown;
  sections?: unknown;
};

// ---------------------------------------------------------------------------
// Pitch names
// ---------------------------------------------------------------------------

export const PITCH_CLASS_NAMES = ["C", "Db", "D", "Eb", "E", "F", "F#", "G", "Ab", "A", "Bb", "B"] as const;

const LETTER_PC: Record<string, number> = { C: 0, D: 2, E: 4, F: 5, G: 7, A: 9, B: 11 };

/** "Eb", "E♭", "e-flat", "F#", "F♯", "Cb", "B#" → pitch class, or null. */
export function parsePitchName(text: string): number | null {
  const cleaned = text.trim().replace(/♭/g, "b").replace(/♯/g, "#").replace(/-?flat$/i, "b").replace(/-?sharp$/i, "#");
  const match = /^([A-Ga-g])(b|#|bb|##)?$/.exec(cleaned);
  if (!match) return null;
  const base = LETTER_PC[match[1].toUpperCase()];
  const acc = match[2] ?? "";
  const shift = acc === "b" ? -1 : acc === "bb" ? -2 : acc === "#" ? 1 : acc === "##" ? 2 : 0;
  return ((base + shift) % 12 + 12) % 12;
}

/** Sharps/flats count of a key. */
export function keySignatureFifths(pitchClass: number, mode: KeyMode): number {
  const majorPc = mode === "major" ? pitchClass : (pitchClass + 3) % 12;
  // Fifths f puts the major tonic at (7f mod 12); choose f in -5..6.
  for (let f = -5; f <= 6; f += 1) if (((7 * f) % 12 + 12) % 12 === majorPc) return f;
  return 0;
}

// ---------------------------------------------------------------------------
// Prediction parsing (lenient on shape, strict on meaning)
// ---------------------------------------------------------------------------

export function parseKey(value: unknown): KeyTruth | null {
  if (!value) return null;
  if (typeof value === "object") {
    const v = value as { tonic?: unknown; mode?: unknown; pitchClass?: unknown; key?: unknown; value?: unknown };
    if (typeof v.key === "string") return parseKey(v.key);
    if (typeof v.value === "string") return parseKey(v.value);
    const mode = normaliseMode(v.mode);
    const pc = typeof v.pitchClass === "number" ? ((v.pitchClass % 12) + 12) % 12 : typeof v.tonic === "string" ? parsePitchName(v.tonic) : null;
    if (pc === null || !mode) return null;
    return { tonic: PITCH_CLASS_NAMES[pc], pitchClass: pc, mode };
  }
  if (typeof value !== "string") return null;
  const match = /^\s*([A-Ga-g](?:♭|♯|b|#|bb|##|-?flat|-?sharp)?)\s*[- ]?\s*(major|minor|maj|min|m|M|dorian|mixolydian|aeolian|ionian)?\s*$/i.exec(value);
  if (!match) return null;
  const pc = parsePitchName(match[1]);
  if (pc === null) return null;
  const modeText = match[2] ?? "major";
  const mode: KeyMode | null =
    modeText === "m" ? "minor" : modeText === "M" ? "major" : normaliseMode(modeText);
  if (!mode) return null;
  return { tonic: PITCH_CLASS_NAMES[pc], pitchClass: pc, mode };
}

function normaliseMode(value: unknown): KeyMode | null {
  if (typeof value !== "string") return null;
  const m = value.toLowerCase();
  if (m === "major" || m === "maj" || m === "ionian") return "major";
  if (m === "minor" || m === "min" || m === "aeolian") return "minor";
  return null;
}

const QUALITY_ALIASES: Record<string, ChordQualityName> = {
  "": "maj", maj: "maj", major: "maj", M: "maj",
  m: "min", min: "min", minor: "min", "-": "min",
  "7": "7", dom7: "7", dom: "7",
  maj7: "maj7", M7: "maj7", "Δ": "maj7", "Δ7": "maj7", ma7: "maj7",
  m7: "min7", min7: "min7", "-7": "min7", mi7: "min7",
  "6": "6", maj6: "6", M6: "6",
  m6: "min6", min6: "min6", "-6": "min6",
  dim: "dim", o: "dim", "°": "dim",
  dim7: "dim7", o7: "dim7", "°7": "dim7",
  hdim7: "hdim7", m7b5: "hdim7", "ø": "hdim7", "ø7": "hdim7", "min7b5": "hdim7",
  aug: "aug", "+": "aug",
  sus2: "sus2", sus4: "sus4", sus: "sus4",
};

export type ParsedChord = { root: number | null; quality: ChordQualityName | "N"; bass: number | null };

/** "G/B", "Am7", "F#dim", "Bbmaj7", "N" → root/quality/bass pitch classes, or null when unreadable. */
export function parseChordSymbol(symbol: string): ParsedChord | null {
  const text = symbol.trim().replace(/♭/g, "b").replace(/♯/g, "#");
  if (text === "N" || text === "NC" || text === "N.C." || text === "") return { root: null, quality: "N", bass: null };
  const match = /^([A-Ga-g](?:b|#|bb|##)?)([^/]*)(?:\/([A-Ga-g](?:b|#|bb|##)?))?$/.exec(text);
  if (!match) return null;
  const root = parsePitchName(match[1]);
  if (root === null) return null;
  const quality = QUALITY_ALIASES[match[2].trim()];
  if (!quality) return null;
  const bass = match[3] ? parsePitchName(match[3]) : null;
  return { root, quality, bass: bass === root ? null : bass };
}

export type ChordSegment = { start: number; end: number; chord: ParsedChord };

function chordFromObject(value: Record<string, unknown>): ParsedChord | null {
  if (typeof value.symbol === "string") return parseChordSymbol(value.symbol);
  if (typeof value.chord === "string") return parseChordSymbol(value.chord);
  if (value.quality === "N" || value.root === null) return { root: null, quality: "N", bass: null };
  const root = typeof value.root === "string" ? parsePitchName(value.root) : typeof value.root === "number" ? ((value.root % 12) + 12) % 12 : null;
  if (root === null) return null;
  const quality = typeof value.quality === "string" ? QUALITY_ALIASES[value.quality] : "maj";
  if (!quality) return null;
  const bass = typeof value.bass === "string" ? parsePitchName(value.bass) : typeof value.bass === "number" ? ((value.bass % 12) + 12) % 12 : null;
  return { root, quality, bass: bass === root ? null : bass };
}

/** Prediction or truth chord list → time segments. Unreadable entries are dropped (and counted by the caller as absent). */
export function parseChordSegments(value: unknown): ChordSegment[] {
  if (!Array.isArray(value)) return [];
  const out: ChordSegment[] = [];
  for (const entry of value) {
    if (!entry || typeof entry !== "object") continue;
    const v = entry as Record<string, unknown>;
    const start = typeof v.start === "number" ? v.start : typeof v.time === "number" ? v.time : null;
    const end = typeof v.end === "number" ? v.end : typeof v.start === "number" && typeof v.duration === "number" ? v.start + v.duration : null;
    if (start === null || end === null || !(end > start)) continue;
    const chord = chordFromObject(v);
    if (!chord) continue;
    out.push({ start, end, chord });
  }
  return out.sort((a, b) => a.start - b.start);
}

export type FlatNote = { start: number; end: number; pitch: number; track?: string };

function noteFromValue(value: unknown, track?: string): FlatNote | null {
  if (Array.isArray(value)) {
    const [start, duration, pitch] = value as number[];
    if (![start, duration, pitch].every((n) => typeof n === "number" && Number.isFinite(n))) return null;
    return { start, end: start + duration, pitch: Math.round(pitch), track };
  }
  if (!value || typeof value !== "object") return null;
  const v = value as Record<string, unknown>;
  const start = typeof v.start === "number" ? v.start : typeof v.onset === "number" ? v.onset : typeof v.time === "number" ? v.time : null;
  const pitch = typeof v.pitch === "number" ? v.pitch : typeof v.midi === "number" ? v.midi : null;
  if (start === null || pitch === null) return null;
  const end = typeof v.end === "number" ? v.end : typeof v.duration === "number" ? start + v.duration : typeof v.offset === "number" ? v.offset : start + 0.1;
  return { start, end, pitch: Math.round(pitch), track };
}

/** Prediction notes: a flat list, or `{ tracks: [{ role, notes }] }`. */
export function parseNotes(value: unknown): { flat: FlatNote[]; tracks: Map<string, FlatNote[]> | null } {
  const tracks = new Map<string, FlatNote[]>();
  if (value && typeof value === "object" && !Array.isArray(value) && Array.isArray((value as { tracks?: unknown }).tracks)) {
    for (const track of (value as { tracks: unknown[] }).tracks) {
      if (!track || typeof track !== "object") continue;
      const t = track as { role?: unknown; name?: unknown; notes?: unknown };
      const role = typeof t.role === "string" ? t.role : typeof t.name === "string" ? t.name : `track${tracks.size}`;
      const notes = Array.isArray(t.notes) ? t.notes.map((n) => noteFromValue(n, role)).filter((n): n is FlatNote => n !== null) : [];
      tracks.set(role, notes);
    }
    return { flat: [...tracks.values()].flat(), tracks };
  }
  if (Array.isArray(value)) {
    return { flat: value.map((n) => noteFromValue(n)).filter((n): n is FlatNote => n !== null), tracks: null };
  }
  return { flat: [], tracks: null };
}

export function parseTimes(value: unknown): number[] {
  if (!Array.isArray(value)) return [];
  return value
    .map((v) => (typeof v === "number" ? v : v && typeof v === "object" && typeof (v as { time?: unknown }).time === "number" ? (v as { time: number }).time : null))
    .filter((v): v is number => v !== null && Number.isFinite(v))
    .sort((a, b) => a - b);
}

export function parseMetre(value: unknown): { numerator: number; denominator: number } | null {
  if (typeof value === "string") {
    const m = /^\s*(\d+)\s*\/\s*(\d+)\s*$/.exec(value);
    return m ? { numerator: Number(m[1]), denominator: Number(m[2]) } : null;
  }
  if (value && typeof value === "object") {
    const v = value as { numerator?: unknown; denominator?: unknown; meter?: unknown; value?: unknown };
    if (typeof v.meter === "string") return parseMetre(v.meter);
    if (typeof v.value === "string") return parseMetre(v.value);
    if (typeof v.numerator === "number" && typeof v.denominator === "number") return { numerator: v.numerator, denominator: v.denominator };
  }
  return null;
}

export function parseTempo(value: unknown): { bpm: number | null; map: TempoPoint[] | null } {
  if (typeof value === "number") return { bpm: value, map: null };
  if (value && typeof value === "object") {
    const v = value as { bpm?: unknown; map?: unknown; tempoMap?: unknown };
    const mapSource = Array.isArray(v.map) ? v.map : Array.isArray(v.tempoMap) ? v.tempoMap : null;
    const map = mapSource
      ? mapSource
          .map((p) => (p && typeof p === "object" && typeof (p as TempoPoint).bpm === "number" ? { time: Number((p as { time?: number }).time ?? 0), bpm: (p as TempoPoint).bpm } : null))
          .filter((p): p is TempoPoint => p !== null)
          .sort((a, b) => a.time - b.time)
      : null;
    const bpm = typeof v.bpm === "number" ? v.bpm : map && map.length ? map[0].bpm : null;
    return { bpm, map };
  }
  return { bpm: null, map: null };
}

/** Sections as `{start,end?,label?}` objects or a bare list of boundary times. */
export function parseSectionBoundaries(value: unknown): number[] | null {
  if (!Array.isArray(value)) return null;
  if (value.every((v) => typeof v === "number")) return [...(value as number[])].sort((a, b) => a - b);
  const starts = value
    .map((v) => (v && typeof v === "object" && typeof (v as { start?: unknown }).start === "number" ? (v as { start: number }).start : null))
    .filter((v): v is number => v !== null);
  return starts.sort((a, b) => a - b);
}

// ---------------------------------------------------------------------------
// Scorers
// ---------------------------------------------------------------------------

export const TEMPO_TOLERANCE = 0.04;
export const ONSET_TOLERANCE_SECONDS = 0.05;
export const BEAT_TOLERANCE_SECONDS = 0.07;
export const SECTION_TOLERANCES_SECONDS = [0.5, 3] as const;

export type ScoreStatus = "scored" | "UNKNOWN_TRUTH" | "NO_PREDICTION";

const within = (predicted: number, truth: number, tolerance = TEMPO_TOLERANCE): boolean =>
  truth > 0 && Math.abs(predicted / truth - 1) <= tolerance;

export type TempoScore = {
  status: ScoreStatus;
  predictedBpm?: number;
  truthBpm?: number;
  ratio?: number;
  /** Within ±4 % of the truth's beat-unit BPM. The headline. */
  exact?: boolean;
  /** Within ±4 % of half / double the truth. Reported beside `exact`, never added to it. */
  halfTempoCredit?: boolean;
  doubleTempoCredit?: boolean;
  /** Compound metres only: within ±4 % of the quarter-note BPM (a 6/8 at 60 dotted-quarter is 90 quarter). */
  quarterUnitCredit?: boolean;
  /** Time-weighted share of the piece where the predicted tempo (map or constant) is within ±4 % of the truth map. */
  mapAccuracy?: number;
  truthConstant?: boolean;
  traps?: string[];
};

function tempoAt(map: TempoPoint[], time: number): number {
  let bpm = map[0]?.bpm ?? 0;
  for (const p of map) if (p.time <= time) bpm = p.bpm;
  return bpm;
}

export function scoreTempo(prediction: unknown, truth: TempoTruth | null): TempoScore {
  if (!truth) return { status: "UNKNOWN_TRUTH" };
  const { bpm, map } = parseTempo(prediction);
  if (bpm === null || !(bpm > 0)) return { status: "NO_PREDICTION" };
  const predMap = map && map.length ? map : [{ time: 0, bpm }];
  let correctSeconds = 0;
  for (let i = 0; i < truth.map.length; i += 1) {
    const segStart = truth.map[i].time;
    const segEnd = i + 1 < truth.map.length ? truth.map[i + 1].time : truth.durationSeconds;
    // Sample at 0.25 s so a predicted map with its own boundaries is credited where it is right.
    for (let t = segStart; t < segEnd; t += 0.25) {
      const step = Math.min(0.25, segEnd - t);
      if (within(tempoAt(predMap, t), truth.map[i].bpm)) correctSeconds += step;
    }
  }
  return {
    status: "scored",
    predictedBpm: bpm,
    truthBpm: truth.bpm,
    ratio: Number((bpm / truth.bpm).toFixed(4)),
    exact: within(bpm, truth.bpm),
    halfTempoCredit: within(bpm, truth.bpm / 2),
    doubleTempoCredit: within(bpm, truth.bpm * 2),
    quarterUnitCredit: truth.quarterBpm !== truth.bpm && within(bpm, truth.quarterBpm),
    mapAccuracy: Number((truth.durationSeconds > 0 ? correctSeconds / truth.durationSeconds : 0).toFixed(4)),
    truthConstant: truth.constant,
    ...(truth.traps?.length ? { traps: truth.traps } : {}),
  };
}

export type MetreScore = {
  status: ScoreStatus;
  predicted?: string;
  truth?: string;
  exact?: boolean;
  /** Same bar length in quarters (2/2 vs 4/4, 3/4 vs 6/8): reported, not credited. */
  sameBarLength?: boolean;
  truthChanges?: number;
  pickupBar?: boolean;
};

export function scoreMetre(prediction: unknown, truth: MetreTruth | null): MetreScore {
  if (!truth) return { status: "UNKNOWN_TRUTH" };
  const predicted = parseMetre(prediction);
  if (!predicted) return { status: "NO_PREDICTION" };
  const quarters = (n: number, d: number) => (n * 4) / d;
  return {
    status: "scored",
    predicted: `${predicted.numerator}/${predicted.denominator}`,
    truth: `${truth.numerator}/${truth.denominator}`,
    exact: predicted.numerator === truth.numerator && predicted.denominator === truth.denominator,
    sameBarLength: Math.abs(quarters(predicted.numerator, predicted.denominator) - quarters(truth.numerator, truth.denominator)) < 1e-9,
    truthChanges: Math.max(0, new Set(truth.changes.map((c) => `${c.numerator}/${c.denominator}`)).size - 1),
    pickupBar: truth.pickupBar,
  };
}

export type KeyCredit = "exact" | "relative" | "parallel" | "fifth" | "none";
export type KeyScore = {
  status: ScoreStatus;
  predicted?: string;
  truth?: string;
  credit?: KeyCredit;
  exact?: boolean;
  relative?: boolean;
  parallel?: boolean;
  fifthNeighbour?: boolean;
  /** MIREX weighting (1 / 0.5 fifth / 0.3 relative / 0.2 parallel) — derived from `credit`, shown for comparability only. */
  mirexWeighted?: number;
  /** When the truth carries only a written key signature: does the predicted key imply the same signature? */
  keySignatureMatch?: boolean | null;
};

export function keyCredit(predicted: KeyTruth, truth: KeyTruth): KeyCredit {
  if (predicted.pitchClass === truth.pitchClass && predicted.mode === truth.mode) return "exact";
  if (predicted.mode !== truth.mode) {
    const relativeOfTruth = truth.mode === "major" ? (truth.pitchClass + 9) % 12 : (truth.pitchClass + 3) % 12;
    if (predicted.pitchClass === relativeOfTruth) return "relative";
    if (predicted.pitchClass === truth.pitchClass) return "parallel";
    return "none";
  }
  const distance = (predicted.pitchClass - truth.pitchClass + 12) % 12;
  if (distance === 5 || distance === 7) return "fifth";
  return "none";
}

const MIREX_KEY_WEIGHT: Record<KeyCredit, number> = { exact: 1, fifth: 0.5, relative: 0.3, parallel: 0.2, none: 0 };

export function scoreKey(prediction: unknown, truth: KeyTruth | null, keySignature: KeySignatureTruth | null = null): KeyScore {
  const predicted = parseKey(prediction);
  if (!truth) {
    if (!keySignature) return { status: "UNKNOWN_TRUTH" };
    if (!predicted) return { status: "NO_PREDICTION" };
    return {
      status: "scored",
      predicted: `${predicted.tonic} ${predicted.mode}`,
      keySignatureMatch: keySignatureFifths(predicted.pitchClass, predicted.mode) === keySignature.fifths,
    };
  }
  if (!predicted) return { status: "NO_PREDICTION" };
  const credit = keyCredit(predicted, truth);
  return {
    status: "scored",
    predicted: `${predicted.tonic} ${predicted.mode}`,
    truth: `${truth.tonic} ${truth.mode}`,
    credit,
    exact: credit === "exact",
    relative: credit === "relative",
    parallel: credit === "parallel",
    fifthNeighbour: credit === "fifth",
    mirexWeighted: MIREX_KEY_WEIGHT[credit],
    keySignatureMatch: keySignature ? keySignatureFifths(predicted.pitchClass, predicted.mode) === keySignature.fifths : null,
  };
}

export type ChordVocabulary = "root" | "majmin" | "majminBass" | "sevenths" | "seventhsBass";
export type ChordVocabularyScore = { correctSeconds: number; scoredSeconds: number; accuracy: number };
export type ChordScore = {
  status: ScoreStatus;
  totalSeconds?: number;
  /** Seconds of the truth timeline the prediction leaves with no chord (scored as "N"). */
  unpredictedSeconds?: number;
  root?: ChordVocabularyScore;
  majmin?: ChordVocabularyScore;
  majminBass?: ChordVocabularyScore;
  sevenths?: ChordVocabularyScore;
  seventhsBass?: ChordVocabularyScore;
};

/** Reduce a quality to the vocabulary's classes; "X" is outside the vocabulary (unscorable in the reference, wrong in a prediction). */
function reduceQuality(quality: ChordQualityName | "N", vocabulary: "majmin" | "sevenths"): string {
  if (quality === "N") return "N";
  if (vocabulary === "majmin") {
    if (quality === "maj" || quality === "maj7" || quality === "7" || quality === "6") return "maj";
    if (quality === "min" || quality === "min7" || quality === "min6") return "min";
    return "X";
  }
  if (quality === "maj" || quality === "min" || quality === "7" || quality === "maj7" || quality === "min7") return quality;
  return "X";
}

function chordAt(segments: ChordSegment[], time: number): ParsedChord {
  for (const s of segments) if (time >= s.start && time < s.end) return s.chord;
  return { root: null, quality: "N", bass: null };
}

export function scoreChords(prediction: unknown, truth: ChordTruth[] | null): ChordScore {
  if (!truth) return { status: "UNKNOWN_TRUTH" };
  if (!Array.isArray(prediction)) return { status: "NO_PREDICTION" };
  const truthSegments = parseChordSegments(truth);
  const predSegments = parseChordSegments(prediction);
  if (!truthSegments.length) return { status: "UNKNOWN_TRUTH" };
  const end = Math.max(...truthSegments.map((s) => s.end));
  const boundaries = new Set<number>([0, end]);
  for (const s of [...truthSegments, ...predSegments]) {
    if (s.start > 0 && s.start < end) boundaries.add(s.start);
    if (s.end > 0 && s.end < end) boundaries.add(s.end);
  }
  const times = [...boundaries].sort((a, b) => a - b);
  const vocab: Record<ChordVocabulary, ChordVocabularyScore> = {
    root: { correctSeconds: 0, scoredSeconds: 0, accuracy: 0 },
    majmin: { correctSeconds: 0, scoredSeconds: 0, accuracy: 0 },
    majminBass: { correctSeconds: 0, scoredSeconds: 0, accuracy: 0 },
    sevenths: { correctSeconds: 0, scoredSeconds: 0, accuracy: 0 },
    seventhsBass: { correctSeconds: 0, scoredSeconds: 0, accuracy: 0 },
  };
  let unpredicted = 0;
  for (let i = 0; i + 1 < times.length; i += 1) {
    const span = times[i + 1] - times[i];
    if (!(span > 1e-9)) continue;
    const mid = (times[i] + times[i + 1]) / 2;
    const t = chordAt(truthSegments, mid);
    const p = chordAt(predSegments, mid);
    const predAbsent = !predSegments.some((s) => mid >= s.start && mid < s.end);
    if (predAbsent) unpredicted += span;
    // root
    vocab.root.scoredSeconds += span;
    if (t.root === p.root) vocab.root.correctSeconds += span;
    const bassOf = (c: ParsedChord) => (c.root === null ? null : c.bass ?? c.root);
    for (const [name, withBass] of [["majmin", false], ["majminBass", true], ["sevenths", false], ["seventhsBass", true]] as const) {
      const v = name.startsWith("majmin") ? "majmin" : "sevenths";
      const tq = reduceQuality(t.quality, v);
      if (tq === "X") continue; // outside the vocabulary: the reference cannot be scored here
      const pq = reduceQuality(p.quality, v);
      vocab[name].scoredSeconds += span;
      const same = tq === "N" ? pq === "N" : t.root === p.root && tq === pq && (!withBass || bassOf(t) === bassOf(p));
      if (same) vocab[name].correctSeconds += span;
    }
  }
  for (const v of Object.values(vocab)) {
    v.accuracy = v.scoredSeconds > 0 ? Number((v.correctSeconds / v.scoredSeconds).toFixed(4)) : 0;
    v.correctSeconds = Number(v.correctSeconds.toFixed(3));
    v.scoredSeconds = Number(v.scoredSeconds.toFixed(3));
  }
  return { status: "scored", totalSeconds: Number(end.toFixed(3)), unpredictedSeconds: Number(unpredicted.toFixed(3)), ...vocab };
}

export type PrfScore = { precision: number; recall: number; f1: number; matched: number; predicted: number; reference: number };

function prf(matched: number, predicted: number, reference: number): PrfScore {
  const precision = predicted ? matched / predicted : 0;
  const recall = reference ? matched / reference : 0;
  const f1 = precision + recall > 0 ? (2 * precision * recall) / (precision + recall) : 0;
  return { precision: Number(precision.toFixed(4)), recall: Number(recall.toFixed(4)), f1: Number(f1.toFixed(4)), matched, predicted, reference };
}

/**
 * Maximum bipartite matching by augmenting paths — the same notion mir_eval
 * uses, so a dense passage is not under-credited by greedy order. Candidate
 * edges are only within the onset window, so the graph is sparse.
 */
function maximumMatching(reference: FlatNote[], predicted: FlatNote[], accepts: (r: FlatNote, p: FlatNote) => boolean): number {
  const sortedPred = predicted.map((p, index) => ({ p, index })).sort((a, b) => a.p.start - b.p.start);
  const candidates: number[][] = reference.map((r) => {
    const out: number[] = [];
    // Binary search the first prediction whose onset could be within the window.
    let lo = 0;
    let hi = sortedPred.length;
    while (lo < hi) {
      const mid = (lo + hi) >> 1;
      if (sortedPred[mid].p.start < r.start - ONSET_TOLERANCE_SECONDS - 1e-9) lo = mid + 1;
      else hi = mid;
    }
    for (let i = lo; i < sortedPred.length && sortedPred[i].p.start <= r.start + ONSET_TOLERANCE_SECONDS + 1e-9; i += 1) {
      if (accepts(r, sortedPred[i].p)) out.push(sortedPred[i].index);
    }
    return out;
  });
  const matchOfPred = new Array<number>(predicted.length).fill(-1);
  const tryAssign = (r: number, seen: Uint8Array): boolean => {
    for (const p of candidates[r]) {
      if (seen[p]) continue;
      seen[p] = 1;
      if (matchOfPred[p] === -1 || tryAssign(matchOfPred[p], seen)) {
        matchOfPred[p] = r;
        return true;
      }
    }
    return false;
  };
  let matched = 0;
  for (let r = 0; r < reference.length; r += 1) {
    if (candidates[r].length && tryAssign(r, new Uint8Array(predicted.length))) matched += 1;
  }
  return matched;
}

export type NotesTrackScore = { onset: PrfScore; onsetPitch: PrfScore; onsetPitchOffset: PrfScore };
export type NotesScore = {
  status: ScoreStatus;
  /** All pitched tracks merged (drums excluded). */
  pitched?: NotesTrackScore;
  /** Drum tracks merged; pitch is the GM kit piece. */
  drums?: NotesTrackScore | null;
  /** When the prediction names tracks by the truth's roles. */
  perTrack?: Record<string, NotesTrackScore>;
  truthPitchedNotes?: number;
  truthDrumNotes?: number;
};

const onsetOk = (r: FlatNote, p: FlatNote) => Math.abs(r.start - p.start) <= ONSET_TOLERANCE_SECONDS + 1e-9;
const pitchOk = (r: FlatNote, p: FlatNote) => onsetOk(r, p) && r.pitch === p.pitch;
const offsetOk = (r: FlatNote, p: FlatNote) => pitchOk(r, p) && Math.abs(r.end - p.end) <= Math.max(ONSET_TOLERANCE_SECONDS, 0.2 * (r.end - r.start)) + 1e-9;

function scoreNoteSet(reference: FlatNote[], predicted: FlatNote[]): NotesTrackScore {
  return {
    onset: prf(maximumMatching(reference, predicted, onsetOk), predicted.length, reference.length),
    onsetPitch: prf(maximumMatching(reference, predicted, pitchOk), predicted.length, reference.length),
    onsetPitchOffset: prf(maximumMatching(reference, predicted, offsetOk), predicted.length, reference.length),
  };
}

const tupleNotes = (track: NoteTrackTruth): FlatNote[] =>
  track.notes.map(([start, duration, pitch]) => ({ start, end: start + duration, pitch, track: track.role }));

export function scoreNotes(prediction: unknown, truth: NotesTruth | null): NotesScore {
  if (!truth) return { status: "UNKNOWN_TRUTH" };
  const parsed = parseNotes(prediction);
  if (!parsed.flat.length && !parsed.tracks) return { status: "NO_PREDICTION" };
  const pitchedTracks = truth.tracks.filter((t) => !t.percussion);
  const drumTracks = truth.tracks.filter((t) => t.percussion);
  const truthPitched = pitchedTracks.flatMap(tupleNotes);
  const truthDrums = drumTracks.flatMap(tupleNotes);
  let predPitched = parsed.flat;
  let predDrums: FlatNote[] = [];
  if (parsed.tracks) {
    const drumRoles = new Set(drumTracks.map((t) => t.role));
    predPitched = [];
    for (const [role, notes] of parsed.tracks) {
      if (drumRoles.has(role) || /drum|kit|perc/i.test(role)) predDrums.push(...notes);
      else predPitched.push(...notes);
    }
  }
  const result: NotesScore = {
    status: "scored",
    pitched: scoreNoteSet(truthPitched, predPitched),
    drums: truthDrums.length ? scoreNoteSet(truthDrums, predDrums) : null,
    truthPitchedNotes: truthPitched.length,
    truthDrumNotes: truthDrums.length,
  };
  if (parsed.tracks) {
    const perTrack: Record<string, NotesTrackScore> = {};
    for (const track of truth.tracks) {
      const predicted = parsed.tracks.get(track.role);
      if (predicted) perTrack[track.role] = scoreNoteSet(tupleNotes(track), predicted);
    }
    if (Object.keys(perTrack).length) result.perTrack = perTrack;
  }
  return result;
}

/** One-to-one matching of two sorted time lists within a window (events are farther apart than the window, so greedy is optimal). */
function matchTimes(reference: number[], predicted: number[], tolerance: number): number {
  let matched = 0;
  let j = 0;
  const used = new Uint8Array(predicted.length);
  for (const r of reference) {
    while (j < predicted.length && predicted[j] < r - tolerance) j += 1;
    for (let k = j; k < predicted.length && predicted[k] <= r + tolerance + 1e-9; k += 1) {
      if (!used[k]) {
        used[k] = 1;
        matched += 1;
        break;
      }
    }
  }
  return matched;
}

export type BeatScore = { status: ScoreStatus; toleranceSeconds?: number } & Partial<PrfScore>;

export function scoreBeats(prediction: unknown, truth: number[] | null): BeatScore {
  if (!truth) return { status: "UNKNOWN_TRUTH" };
  const predicted = parseTimes(prediction);
  if (!predicted.length) return { status: "NO_PREDICTION" };
  const reference = [...truth].sort((a, b) => a - b);
  return { status: "scored", toleranceSeconds: BEAT_TOLERANCE_SECONDS, ...prf(matchTimes(reference, predicted, BEAT_TOLERANCE_SECONDS), predicted.length, reference.length) };
}

export type SectionScore = {
  status: ScoreStatus;
  /** Internal boundaries only: the start of every section but the first. */
  truthBoundaries?: number;
  predictedBoundaries?: number;
  at0_5s?: PrfScore;
  at3s?: PrfScore;
};

export function sectionBoundaries(sections: SectionTruth[]): number[] {
  const starts = sections.map((s) => s.start).sort((a, b) => a - b);
  return starts.filter((t, i) => i > 0 && t > 0);
}

export function scoreSections(prediction: unknown, truth: SectionTruth[] | null): SectionScore {
  if (!truth) return { status: "UNKNOWN_TRUTH" };
  const boundaries = parseSectionBoundaries(prediction);
  if (!boundaries) return { status: "NO_PREDICTION" };
  const end = Math.max(...truth.map((s) => s.end));
  const reference = sectionBoundaries(truth);
  // A predicted boundary at the very start or end names no section change.
  const predicted = boundaries.filter((t) => t > 0.25 && t < end - 0.25);
  const score = (tolerance: number) => prf(matchTimes(reference, predicted, tolerance), predicted.length, reference.length);
  return {
    status: "scored",
    truthBoundaries: reference.length,
    predictedBoundaries: predicted.length,
    at0_5s: score(SECTION_TOLERANCES_SECONDS[0]),
    at3s: score(SECTION_TOLERANCES_SECONDS[1]),
  };
}

export type DomainScore = TempoScore | MetreScore | KeyScore | ChordScore | NotesScore | BeatScore | SectionScore;

/** Score one prediction against one item's truth in one domain. */
export function scoreAgainstGold(domain: GoldDomain, prediction: unknown, truth: GoldTruth): DomainScore {
  switch (domain) {
    case "tempo": return scoreTempo(prediction, truth.tempo);
    case "metre": return scoreMetre(prediction, truth.metre);
    case "key": return scoreKey(prediction, truth.key, truth.keySignature);
    case "chords": return scoreChords(prediction, truth.chords);
    case "notes": return scoreNotes(prediction, truth.notes);
    case "beats": return scoreBeats(prediction, truth.beats);
    case "downbeats": return scoreBeats(prediction, truth.downbeats);
    case "sections": return scoreSections(prediction, truth.sections);
    default: {
      const never: never = domain;
      throw new Error(`unknown domain ${String(never)}`);
    }
  }
}

// ---------------------------------------------------------------------------
// Manifest validation and tier scoring
// ---------------------------------------------------------------------------

/** Problems with a manifest; empty when it is well-formed. */
export function validateManifest(manifest: GoldManifest): string[] {
  const problems: string[] = [];
  if (manifest.version !== ANALYSIS_GOLD_VERSION) problems.push(`version must be ${ANALYSIS_GOLD_VERSION}`);
  const ids = new Set<string>();
  for (const item of manifest.items ?? []) {
    const where = `item ${item.id ?? "?"}`;
    if (!item.id) problems.push("an item has no id");
    else if (ids.has(item.id)) problems.push(`${where}: duplicate id`);
    ids.add(item.id);
    if (!GOLD_TIERS.includes(item.tier)) problems.push(`${where}: tier "${String(item.tier)}" is not one of ${GOLD_TIERS.join(", ")}`);
    if (!item.truth || !item.coverage) { problems.push(`${where}: truth and coverage are required`); continue; }
    for (const domain of GOLD_DOMAINS) {
      const kind = item.coverage[domain];
      if (!COVERAGE_KINDS.includes(kind)) { problems.push(`${where}: coverage.${domain} "${String(kind)}" is not a coverage kind`); continue; }
      const present = item.truth[domain] !== null && item.truth[domain] !== undefined;
      if (kind === "UNKNOWN" && present) problems.push(`${where}: ${domain} truth present but coverage UNKNOWN`);
      if ((kind === "EXACT" || kind === "HUMAN_VERIFIED") && !present) problems.push(`${where}: coverage.${domain} is ${kind} but the truth is null`);
      if (kind === "PARTIAL" && !(domain === "key" && item.truth.keySignature && !item.truth.key)) problems.push(`${where}: PARTIAL coverage is only a written key signature without a mode`);
      if (kind === "EXACT" && item.tier !== "SYNTHETIC_EXACT") problems.push(`${where}: EXACT truth is only possible by construction (tier SYNTHETIC_EXACT)`);
      if (kind === "HUMAN_VERIFIED" && item.tier === "SYNTHETIC_EXACT") problems.push(`${where}: a synthetic item's truth is by construction, not HUMAN_VERIFIED`);
    }
    if (item.annotationTemplate) {
      if (item.tier === "SYNTHETIC_EXACT") problems.push(`${where}: a synthetic item's truth is by construction; it takes no annotation template`);
      let verifiedFields = 0;
      for (const [name, field] of Object.entries(item.annotationTemplate.fields ?? {})) {
        const at = `${where}: annotation field ${name}`;
        if (field.status === "HUMAN_VERIFIED") {
          verifiedFields += 1;
          if (field.value === null || field.value === undefined) problems.push(`${at} is HUMAN_VERIFIED with no value`);
        } else if (field.status === "UNKNOWN") {
          if (field.value !== null && field.value !== undefined) problems.push(`${at} carries a value but is not HUMAN_VERIFIED — a value nobody checked is not truth`);
        } else {
          problems.push(`${at} has status "${String(field.status)}"; only UNKNOWN or HUMAN_VERIFIED`);
        }
        if (field.ownerClaim) {
          if (field.ownerClaim.status !== "UNVERIFIED_OWNER_CLAIM") problems.push(`${at}: an owner claim's status is UNVERIFIED_OWNER_CLAIM, nothing else`);
          if (field.ownerClaim.value === null || field.ownerClaim.value === undefined) problems.push(`${at}: an owner claim without a value`);
          if (!field.ownerClaim.statedOn) problems.push(`${at}: an owner claim must say when it was stated`);
        }
      }
      // An owner claim or a platform estimate never becomes truth: coverage can only be
      // HUMAN_VERIFIED once at least one template field was verified by a person.
      if (verifiedFields === 0 && GOLD_DOMAINS.some((d) => item.coverage[d] === "HUMAN_VERIFIED")) {
        problems.push(`${where}: coverage claims HUMAN_VERIFIED truth but no annotation field is HUMAN_VERIFIED`);
      }
    }
    if (item.tier === "SYNTHETIC_EXACT") {
      if (!item.audio) problems.push(`${where}: a synthetic item must carry rendered audio`);
      else {
        if (!/^[0-9a-f]{64}$/.test(item.audio.mix.sha256)) problems.push(`${where}: mix sha256 malformed`);
        if (!item.audio.mix.path) problems.push(`${where}: mix path missing`);
        for (const stem of item.audio.stems) if (!/^[0-9a-f]{64}$/.test(stem.sha256)) problems.push(`${where}: stem ${stem.role} sha256 malformed`);
      }
    }
  }
  return problems;
}

export type DomainAggregate = {
  itemsWithTruth: number;
  itemsScored: number;
  itemsWithoutPrediction: number;
  /** The headline number for the domain, mean over scored items; what it is depends on the domain (see `headline`). */
  mean: number | null;
  headline: string;
  /** Secondary figures, mean over scored items. Partial credits live here and never move `mean`. */
  means: Record<string, number>;
};

export type TierScore = {
  tier: GoldTier;
  predictor: string;
  items: number;
  domains: Record<GoldDomain, DomainAggregate>;
  perItem: Record<string, Partial<Record<GoldDomain, DomainScore>>>;
};

const HEADLINE: Record<GoldDomain, [string, (s: DomainScore) => number | null]> = {
  tempo: ["exact (±4 %)", (s) => ((s as TempoScore).exact ? 1 : 0)],
  metre: ["exact", (s) => ((s as MetreScore).exact ? 1 : 0)],
  key: ["exact", (s) => {
    const k = s as KeyScore;
    return k.credit ? (k.exact ? 1 : 0) : null;
  }],
  chords: ["majmin accuracy (time-weighted)", (s) => (s as ChordScore).majmin?.accuracy ?? null],
  notes: ["onset+pitch F1, pitched tracks", (s) => (s as NotesScore).pitched?.onsetPitch.f1 ?? null],
  beats: ["F-measure ±70 ms", (s) => (s as BeatScore).f1 ?? null],
  downbeats: ["F-measure ±70 ms", (s) => (s as BeatScore).f1 ?? null],
  sections: ["boundary F1 ±3 s", (s) => (s as SectionScore).at3s?.f1 ?? null],
};

function secondaryFigures(domain: GoldDomain, s: DomainScore): Record<string, number> {
  switch (domain) {
    case "tempo": {
      const t = s as TempoScore;
      return { halfTempoCredit: t.halfTempoCredit ? 1 : 0, doubleTempoCredit: t.doubleTempoCredit ? 1 : 0, quarterUnitCredit: t.quarterUnitCredit ? 1 : 0, mapAccuracy: t.mapAccuracy ?? 0 };
    }
    case "metre": return { sameBarLength: (s as MetreScore).sameBarLength ? 1 : 0 };
    case "key": {
      const k = s as KeyScore;
      const out: Record<string, number> = {};
      if (k.credit) { out.relative = k.relative ? 1 : 0; out.parallel = k.parallel ? 1 : 0; out.fifthNeighbour = k.fifthNeighbour ? 1 : 0; out.mirexWeighted = k.mirexWeighted ?? 0; }
      if (typeof k.keySignatureMatch === "boolean") out.keySignatureMatch = k.keySignatureMatch ? 1 : 0;
      return out;
    }
    case "chords": {
      const c = s as ChordScore;
      return { root: c.root?.accuracy ?? 0, majminBass: c.majminBass?.accuracy ?? 0, sevenths: c.sevenths?.accuracy ?? 0, seventhsBass: c.seventhsBass?.accuracy ?? 0 };
    }
    case "notes": {
      const n = s as NotesScore;
      const out: Record<string, number> = { onsetF1: n.pitched?.onset.f1 ?? 0, onsetPitchOffsetF1: n.pitched?.onsetPitchOffset.f1 ?? 0 };
      if (n.drums) out.drumsOnsetF1 = n.drums.onset.f1;
      return out;
    }
    case "beats":
    case "downbeats": {
      const b = s as BeatScore;
      return { precision: b.precision ?? 0, recall: b.recall ?? 0 };
    }
    case "sections": return { at0_5s: (s as SectionScore).at0_5s?.f1 ?? 0 };
    default: return {};
  }
}

/**
 * Score a prediction file against every item of ONE tier. Predictions for an
 * item of another tier are an error, not a silent skip: a tournament that
 * mixes exact truth with human annotation reports a number that means nothing.
 */
export function scoreTier(manifest: GoldManifest, tier: GoldTier, predictions: PredictionFile): TierScore {
  if (!GOLD_TIERS.includes(tier)) throw new Error(`unknown tier ${String(tier)}`);
  const byId = new Map(manifest.items.map((item) => [item.id, item]));
  for (const id of Object.keys(predictions.items)) {
    const item = byId.get(id);
    if (!item) throw new Error(`prediction for unknown item ${id}`);
    if (item.tier !== tier) throw new Error(`prediction for ${id} is tier ${item.tier}; this score is tier ${tier} — tiers are never mixed`);
  }
  const items = manifest.items.filter((item) => item.tier === tier);
  const perItem: TierScore["perItem"] = {};
  const domains = {} as Record<GoldDomain, DomainAggregate>;
  for (const domain of GOLD_DOMAINS) {
    const withTruth = items.filter((item) => item.coverage[domain] !== "UNKNOWN");
    const headlineValues: number[] = [];
    const secondary = new Map<string, number[]>();
    let withoutPrediction = 0;
    for (const item of withTruth) {
      const prediction = predictions.items[item.id]?.[domain];
      const score = scoreAgainstGold(domain, prediction, item.truth);
      perItem[item.id] = { ...(perItem[item.id] ?? {}), [domain]: score };
      if (score.status !== "scored") { withoutPrediction += 1; continue; }
      const value = HEADLINE[domain][1](score);
      if (value !== null) headlineValues.push(value);
      for (const [name, v] of Object.entries(secondaryFigures(domain, score))) secondary.set(name, [...(secondary.get(name) ?? []), v]);
    }
    const mean = (xs: number[]) => (xs.length ? Number((xs.reduce((a, b) => a + b, 0) / xs.length).toFixed(4)) : null);
    const means: Record<string, number> = {};
    for (const [name, xs] of secondary) { const m = mean(xs); if (m !== null) means[name] = m; }
    domains[domain] = {
      itemsWithTruth: withTruth.length,
      itemsScored: withTruth.length - withoutPrediction,
      itemsWithoutPrediction: withoutPrediction,
      mean: mean(headlineValues),
      headline: HEADLINE[domain][0],
      means,
    };
  }
  return { tier, predictor: predictions.predictor, items: items.length, domains, perItem };
}

/** Truth coverage counts per domain for one tier — the table the manifest and the doc print. */
export function coverageTable(manifest: GoldManifest, tier: GoldTier): Record<GoldDomain, Record<CoverageKind, number>> {
  const out = {} as Record<GoldDomain, Record<CoverageKind, number>>;
  for (const domain of GOLD_DOMAINS) {
    out[domain] = { EXACT: 0, HUMAN_VERIFIED: 0, PARTIAL: 0, UNKNOWN: 0 };
    for (const item of manifest.items) if (item.tier === tier) out[domain][item.coverage[domain]] += 1;
  }
  return out;
}

/** Coverage derived from a truth object: EXACT where present (synthetic), PARTIAL for a bare key signature, else UNKNOWN. */
export function coverageOf(truth: GoldTruth, presentKind: "EXACT" | "HUMAN_VERIFIED" = "EXACT"): TruthCoverage {
  const out = {} as TruthCoverage;
  for (const domain of GOLD_DOMAINS) {
    const present = truth[domain] !== null && truth[domain] !== undefined;
    out[domain] = present ? presentKind : domain === "key" && truth.keySignature ? "PARTIAL" : "UNKNOWN";
  }
  return out;
}

export const EMPTY_TRUTH: GoldTruth = { tempo: null, metre: null, key: null, keySignature: null, chords: null, notes: null, beats: null, downbeats: null, sections: null };
