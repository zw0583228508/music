/**
 * Production brief compiler (Wave U, PR-U1) — layer 3.
 *
 * Turns a UserIntent + StyleProfile (+ the song's sections, clarification
 * answers, carried-over decisions and extra deltas) into the one document the
 * planners read: which style dimensions this song adopts / modifies / rejects,
 * what each section is meant to do, how vocal space is treated, the
 * instrumentation hierarchy, the production aesthetic, and a durable list of
 * scoped producer decisions that later turns add to or supersede.
 *
 * Deterministic and digest-tracked: `derivedAt` is metadata and excluded from
 * `inputsDigestSha256` (mirrors `songMusicalMap.ts`).
 */
import { createHash } from "node:crypto";
import type {
  ArrangementSectionFunction,
  BriefDelta,
  BriefDimensionDecision,
  BriefInstrumentationEntry,
  BriefSectionIntention,
  ClarificationAnswer,
  IntelligenceProvenance,
  IntentConstraint,
  IntentInference,
  IntentSectionRef,
  IntentSectionRequest,
  ProducerBriefDecision,
  ProducerDecisionScope,
  ProducerDecisionTopic,
  ProductionBrief,
  SongModelData,
  StyleDimension,
  StyleDimensionName,
  StyleDimensionValue,
  StyleProfile,
  UserIntent,
  VocalSpacePolicy,
} from "@workspace/db";
import { classifySectionFunction } from "../globalArrangementPlanner";
import { applyClarificationAnswers, planClarifications, type ClarificationOptions } from "./clarification";
import { instrumentFamily, lookupWord } from "./vocabulary";

export const PRODUCTION_BRIEF_VERSION = "1.0" as const;
const METHOD = "brief-compiler/v1";

export type SectionLike = { name: string; startBar: number; endBar: number };

export type CompileBriefOptions = {
  now?: Date;
  /** Durable decisions carried from earlier turns; newer ones supersede them. */
  decisions?: ProducerBriefDecision[];
  /** Extra deltas: a chosen concept, an accepted edit plan, a standing rule. */
  deltas?: BriefDelta[];
  /**
   * Source ref per extra delta, same index (default `delta:<i>`). PR-U6 passes
   * `producer_memory:<ruleId>` so a decision a standing rule produced names it.
   */
  deltaSourceRefs?: Array<string | undefined>;
  briefId?: string;
  clarification?: ClarificationOptions;
};

const clamp = (v: number, lo: number, hi: number): number => (v < lo ? lo : v > hi ? hi : v);
const round3 = (v: number): number => Math.round(v * 1000) / 1000;
const sha256 = (value: unknown): string =>
  createHash("sha256").update(JSON.stringify(value)).digest("hex");

/** Resolve "second chorus" / "last chorus" / "the chorus" against real sections. */
export function resolveSectionRef(ref: IntentSectionRef, sections: SectionLike[]): string[] {
  if (ref.sectionName && sections.some((s) => s.name === ref.sectionName)) return [ref.sectionName];
  if (ref.function === "unknown") return [];
  const ordered = [...sections].sort((a, b) => a.startBar - b.startBar);
  const matching = ordered.filter((s) => (classifySectionFunction(s.name) as string) === ref.function);
  if (!matching.length) return [];
  if (ref.ordinal === "all") return matching.map((s) => s.name);
  if (ref.ordinal === "last") return [matching[matching.length - 1].name];
  const pick = matching[ref.ordinal - 1];
  return pick ? [pick.name] : [];
}

const scopeKey = (scope: ProducerDecisionScope): string => JSON.stringify(scope);

/** The key on which a newer decision supersedes an older one. */
function supersedeKey(d: Pick<ProducerBriefDecision, "scope" | "topic" | "dimension" | "value" | "statement">): string {
  const discriminator =
    d.topic === "instrumentation" ? String(d.value ?? d.statement)
      : d.topic === "style_dimension" ? String(d.dimension ?? d.statement)
        : d.topic === "reference" || d.topic === "other" ? d.statement
          : "";
  return `${scopeKey(d.scope)}|${d.topic}|${discriminator}`;
}

/** Decisions not superseded by a later one. */
export function activeDecisions(brief: Pick<ProductionBrief, "producerDecisions">): ProducerBriefDecision[] {
  const superseded = new Set(brief.producerDecisions.flatMap((d) => d.supersedes));
  return brief.producerDecisions.filter((d) => !superseded.has(d.id));
}

