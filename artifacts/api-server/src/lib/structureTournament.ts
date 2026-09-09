/**
 * Structure tournament (ANALYSIS ENGINE, Stream F — PR-87).
 *
 * Every structure candidate (a provider, the local SSM segmenter, the energy
 * fallback, a cloud worker) is reduced to the same reading — interior
 * boundaries in seconds plus labelled sections — and scored the same way
 * against a truth: boundary precision / recall / F1 at ±0.5 s and ±3 s
 * (interior boundaries, maximum bipartite matching, as in mir_eval), over-
 * and under-segmentation counts, and the pairwise label F (Levy & Sandler)
 * on a fixed frame grid.
 *
 * `reconcileStructures` turns several readings into one answer the way
 * PR-86 treats a contested key: boundaries that two independent readings
 * place within a window of each other are *corroborated*; a boundary only one
 * reading places is *lone* (kept, low confidence); every lone boundary is a
 * *contested region* carrying both readings — "X hears a section change at
 * t, Y hears continuity" — rather than a silent choice. Labels are
 * reconciled pairwise the way PR-86 reconciles a key: two spans are the same
 * section when the weighted "same" vote beats "different" by a usable
 * margin; a split vote with that margin is a *majority* (the minority stays
 * in the span's votes); a split vote without it is *contested* — the pair is
 * not merged and the region carries both readings.
 *
 * Nothing here promotes anything. The numbers are evidence for the lead.
 */
import { analyseAudioStructure } from "./audioStructure";
import { reliabilityFor } from "./providerReliability";

export const STRUCTURE_TOURNAMENT_VERSION = "STRUCTURE_TOURNAMENT_V1" as const;
export const STRUCTURE_RECONCILIATION_VERSION = "STRUCTURE_RECONCILIATION_V1" as const;

export type StructureSpan = { start: number; end: number; label: string };

/** One candidate's (or the truth's) reading of a piece. */
export type StructureReading = {
  provider: string;
  /** Interior boundaries in seconds; the piece start / end are implied. */
  boundaries: number[];
  sections: StructureSpan[];
  /** The candidate's own bounded confidence, if it reports one. */
  confidence?: number;
  /** Provider-level reliability for sections; defaults to the registry. */
  reliability?: number;
};

export const BOUNDARY_TOLERANCES = [0.5, 3] as const;
export type BoundaryTolerance = (typeof BOUNDARY_TOLERANCES)[number];

export type BoundaryScore = {
  tolerance: number;
  reference: number;
  estimated: number;
  hits: number;
  precision: number | null;
  recall: number | null;
  f1: number | null;
  /** Estimated boundaries with no reference within tolerance. */
  spurious: number;
  /** Reference boundaries no estimate reached. */
  missed: number;
};

export type PairwiseScore = { precision: number | null; recall: number | null; f: number | null; frames: number };

export type ReadingScore = {
  provider: string;
  boundaries: Record<string, BoundaryScore>;
  pairwise: PairwiseScore;
  /** estimated / reference section count; > 1 over-segments, < 1 under-segments. */
  segmentationRatio: number | null;
  sections: number;
};

const r3 = (v: number): number => Number(v.toFixed(3));
const safeDiv = (a: number, b: number): number | null => (b > 0 ? r3(a / b) : null);
const f1Of = (p: number | null, r: number | null): number | null =>
  p === null || r === null ? null : p + r > 0 ? r3((2 * p * r) / (p + r)) : 0;

/** Interior boundaries derived from sections when a reading lists none. */
export function boundariesFromSections(sections: readonly StructureSpan[]): number[] {
  const sorted = [...sections].sort((a, b) => a.start - b.start);
  return sorted.slice(1).map((s) => s.start);
}

/**
 * Maximum bipartite matching between reference and estimated boundaries
 * within `tolerance` (augmenting paths; the sets are tiny).
 */
