/**
 * GroovePlan (Brain B-04): one groove per section, shared by drums, bass and
 * comping.
 *
 * Before this stream the rhythm section was a fixed 4/4 grid: kick on 1 and 3,
 * snare on 2 and 4, hats in 8ths (16ths above a density threshold, whatever
 * the tempo), bass on every beat, comping evenly spaced, nothing anticipating
 * or answering, and the same grid in 3/4, 6/8 and 7/8. The parts did not know
 * each other; "kick/bass lock" was a coincidence of the grid.
 *
 * The plan decides, per section and from the plan layers only (never from a
 * part's seed, so every part derives the identical plan):
 *   - the meter's grouping and accent weights (3/4 has no backbeat on a
 *     fourth beat; 6/8 is compound; 5/4 and 7/8 are additive);
 *   - the pulse placement (backbeat / half-time / 2-feel / four-on-the-floor /
 *     waltz / compound / additive / rubato) and the kit template it implies;
 *   - the subdivision, capped by what a player can strike at this tempo;
 *   - the anticipation set (which up-beats the bass and the comping push,
 *     and whether the kick joins them);
 *   - the kick/bass relationship (lock / complement / pedal) and the bass
 *     onsets it implies;
 *   - the comping cell for rhythmic comping and for a bed;
 *   - the fills vocabulary and where fills go (transition devices, phrase
 *     ends, the arc's lifts and arrivals, family entries);
 *   - swing and microtiming (from the style grammar when it has them);
 *   - how the last bar of the song closes.
 * Every value carries `source` and `reason`; the section carries a digest.
 *
 * Two entry points derive the same section: `deriveGroovePlan` for the whole
 * song (the orchestrator persists it on the plan) and `grooveSectionForRequest`
 * for one `PartGenerationRequest` (what the composer's writers call). A test
 * proves they agree.
 */
import { createHash } from "node:crypto";
import type {
  ArcTensionRole, ArcTextureLevel, GlobalArrangementPlan, GrooveAnticipationWhen, GrooveCompingCell,
  GrooveDecision, GrooveFillKind, GrooveFillPlacement, GrooveKickBassRelation, GrooveMeter, GroovePlan,
  GroovePlanSection, GroovePulse, GrooveSubdivision, GrooveValueSource, PhrasePlan, SectionDevelopmentOperator,
  SectionPhrasePlan, SectionPlan, SongModelData, TransitionPlan,
} from "@workspace/db";
import { backbeatPulse, barTiming, meterOf, unitAccents, type BarTiming, type MeterSpec } from "./composer/frame";
import type { PartGenerationRequest } from "./partComposer";
import type { StyleGrammar } from "./styleGrammar";

export const GROOVE_PLAN_VERSION = "1.0" as const;
const METHOD = "groove-plan/v1";

// ---------------------------------------------------------------------------
// Inputs
// ---------------------------------------------------------------------------

export type GrooveSectionSeed = {
  sectionName: string;
  startBar: number;
  endBar: number;
  function: SectionPlan["function"];
  /** The arc's intended level 0..1 (the planners' "energy"). */
  level: number;
  density: number;
  tensionRole: ArcTensionRole | null;
  textureLevel: ArcTextureLevel | null;
  operator: SectionDevelopmentOperator;
  occurrenceIndex: number;
  /** The song's last section: its final bar is the song's ending. */
  isLast: boolean;
};

export type GrooveHints = { swingRatio: number | null; microtimingMs: number | null };

export type GrooveContext = {
  style: string;
  grooveStrategy: GlobalArrangementPlan["grooveStrategy"];
  productionAesthetic: GlobalArrangementPlan["productionAesthetic"] | null;
  timing: BarTiming;
  tempoBand: "ballad" | "midtempo" | "uptempo" | "double-time";
  hints: GrooveHints;
};

export type StyleFamily =
  | "rock" | "pop" | "dance" | "electronic" | "jazz" | "ballad" | "acoustic" | "orchestral" | "cinematic" | "ethnic" | "unknown";

/** The planner's style strings folded into the families the groove rules distinguish. */
export function styleFamilyOf(style: string, aesthetic?: GlobalArrangementPlan["productionAesthetic"] | null): StyleFamily {
  const s = (style ?? "").toLowerCase();
  if (/jazz|swing|bebop|bossa/.test(s)) return "jazz";
  if (/rock|metal|punk|grunge/.test(s)) return "rock";
  if (/dance|house|techno|edm|club|disco/.test(s)) return "dance";
  if (/electro|synth|hip.?hop|trap|r&b|rnb/.test(s)) return "electronic";
  if (/ballad/.test(s)) return "ballad";
  if (/acoustic|folk|singer/.test(s)) return "acoustic";
  if (/orchestra|chamber|classical/.test(s)) return "orchestral";
  if (/cinema|film|score|ambient/.test(s)) return "cinematic";
  if (/ethnic|world|mizrahi|latin|balkan|greek|arab|turkish|klezmer/.test(s)) return "ethnic";
  if (/pop/.test(s)) return "pop";
  if (aesthetic === "electronic") return "electronic";
  if (aesthetic === "cinematic") return "cinematic";
  if (aesthetic === "orchestral") return "orchestral";
  if (aesthetic === "intimate") return "ballad";
  if (aesthetic === "raw_band") return "rock";
  if (aesthetic === "polished_pop") return "pop";
  return "unknown";
}

/** Styles whose drums are programmed rather than played: two hands' worth of hats is allowed. */
const PROGRAMMED: ReadonlySet<StyleFamily> = new Set(["dance", "electronic"]);

/** Tempo band with the thresholds `songMusicalMap` uses, so both plan paths agree without a map. */
export function tempoBandOf(tempoBpm: number): GrooveContext["tempoBand"] {
  return tempoBpm < 76 ? "ballad" : tempoBpm < 112 ? "midtempo" : tempoBpm <= 160 ? "uptempo" : "double-time";
}

/** Swing ratio and microtiming from a style grammar's directives, when it has them. */
export function grooveHintsFromGrammar(grammar: StyleGrammar | null | undefined): GrooveHints {
  const hints: GrooveHints = { swingRatio: null, microtimingMs: null };
  for (const rule of grammar?.rules ?? []) {
    if (rule.directive.kind === "swing" && rule.weight > 0) hints.swingRatio = rule.directive.ratio;
    if (rule.directive.kind === "microtiming" && rule.weight > 0) hints.microtimingMs = rule.directive.offsetMs;
  }
  return hints;
}

