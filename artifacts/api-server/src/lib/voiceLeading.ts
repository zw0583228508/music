/**
 * Voice-leading solver (Wave Q, Q-04).
 *
 * Choosing chord tones is not arranging. **Choosing which octave each voice
 * takes, and how each voice moves to the next chord, is.** Two arrangements can
 * use identical chord symbols and identical instruments and sound a century
 * apart, entirely because of this.
 *
 * The problem is an optimisation, and it is worth stating exactly which one:
 *
 *  - Hard constraints reject a voicing outright — out of range, voices crossed,
 *    spacing a singer cannot hold, a pitch that is not in the chord.
 *  - Soft costs are weighted and traded — total motion, parallel fifths and
 *    octaves, awkward leaps, doubling the wrong tone, throwing away a common
 *    tone.
 *
 * Every soft cost here depends on **one chord and the one before it**. That
 * makes the objective a chain, and a chain is solved exactly by dynamic
 * programming over the candidate voicings — not approximately, not greedily.
 * A greedy pass picks the cheapest step into chord 2 and pays for it at chord
 * 5; this does not, and that difference is audible.
 *
 * Where it stops being exact is stated rather than hidden. When a chord admits
 * more candidates than the cap, the worst are dropped before the search and the
 * result reports `optimality: "beam"` with the reason. A constraint spanning
 * non-adjacent chords ("no voice may sit on the same pitch four times in this
 * phrase") is outside a chain objective altogether, and would need a general
 * constraint solver; none is claimed here.
 */
import type { HarmonyPlanSlot } from "./partGenerationContextV2";
import { parseChord, type ChordToneRole as SymbolToneRole, type ParsedChord } from "./chordSymbols";

// ---------------------------------------------------------------------------
// Chords
// ---------------------------------------------------------------------------

/**
 * Roles a voice may hold. Doubling rules read them: the root doubles freely,
 * the fifth tolerably, the third is thin and the seventh (and every extension,
 * which behaves like one) fights its own resolution.
 */
export type ChordToneRole = SymbolToneRole;

export type ChordTones = {
  symbol: string;
  root: number;
  /** Pitch class to role. A voice's role decides whether doubling it is good. */
  roles: Map<number, ChordToneRole>;
  pitchClasses: number[];
  /** The pitch class that must be lowest, from a slash chord. Null means any. */
  requiredBass: number | null;
  quality: "major" | "minor" | "diminished" | "augmented" | "suspended";
  /** The full reading (Brain B-02): extensions, alterations, template. */
  parsed: ParsedChord;
};

const QUALITY_OF: Record<ParsedChord["triad"], ChordTones["quality"]> = {
  maj: "major", min: "minor", dim: "diminished", aug: "augmented", sus4: "suspended", sus2: "suspended", power: "major",
};

/** The solver's view of a parsed chord. */
export function chordTonesOf(parsed: ParsedChord, options: { requireBass?: boolean } = {}): ChordTones {
  const requireBass = options.requireBass ?? true;
  return {
    symbol: parsed.input,
    root: parsed.root,
    roles: new Map(parsed.roles),
    pitchClasses: [...parsed.pitchClasses],
    requiredBass: requireBass && parsed.bass !== parsed.root ? parsed.bass : null,
    quality: QUALITY_OF[parsed.triad],
    parsed,
  };
}

/**
 * Chord tones with their roles, read by the one parser (`chordSymbols.ts`).
 * Kept as the solver's entry point so its callers and tests do not change.
 */
export function parseChordTones(symbol: string): ChordTones | null {
  const parsed = parseChord(symbol);
  return parsed ? chordTonesOf(parsed) : null;
}

// ---------------------------------------------------------------------------
// The problem
// ---------------------------------------------------------------------------

export type Voice = {
  name: string;
  /** Inclusive MIDI bounds. A voice outside them is not a preference, it is silent. */
  range: { min: number; max: number };
};

/** Voices low to high. SATB with real choral ranges. */
export const SATB: Voice[] = [
  { name: "bass", range: { min: 40, max: 62 } },
  { name: "tenor", range: { min: 48, max: 69 } },
  { name: "alto", range: { min: 53, max: 74 } },
  { name: "soprano", range: { min: 60, max: 81 } },
];

