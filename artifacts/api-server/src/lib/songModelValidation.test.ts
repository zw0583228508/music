import assert from "node:assert/strict";
import test from "node:test";
import {
  CorrectProjectSongModelResponse,
  GetProjectSongModelResponse,
} from "@workspace/api-zod";
import {
  chordMelodyConflictSongModel,
  microNoteSongModel,
  missingSectionsSongModel,
  octaveJumpSongModel,
  tempoDriftSongModel,
  validSongModel,
} from "./__fixtures__/songModelValidation";
import {
  evaluateArrangementEligibility,
  fuseProviderSongModels,
  isLegacySongModel,
  canonicalizeSongModelCoordinates,
  refreshSongModelValidation,
  unavailableVocalIntelligence,
  validateCanonicalSongModel,
  validateSongModelCore,
} from "./songModelValidation";

const issueCodes = (result: { issues: Array<{ code: string }> }) =>
  result.issues.map((item) => item.code);

test("a contested key is accepted flagged with an empty key map; a missing key is still rejected", () => {
  const contestedKey = {
    status: "contested",
    confidence: null,
    providers: ["LOCAL_SIGNAL_ANALYZER_V1", "TRANSCRIPTION_KEY_V1"],
    message: "Independent analyses disagree: Eb major vs G minor.",
    edited: false,
    candidates: [
      { value: "Eb major", confidence: .35, providers: ["TRANSCRIPTION_KEY_V1"] },
      { value: "G minor", confidence: .27, providers: ["LOCAL_SIGNAL_ANALYZER_V1"] },
    ],
  };
  const contested = {
    ...validSongModel,
    keyMap: [],
    fieldStatus: { ...(validSongModel as { fieldStatus?: object }).fieldStatus, key: contestedKey },
  };
  const core = validateSongModelCore(contested);
  assert.equal(core.success, true);
  assert.deepEqual(issueCodes(core), ["CONTESTED_KEY"]);
  assert.equal(core.issues[0]!.severity, "warning");

  // Through fusion the model is accepted, flagged — so arrangement stays blocked
  // until a producer confirms a key, and the candidates ride along untouched.
  const fusion = fuseProviderSongModels([{ provider: "TEST", output: contested, confidence: .8 }]);
  assert.equal(fusion.accepted, true);
  if (fusion.accepted) {
    assert.equal(fusion.model.validation.status, "flagged");
    assert.deepEqual(fusion.model.keyMap, []);
    assert.equal(fusion.model.fieldStatus?.key?.status, "contested");
    assert.equal(fusion.model.fieldStatus?.key?.candidates?.length, 2);
    const eligibility = evaluateArrangementEligibility(fusion.model, "ready", 0.9);
    assert.equal(eligibility.eligible, false);
    if (!eligibility.eligible) assert.equal(eligibility.code, "SONG_MODEL_FLAGGED");
    // Confirming a key is an ordinary correction; the refreshed model carries no warning.
    const confirmed = refreshSongModelValidation({
      ...fusion.model,
      keyMap: [{ time: 0, key: "G minor", confidence: 1 }],
      fieldStatus: { ...fusion.model.fieldStatus!, key: { ...contestedKey, status: "detected", confidence: 1, edited: true } },
    });
    assert.equal(confirmed.validation.status, "accepted");
  }

  // The same empty key map with no contest is still a missing analysis.
  const missing = validateSongModelCore({ ...validSongModel, keyMap: [] });
  assert.equal(missing.success, false);
  assert.ok(issueCodes(missing).includes("MISSING_KEY_MAP"));
  // A contest that names only one value is not a contest.
  const oneCandidate = validateSongModelCore({
    ...contested,
    fieldStatus: { ...contested.fieldStatus, key: { ...contestedKey, candidates: contestedKey.candidates.slice(0, 1) } },
  });
  assert.equal(oneCandidate.success, false);
  assert.ok(issueCodes(oneCandidate).includes("MISSING_KEY_MAP"));
});