/** Mark which of `all` (in order) supersede earlier decisions on the same key. */
export function markSupersedes(all: ProducerBriefDecision[]): ProducerBriefDecision[] {
  const ordered = [...all].sort((a, b) => a.createdAt.localeCompare(b.createdAt) || all.indexOf(a) - all.indexOf(b));
  const latestByKey = new Map<string, ProducerBriefDecision>();
  const out: ProducerBriefDecision[] = [];
  for (const d of ordered) {
    const key = supersedeKey(d);
    const previous = latestByKey.get(key);
    const next: ProducerBriefDecision = {
      ...d,
      supersedes: previous && previous.id !== d.id ? [...new Set([...d.supersedes, previous.id])] : d.supersedes,
    };
    latestByKey.set(key, next);
    out.push(next);
  }
  return out;
}

// ---------------------------------------------------------------------------
// Compiler state
// ---------------------------------------------------------------------------

type State = {
  now: string;
  sections: SectionLike[];
  dimensions: Map<StyleDimensionName, BriefDimensionDecision>;
  sectionIntentions: Map<string, BriefSectionIntention>;
  decisions: ProducerBriefDecision[];
  excludedFamilies: Set<string>;
  hierarchy: Map<string, BriefInstrumentationEntry>;
  descriptors: StyleDimension<string>[];
  vocal: VocalSpacePolicy;
  unresolved: IntentSectionRequest[];
};

function addDecision(
  state: State,
  partial: Omit<ProducerBriefDecision, "id" | "createdAt" | "supersedes">,
): ProducerBriefDecision {
  const id = `dec-${sha256({
    scope: partial.scope, topic: partial.topic, dimension: partial.dimension ?? null,
    value: partial.value ?? null, statement: partial.statement, createdBy: partial.createdBy,
  }).slice(0, 12)}`;
  const existing = state.decisions.find((d) => d.id === id);
  if (existing) return existing;
  const decision: ProducerBriefDecision = { id, ...partial, supersedes: [], createdAt: state.now };
  state.decisions.push(decision);
  return decision;
}

function sectionIntention(state: State, sectionName: string): BriefSectionIntention {
  let intention = state.sectionIntentions.get(sectionName);
  if (!intention) {
    intention = {
      sectionName,
      function: classifySectionFunction(sectionName) as ArrangementSectionFunction,
      character: [],
      decisionIds: [],
    };
    state.sectionIntentions.set(sectionName, intention);
  }
  return intention;
}

function nudge(
  intention: BriefSectionIntention,
  field: "energyBias" | "densityBias",
  delta: number,
  provenance: IntelligenceProvenance,
  confidence: number,
  sourceRef: string,
): void {
  const current = intention[field];
  const value = round3(clamp((current?.value ?? 0) + delta, -1, 1));
  intention[field] = {
    value,
    confidence: round3(Math.max(current?.confidence ?? 0, confidence)),
    provenance: current && current.provenance === "stated" ? "stated" : provenance,
    sourceRefs: [...new Set([...(current?.sourceRefs ?? []), sourceRef])],
  };
}

function instrumentationOf(intention: BriefSectionIntention): NonNullable<BriefSectionIntention["instrumentation"]> {
  intention.instrumentation ??= { add: [], remove: [], feature: [] };
  return intention.instrumentation;
}

const pushUnique = (list: string[], value: string): void => {
  if (!list.includes(value)) list.push(value);
};

function tierFor(family: string, named: boolean, index: number): BriefInstrumentationEntry["tier"] {
  if (family === "drums" || family === "bass" || family === "percussion") return "foundation";
  if (named) return "feature";
  if (index <= 1) return "foundation";
  if (index <= 3) return "core";
  return "colour";
}

function setHierarchy(state: State, entry: BriefInstrumentationEntry): void {
  const existing = state.hierarchy.get(entry.family);
  if (existing && existing.confidence >= entry.confidence && existing.tier === entry.tier) return;
  state.hierarchy.set(entry.family, entry);
}

function setDimension(
  state: State,
  dimension: StyleDimensionName,
  value: StyleDimensionValue,
  decidedBy: BriefDimensionDecision["decidedBy"],
  provenance: IntelligenceProvenance,
  confidence: number,
  rationale: string,
): void {
  const existing = state.dimensions.get(dimension);
  if (existing) {
    state.dimensions.set(dimension, {
      ...existing,
      disposition: JSON.stringify(existing.styleValue) === JSON.stringify(value) ? "adopt" : "modify",
      briefValue: value,
      rationale,
      decidedBy,
      provenance,
      confidence: round3(confidence),
    });
  } else {
    state.dimensions.set(dimension, {
      dimension, disposition: "adopt", styleValue: value, rationale, decidedBy, provenance,
      confidence: round3(confidence),
    });
  }
}

