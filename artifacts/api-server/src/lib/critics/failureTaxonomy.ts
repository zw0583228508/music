/**
 * Failure taxonomy (Brain B-05b, D3).
 *
 * The explicit code list the program brief asks for. Every critic observation
 * carries a free `kind` (what exactly was seen); this module maps each kind
 * onto one closed failure code so the judge, the repair planner (B-06) and
 * the telemetry (B-11) speak one vocabulary. Per code: a definition, the
 * typical kinds that map to it, the layers that usually cause it and the
 * default repair scope.
 *
 * The origin layers per code are also what an adversarial module uses to
 * spread its `originConfidence`: uniform over the code's candidate layers,
 * sharpened only when the plan itself can confirm or deny a layer. No module
 * types an origin confidence by hand.
 */
import type { OriginLayer } from "./types";

export const FAILURE_TAXONOMY_VERSION = "FAILURE_TAXONOMY_v1" as const;

export const FAILURE_CODES = [
  "GLOBAL_COHERENCE_FAILURE",
  "FORM_FAILURE",
  "ENERGY_ARC_FAILURE",
  "MOTIF_FAILURE",
  "HARMONY_FAILURE",
  "VOICE_LEADING_FAILURE",
  "GROOVE_FAILURE",
  "ORCHESTRATION_FAILURE",
  "REGISTER_FAILURE",
  "DENSITY_FAILURE",
  "PLAYABILITY_FAILURE",
  "IDIOM_FAILURE",
  "STYLE_FAILURE",
  "TRANSITION_FAILURE",
  "REPETITION_FAILURE",
  "PREDICTABILITY_FAILURE",
  "CAUSALITY_FAILURE",
  "MASKING_FAILURE",
  "VOCAL_SPACE_FAILURE",
  "PERFORMANCE_FAILURE",
  "RENDER_FAILURE",
  "AUDIO_BALANCE_FAILURE",
  "PLAN_REALISATION_FAILURE",
  "INPUT_UNKNOWN",
] as const;

export type FailureCode = (typeof FAILURE_CODES)[number];
export type RepairScope = "note" | "part" | "section" | "plan";

export type FailureCodeSpec = {
  code: FailureCode;
  definition: string;
  typicalKinds: string[];
  defaultOrigins: OriginLayer[];
  defaultRepairScope: RepairScope;
};