export type VoiceLeadingWeights = {
  /** Per semitone, summed over voices. The backbone of smooth writing. */
  motion: number;
  /** Two voices keeping a perfect fifth or octave in similar motion. */
  parallelPerfect: number;
  /** Per semitone beyond the comfortable leap. */
  largeLeap: number;
  /** Outer voices arriving at a perfect interval in similar motion. */
  directPerfect: number;
  /** Doubling something other than the root. */
  awkwardDoubling: number;
  /** Reward, subtracted: a voice that holds a shared pitch class. */
  commonTone: number;
};

export const DEFAULT_WEIGHTS: VoiceLeadingWeights = {
  motion: 1,
  // Deliberately heavier than any single step. A parallel fifth is not a
  // slightly worse choice; it is the thing the writing is trying to avoid.
  parallelPerfect: 14,
  largeLeap: 2,
  directPerfect: 5,
  awkwardDoubling: 3,
  commonTone: 2,
};

/** Beyond this, a leap needs a reason; the cost grows per semitone after it. */
export const COMFORTABLE_LEAP = 7;

/** Adjacent upper voices beyond an octave apart stop sounding like one chord. */
export const MAX_UPPER_SPACING = 12;

export type VoiceLeadingProblem = {
  chords: Array<{ bar: number; symbol: string }>;
  voices?: Voice[];
  weights?: Partial<VoiceLeadingWeights>;
  /** Voicings retained per chord. Above it the search reports itself as a beam. */
  candidateCap?: number;
  /** Pitches to start from, e.g. the end of the previous section. */
  startFrom?: number[];
};

export type SolvedVoicing = {
  bar: number;
  symbol: string;
  /** One pitch per voice, low to high. */
  pitches: number[];
  /** Cost of arriving here from the previous chord. 0 for the first. */
  transitionCost: number;
  rationale: string;
};

export type VoiceLeadingSolution = {
  status: "solved";
  voicings: SolvedVoicing[];
  totalCost: number;
  /** "exact": the best assignment over all admissible voicings. */
  optimality: "exact" | "beam";
  /** Present when optimality is "beam": which chords were capped. */
  notes: string[];
} | {
  status: "unsolvable";
  /** The first chord with no admissible voicing, and why. */
  reason: string;
  notes: string[];
};

// ---------------------------------------------------------------------------
// Candidate voicings
// ---------------------------------------------------------------------------

/** Every pitch of `pitchClass` inside a voice's range. */
function pitchesInRange(pitchClass: number, range: { min: number; max: number }): number[] {
  const found: number[] = [];
  let pitch = pitchClass + 12 * Math.ceil((range.min - pitchClass) / 12);
  for (; pitch <= range.max; pitch += 12) found.push(pitch);
  return found;
}

/** Cost per extra doubling of a role, relative to the `awkwardDoubling` weight. */
export type DoublingPreferences = Partial<Record<ChordToneRole, number>>;

export const DEFAULT_DOUBLING: DoublingPreferences = {
  root: 0, fifth: 0.5, third: 1, seventh: 1, sixth: 1, ninth: 1, eleventh: 1, thirteenth: 1, suspension: 1,
};

function doublingCost(pitches: number[], chord: ChordTones, weight: number, preferences: DoublingPreferences = DEFAULT_DOUBLING): number {
  const counts = new Map<number, number>();
  for (const pitch of pitches) {
    const pc = ((pitch % 12) + 12) % 12;
    counts.set(pc, (counts.get(pc) ?? 0) + 1);
  }
  let cost = 0;
  for (const [pc, count] of counts) {
    if (count < 2) continue;
    const role = chord.roles.get(pc);
    // The root may be doubled freely; the fifth tolerably; the third is thin
    // and the seventh wants to resolve, so doubling either is paid for.
    const penalty = role === undefined ? 1 : preferences[role] ?? DEFAULT_DOUBLING[role] ?? 1;
    cost += penalty * (count - 1) * weight;
  }
  return cost;
}

export type CandidateOptions = {
  cap?: number;
  weights?: VoiceLeadingWeights;
  doubling?: DoublingPreferences;
  /** Widest interval allowed between adjacent voices from `spacingFromIndex` up (default an octave from the tenor). */
  maxSpacing?: number;
  /** First voice index the spacing rule applies to (default 2: bass to tenor may be wide). */
  spacingFromIndex?: number;
  /** Widest interval between the two lowest voices (default unlimited). */
  maxBassSpacing?: number;
  /** The lowest voice may not sit below this pitch (a planned bass owns the octave beneath). */
  floor?: number;
  /** Rank capped candidates by this static cost in addition to doubling. */
  unary?: (pitches: number[]) => number;
};