/** The value the brief actually uses for a dimension (after modify/reject). */
export function briefDimensionValue(
  brief: Pick<ProductionBrief, "dimensionDecisions">,
  dimension: StyleDimensionName,
): StyleDimensionValue | undefined {
  const decision = brief.dimensionDecisions.find((d) => d.dimension === dimension);
  if (!decision || decision.disposition === "reject") return undefined;
  return decision.disposition === "modify" ? decision.briefValue : decision.styleValue;
}

// ---------------------------------------------------------------------------
// Constraint and inference application
// ---------------------------------------------------------------------------

function decisionScopes(
  state: State,
  scope: IntentInference["scope"],
  request?: IntentSectionRequest,
): ProducerDecisionScope[] {
  if (scope.kind === "global") return [{ kind: "global" }];
  if (scope.kind === "track") return [{ kind: "track", instrument: instrumentFamily(scope.instrument) }];
  if (scope.kind === "phrase") return [{ kind: "phrase", phraseId: scope.phraseId }];
  const names = resolveSectionRef(scope.section, state.sections);
  if (!names.length) {
    if (request && !state.unresolved.some((u) => u.id === request.id)) state.unresolved.push(request);
    return [];
  }
  return names.map((sectionName) => ({ kind: "section", sectionName }));
}

function applyConstraint(state: State, constraint: IntentConstraint, request?: IntentSectionRequest): void {
  const scopes = decisionScopes(state, constraint.scope, request);
  const entry = lookupWord(constraint.subject);
  const sourceRef = `text:${constraint.statement}`;
  const hard = constraint.kind !== "limit" || true; // a stated boundary is always a hard one
  for (const scope of scopes) {
    const section = scope.kind === "section" ? sectionIntention(state, scope.sectionName) : null;
    let topic: ProducerDecisionTopic = "other";
    let dimension: StyleDimensionName | undefined;
    let value: StyleDimensionValue | undefined;

    if (entry?.slot === "instrument") {
      const family = instrumentFamily(entry.value);
      topic = "instrumentation";
      value = family;
      if (constraint.kind === "avoid") {
        if (scope.kind === "global") state.excludedFamilies.add(family);
        if (section) pushUnique(instrumentationOf(section).remove, family);
      } else if (constraint.kind === "require") {
        if (scope.kind === "global") {
          setHierarchy(state, { family, tier: tierFor(family, true, 99), rationale: `requested: "${constraint.statement}"`, provenance: "stated", confidence: constraint.confidence });
        }
        if (section) pushUnique(instrumentationOf(section).add, family);
      } else if (constraint.kind === "limit" && section) {
        nudge(section, "densityBias", -0.2, "stated", constraint.confidence, sourceRef);
      }
    } else if (entry?.slot === "density") {
      topic = "density";
      value = entry.value;
      const direction = entry.value === "dense" ? -1 : 1; // "too busy" → thinner; "too sparse" → fuller
      const sign = constraint.kind === "limit" || constraint.kind === "avoid" ? direction : -direction;
      if (section) nudge(section, "densityBias", 0.35 * sign, "stated", constraint.confidence, sourceRef);
      if (scope.kind === "global" && sign < 0) {
        state.vocal = { ...state.vocal, underLead: "tight", provenance: "stated", confidence: constraint.confidence, rationale: `"${constraint.statement}": thin under the lead` };
      }
    } else if (entry?.slot === "energy") {
      topic = "energy";
      value = entry.value;
      const direction = entry.value === "high" ? -1 : 1;
      const sign = constraint.kind === "limit" || constraint.kind === "avoid" ? direction : -direction;
      if (section) nudge(section, "energyBias", 0.3 * sign, "stated", constraint.confidence, sourceRef);
    } else if (entry && (entry.slot === "genre_word" || entry.slot === "tradition" || entry.slot === "era" || entry.slot === "scene" || entry.slot === "ensemble_size" || entry.slot === "production_feel")) {
      topic = "style_dimension";
      const dimensionOf: Partial<Record<IntentInference["slot"], StyleDimensionName>> = {
        genre_word: "genre", tradition: "tradition", era: "era", scene: "scene",
        ensemble_size: "ensembleType", production_feel: "soundAesthetic",
      };
      dimension = dimensionOf[entry.slot];
      value = entry.value;
      if ((constraint.kind === "avoid" || constraint.kind === "limit") && dimension) {
        const existing = state.dimensions.get(dimension);
        if (existing && JSON.stringify(briefValueOf(existing)) === JSON.stringify(entry.value)) {
          state.dimensions.set(dimension, { ...existing, disposition: "reject", rationale: `ruled out: "${constraint.statement}"`, decidedBy: "constraint", provenance: "stated", confidence: constraint.confidence });
        }
      }
    } else if (entry?.slot === "mood") {
      topic = "aesthetic";
      value = entry.value;
    } else if (constraint.subject === "climax") {
      topic = "climax";
      if (section && constraint.kind === "require") {
        section.climax = { value: "primary", confidence: constraint.confidence, provenance: "stated", sourceRefs: [sourceRef] };
        nudge(section, "energyBias", 0.25, "stated", constraint.confidence, sourceRef);
      }
    } else if (constraint.subject === "everything" && constraint.kind === "limit") {
      topic = "density";
      if (section) nudge(section, "densityBias", -0.3, "stated", constraint.confidence, sourceRef);
    }

    const verb = constraint.kind === "avoid" ? "no" : constraint.kind === "limit" ? "less" : constraint.kind === "keep" ? "keep" : "needs";
    const decision = addDecision(state, {
      scope, topic, statement: `${verb} ${constraint.subject} — "${constraint.statement}"`,
      ...(dimension ? { dimension } : {}), ...(value !== undefined ? { value } : {}),
      strength: hard ? "hard" : "soft", provenance: constraint.provenance,
      confidence: constraint.confidence, sourceRefs: [sourceRef], createdBy: "intake",
    });
    if (section) pushUnique(section.decisionIds, decision.id);
  }
}

