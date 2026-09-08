/**
 * Intent extraction (Wave U, PR-U1) — layer 1 of Universal Producer
 * Intelligence: what the user actually said, and what can be read out of it.
 *
 * Two extractors share one contract:
 *   - a deterministic fallback (keyword / phrase heuristics, Hebrew + English)
 *     that ships now and runs everywhere;
 *   - an injectable `IntentLanguageModel` (PR-U2+) whose structured output is
 *     validated against the same rule the fallback obeys: nothing is recorded
 *     without verbatim evidence in the user's text.
 *
 * Nothing here is ever fabricated. A word the extractor cannot classify is
 * surfaced in `unresolvedTerms`; a negated word ("not too poppy") becomes a
 * constraint and never a style; what was not said is absent.
 */
import { createHash } from "node:crypto";
import type {
  IntentConstraint,
  IntentInference,
  IntentReference,
  IntentScope,
  IntentSectionRef,
  IntentSectionRequest,
  IntentSlotName,
  UserIntent,
} from "@workspace/db";
import {
  LEXICON,
  ORDINAL_TERMS,
  SECTION_TERMS,
  detectLanguage,
  findLexiconHits,
  lookupWord,
  stripHebrewPrefix,
  termPattern,
  type LexiconEntry,
} from "./vocabulary";

export const USER_INTENT_VERSION = "1.0" as const;
const METHOD = "intent-extraction/v1";

// ---------------------------------------------------------------------------
// Public contract
// ---------------------------------------------------------------------------

/**
 * A language model that returns structured JSON for a prompt. The extractor
 * validates whatever comes back; the model cannot add anything the text does
 * not literally contain.
 */
export type IntentLanguageModel = {
  id: string;
  complete(request: { instructions: string; text: string; schemaHint: string }): Promise<unknown>;
};

export type ExtractIntentOptions = {
  llm?: IntentLanguageModel;
  /** References the caller already knows (uploaded files, picked songs). */
  references?: Array<Pick<IntentReference, "kind" | "label" | "aspect">>;
  now?: Date;
};

const SLOT_NAMES: IntentSlotName[] = [
  "mood", "energy", "density", "era", "tradition", "genre_word", "scene",
  "instrument", "ensemble_size", "tempo_feel", "tempo_bpm", "production_feel", "vocal_treatment",
];

const clamp01 = (v: number): number => (v < 0 ? 0 : v > 1 ? 1 : v);
const round3 = (v: number): number => Math.round(v * 1000) / 1000;

export function intentInputsDigest(
  text: string,
  references: ExtractIntentOptions["references"] = [],
): string {
  return createHash("sha256")
    .update(JSON.stringify({ text, references }))
    .digest("hex");
}

// ---------------------------------------------------------------------------
// Clauses and section references
// ---------------------------------------------------------------------------

const CLAUSE_SPLIT = /[,.;:!?\n]+|\s+(?:and|but|also|then|while|whereas)\s+|\s+(?:אבל|ואילו|ואז)\s+/iu;

type SectionHit = { ref: IntentSectionRef; span: string; index: number; end: number };

function findSectionHits(clause: string): SectionHit[] {
  const lower = clause.toLowerCase();
  const hits: SectionHit[] = [];
  for (const { function: fn, terms } of SECTION_TERMS) {
    for (const term of terms) {
      const match = termPattern(term).exec(lower);
      if (!match || match.index === undefined) continue;
      const start = match.index;
      const end = start + match[1].length;
      if (hits.some((h) => start < h.end && end > h.index)) continue;
      hits.push({ ref: { function: fn, ordinal: "all" }, span: clause.slice(start, end), index: start, end });
    }
  }
  hits.sort((a, b) => a.index - b.index);
  // Ordinals: Hebrew puts them after the noun ("הפזמון השני"), English before
  // ("second chorus") or as a number after ("chorus 2").
  for (const hit of hits) {
    const before = lower.slice(0, hit.index);
    const after = lower.slice(hit.end);
    let resolved: IntentSectionRef["ordinal"] | null = null;
    let extraSpan = "";
    const numberAfter = /^\s*#?(\d)\b/.exec(after);
    if (numberAfter) {
      resolved = Number(numberAfter[1]);
      extraSpan = numberAfter[0];
    }
    if (resolved === null) {
      for (const { ordinal, terms } of ORDINAL_TERMS) {
        for (const term of terms) {
          const heAfter = new RegExp(`^\\s+ה?${term}(?![\\p{L}])`, "u").exec(after);
          if (heAfter && /[֐-׿]/.test(term)) { resolved = ordinal; extraSpan = heAfter[0]; break; }
          const enBefore = new RegExp(`(?<![\\p{L}])${term}\\s+(?:the\\s+)?$`, "iu").exec(before);
          if (enBefore) { resolved = ordinal; extraSpan = enBefore[0]; break; }
          const heBefore = new RegExp(`(?<![\\p{L}])${term}\\s+ה?$`, "u").exec(before);
          if (heBefore && /[֐-׿]/.test(term)) { resolved = ordinal; extraSpan = heBefore[0]; break; }
        }
        if (resolved !== null) break;
      }
    }
    if (resolved !== null) {
      hit.ref = { ...hit.ref, ordinal: resolved };
      hit.span = `${hit.span} ${extraSpan.trim()}`.trim();
    }
  }
  return hits;
}

