# PR-01 — Canonical Song Model V2 (design)

Goal: turn the Song Model into the **complete musical map** the Arrangement
Brain reads — without breaking a single existing consumer.

## Constraints

1. **Additive.** `contractVersion` stays `"2.0"`. Every field added in this PR is
   optional. The 30 tests in `songModelValidation.test.ts` and the
   `canonicalTimeline` tests stay green untouched.
2. **Never fabricate.** Every new group is status-tagged
   (`detected | low_confidence | not_available | conflicting`) exactly like the
   existing `vocalIntelligence` groups. No inputs → `not_available` with a
   reason, empty payload. This matches the repo's existing discipline.
3. **Canonical coordinates.** Every timed event carries a `CanonicalTimeRange` /
   `CanonicalTimeCoordinate` reconstructed and checked against `tempoMap` +
   `meterMap` by `validateV2Coordinates`, same as today.
4. **Derived, deterministic, provenanced.** Layers in this PR are computed from
   evidence already in the model (beats, chords, melody, sections, energy,
   dynamics, vocalIntelligence). Each group records `derivedFrom: string[]` and a
   `method` id so regeneration is reproducible and auditable.
5. **Versioned & immutable.** Persisted via the existing `songModelsTable`
   version chain; a new analysis writes a new version, never mutates a prior one.

## What already exists (reused, not rebuilt)

| V2-plan node | Existing home |
|---|---|
| timeline (ppq/tempo/meter/bars/beats) | `SongModelCore.tempoMap/meterMap`, `SongModelData.beats/bars`, `timebase` |
| tonality.globalKey/keyMap | `SongModelCore.keyMap`, `keyEvidence` |
| harmony.chords | `SongModelCore.chords` (`ChordHarmonyEvent` w/ root/quality/function/inversion) |
| melody.leadMelody | `SongModelCore.melody` |
| vocals.phrases/breaths/space | `SongModelData.vocalIntelligence` (v1.0) |
| structure.sections | `SongModelCore.sections` (`AnalysisSection` w/ energy) |
| rhythm evidence | `SongModelData.rhythmEvidence`, `timingEvidence` |
| energy.energyCurve | `SongModelCore.energy[]`, `SongModelData.dynamics[]` |
| existingInstrumentation | `SongModelData.stems`, `sourceStems` |
| styleFingerprint | **new** |
| analysisEvidence / confidence / provenance | `providerProvenance`, `fusion`, `confidenceByField`, `*Evidence[]` |

## New shape

One optional top-level object on `SongModelData`:

```ts
musicalMap?: {
  version: "2.1";
  derivedAt: string;                 // ISO; regeneration marker
  inputsDigestSha256: string;        // hash of the evidence this was derived from

  harmony: {                         // status-group
    status: MapStatus; reason: string | null;
    harmonicRhythm: Array<{ startBar: number; endBar: number; chordsPerBar: number; coordinates?: CanonicalTimeRange }>;
    cadences: Array<{ id: string; kind: "authentic"|"plagal"|"half"|"deceptive"|"none"; atBar: number; strength: number; chordIndexes: number[]; coordinates?: CanonicalTimeCoordinate }>;
    tensionMap: Array<{ start: number; end: number; tension: number; coordinates?: CanonicalTimeRange }>;  // 0..1
    derivedFrom: string[]; method: string;
  };

  melody: {                          // status-group; derived from SongModelCore.melody
    status: MapStatus; reason: string | null;
    phrases: Array<{ id: string; start: number; end: number; noteIndexes: number[]; contour: "rising"|"falling"|"arch"|"valley"|"flat"|"mixed"; peakNoteIndex: number|null; density: number; range: { lowPitch: number; highPitch: number }; coordinates?: CanonicalTimeRange }>;
    motifs: Array<{ id: string; label: string; intervalSignature: number[]; rhythmSignature: number[]; occurrences: Array<{ phraseId: string; noteIndexes: number[]; transposition: number; variation: "exact"|"transposed"|"rhythmic"|"developed" }> }>;
    melodicDensity: Array<{ startBar: number; endBar: number; notesPerBar: number }>;
    range: { lowPitch: number; highPitch: number } | null;
    contour: Array<{ time: number; pitch: number }>;   // reduced lead contour
    derivedFrom: string[]; method: string;
  };

  rhythm: {                          // status-group; derived from beats + melody + rhythmEvidence
    status: MapStatus; reason: string | null;
    grooveProfile: { subdivision: "straight-8"|"straight-16"|"swing-8"|"swing-16"|"triplet"|"mixed"; swingRatio: number|null; pushPullMs: number|null };
    syncopation: Array<{ startBar: number; endBar: number; syncopation: number }>;   // 0..1
    subdivisions: Array<{ startBar: number; endBar: number; dominant: "quarter"|"eighth"|"sixteenth"|"triplet" }>;
    rhythmicDensity: Array<{ startBar: number; endBar: number; onsetsPerBar: number }>;
    derivedFrom: string[]; method: string;
  };

  energy: {                          // status-group; derived from energy[] + dynamics[] + sections
    status: MapStatus; reason: string | null;
    energyCurve: Array<{ startBar: number; endBar: number; energy: number }>;   // section-aligned 0..1
    dynamicCurve: Array<{ startBar: number; endBar: number; dynamic: number }>;
    spectralDensity: Array<{ startBar: number; endBar: number; density: number }> ;  // status not_available until a provider supplies spectra
    derivedFrom: string[]; method: string;
  };

  structure: {                       // status-group; derived from sections + energy + vocalIntelligence
    status: MapStatus; reason: string | null;
    subphrases: Array<{ id: string; sectionName: string; startBar: number; endBar: number; role: "opening"|"development"|"response"|"cadence"|"pickup"|"fill" }>;
    transitions: Array<{ id: string; fromSection: string; toSection: string; atBar: number; energyDelta: number; kind: "build"|"drop"|"continue"|"break" }>;
    climaxCandidates: Array<{ id: string; atBar: number; score: number; evidence: string[] }>;
    derivedFrom: string[]; method: string;
  };

  styleFingerprint: {                // abstract descriptors only — never content
    status: MapStatus; reason: string | null;
    tempoBand: "ballad"|"midtempo"|"uptempo"|"double-time"|null;
    meterFamily: string | null;                 // e.g. "4/4", "compound"
    harmonicComplexity: number | null;          // 0..1 from chord vocabulary/extensions
    rhythmicComplexity: number | null;          // 0..1 from syncopation/subdivision spread
    sectionContrast: number | null;             // 0..1 from energy variance across sections
    instrumentPaletteHints: string[];           // roles present in stems, abstract
    orchestrationSize: "sparse"|"medium"|"dense"|null;
    derivedFrom: string[]; method: string;
  };
};

type MapStatus = "detected" | "low_confidence" | "not_available" | "conflicting";
```

