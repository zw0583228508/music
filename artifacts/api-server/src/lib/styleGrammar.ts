/**
 * Style grammar (Wave Q, Q-02).
 *
 * A fingerprint (PR-27) says how a reference *behaves*: swings at 0.62, chords
 * change every bar, the melody moves stepwise in four-beat phrases. Those are
 * measurements. A composer cannot act on a measurement — it has to be turned
 * into an instruction with a strength, and the turning is where the judgement
 * lives.
 *
 * Three rules govern that translation, and each exists because the obvious
 * implementation gets it wrong:
 *
 *  1. **A neutral measurement produces no rule.** A swing ratio of 0.51 is a
 *     straight feel measured with noise, not a subtle swing. Emitting a
 *     weak-but-present swing rule from it makes every song slightly swung. Such
 *     measurements are dropped and listed in `omitted`, so the silence is
 *     visible rather than accidental.
 *  2. **Weight follows distance from neutral**, not confidence in the analysis.
 *     A heavily swung reference produces a strong swing rule; a mildly swung one
 *     produces a weak one that other considerations may override.
 *  3. **Thin evidence weakens every rule at once.** A fingerprint taken from
 *     forty seconds and one section describes a passage, not a style, and the
 *     grammar says so in its basis instead of quietly sounding as certain as one
 *     taken from a whole song.
 *
 * The grammar inherits the fingerprint's content-freedom by construction: it
 * only ever reads statistics, so it cannot carry a note, a chord, a lyric or a
 * sample out of the reference.
 */
import type { StyleFingerprint } from "@workspace/db";
import type { StyleGrammarSlot } from "./partGenerationContextV2";

export const STYLE_GRAMMAR_VERSION = "STYLE_GRAMMAR_V1" as const;

/** Below this a rule is noise dressed as an instruction, and is not emitted. */
export const MIN_RULE_WEIGHT = 0.15;

/** Under this much material a fingerprint describes a passage, not a style. */
export const THIN_EVIDENCE_SECONDS = 45;
export const THIN_EVIDENCE_SECTIONS = 2;

/** How much every rule is weakened when the evidence is thin. */
export const THIN_EVIDENCE_FACTOR = 0.6;

export type GrammarDirective =
  | { kind: "swing"; ratio: number }
  | { kind: "microtiming"; offsetMs: number }
  | { kind: "ratio"; feature: "syncopation" | "stepwise" | "ornamentation" | "functionalMotion" | "extensions"; target: number }
  | { kind: "rate"; feature: "onsetsPerBeat" | "chordsPerBar" | "notesPerBar"; target: number }
  | { kind: "chordExtensions"; level: "triads" | "sevenths" | "extended" }
  | { kind: "phraseLength"; beats: number }
  | { kind: "register"; tendency: StyleFingerprint["register"]["tendency"] }
  | { kind: "velocityRange"; min: number; max: number }
  | { kind: "arc"; shape: StyleFingerprint["density"]["arcShape"]; points: number[] }
  | { kind: "hierarchy"; families: string[] };

export type GrammarRule = {
  id: string;
  description: string;
  /** 0..1. Nothing here is a hard constraint; those live on the instrument. */
  weight: number;
  directive: GrammarDirective;
};

export type StyleGrammar = {
  version: typeof STYLE_GRAMMAR_VERSION;
  rules: GrammarRule[];
  /** Measurements too close to neutral to become instructions, with the value. */
  omitted: string[];
  /** What the grammar was derived from, and how far it may be trusted. */
  basis: {
    source: StyleFingerprint["source"];
    durationSeconds: number;
    sectionCount: number;
    thinEvidence: boolean;
    /** Always present: one reference is a reference, not a style. */
    caveat: string;
  };
};

const clamp01 = (value: number): number => Math.max(0, Math.min(1, value));
const round = (value: number, digits = 3): number => Number(value.toFixed(digits));

/**
 * Distance from neutral, scaled to a weight. `span` is the distance at which a
 * measurement is as strong a signal as it can be.
 */
const fromNeutral = (value: number, neutral: number, span: number): number =>
  clamp01(Math.abs(value - neutral) / span);

// ---------------------------------------------------------------------------

/**
 * Turn a fingerprint into rules. Deterministic: the same fingerprint gives the
 * same grammar, so a run can be replayed and a change in the writing can be
 * traced to a change in the reference rather than to the grammar drifting.
 */
