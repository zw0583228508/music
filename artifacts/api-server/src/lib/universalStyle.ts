/**
 * Universal style intelligence (Wave Q, Q-02 — PR-66).
 *
 * A producer can name almost any style in the world, including one nobody
 * programmed for ("1970s Ethiopian jazz with Mizrahi strings and a trap
 * hi-hat"). This module turns such a description into the universal style
 * representation (`universalStyleSchema.ts`) and from there into the
 * `StyleGrammar` and arrangement instructions the composers already read —
 * with no genre list anywhere on the path.
 *
 * The pipeline:
 *
 *   description → parseStyleDescription   (deterministic: what the text says)
 *               → synthesiseEvidence      (pluggable reasoning providers; the
 *                                          seed provider ships, an LLM one can
 *                                          be added — neither may write notes)
 *               → clarificationQuestions  (only fields both unknown and consequential)
 *               → styleGrammarFromUniversalStyle  (the Q-02 slot, same directive shapes)
 *               → arrangementInstructions (per-role, in the planners' vocabulary)
 *
 * and, when the song has been analysed, `reconcileWithFingerprint` compares
 * what the producer said with what the song measures, and turns every
 * disagreement into a question rather than a silent override.
 *
 * Structural guarantees: a provider can only fill registry fields, each of
 * which validates its value; no field can hold a note sequence. Everything a
 * provider says arrives with a basis and a confidence, and a value the user
 * stated is never overridden by a value anyone inferred.
 */
import { createHash } from "node:crypto";
import type { InstrumentArrangementRole, RegisterBand, StyleFingerprint } from "@workspace/db";
import type { StyleGrammarSlot } from "./partGenerationContextV2";
import { MIN_RULE_WEIGHT, type GrammarDirective } from "./styleGrammar";
import {
  ERAS, GROOVES, INSTRUMENTS, MODIFIER_WORDS, PITCH_SYSTEMS, REGIONS, STOP_WORDS, STYLE_WORDS, TEMPO_WORDS,
  type GrooveClaim, type InstrumentEntry, type PitchSystemDefinition,
} from "./universalStyleLexicon";
import {
  BASIS_RANK, FIELD_REGISTRY, ROLE_NAMES, UNIVERSAL_STYLE_VERSION, emptyUniversalStyle, fieldSpec, getField, isFieldPath, listFields, setField,
  type Basis, type EnsembleMember, type FieldPath, type FieldSpec, type PitchSystemRef, type RoleMap, type RoleName, type StyleField, type UniversalStyle,
} from "./universalStyleSchema";
import { SEED_PROVIDER_ID, SEED_STYLE_KNOWLEDGE, ensembleFromIds, matchingSeedNotes, pitchSystemRef, seedField, type SeedNote } from "./universalStyleSeed";

export * from "./universalStyleSchema";
export { SEED_PROVIDER_ID, SEED_STYLE_KNOWLEDGE, validateSeed } from "./universalStyleSeed";

export const UNIVERSAL_STYLE_PARSER = "universal-style-parser/v1 (deterministic lexicon + regex; no model)";
export const UNIVERSAL_STYLE_GRAMMAR_VERSION = "UNIVERSAL_STYLE_GRAMMAR_V1" as const;
export const ARRANGEMENT_INSTRUCTIONS_VERSION = "UNIVERSAL_STYLE_INSTRUCTIONS_V1" as const;

const round = (value: number, digits = 3): number => Number(value.toFixed(digits));
const clamp01 = (value: number): number => Math.max(0, Math.min(1, value));
const sha256 = (value: unknown): string => createHash("sha256").update(JSON.stringify(value)).digest("hex");
const HEBREW = /[֐-׿]/;

// ---------------------------------------------------------------------------
// Claims and merging — one rule for every source
// ---------------------------------------------------------------------------

export type StyleClaim = {
  path: FieldPath;
  value: unknown;
  confidence: number;
  basis: Exclude<Basis, "unknown">;
  sources: string[];
  note: string | null;
  hypothesis?: boolean;
};

export type MergeOutcome = "set" | "corroborated" | "merged" | "kept" | "contested" | "rejected";

const deepEqual = (a: unknown, b: unknown): boolean => JSON.stringify(a) === JSON.stringify(b);

/** Numbers within a tolerance count as the same value, so 0.62 and 0.6 do not fight. */
function sameValue(a: unknown, b: unknown, path: FieldPath): boolean {
  if (typeof a === "number" && typeof b === "number") {
    const tolerance = path === "groove.swingRatio" ? 0.03 : path === "groove.microtimingMs" ? 6 : path === "harmony.chordsPerBar" ? 0.3 : path === "phrase.lengthBars" ? 0.5 : path === "melody.rangeSemitones" ? 4 : 0.12;
    return Math.abs(a - b) <= tolerance;
  }
  if (path === "tempo.bpm" && a && b) {
    const x = a as { min: number; max: number }; const y = b as { min: number; max: number };
    return x.min <= y.max && y.min <= x.max;
  }
  if (path === "identity.era" && a && b) {
    const x = a as { from: number; to: number }; const y = b as { from: number; to: number };
    return x.from <= y.to && y.from <= x.to;
  }
  if (path === "harmony.pitchSystem" && a && b) return (a as PitchSystemRef).id === (b as PitchSystemRef).id;
  return deepEqual(a, b);
}

/** Two independent sources agreeing: p(at least one is right). */
const corroborate = (a: number, b: number): number => round(Math.min(1, a + b * (1 - a)));

function mergeLists(current: unknown[], incoming: unknown[], path: FieldPath): unknown[] {
  if (path === "ensemble") {
    const out = [...(current as EnsembleMember[])];
    for (const member of incoming as EnsembleMember[]) {
      const existing = out.find((m) => m.instrument === member.instrument);
      if (existing) {
        for (const tag of member.styleTags) if (!existing.styleTags.includes(tag)) existing.styleTags.push(tag);
      } else out.push(member);
    }
    return out;
  }
  const out = [...current];
  for (const item of incoming) if (!out.some((x) => deepEqual(x, item))) out.push(item);
  return out;
}

/**
 * Merge one claim into a style. The rules, in order: a value the field's
 * validator rejects is rejected; an unknown field takes the claim; list
 * fields take the union; the same value from another source corroborates;
 * a different value goes to whichever has the stronger basis, then the
 * higher confidence, and the loser is recorded as `contested` so the
 * disagreement is visible and can become a question.
 */
export function mergeClaim(style: UniversalStyle, claim: StyleClaim): MergeOutcome {
  const spec = fieldSpec(claim.path);
  if (!spec) return "rejected";
  const value = spec.validate(claim.value);
  if (value === null || value === undefined) return "rejected";
  const current = getField(style, claim.path);
  const incoming: StyleField<unknown> = {
    value, confidence: round(clamp01(claim.confidence)), basis: claim.basis, sources: [...claim.sources], note: claim.note,
    hypothesis: Boolean(claim.hypothesis), contested: null,
  };

  if (current.basis === "unknown") {
    setField(style, claim.path, incoming);
    return "set";
  }

  const stronger = (a: StyleField<unknown>, b: StyleField<unknown>): boolean =>
    BASIS_RANK[a.basis] > BASIS_RANK[b.basis] || (BASIS_RANK[a.basis] === BASIS_RANK[b.basis] && a.confidence >= b.confidence);

  if (spec.mergeAsList || claim.path === "ensemble") {
    const merged = mergeLists(current.value as unknown[], value as unknown[], claim.path);
    setField(style, claim.path, {
      ...current,
      value: merged,
      confidence: Math.max(current.confidence, incoming.confidence),
      basis: BASIS_RANK[incoming.basis] > BASIS_RANK[current.basis] ? incoming.basis : current.basis,
      sources: [...new Set([...current.sources, ...incoming.sources])],
      note: current.note ?? incoming.note,
      hypothesis: current.hypothesis && incoming.hypothesis,
    });
    return "merged";
  }
  if (claim.path === "roles") {
    const merged: RoleMap = { ...(current.value as RoleMap) };
    for (const role of ROLE_NAMES) {
      const list = (value as RoleMap)[role];
      if (!list) continue;
      if (!merged[role] || BASIS_RANK[incoming.basis] > BASIS_RANK[current.basis]) merged[role] = list;
    }
    setField(style, claim.path, { ...current, value: merged, sources: [...new Set([...current.sources, ...incoming.sources])] });
    return "merged";
  }

  if (sameValue(current.value, value, claim.path)) {
    const winner = stronger(current, incoming) ? current : incoming;
    setField(style, claim.path, {
      ...winner,
      confidence: corroborate(current.confidence, incoming.confidence),
      sources: [...new Set([...current.sources, ...incoming.sources])],
      note: winner.note ?? (winner === current ? incoming.note : current.note),
      hypothesis: current.hypothesis && incoming.hypothesis,
      contested: current.contested,
    });
    return "corroborated";
  }

  // A real disagreement.
  const currentWins = stronger(current, incoming);
  const winner = currentWins ? current : incoming;
  const loser = currentWins ? incoming : current;
  const closeCall = BASIS_RANK[winner.basis] === BASIS_RANK[loser.basis] && Math.abs(winner.confidence - loser.confidence) < 0.15;
  setField(style, claim.path, {
    ...winner,
    // Two sources of equal standing disagreeing is not knowledge; say so.
    hypothesis: winner.hypothesis || closeCall,
    contested: [...(current.contested ?? []), { value: loser.value, confidence: loser.confidence, sources: loser.sources }],
  });
  return currentWins ? "kept" : "contested";
}

// ---------------------------------------------------------------------------
// Parsing — what the text itself says
// ---------------------------------------------------------------------------

export type CueKind = "instrument" | "region" | "era" | "groove" | "style_word" | "pitch_system" | "tempo" | "tempo_word" | "meter" | "modifier" | "role" | "unrecognised";

export type ParsedCue = {
  kind: CueKind;
  /** Lexicon id, or the word itself when unrecognised. */
  id: string;
  /** The user's words, verbatim. */
  span: string;
  /** Token range [start, end). */
  start: number;
  end: number;
};

export type ParseResult = {
  style: UniversalStyle;
  cues: ParsedCue[];
  language: UniversalStyle["language"];
  /** Fields the parser filled, by path, with the basis it used. */
  filled: Array<{ path: FieldPath; basis: Basis; outcome: MergeOutcome }>;
};

type Token = { text: string; original: string; start: number };

