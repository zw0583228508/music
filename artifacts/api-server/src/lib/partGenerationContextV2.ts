/**
 * Part generation request V2 (Wave Q, Q-03).
 *
 * V1 tells a part composer what the song is. It does not tell it what the other
 * players are doing. `existingParts` carries `{ instrument, role, noteCount }` —
 * a count. You cannot voice against a count. You cannot stay out of the singer's
 * way, answer a horn line, or leave the low end to the bass, if all you know is
 * that eleven notes exist somewhere.
 *
 * That is the whole gap between a part that is individually correct and an
 * arrangement. This module closes it additively: `PartGenerationRequestV2`
 * extends V1 rather than replacing it, so every existing composer keeps working
 * and the orchestrator's injected `composeParts` seam is untouched.
 *
 * What it adds, and why each one is a decision a real arranger makes:
 *
 *  - **siblingParts** — the actual notes already written. Register, onsets and
 *    all. This is what "arranging" reads.
 *  - **vocalAttentionMap** — where the voice is, and where it is not. Fills go
 *    in the gaps. Nothing else in the contract says where the gaps are.
 *  - **motifMemory** — the cells this song has already established, so a part
 *    can quote the song instead of inventing a fourth unrelated idea.
 *  - **previousSectionSummary / nextSectionIntent** — a section is a step in a
 *    shape. Writing it without knowing where it came from and where it must
 *    arrive produces eight correct bars that go nowhere.
 *  - **hard / soft constraints** — V1 mixes "physically impossible" with
 *    "stylistically wrong". A composer must be able to break the second under
 *    pressure and never the first.
 *  - **lockedMaterial** — what the producer kept. It survives regeneration.
 *  - **candidateStrategy** — how candidates should differ, so a ranker sees
 *    real alternatives instead of three shades of the same take.
 *
 * Slots for `styleGrammar` (Q-02) and `harmonyPlan` (Q-04) are declared here
 * and default to an explicit "not available". A slot that says it is empty is
 * honest; a missing field would be read as "nothing to say".
 */
import type { ChordHarmonyEvent, MusicalNote } from "@workspace/db";
import type { PartGenerationRequest } from "./partComposer";

export const PART_REQUEST_V2 = "PART_GENERATION_REQUEST_V2" as const;

/**
 * Analysed material — the melody and bass this request carries — is a span with
 * an end. Composed material is a `MusicalNote` with a duration. Both describe a
 * pitch over time, and the arranging questions here are the same for either, so
 * they are read through one shape rather than duplicated.
 */
export type TimedPitch = { start: number; end: number; pitch: number };

export const asTimedPitch = (note: MusicalNote): TimedPitch => ({
  start: note.start,
  end: note.start + note.duration,
  pitch: note.pitch,
});

// ---------------------------------------------------------------------------
// Sibling parts: the notes, not the count
// ---------------------------------------------------------------------------

export type SiblingPart = {
  instrument: string;
  role: string;
  /** What was actually written. Empty means written and silent, which is a choice. */
  notes: MusicalNote[];
  noteCount: number;
  /** Null when the part has no notes: an absent register is not register 0. */
  register: { min: number; max: number; median: number } | null;
  /** Onset times, sorted. A part answers another part by placing notes between its onsets. */
  onsets: number[];
  /** Share of the window in which this part is sounding, 0..1. */
  occupancy: number;
};

const median = (values: number[]): number => {
  const sorted = [...values].sort((a, b) => a - b);
  const middle = sorted.length >> 1;
  return sorted.length % 2 ? sorted[middle] : (sorted[middle - 1] + sorted[middle]) / 2;
};

/** Total time covered by these spans, counting overlaps once. */
export function coveredSeconds(spans: Array<{ start: number; end: number }>): number {
  const sorted = [...spans].filter((s) => s.end > s.start).sort((a, b) => a.start - b.start);
  let total = 0;
  let cursor = -Infinity;
  for (const span of sorted) {
    const from = Math.max(span.start, cursor);
    if (span.end > from) {
      total += span.end - from;
      cursor = span.end;
    }
  }
  return total;
}

