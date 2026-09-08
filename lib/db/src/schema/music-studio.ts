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
export type MixMasterControls = {
  tracks: Record<string, {
    levelDb: number;
    pan: number;
    bus: "MIX" | "DRUMS" | "MUSIC" | "VOCALS" | "FX";
    sendDb: number;
    processing: { highPassHz: number; compressorRatio: number; saturation: number };
  }>;
  master: { targetLufs: number; truePeakDbtp: number; processing: { limiter: boolean; stereoWidth: number } };
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

export type DomainReconciliation = {
  domain: AnalysisDomain;
  value: string | number | null;
  confidence: number | null;
  providers: string[];
  status: "detected" | "low_confidence" | "not_available";
  message: string | null;
  margin: number | null;
};

/**
 * Per-domain provider reconciliation. `consensusScore` is the mean confidence
 * across domains that resolved to `detected`; `contestedDomains` did not.
 */
export type DomainReconciliationReport = {
  version: "1.0";
  domains: Partial<Record<AnalysisDomain, DomainReconciliation>>;
  consensusScore: number;
  contestedDomains: AnalysisDomain[];
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
  fields: Array<"bpm" | "key" | "meter" | "sections">;
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
export type SongModelFieldStatus = {
  status: "detected" | "low_confidence" | "failed" | "not_available";
  confidence: number | null;
  providers: string[];
  message: string | null;
  edited: boolean;
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
  };
  ccCurves: string[];
  /** Bounded sample of per-note decisions for audit. */
  decisions: PerformanceDecision[];
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
