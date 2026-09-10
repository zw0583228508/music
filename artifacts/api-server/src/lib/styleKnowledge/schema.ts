/**
 * Style knowledge base — schema (Brain B-09).
 *
 * Genres are *data*, not code. One entry per style family the platform meets,
 * written as the ten resolution levels the resolver walks (genre → subgenre →
 * regional tradition → era → ensemble → rhythmic vocabulary → harmonic
 * vocabulary → orchestration → production aesthetic → performance practice).
 * A level nobody can fill honestly is the literal `"unknown"`; a value inside
 * a level is `{ value, confidence, why }` and is validated against the
 * contract's field registry (`STYLE_FIELDS`), so an entry cannot smuggle a
 * value the grammar has no field for, nor a value outside a field's
 * vocabulary.
 *
 * An entry may `extends` another (a chassidic ballad is a ballad first): the
 * parent's values apply, the child's override path by path. A path may carry
 * *two* values where a style is genuinely bimodal ("boom-bap or trap"); both
 * become candidates, the merge records the conflict, and the question
 * generator can ask.
 *
 * Every value here is a generalisation about a style, never a measurement of
 * the song at hand; the merge ranks it below the brief and below a clear
 * measurement. `coverage` says how far to trust the entry as a whole.
 */
import {
  GROOVE_STRATEGIES, STYLE_FIELDS, STYLE_LEVELS, isStylePath, validateStyleValue,
  type FeltPulse, type GrooveStrategy, type StyleLevel, type StylePath,
} from "../styleGrammar";

export type KnowledgeValue = { value: unknown; confidence: number; why: string };

/**
 * How a style's felt pulse relates to the tempo somebody measured
 * (Brain B-18, R-1b P1-3).
 *
 * A style value cannot answer this on its own: "ballad" says the pulse is
 * slow, but the *written* tempo of a ballad is whatever the analysis counted.
 * The owner's song was measured at 130.43 BPM; an intimate ballad at 130 is
 * felt at 65, and before B-18 the plan asked for `steady_pulse` and the kit
 * played a pop backbeat on 2 and 4 at 130 (and, with no brief at all,
 * `four_on_floor` — kick on every beat of a chassidic ballad).
 *
 * So a style states the band inside which its written tempo *is* its pulse,
 * what it means above and below that band, the strategy it builds on at its
 * own pulse, and the readings it must never be given.
 */
export type PulseConvention = {
  /** Written BPM inside which the measured tempo is the felt pulse. */
  writtenBpm: { min: number; max: number };
  /** The felt pulse when the measured tempo is above the band (fast written, slow felt). */
  above: FeltPulse;
  /** The felt pulse when the measured tempo is below the band. */
  below: FeltPulse;
  /** The groove strategy this style is arranged on at its own felt pulse. */
  strategy: GrooveStrategy;
  /** The strategy this style asks for when the felt pulse is half the written one. */
  halfTimeStrategy?: GrooveStrategy;
  /** Readings this style must never be given, whatever a tempo band measures. */
  never: GrooveStrategy[];
  confidence: number;
  why: string;
};

/** The felt pulse this convention implies for a measured tempo. */
export function feltPulseFor(pulse: PulseConvention, bpm: number | null | undefined): FeltPulse | null {
  if (bpm === null || bpm === undefined || !Number.isFinite(bpm) || bpm <= 0) return null;
  if (bpm > pulse.writtenBpm.max) return pulse.above;
  if (bpm < pulse.writtenBpm.min) return pulse.below;
  return "as_written";
}

/** The groove strategy this convention asks for at a measured tempo. */
export function pulseStrategyFor(pulse: PulseConvention, bpm: number | null | undefined): GrooveStrategy {
  const felt = feltPulseFor(pulse, bpm);
  if (felt === "half_time") return pulse.halfTimeStrategy ?? "half_time_feel";
  return pulse.strategy;
}

export type MatchSlot = "genre" | "subgenre" | "tradition" | "scene" | "ensemble" | "aesthetic" | "era" | "word";
export type MatchTerm = { slot: MatchSlot; term: string };

export type StyleKnowledgeEntry = {
  id: string;
  label: { en: string; he: string };
  /** Parent entry id: its values apply first, this entry's override. */
  extends?: string;
  match: {
    /** Every group must have at least one hit for the entry to apply. */
    requires: MatchTerm[][];
    /** Extra hits raise the score (default weight 1). */
    boosts?: Array<MatchTerm & { weight?: number }>;
  };
  levels: Record<StyleLevel, "unknown" | Partial<Record<StylePath, KnowledgeValue | KnowledgeValue[]>>>;
  /**
   * Brain B-18: how this style's felt pulse relates to a measured tempo, and
   * which groove readings it forbids. Required on every entry: a style with no
   * pulse convention is a style whose groove the tempo band decides, which is
   * the defect R-1b P1-3 measured. Inherited from `extends` when absent.
   */
  pulse?: PulseConvention;
  /** Where this knowledge comes from, in one line. */
  basis: string;
  /** `owner_world`: the owner's own tradition, reviewed by him; `general_practice`: common practice of a widely produced style; `sketch`: a thin entry that mostly says "unknown". */
  coverage: "owner_world" | "general_practice" | "sketch";
};

export const kv = (value: unknown, confidence: number, why: string): KnowledgeValue => ({ value, confidence, why });
export const t = (slot: MatchSlot, term: string): MatchTerm => ({ slot, term });

export type KnowledgeIssue = { entryId: string; path?: string; message: string };