export function describeSiblingPart(
  part: { instrument: string; role: string; notes: readonly MusicalNote[] },
  window: { start: number; end: number },
): SiblingPart {
  const span = Math.max(1e-6, window.end - window.start);
  const notes = part.notes
    .filter((n) => n.start + n.duration > window.start && n.start < window.end)
    .sort((a, b) => a.start - b.start);
  const pitches = notes.map((n) => n.pitch);
  return {
    instrument: part.instrument,
    role: part.role,
    notes,
    noteCount: notes.length,
    register: pitches.length
      ? { min: Math.min(...pitches), max: Math.max(...pitches), median: median(pitches) }
      : null,
    onsets: notes.map((n) => Number(n.start.toFixed(4))),
    occupancy: Number(
      Math.min(
        1,
        coveredSeconds(notes.map((n) => ({ start: n.start, end: n.start + n.duration }))) / span,
      ).toFixed(4),
    ),
  };
}

// ---------------------------------------------------------------------------
// Vocal attention: where the voice is, and where it is not
// ---------------------------------------------------------------------------

/**
 * A gap shorter than this is a breath, not an invitation. Anything an arranger
 * would call a fill needs roughly half a bar at a moderate tempo; below that,
 * playing into it crowds the singer instead of answering them.
 */
export const MIN_FILL_SECONDS = 0.75;

/** Above this share of the window, the voice owns the section and parts support. */
export const VOCAL_DENSE_OCCUPANCY = 0.7;

export type VocalAttentionMap = {
  /** Explicit when there is no vocal at all: an instrumental is not a silent singer. */
  status: "vocal" | "no_vocal";
  occupied: Array<{ start: number; end: number }>;
  gaps: Array<{ start: number; end: number; seconds: number }>;
  /** Gaps long enough to answer into. The only place a fill belongs. */
  fillWindows: Array<{ start: number; end: number; seconds: number }>;
  /** Null with no vocal. Parts crowd a singer by sitting in this range. */
  register: { min: number; max: number; median: number } | null;
  occupancy: number;
  /** True when the voice is carrying the section and everything else accompanies. */
  dense: boolean;
};

export function buildVocalAttentionMap(
  melody: readonly TimedPitch[],
  window: { start: number; end: number },
  minFillSeconds = MIN_FILL_SECONDS,
): VocalAttentionMap {
  const span = Math.max(1e-6, window.end - window.start);
  const sung = melody
    .filter((n) => n.end > window.start && n.start < window.end)
    .map((n) => ({
      start: Math.max(window.start, n.start),
      end: Math.min(window.end, n.end),
      pitch: n.pitch,
    }))
    .sort((a, b) => a.start - b.start);

  if (!sung.length) {
    return {
      status: "no_vocal",
      occupied: [],
      // The whole window is open, and saying so is the point: an instrumental
      // section is where a part may lead rather than accompany.
      gaps: [{ start: window.start, end: window.end, seconds: Number(span.toFixed(4)) }],
      fillWindows: span >= minFillSeconds
        ? [{ start: window.start, end: window.end, seconds: Number(span.toFixed(4)) }]
        : [],
      register: null,
      occupancy: 0,
      dense: false,
    };
  }

  // Merge overlaps first: two singers on one line is still one voice to stay out of.
  const occupied: Array<{ start: number; end: number }> = [];
  for (const note of sung) {
    const last = occupied.at(-1);
    if (last && note.start <= last.end + 1e-6) last.end = Math.max(last.end, note.end);
    else occupied.push({ start: note.start, end: note.end });
  }

  const gaps: VocalAttentionMap["gaps"] = [];
  let cursor = window.start;
  for (const block of occupied) {
    if (block.start - cursor > 1e-6) {
      gaps.push({ start: cursor, end: block.start, seconds: Number((block.start - cursor).toFixed(4)) });
    }
    cursor = Math.max(cursor, block.end);
  }
  if (window.end - cursor > 1e-6) {
    gaps.push({ start: cursor, end: window.end, seconds: Number((window.end - cursor).toFixed(4)) });
  }

  const pitches = sung.map((n) => n.pitch);
  const occupancy = Number(Math.min(1, coveredSeconds(occupied) / span).toFixed(4));
  return {
    status: "vocal",
    occupied: occupied.map((b) => ({ start: Number(b.start.toFixed(4)), end: Number(b.end.toFixed(4)) })),
    gaps,
    fillWindows: gaps.filter((g) => g.seconds >= minFillSeconds),
    register: { min: Math.min(...pitches), max: Math.max(...pitches), median: median(pitches) },
    occupancy,
    dense: occupancy >= VOCAL_DENSE_OCCUPANCY,
  };
}