function normaliseForTokens(text: string): string {
  return text
    .toLowerCase()
    .replace(/&/g, " and ")
    .replace(/[‐-―−]/g, "-")
    .replace(/(\d)\s*\/\s*(\d)/g, "$1/$2")
    .replace(/[“”"()\[\]{}.,;:!?«»]/g, " ")
    .replace(/(^|\s)-|-(\s|$)/g, " ")
    .replace(/(\D)-(\D)/g, "$1 $2")
    .replace(/[’‘]/g, "'");
}

function tokenise(text: string): Token[] {
  const normalised = normaliseForTokens(text);
  const tokens: Token[] = [];
  const re = /\S+/g;
  let match: RegExpExecArray | null;
  while ((match = re.exec(normalised))) tokens.push({ text: match[0], original: match[0], start: match.index });
  return tokens;
}

const HE_PREFIX = /^[והבלמשכ]{1,2}/;

/** A token matches a term token exactly, as an English plural, or behind a Hebrew clitic. */
function tokenMatches(token: string, term: string): boolean {
  if (token === term) return true;
  if (!HEBREW.test(term) && (token === `${term}s` || token === `${term}es` || (term.endsWith("y") && token === `${term.slice(0, -1)}ies`))) return true;
  if (HEBREW.test(token) && HE_PREFIX.test(token)) {
    for (let n = 1; n <= 2 && n < token.length - 1; n += 1) if (token.slice(n) === term) return true;
  }
  return false;
}

type LexEntry = { kind: CueKind; id: string; tokens: string[] };

function buildLexicon(): LexEntry[] {
  const out: LexEntry[] = [];
  const add = (kind: CueKind, id: string, terms: string[]): void => {
    for (const term of terms) {
      const tokens = normaliseForTokens(term).split(/\s+/).filter(Boolean);
      if (tokens.length) out.push({ kind, id, tokens });
    }
  };
  for (const g of GROOVES) add("groove", g.id, g.terms);
  for (const i of INSTRUMENTS) add("instrument", i.id, i.terms);
  for (const r of REGIONS) add("region", r.id, r.terms);
  for (const e of ERAS) add("era", e.id, e.terms);
  for (const p of PITCH_SYSTEMS) add("pitch_system", p.id, p.terms);
  for (const s of STYLE_WORDS) add("style_word", s.tag, s.terms);
  TEMPO_WORDS.forEach((t, index) => add("tempo_word", String(index), t.terms));
  for (const word of Object.keys(MODIFIER_WORDS)) add("modifier", word, [word]);
  // Longest first, so "string quartet" beats "strings" and "trap hi-hat" beats "trap".
  return out.sort((a, b) => b.tokens.length - a.tokens.length || b.tokens.join(" ").length - a.tokens.join(" ").length);
}

let LEXICON_CACHE: LexEntry[] | null = null;
const lexicon = (): LexEntry[] => (LEXICON_CACHE ??= buildLexicon());

/** Instruments a groove word names on the way ("trap hi-hat" names a hi-hat). */
const GROOVE_INSTRUMENT_HINTS: Record<string, { id: string; styleTags: string[] }> = {
  "trap-hats": { id: "hi_hat", styleTags: ["trap"] },
  "walking-bass": { id: "bass", styleTags: [] },
  breakbeat: { id: "breakbeat_drums", styleTags: [] },
};

/**
 * Words that name a *role* rather than an instrument, so "the oud carries the
 * melody" can be read as an assignment. Deliberately excludes every word that
 * is also an instrument name ("bass", "pads", "drums"): those are already read
 * as instruments, and re-reading them as roles would invent an assignment the
 * user did not make.
 */
const ROLE_STATEMENT_WORDS: Record<string, RoleName> = {
  lead: "lead", melody: "lead", tune: "lead", solo: "lead", solos: "lead",
  harmony: "harmony", chords: "harmony", comping: "harmony",
  groove: "drums", beat: "drums",
  "מלודיה": "lead", "מנגינה": "lead", "סולו": "lead", "הרמוניה": "harmony", "אקורדים": "harmony", "גרוב": "drums",
};

/** Words that may stand between an instrument and the role it is given. */
const ROLE_CONNECTORS: ReadonlySet<string> = new Set([
  "on", "carries", "carry", "carrying", "takes", "take", "plays", "play", "playing", "holds", "hold",
  "leads", "does", "doing", "with", "the", "a", "an", "and",
  "נושא", "נושאת", "מנגן", "מנגנת", "לוקח", "לוקחת", "על", "את", "עם",
]);

/** Style-word tags a groove word also implies as identity (so the seed can see "boom bap"). */
const GROOVE_TAG_HINTS: Record<string, string[]> = { "boom-bap": ["hip_hop"], "trap-hats": [], dembow: ["reggaeton"], "one-drop": ["reggae"], clave: ["latin"], tumbao: ["latin"] };

function detectLanguage(text: string): UniversalStyle["language"] {
  const he = (text.match(/[֐-׿]/g) ?? []).length;
  const en = (text.match(/[a-z]/gi) ?? []).length;
  if (!he && !en) return "unknown";
  if (he && en) return he / (he + en) > 0.8 ? "he" : en / (he + en) > 0.8 ? "en" : "mixed";
  return he ? "he" : "en";
}

function memberFrom(entry: InstrumentEntry, styleTags: string[]): EnsembleMember {
  return { instrument: entry.id, family: entry.family, gm: { ...entry.gm }, role: entry.defaultRole, register: entry.register, styleTags: [...styleTags], recognised: true };
}

/**
 * Read the structured cues out of a description: tempo numbers, meters,
 * decades, named instruments, regions, eras, grooves, pitch systems, style
 * words and modifiers. Everything found is `user_stated` with the verbatim
 * span as its source, except the typical values a named groove carries (a
 * "swing" is 0.62 by convention, not by the user's word), which are
 * `inferred`. Words no lexicon carries become tags marked unrecognised.
 */
export function parseStyleDescription(description: string, options: { now?: Date } = {}): ParseResult {
  const text = description.trim();
  const style = emptyUniversalStyle(text);
  style.language = detectLanguage(text);
  const cues: ParsedCue[] = [];
  const filled: ParseResult["filled"] = [];
  const claim = (c: StyleClaim): void => { filled.push({ path: c.path, basis: c.basis, outcome: mergeClaim(style, c) }); };
  const stated = (path: FieldPath, value: unknown, span: string, note: string | null = null, confidence = 1): void =>
    claim({ path, value, confidence, basis: "user_stated", sources: [`stated: "${span}"`], note });

  const lower = text.toLowerCase();

  // --- numbers: bpm, meter, decades --------------------------------------
  const consumed: Array<[number, number]> = [];
  const take = (m: RegExpMatchArray): string => { consumed.push([m.index!, m.index! + m[0].length]); return m[0]; };
  const bpmRange = lower.match(/(\d{2,3})\s*(?:-|–|to|עד)\s*(\d{2,3})\s*bpm/) ?? lower.match(/bpm\s*(?:of|:)?\s*(\d{2,3})\s*(?:-|–|to|עד)\s*(\d{2,3})/);
  const bpmOne = lower.match(/(\d{2,3})\s*bpm/) ?? lower.match(/bpm\s*(?:of|:)?\s*(\d{2,3})/) ?? lower.match(/\bat\s+(\d{2,3})\b/) ?? lower.match(/ב-?(\d{2,3})\s*(?:bpm|פעימות)/);
  if (bpmRange) {
    const span = take(bpmRange);
    stated("tempo.bpm", { min: Number(bpmRange[1]), max: Number(bpmRange[2]) }, span, "a tempo range the user gave");
    cues.push({ kind: "tempo", id: `${bpmRange[1]}-${bpmRange[2]}`, span, start: -1, end: -1 });
  } else if (bpmOne) {
    const span = take(bpmOne);
    const bpm = Number(bpmOne[1]);
    stated("tempo.bpm", { min: bpm - 2, max: bpm + 2 }, span, "a tempo the user gave, ±2");
    cues.push({ kind: "tempo", id: String(bpm), span, start: -1, end: -1 });
  }
  const meterMatch = lower.match(/\b(\d{1,2})\/(2|4|8|16)\b/);
  const groupingMatch = lower.match(/\b(\d(?:\s*\+\s*\d)+)\b/);
  const grouping = groupingMatch ? groupingMatch[1].split("+").map((g) => Number(g.trim())) : null;
  if (meterMatch) {
    const span = take(meterMatch);
    const numerator = Number(meterMatch[1]);
    const fits = grouping && grouping.reduce((a, b) => a + b, 0) === numerator ? grouping : null;
    if (fits && groupingMatch) take(groupingMatch);
    stated("meter", { numerator, denominator: Number(meterMatch[2]), grouping: fits }, fits ? `${span} ${groupingMatch![0]}` : span, fits ? "a meter with the grouping the user gave" : "a meter the user gave");
    cues.push({ kind: "meter", id: `${numerator}/${meterMatch[2]}`, span, start: -1, end: -1 });
  } else if (grouping && [5, 7, 9, 11, 13].includes(grouping.reduce((a, b) => a + b, 0)) && groupingMatch) {
    const span = take(groupingMatch);
    const numerator = grouping.reduce((a, b) => a + b, 0);
    claim({ path: "meter", value: { numerator, denominator: 8, grouping }, confidence: 0.8, basis: "inferred", sources: [`stated: "${span}"`], note: "an additive grouping with no denominator given; 8 assumed" });
    // The grouping is stated; that it makes the *feel* additive is a reading of it.
    claim({ path: "groove.feel", value: "additive", confidence: 0.8, basis: "inferred", sources: [`stated: "${span}"`], note: "an additive grouping in the meter; the feel is read from the grouping, not stated" });
    cues.push({ kind: "meter", id: `${numerator}/8`, span, start: -1, end: -1 });
  }
  const decadeRe = /(?:^|[\s(])((?:'|׳)?(?:1[6-9]|20)?(\d)0)(?:'s|s|׳)?(?=$|[\s),.;])/g;
  let dm: RegExpExecArray | null;
  const decadeSpans: Array<{ from: number; to: number; span: string; index: number }> = [];
  while ((dm = decadeRe.exec(lower))) {
    const raw = dm[1].replace(/['׳]/g, "");
    const full = raw.length === 4 ? Number(raw) : Number(raw) >= 30 ? 1900 + Number(raw) : 2000 + Number(raw);
    if (full < 1600 || full > 2020) continue;
    if (dm[0].trim().length <= 2 && !/s|'|׳/.test(dm[0])) continue; // a bare "70" is not a decade
    decadeSpans.push({ from: full, to: full + 9, span: dm[0].trim(), index: dm.index });
  }
  const hebrewDecade = lower.match(/שנות\s+ה-?(\d)0/);
  if (hebrewDecade) decadeSpans.push({ from: 1900 + Number(hebrewDecade[1]) * 10, to: 1900 + Number(hebrewDecade[1]) * 10 + 9, span: hebrewDecade[0], index: hebrewDecade.index! });
  for (const d of decadeSpans) {
    const before = lower.slice(Math.max(0, d.index - 8), d.index);
    const era = /early|תחילת/.test(before) ? { from: d.from, to: d.from + 3 } : /late|סוף/.test(before) ? { from: d.to - 3, to: d.to } : /mid|אמצע/.test(before) ? { from: d.from + 3, to: d.from + 6 } : { from: d.from, to: d.to };
    stated("identity.era", { ...era, label: `${d.from}s` }, d.span, "a decade the user named");
    cues.push({ kind: "era", id: `${d.from}s`, span: d.span, start: -1, end: -1 });
  }

  // --- lexicon matching over tokens ----------------------------------------
  const tokens = tokenise(text);
  const claimed = new Array<boolean>(tokens.length).fill(false);
  const entries = lexicon();
  const matches: Array<ParsedCue & { entry: LexEntry }> = [];
  for (const entry of entries) {
    for (let i = 0; i + entry.tokens.length <= tokens.length; i += 1) {
      if (claimed.slice(i, i + entry.tokens.length).some(Boolean)) continue;
      let ok = true;
      for (let k = 0; k < entry.tokens.length; k += 1) {
        if (!tokenMatches(tokens[i + k].text, entry.tokens[k])) { ok = false; break; }
      }
      if (!ok) continue;
      // A modifier word must not shadow a longer style/instrument term — longest-first ordering guarantees that already.
      for (let k = 0; k < entry.tokens.length; k += 1) claimed[i + k] = true;
      const span = tokens.slice(i, i + entry.tokens.length).map((t) => t.original).join(" ");
      matches.push({ kind: entry.kind, id: entry.id, span, start: i, end: i + entry.tokens.length, entry });
    }
  }
  matches.sort((a, b) => a.start - b.start);

  /**
   * A compound *style word* is itself decomposable: "Balkan brass" is a brass
   * section from the Balkans, "Ethiopian jazz" is jazz from Ethiopia. So the
   * tokens a multi-word style name consumed are read a second time, and the
   * shorter features inside it are claimed too. Only style names are reopened:
   * a groove word ("trap hi-hat") and an instrument name ("string quartet")
   * have already spent their parts on a specific meaning, and reopening them
   * would invent a genre the user never asked for.
   */
  const subMatches: Array<ParsedCue & { parent: number }> = [];
  matches.forEach((m, parentIndex) => {
    if (m.kind !== "style_word" || m.end - m.start < 2) return;
    const spanClaimed = new Array<boolean>(m.end - m.start).fill(false);
    for (const entry of entries) {
      if (entry.tokens.length >= m.end - m.start) continue;
      if (entry.kind === "modifier" || entry.kind === "tempo_word") continue;
      for (let i = m.start; i + entry.tokens.length <= m.end; i += 1) {
        if (spanClaimed.slice(i - m.start, i - m.start + entry.tokens.length).some(Boolean)) continue;
        let ok = true;
        for (let k = 0; k < entry.tokens.length; k += 1) if (!tokenMatches(tokens[i + k].text, entry.tokens[k])) { ok = false; break; }
        if (!ok) continue;
        if (entry.kind === "style_word" && entry.id === m.id) continue;
        for (let k = 0; k < entry.tokens.length; k += 1) spanClaimed[i - m.start + k] = true;
        subMatches.push({ kind: entry.kind, id: entry.id, span: tokens.slice(i, i + entry.tokens.length).map((t) => t.original).join(" "), start: i, end: i + entry.tokens.length, parent: parentIndex });
      }
    }
  });
  subMatches.sort((a, b) => a.start - b.start);
  /** Regions named inside a compound style word describe the instruments named in the same word. */
  const subRegionsByParent = new Map<number, string[]>();
  for (const s of subMatches) {
    if (s.kind !== "region") continue;
    subRegionsByParent.set(s.parent, [...(subRegionsByParent.get(s.parent) ?? []), s.id]);
  }

  // --- explicit role assignments ("the oud carries the melody") -------------
  const roleMap: RoleMap = {};
  for (const m of matches) {
    if (m.kind !== "instrument") continue;
    for (let j = m.end; j < Math.min(tokens.length, m.end + 4); j += 1) {
      const word = tokens[j].text.replace(/[^a-z0-9֐-׿']/g, "");
      const role = ROLE_STATEMENT_WORDS[word];
      if (role) {
        const list = (roleMap[role] ??= []);
        if (!list.includes(m.id)) list.push(m.id);
        claimed[j] = true;
        cues.push({ kind: "role", id: `${role}:${m.id}`, span: tokens[j].original, start: j, end: j + 1 });
        break;
      }
      // Only a connector may stand between the instrument and its role; any
      // other word means the two are not talking about each other.
      if (!ROLE_CONNECTORS.has(word)) break;
    }
  }
  if (Object.keys(roleMap).length) {
    stated("roles", roleMap, Object.entries(roleMap).map(([r, ids]) => `${ids!.join("/")} → ${r}`).join(", "), "roles the user assigned to named instruments");
  }

  // Words nobody recognised.
  for (let i = 0; i < tokens.length; i += 1) {
    if (claimed[i]) continue;
    const word = tokens[i].text.replace(/^[^a-z0-9֐-׿]+|[^a-z0-9֐-׿']+$/g, "");
    if (!word || STOP_WORDS.has(word) || /^\d+$/.test(word) || word.length < 3) continue;
    const bare = HEBREW.test(word) ? word.replace(HE_PREFIX, "") : word;
    if (STOP_WORDS.has(bare) || bare.length < 3) continue;
    if (consumed.some(([s, e]) => tokens[i].start >= s - 1 && tokens[i].start < e)) continue;
    if (/^(bpm|\d+s)$/.test(word)) continue;
    cues.push({ kind: "unrecognised", id: word, span: tokens[i].original, start: i, end: i + 1 });
    if (!style.unrecognised.includes(word)) style.unrecognised.push(word);
  }

  // --- apply matches --------------------------------------------------------
  const tagsSeen: string[] = [];
  const attachedToInstrument = new Set<number>();
  const memberTags = (index: number): string[] => {
    // A region or style word immediately before an instrument describes that instrument.
    const tags: string[] = [];
    const m = matches[index];
    for (let j = index - 1; j >= 0 && j >= index - 2; j -= 1) {
      const prev = matches[j];
      if (prev.end !== (matches[j + 1]?.start ?? m.start)) break;
      if (prev.kind === "region" || prev.kind === "style_word" || prev.kind === "era") { tags.unshift(prev.id); attachedToInstrument.add(j); } else break;
    }
    return tags;
  };

  const applyMatch = (m: ParsedCue, instrumentTags: string[]): void => {
    cues.push({ kind: m.kind, id: m.id, span: m.span, start: m.start, end: m.end });
    switch (m.kind) {
      case "instrument": {
        const entry = INSTRUMENTS.find((i) => i.id === m.id)!;
        stated("ensemble", [memberFrom(entry, instrumentTags)], m.span, `named instrument (${entry.gm.exact ? "GM" : "nearest GM"} ${entry.gm.family}${entry.gm.program === null ? "" : ` #${entry.gm.program}`})`);
        break;
      }
      case "region": {
        const region = REGIONS.find((r) => r.id === m.id)!;
        stated("identity.region", [region.id], m.span, `named region/culture (${region.area})`);
        break;
      }
      case "era": {
        const era = ERAS.find((e) => e.id === m.id)!;
        const unspecified = era.id === "vintage" || era.id === "golden-age";
        claim({ path: "identity.era", value: { from: era.from, to: era.to, label: era.label }, confidence: unspecified ? 0.5 : 0.95, basis: "user_stated", sources: [`stated: "${m.span}"`], note: unspecified ? "a vague era word; the range is a placeholder to be asked about" : "a named period", hypothesis: unspecified });
        if (era.id === "baroque" || era.id === "renaissance" || era.id === "romantic" || era.id === "medieval") { if (!tagsSeen.includes(era.id)) tagsSeen.push(era.id); }
        break;
      }
      case "groove": {
        const groove = GROOVES.find((g) => g.id === m.id)!;
        for (const gc of groove.claims) applyGrooveClaim(gc, m.span);
        const hint = GROOVE_INSTRUMENT_HINTS[groove.id];
        if (hint) {
          const entry = INSTRUMENTS.find((i) => i.id === hint.id)!;
          stated("ensemble", [memberFrom(entry, [...hint.styleTags, ...instrumentTags])], m.span, "an instrument named inside a groove word");
        }
        for (const tag of GROOVE_TAG_HINTS[groove.id] ?? []) if (!tagsSeen.includes(tag)) tagsSeen.push(tag);
        break;
      }
      case "style_word": {
        if (!tagsSeen.includes(m.id)) tagsSeen.push(m.id);
        break;
      }
      case "pitch_system": {
        const def = PITCH_SYSTEMS.find((p) => p.id === m.id)!;
        claim({ path: "harmony.pitchSystem", value: pitchSystemRef(def), confidence: def.hypothesis ? 0.8 : 1, basis: "user_stated", sources: [`stated: "${m.span}"`, ...def.sources.map((s) => `ref: ${s}`)], note: def.caveat ?? `named pitch system (${def.kind})`, hypothesis: def.hypothesis });
        if (def.kind === "maqam" || def.kind === "makam") tagsSeen.includes("maqam") || tagsSeen.push("maqam");
        if (def.kind === "raga" || def.kind === "melakarta") tagsSeen.includes("raga") || tagsSeen.push("raga");
        break;
      }
      case "tempo_word": {
        const t = TEMPO_WORDS[Number(m.id)];
        claim({ path: "tempo.bpm", value: { min: t.min, max: t.max }, confidence: 0.6, basis: "inferred", sources: [`stated: "${m.span}"`], note: "a tempo word, read as a band" });
        break;
      }
      case "modifier": {
        const mod = MODIFIER_WORDS[m.id];
        // A word that *names* the value ("heavily ornamented", "dry", "deep")
        // is the user stating the field; a word that stands for a number
        // ("lush" → density 0.75) is a convention read out of the word.
        const named = typeof mod.value === "string" || Array.isArray(mod.value);
        claim({
          path: mod.path, value: mod.value, confidence: named ? 0.85 : 0.7,
          basis: named ? "user_stated" : "inferred", sources: [`stated: "${m.span}"`],
          note: named ? "a word naming the value" : "a descriptive word, read as a level",
        });
        break;
      }
      default:
        break;
    }
  };

  matches.forEach((m, index) => applyMatch(m, memberTags(index)));
  for (const sub of subMatches) applyMatch(sub, subRegionsByParent.get(sub.parent) ?? []);

  function applyGrooveClaim(gc: GrooveClaim, span: string): void {
    claim({
      path: gc.path, value: gc.value, confidence: gc.strength === "definitional" ? gc.confidence : gc.confidence * 0.9,
      basis: gc.strength === "definitional" ? "user_stated" : "inferred",
      sources: [`stated: "${span}"`], note: gc.rationale, hypothesis: gc.strength === "typical" && gc.confidence < 0.6,
    });
  }

  // Tags: recognised style words first, then the unrecognised words — as tags, flagged.
  const tags = [...tagsSeen, ...style.unrecognised.map((w) => w)];
  if (tags.length) {
    // Any tag nobody recognised makes the tag set a working assumption: the
    // word is kept verbatim, but what it means musically is not known yet.
    claim({ path: "identity.tags", value: tags, confidence: tagsSeen.length ? (style.unrecognised.length ? 0.7 : 1) : 0.4, basis: "user_stated", sources: [`stated: "${text.slice(0, 120)}"`], note: style.unrecognised.length ? `unrecognised words kept as tags: ${style.unrecognised.join(", ")}` : null, hypothesis: style.unrecognised.length > 0 });
  }

  style.hypotheses = listFields(style).filter((f) => f.field.hypothesis).map((f) => f.path);
  style.provenance = {
    parsedBy: UNIVERSAL_STYLE_PARSER,
    providers: [],
    derivedAt: (options.now ?? new Date()).toISOString(),
    inputsDigestSha256: sha256({ text }),
  };
  return { style, cues, language: style.language, filled };
}

// ---------------------------------------------------------------------------
// Evidence synthesis — pluggable reasoning providers
// ---------------------------------------------------------------------------

/**
 * A reasoning provider fills `inferred` / `evidence` fields for a parsed
 * style. It returns claims, never a style: every claim goes through
 * `mergeClaim`, so it cannot override a user's word, cannot fill a field
 * outside the registry, and cannot write a note sequence anywhere — there is
 * no field that would hold one. An LLM provider implements this interface
 * and answers in claims; the seed provider below is the deterministic one.
 */
export type StyleReasoningProvider = {
  id: string;
  /** Descriptive: what the provider is, for the ledger. */
  kind: "seed" | "rule" | "model" | "test";
  reason(input: { style: UniversalStyle; parse: ParseResult }): Promise<StyleClaim[]>;
};

export type SynthesisReport = {
  providers: Array<{ id: string; kind: StyleReasoningProvider["kind"]; claims: number; outcomes: Record<MergeOutcome, number>; error: string | null }>;
  /** Seed notes that applied, with what they matched on. */
  appliedNotes: Array<{ id: string; label: string; matchedOn: string[] }>;
  /** Paths where sources disagreed. */
  contested: FieldPath[];
};

/** Era ids the style's era overlaps, for seed matching. */
function eraIdsOf(style: UniversalStyle): string[] {
  const era = style.identity.era.value;
  if (!era) return [];
  return ERAS.filter((e) => e.from <= era.to && era.from <= e.to && !(e.id === "vintage" || e.id === "golden-age") && e.to - e.from <= 30).map((e) => e.id)
    .concat(ERAS.filter((e) => (e.id === "vintage" || e.id === "golden-age") && e.label === era.label).map((e) => e.id));
}

/** Instrument-scoped tags ("Mizrahi strings") the seed should also see. */
function ensembleTags(style: UniversalStyle): string[] {
  return (style.ensemble.value ?? []).flatMap((m) => m.styleTags);
}

export function createSeedReasoningProvider(notes: SeedNote[] = SEED_STYLE_KNOWLEDGE): StyleReasoningProvider & { lastMatches: SynthesisReport["appliedNotes"] } {
  const provider = {
    id: SEED_PROVIDER_ID,
    kind: "seed" as const,
    lastMatches: [] as SynthesisReport["appliedNotes"],
    async reason({ style }: { style: UniversalStyle; parse: ParseResult }): Promise<StyleClaim[]> {
      const tags = [...(style.identity.tags.value ?? []), ...ensembleTags(style)];
      const regions = [...(style.identity.region.value ?? []), ...ensembleTags(style)];
      const matches = matchingSeedNotes(tags, regions, eraIdsOf(style), notes);
      provider.lastMatches = matches.map((m) => ({ id: m.note.id, label: m.note.label, matchedOn: m.matchedOn }));
      const claims: StyleClaim[] = [];
      for (const { note, matchedOn } of matches) {
        for (const sc of note.claims) {
          const value = sc.path === "ensemble" ? ensembleFromIds(sc.value as string[]) : sc.value;
          const field = seedField(value, sc, note, matchedOn);
          claims.push({ path: sc.path, value, confidence: field.confidence, basis: "evidence", sources: field.sources, note: field.note, hypothesis: field.hypothesis });
        }
      }
      return claims;
    },
  };
  return provider;
}

export const SEED_REASONING_PROVIDER = createSeedReasoningProvider();

const EMPTY_OUTCOMES = (): Record<MergeOutcome, number> => ({ set: 0, corroborated: 0, merged: 0, kept: 0, contested: 0, rejected: 0 });

/**
 * Ask every provider, in order, and merge what comes back. A provider that
 * throws is recorded and skipped — a style is never left half-synthesised
 * because a model was down. The instrument-scoped tags a user attached to an
 * instrument ("Mizrahi strings") do NOT let a seed note rewrite the whole
 * style's groove: only the instrument's role instruction reads them.
 */
export async function synthesiseEvidence(
  parse: ParseResult,
  providers: readonly StyleReasoningProvider[] = [SEED_REASONING_PROVIDER],
): Promise<{ style: UniversalStyle; report: SynthesisReport }> {
  const style = parse.style;
  const report: SynthesisReport = { providers: [], appliedNotes: [], contested: [] };
  for (const provider of providers) {
    const outcomes = EMPTY_OUTCOMES();
    let error: string | null = null;
    let count = 0;
    try {
      const claims = await provider.reason({ style, parse });
      for (const claim of claims) {
        count += 1;
        if (!isFieldPath(claim.path) || (claim.basis !== "evidence" && claim.basis !== "inferred")) { outcomes.rejected += 1; continue; }
        outcomes[mergeClaim(style, { ...claim, sources: claim.sources.length ? claim.sources : [`provider:${provider.id}`] })] += 1;
      }
      if ("lastMatches" in provider) report.appliedNotes.push(...(provider as { lastMatches: SynthesisReport["appliedNotes"] }).lastMatches);
    } catch (e) {
      error = e instanceof Error ? e.message : String(e);
    }
    report.providers.push({ id: provider.id, kind: provider.kind, claims: count, outcomes, error });
  }
  // Instrument-scoped tags stay on the instrument: the seed saw them (for the palette), but
  // a scoped tag that contradicts a global one must not win the global field.
  style.hypotheses = listFields(style).filter((f) => f.field.hypothesis).map((f) => f.path);
  report.contested = listFields(style).filter((f) => f.field.contested?.length).map((f) => f.path);
  style.provenance.providers = providers.map((p) => p.id);
  style.provenance.inputsDigestSha256 = sha256({ text: style.description, providers: providers.map((p) => p.id) });
  return { style, report };
}

// ---------------------------------------------------------------------------
// Clarification — ask only what is unknown AND consequential
// ---------------------------------------------------------------------------

export type ClarificationReason = "unknown" | "hypothesis" | "contested" | "unrecognised" | "fingerprint_conflict";

export type ClarificationOption = { id: string; label: { en: string; he: string }; value: unknown };

export type ClarificationQuestion = {
  id: string;
  path: FieldPath;
  reason: ClarificationReason;
  /** 0..1: why this question is worth asking now. */
  priority: number;
  question: { en: string; he: string };
  options: ClarificationOption[];
  /** What the system currently assumes, in one line, or null. */
  currentAssumption: string | null;
};

const describeValue = (value: unknown): string => {
  if (value === null || value === undefined) return "unknown";
  if (typeof value === "string" || typeof value === "number") return String(value);
  if (Array.isArray(value)) return value.map((v) => (typeof v === "object" && v && "instrument" in v ? (v as EnsembleMember).instrument : describeValue(v))).join(", ");
  const o = value as Record<string, unknown>;
  if ("numerator" in o) return `${o.numerator}/${o.denominator}${o.grouping ? ` (${(o.grouping as number[]).join("+")})` : ""}`;
  if ("min" in o && "max" in o) return `${o.min}–${o.max} bpm`;
  if ("from" in o && "to" in o) return String(o.label ?? `${o.from}–${o.to}`);
  if ("name" in o) return String(o.name);
  return JSON.stringify(value);
};

const option = (id: string, en: string, he: string, value: unknown): ClarificationOption => ({ id, label: { en, he }, value });

function optionsFor(spec: FieldSpec, field: StyleField<unknown>): ClarificationOption[] {
  const opts: ClarificationOption[] = [];
  if (field.value !== null) opts.push(option("keep", `keep: ${describeValue(field.value)}`, `להשאיר: ${describeValue(field.value)}`, field.value));
  for (const alt of field.contested ?? []) opts.push(option(`alt-${opts.length}`, `use: ${describeValue(alt.value)}`, `להשתמש ב: ${describeValue(alt.value)}`, alt.value));
  if (spec.path === "harmony.pitchSystem") {
    const kind = (field.value as PitchSystemRef | null)?.kind;
    const family = PITCH_SYSTEMS.filter((p) => (kind ? p.kind === kind || (kind === "maqam" && p.kind === "makam") : p.kind === "diatonic_mode")).slice(0, 8);
    for (const p of family) if (!opts.some((o) => (o.value as PitchSystemRef)?.id === p.id)) opts.push(option(p.id, p.name, p.name, pitchSystemRef(p)));
  } else if (spec.options.length) {
    for (const v of spec.options) if (!opts.some((o) => o.value === v)) opts.push(option(v, v.replace(/_/g, " "), v.replace(/_/g, " "), v));
  }
  return opts.slice(0, 10);
}

/**
 * Questions worth asking, most consequential first. A field is asked about
 * when it is unknown and its consequence clears the threshold, when it holds
 * a hypothesis, when sources disagreed, or when the user wrote words nothing
 * recognised. Nothing is asked about a field that would not change the
 * writing.
 */
export function clarificationQuestions(
  style: UniversalStyle,
  options: { max?: number; minConsequence?: number } = {},
): ClarificationQuestion[] {
  const max = options.max ?? 4;
  const minConsequence = options.minConsequence ?? 0.6;
  const out: ClarificationQuestion[] = [];

  if (style.unrecognised.length) {
    out.push({
      id: "unrecognised-words",
      path: "identity.tags",
      reason: "unrecognised",
      priority: 0.95,
      question: {
        en: `I do not know these words as a style: ${style.unrecognised.join(", ")}. What do they mean musically — a tradition, an instrument, a groove, a mood?`,
        he: `אני לא מכיר את המילים האלה כסגנון: ${style.unrecognised.join(", ")}. מה הן אומרות מוזיקלית — מסורת, כלי, גרוב, אווירה?`,
      },
      options: [],
      currentAssumption: "kept as free tags with no musical consequence until explained",
    });
  }

  for (const { path, spec, field } of listFields(style)) {
    if (field.contested?.length && field.basis === "user_stated" && field.contested.some((c) => c.sources.some((s) => s.startsWith("stated:")))) {
      out.push({ id: `contested:${path}`, path, reason: "contested", priority: 0.9 + spec.consequence * 0.1, question: { en: `You said two different things about ${spec.question.en.replace(/\?$/, "").toLowerCase()}: ${describeValue(field.value)} vs ${field.contested.map((c) => describeValue(c.value)).join(" / ")}. Which?`, he: `אמרת שני דברים שונים: ${describeValue(field.value)} לעומת ${field.contested.map((c) => describeValue(c.value)).join(" / ")}. מה נכון?` }, options: optionsFor(spec, field), currentAssumption: describeValue(field.value) });
      continue;
    }
    if (field.basis === "unknown") {
      if (spec.consequence >= minConsequence) {
        out.push({ id: `unknown:${path}`, path, reason: "unknown", priority: spec.consequence * 0.8, question: spec.question, options: optionsFor(spec, field), currentAssumption: null });
      }
      continue;
    }
    // The unrecognised-words question above already asks what the tags mean.
    if (path === "identity.tags" && style.unrecognised.length) continue;
    if (field.hypothesis && spec.consequence >= Math.min(minConsequence, 0.5)) {
      out.push({
        id: `hypothesis:${path}`, path, reason: "hypothesis", priority: spec.consequence * 0.85,
        question: { en: `${spec.question.en} I am assuming ${describeValue(field.value)}${field.note ? ` (${field.note})` : ""}.`, he: `${spec.question.he} אני מניח ${describeValue(field.value)}.` },
        options: optionsFor(spec, field), currentAssumption: describeValue(field.value),
      });
      continue;
    }
    if (field.contested?.length && spec.consequence >= minConsequence) {
      out.push({ id: `contested:${path}`, path, reason: "contested", priority: spec.consequence * 0.7, question: { en: `${spec.question.en} Sources disagree: ${describeValue(field.value)} vs ${field.contested.map((c) => describeValue(c.value)).join(" / ")}.`, he: `${spec.question.he} המקורות חלוקים: ${describeValue(field.value)} לעומת ${field.contested.map((c) => describeValue(c.value)).join(" / ")}.` }, options: optionsFor(spec, field), currentAssumption: describeValue(field.value) });
    }
  }
  return out.sort((a, b) => b.priority - a.priority || a.path.localeCompare(b.path)).slice(0, max);
}

/** Record an answer: the field becomes `user_stated` at full confidence, contested values cleared. */
export function applyClarificationAnswer(style: UniversalStyle, path: FieldPath, value: unknown, answerText = "answer"): MergeOutcome {
  const spec = fieldSpec(path);
  if (!spec) return "rejected";
  const validated = spec.validate(value);
  if (validated === null || validated === undefined) return "rejected";
  setField(style, path, { value: validated, confidence: 1, basis: "user_stated", sources: [`answer: "${answerText}"`], note: "settled by the producer's answer", hypothesis: false, contested: null });
  style.hypotheses = listFields(style).filter((f) => f.field.hypothesis).map((f) => f.path);
  return "set";
}

// ---------------------------------------------------------------------------
// Style grammar — the Q-02 slot, from a universal style
// ---------------------------------------------------------------------------

/** The directives PR-44 defined, plus the ones a universal style can state and a fingerprint cannot. */
export type UniversalGrammarDirective =
  | GrammarDirective
  | { kind: "tempo"; bpmMin: number; bpmMax: number }
  | { kind: "meter"; numerator: number; denominator: number; grouping: number[] | null }
  | { kind: "subdivision"; unit: string }
  | { kind: "pitchSystem"; id: string; name: string; pitchClasses: number[] | null; intervalsCents: number[] | null; microtonal: boolean }
  | { kind: "drumLanguage"; pattern: string; kit: string | null; hiHat: string | null }
  | { kind: "bassLanguage"; pattern: string; attack: string | null }
  | { kind: "chordVocabulary"; vocabulary: string }
  | { kind: "cadence"; habits: string[] }
  | { kind: "level"; feature: "density" | "energy" | "tension"; target: number }
  | { kind: "voicing"; width: string | null; doubling: string | null }
  | { kind: "figures"; names: string[] }
  | { kind: "transitions"; devices: string[] }
  | { kind: "production"; aesthetic: string[]; saturation: string | null; room: string | null }
  | { kind: "contour"; shape: string };

export type UniversalGrammarRule = {
  id: string;
  description: string;
  weight: number;
  directive: UniversalGrammarDirective;
  basis: Basis;
  hypothesis: boolean;
  sources: string[];
};

export type UniversalStyleGrammar = {
  version: typeof UNIVERSAL_STYLE_GRAMMAR_VERSION;
  rules: UniversalGrammarRule[];
  omitted: string[];
  basis: {
    description: string;
    resolvedFields: number;
    unknownFields: number;
    hypotheses: string[];
    caveat: string;
  };
};

const BASIS_FACTOR: Record<Basis, number> = { user_stated: 1, evidence: 0.85, inferred: 0.65, unknown: 0 };
const ORNAMENT_TARGET: Record<string, number> = { none: 0, light: 0.05, moderate: 0.15, heavy: 0.3 };
const beatsPerBar = (m: { numerator: number; denominator: number } | null): number => (m ? m.numerator * (4 / m.denominator) : 4);

/**
 * Rules from a universal style. Weight is confidence scaled by basis (what
 * the user said carries fully; a seed's word less; an inference less again)
 * and halved-ish for a hypothesis. Unknown fields produce no rule, and are
 * listed in `omitted` so the silence is visible.
 */
export function styleGrammarFromUniversalStyle(style: UniversalStyle): UniversalStyleGrammar {
  const rules: UniversalGrammarRule[] = [];
  const omitted: string[] = [];
  const fieldsByPath = new Map(listFields(style).map((f) => [f.path, f.field]));
  const f = <T>(path: FieldPath): StyleField<T> => fieldsByPath.get(path) as StyleField<T>;

  const add = (id: string, field: StyleField<unknown>, description: string, directive: UniversalGrammarDirective, extraFields: StyleField<unknown>[] = []): void => {
    if (field.basis === "unknown") { omitted.push(`${id}: unknown`); return; }
    const weight = round(clamp01(field.confidence * BASIS_FACTOR[field.basis] * (field.hypothesis ? 0.7 : 1)));
    if (weight < MIN_RULE_WEIGHT) { omitted.push(`${id}: too weak to be an instruction (weight ${weight})`); return; }
    rules.push({ id, description, weight, directive, basis: field.basis, hypothesis: field.hypothesis, sources: [...new Set([field, ...extraFields].flatMap((x) => x.sources))] });
  };

  // groove
  const feel = f<string>("groove.feel");
  const swing = f<number>("groove.swingRatio");
  if (feel.value === "swung" || (swing.value !== null && swing.value > 0.53)) {
    const ratio = swing.value ?? 0.62;
    const field = swing.value !== null ? swing : { ...feel, confidence: feel.confidence * 0.8, basis: feel.basis === "user_stated" ? "inferred" as const : feel.basis };
    add("swing", field, `place off-beat subdivisions at a ${round(ratio, 2)} swing ratio`, { kind: "swing", ratio: round(ratio, 3) }, [feel]);
  } else if (feel.value === "straight" || (swing.value !== null && swing.value <= 0.53)) {
    add("swing", swing.value !== null ? swing : feel, "play straight: no swing", { kind: "swing", ratio: 0.5 });
  } else omitted.push("swing: feel unknown");
  const micro = f<number>("groove.microtimingMs");
  if (micro.value !== null && Math.abs(micro.value) >= 8) add("microtiming", micro, micro.value < 0 ? `play ahead of the grid by ${Math.abs(Math.round(micro.value))} ms` : `sit behind the grid by ${Math.round(micro.value)} ms`, { kind: "microtiming", offsetMs: round(micro.value, 1) });
  else omitted.push(micro.value === null ? "microtiming: unknown" : "microtiming: on the grid, no instruction");
  const sync = f<number>("groove.syncopation");
  if (sync.value !== null) add("syncopation", sync, `about ${Math.round(sync.value * 100)}% of onsets fall on weak positions`, { kind: "ratio", feature: "syncopation", target: round(sync.value) });
  else omitted.push("syncopation: unknown");
  const sub = f<string>("groove.subdivision");
  if (sub.value) add("subdivision", sub, `subdivide the beat in ${sub.value}s`, { kind: "subdivision", unit: sub.value });
  else omitted.push("subdivision: unknown");

  // meter & tempo
  const meter = f<{ numerator: number; denominator: number; grouping: number[] | null }>("meter");
  if (meter.value) add("meter", meter, `write in ${meter.value.numerator}/${meter.value.denominator}${meter.value.grouping ? ` grouped ${meter.value.grouping.join("+")}` : ""}`, { kind: "meter", ...meter.value });
  else omitted.push("meter: unknown");
  const tempo = f<{ min: number; max: number }>("tempo.bpm");
  if (tempo.value) add("tempo", tempo, `keep the tempo between ${tempo.value.min} and ${tempo.value.max} bpm`, { kind: "tempo", bpmMin: tempo.value.min, bpmMax: tempo.value.max });
  else omitted.push("tempo: unknown");

  // drums & bass
  const drumLang = f<string>("drums.language");
  const kit = f<string>("drums.kit");
  const hat = f<string>("drums.hiHat");
  if (drumLang.value || kit.value || hat.value) {
    const lead = drumLang.value ? drumLang : kit.value ? kit : hat;
    add("drum-language", lead, `drums: ${drumLang.value ?? "pattern unknown"}${kit.value ? ` on ${kit.value.replace(/_/g, " ")}` : ""}${hat.value ? `; hi-hat ${hat.value.replace(/_/g, " ")}` : ""}`, { kind: "drumLanguage", pattern: drumLang.value ?? "unknown", kit: kit.value, hiHat: hat.value }, [drumLang, kit, hat].filter((x) => x.basis !== "unknown"));
  } else omitted.push("drum-language: unknown");
  const bassLang = f<string>("bass.language");
  const attack = f<string>("bass.attack");
  if (bassLang.value || attack.value) add("bass-language", bassLang.value ? bassLang : attack, `bass: ${bassLang.value ?? "pattern unknown"}${attack.value ? `, ${attack.value.replace(/_/g, " ")}` : ""}`, { kind: "bassLanguage", pattern: bassLang.value ?? "unknown", attack: attack.value }, [attack].filter((x) => x.basis !== "unknown"));
  else omitted.push("bass-language: unknown");

  // harmony
  const ps = f<PitchSystemRef>("harmony.pitchSystem");
  if (ps.value) add("pitch-system", ps, `draw pitches from ${ps.value.name}${ps.value.pitchClasses ? ` [${ps.value.pitchClasses.join(",")}]` : ps.value.intervalsCents ? ` (cents ${ps.value.intervalsCents.join(",")})` : " (not reducible to a set)"}${ps.value.caveat ? ` — ${ps.value.caveat}` : ""}`, { kind: "pitchSystem", id: ps.value.id, name: ps.value.name, pitchClasses: ps.value.pitchClasses, intervalsCents: ps.value.intervalsCents, microtonal: ps.value.microtonal });
  else omitted.push("pitch-system: unknown");
  const vocab = f<string>("harmony.chordVocabulary");
  if (vocab.value) {
    if (vocab.value === "triads" || vocab.value === "sevenths" || vocab.value === "extended") add("chord-extensions", vocab, `voice ${vocab.value}`, { kind: "chordExtensions", level: vocab.value });
    else add("chord-vocabulary", vocab, `harmony as ${vocab.value.replace(/_/g, " ")}`, { kind: "chordVocabulary", vocabulary: vocab.value });
  } else omitted.push("chord-vocabulary: unknown");
  const cpb = f<number>("harmony.chordsPerBar");
  if (cpb.value !== null) add("harmonic-rhythm", cpb, `chords change about ${cpb.value} times a bar`, { kind: "rate", feature: "chordsPerBar", target: round(cpb.value, 2) });
  else omitted.push("harmonic-rhythm: unknown");
  const cadence = f<string[]>("harmony.cadence");
  if (cadence.value?.length) add("cadence", cadence, `end phrases with ${cadence.value.join(" / ").replace(/_/g, " ")} cadences`, { kind: "cadence", habits: cadence.value });
  else omitted.push("cadence: unknown");
  const fm = f<number>("harmony.functionalMotion");
  if (fm.value !== null) add("functional-motion", fm, `${Math.round(fm.value * 100)}% of root motion by fourth or fifth`, { kind: "ratio", feature: "functionalMotion", target: round(fm.value) });
  else omitted.push("functional-motion: unknown");

  // voicing, melody, phrase
  const width = f<string>("voicing.width");
  const doubling = f<string>("voicing.doubling");
  if (width.value || doubling.value) add("voicing", width.value ? width : doubling, `voicings ${width.value ?? "of any width"}${doubling.value ? `, doubling: ${doubling.value.replace(/_/g, " ")}` : ""}`, { kind: "voicing", width: width.value, doubling: doubling.value }, [doubling].filter((x) => x.basis !== "unknown"));
  else omitted.push("voicing: unknown");
  const orn = f<string>("melody.ornamentation");
  if (orn.value) add("ornamentation", orn, `ornamentation is ${orn.value}`, { kind: "ratio", feature: "ornamentation", target: ORNAMENT_TARGET[orn.value] ?? 0.1 });
  else omitted.push("ornamentation: unknown");
  const step = f<number>("melody.stepwiseRatio");
  if (step.value !== null) add("stepwise-motion", step, `${Math.round(step.value * 100)}% of melodic intervals are steps`, { kind: "ratio", feature: "stepwise", target: round(step.value) });
  else omitted.push("stepwise-motion: unknown");
  const contour = f<string>("melody.contour");
  if (contour.value) add("contour", contour, `melodic contour: ${contour.value}`, { kind: "contour", shape: contour.value });
  else omitted.push("contour: unknown");
  const phraseLen = f<number>("phrase.lengthBars");
  if (phraseLen.value !== null) add("phrase-length", phraseLen, `write in phrases of ${phraseLen.value} bars`, { kind: "phraseLength", beats: round(phraseLen.value * beatsPerBar(meter.value), 2) });
  else omitted.push("phrase-length: unknown");

  // register, levels, texture
  const reg = f<string>("register");
  if (reg.value && reg.value !== "mid") add("register", reg, `the writing sits ${reg.value}`, { kind: "register", tendency: reg.value as StyleFingerprint["register"]["tendency"] });
  else omitted.push(reg.value === "mid" ? "register: mid is the default" : "register: unknown");
  for (const feature of ["density", "energy", "tension"] as const) {
    const level = f<number>(feature);
    if (level.value !== null) add(feature, level, `${feature} around ${Math.round(level.value * 100)}%`, { kind: "level", feature, target: round(level.value, 2) });
    else omitted.push(`${feature}: unknown`);
  }
  const ensemble = f<EnsembleMember[]>("ensemble");
  if (ensemble.value?.length) {
    const families = [...new Set(ensemble.value.map((m) => m.family))];
    add("instrument-hierarchy", ensemble, `${families[0]} leads; ${families.slice(1).join(", ") || "nothing else"} follows`, { kind: "hierarchy", families });
  } else omitted.push("instrument-hierarchy: unknown");
  const figures = f<string[]>("rhythmicVocabulary");
  if (figures.value?.length) add("figures", figures, `use the ${figures.value.join(", ").replace(/_/g, " ")} figure(s)`, { kind: "figures", names: figures.value });
  else omitted.push("figures: unknown");
  const trans = f<string[]>("transitions");
  if (trans.value?.length) add("transitions", trans, `hand over sections with ${trans.value.join(", ").replace(/_/g, " ")}`, { kind: "transitions", devices: trans.value });
  else omitted.push("transitions: unknown");
  const aesthetic = f<string[]>("production.aesthetic");
  const sat = f<string>("production.saturation");
  const room = f<string>("production.room");
  if (aesthetic.value?.length || sat.value || room.value) add("production", aesthetic.value?.length ? aesthetic : sat.value ? sat : room, `production: ${(aesthetic.value ?? []).join(", ") || "unspecified"}${sat.value ? `, ${sat.value}` : ""}${room.value ? `, ${room.value} room` : ""}`, { kind: "production", aesthetic: aesthetic.value ?? [], saturation: sat.value, room: room.value }, [sat, room].filter((x) => x.basis !== "unknown"));
  else omitted.push("production: unknown");

  const fields = listFields(style);
  const unknown = fields.filter((x) => x.field.basis === "unknown").length;
  return {
    version: UNIVERSAL_STYLE_GRAMMAR_VERSION,
    rules: rules.sort((a, b) => b.weight - a.weight || a.id.localeCompare(b.id)),
    omitted,
    basis: {
      description: style.description,
      resolvedFields: fields.length - unknown,
      unknownFields: unknown,
      hypotheses: [...style.hypotheses],
      caveat: unknown
        ? `derived from a description, not a recording: ${unknown} of ${fields.length} fields are unknown and produce no rule; ${style.hypotheses.length} rule(s) rest on a hypothesis the producer has not confirmed`
        : "derived from a description, not a recording: every field is stated, inferred or seeded, none is measured",
    },
  };
}

/** The grammar as the Q-02 slot. Directive shapes match what `applyGroove` reads. */
export function universalStyleGrammarSlot(grammar: UniversalStyleGrammar): StyleGrammarSlot {
  if (!grammar.rules.length) return { status: "not_available", reason: `the description resolved no field strongly enough to become a rule (${grammar.omitted.length} considered)` };
  return {
    status: "available",
    version: `${UNIVERSAL_STYLE_GRAMMAR_VERSION}:${grammar.basis.hypotheses.length ? "hypothetical" : "stated"}`,
    rules: grammar.rules.map((rule) => ({ id: rule.id, description: rule.description, weight: rule.weight, directive: rule.directive })),
  };
}

// ---------------------------------------------------------------------------
// Arrangement instructions — per role, in the planners' vocabulary
// ---------------------------------------------------------------------------

export type RoleInstruction = {
  role: RoleName;
  arrangementRole: InstrumentArrangementRole;
  /** Instrument ids, first is preferred. Empty when the style names none for the role. */
  instruments: string[];
  register: RegisterBand;
  density: number;
  rhythmicActivity: number;
  melodicActivity: number;
  voicingStrategy: "open" | "close" | "unison" | "spread" | "drone" | "percussive";
  articulationFamily: "legato" | "staccato" | "sustain" | "pluck" | "percussive" | "mixed";
  interactionWithLead: "avoid" | "support" | "answer" | "double" | "independent";
  /** Sentences in the `physicalRules` / soft-constraint idiom the composers read. */
  constraints: string[];
  /** Tags the user attached to this role's instruments ("Mizrahi strings"). */
  styleTags: string[];
  basis: Basis;
  confidence: number;
  unknowns: string[];
};

export type ArrangementInstructions = {
  version: typeof ARRANGEMENT_INSTRUCTIONS_VERSION;
  roles: RoleInstruction[];
  sectionTargets: { energy: number | null; density: number | null; tension: number | null; basis: Record<"energy" | "density" | "tension", Basis> };
  palette: Array<{ instrument: string; family: string; gmFamily: string; gmProgram: number | null; role: InstrumentArrangementRole; priority: number; rationale: string }>;
  unknowns: FieldPath[];
  caveat: string;
};

const ROLE_OF_ARRANGEMENT_ROLE: Record<InstrumentArrangementRole, RoleName> = {
  GROOVE: "drums", FILL: "drums", BASS: "bass", FOUNDATION: "bass", RHYTHMIC_HARMONY: "harmony", HARMONIC_BED: "harmony",
  LEAD: "lead", PAD: "pads", COUNTER_MELODY: "colour", CALL_RESPONSE: "colour", ACCENT: "colour", OSTINATO: "colour",
  TRANSITION: "colour", CLIMAX_LAYER: "colour",
};
const ARRANGEMENT_ROLE_OF: Record<RoleName, InstrumentArrangementRole> = { drums: "GROOVE", bass: "BASS", harmony: "RHYTHMIC_HARMONY", lead: "LEAD", pads: "PAD", colour: "COUNTER_MELODY" };
const REGISTER_OF: Record<RoleName, RegisterBand> = { drums: "mid", bass: "low", harmony: "mid", lead: "upper_mid", pads: "mid", colour: "high" };

export function arrangementInstructions(style: UniversalStyle): ArrangementInstructions {
  const members = style.ensemble.value ?? [];
  const explicitRoles = style.roles.value ?? {};
  const byRole = new Map<RoleName, EnsembleMember[]>();
  for (const role of ROLE_NAMES) byRole.set(role, []);
  for (const member of members) {
    const explicit = ROLE_NAMES.find((r) => explicitRoles[r]?.includes(member.instrument));
    byRole.get(explicit ?? ROLE_OF_ARRANGEMENT_ROLE[member.role])!.push(member);
  }
  // A lead vocal always leads when present; another LEAD instrument becomes colour.
  const leads = byRole.get("lead")!;
  const vocal = leads.find((m) => m.family === "voice");
  if (vocal && leads.length > 1) {
    byRole.set("lead", [vocal]);
    byRole.get("colour")!.unshift(...leads.filter((m) => m !== vocal));
  }

  const v = <T>(path: FieldPath): StyleField<T> => getField(style, path) as StyleField<T>;
  const density = v<number>("density").value;
  const energy = v<number>("energy").value;
  const sync = v<number>("groove.syncopation").value;
  const sub = v<string>("groove.subdivision").value;
  const rhythmic = clamp01((sub === "sixteenth" ? 0.8 : sub === "eighth" ? 0.55 : sub === "triplet" ? 0.6 : sub === "quarter" ? 0.3 : 0.5) * 0.6 + (sync ?? 0.3) * 0.4 + (energy ?? 0.5) * 0.2);
  const width = v<string>("voicing.width").value;
  const doubling = v<string>("voicing.doubling").value;
  const vocab = v<string>("harmony.chordVocabulary").value;
  const orn = v<string>("melody.ornamentation").value;
  const drumLang = v<string>("drums.language").value;
  const kit = v<string>("drums.kit").value;
  const hat = v<string>("drums.hiHat").value;
  const bassLang = v<string>("bass.language").value;
  const attack = v<string>("bass.attack").value;
  const cpb = v<number>("harmony.chordsPerBar").value;
  const ps = v<PitchSystemRef>("harmony.pitchSystem").value;
  const figures = v<string[]>("rhythmicVocabulary").value ?? [];
  const swing = v<number>("groove.swingRatio").value;
  const feel = v<string>("groove.feel").value;
  const meter = v<{ numerator: number; denominator: number; grouping: number[] | null }>("meter").value;

  const basisOf = (...paths: FieldPath[]): { basis: Basis; confidence: number } => {
    const fields = paths.map((p) => getField(style, p)).filter((x) => x.basis !== "unknown");
    if (!fields.length) return { basis: "unknown", confidence: 0 };
    const best = fields.reduce((a, b) => (BASIS_RANK[a.basis] > BASIS_RANK[b.basis] || (BASIS_RANK[a.basis] === BASIS_RANK[b.basis] && a.confidence >= b.confidence) ? a : b));
    return { basis: best.basis, confidence: round(fields.reduce((s, x) => s + x.confidence, 0) / fields.length) };
  };
  const common: string[] = [];
  if (ps) common.push(ps.pitchClasses ? `stay within ${ps.name}: pitch classes {${ps.pitchClasses.join(",")}} above the tonic` : `stay within ${ps.name}${ps.microtonal ? " (microtonal: a 12-TET renderer approximates it)" : ""}`);
  if (meter) common.push(`phrase in ${meter.numerator}/${meter.denominator}${meter.grouping ? ` felt as ${meter.grouping.join("+")}` : ""}`);
  if (feel === "swung" && swing) common.push(`swing the off-beats at ${swing}`);
  if (feel === "straight") common.push("keep subdivisions straight");

  const roles: RoleInstruction[] = ROLE_NAMES.map((role) => {
    const list = byRole.get(role)!;
    const tags = [...new Set(list.flatMap((m) => m.styleTags))];
    const constraints = [...common];
    const unknowns: string[] = [];
    let voicing: RoleInstruction["voicingStrategy"] = "close";
    let articulation: RoleInstruction["articulationFamily"] = "mixed";
    let interaction: RoleInstruction["interactionWithLead"] = "support";
    let melodic = 0.2;
    let roleDensity = density ?? 0.5;
    let basis: { basis: Basis; confidence: number };
    switch (role) {
      case "drums":
        voicing = "percussive"; articulation = "percussive"; interaction = "independent"; melodic = 0;
        if (kit === "none") { constraints.push("no drums in this style"); roleDensity = 0; }
        else {
          if (drumLang) constraints.push(`kick/snare language: ${drumLang.replace(/_/g, " ")}`); else unknowns.push("drums.language");
          if (kit) constraints.push(`play on ${kit.replace(/_/g, " ")}`); else unknowns.push("drums.kit");
          if (hat) constraints.push(`hi-hat: ${hat.replace(/_/g, " ")}`);
          if (figures.length) constraints.push(`anchor the pattern to ${figures.join(", ").replace(/_/g, " ")}`);
        }
        basis = basisOf("drums.language", "drums.kit", "drums.hiHat");
        break;
      case "bass":
        voicing = "unison"; articulation = bassLang === "sustained" ? "sustain" : bassLang === "walking" || bassLang === "root_pulse" ? "pluck" : "mixed"; interaction = "independent"; melodic = bassLang === "walking" || bassLang === "syncopated_riff" || bassLang === "tumbao" ? 0.5 : 0.2;
        if (bassLang) constraints.push(`bass language: ${bassLang.replace(/_/g, " ")}`); else unknowns.push("bass.language");
        if (attack) constraints.push(`land ${attack.replace(/_/g, " ")}`);
        if (cpb !== null) constraints.push(`follow chord changes at ${cpb} per bar`);
        basis = basisOf("bass.language", "bass.attack");
        break;
      case "harmony":
        voicing = width === "open" ? "open" : width === "wide" ? "spread" : width === "unison" ? "unison" : vocab === "drones" ? "drone" : "close";
        articulation = cpb !== null && cpb >= 2 ? "staccato" : vocab === "drones" ? "sustain" : "mixed"; interaction = "support"; melodic = 0.1;
        if (vocab) constraints.push(vocab === "none" ? "no chords: heterophony or drone only" : `voice ${vocab.replace(/_/g, " ")}`); else unknowns.push("harmony.chordVocabulary");
        if (cpb !== null) constraints.push(`change chords about ${cpb} times a bar`); else unknowns.push("harmony.chordsPerBar");
        if (doubling) constraints.push(`doubling: ${doubling.replace(/_/g, " ")}`);
        basis = basisOf("harmony.chordVocabulary", "harmony.chordsPerBar", "voicing.width");
        break;
      case "lead":
        voicing = "unison"; articulation = orn === "heavy" ? "mixed" : "legato"; interaction = "independent"; melodic = 0.9;
        if (orn) constraints.push(`ornamentation ${orn}`); else unknowns.push("melody.ornamentation");
        if (v<string>("melody.contour").value) constraints.push(`contour ${v<string>("melody.contour").value}`);
        if (v<number>("melody.rangeSemitones").value !== null) constraints.push(`keep the range within ${v<number>("melody.rangeSemitones").value} semitones`);
        basis = basisOf("melody.ornamentation", "melody.contour", "melody.rangeSemitones");
        break;
      case "pads":
        voicing = "spread"; articulation = "sustain"; interaction = "support"; melodic = 0; roleDensity = Math.min(roleDensity, 0.4);
        constraints.push("sustain under the harmony; move only on chord changes");
        basis = basisOf("harmony.chordsPerBar", "voicing.width");
        break;
      default:
        voicing = doubling === "unison_sections" ? "unison" : "close"; articulation = "mixed"; interaction = v<string>("phrase.shape").value === "call_response" ? "answer" : "avoid"; melodic = 0.5;
        constraints.push(interaction === "answer" ? "answer the lead in its gaps" : "stay out of the lead's register and gaps");
        basis = basisOf("phrase.shape", "voicing.doubling");
        break;
    }
    return {
      role, arrangementRole: ARRANGEMENT_ROLE_OF[role],
      instruments: list.map((m) => m.instrument),
      register: list[0]?.register ?? REGISTER_OF[role],
      density: round(roleDensity, 2), rhythmicActivity: round(role === "pads" ? 0.1 : role === "lead" ? rhythmic * 0.8 : rhythmic, 2), melodicActivity: round(melodic, 2),
      voicingStrategy: voicing, articulationFamily: articulation, interactionWithLead: interaction,
      constraints, styleTags: tags, basis: basis.basis, confidence: basis.confidence, unknowns,
    };
  });

  const palette = members.map((m, index) => ({
    instrument: m.instrument, family: m.family, gmFamily: m.gm.family, gmProgram: m.gm.program, role: m.role,
    priority: round(1 - index / Math.max(1, members.length), 2),
    rationale: `${m.recognised ? "named by the user or the seed" : "unrecognised word"}${m.gm.exact ? "" : `; no exact GM patch, nearest is ${m.gm.family}${m.gm.program === null ? "" : ` #${m.gm.program}`}`}${m.styleTags.length ? `; played ${m.styleTags.join("/")}-style` : ""}`,
  }));
  const unknowns = listFields(style).filter((x) => x.field.basis === "unknown").map((x) => x.path);
  return {
    version: ARRANGEMENT_INSTRUCTIONS_VERSION,
    roles,
    sectionTargets: {
      energy: energy, density, tension: v<number>("tension").value,
      basis: { energy: v("energy").basis, density: v("density").basis, tension: v("tension").basis },
    },
    palette,
    unknowns,
    caveat: members.length ? `instructions for ${members.length} instrument(s); ${unknowns.length} style field(s) are unknown and left to the planners' defaults` : "no instruments are known: the palette is empty and every role instruction is generic until the ensemble is stated or seeded",
  };
}

// ---------------------------------------------------------------------------
// Reconciliation with the analysed song's fingerprint
// ---------------------------------------------------------------------------

export type ReconciliationStatus = "agree" | "conflict" | "not_stated" | "not_measured";

export type ReconciliationItem = {
  path: FieldPath;
  status: ReconciliationStatus;
  stated: unknown;
  measured: unknown;
  /** 0 identical … 1 as far apart as the feature allows; null when not comparable. */
  distance: number | null;
  note: string;
};

export type Reconciliation = {
  items: ReconciliationItem[];
  agreements: number;
  conflicts: number;
  /** One question per conflict. The stated value is never replaced. */
  questions: ClarificationQuestion[];
};

const ornamentRank: Record<string, number> = { none: 0, light: 1, moderate: 2, heavy: 3 };

/**
 * Compare what the producer said with what the song measures. Agreement
 * raises nothing; disagreement becomes a question offering both values.
 * The style is not modified: a stated value is never overridden by a
 * measurement, and a measurement is never written into the style as if the
 * producer had said it.
 */
export function reconcileWithFingerprint(style: UniversalStyle, fingerprint: StyleFingerprint): Reconciliation {
  const items: ReconciliationItem[] = [];
  const v = <T>(path: FieldPath): StyleField<T> => getField(style, path) as StyleField<T>;
  const push = (path: FieldPath, stated: unknown, measured: unknown, distance: number | null, conflict: boolean, note: string): void => {
    items.push({ path, status: stated === null ? "not_stated" : measured === null ? "not_measured" : conflict ? "conflict" : "agree", stated, measured, distance, note });
  };

  const tempo = v<{ min: number; max: number }>("tempo.bpm").value;
  if (tempo) {
    const bpm = fingerprint.tempo.bpm;
    const inside = bpm >= tempo.min * 0.95 && bpm <= tempo.max * 1.05;
    const halfDouble = (bpm * 2 >= tempo.min * 0.95 && bpm * 2 <= tempo.max * 1.05) || (bpm / 2 >= tempo.min * 0.95 && bpm / 2 <= tempo.max * 1.05);
    const distance = inside ? 0 : clamp01(Math.min(Math.abs(bpm - tempo.min), Math.abs(bpm - tempo.max)) / 60);
    push("tempo.bpm", tempo, bpm, round(distance), !inside && !halfDouble, inside ? "the song's tempo is in the stated band" : halfDouble ? "the song's tempo is the stated band at half or double time — treated as agreement, worth confirming" : `the song is at ${Math.round(bpm)} bpm, outside ${tempo.min}–${tempo.max}`);
  } else push("tempo.bpm", null, fingerprint.tempo.bpm, null, false, "no tempo was stated; the song's tempo stands");

  const meter = v<{ numerator: number; denominator: number }>("meter").value;
  const measuredMeter = fingerprint.tempo.meter;
  if (meter) {
    const same = `${meter.numerator}/${meter.denominator}` === measuredMeter;
    push("meter", `${meter.numerator}/${meter.denominator}`, measuredMeter, same ? 0 : 1, !same, same ? "same meter" : "the song is in a different meter from the one stated");
  } else push("meter", null, measuredMeter, null, false, "no meter was stated");

  const swing = v<number>("groove.swingRatio").value;
  const feel = v<string>("groove.feel").value;
  const measuredSwing = fingerprint.groove.swingRatio;
  if (swing !== null) {
    const distance = clamp01(Math.abs(swing - measuredSwing) / 0.17);
    push("groove.swingRatio", swing, measuredSwing, round(distance), Math.abs(swing - measuredSwing) > 0.06, Math.abs(swing - measuredSwing) > 0.06 ? `stated swing ${swing} vs measured ${round(measuredSwing, 2)}` : "swing agrees");
  } else if (feel === "swung" || feel === "straight") {
    const measuredFeel = measuredSwing >= 0.56 ? "swung" : measuredSwing <= 0.54 ? "straight" : "ambiguous";
    push("groove.feel", feel, measuredFeel, measuredFeel === feel ? 0 : measuredFeel === "ambiguous" ? 0.5 : 1, measuredFeel !== feel && measuredFeel !== "ambiguous", measuredFeel === feel ? "feel agrees" : `stated ${feel} but the song measures ${measuredFeel} (${round(measuredSwing, 2)})`);
  } else push("groove.feel", null, measuredSwing >= 0.56 ? "swung" : "straight", null, false, "no feel was stated");

  const micro = v<number>("groove.microtimingMs").value;
  if (micro !== null) {
    const d = Math.abs(micro - fingerprint.groove.microtimingMs);
    push("groove.microtimingMs", micro, fingerprint.groove.microtimingMs, round(clamp01(d / 40)), d > 15, d > 15 ? `stated ${micro} ms vs measured ${round(fingerprint.groove.microtimingMs, 1)} ms` : "microtiming agrees");
  } else push("groove.microtimingMs", null, fingerprint.groove.microtimingMs, null, false, "not stated");

  const sync = v<number>("groove.syncopation").value;
  if (sync !== null) {
    const d = Math.abs(sync - fingerprint.groove.syncopation);
    push("groove.syncopation", sync, fingerprint.groove.syncopation, round(clamp01(d / 0.5)), d > 0.2, d > 0.2 ? "syncopation differs" : "syncopation agrees");
  } else push("groove.syncopation", null, fingerprint.groove.syncopation, null, false, "not stated");

  const cpb = v<number>("harmony.chordsPerBar").value;
  if (cpb !== null) {
    const m = fingerprint.harmony.chordsPerBar;
    const ratio = m > 0 && cpb > 0 ? Math.max(m / cpb, cpb / m) : m === cpb ? 1 : 4;
    push("harmony.chordsPerBar", cpb, m, round(clamp01((ratio - 1) / 3)), ratio > 2, ratio > 2 ? `stated ${cpb} chords a bar vs measured ${round(m, 2)}` : "harmonic rhythm agrees");
  } else push("harmony.chordsPerBar", null, fingerprint.harmony.chordsPerBar, null, false, "not stated");

  const vocab = v<string>("harmony.chordVocabulary").value;
  if (vocab && ["triads", "sevenths", "extended"].includes(vocab)) {
    const levels = ["triads", "sevenths", "extended"];
    const d = Math.abs(levels.indexOf(vocab) - levels.indexOf(fingerprint.harmony.chordExtensions));
    push("harmony.chordVocabulary", vocab, fingerprint.harmony.chordExtensions, round(d / 2), d >= 1, d >= 1 ? `stated ${vocab} but the song voices ${fingerprint.harmony.chordExtensions}` : "chord vocabulary agrees");
  } else push("harmony.chordVocabulary", vocab, fingerprint.harmony.chordExtensions, null, false, vocab ? `stated ${vocab} is not on the fingerprint's triads/sevenths/extended scale; not comparable` : "not stated");

  const fm = v<number>("harmony.functionalMotion").value;
  if (fm !== null) {
    const d = Math.abs(fm - fingerprint.harmony.functionalMotion);
    push("harmony.functionalMotion", fm, fingerprint.harmony.functionalMotion, round(clamp01(d)), d > 0.35, d > 0.35 ? "functional motion differs" : "functional motion agrees");
  } else push("harmony.functionalMotion", null, fingerprint.harmony.functionalMotion, null, false, "not stated");

  const orn = v<string>("melody.ornamentation").value;
  if (orn) {
    const d = Math.abs(ornamentRank[orn] - ornamentRank[fingerprint.melodicShape.ornamentation]);
    push("melody.ornamentation", orn, fingerprint.melodicShape.ornamentation, round(d / 3), d >= 2, d >= 2 ? `stated ${orn} ornamentation but the song's melody is ${fingerprint.melodicShape.ornamentation}` : "ornamentation agrees");
  } else push("melody.ornamentation", null, fingerprint.melodicShape.ornamentation, null, false, "not stated");

  const step = v<number>("melody.stepwiseRatio").value;
  if (step !== null) {
    const d = Math.abs(step - fingerprint.melodicShape.stepwiseRatio);
    push("melody.stepwiseRatio", step, fingerprint.melodicShape.stepwiseRatio, round(clamp01(d)), d > 0.25, d > 0.25 ? "stepwise share differs" : "stepwise share agrees");
  } else push("melody.stepwiseRatio", null, fingerprint.melodicShape.stepwiseRatio, null, false, "not stated");

  const phraseLen = v<number>("phrase.lengthBars").value;
  if (phraseLen !== null) {
    const bars = fingerprint.melodicShape.phraseLengthBeats / beatsPerBar(meter ?? null);
    const ratio = bars > 0 ? Math.max(bars / phraseLen, phraseLen / bars) : 4;
    push("phrase.lengthBars", phraseLen, round(bars, 2), round(clamp01((ratio - 1) / 3)), ratio > 2, ratio > 2 ? `stated ${phraseLen}-bar phrases vs measured ${round(bars, 1)}` : "phrase length agrees");
  } else push("phrase.lengthBars", null, round(fingerprint.melodicShape.phraseLengthBeats / beatsPerBar(meter ?? null), 2), null, false, "not stated");

  const reg = v<string>("register").value;
  if (reg) push("register", reg, fingerprint.register.tendency, reg === fingerprint.register.tendency ? 0 : 1, reg !== fingerprint.register.tendency && reg !== "wide" && fingerprint.register.tendency !== "wide", reg === fingerprint.register.tendency ? "register agrees" : `stated ${reg} vs measured ${fingerprint.register.tendency}`);
  else push("register", null, fingerprint.register.tendency, null, false, "not stated");

  const density = v<number>("density").value;
  if (density !== null) {
    const measured = clamp01(fingerprint.density.notesPerBarMean / 24);
    const d = Math.abs(density - measured);
    push("density", density, round(measured, 2), round(d), d > 0.35, d > 0.35 ? `stated density ${density} vs the song's ${round(measured, 2)} (${round(fingerprint.density.notesPerBarMean, 1)} notes/bar)` : "density agrees");
  } else push("density", null, round(clamp01(fingerprint.density.notesPerBarMean / 24), 2), null, false, "not stated");

  const ensemble = v<EnsembleMember[]>("ensemble").value;
  if (ensemble?.length) {
    const statedFamilies = [...new Set(ensemble.map((m) => m.family))];
    const measuredFamilies = fingerprint.instrumentation.hierarchy;
    const missing = statedFamilies.filter((fam) => !measuredFamilies.includes(fam));
    push("ensemble", statedFamilies, measuredFamilies, round(measuredFamilies.length ? missing.length / statedFamilies.length : 1), missing.length > 0 && measuredFamilies.length > 0, missing.length ? `the song has no ${missing.join(", ")}: are these to be added, or to replace what is there?` : "every stated family is present in the song");
  } else push("ensemble", null, fingerprint.instrumentation.hierarchy, null, false, "no ensemble was stated");

  const conflicts = items.filter((i) => i.status === "conflict");
  const questions: ClarificationQuestion[] = conflicts.map((item) => {
    const spec = fieldSpec(item.path)!;
    return {
      id: `fingerprint:${item.path}`,
      path: item.path,
      reason: "fingerprint_conflict",
      priority: round(0.6 + spec.consequence * 0.4),
      question: {
        en: `You asked for ${describeValue(item.stated)} but the song measures ${describeValue(item.measured)} (${item.note}). Follow what you said, or what the song does?`,
        he: `ביקשת ${describeValue(item.stated)} אבל בשיר נמדד ${describeValue(item.measured)}. ללכת לפי מה שאמרת, או לפי השיר?`,
      },
      options: [
        option("stated", `what I said: ${describeValue(item.stated)}`, `מה שאמרתי: ${describeValue(item.stated)}`, item.stated),
        option("measured", `what the song does: ${describeValue(item.measured)}`, `מה שהשיר עושה: ${describeValue(item.measured)}`, item.measured),
      ],
      currentAssumption: `what you said (${describeValue(item.stated)}) — the measurement does not override it`,
    };
  });
  return { items, agreements: items.filter((i) => i.status === "agree").length, conflicts: conflicts.length, questions };
}

// ---------------------------------------------------------------------------
// The whole pipeline
// ---------------------------------------------------------------------------

export type ResolutionShare = {
  fields: number;
  user_stated: number;
  inferred: number;
  evidence: number;
  unknown: number;
  hypotheses: number;
  contested: number;
  /** Fields the deterministic parser alone resolved (stated + inferred from the text). */
  deterministicShare: number;
  /** Fields the reasoning provider(s) resolved. */
  reasoningShare: number;
  unknownShare: number;
};

export function resolutionShare(style: UniversalStyle): ResolutionShare {
  const fields = listFields(style);
  const count = (basis: Basis) => fields.filter((f) => f.field.basis === basis).length;
  const n = fields.length;
  const stated = count("user_stated"); const inferred = count("inferred"); const evidence = count("evidence"); const unknown = count("unknown");
  return {
    fields: n, user_stated: stated, inferred, evidence, unknown,
    hypotheses: fields.filter((f) => f.field.hypothesis).length,
    contested: fields.filter((f) => f.field.contested?.length).length,
    deterministicShare: round((stated + inferred) / n),
    reasoningShare: round(evidence / n),
    unknownShare: round(unknown / n),
  };
}

export type StyleDecomposition = {
  style: UniversalStyle;
  parse: Omit<ParseResult, "style">;
  synthesis: SynthesisReport;
  questions: ClarificationQuestion[];
  grammar: UniversalStyleGrammar;
  grammarSlot: StyleGrammarSlot;
  instructions: ArrangementInstructions;
  reconciliation: Reconciliation | null;
  share: ResolutionShare;
};

/**
 * description → parse → synthesis → clarification → grammar → instructions
 * (→ reconciliation when a fingerprint is given). Deterministic for the seed
 * provider: the same description gives the same decomposition.
 */
export async function decomposeStyle(
  description: string,
  options: { providers?: readonly StyleReasoningProvider[]; fingerprint?: StyleFingerprint | null; maxQuestions?: number; now?: Date } = {},
): Promise<StyleDecomposition> {
  const parse = parseStyleDescription(description, { now: options.now });
  const { style, report } = await synthesiseEvidence(parse, options.providers ?? [SEED_REASONING_PROVIDER]);
  const reconciliation = options.fingerprint ? reconcileWithFingerprint(style, options.fingerprint) : null;
  const questions = [...clarificationQuestions(style, { max: options.maxQuestions ?? 4 }), ...(reconciliation?.questions ?? [])];
  const grammar = styleGrammarFromUniversalStyle(style);
  const { style: _s, ...parseRest } = parse;
  return {
    style, parse: parseRest, synthesis: report, questions, grammar,
    grammarSlot: universalStyleGrammarSlot(grammar), instructions: arrangementInstructions(style), reconciliation,
    share: resolutionShare(style),
  };
}

/** A parse-only decomposition — no provider, nothing seeded — for measuring what the text alone gives. */
export function decomposeStyleDeterministic(description: string, now?: Date): { style: UniversalStyle; share: ResolutionShare; cues: ParsedCue[] } {
  const parse = parseStyleDescription(description, { now });
  return { style: parse.style, share: resolutionShare(parse.style), cues: parse.cues };
}

/** Everything the registry knows, for a UI or a provider prompt. */
export function fieldCatalogue(): Array<{ path: FieldPath; consequence: number; options: readonly string[]; question: { en: string; he: string } }> {
  return FIELD_REGISTRY.map((s) => ({ path: s.path, consequence: s.consequence, options: s.options, question: s.question }));
}

export type { PitchSystemDefinition };
export const UNIVERSAL_STYLE_VERSION_ID = UNIVERSAL_STYLE_VERSION;