test("PR-89: a contested tempo rides on a provisional grid, flags the model, and the block names the field, its candidates and what settles it", () => {
  const contestedTempo = {
    status: "contested",
    confidence: null,
    providers: ["BEAT_THIS", "MADMOM"],
    message: "Independent analyses disagree: 120 (BEAT_THIS) vs 60 (MADMOM) - half double tempo. Confirm one before it is used.",
    edited: false,
    candidates: [
      { value: "120", confidence: .74, providers: ["BEAT_THIS"] },
      { value: "60", confidence: .7, providers: ["MADMOM"], relationToLeader: "half_double_tempo" },
    ],
    relation: "half_double_tempo",
    whatWouldSettleIt: "The bar length: a downbeat or metre reading decides.",
    provisional: true,
  };
  const detectedField = { status: "detected", confidence: .9, providers: ["TEST"], message: null, edited: false };
  const contested = {
    ...validSongModel,
    tempoMap: [{ time: 0, bpm: 120, confidence: 0 }],
    fieldStatus: {
      ...(validSongModel as { fieldStatus?: object }).fieldStatus,
      tempo: contestedTempo,
      meter: detectedField, key: detectedField, melody: detectedField, bass: detectedField,
      harmony: detectedField, sections: detectedField, energy: detectedField,
    },
  };
  const core = validateSongModelCore(contested);
  assert.equal(core.success, true);
  assert.deepEqual(issueCodes(core), ["CONTESTED_TEMPO"]);
  assert.equal(core.issues[0]!.severity, "warning");
  const fusion = fuseProviderSongModels([{ provider: "TEST", output: contested, confidence: .8 }]);
  assert.equal(fusion.accepted, true);
  if (fusion.accepted) {
    assert.equal(fusion.model.validation.status, "flagged");
    // The provisional grid is carried, weighed at zero, and marked as such.
    assert.equal(fusion.model.tempoMap[0]!.confidence, 0);
    assert.equal(fusion.model.fieldStatus?.tempo?.provisional, true);
    const eligibility = evaluateArrangementEligibility(fusion.model, "ready", 0.9);
    assert.equal(eligibility.eligible, false);
    if (!eligibility.eligible) {
      assert.equal(eligibility.code, "SONG_MODEL_FLAGGED");
      assert.ok(eligibility.message.includes("confirms tempo"), eligibility.message);
      assert.ok(eligibility.message.includes("120 (BEAT_THIS) vs 60 (MADMOM)"), eligibility.message);
      assert.ok(eligibility.message.includes("half double tempo"), eligibility.message);
      assert.ok(eligibility.action.includes("bar length"), eligibility.action);
      assert.equal(eligibility.trust?.verdict, "needs_confirmation");
      assert.deepEqual(eligibility.trust?.fieldsToConfirm, ["tempo"]);
    }
    // The producer's confirmation settles it: no warning, arrangement eligible, trust report clean.
    const confirmed = refreshSongModelValidation({
      ...fusion.model,
      tempoMap: [{ time: 0, bpm: 60, confidence: 1 }],
      fieldStatus: {
        ...fusion.model.fieldStatus!,
        tempo: { ...contestedTempo, status: "detected", confidence: 1, edited: true, candidates: undefined, provisional: undefined },
      },
    });
    assert.equal(confirmed.validation.status, "accepted");
    const eligible = evaluateArrangementEligibility(confirmed, "ready", 0.9);
    assert.equal(eligible.eligible, true);
    if (eligible.eligible) assert.equal(eligible.trust.verdict, "trusted_automatically");
  }
  // The same status with one candidate is not a contest; no warning is emitted for it.
  const oneCandidate = validateSongModelCore({
    ...contested,
    fieldStatus: { ...contested.fieldStatus, tempo: { ...contestedTempo, candidates: contestedTempo.candidates.slice(0, 1) } },
  });
  assert.deepEqual(issueCodes(oneCandidate), []);
});

test("accepts a provider response that satisfies the canonical core contract", () => {
  const result = validateSongModelCore(validSongModel);
  assert.equal(result.success, true);
  assert.deepEqual(result.issues, []);
});

test("fusion emits a v2 canonical 960 PPQ timebase", () => {
  const result = fuseProviderSongModels([
    { provider: "analysis", output: validSongModel, confidence: 0.9 },
  ]);
  assert.equal(result.accepted, true);
  if (!result.accepted) return;
  assert.equal(result.model.contractVersion, "2.0");
  assert.deepEqual(result.model.timebase, {
    ppq: 960,
    originSeconds: 0,
    coordinateSystem: "seconds+ticks",
  });
  assert.equal(validateCanonicalSongModel(result.model).success, true);
});

test("API response parsers preserve canonical v2 coordinates", () => {
  const fused = fuseProviderSongModels([
    { provider: "analysis", output: validSongModel, confidence: 0.9 },
  ]);
  assert.equal(fused.accepted, true);
  if (!fused.accepted) return;
  const response = {
    ...fused.model,
    id: "model-1",
    projectId: "project-1",
    sourceId: "source-1",
    version: 1,
    status: "ready",
    audio: {
      ...fused.model.audio,
      proxyObjectPath: null,
      proxyContentType: null,
      analysisStartSeconds: 0,
      analysisDurationSeconds: fused.model.audio.durationSeconds,
      analysisCoverage: "full",
    },
    analysisStartSeconds: 0,
    analysisDurationSeconds: fused.model.audio.durationSeconds,
    analysisCoverage: 1,
    beats: [],
    bars: [],
    waveform: [],
    stems: [],
    dynamics: [],
    sourceStems: [],
    lyrics: [],
    bass: fused.model.bass ?? [],
    confidenceByField: {},
    providerProvenance: [],
    fieldStatus: Object.fromEntries(
      ["tempo", "meter", "key", "melody", "bass", "harmony", "sections", "energy"]
        .map((field) => [field, {
          status: "detected",
          confidence: 0.9,
          providers: ["analysis"],
          message: null,
          edited: false,
        }]),
    ),
    provenance: Object.fromEntries(
      ["tempo", "meter", "key", "melody", "bass", "harmony", "sections", "energy"]
        .map((field) => [field, ["analysis"]]),
    ),
    providers: ["analysis"],
    confidence: fused.model.fusion.confidence,
    createdAt: new Date(0).toISOString(),
    parentModelId: null,
    correction: null,
  };

  for (const parser of [GetProjectSongModelResponse, CorrectProjectSongModelResponse]) {
    const parsed = parser.parse(response);
    assert.equal(parsed.melody[0].coordinates?.start.beatInBar, 1);
    assert.equal(parsed.melody[0].coordinates?.start.beatFraction, 0);
    assert.equal(parsed.timebase?.ppq, 960);
  }
});