/** Split into clauses; a clause naming two sections is split at the second. */
function splitClauses(text: string): string[] {
  const raw = text.split(CLAUSE_SPLIT).map((c) => c.trim()).filter(Boolean);
  const out: string[] = [];
  for (const clause of raw) {
    const hits = findSectionHits(clause);
    if (hits.length <= 1) { out.push(clause); continue; }
    let cursor = 0;
    for (let i = 1; i < hits.length; i += 1) {
      // Back up over a leading Hebrew conjunction glued to the section word.
      const cut = hits[i].index;
      out.push(clause.slice(cursor, cut).trim());
      cursor = cut;
    }
    out.push(clause.slice(cursor).trim());
  }
  return out.filter(Boolean);
}

// ---------------------------------------------------------------------------
// Negations, boosts and structural words
// ---------------------------------------------------------------------------

const STRUCTURE_WORDS: Record<string, string> = {
  climax: "climax", peak: "climax", apex: "climax", שיא: "climax",
  everything: "everything", הכל: "everything", "הכול": "everything",
  drop: "drop", build: "build",
};

type NegationKind = IntentConstraint["kind"];
/**
 * `bare` marks the generic "not X" / "לא X" forms, which only count when X is
 * a known word — otherwise they are more likely part of a sentence we do not
 * understand, and recording them would be a guess.
 */
type NegationPattern = { kind: NegationKind; pattern: RegExp; bare?: boolean };

