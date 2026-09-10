/**
 * Shared machinery for the adversarial critic modules (Brain B-05b).
 *
 * Everything here is pure and deterministic. The modules read the Song
 * Model's own bar grid (never a 120 BPM / 4/4 default: no grid means the
 * module says so and abstains), the plan's section targets, and the
 * performed track models. Confidence is never typed by hand: it is a function
 * of how much evidence the observation rests on and how far the measurement
 * sits past its threshold. Origin confidence is spread over the taxonomy's
 * candidate layers and sharpened only by what the plan can confirm.
 */
import type { ChordHarmonyEvent, MusicalNote, TrackModel } from "@workspace/db";
import { originsForKind, repairScopeForKind } from "../failureTaxonomy";
import type {
  CriticDimensionReport,
  CriticInput,
  CriticObservation,
  OriginLayer,
  Severity,
} from "../types";

// ---------------------------------------------------------------------------
// Numbers
// ---------------------------------------------------------------------------

export const r4 = (v: number): number => Number(v.toFixed(4));
export const clamp01 = (v: number): number => Math.max(0, Math.min(1, v));
export const mean = (xs: readonly number[]): number => (xs.length ? xs.reduce((s, x) => s + x, 0) / xs.length : 0);
export const std = (xs: readonly number[]): number => {
  if (xs.length < 2) return 0;
  const m = mean(xs);
  return Math.sqrt(mean(xs.map((x) => (x - m) ** 2)));
};
export const median = (xs: readonly number[]): number => {
  if (!xs.length) return 0;
  const s = [...xs].sort((a, b) => a - b);
  const mid = Math.floor(s.length / 2);
  return s.length % 2 ? s[mid] : (s[mid - 1] + s[mid]) / 2;
};
export const pc = (pitch: number): number => ((Math.round(pitch) % 12) + 12) % 12;

/** Shannon entropy in bits of a token sequence's unigram distribution. */
export function entropyBits(tokens: readonly string[]): number {
  if (!tokens.length) return 0;
  const counts = new Map<string, number>();
  for (const t of tokens) counts.set(t, (counts.get(t) ?? 0) + 1);
  let h = 0;
  for (const c of counts.values()) {
    const p = c / tokens.length;
    h -= p * Math.log2(p);
  }
  return h;
}

/** Entropy relative to the maximum a sequence of that length could have (all tokens distinct), 0..1. */
export function normalisedEntropy(tokens: readonly string[]): number {
  if (tokens.length < 2) return 0;
  return clamp01(entropyBits(tokens) / Math.log2(tokens.length));
}

/** n-grams of a token sequence as strings. */
export function ngrams(tokens: readonly string[], n: number): string[] {
  const out: string[] = [];
  for (let i = 0; i + n <= tokens.length; i += 1) out.push(tokens.slice(i, i + n).join("|"));
  return out;
}

/**
 * Confidence from evidence quantity and effect size. `n` observations against
 * a saturation count `k` (how many observations make the measurement stable)
 * give 1 - 2^(-n/k); the effect (how far past the threshold, 0..1) scales it.
 * Never a literal.
 */
export function confidenceFromEvidence(n: number, k: number, effect: number): number {
  if (n <= 0 || k <= 0) return 0;
  return r4(clamp01((1 - 2 ** (-n / k)) * clamp01(effect)));
}

/** How far a measured value sits past a threshold, as a 0..1 effect: 0 at the threshold, 1 at `full`. */
export function effectPast(value: number, threshold: number, full: number): number {
  if (full === threshold) return value >= threshold ? 1 : 0;
  return clamp01((value - threshold) / (full - threshold));
}

// ---------------------------------------------------------------------------
// Bar grid and sections
// ---------------------------------------------------------------------------

export type BarSpan = { bar: number; start: number; end: number; beats: number };
export type BarGrid = { bars: BarSpan[]; totalBars: number; songStart: number; songEnd: number };