test("v2 validation rejects a missing or drifted canonical timebase", () => {
  const result = fuseProviderSongModels([
    { provider: "analysis", output: validSongModel, confidence: 0.9 },
  ]);
  assert.equal(result.accepted, true);
  if (!result.accepted) return;
  for (const timebase of [
    undefined,
    { ppq: 480, originSeconds: 0, coordinateSystem: "seconds+ticks" },
  ]) {
    const invalid = { ...result.model, timebase } as any;
    const validation = validateCanonicalSongModel(invalid);
    assert.equal(validation.success, false);
    assert.ok(issueCodes(validation).includes("INVALID_TIMEBASE"));
  }
});

test("canonical validation keeps historical v1 models readable", () => {
  const fused = fuseProviderSongModels([
    { provider: "analysis", output: validSongModel, confidence: 0.9 },
  ]);
  assert.equal(fused.accepted, true);
  if (!fused.accepted) return;
  const legacy = {
    ...fused.model,
    contractVersion: "1.0",
    timebase: undefined,
  };
  assert.equal(validateCanonicalSongModel(legacy).success, true);
});

test("v2 validation rejects coordinates that contradict the canonical timeline", () => {
  const fused = fuseProviderSongModels([
    { provider: "analysis", output: validSongModel, confidence: 0.9 },
  ]);
  assert.equal(fused.accepted, true);
  if (!fused.accepted) return;
  const contradictory = structuredClone(fused.model) as any;
  contradictory.melody[0].coordinates.start.tick = 1;
  const validation = validateCanonicalSongModel(contradictory);
  assert.equal(validation.success, false);
  assert.ok(issueCodes(validation).includes("CONTRADICTORY_COORDINATES"));
});

test("rehydrates every v2 coordinate on correction/versioning paths without changing events", () => {
  const fused = fuseProviderSongModels([
    { provider: "analysis", output: validSongModel, confidence: 0.9 },
  ]);
  assert.equal(fused.accepted, true);
  if (!fused.accepted) return;
  const coordinateStripped = structuredClone(fused.model) as any;
  for (const collection of ["tempoMap", "meterMap", "keyMap", "melody", "chords", "sections"]) {
    for (const event of coordinateStripped[collection]) delete event.coordinates;
  }
  const rehydrated = canonicalizeSongModelCoordinates(coordinateStripped);
  assert.equal(validateCanonicalSongModel(rehydrated).success, true);
  assert.deepEqual(
    rehydrated.melody.map(({ coordinates, ...event }) => event),
    fused.model.melody.map(({ coordinates, ...event }) => event),
  );
  assert.ok(rehydrated.tempoMap.every((event) => event.coordinates));
  assert.ok(rehydrated.meterMap.every((event) => event.coordinates));
  assert.ok(rehydrated.keyMap.every((event) => event.coordinates));
  assert.ok(rehydrated.melody.every((event) => event.coordinates?.start && event.coordinates.end));
  assert.ok(rehydrated.chords.every((event) => event.coordinates?.start && event.coordinates.end));
  assert.ok(rehydrated.sections.every((event) => event.coordinates?.start && event.coordinates.end));
});

