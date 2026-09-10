/**
 * Per-role voicing solver (Brain B-02, D3).
 *
 * The SATB solver in `voiceLeading.ts` knew four choral voices and one chord
 * per bar. Here the same exact chain search is run per instrument role with
 * the instrument's own voice set - three or four keys voices above a planned
 * bass, a string bed with the cello on the root or third, a single guide-tone
 * line for a monophonic brass part - on every chord event of the window,
 * with style-parameterised costs: motion, common tones, parallels, doubling,
 * spacing (close vs open), register target, low-interval mud, collision with
 * the planned bass and with sibling parts' notes, and clearance from the
 * singer when a melody is known. Two development operators are realised:
 * `thicken_voicing` adds a voice and opens the spacing; `raise_register`
 * lifts the target band an octave within range.
 */
import type { ArcTextureLevel, SectionDevelopmentOperator } from "@workspace/db";
import type { ParsedChord, ChordToneRole } from "../chordSymbols";
import {
  candidateVoicings, chordTonesOf, solveChain, transitionCost, type ChordTones, type Voice,
} from "../voiceLeading";
import { voiceLeadingWeightsOf, type HarmonyStyleParams } from "./styleParams";
import { mean, nearestPitch, pc, type HarmonyChordEvent } from "./shared";

export type VoicingRoleKind =
  | "keys_bed" | "keys_comping" | "guitar_bed" | "guitar_comping"
  | "string_pad" | "string_bed" | "string_climax" | "pad_synth" | "brass_line" | "winds_bed";

export type VoicingPlanInput = {
  events: HarmonyChordEvent[];
  /** Previous bars' chords, solved for continuity and dropped from the output. */
  warmup?: HarmonyChordEvent[];
  kind: VoicingRoleKind;
  range: { lo: number; hi: number };
  /** Widest the part may ever be (the instrument's `maxSimultaneousNotes`). */
  maxSimultaneous: number;
  style: HarmonyStyleParams;
  texture: ArcTextureLevel | null;
  level: number;
  operator: SectionDevelopmentOperator;
  /** Planned bass pitch per window event (null: no bass under this chord). */
  bassRef: ReadonlyArray<number | null>;
  /** The part carries the bass itself (no bass family in the arrangement). */
  suppliesBass: boolean;
  /** Pitches of sibling pitched parts sounding at each window event's onset. */
  siblings?: ReadonlyArray<ReadonlyArray<number>>;
  /** The singer's pitch at each window event's onset, when a melody is known and the section is sung. */
  melody?: ReadonlyArray<number | null>;
  /**
   * Lift the target centre (`raise_register`): `true` = an octave; a number =
   * that many semitones. The caller decides how much the plan's register band
   * already carried (B-01 raises the band one step for the shiftable
   * families), so the octave is not applied twice.
   */
  raiseRegister?: boolean | number;
  /** Voice count override (tests). */
  voices?: number;
  /** The previous section's last voicing, when known. */
  startFrom?: number[] | null;
};

export type PlannedVoicing = {
  index: number;
  pitches: number[];
  rationale: string;
};

export type VoicingPlan = {
  kind: VoicingRoleKind;
  voiceCount: number;
  voices: Voice[];
  voicings: PlannedVoicing[];
  totalCost: number;
  optimality: "exact" | "beam" | "fallback";
  notes: string[];
  targetCentre: number;
  targetSpacing: number;
};

const CANDIDATE_CAP = 160;
const MUD_CEILING = 48;
const MUD_INTERVAL = 4;
const LOW_OCTAVE_CEILING = 52;

/** Voices a role carries at a texture level. */
export function voiceCountFor(kind: VoicingRoleKind, texture: ArcTextureLevel | null, maxSimultaneous: number, operator: SectionDevelopmentOperator): number {
  const full = texture === "full" || texture === "tutti";
  let n: number;
  switch (kind) {
    case "brass_line": n = 1; break;
    case "keys_bed": n = full ? 4 : 3; break;
    case "keys_comping": n = full ? 4 : 3; break;
    case "guitar_bed": n = full ? 4 : 3; break;
    case "guitar_comping": n = 3; break;
    case "string_pad": n = texture === "solo" || texture === "duo" ? 2 : full ? 4 : 3; break;
    case "string_bed": n = full ? 4 : 3; break;
    case "string_climax": n = 4; break;
    case "pad_synth": n = full ? 4 : 3; break;
    case "winds_bed": n = full ? 3 : 2; break;
    default: n = 3;
  }
  if (operator === "thicken_voicing" && kind !== "brass_line") n += 1;
  return Math.max(1, Math.min(n, maxSimultaneous));
}

