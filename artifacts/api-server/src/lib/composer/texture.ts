/**
 * Texture archetypes (Brain B-13, D3): what a candidate strategy asks of the
 * writers, instead of thinning their output by an evenly spaced stride.
 *
 * Before this the orchestrator composed every candidate identically and then
 * deleted every Nth note of the time-sorted list to reach a strategy's
 * `densityMultiplier` (`applyDensity`): kicks fell off downbeats (B-12, C7), a
 * motif statement lost half its notes (B-10's finding), a voicing lost an
 * inner voice at random, and "sparse" meant nothing musical. The strategy's
 * other parameters had no reader at all (audit §1.4).
 *
 * Now a strategy is a `TextureIntent` the writers realise:
 *
 *   - density (`thin` / `normal` / `dense`, from the per-part multiplier the
 *     plan still carries) chooses the chordal archetype - a *sustained* bed
 *     (ties across bars while the chord holds), *block* chords on the groove
 *     plan's comping cell, or an *arpeggio* through the voicing at the plan's
 *     step - the voice count (one fewer / one more), which of the plan's two
 *     cells a part reads (the bed cell or the rhythmic cell), the bass
 *     figures (roots only / roots and fifths / the full figure set) and the
 *     kit's hat subdivision and ghosts;
 *   - `syncopationBias` decides whether a keyboard / guitar bed comps on the
 *     rhythmic cell (block chords that push with the shared anticipations);
 *   - `harmonicAdventurousness` moves the voicing solver's extension level
 *     (triads / sevenths / extended) one step either way;
 *   - `registerSpread` moves the solver's close-vs-open spacing;
 *   - `orchestrationSizeDelta` adds or removes a voice on the colour layers
 *     (pads, strings, brass, winds). The family *count* stays the arc's
 *     decision (B-01): a strategy does not silence a planned family.
 *
 * Nothing here deletes a chord tone, a kick or a motif note: the kit texture
 * keeps every kick, snare, crash, push and fill and only asks the hats to
 * play the pulses (a sparser subdivision) or the ghosts to stay home.
 */
import type { ArcTextureLevel, CandidateStrategyId, GrooveCompingCell, MusicalNote } from "@workspace/db";
import type { PartGenerationRequest } from "../partComposer";
import type { MeterSpec } from "./frame";

export type TextureDensity = "thin" | "normal" | "dense";

/** What a candidate strategy asks of every writer (replaces `applyDensity`). */
export type TextureIntent = {
  strategy: CandidateStrategyId | "baseline";
  /** The part's density multiplier the plan carries (< 0.8 thin, > 1.1 dense); kept for the plan / provenance readers. */
  densityMultiplier: number;
  density: TextureDensity;
  /** -1 (straighter) .. 1 (more syncopated). */
  syncopation: number;
  /** 0..1 harmonic risk: extension level of the voicings. */
  harmonicRisk: number;
  /** 0..1 register spread: close vs open spacing. */
  registerSpread: number;
  /** -1 / 0 / +1 voices on the colour layers. */
  colourVoicesDelta: -1 | 0 | 1;
  reason: string;
};

export const BASELINE_TEXTURE: TextureIntent = {
  strategy: "baseline", densityMultiplier: 1, density: "normal", syncopation: 0, harmonicRisk: 0.3, registerSpread: 0.5, colourVoicesDelta: 0,
  reason: "no candidate strategy: the writers' defaults",
};

export function densityLevelOf(multiplier: number): TextureDensity {
  if (multiplier < 0.8) return "thin";
  if (multiplier > 1.1) return "dense";
  return "normal";
}

export type StrategyBias = { syncopationBias: number; harmonicAdventurousness: number; registerSpread: number; orchestrationSizeDelta: number };

/** The intent for one part of one candidate: the strategy's bias plus the part's density multiplier. */
export function textureIntentFor(strategy: CandidateStrategyId, bias: StrategyBias, densityMultiplier: number): TextureIntent {
  const density = densityLevelOf(densityMultiplier);
  const delta = bias.orchestrationSizeDelta > 0 ? 1 : bias.orchestrationSizeDelta < 0 ? -1 : 0;
  return {
    strategy, densityMultiplier, density,
    syncopation: bias.syncopationBias, harmonicRisk: bias.harmonicAdventurousness, registerSpread: bias.registerSpread,
    colourVoicesDelta: delta,
    reason: `${strategy}: density x${densityMultiplier} -> ${density} texture; syncopation ${bias.syncopationBias}; harmonic risk ${bias.harmonicAdventurousness}; register spread ${bias.registerSpread}; colour voices ${delta >= 0 ? "+" : ""}${delta}`,
  };
}

// ---------------------------------------------------------------------------
// Chordal parts (keys / guitar / strings / pads / brass / winds)
// ---------------------------------------------------------------------------

