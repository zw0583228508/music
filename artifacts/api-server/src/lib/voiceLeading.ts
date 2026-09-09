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

// ---------------------------------------------------------------------------
// Chords
// ---------------------------------------------------------------------------

const ROOTS: Record<string, number> = {
  C: 0, "C#": 1, DB: 1, D: 2, "D#": 3, EB: 3, E: 4, F: 5, "F#": 6, GB: 6,
  G: 7, "G#": 8, AB: 8, A: 9, "A#": 10, BB: 10, B: 11,
};

export type ChordToneRole = "root" | "third" | "fifth" | "seventh";

export type ChordTones = {
  symbol: string;
  root: number;
  /** Pitch class to role. A voice's role decides whether doubling it is good. */
  roles: Map<number, ChordToneRole>;
  pitchClasses: number[];
  /** The pitch class that must be lowest, from a slash chord. Null means any. */
  requiredBass: number | null;
  quality: "major" | "minor" | "diminished" | "augmented" | "suspended";
};

const normalise = (symbol: string): string =>
  symbol.replace(/♯/g, "#").replace(/♭/g, "b").trim();

function rootOf(text: string): { pitchClass: number; rest: string } | null {
  const match = /^([A-Ga-g])([#b]?)/.exec(text);
  if (!match) return null;
  const pitchClass = ROOTS[`${match[1].toUpperCase()}${match[2].toUpperCase()}`];
  if (pitchClass === undefined) return null;
  return { pitchClass, rest: text.slice(match[0].length) };
}

/**
 * Chord tones with their roles. Roles matter because doubling is not a free
 * choice: doubling the root is idiomatic, doubling the third is thin, and
 * doubling the seventh of a dominant chord fights its own resolution.
 */
export function parseChordTones(symbol: string): ChordTones | null {
  const text = normalise(symbol);
  const [body, slash] = text.split("/");
  const parsed = rootOf(body);
  if (!parsed) return null;
  const { pitchClass: root, rest } = parsed;
  const q = rest.toLowerCase();

  const quality: ChordTones["quality"] =
    q.includes("dim") || q.startsWith("°") ? "diminished"
      : q.includes("aug") || q.startsWith("+") ? "augmented"
        : q.startsWith("sus") ? "suspended"
          : q.startsWith("m") && !q.startsWith("maj") ? "minor"
            : "major";

  const third = quality === "minor" || quality === "diminished" ? 3
    : quality === "suspended" ? (q.includes("sus2") ? 2 : 5)
      : 4;
  const fifth = quality === "diminished" ? 6 : quality === "augmented" ? 8 : 7;

  const roles = new Map<number, ChordToneRole>();
  roles.set(root, "root");
  roles.set((root + third) % 12, "third");
  roles.set((root + fifth) % 12, "fifth");
  if (/(^|[^s])7|9|11|13/.test(q)) {
    // A diminished seventh is a diminished seventh; maj7 is a major seventh;
    // everything else in this vocabulary is minor.
    const seventh = q.includes("maj7") || q.includes("ma7") || q.includes("M7") ? 11
      : quality === "diminished" && q.includes("dim7") ? 9
        : 10;
    roles.set((root + seventh) % 12, "seventh");
  }

  let requiredBass: number | null = null;
  if (slash) {
    const bass = rootOf(normalise(slash));
    if (bass) requiredBass = bass.pitchClass;
  }

  return {
    symbol,
    root,
    roles,
    pitchClasses: [...roles.keys()],
    requiredBass,
    quality,
  };
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

function doublingCost(pitches: number[], chord: ChordTones, weight: number): number {
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
    const penalty = role === "root" ? 0 : role === "fifth" ? 0.5 : 1;
    cost += penalty * (count - 1) * weight;
  }
  return cost;
}

/**
 * Admissible voicings of one chord: in range, not crossed, spaced like a chord,
 * containing only chord tones, and with the required bass when one is named.
 */
export function candidateVoicings(
  chord: ChordTones,
  voices: Voice[],
  options: { cap?: number; weights?: VoiceLeadingWeights } = {},
): { candidates: number[][]; capped: boolean } {
  const weights = options.weights ?? DEFAULT_WEIGHTS;
  const perVoice = voices.map((voice) =>
    chord.pitchClasses
      .flatMap((pc) => pitchesInRange(pc, voice.range))
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
      if (index >= 2 && below !== undefined && pitch - below > MAX_UPPER_SPACING) continue;
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
    .map((pitches) => ({ pitches, cost: doublingCost(pitches, chord, weights.awkwardDoubling) }))
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

  cost += doublingCost(to, chord, weights.awkwardDoubling);
  return { cost: Number(cost.toFixed(4)), reasons };
}

// ---------------------------------------------------------------------------
// The search
// ---------------------------------------------------------------------------

/**
 * The cheapest assignment of voicings across the whole progression.
 *
 * Dynamic programming, one layer per chord: for each candidate at chord i, keep
 * the cheapest way to have arrived there. Because every cost is adjacent-only,
 * that is the global optimum, not a good guess — and it costs
 * `chords × candidates²` rather than `candidates^chords`.
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

  const first = layers[0];
  let costs: number[] = first.candidates.map((pitches) => {
    const base = doublingCost(pitches, first.chord, weights.awkwardDoubling);
    if (!problem.startFrom || problem.startFrom.length !== pitches.length) return base;
    // Continuing from a previous section is the same move as any other.
    return base + transitionCost(problem.startFrom, pitches, first.chord, weights).cost;
  });
  const backPointers: number[][] = [new Array(first.candidates.length).fill(-1)];
  const stepCosts: number[][] = [costs.map(() => 0)];
  const stepReasons: string[][][] = [first.candidates.map(() => [])];

  for (let layer = 1; layer < layers.length; layer += 1) {
    const previous = layers[layer - 1];
    const current = layers[layer];
    const next: number[] = new Array(current.candidates.length).fill(Infinity);
    const from: number[] = new Array(current.candidates.length).fill(-1);
    const paid: number[] = new Array(current.candidates.length).fill(0);
    const why: string[][] = new Array(current.candidates.length).fill(null).map(() => []);

    for (let c = 0; c < current.candidates.length; c += 1) {
      for (let p = 0; p < previous.candidates.length; p += 1) {
        if (!Number.isFinite(costs[p])) continue;
        const move = transitionCost(previous.candidates[p], current.candidates[c], current.chord, weights);
        const total = costs[p] + move.cost;
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

  const chosen: number[] = new Array(layers.length).fill(0);
  chosen[layers.length - 1] = best;
  for (let layer = layers.length - 1; layer > 0; layer -= 1) {
    chosen[layer - 1] = backPointers[layer][chosen[layer]];
  }

  const voicings: SolvedVoicing[] = layers.map((layer, index) => {
    const pitches = layer.candidates[chosen[index]];
    const reasons = stepReasons[index][chosen[index]] ?? [];
    return {
      bar: layer.bar,
      symbol: layer.symbol,
      pitches,
      transitionCost: index === 0 ? 0 : stepCosts[index][chosen[index]],
      rationale: index === 0
        ? "opening voicing, chosen for spacing and doubling"
        : reasons.length ? reasons.join("; ") : "smooth motion, no rule broken",
    };
  });

  return {
    status: "solved",
    voicings,
    totalCost: Number(costs[best].toFixed(4)),
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