/**
 * Admissible voicings of one chord: in range, not crossed, spaced like a chord,
 * containing only chord tones, and with the required bass when one is named.
 */
export function candidateVoicings(
  chord: ChordTones,
  voices: Voice[],
  options: CandidateOptions = {},
): { candidates: number[][]; capped: boolean } {
  const weights = options.weights ?? DEFAULT_WEIGHTS;
  const maxSpacing = options.maxSpacing ?? MAX_UPPER_SPACING;
  const spacingFrom = options.spacingFromIndex ?? 2;
  const perVoice = voices.map((voice) =>
    chord.pitchClasses
      .flatMap((pc) => pitchesInRange(pc, voice.range))
      .filter((pitch) => options.floor === undefined || pitch >= options.floor)
      .sort((a, b) => a - b));

  const results: number[][] = [];
  const current: number[] = [];

  const walk = (index: number): void => {
    if (index === voices.length) {
      // Every chord tone must sound somewhere, or it is a different chord.
      const sounding = new Set(current.map((p) => ((p % 12) + 12) % 12));
      if (chord.pitchClasses.every((pc) => sounding.has(pc)) || voices.length < chord.pitchClasses.length) {
        results.push([...current]);
      }
      return;
    }
    for (const pitch of perVoice[index]) {
      const below = current[index - 1];
      // Voices may share a pitch but never cross: a crossed pair stops being
      // two lines a listener can follow.
      if (below !== undefined && pitch < below) continue;
      // Spacing applies between the upper voices; bass to tenor may be wide.
      if (index >= spacingFrom && below !== undefined && pitch - below > maxSpacing) continue;
      if (index === 1 && options.maxBassSpacing !== undefined && below !== undefined && pitch - below > options.maxBassSpacing) continue;
      if (index === 0 && chord.requiredBass !== null && ((pitch % 12) + 12) % 12 !== chord.requiredBass) continue;
      current.push(pitch);
      walk(index + 1);
      current.pop();
    }
  };
  walk(0);

  const cap = options.cap ?? 400;
  if (results.length <= cap) return { candidates: results, capped: false };
  // Over the cap the cheapest-standing voicings are kept. This is where the
  // search stops being exact, and the caller is told so.
  const ranked = results
    .map((pitches) => ({ pitches, cost: doublingCost(pitches, chord, weights.awkwardDoubling, options.doubling) + (options.unary?.(pitches) ?? 0) }))
    .sort((a, b) => a.cost - b.cost)
    .slice(0, cap)
    .map((entry) => entry.pitches);
  return { candidates: ranked, capped: true };
}

// ---------------------------------------------------------------------------
// The cost of one move
// ---------------------------------------------------------------------------

const PERFECT = new Set([0, 7]);

/**
 * What it costs to move from one voicing to the next. Adjacent-only by
 * construction — that is what makes the whole problem exactly solvable.
 */
