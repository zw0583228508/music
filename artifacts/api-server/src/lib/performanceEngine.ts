/**
 * Performance Engine V1 (PR-14).
 *
 * Separates **Composition MIDI** ("C4 in bar 20") from **Performance MIDI**
 * ("exactly when the player strikes it, how hard, how long, with what pedal,
 * and how the hand enters the chord").
 *
 * Humanisation is never `timing += random(-20ms, +20ms)`. Every offset and
 * velocity change is derived from: instrument family, tempo, groove, style,
 * phrase position, metrical position, dynamic shape and musical role — with a
 * small *seeded* jitter scaled by all of the above, so the result is
 * deterministic and auditable.
 */
import type {
  ArticulationEvent,
  ControlEvent,
  InstrumentArrangementRole,
  MusicalNote,
  PerformanceDecision,
  PerformanceEvidence,
  PerformanceStyle,
  PhrasePlan,
  StyleProfile,
} from "@workspace/db";
import { LEGATO_TOLERANCE_SECONDS } from "./musicalConstraints";
import { accentWeight, meterOf, type MeterSpec } from "./composer/frame";
import type { StyleGrammar, StyleValue } from "./styleGrammar";
import { resolveStyle } from "./styleResolver";

export const PERFORMANCE_ENGINE = "PERFORMANCE_ENGINE_V2" as const;
const MAX_DECISION_SAMPLE = 64;

// ---------------------------------------------------------------------------
// Style -> performance (PR-23)
// ---------------------------------------------------------------------------

const MELODIC_ROLES: ReadonlySet<string> = new Set(["LEAD", "COUNTER_MELODY", "CALL_RESPONSE"]);
const SUSTAINING_FAMILIES: ReadonlySet<string> = new Set(["strings", "brass", "winds", "voice"]);

/**
 * Brain B-09: the performance-relevant slice of the resolved StyleGrammar.
 * Only values the grammar evidences are carried, each with its provenance
 * (`brief` / `template` / `research` / `fingerprint`), so the evidence can say
 * *why* a bass sits behind the beat. Absent stays absent: the engine then
 * behaves exactly as V1 for that parameter.
 */
export function performanceStyleFromGrammar(grammar: StyleGrammar | null | undefined): PerformanceStyle {
  const style: PerformanceStyle = {};
  if (!grammar) return style;
  const sources: NonNullable<PerformanceStyle["sources"]> = [];
  const take = <K extends keyof PerformanceStyle>(key: K, value: StyleValue<unknown> | undefined, accept: (v: unknown) => PerformanceStyle[K] | undefined) => {
    if (!value) return;
    const accepted = accept(value.value);
    if (accepted === undefined) return;
    style[key] = accepted;
    sources.push({ dimension: key, value: accepted as string | number, provenance: value.provenance });
  };
  const oneOf = <T extends string>(...allowed: T[]) => (value: unknown): T | undefined =>
    typeof value === "string" && (allowed as string[]).includes(value) ? (value as T) : undefined;
  take("swingRatio", grammar.groove.swingRatio, (v) => (typeof v === "number" && v >= 0.5 && v <= 0.8 ? v : undefined));
  take("microtiming", grammar.groove.microtiming, oneOf("quantized", "on_top", "behind", "ahead", "loose"));
  take("dynamics", grammar.performance.dynamics, oneOf("narrow", "moderate", "wide"));
  take("melodicOrnamentation", grammar.melodic.ornamentation, oneOf("none", "light", "moderate", "heavy"));
  take("bassAttackPosition", grammar.bass.attackPosition, oneOf("on_the_beat", "anticipated", "laid_back", "sustained"));
  take("fillFrequency", grammar.groove.fillFrequency, oneOf("rare", "moderate", "frequent"));
  take("articulationLanguage", grammar.performance.articulationLanguage, (v) => (typeof v === "string" && v.trim() ? v : undefined));
  if (sources.length) style.sources = sources;
  return style;
}

/**
 * @deprecated Brain B-09: a StyleProfile is one *input* of the StyleGrammar.
 * This adapter resolves the profile (with the knowledge base the profile's
 * identity names) and projects the grammar; kept for the callers that still
 * hold a bare profile (`arrangementOrchestratorProvider`, `scopedRegeneration`,
 * the arranger training pipeline). An out-of-vocabulary profile value is
 * dropped by the contract's validation and is not carried.
 */
export function performanceStyleFromProfile(profile: StyleProfile | null | undefined): PerformanceStyle {
  if (!profile) return {};
  return performanceStyleFromGrammar(resolveStyle({ styleProfile: profile }).grammar);
}

