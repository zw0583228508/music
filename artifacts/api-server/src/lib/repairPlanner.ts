/**
 * Repair planner (Arrangement Brain, stream B-06, D1).
 *
 * From the note-level critics' observations (B-05a dimensions + B-05b
 * adversarial modules) and the judge's verdict, build a `RepairPlan`: which
 * plan layer to reopen for which group of observations, with what bounded
 * operation, in what scope, expecting which observations to disappear.
 *
 *   1. Observations of severity `minor` or worse are grouped by scope
 *      (section + track set). A group is one musical place with a problem.
 *   2. The origin layer of a group is the critics' weighted vote
 *      (`confidence x originConfidence` per observation, summed per
 *      `suspectedOrigin`), refined only where the plan itself can confirm or
 *      deny a layer (the planned climax's texture is lower than the peak's ->
 *      the arc, not the composer). Ties break toward the earlier layer of the
 *      pipeline, because a plan decision explains more notes than a composer.
 *   3. Each layer has a small table of bounded operations on the plan objects
 *      it owns (`OPERATIONS`); the planner picks the one the group's failure
 *      code and kinds call for, with the parameters decided here, from the
 *      plan. Where the layer has no lever the composer reads today (a
 *      per-section harmony cost profile, a per-part register band), the
 *      operation says so (`leverAvailable: false`) and is realised as a
 *      recompose of the part from the plan that already states the intent.
 *   4. Priorities come from the judge (`verdict.ranked`), never from a score.
 *      The ranked operations are then dealt round-robin over their
 *      `<layer>.<operation>` shape (`diversifyByShape`), so a budget of three
 *      passes covers three problems rather than the same edit in three
 *      sections; the queue is deeper than the budget and the rest are deferred
 *      with the reason. Findings the repair stage cannot act on (perform /
 *      render / mix / brief / unknown origins, `INPUT_UNKNOWN`) are deferred,
 *      never silently dropped.
 *
 * Pure and deterministic: the same observations, verdict and plan give the
 * same RepairPlan. The executor (`repairExecutor.ts`) applies an operation to
 * the plan objects; the loop (`criticRepairLoop.ts`) judges the result.
 */
import type {
  ArcDynamicMarking,
  ArcTextureLevel,
  ArrangementFailureCode,
  ArrangementPlan,
  DecisionOriginLayer,
  RepairLayer,
  RepairOperationScope,
  RepairOperationSpec,
  RepairPlan,
  SectionDevelopmentOperator,
  TrackModel,
} from "@workspace/db";
import type { CriticObservation, Severity } from "./critics/types";
import type { JudgeVerdict } from "./critics/judge";
import { codeForKind, FAILURE_TAXONOMY, type FailureCode } from "./critics/failureTaxonomy";
import { DYNAMIC_MARKINGS, REGISTER_SHIFTABLE_FAMILIES, TEXTURE_LEVELS, canonicalFamily } from "./arrangementArc";

export const REPAIR_PLANNER_VERSION = "REPAIR_PLANNER_v1" as const;
const METHOD = "repair-planner/v1";
export const DEFAULT_MAX_REPAIR_PASSES = 3;
/** How many operations the plan queues per pass of budget, so a pass that changes nothing still leaves the loop somewhere to go. */
export const QUEUE_DEPTH_FACTOR = 4;

// ---------------------------------------------------------------------------
// Failure codes for every observation kind
// ---------------------------------------------------------------------------

/**
 * B-05a's dimension kinds are not in `critics/failureTaxonomy.ts` (written by
 * B-05b before B-05a landed); until the taxonomy lists them, this supplement
 * gives each one the code its definition matches. `codeForKind` wins when it
 * knows the kind.
 */
export const B05A_KIND_CODES: Readonly<Record<string, FailureCode>> = Object.freeze({
  // register
  low_mid_pileup: "REGISTER_FAILURE",
  low_register_crowding: "REGISTER_FAILURE",
  vocal_masking: "VOCAL_SPACE_FAILURE",
  /** The part left the band the plan gave it: the notes contradict the plan. */
  part_outside_planned_band: "PLAN_REALISATION_FAILURE",
  part_outside_comfortable_range: "IDIOM_FAILURE",
  sub_register_overlap: "AUDIO_BALANCE_FAILURE",
  // orchestration
  notes_outside_song: "PLAN_REALISATION_FAILURE",
  unplanned_entry: "ORCHESTRATION_FAILURE",
  continuous_tutti: "GLOBAL_COHERENCE_FAILURE",
  // emotional arc
  climax_misplaced: "ENERGY_ARC_FAILURE",
  no_build_into_climax: "ENERGY_ARC_FAILURE",
  no_release_after_climax: "ENERGY_ARC_FAILURE",
  flat_arc: "ENERGY_ARC_FAILURE",
  flat_arc_by_plan: "ENERGY_ARC_FAILURE",
  // form
  repeat_without_development: "FORM_FAILURE",
  development_by_dynamics_only: "FORM_FAILURE",
  repeat_without_identity: "FORM_FAILURE",
  // harmony / voice leading
  clash_share: "HARMONY_FAILURE",
  overhang_across_chord_change: "HARMONY_FAILURE",
  out_of_key_share: "HARMONY_FAILURE",
  bass_leaves_chord: "HARMONY_FAILURE",
  bass_rarely_states_root: "HARMONY_FAILURE",
  parallel_perfects_within_part: "VOICE_LEADING_FAILURE",
  no_common_tone_retention: "VOICE_LEADING_FAILURE",
  voice_crossing_between_parts: "VOICE_LEADING_FAILURE",
  // density
  part_sparse_in_dense_section: "DENSITY_FAILURE",
  comping_below_role_floor: "DENSITY_FAILURE",
  bed_thin_voicing: "DENSITY_FAILURE",
  bed_single_voice: "DENSITY_FAILURE",
  part_overdense: "DENSITY_FAILURE",
  foundation_gaps: "DENSITY_FAILURE",
  louder_section_thinner: "DENSITY_FAILURE",
  quieter_section_denser: "DENSITY_FAILURE",
  density_flat_against_plan: "DENSITY_FAILURE",
  density_flat_by_plan: "DENSITY_FAILURE",
  // repetition
  loop_without_variation: "REPETITION_FAILURE",
  section_verbatim_copy: "FORM_FAILURE",
  same_type_sections_unrelated: "FORM_FAILURE",
  sections_indistinguishable: "FORM_FAILURE",
});

