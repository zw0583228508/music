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
import { STYLE_FIELDS, STYLE_LEVELS, isStylePath, validateStyleValue, type StyleLevel, type StylePath } from "../styleGrammar";

export type KnowledgeValue = { value: unknown; confidence: number; why: string };

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
  const levelsKnown = STYLE_LEVELS.filter((l) => entry.levels?.[l] !== "unknown").length;
  if (levelsKnown === 0) issue("an entry with every level unknown says nothing");
  return issues;
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