const decision = <T>(value: T, source: GrooveValueSource, reason: string): GrooveDecision<T> => ({ value, source, reason });
const clamp01 = (v: number): number => (v < 0 ? 0 : v > 1 ? 1 : v);
const r3 = (v: number): number => Math.round(v * 1000) / 1000;

function hash01(key: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < key.length; i += 1) { h ^= key.charCodeAt(i); h = Math.imul(h, 0x01000193) >>> 0; }
  return (h >>> 8) / 0x1000000;
}

const TEXTURE_RANK: Record<ArcTextureLevel, number> = { solo: 0, duo: 1, bed: 2, full: 3, tutti: 4 };
const thin = (seed: GrooveSectionSeed): boolean =>
  (seed.textureLevel !== null && TEXTURE_RANK[seed.textureLevel] <= 1) || seed.level < 0.3;
const quiet = (seed: GrooveSectionSeed): boolean => seed.tensionRole === "afterglow" || seed.tensionRole === "breath";

// ---------------------------------------------------------------------------
// Meter
// ---------------------------------------------------------------------------

export function grooveMeterOf(spec: MeterSpec, unitSeconds: number): GrooveMeter {
  return {
    numerator: spec.numerator,
    denominator: spec.denominator,
    feel: spec.feel,
    grouping: decision(spec.grouping, "meter", spec.groupingReason),
    pulses: spec.pulses,
    accentWeights: unitAccents(spec).map(r3),
    unitSeconds: r3(unitSeconds),
    barSeconds: r3(unitSeconds * spec.numerator),
  };
}

// ---------------------------------------------------------------------------
// Decisions
// ---------------------------------------------------------------------------

function pulseFor(seed: GrooveSectionSeed, ctx: GrooveContext, spec: MeterSpec, family: StyleFamily): GrooveDecision<GroovePulse> {
  if (spec.feel === "compound") return decision("compound", "meter", `${spec.numerator}/${spec.denominator}: dotted pulses, kick on the first, snare on the second`);
  if (spec.feel === "additive") return decision("additive", "meter", `${spec.numerator}/${spec.denominator} as ${spec.grouping.join("+")}: kick on the group starts, snare on the group nearest the bar's middle`);
  if (spec.numerator === 3) return decision("waltz", "meter", "3/4: downbeat kick, snare on 2, cross-stick on 3 - no fourth beat to backbeat");
  const strategy = ctx.grooveStrategy;
  if (strategy === "rubato") return decision("rubato", "strategy", "rubato groove: the kit marks pulses only");
  if (strategy === "half_time_feel") return decision("half_time", "strategy", "half-time feel: snare on 3");
  const band = family === "rock" || family === "pop" || family === "dance" || family === "electronic";
  if (quiet(seed) && seed.level < 0.4) {
    return band
      ? decision("half_time", "arc", `${seed.tensionRole} at level ${seed.level}: the band drops to half-time`)
      : decision("two_feel", "arc", `${seed.tensionRole} at level ${seed.level}: a 2-feel leaves room`);
  }
  if ((seed.function === "breakdown" || seed.function === "bridge") && seed.tensionRole === "release" && band) {
    return decision("half_time", "arc", `${seed.function} marked release: half-time under the return`);
  }
  if (seed.textureLevel !== null && TEXTURE_RANK[seed.textureLevel] <= 1 && (family === "jazz" || family === "acoustic" || family === "ballad")) {
    return decision("two_feel", "arc", `${seed.textureLevel} texture in a ${family} setting: 2-feel`);
  }
  if (strategy === "four_on_floor") {
    if (seed.level < 0.45 && seed.textureLevel !== null && TEXTURE_RANK[seed.textureLevel] <= 2) {
      return decision("backbeat", "arc", `four-on-the-floor asks for a full texture; the arc's level ${seed.level} / ${seed.textureLevel} here keeps a backbeat`);
    }
    return decision("four_on_floor", "strategy", "four-on-the-floor kick under a backbeat snare");
  }
  if (strategy === "swing") return decision("backbeat", "strategy", "swing: backbeat with the ride carrying the feel");
  return decision("backbeat", "strategy", `${strategy}: kick 1 and 3, snare 2 and 4`);
}

type StepLadder = GrooveSubdivision[];
const LADDER: StepLadder = ["quarters", "8ths", "16ths"];
const stepOf = (s: GrooveSubdivision, by: number): GrooveSubdivision => {
  if (s === "shuffle" || s === "triplets") return by < 0 ? "quarters" : s;
  const at = LADDER.indexOf(s);
  return LADDER[Math.max(0, Math.min(LADDER.length - 1, at + by))];
};

/** Hat step in denominator units for a subdivision in this meter (0 = pulses only). */
export function stepUnitsFor(subdivision: GrooveSubdivision, spec: MeterSpec): number {
  const unitsPerQuarter = spec.denominator / 4;
  if (spec.denominator >= 8) {
    // The unit is an eighth (or shorter): "8ths" is every unit, "16ths" half a unit, "quarters" the pulses.
    if (subdivision === "quarters") return 0;
    if (subdivision === "16ths") return 0.5 * (8 / spec.denominator);
    return 1 * (8 / spec.denominator);
  }
  if (subdivision === "quarters") return 1 * unitsPerQuarter;
  if (subdivision === "16ths") return 0.25 * unitsPerQuarter;
  if (subdivision === "triplets") return (1 / 3) * unitsPerQuarter;
  return 0.5 * unitsPerQuarter; // 8ths, shuffle
}

function strikesPerSecond(subdivision: GrooveSubdivision, spec: MeterSpec, unitSeconds: number): number {
  const step = stepUnitsFor(subdivision, spec);
  if (step === 0) return 1 / (unitSeconds * (spec.numerator / Math.max(1, spec.pulses.length)));
  return 1 / (step * unitSeconds);
}

/** One hand on a hi-hat: ~7.5 strikes a second; programmed kits are allowed 9. */
const HAND_LIMIT = 7.5;
const PROGRAMMED_LIMIT = 9;

