/**
 * Per-domain provider reliability — the single source of truth for how much a
 * given analysis provider's evidence is trusted in each musical domain.
 *
 * Before this module, reliability weights were scattered: a `tempo/meter/key`
 * table in `analysisReconciliation.ts` and a `transcriptionReliability` table
 * inside `fuseCanonicalNotes`. Those exact values are preserved here so the
 * reconciliation behaviour does not change; the registry just makes them one
 * auditable list and extends it to every domain the Arrangement Brain reads.
 *
 * A weight is a bounded competence estimate in [0, 1] — not a probability. A
 * domain absent from a profile means the provider is simply not a source for
 * it, and the unknown-provider fallback applies.
 */
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

export const ANALYSIS_DOMAINS: readonly AnalysisDomain[] = [
  "tempo",
  "downbeats",
  "meter",
  "key",
  "chords",
  "melody",
  "bass",
  "sections",
  "instruments",
] as const;

export type ProviderReliabilityProfile = {
  provider: string;
  /** Per-domain competence in [0, 1]. Absent domain => not a source for it. */
  domains: Partial<Record<AnalysisDomain, number>>;
  /** Short rationale, kept with the number so review is possible. */
  note?: string;
};

/** Applied to any (provider, domain) pair not in the registry. */
export const DEFAULT_UNKNOWN_RELIABILITY = 0.35;

/**
 * `STANDARD_MIDI` is authoritative for structural facts read straight out of a
 * MIDI source; GPU providers are ranked by observed competence in each domain;
 * `LOCAL_SIGNAL_ANALYZER_V1` is the always-available CPU baseline and is
 * deliberately low so it never outvotes a real provider on its own.
 */
export const PROVIDER_RELIABILITY: Record<string, ProviderReliabilityProfile> = {
  STANDARD_MIDI: {
    provider: "STANDARD_MIDI",
    note: "Facts read directly from a MIDI container.",
    domains: {
      tempo: 0.99, meter: 0.99, key: 0.99, downbeats: 0.99,
      sections: 0.8, chords: 0.7, melody: 0.9, bass: 0.85,
    },
  },
  BEAT_THIS: {
    provider: "BEAT_THIS",
    note: "Dedicated beat/downbeat tracker.",
    domains: { tempo: 0.82, downbeats: 0.88, meter: 0.62 },
  },
  MADMOM: {
    provider: "MADMOM",
    note: "2016 DBN beat/downbeat models.",
    domains: { tempo: 0.78, downbeats: 0.8, meter: 0.55 },
  },
  ALL_IN_ONE: {
    provider: "ALL_IN_ONE",
    note: "Joint structure/beat/downbeat analysis on Harmonix folds.",
    domains: {
      tempo: 0.84, downbeats: 0.82, meter: 0.84, sections: 0.86, key: 0.6,
    },
  },
  SONGFORMER: {
    provider: "SONGFORMER",
    note: "Structure segmentation.",
    domains: { sections: 0.82, downbeats: 0.6 },
  },
  ESSENTIA: {
    provider: "ESSENTIA",
    note: "Key/scale + tonal descriptors.",
    domains: { key: 0.82, chords: 0.55 },
  },
  CHROMA: {
    provider: "CHROMA",
    note: "HPCP + librosa chroma; key support.",
    domains: { key: 0.7, chords: 0.5 },
  },
  SHEETSAGE: {
    provider: "SHEETSAGE",
    note: "Lead-sheet melody + chords + timing.",
    domains: { melody: 0.92, chords: 0.7, downbeats: 0.55 },
  },
  BASIC_PITCH: {
    provider: "BASIC_PITCH",
    note: "Bounded CPU polyphonic transcription.",
    domains: { melody: 1, bass: 0.6 },
  },
  MT3: {
    provider: "MT3",
    note: "Multi-instrument transcription.",
    domains: { melody: 0.98, bass: 0.75 },
  },
  MR_MT3: {
    provider: "MR_MT3",
    domains: { melody: 0.98, bass: 0.75 },
  },
  YOUR_MT3: {
    provider: "YOUR_MT3",
    domains: { melody: 0.98, bass: 0.75 },
  },
  DEMUCS: {
    provider: "DEMUCS",
    note: "4-stem separation; instrument presence.",
    domains: { instruments: 0.85, bass: 0.7 },
  },
  BS_ROFORMER: {
    provider: "BS_ROFORMER",
    note: "Vocal/instrumental separation.",
    domains: { instruments: 0.82 },
  },
  BASS: {
    provider: "BASS",
    note: "Verified bass-stem transcription.",
    domains: { bass: 0.9 },
  },
  LOCAL_SIGNAL_ANALYZER_V1: {
    provider: "LOCAL_SIGNAL_ANALYZER_V1",
    note: "Always-available CPU baseline (FFmpeg + local extraction).",
    domains: {
      tempo: 0.48, key: 0.45, meter: 0.4, downbeats: 0.4,
      sections: 0.4, chords: 0.35, melody: 0.35, bass: 0.35,
      instruments: 0.4,
    },
  },
};

/** Reliability of `provider` in `domain`, falling back for unknown pairs. */
export function reliabilityFor(provider: string, domain: AnalysisDomain): number {
  const value = PROVIDER_RELIABILITY[provider]?.domains[domain];
  return typeof value === "number" ? value : DEFAULT_UNKNOWN_RELIABILITY;
}

/** Every known (provider, weight) for a domain, strongest first. */
export function domainReliabilityProfile(
  domain: AnalysisDomain,
): Array<{ provider: string; reliability: number; note?: string }> {
  return Object.values(PROVIDER_RELIABILITY)
    .filter((profile) => typeof profile.domains[domain] === "number")
    .map((profile) => ({
      provider: profile.provider,
      reliability: profile.domains[domain] as number,
      note: profile.note,
    }))
    .sort(
      (a, b) => b.reliability - a.reliability || a.provider.localeCompare(b.provider),
    );
}