/** The pitch classes a role voices from a chord, reduced to what `n` voices can carry. */
export function tonesToVoice(chord: ParsedChord, n: number, extensions: HarmonyStyleParams["extensions"], bassCovered: boolean): ChordTones {
  const roleOf = (klass: number): ChordToneRole => chord.roles.get(klass) ?? "root";
  let tones = chord.pitchClasses.filter((klass) => {
    const role = roleOf(klass);
    if (extensions === "triads") return role === "root" || role === "third" || role === "fifth" || role === "suspension";
    if (extensions === "sevenths") return role !== "ninth" && role !== "eleventh" && role !== "thirteenth";
    return true;
  });
  // Drop order when the voices are fewer than the tones: the fifth first (the bass
  // implies it), then the root when a bass carries it, then the lower extensions,
  // then the sixth. The third / suspension and the seventh are kept to the last.
  const dropOrder: ChordToneRole[] = bassCovered
    ? ["fifth", "root", "eleventh", "ninth", "sixth", "thirteenth", "seventh"]
    : ["fifth", "eleventh", "ninth", "sixth", "thirteenth", "seventh", "root"];
  for (const role of dropOrder) {
    if (tones.length <= n) break;
    if (role === "root" && tones.length <= 3 && !bassCovered) continue;
    tones = tones.filter((klass) => roleOf(klass) !== role || tones.length <= n);
    while (tones.length > n && tones.some((klass) => roleOf(klass) === role)) {
      const at = tones.findIndex((klass) => roleOf(klass) === role);
      tones.splice(at, 1);
    }
  }
  if (!tones.length) tones = [chord.root];
  const base = chordTonesOf(chord, { requireBass: false });
  return { ...base, pitchClasses: tones, requiredBass: null };
}

type LayerSpec = {
  event: HarmonyChordEvent;
  tones: ChordTones;
  candidates: number[][];
  bass: number | null;
  siblings: ReadonlyArray<number>;
  melody: number | null;
  inWindow: boolean;
};

/** The voice set of a role inside its register band. */
export function voicesFor(kind: VoicingRoleKind, n: number, range: { lo: number; hi: number }, suppliesBass: boolean): { voices: Voice[]; maxSpacing: number; spacingFromIndex: number; maxBassSpacing?: number } {
  const { lo, hi } = range;
  const band = (min: number, max: number): Voice["range"] => ({ min: Math.max(lo, Math.min(min, hi - 1)), max: Math.min(hi, Math.max(max, lo + 1)) });
  const same = (min: number, max: number) => Array.from({ length: n }, (_, i) => ({ name: `v${i}`, range: band(min, max) }));
  switch (kind) {
    case "keys_bed":
    case "guitar_bed": {
      if (suppliesBass && n >= 3) {
        // Left hand carries the bass an octave or two below the right hand's voicing.
        return {
          voices: [{ name: "lh", range: band(lo, Math.min(hi - 8, 55)) }, ...Array.from({ length: n - 1 }, (_, i) => ({ name: `rh${i}`, range: band(Math.max(lo + 7, 50), hi) }))],
          maxSpacing: 12, spacingFromIndex: 2, maxBassSpacing: 19,
        };
      }
      return { voices: same(Math.max(lo, 48), hi), maxSpacing: 12, spacingFromIndex: 1 };
    }
    case "keys_comping":
      return { voices: same(Math.max(lo, 53), hi), maxSpacing: 9, spacingFromIndex: 1 };
    case "guitar_comping":
      return { voices: same(Math.max(lo, 50), hi), maxSpacing: 9, spacingFromIndex: 1 };
    case "string_pad":
    case "string_bed":
      return {
        voices: [{ name: "cello", range: band(lo, lo + 19) }, ...Array.from({ length: n - 1 }, (_, i) => ({ name: `s${i}`, range: band(lo + 5, hi) }))],
        maxSpacing: 12, spacingFromIndex: 2, maxBassSpacing: 19,
      };
    case "string_climax":
      return { voices: same(Math.max(lo, lo + 5), hi), maxSpacing: 12, spacingFromIndex: 1 };
    case "pad_synth":
      return { voices: same(lo, hi), maxSpacing: 12, spacingFromIndex: 1 };
    case "winds_bed":
      return { voices: same(lo, hi), maxSpacing: 12, spacingFromIndex: 1 };
    case "brass_line":
    default:
      return { voices: same(lo, hi), maxSpacing: 12, spacingFromIndex: 1 };
  }
}