function ceilingFor(ctx: GrooveContext, spec: MeterSpec, family: StyleFamily): GrooveDecision<GrooveSubdivision> {
  const limit = PROGRAMMED.has(family) ? PROGRAMMED_LIMIT : HAND_LIMIT;
  const unit = ctx.timing.beatSeconds;
  for (const candidate of ["16ths", "8ths", "quarters"] as GrooveSubdivision[]) {
    const rate = strikesPerSecond(candidate, spec, unit);
    if (rate <= limit) {
      return decision(candidate, "tempo",
        `${candidate} at ${ctx.timing.tempoBpm} BPM = ${r3(rate)} strikes/s ≤ ${limit}/s ${PROGRAMMED.has(family) ? "(programmed kit)" : "(one hand)"}`);
    }
  }
  return decision("quarters", "tempo", `${ctx.timing.tempoBpm} BPM: pulses only`);
}

function capped(value: GrooveSubdivision, ceiling: GrooveSubdivision): GrooveSubdivision {
  if (value === "shuffle" || value === "triplets") return ceiling === "quarters" ? "quarters" : value;
  return LADDER.indexOf(value) > LADDER.indexOf(ceiling) ? ceiling : value;
}

function subdivisionFor(seed: GrooveSectionSeed, ctx: GrooveContext, spec: MeterSpec, family: StyleFamily, pulse: GroovePulse, ceiling: GrooveDecision<GrooveSubdivision>): GrooveDecision<GrooveSubdivision> {
  let base: GrooveDecision<GrooveSubdivision>;
  if (spec.feel !== "simple") base = decision("8ths", "meter", `${spec.numerator}/${spec.denominator}: the hats mark every unit`);
  else if (ctx.grooveStrategy === "swing") base = family === "jazz"
    ? decision("triplets", "style", "jazz swing: the ride plays the triplet pattern")
    : decision("shuffle", "strategy", "swing groove: shuffled 8ths");
  else if (pulse === "rubato") base = decision("quarters", "strategy", "rubato: pulses only");
  else if (pulse === "two_feel") base = decision("quarters", "arc", "2-feel: hats on the beats");
  else base = decision("8ths", "strategy", `${ctx.grooveStrategy}: straight 8ths`);

  let value = base;
  const full = seed.textureLevel !== null && TEXTURE_RANK[seed.textureLevel] >= 3;
  if (full && seed.level >= 0.6 && seed.density >= 0.5 && base.value === "8ths" && spec.feel === "simple") {
    value = decision(stepOf(base.value, 1), "arc", `${seed.textureLevel} texture at level ${seed.level}: one step denser than the ${base.value} the ${base.source} gives`);
  } else if ((thin(seed) || quiet(seed)) && base.value !== "quarters") {
    value = decision(stepOf(base.value, -1), "arc", `${seed.textureLevel ?? "thin"} texture / ${seed.tensionRole ?? "low level"}: one step sparser than ${base.value}`);
  }
  const limited = capped(value.value, ceiling.value);
  if (limited !== value.value) {
    return decision(limited, "tempo", `${value.value} wanted (${value.reason}) but ${ceiling.reason}`);
  }
  return value;
}

function kickBassFor(seed: GrooveSectionSeed, ctx: GrooveContext, family: StyleFamily, pulse: GroovePulse): GrooveDecision<GrooveKickBassRelation> {
  if (pulse === "rubato") return decision("pedal", "strategy", "rubato: the bass holds the root under each chord");
  if (quiet(seed)) return decision("pedal", "arc", `${seed.tensionRole}: the bass rests on the root`);
  if (family === "jazz") return decision("complement", "style", "jazz: the bass walks the pulses between the kick's accents");
  if (family === "acoustic") return decision("complement", "style", "acoustic: the bass fills the beats the kick leaves");
  if (seed.tensionRole === "lift" || seed.tensionRole === "arrival") return decision("lock", "arc", `${seed.tensionRole}: kick and bass on the same onsets`);
  if ((family === "ballad" || family === "cinematic" || family === "orchestral") && seed.level < 0.45 && seed.textureLevel !== null && TEXTURE_RANK[seed.textureLevel] <= 2) {
    return decision("pedal", "style", `${family} at level ${seed.level}: a held root under the chord`);
  }
  return decision("lock", "style", `${family}: kick and bass share their onsets`);
}

type KitTemplate = GroovePlanSection["kit"] & { hat: number[] };

/** Kit template per bar for the pulse in this meter. Positions in denominator units. */
export function kitTemplateFor(pulse: GroovePulse, spec: MeterSpec, subdivision: GrooveSubdivision, seed: GrooveSectionSeed, family: StyleFamily): KitTemplate {
  const n = spec.numerator;
  const step = stepUnitsFor(subdivision, spec);
  const pulses = spec.pulses;
  const hatGrid = (): number[] => {
    if (step === 0) return [...pulses];
    const out: number[] = [];
    for (let u = 0; u < n - 1e-9; u += step) out.push(r3(u));
    return out;
  };
  const light = thin(seed) || quiet(seed);
  const ride = subdivision === "triplets" || (family === "jazz" && subdivision === "shuffle");
  const base: KitTemplate = { kick: [0], snare: [], sideStick: [], hatStepUnits: step, hat: hatGrid(), openHat: [], ghost: [], ride };
  const backbeat = backbeatPulse(spec);
  if (spec.feel === "compound") {
    const kick = light ? [0] : seed.level >= 0.7 ? [0, 2] : [0];
    const snare = pulses.filter((_, i) => i % 2 === 1);
    return { ...base, kick, snare: light ? [] : snare, sideStick: light ? snare : [], ghost: light ? [] : pulses.map((p) => p + 2).filter((u) => u < n && !snare.includes(u)) };
  }
  if (spec.feel === "additive") {
    const kick = pulses.filter((p) => p !== backbeat);
    if (seed.level >= 0.65 && !light) {
      // The third unit of a leading 3-group takes a kick too (the "boom-boom" before the snare).
      const lead = spec.grouping[0] === 3 ? [2] : [];
      kick.push(...lead.filter((u) => u !== backbeat && !kick.includes(u)));
    }
    const ghost = spec.grouping.map((g, i) => (g === 3 ? pulses[i] + 1 : -1)).filter((u) => u >= 0 && u !== backbeat);
    return { ...base, kick: light ? [0] : kick.sort((a, b) => a - b), snare: light ? [] : [backbeat], sideStick: light ? [backbeat] : [], ghost: light ? [] : ghost };
  }
  if (spec.numerator === 3) {
    return light
      ? { ...base, kick: [0], sideStick: [1, 2] }
      : { ...base, kick: [0], snare: [1], sideStick: [2], ghost: subdivision === "16ths" ? [1.75] : [] };
  }
  if (spec.numerator === 2) return { ...base, kick: [0], snare: light ? [] : [1], sideStick: light ? [1] : [] };
  // Simple 4/4 (and 6/4 etc. fall to the 4/4 shapes on the first four beats).
  const eighths = subdivision !== "quarters";
  switch (pulse) {
    case "four_on_floor":
      return { ...base, kick: [0, 1, 2, 3], snare: [1, 3], openHat: eighths ? [0.5, 1.5, 2.5, 3.5] : [], ghost: [] };
    case "half_time":
      return { ...base, kick: light ? [0] : [0, 2.5], snare: light ? [] : [2], sideStick: light ? [2] : [], ghost: eighths && !light ? [1.5] : [] };
    case "two_feel":
      return { ...base, kick: [0, 2], sideStick: [1, 3], hat: step === 0 ? [0, 1, 2, 3] : base.hat };
    case "rubato":
      return { ...base, kick: [0], sideStick: [backbeat], hat: [...pulses], hatStepUnits: 0 };
    case "backbeat":
    default: {
      if (light) return { ...base, kick: [0], sideStick: [1, 3], hat: step === 0 ? [0, 1, 2, 3] : base.hat };
      const kick = seed.level >= 0.7 && seed.density >= 0.6 ? [0, 2, 2.5] : [0, 2];
      const ghost = subdivision === "16ths" ? [1.75, 3.25] : eighths && !kick.includes(2.5) ? [2.5] : [];
      return { ...base, kick, snare: [1, 3], ghost };
    }
  }
}