test("Song Model API serialization retains v2 canonical coordinates and timebase", () => {
  const fused = fuseProviderSongModels([
    { provider: "analysis", output: validSongModel, confidence: 0.9 },
  ]);
  assert.equal(fused.accepted, true);
  if (!fused.accepted) return;
  const fields = ["tempo", "meter", "key", "melody", "bass", "harmony", "sections", "energy"] as const;
  const serialized = GetProjectSongModelResponse.parse({
    ...fused.model,
    id: "model-1",
    projectId: "project-1",
    sourceId: "source-1",
    version: 2,
    status: "ready",
    audio: {
      ...fused.model.audio,
      proxyObjectPath: null,
      proxyContentType: null,
      analysisStartSeconds: 0,
      analysisDurationSeconds: 16,
      analysisCoverage: "full",
    },
    analysisStartSeconds: 0,
    analysisDurationSeconds: 16,
    analysisCoverage: 1,
    beats: [],
    bars: [],
    bass: [],
    dynamics: [],
    waveform: [],
    stems: [],
    sourceStems: [],
    lyrics: [],
    confidenceByField: {},
    providerProvenance: [],
    fieldStatus: Object.fromEntries(fields.map((field) => [field, {
      status: "detected", confidence: 0.9, providers: ["analysis"], message: null, edited: false,
    }])),
    provenance: Object.fromEntries(fields.map((field) => [field, ["analysis"]])),
    providers: ["analysis"],
    confidence: 0.9,
    createdAt: "2025-01-01T00:00:00.000Z",
  });
  assert.deepEqual(serialized.timebase, fused.model.timebase);
  assert.deepEqual(serialized.tempoMap[0].coordinates, fused.model.tempoMap[0].coordinates);
  assert.deepEqual(serialized.meterMap[0].coordinates, fused.model.meterMap[0].coordinates);
  assert.deepEqual(serialized.melody[0].coordinates, fused.model.melody[0].coordinates);
  assert.deepEqual(serialized.chords[0].coordinates, fused.model.chords[0].coordinates);
  assert.deepEqual(serialized.sections[0].coordinates, fused.model.sections[0].coordinates);
  assert.equal(serialized.vocalEvidence.status, "not_available");
  assert.deepEqual(serialized.vocalEvidence.observedVoicedWindows, []);
  assert.deepEqual(serialized.vocalEvidence.observedSilentWindows, []);
  assert.match(serialized.vocalEvidence.reason ?? "", /No decoded vocal/i);
});

test("pre-change v2 API rows serialize explicit unavailable vocal intelligence", () => {
  const fused = fuseProviderSongModels([
    { provider: "analysis", output: validSongModel, confidence: .9 },
  ]);
  assert.equal(fused.accepted, true);
  if (!fused.accepted) return;
  const historical = structuredClone(fused.model) as any;
  delete historical.vocalEvidence;
  delete historical.vocalIntelligence;
  historical.vocalEvidence = {
    status: "not_available",
    reason: "This historical Song Model has no decoded vocal stem evidence.",
    provenance: null,
    sampleRate: null,
    channels: null,
    frameSizeSamples: null,
    thresholds: null,
    observedVoicedWindows: [],
    observedSilentWindows: [],
  };
  historical.vocalIntelligence = unavailableVocalIntelligence();
  const fields = ["tempo", "meter", "key", "melody", "bass", "harmony", "sections", "energy"] as const;
  const serialized = GetProjectSongModelResponse.parse({
    ...historical,
    id: "historical-model",
    projectId: "project-1",
    sourceId: "source-1",
    version: 1,
    status: "ready",
    audio: {
      ...historical.audio,
      proxyObjectPath: null,
      proxyContentType: null,
      analysisStartSeconds: 0,
      analysisDurationSeconds: historical.audio.durationSeconds,
      analysisCoverage: "full",
    },
    analysisStartSeconds: 0,
    analysisDurationSeconds: historical.audio.durationSeconds,
    analysisCoverage: 1,
    beats: [],
    bars: [],
    bass: historical.bass ?? [],
    dynamics: historical.energy,
    waveform: [],
    stems: [],
    sourceStems: [],
    lyrics: [],
    confidenceByField: {},
    providerProvenance: [],
    fieldStatus: Object.fromEntries(fields.map((field) => [field, {
      status: "not_available", confidence: null, providers: [], message: "Historical evidence unavailable.", edited: false,
    }])),
    provenance: Object.fromEntries(fields.map((field) => [field, []])),
    parentModelId: null,
    correction: null,
    providers: [],
    confidence: 0,
    createdAt: new Date(0).toISOString(),
  });
  assert.equal(serialized.vocalIntelligence.phrases.status, "not_available");
  assert.equal(serialized.vocalIntelligence.breaths.status, "not_available");
  assert.equal(serialized.vocalIntelligence.lyricAlignment.status, "not_available");
  assert.equal(serialized.vocalIntelligence.melodyAlignment.status, "not_available");
  assert.equal(serialized.vocalIntelligence.arrangementSpace.status, "not_available");
});