## Implementation plan

1. **`lib/db/src/schema/music-studio.ts`** — add the optional `musicalMap` type
   to `SongModelData`. No column change (already `jsonb`).
2. **`artifacts/api-server/src/lib/songMusicalMap.ts`** (new) —
   `deriveMusicalMap(model: SongModelData): SongModelData["musicalMap"]`.
   Pure, deterministic, each sub-derivation independently degradable to
   `not_available`. Unit-tested in isolation with hand-built models.
3. **`songModelValidation.ts`** —
   - `validateMusicalMap(input, issues)` invoked from `validateCanonicalSongModel`
     only when `input.musicalMap !== undefined` (v1 + bare v2 unaffected).
   - `canonicalizeSongModelCoordinates` extended to recompute `musicalMap`
     coordinates from the timeline (same pattern as `vocalIntelligence`).
   - `refreshSongModelValidation` re-derives the map when stale
     (`inputsDigestSha256` mismatch).
4. **Fusion** — after `fuseProviderSongModels` selects the model, attach
   `musicalMap = deriveMusicalMap(model)` before `canonicalizeSongModelCoordinates`.
5. **OpenAPI** — add `SongModelMusicalMap` schema + `musicalMap?` on the
   `SongModel` response; regenerate `api-zod` / `api-client-react` via orval.
6. **Studio** — `song-model-inspector.tsx` gains a read-only "Musical map" panel
   (harmonic rhythm, tension, phrases/motifs, climax candidates). Non-blocking.
7. **Tests** — new `songMusicalMap.test.ts`; extend `songModelValidation.test.ts`
   with musicalMap accept/reject + canonical-coordinate cases. Existing tests
   unchanged.

## Regression guard

```
# from artifacts/api-server
pnpm exec esbuild src/lib/songModelValidation.test.ts --bundle --platform=node --format=esm --outfile=<tmp> && node --test <tmp>
pnpm exec esbuild src/lib/canonicalTimeline.test.ts   --bundle --platform=node --format=esm --outfile=<tmp> && node --test <tmp>
pnpm exec esbuild src/lib/songMusicalMap.test.ts       --bundle --platform=node --format=esm --outfile=<tmp> && node --test <tmp>
```

(The repo's `run-focused-api-tests.mjs` spawns a bare `esbuild` binary and fails
on Windows; the direct-bundle form above is the local equivalent and is what CI
runs under the hood.)

## Downstream (not this PR)

`analysisReconciliation-v2` (PR-02) consumes `musicalMap.*.derivedFrom` +
per-domain `ProviderReliabilityProfile`. The Global Arrangement Planner (PR-04)
reads `energy.energyCurve`, `structure.climaxCandidates`,
`styleFingerprint`, `harmony.tensionMap`.