export function matchBoundaries(reference: readonly number[], estimated: readonly number[], tolerance: number): Array<[refIndex: number, estIndex: number]> {
  const adjacency = reference.map((r) => estimated.map((e, j) => (Math.abs(e - r) <= tolerance + 1e-9 ? j : -1)).filter((j) => j >= 0));
  const matchOfEst = new Array<number>(estimated.length).fill(-1);
  const tryAssign = (i: number, seen: boolean[]): boolean => {
    for (const j of adjacency[i]) {
      if (seen[j]) continue;
      seen[j] = true;
      if (matchOfEst[j] < 0 || tryAssign(matchOfEst[j], seen)) { matchOfEst[j] = i; return true; }
    }
    return false;
  };
  for (let i = 0; i < reference.length; i += 1) tryAssign(i, new Array<boolean>(estimated.length).fill(false));
  const pairs: Array<[number, number]> = [];
  matchOfEst.forEach((i, j) => { if (i >= 0) pairs.push([i, j]); });
  return pairs.sort((a, b) => a[0] - b[0]);
}

export function scoreBoundaries(reference: readonly number[], estimated: readonly number[], tolerance: number): BoundaryScore {
  const hits = matchBoundaries(reference, estimated, tolerance).length;
  // No boundaries on either side is not a measurement; an empty answer
  // against a real truth (or boundaries where there are none) is a zero.
  const nothingToScore = reference.length === 0 && estimated.length === 0;
  const precision = nothingToScore ? null : estimated.length ? safeDiv(hits, estimated.length) : 0;
  const recall = nothingToScore ? null : reference.length ? safeDiv(hits, reference.length) : 0;
  return {
    tolerance,
    reference: reference.length,
    estimated: estimated.length,
    hits,
    precision,
    recall,
    f1: f1Of(precision, recall),
    spurious: estimated.length - hits,
    missed: reference.length - hits,
  };
}

function labelAt(sections: readonly StructureSpan[], time: number): string | null {
  for (const s of sections) if (time >= s.start && time < s.end) return s.label;
  return null;
}

/**
 * Pairwise frame-label agreement (Levy & Sandler): of all frame pairs the
 * reference puts in the same section, how many does the estimate also join
 * (recall), and vice versa (precision). Counted through a contingency table
 * so it is O(frames), not O(frames²). Frames outside both readings are
 * skipped; a frame outside one reading counts as its own label.
 */
export function scorePairwise(reference: readonly StructureSpan[], estimated: readonly StructureSpan[], frameSeconds = 0.25): PairwiseScore {
  const start = Math.min(...reference.map((s) => s.start), ...estimated.map((s) => s.start));
  const end = Math.max(...reference.map((s) => s.end), ...estimated.map((s) => s.end));
  if (!Number.isFinite(start) || !Number.isFinite(end) || end <= start) return { precision: null, recall: null, f: null, frames: 0 };
  const table = new Map<string, number>();
  const refTotals = new Map<string, number>();
  const estTotals = new Map<string, number>();
  let frames = 0;
  for (let t = start + frameSeconds / 2; t < end; t += frameSeconds) {
    const r = labelAt(reference, t);
    const e = labelAt(estimated, t);
    if (r === null && e === null) continue;
    const rk = r ?? "∅ref";
    const ek = e ?? "∅est";
    frames += 1;
    table.set(`${rk}\u001f${ek}`, (table.get(`${rk}\u001f${ek}`) ?? 0) + 1);
    refTotals.set(rk, (refTotals.get(rk) ?? 0) + 1);
    estTotals.set(ek, (estTotals.get(ek) ?? 0) + 1);
  }
  const choose2 = (n: number): number => (n * (n - 1)) / 2;
  let agree = 0;
  for (const n of table.values()) agree += choose2(n);
  let sameRef = 0;
  for (const n of refTotals.values()) sameRef += choose2(n);
  let sameEst = 0;
  for (const n of estTotals.values()) sameEst += choose2(n);
  const precision = safeDiv(agree, sameEst);
  const recall = safeDiv(agree, sameRef);
  return { precision, recall, f: f1Of(precision, recall), frames };
}