export type PerformanceInput = {
  trackId: string;
  instrument: string;
  family: string;
  role: InstrumentArrangementRole;
  notes: MusicalNote[];
  tempoBpm: number;
  meter?: string;
  /** From the global plan: steady_pulse / syncopated / swing / rubato / ... */
  groove?: string;
  style?: string;
  /** e.g. "mp->f" from the section's role assignment. */
  dynamicShape?: string;
  phrases?: PhrasePlan[];
  seed?: number;
  /** Bar → seconds, so metrical position can be computed. */
  barSeconds?: number;
  /** PR-23: the instrument's playable range, so ornaments never leave it. */
  playableRange?: { min: number; max: number };
  /**
   * The instrument definition's articulation names. When given, the engine
   * never emits an articulation the instrument cannot map — a bow change on a
   * plucked bass is not a performance decision, it is a rendering error.
   */
  articulationVocabulary?: string[];
  /**
   * The instrument's polyphony limit. At 1, humanised lengths are clamped so
   * no note sustains past the next onset by more than the legato tolerance:
   * a performance must never break a constraint the composition satisfied.
   */
  maxSimultaneousNotes?: number;
  /**
   * PR-23: performance style resolved from the project's StyleProfile. When
   * absent, every parameter keeps its V1 default and the output is identical
   * to V1 -- supplying even an empty style enables the V2 behaviours (phrase
   * dynamics, legato/staccato articulation, keyswitch resolution).
   */
  performanceStyle?: PerformanceStyle;
  /**
   * PR-23: the track's articulation map (TrackMappingMetadata.articulationMap
   * or InstrumentDefinition.directiveMappings): articulation name -> keyswitch
   * note or renderer label. Numeric entries become `keyswitch` on the event,
   * which the VST3 worker plays as a short lead note.
   */
  articulationMap?: Record<string, string | number>;
  /**
   * B-04: absolute seconds of the chord onsets, so the sustain pedal follows
   * the harmonic rhythm. Absent: the pedal follows the part's own chord
   * changes (pitch-class set changes between clusters) and the bar lines.
   */
  chordOnsets?: number[];
  /**
   * B-04: planned agogics from the transition realisation - a ritardando is a
   * time warp every part receives alike, so the parts slow down together.
   * Phrase-final lengthening and the lean-in after a cadence need only
   * `phrases`.
   */
  agogics?: Array<{ kind: "ritardando"; start: number; end: number; slowdown: number }>;
  /**
   * B-13 (R-1b P0-3): the track's section ranges in absolute seconds, each
   * with the role and dynamic shape the section plan assigned it, and the
   * arc's tension role.
   *
   * Without this the orchestrator resolved one role assignment per instrument
   * - `roleAssignments.find((r) => r.instrument === track.instrument)`, the
   * *first* section's - and the whole track was performed as the intro's
   * "pp": shipped velocities were x0.58-0.60 of composed in every one of the
   * owner's nine sections, and the "big final chorus" piano shipped at mean
   * velocity 52 against a composed 86. With it the role, the dynamic ramp and
   * `progress` are resolved per section, so the ramp a shape describes
   * ("mp->mf") happens inside the section it was written for and the composed
   * velocities keep the arc they were written with.
   */
  sectionRanges?: Array<{
    sectionName: string;
    start: number;
    end: number;
    role?: InstrumentArrangementRole;
    dynamicShape?: string;
    tensionRole?: string;
  }>;
};

export type PerformedTrack = {
  notes: MusicalNote[];
  cc: ControlEvent[];
  articulations: ArticulationEvent[];
  evidence: PerformanceEvidence;
};

// ---------------------------------------------------------------------------
// Family + role profiles
// ---------------------------------------------------------------------------

type FamilyProfile = {
  id: string;
  /** Base seeded-jitter width, milliseconds. */
  jitterMs: number;
  /** Systematic push (−) / pull (+) in milliseconds. */
  feelMs: number;
  /** How strongly metrical accent shapes velocity, 0..1. */
  accentDepth: number;
  /** Note-length multiplier: <1 detaches, >1 overlaps (legato). */
  lengthFactor: number;
};

const FAMILY_PROFILES: Record<string, FamilyProfile> = {
  drums: { id: "kit-limb", jitterMs: 3.5, feelMs: -2, accentDepth: 0.85, lengthFactor: 1 },
  bass: { id: "finger-bass", jitterMs: 6, feelMs: -3, accentDepth: 0.6, lengthFactor: 0.96 },
  keys: { id: "two-hand-keyboard", jitterMs: 7, feelMs: 0, accentDepth: 0.55, lengthFactor: 1.02 },
  guitar: { id: "pick-and-strum", jitterMs: 9, feelMs: 1, accentDepth: 0.6, lengthFactor: 0.98 },
  strings: { id: "bowed-phrase", jitterMs: 14, feelMs: 5, accentDepth: 0.35, lengthFactor: 1.08 },
  brass: { id: "breath-phrase", jitterMs: 10, feelMs: 3, accentDepth: 0.5, lengthFactor: 1.02 },
  winds: { id: "breath-phrase", jitterMs: 9, feelMs: 3, accentDepth: 0.45, lengthFactor: 1.02 },
  voice: { id: "sung-phrase", jitterMs: 12, feelMs: 4, accentDepth: 0.4, lengthFactor: 1.05 },
  synth: { id: "patch-locked", jitterMs: 2, feelMs: 0, accentDepth: 0.4, lengthFactor: 1 },
};
const profileFor = (family: string): FamilyProfile => FAMILY_PROFILES[family] ?? FAMILY_PROFILES.keys;

/**
 * Shorten held notes so that no more than `ceiling` notes sound at any onset.
 * "Sounding" follows `simultaneousClusters` in musicalConstraints: a note
 * counts at onset t when it started at or before t and ends after
 * t + LEGATO_TOLERANCE_SECONDS. Mutates `notes` in place (by replacement).
 */
