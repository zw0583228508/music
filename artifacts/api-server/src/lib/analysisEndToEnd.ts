/**
 * The Analysis Engine end to end on real songs (Analysis Engine wave, Stream J
 * — PR-90).
 *
 * The wave built its parts in separate streams: Basic Pitch (live), the rhythm
 * trackers (PR-84), the harmony worker (PR-85), the disagreement engine and the
 * trust report (PR-89). This module is the one place where all of it is read
 * for one song at a time and summed over a corpus, so the closing question of
 * the wave — *what still prevents the engine from being trusted automatically
 * by the Arrangement Brain* — can be answered with counts rather than
 * impressions.
 *
 * Two paths are reported per song and never merged:
 *
 *   platform   what `POST /projects/:id/sources` produced today — the Song
 *              Model's `fieldStatus`, `reconciliation` and `trustReport`
 *              (Basic Pitch on Modal + the local analysers + PR-86/89
 *              reconciliation). This is what a producer gets.
 *   engine     every witness the wave has — the four rhythm trackers, the two
 *              BTC chord vocabularies, the worker's chroma key and the
 *              platform's own observations — judged by the *same*
 *              disagreement engine (`judgeDomain`, `judgeChordBars`,
 *              `judgeSections`, `reconcileRhythm`) and folded into the same
 *              trust report. Nothing is tuned; the thresholds and reliability
 *              weights are the shipped ones. This is what the engine would
 *              say if the workers were wired into `sourceAnalyzer`.
 *
 * Truth is read from `ANALYSIS_GOLD_V1` manifests only (PR-81): a domain is
 * scored on a song only where its coverage is HUMAN_VERIFIED, one tier at a
 * time, and a request that spans tiers throws. Everywhere else the numbers are
 * agreement, contest rate, coverage, latency and cost — not accuracy — and
 * the aggregate says which.
 *
 * Pure: no I/O. `scripts/run-analysis-end-to-end.mjs` does the reading.
 */
import type {
  DomainReconciliationReport,
  SongModelField,
  SongModelFieldCandidate,
  SongModelFieldStatus,
} from "@workspace/db";
import {
  type CandidateRelation,
  type DomainCandidate,
  type DomainObservation,
  type DomainVerdict,
  type VerdictStatus,
  fieldCandidatesOf,
  fieldStatusOf,
  judgeChordBars,
  judgeDomain,
  judgeSections,
  normalizeKeyLabel,
  parseChordLabel,
  whatWouldSettleIt,
} from "./analysisDisagreement";
import {
  type CoverageKind,
  type GoldDomain,
  type GoldManifest,
  type GoldTier,
  type PredictionFile,
  type SectionTruth,
  type TierScore,
  GOLD_DOMAINS,
  scoreSections,
  scoreTier,
} from "./analysisGold";
import { type AnalysisTrustReport, type TrustField, type TrustVerdict, TRUST_FIELDS, analysisTrustReport } from "./analysisTrust";
import { estimateWindowKey } from "./harmonyEngine";
import type { AnalysisDomain } from "./providerReliability";
import { reliabilityFor } from "./providerReliability";
import {
  type ProviderRhythmObservation,
  type ReconciledRhythm,
  reconcileRhythm,
  tempoOnlyObservation,
} from "./rhythmEngine";

// ---------------------------------------------------------------------------
// Vocabulary
// ---------------------------------------------------------------------------

export const END_TO_END_VERSION = "analysis-end-to-end-1.0" as const;

/** The tiers a real recording can belong to. Synthetic renders are not songs. */
export const END_TO_END_TIERS = ["REAL_AUDIO", "PROFESSIONAL_REAL_WORLD"] as const satisfies readonly GoldTier[];
export type EndToEndTier = (typeof END_TO_END_TIERS)[number];

/** The domains the owner's brief asks about, in report order. */
export const END_TO_END_DOMAINS = [
  "tempo", "meter", "beats", "downbeats", "key", "chords", "melody", "bass", "sections", "separation", "loudness",
] as const;
export type EndToEndDomain = (typeof END_TO_END_DOMAINS)[number];

export const END_TO_END_PATHS = ["platform", "engine"] as const;
export type EndToEndPath = (typeof END_TO_END_PATHS)[number];

export type EndToEndStatus = VerdictStatus;
export const END_TO_END_STATUSES: readonly EndToEndStatus[] = ["detected", "low_confidence", "contested", "unknown"];

export type EndToEndCandidate = { value: string; providers: string[]; relationToLeader?: string };

export type EndToEndDomainResult = {
  status: EndToEndStatus;
  value: string | number | null;
  confidence: number | null;
  providers: string[];
  candidates: EndToEndCandidate[];
  relation: string | null;
  /** Who or what answered, or why nothing did. One line, for the per-song table. */
  note: string | null;
};

export type EndToEndTrust = {
  verdict: TrustVerdict;
  fieldsToConfirm: TrustField[];
  reasons: string[];
};

export type EndToEndPathResult = {
  domains: Record<EndToEndDomain, EndToEndDomainResult>;
  trust: EndToEndTrust;
};

export type EndToEndLatency = {
  /** The API's own analysis wall time (decode + Basic Pitch on Modal + local analysers + reconciliation). */
  platformAnalysisMs: number | null;
  rhythmWorkerMs: number | null;
  harmonyWorkerMs: number | null;
  /** Everything in parallel: the slowest stage. */
  engineParallelMs: number | null;
  /** Everything one after the other. */
  engineSerialMs: number | null;
};

export type EndToEndSpend = {
  /** Container-seconds per worker, and the list-price estimate they imply. */
  containerSeconds: Record<string, number>;
  usd: number;
};

export type EndToEndSongRow = {
  id: string;
  tier: EndToEndTier;
  dataset: string;
  genreFamily: string;
  title: string;
  sha256: string;
  bytes: number;
  durationSeconds: number;
  licence: string;
  /** From the manifest: which domains carry human-verified truth for this song. */
  truthCoverage: Partial<Record<GoldDomain, CoverageKind>>;
  paths: Record<EndToEndPath, EndToEndPathResult>;
  latency: EndToEndLatency;
  spend: EndToEndSpend;
  /** Stages that failed or were skipped, verbatim. */
  failures: string[];
  /** What the engine path saw: the witnesses per domain and PR-84's own rhythm verdicts beside PR-89's judge. */
  engineTrace: EngineTrace;
};

// ---------------------------------------------------------------------------
// Inputs — what the runner reads for one song
// ---------------------------------------------------------------------------