/** Score one reading against a truth reading. */
export function scoreReading(truth: StructureReading, reading: StructureReading, tolerances: readonly number[] = BOUNDARY_TOLERANCES): ReadingScore {
  const refBoundaries = truth.boundaries.length ? truth.boundaries : boundariesFromSections(truth.sections);
  const estBoundaries = reading.boundaries.length ? reading.boundaries : boundariesFromSections(reading.sections);
  const boundaries: Record<string, BoundaryScore> = {};
  for (const tolerance of tolerances) boundaries[String(tolerance)] = scoreBoundaries(refBoundaries, estBoundaries, tolerance);
  return {
    provider: reading.provider,
    boundaries,
    pairwise: scorePairwise(truth.sections, reading.sections),
    segmentationRatio: truth.sections.length ? r3(reading.sections.length / truth.sections.length) : null,
    sections: reading.sections.length,
  };
}

// ---------------------------------------------------------------------------
// Reconciliation
// ---------------------------------------------------------------------------

export type ReconciledBoundary = {
  time: number;
  status: "corroborated" | "lone";
  providers: string[];
  /** Summed provider weight behind the boundary, clamped to [0, 1]. */
  score: number;
  /** Each provider's own placement, for the record. */
  placements: Array<{ provider: string; time: number }>;
};

export type ContestedRegion = {
  start: number;
  end: number;
  kind: "boundary" | "label";
  /** Each side's reading of the region. */
  candidates: Array<{ provider: string; reading: string; score: number }>;
};

export type ReconciledSection = {
  index: number;
  start: number;
  end: number;
  /** Letter from the reconciled same/different relation. */
  label: string;
  /** How each provider labelled the bulk of this span. */
  votes: Array<{ provider: string; label: string; overlap: number }>;
  /**
   * agreed: every voter joins or separates this span the same way;
   * majority: a split vote decided by the margin; contested: a split vote
   * with no usable margin (not merged, carried); single_source: one voter.
   */
  labelStatus: "agreed" | "majority" | "contested" | "single_source";
  /** The weaker of the two boundaries that bound the span. */
  confidence: number;
};

export type StructureReconciliation = {
  version: typeof STRUCTURE_RECONCILIATION_VERSION;
  status: "detected" | "low_confidence" | "contested" | "not_available";
  providers: string[];
  toleranceSeconds: number;
  boundaries: ReconciledBoundary[];
  /** Spans between every kept boundary (corroborated and lone). */
  sections: ReconciledSection[];
  /** Spans between corroborated boundaries only — the part two readings prove. */
  corroboratedSections: ReconciledSection[];
  contested: ContestedRegion[];
  message: string;
  weights: Array<{ provider: string; weight: number }>;
};

export type ReconcileOptions = {
  /** Two placements within this many seconds are the same boundary. */
  toleranceSeconds?: number;
  /**
   * A lone boundary below this weight is dropped as noise. The floor is
   * capped at `loneRatio` of the heaviest reading present, so two local
   * baselines (weights ~0.13) can still carry a lone boundary: a floor that
   * only a provider clears would silently discard every reading the
   * production path actually has.
   */
  loneFloor?: number;
  /** The floor is never more than this fraction of the heaviest reading's weight (PR-86's relative floor). */
  loneRatio?: number;
  /**
   * A "same" vote must beat "different" by this fraction of the total
   * label weight for two spans to merge; a split below it is contested.
   */
  labelMargin?: number;
  /** Start / end of the piece; defaults to the readings' extremes. */
  start?: number;
  end?: number;
};

const clamp01 = (v: number): number => Math.max(0, Math.min(1, v));

function readingWeight(reading: StructureReading): number {
  const reliability = reading.reliability ?? reliabilityFor(reading.provider, "sections");
  return clamp01(clamp01(reading.confidence ?? 1) * reliability);
}

function letterFor(index: number): string {
  return String.fromCharCode(65 + (index % 26)) + (index >= 26 ? String(Math.floor(index / 26)) : "");
}

function dominantLabel(sections: readonly StructureSpan[], start: number, end: number): { label: string; overlap: number } | null {
  const overlaps = new Map<string, number>();
  for (const s of sections) {
    const o = Math.min(end, s.end) - Math.max(start, s.start);
    if (o > 0) overlaps.set(s.label, (overlaps.get(s.label) ?? 0) + o);
  }
  let best: { label: string; overlap: number } | null = null;
  for (const [label, o] of overlaps) if (!best || o > best.overlap || (o === best.overlap && label < best.label)) best = { label, overlap: o };
  if (!best) return null;
  return { label: best.label, overlap: r3(best.overlap / Math.max(1e-9, end - start)) };
}