export function transitionCost(
  from: number[],
  to: number[],
  chord: ChordTones,
  weights: VoiceLeadingWeights,
  doubling: DoublingPreferences = DEFAULT_DOUBLING,
): { cost: number; reasons: string[] } {
  const reasons: string[] = [];
  let cost = 0;

  let motion = 0;
  let leapCost = 0;
  let held = 0;
  for (let i = 0; i < to.length; i += 1) {
    const distance = Math.abs(to[i] - from[i]);
    motion += distance;
    if (distance === 0) held += 1;
    else if (distance > COMFORTABLE_LEAP) leapCost += (distance - COMFORTABLE_LEAP) * weights.largeLeap;
  }
  cost += motion * weights.motion + leapCost;
  if (leapCost > 0) reasons.push("leap beyond a comfortable interval");
  // A voice that can stay, staying, is the single most idiomatic move there is.
  cost -= held * weights.commonTone;
  if (held > 0) reasons.push(`${held} common tone(s) held`);

  for (let a = 0; a < to.length; a += 1) {
    for (let b = a + 1; b < to.length; b += 1) {
      const before = Math.abs(from[a] - from[b]) % 12;
      const after = Math.abs(to[a] - to[b]) % 12;
      const movedA = to[a] - from[a];
      const movedB = to[b] - from[b];
      const similar = movedA !== 0 && movedB !== 0 && Math.sign(movedA) === Math.sign(movedB);
      if (similar && PERFECT.has(before) && before === after) {
        cost += weights.parallelPerfect;
        reasons.push(`parallel ${before === 0 ? "octave" : "fifth"}`);
      }
    }
  }

  // Direct (hidden) perfect intervals between the outer voices, reached by
  // similar motion with the top voice leaping. Softer than a true parallel.
  if (to.length >= 2) {
    const top = to.length - 1;
    const movedBass = to[0] - from[0];
    const movedTop = to[top] - from[top];
    const outer = Math.abs(to[top] - to[0]) % 12;
    if (
      movedBass !== 0 && movedTop !== 0 &&
      Math.sign(movedBass) === Math.sign(movedTop) &&
      PERFECT.has(outer) &&
      Math.abs(movedTop) > 2
    ) {
      cost += weights.directPerfect;
      reasons.push("direct perfect interval in the outer voices");
    }
  }

  cost += doublingCost(to, chord, weights.awkwardDoubling, doubling);
  return { cost: Number(cost.toFixed(4)), reasons };
}

// ---------------------------------------------------------------------------
// The search
// ---------------------------------------------------------------------------

export type ChainSolution = {
  /** Index of the chosen candidate per layer. */
  chosen: number[];
  totalCost: number;
  /** Cost paid to arrive at each layer's choice (0 for the first unless `startFrom`). */
  stepCosts: number[];
  stepReasons: string[][];
};

/**
 * The cheapest path through layers of candidates when every cost is either a
 * property of one candidate (`unary`) or of two adjacent ones (`pairwise`).
 * Dynamic programming, one layer per chord: for each candidate at layer i,
 * keep the cheapest way to have arrived there. That is the global optimum,
 * not a good guess, and it costs layers x candidates^2 rather than
 * candidates^layers. Generic over the candidate type so a bass line (one
 * pitch per chord) and a voicing (one pitch per voice) use one solver.
 */
export function solveChain<T>(problem: {
  layers: ReadonlyArray<ReadonlyArray<T>>;
  unary: (candidate: T, layer: number) => number;
  pairwise: (from: T, to: T, layer: number) => { cost: number; reasons: string[] };
  startFrom?: T;
}): ChainSolution | null {
  const { layers } = problem;
  if (!layers.length || layers.some((layer) => layer.length === 0)) return null;
  const opening = layers[0].map((candidate) =>
    problem.startFrom === undefined ? { cost: 0, reasons: [] as string[] } : problem.pairwise(problem.startFrom, candidate, 0));
  let costs: number[] = layers[0].map((candidate, i) => problem.unary(candidate, 0) + opening[i].cost);
  const backPointers: number[][] = [new Array(layers[0].length).fill(-1)];
  const stepCosts: number[][] = [opening.map((o) => o.cost)];
  const stepReasons: string[][][] = [opening.map((o) => o.reasons)];

  for (let layer = 1; layer < layers.length; layer += 1) {
    const previous = layers[layer - 1];
    const current = layers[layer];
    const next: number[] = new Array(current.length).fill(Infinity);
    const from: number[] = new Array(current.length).fill(-1);
    const paid: number[] = new Array(current.length).fill(0);
    const why: string[][] = new Array(current.length).fill(null).map(() => []);
    for (let c = 0; c < current.length; c += 1) {
      const here = problem.unary(current[c], layer);
      for (let p = 0; p < previous.length; p += 1) {
        if (!Number.isFinite(costs[p])) continue;
        const move = problem.pairwise(previous[p], current[c], layer);
        const total = costs[p] + move.cost + here;
        if (total < next[c]) {
          next[c] = total;
          from[c] = p;
          paid[c] = move.cost;
          why[c] = move.reasons;
        }
      }
    }
    costs = next;
    backPointers.push(from);
    stepCosts.push(paid);
    stepReasons.push(why);
  }

  let best = 0;
  for (let i = 1; i < costs.length; i += 1) if (costs[i] < costs[best]) best = i;
  if (!Number.isFinite(costs[best])) return null;
  const chosen: number[] = new Array(layers.length).fill(0);
  chosen[layers.length - 1] = best;
  for (let layer = layers.length - 1; layer > 0; layer -= 1) chosen[layer - 1] = backPointers[layer][chosen[layer]];
  return {
    chosen,
    totalCost: Number(costs[best].toFixed(4)),
    stepCosts: chosen.map((c, layer) => stepCosts[layer][c]),
    stepReasons: chosen.map((c, layer) => stepReasons[layer][c] ?? []),
  };
}

