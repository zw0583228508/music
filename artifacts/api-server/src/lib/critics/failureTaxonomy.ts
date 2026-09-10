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
    typicalKinds: ["section_byte_copy", "section_note_copy", "section_rhythm_copy", "section_verbatim_copy", "sections_indistinguishable", "same_type_sections_unrelated", "repeat_without_development", "repeat_without_identity", "development_by_dynamics_only"],
    defaultOrigins: ["form", "compose"],
    defaultRepairScope: "section",
  },
  ENERGY_ARC_FAILURE: {
    code: "ENERGY_ARC_FAILURE",
    definition: "The intended dynamic / textural arc is not realised in the notes: no build, an unprepared or unrealised climax, no dynamic movement.",
    typicalKinds: ["climax_not_prepared", "climax_not_realised", "no_dynamic_movement", "arrival_thinner_than_setup", "louder_section_thinner", "quieter_section_denser", "no_build_into_climax", "no_release_after_climax", "climax_misplaced", "flat_arc", "flat_arc_by_plan", "density_flat_against_plan", "density_flat_by_plan"],
    defaultOrigins: ["arc", "compose", "perform"],
    defaultRepairScope: "section",
  },
  MOTIF_FAILURE: {
    code: "MOTIF_FAILURE",
    definition: "Melodic material neither recurs nor develops; no top-voice line carries the arrangement.",
    typicalKinds: ["no_top_voice_line", "no_recurrence", "motif_abandoned", "recurrence_is_copy_only", "line_static", "line_erratic"],
    defaultOrigins: ["compose"],
    defaultRepairScope: "part",
  },
  HARMONY_FAILURE: {
    code: "HARMONY_FAILURE",
    definition: "Chord realisation is wrong or lifeless: root-position-only stacks, harmony changing only on downbeats, wrong tones.",
    typicalKinds: ["root_position_only", "chord_changes_only_on_downbeat", "clash_share", "overhang_across_chord_change", "out_of_key_share", "bass_leaves_chord", "bass_rarely_states_root", "approach_tone_wrong_mode"],
    defaultOrigins: ["harmony", "compose"],
    defaultRepairScope: "part",
  },
  VOICE_LEADING_FAILURE: {
    code: "VOICE_LEADING_FAILURE",
    definition: "Voices move badly between chords: identical voicing shapes shifted in parallel, no common tones, no approach.",
    typicalKinds: ["identical_voicing_shape", "static_bass_no_approach", "no_common_tone_retention", "parallel_perfects_within_part", "parallel_perfects_between_parts", "part_doubles_another", "voice_crossing_between_parts", "bass_leaps", "voicing_leaps"],
    defaultOrigins: ["harmony", "compose"],
    defaultRepairScope: "part",
  },
  GROOVE_FAILURE: {
    code: "GROOVE_FAILURE",
    definition: "Rhythm is a grid or a block: every part in the same rhythm, nothing interlocks, no anticipation.",
    typicalKinds: ["rhythm_predictable", "every_part_same_rhythm", "off_grid", "harmony_off_grid", "subdivision_inconsistent", "backbeat_displaced", "backbeat_missing", "kick_bass_disagreement", "anticipation_mismatch", "planned_fill_missing", "homorhythmic_texture", "grid_saturation", "locked", "interlocking", "independent", "part_locked_to_part", "part_doubles_part"],
    defaultOrigins: ["groove", "compose"],
    defaultRepairScope: "section",
  },
  ORCHESTRATION_FAILURE: {
    code: "ORCHESTRATION_FAILURE",
    definition: "Who plays what is wrong: a planned family is silent, an instrument resolves to the wrong definition, doublings and unisons nobody chose.",
    typicalKinds: ["planned_family_silent", "definition_family_mismatch", "unison_doubling_by_accident", "single_pitch_percussion", "notes_outside_song", "continuous_tutti", "unplanned_entry"],
    defaultOrigins: ["orchestration", "compose"],
    defaultRepairScope: "part",
  },
  REGISTER_FAILURE: {
    code: "REGISTER_FAILURE",
    definition: "Parts sit in the wrong or the same register: sustained extremes, two parts stacked in close position in one octave, low-interval mud.",
    typicalKinds: ["string_bed_too_high", "sustained_extreme_register", "close_position_same_octave", "keys_low_interval_mud", "bass_and_keys_share_low_octave", "part_outside_planned_band", "part_outside_comfortable_range", "low_mid_pileup", "low_register_crowding", "sub_register_overlap", "top_line_above_comfortable_ceiling", "climax_all_treble", "counterline_clashes_bed", "line_range_extreme"],
    defaultOrigins: ["register", "compose"],
    defaultRepairScope: "part",
  },
  DENSITY_FAILURE: {
    code: "DENSITY_FAILURE",
    definition: "Texture thickness changes for no reason or never changes: no rests, density jumps off the form.",
    typicalKinds: ["no_rests", "density_change_off_form", "single_voice_bed", "bed_thin_voicing", "comping_below_role_floor", "part_sparse_in_dense_section", "part_overdense", "foundation_gaps"],
    defaultOrigins: ["arc", "compose"],
    defaultRepairScope: "section",
  },
  PLAYABILITY_FAILURE: {
    code: "PLAYABILITY_FAILURE",
    definition: "A player cannot physically do it: range, polyphony, hand span, leap, breath, re-articulation (the calibrated constraint engine's errors).",
    typicalKinds: ["physically_unplayable", "part_unplayable", "kit_limbs_exceeded"],
    defaultOrigins: ["compose", "perform"],
    defaultRepairScope: "note",
  },
  IDIOM_FAILURE: {
    code: "IDIOM_FAILURE",
    definition: "Possible but not idiomatic: a player would refuse or resent it - endless sustains, brass with no breathing room, a bass held past its decay, a cluster voicing on keys, the uncomfortable register for minutes.",
    typicalKinds: ["endless_sustain", "brass_no_breathing_room", "bass_sustain_beyond_decay", "keyboard_cluster_voicing", "outside_comfortable_range", "pad_staccato", "strings_overbusy_bed", "bass_chords", "phrase_too_long_for_breath", "hand_span_exceeded", "guitar_voicing_unfingerable"],
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
    definition: "A boundary is not prepared, or one of the song's two outer boundaries is missing: nothing in the last bar announces what follows, the song opens on silence, the song stops instead of ending.",
    typicalKinds: ["transition_unprepared", "ending_is_a_cut", "ending_missing", "boundary_unmarked", "planned_device_unrealised", "device_unverifiable_from_notes", "intro_empty", "ending_cut"],
    defaultOrigins: ["form", "compose", "perform"],
    defaultRepairScope: "section",
  },
  REPETITION_FAILURE: {
    code: "REPETITION_FAILURE",
    definition: "Literal repetition where variation is expected: identical bars for long stretches.",
    typicalKinds: ["identical_bars", "loop_without_variation"],
    defaultOrigins: ["compose"],
    defaultRepairScope: "part",
  },
  PREDICTABILITY_FAILURE: {
    code: "PREDICTABILITY_FAILURE",
    definition: "Nothing surprises: low rhythmic or pitch entropy, machine-locked onsets, constant velocities.",
    typicalKinds: ["pitch_predictable", "grid_locked_onsets", "constant_velocity", "candidates_near_identical"],
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
    typicalKinds: ["melody_masked", "vocal_masking", "line_masks_vocal", "line_in_vocal_register"],
    defaultOrigins: ["register", "orchestration", "compose"],
    defaultRepairScope: "section",
  },
  PERFORMANCE_FAILURE: {
    code: "PERFORMANCE_FAILURE",
    definition: "The performance layer flattened or broke what was written: dynamics, timing, articulation.",
    typicalKinds: ["flat_dynamics", "no_dynamics_anywhere", "dynamic_range_flat_per_section", "accents_inverted", "mechanical_timing", "no_expression_cc", "no_sustain_pedal", "pedal_ignores_chord_changes", "no_dynamic_contrast_between_sections", "dynamics_flat_by_plan"],
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

/**
 * The dimension a kind came from, when the kind itself is not in the table
 * (B-05c). The only open kind set in the program is `playability`, which
 * re-emits the constraint engine's own violation codes verbatim; they all
 * belong to `PLAYABILITY_FAILURE`, and inventing a taxonomy row per engine code
 * would put the engine's vocabulary in two places. Every other dimension is
 * listed so that a kind added tomorrow without a taxonomy row still reaches the
 * judge's rules under its dimension's code instead of silently becoming
 * `UNCLASSIFIED` — which is what happened to all forty-odd B-05a kinds until
 * now (R-1b P0-5: "the judge ranks a 2-bar silent intro above everything else").
 */
export const DIMENSION_DEFAULT_CODE: Readonly<Record<string, FailureCode>> = Object.freeze({
  harmony: "HARMONY_FAILURE",
  voiceLeading: "VOICE_LEADING_FAILURE",
  melodyAndCounterline: "MOTIF_FAILURE",
  motifRecurrenceAndDevelopment: "MOTIF_FAILURE",
  groove: "GROOVE_FAILURE",
  rhythmicInteraction: "GROOVE_FAILURE",
  orchestration: "ORCHESTRATION_FAILURE",
  idiomaticity: "IDIOM_FAILURE",
  register: "REGISTER_FAILURE",
  density: "DENSITY_FAILURE",
  transitions: "TRANSITION_FAILURE",
  repetitionVsVariation: "REPETITION_FAILURE",
  sectionDevelopment: "FORM_FAILURE",
  playability: "PLAYABILITY_FAILURE",
  performanceRealisation: "PERFORMANCE_FAILURE",
  emotionalArcAndTension: "ENERGY_ARC_FAILURE",
});

/**
 * The code for a kind. `dimension`, when given, supplies the fallback above;
 * without it an unlisted kind is `null` (the test forbids that for every kind a
 * dimension or adversarial module can emit, apart from the informational
 * `measured` record and the playability engine's own codes).
 */
export function codeForKind(kind: string, dimension?: string): FailureCode | null {
  return KIND_TO_CODE[kind] ?? (dimension ? DIMENSION_DEFAULT_CODE[dimension] ?? null : null);
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