test("vocal evidence retains stem provenance and rejects overlapping or out-of-bounds observations", () => {
  const fused = fuseProviderSongModels([
    {
      provider: "analysis",
      confidence: 0.9,
      output: {
        ...validSongModel,
        vocalEvidence: {
          status: "detected",
          reason: null,
          provenance: {
            sourceStemRole: "vocals",
            objectPath: "/objects/analysis/project/job/vocals.flac",
            provider: "DEMUCS",
            contentChecksum: "a".repeat(64),
          },
          sampleRate: 8_000,
          channels: 1,
          frameSizeSamples: 800,
          thresholds: { rms: .01, peak: .02, activitySample: .005, activityRatio: .1 },
          observedVoicedWindows: [{ start: 1, end: 2 }],
          observedSilentWindows: [{ start: 0, end: 1 }],
        },
      },
    },
  ]);
  assert.equal(fused.accepted, true);
  if (!fused.accepted) return;
  assert.equal(fused.model.vocalEvidence?.provenance?.contentChecksum, "a".repeat(64));
  assert.ok(fused.model.vocalEvidence?.observedVoicedWindows[0].coordinates);
  assert.equal(validateCanonicalSongModel(fused.model).success, true);

  const invalid = structuredClone(fused.model);
  invalid.vocalEvidence!.observedSilentWindows = [{ start: 1.5, end: 20 }];
  const validation = validateCanonicalSongModel(invalid);
  assert.equal(validation.success, false);
  assert.ok(issueCodes(validation).includes("INVALID_VOCAL_WINDOW"));
  assert.ok(issueCodes(validation).includes("OVERLAPPING_VOCAL_WINDOWS"));
});

test("phrase, breath, and arrangement-space evidence stays canonical across pickups and meter changes", () => {
  const fused = fuseProviderSongModels([
    {
      provider: "analysis",
      confidence: .9,
      output: {
        ...validSongModel,
        meterMap: [
          { bar: 1, meter: "4/4", confidence: .9 },
          { bar: 2, meter: "3/4", confidence: .9 },
        ],
        vocalEvidence: {
          status: "detected",
          reason: null,
          provenance: {
            sourceStemRole: "vocals",
            objectPath: "/objects/vocals.flac",
            provider: "DEMUCS",
            contentChecksum: "b".repeat(64),
          },
          sampleRate: 8_000,
          channels: 1,
          frameSizeSamples: 800,
          thresholds: { rms: .01, peak: .02, activitySample: .005, activityRatio: .1 },
          observedVoicedWindows: [{ start: .25, end: 1.5 }, { start: 2, end: 2.75 }],
          observedSilentWindows: [{ start: 0, end: .25 }, { start: 1.5, end: 2 }, { start: 2.75, end: 4.5 }],
        },
        vocalIntelligence: {
          version: "1.0",
          provenance: {
            sourceStemRole: "vocals",
            objectPath: "/objects/vocals.flac",
            provider: "DEMUCS",
            contentChecksum: "b".repeat(64),
          },
          phrases: {
            status: "detected",
            reason: null,
            events: [
              { id: "phrase-1", start: .25, end: 1.5, confidence: .8 },
              { id: "phrase-2", start: 2, end: 2.75, confidence: .8 },
            ],
          },
          breaths: {
            status: "detected",
            reason: null,
            events: [{ id: "breath-1", start: 1.5, end: 2, confidence: .65, kind: "inter_phrase" }],
          },
          lyricAlignment: {
            status: "not_available",
            reason: "No timed lyric evidence is available.",
            alignments: [],
          },
          melodyAlignment: {
            status: "aligned",
            reason: null,
            alignments: [{ phraseId: "phrase-1", melodyIndexes: [0], confidence: .8 }],
          },
          arrangementSpace: {
            status: "detected",
            reason: null,
            windows: [{
              id: "space-1", start: 2.75, end: 4.5, confidence: .8,
              phraseBeforeId: "phrase-2", phraseAfterId: null,
              bars: [2, 3], sections: ["Verse"],
            }],
          },
        },
      },
    },
  ]);
  assert.equal(fused.accepted, true);
  if (!fused.accepted) return;
  const phrase = fused.model.vocalIntelligence!.phrases.events[0];
  const space = fused.model.vocalIntelligence!.arrangementSpace.windows[0];
  assert.equal(phrase.coordinates?.start.beatFraction, .5);
  assert.equal(space.coordinates?.start.bar, 2);
  assert.equal(validateCanonicalSongModel(fused.model).success, true);
});

test("fusion rejects malformed or unsupported vocal intelligence before canonicalization", () => {
  const malformed = {
    ...validSongModel,
    vocalIntelligence: {
      version: "1.0",
      provenance: null,
      phrases: { status: "detected", reason: null, events: [] },
      breaths: null,
      lyricAlignment: { status: "aligned", reason: null, alignments: [] },
      melodyAlignment: { status: "not_available", reason: "Unavailable.", alignments: [] },
      arrangementSpace: { status: "not_available", reason: "Unavailable.", windows: [] },
    },
  };
  const result = fuseProviderSongModels([
    { provider: "analysis", output: malformed, confidence: .9 },
  ]);
  assert.equal(result.accepted, false);
  if (result.accepted) return;
  assert.ok(issueCodes(result).includes("INVALID_VOCAL_INTELLIGENCE"));
  assert.ok(issueCodes(result).includes("UNVERIFIED_VOCAL_ALIGNMENT"));
});