/** The code a dimension's unlisted kinds default to; `INPUT_UNKNOWN` for a dimension nobody mapped. */
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

export function failureCodeOf(observation: Pick<CriticObservation, "kind" | "dimension">): ArrangementFailureCode {
  return codeForKind(observation.kind) ?? B05A_KIND_CODES[observation.kind] ?? DIMENSION_DEFAULT_CODE[observation.dimension] ?? "INPUT_UNKNOWN";
}

// ---------------------------------------------------------------------------
// Layers
// ---------------------------------------------------------------------------

/** Pipeline order: a tie in the vote goes to the earlier layer (a plan decision explains more notes than a composer). */
const LAYER_ORDER: readonly DecisionOriginLayer[] = ["brief", "arc", "form", "orchestration", "register", "harmony", "groove", "compose", "perform", "render", "mix", "unknown"];
const PLANNABLE: ReadonlySet<DecisionOriginLayer> = new Set<DecisionOriginLayer>(["arc", "form", "harmony", "groove", "orchestration", "register", "compose"]);
const DEFERRED_LAYER_REASON: Partial<Record<DecisionOriginLayer, string>> = {
  perform: "the performance layer runs after the repair stage; a perform finding is for the perform stage (B-13), not a recompose",
  render: "a render finding is for the render loop (B-07); the notes are not the cause",
  mix: "a mix finding is for the mix stage; the notes are not the cause",
  brief: "the brief is the producer's decision; the repair stage does not overrule it on its own",
  unknown: "no layer is suspected; nothing can be reopened without guessing a cause",
};

const SEVERITY_RANK: Record<Severity, number> = { info: 0, minor: 1, major: 2, blocking: 3 };
const SEVERITY_BASE: Record<Severity, number> = { blocking: 1000, major: 100, minor: 10, info: 1 };

const r4 = (v: number) => Number(v.toFixed(4));
const uniq = <T,>(xs: readonly T[]): T[] => [...new Set(xs)];

// ---------------------------------------------------------------------------
// Plan readings the planner needs
// ---------------------------------------------------------------------------

type SectionReading = {
  name: string;
  startBar: number;
  endBar: number;
  function: string;
  occurrenceIndex: number;
  operator: SectionDevelopmentOperator;
  texture: ArcTextureLevel | null;
  marking: ArcDynamicMarking | null;
  energy: number;
  activeFamilies: string[];
  isClimax: boolean;
};

function readSections(plan: ArrangementPlan): SectionReading[] {
  const targets = plan.globalPlan?.sectionTargets ?? [];
  const sections = plan.sectionPlan?.sections ?? [];
  const climax = plan.globalPlan?.climax?.sectionName ?? null;
  const arc = plan.globalPlan?.arc;
  return targets.map((target) => {
    const section = sections.find((s) => s.sectionName === target.sectionName && s.startBar === target.startBar) ?? sections.find((s) => s.sectionName === target.sectionName);
    const arcSection = arc?.sections.find((s) => s.sectionName === target.sectionName && s.startBar === target.startBar);
    return {
      name: target.sectionName,
      startBar: target.startBar,
      endBar: target.endBar,
      function: target.role,
      occurrenceIndex: arcSection?.occurrenceIndex ?? section?.occurrenceIndex ?? 0,
      operator: arcSection?.developmentOperator.value ?? section?.developmentOperator ?? "identity",
      texture: arcSection?.textureLevel.value ?? section?.textureLevel ?? target.textureLevel ?? null,
      marking: arcSection?.intendedDynamic.value.marking ?? section?.intendedDynamic ?? target.intendedDynamic ?? null,
      energy: target.energy,
      activeFamilies: section?.activeInstrumentFamilies ?? arcSection?.activeFamilies ?? [],
      isClimax: target.sectionName === climax,
    };
  });
}

function sectionsForBars(sections: SectionReading[], startBar: number, endBar: number): SectionReading[] {
  return sections.filter((s) => s.startBar <= endBar && s.endBar >= startBar);
}

const stepTexture = (texture: ArcTextureLevel, steps: number): ArcTextureLevel =>
  TEXTURE_LEVELS[Math.max(0, Math.min(TEXTURE_LEVELS.length - 1, TEXTURE_LEVELS.indexOf(texture) + steps))];
const stepMarking = (marking: ArcDynamicMarking, steps: number): ArcDynamicMarking =>
  DYNAMIC_MARKINGS[Math.max(0, Math.min(DYNAMIC_MARKINGS.length - 1, DYNAMIC_MARKINGS.indexOf(marking) + steps))];

const CHORDAL = new Set(["keys", "guitar", "strings", "pads", "synth"]);
const COUNTERLINE = new Set(["strings", "winds", "brass", "guitar", "synth"]);
const COMPING = new Set(["keys", "guitar"]);

/** The development operators a section could take instead of its current one, in the order the arc prefers them. */
export function alternativeOperators(section: SectionReading, familyOrder: readonly string[]): SectionDevelopmentOperator[] {
  const active = section.activeFamilies.map(canonicalFamily);
  const candidates: SectionDevelopmentOperator[] = ["add_layer", "raise_register", "thicken_voicing", "activate_counterline", "change_comping_subdivision"];
  return candidates.filter((operator) => {
    if (operator === section.operator) return false;
    switch (operator) {
      case "add_layer": return familyOrder.some((f) => !active.includes(canonicalFamily(f)));
      case "raise_register": return active.some((f) => REGISTER_SHIFTABLE_FAMILIES.has(f));
      case "thicken_voicing": return active.some((f) => CHORDAL.has(f));
      case "activate_counterline": return active.some((f) => COUNTERLINE.has(f));
      case "change_comping_subdivision": return active.some((f) => COMPING.has(f));
      default: return false;
    }
  });
}

// ---------------------------------------------------------------------------
// Grouping
// ---------------------------------------------------------------------------

type Group = {
  key: string;
  observations: CriticObservation[];
  sections: SectionReading[];
  sectionNames: string[];
  trackIds: string[];
  instruments: string[];
  startBar: number;
  endBar: number;
  priority: number;
  votes: Array<{ layer: DecisionOriginLayer; weight: number }>;
  primaryCode: ArrangementFailureCode;
  codes: ArrangementFailureCode[];
};

function instrumentOfTrack(trackModels: readonly TrackModel[], trackId: string): string | null {
  const track = trackModels.find((t) => t.id === trackId);
  return track ? track.instrument : null;
}