function buildSections(
  edges: readonly number[],
  readings: readonly StructureReading[],
  weights: ReadonlyMap<string, number>,
  boundaryConfidence: (time: number) => number,
  contested: ContestedRegion[],
  labelMargin: number,
): ReconciledSection[] {
  const spans = edges.slice(0, -1).map((start, i) => ({ start, end: edges[i + 1] }));
  const votes = spans.map((span) => readings.map((reading) => {
    const vote = dominantLabel(reading.sections, span.start, span.end);
    return vote ? { provider: reading.provider, label: vote.label, overlap: vote.overlap } : null;
  }).filter((v): v is { provider: string; label: string; overlap: number } => v !== null));
  // Pairwise same/different relation by weighted vote.
  const n = spans.length;
  const parent = Array.from({ length: n }, (_, i) => i);
  const find = (i: number): number => (parent[i] === i ? i : (parent[i] = find(parent[i])));
  const contestedSpans = new Set<number>();
  const majoritySpans = new Set<number>();
  for (let i = 0; i < n; i += 1) {
    for (let j = i + 1; j < n; j += 1) {
      let same = 0;
      let different = 0;
      const sides: Array<{ provider: string; reading: string; score: number }> = [];
      for (const vi of votes[i]) {
        const vj = votes[j].find((v) => v.provider === vi.provider);
        if (!vj) continue;
        const w = weights.get(vi.provider) ?? 0;
        if (vi.label === vj.label) same += w; else different += w;
        sides.push({ provider: vi.provider, reading: vi.label === vj.label ? `same (${vi.label})` : `different (${vi.label} vs ${vj.label})`, score: r3(w) });
      }
      if (same + different <= 0) continue;
      const decided = Math.abs(same - different) / (same + different) >= labelMargin;
      if (same > different && decided) parent[find(i)] = find(j);
      if (same > 0 && different > 0) {
        if (decided) {
          majoritySpans.add(i);
          majoritySpans.add(j);
        } else {
          contestedSpans.add(i);
          contestedSpans.add(j);
          contested.push({ start: spans[i].start, end: spans[j].end, kind: "label", candidates: sides });
        }
      }
    }
  }
  const letters = new Map<number, string>();
  return spans.map((span, index) => {
    const root = find(index);
    if (!letters.has(root)) letters.set(root, letterFor(letters.size));
    return {
      index,
      start: r3(span.start),
      end: r3(span.end),
      label: letters.get(root)!,
      votes: votes[index],
      labelStatus: votes[index].length <= 1 ? "single_source" : contestedSpans.has(index) ? "contested" : majoritySpans.has(index) ? "majority" : "agreed",
      confidence: r3(Math.min(boundaryConfidence(span.start), boundaryConfidence(span.end))),
    };
  });
}