export const FAILURE_TAXONOMY: Record<FailureCode, FailureCodeSpec> = {
  GLOBAL_COHERENCE_FAILURE: {
    code: "GLOBAL_COHERENCE_FAILURE",
    definition: "The whole does not hold together: sections, parts or register plans contradict each other across the song rather than within a bar.",
    typicalKinds: ["ensemble_never_changes", "everyone_always_playing"],
    defaultOrigins: ["arc", "orchestration"],
    defaultRepairScope: "plan",
  },
  FORM_FAILURE: {
    code: "FORM_FAILURE",
    definition: "Section identity or section development is wrong: a repeat that should develop does not, or a section that should be recognisable is not.",
    typicalKinds: ["section_byte_copy", "section_note_copy", "section_rhythm_copy"],
    defaultOrigins: ["form", "compose"],
    defaultRepairScope: "section",
  },
  ENERGY_ARC_FAILURE: {
    code: "ENERGY_ARC_FAILURE",
    definition: "The intended dynamic / textural arc is not realised in the notes: no build, an unprepared or unrealised climax, no dynamic movement.",
    typicalKinds: ["climax_not_prepared", "climax_not_realised", "no_dynamic_movement"],
    defaultOrigins: ["arc", "compose", "perform"],
    defaultRepairScope: "section",
  },
  MOTIF_FAILURE: {
    code: "MOTIF_FAILURE",
    definition: "Melodic material neither recurs nor develops; no top-voice line carries the arrangement.",
    typicalKinds: ["no_top_voice_line"],
    defaultOrigins: ["compose"],
    defaultRepairScope: "part",
  },
  HARMONY_FAILURE: {
    code: "HARMONY_FAILURE",
    definition: "Chord realisation is wrong or lifeless: root-position-only stacks, harmony changing only on downbeats, wrong tones.",
    typicalKinds: ["root_position_only", "chord_changes_only_on_downbeat"],
    defaultOrigins: ["harmony", "compose"],
    defaultRepairScope: "part",
  },
  VOICE_LEADING_FAILURE: {
    code: "VOICE_LEADING_FAILURE",
    definition: "Voices move badly between chords: identical voicing shapes shifted in parallel, no common tones, no approach.",
    typicalKinds: ["identical_voicing_shape", "static_bass_no_approach"],
    defaultOrigins: ["harmony", "compose"],
    defaultRepairScope: "part",
  },
  GROOVE_FAILURE: {
    code: "GROOVE_FAILURE",
    definition: "Rhythm is a grid or a block: every part in the same rhythm, nothing interlocks, no anticipation.",
    typicalKinds: ["rhythm_predictable", "every_part_same_rhythm"],
    defaultOrigins: ["groove", "compose"],
    defaultRepairScope: "section",
  },
  ORCHESTRATION_FAILURE: {
    code: "ORCHESTRATION_FAILURE",
    definition: "Who plays what is wrong: a planned family is silent, an instrument resolves to the wrong definition, doublings and unisons nobody chose.",
    typicalKinds: ["planned_family_silent", "definition_family_mismatch", "unison_doubling_by_accident", "single_pitch_percussion"],
    defaultOrigins: ["orchestration", "compose"],
    defaultRepairScope: "part",
  },
  REGISTER_FAILURE: {
    code: "REGISTER_FAILURE",
    definition: "Parts sit in the wrong or the same register: sustained extremes, two parts stacked in close position in one octave, low-interval mud.",
    typicalKinds: ["string_bed_too_high", "sustained_extreme_register", "close_position_same_octave", "keys_low_interval_mud", "bass_and_keys_share_low_octave"],
    defaultOrigins: ["register", "compose"],
    defaultRepairScope: "part",
  },
  DENSITY_FAILURE: {
    code: "DENSITY_FAILURE",
    definition: "Texture thickness changes for no reason or never changes: no rests, density jumps off the form.",
    typicalKinds: ["no_rests", "density_change_off_form"],
    defaultOrigins: ["arc", "compose"],
    defaultRepairScope: "section",
  },
  PLAYABILITY_FAILURE: {
    code: "PLAYABILITY_FAILURE",
    definition: "A player cannot physically do it: range, polyphony, hand span, leap, breath, re-articulation (the calibrated constraint engine's errors).",
    typicalKinds: ["physically_unplayable"],
    defaultOrigins: ["compose", "perform"],
    defaultRepairScope: "note",
  },
  IDIOM_FAILURE: {
    code: "IDIOM_FAILURE",
    definition: "Possible but not idiomatic: a player would refuse or resent it - endless sustains, brass with no breathing room, a bass held past its decay, a cluster voicing on keys, the uncomfortable register for minutes.",
    typicalKinds: ["endless_sustain", "brass_no_breathing_room", "bass_sustain_beyond_decay", "keyboard_cluster_voicing", "outside_comfortable_range"],
    defaultOrigins: ["compose", "orchestration"],
    defaultRepairScope: "part",
  },
  STYLE_FAILURE: {
    code: "STYLE_FAILURE",
    definition: "The writing contradicts the style contract (StyleGrammar) or reads as generic where the style has a signature.",
    typicalKinds: [],
    defaultOrigins: ["brief", "compose"],
    defaultRepairScope: "section",
  },
  TRANSITION_FAILURE: {
    code: "TRANSITION_FAILURE",
    definition: "A boundary is not prepared or an ending is a cut: nothing in the last bar announces what follows, the song stops instead of ending.",
    typicalKinds: ["transition_unprepared", "ending_is_a_cut", "ending_missing"],
    defaultOrigins: ["form", "compose", "perform"],
    defaultRepairScope: "section",
  },
  REPETITION_FAILURE: {
    code: "REPETITION_FAILURE",
    definition: "Literal repetition where variation is expected: identical bars for long stretches.",
    typicalKinds: ["identical_bars"],
    defaultOrigins: ["compose"],
    defaultRepairScope: "part",
  },
  PREDICTABILITY_FAILURE: {
    code: "PREDICTABILITY_FAILURE",
    definition: "Nothing surprises: low rhythmic or pitch entropy, machine-locked onsets, constant velocities.",
    typicalKinds: ["pitch_predictable", "grid_locked_onsets", "constant_velocity"],
    defaultOrigins: ["compose", "perform"],
    defaultRepairScope: "part",
  },
  CAUSALITY_FAILURE: {
    code: "CAUSALITY_FAILURE",
    definition: "Events have no musical cause: an entry that answers nothing, a register jump or exit mid-phrase with nothing before it.",
    typicalKinds: ["unmotivated_entry", "unmotivated_register_jump", "mid_phrase_entry", "mid_phrase_exit"],
    defaultOrigins: ["orchestration", "compose"],
    defaultRepairScope: "section",
  },
  MASKING_FAILURE: {
    code: "MASKING_FAILURE",
    definition: "Two parts fight for the same register at the same time with clashing rhythms; neither can be heard.",
    typicalKinds: ["register_fight"],
    defaultOrigins: ["register", "orchestration"],
    defaultRepairScope: "part",
  },
  VOCAL_SPACE_FAILURE: {
    code: "VOCAL_SPACE_FAILURE",
    definition: "The arrangement covers the singer: loud notes in the vocal's register while the vocal is sounding.",
    typicalKinds: ["melody_masked"],
    defaultOrigins: ["register", "orchestration", "compose"],
    defaultRepairScope: "section",
  },
  PERFORMANCE_FAILURE: {
    code: "PERFORMANCE_FAILURE",
    definition: "The performance layer flattened or broke what was written: dynamics, timing, articulation.",
    typicalKinds: [],
    defaultOrigins: ["perform"],
    defaultRepairScope: "part",
  },
  RENDER_FAILURE: {
    code: "RENDER_FAILURE",
    definition: "The render did not realise the notes: silence, wrong instrument, out-of-range asset.",
    typicalKinds: [],
    defaultOrigins: ["render"],
    defaultRepairScope: "part",
  },
  AUDIO_BALANCE_FAILURE: {
    code: "AUDIO_BALANCE_FAILURE",
    definition: "The mix hides or exaggerates a part: masking, mud, imbalance measured on audio.",
    typicalKinds: [],
    defaultOrigins: ["mix"],
    defaultRepairScope: "part",
  },
  PLAN_REALISATION_FAILURE: {
    code: "PLAN_REALISATION_FAILURE",
    definition: "The notes contradict the plan that authored them (a planned entry, register or climax that the composer did not realise).",
    typicalKinds: [],
    defaultOrigins: ["compose"],
    defaultRepairScope: "part",
  },
  INPUT_UNKNOWN: {
    code: "INPUT_UNKNOWN",
    definition: "The critic could not judge because an input is unknown or contested (no bar grid, no meter, no chords). Not a musical defect; never repaired by composing.",
    typicalKinds: ["no_bar_grid", "no_notes"],
    defaultOrigins: ["unknown"],
    defaultRepairScope: "plan",
  },
};

/** kind → code, derived from the taxonomy's typical kinds; extend by adding to the taxonomy. */
export const KIND_TO_CODE: Readonly<Record<string, FailureCode>> = Object.freeze(
  Object.fromEntries(
    FAILURE_CODES.flatMap((code) => FAILURE_TAXONOMY[code].typicalKinds.map((kind) => [kind, code] as const)),
  ),
);

/** The code for a kind, or null when the kind is not in the taxonomy (the test forbids that for emitted kinds). */
export function codeForKind(kind: string): FailureCode | null {
  return KIND_TO_CODE[kind] ?? null;
}

/** Candidate origin layers for a kind (the code's defaults). Unknown kinds attribute to nothing. */
export function originsForKind(kind: string): OriginLayer[] {
  const code = codeForKind(kind);
  return code ? [...FAILURE_TAXONOMY[code].defaultOrigins] : ["unknown"];
}

export function repairScopeForKind(kind: string): RepairScope {
  const code = codeForKind(kind);
  return code ? FAILURE_TAXONOMY[code].defaultRepairScope : "plan";
}