function priorityOf(observation: CriticObservation, verdict: JudgeVerdict): number {
  const ranked = verdict.ranked.find((r) => r.observation.id === observation.id);
  return ranked ? ranked.priority : SEVERITY_BASE[observation.severity] * observation.confidence;
}

function groupObservations(
  observations: readonly CriticObservation[],
  verdict: JudgeVerdict,
  sections: SectionReading[],
  trackModels: readonly TrackModel[],
): Group[] {
  const byKey = new Map<string, CriticObservation[]>();
  for (const observation of observations) {
    const inBars = sectionsForBars(sections, observation.location.startBar, observation.location.endBar);
    // The adversarial modules name the section at the observation's first bar
    // even when it spans the song; the bars decide the scope, the name only
    // when it covers them.
    const named = observation.location.sectionName ? sections.find((s) => s.name === observation.location.sectionName) : undefined;
    const nameCovers = !!named && named.startBar <= observation.location.startBar && named.endBar >= observation.location.endBar;
    const sectionKey = nameCovers
      ? named!.name
      : inBars.length === sections.length && sections.length > 1 ? "*" : inBars.map((s) => s.name).join("+") || observation.location.sectionName || "*";
    const tracks = [...observation.location.trackIds].sort();
    // A whole-arrangement observation (every track listed) is about the place, not the parts.
    const trackKey = tracks.length && tracks.length < trackModels.length ? tracks.join("+") : "all";
    const key = `${sectionKey}|${trackKey}`;
    byKey.set(key, [...(byKey.get(key) ?? []), observation]);
  }
  const groups: Group[] = [];
  for (const [key, members] of byKey) {
    const startBar = Math.min(...members.map((m) => m.location.startBar));
    const endBar = Math.max(...members.map((m) => m.location.endBar));
    const sectionKey = key.split("|")[0];
    const inScope = sectionKey === "*"
      ? sections
      : sections.filter((s) => sectionKey.split("+").includes(s.name));
    if (!inScope.length) inScope.push(...sectionsForBars(sections, startBar, endBar));
    const trackIds = key.endsWith("|all") ? [] : uniq(members.flatMap((m) => m.location.trackIds)).sort();
    const instruments = uniq(trackIds.map((id) => instrumentOfTrack(trackModels, id)).filter((i): i is string => !!i)).sort();
    const voteMap = new Map<DecisionOriginLayer, number>();
    for (const m of members) {
      const weight = Math.max(0.05, m.confidence) * Math.max(0.05, m.originConfidence) * (SEVERITY_RANK[m.severity] || 1);
      voteMap.set(m.suspectedOrigin, (voteMap.get(m.suspectedOrigin) ?? 0) + weight);
    }
    const votes = [...voteMap.entries()].map(([layer, weight]) => ({ layer, weight: r4(weight) }))
      .sort((a, b) => b.weight - a.weight || LAYER_ORDER.indexOf(a.layer) - LAYER_ORDER.indexOf(b.layer));
    const codePriority = new Map<ArrangementFailureCode, number>();
    for (const m of members) {
      const code = failureCodeOf(m);
      codePriority.set(code, Math.max(codePriority.get(code) ?? 0, priorityOf(m, verdict)));
    }
    const codes = [...codePriority.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0])).map(([code]) => code);
    groups.push({
      key,
      observations: [...members].sort((a, b) => a.id.localeCompare(b.id)),
      sections: inScope,
      sectionNames: inScope.map((s) => s.name),
      trackIds,
      instruments,
      startBar,
      endBar,
      priority: r4(Math.max(...members.map((m) => priorityOf(m, verdict)))),
      votes,
      primaryCode: codes[0] ?? "INPUT_UNKNOWN",
      codes,
    });
  }
  return groups.sort((a, b) => b.priority - a.priority || a.key.localeCompare(b.key));
}

// ---------------------------------------------------------------------------
// Origin refinement: where the plan can confirm or deny a layer
// ---------------------------------------------------------------------------

function refineOrigin(group: Group, sections: SectionReading[]): { layer: DecisionOriginLayer; note: string | null } {
  const top = group.votes[0]?.layer ?? "unknown";
  const kinds = new Set(group.observations.map((o) => o.kind));
  if (kinds.has("climax_misplaced")) {
    const climax = sections.find((s) => s.isClimax);
    const peakName = group.observations.find((o) => o.kind === "climax_misplaced")?.evidence.actualPeak;
    const peak = sections.find((s) => s.name === peakName);
    if (climax && peak && climax !== peak) {
      const climaxTexture = climax.texture ? TEXTURE_LEVELS.indexOf(climax.texture) : -1;
      const peakTexture = peak.texture ? TEXTURE_LEVELS.indexOf(peak.texture) : -1;
      if (climaxTexture >= 0 && peakTexture >= 0 && climaxTexture < peakTexture) {
        return { layer: "arc", note: `the plan's climax "${climax.name}" is planned ${climax.texture} while "${peak.name}" is planned ${peak.texture}: the arc's texture decision, not the composer` };
      }
      if (peak.energy >= climax.energy) {
        return { layer: "arc", note: `the plan's intended level peaks in "${peak.name}" (${peak.energy}) rather than at its climax "${climax.name}" (${climax.energy}): the arc's dynamic decision` };
      }
    }
  }
  if (kinds.has("planned_family_silent")) {
    const taskPlanned = group.observations.some((o) => o.kind === "planned_family_silent" && o.evidence.taskPlanned === true);
    if (!taskPlanned) return { layer: "orchestration", note: "the family is assigned a role that produced no part task: the orchestration plan, not the composer" };
  }
  return { layer: top, note: null };
}

// ---------------------------------------------------------------------------
// Operations per layer
// ---------------------------------------------------------------------------

type OperationDraft = {
  operation: string;
  params: Record<string, unknown>;
  leverAvailable: boolean;
  leverNote?: string;
  scopeSections?: string[];
  scopeInstruments?: string[];
  reason: string;
};

const BASS_KINDS = new Set(["bass_leaves_chord", "bass_rarely_states_root", "static_bass_no_approach", "bass_sustain_beyond_decay", "bass_and_keys_share_low_octave"]);
const SECTION_WIDE_REGISTER_KINDS = new Set(["low_mid_pileup", "low_register_crowding", "close_position_same_octave", "keys_low_interval_mud", "bass_and_keys_share_low_octave", "register_crowded"]);
const TRANSITION_KINDS = new Set(["transition_unprepared", "climax_not_prepared", "planned_fill_missing", "ending_is_a_cut", "ending_missing"]);