// ---------------------------------------------------------------------------
// Motif memory: what this song has already said
// ---------------------------------------------------------------------------

export type Motif = {
  /** Interval steps in semitones, transposition-independent by construction. */
  intervals: number[];
  /** Inter-onset ratios, so the cell is recognisable at any tempo. */
  rhythm: number[];
  occurrences: number;
  firstStart: number;
};

/** Below three notes a cell is an interval, not a motif. */
const MOTIF_LENGTH = 3;

/**
 * Recurring cells in the melody, most frequent first. Intervals rather than
 * pitches, so a motif is recognised when it returns transposed — which is how
 * songs actually restate them.
 */
export function buildMotifMemory(melody: readonly TimedPitch[], limit = 4): Motif[] {
  const notes = [...melody].sort((a, b) => a.start - b.start);
  if (notes.length <= MOTIF_LENGTH) return [];
  const found = new Map<string, Motif>();
  for (let i = 0; i + MOTIF_LENGTH <= notes.length; i += 1) {
    const cell = notes.slice(i, i + MOTIF_LENGTH);
    const intervals: number[] = [];
    const spacing: number[] = [];
    for (let j = 1; j < cell.length; j += 1) {
      intervals.push(cell[j].pitch - cell[j - 1].pitch);
      spacing.push(Math.max(1e-4, cell[j].start - cell[j - 1].start));
    }
    // Normalise the rhythm to its first gap: the shape, not the tempo.
    const rhythm = spacing.map((s) => Number((s / spacing[0]).toFixed(2)));
    const key = `${intervals.join(",")}|${rhythm.join(",")}`;
    const existing = found.get(key);
    if (existing) existing.occurrences += 1;
    else found.set(key, { intervals, rhythm, occurrences: 1, firstStart: Number(cell[0].start.toFixed(4)) });
  }
  return [...found.values()]
    .filter((motif) => motif.occurrences > 1)
    .sort((a, b) => b.occurrences - a.occurrences || a.firstStart - b.firstStart)
    .slice(0, limit);
}

// ---------------------------------------------------------------------------
// Where this section came from, and where it has to arrive
// ---------------------------------------------------------------------------

export type PreviousSectionSummary = {
  status: "available" | "none";
  sectionName: string | null;
  role: string | null;
  energy: number | null;
  density: number | null;
  chordSymbols: string[];
  melodyNoteCount: number;
  bassNoteCount: number;
  register: { min: number; max: number } | null;
};

export type NextSectionIntent = {
  status: "available" | "none";
  sectionName: string | null;
  role: string | null;
  energy: number | null;
  /** Positive means the next section is bigger: this one must leave room to grow. */
  energyDelta: number | null;
  densityDelta: number | null;
  noveltyVsPrevious: number | null;
  /** The arranging instruction that follows from the deltas. */
  approach: "build" | "sustain" | "clear_out" | "unknown";
};

type SectionTarget = PartGenerationRequest["globalPlan"]["sectionTargets"][number];