function anticipationsFor(seed: GrooveSectionSeed, ctx: GrooveContext, spec: MeterSpec, pulse: GroovePulse, kickBass: GrooveKickBassRelation): GroovePlanSection["anticipations"] {
  const n = spec.numerator;
  const units: number[] = spec.feel === "simple"
    ? (spec.denominator >= 8 ? [n - 1] : [n - 0.5])
    : [n - 1];
  if (spec.feel === "simple" && n === 4 && ctx.grooveStrategy === "syncopated") units.unshift(1.5);
  const kickAnticipates = kickBass === "lock" && pulse !== "four_on_floor" && pulse !== "rubato" && pulse !== "waltz";
  const kickNote = kickAnticipates ? "; the kick joins (kick/bass lock)"
    : pulse === "four_on_floor" ? "; the kick stays on the floor"
    : pulse === "waltz" ? "; a waltz kick keeps the downbeat, bass and comping push"
    : "; bass and comping alone";
  const label = units.map((u) => (spec.denominator >= 8 ? `unit ${u}` : `the "and" of ${Math.floor(u) + 1}`)).join(" and ");
  let when: GrooveDecision<GrooveAnticipationWhen>;
  if (pulse === "rubato") when = decision("never", "strategy", "rubato: nothing is pushed");
  else if (thin(seed) && seed.function === "intro") when = decision("never", "arc", "a thin intro states the time plainly");
  else if (quiet(seed) && seed.level < 0.4) when = decision("never", "arc", `${seed.tensionRole}: no pushes`);
  else if (seed.textureLevel === "solo") when = decision("never", "arc", "solo texture: no pushes");
  else if (ctx.grooveStrategy === "syncopated") when = decision("every_bar", "strategy", `syncopated: push ${label} in every bar`);
  else if (seed.tensionRole === "lift") when = decision("every_bar", "arc", `lift: push ${label} in every bar into the arrival`);
  else when = decision("before_chord_change", "strategy", `${ctx.grooveStrategy}: push ${label} into a chord change`);
  return decision({ units, when: when.value, kickAnticipates }, when.source, `${when.reason}${kickNote}`);
}

function bassUnitsFor(relation: GrooveKickBassRelation, pulse: GroovePulse, kit: KitTemplate, spec: MeterSpec): number[] {
  if (relation === "pedal") return [0];
  if (pulse === "two_feel") return spec.numerator === 4 ? [0, 2] : [...spec.pulses];
  if (relation === "complement") return spec.feel === "simple" ? Array.from({ length: spec.numerator }, (_, i) => i) : [...spec.pulses];
  return [...kit.kick];
}

const RHYTHMIC_LADDER: GrooveCompingCell[] = ["sparse_hits", "quarter_pulses", "arpeggiated_8ths", "off_beat_chop"];

function compingFor(seed: GrooveSectionSeed, ctx: GrooveContext, spec: MeterSpec, family: StyleFamily, pulse: GroovePulse, ceiling: GrooveSubdivision) {
  let rhythmic: GrooveDecision<GrooveCompingCell>;
  if (thin(seed) || seed.tensionRole === "breath") rhythmic = decision("sparse_hits", "arc", `${seed.textureLevel ?? "thin"} / ${seed.tensionRole ?? "low level"}: a hit on the downbeat and the push only`);
  else if (family === "jazz" || ctx.grooveStrategy === "swing") rhythmic = decision("charleston", "style", "swing comping: 1 and the \"and\" of 2");
  else if (pulse === "four_on_floor" || family === "dance" || family === "electronic") rhythmic = decision("off_beat_chop", "style", "off-beat chop against the floor kick");
  else if (ctx.grooveStrategy === "syncopated") rhythmic = decision("quarter_pulses", "strategy", "syncopated: quarter pulses that the anticipation set pushes");
  else if (family === "ballad" || family === "acoustic" || family === "cinematic" || family === "orchestral") rhythmic = decision("arpeggiated_8ths", "style", `${family}: arpeggiated comping`);
  else rhythmic = seed.level >= 0.5
    ? decision("quarter_pulses", "arc", `${family} at level ${seed.level}: quarter pulses`)
    : decision("arpeggiated_8ths", "arc", `${family} at level ${seed.level}: arpeggiated 8ths`);
  let arpeggioStep = rhythmic.value === "arpeggiated_8ths" ? stepUnitsFor("8ths", spec) : 0;
  if (seed.operator === "change_comping_subdivision") {
    const at = RHYTHMIC_LADDER.indexOf(rhythmic.value);
    if (rhythmic.value === "arpeggiated_8ths" && ceiling === "16ths") {
      arpeggioStep = stepUnitsFor("16ths", spec);
      rhythmic = decision("arpeggiated_8ths", "operator", `change_comping_subdivision: the arpeggio halves its step (16ths) on this repeat (was ${rhythmic.reason})`);
    } else if (at >= 0 && at < RHYTHMIC_LADDER.length - 1) {
      const next = RHYTHMIC_LADDER[at + 1];
      rhythmic = decision(next, "operator", `change_comping_subdivision: ${rhythmic.value} → ${next} on this repeat`);
      arpeggioStep = next === "arpeggiated_8ths" ? stepUnitsFor("8ths", spec) : 0;
    } else if (at === RHYTHMIC_LADDER.length - 1) {
      rhythmic = decision("quarter_pulses", "operator", `change_comping_subdivision: ${rhythmic.value} was the densest cell, the repeat opens up to quarter pulses`);
      arpeggioStep = 0;
    }
  }
  const bed: GrooveDecision<GrooveCompingCell> = seed.tensionRole === "lift" && seed.level >= 0.55
    ? decision("quarter_pulses", "arc", "lift: the bed pulses in quarters under the build")
    : decision("whole_note_bed", "default", "a bed holds each chord");
  return {
    rhythmic, bed,
    rhythmicUnits: cellUnits(rhythmic.value, spec, arpeggioStep),
    bedUnits: cellUnits(bed.value, spec, 0),
    arpeggioStepUnits: r3(arpeggioStep),
  };
}

