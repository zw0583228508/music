/**
 * Producer memory across projects (Wave U, PR-U6).
 *
 * A producer says things that are true of *them*, not of one song: "never high
 * strings", "leave the last chorus for the singer", "I like a live drummer
 * feel". Until now every such statement died with its project. A memory rule
 * carries one of them forward.
 *
 * Three rules keep it honest:
 *  - **Only the producer's own statements.** A rule is promoted from a brief
 *    decision whose provenance is `stated`. What the platform *inferred* or
 *    *learned* never becomes memory — that is PR-30's personal profile, which
 *    sits at `default` provenance below everything.
 *  - **Visible wherever it acts.** At a later project's intake the rule is
 *    applied as an ordinary `stated` decision whose sourceRef is
 *    `producer_memory:<ruleId>`, so the brief, the explanation and the studio
 *    all say where it came from, and a project-level statement supersedes it
 *    exactly as it would supersede any earlier decision.
 *  - **Revocable, never retroactive.** Revoking a rule stops it applying to
 *    new briefs; the briefs it already shaped are unchanged, and their
 *    decisions stay in their own history.
 *
 * Pure: persistence lives in `producerMemoryStore.ts`.
 */
import type {
  BriefDelta,
  ProducerBriefDecision,
  ProducerMemoryRule,
} from "@workspace/db";

export const PRODUCER_MEMORY_VERSION = "1.0" as const;
export const MEMORY_SOURCE_PREFIX = "producer_memory:";

export const memorySourceRef = (ruleId: string): string => `${MEMORY_SOURCE_PREFIX}${ruleId}`;
export const isMemorySourceRef = (ref: string): boolean => ref.startsWith(MEMORY_SOURCE_PREFIX);
export const memoryRuleIdFromRef = (ref: string): string | null =>
  (isMemorySourceRef(ref) ? ref.slice(MEMORY_SOURCE_PREFIX.length) : null);

export class ProducerMemoryError extends Error {
  constructor(readonly status: 400 | 404 | 409, message: string) {
    super(message);
    this.name = "ProducerMemoryError";
  }
}

/** Topics that describe a producer, not a song: everything except a reference to one song's material. */
const PORTABLE_TOPICS = new Set<ProducerBriefDecision["topic"]>([
  "instrumentation", "energy", "density", "aesthetic", "vocal_space", "style_dimension", "other",
]);

/**
 * The change that re-creates this decision in another project's brief. A
 * decision made in chat has the delta that produced it stored alongside it; a
 * decision read out of the intake text has none, and a `decision` delta
 * carrying the same content reproduces it exactly (the compiler's own
 * round-trip, tested in `decisionsProducedBy`).
 */
export function deltaForDecision(decision: ProducerBriefDecision, stored: BriefDelta | null): BriefDelta {
  if (stored) return stored;
  return {
    kind: "decision",
    scope: decision.scope,
    topic: decision.topic,
    statement: decision.statement,
    strength: decision.strength,
    ...(decision.dimension ? { dimension: decision.dimension } : {}),
    ...(decision.value !== undefined ? { value: decision.value } : {}),
    rationale: decision.statement,
  };
}

/**
 * Why this decision cannot become a standing rule, or null when it can.
 * Kept as a message rather than a boolean: the producer deserves the reason.
 */
export function memoryRefusalReason(decision: ProducerBriefDecision, delta: BriefDelta | null): string | null {
  if (decision.provenance !== "stated") {
    return `Only what you said yourself becomes a standing rule; "${decision.statement}" is ${decision.provenance}, not stated.`;
  }
  void delta;
  if (!PORTABLE_TOPICS.has(decision.topic)) {
    return `A ${decision.topic} decision belongs to this song, not to every song.`;
  }
  if (decision.scope.kind === "track" && !decision.scope.instrument) {
    return "A track-scoped rule needs the instrument it is about.";
  }
  return null;
}

/**
 * A standing rule from a project decision. The section reference (if any)
 * travels as the delta already carries it: a later project without that
 * section surfaces it in `unresolvedSectionRequests`, never guessed.
 */
export function memoryRuleFromDecision(input: {
  id: string;
  decision: ProducerBriefDecision;
  delta: BriefDelta | null;
  projectId: string;
  briefId: string;
  now?: Date;
}): ProducerMemoryRule {
  const refusal = memoryRefusalReason(input.decision, input.delta);
  if (refusal) throw new ProducerMemoryError(409, refusal);
  const { decision } = input;
  const delta = deltaForDecision(decision, input.delta);
  return {
    id: input.id,
    statement: decision.statement,
    topic: decision.topic,
    scope: decision.scope,
    strength: decision.strength,
    ...(decision.dimension ? { dimension: decision.dimension } : {}),
    ...(decision.value !== undefined ? { value: decision.value } : {}),
    delta,
    source: { projectId: input.projectId, briefId: input.briefId, decisionId: decision.id },
    createdAt: (input.now ?? new Date()).toISOString(),
  };
}

/**
 * What a later project's compiler receives: the deltas, and the source ref for
 * each, so every decision they produce names the rule it came from. A rule
 * whose statement the project has already made is still applied — the compiler
 * supersedes by scope and topic, which is the behaviour a producer expects
 * when they repeat themselves.
 */
export function memoryCompileInputs(rules: readonly ProducerMemoryRule[]): {
  deltas: BriefDelta[];
  deltaSourceRefs: string[];
} {
  return {
    deltas: rules.map((rule) => rule.delta),
    deltaSourceRefs: rules.map((rule) => memorySourceRef(rule.id)),
  };
}

/** The decisions of a brief that came from memory, with the rule each names. */
export function memoryDecisionsIn(
  decisions: readonly ProducerBriefDecision[],
  rules: readonly ProducerMemoryRule[],
): Array<{ decision: ProducerBriefDecision; rule: ProducerMemoryRule | null; ruleId: string }> {
  const byId = new Map(rules.map((rule) => [rule.id, rule]));
  const found: Array<{ decision: ProducerBriefDecision; rule: ProducerMemoryRule | null; ruleId: string }> = [];
  for (const decision of decisions) {
    for (const ref of decision.sourceRefs) {
      const ruleId = memoryRuleIdFromRef(ref);
      if (!ruleId) continue;
      found.push({ decision, rule: byId.get(ruleId) ?? null, ruleId });
      break;
    }
  }
  return found;
}

/** One sentence for the chat: what the producer's memory did to this brief. */
export function describeMemoryApplied(applied: ReadonlyArray<{ rule: ProducerMemoryRule | null; ruleId: string }>): string | null {
  if (!applied.length) return null;
  const statements = applied.map(({ rule, ruleId }) => `"${rule?.statement ?? ruleId}"`);
  return `Your standing rule${applied.length === 1 ? "" : "s"} ${statements.join(", ")} ${applied.length === 1 ? "was" : "were"} applied to this project; revoke ${applied.length === 1 ? "it" : "them"} in producer memory, or say otherwise here and this project will follow what you say.`;
}