/** Onsets this close before a bar line belong to the next bar (performance jitter is <= 14 ms). */
const BAR_TOLERANCE_SECONDS = 0.03;

export function gridFrom(input: CriticInput): BarGrid | null {
  const bars = (input.songModel.bars ?? [])
    .filter((b) => Number.isFinite(b.start) && Number.isFinite(b.end) && b.end > b.start)
    .map((b) => ({ bar: b.bar, start: b.start, end: b.end, beats: Math.max(1, Math.round(b.beats || 0)) }))
    .sort((a, b) => a.start - b.start);
  if (!bars.length) return null;
  return { bars, totalBars: bars.length, songStart: bars[0].start, songEnd: bars[bars.length - 1].end };
}

/** 1-based bar index for a time, clamped to the grid. */
export function barAt(grid: BarGrid, time: number): number {
  const t = time + BAR_TOLERANCE_SECONDS;
  let lo = 0;
  let hi = grid.bars.length - 1;
  while (lo < hi) {
    const mid = (lo + hi + 1) >> 1;
    if (grid.bars[mid].start <= t) lo = mid; else hi = mid - 1;
  }
  return grid.bars[lo].bar;
}

export function barSpan(grid: BarGrid, bar: number): BarSpan {
  return grid.bars[Math.max(0, Math.min(grid.bars.length - 1, bar - grid.bars[0].bar))];
}

/** Position of a time inside its bar, in beats (may be fractionally negative for jittered early onsets). */
export function beatPosition(grid: BarGrid, time: number): { bar: number; beat: number; beatSeconds: number } {
  const bar = barAt(grid, time);
  const span = barSpan(grid, bar);
  const beatSeconds = (span.end - span.start) / span.beats;
  return { bar, beat: (time - span.start) / beatSeconds, beatSeconds };
}

export type SectionInfo = {
  name: string;
  startBar: number;
  endBar: number;
  role: string;
  energy: number;
  isClimax: boolean;
  isSung: boolean;
};

function roleFromName(name: string): string {
  const n = name.toLowerCase();
  for (const role of ["prechorus", "chorus", "verse", "intro", "outro", "bridge", "breakdown", "instrumental"]) {
    if (n.includes(role)) return role;
  }
  return "neutral";
}

/** Voiced vocal windows in seconds, from the vocal evidence or the musical map; [] when unknown. */
export function voicedWindows(input: CriticInput): Array<{ start: number; end: number }> {
  const evidence = input.songModel.vocalEvidence;
  if (evidence && evidence.status === "detected" && evidence.observedVoicedWindows?.length) {
    return evidence.observedVoicedWindows.map((w) => ({ start: w.start, end: w.end }));
  }
  const vocals = input.songModel.musicalMap?.vocals;
  if (vocals && vocals.status === "detected" && vocals.phrases?.length) {
    return vocals.phrases.filter((p) => p.activity > 0.5).map((p) => ({ start: p.start, end: p.end }));
  }
  return [];
}

export function sectionsFrom(input: CriticInput, grid: BarGrid): SectionInfo[] {
  const voiced = voicedWindows(input);
  const sungShare = (startBar: number, endBar: number): number => {
    const start = barSpan(grid, startBar).start;
    const end = barSpan(grid, endBar).end;
    if (end <= start) return 0;
    let covered = 0;
    for (const w of voiced) covered += Math.max(0, Math.min(end, w.end) - Math.max(start, w.start));
    return covered / (end - start);
  };
  const targets = input.plan.globalPlan?.sectionTargets;
  const climaxName = input.plan.globalPlan?.climax?.sectionName ?? null;
  const raw = targets && targets.length
    ? targets.map((t) => ({ name: t.sectionName, startBar: t.startBar, endBar: t.endBar, role: t.role as string, energy: t.energy }))
    : (input.songModel.sections ?? []).map((s) => ({
      name: s.name, startBar: s.startBar, endBar: s.endBar, role: roleFromName(s.name), energy: s.energy ?? 0,
    }));
  const sorted = [...raw].sort((a, b) => a.startBar - b.startBar);
  const maxEnergy = Math.max(...sorted.map((s) => s.energy), -Infinity);
  return sorted.map((s) => ({
    ...s,
    isClimax: climaxName ? s.name === climaxName : s.energy === maxEnergy,
    // A quarter of the section under a voiced window is enough to call it sung.
    isSung: sungShare(s.startBar, s.endBar) >= 0.25,
  }));
}