const briefValueOf = (d: BriefDimensionDecision): StyleDimensionValue =>
  d.disposition === "modify" && d.briefValue !== undefined ? d.briefValue : d.styleValue;

const BIG_WORDS = new Set(["cinematic", "epic", "orchestral"]);

function applyInference(state: State, inference: IntentInference, request?: IntentSectionRequest): void {
  const scopes = decisionScopes(state, inference.scope, request);
  const sourceRefs = inference.evidence.map((e) => `text:${e}`);
  for (const scope of scopes) {
    const section = scope.kind === "section" ? sectionIntention(state, scope.sectionName) : null;
    if (scope.kind === "global") {
      switch (inference.slot) {
        case "energy":
          addDecision(state, { scope, topic: "energy", statement: `${inference.value} energy overall`, value: inference.value, strength: "soft", provenance: inference.provenance, confidence: inference.confidence, sourceRefs, createdBy: "intake" });
          break;
        case "density":
          addDecision(state, { scope, topic: "density", statement: `${inference.value} texture overall`, value: inference.value, strength: "soft", provenance: inference.provenance, confidence: inference.confidence, sourceRefs, createdBy: "intake" });
          if (inference.value === "dense") state.vocal = { ...state.vocal, gapFill: "active", provenance: inference.provenance, confidence: inference.confidence, rationale: "a full texture was asked for: fill the gaps between phrases" };
          if (inference.value === "sparse") state.vocal = { ...state.vocal, underLead: "tight", provenance: inference.provenance, confidence: inference.confidence, rationale: "a sparse texture was asked for: thin under the lead" };
          break;
        case "production_feel":
          if (!state.descriptors.some((d) => d.value === inference.value)) {
            state.descriptors.push({ value: inference.value, confidence: inference.confidence, provenance: inference.provenance, sourceRefs });
          }
          break;
        case "instrument": {
          const family = instrumentFamily(inference.value);
          setHierarchy(state, { family, tier: tierFor(family, true, 99), rationale: `named: "${inference.evidence.join('", "')}"`, provenance: inference.provenance, confidence: inference.confidence });
          addDecision(state, { scope, topic: "instrumentation", statement: `feature ${family} (${inference.value})`, value: family, strength: "soft", provenance: inference.provenance, confidence: inference.confidence, sourceRefs, createdBy: "intake" });
          break;
        }
        case "mood":
          addDecision(state, { scope, topic: "aesthetic", statement: `mood: ${inference.value}`, value: inference.value, strength: "soft", provenance: inference.provenance, confidence: inference.confidence, sourceRefs, createdBy: "intake" });
          break;
        case "vocal_treatment":
          addDecision(state, { scope, topic: "vocal_space", statement: `vocal treatment: ${inference.value}`, value: inference.value, strength: "soft", provenance: inference.provenance, confidence: inference.confidence, sourceRefs, createdBy: "intake" });
          break;
        default:
          break; // identity words live in the style profile
      }
      continue;
    }
    if (section) {
      let decision: ProducerBriefDecision | null = null;
      switch (inference.slot) {
        case "production_feel":
        case "mood":
          if (!section.character.some((c) => c.value === inference.value)) {
            section.character.push({ value: inference.value, confidence: inference.confidence, provenance: inference.provenance, sourceRefs });
          }
          if (BIG_WORDS.has(inference.value)) nudge(section, "energyBias", 0.15, "inferred", inference.confidence * 0.8, sourceRefs[0] ?? "");
          decision = addDecision(state, { scope, topic: "aesthetic", statement: `${section.sectionName}: ${inference.value}`, value: inference.value, strength: "soft", provenance: inference.provenance, confidence: inference.confidence, sourceRefs, createdBy: "intake" });
          break;
        case "energy":
          nudge(section, "energyBias", inference.value === "high" ? 0.3 : -0.3, inference.provenance, inference.confidence, sourceRefs[0] ?? "");
          decision = addDecision(state, { scope, topic: "energy", statement: `${section.sectionName}: ${inference.value} energy`, value: inference.value, strength: "soft", provenance: inference.provenance, confidence: inference.confidence, sourceRefs, createdBy: "intake" });
          break;
        case "density":
          nudge(section, "densityBias", inference.value === "dense" ? 0.3 : -0.3, inference.provenance, inference.confidence, sourceRefs[0] ?? "");
          decision = addDecision(state, { scope, topic: "density", statement: `${section.sectionName}: ${inference.value} texture`, value: inference.value, strength: "soft", provenance: inference.provenance, confidence: inference.confidence, sourceRefs, createdBy: "intake" });
          break;
        case "instrument": {
          const family = instrumentFamily(inference.value);
          pushUnique(instrumentationOf(section).feature, family);
          pushUnique(instrumentationOf(section).add, family);
          decision = addDecision(state, { scope, topic: "instrumentation", statement: `${section.sectionName}: feature ${family}`, value: family, strength: "soft", provenance: inference.provenance, confidence: inference.confidence, sourceRefs, createdBy: "intake" });
          break;
        }
        default:
          decision = addDecision(state, { scope, topic: "other", statement: `${section.sectionName}: ${inference.slot} ${inference.value}`, value: inference.value, strength: "soft", provenance: inference.provenance, confidence: inference.confidence, sourceRefs, createdBy: "intake" });
      }
      if (decision) pushUnique(section.decisionIds, decision.id);
      continue;
    }
    if (scope.kind === "track") {
      const topic: ProducerDecisionTopic =
        inference.slot === "tradition" || inference.slot === "mood" ? "ornamentation" : "aesthetic";
      addDecision(state, { scope, topic, statement: `${scope.instrument}: ${inference.value}`, value: inference.value, strength: "soft", provenance: inference.provenance, confidence: inference.confidence, sourceRefs, createdBy: "intake" });
    }
  }
}