/** Order matters: the most specific patterns first. */
const NEGATION_PATTERNS: NegationPattern[] = [
  // English
  { kind: "avoid", pattern: /\bnot\s+too\s+([\p{L}'-]+)/iu },
  { kind: "require", pattern: /\b(?:doesn't|does\s+not|don't|do\s+not|isn't|is\s+not|still\s+doesn't|still\s+isn't)\s+(?:really\s+)?(?:feel|sound|read|land)\s+like\s+(?:a\s+|an\s+|the\s+)?([\p{L}'-]+)/iu },
  { kind: "avoid", pattern: /\b(?:don't|dont|do\s+not|doesn't|does\s+not)\s+(?:want|need|like)\s+(?:any\s+|the\s+|a\s+|an\s+)?([\p{L}'-]+)/iu },
  { kind: "avoid", pattern: /\b(?:without|avoid|never|remove|drop|mute|lose)\s+(?:any\s+|the\s+|all\s+|a\s+)?([\p{L}'-]+)/iu },
  { kind: "avoid", pattern: /\bno\s+([\p{L}'-]+)/iu },
  { kind: "limit", pattern: /\b(?:less|fewer|reduce|thin\s+out|tone\s+down|calm\s+down)\s+(?:the\s+|of\s+)?([\p{L}'-]+)/iu },
  { kind: "limit", pattern: /\btoo\s+([\p{L}'-]+)/iu },
  { kind: "keep", pattern: /\b(?:keep|leave|preserve|don't\s+touch|do\s+not\s+touch)\s+(?:the\s+|all\s+the\s+)?([\p{L}'-]+)/iu },
  { kind: "require", pattern: /\b(?:add|bring\s+in|introduce|put\s+in)\s+(?:some\s+|a\s+|an\s+|the\s+|more\s+)?([\p{L}'-]+)/iu },
  { kind: "require", pattern: /\b(?:regenerate|redo|re-do|rewrite|replace|rework|fix|change)\s+(?:the\s+|all\s+the\s+)?([\p{L}'-]+)/iu },
  { kind: "avoid", pattern: /\bnot\s+(?!too\b)([\p{L}'-]+)/iu, bare: true },
  // Hebrew — an optional glued "ו" (and) is allowed before every verb.
  { kind: "avoid", pattern: /(?<![\p{L}])ו?לא\s+([\p{L}'-]+)\s+מדי/u },
  { kind: "require", pattern: /(?<![\p{L}])ו?לא\s+מרגיש(?:ה|ים)?\s+(?:כמו\s+)?([\p{L}'-]+)/u },
  { kind: "avoid", pattern: /(?<![\p{L}])ו?(?:בלי|ללא)\s+([\p{L}'-]+)/u },
  { kind: "avoid", pattern: /(?<![\p{L}])ו?לא\s+(?:רוצה|רוצים|צריך|צריכים)\s+([\p{L}'-]+)/u },
  { kind: "avoid", pattern: /(?<![\p{L}])ו?(?:תוריד|תורידו|להוריד|תסיר|תסירו|הסר|להסיר|תשתיק|להשתיק)\s+(?:את\s+)?([\p{L}'-]+)/u },
  { kind: "limit", pattern: /(?<![\p{L}])ו?פחות\s+([\p{L}'-]+)/u },
  { kind: "limit", pattern: /(?<![\p{L}])([\p{L}'-]+)\s+מדי(?![\p{L}])/u },
  { kind: "keep", pattern: /(?<![\p{L}])ו?(?:תשאיר|תשאירו|להשאיר|שמור|שמרו|לשמור|אל\s+תיגע|אל\s+תגע|אל\s+תיגעו)\s+(?:על\s+|את\s+|ב)?([\p{L}'-]+)/u },
  { kind: "require", pattern: /(?<![\p{L}])ו?(?:תוסיף|תוסיפו|להוסיף|תכניס|תכניסו|להכניס)\s+(?:את\s+|עוד\s+)?([\p{L}'-]+)/u },
  { kind: "require", pattern: /(?<![\p{L}])ו?(?:תחליף|תחליפו|להחליף|תשנה|תשנו|לשנות|תתקן|תתקנו|לתקן)\s+(?:את\s+)?([\p{L}'-]+)/u },
  { kind: "avoid", pattern: /(?<![\p{L}])ו?לא\s+([\p{L}'-]+)/u, bare: true },
];

const BOOST_PATTERNS: RegExp[] = [
  /\b(?:more|much\s+more|a\s+bit\s+more|extra|bigger|stronger)\s+([\p{L}'-]+)/iu,
  /(?<![\p{L}])(?:יותר|הרבה\s+יותר|קצת\s+יותר|עוד)\s+([\p{L}'-]+)/u,
  /(?<![\p{L}])([\p{L}'-]+)\s+יותר(?![\p{L}])/u,
];

const STOP_WORDS = new Set([
  "the", "a", "an", "it", "this", "that", "so", "very", "much", "of", "in", "on", "to", "is", "be",
  "את", "של", "זה", "זאת", "הזה", "הזאת", "כזה", "כזאת", "מאוד", "ממש", "קצת", "עם", "על",
]);

type Subject = { canonical: string; entry: LexiconEntry | null };

function normaliseSubject(raw: string): Subject | null {
  const bare = raw.toLowerCase().replace(/^[\s"'“”‘’(]+|[\s"'“”‘’).,!?;:]+$/g, "");
  if (!bare || STOP_WORDS.has(bare)) return null;
  const structural = STRUCTURE_WORDS[bare] ?? STRUCTURE_WORDS[stripHebrewPrefix(bare, (c) => c in STRUCTURE_WORDS)];
  if (structural) return { canonical: structural, entry: null };
  const stripped = stripHebrewPrefix(bare, (c) => lookupWord(c) !== null);
  const entry = lookupWord(stripped);
  return { canonical: entry ? entry.value : stripped, entry };
}

// ---------------------------------------------------------------------------
// References
// ---------------------------------------------------------------------------

const REFERENCE_PATTERNS: RegExp[] = [
  /\b(?:in\s+the\s+style\s+of|in\s+the\s+spirit\s+of|similar\s+to|inspired\s+by|reminiscent\s+of|sounds?\s+like|like|a\s+la|à\s+la)\s+(.+)$/iu,
  /(?<![\p{L}])(?:בסגנון\s+של|בסגנון|בהשראת|דומה\s+ל|מזכיר\s+את|מזכירה\s+את|כמו\s+ב|כמו)\s*(.+)$/u,
];
const ASPECT_PATTERN = /^(?:the\s+)?(drums|groove|sound|vibe|arrangement|energy|feel|production|vocals|strings|bass|harmony|tempo|התופים|הגרוב|הסאונד|העיבוד|האנרגיה|הבס|ההרמוניה)\s+(?:of|from|של|מ)\s*(.+)$/iu;
const QUOTE_PATTERN = /["“”«]([^"“”«»]{2,80})["”»]/gu;

function extractReferences(clause: string, startId: number): IntentReference[] {
  const refs: IntentReference[] = [];
  let seq = startId;
  const seen = new Set<string>();
  const push = (label: string, kind: IntentReference["kind"], evidence: string, aspect?: string) => {
    const clean = label.trim().replace(/^(?:the\s+song|the\s+track|the\s+artist|a\s+|an\s+|the\s+|ה)\s*/iu, "").trim();
    if (!clean || seen.has(clean.toLowerCase())) return;
    // A "reference" made only of vocabulary words is a description, not a reference.
    const words = clean.split(/\s+/);
    if (words.every((w) => lookupWord(stripHebrewPrefix(w, (c) => lookupWord(c) !== null)) !== null)) return;
    seen.add(clean.toLowerCase());
    refs.push({ id: `ref-${seq++}`, kind, label: clean, ...(aspect ? { aspect } : {}), evidence });
  };
  for (const pattern of REFERENCE_PATTERNS) {
    const match = pattern.exec(clause);
    if (!match) continue;
    const rest = match[1].trim();
    const aspect = ASPECT_PATTERN.exec(rest);
    if (aspect) push(aspect[2], "description", match[0], aspect[1].toLowerCase());
    else push(rest, "description", match[0]);
  }
  for (const match of clause.matchAll(QUOTE_PATTERN)) push(match[1], "song", match[0]);
  return refs;
}

// ---------------------------------------------------------------------------
// Deterministic extraction
// ---------------------------------------------------------------------------

type Draft = {
  inferences: IntentInference[];
  constraints: IntentConstraint[];
  references: IntentReference[];
  sectionRequests: IntentSectionRequest[];
  unresolved: Set<string>;
};

function scopeKey(scope: IntentScope): string {
  return JSON.stringify(scope);
}

function addInference(draft: Draft, next: Omit<IntentInference, "id">): IntentInference {
  const existing = draft.inferences.find(
    (i) => i.slot === next.slot && i.value === next.value && scopeKey(i.scope) === scopeKey(next.scope),
  );
  if (existing) {
    for (const ev of next.evidence) if (!existing.evidence.includes(ev)) existing.evidence.push(ev);
    if (next.confidence > existing.confidence) {
      existing.confidence = next.confidence;
      existing.provenance = next.provenance;
    }
    return existing;
  }
  const created: IntentInference = { id: `inf-${draft.inferences.length + 1}`, ...next };
  draft.inferences.push(created);
  return created;
}

function addConstraint(draft: Draft, next: Omit<IntentConstraint, "id">): IntentConstraint {
  const existing = draft.constraints.find(
    (c) => c.kind === next.kind && c.subject === next.subject && scopeKey(c.scope) === scopeKey(next.scope),
  );
  if (existing) return existing;
  const created: IntentConstraint = { id: `con-${draft.constraints.length + 1}`, ...next };
  draft.constraints.push(created);
  return created;
}

function extractClause(draft: Draft, clause: string): void {
  const sectionHits = findSectionHits(clause);
  const scopes: IntentScope[] = sectionHits.length
    ? sectionHits.map((h) => ({ kind: "section", section: h.ref }))
    : [{ kind: "global" }];
  const clauseInferenceIds: string[] = [];
  const clauseConstraintIds: string[] = [];

  // Anything a negation consumes is blanked before positive matching so a
  // ruled-out word can never come back as a style.
  let positive = clause;
  for (const hit of sectionHits) positive = positive.replace(hit.span, " ".repeat(hit.span.length));
  const blank = (span: string) => {
    const at = positive.toLowerCase().indexOf(span.toLowerCase());
    if (at >= 0) positive = positive.slice(0, at) + " ".repeat(span.length) + positive.slice(at + span.length);
  };

  for (const { kind, pattern, bare } of NEGATION_PATTERNS) {
    const match = pattern.exec(positive);
    if (!match) continue;
    const subject = normaliseSubject(match[1]);
    if (!subject) continue;
    if (bare && !subject.entry && !(subject.canonical in STRUCTURE_WORDS)) continue;
    for (const scope of scopes) {
      const created = addConstraint(draft, {
        kind, subject: subject.canonical, statement: match[0].trim(), scope,
        confidence: subject.entry ? 0.85 : 0.6, provenance: "stated",
      });
      clauseConstraintIds.push(created.id);
    }
    blank(match[0]);
  }

  // "more X" — a positive request. Known words become stated inferences;
  // unknown ones are surfaced, never guessed.
  for (const pattern of BOOST_PATTERNS) {
    const match = pattern.exec(positive);
    if (!match) continue;
    const subject = normaliseSubject(match[1]);
    if (!subject) continue;
    if (subject.entry) {
      for (const scope of scopes) {
        const created = addInference(draft, {
          slot: subject.entry.slot, value: subject.entry.value,
          confidence: subject.entry.confidence ?? 0.85, provenance: "stated",
          evidence: [match[0].trim()], scope,
        });
        clauseInferenceIds.push(created.id);
      }
      blank(match[0]);
    } else if (subject.canonical in STRUCTURE_WORDS) {
      for (const scope of scopes) {
        const created = addConstraint(draft, {
          kind: "require", subject: STRUCTURE_WORDS[subject.canonical] ?? subject.canonical,
          statement: match[0].trim(), scope, confidence: 0.7, provenance: "stated",
        });
        clauseConstraintIds.push(created.id);
      }
      blank(match[0]);
    } else {
      draft.unresolved.add(subject.canonical);
    }
  }

  // Tempo in BPM is the one number worth reading.
  const bpm = /(\d{2,3})\s*bpm/iu.exec(positive);
  if (bpm) {
    for (const scope of scopes) {
      const created = addInference(draft, {
        slot: "tempo_bpm", value: bpm[1], confidence: 0.95, provenance: "stated",
        evidence: [bpm[0]], scope,
      });
      clauseInferenceIds.push(created.id);
    }
    blank(bpm[0]);
  }

  // References before the lexicon so a referenced title's words are not read
  // as descriptors of the arrangement.
  const references = extractReferences(positive, draft.references.length + 1);
  for (const ref of references) {
    draft.references.push(ref);
    if (ref.evidence) blank(ref.evidence);
  }

  for (const hit of findLexiconHits(positive)) {
    for (const scope of scopes) {
      const created = addInference(draft, {
        slot: hit.entry.slot, value: hit.entry.value,
        confidence: hit.entry.confidence ?? 0.85, provenance: "stated",
        evidence: [hit.span], scope,
      });
      clauseInferenceIds.push(created.id);
      for (const implied of hit.entry.implies ?? []) {
        const derived = addInference(draft, {
          slot: implied.slot, value: implied.value, confidence: implied.confidence,
          provenance: "inferred", evidence: [hit.span], scope,
        });
        clauseInferenceIds.push(derived.id);
      }
    }
  }

  for (const hit of sectionHits) {
    draft.sectionRequests.push({
      id: `secreq-${draft.sectionRequests.length + 1}`,
      section: hit.ref,
      text: clause,
      inferenceIds: [...new Set(clauseInferenceIds)],
      constraintIds: [...new Set(clauseConstraintIds)],
    });
  }
}

function finish(
  draft: Draft,
  text: string,
  options: ExtractIntentOptions,
  method: string,
): UserIntent {
  for (const ref of options.references ?? []) {
    if (draft.references.some((r) => r.label.toLowerCase() === ref.label.toLowerCase())) continue;
    draft.references.push({ id: `ref-${draft.references.length + 1}`, ...ref });
  }
  const scored = [
    ...draft.inferences.map((i) => i.confidence),
    ...draft.constraints.map((c) => c.confidence),
  ];
  const confidence = scored.length
    ? round3(clamp01(scored.reduce((a, b) => a + b, 0) / scored.length))
    : 0;
  return {
    version: USER_INTENT_VERSION,
    derivedAt: (options.now ?? new Date()).toISOString(),
    inputsDigestSha256: intentInputsDigest(text, options.references),
    method,
    rawText: text,
    language: detectLanguage(text),
    inferences: draft.inferences.map((i) => ({ ...i, confidence: round3(i.confidence) })),
    constraints: draft.constraints.map((c) => ({ ...c, confidence: round3(c.confidence) })),
    references: draft.references,
    sectionRequests: draft.sectionRequests,
    unresolvedTerms: [...draft.unresolved].sort(),
    confidence,
  };
}

/** The deterministic extractor. Synchronous; no model involved. */
export function extractUserIntentSync(
  text: string,
  options: Omit<ExtractIntentOptions, "llm"> = {},
): UserIntent {
  const draft: Draft = {
    inferences: [], constraints: [], references: [], sectionRequests: [], unresolved: new Set(),
  };
  for (const clause of splitClauses(text)) extractClause(draft, clause);
  return finish(draft, text, options, METHOD);
}

// ---------------------------------------------------------------------------
// Model output validation and merge
// ---------------------------------------------------------------------------

const SCHEMA_HINT = JSON.stringify({
  inferences: [{ slot: SLOT_NAMES.join("|"), value: "string", confidence: 0.8, evidence: ["verbatim span"], section: { function: "chorus", ordinal: 2 } }],
  constraints: [{ kind: "avoid|limit|require|keep", subject: "string", statement: "verbatim span", section: null }],
  references: [{ kind: "song|artist|recording|playlist|description", label: "string", aspect: "string|null", evidence: "verbatim span" }],
});

const INSTRUCTIONS = [
  "Read the producer's request about a song arrangement and return JSON only.",
  "Every inference and constraint must quote a verbatim span of the text as evidence; anything without such evidence will be discarded.",
  "Negations ('not too poppy', 'no drums') are constraints, never styles.",
  "Do not guess what was not said. Leave absent what you cannot infer.",
].join("\n");

const isRecord = (v: unknown): v is Record<string, unknown> => !!v && typeof v === "object" && !Array.isArray(v);

function verbatim(text: string, span: unknown): span is string {
  return typeof span === "string" && span.trim().length > 0 && text.toLowerCase().includes(span.trim().toLowerCase());
}

function scopeFromModel(text: string, raw: unknown): IntentScope {
  if (!isRecord(raw)) return { kind: "global" };
  const fn = typeof raw.function === "string" ? raw.function : "unknown";
  const valid = SECTION_TERMS.some((s) => s.function === fn);
  const ordinal = raw.ordinal === "last" || raw.ordinal === "all"
    ? raw.ordinal
    : typeof raw.ordinal === "number" && Number.isInteger(raw.ordinal) && raw.ordinal > 0
      ? raw.ordinal
      : "all";
  void text;
  return valid
    ? { kind: "section", section: { function: fn as IntentSectionRef["function"], ordinal } }
    : { kind: "global" };
}

/**
 * Keep only model output that the text literally supports. Model inferences
 * are `inferred` at most 0.85 confidence — the model reads, it does not know.
 */
export function validateModelIntent(
  raw: unknown,
  text: string,
): { inferences: Array<Omit<IntentInference, "id">>; constraints: Array<Omit<IntentConstraint, "id">>; references: Array<Omit<IntentReference, "id">>; rejected: number } {
  const out = { inferences: [] as Array<Omit<IntentInference, "id">>, constraints: [] as Array<Omit<IntentConstraint, "id">>, references: [] as Array<Omit<IntentReference, "id">>, rejected: 0 };
  if (!isRecord(raw)) return { ...out, rejected: 1 };
  for (const item of Array.isArray(raw.inferences) ? raw.inferences : []) {
    if (!isRecord(item) || !SLOT_NAMES.includes(item.slot as IntentSlotName) || typeof item.value !== "string") { out.rejected += 1; continue; }
    const evidence = (Array.isArray(item.evidence) ? item.evidence : []).filter((s): s is string => verbatim(text, s)).map((s) => s.trim());
    if (evidence.length === 0) { out.rejected += 1; continue; }
    const confidence = typeof item.confidence === "number" ? clamp01(Math.min(0.85, item.confidence)) : 0.6;
    out.inferences.push({
      slot: item.slot as IntentSlotName, value: item.value.trim().toLowerCase().replace(/\s+/g, "_"),
      confidence, provenance: "inferred", evidence, scope: scopeFromModel(text, item.section),
    });
  }
  for (const item of Array.isArray(raw.constraints) ? raw.constraints : []) {
    const kinds: IntentConstraint["kind"][] = ["avoid", "limit", "require", "keep"];
    if (!isRecord(item) || !kinds.includes(item.kind as IntentConstraint["kind"]) || typeof item.subject !== "string" || !verbatim(text, item.statement)) { out.rejected += 1; continue; }
    const subject = normaliseSubject(item.subject);
    if (!subject) { out.rejected += 1; continue; }
    out.constraints.push({
      kind: item.kind as IntentConstraint["kind"], subject: subject.canonical, statement: (item.statement as string).trim(),
      scope: scopeFromModel(text, item.section), confidence: 0.75, provenance: "inferred",
    });
  }
  for (const item of Array.isArray(raw.references) ? raw.references : []) {
    const kinds: IntentReference["kind"][] = ["song", "artist", "recording", "playlist", "description"];
    if (!isRecord(item) || typeof item.label !== "string" || !item.label.trim() || !verbatim(text, item.evidence)) { out.rejected += 1; continue; }
    out.references.push({
      kind: kinds.includes(item.kind as IntentReference["kind"]) ? item.kind as IntentReference["kind"] : "description",
      label: item.label.trim(), ...(typeof item.aspect === "string" && item.aspect ? { aspect: item.aspect } : {}),
      evidence: (item.evidence as string).trim(),
    });
  }
  return out;
}

/**
 * Extract intent with the deterministic extractor, then let an injected model
 * (if any) add what the heuristics missed — subject to the same evidence rule.
 * Deterministic results are never removed by the model.
 */
export async function extractUserIntent(
  text: string,
  options: ExtractIntentOptions = {},
): Promise<UserIntent> {
  const base = extractUserIntentSync(text, options);
  if (!options.llm || !text.trim()) return base;
  let raw: unknown;
  try {
    raw = await options.llm.complete({ instructions: INSTRUCTIONS, text, schemaHint: SCHEMA_HINT });
  } catch {
    return base;
  }
  const validated = validateModelIntent(raw, text);
  const draft: Draft = {
    inferences: base.inferences.map((i) => ({ ...i, evidence: [...i.evidence] })),
    constraints: [...base.constraints],
    references: [...base.references],
    sectionRequests: [...base.sectionRequests],
    unresolved: new Set(base.unresolvedTerms),
  };
  for (const inference of validated.inferences) {
    const existing = draft.inferences.find((i) => i.slot === inference.slot && i.value === inference.value && scopeKey(i.scope) === scopeKey(inference.scope));
    if (existing) continue; // the deterministic reading stands; it already has evidence
    addInference(draft, inference);
    for (const ev of inference.evidence) draft.unresolved.delete(ev.toLowerCase());
  }
  for (const constraint of validated.constraints) addConstraint(draft, constraint);
  for (const reference of validated.references) {
    if (draft.references.some((r) => r.label.toLowerCase() === reference.label.toLowerCase())) continue;
    draft.references.push({ id: `ref-${draft.references.length + 1}`, ...reference });
  }
  return finish(draft, text, options, `${METHOD}+${options.llm.id}`);
}

/** Inferences and constraints scoped to a given section function/ordinal. */
export function intentForSection(
  intent: UserIntent,
  section: IntentSectionRef,
): { inferences: IntentInference[]; constraints: IntentConstraint[] } {
  const matches = (scope: IntentScope): boolean =>
    scope.kind === "section" &&
    scope.section.function === section.function &&
    (scope.section.ordinal === section.ordinal || scope.section.ordinal === "all");
  return {
    inferences: intent.inferences.filter((i) => matches(i.scope)),
    constraints: intent.constraints.filter((c) => matches(c.scope)),
  };
}

export { LEXICON };