/** A move worth changing the writing for. Below it, the sections are the same size. */
const MEANINGFUL_ENERGY_DELTA = 0.08;

export function summarisePreviousSection(
  request: Pick<PartGenerationRequest, "context" | "globalPlan" | "section">,
): PreviousSectionSummary {
  const targets = request.globalPlan.sectionTargets;
  const index = targets.findIndex((t) => t.sectionName === request.section.sectionName);
  const previous: SectionTarget | undefined = index > 0 ? targets[index - 1] : undefined;
  const bars = request.context.previousBars;
  const pitches = [...bars.melody, ...bars.bass].map((n) => n.pitch);
  if (!previous && !bars.melody.length && !bars.bass.length && !bars.chords.length) {
    // The first section of the song has no history, and inventing one would
    // make every opening sound like a continuation.
    return {
      status: "none", sectionName: null, role: null, energy: null, density: null,
      chordSymbols: [], melodyNoteCount: 0, bassNoteCount: 0, register: null,
    };
  }
  return {
    status: "available",
    sectionName: previous?.sectionName ?? null,
    role: previous?.role ?? null,
    energy: previous?.energy ?? null,
    density: previous?.density ?? null,
    chordSymbols: bars.chords.map((c: ChordHarmonyEvent) => c.symbol),
    melodyNoteCount: bars.melody.length,
    bassNoteCount: bars.bass.length,
    register: pitches.length ? { min: Math.min(...pitches), max: Math.max(...pitches) } : null,
  };
}

export function deriveNextSectionIntent(
  request: Pick<PartGenerationRequest, "globalPlan" | "section">,
): NextSectionIntent {
  const targets = request.globalPlan.sectionTargets;
  const index = targets.findIndex((t) => t.sectionName === request.section.sectionName);
  const current = index >= 0 ? targets[index] : undefined;
  const next = index >= 0 ? targets[index + 1] : undefined;
  if (!next || !current) {
    return {
      status: "none", sectionName: null, role: null, energy: null,
      energyDelta: null, densityDelta: null, noveltyVsPrevious: null, approach: "unknown",
    };
  }
  const energyDelta = Number((next.energy - current.energy).toFixed(4));
  return {
    status: "available",
    sectionName: next.sectionName,
    role: next.role,
    energy: next.energy,
    energyDelta,
    densityDelta: Number((next.density - current.density).toFixed(4)),
    noveltyVsPrevious: next.noveltyVsPrevious,
    // A section before a bigger one must not already be full, or the lift has
    // nowhere to come from. A section before a smaller one may stay full.
    approach: energyDelta > MEANINGFUL_ENERGY_DELTA
      ? "build"
      : energyDelta < -MEANINGFUL_ENERGY_DELTA
        ? "clear_out"
        : "sustain",
  };
}

// ---------------------------------------------------------------------------
// Constraints a composer may break, and constraints it may not
// ---------------------------------------------------------------------------

export type HardConstraint = {
  id: string;
  /** Physically impossible, contractually fixed, or already promised to the producer. */
  kind: "physical" | "range" | "budget" | "locked";
  description: string;
};

export type SoftConstraint = {
  id: string;
  kind: "style" | "texture" | "register" | "density";
  description: string;
  /** 0..1. Higher is stronger, none is absolute. */
  weight: number;
};

/**
 * V1's `constraints` block mixes both kinds. Splitting them is not tidying: a
 * composer under pressure must know which line it may cross. Playing outside an
 * instrument's range produces a part nobody can perform; playing denser than
 * the style prefers produces a part somebody may like.
 */