function applyDelta(
  state: State,
  delta: BriefDelta,
  createdBy: ProducerBriefDecision["createdBy"],
  sourceRef: string,
): void {
  const provenance: IntelligenceProvenance = "stated";
  const decidedBy: BriefDimensionDecision["decidedBy"] = createdBy === "clarification" ? "answer" : "producer";
  switch (delta.kind) {
    case "set_dimension": {
      setDimension(state, delta.dimension, delta.value, decidedBy, provenance, delta.confidence, delta.rationale);
      addDecision(state, { scope: { kind: "global" }, topic: "style_dimension", statement: `${delta.dimension} = ${JSON.stringify(delta.value)} — ${delta.rationale}`, dimension: delta.dimension, value: delta.value, strength: "hard", provenance, confidence: delta.confidence, sourceRefs: [sourceRef], createdBy });
      if (delta.dimension === "soundAesthetic" && typeof delta.value === "string" && !state.descriptors.some((d) => d.value === delta.value)) {
        state.descriptors.push({ value: delta.value, confidence: delta.confidence, provenance, sourceRefs: [sourceRef] });
      }
      break;
    }
    case "exclude_value": {
      const entry = lookupWord(delta.value);
      if (entry?.slot === "instrument") state.excludedFamilies.add(instrumentFamily(entry.value));
      if (delta.dimension) {
        const existing = state.dimensions.get(delta.dimension);
        if (existing && JSON.stringify(briefValueOf(existing)) === JSON.stringify(delta.value)) {
          state.dimensions.set(delta.dimension, { ...existing, disposition: "reject", rationale: delta.rationale, decidedBy, provenance, confidence: 0.9 });
        }
      }
      addDecision(state, { scope: { kind: "global" }, topic: entry?.slot === "instrument" ? "instrumentation" : "style_dimension", statement: `no ${delta.value} — ${delta.rationale}`, ...(delta.dimension ? { dimension: delta.dimension } : {}), value: entry?.slot === "instrument" ? instrumentFamily(entry.value) : delta.value, strength: "hard", provenance, confidence: 0.9, sourceRefs: [sourceRef], createdBy });
      break;
    }
    case "section_intention": {
      const names = resolveSectionRef(delta.section, state.sections);
      for (const name of names) {
        const section = sectionIntention(state, name);
        if (delta.energyBias !== undefined) nudge(section, "energyBias", delta.energyBias, provenance, 0.9, sourceRef);
        if (delta.densityBias !== undefined) nudge(section, "densityBias", delta.densityBias, provenance, 0.9, sourceRef);
        if (delta.climax) section.climax = { value: delta.climax, confidence: 0.9, provenance, sourceRefs: [sourceRef] };
        for (const c of delta.character ?? []) {
          if (!section.character.some((x) => x.value === c)) section.character.push({ value: c, confidence: 0.9, provenance, sourceRefs: [sourceRef] });
        }
        for (const f of delta.add ?? []) pushUnique(instrumentationOf(section).add, instrumentFamily(f));
        for (const f of delta.remove ?? []) pushUnique(instrumentationOf(section).remove, instrumentFamily(f));
        const topic: ProducerDecisionTopic = delta.climax ? "climax" : delta.densityBias !== undefined ? "density" : delta.energyBias !== undefined ? "energy" : delta.add?.length || delta.remove?.length ? "instrumentation" : "aesthetic";
        const decision = addDecision(state, { scope: { kind: "section", sectionName: name }, topic, statement: `${name}: ${delta.rationale}`, strength: "hard", provenance, confidence: 0.9, sourceRefs: [sourceRef], createdBy });
        pushUnique(section.decisionIds, decision.id);
      }
      break;
    }
    case "instrumentation": {
      for (const f of delta.add ?? []) setHierarchy(state, { family: instrumentFamily(f), tier: tierFor(instrumentFamily(f), true, 99), rationale: delta.rationale, provenance, confidence: 0.9 });
      for (const f of delta.feature ?? []) setHierarchy(state, { family: instrumentFamily(f), tier: "feature", rationale: delta.rationale, provenance, confidence: 0.9 });
      for (const f of delta.remove ?? []) state.excludedFamilies.add(instrumentFamily(f));
      addDecision(state, { scope: { kind: "global" }, topic: "instrumentation", statement: delta.rationale, value: [...(delta.add ?? []), ...(delta.feature ?? [])].map(instrumentFamily), strength: "hard", provenance, confidence: 0.9, sourceRefs: [sourceRef], createdBy });
      break;
    }
    case "vocal_space": {
      state.vocal = {
        ...state.vocal,
        ...(delta.underLead ? { underLead: delta.underLead } : {}),
        ...(delta.gapFill ? { gapFill: delta.gapFill } : {}),
        ...(delta.counterMelodyAllowed !== undefined ? { counterMelodyAllowed: delta.counterMelodyAllowed } : {}),
        provenance, confidence: 0.9, rationale: delta.rationale,
      };
      addDecision(state, { scope: { kind: "global" }, topic: "vocal_space", statement: delta.rationale, strength: "hard", provenance, confidence: 0.9, sourceRefs: [sourceRef], createdBy });
      break;
    }
    case "decision": {
      const decision = addDecision(state, { scope: delta.scope, topic: delta.topic, statement: delta.statement, ...(delta.dimension ? { dimension: delta.dimension } : {}), ...(delta.value !== undefined ? { value: delta.value } : {}), strength: delta.strength, provenance, confidence: 0.9, sourceRefs: [sourceRef], createdBy });
      if (delta.scope.kind === "section") pushUnique(sectionIntention(state, delta.scope.sectionName).decisionIds, decision.id);
      if (delta.dimension && delta.value !== undefined && delta.scope.kind === "global") {
        setDimension(state, delta.dimension, delta.value, decidedBy, provenance, 0.9, delta.rationale);
      }
      break;
    }
    default:
      break;
  }
}