export function clampPolyphony(notes: MusicalNote[], ceiling: number): number {
  notes.sort((a, b) => a.start - b.start || a.pitch - b.pitch);
  const onsets = [...new Set(notes.map((note) => Math.round(note.start * 1000)))].sort((a, b) => a - b);
  let released = 0;
  for (const onsetMs of onsets) {
    const startingHere = notes.filter((note) => Math.round(note.start * 1000) === onsetMs).length;
    // B-24: onsets are *grouped* by whole milliseconds, but the note that
    // sounds must be judged against the real start of the earliest note in the
    // group. Judging against the rounded value let a note that starts at
    // 3.6955 s be treated as starting at 3.696 s, and a held note ending
    // 30.1 ms into it read as legal against a 30 ms tolerance — a half-
    // millisecond of rounding deciding whether two notes sound together.
    const onset = Math.min(
      ...notes.filter((note) => Math.round(note.start * 1000) === onsetMs).map((note) => note.start),
    );
    const held = notes
      .map((note, index) => ({ note, index }))
      .filter(({ note }) => Math.round(note.start * 1000) < onsetMs && note.start + note.duration > onset + LEGATO_TOLERANCE_SECONDS)
      .sort((a, b) => a.note.start - b.note.start || a.note.pitch - b.note.pitch);
    const excess = held.length + startingHere - ceiling;
    if (excess <= 0) continue;
    for (const { note, index } of held.slice(0, Math.min(excess, held.length))) {
      // One millisecond inside the tolerance: "ends after t + tolerance" is a
      // strict comparison on floats, and an end that lands on it by rounding
      // would still count as sounding.
      const limit = onset + LEGATO_TOLERANCE_SECONDS - 0.001 - note.start;
      notes[index] = { ...note, duration: Number(Math.max(0.02, limit).toFixed(4)) };
      released += 1;
    }
  }
  return released;
}

/** Roles that drive vs. float. */
const ROLE_FEEL_MS: Partial<Record<InstrumentArrangementRole, number>> = {
  GROOVE: -3, BASS: -2, FOUNDATION: -2, OSTINATO: -1,
  LEAD: 2, COUNTER_MELODY: 3, CALL_RESPONSE: 3,
  PAD: 8, HARMONIC_BED: 5, RHYTHMIC_HARMONY: 0,
  ACCENT: -1, FILL: -2, TRANSITION: -2, CLIMAX_LAYER: 0,
};

const DYNAMIC_LEVELS: Record<string, number> = {
  pp: 0.35, p: 0.5, mp: 0.62, mf: 0.75, f: 0.88, ff: 1,
};

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function seededUnit(seed: number, key: string): number {
  let h = seed >>> 0;
  for (let i = 0; i < key.length; i += 1) {
    h ^= key.charCodeAt(i);
    h = Math.imul(h, 16_777_619) >>> 0;
  }
  // −1 .. 1, deterministic.
  return ((h % 20_001) / 10_000) - 1;
}

const clamp = (v: number, lo: number, hi: number): number => (v < lo ? lo : v > hi ? hi : v);
const midi = (v: number): number => Math.round(clamp(v, 1, 127));

/** Beat index within the bar (0-based) and the fraction into that beat. */
function metricalPosition(
  timeSeconds: number,
  tempoBpm: number,
  beatsPerBar: number,
): { beatInBar: number; fraction: number } {
  const beat = (timeSeconds * tempoBpm) / 60;
  const beatInBar = Math.floor(beat) % Math.max(1, beatsPerBar);
  return { beatInBar, fraction: beat - Math.floor(beat) };
}

/**
 * Metrical accent weight, 0..1. B-04: the table is per meter and lives in
 * `composer/frame.ts` (`accentWeight`) so the composer and the performance
 * engine accent the same positions: 4/4 keeps 1 / 0.68 / 0.82 / 0.68 on the
 * beats, 0.46 on the off-beat 8ths and 0.34 elsewhere; 3/4 has no secondary
 * accent; 6/8 accents its two dotted pulses; 5/4 and 7/8 accent their group
 * starts with the backbeat group strongest.
 */
function metricalWeightAt(timeSeconds: number, unitSeconds: number, meter: MeterSpec): number {
  return accentWeight(meter, timeSeconds / Math.max(1e-6, unitSeconds));
}

/** Sustain-pedal change points: the bar lines plus the chord onsets (given, or read from the part's own chord changes). */
function pedalChangePoints(notes: readonly MusicalNote[], chordOnsets: number[] | undefined, barSeconds: number, songEnd: number): number[] {
  const points = new Set<number>();
  for (let t = 0; t <= songEnd; t += barSeconds) points.add(Number(t.toFixed(3)));
  if (chordOnsets && chordOnsets.length) {
    for (const t of chordOnsets) if (t >= 0 && t <= songEnd) points.add(Number(t.toFixed(3)));
  } else {
    // The part's own harmony: a cluster whose pitch-class set differs from the previous cluster's is a change.
    const sorted = [...notes].sort((a, b) => a.start - b.start || a.pitch - b.pitch);
    let previous: string | null = null;
    let index = 0;
    while (index < sorted.length) {
      const at = sorted[index].start;
      const cluster: MusicalNote[] = [];
      while (index < sorted.length && sorted[index].start - at < 0.03) { cluster.push(sorted[index]); index += 1; }
      const set = [...new Set(cluster.map((n) => ((n.pitch % 12) + 12) % 12))].sort((a, b) => a - b).join(".");
      if (previous !== null && set !== previous) points.add(Number(at.toFixed(3)));
      previous = set;
    }
  }
  const ordered = [...points].sort((a, b) => a - b);
  // Two changes within 50 ms are one pedal movement.
  return ordered.filter((t, i) => i === 0 || t - ordered[i - 1] > 0.05);
}