export function splitConstraints(
  request: Pick<PartGenerationRequest, "constraints" | "role" | "instrument">,
): { hard: HardConstraint[]; soft: SoftConstraint[] } {
  const { constraints } = request;
  const hard: HardConstraint[] = [
    {
      id: "playable-range",
      kind: "range",
      description: `${request.instrument} sounds only from ${constraints.playableRange.min} to ${constraints.playableRange.max}`,
    },
    {
      id: "max-simultaneous",
      kind: "physical",
      description: `at most ${constraints.maxSimultaneousNotes} notes may sound at once`,
    },
    {
      id: "min-duration",
      kind: "physical",
      description: `no note shorter than ${constraints.minNoteDuration}s`,
    },
    ...constraints.physicalRules.map((rule, index) => ({
      id: `physical-${index}`,
      kind: "physical" as const,
      description: rule,
    })),
  ];
  const soft: SoftConstraint[] = [
    {
      id: "comfortable-range",
      kind: "register",
      description: `stay within ${constraints.comfortableRange.min}–${constraints.comfortableRange.max} unless the line needs the extreme`,
      weight: 0.7,
    },
    {
      id: "max-leap",
      kind: "style",
      description: `leaps beyond ${constraints.maxLeap} semitones read as awkward on ${request.instrument}`,
      weight: 0.6,
    },
  ];
  return { hard, soft };
}

// ---------------------------------------------------------------------------
// Locked material and candidate strategy
// ---------------------------------------------------------------------------

export type LockedMaterial = {
  /** Notes the producer kept. They survive regeneration byte for byte. */
  notes: MusicalNote[];
  /** Time ranges a composer must not write into, derived from those notes. */
  frozenRanges: Array<{ start: number; end: number }>;
  reason: string | null;
};

export function lockedMaterialFrom(
  notes: readonly MusicalNote[],
  reason: string | null = null,
): LockedMaterial {
  const kept = [...notes].sort((a, b) => a.start - b.start);
  const frozenRanges: Array<{ start: number; end: number }> = [];
  for (const note of kept) {
    const last = frozenRanges.at(-1);
    const end = note.start + note.duration;
    if (last && note.start <= last.end + 1e-6) last.end = Math.max(last.end, end);
    else frozenRanges.push({ start: note.start, end });
  }
  return { notes: kept, frozenRanges, reason: kept.length ? reason : null };
}

export type CandidateStrategy = {
  count: number;
  /** What must differ between candidates, so a ranker sees real alternatives. */
  diversify: Array<"register" | "rhythm" | "density" | "articulation">;
  /** One per candidate, derived from the task seed so a run is reproducible. */
  seeds: number[];
};

export function candidateStrategy(seed: number, count = 3): CandidateStrategy {
  const seeds: number[] = [];
  let value = seed >>> 0;
  for (let i = 0; i < Math.max(1, count); i += 1) {
    // A fixed odd multiplier keeps candidates far apart and the run repeatable.
    value = (Math.imul(value, 1_664_525) + 1_013_904_223) >>> 0;
    seeds.push(value);
  }
  return {
    count: Math.max(1, count),
    diversify: ["register", "rhythm", "density"],
    seeds,
  };
}

// ---------------------------------------------------------------------------
// The slots Q-02 and Q-04 will fill
// ---------------------------------------------------------------------------

/**
 * A rule as a composer receives it.
 *
 * `directive` is the machine-readable half and is what a pass acts on. It was
 * added because the first version carried only a description, and the groove
 * pass had to parse the swing ratio back out of English prose — which is a
 * contract asking to be misread. `description` stays, for a decision ledger and
 * for anything a human reads.
 */
export type StyleGrammarRule = {
  id: string;
  description: string;
  weight: number;
  /** Absent only for a rule whose directive kind a reader does not know. */
  directive?: unknown;
};

export type StyleGrammarSlot =
  | { status: "not_available"; reason: string }
  | { status: "available"; version: string; rules: StyleGrammarRule[] };

export type HarmonyPlanSlot =
  | { status: "not_available"; reason: string }
  | {
      status: "available";
      version: string;
      /** Voice-leading targets per bar, filled by the Q-04 solver. */
      voicings: Array<{ bar: number; pitches: number[]; rationale: string }>;
    };