/** A task-producing role for a family whose assigned role built no task (`taskFor` in partComposer.ts). */
function taskProducingRole(family: string): string {
  const f = canonicalFamily(family);
  if (f === "drums" || f === "percussion") return "GROOVE";
  if (f === "bass") return "BASS";
  if (f === "pads" || f === "synth") return "PAD";
  if (f === "brass" || f === "winds") return "CLIMAX_LAYER";
  return "HARMONIC_BED";
}

function draftOperation(layer: DecisionOriginLayer, group: Group, sections: SectionReading[], plan: ArrangementPlan): OperationDraft | null {
  const kinds = new Set(group.observations.map((o) => o.kind));
  const code = group.primaryCode;
  const familyOrder = plan.globalPlan?.arc?.familyOrder ?? [];
  const climax = sections.find((s) => s.isClimax) ?? null;
  const first = group.sections[0] ?? null;

  switch (layer) {
    case "arc": {
      if (kinds.has("climax_misplaced") && climax) {
        const peakName = group.observations.find((o) => o.kind === "climax_misplaced")?.evidence.actualPeak;
        const peak = sections.find((s) => s.name === peakName) ?? first;
        if (!peak || peak === climax) return null;
        const textureLevels: Record<string, ArcTextureLevel> = {};
        const sectionDynamics: Record<string, ArcDynamicMarking> = {};
        const climaxTexture = climax.texture ?? "full";
        const peakTexture = peak.texture ?? "full";
        if (TEXTURE_LEVELS.indexOf(climaxTexture) <= TEXTURE_LEVELS.indexOf(peakTexture)) {
          textureLevels[climax.name] = stepTexture(peakTexture, 1) === peakTexture ? peakTexture : stepTexture(peakTexture, 1);
          if (textureLevels[climax.name] === peakTexture) textureLevels[peak.name] = stepTexture(peakTexture, -1);
        }
        const climaxMarking = climax.marking ?? "f";
        const peakMarking = peak.marking ?? "mf";
        if (DYNAMIC_MARKINGS.indexOf(peakMarking) >= DYNAMIC_MARKINGS.indexOf(climaxMarking)) {
          sectionDynamics[peak.name] = stepMarking(climaxMarking, -1);
        }
        if (!Object.keys(textureLevels).length && !Object.keys(sectionDynamics).length) return null;
        return {
          operation: "arc.restate_climax",
          params: { climaxSection: climax.name, peakSection: peak.name, textureLevels, sectionDynamics },
          leverAvailable: true,
          scopeSections: uniq([climax.name, peak.name]),
          scopeInstruments: [],
          reason: `the notes peak in "${peak.name}" while the arc's climax is "${climax.name}": restate the climax's texture / the peak's dynamic and re-derive the plan below the arc`,
        };
      }
      if (kinds.has("no_release_after_climax") && first) {
        return {
          operation: "arc.restate_dynamics",
          params: { sectionDynamicSteps: { [first.name]: -1 }, textureSteps: { [first.name]: -1 } },
          leverAvailable: true, scopeSections: [first.name], scopeInstruments: [],
          reason: `"${first.name}" keeps the climax's energy: one marking and one texture level down after the arrival`,
        };
      }
      if (kinds.has("flat_arc") || kinds.has("flat_arc_by_plan")) {
        if (!climax) return null;
        const quietest = [...sections].filter((s) => s !== climax).sort((a, b) => a.energy - b.energy)[0];
        if (!quietest) return null;
        return {
          operation: "arc.widen_dynamics",
          params: { sectionDynamicSteps: { [climax.name]: 1, [quietest.name]: -1 }, textureSteps: { [quietest.name]: -1 } },
          leverAvailable: true, scopeSections: [climax.name, quietest.name], scopeInstruments: [],
          reason: `the arc is flat: raise the climax one marking and thin the quietest section`,
        };
      }
      if (code === "DENSITY_FAILURE" && first) {
        const thinner = kinds.has("louder_section_thinner") || kinds.has("part_sparse_in_dense_section") || kinds.has("density_flat_by_plan") || kinds.has("density_flat_against_plan");
        const steps = thinner ? 1 : -1;
        return {
          operation: "arc.set_texture_level",
          params: { textureSteps: { [first.name]: steps } },
          leverAvailable: true, scopeSections: [first.name], scopeInstruments: [],
          reason: `the texture of "${first.name}" contradicts its place in the arc: ${steps > 0 ? "one level fuller" : "one level thinner"}`,
        };
      }
      if (code === "GLOBAL_COHERENCE_FAILURE" || kinds.has("continuous_tutti") || kinds.has("everyone_always_playing")) {
        const nonClimax = sections.filter((s) => !s.isClimax && (s.function === "verse" || s.function === "intro" || s.function === "bridge" || s.function === "breakdown"));
        if (!nonClimax.length) return null;
        return {
          operation: "arc.set_texture_level",
          params: { textureSteps: Object.fromEntries(nonClimax.map((s) => [s.name, -1])) },
          leverAvailable: true, scopeSections: nonClimax.map((s) => s.name), scopeInstruments: [],
          reason: "the ensemble never changes: thin the sections that are not the arrival so the texture has somewhere to go",
        };
      }
      return null;
    }
    case "form": {
      if (code === "FORM_FAILURE" || code === "REPETITION_FAILURE") {
        const repeat = group.sections.find((s) => s.occurrenceIndex > 0) ?? null;
        if (!repeat) return null;
        if (kinds.has("repeat_without_identity")) {
          if (repeat.operator === "identity") return null;
          return {
            operation: "form.change_development_operator",
            params: { sectionName: repeat.name, operator: "identity", previousOperator: repeat.operator },
            leverAvailable: true, scopeSections: [repeat.name], scopeInstruments: [],
            reason: `"${repeat.name}" is not recognisable as its section type: restate it (identity) instead of ${repeat.operator}`,
          };
        }
        const alternatives = alternativeOperators(repeat, familyOrder);
        if (!alternatives.length) return null;
        return {
          operation: "form.change_development_operator",
          params: { sectionName: repeat.name, operator: alternatives[0], previousOperator: repeat.operator, alternatives },
          leverAvailable: true, scopeSections: [repeat.name], scopeInstruments: [],
          reason: repeat.operator === "identity"
            ? `"${repeat.name}" repeats its earlier statement with no development operator: choose ${alternatives[0]}`
            : `"${repeat.name}" was planned ${repeat.operator} and still reads as a copy: reopen the choice, ${alternatives[0]}`,
        };
      }
      if (code === "TRANSITION_FAILURE" || [...kinds].some((k) => TRANSITION_KINDS.has(k))) {
        const transition = transitionInto(plan, group);
        if (!transition) return null;
        return {
          operation: "form.add_transition_device",
          params: { transitionId: transition.id, device: transition.device, fromSection: transition.fromSection, toSection: transition.toSection },
          leverAvailable: true, scopeSections: uniq([transition.fromSection, transition.toSection]), scopeInstruments: ["drums", "percussion"],
          reason: `the boundary ${transition.fromSection} -> ${transition.toSection} is unprepared: a ${transition.device} on the transition, realised by the kit`,
        };
      }
      return null;
    }
    case "groove": {
      if (code === "TRANSITION_FAILURE" || [...kinds].some((k) => TRANSITION_KINDS.has(k))) {
        const transition = transitionInto(plan, group);
        if (!transition) return null;
        return {
          operation: "groove.add_fill",
          params: { transitionId: transition.id, device: transition.device, fromSection: transition.fromSection, toSection: transition.toSection },
          leverAvailable: true, scopeSections: uniq([transition.fromSection, transition.toSection]), scopeInstruments: ["drums", "percussion"],
          reason: `nothing carries ${transition.fromSection} -> ${transition.toSection}: a ${transition.device} on the transition plan`,
        };
      }
      const repeat = group.sections.find((s) => s.occurrenceIndex > 0 && s.operator !== "change_comping_subdivision" && s.activeFamilies.some((f) => COMPING.has(canonicalFamily(f))));
      if (repeat) {
        return {
          operation: "groove.change_comping_subdivision",
          params: { sectionName: repeat.name, operator: "change_comping_subdivision", previousOperator: repeat.operator },
          leverAvailable: true, scopeSections: [repeat.name], scopeInstruments: [],
          reason: `the groove of "${repeat.name}" is a block: flip the comping between bed and rhythmic comping (the plan's comping lever)`,
        };
      }
      return {
        operation: "groove.recompose_rhythm_section",
        params: {},
        leverAvailable: false,
        leverNote: "the GroovePlan is derived from the section plan inside the composer (B-04); no per-section groove cell is stored in the plan yet, so the rhythm section is recomposed from the plan that already states the groove",
        reason: "recompose the rhythm section of the flagged bars from the plan's groove",
      };
    }
    case "orchestration": {
      if (kinds.has("planned_family_silent")) {
        const silent = group.observations.filter((o) => o.kind === "planned_family_silent");
        const notTasked = silent.find((o) => o.evidence.taskPlanned === false);
        if (notTasked && first) {
          const family = String(notTasked.evidence.instrument ?? "");
          if (!family) return null;
          return {
            operation: "orchestration.change_role",
            params: { sectionName: first.name, instrument: family, role: taskProducingRole(family), previousRoles: String(notTasked.evidence.plannedRoles ?? "") },
            leverAvailable: true, scopeSections: [first.name], scopeInstruments: [family],
            reason: `${family} is assigned a role in "${first.name}" that builds no part task: give it ${taskProducingRole(family)} so a part exists`,
          };
        }
        return null;
      }
      if (kinds.has("unison_doubling_by_accident") && first && group.instruments.length) {
        const doubled = group.instruments[group.instruments.length - 1];
        return {
          operation: "orchestration.change_role",
          params: { sectionName: first.name, instrument: doubled, role: canonicalFamily(doubled) === "strings" || canonicalFamily(doubled) === "pads" ? "PAD" : "COUNTER_MELODY" },
          leverAvailable: true, scopeSections: [first.name], scopeInstruments: [doubled],
          reason: `${doubled} doubles another part in "${first.name}" by accident: give it its own role`,
        };
      }
      if (kinds.has("continuous_tutti") || kinds.has("everyone_always_playing") || kinds.has("ensemble_never_changes")) {
        return null; // the arc's texture ladder is the lever (see the arc case); the vote falls through
      }
      if (kinds.has("definition_family_mismatch")) return null; // B-03's instrument profiles; nothing in the plan to reopen
      return null;
    }
    case "register": {
      const sectionWide = [...kinds].some((k) => SECTION_WIDE_REGISTER_KINDS.has(k)) || code === "VOCAL_SPACE_FAILURE";
      if (sectionWide && first) {
        let up = 1;
        let avoidBand: string | null = null;
        if (code === "VOCAL_SPACE_FAILURE") {
          // Away from the singer, which is not the same as "one step in some
          // direction": a part planned *above* her band that is moved down
          // lands on her, and a part planned *on* her band must clear it, not
          // stop inside it. So the direction points away from the vocal band
          // (down when the part is already on it — the singer keeps the middle
          // and the bed goes under her) and the band she occupies is named so
          // the executor steps past it instead of into it.
          const masking = group.observations.find((o) => o.kind === "vocal_masking");
          const bands = ["sub", "low", "low_mid", "mid", "upper_mid", "high", "very_high"];
          const vocalBand = String(masking?.evidence.vocalBand ?? "mid");
          const vocal = bands.indexOf(vocalBand);
          const planned = bands.indexOf(String(masking?.evidence.plannedRegister ?? "mid"));
          up = planned > vocal ? 1 : -1;
          avoidBand = vocalBand;
        }
        return {
          operation: "register.shift_section_band",
          params: { sectionName: first.name, direction: up, ...(avoidBand ? { avoidBand } : {}) },
          leverAvailable: true, scopeSections: [first.name], scopeInstruments: [],
          reason: code === "VOCAL_SPACE_FAILURE"
            ? `a part sits on the singer's pitches in "${first.name}": move the section's band ${up > 0 ? "up" : "down"}, clear of the ${avoidBand} band she occupies, and re-voice`
            : `the pitched parts of "${first.name}" pile up in the low-mid: move the section's register band one step up and re-voice`,
        };
      }
      return {
        operation: "register.recompose_into_planned_band",
        params: {},
        leverAvailable: false,
        leverNote: "the plan states a register band per section (registerDistribution) and per role assignment, but the composer reads only the section band; a per-part register plan is B-03's - the part is recomposed into the band the plan already gives it",
        reason: "recompose the part into the register band its plan already states",
      };
    }
    case "harmony": {
      const bass = [...kinds].some((k) => BASS_KINDS.has(k)) || group.instruments.some((i) => canonicalFamily(i) === "bass");
      return {
        operation: bass ? "harmony.replan_bass" : "harmony.resolve_voicings",
        params: bass ? { line: "planned (B-02 bassLine.ts)" } : { solver: "per-role voicing (B-02 voicings.ts)" },
        leverAvailable: false,
        leverNote: "B-02's bass planner and voicing solver take their cost profile from the global aesthetic; the plan carries no per-section harmony profile yet, so the part is re-planned from the plan it already has",
        reason: bass ? "re-plan the bass line of the flagged bars from the harmonic rhythm" : "re-solve the voicings of the flagged bars against the planned bass",
      };
    }
    case "compose":
      return {
        operation: "compose.recompose_part",
        params: {},
        leverAvailable: true,
        reason: "the plan states the intent and the notes do not realise it: recompose the part from the plan",
      };
    default:
      return null;
  }
}