/** Phrase arc: rise to ~70% through the phrase, then ease off. */
function phraseArc(timeSeconds: number, phrases: PhrasePlan[] | undefined, barSeconds: number): number {
  if (!phrases || phrases.length === 0 || barSeconds <= 0) return 0;
  const bar = Math.floor(timeSeconds / barSeconds) + 1;
  const phrase = phrases.find((p) => bar >= p.startBar && bar <= p.endBar);
  if (!phrase) return 0;
  const span = Math.max(1, phrase.endBar - phrase.startBar + 1);
  const position = (bar - phrase.startBar) / span;
  return position <= 0.7 ? position / 0.7 : 1 - (position - 0.7) / 0.3;
}

/** "mp->f" | "f" | "mf->mp" → [start, end] level in 0..1. */
function dynamicRamp(shape: string | undefined): [number, number] {
  if (!shape) return [0.7, 0.7];
  const [from, to] = shape.split("->").map((s) => s.trim());
  const start = DYNAMIC_LEVELS[from] ?? 0.7;
  const end = DYNAMIC_LEVELS[to ?? from] ?? start;
  return [start, end];
}

// ---------------------------------------------------------------------------
// Engine
// ---------------------------------------------------------------------------

export function applyPerformance(input: PerformanceInput): PerformedTrack {
  const seed = input.seed ?? 1;
  const family = input.family;
  // The bass lives in the strings definition family but is plucked, exactly
  // the confusion the constraint engine already corrects for (PR-16). Without
  // this it inherits the bowed profile's legato lengthening and every note
  // overlaps the next; the finger-bass profile below was unreachable.
  const plucked = /bass/i.test(input.instrument);
  const profile = plucked ? FAMILY_PROFILES.bass : profileFor(family);
  // B-04: the meter's units and grouping; a bar is numerator x one denominator
  // unit (6/8 and 7/8 were read as six and seven quarters).
  const meterSpec: MeterSpec = meterOf(input.meter);
  const beatsPerBar = meterSpec.numerator;
  const beatSeconds = 60 / Math.max(1, input.tempoBpm);
  const unitSeconds = beatSeconds * (4 / meterSpec.denominator);
  const barSeconds = input.barSeconds ?? unitSeconds * beatsPerBar;
  const style = input.performanceStyle;
  const v2 = style !== undefined;
  const swing = (input.groove ?? "").includes("swing") || (style?.swingRatio ?? 0.5) > 0.5;
  // V1 swung every offbeat to the triplet point; a style names the ratio.
  const swingRatio = style?.swingRatio ?? 2 / 3;
  const rubato = input.groove === "rubato";
  const [dynStart, dynEnd] = dynamicRamp(input.dynamicShape);
  // Dynamics width: how much metrical accent and dynamic shape move velocity.
  const accentDepthScale = style?.dynamics === "narrow" ? 0.6 : style?.dynamics === "wide" ? 1.35 : 1;
  const [rangeFloor, rangeSpan] = style?.dynamics === "narrow" ? [0.82, 0.3]
    : style?.dynamics === "wide" ? [0.65, 0.6] : [0.75, 0.45];
  // Microtiming: where the player sits relative to the grid, and how loosely.
  const microFeelMs = style?.microtiming === "behind" ? 8 : style?.microtiming === "ahead" ? -6 : 0;
  const microJitterScale = style?.microtiming === "quantized" ? 0.1 : style?.microtiming === "loose" ? 1.6 : 1;
  const microFeelScale = style?.microtiming === "quantized" ? 0.2 : 1;

  const source = [...input.notes].sort((a, b) => a.start - b.start || a.pitch - b.pitch);
  const songEnd = Math.max(0.001, ...source.map((n) => n.start + n.duration));

  // B-13: the section a note belongs to, and the role / dynamic ramp that
  // section was planned with. With no `sectionRanges` the track keeps V1's
  // single role and shape and one ramp across the whole song.
  const ranges = (input.sectionRanges ?? []).filter((r) => r.end > r.start).sort((a, b) => a.start - b.start);
  const rangeAt = (time: number) => ranges.find((r) => time >= r.start - 1e-6 && time < r.end - 1e-6);
  /** The role, the dynamic ramp's endpoints and where in the ramp `time` sits. */
  const shapeAt = (time: number): { role: InstrumentArrangementRole; from: number; to: number; progress: number; section: string | null; tensionRole: string | null } => {
    const range = rangeAt(time);
    if (!range) {
      return { role: input.role, from: dynStart, to: dynEnd, progress: clamp(time / songEnd, 0, 1), section: null, tensionRole: null };
    }
    const [from, to] = dynamicRamp(range.dynamicShape ?? input.dynamicShape);
    return {
      role: range.role ?? input.role, from, to,
      progress: clamp((time - range.start) / Math.max(1e-6, range.end - range.start), 0, 1),
      section: range.sectionName, tensionRole: range.tensionRole ?? null,
    };
  };
  const dynamicLevelAt = (time: number): number => {
    const shape = shapeAt(time);
    return shape.from + (shape.to - shape.from) * shape.progress;
  };

  const notes: MusicalNote[] = [];
  const cc: ControlEvent[] = [];
  const articulations: ArticulationEvent[] = [];
  const vocabulary = input.articulationVocabulary;
  const pushArticulation = (event: ArticulationEvent) => {
    if (!vocabulary || vocabulary.includes(event.name)) articulations.push(event);
  };
  const decisions: PerformanceDecision[] = [];
  const added = { ghostNotes: 0, flams: 0, strumSpreadNotes: 0, breathGaps: 0, ornaments: 0, fills: 0, keyswitches: 0 };
  const ccCurves: string[] = [];
  const offsets: number[] = [];
  const phraseAt = (time: number): PhrasePlan | undefined => {
    if (!input.phrases?.length || barSeconds <= 0) return undefined;
    const bar = Math.floor(time / barSeconds) + 1;
    return input.phrases.find((p) => bar >= p.startBar && bar <= p.endBar);
  };
  // Phrase-role dynamics (V2): a pickup or opening starts a touch under, a
  // cadence tapers, a fill leans in. Applied on top of the phrase arc.
  const phraseRoleGain = (time: number): number => {
    if (!v2) return 1;
    const phrase = phraseAt(time);
    if (!phrase) return 1;
    const span = Math.max(1, phrase.endBar - phrase.startBar + 1) * barSeconds;
    const position = clamp((time - (phrase.startBar - 1) * barSeconds) / span, 0, 1);
    if (phrase.role === "pickup" || phrase.role === "opening") return position < 0.25 ? 0.94 : 1;
    if (phrase.role === "cadence") return position > 0.75 ? 0.9 : 1;
    if (phrase.role === "fill") return 1.05;
    return 1;
  };
  // B-04 agogics. (1) Phrase-final lengthening: the last quarter of a cadence
  // phrase's final bar broadens, more for bowed and blown lines than for the
  // rhythm section. (2) The downbeat that follows a cadence or fill phrase
  // leans in (a touch early and a touch stronger). (3) A planned ritardando
  // is a time warp that is a pure function of time, so every part slows
  // together and the export, which plays absolute seconds, honours it.
  const AGOGIC_MS: Record<string, number> = { strings: 14, brass: 14, winds: 14, voice: 14, keys: 10, guitar: 10, bass: 6, drums: 2, synth: 2 };
  const agogicAt = (time: number): { ms: number; reason: string; leanIn: boolean } => {
    if (!input.phrases?.length || barSeconds <= 0) return { ms: 0, reason: "", leanIn: false };
    const phrase = phraseAt(time);
    let ms = 0;
    let reason = "";
    if (phrase && phrase.role === "cadence") {
      const end = phrase.endBar * barSeconds;
      const from = end - barSeconds * 0.25;
      if (time >= from - 1e-6) {
        ms = (AGOGIC_MS[plucked ? "bass" : family] ?? 6) * clamp((time - from) / Math.max(1e-6, end - from), 0, 1);
        reason = "phrase-final lengthening (cadence)";
      }
    }
    const bar = Math.floor(time / barSeconds + 1e-6) + 1;
    const atDownbeat = Math.abs(time - (bar - 1) * barSeconds) < 0.02;
    const leanIn = atDownbeat && !!phrase && phrase.startBar === bar &&
      input.phrases.some((p) => p.endBar === bar - 1 && (p.role === "cadence" || p.role === "fill"));
    return { ms, reason, leanIn };
  };
  const warpAt = (time: number): { offsetSeconds: number; stretch: number } => {
    let offsetSeconds = 0;
    let stretch = 1;
    for (const event of input.agogics ?? []) {
      if (event.kind !== "ritardando" || event.end <= event.start) continue;
      const span = event.end - event.start;
      if (time <= event.start) continue;
      if (time >= event.end) { offsetSeconds += span * event.slowdown / 2; continue; }
      const p = (time - event.start) / span;
      offsetSeconds += (time - event.start) * (event.slowdown * p) / 2;
      stretch *= 1 + event.slowdown * p;
    }
    return { offsetSeconds, stretch };
  };

  // Group simultaneous notes so chords can be rolled/strummed as one gesture.
  const clusters: MusicalNote[][] = [];
  for (const note of source) {
    const open = clusters[clusters.length - 1];
    if (open && Math.abs(open[0].start - note.start) < 0.012) open.push(note);
    else clusters.push([note]);
  }

  for (const cluster of clusters) {
    const anchor = cluster[0];
    const { beatInBar, fraction } = metricalPosition(anchor.start, input.tempoBpm, beatsPerBar);
    const weight = metricalWeightAt(anchor.start, unitSeconds, meterSpec);
    const arc = phraseArc(anchor.start, input.phrases, barSeconds);
    // B-13: this section's role, shape and place in its own ramp.
    const shape = shapeAt(anchor.start);
    const role = shape.role;
    const dynamicLevel = shape.from + (shape.to - shape.from) * shape.progress;

    // --- timing -------------------------------------------------------
    const reasons: string[] = [];
    let offsetMs = (profile.feelMs + (ROLE_FEEL_MS[role] ?? 0)) * microFeelScale + microFeelMs;
    reasons.push(`${family} feel ${profile.feelMs}ms`, `${role} feel ${ROLE_FEEL_MS[role] ?? 0}ms`);
    if (shape.section) reasons.push(`${shape.section}${shape.tensionRole ? ` (${shape.tensionRole})` : ""}: ${role}, ${shape.from.toFixed(2)}->${shape.to.toFixed(2)}`);
    if (style?.microtiming) reasons.push(`microtiming ${style.microtiming}`);
    if (plucked && style?.bassAttackPosition) {
      // Where the bassist places the attack against the kick.
      const bassMs = style.bassAttackPosition === "anticipated" ? -12
        : style.bassAttackPosition === "laid_back" ? 14 : 0;
      offsetMs += bassMs;
      reasons.push(`bass attack ${style.bassAttackPosition}`);
    }
    if (swing && Math.abs(fraction - 0.5) < 0.08) {
      offsetMs += beatSeconds * 1000 * (swingRatio - 0.5);
      reasons.push("swung offbeat");
      if (style?.swingRatio !== undefined) reasons.push(`swing ratio ${swingRatio.toFixed(2)}`);
    }
    if (rubato && arc > 0) {
      offsetMs += (1 - arc) * 12;
      reasons.push("rubato phrase breathing");
    }
    const agogic = agogicAt(anchor.start);
    if (agogic.ms > 0) { offsetMs += agogic.ms; reasons.push(agogic.reason); }
    if (agogic.leanIn) { offsetMs -= 6; reasons.push("downbeat after a cadence leans in"); }
    const warp = warpAt(anchor.start);
    if (warp.offsetSeconds > 0) reasons.push(`ritardando +${(warp.offsetSeconds * 1000).toFixed(0)}ms`);
    // Tighter on strong beats; looser off the grid.
    const jitterScale = profile.jitterMs * (0.4 + (1 - weight) * 0.9) * microJitterScale;
    // B-24: seeded from where the note is and who plays it, never from the
    // note's id — ids are built as `part-<sectionName>-<instrument>-<role>`
    // (`partComposer.ts:233`), so seeding on them made a player's micro-timing
    // depend on the *label* the producer typed for the section. Renaming
    // "Chorus" to "פזמון" moved every onset.
    const jitter = seededUnit(seed, `${family}:${role}:t:${anchor.start.toFixed(4)}`) * jitterScale;
    offsetMs += jitter;
    reasons.push(`metrical weight ${weight.toFixed(2)}`);
    offsets.push(offsetMs);

    // --- chord gesture (roll / strum / hand offset) ---------------------
    const sorted = [...cluster].sort((a, b) => a.pitch - b.pitch);
    const strumDown = beatInBar % 2 === 0;
    let spreadMs = 0;
    if (cluster.length > 1) {
      if (family === "guitar") {
        spreadMs = 8 + cluster.length * 2.5 + (1 - weight) * 6;
        reasons.push(`${strumDown ? "down" : "up"} strum spread ${spreadMs.toFixed(0)}ms`);
        added.strumSpreadNotes += cluster.length - 1;
      } else if (family === "keys") {
        spreadMs = 4 + cluster.length * 1.8 * (1 - dynamicLevel * 0.5);
        reasons.push(`chord roll ${spreadMs.toFixed(0)}ms`);
        added.strumSpreadNotes += cluster.length - 1;
      } else if (family === "strings" || family === "brass") {
        spreadMs = 3;
      }
    }

    cluster.forEach((note) => {
      const index = sorted.indexOf(note);
      const order = family === "guitar" && !strumDown ? cluster.length - 1 - index : index;
      const gestureMs = spreadMs * (cluster.length > 1 ? order / (cluster.length - 1) : 0);
      // Piano left hand (below C4) leads very slightly.
      const handMs = family === "keys" && note.pitch < 60 ? -4 : 0;
      const start = Math.max(0, note.start + warp.offsetSeconds + (offsetMs + gestureMs + handMs) / 1000);

      // --- velocity ---------------------------------------------------
      const accent = 1 - profile.accentDepth * accentDepthScale * (1 - weight);
      let velocity = (note.velocity || 90) * accent;
      velocity *= rangeFloor + dynamicLevel * rangeSpan;
      velocity *= 0.9 + arc * 0.2;
      velocity *= phraseRoleGain(anchor.start);
      if (agogic.leanIn) velocity *= 1.04;
      if (family === "drums") {
        // Kick/snare carry the accent; hats sit under them.
        if (note.pitch === 42 || note.pitch === 44 || note.pitch === 46) velocity *= 0.72;
        if (note.pitch === 36 || note.pitch === 38) velocity *= 1.08;
      }
      // B-24: same rule as the timing jitter — the music, not the label.
      velocity += seededUnit(seed, `${family}:v:${note.start.toFixed(4)}:${note.pitch}`) * 4;
      const performedVelocity = midi(velocity);

      // --- length -----------------------------------------------------
      // The ritardando stretches durations with the time; phrase-final lengthening delays the onset only (a
      // longer chord would lap the next one and break a fingering the composition kept legal).
      let duration = note.duration * profile.lengthFactor * warp.stretch;
      if (plucked && style?.bassAttackPosition === "sustained") duration *= 1.15;
      if (role === "PAD" || role === "HARMONIC_BED") duration *= 1.06;
      if (role === "GROOVE" || family === "drums") duration = Math.min(duration, 0.25);
      duration = Math.max(0.02, duration);

      notes.push({ ...note, start: Number(start.toFixed(4)), duration: Number(duration.toFixed(4)), velocity: performedVelocity });
      if (decisions.length < MAX_DECISION_SAMPLE) {
        decisions.push({
          noteId: note.id,
          timingOffsetMs: Number((offsetMs + gestureMs + handMs).toFixed(2)),
          velocityDelta: performedVelocity - (note.velocity || 90),
          reasons: [...reasons],
        });
      }
    });
  }

  // --- family gestures --------------------------------------------------
  if (family === "drums") {
    // Ghost snares between backbeats, and a flam on the loudest hit.
    const snares = notes.filter((n) => n.pitch === 38).sort((a, b) => a.start - b.start);
    for (let i = 1; i < snares.length; i += 1) {
      const gap = snares[i].start - snares[i - 1].start;
      // B-04: no ghost inside a rest longer than two bars (one used to appear four bars into a drum-less section).
      if (gap > beatSeconds * 1.4 && gap <= barSeconds * 2) {
        // B-04: a ghost sits on a weak position - the last 16th (x/8: the last 8th) before the next backbeat - not on the beat between the two.
        const at = snares[i].start - unitSeconds * (meterSpec.denominator >= 8 ? 0.5 : 0.25);
        notes.push({
          id: `${snares[i - 1].id}-ghost`, start: Number(at.toFixed(4)),
          duration: 0.06, pitch: 38, velocity: 26,
        });
        added.ghostNotes += 1;
      }
    }
    const loudest = notes.reduce<MusicalNote | null>(
      (best, n) => (n.pitch === 38 && (!best || n.velocity > best.velocity) ? n : best), null,
    );
    if (loudest) {
      notes.push({
        id: `${loudest.id}-flam`, start: Number(Math.max(0, loudest.start - 0.022).toFixed(4)),
        duration: 0.05, pitch: 38, velocity: Math.max(20, Math.round(loudest.velocity * 0.45)),
      });
      added.flams += 1;
      pushArticulation({ time: loudest.start, name: "flam", intensity: 0.6 });
    }
  }

  if (family === "strings" || family === "brass" || family === "winds") {
    // CC1 phrase arc + CC11 bow/breath dynamics across the part.
    const step = Math.max(0.25, beatSeconds / 2);
    for (let t = 0; t <= songEnd; t += step) {
      const arc = phraseArc(t, input.phrases, barSeconds);
      const level = dynamicLevelAt(t);
      cc.push({ controller: 1, time: Number(t.toFixed(3)), value: midi(40 + arc * 60 + level * 20) });
      cc.push({ controller: 11, time: Number(t.toFixed(3)), value: midi(50 + level * 60 + arc * 15) });
    }
    ccCurves.push("CC1 phrase arc", "CC11 bow/breath dynamics");
    // Bow changes / attacks at phrase starts.
    for (const phrase of input.phrases ?? []) {
      pushArticulation({
        time: Number(((phrase.startBar - 1) * barSeconds).toFixed(3)),
        name: family === "strings" && !plucked ? "bow_change" : "attack",
        intensity: 0.5,
      });
    }
  }

  if (family === "brass" || family === "winds" || family === "voice") {
    // Breathe: shorten the last note before every long rest.
    const ordered = notes.slice().sort((a, b) => a.start - b.start);
    for (let i = 0; i < ordered.length - 1; i += 1) {
      const gap = ordered[i + 1].start - (ordered[i].start + ordered[i].duration);
      if (gap > 0.3) {
        ordered[i].duration = Math.max(0.05, ordered[i].duration - 0.08);
        added.breathGaps += 1;
      }
    }
  }

  if (family === "guitar" && (input.role === "RHYTHMIC_HARMONY" || input.role === "OSTINATO")) {
    pushArticulation({ time: 0, name: "palm_mute", intensity: 0.4 });
  }
  if (family === "keys") {
    // B-04: the sustain pedal follows the harmonic rhythm - up on every chord
    // onset (and every bar line), down 30 ms after - instead of once per bar,
    // which smeared a chord change on beat 3 into the chord before it.
    for (const t of pedalChangePoints(notes, input.chordOnsets, barSeconds, songEnd)) {
      cc.push({ controller: 64, time: Number(t.toFixed(3)), value: 0 });
      cc.push({ controller: 64, time: Number((t + 0.03).toFixed(3)), value: 100 });
    }
    ccCurves.push(input.chordOnsets?.length ? "CC64 sustain pedal on chord onsets" : "CC64 sustain pedal on the part's chord changes and bar lines");
  }

  // --- V2: ornaments, fills, articulation language, keyswitches -------------
  if (v2) {
    const phrases = input.phrases ?? [];
    const minPitch = input.playableRange?.min ?? 0;
    const maxPitch = input.playableRange?.max ?? 127;

    // Ornaments for melodic roles: a grace note from below into the phrase
    // peak (light), also into the phrase's first note (moderate), and a
    // slide-in to the phrase's last note (heavy). Deterministic, in range,
    // and short enough that the monophony clamp keeps the line playable.
    const ornamentation = style?.melodicOrnamentation ?? "none";
    if (ornamentation !== "none" && MELODIC_ROLES.has(input.role) && phrases.length) {
      for (const phrase of phrases) {
        const start = (phrase.startBar - 1) * barSeconds;
        const end = phrase.endBar * barSeconds;
        const inPhrase = notes.filter((n) => n.start >= start && n.start < end && !n.id.includes("-grace"));
        if (!inPhrase.length) continue;
        const targets: MusicalNote[] = [inPhrase.reduce((best, n) => (n.pitch > best.pitch ? n : best), inPhrase[0])];
        if (ornamentation !== "light") targets.push(inPhrase[0]);
        if (ornamentation === "heavy") targets.push(inPhrase[inPhrase.length - 1]);
        for (const target of new Set(targets)) {
          const gracePitch = target.pitch - 2;
          if (gracePitch < minPitch || target.start < 0.07) continue;
          notes.push({
            id: `${target.id}-grace`,
            start: Number((target.start - 0.06).toFixed(4)),
            duration: 0.05,
            pitch: gracePitch,
            velocity: midi(target.velocity * 0.7),
          });
          added.ornaments += 1;
        }
      }
      if (added.ornaments) ccCurves.push(`ornaments ${ornamentation}`);
    }

    // Drum fills into phrase boundaries: four sixteenths on the beat before a
    // phrase, rising into it. Frequency decides which boundaries earn one.
    if (family === "drums" && input.role === "GROOVE" && style?.fillFrequency && phrases.length) {
      const wants = (phrase: PhrasePlan): boolean =>
        style.fillFrequency === "rare" ? phrase.role === "fill"
          : style.fillFrequency === "moderate" ? phrase.role === "fill" || phrase.role === "cadence"
            : phrase.role === "fill" || phrase.role === "cadence" || phrase.entersFamilies.length > 0;
      const fillPitches = [38, 45, 43, 41];
      for (const phrase of phrases) {
        if (!wants(phrase)) continue;
        const phraseStart = (phrase.startBar - 1) * barSeconds;
        const fillStart = phraseStart - beatSeconds;
        if (fillStart < 0) continue;
        for (let i = 0; i < 4; i += 1) {
          notes.push({
            id: `${phrase.id}-fill-${i}`,
            start: Number((fillStart + (i * beatSeconds) / 4).toFixed(4)),
            duration: 0.08,
            pitch: fillPitches[i],
            velocity: 70 + i * 13,
          });
        }
        added.fills += 1;
      }
    }

    // Articulation language for sustaining lines: legato at phrase starts
    // when the line is connected; staccato once per phrase when most of its
    // notes are detached. Both go through the vocabulary gate.
    if (SUSTAINING_FAMILIES.has(family) && !plucked && phrases.length) {
      for (const phrase of phrases) {
        const start = (phrase.startBar - 1) * barSeconds;
        const end = phrase.endBar * barSeconds;
        const inPhrase = notes.filter((n) => n.start >= start && n.start < end).sort((a, b) => a.start - b.start);
        if (inPhrase.length < 2) continue;
        let detached = 0;
        for (let i = 0; i + 1 < inPhrase.length; i += 1) {
          const ioi = inPhrase[i + 1].start - inPhrase[i].start;
          if (ioi > 0 && inPhrase[i].duration < ioi * 0.35) detached += 1;
        }
        const ratio = detached / (inPhrase.length - 1);
        pushArticulation({ time: Number(start.toFixed(3)), name: ratio >= 0.6 ? "staccato" : "legato", intensity: 0.5 });
      }
    }

    // Keyswitches: resolve articulation names through the track's map so the
    // renderer plays them, not just reads them.
    if (input.articulationMap) {
      for (let i = 0; i < articulations.length; i += 1) {
        const mapped = input.articulationMap[articulations[i].name];
        const key = typeof mapped === "number" ? mapped : typeof mapped === "string" && /^\d+$/.test(mapped) ? Number(mapped) : undefined;
        if (key !== undefined && key >= 0 && key <= 127 && articulations[i].keyswitch === undefined) {
          articulations[i] = { ...articulations[i], keyswitch: key };
          added.keyswitches += 1;
        }
      }
    }
    void maxPitch;
  }

  notes.sort((a, b) => a.start - b.start || a.pitch - b.pitch);
  cc.sort((a, b) => a.time - b.time || a.controller - b.controller);
  articulations.sort((a, b) => a.time - b.time);

  const meanOffset = offsets.length ? offsets.reduce((s, v) => s + v, 0) / offsets.length : 0;
  const variance = offsets.length
    ? offsets.reduce((s, v) => s + (v - meanOffset) ** 2, 0) / offsets.length
    : 0;

  if (input.maxSimultaneousNotes && input.maxSimultaneousNotes >= 1) {
    // The instrument's polyphony ceiling survives humanisation. Legato
    // lengthening (bowed strings ×1.08, a harmonic bed ×1.06) lets the tails of
    // one chord lap the next; at a ceiling of 1 that is the monophony rule, at
    // 4 it is a string quartet whose fifth and sixth "voices" are the previous
    // chord still ringing. Same definition of "sounding together" as the
    // constraint engine and the provider contract validator (a note sounds at
    // an onset when it ends more than the legato tolerance after it), so what
    // is performed still passes the check the composition passed. The
    // earliest-started held notes are released first, down to the tolerance.
    clampPolyphony(notes, input.maxSimultaneousNotes);
  }

  return {
    notes,
    cc,
    articulations,
    evidence: {
      version: "1.0",
      engine: PERFORMANCE_ENGINE,
      engineVersion: v2 ? "2.0" : "1.0",
      seed,
      family,
      profile: profile.id,
      meanTimingOffsetMs: Number(meanOffset.toFixed(2)),
      timingStdMs: Number(Math.sqrt(variance).toFixed(2)),
      addedEvents: v2
        ? added
        : { ghostNotes: added.ghostNotes, flams: added.flams, strumSpreadNotes: added.strumSpreadNotes, breathGaps: added.breathGaps },
      ccCurves,
      ...(v2 ? { styleInputs: style?.sources ?? [] } : {}),
      decisions,
    },
  };
}