/**
 * Solve the voicings of a role across the window's chord events.
 */
export function planVoicings(input: VoicingPlanInput): VoicingPlan {
  const notes: string[] = [];
  const n = input.voices ?? voiceCountFor(input.kind, input.texture, input.maxSimultaneous, input.operator);
  const { lo, hi } = input.range;
  const style = input.style;
  const weights = voiceLeadingWeightsOf(style);
  const spec = voicesFor(input.kind, n, input.range, input.suppliesBass);
  const spread = input.operator === "thicken_voicing" ? 2 : 0;
  // A pad sits above and wider than the keys by default, so two beds solved
  // without sight of each other do not land on one voicing.
  const padLift = input.kind === "pad_synth" ? 7 : 0;
  const targetSpacing = input.kind === "string_climax" ? 7 + spread : 3 + style.closeVsOpen * 5 + spread + (input.kind === "pad_synth" ? 2 : 0);
  const bandCentre = (lo + hi) / 2 + padLift;
  const raise = typeof input.raiseRegister === "number" ? input.raiseRegister : input.raiseRegister ? 12 : 0;
  const targetCentre = Math.min(hi - (n - 1) * targetSpacing / 2, Math.max(lo + (n - 1) * targetSpacing / 2, bandCentre + raise));
  const warmup = input.warmup ?? [];
  const all = [...warmup, ...input.events];
  if (!all.length) {
    return { kind: input.kind, voiceCount: n, voices: spec.voices, voicings: [], totalCost: 0, optimality: "exact", notes: ["no chord events in the window"], targetCentre, targetSpacing };
  }

  const unaryFor = (layer: Omit<LayerSpec, "candidates">) => (pitches: number[]): number => {
    let cost = 0;
    // Register: the mean voice sits near the target centre.
    cost += style.registerWeight * Math.abs(mean(pitches) - targetCentre) / 2;
    // Spacing: close vs open, on the voices above the lowest when a left hand or cello is separate.
    if (pitches.length >= 2) {
      const from = spec.spacingFromIndex >= 2 && pitches.length >= 3 ? 1 : 0;
      const gaps: number[] = [];
      for (let i = from + 1; i < pitches.length; i += 1) gaps.push(pitches[i] - pitches[i - 1]);
      if (gaps.length) cost += style.spacingWeight * Math.abs(mean(gaps) - targetSpacing);
    }
    // Low-interval mud and the octave the bass owns.
    for (let i = 1; i < pitches.length; i += 1) {
      if (pitches[i] < MUD_CEILING && pitches[i] - pitches[i - 1] <= MUD_INTERVAL && pitches[i] !== pitches[i - 1]) cost += 5;
    }
    if (layer.bass !== null && !input.suppliesBass) {
      const lowest = pitches[0];
      if (lowest <= LOW_OCTAVE_CEILING && pc(lowest) === pc(layer.bass)) cost += 4;
      if (Math.abs(lowest - layer.bass) < 3) cost += 6;
    }
    // Sibling collisions at the onset: a unison nobody chose.
    for (const pitch of pitches) {
      for (const other of layer.siblings) {
        if (other === pitch) cost += 3;
        else if (Math.abs(other - pitch) === 1) cost += 1;
      }
    }
    // The singer: the top voice keeps out of the melody's register and does not sit on the melody note.
    if (layer.melody !== null) {
      const top = pitches[pitches.length - 1];
      if (Math.abs(top - layer.melody) <= 2) cost += 4;
      if (pitches.some((p) => p === layer.melody)) cost += 2;
      if (top > layer.melody) cost += 1.5;
    }
    // The lowest string voice prefers the root or the third; the brass line prefers guide tones.
    const role = layer.tones.roles.get(pc(pitches[0]));
    if (input.kind === "string_pad" || input.kind === "string_bed") cost += role === "root" ? 0 : role === "third" || role === "suspension" ? 0.5 : 4;
    if (input.kind === "brass_line") {
      cost += role === "third" || role === "seventh" || role === "suspension" ? 0 : role === "root" ? 1 : role === "fifth" ? 1.5 : 0.5;
    }
    return cost;
  };

  let optimality: VoicingPlan["optimality"] = "exact";
  const layers: LayerSpec[] = all.map((event, i) => {
    const w = i - warmup.length;
    const inWindow = w >= 0;
    const bass = inWindow ? input.bassRef[w] ?? null : null;
    const siblings = inWindow ? input.siblings?.[w] ?? [] : [];
    const melody = inWindow ? input.melody?.[w] ?? null : null;
    const bassCovered = bass !== null || input.suppliesBass;
    const base = { event, bass, siblings, melody, inWindow };
    // Try the full tone set, then fewer tones, then without the bass floor, then any range.
    for (let tones = n; tones >= 1; tones -= 1) {
      const toneSet = tonesToVoice(event.chord, tones, style.extensions, bassCovered);
      if (input.suppliesBass && event.chord.bass !== event.chord.root && spec.voices[0]?.name === "lh") toneSet.requiredBass = event.chord.bass;
      const unary = unaryFor({ ...base, tones: toneSet });
      const floor = bass !== null && !input.suppliesBass ? bass + 3 : undefined;
      for (const relax of [0, 1]) {
        const { candidates, capped } = candidateVoicings(toneSet, spec.voices, {
          cap: CANDIDATE_CAP, weights, doubling: style.doublingPreferences,
          maxSpacing: spec.maxSpacing, spacingFromIndex: spec.spacingFromIndex, maxBassSpacing: spec.maxBassSpacing,
          floor: relax ? undefined : floor, unary,
        });
        if (candidates.length) {
          if (capped) { optimality = "beam"; notes.push(`${event.symbol} at ${event.start.toFixed(2)}s: candidates capped at ${CANDIDATE_CAP}`); }
          if (tones < n) notes.push(`${event.symbol}: voiced with ${tones} tone(s) - the range holds no complete voicing`);
          if (relax) notes.push(`${event.symbol}: voiced below the bass floor - no room above the bass`);
          return { ...base, tones: toneSet, candidates };
        }
      }
    }
    // Nothing fits: a root-position stack nearest the centre, in range, as the last resort.
    optimality = "fallback";
    notes.push(`${event.symbol}: no admissible voicing for ${n} voice(s) in ${lo}-${hi}; stacked from the centre`);
    const stack: number[] = [];
    let cursor = targetCentre - (n - 1) * 2;
    for (let v = 0; v < n; v += 1) {
      const klass = event.chord.pitchClasses[v % event.chord.pitchClasses.length];
      const pitch = nearestPitch(klass, cursor, lo, hi) ?? Math.round(Math.max(lo, Math.min(hi, cursor)));
      stack.push(pitch);
      cursor = pitch + 3;
    }
    return { ...base, tones: chordTonesOf(event.chord, { requireBass: false }), candidates: [stack.sort((a, b) => a - b)] };
  });

  const startFrom = input.startFrom && input.startFrom.length === n ? input.startFrom : undefined;
  const solved = solveChain<number[]>({
    layers: layers.map((layer) => layer.candidates),
    unary: (pitches, i) => unaryFor(layers[i])(pitches),
    pairwise: (from, to, i) => transitionCost(from, to, layers[i].tones, weights, style.doublingPreferences),
    startFrom,
  });
  if (!solved) {
    // Every layer has at least one candidate, so the chain always has a path.
    return { kind: input.kind, voiceCount: n, voices: spec.voices, voicings: [], totalCost: 0, optimality: "fallback", notes: [...notes, "no path through the voicings"], targetCentre, targetSpacing };
  }
  const voicings: PlannedVoicing[] = [];
  layers.forEach((layer, i) => {
    if (!layer.inWindow) return;
    const reasons = solved.stepReasons[i];
    voicings.push({
      index: i - warmup.length,
      pitches: layer.candidates[solved.chosen[i]],
      rationale: i === 0 && !startFrom ? "opening voicing" : reasons.length ? reasons.join("; ") : "smooth motion, no rule broken",
    });
  });
  return { kind: input.kind, voiceCount: n, voices: spec.voices, voicings, totalCost: solved.totalCost, optimality, notes, targetCentre, targetSpacing };
}