/** Validate one entry against the contract. Empty result = valid. */
export function validateKnowledgeEntry(entry: StyleKnowledgeEntry, all: readonly StyleKnowledgeEntry[] = []): KnowledgeIssue[] {
  const issues: KnowledgeIssue[] = [];
  const issue = (message: string, path?: string): void => { issues.push({ entryId: entry.id, ...(path ? { path } : {}), message }); };
  if (!/^[a-z0-9_]+$/.test(entry.id)) issue("id must be snake_case");
  if (!entry.label?.en?.trim() || !entry.label?.he?.trim()) issue("label needs en and he");
  if (!entry.basis?.trim()) issue("basis is required");
  if (!entry.match?.requires?.length) issue("match.requires must have at least one group");
  for (const group of entry.match?.requires ?? []) {
    if (!group.length) issue("an empty requires group can never be satisfied");
  }
  if (entry.extends) {
    const parent = all.find((e) => e.id === entry.extends);
    if (!parent) issue(`extends unknown entry ${entry.extends}`);
    // No cycles.
    let cursor: StyleKnowledgeEntry | undefined = parent;
    const seen = new Set<string>([entry.id]);
    while (cursor) {
      if (seen.has(cursor.id)) { issue(`extends cycle through ${cursor.id}`); break; }
      seen.add(cursor.id);
      cursor = cursor.extends ? all.find((e) => e.id === cursor!.extends) : undefined;
    }
  }
  for (const level of STYLE_LEVELS) {
    const block = entry.levels?.[level];
    if (block === undefined) { issue(`level ${level} is missing (write "unknown" when nothing is known)`); continue; }
    if (block === "unknown") continue;
    if (!block || typeof block !== "object") { issue(`level ${level} is neither "unknown" nor a value map`); continue; }
    const entries = Object.entries(block);
    if (!entries.length) issue(`level ${level} is an empty map (write "unknown" instead)`);
    for (const [path, raw] of entries) {
      if (!isStylePath(path)) { issue("not a field of the contract", path); continue; }
      if (STYLE_FIELDS[path].level !== level) issue(`belongs to level ${STYLE_FIELDS[path].level}, not ${level}`, path);
      const values = Array.isArray(raw) ? raw : [raw];
      if (Array.isArray(raw) && raw.length < 2) issue("a list of alternatives needs at least two values", path);
      for (const v of values) {
        const invalid = validateStyleValue(path, v.value);
        if (invalid) issue(invalid, path);
        if (!(v.confidence > 0 && v.confidence <= 1)) issue(`confidence ${v.confidence} is not in (0, 1]`, path);
        if (!v.why?.trim()) issue("every value needs a why", path);
      }
    }
  }
  // B-18: the pulse convention, when this entry states one.
  const pulse = entry.pulse;
  if (pulse) {
    const { min, max } = pulse.writtenBpm ?? {};
    if (!(typeof min === "number" && typeof max === "number" && min > 0 && max >= min && max <= 320)) {
      issue("pulse.writtenBpm must be a { min, max } band in (0, 320]", "pulse");
    }
    for (const [field, value] of [["above", pulse.above], ["below", pulse.below]] as const) {
      if (!["as_written", "half_time", "double_time"].includes(String(value))) issue(`pulse.${field} is not a felt pulse`, "pulse");
    }
    for (const [field, value] of [["strategy", pulse.strategy], ["halfTimeStrategy", pulse.halfTimeStrategy]] as const) {
      if (value !== undefined && !GROOVE_STRATEGIES.includes(value)) issue(`pulse.${field} ${String(value)} is not a groove strategy`, "pulse");
    }
    if (!Array.isArray(pulse.never)) issue("pulse.never must be a list (write [] when the style forbids nothing)", "pulse");
    else for (const s of pulse.never) if (!GROOVE_STRATEGIES.includes(s)) issue(`pulse.never ${String(s)} is not a groove strategy`, "pulse");
    if (pulse.never?.includes(pulse.strategy)) issue("pulse.never forbids the style's own strategy", "pulse");
    if (!(pulse.confidence > 0 && pulse.confidence <= 1)) issue(`pulse.confidence ${pulse.confidence} is not in (0, 1]`, "pulse");
    if (!pulse.why?.trim()) issue("pulse needs a why", "pulse");
  } else if (!entry.extends) {
    issue("a root entry must state a pulse convention (B-18): without one, the tempo band decides the groove", "pulse");
  }
  const levelsKnown = STYLE_LEVELS.filter((l) => entry.levels?.[l] !== "unknown").length;
  if (levelsKnown === 0) issue("an entry with every level unknown says nothing");
  return issues;
}

/** The pulse convention of an entry, or the nearest ancestor's. */
export function pulseConventionOf(entry: StyleKnowledgeEntry, all: readonly StyleKnowledgeEntry[]): PulseConvention | null {
  const chain = knowledgeChain(entry, all);
  for (let i = chain.length - 1; i >= 0; i -= 1) if (chain[i].pulse) return chain[i].pulse!;
  return null;
}

/** The entry chain from the root ancestor down to `entry`. */
export function knowledgeChain(entry: StyleKnowledgeEntry, all: readonly StyleKnowledgeEntry[]): StyleKnowledgeEntry[] {
  const chain: StyleKnowledgeEntry[] = [entry];
  const seen = new Set<string>([entry.id]);
  let cursor = entry;
  while (cursor.extends) {
    const parent = all.find((e) => e.id === cursor.extends);
    if (!parent || seen.has(parent.id)) break;
    chain.unshift(parent);
    seen.add(parent.id);
    cursor = parent;
  }
  return chain;
}

/** Levels an entry (with its ancestors) leaves unknown. */
export function unknownLevels(entry: StyleKnowledgeEntry, all: readonly StyleKnowledgeEntry[]): StyleLevel[] {
  const chain = knowledgeChain(entry, all);
  return STYLE_LEVELS.filter((level) => chain.every((e) => e.levels[level] === "unknown"));
}