export type ChordalArchetype = "sustained" | "block" | "arpeggio";

export type ChordalTexture = {
  archetype: ChordalArchetype;
  /** Which of the groove plan's comping cells the part reads its onsets from. */
  cell: "bed" | "rhythmic";
  /**
   * B-21: the groove cell whose onsets this part actually plays. It is the
   * plan's cell for `cell` unless the arc's level asked a struck bed to
   * re-articulate faster (an arrival is *heard*, not held). The cell
   * vocabulary and its unit sets stay the groove plan's (`cellUnits`); only
   * which of them this part reads is the texture's decision.
   */
  onsetCell: GrooveCompingCell;
  /**
   * B-21: an `arpeggio` sounds **one voice per onset** (a broken chord). Before
   * this the archetype was named `arpeggio` and the writer struck the whole
   * voicing on every onset of an `arpeggiated_8ths` cell, because its groups
   * were shorter than two arpeggio steps and the arpeggio branch never ran:
   * measured on the owner's Verse 1, 22 bars x 8 eighths x 3 voices = 501
   * notes at 12.4 notes a second inside ten semitones, while the choruses held
   * long chords. The archetype and the notes now agree.
   */
  brokenChord: boolean;
  /** Added to the solver's voice count for this part (clamped by the caller). */
  voiceDelta: number;
  /** Shift of the style's extension level: -1 triads-ward, +1 extended-ward. */
  extensionsShift: -1 | 0 | 1;
  /** Added to the style's closeVsOpen (0 close .. 1 open), clamped by the caller. */
  closeVsOpenShift: number;
  reason: string;
};

const SUSTAINING_FAMILIES = new Set(["strings", "pads", "synth", "brass", "winds"]);
const COLOUR_TASKS = new Set<PartGenerationRequest["task"]>(["PAD", "STRINGS", "BRASS", "WOODWINDS"]);

const isFull = (level: ArcTextureLevel | null) => level === "full" || level === "tutti";
const isThinLevel = (level: ArcTextureLevel | null) => level === "solo" || level === "duo";

/** Arc level at or above which a struck bed re-articulates on the pulse instead of holding the chord. */
export const BED_RESTRIKE_LEVEL = 0.5;

/**
 * The texture of a chordal part: role, family and the arc's texture level
 * set the default; the strategy's intent moves it. Every choice states why.
 *
 * B-21 gives it the two readings it was missing. The arc's *numeric* level
 * (not only the texture word) decides how often a struck bed re-articulates,
 * and an `arpeggio` is a broken chord rather than a re-struck block. Before
 * this the only reads of the arc here were `isFull(level)` and
 * `level !== "tutti"` - neither of which can thin anything - so a `bed`-texture
 * verse at level 0.44 comped exactly as densely as a `tutti` chorus would, and
 * the density critics reported `arrival_thinner_than_setup`,
 * `louder_section_thinner` and `climax_not_realised` on the owner's song.
 */