test("fusion rejects arrangement-space bars and sections that drift from the canonical model", () => {
  const provenance = {
    sourceStemRole: "vocals",
    objectPath: "/objects/vocals.flac",
    provider: "DEMUCS",
    contentChecksum: "c".repeat(64),
  };
  const base = {
    ...validSongModel,
    vocalEvidence: {
      status: "detected",
      reason: null,
      provenance,
      sampleRate: 8_000,
      channels: 1,
      frameSizeSamples: 800,
      thresholds: { rms: .01, peak: .02, activitySample: .005, activityRatio: .1 },
      observedVoicedWindows: [{ start: 0, end: 1 }],
      observedSilentWindows: [{ start: 1, end: 2 }],
    },
    vocalIntelligence: {
      version: "1.0",
      provenance,
      phrases: {
        status: "detected",
        reason: null,
        events: [{ id: "phrase-1", start: 0, end: 1, confidence: .8 }],
      },
      breaths: { status: "not_available", reason: "No bounded breath.", events: [] },
      lyricAlignment: { status: "not_available", reason: "No lyrics.", alignments: [] },
      melodyAlignment: { status: "not_available", reason: "No overlap.", alignments: [] },
      arrangementSpace: {
        status: "detected",
        reason: null,
        windows: [{
          id: "space-1", start: 1, end: 2, confidence: .8,
          phraseBeforeId: "phrase-1", phraseAfterId: null,
          bars: [99], sections: ["invented-section"],
        }],
      },
    },
  };
  const result = fuseProviderSongModels([
    { provider: "analysis", output: base, confidence: .9 },
  ]);
  assert.equal(result.accepted, false);
  if (result.accepted) return;
  assert.ok(issueCodes(result).includes("UNVERIFIED_ARRANGEMENT_SPACE"));
});

test("conflicting and absent vocal intelligence remains explicit and empty", () => {
  const fused = fuseProviderSongModels([
    { provider: "analysis", output: validSongModel, confidence: .9 },
  ]);
  assert.equal(fused.accepted, true);
  if (!fused.accepted) return;
  assert.equal(fused.model.vocalIntelligence?.phrases.status, "not_available");
  assert.deepEqual(fused.model.vocalIntelligence?.phrases.events, []);
  const conflicting = structuredClone(fused.model);
  conflicting.vocalIntelligence!.lyricAlignment = {
    status: "conflicting",
    reason: "Timed lyric evidence overlaps and cannot be aligned deterministically.",
    alignments: [],
  };
  assert.equal(validateCanonicalSongModel(conflicting).success, true);
  assert.deepEqual(conflicting.vocalIntelligence!.lyricAlignment.alignments, []);
});

test("does not invent timed evidence for energy and dynamics sample arrays", () => {
  const fused = fuseProviderSongModels([
    { provider: "analysis", output: validSongModel, confidence: 0.9 },
  ]);
  assert.equal(fused.accepted, true);
  if (!fused.accepted) return;
  assert.deepEqual(fused.model.energy, validSongModel.energy);
  assert.equal(Object.hasOwn(fused.model.energy, "coordinates"), false);
  assert.ok(fused.model.dynamics === undefined || !Object.hasOwn(fused.model.dynamics, "coordinates"));
});

test("preserves observed bass evidence and its active-path metadata through fusion serialization", () => {
  const bass = [{ start: 0.25, end: 0.75, pitch: 38, confidence: 0.91, provider: "BASS" }];
  const candidate = {
    ...validSongModel,
    bass,
    confidenceByField: { bass: 0.91 },
    fieldStatus: {
      bass: {
        status: "detected",
        confidence: 0.91,
        providers: ["BASS"],
        message: null,
        edited: false,
      },
    },
    provenance: { bass: ["BASS"] },
    providerProvenance: [{
      capability: "bass_evidence",
      provider: "BASS",
      version: "1.0.0",
      status: "ready" as const,
    }],
  };
  const fused = fuseProviderSongModels([
    { provider: "BASS", output: candidate, confidence: 0.91 },
  ]);
  assert.equal(fused.accepted, true);
  if (!fused.accepted) return;
  const persisted = JSON.parse(JSON.stringify(fused.model));
  assert.deepEqual(persisted.bass.map(({ coordinates, ...note }: any) => note), bass);
  assert.equal(persisted.bass[0].coordinates.start.tick, 480);
  assert.equal(persisted.confidenceByField.bass, 0.91);
  assert.deepEqual(persisted.fieldStatus.bass.providers, ["BASS"]);
  assert.deepEqual(persisted.provenance.bass, ["BASS"]);
  assert.equal(persisted.providerProvenance[0].provider, "BASS");
  assert.equal(persisted.fusion.selectedProvider, "BASS");
  assert.equal(validateCanonicalSongModel(persisted).success, true);
  assert.deepEqual(
    refreshSongModelValidation(persisted).bass?.map(({ coordinates, ...note }: any) => note),
    bass,
  );
});