/**
 * The boundary a transition group is about, and a device it does not already
 * carry. A transition that already has the device the operation would add is
 * skipped here rather than drafted and rejected by the executor — an
 * operation the plan can refuse on sight is not a repair attempt.
 */
function transitionInto(plan: ArrangementPlan, group: Group): { id: string; kind: string; fromSection: string; toSection: string; device: string } | null {
  const transitions = plan.transitionPlan?.transitions ?? [];
  const target = group.sections[0];
  if (!target) return null;
  const candidates = [
    ...transitions.filter((t) => t.toSection === target.name),
    ...transitions.filter((t) => t.fromSection === target.name),
  ];
  for (const into of candidates) {
    const wanted = into.kind === "drop" ? ["break", "drum_fill"] : ["drum_fill", "break"];
    const device = wanted.find((d) => !into.devices.some((existing) => existing.device === d));
    if (device) return { id: into.id, kind: into.kind, fromSection: into.fromSection, toSection: into.toSection, device };
  }
  return null;
}

// ---------------------------------------------------------------------------
// The plan
// ---------------------------------------------------------------------------

export type SeededRepairTarget = {
  /** The producer's finding id (kept in the operation id). */
  id: string;
  failureCode: ArrangementFailureCode;
  originLayer: DecisionOriginLayer;
  kind?: string;
  reason: string;
  scope: RepairOperationScope;
};

