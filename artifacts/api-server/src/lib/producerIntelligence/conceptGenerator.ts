/**
 * Arrangement concepts (Wave U, PR-U1).
 *
 * Before any note: three deliberately different directions for the same
 * brief, expressed as brief-dimension deltas. This is the mechanism meant to
 * fix the platform's flat candidate diversity (PR-18's `candidateDiversity`
 * ≈ 50 with no spread): the five candidate strategies vary *how much*; a
 * concept varies *what world* — room, dynamics, doublings, ensemble.
 *
 * Concepts respect the brief: a dimension the user stated is never changed by
 * a concept, and a direction the brief has ruled out (no strings, no
 * orchestral doubling) falls back to an alternative that still differs from
 * its siblings.
 */
import { createHash } from "node:crypto";
import type {
  ArrangementConcept,
  ArrangementConceptSet,
  BriefDelta,
  CandidateStrategyId,
  ProductionBrief,
  StyleDimensionName,
  StyleDimensionValue,
} from "@workspace/db";
import { briefDimensionValue } from "./briefCompiler";

export const ARRANGEMENT_CONCEPTS_VERSION = "1.0" as const;
const METHOD = "concept-generator/v1";

type Template = {
  id: string;
  name: string;
  thesis: string;
  candidateStrategy: CandidateStrategyId;
  dimensions: Array<{ dimension: StyleDimensionName; value: StyleDimensionValue }>;
  extra?: BriefDelta[];
  /** Families this direction needs; if the brief excludes all of them, fall back. */
  needsAnyFamily?: string[];
  fallback?: Template;
};

const set = (dimension: StyleDimensionName, value: StyleDimensionValue) => ({ dimension, value });

const INTIMATE: Template = {
  id: "intimate_rooted",
  name: "Intimate & rooted",
  thesis: "A small room and a lead that carries; every part earns its place, nothing doubles.",
  candidateStrategy: "sparse",
  dimensions: [
    set("ensembleType", "small_acoustic"), set("roomSize", "small"), set("dynamics", "moderate"),
    set("doublingRules", "none"), set("voicingWidth", "close"), set("fillFrequency", "rare"),
  ],
  extra: [{ kind: "decision", scope: { kind: "global" }, topic: "density", statement: "sparse texture: the lead carries", strength: "soft", value: "sparse", rationale: "concept: intimate & rooted" }],
  fallback: {
    id: "rooted_traditional",
    name: "Rooted & traditional",
    thesis: "The traditional small ensemble; restraint as the statement.",
    candidateStrategy: "conservative",
    dimensions: [set("ensembleType", "traditional_small"), set("roomSize", "medium"), set("dynamics", "moderate"), set("doublingRules", "none"), set("fillFrequency", "rare")],
  },
};

const CONTEMPORARY: Template = {
  id: "contemporary_large",
  name: "Contemporary & full",
  thesis: "A modern produced band sound: wide, driving, layered, with fills that push the sections.",
  candidateStrategy: "rhythmic",
  dimensions: [
    set("ensembleType", "band_plus_production"), set("roomSize", "medium"), set("saturation", "warm"),
    set("stereoAesthetic", "wide"), set("fillFrequency", "frequent"), set("chordRhythm", "pulsing"),
  ],
  extra: [{ kind: "decision", scope: { kind: "global" }, topic: "density", statement: "full texture: layered band", strength: "soft", value: "dense", rationale: "concept: contemporary & full" }],
  fallback: {
    id: "stripped_contemporary",
    name: "Stripped contemporary",
    thesis: "Modern and clean: a tight band with natural width and no clutter.",
    candidateStrategy: "rhythmic",
    dimensions: [set("ensembleType", "band"), set("roomSize", "medium"), set("saturation", "clean"), set("stereoAesthetic", "natural"), set("fillFrequency", "moderate")],
  },
};

const CINEMATIC: Template = {
  id: "hybrid_cinematic",
  name: "Hybrid & cinematic",
  thesis: "The rooted parts inside an orchestral frame: wide dynamics, swells into the sections, one real climax.",
  candidateStrategy: "adventurous",
  needsAnyFamily: ["strings", "brass", "winds", "pads"],
  dimensions: [
    set("ensembleType", "hybrid_orchestral"), set("roomSize", "large"), set("dynamics", "wide"),
    set("doublingRules", "orchestral"), set("voicingWidth", "wide"), set("transitionLanguage", "swells_and_builds"),
  ],
  extra: [
    { kind: "instrumentation", add: ["strings"], rationale: "concept: hybrid & cinematic" },
    { kind: "section_intention", section: { function: "chorus", ordinal: "last" }, climax: "primary", energyBias: 0.2, rationale: "concept: hybrid & cinematic — the last chorus is the climax" },
  ],
  fallback: {
    id: "textural_atmospheric",
    name: "Textural & atmospheric",
    thesis: "Space as an instrument: sustained textures, a long room, dynamics that breathe.",
    candidateStrategy: "adventurous",
    dimensions: [set("ensembleType", "textural_ensemble"), set("roomSize", "hall"), set("dynamics", "wide"), set("chordRhythm", "sustained"), set("doublingRules", "none"), set("saturation", "warm")],
    extra: [{ kind: "section_intention", section: { function: "chorus", ordinal: "last" }, climax: "primary", rationale: "concept: textural — the last chorus is the climax" }],
  },
};

