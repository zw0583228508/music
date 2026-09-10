import {
  boolean,
  doublePrecision,
  integer,
  index,
  jsonb,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
} from "drizzle-orm/pg-core";

export type AnalysisSection = {
  name: string;
  startBar: number;
  endBar: number;
  energy: number;
  /** Present on v2 analysis output when the section has observed bar bounds. */
  coordinates?: CanonicalTimeRange;
};

/** A v2 musical location expressed on every canonical timeline axis. */
export type CanonicalTimeCoordinate = {
  seconds: number;
  tick: number;
  beat: number;
  bar: number;
  beatInBar: number;
  beatFraction: number;
};

export type CanonicalTimeRange = {
  start: CanonicalTimeCoordinate;
  end: CanonicalTimeCoordinate;
};

export type ArrangementSection = {
  name: string;
  energy: number;
  density: number;
  tracks: string[];
  startBar?: number;
  endBar?: number;
  chords?: Array<{
    id: string;
    startBeat: number;
    durationBeats: number;
    symbol: string;
    quality: string;
    inversion: number;
    bass?: string;
  }>;
  markers?: Array<{
    id: string;
    bar: number;
    label: string;
    color: string;
  }>;
  automation?: Array<{ bar: number; value: number }>;
  midiNotes?: Array<{
    id: string;
    pitch: number;
    start: number;
    duration: number;
    velocity: number;
    articulation: string;
  }>;
  cc?: number[];
  midiTracks?: Record<string, {
    notes: Array<{
      id: string;
      pitch: number;
      start: number;
      duration: number;
      velocity: number;
      articulation: string;
    }>;
    cc: number[];
  }>;
  transposeSemitones?: number;
};

export type ArrangementRevisionSnapshot = {
  name: string;
  harmonyComplexity: number;
  energy: number;
  density: number;
  orchestraSize: number;
  rhythmIntensity: number;
  selectedCandidateId: string | null;
  sections: ArrangementSection[];
};
export type MusicGenerationTask =
  | "SEPARATION"
  | "TRANSCRIPTION"
  | "ACCOMPANIMENT"
  | "ORCHESTRATION"
  | "ARRANGEMENT";

export type AceStepOperation =
  | "COMPLETE"
  | "LEGO"
  | "REPAINT"
  | "COVER"
  | "EXTRACT";

export type AceStepRegion = {
  unit: "bar" | "beat" | "time";
  start: number;
  end: number;
  crossfadeSeconds: number;
};

export type ProductionJobKind =
  | "analysis"
  | "separation"
  | "transcription"
  | "arrangement"
  | "rendering"
  | "mixing"
  | "mastering"
  | "quality"
  | "export";
export type TrackPerformance = {
  /**
   * Performances created before Song Model v2 omit this field and are
   * interpreted at the legacy 480 PPQ by export consumers.
   */
  ppq?: number;
  tempoMap: Array<{ tick: number; bpm: number }>;
  meterMap: Array<{ tick: number; numerator: number; denominator: number }>;
  notes: Array<{
    startTick: number;
    durationTicks: number;
    pitch: number;
    velocity: number;
  }>;
  expression: Array<{ tick: number; value: number }>;
  articulations: Array<{
    tick: number;
    type: string;
    keyswitch: number;
  }>;
  /** Identity of the exact performed material represented by this MIDI data. */
  performedMaterialSha256?: string;
};

export type ArrangementCandidateData = {
  id: string;
  label: string;
  score: number;
  summary: string;
  provider: string;
};

export type ExportFileRecord = {
  name: string;
  type: string;
  size: string;
  format: string;
  url: string;
};

/** Immutable producer-facing mix/master decision, including render proof. */
/**
 * PR-25: a time segment of a track's mix that differs from its static
 * controls. Offsets are relative to `levelDb` / `sendDb`; segments never
 * overlap and are applied with a short ramp so the evolution is inaudible as
 * a step but audible as a mix that moves with the song.
 */
export type MixControlAutomationSegment = {
  startSeconds: number;
  endSeconds: number;
  levelOffsetDb: number;
  sendOffsetDb: number;
  /** Section name or reason, for the revision's evidence. */
  label?: string;
};

export type MixMasterTrackControl = {
  levelDb: number;
  pan: number;
  bus: "MIX" | "DRUMS" | "MUSIC" | "VOCALS" | "FX";
  sendDb: number;
  processing: { highPassHz: number; compressorRatio: number; saturation: number };
  /** PR-25: section-by-section evolution; absent means a static mix. */
  automation?: MixControlAutomationSegment[];
};

export type MixMasterControls = {
  tracks: Record<string, MixMasterTrackControl>;
  master: { targetLufs: number; truePeakDbtp: number; processing: { limiter: boolean; stereoWidth: number } };
};

// ---------------------------------------------------------------------------
// Wave 7 — PR-27: reference style fingerprint.
//
// A fingerprint is a small set of *abstract* statistics about how a piece of
// music behaves — never its content. No note sequence, melody, chord
// progression, lyric, audio or anything from which those could be rebuilt
// ever enters it: every field is a scalar, a class word, or a distribution of
// at most 16 numbers. `assertContentFree` enforces that structurally. This is
// the rule PR-U4 (reference intelligence) and PR-28..31 (learning) build on.
// ---------------------------------------------------------------------------

export type StyleFingerprintSourceKind = "song_model" | "arrangement" | "reference_upload";

export type StyleFingerprintSource = {
  kind: StyleFingerprintSourceKind;
  id: string;
  version: number | null;
  label?: string;
};

/** Where onsets fall, as fractions of all onsets (sums to ~1). */
export type SubdivisionDistribution = { quarter: number; eighth: number; sixteenth: number; triplet: number; other: number };

export type StyleFingerprint = {
  version: "1.0";
  method: string;
  derivedAt: string;
  /** Digest of the inputs (song model / track models) the fingerprint was taken from. */
  inputsDigestSha256: string;
  source: StyleFingerprintSource;
  /** Structural guarantee, re-checked on every read: see assertContentFree. */
  contentFree: true;
  tempo: { bpm: number; stability: number; meter: string; behavior: "slow" | "moderate" | "fast" | "rubato_tolerant" | "strict_grid" };
  groove: {
    /** 0.5 straight … ~0.67 triplet swing, estimated from offbeat placement. */
    swingRatio: number;
    /** Mean signed onset offset from the 16th grid, ms (negative = ahead). */
    microtimingMs: number;
    microtiming: "quantized" | "on_top" | "behind" | "ahead" | "loose";
    /** Fraction of onsets on metrically weak positions. */
    syncopation: number;
    subdivisions: SubdivisionDistribution;
    /** Onsets per beat, mean. */
    onsetDensity: number;
  };
  harmony: {
    chordsPerBar: number;
    harmonicRhythm: "slow" | "moderate" | "fast";
    /** Share of chords beyond triads. */
    extensionShare: number;
    chordExtensions: "triads" | "sevenths" | "extended";
    keyChanges: number;
    /** Share of chords whose root moves by a fourth/fifth (functional motion). */
    functionalMotion: number;
  };
  /** Statistics of the melodic line — never the line. */
  melodicShape: {
    rangeSemitones: number;
    stepwiseRatio: number;
    leapRatio: number;
    meanIntervalSemitones: number;
    /** Median phrase length in beats (phrases split on rests ≥ one beat). */
    phraseLengthBeats: number;
    phraseLength: "short" | "regular" | "long" | "irregular";
    ornamentDensity: number;
    ornamentation: "none" | "light" | "moderate" | "heavy";
  };
  register: { low: number; mid: number; high: number; tendency: "low" | "mid" | "high" | "wide" };
  dynamics: { velocityP10: number; velocityP90: number; rangeClass: "narrow" | "moderate" | "wide" };
  /** Eight-point normalised energy arc over the piece (0..1). */
  energyArc: number[];
  density: { notesPerBarMean: number; notesPerBarP10: number; notesPerBarP90: number; arcShape: "flat" | "rising" | "falling" | "arch" | "valley" };
  instrumentation: {
    /** Families ordered by note share, most present first. */
    hierarchy: string[];
    familyShare: Record<string, number>;
    trackCount: number;
  };
  sectionCount: number;
  durationSeconds: number;
};

export type FingerprintFeatureDelta = {
  feature: string;
  left: number | string;
  right: number | string;
  /** 0 identical … 1 as different as the feature's range allows. */
  distance: number;
  /** A sentence a producer would say ("the reference swings harder: 0.62 vs 0.52"). */
  summary: string;
};

export type FingerprintComparison = {
  version: "1.0";
  leftId: string;
  rightId: string;
  /** Weighted mean of the per-feature distances, 0..1. */
  distance: number;
  deltas: FingerprintFeatureDelta[];
  /** The three largest differences, in words. */
  headline: string[];
};