/**
 * The cheapest assignment of voicings across the whole progression - the
 * SATB entry point, now a thin caller of `solveChain`.
 */
export function solveVoiceLeading(problem: VoiceLeadingProblem): VoiceLeadingSolution {
  const voices = problem.voices ?? SATB;
  const weights = { ...DEFAULT_WEIGHTS, ...problem.weights };
  const cap = problem.candidateCap ?? 400;
  const notes: string[] = [];

  if (!problem.chords.length) {
    return { status: "unsolvable", reason: "the progression is empty", notes };
  }

  const layers: Array<{ bar: number; symbol: string; chord: ChordTones; candidates: number[][] }> = [];
  for (const entry of problem.chords) {
    const chord = parseChordTones(entry.symbol);
    if (!chord) {
      return { status: "unsolvable", reason: `"${entry.symbol}" at bar ${entry.bar} is not a chord this solver reads`, notes };
    }
    const { candidates, capped } = candidateVoicings(chord, voices, { cap, weights });
    if (!candidates.length) {
      // Saying which chord and why beats returning an empty result: the usual
      // cause is a voice range that cannot hold this chord at all.
      return {
        status: "unsolvable",
        reason: `no voicing of ${entry.symbol} at bar ${entry.bar} fits the voice ranges without crossing`,
        notes,
      };
    }
    if (capped) {
      notes.push(`bar ${entry.bar} (${entry.symbol}): candidates capped at ${cap}, so the result is optimal among those kept`);
    }
    layers.push({ bar: entry.bar, symbol: entry.symbol, chord, candidates });
  }

  const startFrom = problem.startFrom && problem.startFrom.length === voices.length ? problem.startFrom : undefined;
  const solved = solveChain<number[]>({
    layers: layers.map((layer) => layer.candidates),
    unary: (pitches, index) => doublingCost(pitches, layers[index].chord, weights.awkwardDoubling),
    pairwise: (from, to, index) => transitionCost(from, to, layers[index].chord, weights),
    startFrom,
  });
  if (!solved) {
    return { status: "unsolvable", reason: "no path through the candidate voicings", notes };
  }

  const voicings: SolvedVoicing[] = layers.map((layer, index) => {
    const pitches = layer.candidates[solved.chosen[index]];
    const reasons = solved.stepReasons[index];
    return {
      bar: layer.bar,
      symbol: layer.symbol,
      pitches,
      transitionCost: index === 0 && startFrom === undefined ? 0 : solved.stepCosts[index],
      rationale: index === 0
        ? "opening voicing, chosen for spacing and doubling"
        : reasons.length ? reasons.join("; ") : "smooth motion, no rule broken",
    };
  });

  return {
    status: "solved",
    voicings,
    totalCost: solved.totalCost,
    optimality: notes.length ? "beam" : "exact",
    notes,
  };
}

export const HARMONY_PLAN_VERSION = "HARMONY_PLAN_V1_VOICE_LEADING" as const;

/**
 * The solution as the Q-04 slot a `PartGenerationRequestV2` carries. An
 * unsolvable progression fills the slot with its reason rather than with
 * nothing: a composer that is told why there is no plan can still write; one
 * handed an empty plan cannot tell it apart from a plan that says play nothing.
 */
export function harmonyPlanSlot(solution: VoiceLeadingSolution): HarmonyPlanSlot {
  if (solution.status !== "solved") {
    return { status: "not_available", reason: `voice leading could not be solved: ${solution.reason}` };
  }
  return {
    status: "available",
    // The version records how the voicings were reached, including whether the
    // search was exact — a beam result must not be read as a proof.
    version: `${HARMONY_PLAN_VERSION}:${solution.optimality}`,
    voicings: solution.voicings.map((voicing) => ({
      bar: voicing.bar,
      pitches: voicing.pitches,
      rationale: voicing.rationale,
    })),
  };
}