/** Reconcile independent structure readings of the same audio. */
export function reconcileStructures(readings: readonly StructureReading[], options: ReconcileOptions = {}): StructureReconciliation {
  const tolerance = options.toleranceSeconds ?? 3;
  const loneRatio = options.loneRatio ?? 0.4;
  const labelMargin = options.labelMargin ?? 0.2;
  const usable = readings.filter((r) => r.provider && (r.sections.length > 0 || r.boundaries.length > 0));
  const weights = new Map(usable.map((r) => [r.provider, readingWeight(r)] as const));
  const weightList = [...weights].map(([provider, weight]) => ({ provider, weight: r3(weight) })).sort((a, b) => a.provider.localeCompare(b.provider));
  const heaviest = Math.max(0, ...weights.values());
  const loneFloor = Math.min(options.loneFloor ?? 0.15, loneRatio * heaviest);
  if (!usable.length) {
    return {
      version: STRUCTURE_RECONCILIATION_VERSION, status: "not_available", providers: [], toleranceSeconds: tolerance,
      boundaries: [], sections: [], corroboratedSections: [], contested: [],
      message: "No structure reading was available.", weights: weightList,
    };
  }
  const start = options.start ?? Math.min(...usable.flatMap((r) => r.sections.map((s) => s.start)), ...usable.flatMap((r) => r.boundaries));
  const end = options.end ?? Math.max(...usable.flatMap((r) => r.sections.map((s) => s.end)), ...usable.flatMap((r) => r.boundaries));

  // Cluster placements: sorted by time, a placement joins the open cluster
  // when within tolerance of its weighted centre and the provider is new to it.
  const placements = usable.flatMap((r) => (r.boundaries.length ? r.boundaries : boundariesFromSections(r.sections))
    .filter((t) => t > start && t < end)
    .map((time) => ({ provider: r.provider, time, weight: weights.get(r.provider) ?? 0 })))
    .sort((a, b) => a.time - b.time || a.provider.localeCompare(b.provider));
  type Cluster = { placements: Array<{ provider: string; time: number; weight: number }>; centre: number; weight: number };
  const clusters: Cluster[] = [];
  for (const p of placements) {
    const open = clusters[clusters.length - 1];
    if (open && Math.abs(p.time - open.centre) <= tolerance && !open.placements.some((q) => q.provider === p.provider)) {
      open.placements.push(p);
      open.weight += p.weight;
      open.centre = open.placements.reduce((acc, q) => acc + q.time * Math.max(1e-6, q.weight), 0) /
        open.placements.reduce((acc, q) => acc + Math.max(1e-6, q.weight), 0);
    } else {
      clusters.push({ placements: [p], centre: p.time, weight: p.weight });
    }
  }
  const multi = usable.length >= 2;
  const boundaries: ReconciledBoundary[] = [];
  const contested: ContestedRegion[] = [];
  for (const cluster of clusters) {
    const providers = cluster.placements.map((p) => p.provider).sort();
    const corroborated = providers.length >= 2;
    if (!corroborated && cluster.weight < loneFloor) continue;
    boundaries.push({
      time: r3(cluster.centre),
      status: corroborated ? "corroborated" : "lone",
      providers,
      score: r3(clamp01(cluster.weight)),
      placements: cluster.placements.map((p) => ({ provider: p.provider, time: r3(p.time) })),
    });
    if (!corroborated && multi) {
      const silent = usable.filter((r) => !providers.includes(r.provider));
      contested.push({
        start: r3(Math.max(start, cluster.centre - tolerance)),
        end: r3(Math.min(end, cluster.centre + tolerance)),
        kind: "boundary",
        candidates: [
          ...cluster.placements.map((p) => ({ provider: p.provider, reading: `section change at ${r3(p.time)} s`, score: r3(p.weight) })),
          ...silent.map((r) => ({ provider: r.provider, reading: "continuous", score: r3(weights.get(r.provider) ?? 0) })),
        ],
      });
    }
  }
  const confidenceAt = (time: number): number => {
    if (Math.abs(time - start) < 1e-6 || Math.abs(time - end) < 1e-6) return 1;
    const b = boundaries.find((x) => Math.abs(x.time - time) < 1e-6);
    return b ? (b.status === "corroborated" ? Math.min(1, 0.5 + b.score / 2) : Math.min(0.49, b.score)) : 0;
  };
  const allEdges = [start, ...boundaries.map((b) => b.time), end];
  const corroboratedEdges = [start, ...boundaries.filter((b) => b.status === "corroborated").map((b) => b.time), end];
  const sections = buildSections(allEdges, usable, weights, confidenceAt, contested, labelMargin);
  const corroboratedSections = buildSections(corroboratedEdges, usable, weights, confidenceAt, [], labelMargin);

  const lone = boundaries.filter((b) => b.status === "lone").length;
  const corroboratedCount = boundaries.length - lone;
  const labelContests = sections.filter((s) => s.labelStatus === "contested").length;
  let status: StructureReconciliation["status"];
  let message: string;
  if (!multi) {
    status = "low_confidence";
    message = `Only ${usable[0].provider} read the structure (${boundaries.length} boundaries); nothing corroborates it.`;
  } else if (lone === 0 && labelContests === 0) {
    status = corroboratedCount > 0 ? "detected" : "low_confidence";
    message = corroboratedCount > 0
      ? `${usable.length} independent readings agree on ${corroboratedCount} boundaries within ±${tolerance} s and on which sections repeat.`
      : `${usable.length} readings found no section change they agree on.`;
  } else {
    status = "contested";
    message = `${corroboratedCount} boundaries corroborated, ${lone} placed by one reading only, ${labelContests} of ${sections.length} sections with an undecided label. Contested regions carry both readings; confirm before arranging on them.`;
  }
  return {
    version: STRUCTURE_RECONCILIATION_VERSION,
    status,
    providers: usable.map((r) => r.provider).sort(),
    toleranceSeconds: tolerance,
    boundaries,
    sections,
    corroboratedSections,
    contested,
    message,
    weights: weightList,
  };
}