// ---------------------------------------------------------------------------
// Digest and assembly
// ---------------------------------------------------------------------------

export function productionBriefInputsDigest(
  intent: UserIntent,
  profile: StyleProfile,
  songModel: SongModelData | undefined,
  answers: ClarificationAnswer[],
  options: CompileBriefOptions,
): string {
  return sha256({
    intentDigest: intent.inputsDigestSha256,
    intent: {
      inferences: intent.inferences, constraints: intent.constraints, references: intent.references,
      sectionRequests: intent.sectionRequests, unresolvedTerms: intent.unresolvedTerms,
    },
    profile: { dimensions: profile.dimensions, exclusions: profile.exclusions, conflicts: profile.conflicts },
    sections: (songModel?.sections ?? []).map((s) => [s.name, s.startBar, s.endBar]),
    vocalsStatus: songModel?.musicalMap?.vocals.status ?? null,
    answers,
    deltas: options.deltas ?? [],
    decisions: (options.decisions ?? []).map(({ createdAt: _createdAt, ...rest }) => rest),
  });
}

const PLANNER_AESTHETIC: Record<string, ProductionBrief["productionAesthetic"]["plannerAesthetic"]> = {
  cinematic: "cinematic", orchestral: "orchestral", arranged: "orchestral",
  intimate: "intimate", acoustic: "intimate", raw_intimate: "intimate", small_acoustic: "intimate",
  electronic: "electronic", raw: "raw_band", live: "raw_band", lo_fi: "raw_band", band: "raw_band",
  polished: "polished_pop", produced: "polished_pop",
};

