/**
 * Brief → planner hints (Wave U, PR-U1).
 *
 * The brief never writes notes and never replaces a planner. It is reduced to
 * the levers `deriveGlobalArrangementPlan` and `deriveSectionPhrasePlan`
 * accept through their optional `hints`.
 *
 * Brain B-01: the arc levers state *intent* and are honoured as stated -
 * dynamic markings / step shifts per section and globally, texture levels /
 * steps, the climax section, the arc template ("intimate ballad"), and the
 * brief's family priority. The Wave-U multipliers (`sectionEnergyBias`,
 * `sectionDensityBias`, `activeFamilyBias`) are still emitted for the record
 * and for older readers, but they now touch the source *prior* only.
 * Palette additions and removals, a production aesthetic the palette can
 * carry and a groove the evidence does not contradict are unchanged.
 * Categorical hints are only emitted when grounded in the user's own words;
 * research findings never become one.
 */
import type {
  ArcDynamicMarking,
  ArcEndingGesture,
  ArcFamilyDynamic,
  ArcIntroFigure,
  ArcTemplateId,
  ArcTextureLevel,
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
import { deriveStyleFingerprint } from "../styleFingerprint";
import { STYLE_PATHS } from "../styleGrammar";
import { resolveStyle, type StyleResolution } from "../styleResolver";
import { activeDecisions } from "./briefCompiler";

export type BriefPlannerHints = {
  global: GlobalPlannerHints;
  section: SectionPlannerHints;
  /** One line per hint, naming the decision or dimension it came from. */
  evidence: string[];
  /**
   * Brain B-09: the style resolution the hints were derived from — the
   * knowledge entry, the grammar digest and the questions worth asking. The
   * grammar itself rides in `global.styleGrammar` for the planner's pickers.
   */
  style?: {
    inputsDigestSha256: string;
    knowledgeEntry: string | null;
    questions: StyleResolution["questions"];
  };
};

export type BriefPlannerHintOptions = {
  /** The song, so the brief's grammar can meet the song's measured behaviour (PR-27 fingerprint). */
  songModel?: SongModelData | null;
};

const clampMul = (v: number): number => Math.max(0.6, Math.min(1.4, Math.round(v * 1000) / 1000));
/** A -1..1 brief bias in marking / texture steps: +-0.3 is one step, +-0.6 two. */
const stepsOf = (bias: number): number => Math.max(-2, Math.min(2, Math.round(bias / 0.3)));
const signed = (n: number): string => (n > 0 ? `+${n}` : `${n}`);

/** The arc template a brief word implies, when the brief says nothing more specific. */
const TEMPLATE_WORDS: Array<{ pattern: RegExp; template: ArcTemplateId }> = [
  { pattern: /ballad|intimate|acoustic|singer.?songwriter|lullaby|chanson/i, template: "intimate_ballad" },
  { pattern: /cinematic|orchestral|epic|film|score|symphon/i, template: "cinematic_swell" },
  { pattern: /edm|house|techno|trance|dance|electro|dubstep|drum.?and.?bass|synthwave/i, template: "electronic_drop" },
  { pattern: /rock|punk|metal|grunge|indie|garage/i, template: "band_steady" },
  { pattern: /pop|r&b|soul|funk|gospel|reggae/i, template: "pop_build" },
];

const TEMPLATE_FOR_AESTHETIC: Record<NonNullable<ProductionBrief["productionAesthetic"]["plannerAesthetic"]>, ArcTemplateId> = {
  intimate: "intimate_ballad", cinematic: "cinematic_swell", orchestral: "cinematic_swell",
  electronic: "electronic_drop", raw_band: "band_steady", polished_pop: "pop_build",
};

/** The brief's instrumentation tiers in the order the arc should keep them when the texture thins. */
const TIER_RANK: Record<ProductionBrief["instrumentation"]["hierarchy"][number]["tier"], number> = {
  core: 0, foundation: 0, feature: 1, colour: 2,
};

const GROOVE_FROM_DIMENSION: Array<{ dimension: StyleDimensionName; value: string; groove: GlobalArrangementPlan["grooveStrategy"] }> = [
  { dimension: "grooveFamily", value: "swung", groove: "swing" },
  { dimension: "tempoBehavior", value: "rubato_tolerant", groove: "rubato" },
  { dimension: "kickSnareLanguage", value: "four_on_floor", groove: "four_on_floor" },
];

/** The brief's StyleGrammar, with the song's fingerprint when the song is at hand. */
export function resolveBriefStyle(brief: ProductionBrief, options: BriefPlannerHintOptions = {}): StyleResolution {
  let fingerprint = null;
  const model = options.songModel ?? null;
  if (model) {
    try {
      fingerprint = deriveStyleFingerprint({
        source: { kind: "song_model", id: `brief:${brief.id}`, version: null },
        songModel: model,
        tempoBpm: model.tempoMap?.[0]?.bpm,
        meter: model.meterMap?.[0]?.meter,
      });
    } catch {
      fingerprint = null; // a fingerprint that cannot be taken is a missing measurement, not a missing brief
    }
  }
  return resolveStyle({
    brief,
    fingerprint,
    song: model ? { tempoBpm: model.tempoMap?.[0]?.bpm ?? null, key: model.keyMap?.[0]?.key ?? null } : null,
  });
}

export function briefPlannerHints(brief: ProductionBrief, options: BriefPlannerHintOptions = {}): BriefPlannerHints {
  const evidence: string[] = [];
  // Brain B-09: one style contract behind the levers. The grammar's
  // arrangement section supplies the global dynamic / texture levers, the
  // template when the brief names none, and the family priority when the
  // brief names no instruments; the planner's pickers read the grammar itself.
  const styleResolution = resolveBriefStyle(brief, options);
  const grammar = styleResolution.grammar;
  const grammarSaysSomething = grammar.unknown.length < STYLE_PATHS.length && styleResolution.terms.length > 0;
  const sectionEnergyBias: Record<string, number> = {};
  const sectionDensityBias: Record<string, number> = {};
  const sectionFamilies: SectionPlannerHints["sectionFamilies"] = {};
  const paletteAdd = new Set<string>();
  const paletteRemove = new Set<string>();
  let activeFamilyBias = 0;
  let climaxSectionName: string | undefined;
  // B-01 arc levers.
  const sectionDynamics: Record<string, ArcDynamicMarking> = {};
  const sectionDynamicSteps: Record<string, number> = {};
  const textureLevels: Record<string, ArcTextureLevel> = {};
  const textureSteps: Record<string, number> = {};
  let globalDynamicSteps = 0;
  let globalTextureSteps = 0;
  let arcTemplate: ArcTemplateId | undefined;
  let arcTemplateWhy = "";

  const decisions = activeDecisions(brief);

  // A constraint ("not too busy", "לא עמוס מדי") is compiled as a decision
  // whose `value` is the ruled-out word and whose statement starts with the
  // compiler's boundary verb; it means the opposite direction of `value`.
  const boundary = (d: ProducerBriefDecision): boolean => /^(?:no|less) /.test(d.statement);

  // Global energy / density decisions: the deprecated multipliers on the prior
  // and the family bias still come from the decisions one by one; the arc
  // levers (one marking / texture step for every section) come from the
  // grammar's arrangement section, which merged those same decisions into
  // `globalDynamic` / `globalTexture` with provenance `brief`.
  for (const d of decisions) {
    if (d.scope.kind !== "global") continue;
    if (d.topic === "energy" && (d.value === "high" || d.value === "low")) {
      const higher = (d.value === "high") !== boundary(d);
      const mul = higher ? 1.15 : 0.85;
      for (const name of brief.sectionNames) sectionEnergyBias[name] = clampMul((sectionEnergyBias[name] ?? 1) * mul);
      evidence.push(`${d.id}: global energy ${boundary(d) ? `not ${d.value}` : d.value} (prior ×${mul})`);
    }
    if (d.topic === "density" && (d.value === "dense" || d.value === "sparse")) {
      const denser = (d.value === "dense") !== boundary(d);
      const mul = denser ? 1.15 : 0.8;
      for (const name of brief.sectionNames) sectionDensityBias[name] = clampMul((sectionDensityBias[name] ?? 1) * mul);
      activeFamilyBias += denser ? 0.3 : -0.35;
      evidence.push(`${d.id}: global density ${boundary(d) ? `not ${d.value}` : d.value} (prior ×${mul}, family bias ${denser ? "+0.3" : "-0.35"})`);
    }
  }
  // B-18 (R-1b P1-2): the families the brief gave a level of their own. These
  // move only their family; the section keeps its arc marking. Before B-18
  // "soft strings, gentle bass" became `globalDynamicSteps: -1` and quietened
  // every section of the song (template chorus mf -> mp, verse p -> pp).
  const familyDynamicSteps: Record<string, number> = {};
  const familyEmphasis: Record<string, ArcFamilyDynamic["emphasis"]> = {};
  for (const level of brief.familyLevels ?? []) {
    familyDynamicSteps[level.family] = Math.max(-2, Math.min(2, level.dynamicSteps));
    familyEmphasis[level.family] = level.emphasis;
    evidence.push(`${level.family}: "${level.word}" (${level.provenance} ${level.confidence}) -> ${signed(level.dynamicSteps)} marking for ${level.family} only, role ${level.emphasis} — not a global marking (R-1b P1-2)`);
  }

  const globalDynamic = grammar.arrangement.globalDynamic;
  if (globalDynamic && globalDynamic.provenance === "brief" && globalDynamic.value !== "moderate") {
    globalDynamicSteps = globalDynamic.value === "high" ? 1 : -1;
    evidence.push(`style grammar arrangement.globalDynamic=${globalDynamic.value} (brief ${globalDynamic.confidence}) → every section ${signed(globalDynamicSteps)} marking`);
  }
  const globalTexture = grammar.arrangement.globalTexture;
  if (globalTexture && globalTexture.provenance === "brief" && globalTexture.value !== "moderate") {
    globalTextureSteps = globalTexture.value === "full" ? 1 : -1;
    evidence.push(`style grammar arrangement.globalTexture=${globalTexture.value} (brief ${globalTexture.confidence}) → every section ${signed(globalTextureSteps)} texture level`);
  }

  // Per-section intentions: a -1..1 bias is a marking / texture step shift
  // on the arc (the intent), and the deprecated multiplier on the prior.
  for (const s of brief.sectionIntentions) {
    if (s.energyBias) {
      sectionEnergyBias[s.sectionName] = clampMul((sectionEnergyBias[s.sectionName] ?? 1) * (1 + 0.35 * s.energyBias.value));
      const steps = stepsOf(s.energyBias.value);
      if (steps !== 0) sectionDynamicSteps[s.sectionName] = steps;
      evidence.push(`${s.sectionName}: energy bias ${s.energyBias.value} (${s.energyBias.provenance}) → ${signed(steps)} marking (prior ×${sectionEnergyBias[s.sectionName]})`);
    }
    if (s.densityBias) {
      sectionDensityBias[s.sectionName] = clampMul((sectionDensityBias[s.sectionName] ?? 1) * (1 + 0.35 * s.densityBias.value));
      const steps = stepsOf(s.densityBias.value);
      if (steps !== 0) textureSteps[s.sectionName] = steps;
      evidence.push(`${s.sectionName}: density bias ${s.densityBias.value} (${s.densityBias.provenance}) → ${signed(steps)} texture level (prior ×${sectionDensityBias[s.sectionName]})`);
      // A thinner section keeps fewer families; a fuller one more. Only the
      // strongest per-section request moves the global family bias.
      if (s.densityBias.value <= -0.3 && sectionFamilies[s.sectionName] === undefined) sectionFamilies[s.sectionName] = {};
    }
    if (s.climax?.value === "primary") {
      climaxSectionName = s.sectionName;
      // A climax is louder than what surrounds it, whatever else was said.
      sectionDynamicSteps[s.sectionName] = Math.max(1, sectionDynamicSteps[s.sectionName] ?? 0);
      evidence.push(`${s.sectionName}: climax primary (${s.climax.provenance}) → the arc's primary climax, at least +1 marking`);
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

  // Palette: every family the brief names joins; excluded ones leave. The
  // named families, core and foundation first, are the arc's priority order
  // (a family the producer asked for is kept when the texture thins).
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
  let familyPriority = brief.instrumentation.hierarchy
    .filter((entry) => entry.family !== "vocals" && !brief.instrumentation.excludedFamilies.includes(entry.family))
    .map((entry, index) => ({ entry, index }))
    .sort((a, b) => TIER_RANK[a.entry.tier] - TIER_RANK[b.entry.tier] || a.index - b.index)
    .map(({ entry }) => entry.family)
    .filter((family, index, all) => all.indexOf(family) === index);
  if (familyPriority.length) evidence.push(`family priority ${familyPriority.join(" > ")} (brief tiers)`);
  // No instruments named: the style's own hierarchy (knowledge base or
  // research) is the priority, minus what the brief excluded.
  const grammarPriority = grammar.arrangement.familyPriority;
  if (!familyPriority.length && grammarPriority && grammarPriority.provenance !== "fingerprint") {
    familyPriority = grammarPriority.value.filter((f) => f !== "vocals" && !brief.instrumentation.excludedFamilies.includes(f));
    if (familyPriority.length) evidence.push(`family priority ${familyPriority.join(" > ")} (style grammar, ${grammarPriority.provenance} ${grammarPriority.confidence})`);
  }

  // Arc template: the aesthetic the brief states, else a genre / mood word
  // in the user's own text, else nothing (the planner reads the style).
  const plannerAesthetic = brief.productionAesthetic.plannerAesthetic;
  if (plannerAesthetic) {
    arcTemplate = TEMPLATE_FOR_AESTHETIC[plannerAesthetic];
    arcTemplateWhy = `stated aesthetic ${plannerAesthetic}`;
  }
  if (!arcTemplate) {
    const words = [
      ...brief.productionAesthetic.descriptors.map((d) => d.value),
      ...decisions.filter((d) => d.topic === "aesthetic" || d.topic === "style_dimension").map((d) => String(d.value ?? "")),
      ...brief.dimensionDecisions
        .filter((d) => d.dimension === "genre" && d.disposition !== "reject" && (d.provenance === "stated" || d.decidedBy === "answer" || d.decidedBy === "producer"))
        .map((d) => String(d.disposition === "modify" ? d.briefValue : d.styleValue)),
    ];
    for (const word of words) {
      const match = TEMPLATE_WORDS.find((t) => t.pattern.test(word));
      if (match) { arcTemplate = match.template; arcTemplateWhy = `"${word}"`; break; }
    }
  }
  // Still nothing: the style's template (the knowledge base's arc for the
  // resolved world, or a researched one) — never a measured one.
  const grammarTemplate = grammar.arrangement.arcTemplate;
  if (!arcTemplate && grammarTemplate && grammarTemplate.provenance !== "fingerprint") {
    arcTemplate = grammarTemplate.value;
    arcTemplateWhy = `style grammar, ${grammarTemplate.provenance} ${grammarTemplate.confidence}${styleResolution.knowledge.entry ? ` (${styleResolution.knowledge.entry})` : ""}`;
  }
  if (arcTemplate) evidence.push(`arc template ${arcTemplate} (${arcTemplateWhy})`);

  // B-18 (R-1b P1-7): the style's opening figure and ending, when the
  // knowledge base or the brief states one. Never measured: how a song ends is
  // an arrangement decision, not something the source's last bar can settle.
  const introValue = grammar.arrangement.introFigure;
  const introFigure: ArcIntroFigure | undefined =
    introValue && introValue.provenance !== "fingerprint" ? introValue.value : undefined;
  if (introFigure) evidence.push(`intro figure ${introFigure} (style grammar, ${introValue!.provenance} ${introValue!.confidence})`);
  const endingValue = grammar.arrangement.endingGesture;
  const endingGesture: ArcEndingGesture | undefined =
    endingValue && endingValue.provenance !== "fingerprint" ? endingValue.value : undefined;
  if (endingGesture) evidence.push(`ending ${endingGesture} (style grammar, ${endingValue!.provenance} ${endingValue!.confidence})`);

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
    // B-01 arc levers.
    ...(Object.keys(sectionDynamics).length ? { sectionDynamics } : {}),
    ...(Object.keys(sectionDynamicSteps).length ? { sectionDynamicSteps } : {}),
    ...(globalDynamicSteps ? { globalDynamicSteps: Math.max(-2, Math.min(2, globalDynamicSteps)) } : {}),
    ...(Object.keys(textureLevels).length ? { textureLevels } : {}),
    ...(Object.keys(textureSteps).length ? { textureSteps } : {}),
    ...(globalTextureSteps ? { globalTextureSteps: Math.max(-2, Math.min(2, globalTextureSteps)) } : {}),
    ...(arcTemplate ? { arcTemplate } : {}),
    ...(familyPriority.length ? { familyPriority } : {}),
    // B-18 arc levers.
    ...(Object.keys(familyDynamicSteps).length ? { familyDynamicSteps } : {}),
    ...(Object.keys(familyEmphasis).length ? { familyEmphasis } : {}),
    ...(introFigure ? { introFigure } : {}),
    ...(endingGesture ? { endingGesture } : {}),
    // B-09: the grammar itself, for the planner's style / aesthetic / groove pickers.
    ...(grammarSaysSomething ? { styleGrammar: grammar } : {}),
  };
  const section: SectionPlannerHints = {
    ...(activeFamilyBias !== 0 ? { activeFamilyBias: Math.max(-1, Math.min(1, Math.round(activeFamilyBias * 1000) / 1000)) } : {}),
    ...(Object.keys(sectionFamilies).length ? { sectionFamilies } : {}),
  };
  if (grammarSaysSomething) {
    evidence.push(`style grammar ${grammar.inputsDigestSha256.slice(0, 12)}: ${styleResolution.knowledge.entry ? `knowledge entry ${styleResolution.knowledge.entry}` : "no knowledge entry matched"}, ${STYLE_PATHS.length - grammar.unknown.length} of ${STYLE_PATHS.length} fields known, ${styleResolution.questions.length} question(s) worth asking`);
  }
  return {
    global,
    section,
    evidence,
    ...(grammarSaysSomething ? { style: { inputsDigestSha256: grammar.inputsDigestSha256, knowledgeEntry: styleResolution.knowledge.entry, questions: styleResolution.questions } } : {}),
  };
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
  const hints = briefPlannerHints(brief, { songModel });
  const globalPlan = deriveGlobalArrangementPlan(songModel, { now: options.now, hints: hints.global });
  const sectionPlan = deriveSectionPhrasePlan(songModel, globalPlan, { now: options.now, hints: hints.section });
  return {
    globalPlan,
    sectionPlan,
    hints,
    planRef: briefPlanRef(brief),
  };
}