export const styleFingerprintsTable = pgTable(
  "music_style_fingerprints",
  {
    id: text("id").primaryKey(),
    projectId: text("project_id").notNull().references(() => musicProjectsTable.id, { onDelete: "cascade" }),
    sourceKind: text("source_kind").notNull(),
    sourceId: text("source_id").notNull(),
    sourceVersion: integer("source_version"),
    digest: text("digest").notNull(),
    fingerprint: jsonb("fingerprint").$type<StyleFingerprint>().notNull(),
    createdBy: text("created_by").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [uniqueIndex("music_style_fingerprints_source_unique").on(table.projectId, table.sourceKind, table.sourceId, table.digest)],
);

// ---------------------------------------------------------------------------
// Wave U — PR-U4: reference tracks. A reference the user names or uploads,
// durable per project. What may be copied from it is an explicit, user-set
// scope; what *can* be read from it is only its PR-27 fingerprint — a named
// reference (a song or artist by name) has no audio and no fingerprint, so it
// stays a label that carries a scope and a rights note and nothing else. The
// row never holds the reference's content beyond what the project already
// stores for its own uploads (`sourceId` points at a `music_project_sources`
// row the same owner uploaded).
// ---------------------------------------------------------------------------

/** What a reference is allowed to lend the brief. `sound` is empty until audio features exist (PR-27). */
export type ReferenceCopyScope = "groove" | "sound" | "arrangement" | "mood";

export type ReferenceTrackKind = "uploaded_audio" | "named";

export const musicReferenceTracksTable = pgTable(
  "music_reference_tracks",
  {
    id: text("id").primaryKey(),
    projectId: text("project_id").notNull().references(() => musicProjectsTable.id, { onDelete: "cascade" }),
    /** Mirrors `music_projects.owner_id` (nullable there, so nullable here). */
    ownerId: text("owner_id"),
    kind: text("kind").$type<ReferenceTrackKind>().notNull(),
    label: text("label").notNull(),
    /** The owner's own upload this reference is (any of their projects); null for a named reference. */
    sourceId: text("source_id").references(() => projectSourcesTable.id, { onDelete: "set null" }),
    /** Version of that source's Song Model the fingerprint was taken from. */
    songModelVersion: integer("song_model_version"),
    /** The PR-27 row (`music_style_fingerprints`, sourceKind `reference_upload`). The only thing learning may read. */
    fingerprintId: text("fingerprint_id"),
    allowedScopes: jsonb("allowed_scopes").$type<ReferenceCopyScope[]>().notNull().default([]),
    /** The user's own statement of what this is ("my own demo", "commercial track for reference only"). Recorded, never assumed. */
    rightsNote: text("rights_note"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow().$onUpdate(() => new Date()),
  },
  (table) => [index("music_reference_tracks_project_idx").on(table.projectId, table.createdAt)],
);

// ---------------------------------------------------------------------------
// Wave 7 — PR-28: preference events. What the learning system may learn from.
//
// The producer-decision ledger (PR-19) records *that* a choice happened, with
// ids and one-way hashes only. A preference event records what the choice
// was *about*, in the only form that is rights-cleared by construction: the
// content-free fingerprint features of the subjects (PR-27), the critic and
// ranking scores, and the outcome. No note, audio or text of the music ever
// enters an event; `assertContentFree` is applied to every stored row.
// Writes obey the owner's learning controls; the owner can erase everything.
// ---------------------------------------------------------------------------

export type PreferenceEventKind = "pairwise" | "rating" | "approval" | "rejection";

export type PreferenceSubjectKind = "candidate" | "arrangement" | "mix_revision";

/**
 * Why the platform may learn from this subject at all. Platform-generated
 * material and the owner's own uploads are the only bases today; a
 * third-party reference reaches learning only as a fingerprint
 * (`fingerprint_only`), never as content.
 */
export type PreferenceRightsBasis = "platform_generated" | "owner_upload" | "fingerprint_only";

export type PreferenceSubject = {
  kind: PreferenceSubjectKind;
  id: string;
  fingerprintDigest: string | null;
  rankingScore: number | null;
  criticScore: number | null;
  modelVersion: string | null;
};

/** Named, content-free numeric features in a fixed order (see fingerprintFeatureVector). */
export type PreferenceFeatureVector = Record<string, number>;

export type PreferenceEvent = {
  id: string;
  ownerId: string;
  projectId: string;
  decisionId: string | null;
  kind: PreferenceEventKind;
  source: ProducerDecisionSource;
  rightsBasis: PreferenceRightsBasis;
  subject: PreferenceSubject;
  compared: PreferenceSubject | null;
  outcome: { preferred: "subject" | "compared" | null; rating: number | null; reasons: string[] };
  features: { subject: PreferenceFeatureVector; compared: PreferenceFeatureVector | null; delta: PreferenceFeatureVector | null };
  createdAt: string;
};

export const preferenceEventsTable = pgTable("music_preference_events", {
  id: text("id").primaryKey(),
  ownerId: text("owner_id").notNull(),
  projectId: text("project_id").notNull().references(() => musicProjectsTable.id, { onDelete: "cascade" }),
  decisionId: text("decision_id"),
  kind: text("kind").$type<PreferenceEventKind>().notNull(),
  source: text("source").$type<ProducerDecisionSource>().notNull(),
  rightsBasis: text("rights_basis").$type<PreferenceRightsBasis>().notNull(),
  subject: jsonb("subject").$type<PreferenceSubject>().notNull(),
  compared: jsonb("compared").$type<PreferenceSubject | null>(),
  outcome: jsonb("outcome").$type<PreferenceEvent["outcome"]>().notNull(),
  features: jsonb("features").$type<PreferenceEvent["features"]>().notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (table) => [
  index("music_preference_events_owner_created_at_idx").on(table.ownerId, table.createdAt),
  index("music_preference_events_project_idx").on(table.projectId),
]);

// ---------------------------------------------------------------------------
// Wave 7 — PR-29: pairwise arrangement critic, learned from preference events.
// A model is stored as a candidate with its held-out metrics; only a model
// that beat the critic-only baseline may be promoted to active, and an active
// model only decides the critics' near-ties.
// ---------------------------------------------------------------------------

export type PairwiseCriticModel = {
  version: "1.0";
  method: string;
  featureNames: string[];
  weights: number[];
  standardization: { mean: number[]; std: number[] };
  trainedOn: { events: number; trainingPairs: number; heldOutPairs: number };
  metrics: { heldOutAccuracy: number; baselineAccuracy: number; trainingLogLoss: number; heldOutLogLoss: number };
  influentialFeatures: Array<{ name: string; weight: number }>;
  promotable: boolean;
  promotionReason: string;
  trainedAt: string;
  inputsDigestSha256: string;
};

export type PairwiseCriticStatus = "candidate" | "active" | "retired";

export const pairwiseCriticModelsTable = pgTable("music_pairwise_critic_models", {
  id: text("id").primaryKey(),
  ownerId: text("owner_id").notNull(),
  version: integer("version").notNull(),
  status: text("status").$type<PairwiseCriticStatus>().notNull().default("candidate"),
  model: jsonb("model").$type<PairwiseCriticModel>().notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  promotedAt: timestamp("promoted_at", { withTimezone: true }),
  retiredAt: timestamp("retired_at", { withTimezone: true }),
}, (table) => [uniqueIndex("music_pairwise_critic_models_owner_version_unique").on(table.ownerId, table.version)]);

// ---------------------------------------------------------------------------
// Wave 7 — PR-30: personalized arrangement profile. The owner's learned
// *defaults*: StyleProfile dimensions derived from what they preferred, at
// `default` provenance so anything they state, research finds or the text
// implies always outranks them. Derived only from preference events (already
// consent-gated, rights-cleared and content-free).
// ---------------------------------------------------------------------------

export type PersonalDimensionEvidence = {
  dimension: StyleDimensionName;
  /** How many preferred subjects supported this value. */
  support: number;
  /** Fraction of pairwise choices that agreed with the direction / class (0.5 = coin flip). */
  agreement: number;
  summary: string;
};

export type PersonalizedArrangementProfile = {
  version: "1.0";
  method: string;
  derivedAt: string;
  inputsDigestSha256: string;
  support: { events: number; pairwise: number; preferredSubjects: number; dispreferredSubjects: number };
  /** Dimensions with enough consistent support; all `default` provenance. */
  dimensions: StyleProfileDimensions;
  evidence: PersonalDimensionEvidence[];
  /** Tendencies with too little or too mixed support to become defaults, kept for honesty. */
  undecided: Array<{ dimension: StyleDimensionName; reason: string }>;
};

export const personalArrangementProfilesTable = pgTable("music_personal_arrangement_profiles", {
  id: text("id").primaryKey(),
  ownerId: text("owner_id").notNull(),
  version: integer("version").notNull(),
  active: boolean("active").notNull().default(false),
  profile: jsonb("profile").$type<PersonalizedArrangementProfile>().notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (table) => [uniqueIndex("music_personal_arrangement_profiles_owner_version_unique").on(table.ownerId, table.version)]);

// ---------------------------------------------------------------------------
// Wave 7 — PR-31: the arranger training pipeline → YOUR_ARRANGER_MODEL.
// A model version is a learned arranger *policy* (planner hints + performance
// style) trained from every consented, content-free preference event, stored
// with the benchmark verdict that decides whether it may be promoted. Until a
// version is promoted the provider is shadow-only: usable for comparison,
// never the default. That is the plan's rule, in code.
// ---------------------------------------------------------------------------

export type ArrangerPolicy = {
  plannerHints: {
    /** Multiplier on every section's density (1 = the planner's own reading). */
    densityMultiplier: number;
    /** -1..1 bias on how many palette families stay active. */
    activeFamilyBias: number;
  };
  performanceStyle: PerformanceStyle;
};

export type ArrangerPolicyModel = {
  version: "0.1";
  id: "YOUR_ARRANGER_MODEL";
  method: string;
  trainedAt: string;
  inputsDigestSha256: string;
  trainedOn: {
    events: number;
    owners: number;
    pairwise: number;
    preferredSubjects: number;
    dispreferredSubjects: number;
    rightsBases: Record<string, number>;
  };
  /** True when the data decided nothing: the policy equals the reference pipeline. */
  neutral: boolean;
  policy: ArrangerPolicy;
  evidence: string[];
  undecided: string[];
};

export type ArrangerModelStatus = "candidate" | "active" | "retired";

export const arrangerModelVersionsTable = pgTable("music_arranger_model_versions", {
  id: text("id").primaryKey(),
  version: integer("version").notNull(),
  status: text("status").$type<ArrangerModelStatus>().notNull().default("candidate"),
  model: jsonb("model").$type<ArrangerPolicyModel>().notNull(),
  /** Reference run, candidate run and the verdict (arrangementBenchmark types). */
  benchmark: jsonb("benchmark").$type<Record<string, unknown>>().notNull(),
  beatsBaseline: boolean("beats_baseline").notNull().default(false),
  createdBy: text("created_by").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  promotedAt: timestamp("promoted_at", { withTimezone: true }),
  retiredAt: timestamp("retired_at", { withTimezone: true }),
}, (table) => [uniqueIndex("music_arranger_model_versions_version_unique").on(table.version)]);

/**
 * Mastering Engine (PR-26): what a master *achieved*, measured with
 * BS.1770-4 gated loudness and 4× true peak — never asserted from the
 * profile alone.
 */
export type MasteringReport = {
  version: "2.0";
  method: string;
  profile: string;
  intent: string;
  sampleRate: number;
  target: { integratedLufs: number; truePeakDbtp: number; stereoWidth: number; limiter: boolean };
  input: { integratedLufs: number | null; truePeakDbtp: number; loudnessRangeLu: number };
  output: { integratedLufs: number | null; truePeakDbtp: number; loudnessRangeLu: number; maxMomentaryLufs: number | null };
  gainDb: number;
  compression: { ratio: number; maxReductionDb: number };
  limiter: { enabled: boolean; maxReductionDb: number; limitedFrameRatio: number };
  /** Output loudness within ±1 LU of the target. */
  withinTarget: boolean;
  warnings: string[];
  steps: Array<{ step: string; detail: string }>;
  /** Tracks the profile left out of the mix (stems keep them). */
  excludedTracks: Array<{ trackId: string; role: string; family: string; reason: string }>;
};

/**
 * Mix Brain V1 (PR-25). A mix decided per musical role — not per track
 * index — that evolves across the song's sections, with every value
 * explained. `mixPlanToControls` turns it into the controls the mix/master
 * revision route already accepts, so the plan is auditioned, approved and
 * exported through the existing path.
 */
export type MixPlanTrack = {
  trackId: string;
  instrument: string;
  role: string;
  family: string;
  bus: MixMasterTrackControl["bus"];
  levelDb: number;
  pan: number;
  sendDb: number;
  processing: MixMasterTrackControl["processing"];
  /** 1 = foreground (lead) … 5 = deepest background (pad). */
  priority: number;
  rationale: string[];
  /** Per-section evolution, only for sections where the track plays. */
  sections: Array<{
    sectionName: string;
    startSeconds: number;
    endSeconds: number;
    levelOffsetDb: number;
    sendOffsetDb: number;
    reason: string;
  }>;
};

export type MixPlanConflict = {
  trackIds: [string, string];
  kind: "register_masking" | "role_duplicate";
  resolution: string;
};

export type MixPlan = {
  version: "1.0";
  method: string;
  derivedAt: string;
  inputsDigestSha256: string;
  arrangementId: string | null;
  tracks: MixPlanTrack[];
  master: {
    targetLufs: number;
    truePeakDbtp: number;
    processing: { limiter: boolean; stereoWidth: number };
    rationale: string[];
  };
  sections: Array<{
    sectionName: string;
    startSeconds: number;
    endSeconds: number;
    energy: number;
    density: number;
    /** The tracks the listener should follow in this section. */
    focusTrackIds: string[];
  }>;
  conflicts: MixPlanConflict[];
  /** StyleProfile dimensions that shaped the plan, with provenance. */
  styleInputs: Array<{ dimension: string; value: string | number; provenance: string }>;
};
export type MixMasterFinding = {
  id: string;
  severity: "info" | "warning" | "error";
  message: string;
  control: string;
  startSeconds: number;
  endSeconds: number;
};
export type MixMasterRevisionEvidence = {
  arrangementId: string;
  arrangementVersion: number;
  songModelVersion: number | null;
  timelineSha256: string;
  artifactIds: string[];
  variants: {
    original: { url: string; sourceId: string; timelineSha256: string; durationSeconds: number } | null;
    repaired: { url: string; artifactId: string; checksum: string; timelineSha256: string; durationSeconds: number } | null;
    mixed: { url: string; artifactId: string; checksum: string; timelineSha256: string; durationSeconds: number };
    mastered: { url: string; artifactId: string; checksum: string; timelineSha256: string; durationSeconds: number };
  };
  renderer: string;
  quality: { integratedLufs: number; truePeakDbtp: number; truePeakMethod: "4x-windowed-sinc-estimate"; findings: MixMasterFinding[] };
};

export type SongModelField =
  | "tempo"
  | "meter"
  | "key"
  | "melody"
  | "bass"
  | "harmony"
  | "sections"
  | "energy";
export type SongModelValidationIssue = {
  code: string;
  severity: "error" | "warning";
  path: string;
  message: string;
  provider?: string;
};

/**
 * Status of a derived musical-map group. Mirrors the discipline of
 * `vocalIntelligence`: when the evidence needed to derive a group is missing the
 * group is `not_available` with a `reason` and an empty payload — the map never
 * fabricates musical structure.
 */
export type MusicalMapStatus =
  | "detected"
  | "low_confidence"
  | "not_available"
  | "conflicting";

type MusicalMapGroup<T> = {
  status: MusicalMapStatus;
  reason: string | null;
  /** Song Model fields this group was derived from, e.g. `["chords", "beats"]`. */
  derivedFrom: string[];
  /** Versioned derivation method id, e.g. `"harmonic-rhythm/v1"`. */
  method: string;
} & T;

/** A bar-indexed span; canonical coordinates are filled in by canonicalization. */
export type MusicalMapBarSpan = {
  startBar: number;
  endBar: number;
  coordinates?: CanonicalTimeRange;
};

/**
 * Canonical Song Model V2 musical map — the derived analytical layer the
 * Arrangement Brain reads. Additive and optional: `contractVersion` stays
 * `"2.0"` and every field here is derived deterministically from evidence
 * already present on the model.
 */
export type SongModelMusicalMap = {
  version: "2.2";
  /** ISO timestamp the map was derived. */
  derivedAt: string;
  /** SHA-256 over the canonical evidence this map was derived from. */
  inputsDigestSha256: string;

  harmony: MusicalMapGroup<{
    harmonicRhythm: Array<MusicalMapBarSpan & { chordsPerBar: number }>;
    cadences: Array<{
      id: string;
      kind: "authentic" | "plagal" | "half" | "deceptive" | "none";
      atBar: number;
      strength: number;
      chordIndexes: number[];
      coordinates?: CanonicalTimeCoordinate;
    }>;
    tensionMap: Array<{
      start: number;
      end: number;
      tension: number;
      coordinates?: CanonicalTimeRange;
    }>;
  }>;

  melody: MusicalMapGroup<{
    phrases: Array<{
      id: string;
      start: number;
      end: number;
      noteIndexes: number[];
      contour: "rising" | "falling" | "arch" | "valley" | "flat" | "mixed";
      peakNoteIndex: number | null;
      density: number;
      range: { lowPitch: number; highPitch: number };
      coordinates?: CanonicalTimeRange;
    }>;
    motifs: Array<{
      id: string;
      label: string;
      intervalSignature: number[];
      rhythmSignature: number[];
      occurrences: Array<{
        phraseId: string;
        noteIndexes: number[];
        transposition: number;
        variation: "exact" | "transposed" | "rhythmic" | "developed";
      }>;
    }>;
    melodicDensity: Array<MusicalMapBarSpan & { notesPerBar: number }>;
    range: { lowPitch: number; highPitch: number } | null;
    contour: Array<{ time: number; pitch: number }>;
  }>;

  rhythm: MusicalMapGroup<{
    grooveProfile: {
      subdivision:
        | "straight-8"
        | "straight-16"
        | "swing-8"
        | "swing-16"
        | "triplet"
        | "mixed";
      swingRatio: number | null;
      pushPullMs: number | null;
    };
    syncopation: Array<MusicalMapBarSpan & { syncopation: number }>;
    subdivisions: Array<
      MusicalMapBarSpan & {
        dominant: "quarter" | "eighth" | "sixteenth" | "triplet";
      }
    >;
    rhythmicDensity: Array<MusicalMapBarSpan & { onsetsPerBar: number }>;
  }>;

  energy: MusicalMapGroup<{
    energyCurve: Array<MusicalMapBarSpan & { energy: number }>;
    dynamicCurve: Array<MusicalMapBarSpan & { dynamic: number }>;
    spectralDensity: Array<MusicalMapBarSpan & { density: number }>;
  }>;

  structure: MusicalMapGroup<{
    subphrases: Array<
      MusicalMapBarSpan & {
        id: string;
        sectionName: string;
        role:
          | "opening"
          | "development"
          | "response"
          | "cadence"
          | "pickup"
          | "fill";
      }
    >;
    transitions: Array<{
      id: string;
      fromSection: string;
      toSection: string;
      atBar: number;
      energyDelta: number;
      kind: "build" | "drop" | "continue" | "break";
      coordinates?: CanonicalTimeCoordinate;
    }>;
    climaxCandidates: Array<{
      id: string;
      atBar: number;
      score: number;
      evidence: string[];
      coordinates?: CanonicalTimeCoordinate;
    }>;
  }>;

  styleFingerprint: MusicalMapGroup<{
    tempoBand: "ballad" | "midtempo" | "uptempo" | "double-time" | null;
    meterFamily: string | null;
    harmonicComplexity: number | null;
    rhythmicComplexity: number | null;
    sectionContrast: number | null;
    instrumentPaletteHints: string[];
    orchestrationSize: "sparse" | "medium" | "dense" | null;
  }>;

  /**
   * Phrase-level vocal intelligence (PR-03). Derived from the verified
   * `vocalIntelligence` phrases/breaths + melody + energy. `phraseId` links to
   * `vocalIntelligence.phrases.events[].id`.
   */
  vocals: MusicalMapGroup<{
    phrases: Array<{
      phraseId: string;
      start: number;
      end: number;
      /** Voiced fraction of the phrase span, 0..1. */
      activity: number;
      /** Aligned melody-note rate across the phrase, notes/second. */
      density: number;
      range: { lowPitch: number; highPitch: number } | null;
      peakPitch: number | null;
      contour: "rising" | "falling" | "arch" | "valley" | "flat" | "mixed";
      /** End-of-phrase melodic motion. */
      cadence: "rising" | "falling" | "sustained" | "unknown";
      /** Phrase begins before its bar downbeat. */
      pickup: boolean;
      /** 0..1 from range, register height, and local energy. */
      emotionalIntensity: number;
      coordinates?: CanonicalTimeRange;
    }>;
    breathWindows: Array<{
      id: string;
      start: number;
      end: number;
      coordinates?: CanonicalTimeRange;
    }>;
    silenceWindows: Array<{
      id: string;
      start: number;
      end: number;
      coordinates?: CanonicalTimeRange;
    }>;
    vocalDensityCurve: Array<MusicalMapBarSpan & { vocalDensity: number }>;
    registerMap: Array<
      MusicalMapBarSpan & {
        register: "low" | "low_mid" | "mid" | "upper_mid" | "high";
      }
    >;
  }>;

  /**
   * Budget-annotated arrangement space (PR-03). Extends
   * `vocalIntelligence.arrangementSpace` windows with per-window
   * counter-melody / fill / pad budgets and a vocal-density level.
   */
  arrangementSpace: MusicalMapGroup<{
    windows: Array<{
      id: string;
      start: number;
      end: number;
      bars: number[];
      sections: string[];
      vocalDensity: "none" | "low" | "medium" | "high";
      counterMelodyBudget: number;
      fillBudget: number;
      padBudget: number;
      coordinates?: CanonicalTimeRange;
    }>;
  }>;
};

/** Musical domains reconciled independently across providers. */
export type AnalysisDomain =
  | "tempo"
  | "downbeats"
  | "meter"
  | "key"
  | "chords"
  | "melody"
  | "bass"
  | "sections"
  | "instruments";

export type DomainReconciliationCandidate = {
  value: string | number;
  /** Summed provider weight (confidence x reliability), clamped to [0, 1]. */
  score: number;
  providers: string[];
  /** Musical relation to the leading candidate (PR-89); absent on the leader. */
  relationToLeader?: string;
};

export type DomainReconciliation = {
  domain: AnalysisDomain;
  value: string | number | null;
  confidence: number | null;
  providers: string[];
  /** `not_available` is the disagreement engine's UNKNOWN: no usable evidence. */
  status: "detected" | "low_confidence" | "contested" | "not_available";
  message: string | null;
  margin: number | null;
  /** Present when `status` is `contested`: every value with real weight, strongest first. */
  candidates?: DomainReconciliationCandidate[];
  /** Relation between the two leading candidates when contested (PR-89). */
  relation?: string | null;
  /** What evidence would settle an open question (PR-89). */
  whatWouldSettleIt?: string | null;
};

/**
 * Per-domain provider reconciliation. `consensusScore` is the mean confidence
 * across domains that resolved to `detected`; `contestedDomains` did not.
 */
/**
 * Structure evidence (PR-87): every independent section reading of the
 * analysed window and their reconciliation — boundaries two readings agree
 * on are corroborated, one reading's alone are lone, and every disagreement
 * is a contested region carrying both readings. Additive: `sections` on the
 * Song Model are still chosen by the default path; this records what the
 * candidates said so a person (or Stream I) can weigh them.
 */
export type StructureEvidenceReport = {
  version: "STRUCTURE_EVIDENCE_V1";
  /** The analysed window in source seconds. */
  window: { start: number; end: number };
  readings: Array<{
    provider: string;
    /** Interior boundaries in source seconds. */
    boundaries: number[];
    /** Section letters (or the provider's names) in order. */
    form: string;
    confidence: number | null;
  }>;
  status: "detected" | "low_confidence" | "contested" | "not_available";
  boundaries: Array<{
    time: number;
    status: "corroborated" | "lone";
    providers: string[];
    score: number;
  }>;
  sections: Array<{
    start: number;
    end: number;
    label: string;
    labelStatus: "agreed" | "majority" | "contested" | "single_source";
    confidence: number;
  }>;
  contested: Array<{
    start: number;
    end: number;
    kind: "boundary" | "label";
    candidates: Array<{ provider: string; reading: string; score: number }>;
  }>;
  message: string;
};

export type DomainReconciliationReport = {
  version: "1.0";
  domains: Partial<Record<AnalysisDomain, DomainReconciliation>>;
  consensusScore: number;
  contestedDomains: AnalysisDomain[];
  /** PR-89: the engine's four-way verdict per domain (unknown vs contested vs low_confidence vs detected). */
  verdicts?: Partial<Record<AnalysisDomain, "detected" | "low_confidence" | "contested" | "unknown">>;
  engine?: {
    version: string;
    thresholds: {
      contestFloor: number;
      contestRatio: number;
      corroborationMargin: number;
      singleObservationFloor: number;
    };
  };
  /** Present when the analyzer ran the structure candidates (PR-87). */
  structure?: StructureEvidenceReport;
};

export type SongModelData = SongModelCore & {
  contractVersion: "1.0" | "2.0";
  /**
   * Canonical v2 models declare their musical coordinate system explicitly.
   * Historical v1 models remain readable without this field.
   */
  timebase?: {
    ppq: 960;
    originSeconds: 0;
    coordinateSystem: "seconds+ticks";
  };
  validation: {
    status: "accepted" | "flagged";
    issues: SongModelValidationIssue[];
  };
  fusion: {
    selectedProvider: string | null;
    confidence: number;
    decisions: ProviderFusionDecision[];
  };
  audio: SongModelCore["audio"] & {
    proxyObjectPath: string | null;
    proxyContentType: string | null;
    analysisStartSeconds: number;
    analysisDurationSeconds: number;
    analysisCoverage: "full" | "representative";
  };
  analysisStartSeconds: number;
  analysisDurationSeconds: number;
  analysisCoverage: number;
  beats: Array<{
    time: number;
    beat: number;
    bar: number;
    confidence: number;
    coordinates?: CanonicalTimeCoordinate;
  }>;
  bars: Array<{
    bar: number;
    start: number;
    end: number;
    beats: number;
    confidence: number;
    coordinates?: CanonicalTimeRange;
  }>;
  dynamics: number[];
  waveform: number[];
  stems: Array<{
    name: string;
    role: string;
    source: string;
    channels: number;
    confidence: number;
  }>;
  sourceStems: Array<{
    role: string;
    objectPath: string;
    provider: string;
    confidence: number;
    /** SHA-256 of the persisted provider stem bytes when available. */
    checksum?: string;
  }>;
  /**
   * Activity observations made solely from decoded PCM of a verified
   * vocal/voice separation stem. This deliberately does not infer vocal
   * space from lyrics, melody, structure, or full-mix duration.
   */
  vocalEvidence?: {
    status: "detected" | "low_confidence" | "not_available" | "failed";
    reason: string | null;
    provenance: {
      sourceStemRole: string;
      objectPath: string;
      provider: string;
      contentChecksum?: string;
    } | null;
    sampleRate: number | null;
    channels: number | null;
    frameSizeSamples: number | null;
    thresholds: {
      rms: number;
      peak: number;
      activitySample: number;
      activityRatio: number;
    } | null;
    observedVoicedWindows: Array<{
      start: number;
      end: number;
      coordinates?: CanonicalTimeRange;
    }>;
    observedSilentWindows: Array<{
      start: number;
      end: number;
      coordinates?: CanonicalTimeRange;
    }>;
  };
  vocalIntelligence?: {
    version: "1.0";
    provenance: {
      sourceStemRole: string;
      objectPath: string;
      provider: string;
      contentChecksum?: string;
    } | null;
    phrases: {
      status: "detected" | "low_confidence" | "not_available" | "conflicting";
      reason: string | null;
      events: Array<{
        id: string;
        start: number;
        end: number;
        confidence: number;
        coordinates?: CanonicalTimeRange;
      }>;
    };
    breaths: {
      status: "detected" | "not_available";
      reason: string | null;
      events: Array<{
        id: string;
        start: number;
        end: number;
        confidence: number;
        kind: "inter_phrase";
        coordinates?: CanonicalTimeRange;
      }>;
    };
    lyricAlignment: {
      status: "aligned" | "not_available" | "conflicting";
      reason: string | null;
      alignments: Array<{ phraseId: string; lyricIndexes: number[]; confidence: number }>;
    };
    melodyAlignment: {
      status: "aligned" | "not_available" | "conflicting";
      reason: string | null;
      alignments: Array<{ phraseId: string; melodyIndexes: number[]; confidence: number }>;
    };
    arrangementSpace: {
      status: "detected" | "not_available";
      reason: string | null;
      windows: Array<{
        id: string;
        start: number;
        end: number;
        confidence: number;
        phraseBeforeId: string | null;
        phraseAfterId: string | null;
        bars: number[];
        sections: string[];
        coordinates?: CanonicalTimeRange;
      }>;
    };
  };
  lyrics: Array<{
    start: number;
    end: number;
    text: string;
    confidence: number;
    coordinates?: CanonicalTimeRange;
  }>;
  /**
   * Derived musical map (Canonical Song Model V2). Present on freshly analysed
   * v2 models; absent on historical models until they are re-derived.
   */
  musicalMap?: SongModelMusicalMap;
  /**
   * Per-domain provider reconciliation (Analysis Reconciliation V2). Records how
   * strongly the independent providers agreed on each musical fact.
   */
  reconciliation?: DomainReconciliationReport;
  confidenceByField: Record<string, number>;
  providerProvenance: Array<{
    capability: string;
    provider: string;
    version: string;
    status: "ready" | "fallback" | "unavailable" | "failed";
    attempts?: number;
    errorCode?: string;
    errorMessage?: string;
  }>;
  rhythmEvidence?: Array<{
    provider: string;
    version: string;
    beats: number[];
    downbeats: number[];
    tempoBpm: number;
  }>;
  timingEvidence?: Array<{
    provider: string;
    version: string;
    events: Array<{
      start: number;
      end: number;
      beat: number;
    }>;
  }>;
  pitchEvidence?: Array<{
    provider: string;
    version: string;
    sourceStem: string;
    frames: Array<{
      time: number;
      frequencyHz: number;
      midiPitch: number | null;
      periodicity: number;
      voiced: boolean;
      confidence: number;
    }>;
  }>;
  keyEvidence?: Array<{
    provider: string;
    version: string;
    key: string;
    scale: string;
    confidence: number;
    hpcp: number[];
  }>;
  loudness?: {
    provider: string;
    version: string;
    integratedLUFS: number;
    loudnessRange: number;
    /** Linear sample peak. This is deliberately not labelled true peak. */
    samplePeak: number;
  } | null;
  fieldStatus?: Partial<Record<SongModelField, SongModelFieldStatus>>;
  provenance?: Partial<Record<SongModelField, string[]>>;
};

export type SongModelCorrection = {
  correctedBy: string;
  correctedAt: string;
  fields: Array<"bpm" | "key" | "meter" | "sections" | "chords">;
};

export type ModelCapability =
  | "separation"
  | "structure"
  | "transcription"
  | "harmony"
  | "arrangement"
  | "orchestration"
  | "audio_generation";

export type ProviderAvailabilityStatus =
  | "ready"
  | "configured"
  | "unavailable";

export type ProviderHealthStatus =
  | "healthy"
  | "unhealthy"
  | "unknown";

export type ProviderRuntimeSnapshot = {
  availability: ProviderAvailabilityStatus;
  configurationReady: boolean;
  checkpointReady: boolean;
  runtimeReady: boolean;
  smokeTested: boolean;
  healthStatus: ProviderHealthStatus;
  checkedAt: string | null;
  latencyMs: number | null;
  message: string | null;
  reportedVersion: string | null;
  // A provider may advertise a lower per-request candidate ceiling during its
  // health check. Absent means that the platform ceiling applies.
  maximumCandidates?: number | null;
  reportedChecksum?: string | null;
  runtimeProvenance?: {
    model: string;
    checkpointSha256: string;
    revision: string;
    modalImageId: string;
    sourceImageDigest: string;
    cudaVersion: string;
    pytorchVersion: string;
    gpu: string;
  } | null;
};

export const musicProjectsTable = pgTable("music_projects", {
  id: text("id").primaryKey(),
  name: text("name").notNull(),
  sourceType: text("source_type").notNull(),
  sourceName: text("source_name"),
  ownerId: text("owner_id"),
  status: text("status").notNull().default("draft"),
  duration: text("duration").notNull().default("0:00"),
  key: text("key").notNull().default("—"),
  bpm: doublePrecision("bpm").notNull().default(0),
  meter: text("meter").notNull().default("4/4"),
  confidence: doublePrecision("confidence").notNull().default(0),
  coverColor: text("cover_color").notNull().default("#7c3aed"),
  sections: jsonb("sections").$type<AnalysisSection[]>().notNull().default([]),
  energy: jsonb("energy").$type<number[]>().notNull().default([]),
  providers: jsonb("providers").$type<string[]>().notNull().default([]),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true })
    .notNull()
    .defaultNow()
    .$onUpdate(() => new Date()),
});

export type ProjectCleanupStatus = "queued" | "running" | "partial" | "completed";
export const projectSourcesTable = pgTable("music_project_sources", {
  id: text("id").primaryKey(),
  projectId: text("project_id")
    .notNull()
    .references(() => musicProjectsTable.id, { onDelete: "cascade" }),
  ownerId: text("owner_id").notNull(),
  objectPath: text("object_path").notNull(),
  name: text("name").notNull(),
  size: integer("size").notNull(),
  contentType: text("content_type").notNull(),
  sourceType: text("source_type").notNull(),
  status: text("status").notNull().default("queued"),
  progress: integer("progress").notNull().default(0),
  durationSeconds: doublePrecision("duration_seconds"),
  sampleRate: integer("sample_rate"),
  channels: integer("channels"),
  error: text("error"),
  analysisLeaseId: text("analysis_lease_id"),
  analysisLeaseExpiresAt: timestamp("analysis_lease_expires_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true })
    .notNull()
    .defaultNow()
    .$onUpdate(() => new Date()),
});

export const analysisAttemptsTable = pgTable(
  "music_analysis_attempts",
  {
    id: text("id").primaryKey(),
    projectId: text("project_id")
      .notNull()
      .references(() => musicProjectsTable.id, { onDelete: "cascade" }),
    sourceId: text("source_id")
      .notNull()
      .references(() => projectSourcesTable.id, { onDelete: "cascade" }),
    attemptNumber: integer("attempt_number").notNull(),
    status: text("status").notNull().default("queued"),
    stage: text("stage").notNull().default("queued"),
    progress: integer("progress").notNull().default(0),
    error: text("error"),
    startedAt: timestamp("started_at", { withTimezone: true }),
    completedAt: timestamp("completed_at", { withTimezone: true }),
    heartbeatAt: timestamp("heartbeat_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow()
      .$onUpdate(() => new Date()),
  },
  (table) => [
    uniqueIndex("music_analysis_attempts_source_number_unique")
      .on(table.sourceId, table.attemptNumber),
  ],
);
export const songModelsTable = pgTable(
  "music_song_models",
  {
    id: text("id").primaryKey(),
    projectId: text("project_id")
      .notNull()
      .references(() => musicProjectsTable.id, { onDelete: "cascade" }),
    sourceId: text("source_id")
      .notNull()
      .references(() => projectSourcesTable.id, { onDelete: "cascade" }),
    version: integer("version").notNull().default(1),
    status: text("status").notNull().default("ready"),
    analysisJobId: text("analysis_job_id"),
    parentModelId: text("parent_model_id"),
    correction: jsonb("correction").$type<SongModelCorrection | null>(),
    model: jsonb("model").$type<SongModelData>().notNull(),
    providers: jsonb("providers").$type<string[]>().notNull().default([]),
    confidence: doublePrecision("confidence").notNull().default(0),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex("music_song_models_analysis_job_idx").on(table.analysisJobId),
    uniqueIndex("music_song_models_project_version_idx").on(
      table.projectId,
      table.version,
    ),
  ],
);

export const modelRegistryTable = pgTable("music_model_registry", {
  id: text("id").primaryKey(),
  name: text("name").notNull(),
  provider: text("provider").notNull(),
  version: text("version").notNull(),
  capabilities: jsonb("capabilities").$type<ModelCapability[]>().notNull().default([]),
  inputTypes: jsonb("input_types").$type<string[]>().notNull().default([]),
  execution: text("execution").notNull(),
  status: text("status")
    .$type<ProviderAvailabilityStatus>()
    .notNull()
    .default("unavailable"),
  configurationReady: boolean("configuration_ready").notNull().default(false),
  checkpointReady: boolean("checkpoint_ready").notNull().default(false),
  runtimeReady: boolean("runtime_ready").notNull().default(false),
  healthStatus: text("health_status")
    .$type<ProviderHealthStatus>()
    .notNull()
    .default("unknown"),
  healthCheckedAt: timestamp("health_checked_at", { withTimezone: true }),
  healthLatencyMs: integer("health_latency_ms"),
  healthMessage: text("health_message"),
  reportedVersion: text("reported_version"),
  license: text("license"),
  priority: integer("priority").notNull().default(100),
  notes: text("notes"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true })
    .notNull()
    .defaultNow()
    .$onUpdate(() => new Date()),
});

export const analysisJobsTable = pgTable("music_analysis_jobs", {
  id: text("id").primaryKey(),
  projectId: text("project_id")
    .notNull()
    .references(() => musicProjectsTable.id, { onDelete: "cascade" }),
  sourceId: text("source_id")
    .notNull()
    .references(() => projectSourcesTable.id, { onDelete: "cascade" }),
  status: text("status").notNull().default("queued"),
  stage: text("stage").notNull().default("queued"),
  progress: integer("progress").notNull().default(0),
  attempt: integer("attempt").notNull().default(1),
  error: text("error"),
  workerId: text("worker_id"),
  leaseVersion: integer("lease_version").notNull().default(0),
  leaseExpiresAt: timestamp("lease_expires_at", { withTimezone: true }),
  startedAt: timestamp("started_at", { withTimezone: true }),
  finishedAt: timestamp("finished_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true })
    .notNull()
    .defaultNow()
    .$onUpdate(() => new Date()),
}, (table) => [
  uniqueIndex("music_analysis_jobs_source_attempt_idx").on(table.sourceId, table.attempt),
]);

export const arrangementsTable = pgTable(
  "music_arrangements",
  {
    id: text("id").primaryKey(),
    projectId: text("project_id")
      .notNull()
      .references(() => musicProjectsTable.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    style: text("style").notNull(),
    mode: text("mode").notNull(),
    version: integer("version").notNull().default(1),
    status: text("status").notNull().default("draft"),
    harmonyComplexity: integer("harmony_complexity").notNull().default(5),
    energy: doublePrecision("energy").notNull().default(0.6),
    density: doublePrecision("density").notNull().default(0.55),
    orchestraSize: doublePrecision("orchestra_size").notNull().default(0.5),
    rhythmIntensity: doublePrecision("rhythm_intensity").notNull().default(0.6),
    sections: jsonb("sections").$type<ArrangementSection[]>().notNull().default([]),
    generationProvider: text("generation_provider"),
    candidates: jsonb("candidates").$type<ArrangementCandidateData[]>().notNull().default([]),
    selectedCandidateId: text("selected_candidate_id"),
    sourceGenerationJobId: text("source_generation_job_id"),
    sourceCandidateId: text("source_candidate_id"),
    generationProvenance: jsonb("generation_provenance")
      .$type<ArrangementGenerationProvenance>(),
    styleSpec: jsonb("style_spec").$type<StyleSpec | null>(),
    plan: jsonb("plan").$type<ArrangementPlan | null>(),
    trackModels: jsonb("track_models").$type<TrackModel[]>().notNull().default([]),
    songModelVersion: integer("song_model_version"),
    parentArrangementId: text("parent_arrangement_id"),
    parameters: jsonb("parameters").$type<Record<string, number | string | boolean>>()
      .notNull()
      .default({}),
    seed: integer("seed"),
    modelVersion: text("model_version"),
    provenance: jsonb("provenance").$type<ArtifactProvenance | null>(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex("music_arrangements_source_candidate_unique").on(
      table.sourceCandidateId,
    ),
  ],
);

export const arrangementRevisionsTable = pgTable(
  "music_arrangement_revisions",
  {
    id: text("id").primaryKey(),
    arrangementId: text("arrangement_id")
      .notNull()
      .references(() => arrangementsTable.id, { onDelete: "cascade" }),
    version: integer("version").notNull(),
    snapshot: jsonb("snapshot").$type<ArrangementRevisionSnapshot>().notNull(),
    summary: jsonb("summary").$type<ArrangementRevisionSummary>().notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex("music_arrangement_revisions_arrangement_version_unique").on(
      table.arrangementId,
      table.version,
    ),
  ],
);
export const musicGenerationJobsTable = pgTable("music_generation_jobs", {
  id: text("id").primaryKey(),
  projectId: text("project_id")
    .notNull()
    .references(() => musicProjectsTable.id, { onDelete: "cascade" }),
  arrangementId: text("arrangement_id")
    .notNull()
    .references(() => arrangementsTable.id, { onDelete: "cascade" }),
  songModelId: text("song_model_id").references(() => songModelsTable.id, {
    onDelete: "set null",
  }),
  songModelVersion: integer("song_model_version"),
  task: text("task").$type<MusicGenerationTask>().notNull(),
  status: text("status").notNull().default("queued"),
  provider: text("provider").notNull(),
  modelVersion: text("model_version").notNull(),
  providerRuntime: jsonb("provider_runtime").$type<ProviderRuntimeSnapshot | null>(),
  hardware: text("hardware").notNull(),
  speed: text("speed").notNull(),
  progress: integer("progress").notNull().default(0),
  stage: text("stage").notNull().default("queued"),
  providerRequestId: text("provider_request_id"),
  providerCancelUrl: text("provider_cancel_url"),
  providerCancellationAcknowledgedAt: timestamp(
    "provider_cancellation_acknowledged_at",
    { withTimezone: true },
  ),
  workerId: text("worker_id"),
  leaseVersion: integer("lease_version").notNull().default(0),
  heartbeatAt: timestamp("heartbeat_at", { withTimezone: true }),
  leaseExpiresAt: timestamp("lease_expires_at", { withTimezone: true }),
  idempotencyKey: text("idempotency_key"),
  attempt: integer("attempt").notNull().default(0),
  maxAttempts: integer("max_attempts").notNull().default(3),
  retryable: boolean("retryable").notNull().default(true),
  cancelRequestedAt: timestamp("cancel_requested_at", { withTimezone: true }),
  errorCode: text("error_code"),
  requestedCandidates: integer("requested_candidates").notNull().default(1),
  seed: integer("seed").notNull(),
  parameters: jsonb("parameters")
    .$type<GenerationParameters>()
    .notNull()
    .default({}),
  parentArtifactIds: jsonb("parent_artifact_ids")
    .$type<string[]>()
    .notNull()
    .default([]),
  inputSnapshot: jsonb("input_snapshot")
    .$type<GenerationInputSnapshot>()
    .notNull(),
  error: text("error"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true })
    .notNull()
    .defaultNow()
    .$onUpdate(() => new Date()),
  completedAt: timestamp("completed_at", { withTimezone: true }),
}, (table) => [
  uniqueIndex("music_generation_jobs_arrangement_idempotency_unique").on(
    table.arrangementId,
    table.idempotencyKey,
  ),
]);
const emptyTrackPerformance: TrackPerformance = {
  tempoMap: [],
  meterMap: [],
  notes: [],
  expression: [],
  articulations: [],
};

export const tracksTable = pgTable("music_tracks", {
  id: text("id").primaryKey(),
  projectId: text("project_id")
    .notNull()
    .references(() => musicProjectsTable.id, { onDelete: "cascade" }),
  name: text("name").notNull(),
  role: text("role").notNull(),
  kind: text("kind").notNull(),
  color: text("color").notNull(),
  volume: doublePrecision("volume").notNull().default(0),
  muted: boolean("muted").notNull().default(false),
  solo: boolean("solo").notNull().default(false),
  status: text("status").notNull(),
  performance: jsonb("performance")
    .$type<TrackPerformance>()
    .notNull()
    .default(emptyTrackPerformance),
  instrumentDefinition: jsonb("instrument_definition").$type<InstrumentDefinition | null>(),
  trackModel: jsonb("track_model").$type<TrackModel | null>(),
  provenance: jsonb("provenance").$type<ArtifactProvenance | null>(),
});

export const musicArtifactsTable = pgTable("music_artifacts", {
  id: text("id").primaryKey(),
  projectId: text("project_id")
    .notNull()
    .references(() => musicProjectsTable.id, { onDelete: "cascade" }),
  type: text("type").notNull(),
  label: text("label").notNull(),
  version: integer("version").notNull().default(1),
  size: text("size").notNull(),
  format: text("format").notNull(),
  url: text("url"),
  state: text("state").notNull().default("ready"),
  hash: text("hash"),
  checksum: text("checksum"),
  parentIds: jsonb("parent_ids").$type<string[]>().notNull().default([]),
  createdBy: text("created_by"),
  modelVersion: text("model_version"),
  parameters: jsonb("parameters").$type<Record<string, number | string | boolean>>()
    .notNull()
    .default({}),
  storageUri: text("storage_uri"),
  technicalMetadata: jsonb("technical_metadata")
    .$type<Record<string, string | number | boolean | null>>()
    .notNull()
    .default({}),
  provider: text("provider"),
  license: text("license"),
  retentionPolicy: text("retention_policy").notNull().default("project"),
  expiresAt: timestamp("expires_at", { withTimezone: true }),
  immutable: boolean("immutable").notNull().default(true),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

/**
 * Provider-neutral queue contract for long-running work that is not represented
 * by the legacy analysis or arrangement tables. A row is the source of truth
 * for recovery; workers must fence every write with workerId + leaseVersion.
 */
export const productionJobsTable = pgTable("music_production_jobs", {
  id: text("id").primaryKey(),
  projectId: text("project_id")
    .notNull()
    .references(() => musicProjectsTable.id, { onDelete: "cascade" }),
  ownerId: text("owner_id").notNull(),
  kind: text("kind").$type<ProductionJobKind>().notNull(),
  status: text("status").$type<ProductionJobStatus>().notNull().default("queued"),
  stage: text("stage").notNull().default("queued"),
  progress: integer("progress").notNull().default(0),
  attempt: integer("attempt").notNull().default(0),
  maxAttempts: integer("max_attempts").notNull().default(3),
  idempotencyKey: text("idempotency_key").notNull(),
  inputSnapshot: jsonb("input_snapshot").$type<Record<string, unknown>>().notNull(),
  requiredCapabilities: jsonb("required_capabilities").$type<string[]>().notNull().default([]),
  resourcePool: text("resource_pool").notNull().default("AUTO"),
  provider: text("provider"),
  modelVersion: text("model_version"),
  workerId: text("worker_id"),
  leaseVersion: integer("lease_version").notNull().default(0),
  heartbeatAt: timestamp("heartbeat_at", { withTimezone: true }),
  leaseExpiresAt: timestamp("lease_expires_at", { withTimezone: true }),
  cancelRequestedAt: timestamp("cancel_requested_at", { withTimezone: true }),
  retryable: boolean("retryable").notNull().default(true),
  error: jsonb("error").$type<ProductionJobError | null>(),
  outputArtifactIds: jsonb("output_artifact_ids").$type<string[]>().notNull().default([]),
  estimatedCostUnits: integer("estimated_cost_units").notNull().default(0),
  actualCostUnits: integer("actual_cost_units"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true })
    .notNull()
    .defaultNow()
    .$onUpdate(() => new Date()),
  completedAt: timestamp("completed_at", { withTimezone: true }),
}, (table) => [
  uniqueIndex("music_production_jobs_project_idempotency_unique").on(
    table.projectId,
    table.idempotencyKey,
  ),
]);
export const musicExportsTable = pgTable("music_exports", {
  id: text("id").primaryKey(),
  projectId: text("project_id")
    .notNull()
    .references(() => musicProjectsTable.id, { onDelete: "cascade" }),
  arrangementId: text("arrangement_id")
    .notNull()
    .references(() => arrangementsTable.id, { onDelete: "cascade" }),
  status: text("status").notNull().default("rendering"),
  masterProfile: text("master_profile").notNull(),
  bundleUrl: text("bundle_url"),
  files: jsonb("files").$type<ExportFileRecord[]>().notNull().default([]),
  error: text("error"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  completedAt: timestamp("completed_at", { withTimezone: true }),
});

export const mixMasterRevisionsTable = pgTable(
  "music_mix_master_revisions",
  {
    id: text("id").primaryKey(),
    projectId: text("project_id").notNull().references(() => musicProjectsTable.id, { onDelete: "cascade" }),
    arrangementId: text("arrangement_id").notNull().references(() => arrangementsTable.id, { onDelete: "restrict" }),
    version: integer("version").notNull(),
    controls: jsonb("controls").$type<MixMasterControls>().notNull(),
    evidence: jsonb("evidence").$type<MixMasterRevisionEvidence>().notNull(),
    previewArtifactId: text("preview_artifact_id").notNull().references(() => musicArtifactsTable.id, { onDelete: "restrict" }),
    approvedAt: timestamp("approved_at", { withTimezone: true }),
    approvedBy: text("approved_by"),
    createdBy: text("created_by").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [uniqueIndex("music_mix_master_revisions_project_version_unique").on(table.projectId, table.version)],
);

export const studioActivitiesTable = pgTable("studio_activities", {
  id: text("id").primaryKey(),
  projectId: text("project_id").references(() => musicProjectsTable.id, {
    onDelete: "cascade",
  }),
  title: text("title").notNull(),
  detail: text("detail").notNull(),
  type: text("type").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

/**
 * Private, append-only producer learning record. `context` deliberately holds
 * stable IDs and server-derived hashes only; it must never contain object paths,
 * signed URLs, or acoustic fingerprints.
 */
export type ProducerDecisionContext = {
  subjectId: string | null;
  comparedSubjectId: string | null;
  modelVersion: string | null;
  evidenceIds: string[];
  lineageIds: string[];
  evidenceSha256: string | null;
  rankingScore?: number | null;
  criticScore?: number | null;
};
export type ProducerDecisionSource =
  | "explicit_feedback"
  | "inferred_behavior"
  | "objective_evidence";
export const producerDecisionsTable = pgTable("music_producer_decisions", {
  id: text("id").primaryKey(),
  ownerId: text("owner_id").notNull(),
  projectId: text("project_id").notNull().references(() => musicProjectsTable.id, { onDelete: "cascade" }),
  domain: text("domain").notNull(),
  kind: text("kind").notNull(),
  source: text("source").$type<ProducerDecisionSource>().notNull(),
  rating: integer("rating"),
  reasons: jsonb("reasons").$type<string[]>().notNull().default([]),
  context: jsonb("context").$type<ProducerDecisionContext>().notNull(),
  version: integer("version").notNull().default(1),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (table) => [
  index("music_producer_decisions_owner_created_at_idx").on(table.ownerId, table.createdAt),
]);

export const producerPreferencesTable = pgTable("music_producer_preferences", {
  ownerId: text("owner_id").primaryKey(),
  learningEnabled: boolean("learning_enabled").notNull().default(true),
  inferredBehaviorEnabled: boolean("inferred_behavior_enabled").notNull().default(true),
  version: integer("version").notNull().default(1),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

/** Immutable snapshots preserve owner preference-control history. */
export const producerPreferenceVersionsTable = pgTable("music_producer_preference_versions", {
  id: text("id").primaryKey(),
  ownerId: text("owner_id").notNull(),
  version: integer("version").notNull(),
  learningEnabled: boolean("learning_enabled").notNull(),
  inferredBehaviorEnabled: boolean("inferred_behavior_enabled").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (table) => [uniqueIndex("music_producer_preference_versions_unique").on(table.ownerId, table.version)]);

export const calibrationVersionsTable = pgTable("music_calibration_versions", {
  id: text("id").primaryKey(),
  ownerId: text("owner_id").notNull(),
  version: integer("version").notNull(),
  rankingWeight: doublePrecision("ranking_weight").notNull(),
  criticWeight: doublePrecision("critic_weight").notNull(),
  heldOutAgreement: doublePrecision("held_out_agreement").notNull(),
  baselineAgreement: doublePrecision("baseline_agreement").notNull(),
  heldOutExamples: integer("held_out_examples"),
  evaluationSha256: text("evaluation_sha256"),
  status: text("status").notNull().default("candidate"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  promotedAt: timestamp("promoted_at", { withTimezone: true }),
}, (table) => [uniqueIndex("music_calibration_versions_owner_version_unique").on(table.ownerId, table.version)]);
export const calibrationActivePointersTable = pgTable("music_calibration_active_pointers", {
  ownerId: text("owner_id").primaryKey(),
  calibrationVersionId: text("calibration_version_id").notNull().references(() => calibrationVersionsTable.id, { onDelete: "restrict" }),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});
export const calibrationActivationHistoryTable = pgTable("music_calibration_activation_history", {
  id: text("id").primaryKey(),
  ownerId: text("owner_id").notNull(),
  calibrationVersionId: text("calibration_version_id").notNull().references(() => calibrationVersionsTable.id, { onDelete: "restrict" }),
  action: text("action").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const musicAuditEventsTable = pgTable("music_audit_events", {
  id: text("id").primaryKey(),
  projectId: text("project_id").references(() => musicProjectsTable.id, {
    onDelete: "cascade",
  }),
  actorId: text("actor_id"),
  action: text("action").notNull(),
  resourceType: text("resource_type").notNull(),
  resourceId: text("resource_id"),
  requestId: text("request_id"),
  outcome: text("outcome").notNull().default("success"),
  metadata: jsonb("metadata")
    .$type<Record<string, string | number | boolean | null>>()
    .notNull()
    .default({}),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});
export type GenerationInputSnapshot = {
  operation: AceStepOperation | null;
  sourceArtifactId: string | null;
  instrument: string | null;
  region: AceStepRegion | null;
  arrangement: {
    id: string;
    version: number;
    style: string;
    mode: string;
    status: string;
    harmonyComplexity: number;
    energy: number;
    density: number;
    orchestraSize: number;
    rhythmIntensity: number;
  };
  songModel: unknown;
  tracks: Array<{ id: string; name: string; role: string; instrument: string }>;
  /** Immutable approved producer controls frozen before provider work begins. */
  generationPreference?: GenerationPreferenceSnapshot | null;
  /** Absent on generation jobs persisted before bounded repairs were introduced. */
  repair?: CandidateRepairSnapshot | null;
};

export type CriticRepairFinding = {
  id: string;
  affectedSections: string[];
  startBar: number;
  endBar: number;
  affectedTrackIds: string[];
  /** Roles are copied from the rendered tracks, never inferred from names. */
  affectedRoles?: string[];
  /** Inclusive canonical bar scope used by repair validation. */
  canonicalScope?: { startBar: number; endBar: number };
  /** Bounded, non-secret references to the evidence used for this finding. */
  evidenceReferences?: Array<{ source: string; summary: string }>;
  /** The repair worker may perform only one of these local operations. */
  permissibleRepairOperations?: CriticRepairOperation[];
  musicalReason: string;
};
export type CriticRepairOperation =
  | "adjust_notes"
  | "adjust_rhythm"
  | "adjust_register"
  | "adjust_dynamics"
  | "adjust_voicing"
  | "adjust_directive";
export type ProviderFusionDecision = {
  provider: string;
  status: "selected" | "accepted" | "flagged" | "rejected";
  confidence: number;
  compatibility: number;
  issues: SongModelValidationIssue[];
};

export type SongModelCore = {
  audio: {
    name: string;
    contentType: string;
    size: number;
    durationSeconds: number;
    sampleRate: number;
    channels: number;
  };
  tempoMap: Array<{ time: number; bpm: number; confidence: number; coordinates?: CanonicalTimeCoordinate }>;
  meterMap: Array<{ bar: number; meter: string; confidence: number; coordinates?: CanonicalTimeCoordinate }>;
  keyMap: Array<{ time: number; key: string; confidence: number; coordinates?: CanonicalTimeCoordinate }>;
  melody: Array<{
    start: number;
    end: number;
    pitch: number;
    velocity: number;
    confidence: number;
    source: string;
    coordinates?: CanonicalTimeRange;
  }>;
  /** Observed bass notes from harmony providers; absent/empty means no bass evidence. */
  bass?: Array<{
    start: number;
    end: number;
    pitch: number;
    confidence: number;
    provider?: string;
    sourceStem?: string;
    sourceStemProvider?: string;
    providers?: string[];
    coordinates?: CanonicalTimeRange;
  }>;
  chords: ChordHarmonyEvent[];
  sections: AnalysisSection[];
  energy: number[];
};

export type ArtifactProvenance = {
  model: string;
  version: string;
  parameters: Record<string, number | string | boolean>;
  parentIds: string[];
  createdBy: string;
};
/**
 * The original chord fields remain required so Song Models written before the
 * canonical harmony contract can continue to be read unchanged. The remaining
 * fields enrich an event when a harmony provider can supply them.
 */
export type ChordTiming = {
  startBeat?: number;
  durationBeats?: number;
  startSeconds?: number;
  endSeconds?: number;
};

export type MelodyConflictEvidence = {
  noteId?: string;
  pitch?: number;
  start?: number;
  end?: number;
  conflict: "clash" | "avoid_note" | "unresolved_tension" | "unknown";
  severity?: number;
  explanation?: string;
};

export type ChordCandidateProvenance = {
  candidateId: string;
  provider: string;
  modelVersion?: string;
  score?: number;
  selected?: boolean;
  evidence?: string[];
};

export type ChordBassSupportEvidence = {
  start: number;
  end: number;
  pitch: number;
  confidence: number;
  provider: string;
};

export type ChordHarmonyEvent = {
  /** Legacy timing and display fields. */
  start: number;
  end: number;
  symbol: string;
  roman: string;
  confidence: number;
  /** Canonical harmony fields; optional for legacy persisted Song Models. */
  root?: string;
  quality?: string;
  extensions?: string[];
  alterations?: string[];
  inversion?: number;
  bass?: string;
  function?: string;
  timing?: ChordTiming;
  melodyConflictEvidence?: MelodyConflictEvidence[];
  candidateProvenance?: ChordCandidateProvenance[];
  bassSupportEvidence?: ChordBassSupportEvidence[];
  coordinates?: CanonicalTimeRange;
};
/** One value independent analyses named for a contested field. */
export type SongModelFieldCandidate = {
  value: string;
  confidence: number;
  providers: string[];
  /** Musical relation to the leading candidate (PR-89): half_double_tempo, relative, parallel, ... */
  relationToLeader?: string;
};
export type SongModelFieldStatus = {
  /**
   * `contested`: independent analyses named different values with comparable
   * weight. The field's own map stays empty rather than carrying an arbitrary
   * pick; `candidates` holds what was named so a producer can confirm one.
   */
  status: "detected" | "low_confidence" | "contested" | "failed" | "not_available";
  confidence: number | null;
  providers: string[];
  message: string | null;
  edited: boolean;
  /** Present when `status` is `contested`: strongest first. */
  candidates?: SongModelFieldCandidate[];
  /** PR-89: relation between the two leading candidates when contested. */
  relation?: string | null;
  /** PR-89: what evidence would settle an open question. */
  whatWouldSettleIt?: string | null;
  /**
   * PR-89: true when the field's map carries a *provisional* value that exists
   * only because the canonical timeline needs a grid (a contested tempo or
   * metre). It is not a measurement; the candidates are the record.
   */
  provisional?: boolean;
};
export type ArrangementGenerationProvenance = {
  jobId: string;
  candidateId: string;
  provider: string;
  modelVersion: string;
  reportedModelVersion: string | null;
  checkpointSha256: string | null;
  providerRequestId: string | null;
  songModelVersion: number | null;
  seed: number;
  parameters: GenerationParameters;
  parentArtifactIds: string[];
  evaluation: CandidateEvaluation;
};

export type CandidateEvaluationStatus =
  | "plan_received"
  | "rendering"
  | "render_succeeded"
  | "analyzing"
  | "evaluated"
  | "render_failed"
  | "analysis_failed"
  | "diversity_rejected"
  | "repair_not_improved"
  | "repair_scope_violated";
export type CandidatePlan = {
  sections: ArrangementSection[];
  tracks?: Array<{
    id: string;
    name: string;
    role: string;
    kind: string;
  }>;
};

export const musicGenerationCandidatesTable = pgTable(
  "music_generation_candidates",
  {
    id: text("id").primaryKey(),
    jobId: text("job_id")
      .notNull()
      .references(() => musicGenerationJobsTable.id, { onDelete: "cascade" }),
    projectId: text("project_id")
      .notNull()
      .references(() => musicProjectsTable.id, { onDelete: "cascade" }),
    arrangementId: text("arrangement_id")
      .notNull()
      .references(() => arrangementsTable.id, { onDelete: "cascade" }),
    artifactId: text("artifact_id"),
    providerRequestId: text("provider_request_id"),
    reportedModelVersion: text("reported_model_version"),
    checkpointSha256: text("checkpoint_sha256"),
    provider: text("provider").notNull(),
    modelVersion: text("model_version").notNull(),
    seed: integer("seed").notNull(),
    rank: integer("rank"),
    label: text("label").notNull(),
    score: doublePrecision("score").notNull(),
    confidence: doublePrecision("confidence").notNull(),
    summary: text("summary").notNull(),
    status: text("status").notNull().default("validated"),
    parameters: jsonb("parameters")
      .$type<GenerationParameters>()
      .notNull()
      .default({}),
    parentArtifactIds: jsonb("parent_artifact_ids")
      .$type<string[]>()
      .notNull()
      .default([]),
    plan: jsonb("plan").$type<CandidatePlan>().notNull(),
    trackModels: jsonb("track_models").$type<TrackModel[] | null>(),
    evaluatedPlan: jsonb("evaluated_plan").$type<ArrangementPlan | null>(),
    evaluatedStyleSpec: jsonb("evaluated_style_spec").$type<StyleSpec | null>(),
    evaluation: jsonb("evaluation")
      .$type<CandidateEvaluation>()
      .notNull()
      .default({
        status: "plan_received",
        providerScore: 0,
        renderArtifactIds: [],
        artifacts: [],
        qualityReport: null,
        musicCritic: null,
        audioCritic: null,
        error: null,
      }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
);

export type HarmonyCandidateRationale = {
  symbol: string;
  function: string;
  score: number;
  melodyFit: number;
  bassFit: number;
  voiceLeading: number;
  selected: boolean;
};

export type HarmonyDecisionEvidence = {
  start: number;
  end: number;
  symbol: string;
  function?: string;
  source: "song_model_chord_evidence" | "deterministic_candidate_scoring";
  score?: number;
  melodyFit?: number;
  bassFit?: number;
  voiceLeading?: number;
  harmonicBars?: number;
  complexity?: number;
  candidateRationale?: HarmonyCandidateRationale[];
  bassSupportEvidence?: ChordBassSupportEvidence[];
};

export type GenerationParameters = Record<string, unknown> & {
  harmonyDecisions?: HarmonyDecisionEvidence[];
  styleGrammarVersion?: StyleGrammar["version"];
  styleGrammarEvidenceSha256?: string;
  generationPreference?: GenerationPreferenceSnapshot | null;
};

export type StyleGrammar = {
  version: "1.0";
  evidenceSha256: string;
  vocabulary: {
    groove: "straight" | "swung" | "syncopated" | "four_on_floor";
    voicing: "close" | "open" | "drop_two" | "quartal" | "wide";
    articulation: "legato" | "tight" | "accented" | "pulsed";
    instrumentation: "acoustic" | "electronic" | "hybrid" | "orchestral";
    phraseBehavior: "call_response" | "continuous" | "sparse_answers" | "motivic";
    fills: "none" | "cadential" | "frequent" | "sectional";
    transitions: "hard_cut" | "thin_build" | "riser" | "orchestral_swell";
    development: "repetition" | "additive" | "transformative" | "dynamic_arc";
  };
};
export type StyleSpec = {
  genre: string; subgenre: string; era: string;
  tempoCharacter: "laid_back" | "steady" | "driving" | "rubato";
  rhythm: { swing: number; syncopation: number; subdivision: string };
  harmony: { complexity: number; tension: number; voicing: string };
  instrumentation: { preferredFamilies: string[]; avoid: string[] };
  orchestration: { density: number; registerSpread: number; dynamics: string };
  production: { stereoWidth: number; room: string; mixProfile: string };
  dynamics: { range: number; accentStrength: number };
  /** Absent on historical arrangements. */
  grammar?: StyleGrammar;
};

export type TrackModel = {
  id: string; instrument: string; instrumentDefinition: InstrumentDefinition; role: string;
  notes: MusicalNote[]; cc: ControlEvent[]; articulations: ArticulationEvent[];
  automation: AutomationPoint[]; source: string; version: number; provenance: ArtifactProvenance;
  /** Optional section-level intent and renderer mapping for canonical plans. */
  directive?: TrackDirective;
  appliedDirectives?: AppliedTrackDirective[];
  mapping?: TrackMappingMetadata;
  /** Deterministic performance decisions and canonical timeline binding. */
  performanceEvidence?: TrackPerformanceEvidence;
  harmonyEvidence?: {
    version: "2.0";
    mode: "advanced_voicing" | "phrase_countermelody";
    selectedMotion?: number;
    baselineMotion?: number;
    maximumLeap?: number;
    motifRefs?: string[];
    resolutionObligations?: number;
    melodyEvidencePreserved: boolean;
    bassEvidencePreserved: boolean;
  };
};

export type TrackPerformanceEvidence = {
  version: "1.0";
  /** Historical field containing the performance/humanization seed. */
  seed: number;
  /** Canonical Composition Intelligence seed, when a versioned plan exists. */
  compositionSeed?: number;
  /** Explicit alias for the derived performance/humanization seed. */
  performanceSeed?: number;
  instrumentFamily: InstrumentDefinition["family"];
  articulationProfile: string;
  timingProfile: string;
  dynamicsProfile: string;
  canonicalTimelineSha256: string;
  phraseIds: string[];
  sectionRanges: Array<{
    section: string;
    startBar: number;
    endBar: number;
    start: number;
    end: number;
  }>;
  playability: {
    valid: boolean;
    checkedNotes: number;
    violations: string[];
  };
  performedMaterialSha256: string;
};
export type AppliedTrackDirective = {
  section: string;
  startBar: number;
  endBar: number;
  start: number;
  end: number;
  directive: TrackDirective;
};

export type ControlEvent = {
  controller: number; time: number; value: number; channel?: number;
};

export type InstrumentDefinition = {
  id: string;
  family: "keys" | "strings" | "brass" | "drums" | "guitar" | "voice" | "synth";
  playableRange: { min: number; max: number };
  comfortableRange: { min: number; max: number };
  registers: Array<{ name: string; min: number; max: number; character: string }>;
  polyphonic: boolean;
  maxVoices: number;
  articulations: string[];
  constraints: {
    maxLeap: number; minNoteDuration: number; maxSimultaneousNotes: number;
    breathSeconds?: number; strings?: number; frets?: number; hands?: number; feet?: number;
  };
  controls: { dynamics: number[]; expression: number[]; sustain?: number; pitchBend: boolean; aftertouch: boolean };
  /** Maps provider-neutral directives onto instrument-specific renderer data. */
  directiveMappings?: InstrumentDirectiveMappings;
};

export type AutomationPoint = { parameter: string; time: number; value: number };

export type ArrangementPlanSection = {
  section: string; startBar: number; endBar: number; energy: number; density: number;
  tracks: Record<string, string>; operations: string[];
  /** Explicit membership; `tracks` remains the compatibility role map. */
  activeTracks?: string[];
  /** Provider-neutral orchestration intent indexed by track id. */
  trackDirectives?: Record<string, TrackDirective>;
};

export type CompositionIntelligenceVersion = "1.0" | "2.0";
export type CompositionPhraseIntent =
  | "state"
  | "develop"
  | "answer"
  | "build"
  | "release"
  | "protect_vocal";

export type PhraseIntention =
  | "support"
  | "silence"
  | "response"
  | "transition"
  | "foreground";
export type OrchestrationRole =
  | "foundation"
  | "pulse"
  | "groove"
  | "harmonic_support"
  | "texture"
  | "countermelody"
  | "hook"
  | "response"
  | "lift"
  | "transition"
  | "accent"
  | "doubling"
  | "pad";
export type InstrumentFunction =
  | "foundation"
  | "pulse"
  | "harmony"
  | "lead"
  | "counterline"
  | "texture";

export type GrooveResponsibility =
  | "foundation"
  | "pulse"
  | "syncopation"
  | "accent"
  | "fill";
export type GrooveGesture =
  | "state"
  | "pickup"
  | "push"
  | "anticipation"
  | "break"
  | "fill";

/** Shared, deterministic rhythm-section decisions on the canonical timeline. */
export type SharedGroovePlan = {
  version: "1.0";
  seed: number;
  evidenceSha256: string;
  subdivision: "8th" | "16th";
  roles: Array<{
    trackId: string;
    responsibility: GrooveResponsibility;
  }>;
  motifs: Array<{
    id: string;
    sourceMotifId: string | null;
    phraseId: string;
    variation: "state" | "develop" | "answer";
  }>;
  events: Array<{
    id: string;
    motifId: string;
    sectionId: string;
    phraseId: string;
    trackId: string;
    responsibility: GrooveResponsibility;
    gesture: GrooveGesture;
    sharedAccentId: string | null;
    coordinate: CanonicalTimeCoordinate;
    durationTicks: number;
    velocity: number;
  }>;
};

/** Immutable reasoning identity and decisions used to materialize performance events. */
export type CompositionIntelligencePlan = {
  version: CompositionIntelligenceVersion;
  mode: "legacy" | "reasoning_core";
  precedence: ["song_intent", "dramatic_arc", "section_function", "phrase_intent", "instrument_role", "motif", "harmony_rhythm_voicing", "event"];
  seed: number;
  evidenceSha256: string;
  songIntent: "preserve_observed_form" | "develop_observed_form";
  motifs: Array<{
    id: string;
    fingerprint: string;
    sourceSectionId: string;
    sourcePhraseId: string;
    parentMotifId: string | null;
    transformation: MotifTransformation;
    ownerTrackId: string | null;
    evidenceSha256: string;
  }>;
  tensionRelease: Array<{
    sectionId: string;
    tension: number;
    release: number;
  }>;
  phrases: Array<{
    id: string;
    sectionId: string;
    startBar: number;
    endBar: number;
    startSeconds?: number;
    endSeconds?: number;
    intent: CompositionPhraseIntent;
    tension: number;
    motifRef: string;
    sourceMotifRef: string | null;
    intention: PhraseIntention;
    transformation: MotifTransformation;
    responseToPhraseId: string | null;
    ownerTrackId: string | null;
  }>;
  instrumentRoles: Array<{
    trackId: string;
    function: InstrumentFunction;
    authority: "project_track";
  }>;
  /** Present on v2 plans; absent historical plans keep their original behavior. */
  groove?: SharedGroovePlan;
  orchestrationAssignments?: Array<{
    sectionId: string;
    phraseId: string;
    trackId: string;
    role: OrchestrationRole;
    register: "low" | "middle" | "high";
    handoffFromTrackId: string | null;
    doublingTrackId: string | null;
  }>;
};

export type ArrangementHierarchyScope = {
  level: "song" | "section" | "phrase" | "bar" | "event";
  id: string;
};

export type ArrangementHierarchy = {
  version: "1.0";
  status: "applied" | "no_op";
  reason: string | null;
  precedence: ["song", "section", "phrase", "bar", "event"];
  song: {
    id: string;
    intent: "development_arc" | "preserve_observed_form";
    climaxSectionId: string | null;
  };
  sections: Array<{
    id: string;
    sourceSection: string;
    startBar: number;
    endBar: number;
    function: "intro" | "verse" | "prechorus" | "chorus" | "bridge" | "outro" | "neutral";
    development: "initial" | "development" | "reprise" | "neutral";
    targetEnergy: number;
    targetDensity: number;
    phraseIds: string[];
    barIds: string[];
  }>;
  phrases: Array<{
    id: string;
    sectionId: string;
    startBar: number;
    endBar: number;
    confidence: number;
    intent: "protect_vocal_phrase";
  }>;
  bars: Array<{
    id: string;
    sectionId: string;
    bar: number;
    meter: string;
    phraseIds: string[];
    vocalSpace: "occupied" | "available" | "unknown";
  }>;
  events: Array<{
    id: string;
    sectionId: string;
    barId: string;
    trackId: string;
    intent: "support_vocal" | "use_vocal_space" | "follow_section";
    source: "section" | "vocal_phrase" | "vocal_space";
  }>;
};

export type OrchestrationCue = {
  bar?: number;
  beat?: number;
  mode?: string;
  durationBeats?: number;
};

export type TrackDirective = {
  role?: string;
  musicalFunction?: OrchestrationRole;
  register?: string;
  rhythmicActivity?: number;
  harmonicActivity?: number;
  dynamicTarget?: number;
  articulationFamily?: string;
  entry?: OrchestrationCue;
  exit?: OrchestrationCue;
  transition?: string;
  fill?: boolean;
  handoffFromTrackId?: string;
  doublingTrackId?: string;
};

export type TrackMappingMetadata = {
  midiChannel?: number;
  program?: number;
  articulationMap?: Record<string, string | number>;
  controlMap?: Record<string, number>;
};

export type InstrumentDirectiveMappings = {
  registers?: Record<string, { min: number; max: number }>;
  articulationFamilies?: Record<string, string[]>;
  dynamicTargets?: Record<string, number>;
  controls?: Record<string, number>;
};

/**
 * Whole-song arrangement direction (PR-04), derived before any section or note
 * is written. Every candidate section is planned against this one plan.
 */
export type GlobalArrangementPlan = {
  version: "1.0";
  derivedAt: string;
  inputsDigestSha256: string;
  method: string;
  confidence: number;
  style: string;
  substyle: string | null;
  instrumentPalette: Array<{ role: string; priority: number; rationale: string }>;
  sectionTargets: Array<{
    sectionName: string;
    startBar: number;
    endBar: number;
    energy: number;
    density: number;
    tension: number;
    role:
      | "intro" | "verse" | "prechorus" | "chorus" | "bridge"
      | "breakdown" | "outro" | "instrumental" | "neutral";
    noveltyVsPrevious: number;
  }>;
  climax: { sectionName: string; atBar: number; energy: number } | null;
  secondaryClimax: { sectionName: string; atBar: number; energy: number } | null;
  grooveStrategy:
    | "steady_pulse" | "syncopated" | "swing" | "half_time_feel"
    | "four_on_floor" | "rubato";
  orchestrationStrategy:
    | "layered_build" | "call_and_response" | "wave_dynamics"
    | "static_bed" | "sparse_to_full";
  motifStrategy: "recurring_hook" | "developing_motif" | "through_composed";
  contrastStrategy:
    | "dynamic_contrast" | "textural_contrast" | "harmonic_contrast"
    | "register_contrast" | "minimal_contrast";
  harmonicComplexity: number;
  rhythmicComplexity: number;
  productionAesthetic:
    | "intimate" | "polished_pop" | "cinematic" | "raw_band"
    | "electronic" | "orchestral";
};

/** Standard arrangement roles an instrument can hold in a section. */
export type InstrumentArrangementRole =
  | "LEAD"
  | "FOUNDATION"
  | "BASS"
  | "GROOVE"
  | "RHYTHMIC_HARMONY"
  | "HARMONIC_BED"
  | "OSTINATO"
  | "COUNTER_MELODY"
  | "CALL_RESPONSE"
  | "ACCENT"
  | "PAD"
  | "FILL"
  | "TRANSITION"
  | "CLIMAX_LAYER";

export type RegisterBand = "low" | "low_mid" | "mid" | "upper_mid" | "high";

export type InstrumentRoleAssignment = {
  sectionName: string;
  /** Palette role, e.g. "drums", "bass", "strings". */
  instrument: string;
  role: InstrumentArrangementRole;
  register: RegisterBand;
  density: number;
  rhythmicActivity: number;
  melodicActivity: number;
  voicingStrategy: "open" | "close" | "unison" | "spread" | "drone" | "percussive";
  articulationFamily: "legato" | "staccato" | "sustain" | "pluck" | "percussive" | "mixed";
  dynamicShape: string;
  interactionWithLead: "avoid" | "support" | "answer" | "double" | "independent";
  entryBar: number;
  exitBar: number;
};

export type SectionPlan = {
  sectionName: string;
  startBar: number;
  endBar: number;
  function:
    | "intro" | "verse" | "prechorus" | "chorus" | "bridge"
    | "breakdown" | "outro" | "instrumental" | "neutral";
  energy: number;
  density: number;
  tension: number;
  groove: string;
  activeInstrumentFamilies: string[];
  inactiveInstrumentFamilies: string[];
  leadRole: string;
  supportingRoles: string[];
  registerDistribution: Partial<Record<RegisterBand, number>>;
  rhythmicActivity: number;
  melodicActivity: number;
  harmonicActivity: number;
  transitionIn: string;
  transitionOut: string;
  noveltyRelativeToPreviousSection: number;
};

export type PhrasePlan = {
  id: string;
  sectionName: string;
  startBar: number;
  endBar: number;
  role: "opening" | "development" | "response" | "cadence" | "pickup" | "fill";
  energyTarget: number;
  entersFamilies: string[];
  leavesFamilies: string[];
};

/**
 * Section / phrase / instrument-role plan (PR-05), derived from the
 * GlobalArrangementPlan + musical map before any note is written.
 */
export type SectionPhrasePlan = {
  version: "1.0";
  derivedAt: string;
  inputsDigestSha256: string;
  method: string;
  sections: SectionPlan[];
  phrases: PhrasePlan[];
  roleAssignments: InstrumentRoleAssignment[];
};

/** One instrument's rebalancing under a budget window. */
export type OrchestrationInstrumentAdjustment = {
  instrument: string;
  /** Multiplier on planned density: <1 ducks, >1 opens up. */
  densityMultiplier: number;
  /** Octave/register shift in semitones (e.g. -12, 0, +12). */
  registerShift: number;
  note: string;
};

export type OrchestrationBudgetWindow = {
  id: string;
  startBar: number;
  endBar: number;
  /** How much listener attention the lead is holding here, 0..1. */
  vocalAttention: number;
  budgets: {
    totalDensity: number;
    melodic: number;
    rhythmic: number;
    harmonic: number;
    register: number;
    spectral: number;
    attention: number;
  };
  instrumentAdjustments: OrchestrationInstrumentAdjustment[];
};

export type RegisterOccupancySpan = {
  startBar: number;
  endBar: number;
  occupancy: Partial<Record<RegisterBand, number>>;
  overcrowdedBands: RegisterBand[];
  resolutions: Array<{
    instrument: string;
    action: "drop_octave" | "raise_octave" | "simplify" | "thin_voicing";
    band: RegisterBand;
  }>;
};

/**
 * Orchestration Budget Engine (PR-06): per-moment density/attention budgets and
 * a register-occupancy map with overcrowding resolutions, derived from the
 * section/phrase plan and the vocal arrangement-space map.
 */
export type OrchestrationBudgetPlan = {
  version: "1.0";
  derivedAt: string;
  inputsDigestSha256: string;
  method: string;
  windows: OrchestrationBudgetWindow[];
  registerOccupancy: RegisterOccupancySpan[];
};

export type TransitionDevice =
  | "drum_fill" | "bass_pickup" | "keys_pickup" | "guitar_pickup" | "string_run"
  | "brass_push" | "cymbal_swell" | "cymbal_choke" | "break" | "stop"
  | "anticipation" | "turnaround" | "riser" | "reverse" | "build_up"
  | "breakdown" | "ending_hit" | "ritardando";

export type TransitionDevicePlan = {
  device: TransitionDevice;
  instrument: string;
  startBar: number;
  endBar: number;
  intensity: number;
  rationale: string;
};

export type TransitionPlan = {
  id: string;
  fromSection: string;
  toSection: string;
  /** First bar of the target section. */
  atBar: number;
  /** Bars before `atBar` the transition occupies. */
  approachBars: number;
  kind: "build" | "drop" | "continue" | "break";
  strength: number;
  harmonicApproach: "dominant_prep" | "plagal" | "chromatic" | "static" | "none";
  vocalSafe: boolean;
  devices: TransitionDevicePlan[];
};

/** Part composition task types (PR-09). */
export type PartTask =
  | "DRUMS" | "PERCUSSION" | "BASS" | "PIANO" | "KEYS"
  | "ACOUSTIC_GUITAR" | "ELECTRIC_GUITAR" | "STRINGS" | "BRASS" | "WOODWINDS"
  | "PAD" | "OSTINATO" | "COUNTER_MELODY" | "CALL_RESPONSE" | "FILL"
  | "TRANSITION" | "INTRO" | "ENDING";

/**
 * Compact index of the parts to compose for an arrangement (PR-09). The full
 * self-contained `PartGenerationRequest` (previous + current + next context) is
 * built on demand by the Part Composer; this list fixes the enumeration and the
 * deterministic seeds so candidate generation (PR-10) is reproducible.
 */
export type PartComposerPlan = {
  version: "1.0";
  derivedAt: string;
  inputsDigestSha256: string;
  method: string;
  tasks: Array<{
    id: string;
    task: PartTask;
    sectionName: string;
    instrument: string;
    role: InstrumentArrangementRole;
    startBar: number;
    endBar: number;
    seed: number;
    /** Task ids that must be composed first so this part has its context. */
    dependsOn: string[];
  }>;
};

/** One humanisation decision, with the musical reasons behind it (PR-14). */
export type PerformanceDecision = {
  noteId: string;
  timingOffsetMs: number;
  velocityDelta: number;
  reasons: string[];
};

/**
 * Evidence for how Composition MIDI became Performance MIDI (PR-14). Timing and
 * dynamics are derived from instrument, tempo, groove, style, phrase, metrical
 * position, dynamic shape and musical role — never a single random offset.
 */
export type PerformanceEvidence = {
  version: "1.0";
  engine: string;
  /** "1.0" when no performance style was supplied (V1 behaviour), "2.0" otherwise. */
  engineVersion?: "1.0" | "2.0";
  seed: number;
  family: string;
  profile: string;
  meanTimingOffsetMs: number;
  timingStdMs: number;
  addedEvents: {
    ghostNotes: number;
    flams: number;
    strumSpreadNotes: number;
    breathGaps: number;
    /** PR-23: grace notes / turns added for melodic roles. */
    ornaments?: number;
    /** PR-23: drum fills added at phrase boundaries. */
    fills?: number;
    /** PR-23: articulation events that resolved to a keyswitch. */
    keyswitches?: number;
  };
  ccCurves: string[];
  /** PR-23: which style dimensions shaped this performance, with provenance. */
  styleInputs?: Array<{ dimension: string; value: string | number; provenance: string }>;
  /** Bounded sample of per-note decisions for audit. */
  decisions: PerformanceDecision[];
};

/**
 * Performance style (PR-23): the performance-relevant slice of a StyleProfile,
 * resolved per project. Every field is optional and absent means "the V1
 * default" -- a style never invents a value the profile did not evidence.
 */
export type PerformanceStyle = {
  /** 0.5 straight … ~0.67 triplet swing. */
  swingRatio?: number;
  microtiming?: "quantized" | "on_top" | "behind" | "ahead" | "loose";
  dynamics?: "narrow" | "moderate" | "wide";
  melodicOrnamentation?: "none" | "light" | "moderate" | "heavy";
  bassAttackPosition?: "on_the_beat" | "anticipated" | "laid_back" | "sustained";
  fillFrequency?: "rare" | "moderate" | "frequent";
  articulationLanguage?: string;
  /** Which StyleProfile dimensions produced the values above, for evidence. */
  sources?: Array<{ dimension: string; value: string | number; provenance: string }>;
};

/**
 * Sound selection (PR-24). What a track's sound *should be*, decided for
 * musical reasons before any catalogue is consulted; then which attested
 * instrument realizes it, with every candidate scored and explained.
 */
export type SoundTarget = {
  register: "low" | "mid" | "high" | "wide";
  attack: "soft" | "medium" | "sharp";
  sustain: "short" | "medium" | "long";
  brightness: "dark" | "neutral" | "bright";
  width: "mono" | "narrow" | "natural" | "wide";
  space: "dry" | "small" | "medium" | "large" | "hall";
  saturation: "clean" | "warm" | "driven" | "lo_fi";
  dynamicsResponse: "narrow" | "moderate" | "wide";
  /** Character words the style asked for ("vintage", "cinematic", "granular"). */
  character: string[];
};

/** One attested instrument the renderer offers, as the brain sees it. */
export type SoundCatalogueEntry = {
  assetId: string;
  name?: string;
  manufacturer?: string;
  /** Track families this instrument can serve; absent means universal. */
  families?: string[];
  /** Arrangement roles it is meant for; absent means any. */
  roles?: string[];
  /** Operator-declared character words ("analog", "warm", "granular", "acoustic"). */
  character?: string[];
};

export type SoundSelectionCandidate = {
  assetId: string;
  score: number;
  reasons: string[];
};

export type SoundTargetProvenance = {
  field: keyof SoundTarget;
  source: "default" | "family" | "role" | "notes" | "style";
  detail: string;
};

export type InstrumentSoundProfile = {
  version: "1.0";
  method: string;
  trackId: string;
  instrument: string;
  role: string;
  family: string;
  target: SoundTarget;
  provenance: SoundTargetProvenance[];
  selection: {
    assetId: string | null;
    reason: string;
    /** Every compatible candidate, best first; incompatible ones are listed in `rejected`. */
    candidates: SoundSelectionCandidate[];
    rejected: Array<{ assetId: string; reason: string }>;
  };
  inputsDigestSha256: string;
};

/** Granularity at which a producer can freeze material (PR-17). */
export type LockScope = "global" | "section" | "track" | "phrase" | "event";

/**
 * A producer decision to keep existing material. Anything a lock covers is
 * carried over verbatim on regeneration; everything else may be rewritten.
 */
export type ArrangementLock = {
  id: string;
  scope: LockScope;
  sectionName?: string;
  instrument?: string;
  trackId?: string;
  phraseId?: string;
  startBar?: number;
  endBar?: number;
  noteIds?: string[];
  reason?: string;
  createdAt: string;
};

export type ArrangementLockSet = {
  version: "1.0";
  locks: ArrangementLock[];
};

/** What a partial regeneration is allowed to touch (PR-17). */
export type RegenerationScope = {
  instrument: string;
  sectionName: string;
  startBar: number;
  endBar: number;
  reason: string;
};

export type PartialRegenerationReport = {
  version: "1.0";
  method: string;
  requested: RegenerationScope[];
  blockedByLock: Array<{ scope: RegenerationScope; lockId: string }>;
  regenerated: RegenerationScope[];
  keptNotes: number;
  replacedNotes: number;
  /** True when every locked note survived the merge byte-identical. */
  locksHonoured: boolean;
};

/** One orchestrator candidate as it fared in a scoped regeneration (PR-U5). */
export type ScopedRegenerationCandidate = {
  candidateId: string;
  label: string;
  strategy: CandidateStrategyId;
  seed: number;
  /** The merged arrangement passed the critic's hard rules. */
  feasible: boolean;
  /** Critic score of the merged arrangement (0..100). */
  score: number;
  /** Playability errors in the merged arrangement. */
  constraintErrors: number;
  locksHonoured: boolean;
  violations: number;
  replacedNotes: number;
  /** Replaced notes that are identical (id and content) to what was there: a deterministic composer writing the same part again. */
  identicalReplacedNotes: number;
  selected: boolean;
};

/**
 * A chat edit applied to the arrangement (PR-U5): the PR-17 report plus what
 * the producer needs to check the promise — which tracks / sections / bar
 * ranges changed, what was preserved verbatim, how the locks were verified,
 * and how the candidates were ranked before one was accepted.
 */
export type ScopedRegenerationReport = PartialRegenerationReport & {
  /** The producer turn whose EditPlan was applied. */
  editTurnId: string;
  editIntent: EditPlanIntent;
  editText: string;
  parentArrangementId: string;
  parentArrangementVersion: number;
  songModelVersion: number;
  productionBriefId: string | null;
  productionBriefDigestSha256: string | null;
  /** The lock set actually applied, resolved to this arrangement's tracks. */
  locks: ArrangementLock[];
  /** Families the EditPlan named that no track of this arrangement carries. */
  unmatchedFamilies: string[];
  changed: {
    instruments: string[];
    sections: string[];
    barRanges: Array<{ instrument: string; sectionName: string; startBar: number; endBar: number; replacedNotes: number }>;
  };
  preserved: {
    /** Tracks carried over byte-identical (no allowed scope touched them). */
    instruments: string[];
    /** Sections no allowed scope touched. */
    sections: string[];
    notes: number;
  };
  verification: { honoured: boolean; violations: string[]; checkedLockedNotes: number };
  /** Of the accepted candidate's replaced notes, how many reproduce the previous material exactly. */
  identicalReplacedNotes: number;
  candidates: ScopedRegenerationCandidate[];
  selectedCandidateId: string;
  /** One line per planner hint the brief contributed. */
  plannerHintEvidence: string[];
  warnings: string[];
  durationMs: number;
};

// ---------------------------------------------------------------------------
// Wave U — Universal Producer Intelligence (PR-U1): contracts.
//
// Four strictly separated layers sit in front of the ArrangementPlan:
//   UserIntent      — what the user said, plus what was inferred from it;
//   StyleProfile    — independent dimensions of the musical world asked for;
//   ProductionBrief — how THIS song realises that world: the single source of
//                     truth the planners read;
//   ArrangementPlan — unchanged in shape; may reference the brief it came from.
//
// The platform holds no closed catalogue of styles. Identity dimensions
// (tradition, genre, scene, ...) are open strings; the fine dimensions form a
// universal vocabulary for describing music. A dimension with no evidence is
// absent — never defaulted — and every populated value carries confidence and
// provenance.
// ---------------------------------------------------------------------------

/** Where a piece of producer knowledge came from. */
export type IntelligenceProvenance = "stated" | "inferred" | "default" | "researched";

/**
 * One populated, evidence-bearing value of a style dimension. `sourceRefs`
 * name the evidence: a verbatim user span (`text:"..."`), a vocabulary rule
 * (`vocab:<id>`), a research source (`research:<id>`), or a clarification
 * answer (`answer:<questionId>/<optionId>`).
 */
export type StyleDimension<T = string> = {
  value: T;
  /** 0..1 */
  confidence: number;
  provenance: IntelligenceProvenance;
  sourceRefs?: string[];
};

export type IntentSectionFunction =
  | "intro" | "verse" | "prechorus" | "chorus" | "bridge"
  | "breakdown" | "outro" | "instrumental" | "unknown";

/** A section as the user refers to it ("second chorus", "last chorus"). */
export type IntentSectionRef = {
  function: IntentSectionFunction;
  /** 1-based ordinal, or "last" / "all" when the user did not number it. */
  ordinal: number | "last" | "all";
  /** Resolved against the Song Model's sections when one was available. */
  sectionName?: string;
};

/** Scope of an inference or constraint, as spoken (sections not yet resolved). */
export type IntentScope =
  | { kind: "global" }
  | { kind: "section"; section: IntentSectionRef }
  | { kind: "phrase"; phraseId: string }
  | { kind: "track"; instrument: string };

export type IntentSlotName =
  | "mood" | "energy" | "density" | "era" | "tradition" | "genre_word" | "scene"
  | "instrument" | "ensemble_size" | "tempo_feel" | "tempo_bpm"
  | "production_feel" | "vocal_treatment";

/** Something read out of the user's words. Never present without evidence. */
export type IntentInference = {
  id: string;
  slot: IntentSlotName;
  value: string;
  confidence: number;
  provenance: IntelligenceProvenance;
  /** Verbatim spans of the user's text this rests on. */
  evidence: string[];
  scope: IntentScope;
};

/**
 * A boundary the user drew ("not too poppy", "no drums", "keep the piano").
 * Never a style: a negated style word is recorded here and nowhere else.
 */
export type IntentConstraint = {
  id: string;
  kind: "avoid" | "limit" | "require" | "keep";
  /** Normalised subject ("poppy", "busy", "drums"). */
  subject: string;
  /** The user's words, verbatim. */
  statement: string;
  scope: IntentScope;
  confidence: number;
  provenance: IntelligenceProvenance;
};

export type IntentReference = {
  id: string;
  kind: "song" | "artist" | "recording" | "playlist" | "description";
  label: string;
  /** What the user wants from it, when said ("the drums from ..."). */
  aspect?: string;
  /** Verbatim span, when it came from the text. */
  evidence?: string;
};

export type IntentSectionRequest = {
  id: string;
  section: IntentSectionRef;
  /** The clause the user said about this section, verbatim. */
  text: string;
  inferenceIds: string[];
  constraintIds: string[];
};

/** Layer 1: what the user actually said, and what was read out of it. */
export type UserIntent = {
  version: "1.0";
  derivedAt: string;
  inputsDigestSha256: string;
  method: string;
  /** Untouched user text. */
  rawText: string;
  language: "he" | "en" | "mixed" | "unknown";
  inferences: IntentInference[];
  constraints: IntentConstraint[];
  references: IntentReference[];
  sectionRequests: IntentSectionRequest[];
  /** "more X" / "less X" targets the extractor could not classify. Surfaced, not guessed. */
  unresolvedTerms: string[];
  /** Mean confidence over inferences + constraints; 0 when nothing was extracted. */
  confidence: number;
};

/**
 * Layer 2: the independent dimensions of a musical world. Every field is
 * optional; only dimensions with evidence are populated. Identity dimensions
 * are open strings so any tradition, scene or school can be named; the fine
 * dimensions use a fixed universal vocabulary the planners can read.
 */
export type StyleProfileDimensions = {
  tradition?: StyleDimension<string>;
  genre?: StyleDimension<string>;
  subgenre?: StyleDimension<string>;
  scene?: StyleDimension<string>;
  era?: StyleDimension<string>;
  productionSchool?: StyleDimension<string>;
  ensembleType?: StyleDimension<string>;
  grooveFamily?: StyleDimension<string>;
  harmonicLanguage?: StyleDimension<string>;
  melodicLanguage?: StyleDimension<string>;
  articulationLanguage?: StyleDimension<string>;
  soundAesthetic?: StyleDimension<string>;

  tempoBehavior?: StyleDimension<"slow" | "moderate" | "fast" | "rubato_tolerant" | "strict_grid" | "breathing">;
  /** 0.5 (straight) .. ~0.75 (hard swing). */
  swingRatio?: StyleDimension<number>;
  microtiming?: StyleDimension<"quantized" | "on_top" | "behind" | "ahead" | "loose">;
  subdivisionVocabulary?: StyleDimension<string[]>;
  kickSnareLanguage?: StyleDimension<string>;
  bassAttackPosition?: StyleDimension<"on_the_beat" | "anticipated" | "laid_back" | "sustained">;
  chordRhythm?: StyleDimension<"sustained" | "pulsing" | "syncopated" | "arpeggiated" | "stabs">;
  chordExtensions?: StyleDimension<"triads" | "sevenths" | "extended" | "quartal" | "modal">;
  harmonicRhythm?: StyleDimension<"slow" | "moderate" | "fast">;
  passingChordDensity?: StyleDimension<"none" | "sparse" | "frequent">;
  melodicOrnamentation?: StyleDimension<"none" | "light" | "moderate" | "heavy">;
  phraseLength?: StyleDimension<"short" | "regular" | "long" | "irregular">;
  pickupBehavior?: StyleDimension<"none" | "occasional" | "characteristic">;
  cadenceLanguage?: StyleDimension<string>;
  callAndResponse?: StyleDimension<"none" | "occasional" | "structural">;
  registerTendencies?: StyleDimension<"low" | "mid" | "high" | "wide">;
  voicingWidth?: StyleDimension<"close" | "open" | "wide">;
  doublingRules?: StyleDimension<"none" | "octaves" | "unison_sections" | "orchestral">;
  articulations?: StyleDimension<string[]>;
  fillFrequency?: StyleDimension<"rare" | "moderate" | "frequent">;
  transitionLanguage?: StyleDimension<string>;
  /** Families in order of importance for this world. */
  instrumentationHierarchy?: StyleDimension<string[]>;
  dynamics?: StyleDimension<"narrow" | "moderate" | "wide">;
  roomSize?: StyleDimension<"dry" | "small" | "medium" | "large" | "hall">;
  saturation?: StyleDimension<"clean" | "warm" | "driven" | "lo_fi">;
  stereoAesthetic?: StyleDimension<"mono" | "narrow" | "natural" | "wide">;
};

export type StyleDimensionName = keyof StyleProfileDimensions;
export type StyleDimensionValue = string | number | string[];

/** A value the user ruled out. It never populates a dimension. */
export type StyleExclusion = {
  /** The dimension the value would have populated, when known. */
  dimension?: StyleDimensionName;
  value: string;
  sourceRefs: string[];
};

/** A research finding that did not become a dimension value (PR-U3). */
export type StyleResearchCandidate = {
  dimension: StyleDimensionName;
  value: StyleDimensionValue;
  /** 0..1 */
  confidence: number;
  sourceRefs: string[];
  /** One line: why the world usually does this. */
  rationale: string;
};

/**
 * What per-project style research contributed to a profile (PR-U3). Stored
 * with the profile so the questions it raises can be re-derived from the
 * record alone — no research is re-run to read a brief. Absent when no
 * world was named, so nothing was researched.
 */
export type StyleResearchSummary = {
  method: string;
  /** The identity terms that named the world (`tradition=hasidic`, `genre=ballad`). */
  world: string[];
  /** Research providers consulted, in order (also listed in `sources`). */
  providers: string[];
  /** Findings gated into clarification questions (0.4 ≤ confidence < 0.7). They never populate a dimension. */
  candidates: StyleResearchCandidate[];
  /** Findings that never surface (too weak, out of vocabulary, or contradicting what the user said), with the reason. */
  discarded: Array<StyleResearchCandidate & { reason: string }>;
};

export type StyleProfile = {
  version: "1.0";
  derivedAt: string;
  inputsDigestSha256: string;
  method: string;
  /** Only dimensions with evidence are present. */
  dimensions: StyleProfileDimensions;
  exclusions: StyleExclusion[];
  /** Dimensions where sources disagreed; the winner is in `dimensions`. */
  conflicts: Array<{ dimension: StyleDimensionName; values: string[] }>;
  /** Knowledge sources consulted, in order. */
  sources: string[];
  /** Mean confidence over populated dimensions; 0 when none. */
  confidence: number;
  /** Per-project research, when a world was named (PR-U3). */
  research?: StyleResearchSummary;
};

/** Scope of a durable producer decision, resolved to this song's sections. */
export type ProducerDecisionScope =
  | { kind: "global" }
  | { kind: "section"; sectionName: string }
  | { kind: "phrase"; phraseId: string }
  | { kind: "track"; instrument: string; sectionName?: string };

export type ProducerDecisionTopic =
  | "energy" | "density" | "instrumentation" | "climax" | "ornamentation"
  | "vocal_space" | "groove" | "harmony" | "aesthetic" | "structure"
  | "style_dimension" | "reference" | "other";

/**
 * A durable arrangement decision inside a ProductionBrief. Later chat turns
 * add decisions or supersede earlier ones on the same scope + topic. Distinct
 * from the learning ledger's `producerDecisionsTable` / OpenAPI
 * `ProducerDecision`, which record feedback about generated candidates.
 */
export type ProducerBriefDecision = {
  id: string;
  scope: ProducerDecisionScope;
  topic: ProducerDecisionTopic;
  /** Human-readable, in the user's terms. */
  statement: string;
  /** Machine-readable, when the decision sets a style dimension. */
  dimension?: StyleDimensionName;
  value?: StyleDimensionValue;
  /** "hard" = the planners must not violate it; "soft" = a preference. */
  strength: "hard" | "soft";
  provenance: IntelligenceProvenance;
  confidence: number;
  sourceRefs: string[];
  /** Ids of earlier decisions this one replaces. */
  supersedes: string[];
  createdBy: "intake" | "clarification" | "chat" | "producer" | "system";
  createdAt: string;
};

/** How the brief treats one style dimension for this song. */
export type BriefDimensionDecision = {
  dimension: StyleDimensionName;
  disposition: "adopt" | "modify" | "reject";
  /** The style profile's value (or the answer's, when the profile had none). */
  styleValue: StyleDimensionValue;
  /** For "modify": the value the brief actually uses. */
  briefValue?: StyleDimensionValue;
  rationale: string;
  decidedBy: "style_profile" | "constraint" | "answer" | "producer";
  provenance: IntelligenceProvenance;
  confidence: number;
};

export type ArrangementSectionFunction =
  | "intro" | "verse" | "prechorus" | "chorus" | "bridge"
  | "breakdown" | "outro" | "instrumental" | "neutral";

export type BriefSectionIntention = {
  sectionName: string;
  function: ArrangementSectionFunction;
  /** -1..1 relative to the analysed section energy; absent when the planners decide. */
  energyBias?: StyleDimension<number>;
  densityBias?: StyleDimension<number>;
  instrumentation?: { add: string[]; remove: string[]; feature: string[] };
  climax?: StyleDimension<"none" | "secondary" | "primary">;
  /** Descriptors ("cinematic", "intimate") in the universal vocabulary. */
  character: StyleDimension<string>[];
  decisionIds: string[];
};

export type VocalSpacePolicy = {
  /** How much the arrangement thins under the lead. */
  underLead: "open" | "moderate" | "tight";
  /** Activity in the gaps between vocal phrases. */
  gapFill: "none" | "sparse" | "active";
  counterMelodyAllowed: boolean;
  provenance: IntelligenceProvenance;
  confidence: number;
  rationale: string;
};

export type BriefInstrumentationEntry = {
  family: string;
  tier: "foundation" | "core" | "colour" | "feature";
  rationale: string;
  provenance: IntelligenceProvenance;
  confidence: number;
};

/** A concrete change to a ProductionBrief (from an answer, a concept or an edit). */
export type BriefDelta =
  | {
      kind: "set_dimension";
      dimension: StyleDimensionName;
      value: StyleDimensionValue;
      confidence: number;
      rationale: string;
    }
  | { kind: "exclude_value"; dimension?: StyleDimensionName; value: string; rationale: string }
  | {
      kind: "section_intention";
      section: IntentSectionRef;
      energyBias?: number;
      densityBias?: number;
      climax?: "none" | "secondary" | "primary";
      character?: string[];
      add?: string[];
      remove?: string[];
      rationale: string;
    }
  | { kind: "instrumentation"; add?: string[]; remove?: string[]; feature?: string[]; rationale: string }
  | {
      kind: "vocal_space";
      underLead?: VocalSpacePolicy["underLead"];
      gapFill?: VocalSpacePolicy["gapFill"];
      counterMelodyAllowed?: boolean;
      rationale: string;
    }
  | {
      kind: "decision";
      scope: ProducerDecisionScope;
      topic: ProducerDecisionTopic;
      statement: string;
      strength: "hard" | "soft";
      dimension?: StyleDimensionName;
      value?: StyleDimensionValue;
      rationale: string;
    };

/**
 * Layer 3: how we choose to realise the style in THIS song. Deterministic,
 * digest-tracked (`derivedAt` excluded), and the only thing the planners read.
 */
export type ProductionBrief = {
  version: "1.0";
  id: string;
  derivedAt: string;
  inputsDigestSha256: string;
  method: string;
  intentDigestSha256: string;
  styleProfileDigestSha256: string;
  /** Section names the brief was compiled against (empty without a Song Model). */
  sectionNames: string[];
  dimensionDecisions: BriefDimensionDecision[];
  sectionIntentions: BriefSectionIntention[];
  /** Section requests that matched no section of this song. */
  unresolvedSectionRequests: IntentSectionRequest[];
  vocalSpace: VocalSpacePolicy;
  instrumentation: { hierarchy: BriefInstrumentationEntry[]; excludedFamilies: string[] };
  productionAesthetic: {
    descriptors: StyleDimension<string>[];
    /** Nearest value the current planner consumes; absent unless stated with confidence. */
    plannerAesthetic?: GlobalArrangementPlan["productionAesthetic"];
  };
  producerDecisions: ProducerBriefDecision[];
  openQuestionIds: string[];
  answeredQuestionIds: string[];
  confidence: number;
};

export type ClarificationOption = {
  id: string;
  label: string;
  labelHe?: string;
  description: string;
  /** What choosing this answer does to the brief. */
  briefDeltas: BriefDelta[];
};

/** A question worth asking: the answer materially changes the arrangement. */
export type ClarificationQuestion = {
  id: string;
  question: string;
  questionHe?: string;
  /** 0..1: how much of the arrangement would change depending on the answer. */
  informationGain: number;
  settlesDimensions: StyleDimensionName[];
  trigger: { reason: string; sourceRefs: string[] };
  options: ClarificationOption[];
  allowFreeText: boolean;
};

export type ClarificationAnswer = { questionId: string; optionId?: string; freeText?: string };

/** One deliberately different direction for the same brief, before any notes. */
export type ArrangementConcept = {
  id: string;
  name: string;
  thesis: string;
  deltas: BriefDelta[];
  /** Brief dimensions this concept changes relative to the base brief. */
  differsIn: StyleDimensionName[];
  /** The existing candidate strategy that best realises this direction. */
  candidateStrategy: CandidateStrategyId;
  contrastsWith: Array<{ conceptId: string; dimensions: StyleDimensionName[] }>;
};

export type ArrangementConceptSet = {
  version: "1.0";
  derivedAt: string;
  inputsDigestSha256: string;
  method: string;
  briefId: string;
  briefDigestSha256: string;
  concepts: ArrangementConcept[];
};

export type EditPlanIntent =
  | "reduce_density" | "raise_density" | "lower_energy" | "raise_energy" | "raise_climax"
  | "change_ornamentation" | "add_instrument" | "remove_instrument" | "feature_instrument"
  | "regenerate_part" | "change_groove" | "change_harmony" | "change_aesthetic"
  | "keep" | "unclear";

/** A chat edit request mapped onto the existing PR-17 lock / regeneration scopes. */
export type EditPlan = {
  version: "1.0";
  derivedAt: string;
  inputsDigestSha256: string;
  method: string;
  rawText: string;
  scope: {
    kind: LockScope;
    sectionName?: string;
    instrument?: string;
    phraseId?: string;
    startBar?: number;
    endBar?: number;
  };
  intent: EditPlanIntent;
  /** Locks that must survive verbatim. */
  preserve: ArrangementLock[];
  /** Regeneration scopes to request. */
  modify: RegenerationScope[];
  /** Durable brief changes so a later full regeneration honours the edit too. */
  briefDeltas: BriefDelta[];
  rationale: string;
  evidence: string[];
  confidence: number;
};

/** An answer to "why is X here?" built only from the plan's own data. */
export type PlanExplanation = {
  answered: boolean;
  answer: string;
  evidence: Array<{ source: string; ref: string; detail: string }>;
  confidence: number;
};

/** Dimensions the Audio Critic V1 scores after rendering (PR-15). */
export type AudioCritiqueDimension =
  | "balance" | "masking" | "harshness" | "mud" | "lowEndConflict"
  | "transientQuality" | "stereoDistribution" | "dynamicMovement"
  | "instrumentRealism" | "spectralCrowding";

export type AudioCritiqueScore = {
  dimension: AudioCritiqueDimension;
  score: number;
  weight: number;
  confidence: number;
  findings: string[];
};

export type AudioMixAction = {
  dimension: AudioCritiqueDimension;
  instrument?: string;
  action: string;
  reason: string;
};

/** Second critique, after rendering (PR-15). */
export type AudioCritique = {
  version: "1.0";
  method: string;
  sampleRate: number;
  stemCount: number;
  overallScore: number;
  dimensions: AudioCritiqueScore[];
  recommendedMixActions: AudioMixAction[];
};

/** One §26 render check (PR-13). */
export type RenderCheck = {
  name:
    | "audio_exists" | "non_silent" | "correct_duration" | "correct_sample_rate"
    | "no_clipping" | "correct_instrument" | "correct_note_events"
    | "pitch_sensitivity" | "expression_sensitivity" | "asset_identity"
    | "renderer_identity";
  passed: boolean;
  detail: string;
};

/**
 * Full render attestation for one stem (PR-13). Every check from the plan's
 * §26 list; `feasible` is true only when no check fails.
 */
export type RenderAttestation = {
  version: "1.0";
  renderer: string;
  rendererVersion: string;
  assetId: string;
  trackId: string;
  instrument: string;
  family: string;
  sampleRate: number;
  bitDepth: number;
  channels: number;
  durationSeconds: number;
  noteEventCount: number;
  rmsDbfs: number;
  truePeakDbfs: number;
  sha256: string;
  checks: RenderCheck[];
  feasible: boolean;
};

/** Dimensions the Music Critic V1 scores (PR-11). */
export type CritiqueDimension =
  | "harmony" | "groove" | "voiceLeading" | "leadCompatibility" | "orchestration"
  | "sectionDevelopment" | "motifCoherence" | "contrast" | "transitions"
  | "playability" | "performancePotential";

export type CritiqueFinding = {
  dimension: CritiqueDimension | "hardRule";
  severity: "info" | "warning" | "error";
  sectionName?: string;
  instrument?: string;
  startBar?: number;
  endBar?: number;
  message: string;
};

export type CritiqueDimensionScore = {
  dimension: CritiqueDimension;
  /** 0..100. */
  score: number;
  weight: number;
  /** 0..1 — lower when judged from the plan alone (no notes yet). */
  confidence: number;
  findings: string[];
};

export type CritiqueRecommendedRepair = {
  dimension: CritiqueDimension;
  sectionName?: string;
  instrument?: string;
  startBar?: number;
  endBar?: number;
  action: string;
  reason: string;
};

/**
 * Music Critic V1 (PR-11) — deep musical critique on top of the existing
 * reliability ranking. A `feasible` hard-rule gate, per-dimension scores with
 * findings, and targeted repair recommendations.
 */
export type ArrangementCritique = {
  version: "1.0";
  method: string;
  /** True when track models (notes) were supplied, not just the plan. */
  evaluatedNotes: boolean;
  feasible: boolean;
  hardRuleFindings: CritiqueFinding[];
  overallScore: number;
  dimensions: CritiqueDimensionScore[];
  strengths: string[];
  weaknesses: string[];
  recommendedRepairs: CritiqueRecommendedRepair[];
};

/** A bounded repair request produced from a critique (PR-12). */
export type CriticRepairRequest = {
  id: string;
  dimension: CritiqueDimension;
  sectionName?: string;
  instrument?: string;
  startBar?: number;
  endBar?: number;
  /** Concrete operations a generator/plan-editor should perform, scoped tight. */
  operations: string[];
  reason: string;
};

export type CriticRepairPass = {
  pass: number;
  requests: CriticRepairRequest[];
  applied: string[];
  scoreBefore: number;
  scoreAfter: number;
  feasibleAfter: boolean;
};

/**
 * Critic → Repair loop result (PR-12). Bounded number of passes; each pass
 * regenerates only the flagged scope, then re-critiques.
 */
export type CriticRepairLoopResult = {
  version: "1.0";
  method: string;
  maxPasses: number;
  outcome: "not_needed" | "improved" | "plateau" | "exhausted" | "infeasible";
  initialScore: number;
  finalScore: number;
  passes: CriticRepairPass[];
  finalCritique: ArrangementCritique;
};

/** Deliberate candidate-generation strategies (PR-10). */
export type CandidateStrategyId =
  | "conservative" | "rhythmic" | "melodic" | "sparse" | "adventurous";

/**
 * Deliberate diversity for candidate generation (PR-10): instead of random
 * seeds, each candidate is steered by a named strategy so the critic chooses
 * between genuinely different ideas.
 */
export type CandidateGenerationPlan = {
  version: "1.0";
  derivedAt: string;
  inputsDigestSha256: string;
  method: string;
  baseSeed: number;
  candidates: Array<{
    candidateId: string;
    label: string;
    strategy: CandidateStrategyId;
    seed: number;
    parameters: Record<string, number>;
    partAdjustments: Array<{
      taskId: string;
      densityMultiplier: number;
      seed: number;
      note: string;
    }>;
  }>;
};

/** Transition Engine (PR-08): planned devices for every section boundary. */
export type TransitionPlanSet = {
  version: "1.0";
  derivedAt: string;
  inputsDigestSha256: string;
  method: string;
  transitions: TransitionPlan[];
};

export type ArrangementPlan = {
  id: string; version: number; sections: ArrangementPlanSection[]; style: StyleSpec;
  songModelVersion: number; parameters: Record<string, number | string | boolean>;
  provenance: ArtifactProvenance;
  /** Auditable song → section → phrase → bar → event planning authority. */
  hierarchy: ArrangementHierarchy;
  /** Whole-song direction, derived before section planning; absent on historical plans. */
  globalPlan?: GlobalArrangementPlan;
  /** Section / phrase / instrument-role plan; absent on historical plans. */
  sectionPlan?: SectionPhrasePlan;
  /** Per-moment orchestration budgets + register occupancy; absent on historical plans. */
  orchestrationBudget?: OrchestrationBudgetPlan;
  /** Planned transition devices per section boundary; absent on historical plans. */
  transitionPlan?: TransitionPlanSet;
  /** Compact index of parts to compose (full request built on demand); absent on historical plans. */
  partComposerPlan?: PartComposerPlan;
  /** Deliberate candidate-generation strategy set; absent on historical plans. */
  candidateGenerationPlan?: CandidateGenerationPlan;
  /** Absent only on historical persisted plans, which are interpreted as v1. */
  compositionIntelligence?: CompositionIntelligencePlan;
  /** Frozen before notes are generated; absent on historical plans. */
  generationPreference?: GenerationPreferenceSnapshot | null;
  /** The ProductionBrief this plan was planned from (Wave U); absent without a brief. */
  productionBriefId?: string;
  productionBriefDigestSha256?: string;
  /** Present when this version came from a chat edit applied within locks (PR-U5). */
  regeneration?: ScopedRegenerationReport;
};

export type MusicalNote = {
  id: string; start: number; duration: number; pitch: number; velocity: number;
  channel?: number; voice?: string;
  /** Canonical motif decision that authored this event. */
  motif?: {
    id: string;
    fingerprint: string;
    parentMotifId: string | null;
    transformation: MotifTransformation;
    phraseId: string;
    intention: PhraseIntention;
    evidenceSha256: string;
    windowEndSeconds?: number;
  };
};

export type ArticulationEvent = {
  time: number; name: string; keyswitch?: number; intensity?: number;
};

export type ArrangementRevisionSummary = {
  affectedSections: string[];
  affectedTracks: string[];
  trackMembershipChanges: number;
  chordChanges: number;
  noteChanges: number;
  ccChanges: number;
  conductorControls: string[];
  candidateSelectionChanged: boolean;
};

export const projectCleanupJobsTable = pgTable("music_project_cleanup_jobs", {
  id: text("id").primaryKey(),
  projectId: text("project_id").notNull(),
  ownerId: text("owner_id").notNull(),
  status: text("status").$type<ProjectCleanupStatus>().notNull().default("queued"),
  objectPaths: jsonb("object_paths").$type<string[]>().notNull().default([]),
  activeUploadPaths: jsonb("active_upload_paths").$type<string[]>().notNull().default([]),
  uploadLeaseExpiresAt: timestamp("upload_lease_expires_at", { withTimezone: true }),
  analysisJobIds: jsonb("analysis_job_ids").$type<string[]>().notNull().default([]),
  attempts: integer("attempts").notNull().default(0),
  lastError: text("last_error"),
  startedAt: timestamp("started_at", { withTimezone: true }),
  leaseId: text("lease_id"),
  leaseExpiresAt: timestamp("lease_expires_at", { withTimezone: true }),
  completedAt: timestamp("completed_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true })
    .notNull()
    .defaultNow()
    .$onUpdate(() => new Date()),
});

export const projectUploadReservationsTable = pgTable("music_project_upload_reservations", {
  objectPath: text("object_path").primaryKey(),
  projectId: text("project_id")
    .notNull()
    .references(() => musicProjectsTable.id, { onDelete: "cascade" }),
  ownerId: text("owner_id").notNull(),
  contentType: text("content_type").notNull().default("application/octet-stream"),
  size: integer("size").notNull().default(0),
  expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export type ProductionJobStatus =
  | "queued"
  | "running"
  | "succeeded"
  | "failed"
  | "cancel_requested"
  | "cancelled";

export type ProductionJobError = {
  code: string;
  message: string;
  retryable: boolean;
  provider?: string;
  details?: Record<string, string | number | boolean>;
};

export const musicUsageLedgerTable = pgTable("music_usage_ledger", {
  id: text("id").primaryKey(),
  projectId: text("project_id")
    .notNull()
    .references(() => musicProjectsTable.id, { onDelete: "cascade" }),
  ownerId: text("owner_id").notNull(),
  jobId: text("job_id"),
  kind: text("kind").notNull(),
  units: integer("units").notNull().default(0),
  estimatedCostCents: integer("estimated_cost_cents").notNull().default(0),
  actualCostCents: integer("actual_cost_cents"),
  status: text("status").notNull().default("reserved"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (table) => [
  uniqueIndex("music_usage_ledger_job_unique").on(table.jobId),
]);

export type CandidateEvaluation = {
  status: CandidateEvaluationStatus;
  providerScore: number;
  renderArtifactIds: string[];
  artifacts: CandidateEvaluationArtifact[];
  qualityReport: CandidateQualityReport | null;
  musicCritic: CandidateMusicCriticReport | null;
  /** Deterministic PCM-only evidence, deliberately independent of the symbolic critic. */
  audioCritic: CandidateAudioCriticReport | null;
  error: string | null;
  strategy?: CandidateStrategyEvidence;
  diversity?: CandidateDiversityEvidence;
  repair?: CandidateRepairEvidence;
};

export type CandidateRepairEvidence = {
  sourceCandidateId: string;
  /** Display-safe lineage persisted for repairs created after this field was introduced. */
  sourceCandidateLabel?: string;
  findingId: string;
  seed: number;
  attempt: number;
  maxAttempts: number;
  scope: {
    affectedSections: string[];
    startBar: number;
    endBar: number;
    affectedTrackIds: string[];
  };
  musicalReason: string;
  outsideScopePreserved: boolean;
  changedScopes: ArrangementHierarchyScope[];
  sourceQualityScore: number;
  repairedQualityScore: number | null;
  improved: boolean;
};
export type CandidateStrategyEvidence = {
  name: "sparse" | "balanced" | "rhythmic" | "harmonic" | "orchestral";
  index: number;
  baseSeed: number;
  seed: number;
};

export type CandidateDiversityEvidence = {
  fingerprint: {
    activeTracks: string[];
    densityEnergy: Array<{ density: number; energy: number }>;
    harmonySequence: string[];
    trackRoleInstruments: string[];
    noteShape: number[];
  };
  comparedToCandidateId: string | null;
  distance: number | null;
  threshold: number;
  rejected: boolean;
  reason: "baseline_retained" | "near_duplicate" | "sufficiently_distinct";
};

export type CandidateQualityReport = {
  score: number;
  checks: Record<string, number>;
  weights: Record<string, number>;
  strengths: string[];
  weaknesses: string[];
  warnings: string[];
  evaluatedAt: string;
  renderArtifactIds: string[];
  lineageComplete: boolean;
};

export type CandidateMusicCriticDimension =
  | "vocalFit"
  | "harmony"
  | "development"
  | "contrastAndTransitions"
  | "registerCollisions"
  | "playability"
  | "repetition"
  | "styleAndControlAdherence"
  | "motifContinuityAndDevelopment"
  | "phraseIntent"
  | "vocalInteraction"
  | "roleDuplication"
  | "orchestralBalance"
  | "grooveCoordination"
  | "voiceLeading"
  | "countermelodyShape"
  | "dramaticTrajectory";

export type CandidateMusicCriticEvidence = {
  source:
    | "vocal_activity"
    | "harmony_decisions"
    | "section_plan"
    | "track_notes"
    | "instrument_constraints"
    | "style_and_directives"
    | "composition_intelligence"
    | "rhythm_evidence";
  summary: string;
  observations: Record<string, string | number | boolean>;
};

export type CandidateMusicCriticDimensionResult = {
  status: "available" | "unavailable" | "failed";
  score: number | null;
  evidence: CandidateMusicCriticEvidence[];
  explanation: string;
  findings: CriticRepairFinding[];
};

export type CandidateMusicCriticReport = CandidateMusicCriticReportV1 | CandidateMusicCriticReportV2;
type CandidateMusicCriticReportCoverage = {
  availableDimensions: number;
  totalDimensions: number;
  sparse: boolean;
};
export type CandidateMusicCriticReportV2 = {
  version: "music-critic-v2";
  score: number;
  coverage: CandidateMusicCriticReportCoverage;
  dimensions: Record<
    CandidateMusicCriticDimension,
    CandidateMusicCriticDimensionResult
  >;
};
export type CandidateMusicCriticReportV1 = {
  version: "music-critic-v1";
  score: number;
  coverage: CandidateMusicCriticReportCoverage;
  dimensions: Record<Exclude<CandidateMusicCriticDimension,
    "motifContinuityAndDevelopment" | "phraseIntent" | "vocalInteraction" | "roleDuplication" |
    "orchestralBalance" | "grooveCoordination" | "voiceLeading" | "countermelodyShape" | "dramaticTrajectory">,
    CandidateMusicCriticDimensionResult>;
};

export type CandidateAudioCriticDimension =
  | "vocalFit"
  | "masking"
  | "balance"
  | "dynamics"
  | "artifactsAndDistortion"
  | "transitions"
  | "repetition";

export type CandidateAudioCriticFinding = {
  id: string;
  startSeconds: number;
  endSeconds: number;
  /** Present only where a rendered stem or a single-track render supports attribution. */
  affectedTrackIds?: string[];
  confidence: number;
  provenance: "rendered_pcm";
  recommendation: string;
};

export type CandidateAudioCriticDimensionResult = {
  status: "available" | "unavailable" | "failed";
  score: number | null;
  explanation: string;
  findings: CandidateAudioCriticFinding[];
};

export type CandidateAudioCriticReport = {
  version: "perceptual-audio-critic-v1";
  status: "available" | "unavailable" | "failed" | "insufficient";
  score: number | null;
  coverage: { availableDimensions: number; totalDimensions: 7; sufficient: boolean };
  /** Hash/metadata only: samples and storage locations are never persisted in critic evidence. */
  evidence: {
    artifactId: string;
    artifactSha256: string;
    sampleRate: number;
    analyzerVersion: string;
  } | null;
  dimensions: Record<CandidateAudioCriticDimension, CandidateAudioCriticDimensionResult>;
};

export type CandidateEvaluationArtifact = {
  id: string;
  type: "AUDIO_TRACK" | "MIDI" | "QUALITY_REPORT";
  label: string;
  url: string;
  /** Exact stored artifact bytes; optional only for historical rows. */
  artifactSha256?: string;
};

export type CandidateRepairSnapshot = {
  sourceCandidateId: string;
  sourceCandidateLabel: string;
  sourceScore: number;
  seed: number;
  maxAttempts: number;
  finding: CriticRepairFinding;
  plan: ArrangementPlan;
  trackModels: TrackModel[];
};

export type GenerationPreferenceEffects = {
  orchestrationDensity: number;
  responseFrequency: number;
  roleEmphasis: "foundation" | "pulse" | "harmony" | "counterline" | "texture";
  voicingCharacter: "close" | "open" | "wide";
  development: "restrained" | "balanced" | "progressive";
  transitionIntensity: number;
};

export type MotifTransformation =
  | "repetition"
  | "rhythmic_variation"
  | "augmentation"
  | "diminution"
  | "register_displacement"
  | "answering_gesture"
  | "orchestral_handoff";

export type GenerationPreferenceSnapshot = {
  contractVersion: "1.0";
  calibrationId: string;
  calibrationVersion: number;
  heldOutAgreement: number;
  baselineAgreement: number;
  heldOutExamples: number;
  evaluationSha256: string;
  evidenceSha256: string;
  effects: GenerationPreferenceEffects;
};

// ---------------------------------------------------------------------------
// Wave U — PR-U2: persistent producer conversation. Additive tables only.
//
// One "current" ProductionBrief per project = the row with the highest
// `version`. Every version keeps the UserIntent + StyleProfile it was compiled
// from and the clarification answers it applied, so any version can be
// recompiled from its own inputs. Chat turns are append-only; durable
// decisions are superseded, never deleted.
// ---------------------------------------------------------------------------

export type ProducerChatTurnRole = "user" | "producer";

export type ProducerChatTurnKind =
  | "intake" | "answers" | "refinement" | "edit" | "explanation" | "supersede"
  /** PR-U4: a reference was added, rescoped, fingerprinted or removed, and the brief recompiled. */
  | "reference"
  /** PR-U5: an edit turn's EditPlan was applied to the arrangement within its locks. */
  | "regeneration";

/** What a producer turn did to the musical state, in machine-readable form. */
export type ProducerChatTurnStructured = {
  kind: ProducerChatTurnKind;
  briefVersion: number | null;
  /** Intent items this turn added (verbatim-evidenced; never the full intent). */
  intentDelta?: {
    inferences: IntentInference[];
    constraints: IntentConstraint[];
    references: IntentReference[];
    unresolvedTerms: string[];
  };
  clarifications?: ClarificationQuestion[];
  answers?: ClarificationAnswer[];
  editPlan?: EditPlan;
  /** Ids (in the brief) of the durable decisions this turn created. */
  decisionIds?: string[];
  explanation?: PlanExplanation;
  /** Where the plan the turn reasoned over came from. */
  planSource?: "arrangement" | "derived" | "none";
  /** `intent-extraction/v1` or `intent-extraction/v1+<model id>`. */
  intentMethod?: string;
  /** PR-U4: the reference rows a turn touched (added / rescoped / fingerprinted / removed / compared). */
  referenceIds?: string[];
  /** PR-U5: what applying an edit turn did to the arrangement. */
  regeneration?: ScopedRegenerationReport;
  /** PR-U5: the arrangement version a regeneration turn produced. */
  arrangementId?: string;
  arrangementVersion?: number;
};

export const musicProductionBriefsTable = pgTable(
  "music_production_briefs",
  {
    id: text("id").primaryKey(),
    projectId: text("project_id")
      .notNull()
      .references(() => musicProjectsTable.id, { onDelete: "cascade" }),
    version: integer("version").notNull(),
    intent: jsonb("intent").$type<UserIntent>().notNull(),
    styleProfile: jsonb("style_profile").$type<StyleProfile>().notNull(),
    brief: jsonb("brief").$type<ProductionBrief>().notNull(),
    /** Clarification answers applied at this version (carried to later ones). */
    answers: jsonb("answers").$type<ClarificationAnswer[]>().notNull().default([]),
    inputsDigestSha256: text("inputs_digest_sha256").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex("music_production_briefs_project_version_unique").on(table.projectId, table.version),
  ],
);

export const musicProducerChatTurnsTable = pgTable(
  "music_producer_chat_turns",
  {
    id: text("id").primaryKey(),
    projectId: text("project_id")
      .notNull()
      .references(() => musicProjectsTable.id, { onDelete: "cascade" }),
    briefId: text("brief_id"),
    role: text("role").$type<ProducerChatTurnRole>().notNull(),
    text: text("text").notNull(),
    structured: jsonb("structured").$type<ProducerChatTurnStructured | null>(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index("music_producer_chat_turns_project_created_at_idx").on(table.projectId, table.createdAt),
  ],
);

/**
 * Durable producer decisions made in chat (standing rules and scoped
 * overrides). Named `music_producer_brief_decisions` because
 * `music_producer_decisions` is the learning ledger (`producerDecisionsTable`).
 * `delta` is the BriefDelta that produces `decision` when the brief is
 * recompiled; a superseded row's delta is no longer applied.
 */
export const musicProducerBriefDecisionsTable = pgTable(
  "music_producer_brief_decisions",
  {
    id: text("id").primaryKey(),
    projectId: text("project_id")
      .notNull()
      .references(() => musicProjectsTable.id, { onDelete: "cascade" }),
    briefId: text("brief_id").notNull(),
    /** The decision's id inside the brief (`dec-…`), stable across recompiles. */
    decisionId: text("decision_id").notNull(),
    decision: jsonb("decision").$type<ProducerBriefDecision>().notNull(),
    delta: jsonb("delta").$type<BriefDelta | null>(),
    supersededBy: text("superseded_by"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index("music_producer_brief_decisions_project_idx").on(table.projectId, table.createdAt),
  ],
);

// ---------------------------------------------------------------------------
// Wave U — PR-U6: producer memory. A standing rule the producer chose to keep
// across projects ("never high strings", "leave the second chorus for the
// singer"). Only ever the owner's OWN stated decisions — never a learned
// inference (that is PR-30's personal profile, which sits at `default`
// provenance below everything). A rule is promoted from one project's brief
// decision, applied at the intake of every later project as a `stated`
// decision marked `producer_memory:<id>`, and revocable; revoking it leaves
// the briefs it already shaped untouched, exactly like superseding a decision.
// ---------------------------------------------------------------------------

export type ProducerMemoryStatus = "active" | "revoked";

export type ProducerMemoryRule = {
  id: string;
  /** The producer's own words, carried verbatim from the decision. */
  statement: string;
  topic: ProducerDecisionTopic;
  scope: ProducerDecisionScope;
  strength: "hard" | "soft";
  dimension?: StyleDimensionName;
  value?: StyleDimensionValue;
  /** Re-applied when a later project's brief is compiled. */
  delta: BriefDelta;
  /** The project, brief and decision that stated it. */
  source: { projectId: string; briefId: string; decisionId: string };
  createdAt: string;
};

export const musicProducerMemoryTable = pgTable(
  "music_producer_memory",
  {
    id: text("id").primaryKey(),
    ownerId: text("owner_id").notNull(),
    rule: jsonb("rule").$type<ProducerMemoryRule>().notNull(),
    /** Kept as columns as well so a project's deletion is visible in the row. */
    sourceProjectId: text("source_project_id"),
    sourceDecisionId: text("source_decision_id").notNull(),
    status: text("status").$type<ProducerMemoryStatus>().notNull().default("active"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    revokedAt: timestamp("revoked_at", { withTimezone: true }),
  },
  (table) => [
    index("music_producer_memory_owner_idx").on(table.ownerId, table.createdAt),
    uniqueIndex("music_producer_memory_decision_unique").on(table.ownerId, table.sourceDecisionId),
  ],
);

// ---------------------------------------------------------------------------
// Gate C — PR-34: blind listening sessions. Two arrangements of the same song
// (two generation candidates the owner picks, each standing for a system under
// test), served to human raters as anonymised A/B audio with the PR-18
// questions. Raters see tokens and audio, never a system name; the owner's own
// votes are recorded but excluded from the verdict. The audio is the
// candidates' existing evaluation renders — nothing new is rendered or stored.
// ---------------------------------------------------------------------------

export type BlindListeningPick = "ranked" | "first" | "explicit";

export type BlindListeningSide = {
  /** The system under test this side stands for (e.g. "brain · ranked #1"). Never shown to a rater. */
  label: string;
  generationJobId: string;
  candidateId: string;
  candidateLabel: string;
  pick: BlindListeningPick;
  /** The candidate's evaluation render (AUDIO_TRACK artifact URL). */
  audioUrl: string;
};

export type BlindListeningSides = {
  left: BlindListeningSide;
  right: BlindListeningSide;
  /** Which side has to win: the plan's KPI is "the new brain beats the previous one". */
  challenger: "left" | "right";
  /**
   * Wave Q tournament sessions (PR-68): many pairs from one tournament report,
   * each side its own render. `audioByToken` maps a pair token to its stored
   * render; `left`/`right` above then only name the incumbent and challenger
   * arms the gate is about. Absent on the original two-candidate sessions.
   */
  kind?: "candidates" | "tournament";
  audioByToken?: Record<string, string>;
  tournament?: {
    runId: string;
    evidenceFile: string;
    /** The one question every pair must answer; the gate and the owner's preference read it. */
    primaryQuestion: string;
    secondaryQuestions: string[];
    /** Which comparison types were drawn, and how many pairs each. */
    comparisons: Array<{ id: string; a: string; b: string; pairs: number }>;
    /** token → tournament entry key (task:seed:provider). Owner-only. */
    entryByToken: Record<string, string>;
    /**
     * PR-72 listening benchmark V2: which renderer made the audio, the
     * composition the session was drawn with, how many pairs of each window
     * kind, and the context-identity proof. Absent on PR-68 sessions.
     * Owner-only.
     */
    benchmarkV2?: {
      benchmarkVersion: string;
      renderer: string;
      rendererVersion: string;
      quotas: Record<string, number>;
      byWindowKind: Record<string, number>;
      contextIdentity: { pairsChecked: number; identical: boolean };
    };
  };
};

/** Same shape as the benchmark's `BlindPair` (arrangementBenchmark.ts). */
export type BlindListeningPair = {
  pairId: string;
  caseId: string;
  left: { token: string; systemUnderTest: string };
  right: { token: string; systemUnderTest: string };
  questions: string[];
  /** Tournament sessions: the comparison type, task, seed and target family behind this pair. Owner-only. */
  meta?: { comparison: string; taskId: string; seed: number; family: string };
};

export type BlindListeningSessionStatus = "open" | "closed";

export const musicBlindListeningSessionsTable = pgTable(
  "music_blind_listening_sessions",
  {
    id: text("id").primaryKey(),
    projectId: text("project_id").notNull().references(() => musicProjectsTable.id, { onDelete: "cascade" }),
    ownerId: text("owner_id").notNull(),
    title: text("title").notNull(),
    sides: jsonb("sides").$type<BlindListeningSides>().notNull(),
    pairs: jsonb("pairs").$type<BlindListeningPair[]>().notNull(),
    /** token → system under test. Owner-only; never part of a rater view. */
    keyBySide: jsonb("key_by_side").$type<Record<string, string>>().notNull(),
    status: text("status").$type<BlindListeningSessionStatus>().notNull().default("open"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    closedAt: timestamp("closed_at", { withTimezone: true }),
  },
  (table) => [index("music_blind_listening_sessions_project_idx").on(table.projectId, table.createdAt)],
);

export const musicBlindListeningVotesTable = pgTable(
  "music_blind_listening_votes",
  {
    id: text("id").primaryKey(),
    sessionId: text("session_id").notNull().references(() => musicBlindListeningSessionsTable.id, { onDelete: "cascade" }),
    pairId: text("pair_id").notNull(),
    raterId: text("rater_id").notNull(),
    question: text("question").notNull(),
    winnerToken: text("winner_token").notNull(),
    /** The session owner's votes are kept for the record and excluded from the verdict. */
    isOwner: boolean("is_owner").notNull().default(false),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [uniqueIndex("music_blind_listening_votes_unique").on(table.sessionId, table.pairId, table.raterId, table.question)],
);