/** The reconciled answer as a reading, so it can be scored like a candidate. */
export function reconciliationAsReading(reconciliation: StructureReconciliation, variant: "all" | "corroborated" = "all"): StructureReading {
  const sections = variant === "all" ? reconciliation.sections : reconciliation.corroboratedSections;
  return {
    provider: variant === "all" ? "RECONCILED" : "RECONCILED_CORROBORATED",
    boundaries: sections.slice(1).map((s) => s.start),
    sections: sections.map((s) => ({ start: s.start, end: s.end, label: s.label })),
  };
}

// ---------------------------------------------------------------------------
// Analyzer evidence (the additive Song Model field)
// ---------------------------------------------------------------------------

export type StructureEvidenceInput = {
  /** Mono PCM of the analysed window. */
  samples: ArrayLike<number>;
  sampleRate: number;
  /** Where the window starts in the source, in seconds. */
  windowStartSeconds: number;
  /** Structure readings already in hand (a provider's sections, the energy fallback), in source seconds. */
  readings?: StructureReading[];
  /** Injected for tests; defaults to the local SSM segmenter. */
  segment?: (samples: ArrayLike<number>, sampleRate: number) => AudioStructureLike | null;
};

/** The subset of `AudioStructureResult` the evidence needs (keeps the import one-way). */
export type AudioStructureLike = {
  provider: string;
  boundaries: Array<{ time: number }>;
  sections: Array<{ start: number; end: number; base: string }>;
  confidence: number;
};

export const STRUCTURE_EVIDENCE_VERSION = "STRUCTURE_EVIDENCE_V1" as const;

export type StructureEvidence = {
  version: typeof STRUCTURE_EVIDENCE_VERSION;
  window: { start: number; end: number };
  readings: Array<{ provider: string; boundaries: number[]; form: string; confidence: number | null }>;
  status: StructureReconciliation["status"];
  boundaries: Array<Pick<ReconciledBoundary, "time" | "status" | "providers" | "score">>;
  sections: Array<Pick<ReconciledSection, "start" | "end" | "label" | "labelStatus" | "confidence">>;
  contested: ContestedRegion[];
  message: string;
};

/** Is the additive structure evidence enabled? Default on; `0`, `false`, `off` disable. */
export function structureEvidenceEnabled(env: NodeJS.ProcessEnv = process.env): boolean {
  const value = (env.ANALYSIS_STRUCTURE_EVIDENCE ?? "").trim().toLowerCase();
  return !["0", "false", "off", "no"].includes(value);
}

/** Sections in bars → a reading in source seconds, given the bar grid. */
export function readingFromBarSections(
  provider: string,
  sections: ReadonlyArray<{ name: string; startBar: number; endBar: number }>,
  bars: ReadonlyArray<{ bar: number; start: number; end: number }>,
  confidence: number,
): StructureReading | null {
  const byBar = new Map(bars.map((b) => [b.bar, b]));
  const spans: StructureSpan[] = [];
  for (const section of sections) {
    const first = byBar.get(section.startBar);
    const last = byBar.get(section.endBar);
    if (!first || !last) continue;
    spans.push({ start: first.start, end: last.end, label: section.name.replace(/\s\d+$/, "") });
  }
  if (!spans.length) return null;
  return { provider, boundaries: spans.slice(1).map((s) => s.start), sections: spans, confidence };
}