/**
 * Compile the brief. `answers` resolve clarification questions the planner
 * would ask for this intent + profile (recomputed here, so the result depends
 * only on inputs); `options.decisions` carries earlier turns' decisions.
 */
export function compileProductionBrief(
  intent: UserIntent,
  profile: StyleProfile,
  songModel?: SongModelData,
  answers: ClarificationAnswer[] = [],
  options: CompileBriefOptions = {},
): ProductionBrief {
  const now = options.now ?? new Date();
  const sections: SectionLike[] = (songModel?.sections ?? [])
    .map((s) => ({ name: s.name, startBar: s.startBar, endBar: s.endBar }))
    .sort((a, b) => a.startBar - b.startBar);
  const vocalsKnown = songModel?.musicalMap?.vocals.status === "detected" || songModel?.musicalMap?.vocals.status === "low_confidence";
  const state: State = {
    now: now.toISOString(),
    sections,
    dimensions: new Map(),
    sectionIntentions: new Map(),
    decisions: [],
    excludedFamilies: new Set(),
    hierarchy: new Map(),
    descriptors: [],
    vocal: songModel && !vocalsKnown
      ? { underLead: "open", gapFill: "sparse", counterMelodyAllowed: true, provenance: "inferred", confidence: 0.6, rationale: "the Song Model holds no vocal evidence: nothing to protect under a lead" }
      : { underLead: "moderate", gapFill: "sparse", counterMelodyAllowed: true, provenance: "default", confidence: 0.5, rationale: "default policy: thin under the lead, answer in the gaps" },
    unresolved: [],
  };
  for (const s of sections) sectionIntention(state, s.name);

  // 1. Style profile → dimension decisions (adopt), instrumentation hierarchy.
  for (const [name, dim] of Object.entries(profile.dimensions) as Array<[StyleDimensionName, StyleDimension<StyleDimensionValue>]>) {
    state.dimensions.set(name, {
      dimension: name, disposition: "adopt", styleValue: dim.value,
      rationale: `from the style profile (${dim.provenance}${dim.sourceRefs?.length ? `: ${dim.sourceRefs.slice(0, 3).join(", ")}` : ""})`,
      decidedBy: "style_profile", provenance: dim.provenance, confidence: dim.confidence,
    });
    if (name === "instrumentationHierarchy" && Array.isArray(dim.value)) {
      dim.value.forEach((family, index) => setHierarchy(state, {
        family: String(family), tier: tierFor(String(family), dim.provenance === "stated", index),
        rationale: `style profile hierarchy (${dim.provenance})`, provenance: dim.provenance, confidence: dim.confidence,
      }));
    }
    if (name === "soundAesthetic" && typeof dim.value === "string") {
      state.descriptors.push({ value: dim.value, confidence: dim.confidence, provenance: dim.provenance, sourceRefs: dim.sourceRefs ?? [] });
    }
  }

  // 2. What the user said: constraints first (they can reject), then inferences.
  const requestFor = (id: string, kind: "inferenceIds" | "constraintIds"): IntentSectionRequest | undefined =>
    intent.sectionRequests.find((r) => r[kind].includes(id));
  for (const constraint of intent.constraints) applyConstraint(state, constraint, requestFor(constraint.id, "constraintIds"));
  for (const inference of intent.inferences) applyInference(state, inference, requestFor(inference.id, "inferenceIds"));
  for (const reference of intent.references) {
    addDecision(state, { scope: { kind: "global" }, topic: "reference", statement: `reference: ${reference.label}${reference.aspect ? ` (${reference.aspect})` : ""}`, strength: "soft", provenance: "stated", confidence: 0.8, sourceRefs: reference.evidence ? [`text:${reference.evidence}`] : [], createdBy: "intake" });
  }

  // 3. Clarification answers, then extra deltas (concept / edit).
  const questions = planClarifications(intent, profile, options.clarification);
  const applied = applyClarificationAnswers(questions, answers);
  const answeredOptions = answers
    .filter((a) => applied.answered.includes(a.questionId))
    .map((a) => `answer:${a.questionId}/${a.optionId ?? "free_text"}`);
  let optionIndex = 0;
  for (const question of questions) {
    const answer = answers.find((a) => a.questionId === question.id);
    if (!answer) continue;
    const option = answer.optionId ? question.options.find((o) => o.id === answer.optionId) : undefined;
    const ref = answeredOptions[optionIndex++] ?? `answer:${question.id}`;
    const deltas = option ? option.briefDeltas : applied.deltas.filter((d) => d.kind === "decision" && d.rationale === `free-text answer to ${question.id}`);
    for (const delta of deltas) applyDelta(state, delta, "clarification", ref);
  }
  (options.deltas ?? []).forEach((delta, i) => applyDelta(state, delta, "producer", options.deltaSourceRefs?.[i] ?? `delta:${i}`));

  // 4. Carried decisions; supersede by key, newest wins.
  for (const carried of options.decisions ?? []) {
    if (!state.decisions.some((d) => d.id === carried.id)) state.decisions.push({ ...carried });
  }
  const producerDecisions = markSupersedes(state.decisions);

  // 5. Assemble.
  for (const family of state.excludedFamilies) state.hierarchy.delete(family);
  const hierarchy = [...state.hierarchy.values()].sort((a, b) => {
    const order = { foundation: 0, core: 1, feature: 2, colour: 3 };
    return order[a.tier] - order[b.tier] || a.family.localeCompare(b.family);
  });
  const statedDescriptors = state.descriptors
    .filter((d) => d.provenance === "stated" && d.confidence >= 0.6 && PLANNER_AESTHETIC[d.value])
    .sort((a, b) => b.confidence - a.confidence);
  const plannerAesthetic = statedDescriptors.length ? PLANNER_AESTHETIC[statedDescriptors[0].value] : undefined;

  const dimensionDecisions = [...state.dimensions.values()].sort((a, b) => a.dimension.localeCompare(b.dimension));
  const scored = [...dimensionDecisions.map((d) => d.confidence), ...producerDecisions.map((d) => d.confidence)];
  const confidence = scored.length ? round3(scored.reduce((s, v) => s + v, 0) / scored.length) : 0;
  const digest = productionBriefInputsDigest(intent, profile, songModel, answers, options);

  return {
    version: PRODUCTION_BRIEF_VERSION,
    id: options.briefId ?? `brief-${digest.slice(0, 12)}`,
    derivedAt: state.now,
    inputsDigestSha256: digest,
    method: METHOD,
    intentDigestSha256: intent.inputsDigestSha256,
    styleProfileDigestSha256: profile.inputsDigestSha256,
    sectionNames: sections.map((s) => s.name),
    dimensionDecisions,
    sectionIntentions: sections.map((s) => state.sectionIntentions.get(s.name)!),
    unresolvedSectionRequests: state.unresolved,
    vocalSpace: state.vocal,
    instrumentation: { hierarchy, excludedFamilies: [...state.excludedFamilies].sort() },
    productionAesthetic: {
      descriptors: state.descriptors,
      ...(plannerAesthetic ? { plannerAesthetic } : {}),
    },
    producerDecisions,
    openQuestionIds: applied.unanswered,
    answeredQuestionIds: applied.answered,
    confidence,
  };
}

/** True when `brief` is absent or was compiled from different inputs. */
export function isProductionBriefStale(
  brief: ProductionBrief | undefined,
  intent: UserIntent,
  profile: StyleProfile,
  songModel?: SongModelData,
  answers: ClarificationAnswer[] = [],
  options: CompileBriefOptions = {},
): boolean {
  if (!brief || brief.version !== PRODUCTION_BRIEF_VERSION) return true;
  return brief.inputsDigestSha256 !== productionBriefInputsDigest(intent, profile, songModel, answers, options);
}