/** Onsets per bar of a comping cell in this meter. */
export function cellUnits(cell: GrooveCompingCell, spec: MeterSpec, arpeggioStep: number): number[] {
  const n = spec.numerator;
  const pulses = spec.pulses;
  switch (cell) {
    case "whole_note_bed":
    case "sparse_hits":
      return [0];
    case "quarter_pulses":
      return spec.feel === "simple" ? Array.from({ length: n }, (_, i) => i) : [...pulses];
    case "off_beat_chop":
      if (spec.feel === "simple") return n === 3 ? [1, 2] : Array.from({ length: n }, (_, i) => i + 0.5);
      // Compound / additive: the last unit of every group.
      return spec.grouping.map((g, i) => pulses[i] + g - 1);
    case "charleston":
      return spec.feel === "simple" ? [0, 1.5] : [0, pulses[1] ?? 0].filter((u, i, a) => a.indexOf(u) === i);
    case "arpeggiated_8ths": {
      const step = arpeggioStep > 0 ? arpeggioStep : stepUnitsFor("8ths", spec);
      const out: number[] = [];
      for (let u = 0; u < n - 1e-9; u += step) out.push(r3(u));
      return out;
    }
    default:
      return [0];
  }
}

const FILL_VOCABULARY: Record<StyleFamily, GrooveFillKind[]> = {
  rock: ["tom_run", "snare_roll", "kick_snare_16ths", "crash_only"],
  pop: ["tom_run", "snare_roll", "snare_pickup", "crash_only"],
  dance: ["snare_roll", "crash_only", "open_hat_lift"],
  electronic: ["snare_roll", "kick_snare_16ths", "open_hat_lift"],
  jazz: ["snare_pickup", "open_hat_lift", "tom_run"],
  ballad: ["snare_pickup", "crash_only", "tom_run"],
  acoustic: ["snare_pickup", "open_hat_lift", "crash_only"],
  orchestral: ["snare_roll", "crash_only"],
  cinematic: ["snare_roll", "crash_only", "tom_run"],
  ethnic: ["tom_run", "snare_pickup", "kick_snare_16ths"],
  unknown: ["tom_run", "snare_roll", "crash_only"],
};
const BIG_FILLS: ReadonlySet<GrooveFillKind> = new Set(["tom_run", "snare_roll", "kick_snare_16ths"]);

function fillsFor(seed: GrooveSectionSeed, spec: MeterSpec, family: StyleFamily, phrases: PhrasePlan[], transitions: TransitionPlan[]): GroovePlanSection["fills"] {
  const vocabulary = decision(FILL_VOCABULARY[family], "style", `${family} fills`);
  const placements: GroovePlanPlacementDraft[] = [];
  const n = spec.numerator;
  const light = n <= 4 ? 1 : 2;
  const heavy = n <= 4 ? 2 : Math.max(2, spec.grouping[spec.grouping.length - 1]);
  const pick = (bar: number, intensity: number): GrooveFillKind => {
    const pool = vocabulary.value.filter((k) => (intensity >= 0.6 ? BIG_FILLS.has(k) : !BIG_FILLS.has(k)));
    const from = pool.length ? pool : vocabulary.value;
    return from[Math.floor(hash01(`${seed.sectionName}:${bar}`) * from.length) % from.length];
  };
  const place = (bar: number, kind: GrooveFillKind, lengthUnits: number, intensity: number, source: GrooveValueSource, reason: string) => {
    if (bar < seed.startBar || bar > seed.endBar) return;
    if (placements.some((p) => Math.abs(p.bar - bar) <= 1 && p.lengthUnits > 0 && lengthUnits > 0)) return;
    placements.push({ bar, kind, lengthUnits, intensity: r3(clamp01(intensity)), source, reason });
  };
  const outgoing = transitions.filter((t) => t.fromSection === seed.sectionName && t.toSection !== seed.sectionName);
  const incoming = transitions.filter((t) => t.toSection === seed.sectionName && t.fromSection !== seed.sectionName);

  // 1. Transition devices out of this section.
  for (const t of outgoing) {
    const fill = t.devices.find((d) => d.device === "drum_fill");
    const build = t.devices.find((d) => d.device === "build_up");
    const swell = t.devices.find((d) => d.device === "cymbal_swell");
    if (build) place(seed.endBar, "snare_roll", Math.max(heavy, Math.min(n, Math.round(n * build.intensity))), build.intensity, "transition", `${t.id} build_up (${build.intensity}): a snare build into ${t.toSection}`);
    if (fill) {
      const kind = pick(seed.endBar, fill.intensity);
      const length = fill.intensity >= 0.9 && seed.tensionRole === "lift" ? n : fill.intensity >= 0.75 ? heavy : light;
      place(seed.endBar, kind, length, fill.intensity, "transition", `${t.id} drum_fill (${fill.intensity}) into ${t.toSection}: ${kind} over the last ${length} unit(s)`);
    } else if (swell) {
      place(seed.endBar, "crash_only", 0, swell.intensity, "transition", `${t.id} cymbal_swell into ${t.toSection}: the crash lands on its downbeat`);
    }
  }
  // 2. The arc: a lift's last bar is a fill even when no device was planned; an arrival opens with a crash.
  if (seed.tensionRole === "lift" && !seed.isLast && !placements.some((p) => p.bar === seed.endBar)) {
    const kind = pick(seed.endBar, 0.7);
    place(seed.endBar, kind, heavy, 0.7, "arc", `lift: ${kind} into the arrival`);
  }
  const landing = incoming.find((t) => (t.kind === "build" && t.strength >= 0.4) || t.devices.some((d) => (d.device === "drum_fill" && d.intensity >= 0.5) || d.device === "cymbal_swell" || d.device === "build_up"));
  if (seed.tensionRole === "arrival" || landing) {
    const why = seed.tensionRole === "arrival" ? "arrival" : `${landing!.id} (${landing!.kind}) lands here`;
    placements.push({ bar: seed.startBar, kind: "crash_only", lengthUnits: 0, intensity: 0.8, source: seed.tensionRole === "arrival" ? "arc" : "transition", reason: `${why}: crash on the downbeat` });
  }
  // 3. Phrases: cadence / fill phrases end with a light fill when the section is not thin; family entries get a pickup.
  if (!thin(seed) && seed.level >= 0.45) {
    for (const phrase of phrases) {
      if ((phrase.role === "cadence" || phrase.role === "fill") && phrase.endBar < seed.endBar) {
        const kind = pick(phrase.endBar, 0.3);
        place(phrase.endBar, kind, light, 0.35, "phrase", `${phrase.role} phrase ends at bar ${phrase.endBar}: ${kind}`);
      }
      if (phrase.entersFamilies.length && phrase.startBar > seed.startBar) {
        const pickupKind = vocabulary.value.includes("snare_pickup") ? "snare_pickup" : pick(phrase.startBar - 1, 0.3);
        place(phrase.startBar - 1, pickupKind, 1, 0.3, "phrase", `pickup into the entry of ${phrase.entersFamilies.join(", ")} at bar ${phrase.startBar}`);
      }
    }
  }
  // 4. The song's last bar is the ending, never a fill.
  const final = seed.isLast ? placements.filter((p) => p.bar !== seed.endBar) : placements;
  return { vocabulary, placements: final.sort((a, b) => a.bar - b.bar || a.lengthUnits - b.lengthUnits) };
}
type GroovePlanPlacementDraft = GrooveFillPlacement;