/**
 * Run the local SSM segmenter on the analysed window, put it beside every
 * reading already in hand, and reconcile. Pure given `segment`; the default
 * segmenter is deterministic.
 */
export function buildStructureEvidence(input: StructureEvidenceInput): StructureEvidence {
  const segment = input.segment ?? analyseAudioStructure;
  const local = segment(input.samples, input.sampleRate);
  const offset = input.windowStartSeconds;
  const windowEnd = r3(offset + input.samples.length / input.sampleRate);
  const readings: StructureReading[] = [...(input.readings ?? [])];
  if (local) {
    readings.push({
      provider: local.provider,
      boundaries: local.boundaries.map((b) => r3(b.time + offset)),
      sections: local.sections.map((s) => ({ start: r3(s.start + offset), end: r3(s.end + offset), label: s.base })),
      confidence: local.confidence,
    });
  }
  const reconciliation = reconcileStructures(readings, { start: r3(offset), end: windowEnd });
  return {
    version: STRUCTURE_EVIDENCE_VERSION,
    window: { start: r3(offset), end: windowEnd },
    readings: readings.map((r) => ({
      provider: r.provider,
      boundaries: r.boundaries.map(r3),
      form: r.sections.map((s) => s.label).join(" "),
      confidence: r.confidence ?? null,
    })),
    status: reconciliation.status,
    boundaries: reconciliation.boundaries.map((b) => ({ time: b.time, status: b.status, providers: b.providers, score: b.score })),
    sections: reconciliation.sections.map((s) => ({ start: s.start, end: s.end, label: s.label, labelStatus: s.labelStatus, confidence: s.confidence })),
    contested: reconciliation.contested,
    message: reconciliation.message,
  };
}

// ---------------------------------------------------------------------------
// Aggregation
// ---------------------------------------------------------------------------

export type AggregateScore = {
  provider: string;
  pieces: number;
  /** Mean over pieces, per tolerance. */
  boundaryF1: Record<string, number | null>;
  boundaryPrecision: Record<string, number | null>;
  boundaryRecall: Record<string, number | null>;
  pairwiseF: number | null;
  meanSegmentationRatio: number | null;
  /** Pieces where the candidate over-segments (ratio > 1.25) / under-segments (< 0.75). */
  overSegmentedPieces: number;
  underSegmentedPieces: number;
  totalSpurious: Record<string, number>;
  totalMissed: Record<string, number>;
};

function meanOrNull(values: Array<number | null>): number | null {
  const present = values.filter((v): v is number => v !== null);
  return present.length ? r3(present.reduce((a, b) => a + b, 0) / present.length) : null;
}

export function aggregateScores(scores: readonly ReadingScore[]): AggregateScore | null {
  if (!scores.length) return null;
  const tolerances = Object.keys(scores[0].boundaries);
  const perTol = (pick: (b: BoundaryScore) => number | null): Record<string, number | null> =>
    Object.fromEntries(tolerances.map((t) => [t, meanOrNull(scores.map((s) => pick(s.boundaries[t])))]));
  const sumTol = (pick: (b: BoundaryScore) => number): Record<string, number> =>
    Object.fromEntries(tolerances.map((t) => [t, scores.reduce((acc, s) => acc + pick(s.boundaries[t]), 0)]));
  return {
    provider: scores[0].provider,
    pieces: scores.length,
    boundaryF1: perTol((b) => b.f1),
    boundaryPrecision: perTol((b) => b.precision),
    boundaryRecall: perTol((b) => b.recall),
    pairwiseF: meanOrNull(scores.map((s) => s.pairwise.f)),
    meanSegmentationRatio: meanOrNull(scores.map((s) => s.segmentationRatio)),
    overSegmentedPieces: scores.filter((s) => (s.segmentationRatio ?? 1) > 1.25).length,
    underSegmentedPieces: scores.filter((s) => (s.segmentationRatio ?? 1) < 0.75).length,
    totalSpurious: sumTol((b) => b.spurious),
    totalMissed: sumTol((b) => b.missed),
  };
}
