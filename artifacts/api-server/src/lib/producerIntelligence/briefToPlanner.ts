/**
 * Brief → planner hints (Wave U, PR-U1).
 *
 * The brief never writes notes and never replaces a planner. It is reduced to
 * a small set of *biases* that `deriveGlobalArrangementPlan` and
 * `deriveSectionPhrasePlan` accept through their optional `hints`: section
 * energy / density multipliers, palette additions and removals, a preferred
 * climax section, a production aesthetic the palette can carry, and a groove
 * the evidence does not contradict. Categorical hints are only emitted when
 * grounded in the user's own words; research findings never become one.
 */
import type {
  ArrangementPlan,
  GlobalArrangementPlan,
  ProducerBriefDecision,
  ProductionBrief,
  SectionPhrasePlan,
  SongModelData,
  StyleDimensionName,
} from "@workspace/db";
import { deriveGlobalArrangementPlan, type GlobalPlannerHints } from "../globalArrangementPlanner";
import { deriveSectionPhrasePlan, type SectionPlannerHints } from "../sectionPhrasePlanner";
import { activeDecisions } from "./briefCompiler";

export type BriefPlannerHints = {
  global: GlobalPlannerHints;
  section: SectionPlannerHints;
  /** One line per hint, naming the decision or dimension it came from. */
  evidence: string[];
};

const clampMul = (v: number): number => Math.max(0.6, Math.min(1.4, Math.round(v * 1000) / 1000));

const GROOVE_FROM_DIMENSION: Array<{ dimension: StyleDimensionName; value: string; groove: GlobalArrangementPlan["grooveStrategy"] }> = [
  { dimension: "grooveFamily", value: "swung", groove: "swing" },
  { dimension: "tempoBehavior", value: "rubato_tolerant", groove: "rubato" },
  { dimension: "kickSnareLanguage", value: "four_on_floor", groove: "four_on_floor" },
];

export function briefPlannerHints(brief: ProductionBrief): BriefPlannerHints {
  const evidence: string[] = [];
  const sectionEnergyBias: Record<string, number> = {};
  const sectionDensityBias: Record<string, number> = {};
  const sectionFamilies: SectionPlannerHints["sectionFamilies"] = {};
  const paletteAdd = new Set<string>();
  const paletteRemove = new Set<string>();
  let activeFamilyBias = 0;
  let climaxSectionName: string | undefined;

  const decisions = activeDecisions(brief);

  // A constraint ("not too busy", "לא עמוס מדי") is compiled as a decision
  // whose `value` is the ruled-out word and whose statement starts with the
  // compiler's boundary verb; it means the opposite direction of `value`.
  const boundary = (d: ProducerBriefDecision): boolean => /^(?:no|less) /.test(d.statement);

  // Global energy / density decisions bias every section a little.
  for (const d of decisions) {
    if (d.scope.kind !== "global") continue;
    if (d.topic === "energy" && (d.value === "high" || d.value === "low")) {
      const higher = (d.value === "high") !== boundary(d);
      const mul = higher ? 1.15 : 0.85;
      for (const name of brief.sectionNames) sectionEnergyBias[name] = clampMul((sectionEnergyBias[name] ?? 1) * mul);
      evidence.push(`${d.id}: global energy ${boundary(d) ? `not ${d.value}` : d.value} → all sections ×${mul}`);
    }
    if (d.topic === "density" && (d.value === "dense" || d.value === "sparse")) {
      const denser = (d.value === "dense") !== boundary(d);
      const mul = denser ? 1.15 : 0.8;
      for (const name of brief.sectionNames) sectionDensityBias[name] = clampMul((sectionDensityBias[name] ?? 1) * mul);
      activeFamilyBias += denser ? 0.3 : -0.35;
      evidence.push(`${d.id}: global density ${boundary(d) ? `not ${d.value}` : d.value} → all sections ×${mul}, family bias ${denser ? "+0.3" : "-0.35"}`);
    }
  }

  // Per-section intentions.
  for (const s of brief.sectionIntentions) {
    if (s.energyBias) {
      sectionEnergyBias[s.sectionName] = clampMul((sectionEnergyBias[s.sectionName] ?? 1) * (1 + 0.35 * s.energyBias.value));
      evidence.push(`${s.sectionName}: energy bias ${s.energyBias.value} (${s.energyBias.provenance}) → ×${sectionEnergyBias[s.sectionName]}`);
    }
    if (s.densityBias) {
      sectionDensityBias[s.sectionName] = clampMul((sectionDensityBias[s.sectionName] ?? 1) * (1 + 0.35 * s.densityBias.value));
      evidence.push(`${s.sectionName}: density bias ${s.densityBias.value} (${s.densityBias.provenance}) → ×${sectionDensityBias[s.sectionName]}`);
      // A thinner section keeps fewer families; a fuller one more. Only the
      // strongest per-section request moves the global family bias.
      if (s.densityBias.value <= -0.3 && sectionFamilies[s.sectionName] === undefined) sectionFamilies[s.sectionName] = {};
    }
    if (s.climax?.value === "primary") {
      climaxSectionName = s.sectionName;
      evidence.push(`${s.sectionName}: climax primary (${s.climax.provenance})`);
    }
    const instrumentation = s.instrumentation;
    if (instrumentation && (instrumentation.add.length || instrumentation.remove.length || instrumentation.feature.length)) {
      const add = [...new Set([...instrumentation.add, ...instrumentation.feature])];
      sectionFamilies[s.sectionName] = {
        ...(add.length ? { add } : {}),
        ...(instrumentation.remove.length ? { remove: instrumentation.remove } : {}),
      };
      for (const f of add) paletteAdd.add(f);
      evidence.push(`${s.sectionName}: families +[${add.join(",")}] -[${instrumentation.remove.join(",")}]`);
    }
  }
  for (const name of Object.keys(sectionFamilies)) {
    if (Object.keys(sectionFamilies[name]).length === 0) delete sectionFamilies[name];
  }

  // Palette: every family the brief names joins; excluded ones leave.
  for (const entry of brief.instrumentation.hierarchy) {
    if (entry.family === "vocals") continue;
    paletteAdd.add(entry.family);
    evidence.push(`palette +${entry.family} (${entry.tier}, ${entry.provenance})`);
  }
  for (const family of brief.instrumentation.excludedFamilies) {
    paletteRemove.add(family);
    paletteAdd.delete(family);
    evidence.push(`palette -${family} (excluded)`);
  }

  // Categorical hints: only when grounded in the user's words.
  const grounded = (refs: string[] | undefined): boolean => (refs ?? []).some((r) => r.startsWith("text:") || r.startsWith("answer:"));
  let grooveStrategy: GlobalArrangementPlan["grooveStrategy"] | undefined;
  for (const d of brief.dimensionDecisions) {
    if (d.disposition === "reject") continue;
    const value = d.disposition === "modify" ? d.briefValue : d.styleValue;
    const mapping = GROOVE_FROM_DIMENSION.find((m) => m.dimension === d.dimension && m.value === value);
    if (!mapping) continue;
    const statedEnough = d.provenance === "stated" || d.decidedBy === "answer" || d.decidedBy === "producer" ||
      (d.provenance === "inferred" && d.confidence >= 0.5 && grounded(decisions.find((x) => x.dimension === d.dimension)?.sourceRefs));
    if (!statedEnough) continue;
    grooveStrategy = mapping.groove;
    evidence.push(`${d.dimension}=${String(value)} (${d.provenance}) → groove ${mapping.groove}`);
    break;
  }
  const productionAesthetic = brief.productionAesthetic.plannerAesthetic;
  if (productionAesthetic) evidence.push(`production aesthetic ${productionAesthetic} (stated descriptor)`);

  const global: GlobalPlannerHints = {
    ...(Object.keys(sectionEnergyBias).length ? { sectionEnergyBias } : {}),
    ...(Object.keys(sectionDensityBias).length ? { sectionDensityBias } : {}),
    ...(paletteAdd.size ? { paletteAdd: [...paletteAdd].sort() } : {}),
    ...(paletteRemove.size ? { paletteRemove: [...paletteRemove].sort() } : {}),
    ...(climaxSectionName ? { climaxSectionName } : {}),
    ...(productionAesthetic ? { productionAesthetic } : {}),
    ...(grooveStrategy ? { grooveStrategy } : {}),
  };
  const section: SectionPlannerHints = {
    ...(activeFamilyBias !== 0 ? { activeFamilyBias: Math.max(-1, Math.min(1, Math.round(activeFamilyBias * 1000) / 1000)) } : {}),
    ...(Object.keys(sectionFamilies).length ? { sectionFamilies } : {}),
  };
  return { global, section, evidence };
}