/**
 * Dimensions the repair stage does not plan from: the repair stage judges the
 * composed notes, and performance (dynamics, timing, articulation) is applied
 * after it, so `performanceRealisation` findings on pre-performance notes are
 * for the perform stage. They are deferred with that reason, never dropped.
 */
export const DEFAULT_EXCLUDED_DIMENSIONS: readonly string[] = ["performanceRealisation"];

export type RepairPlannerInput = {
  observations: readonly CriticObservation[];
  verdict: JudgeVerdict;
  plan: ArrangementPlan;
  trackModels: readonly TrackModel[];
  /** Dimensions whose observations are deferred rather than planned (default `DEFAULT_EXCLUDED_DIMENSIONS`). */
  excludeDimensions?: readonly string[];
  /**
   * True when `trackModels` were composed from `plan` by the deterministic
   * composer this run will recompose with — which is the case for every
   * candidate the orchestrator repairs, before and after an accepted pass.
   * Recomposing a part from an unchanged plan then writes the same notes, so
   * `compose.recompose_part` is a no-op by construction and is not offered:
   * the group is deferred saying so, and the budget goes to an operation that
   * can change something. This is R-1a's P1-4 read backwards — the fix is not
   * to attempt more, it is to stop attempting what cannot fire and say why.
   */
  notesAreFreshFromPlan?: boolean;
  maxPasses?: number;
  /** A producer-triggered repair's scope: observations outside it are not planned, operations are clipped to it. */
  scopeLimit?: RepairOperationScope | null;
  /** The producer's finding, planned first even when no critic observation restates it. */
  seeded?: SeededRepairTarget | null;
};

function scopeIntersects(a: RepairOperationScope, obs: CriticObservation): boolean {
  const bars = obs.location.startBar <= a.endBar && obs.location.endBar >= a.startBar;
  const tracks = !a.trackIds.length || !obs.location.trackIds.length || obs.location.trackIds.some((t) => a.trackIds.includes(t));
  return bars && tracks;
}

function clipScope(scope: RepairOperationScope, limit: RepairOperationScope | null | undefined): RepairOperationScope {
  if (!limit) return scope;
  return {
    sections: scope.sections.filter((s) => limit.sections.includes(s)),
    instruments: limit.instruments.length ? (scope.instruments.length ? scope.instruments.filter((i) => limit.instruments.includes(i)) : [...limit.instruments]) : scope.instruments,
    trackIds: limit.trackIds.length ? (scope.trackIds.length ? scope.trackIds.filter((t) => limit.trackIds.includes(t)) : [...limit.trackIds]) : scope.trackIds,
    startBar: Math.max(scope.startBar, limit.startBar),
    endBar: Math.min(scope.endBar, limit.endBar),
  };
}

/**
 * `compose.recompose_part` edits no plan object: it recomposes the scoped
 * tasks from an unchanged plan, which on notes the same deterministic composer
 * just wrote from that plan is a no-op by construction. It is therefore not
 * offered for such a candidate — the group is deferred saying so.
 *
 * A `leverAvailable: false` operation of a *named plan layer* is the same
 * no-op mechanically, and is still offered: it costs no pass (a pass that
 * changes nothing is rejected before the budget is spent), and its record is
 * the evidence that the layer was named and its lever is missing — which is
 * what the capability ladder and the next stream need. Suppressing those was
 * measured on the corpus and lost two repairs that the reordered queue would
 * otherwise have reached, so they stay.
 */
export const noOpOnFreshNotes = (draft: OperationDraft) => draft.operation === "compose.recompose_part";
export const NO_OP_ON_FRESH_NOTES_REASON =
  "the only layer named for this group is the composer, and these notes were just composed from this plan: " +
  "recomposing the part would write the same notes. Nothing is attempted, because nothing would change";