export function chordalTextureFor(input: {
  task: PartGenerationRequest["task"];
  role: PartGenerationRequest["role"];
  family: string;
  level: ArcTextureLevel | null;
  /** The arc's intended level 0..1 for this section (`arcIntent.level`, else the section's energy). */
  arcLevel: number;
  intent: TextureIntent;
  plannedRhythmicCell: GrooveCompingCell;
  plannedBedCell: GrooveCompingCell;
}): ChordalTexture {
  const { role, family, level, arcLevel, intent } = input;
  const sustaining = SUSTAINING_FAMILIES.has(family);
  const comping = role === "RHYTHMIC_HARMONY" || role === "OSTINATO";
  const reasons: string[] = [];
  let cell: ChordalTexture["cell"] = comping ? "rhythmic" : "bed";
  let onsetCell: GrooveCompingCell = comping ? input.plannedRhythmicCell : input.plannedBedCell;
  let archetype: ChordalArchetype;
  let brokenChord = false;
  if (!comping) {
    // A bed: bowed / blown / synth families hold the chord (ties across bars); a
    // keyboard or guitar bed re-strikes on the plan's bed cell (per bar, or
    // in quarters under a lift), because a struck string decays.
    archetype = sustaining ? "sustained" : "block";
    reasons.push(sustaining ? `${family} bed holds each chord` : `${family} bed re-strikes on the plan's bed cell (${input.plannedBedCell})`);
    // B-21: how often a struck bed re-articulates is the arc's decision. At a
    // `full` / `tutti` texture, or from level 0.5 up, it is re-struck on the
    // meter's pulses - that is what makes an arrival arrive on a piano.
    if (!sustaining && (isFull(level) || arcLevel >= BED_RESTRIKE_LEVEL) && onsetCell === "whole_note_bed") {
      onsetCell = "quarter_pulses";
      reasons.push(`${level ?? "no"} texture at level ${arcLevel.toFixed(2)}: the struck bed re-articulates on the pulse instead of holding the chord`);
    }
    if (intent.density === "thin" || isThinLevel(level)) {
      archetype = "sustained";
      onsetCell = input.plannedBedCell;
      reasons.push(intent.density === "thin" ? "thin texture: held, not re-struck" : `${level} texture: held, not re-struck`);
    }
    if (intent.density === "dense" && !sustaining) {
      archetype = input.plannedRhythmicCell === "arpeggiated_8ths" ? "arpeggio" : "block";
      cell = "rhythmic";
      onsetCell = input.plannedRhythmicCell;
      reasons.push(`dense texture: the bed moves on the rhythmic cell (${input.plannedRhythmicCell})`);
    }
    if (intent.syncopation >= 0.5 && !sustaining && isFull(level)) {
      cell = "rhythmic";
      archetype = "block";
      onsetCell = input.plannedRhythmicCell;
      reasons.push(`syncopation ${intent.syncopation}: the ${family} bed comps on the rhythmic cell in a ${level} texture`);
    }
    if (intent.strategy === "melodic" && !sustaining && level !== "tutti" && intent.density !== "thin" && !isThinLevel(level)) {
      // B-13's decision, kept: the bed stays on its own cell and the arpeggio
      // is walked *inside* each held group (the group is long enough there).
      archetype = "arpeggio";
      reasons.push("melodic strategy: a broken-chord bed, a moving inner line");
    }
  } else {
    archetype = input.plannedRhythmicCell === "arpeggiated_8ths" ? "arpeggio" : "block";
    reasons.push(archetype === "arpeggio" ? "the plan's comping cell is arpeggiated" : `block chords on the plan's ${input.plannedRhythmicCell}`);
    if (intent.density === "thin" || isThinLevel(level)) {
      cell = "bed";
      onsetCell = input.plannedBedCell;
      archetype = "sustained";
      reasons.push(intent.density === "thin" ? "thin texture: the comp holds on the bed cell" : `${level} texture: the comp holds on the bed cell`);
    }
    if (intent.density === "dense" && archetype === "block") { archetype = "arpeggio"; reasons.push("dense texture: the voicing is arpeggiated through the cell's windows"); }
    if (intent.strategy === "melodic" && intent.density !== "thin" && archetype !== "sustained") { archetype = "arpeggio"; reasons.push("melodic strategy: arpeggiated comping"); }
  }
  brokenChord = archetype === "arpeggio";
  if (brokenChord) reasons.push("arpeggio: one voice per onset, the bottom voice held under the figure");
  let voiceDelta = intent.density === "thin" ? -1 : intent.density === "dense" ? 1 : 0;
  if (COLOUR_TASKS.has(input.task)) voiceDelta += intent.colourVoicesDelta;
  if (voiceDelta) reasons.push(`${voiceDelta > 0 ? "+" : ""}${voiceDelta} voice(s)`);
  const extensionsShift: ChordalTexture["extensionsShift"] = intent.harmonicRisk >= 0.7 ? 1 : intent.harmonicRisk <= 0.12 ? -1 : 0;
  if (extensionsShift) reasons.push(extensionsShift > 0 ? "harmonic risk: one extension level up" : "harmonic risk: one extension level down");
  const closeVsOpenShift = Number(((intent.registerSpread - 0.5) * 0.6).toFixed(3));
  if (Math.abs(closeVsOpenShift) >= 0.05) reasons.push(closeVsOpenShift > 0 ? "register spread: more open spacing" : "register spread: closer spacing");
  return { archetype, cell, onsetCell, brokenChord, voiceDelta, extensionsShift, closeVsOpenShift, reason: reasons.join("; ") };
}

// ---------------------------------------------------------------------------
// Bass
// ---------------------------------------------------------------------------

export type BassTexture = {
  /** Which figures of the groove plan's bass rhythm are pitched as written: roots only, roots and fifths, or every figure (fifth / octave / approach). */
  figures: "roots" | "roots_fifths" | "full";
  reason: string;
};

/** The bass keeps the groove's onsets (that is the kick/bass lock); density chooses how much the line moves between them. */
export function bassTextureFor(intent: TextureIntent, arcLevel: number): BassTexture {
  if (intent.density === "thin" || arcLevel < 0.3) return { figures: "roots", reason: intent.density === "thin" ? "thin texture: roots on the groove's onsets" : `level ${arcLevel.toFixed(2)}: roots only` };
  if (intent.density === "dense" || intent.syncopation >= 0.5 || arcLevel >= 0.65) return { figures: "full", reason: intent.density === "dense" ? "dense texture: the full figure set (fifths, octaves, approaches)" : intent.syncopation >= 0.5 ? "syncopated strategy: the full figure set" : `level ${arcLevel.toFixed(2)}: the full figure set` };
  return { figures: "roots_fifths", reason: `level ${arcLevel.toFixed(2)}: roots and fifths` };
}