test("keeps absent bass evidence unavailable rather than inferring a fallback", () => {
  const candidate = {
    ...validSongModel,
    bass: [],
    confidenceByField: { bass: 0 },
    fieldStatus: {
      bass: {
        status: "not_available",
        confidence: null,
        providers: [],
        message: "No bass provider returned observed bass evidence.",
        edited: false,
      },
    },
    provenance: { bass: [] },
  };
  const fused = fuseProviderSongModels([
    { provider: "analysis", output: candidate, confidence: 0.9 },
  ]);
  assert.equal(fused.accepted, true);
  if (!fused.accepted) return;
  const persisted = JSON.parse(JSON.stringify(fused.model));
  assert.deepEqual(persisted.bass, []);
  assert.equal(persisted.fieldStatus.bass.status, "not_available");
  assert.equal(persisted.fieldStatus.bass.confidence, null);
  assert.deepEqual(persisted.fieldStatus.bass.providers, []);
  assert.deepEqual(persisted.provenance.bass, []);
});

test("flags tempo drift without silently discarding the candidate", () => {
  const result = validateSongModelCore(tempoDriftSongModel);
  assert.equal(result.success, true);
  assert.ok(issueCodes(result).includes("TEMPO_DRIFT"));
});

test("flags abrupt octave tracking jumps", () => {
  const result = validateSongModelCore(octaveJumpSongModel);
  assert.equal(result.success, true);
  assert.ok(issueCodes(result).includes("OCTAVE_JUMP"));
});

test("rejects micro-notes", () => {
  const result = validateSongModelCore(microNoteSongModel);
  assert.equal(result.success, false);
  assert.ok(issueCodes(result).includes("MICRO_NOTE"));
});

test("rejects provider output with missing sections", () => {
  const result = validateSongModelCore(missingSectionsSongModel);
  assert.equal(result.success, false);
  assert.ok(issueCodes(result).includes("MISSING_SECTIONS"));
});

test("revalidation removes a stale missing-sections issue after correction", () => {
  const fused = fuseProviderSongModels([
    { provider: "valid", output: validSongModel, confidence: 0.9 },
  ]);
  assert.equal(fused.accepted, true);
  if (!fused.accepted) return;
  const stale = {
    ...fused.model,
    validation: {
      status: "flagged" as const,
      issues: [{
        code: "MISSING_SECTIONS",
        severity: "error" as const,
        path: "sections",
        message: "At least one structural section is required before arranging.",
      }],
    },
  };
  const refreshed = refreshSongModelValidation(stale);
  assert.equal(refreshed.validation.status, "accepted");
  assert.equal(issueCodes(refreshed.validation).includes("MISSING_SECTIONS"), false);
});

test("v2 corrections rebuild coordinates after tempo, meter, and section edits", () => {
  const fused = fuseProviderSongModels([
    { provider: "valid", output: validSongModel, confidence: 0.9 },
  ]);
  assert.equal(fused.accepted, true);
  if (!fused.accepted) return;
  const corrected = refreshSongModelValidation({
    ...fused.model,
    tempoMap: [{ ...fused.model.tempoMap[0], bpm: 60 }],
    meterMap: [{ ...fused.model.meterMap[0], meter: "6/8" }],
    sections: [{ ...fused.model.sections[0], startBar: 1, endBar: 2 }],
  });
  const validation = validateCanonicalSongModel(corrected);
  assert.equal(validation.success, true);
  assert.equal(corrected.melody[0].coordinates?.end.tick, 480);
  assert.equal(corrected.sections[0].coordinates?.end.tick, 5760);
  assert.equal(corrected.sections[0].coordinates?.end.bar, 3);
});

test("rejects high-confidence chord and melody conflicts", () => {
  const result = validateSongModelCore(chordMelodyConflictSongModel);
  assert.equal(result.success, false);
  assert.ok(issueCodes(result).includes("CHORD_MELODY_CONFLICT"));
});

test("fusion rejects malformed candidates and selects the compatible consensus", () => {
  const outlier = {
    ...validSongModel,
    tempoMap: [{ time: 0, bpm: 168, confidence: 0.96 }],
  };
  const result = fuseProviderSongModels([
    { provider: "tempo-outlier", output: outlier, confidence: 0.96 },
    { provider: "consensus-a", output: validSongModel, confidence: 0.91 },
    {
      provider: "consensus-b",
      output: {
        ...validSongModel,
        tempoMap: [{ time: 0, bpm: 121, confidence: 0.89 }],
      },
      confidence: 0.89,
    },
    { provider: "micro-notes", output: microNoteSongModel, confidence: 0.98 },
  ]);
  assert.equal(result.accepted, true);
  if (!result.accepted) return;
  assert.equal(result.model.fusion.selectedProvider, "consensus-a");
  assert.equal(
    result.decisions.find((decision) => decision.provider === "micro-notes")?.status,
    "rejected",
  );
  assert.equal(
    result.decisions.find((decision) => decision.provider === "tempo-outlier")?.status,
    "flagged",
  );
});

