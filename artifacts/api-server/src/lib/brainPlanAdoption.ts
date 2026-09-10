/**
 * One planner per job (Brain B-00, D4).
 *
 * The job runner's `materializeCandidate` builds an `ArrangementPlan` with the
 * legacy planner (`createArrangementPlan`) for every provider candidate, then
 * grades (`evaluateCandidateMusicalFit`) and diversifies (`fingerprintCandidate`)
 * on it. For the Arrangement Brain — a provider that returns its own plan and
 * already-composed notes — that meant the persisted plan was not the plan the
 * notes were written from, every candidate shared identical sections, and the
 * diversity gate could not see the brain's candidates apart (architecture map
 * hot spot 1; audit §1.4, §5.2).
 *
 * This module is pure so it can be tested without the database. It reads the
 * brain's evidence off a provider candidate's parameters and rewrites the
 * legacy plan so that:
 *   - its planning layers (global / section / budget / transition / part /
 *     candidate plans) are the brain's own, not a second derivation;
 *   - its sections carry the candidate's own energy, density and active
 *     tracks (from `candidate.plan.sections`), which differ per candidate;
 *   - its provenance says where the plan came from.
 * The legacy skeleton (style, hierarchy, composition intelligence, track
 * directives) is kept, because the export and selection paths read it.
 * Providers that return no brain evidence are untouched, byte for byte.
 */
import type {
  ArrangementBrainCandidateEvidence,
  ArrangementPlan,
  CandidatePlan,
  GenerationParameters,
} from "@workspace/db";

export const BRAIN_PLAN_SOURCE = "ARRANGEMENT_ORCHESTRATOR" as const;

/** The brain's evidence on a candidate's parameters, or null when the candidate did not come from the brain. */
export function readArrangementBrainEvidence(
  parameters: GenerationParameters | Record<string, unknown> | undefined | null,
): ArrangementBrainCandidateEvidence | null {
  const candidate = parameters?.["arrangementBrain"];
  if (!candidate || typeof candidate !== "object" || Array.isArray(candidate)) return null;
  const evidence = candidate as Partial<ArrangementBrainCandidateEvidence>;
  if (evidence.version !== "1.0") return null;
  const plan = evidence.plan;
  if (!plan || typeof plan !== "object" || !plan.globalPlan || !plan.sectionPlan) return null;
  return evidence as ArrangementBrainCandidateEvidence;
}

export type AdoptBrainPlanInput = {
  /** The legacy planner's plan for this candidate (skeleton: style, hierarchy, directives). */
  legacyPlan: ArrangementPlan;
  /** The provider candidate's small plan: per-section energy / density / active tracks. */
  candidatePlan: CandidatePlan;
  /** The brain's own plan for this candidate (its planning layers). */
  brainPlan: ArrangementPlan;
  /** The project's tracks the candidate is evaluated against (the brain's ensemble). */
  tracks: Array<{ id: string; name: string; role: string; instrument?: string }>;
};

const normalise = (value: string) => value.replaceAll("_", " ").trim().toLowerCase();

/**
 * Rewrite the legacy plan so the runner grades and diversifies on the brain's
 * plan and this candidate's own sections.
 */
export function adoptBrainPlan(input: AdoptBrainPlanInput): ArrangementPlan {
  const { legacyPlan, candidatePlan, brainPlan, tracks } = input;
  const providerSections = new Map(candidatePlan.sections.map((section) => [normalise(section.name), section]));

  // Every way a provider section may name a track → the project track ids it means.
  const idsByToken = new Map<string, Set<string>>();
  const register = (token: string | undefined, trackId: string) => {
    if (!token) return;
    const key = normalise(token);
    const set = idsByToken.get(key) ?? new Set<string>();
    set.add(trackId);
    idsByToken.set(key, set);
  };
  for (const track of tracks) {
    register(track.id, track.id);
    register(track.name, track.id);
    register(track.role, track.id);
    register(track.instrument, track.id);
  }
  for (const descriptor of candidatePlan.tracks ?? []) {
    const project = tracks.find((track) => track.id === descriptor.id);
    if (!project) continue;
    register(descriptor.id, project.id);
    register(descriptor.name, project.id);
    register(descriptor.role, project.id);
  }
  const nameById = new Map(tracks.map((track) => [track.id, track.name]));

  const sections = legacyPlan.sections.map((section) => {
    const providerSection = providerSections.get(normalise(section.section));
    if (!providerSection) return section;
    const enabledIds = new Set(providerSection.tracks.flatMap((token) => [...(idsByToken.get(normalise(token)) ?? [])]));
    const enabledNames = new Set([...enabledIds].map((id) => nameById.get(id) ?? id));
    return {
      ...section,
      energy: providerSection.energy,
      density: providerSection.density,
      tracks: Object.fromEntries(
        Object.entries(section.tracks).map(([trackName, operation]) => [
          trackName,
          enabledNames.has(trackName) || enabledIds.has(trackName) ? operation : "none",
        ]),
      ),
      activeTracks: [...enabledIds].sort(),
      trackDirectives: Object.fromEntries(
        Object.entries(section.trackDirectives ?? {}).filter(([key]) => {
          const resolved = tracks.find((track) => track.id === key || track.name === key);
          return resolved ? enabledIds.has(resolved.id) : false;
        }),
      ),
    };
  });

  return {
    ...legacyPlan,
    sections,
    // The brain's layers replace the legacy re-derivation; a layer the brain
    // did not produce stays whatever the legacy plan had (never invented here).
    ...(brainPlan.globalPlan ? { globalPlan: brainPlan.globalPlan } : {}),
    ...(brainPlan.sectionPlan ? { sectionPlan: brainPlan.sectionPlan } : {}),
    ...(brainPlan.orchestrationBudget ? { orchestrationBudget: brainPlan.orchestrationBudget } : {}),
    ...(brainPlan.transitionPlan ? { transitionPlan: brainPlan.transitionPlan } : {}),
    ...(brainPlan.partComposerPlan ? { partComposerPlan: brainPlan.partComposerPlan } : {}),
    ...(brainPlan.candidateGenerationPlan ? { candidateGenerationPlan: brainPlan.candidateGenerationPlan } : {}),
    parameters: {
      ...legacyPlan.parameters,
      planSource: BRAIN_PLAN_SOURCE,
      brainPlanId: brainPlan.id,
    },
    provenance: {
      ...legacyPlan.provenance,
      parameters: {
        ...legacyPlan.provenance.parameters,
        planSource: BRAIN_PLAN_SOURCE,
        brainPlanId: brainPlan.id,
        legacyPlannerRole: "skeleton only (style, hierarchy, directives); planning layers and sections are the brain's",
      },
    },
  };
}