export function sectionAt(sections: readonly SectionInfo[], bar: number): SectionInfo | null {
  return sections.find((s) => bar >= s.startBar && bar <= s.endBar) ?? null;
}

/** Bars that lie under a voiced vocal window. */
export function sungBars(input: CriticInput, grid: BarGrid): Set<number> {
  const out = new Set<number>();
  for (const w of voicedWindows(input)) {
    const from = barAt(grid, w.start);
    const to = barAt(grid, Math.max(w.start, w.end - BAR_TOLERANCE_SECONDS * 2));
    for (let b = from; b <= to; b += 1) out.add(b);
  }
  return out;
}

/** Consecutive bars merged into [start, end] runs. */
export function mergeRuns(bars: Iterable<number>): Array<[number, number]> {
  const sorted = [...new Set(bars)].sort((a, b) => a - b);
  const runs: Array<[number, number]> = [];
  for (const b of sorted) {
    const last = runs[runs.length - 1];
    if (last && b === last[1] + 1) last[1] = b; else runs.push([b, b]);
  }
  return runs;
}

// ---------------------------------------------------------------------------
// Parts
// ---------------------------------------------------------------------------

export type PartView = {
  track: TrackModel;
  id: string;
  family: string;
  percussion: boolean;
  notes: MusicalNote[];
  /** Notes by the bar of their onset. */
  byBar: Map<number, MusicalNote[]>;
  /** Bars with at least one onset. */
  activeBars: number[];
  /** Bars in which at least one note is sounding (a two-bar chord sounds in both). */
  soundingBars: number[];
};

export function isPercussionTrack(track: TrackModel): boolean {
  return track.instrumentDefinition.family === "drums" || /drum|perc|kit/i.test(`${track.instrument} ${track.id}`);
}

export function partsFrom(input: CriticInput, grid: BarGrid): PartView[] {
  return [...input.trackModels]
    .filter((t) => t.notes.length > 0)
    .sort((a, b) => a.id.localeCompare(b.id))
    .map((track) => {
      const notes = [...track.notes]
        .filter((n) => Number.isFinite(n.start) && Number.isFinite(n.duration) && n.duration > 0 && Number.isFinite(n.pitch))
        .sort((a, b) => a.start - b.start || a.pitch - b.pitch);
      const byBar = new Map<number, MusicalNote[]>();
      const sounding = new Set<number>();
      for (const n of notes) {
        const bar = barAt(grid, n.start);
        const list = byBar.get(bar) ?? [];
        list.push(n);
        byBar.set(bar, list);
        // A note counts as sounding in a later bar only when it reaches past a quarter of that bar.
        const endBar = barAt(grid, n.start + n.duration - BAR_TOLERANCE_SECONDS);
        for (let b = bar; b <= endBar; b += 1) {
          if (b === bar) { sounding.add(b); continue; }
          const span = barSpan(grid, b);
          if (n.start + n.duration >= span.start + (span.end - span.start) * 0.25) sounding.add(b);
        }
      }
      return {
        track, id: track.id, family: track.instrumentDefinition.family, percussion: isPercussionTrack(track),
        notes, byBar, activeBars: [...byBar.keys()].sort((a, b) => a - b), soundingBars: [...sounding].sort((a, b) => a - b),
      };
    });
}