// ---------------------------------------------------------------------------
// Kit (the writer is B-04's; the texture is applied to its notes by id class)
// ---------------------------------------------------------------------------

export type KitTexture = {
  /** `pulses_only`: hats play the meter's pulses instead of the plan's subdivision. */
  hats: "as_planned" | "pulses_only";
  ghosts: boolean;
  reason: string;
};

export function kitTextureFor(intent: TextureIntent): KitTexture {
  if (intent.density === "thin") return { hats: "pulses_only", ghosts: false, reason: "thin texture: hats on the pulses, no ghost notes" };
  if (intent.strategy === "conservative") return { hats: "as_planned", ghosts: false, reason: "conservative: the plan's hats, no ghost notes" };
  return { hats: "as_planned", ghosts: true, reason: "the plan's kit as written" };
}

// ---------------------------------------------------------------------------
// The motif exemption (B-13's brief; made enforceable at the merge)
// ---------------------------------------------------------------------------

/**
 * A note that carries motif provenance is never thinned.
 *
 * This is the rule `applyDensity` broke and B-13's brief required: a motif
 * statement is a musical *identity*, and a texture that removes one of its
 * notes does not make the part sparser, it makes the statement wrong. B-10
 * owns the provenance (`note.motif`); every texture path here asks this
 * question before it drops anything, and so does the orchestrator's merge
 * (`dedupeSimultaneous`), which since B-13 put a bed and a counter-line on one
 * track could otherwise have kept a louder bed note over the motif note that
 * doubles it.
 *
 * The exemption is per *note*, and it is deliberately not per group: a note
 * that names its statement is protected on its own, so a group split across
 * bars or handed to another instrument keeps every one of its notes.
 */
export function isMotifProtected(note: MusicalNote): boolean {
  return !!note.motif;
}

/**
 * `keep` with the motif exemption applied: a note the predicate would drop is
 * kept anyway when it carries motif provenance. Returns the same array when
 * nothing is dropped, and reports how many notes the exemption saved.
 */
export function thinExceptMotif(
  notes: MusicalNote[],
  keep: (note: MusicalNote) => boolean,
): { notes: MusicalNote[]; exempted: number } {
  let exempted = 0;
  const kept = notes.filter((note) => {
    if (keep(note)) return true;
    if (isMotifProtected(note)) { exempted += 1; return true; }
    return false;
  });
  return { notes: kept.length === notes.length ? notes : kept, exempted };
}

/** The reference kit's note ids (`composer/rhythmParts.ts`): `h<bar>-<unit>` hats / ride, `g<bar>-<unit>` ghost snares. */
const HAT_ID = /^(?:.*-)?h(\d+)-([\d.]+)$/;
const GHOST_ID = /^(?:.*-)?g(\d+)-([\d.]+)$/;

/**
 * Apply a kit texture to a kit part's notes: hats off the pulses go when the
 * texture asks for pulses only; ghost snares go when it asks for none. Kicks,
 * snares, side-sticks, crashes, pushes, fills and endings are never touched.
 * Returns the same array when nothing changes.
 */
export function applyKitTexture(notes: MusicalNote[], texture: KitTexture, meter: MeterSpec): MusicalNote[] {
  if (texture.hats === "as_planned" && texture.ghosts) return notes;
  const pulses = new Set(meter.pulses.map((p) => Number(p.toFixed(3))));
  // The motif exemption applies here too: a kit figure B-10 tagged as a motif
  // statement (a hooked hat pattern handed to the drummer) is not a ghost note
  // the texture may send home.
  return thinExceptMotif(notes, (note) => {
    const hat = HAT_ID.exec(note.id);
    if (hat && texture.hats === "pulses_only") {
      const unit = Number(hat[2]);
      return pulses.has(Number(unit.toFixed(3)));
    }
    if (!texture.ghosts && GHOST_ID.test(note.id)) return false;
    return true;
  }).notes;
}

/**
 * Apply the intent to a written part when the writer itself could not (the
 * kit and the percussion are stream B-04's writers): only the kit texture
 * applies; every pitched part realises its texture while writing.
 */
export function applyTextureAfterWriting(task: PartGenerationRequest["task"], notes: MusicalNote[], intent: TextureIntent, meter: MeterSpec): { notes: MusicalNote[]; applied: string | null } {
  if (task !== "DRUMS") return { notes, applied: null };
  const texture = kitTextureFor(intent);
  const out = applyKitTexture(notes, texture, meter);
  return { notes: out, applied: out === notes ? null : texture.reason };
}