/** The slice of a stored Song Model the engine path needs. */
export type PlatformSlice = {
  fieldStatus: Partial<Record<SongModelField, SongModelFieldStatus>> | null;
  reconciliation: DomainReconciliationReport | null;
  trustReport: AnalysisTrustReport | null;
  tempoMap: Array<{ time: number; bpm: number; confidence: number }>;
  meterMap: Array<{ bar: number; meter: string; confidence: number }>;
  keyMap: Array<{ time: number; key: string; confidence: number }>;
  sections: Array<{ name: string; startBar: number; endBar: number }>;
  bars: Array<{ bar: number; start: number; end: number }>;
  melodyCount: number;
  bassCount: number;
  chordCount: number;
  loudness: { provider: string; integratedLUFS: number } | null;
  providerProvenance: Array<{ capability: string; provider: string; status: string; errorCode?: string }>;
  analysisStartSeconds: number;
  analysisDurationSeconds: number;
  validationStatus: "accepted" | "flagged" | null;
  validationIssues: string[];
};

export type RhythmWorkerProvider = {
  provider: string;
  available: boolean;
  reason?: string;
  beats: number[];
  downbeats: number[] | null;
  tempoBpm: number | null;
  meter: string | null;
  runtimeSeconds?: number;
};

export type RhythmWorkerSlice = {
  durationSeconds: number;
  providers: RhythmWorkerProvider[];
  onsetEnvelope?: { frameRateHz: number; strengths: number[]; startSeconds?: number } | null;
};

export type HarmonyChordSpan = { start: number; end: number; symbol: string };

export type HarmonyWorkerSlice = {
  durationSeconds: number;
  BTC_MAJMIN?: HarmonyChordSpan[];
  BTC_LARGE_VOCA?: HarmonyChordSpan[];
  KEY_KRUMHANSL?: { key: string; scale: string; confidence: number } | null;
  BEATS?: { beats: number[]; tempoBpm?: number | null } | null;
  timings?: Record<string, number>;
  errors?: Record<string, string>;
};

export type EndToEndSongInput = {
  id: string;
  tier: EndToEndTier;
  dataset: string;
  genreFamily: string;
  title: string;
  sha256: string;
  bytes: number;
  durationSeconds: number;
  licence: string;
  truthCoverage: Partial<Record<GoldDomain, CoverageKind>>;
  platform: PlatformSlice | null;
  rhythm: RhythmWorkerSlice | null;
  harmony: HarmonyWorkerSlice | null;
  latency: { platformAnalysisMs: number | null; rhythmWorkerMs: number | null; harmonyWorkerMs: number | null };
  failures?: string[];
};

// ---------------------------------------------------------------------------
// Spend model — Modal list prices, stated so the estimate can be re-derived
// ---------------------------------------------------------------------------

/** Modal list prices (USD) per core-second and per GiB-second; the dashboard is the metered figure. */
export const MODAL_LIST_PRICES = {
  cpuCoreSecond: 0.192 / 3600,
  memoryGibSecond: 0.024 / 3600,
} as const;

/** The containers each worker declares (cpu cores, memory GiB). */
export const WORKER_SHAPES: Record<string, { cores: number; gib: number }> = {
  BASIC_PITCH: { cores: 4, gib: 8 },
  RHYTHM_TOURNAMENT: { cores: 4, gib: 8 },
  HARMONY_ACR: { cores: 4, gib: 8 },
};