/** Simultaneous-onset clusters (chords) within a tolerance, in onset order. */
export function clustersOf(notes: readonly MusicalNote[], toleranceSeconds = 0.03): MusicalNote[][] {
  const sorted = [...notes].sort((a, b) => a.start - b.start || a.pitch - b.pitch);
  const out: MusicalNote[][] = [];
  for (const n of sorted) {
    const last = out[out.length - 1];
    if (last && n.start - last[0].start <= toleranceSeconds) last.push(n); else out.push([n]);
  }
  return out;
}

/** Highest note of each onset cluster. */
export function topLine(notes: readonly MusicalNote[]): MusicalNote[] {
  return clustersOf(notes).map((c) => c.reduce((best, n) => (n.pitch > best.pitch ? n : best), c[0]));
}

/** Lowest note of each onset cluster. */
export function bottomLine(notes: readonly MusicalNote[]): MusicalNote[] {
  return clustersOf(notes).map((c) => c.reduce((best, n) => (n.pitch < best.pitch ? n : best), c[0]));
}

/** Seconds during [start, end] in which at least one of the notes sounds. */
export function soundingSeconds(notes: readonly MusicalNote[], start: number, end: number): number {
  const spans = notes
    .map((n) => [Math.max(start, n.start), Math.min(end, n.start + n.duration)] as [number, number])
    .filter(([a, b]) => b > a)
    .sort((a, b) => a[0] - b[0]);
  let total = 0;
  let cursor = -Infinity;
  for (const [a, b] of spans) {
    const from = Math.max(a, cursor);
    if (b > from) total += b - from;
    cursor = Math.max(cursor, b);
  }
  return total;
}

/** The longest stretch in which the part never rests for `restSeconds` or more. */
export function longestUnbrokenRun(notes: readonly MusicalNote[], restSeconds: number): { seconds: number; start: number } {
  const sorted = [...notes].sort((a, b) => a.start - b.start);
  let best = { seconds: 0, start: sorted[0]?.start ?? 0 };
  let runStart = sorted[0]?.start ?? 0;
  let runEnd = sorted[0] ? sorted[0].start + sorted[0].duration : 0;
  for (const n of sorted.slice(1)) {
    if (n.start - runEnd >= restSeconds) {
      if (runEnd - runStart > best.seconds) best = { seconds: runEnd - runStart, start: runStart };
      runStart = n.start;
      runEnd = n.start + n.duration;
    } else {
      runEnd = Math.max(runEnd, n.start + n.duration);
    }
  }
  if (runEnd - runStart > best.seconds) best = { seconds: runEnd - runStart, start: runStart };
  return best;
}

/** A bar's content relative to the bar start: pitch, onset (in 1/48 beat), duration (in 1/48 beat). */
export function barSignature(grid: BarGrid, bar: number, notes: readonly MusicalNote[], withVelocity = false): string {
  const span = barSpan(grid, bar);
  const beatSeconds = (span.end - span.start) / span.beats;
  return notes
    .map((n) => {
      const on = Math.round(((n.start - span.start) / beatSeconds) * 48);
      const dur = Math.round((n.duration / beatSeconds) * 48);
      return `${n.pitch}@${on}:${dur}${withVelocity ? `v${n.velocity}` : ""}`;
    })
    .sort()
    .join(",");
}

/** Onset positions of a bar as a 16th-slot pattern string (rhythm only). */
export function rhythmToken(grid: BarGrid, bar: number, notes: readonly MusicalNote[]): string {
  const span = barSpan(grid, bar);
  const beatSeconds = (span.end - span.start) / span.beats;
  const slots = new Set<number>();
  for (const n of notes) slots.add(Math.max(0, Math.round(((n.start - span.start) / beatSeconds) * 4)));
  return [...slots].sort((a, b) => a - b).join(".");
}