/** The reference an ArrangementPlan carries to the brief it was planned from. */
export type BriefPlanRef = { productionBriefId: string; productionBriefDigestSha256: string };

export const briefPlanRef = (brief: Pick<ProductionBrief, "id" | "inputsDigestSha256">): BriefPlanRef =>
  ({ productionBriefId: brief.id, productionBriefDigestSha256: brief.inputsDigestSha256 });

/**
 * Stamp the brief on a plan (PR-U5): every plan produced for a project with a
 * current brief says which brief version it came from, whatever path built it
 * (a generation job's `materializeCandidate`, a chat regeneration, a derived plan).
 */
export function stampBriefOnPlan<T extends Pick<ArrangementPlan, "productionBriefId" | "productionBriefDigestSha256">>(
  plan: T,
  brief: Pick<ProductionBrief, "id" | "inputsDigestSha256"> | BriefPlanRef,
): T {
  const ref = "productionBriefId" in brief ? brief : briefPlanRef(brief);
  return { ...plan, productionBriefId: ref.productionBriefId, productionBriefDigestSha256: ref.productionBriefDigestSha256 };
}

/** Hints as a generation job carries them in `parameters.plannerHints` (a plain JSON object). */
export function plannerHintsForJob(brief: ProductionBrief): { global: GlobalPlannerHints; section: SectionPlannerHints } | null {
  const hints = briefPlannerHints(brief);
  return Object.keys(hints.global).length || Object.keys(hints.section).length ? { global: hints.global, section: hints.section } : null;
}

/**
 * Run the existing planners with the brief's hints. Returns the plans plus the
 * reference to stamp on the ArrangementPlan (`productionBriefId` /
 * `productionBriefDigestSha256`).
 */
export function applyBriefToPlans(
  songModel: SongModelData,
  brief: ProductionBrief,
  options: { now?: Date } = {},
): {
  globalPlan: GlobalArrangementPlan;
  sectionPlan: SectionPhrasePlan;
  hints: BriefPlannerHints;
  planRef: { productionBriefId: string; productionBriefDigestSha256: string };
} {
  const hints = briefPlannerHints(brief);
  const globalPlan = deriveGlobalArrangementPlan(songModel, { now: options.now, hints: hints.global });
  const sectionPlan = deriveSectionPhrasePlan(songModel, globalPlan, { now: options.now, hints: hints.section });
  return {
    globalPlan,
    sectionPlan,
    hints,
    planRef: briefPlanRef(brief),
  };
}