function swingFor(ctx: GrooveContext, subdivision: GrooveSubdivision): GrooveDecision<number> {
  const swung = ctx.grooveStrategy === "swing" || subdivision === "shuffle" || subdivision === "triplets";
  if (!swung) return decision(0.5, "default", "straight");
  if (ctx.hints.swingRatio !== null) return decision(r3(ctx.hints.swingRatio), "style", `the style grammar's swing ratio ${ctx.hints.swingRatio}`);
  const bpm = ctx.timing.tempoBpm;
  // Never under 0.6: the performance engine swings any onset within 0.08 of the half-beat itself, and a plan ratio
  // closer to 0.5 than that would be swung twice.
  const ratio = bpm <= 100 ? 0.67 : bpm <= 160 ? 0.62 : 0.6;
  return decision(ratio, "tempo", `swing flattens with tempo: ${ratio} at ${bpm} BPM`);
}

function endingFor(seed: GrooveSectionSeed, family: StyleFamily): GroovePlanSection["ending"] {
  if (!seed.isLast) return decision("none", "default", "not the last section");
  if (family === "ballad" || family === "cinematic" || family === "orchestral" || family === "acoustic" || quiet(seed)) {
    return decision("thin_out", "style", `${family}${quiet(seed) ? ` / ${seed.tensionRole}` : ""}: the last bar thins to a held chord, kick and crash on its downbeat`);
  }
  return decision("held_hit", "style", `${family}: a final hit held for the last bar`);
}

// ---------------------------------------------------------------------------
// Section derivation
// ---------------------------------------------------------------------------

export type GrooveSectionInput = {
  seed: GrooveSectionSeed;
  previous: GrooveSectionSeed | null;
  phrases: PhrasePlan[];
  transitions: TransitionPlan[];
};