function operationFor(
  group: Group,
  layer: DecisionOriginLayer,
  sections: SectionReading[],
  plan: ArrangementPlan,
  limit: RepairOperationScope | null | undefined,
  index: number,
  suffix: string,
  notesAreFreshFromPlan: boolean,
): { spec: Omit<RepairOperationSpec, "fallback">; layerUsed: RepairLayer } | null {
  if (!PLANNABLE.has(layer)) return null;
  const draft = draftOperation(layer, group, sections, plan);
  if (!draft) return null;
  if (notesAreFreshFromPlan && noOpOnFreshNotes(draft)) return null;
  const scopeSections = draft.scopeSections ?? group.sectionNames;
  const scopedSections = sections.filter((s) => scopeSections.includes(s.name));
  const scope: RepairOperationScope = clipScope({
    sections: scopeSections,
    instruments: draft.scopeInstruments ?? group.instruments,
    trackIds: draft.scopeInstruments ? [] : group.trackIds,
    startBar: scopedSections.length ? Math.min(...scopedSections.map((s) => s.startBar)) : group.startBar,
    endBar: scopedSections.length ? Math.max(...scopedSections.map((s) => s.endBar)) : group.endBar,
  }, limit);
  if (!scope.sections.length || scope.endBar < scope.startBar) return null;
  const primaryTargets = group.observations.filter((o) => failureCodeOf(o) === group.primaryCode).map((o) => o.id);
  const layerUsed = layer as RepairLayer;
  return {
    layerUsed,
    spec: {
      id: `repair-${index + 1}-${layerUsed}-${suffix}`,
      layer: layerUsed,
      operation: draft.operation,
      params: draft.params,
      scope,
      failureCode: group.primaryCode,
      suspectedOrigin: layer,
      originVotes: group.votes,
      targets: group.observations.map((o) => o.id),
      expectedEffect: primaryTargets,
      priority: group.priority,
      reason: draft.reason,
      leverAvailable: draft.leverAvailable,
      ...(draft.leverNote ? { leverNote: draft.leverNote } : {}),
    },
  };
}

/**
 * One pass per problem, not three passes on the same problem.
 *
 * The judge's priorities tie constantly - five sections of one song carry the
 * same `vocal_masking` severity and confidence, so five copies of the same
 * register edit rank above every other layer and a budget of three passes
 * never reaches the arc. An arranger given three revisions does not spend all
 * three moving the register band of three different sections. So the ranked
 * operations are dealt round-robin over their `<layer>.<operation>` shape:
 * priority still decides which shape leads and which operation inside a shape
 * comes first, and the budget covers distinct edits before it repeats one.
 * Deterministic, and visible in the persisted plan rather than hidden in the
 * loop. Measured on the seeded corpus: without it the arc never gets a pass on
 * the anchors whose vocal band is crowded.
 */
export function diversifyByShape(operations: readonly RepairOperationSpec[]): RepairOperationSpec[] {
  const buckets = new Map<string, RepairOperationSpec[]>();
  for (const operation of operations) {
    const shape = `${operation.layer}.${operation.operation}`;
    buckets.set(shape, [...(buckets.get(shape) ?? []), operation]);
  }
  const shapes = [...buckets.keys()];
  const out: RepairOperationSpec[] = [];
  while (out.length < operations.length) {
    let dealt = false;
    for (const shape of shapes) {
      const next = buckets.get(shape)!.shift();
      if (next) { out.push(next); dealt = true; }
    }
    if (!dealt) break;
  }
  return out;
}