test("arrangement eligibility blocks invalid and low-confidence Song Models", () => {
  const fused = fuseProviderSongModels([
    { provider: "valid", output: validSongModel, confidence: 0.9 },
  ]);
  assert.equal(fused.accepted, true);
  if (!fused.accepted) return;

  assert.equal(validateCanonicalSongModel(fused.model).success, true);
  assert.equal(evaluateArrangementEligibility(fused.model, "ready", 0.9).eligible, true);

  const invalid = {
    ...fused.model,
    sections: [],
  };
  const invalidEligibility = evaluateArrangementEligibility(invalid, "ready", 0.9);
  assert.equal(invalidEligibility.eligible, false);
  if (!invalidEligibility.eligible) {
    assert.equal(invalidEligibility.code, "INVALID_SONG_MODEL");
    assert.match(invalidEligibility.action, /Re-run analysis/i);
  }

  const lowConfidence = evaluateArrangementEligibility(fused.model, "ready", 0.3);
  assert.equal(lowConfidence.eligible, false);
  if (!lowConfidence.eligible) {
    assert.equal(lowConfidence.code, "LOW_SONG_MODEL_CONFIDENCE");
  }
});

test("canonical validation rejects malformed nested chord decision evidence", () => {
  const fused = fuseProviderSongModels([
    { provider: "valid", output: validSongModel, confidence: 0.9 },
  ]);
  assert.equal(fused.accepted, true);
  if (!fused.accepted) return;

  const invalidConflict = structuredClone(fused.model) as any;
  invalidConflict.chords[0].melodyConflictEvidence = [{}];
  const conflictResult = validateCanonicalSongModel(invalidConflict);
  assert.equal(conflictResult.success, false);
  assert.ok(issueCodes(conflictResult).includes("INVALID_MELODY_CONFLICT_EVIDENCE"));

  const invalidCandidate = structuredClone(fused.model) as any;
  invalidCandidate.chords[0].candidateProvenance = [{
    candidateId: "candidate-1",
    provider: "provider",
    score: "high",
  }];
  const candidateResult = validateCanonicalSongModel(invalidCandidate);
  assert.equal(candidateResult.success, false);
  assert.ok(issueCodes(candidateResult).includes("INVALID_CHORD_CANDIDATE_PROVENANCE"));

  for (const timing of [
    { startBeat: -1, durationBeats: 4 },
    { startBeat: 0 },
    { startSeconds: 0, endSeconds: -1 },
    { startSeconds: 1, endSeconds: 2 },
  ]) {
    const invalidTiming = structuredClone(fused.model) as any;
    invalidTiming.chords[0].timing = timing;
    const timingResult = validateCanonicalSongModel(invalidTiming);
    assert.equal(timingResult.success, false);
    assert.ok(issueCodes(timingResult).includes("INVALID_CANONICAL_CHORD_TIMING"));
  }

  const invalidBassSupport = structuredClone(fused.model) as any;
  invalidBassSupport.chords[0].bassSupportEvidence = [{
    start: 0,
    end: 1,
    pitch: 128,
    confidence: 1,
    provider: "",
  }];
  const bassSupportResult = validateCanonicalSongModel(invalidBassSupport);
  assert.equal(bassSupportResult.success, false);
  assert.ok(issueCodes(bassSupportResult).includes("INVALID_CHORD_BASS_SUPPORT"));
});

test("arrangement eligibility blocks flagged tempo drift and octave jumps", () => {
  for (const output of [tempoDriftSongModel, octaveJumpSongModel]) {
    const fused = fuseProviderSongModels([
      { provider: "flagged", output, confidence: 0.9 },
    ]);
    assert.equal(fused.accepted, true);
    if (!fused.accepted) continue;
    const eligibility = evaluateArrangementEligibility(
      fused.model,
      "ready",
      fused.model.fusion.confidence,
    );
    assert.equal(eligibility.eligible, false);
    if (!eligibility.eligible) {
      assert.equal(eligibility.code, "SONG_MODEL_FLAGGED");
    }
  }
});

test("arrangement eligibility uses compatibility-adjusted fusion confidence", () => {
  const incompatible = {
    ...validSongModel,
    tempoMap: [{ time: 0, bpm: 168, confidence: 0.96 }],
  };
  const fused = fuseProviderSongModels([
    { provider: "tempo-a", output: validSongModel, confidence: 0.96 },
    { provider: "tempo-b", output: incompatible, confidence: 0.95 },
  ]);
  assert.equal(fused.accepted, true);
  if (!fused.accepted) return;
  assert.ok(fused.model.fusion.confidence < 0.55);
  const eligibility = evaluateArrangementEligibility(fused.model, "ready", 0.96);
  assert.equal(eligibility.eligible, false);
});

test("legacy backfill never auto-heals an invalid current-contract Song Model", () => {
  assert.equal(isLegacySongModel(validSongModel), true);
  assert.equal(isLegacySongModel({ ...validSongModel, contractVersion: "1.0", sections: [] }), false);
  assert.equal(isLegacySongModel(null), false);
});