export function estimateSpend(containerSeconds: Record<string, number>): number {
  let usd = 0;
  for (const [worker, seconds] of Object.entries(containerSeconds)) {
    const shape = WORKER_SHAPES[worker] ?? { cores: 4, gib: 8 };
    usd += seconds * (shape.cores * MODAL_LIST_PRICES.cpuCoreSecond + shape.gib * MODAL_LIST_PRICES.memoryGibSecond);
  }
  return Number(usd.toFixed(4));
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const round = (value: number, places = 3): number => Number(value.toFixed(places));

function median(values: readonly number[]): number | null {
  const sorted = values.filter((v) => Number.isFinite(v)).sort((a, b) => a - b);
  if (!sorted.length) return null;
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[mid]! : (sorted[mid - 1]! + sorted[mid]!) / 2;
}

const verdictStatusOfField = (status: SongModelFieldStatus["status"] | undefined): EndToEndStatus =>
  status === "detected" ? "detected"
    : status === "low_confidence" ? "low_confidence"
      : status === "contested" ? "contested"
        : "unknown";

function fromVerdict<T extends string | number>(verdict: DomainVerdict<T>, note: string | null = null): EndToEndDomainResult {
  return {
    status: verdict.status,
    value: verdict.value,
    confidence: verdict.confidence,
    providers: verdict.providers,
    candidates: verdict.status === "contested" ? fieldCandidatesOf(verdict.candidates) : [],
    // Two tempo clusters can sit inside the 3 BPM clustering tolerance yet
    // outside the 3 % "same" band of the relation: that is a near tempo, not
    // an unspecified relation.
    relation: verdict.status !== "contested" ? null
      : verdict.relation === "same" ? (verdict.domain === "tempo" ? "near_tempo" : null)
        : verdict.relation,
    note: note ?? verdict.message,
  };
}

function unknownResult(note: string): EndToEndDomainResult {
  return { status: "unknown", value: null, confidence: null, providers: [], candidates: [], relation: null, note };
}

function fromFieldStatus(status: SongModelFieldStatus | undefined, value: string | number | null, note?: string | null): EndToEndDomainResult {
  if (!status) return unknownResult("no field status recorded");
  const verdict = verdictStatusOfField(status.status);
  return {
    status: verdict,
    value: verdict === "contested" ? null : value,
    confidence: status.confidence ?? null,
    providers: status.providers ?? [],
    candidates: verdict === "contested" ? (status.candidates ?? []).map((c: SongModelFieldCandidate) => ({
      value: c.value, providers: c.providers, ...(c.relationToLeader ? { relationToLeader: c.relationToLeader } : {}),
    })) : [],
    relation: verdict === "contested" ? status.relation ?? null : null,
    note: note ?? status.message ?? null,
  };
}

/**
 * The platform's own observations, read back from the stored reconciliation.
 * Exact for a contested field (every candidate carries its own score) and for
 * a single-source field (score = confidence × reliability); for a corroborated
 * field each provider is given the stored confidence, an approximation the
 * evidence file names. Nothing is invented for a domain the platform did not
 * reconcile.
 */
export function platformObservations(
  reconciliation: DomainReconciliationReport | null,
  domain: AnalysisDomain,
): Array<DomainObservation<string | number>> {
  const stored = reconciliation?.domains?.[domain];
  if (!stored) return [];
  const out: Array<DomainObservation<string | number>> = [];
  const confidenceOf = (provider: string, score: number, share = 1) => {
    const reliability = reliabilityFor(provider, domain);
    return reliability > 0 ? Math.min(1, round((score * share) / reliability)) : 0;
  };
  if (stored.status === "contested" && stored.candidates?.length) {
    for (const candidate of stored.candidates) {
      const share = 1 / Math.max(1, candidate.providers.length);
      for (const provider of candidate.providers) {
        out.push({ provider, value: candidate.value, confidence: confidenceOf(provider, candidate.score, share) });
      }
    }
    return out;
  }
  if (stored.value === null || stored.value === undefined || !stored.providers?.length) return [];
  for (const provider of stored.providers) {
    out.push({ provider, value: stored.value, confidence: confidenceOf(provider, stored.confidence ?? 0) });
  }
  return out;
}

/** BTC's `G:min7` / `Bb:maj` / `N` reduced to the triad label the contest is about. */
export function triadLabel(symbol: string): string | null {
  const trimmed = symbol.trim();
  if (!trimmed || trimmed === "N" || trimmed === "X") return null;
  const flat = trimmed.replace(":", "");
  const parsed = parseChordLabel(flat);
  if (!parsed) return null;
  const match = /^([A-Ga-g][#♯b♭]?)(.*)$/.exec(flat)!;
  const root = match[1].replace("♯", "#").replace("♭", "b");
  const suffix = match[2].replace(/\/.*$/, "");
  if (parsed.quality === "maj") return root;
  if (parsed.quality === "min") return `${root}m`;
  if (/^(dim|hdim|°|o)/i.test(suffix)) return `${root}dim`;
  if (/^aug|\+/.test(suffix)) return `${root}aug`;
  if (/^sus/i.test(suffix)) return `${root}sus`;
  return `${root}${suffix}`;
}

/** Bar spans from downbeat times (the last bar closes at `end`). */
export function barsFromDownbeats(downbeats: readonly number[], end: number): Array<{ bar: number; start: number; end: number }> {
  const sorted = [...downbeats].filter((t) => Number.isFinite(t) && t >= 0 && t < end).sort((a, b) => a - b);
  return sorted.map((start, index) => ({ bar: index + 1, start, end: index + 1 < sorted.length ? sorted[index + 1]! : end }))
    .filter((bar) => bar.end - bar.start > 0.2);
}

/** The chord a provider names for a bar: its longest-sounding triad label, with the share of the bar it covers. */
export function dominantChordInBar(
  spans: readonly HarmonyChordSpan[],
  bar: { start: number; end: number },
): { label: string; share: number } | null {
  const seconds = new Map<string, number>();
  for (const span of spans) {
    const overlap = Math.min(span.end, bar.end) - Math.max(span.start, bar.start);
    if (overlap <= 0) continue;
    const label = triadLabel(span.symbol);
    if (!label) continue;
    seconds.set(label, (seconds.get(label) ?? 0) + overlap);
  }
  if (!seconds.size) return null;
  const [label, covered] = [...seconds.entries()].sort((a, b) => b[1] - a[1])[0]!;
  const length = bar.end - bar.start;
  return length > 0 ? { label, share: round(covered / length) } : null;
}

/** Duration-weighted pitch-class profile implied by a chord sequence (PR-85's chord-derived key witness). */
export function chordProfile(spans: readonly HarmonyChordSpan[]): number[] {
  const weights = new Array<number>(12).fill(0);
  const names: Record<string, number> = { C: 0, D: 2, E: 4, F: 5, G: 7, A: 9, B: 11 };
  for (const span of spans) {
    const label = triadLabel(span.symbol);
    if (!label) continue;
    const match = /^([A-G])([#b]?)(m|dim|aug|sus)?/.exec(label);
    if (!match) continue;
    const root = (names[match[1]]! + (match[2] === "#" ? 1 : match[2] === "b" ? -1 : 0) + 12) % 12;
    const third = match[3] === "m" || match[3] === "dim" ? 3 : match[3] === "sus" ? 5 : 4;
    const fifth = match[3] === "dim" ? 6 : match[3] === "aug" ? 8 : 7;
    const length = Math.max(0, span.end - span.start);
    weights[root] += length * 1.5;
    weights[(root + third) % 12] += length;
    weights[(root + fifth) % 12] += length;
  }
  return weights;
}

// ---------------------------------------------------------------------------
// The platform path — read, not recomputed
// ---------------------------------------------------------------------------

export function platformPath(input: EndToEndSongInput): EndToEndPathResult {
  const model = input.platform;
  const empty = (): Record<EndToEndDomain, EndToEndDomainResult> =>
    Object.fromEntries(END_TO_END_DOMAINS.map((d) => [d, unknownResult("the platform produced no Song Model")])) as Record<EndToEndDomain, EndToEndDomainResult>;
  if (!model) {
    return { domains: empty(), trust: { verdict: "not_usable", fieldsToConfirm: [], reasons: ["no Song Model: the analysis failed or never ran"] } };
  }
  const fs = model.fieldStatus ?? {};
  const provenance = (capability: string) => model.providerProvenance.filter((p) => p.capability === capability);
  const separationRuns = provenance("separation");
  const loudnessRuns = provenance("loudness");
  const tempo = fromFieldStatus(fs.tempo, model.tempoMap[0]?.bpm ?? null);
  const meter = fromFieldStatus(fs.meter, model.meterMap[0]?.meter ?? null);
  const domains: Record<EndToEndDomain, EndToEndDomainResult> = {
    tempo,
    meter,
    // The platform's beats and bars are a grid laid from time zero at the
    // estimated tempo and the assumed metre: they inherit those statuses.
    beats: { ...tempo, value: null, candidates: [], relation: null, note: "a grid from time 0 at the estimated tempo; no beat tracker ran" },
    downbeats: { ...meter, value: null, candidates: [], relation: null, note: "bar lines counted on the assumed metre; no downbeat tracker ran" },
    key: fromFieldStatus(fs.key, model.keyMap[0]?.key ?? null),
    chords: fromFieldStatus(fs.harmony, model.chordCount ? `${model.chordCount} chord events` : null),
    melody: fromFieldStatus(fs.melody, model.melodyCount ? `${model.melodyCount} notes` : null),
    bass: fromFieldStatus(fs.bass, model.bassCount ? `${model.bassCount} notes` : null),
    sections: fromFieldStatus(fs.sections, model.sections.length ? `${model.sections.length} sections` : null),
    separation: unknownResult(separationRuns.length
      ? `no stems: ${separationRuns.map((p) => `${p.provider} ${p.status}${p.errorCode ? ` (${p.errorCode})` : ""}`).join(", ")}`
      : "no separation provider was scheduled"),
    loudness: model.loudness
      ? { status: "detected", value: model.loudness.integratedLUFS, confidence: 1, providers: [model.loudness.provider], candidates: [], relation: null, note: "integrated LUFS" }
      : unknownResult(loudnessRuns.length
        ? `no loudness: ${loudnessRuns.map((p) => `${p.provider} ${p.status}${p.errorCode ? ` (${p.errorCode})` : ""}`).join(", ")}`
        : "no loudness provider was scheduled"),
  };
  const trust = model.trustReport ?? analysisTrustReport({ fieldStatus: fs, reconciliation: model.reconciliation });
  return { domains, trust: { verdict: trust.verdict, fieldsToConfirm: trust.fieldsToConfirm, reasons: trust.reasons } };
}

// ---------------------------------------------------------------------------
// The engine path — every witness through the shipped judge
// ---------------------------------------------------------------------------

/** Labels the harmony worker's arms wear in `providerReliability.ts` (as PR-85 mapped them). */
export const HARMONY_ARM_LABELS = {
  BTC_MAJMIN: { provider: "CHROMA", confidence: 0.85 },
  BTC_LARGE_VOCA: { provider: "SHEETSAGE", confidence: 0.9 },
  KEY_KRUMHANSL: { provider: "CHROMA" },
  /** Not in the reliability table: it takes the default weight, and the evidence says so. */
  BTC_CHORD_KEY: { provider: "BTC_CHORD_KEY" },
} as const;

export type EngineTrace = {
  tempoObservations: Array<DomainObservation<number>>;
  meterObservations: Array<DomainObservation<string>>;
  keyObservations: Array<DomainObservation<string>>;
  chordBars: number;
  chordBarsEvidenced: number;
  barGridSource: string | null;
  rhythm: Pick<ReconciledRhythm, "contestedFields" | "selectedProvider" | "usedAudioEvidence"> & {
    tempo: { status: string; value: number | null; providers: string[]; candidates?: Array<{ value: number; providers: string[] }> };
    beatGrid: { status: string; providers: string[]; rationale: string };
    downbeats: { status: string; providers: string[]; rationale: string };
    meter: { status: string; value: string | null; providers: string[] };
    disagreements: Array<{ family: string; providers: string[]; resolved: boolean }>;
  } | null;
};

export function enginePath(input: EndToEndSongInput): { result: EndToEndPathResult; trace: EngineTrace } {
  const model = input.platform;
  const fs = model?.fieldStatus ?? {};
  const rhythmProviders = (input.rhythm?.providers ?? []).filter((p) => p.available && p.beats.length >= 2);

  // --- rhythm: the PR-84 engine over the trackers, plus the platform's tempo-only reading
  const rhythmObservations: ProviderRhythmObservation[] = rhythmProviders.map((p) => ({
    provider: p.provider, beats: p.beats, downbeats: p.downbeats?.length ? p.downbeats : null, tempoBpm: p.tempoBpm, meter: p.meter,
  }));
  const localTempo = platformObservations(model?.reconciliation ?? null, "tempo")
    .find((o) => o.provider === "LOCAL_SIGNAL_ANALYZER_V1" && typeof o.value === "number");
  if (localTempo) rhythmObservations.push(tempoOnlyObservation(localTempo.provider, localTempo.value as number, localTempo.confidence));
  const rhythm = rhythmObservations.length
    ? reconcileRhythm({ observations: rhythmObservations, onsetEnvelope: input.rhythm?.onsetEnvelope ?? null, durationSeconds: input.rhythm?.durationSeconds ?? input.durationSeconds })
    : null;

  // --- tempo and metre through the four-way judge
  const tempoObservations: Array<DomainObservation<number>> = rhythmProviders
    .filter((p) => typeof p.tempoBpm === "number" && p.tempoBpm! > 0)
    .map((p) => ({ provider: p.provider, value: round(p.tempoBpm!, 2) }));
  if (localTempo) tempoObservations.push({ provider: localTempo.provider, value: localTempo.value as number, confidence: localTempo.confidence });
  const tempoVerdict = judgeDomain("tempo", tempoObservations);

  const meterObservations: Array<DomainObservation<string>> = rhythmProviders
    .filter((p) => typeof p.meter === "string" && /^\d+\/\d+$/.test(p.meter))
    .map((p) => ({ provider: p.provider, value: p.meter! }));
  const assumedMeter = fs.meter?.providers?.includes("LOCAL_SIGNAL_ANALYZER_V1") && model?.meterMap[0]
    ? { provider: "LOCAL_SIGNAL_ANALYZER_V1", value: model.meterMap[0].meter, confidence: model.meterMap[0].confidence }
    : null;
  if (assumedMeter) meterObservations.push(assumedMeter);
  const meterVerdict = judgeDomain("meter", meterObservations);

  // --- key: the platform's two readings plus the worker's chroma key and the key its chords imply
  const keyObservations: Array<DomainObservation<string>> = platformObservations(model?.reconciliation ?? null, "key")
    .filter((o): o is DomainObservation<string> => typeof o.value === "string");
  const chromaKey = input.harmony?.KEY_KRUMHANSL;
  if (chromaKey?.key && chromaKey.scale) {
    const label = normalizeKeyLabel(`${chromaKey.key} ${chromaKey.scale}`);
    if (label) keyObservations.push({ provider: HARMONY_ARM_LABELS.KEY_KRUMHANSL.provider, value: label, confidence: chromaKey.confidence });
  }
  const largeVoca = input.harmony?.BTC_LARGE_VOCA ?? [];
  const chordKey = largeVoca.length ? estimateWindowKey(chordProfile(largeVoca)) : null;
  if (chordKey) keyObservations.push({ provider: HARMONY_ARM_LABELS.BTC_CHORD_KEY.provider, value: normalizeKeyLabel(chordKey.key) ?? chordKey.key, confidence: chordKey.confidence });
  const keyVerdict = judgeDomain("key", keyObservations);

  // --- chords per bar, on the best grid available
  const end = input.harmony?.durationSeconds ?? input.durationSeconds;
  let bars: Array<{ bar: number; start: number; end: number }> = [];
  let barGridSource: string | null = null;
  if (rhythm?.downbeats.value && rhythm.downbeats.value.length >= 4) {
    bars = barsFromDownbeats(rhythm.downbeats.value, end);
    barGridSource = `rhythm engine downbeats (${rhythm.downbeats.status}, ${rhythm.downbeats.providers.join("/") || "lean"})`;
  } else if (input.harmony?.BEATS?.beats && input.harmony.BEATS.beats.length >= 8) {
    const beats = input.harmony.BEATS.beats;
    bars = barsFromDownbeats(beats.filter((_, i) => i % 4 === 0), end);
    barGridSource = "librosa beats grouped by four (metre assumed)";
  } else if (model?.bars.length) {
    bars = model.bars;
    barGridSource = "platform grid (local tempo, assumed metre)";
  }
  const majmin = input.harmony?.BTC_MAJMIN ?? [];
  const chordBars = bars.map((bar) => {
    const observations: Array<DomainObservation<string>> = [];
    const a = dominantChordInBar(majmin, bar);
    if (a) observations.push({ provider: HARMONY_ARM_LABELS.BTC_MAJMIN.provider, value: a.label, confidence: round(a.share * HARMONY_ARM_LABELS.BTC_MAJMIN.confidence) });
    const b = dominantChordInBar(largeVoca, bar);
    if (b) observations.push({ provider: HARMONY_ARM_LABELS.BTC_LARGE_VOCA.provider, value: b.label, confidence: round(b.share * HARMONY_ARM_LABELS.BTC_LARGE_VOCA.confidence) });
    return { bar: bar.bar, observations };
  });
  const chordsVerdict = judgeChordBars(chordBars);

  // --- sections: the only witness is the platform's energy sketch
  const sectionsVerdict = judgeSections(model?.sections.length && fs.sections
    ? [{ provider: fs.sections.providers[0] ?? "LOCAL_SIGNAL_ANALYZER_V1", boundaries: model.sections.map((s) => s.startBar), labels: model.sections.map((s) => s.name), confidence: fs.sections.confidence ?? undefined }]
    : []);

  const statusOfRhythmField = (status: "agreed" | "contested" | "unknown"): EndToEndStatus =>
    status === "agreed" ? "detected" : status === "contested" ? "contested" : "unknown";
  // A contested grid carries PR-84's disagreement family as its "relation": the
  // kind of question that is open (drift, unrelated grids, a pickup, a missing
  // downbeat model), which is what the aggregate counts.
  const familyFor = (field: "beatGrid" | "downbeats"): string | null => {
    if (!rhythm || rhythm[field].status !== "contested") return null;
    const wanted = field === "beatGrid"
      ? ["drift", "beat_grid_mismatch", "half_double_tempo"]
      : ["pickup_phase", "downbeat_absent", "triple_duple_meter", "beat_grid_mismatch", "drift"];
    const named: string[] = rhythm.disagreements.map((d) => String(d.family));
    return wanted.find((family) => named.includes(family)) ?? (rhythm[field].providers.length <= 1 ? "single_tracker" : null);
  };

  const levelDispute = rhythm?.tempo.status === "contested" && tempoVerdict.status !== "contested"
    ? `PR-84's rhythm engine carries this tempo as CONTESTED between ${(rhythm.tempo.candidates ?? []).map((c) => `${c.value} (${c.providers.join("/")})`).join(" and ")}: a metrical-level dispute the weight-based judge resolves by weight.`
    : null;
  const tempoNote = !tempoObservations.length ? "no tempo witness reached the engine"
    : [tempoVerdict.message, levelDispute].filter((part): part is string => Boolean(part)).join(" ") || null;
  const domains: Record<EndToEndDomain, EndToEndDomainResult> = {
    tempo: fromVerdict(tempoVerdict, tempoNote),
    meter: fromVerdict(meterVerdict, meterObservations.length ? null : "no metre witness reached the engine"),
    beats: rhythm ? {
      status: statusOfRhythmField(rhythm.beatGrid.status), value: rhythm.beatGrid.value ? `${rhythm.beatGrid.value.length} beats` : null, confidence: null,
      providers: rhythm.beatGrid.providers, candidates: [], relation: familyFor("beatGrid"), note: rhythm.beatGrid.rationale,
    } : unknownResult("no beat tracker ran"),
    downbeats: rhythm ? {
      status: statusOfRhythmField(rhythm.downbeats.status), value: rhythm.downbeats.value ? `${rhythm.downbeats.value.length} downbeats` : null, confidence: null,
      providers: rhythm.downbeats.providers, candidates: [], relation: familyFor("downbeats"), note: rhythm.downbeats.rationale,
    } : unknownResult("no downbeat tracker ran"),
    key: fromVerdict(keyVerdict, keyObservations.length ? null : "no key witness reached the engine"),
    chords: {
      status: chordsVerdict.status, value: chordsVerdict.summary.evidenced ? `${chordsVerdict.summary.evidenced} bars` : null, confidence: null,
      providers: chordsVerdict.summary.evidenced ? [HARMONY_ARM_LABELS.BTC_MAJMIN.provider, HARMONY_ARM_LABELS.BTC_LARGE_VOCA.provider] : [],
      candidates: [], relation: chordsVerdict.contestedBars[0]?.relation && chordsVerdict.contestedBars[0].relation !== "same" ? chordsVerdict.contestedBars[0].relation : null,
      note: chordsVerdict.message ?? `${chordsVerdict.summary.detected} of ${chordsVerdict.summary.evidenced} bars corroborated by both vocabularies`,
    },
    melody: fromFieldStatus(fs.melody, model?.melodyCount ? `${model.melodyCount} notes` : null, "no second transcription or stem: the platform's reading stands"),
    bass: fromFieldStatus(fs.bass, model?.bassCount ? `${model.bassCount} notes` : null, "no bass stem or bass tracker: the platform's reading stands"),
    sections: fromVerdict(sectionsVerdict, model?.sections.length ? null : "no structure witness"),
    separation: unknownResult("no separation provider is live (DEMUCS unconfigured, BS_ROFORMER licence-blocked)"),
    loudness: unknownResult("no loudness provider is live (PYLOUDNORM endpoint gone)"),
  };

  // --- the trust report over the engine's own field statuses
  const fieldStatus = engineFieldStatus(domains, { tempo: tempoVerdict, meter: meterVerdict, key: keyVerdict, sections: sectionsVerdict, chords: chordsVerdict }, fs);
  const trust = analysisTrustReport({ fieldStatus });

  const trace: EngineTrace = {
    tempoObservations, meterObservations, keyObservations,
    chordBars: bars.length, chordBarsEvidenced: chordsVerdict.summary.evidenced, barGridSource,
    rhythm: rhythm ? {
      contestedFields: rhythm.contestedFields, selectedProvider: rhythm.selectedProvider, usedAudioEvidence: rhythm.usedAudioEvidence,
      tempo: { status: rhythm.tempo.status, value: rhythm.tempo.value, providers: rhythm.tempo.providers, ...(rhythm.tempo.candidates ? { candidates: rhythm.tempo.candidates.map((c) => ({ value: c.value, providers: c.providers })) } : {}) },
      beatGrid: { status: rhythm.beatGrid.status, providers: rhythm.beatGrid.providers, rationale: rhythm.beatGrid.rationale },
      downbeats: { status: rhythm.downbeats.status, providers: rhythm.downbeats.providers, rationale: rhythm.downbeats.rationale },
      meter: { status: rhythm.meter.status, value: rhythm.meter.value, providers: rhythm.meter.providers },
      disagreements: rhythm.disagreements.map((d) => ({ family: d.family, providers: d.providers, resolved: d.resolved })),
    } : null,
  };
  return { result: { domains, trust: { verdict: trust.verdict, fieldsToConfirm: trust.fieldsToConfirm, reasons: trust.reasons } }, trace };
}

function engineFieldStatus(
  domains: Record<EndToEndDomain, EndToEndDomainResult>,
  verdicts: {
    tempo: DomainVerdict<number>; meter: DomainVerdict<string>; key: DomainVerdict<string>;
    sections: DomainVerdict<string>; chords: { status: VerdictStatus; message: string | null; whatWouldSettleIt: string | null };
  },
  platform: Partial<Record<SongModelField, SongModelFieldStatus>>,
): Partial<Record<SongModelField, SongModelFieldStatus>> {
  const of = <T extends string | number>(verdict: DomainVerdict<T>): SongModelFieldStatus => ({
    status: fieldStatusOf(verdict.status),
    confidence: verdict.confidence,
    providers: verdict.providers,
    message: verdict.message,
    edited: false,
    ...(verdict.status === "contested" ? { candidates: fieldCandidatesOf(verdict.candidates), relation: verdict.relation !== "same" ? verdict.relation : null } : {}),
    whatWouldSettleIt: verdict.whatWouldSettleIt,
  });
  return {
    tempo: of(verdicts.tempo),
    meter: of(verdicts.meter),
    key: of(verdicts.key),
    sections: of(verdicts.sections),
    harmony: {
      status: fieldStatusOf(verdicts.chords.status), confidence: null, providers: domains.chords.providers,
      message: verdicts.chords.message, edited: false, whatWouldSettleIt: verdicts.chords.whatWouldSettleIt,
    },
    melody: platform.melody ?? { status: "not_available", confidence: null, providers: [], message: domains.melody.note, edited: false },
    bass: platform.bass ?? { status: "not_available", confidence: null, providers: [], message: domains.bass.note, edited: false },
  };
}

// ---------------------------------------------------------------------------
// One song → one row
// ---------------------------------------------------------------------------

export function evaluateSong(input: EndToEndSongInput): { row: EndToEndSongRow; trace: EngineTrace } {
  const platform = platformPath(input);
  const engine = enginePath(input);
  const rhythmSeconds = input.rhythm
    ? (input.rhythm.providers.reduce((sum, p) => sum + (p.runtimeSeconds ?? 0), 0) || (input.latency.rhythmWorkerMs ?? 0) / 1000)
    : 0;
  const harmonySeconds = input.harmony?.timings?.total ?? (input.latency.harmonyWorkerMs ?? 0) / 1000;
  // Basic Pitch's container time is inside the API's wall time and is not
  // reported separately; the whole wall time is the upper bound used here.
  const basicPitchSeconds = input.platform?.providerProvenance.some((p) => p.provider === "BASIC_PITCH" && p.status === "ready")
    ? (input.latency.platformAnalysisMs ?? 0) / 1000 : 0;
  const containerSeconds = {
    BASIC_PITCH: round(basicPitchSeconds, 1),
    RHYTHM_TOURNAMENT: round(rhythmSeconds, 1),
    HARMONY_ACR: round(harmonySeconds, 1),
  };
  const stages = [input.latency.platformAnalysisMs, input.latency.rhythmWorkerMs, input.latency.harmonyWorkerMs].filter((v): v is number => typeof v === "number");
  const row: EndToEndSongRow = {
    id: input.id, tier: input.tier, dataset: input.dataset, genreFamily: input.genreFamily, title: input.title,
    sha256: input.sha256, bytes: input.bytes, durationSeconds: input.durationSeconds, licence: input.licence,
    truthCoverage: input.truthCoverage,
    paths: { platform, engine: engine.result },
    latency: {
      platformAnalysisMs: input.latency.platformAnalysisMs,
      rhythmWorkerMs: input.latency.rhythmWorkerMs,
      harmonyWorkerMs: input.latency.harmonyWorkerMs,
      engineParallelMs: stages.length ? Math.max(...stages) : null,
      engineSerialMs: stages.length ? stages.reduce((a, b) => a + b, 0) : null,
    },
    spend: { containerSeconds, usd: estimateSpend(containerSeconds) },
    failures: input.failures ?? [],
    engineTrace: engine.trace,
  };
  return { row, trace: engine.trace };
}

// ---------------------------------------------------------------------------
// Aggregation over the corpus
// ---------------------------------------------------------------------------

export type DomainAggregate = {
  songs: number;
  counts: Record<EndToEndStatus, number>;
  /** detected + low_confidence + contested, over songs. */
  coverage: number;
  /** Among contested songs: how the two leading candidates relate. */
  relations: Record<string, number>;
  /** Providers that appear on any answered song, with how often. */
  providers: Record<string, number>;
};

export type PathAggregate = {
  domains: Record<EndToEndDomain, DomainAggregate>;
  verdicts: Record<TrustVerdict, number>;
  /** Reason lines with the song-specific numbers stripped, most frequent first. */
  topReasons: Array<{ reason: string; songs: number }>;
  fieldsToConfirm: Record<string, number>;
};

export type EndToEndAggregate = {
  version: typeof END_TO_END_VERSION;
  songs: number;
  byTier: Record<string, number>;
  byDataset: Record<string, number>;
  paths: Record<EndToEndPath, PathAggregate>;
  /**
   * PR-84's rhythm engine beside PR-89's judge on the same trackers: how often
   * the level-aware engine says CONTESTED where the weight-based judge resolves
   * a tempo, and which disagreement families it named.
   */
  rhythmEngine: {
    songsWithTrackers: number;
    tempo: Record<"agreed" | "contested" | "unknown", number>;
    levelDisputesResolvedByWeight: number;
    families: Record<string, number>;
    selectedProvider: Record<string, number>;
  };
  latencyMs: Record<keyof EndToEndLatency, { median: number | null; p90: number | null; n: number }>;
  spend: { totalUsd: number; medianUsdPerSong: number | null; containerSeconds: Record<string, number> };
  failures: Record<string, number>;
  /** Verdict distribution per dataset and path, so the owner's uploads are never averaged into the public songs unseen. */
  verdictsByDataset: Record<string, Record<EndToEndPath, Record<TrustVerdict, number>>>;
};

/** `key: contested — Eb major (X) vs G minor (Y), mediant` → `key: contested (mediant)`. */
export function normaliseReason(reason: string): string {
  const head = reason.split(" — ")[0]!.trim();
  const relation = /, ([a-z_ ]+)$/.exec(reason)?.[1];
  if (head.endsWith("contested") && relation) return `${head} (${relation.trim()})`;
  if (head.startsWith("not usable")) return head;
  return head;
}

function percentile(values: readonly number[], p: number): number | null {
  const sorted = values.filter((v) => Number.isFinite(v)).sort((a, b) => a - b);
  if (!sorted.length) return null;
  return sorted[Math.min(sorted.length - 1, Math.floor(p * (sorted.length - 1) + 0.5))]!;
}

export function aggregateEndToEnd(rows: readonly EndToEndSongRow[]): EndToEndAggregate {
  const count = <K extends string>(keys: readonly K[]) => Object.fromEntries(keys.map((k) => [k, 0])) as Record<K, number>;
  const paths = Object.fromEntries(END_TO_END_PATHS.map((path) => {
    const domains = Object.fromEntries(END_TO_END_DOMAINS.map((domain) => {
      const counts = count(END_TO_END_STATUSES);
      const relations: Record<string, number> = {};
      const providers: Record<string, number> = {};
      for (const row of rows) {
        const result = row.paths[path].domains[domain];
        counts[result.status] += 1;
        if (result.status === "contested") {
          const relation = result.relation ?? "unspecified";
          relations[relation] = (relations[relation] ?? 0) + 1;
        }
        if (result.status !== "unknown") {
          const named = result.status === "contested" ? result.candidates.flatMap((c) => c.providers) : result.providers;
          for (const provider of new Set(named)) providers[provider] = (providers[provider] ?? 0) + 1;
        }
      }
      const answered = counts.detected + counts.low_confidence + counts.contested;
      return [domain, { songs: rows.length, counts, coverage: rows.length ? round(answered / rows.length) : 0, relations, providers }];
    })) as Record<EndToEndDomain, DomainAggregate>;
    const verdicts = count(["trusted_automatically", "needs_confirmation", "not_usable"] as const);
    const reasons = new Map<string, number>();
    const fields: Record<string, number> = {};
    for (const row of rows) {
      const trust = row.paths[path].trust;
      verdicts[trust.verdict] += 1;
      for (const reason of new Set(trust.reasons.map(normaliseReason))) reasons.set(reason, (reasons.get(reason) ?? 0) + 1);
      for (const field of trust.fieldsToConfirm) fields[field] = (fields[field] ?? 0) + 1;
    }
    const topReasons = [...reasons.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
      .map(([reason, songs]) => ({ reason, songs }));
    return [path, { domains, verdicts, topReasons, fieldsToConfirm: fields }];
  })) as Record<EndToEndPath, PathAggregate>;

  const latencyKeys: Array<keyof EndToEndLatency> = ["platformAnalysisMs", "rhythmWorkerMs", "harmonyWorkerMs", "engineParallelMs", "engineSerialMs"];
  const latencyMs = Object.fromEntries(latencyKeys.map((key) => {
    const values = rows.map((row) => row.latency[key]).filter((v): v is number => typeof v === "number");
    return [key, { median: median(values), p90: percentile(values, 0.9), n: values.length }];
  })) as EndToEndAggregate["latencyMs"];
  const containerSeconds: Record<string, number> = {};
  for (const row of rows) for (const [worker, seconds] of Object.entries(row.spend.containerSeconds)) containerSeconds[worker] = round((containerSeconds[worker] ?? 0) + seconds, 1);
  const failures: Record<string, number> = {};
  for (const row of rows) for (const failure of row.failures) failures[failure] = (failures[failure] ?? 0) + 1;
  const tally = (pick: (row: EndToEndSongRow) => string) => {
    const out: Record<string, number> = {};
    for (const row of rows) out[pick(row)] = (out[pick(row)] ?? 0) + 1;
    return out;
  };
  const rhythmEngine: EndToEndAggregate["rhythmEngine"] = {
    songsWithTrackers: 0, tempo: { agreed: 0, contested: 0, unknown: 0 }, levelDisputesResolvedByWeight: 0, families: {}, selectedProvider: {},
  };
  for (const row of rows) {
    const summary = row.engineTrace.rhythm;
    if (!summary) continue;
    rhythmEngine.songsWithTrackers += 1;
    rhythmEngine.tempo[summary.tempo.status as "agreed" | "contested" | "unknown"] += 1;
    if (summary.tempo.status === "contested" && row.paths.engine.domains.tempo.status !== "contested") rhythmEngine.levelDisputesResolvedByWeight += 1;
    for (const family of new Set(summary.disagreements.map((d) => d.family))) rhythmEngine.families[family] = (rhythmEngine.families[family] ?? 0) + 1;
    const selected = summary.selectedProvider ?? "none";
    rhythmEngine.selectedProvider[selected] = (rhythmEngine.selectedProvider[selected] ?? 0) + 1;
  }
  const verdictsByDataset: EndToEndAggregate["verdictsByDataset"] = {};
  for (const row of rows) {
    const entry = (verdictsByDataset[row.dataset] ??= {
      platform: { trusted_automatically: 0, needs_confirmation: 0, not_usable: 0 },
      engine: { trusted_automatically: 0, needs_confirmation: 0, not_usable: 0 },
    });
    for (const path of END_TO_END_PATHS) entry[path][row.paths[path].trust.verdict] += 1;
  }
  return {
    version: END_TO_END_VERSION,
    songs: rows.length,
    byTier: tally((row) => row.tier),
    byDataset: tally((row) => row.dataset),
    paths,
    rhythmEngine,
    verdictsByDataset,
    latencyMs,
    spend: {
      totalUsd: round(rows.reduce((sum, row) => sum + row.spend.usd, 0), 4),
      medianUsdPerSong: median(rows.map((row) => row.spend.usd)),
      containerSeconds,
    },
    failures,
  };
}

// ---------------------------------------------------------------------------
// Accuracy — only where a person verified the truth, one tier at a time
// ---------------------------------------------------------------------------

export type AccuracyArm = {
  name: string;
  /** Which path's resolved value is the prediction; contested and unknown songs make no prediction. */
  path: EndToEndPath;
  domains: readonly GoldDomain[];
};

/** The row's resolved prediction for a gold domain, or undefined when it has none. */
export function predictionFor(row: EndToEndSongRow, path: EndToEndPath, domain: GoldDomain): unknown {
  const map: Partial<Record<GoldDomain, EndToEndDomain>> = { tempo: "tempo", metre: "meter", key: "key" };
  const target = map[domain];
  if (!target) return undefined;
  const result = row.paths[path].domains[target];
  if (result.status === "contested" || result.status === "unknown" || result.value === null) return undefined;
  return result.value;
}

export type TierAccuracy = {
  tier: EndToEndTier;
  arms: Array<TierScore & { contestedWithTruth: Partial<Record<GoldDomain, number>>; unknownWithTruth: Partial<Record<GoldDomain, number>> }>;
};

/**
 * Score every arm on ONE tier. Rows from another tier are refused, not
 * skipped: mixing the owner's uploads with public recordings, or either with
 * synthetic renders, would produce a number that means nothing.
 */
export function scoreTierRows(
  manifest: GoldManifest,
  rows: readonly EndToEndSongRow[],
  tier: EndToEndTier,
  arms: readonly AccuracyArm[],
  extraPredictions: Record<string, PredictionFile> = {},
): TierAccuracy {
  if (!END_TO_END_TIERS.includes(tier)) throw new Error(`tier ${String(tier)} is not a real-recording tier`);
  const foreign = rows.filter((row) => row.tier !== tier);
  if (foreign.length) {
    throw new Error(`refusing to score tier ${tier} with ${foreign.length} row(s) of another tier (${[...new Set(foreign.map((r) => r.tier))].join(", ")}) — tiers are never mixed`);
  }
  const byId = new Map(manifest.items.map((item) => [item.id, item]));
  const scored: TierAccuracy["arms"] = [];
  for (const arm of arms) {
    const predictions: PredictionFile = { predictor: arm.name, items: {} };
    const contested: Partial<Record<GoldDomain, number>> = {};
    const unknown: Partial<Record<GoldDomain, number>> = {};
    for (const row of rows) {
      const item = byId.get(row.id);
      if (!item) throw new Error(`row ${row.id} is not in the manifest`);
      const entry: Record<string, unknown> = {};
      for (const domain of arm.domains) {
        if (item.coverage[domain] !== "HUMAN_VERIFIED") continue;
        const prediction = predictionFor(row, arm.path, domain);
        if (prediction !== undefined) entry[domain] = prediction;
        else {
          const target = ({ tempo: "tempo", metre: "meter", key: "key" } as Partial<Record<GoldDomain, EndToEndDomain>>)[domain];
          const status = target ? row.paths[arm.path].domains[target].status : "unknown";
          if (status === "contested") contested[domain] = (contested[domain] ?? 0) + 1;
          else unknown[domain] = (unknown[domain] ?? 0) + 1;
        }
      }
      if (Object.keys(entry).length) predictions.items[row.id] = entry;
    }
    scored.push({ ...scoreTier(manifest, tier, predictions), contestedWithTruth: contested, unknownWithTruth: unknown });
  }
  for (const [name, predictions] of Object.entries(extraPredictions)) {
    for (const id of Object.keys(predictions.items)) {
      const item = byId.get(id);
      if (!item) throw new Error(`prediction for unknown item ${id}`);
      if (item.tier !== tier) throw new Error(`prediction ${name}/${id} is tier ${item.tier}; this score is tier ${tier} — tiers are never mixed`);
    }
    scored.push({ ...scoreTier(manifest, tier, { ...predictions, predictor: name }), contestedWithTruth: {}, unknownWithTruth: {} });
  }
  return { tier, arms: scored };
}

// ---------------------------------------------------------------------------
// Truth readers for the public annotations this run uses
// ---------------------------------------------------------------------------

/** SALAMI `parsed/textfileN_functions.txt` → sections; `End` closes the piece, sub-second slivers merge forward. */
export function parseSalamiFunctions(text: string): SectionTruth[] {
  const lines = text.split(/\r?\n/).map((line) => line.trim()).filter(Boolean)
    .map((line) => { const [time, ...rest] = line.split(/\t|\s{2,}|\s/); return { time: Number(time), label: rest.join(" ").trim() }; })
    .filter((line) => Number.isFinite(line.time));
  const sections: SectionTruth[] = [];
  for (let i = 0; i < lines.length - 1; i += 1) {
    const { time, label } = lines[i]!;
    if (/^end$/i.test(label)) break;
    const end = lines[i + 1]!.time;
    if (end - time < 1 && sections.length === 0 && i + 1 < lines.length - 1) continue;
    if (end - time <= 0) continue;
    sections.push({ start: time, end, label });
  }
  // Merge a sliver shorter than a second into the section that follows it.
  const merged: SectionTruth[] = [];
  for (const section of sections) {
    const previous = merged[merged.length - 1];
    if (previous && previous.end - previous.start < 1) { previous.end = section.end; previous.label = section.label; continue; }
    merged.push({ ...section });
  }
  return merged;
}

/** Boundary agreement between two human annotators of the same recording — the ceiling a scorer should be read against. */
export function annotatorAgreement(reference: SectionTruth[], other: SectionTruth[]): { at3s: number | null; at0_5s: number | null } {
  const score = scoreSections(other.map((s) => s.start), reference);
  return { at3s: score.at3s?.f1 ?? null, at0_5s: score.at0_5s?.f1 ?? null };
}

/** A manifest item's truth coverage as the row records it. */
export function coverageOfItem(manifest: GoldManifest, id: string): Partial<Record<GoldDomain, CoverageKind>> {
  const item = manifest.items.find((entry) => entry.id === id);
  if (!item) return {};
  return Object.fromEntries(GOLD_DOMAINS.map((domain) => [domain, item.coverage[domain]])) as Partial<Record<GoldDomain, CoverageKind>>;
}

// Re-exported so the runner and the tests read one vocabulary.
export { TRUST_FIELDS, whatWouldSettleIt };
export type { CandidateRelation, DomainCandidate };