export function buildRepairPlan(input: RepairPlannerInput): RepairPlan {
  const maxPasses = Math.max(0, input.maxPasses ?? DEFAULT_MAX_REPAIR_PASSES);
  const sections = readSections(input.plan);
  const limit = input.scopeLimit ?? null;
  const deferred: RepairPlan["deferred"] = [];

  const excluded = new Set(input.excludeDimensions ?? DEFAULT_EXCLUDED_DIMENSIONS);
  const considered = input.observations.filter((o) => o.severity !== "info");
  const excludedObservations = considered.filter((o) => excluded.has(o.dimension));
  if (excludedObservations.length) {
    deferred.push({
      observationIds: excludedObservations.map((o) => o.id).sort(),
      reason: `${[...excluded].join(", ")}: the repair stage judges composed notes; performance is applied after it, so these are for the perform stage`,
    });
  }
  const inLimit = (limit ? considered.filter((o) => scopeIntersects(limit, o)) : considered).filter((o) => !excluded.has(o.dimension));
  if (limit) {
    const outside = considered.filter((o) => !excluded.has(o.dimension) && !scopeIntersects(limit, o));
    if (outside.length) deferred.push({ observationIds: outside.map((o) => o.id).sort(), reason: "outside the producer's repair scope" });
  }
  const unknownInput = inLimit.filter((o) => failureCodeOf(o) === "INPUT_UNKNOWN");
  if (unknownInput.length) {
    deferred.push({ observationIds: unknownInput.map((o) => o.id).sort(), reason: "INPUT_UNKNOWN: the critic could not judge (an unknown or contested input); not a musical defect a recompose can fix" });
  }
  const plannable = inLimit.filter((o) => !unknownInput.includes(o));

  const groups = groupObservations(plannable, input.verdict, sections, input.trackModels);
  const operations: RepairOperationSpec[] = [];
  const seenKeys = new Set<string>();
  const fresh = input.notesAreFreshFromPlan === true;

  // The producer's finding first: its scope is the contract.
  if (input.seeded) {
    const seeded = input.seeded;
    const seededSections = sections.filter((s) => seeded.scope.sections.includes(s.name));
    const pseudoGroup: Group = {
      key: `seeded|${seeded.id}`,
      observations: plannable.filter((o) => scopeIntersects(seeded.scope, o) && failureCodeOf(o) === seeded.failureCode),
      sections: seededSections,
      sectionNames: seeded.scope.sections,
      trackIds: seeded.scope.trackIds,
      instruments: seeded.scope.instruments,
      startBar: seeded.scope.startBar,
      endBar: seeded.scope.endBar,
      priority: 1e6,
      votes: [{ layer: seeded.originLayer, weight: 1 }],
      primaryCode: seeded.failureCode,
      codes: [seeded.failureCode],
    };
    // A finding that names no cause is not turned into one: `INPUT_UNKNOWN /
    // unknown` means the critic could not say which layer authored the notes,
    // and the planner then works from the observations inside the finding's
    // scope (which the scope limit already restricts it to) rather than
    // inventing a recompose. Charter rule 4.
    const layers = seeded.originLayer === "unknown"
      ? []
      : uniq([seeded.originLayer, "compose" as DecisionOriginLayer]).filter((l) => PLANNABLE.has(l));
    let primary: ReturnType<typeof operationFor> = null;
    let fallback: ReturnType<typeof operationFor> = null;
    for (const layer of layers) {
      const op = operationFor(pseudoGroup, layer, sections, input.plan, seeded.scope, operations.length, "producer", fresh);
      if (!op) continue;
      if (!primary) primary = op;
      else if (!fallback && op.spec.operation !== primary.spec.operation) fallback = op;
    }
    if (!layers.length) {
      deferred.push({
        observationIds: [seeded.id],
        reason: `the producer's finding names no origin layer (${seeded.failureCode} / ${seeded.originLayer}); the critic observations inside its scope are planned instead of a guessed cause`,
      });
    } else if (primary) {
      operations.push({
        ...primary.spec,
        reason: `producer finding ${seeded.id} (${seeded.failureCode} / ${seeded.originLayer}): ${seeded.reason}. ${primary.spec.reason}`,
        fallback: fallback ? { ...fallback.spec, fallback: null } : null,
      });
      for (const o of pseudoGroup.observations) seenKeys.add(o.id);
    } else {
      deferred.push({ observationIds: [seeded.id], reason: `no operation exists for the producer finding's layer ${seeded.originLayer} inside its scope` });
    }
  }

  for (const group of groups) {
    if (group.observations.every((o) => seenKeys.has(o.id))) continue;
    const refined = refineOrigin(group, sections);
    const voted = group.votes.map((v) => v.layer);
    // A recompose is a candidate only where a critic or the taxonomy names the
    // composer; a group every critic attributes to the performance, the render
    // or the mix is deferred to that stage, never recomposed for want of an idea.
    const composeNamed = voted.includes("compose") || refined.layer === "compose" ||
      group.codes.some((code) => FAILURE_TAXONOMY[code as FailureCode]?.defaultOrigins.includes("compose"));
    // The critics vote on where the notes came from; the taxonomy says which
    // layers *own* a failure class. A critic that can only see the notes says
    // "compose" for a thin arrival, and the layer that decided the arrival
    // would be thin is the arc. So after the vote, the owning layers of the
    // group's codes are tried too — last, so a critic that did name a plan
    // layer still outranks them.
    const owning = uniq(group.codes.flatMap((code) => (FAILURE_TAXONOMY[code as FailureCode]?.defaultOrigins ?? []) as DecisionOriginLayer[]))
      .filter((layer) => PLANNABLE.has(layer) && layer !== "compose");
    const order = uniq([refined.layer, ...voted, ...owning, ...(composeNamed ? ["compose" as DecisionOriginLayer] : [])]);
    const deferrable = order.filter((l) => !PLANNABLE.has(l));
    let primary: ReturnType<typeof operationFor> = null;
    let fallback: ReturnType<typeof operationFor> = null;
    for (const layer of order) {
      const op = operationFor(group, layer, sections, input.plan, limit, operations.length, group.key.replace(/[^a-z0-9]+/gi, "_").slice(0, 40), fresh);
      if (!op) continue;
      if (!primary) primary = op;
      else if (!fallback && (op.spec.operation !== primary.spec.operation || op.layerUsed !== primary.layerUsed)) fallback = op;
      if (primary && fallback) break;
    }
    if (!primary) {
      const onlyNoOps = fresh && order.some((l) => {
        if (!PLANNABLE.has(l)) return false;
        const draft = draftOperation(l, group, sections, input.plan);
        return !!draft && noOpOnFreshNotes(draft);
      });
      const reason = onlyNoOps
        ? NO_OP_ON_FRESH_NOTES_REASON
        : deferrable.length
          ? `${deferrable[0]}: ${DEFERRED_LAYER_REASON[deferrable[0]] ?? `layer ${deferrable[0]} is not reopened by the repair stage`}`
          : "no bounded operation applies to this group (the plan has no lever for it and a recompose would not address it)";
      deferred.push({ observationIds: group.observations.map((o) => o.id), reason });
      continue;
    }
    const spec: RepairOperationSpec = {
      ...primary.spec,
      reason: refined.note ? `${refined.note}. ${primary.spec.reason}` : primary.spec.reason,
      fallback: fallback ? { ...fallback.spec, fallback: null } : null,
    };
    operations.push(spec);
    for (const o of group.observations) seenKeys.add(o.id);
  }

  operations.sort((a, b) => b.priority - a.priority || a.id.localeCompare(b.id));
  const ordered = diversifyByShape(operations);
  // The queue is deeper than the budget on purpose: a pass the loop declines
  // to repeat (an operation shape already measured as ineffective) costs no
  // pass, and the budget should then reach the next layer down the ranking
  // rather than run out of candidates. `maxPasses` still caps what is applied.
  const queueDepth = Math.max(maxPasses, Math.min(maxPasses * QUEUE_DEPTH_FACTOR, ordered.length));
  const kept = ordered.slice(0, queueDepth);
  for (const dropped of ordered.slice(queueDepth)) {
    deferred.push({ observationIds: dropped.targets, reason: `beyond the planned queue (${queueDepth} operations for a budget of ${maxPasses} passes); would have been ${dropped.operation} on ${dropped.scope.sections.join(", ")}` });
  }
  // Re-number so ids reflect the order they will be tried in.
  const numbered = kept.map((op, i) => ({ ...op, id: op.id.replace(/^repair-\d+-/, `repair-${i + 1}-`), fallback: op.fallback ? { ...op.fallback, id: op.fallback.id.replace(/^repair-\d+-/, `repair-${i + 1}-fallback-`) } : null }));

  return {
    version: "1.0",
    method: METHOD,
    maxPasses,
    observationsConsidered: considered.length,
    operations: numbered,
    deferred,
    scopeLimit: limit,
  };
}

/** Does `target` still exist among `after`: same dimension and kind at an overlapping place (ids may shift when a track appears or leaves). */
export function observationPersists(target: CriticObservation, after: readonly CriticObservation[]): boolean {
  return after.some((o) =>
    o.dimension === target.dimension && o.kind === target.kind &&
    o.location.startBar <= target.location.endBar && o.location.endBar >= target.location.startBar &&
    (!o.location.trackIds.length || !target.location.trackIds.length || o.location.trackIds.some((t) => target.location.trackIds.includes(t))));
}