const TEMPLATES: Template[] = [INTIMATE, CONTEMPORARY, CINEMATIC];

/** Dimensions the user (or an answer / producer) fixed: concepts leave them alone. */
export function protectedDimensions(brief: ProductionBrief): Set<StyleDimensionName> {
  const out = new Set<StyleDimensionName>();
  for (const d of brief.dimensionDecisions) {
    if (d.disposition === "reject") continue;
    if (d.provenance === "stated" || d.decidedBy === "answer" || d.decidedBy === "producer") out.add(d.dimension);
  }
  return out;
}

function conflicts(template: Template, brief: ProductionBrief): boolean {
  const excluded = new Set(brief.instrumentation.excludedFamilies);
  if (template.needsAnyFamily && template.needsAnyFamily.every((f) => excluded.has(f))) return true;
  for (const { dimension, value } of template.dimensions) {
    const rejected = brief.dimensionDecisions.find((d) => d.dimension === dimension && d.disposition === "reject");
    if (rejected && JSON.stringify(rejected.styleValue) === JSON.stringify(value)) return true;
  }
  return false;
}

function realise(template: Template, brief: ProductionBrief, protectedDims: Set<StyleDimensionName>): { concept: Omit<ArrangementConcept, "contrastsWith">; effective: Map<StyleDimensionName, StyleDimensionValue> } {
  const chosen = conflicts(template, brief) && template.fallback ? template.fallback : template;
  const deltas: BriefDelta[] = [];
  const effective = new Map<StyleDimensionName, StyleDimensionValue>();
  for (const { dimension, value } of chosen.dimensions) {
    if (protectedDims.has(dimension)) continue;
    if (JSON.stringify(briefDimensionValue(brief, dimension)) === JSON.stringify(value)) continue;
    deltas.push({ kind: "set_dimension", dimension, value, confidence: 0.7, rationale: `concept: ${chosen.name}` });
    effective.set(dimension, value);
  }
  for (const extra of chosen.extra ?? []) {
    if (extra.kind === "instrumentation" && extra.add?.some((f) => brief.instrumentation.excludedFamilies.includes(f))) continue;
    deltas.push(extra);
  }
  return {
    concept: {
      id: `concept-${chosen.id}`,
      name: chosen.name,
      thesis: chosen.thesis,
      deltas,
      differsIn: [...effective.keys()].sort(),
      candidateStrategy: chosen.candidateStrategy,
    },
    effective,
  };
}

export function arrangementConceptsInputsDigest(brief: ProductionBrief): string {
  return createHash("sha256")
    .update(JSON.stringify({ briefDigest: brief.inputsDigestSha256, briefId: brief.id, templates: TEMPLATES.map((t) => t.id) }))
    .digest("hex");
}

/** Exactly three concepts, each a different world, each honouring the brief. */
export function generateArrangementConcepts(
  brief: ProductionBrief,
  options: { now?: Date } = {},
): ArrangementConceptSet {
  const protectedDims = protectedDimensions(brief);
  const realised = TEMPLATES.map((t) => realise(t, brief, protectedDims));
  const concepts: ArrangementConcept[] = realised.map(({ concept, effective }, i) => ({
    ...concept,
    contrastsWith: realised
      .map((other, j) => ({ other, j }))
      .filter(({ j }) => j !== i)
      .map(({ other }) => {
        const dims = new Set<StyleDimensionName>([...effective.keys(), ...other.effective.keys()]);
        const differing = [...dims].filter((d) =>
          JSON.stringify(effective.get(d) ?? briefDimensionValue(brief, d)) !==
          JSON.stringify(other.effective.get(d) ?? briefDimensionValue(brief, d)));
        return { conceptId: other.concept.id, dimensions: differing.sort() };
      }),
  }));
  return {
    version: ARRANGEMENT_CONCEPTS_VERSION,
    derivedAt: (options.now ?? new Date()).toISOString(),
    inputsDigestSha256: arrangementConceptsInputsDigest(brief),
    method: METHOD,
    briefId: brief.id,
    briefDigestSha256: brief.inputsDigestSha256,
    concepts,
  };
}