export function deriveStyleGrammar(fingerprint: StyleFingerprint): StyleGrammar {
  const rules: GrammarRule[] = [];
  const omitted: string[] = [];

  const thinEvidence =
    fingerprint.durationSeconds < THIN_EVIDENCE_SECONDS ||
    fingerprint.sectionCount < THIN_EVIDENCE_SECTIONS;
  const evidenceFactor = thinEvidence ? THIN_EVIDENCE_FACTOR : 1;

  const add = (rule: Omit<GrammarRule, "weight"> & { weight: number }): void => {
    const weight = round(clamp01(rule.weight) * evidenceFactor);
    if (weight < MIN_RULE_WEIGHT) {
      omitted.push(`${rule.id}: too close to neutral to be an instruction (weight ${weight})`);
      return;
    }
    rules.push({ ...rule, weight });
  };

  // --- groove -------------------------------------------------------------

  const { groove } = fingerprint;
  // 0.5 is straight, 0.667 is a triplet swing. Half of that distance is the
  // point at which the swing is unmistakable.
  add({
    id: "swing",
    description: `place off-beat subdivisions at a ${round(groove.swingRatio, 2)} swing ratio`,
    weight: fromNeutral(groove.swingRatio, 0.5, 0.12),
    directive: { kind: "swing", ratio: round(groove.swingRatio, 3) },
  });

  // Under about 8 ms nobody hears a push or a drag; that is grid noise.
  add({
    id: "microtiming",
    description: groove.microtimingMs < 0
      ? `play ahead of the grid by ${Math.abs(Math.round(groove.microtimingMs))} ms`
      : `sit behind the grid by ${Math.round(groove.microtimingMs)} ms`,
    weight: fromNeutral(groove.microtimingMs, 0, 25) * (Math.abs(groove.microtimingMs) < 8 ? 0 : 1),
    directive: { kind: "microtiming", offsetMs: round(groove.microtimingMs, 1) },
  });

  add({
    id: "syncopation",
    description: `about ${Math.round(groove.syncopation * 100)}% of onsets fall on weak positions`,
    weight: fromNeutral(groove.syncopation, 0.2, 0.3),
    directive: { kind: "ratio", feature: "syncopation", target: round(groove.syncopation) },
  });

  add({
    id: "onset-density",
    description: `about ${round(groove.onsetDensity, 2)} onsets per beat`,
    // Two onsets per beat is the middle of the ordinary range.
    weight: fromNeutral(groove.onsetDensity, 2, 2),
    directive: { kind: "rate", feature: "onsetsPerBeat", target: round(groove.onsetDensity, 2) },
  });

  // --- harmony ------------------------------------------------------------

  const { harmony } = fingerprint;
  add({
    id: "harmonic-rhythm",
    description: `chords change about ${round(harmony.chordsPerBar, 2)} times a bar (${harmony.harmonicRhythm})`,
    weight: fromNeutral(harmony.chordsPerBar, 1, 1.5),
    directive: { kind: "rate", feature: "chordsPerBar", target: round(harmony.chordsPerBar, 2) },
  });

  // The level is categorical, so it is stated at a weight set by how far the
  // extension share is from the boundary it sits on.
  add({
    id: "chord-extensions",
    description: harmony.chordExtensions === "triads"
      ? "voice triads; sevenths and extensions are foreign here"
      : `voice ${harmony.chordExtensions} (${Math.round(harmony.extensionShare * 100)}% of chords go beyond triads)`,
    weight: harmony.chordExtensions === "triads"
      ? clamp01(1 - harmony.extensionShare * 3)
      : fromNeutral(harmony.extensionShare, 0.15, 0.4),
    directive: { kind: "chordExtensions", level: harmony.chordExtensions },
  });

  add({
    id: "functional-motion",
    description: `${Math.round(harmony.functionalMotion * 100)}% of root motion is by fourth or fifth`,
    weight: fromNeutral(harmony.functionalMotion, 0.35, 0.35),
    directive: { kind: "ratio", feature: "functionalMotion", target: round(harmony.functionalMotion) },
  });

  // --- melody -------------------------------------------------------------

  const { melodicShape } = fingerprint;
  add({
    id: "stepwise-motion",
    description: `${Math.round(melodicShape.stepwiseRatio * 100)}% of melodic intervals are steps`,
    // Most melodies are mostly stepwise; the signal is the departure from that.
    weight: fromNeutral(melodicShape.stepwiseRatio, 0.65, 0.3),
    directive: { kind: "ratio", feature: "stepwise", target: round(melodicShape.stepwiseRatio) },
  });

  add({
    id: "phrase-length",
    description: `write in phrases of about ${round(melodicShape.phraseLengthBeats, 1)} beats (${melodicShape.phraseLength})`,
    // Four beats is the default phrase; departures from it are the style.
    weight: fromNeutral(melodicShape.phraseLengthBeats, 4, 4),
    directive: { kind: "phraseLength", beats: round(melodicShape.phraseLengthBeats, 2) },
  });

  add({
    id: "ornamentation",
    description: `ornamentation is ${melodicShape.ornamentation}`,
    weight: fromNeutral(melodicShape.ornamentDensity, 0.05, 0.25),
    directive: { kind: "ratio", feature: "ornamentation", target: round(melodicShape.ornamentDensity) },
  });

  // --- register, dynamics, shape -----------------------------------------

  add({
    id: "register",
    description: `the writing sits ${fingerprint.register.tendency}`,
    // "mid" is where music sits by default and is not an instruction.
    weight: fingerprint.register.tendency === "mid" ? 0 : 0.5,
    directive: { kind: "register", tendency: fingerprint.register.tendency },
  });

  const { dynamics } = fingerprint;
  add({
    id: "dynamic-range",
    description: `velocities run ${Math.round(dynamics.velocityP10)}–${Math.round(dynamics.velocityP90)} (${dynamics.rangeClass})`,
    // A narrow or a wide range is a decision; a moderate one is the default.
    weight: dynamics.rangeClass === "moderate" ? 0 : 0.5,
    directive: {
      kind: "velocityRange",
      min: Math.round(dynamics.velocityP10),
      max: Math.round(dynamics.velocityP90),
    },
  });

  add({
    id: "energy-arc",
    description: `energy is ${fingerprint.density.arcShape} across the piece`,
    // A flat arc is the absence of a shape, not a shape to reproduce.
    weight: fingerprint.density.arcShape === "flat" ? 0 : 0.6,
    directive: {
      kind: "arc",
      shape: fingerprint.density.arcShape,
      points: fingerprint.energyArc.map((value) => round(value)),
    },
  });

  add({
    id: "density",
    description: `about ${round(fingerprint.density.notesPerBarMean, 1)} notes per bar`,
    weight: fromNeutral(fingerprint.density.notesPerBarMean, 8, 10),
    directive: { kind: "rate", feature: "notesPerBar", target: round(fingerprint.density.notesPerBarMean, 2) },
  });

  const { instrumentation } = fingerprint;
  add({
    id: "instrument-hierarchy",
    description: instrumentation.hierarchy.length
      ? `${instrumentation.hierarchy[0]} leads; ${instrumentation.hierarchy.slice(1).join(", ") || "nothing else"} follows`
      : "no instrument hierarchy was measured",
    weight: instrumentation.hierarchy.length > 1 ? 0.5 : 0,
    directive: { kind: "hierarchy", families: [...instrumentation.hierarchy] },
  });

  return {
    version: STYLE_GRAMMAR_VERSION,
    rules: rules.sort((a, b) => b.weight - a.weight || a.id.localeCompare(b.id)),
    omitted,
    basis: {
      source: fingerprint.source,
      durationSeconds: fingerprint.durationSeconds,
      sectionCount: fingerprint.sectionCount,
      thinEvidence,
      caveat: thinEvidence
        ? `derived from ${Math.round(fingerprint.durationSeconds)}s and ${fingerprint.sectionCount} section(s): this describes a passage, not a style, and every rule is weakened accordingly`
        : "derived from one reference: this describes how that reference behaves, not how a genre behaves",
    },
  };
}

/**
 * The grammar as the Q-02 slot a `PartGenerationRequestV2` carries.
 *
 * A grammar with no rules is not passed off as available. Every measurement was
 * neutral, which is itself a finding — the reference has no strong behaviour to
 * imitate — and a composer told that will write plainly instead of hunting for
 * a character that was never there.
 */
export function styleGrammarSlot(grammar: StyleGrammar): StyleGrammarSlot {
  if (!grammar.rules.length) {
    return {
      status: "not_available",
      reason: `no measurement in the reference was far enough from neutral to become a rule (${grammar.omitted.length} considered)`,
    };
  }
  return {
    status: "available",
    // The version carries the caveat's weight class, so a grammar built on thin
    // evidence cannot be read as one built on a whole song.
    version: `${STYLE_GRAMMAR_VERSION}:${grammar.basis.thinEvidence ? "thin" : "full"}`,
    rules: grammar.rules.map((rule) => ({
      id: rule.id,
      description: rule.description,
      weight: rule.weight,
      // The half a pass acts on. Without it the groove pass had to read the
      // swing ratio back out of English, which is a contract asking to be
      // misread.
      directive: rule.directive,
    })),
  };
}