export const STYLE_GRAMMAR_PENDING: StyleGrammarSlot = {
  status: "not_available",
  reason: "Q-02 style grammar has not been built; no grammar rules exist to apply",
};

export const HARMONY_PLAN_PENDING: HarmonyPlanSlot = {
  status: "not_available",
  reason: "Q-04 harmony plan has not been built; no solved voicings exist to follow",
};

// ---------------------------------------------------------------------------
// The V2 request
// ---------------------------------------------------------------------------

export type PartGenerationRequestV2 = PartGenerationRequest & {
  requestVersion: typeof PART_REQUEST_V2;
  siblingParts: SiblingPart[];
  vocalAttentionMap: VocalAttentionMap;
  motifMemory: Motif[];
  previousSectionSummary: PreviousSectionSummary;
  nextSectionIntent: NextSectionIntent;
  hardConstraints: HardConstraint[];
  softConstraints: SoftConstraint[];
  lockedMaterial: LockedMaterial;
  candidateStrategy: CandidateStrategy;
  /** The brief this part answers to, by reference. Null when none was recorded. */
  productionBriefRef: string | null;
  styleGrammar: StyleGrammarSlot;
  harmonyPlan: HarmonyPlanSlot;
};

/**
 * Upgrades a V1 request in place. Everything V1 carried is preserved
 * unchanged, so a composer written against V1 reads a V2 request without
 * knowing it is one.
 */
export function upgradePartGenerationRequest(
  request: PartGenerationRequest,
  extras: {
    /** The parts already written, with their notes. */
    siblings?: Array<{ instrument: string; role: string; notes: readonly MusicalNote[] }>;
    /** Section bounds in seconds. Defaults to the current bars this request carries. */
    window?: { start: number; end: number };
    lockedNotes?: readonly MusicalNote[];
    lockedReason?: string | null;
    productionBriefRef?: string | null;
    candidateCount?: number;
    styleGrammar?: StyleGrammarSlot;
    harmonyPlan?: HarmonyPlanSlot;
  } = {},
): PartGenerationRequestV2 {
  const current = request.context.currentBars;
  const spans: Array<{ start: number; end: number }> = [
    ...current.chords.map((c) => ({ start: c.start, end: c.end })),
    ...current.melody.map((n) => ({ start: n.start, end: n.end })),
    ...current.bass.map((n) => ({ start: n.start, end: n.end })),
  ];
  const window = extras.window ?? {
    start: spans.length ? Math.min(...spans.map((s) => s.start)) : 0,
    end: spans.length ? Math.max(...spans.map((s) => s.end)) : 0,
  };
  const { hard, soft } = splitConstraints(request);
  return {
    ...request,
    requestVersion: PART_REQUEST_V2,
    siblingParts: (extras.siblings ?? []).map((part) => describeSiblingPart(part, window)),
    vocalAttentionMap: buildVocalAttentionMap(current.melody, window),
    motifMemory: buildMotifMemory(current.melody),
    previousSectionSummary: summarisePreviousSection(request),
    nextSectionIntent: deriveNextSectionIntent(request),
    hardConstraints: hard,
    softConstraints: soft,
    lockedMaterial: lockedMaterialFrom(extras.lockedNotes ?? [], extras.lockedReason ?? null),
    candidateStrategy: candidateStrategy(request.seed, extras.candidateCount),
    productionBriefRef: extras.productionBriefRef ?? null,
    styleGrammar: extras.styleGrammar ?? STYLE_GRAMMAR_PENDING,
    harmonyPlan: extras.harmonyPlan ?? HARMONY_PLAN_PENDING,
  };
}

/** True when this request carries the V2 context. Composers may branch on it. */
export function isPartGenerationRequestV2(
  request: PartGenerationRequest | PartGenerationRequestV2,
): request is PartGenerationRequestV2 {
  return (request as PartGenerationRequestV2).requestVersion === PART_REQUEST_V2;
}