// ---------------------------------------------------------------------------
// Harmony (one small local reader; B-02 owns the unified chord parser)
// ---------------------------------------------------------------------------

const NOTE_ROOTS: Record<string, number> = {
  C: 0, "C#": 1, DB: 1, D: 2, "D#": 3, EB: 3, E: 4, F: 5, "F#": 6, GB: 6, G: 7, "G#": 8, AB: 8, A: 9, "A#": 10, BB: 10, B: 11,
};

export function rootPcOf(chord: ChordHarmonyEvent): number | null {
  const symbol = chord.root ?? chord.symbol ?? "";
  const m = /^([A-Ga-g])([#b♯♭]?)/.exec(symbol.trim());
  if (!m) return null;
  const acc = m[2].replace("♯", "#").replace("♭", "b").toUpperCase();
  const v = NOTE_ROOTS[`${m[1].toUpperCase()}${acc}`];
  return v === undefined ? null : v;
}

export function chordTonePcs(chord: ChordHarmonyEvent): Set<number> {
  const root = rootPcOf(chord);
  if (root === null) return new Set();
  const q = (chord.quality ?? chord.symbol.replace(/^[A-Ga-g][#b♯♭]?/, "")).toLowerCase();
  const intervals = q.includes("dim") ? [0, 3, 6]
    : q.includes("aug") ? [0, 4, 8]
    : q.includes("sus2") ? [0, 2, 7]
    : q.includes("sus") ? [0, 5, 7]
    : (q.startsWith("m") && !q.startsWith("maj")) || q === "min" ? [0, 3, 7]
    : [0, 4, 7];
  if (/7|9|11|13/.test(q)) intervals.push(q.includes("maj7") ? 11 : 10);
  return new Set(intervals.map((i) => (root + i) % 12));
}

export function chordAt(chords: readonly ChordHarmonyEvent[], time: number): ChordHarmonyEvent | null {
  let found: ChordHarmonyEvent | null = null;
  for (const c of chords) {
    if (c.start <= time + 0.03 && c.end > time + 0.03) { found = c; break; }
  }
  return found;
}

// ---------------------------------------------------------------------------
// Observations and reports
// ---------------------------------------------------------------------------

export const SEVERITY_PENALTY: Record<Severity, number> = { blocking: 40, major: 12, minor: 4, info: 1 };
/** Below this the confidence function has seen essentially no evidence (n/k < 0.03). */
const MIN_REPORTED_CONFIDENCE = 0.02;

export type PlanAttribution = {
  /** The layer whose plan field, if it explains the observation, is the origin. */
  layer: OriginLayer;
  /** Share of the observed instances the plan itself asked for, 0..1. */
  planExplains: number;
};

/**
 * Origin layer + confidence for a kind. Without plan evidence: the code's
 * first candidate layer at 1/(number of candidates). With plan evidence: the
 * planned layer when the plan explains at least half of what was observed
 * (confidence = that share), else the leading non-plan candidate at the
 * complementary share spread over the remaining candidates.
 */
export function originFor(kind: string, attribution?: PlanAttribution): { layer: OriginLayer; confidence: number } {
  const candidates = originsForKind(kind);
  if (!attribution) return { layer: candidates[0], confidence: r4(1 / candidates.length) };
  const share = clamp01(attribution.planExplains);
  if (share >= 0.5) return { layer: attribution.layer, confidence: r4(share) };
  const rest = candidates.filter((c) => c !== attribution.layer);
  const layer = rest[0] ?? candidates[0];
  return { layer, confidence: r4((1 - share) / Math.max(1, rest.length)) };
}

export type ObservationDraft = {
  dimension: string;
  kind: string;
  severity: Severity;
  startBar: number;
  endBar: number;
  trackIds: string[];
  evidence: Record<string, number | string | boolean>;
  confidence: number;
  repair: { operation: string; detail: string } | null;
  attribution?: PlanAttribution;
};

export function makeObservation(draft: ObservationDraft, sections: readonly SectionInfo[]): CriticObservation {
  const origin = originFor(draft.kind, draft.attribution);
  const section = sectionAt(sections, draft.startBar);
  const evidence: Record<string, number | string | boolean> = {};
  for (const [k, v] of Object.entries(draft.evidence)) {
    evidence[k] = typeof v === "number" ? (Number.isFinite(v) ? r4(v) : 0) : v;
  }
  const trackIds = [...draft.trackIds].sort();
  return {
    id: `${draft.dimension}:${draft.kind}:${draft.startBar}-${draft.endBar}:${trackIds.join("+") || "all"}`,
    dimension: draft.dimension,
    kind: draft.kind,
    severity: draft.severity,
    location: {
      startBar: draft.startBar,
      endBar: draft.endBar,
      ...(section ? { sectionName: section.name } : {}),
      trackIds,
    },
    evidence,
    suspectedOrigin: origin.layer,
    originConfidence: origin.confidence,
    recommendedRepair: draft.repair
      ? { operation: draft.repair.operation, scope: repairScopeForKind(draft.kind), detail: draft.repair.detail }
      : null,
    confidence: r4(clamp01(draft.confidence)),
  };
}

/** Confidence-weighted severity penalty; the score is 100 minus this, floored at 0. */
export function penaltyOf(observations: readonly CriticObservation[]): number {
  return r4(observations.reduce((sum, o) => sum + SEVERITY_PENALTY[o.severity] * o.confidence, 0));
}

export function scoreFromPenalty(penalty: number): number {
  return Math.max(0, Math.min(100, Math.round(100 - penalty)));
}

export type ControlStatus = CriticDimensionReport["summary"]["controlStatus"];

export function buildReport(args: {
  dimension: string;
  version: string;
  observations: CriticObservation[];
  coverage: number;
  controlStatus?: ControlStatus;
}): CriticDimensionReport {
  // An observation whose confidence rounds to nothing carries no evidence weight; it is not reported.
  const observations = args.observations
    .filter((o) => o.confidence >= MIN_REPORTED_CONFIDENCE)
    .sort((a, b) => a.location.startBar - b.location.startBar || a.id.localeCompare(b.id));
  return {
    dimension: args.dimension,
    version: args.version,
    applicable: true,
    observations,
    summary: {
      score0to100: scoreFromPenalty(penaltyOf(observations)),
      coverage: r4(clamp01(args.coverage)),
      controlStatus: args.controlStatus ?? "uncalibrated",
    },
  };
}

export function notApplicable(dimension: string, version: string, reason: string, controlStatus?: ControlStatus): CriticDimensionReport {
  return {
    dimension, version, applicable: false, reasonIfNot: reason, observations: [],
    summary: { score0to100: null, coverage: 0, controlStatus: controlStatus ?? "uncalibrated" },
  };
}

/** The common preamble: grid, sections, parts — or the reason there is nothing to judge. */
export function prepare(input: CriticInput): { grid: BarGrid; sections: SectionInfo[]; parts: PartView[] } | { reason: string; kind: "no_bar_grid" | "no_notes" } {
  const grid = gridFrom(input);
  if (!grid) return { reason: "The Song Model carries no bar grid; the critic will not assume a tempo or meter.", kind: "no_bar_grid" };
  const parts = partsFrom(input, grid);
  if (!parts.length) return { reason: "No track carries a note; there is nothing to reject.", kind: "no_notes" };
  return { grid, sections: sectionsFrom(input, grid), parts };
}

/** Share of (part × bar) cells that carry notes — what a per-bar module actually looked at. */
export function cellCoverage(parts: readonly PartView[], grid: BarGrid): number {
  if (!parts.length || !grid.totalBars) return 0;
  const active = parts.reduce((s, p) => s + p.activeBars.length, 0);
  return clamp01(active / (parts.length * grid.totalBars));
}