function stableStringify(value: unknown): string {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(",")}]`;
  const record = value as Record<string, unknown>;
  return `{${Object.keys(record).filter((k) => record[k] !== undefined).sort().map((k) => `${JSON.stringify(k)}:${stableStringify(record[k])}`).join(",")}}`;
}

function deriveOnce(seed: GrooveSectionSeed, ctx: GrooveContext, phrases: PhrasePlan[], transitions: TransitionPlan[]): Omit<GroovePlanSection, "continuity" | "digest"> {
  const spec = ctx.timing.meter;
  const family = styleFamilyOf(ctx.style, ctx.productionAesthetic);
  const pulse = pulseFor(seed, ctx, spec, family);
  const ceiling = ceilingFor(ctx, spec, family);
  const subdivision = subdivisionFor(seed, ctx, spec, family, pulse.value, ceiling);
  const kickBass = kickBassFor(seed, ctx, family, pulse.value);
  const kit = kitTemplateFor(pulse.value, spec, subdivision.value, seed, family);
  const anticipations = anticipationsFor(seed, ctx, spec, pulse.value, kickBass.value);
  const comping = compingFor(seed, ctx, spec, family, pulse.value, ceiling.value);
  const approach = approachFor(seed, spec, subdivision.value, ceiling.value, transitions);
  return {
    sectionName: seed.sectionName,
    startBar: seed.startBar,
    endBar: seed.endBar,
    meter: grooveMeterOf(spec, ctx.timing.beatSeconds),
    pulse,
    subdivision,
    densityCeiling: ceiling,
    kit: { kick: kit.kick, snare: kit.snare, sideStick: kit.sideStick, hatStepUnits: r3(kit.hatStepUnits), openHat: kit.openHat, ghost: kit.ghost, ride: kit.ride },
    anticipations,
    kickBass,
    bassUnits: bassUnitsFor(kickBass.value, pulse.value, kit, spec),
    comping,
    fills: fillsFor(seed, spec, family, phrases, transitions),
    swing: swingFor(ctx, subdivision.value),
    microtimingMs: ctx.hints.microtimingMs !== null
      ? decision(r3(ctx.hints.microtimingMs), "style", "the style grammar's microtiming")
      : decision(0, "default", "on the grid; the performance layer adds the feel"),
    ending: endingFor(seed, family),
    approach,
  };
}

/**
 * The approach: the last bars of a section that a build leaves, or that the
 * arc marks as a lift, open the hats one step (within the tempo ceiling) and
 * crescendo, so the arrival is prepared in the notes of every part.
 */
function approachFor(seed: GrooveSectionSeed, spec: MeterSpec, subdivision: GrooveSubdivision, ceiling: GrooveSubdivision, transitions: TransitionPlan[]): GroovePlanSection["approach"] {
  if (seed.isLast) return decision(null, "default", "the last section ends the song; nothing to approach");
  const build = transitions.find((t) => t.fromSection === seed.sectionName && t.toSection !== seed.sectionName && t.kind === "build");
  const lift = seed.tensionRole === "lift";
  if (!build && !lift) return decision(null, "default", "no build leaves this section and it is not a lift");
  const bars = Math.min(2, seed.endBar - seed.startBar + 1);
  const denser = capped(stepOf(subdivision, 1), ceiling);
  const hatStepUnits = r3(stepUnitsFor(denser, spec));
  const strong = lift || (build?.strength ?? 0) >= 0.6;
  const crescendo = strong ? 18 : 10;
  return decision(
    { bars, hatStepUnits, crescendo },
    lift ? "arc" : "transition",
    `${lift ? "lift" : `${build!.id} is a build (strength ${build!.strength})`}: the last ${bars} bar(s) open the hats to ${denser}${denser === subdivision ? " (the tempo ceiling)" : ""} and crescendo by ${crescendo}`,
  );
}

/** Derive one section's groove, with continuity against the previous section's seed. */
export function deriveGrooveSection(input: GrooveSectionInput, ctx: GrooveContext): GroovePlanSection {
  const own = deriveOnce(input.seed, ctx, input.phrases, input.transitions);
  const changed: string[] = [];
  let note = "first section";
  if (input.previous) {
    const prev = deriveOnce(input.previous, ctx, [], []);
    const licences: string[] = [];
    if (input.previous.textureLevel !== input.seed.textureLevel) licences.push(`texture ${input.previous.textureLevel} → ${input.seed.textureLevel}`);
    if (input.previous.tensionRole !== input.seed.tensionRole) licences.push(`tension ${input.previous.tensionRole} → ${input.seed.tensionRole}`);
    if (input.previous.function !== input.seed.function) licences.push(`function ${input.previous.function} → ${input.seed.function}`);
    if (input.seed.operator === "change_comping_subdivision") licences.push("operator change_comping_subdivision");
    const compare: Array<[string, unknown, unknown]> = [
      ["pulse", prev.pulse.value, own.pulse.value],
      ["subdivision", prev.subdivision.value, own.subdivision.value],
      ["kickBass", prev.kickBass.value, own.kickBass.value],
      ["comping.rhythmic", prev.comping.rhythmic.value, own.comping.rhythmic.value],
      ["comping.bed", prev.comping.bed.value, own.comping.bed.value],
      ["anticipations", stableStringify(prev.anticipations.value), stableStringify(own.anticipations.value)],
    ];
    for (const [field, before, after] of compare) if (before !== after) changed.push(`${field}: ${before} → ${after}`);
    if (changed.length && !licences.length) {
      // No plan-level change licenses a new groove: keep the previous pulse and subdivision.
      own.pulse = decision(prev.pulse.value, "continuity", `kept from ${input.previous.sectionName}: nothing in the plan changed between the sections (was: ${own.pulse.reason})`);
      own.subdivision = decision(prev.subdivision.value, "continuity", `kept from ${input.previous.sectionName} (was: ${own.subdivision.reason})`);
      const kit = kitTemplateFor(own.pulse.value, ctx.timing.meter, own.subdivision.value, input.seed, styleFamilyOf(ctx.style, ctx.productionAesthetic));
      own.kit = { kick: kit.kick, snare: kit.snare, sideStick: kit.sideStick, hatStepUnits: r3(kit.hatStepUnits), openHat: kit.openHat, ghost: kit.ghost, ride: kit.ride };
      own.bassUnits = bassUnitsFor(own.kickBass.value, own.pulse.value, kit, ctx.timing.meter);
      note = `continuity kept the pulse and subdivision of ${input.previous.sectionName}; ${changed.length} field(s) had differed`;
      changed.length = 0;
    } else {
      note = changed.length ? `licensed by ${licences.join("; ")}` : `same groove as ${input.previous.sectionName}`;
    }
  }
  const body = { ...own, continuity: { changedFromPrevious: changed, note } };
  const digest = createHash("sha256").update(stableStringify(body)).digest("hex");
  return { ...body, digest };
}

// ---------------------------------------------------------------------------
// Seeds from the plan layers
// ---------------------------------------------------------------------------

function seedFromSectionPlan(section: SectionPlan, lastBar: number): GrooveSectionSeed {
  return {
    sectionName: section.sectionName,
    startBar: section.startBar,
    endBar: section.endBar,
    function: section.function,
    level: section.energy,
    density: section.density,
    tensionRole: section.tensionRole ?? null,
    textureLevel: section.textureLevel ?? null,
    operator: section.developmentOperator ?? "identity",
    occurrenceIndex: section.occurrenceIndex ?? 0,
    isLast: section.endBar >= lastBar,
  };
}

/** The previous section's seed from the global plan's targets (what a part request can see). */
function seedFromTarget(globalPlan: GlobalArrangementPlan, index: number, lastBar: number): GrooveSectionSeed | null {
  const target = globalPlan.sectionTargets[index];
  if (!target) return null;
  const arc = globalPlan.arc?.sections.find((s) => s.sectionName === target.sectionName);
  return {
    sectionName: target.sectionName,
    startBar: target.startBar,
    endBar: target.endBar,
    function: target.role,
    level: target.energy,
    density: target.density,
    tensionRole: target.tensionRole ?? arc?.tensionRole.value ?? null,
    textureLevel: target.textureLevel ?? arc?.textureLevel.value ?? null,
    operator: arc?.developmentOperator.value ?? "identity",
    occurrenceIndex: arc?.occurrenceIndex ?? 0,
    isLast: target.endBar >= lastBar,
  };
}

function contextOf(globalPlan: GlobalArrangementPlan, timing: BarTiming, hints: GrooveHints): GrooveContext {
  return {
    style: globalPlan.style,
    grooveStrategy: globalPlan.grooveStrategy,
    productionAesthetic: globalPlan.productionAesthetic ?? null,
    timing,
    tempoBand: tempoBandOf(timing.tempoBpm),
    hints,
  };
}

const NO_HINTS: GrooveHints = { swingRatio: null, microtimingMs: null };

/** The groove of the section a part request is for - what the composer's writers read. */
export function grooveSectionForRequest(request: PartGenerationRequest, timing: BarTiming, hints: GrooveHints = NO_HINTS): GroovePlanSection {
  const targets = request.globalPlan.sectionTargets;
  const lastBar = Math.max(...targets.map((t) => t.endBar), request.section.endBar);
  const index = targets.findIndex((t) => t.sectionName === request.section.sectionName);
  const seed = seedFromSectionPlan(request.section, lastBar);
  const previous = index > 0 ? seedFromTarget(request.globalPlan, index - 1, lastBar) : null;
  return deriveGrooveSection(
    { seed, previous, phrases: request.phrases, transitions: request.transitions },
    contextOf(request.globalPlan, timing, hints),
  );
}

export function groovePlanInputsDigest(globalPlan: GlobalArrangementPlan, sectionPlan: SectionPhrasePlan, transitions: TransitionPlan[], timing: BarTiming, hints: GrooveHints): string {
  return createHash("sha256").update(stableStringify({
    globalDigest: globalPlan.inputsDigestSha256,
    grooveStrategy: globalPlan.grooveStrategy,
    style: globalPlan.style,
    aesthetic: globalPlan.productionAesthetic,
    sectionPlanDigest: sectionPlan.inputsDigestSha256,
    sections: sectionPlan.sections.map((s) => [s.sectionName, s.startBar, s.endBar, s.function, s.energy, s.density, s.tensionRole, s.textureLevel, s.developmentOperator]),
    transitions: transitions.map((t) => [t.id, t.kind, t.strength, t.devices.map((d) => [d.device, d.intensity])]),
    tempoBpm: timing.tempoBpm,
    meter: `${timing.meter.numerator}/${timing.meter.denominator}`,
    grouping: timing.meter.grouping,
    hints,
  })).digest("hex");
}

/** The whole song's groove plan from the plan layers. */
export function deriveGroovePlan(
  songModel: SongModelData,
  layers: { globalPlan: GlobalArrangementPlan; sectionPlan: SectionPhrasePlan; transitions: TransitionPlan[] },
  options: { tempoBpm?: number; meter?: string; styleGrammar?: StyleGrammar | null; now?: Date } = {},
): GroovePlan {
  const tempoBpm = options.tempoBpm ?? songModel.tempoMap?.[0]?.bpm ?? 120;
  const meter = options.meter ?? songModel.meterMap?.[0]?.meter ?? "4/4";
  const timing = barTiming(tempoBpm, meter);
  const hints = grooveHintsFromGrammar(options.styleGrammar);
  const ctx = contextOf(layers.globalPlan, timing, hints);
  const sections = layers.sectionPlan.sections;
  const lastBar = Math.max(...sections.map((s) => s.endBar), 1);
  const out: GroovePlanSection[] = [];
  sections.forEach((section, index) => {
    const seed = seedFromSectionPlan(section, lastBar);
    const previous = index > 0 ? seedFromTarget(layers.globalPlan, index - 1, lastBar) ?? seedFromSectionPlan(sections[index - 1], lastBar) : null;
    out.push(deriveGrooveSection({
      seed, previous,
      phrases: layers.sectionPlan.phrases.filter((p) => p.sectionName === section.sectionName),
      transitions: layers.transitions.filter((t) => t.fromSection === section.sectionName || t.toSection === section.sectionName),
    }, ctx));
  });
  return {
    version: GROOVE_PLAN_VERSION,
    derivedAt: (options.now ?? new Date()).toISOString(),
    inputsDigestSha256: groovePlanInputsDigest(layers.globalPlan, layers.sectionPlan, layers.transitions, timing, hints),
    method: METHOD,
    tempoBpm,
    meter,
    sections: out,
  };
}

// ---------------------------------------------------------------------------
// Shared realisation helpers (the parts agree because they call the same code)
// ---------------------------------------------------------------------------

export type ChordLike = { start: number; end: number; symbol: string; root?: string | null };

/** The chord sounding at `time` among `chords` (start-inclusive), or null. */
export function chordAtTime<T extends ChordLike>(chords: readonly T[], time: number): T | null {
  for (let i = chords.length - 1; i >= 0; i -= 1) {
    const c = chords[i];
    if (c.start <= time + 1e-6 && c.end > time + 1e-6) return c;
  }
  return null;
}

export type AnticipationSlot<T extends ChordLike = ChordLike> = {
  bar: number;
  unit: number;
  /** Absolute seconds of the pushed onset. */
  time: number;
  /** Absolute seconds of the grid point being anticipated (the next unit or the next downbeat). */
  target: number;
  /** The chord that starts at (or is sounding at) the target, when known. */
  chord: T | null;
  /** True when the chord at the target differs from the chord at the slot. */
  changesChord: boolean;
};

/**
 * The anticipation slots of one bar under the plan: the units the plan names,
 * filtered by `when` - every bar, only where the next grid point carries a new
 * chord, only at phrase ends, or never. `nextChords` supplies the chords past
 * the part's own window (the following section's first chord for the last bar).
 */
export function anticipationSlots<T extends ChordLike>(
  groove: GroovePlanSection,
  bar: number,
  barStart: number,
  unitSeconds: number,
  chords: readonly T[],
  phraseEndBars: ReadonlySet<number>,
): Array<AnticipationSlot<T>> {
  const { units, when } = groove.anticipations.value;
  if (when === "never") return [];
  if (when === "phrase_ends" && !phraseEndBars.has(bar)) return [];
  const out: Array<AnticipationSlot<T>> = [];
  for (const unit of units) {
    const time = barStart + unit * unitSeconds;
    const target = barStart + Math.ceil(unit + 1e-9) * unitSeconds;
    const here = chordAtTime(chords, time);
    const next = chordAtTime(chords, target);
    const changesChord = !!next && (!here || next.symbol !== here.symbol || Math.abs(next.start - here.start) > 1e-6);
    if (when === "before_chord_change" && !changesChord) continue;
    out.push({ bar, unit, time, target, chord: next, changesChord });
  }
  return out;
}

/** Bars on which a phrase ends, from the section's phrase list. */
export function phraseEndBarsOf(phrases: readonly PhrasePlan[]): Set<number> {
  return new Set(phrases.map((p) => p.endBar));
}
