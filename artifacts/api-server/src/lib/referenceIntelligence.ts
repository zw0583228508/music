/**
 * Reference intelligence (Wave U, PR-U4).
 *
 * A reference the user names or uploads becomes a durable row per project
 * (`music_reference_tracks`). Three rules, each enforced here and tested:
 *
 *   1. The fingerprint is the only thing learning reads (PR-27). A named
 *      reference ("like a Yosef Karduner song") has no audio and no
 *      fingerprint: it stays a label carrying a copy scope and a rights note.
 *      An uploaded reference is one of the owner's own project uploads,
 *      analysed by the same path as any project source; only its content-free
 *      fingerprint is read from it.
 *   2. Scope gates everything. `allowedScopes` (groove / sound / arrangement /
 *      mood) is what the user allowed to be copied; `dimensionsFromFingerprint`
 *      contributes only inside those scopes, and `sound` is empty until audio
 *      features exist. Disallowed scopes contribute nothing.
 *   3. A reference never outranks the user. Its dimensions enter the profile
 *      as `inferred` (below `stated` and `researched`) with `reference:<fp>`
 *      refs, and a value that contradicts what the user said — or what their
 *      own words imply through the universal vocabulary — is withheld, the
 *      same guard PR-U3 applies to research.
 *
 * Everything here is store-agnostic; `referenceIntelligenceDbStore.ts` is the
 * Drizzle side and `producerChat.ts` wires it into the brief pipeline.
 */
import type {
  ClarificationAnswer,
  ClarificationQuestion,
  FingerprintComparison,
  IntentReference,
  PlanExplanation,
  ReferenceCopyScope,
  ReferenceTrackKind,
  SongModelData,
  StyleDimensionName,
  StyleDimensionValue,
  StyleFingerprint,
  StyleProfile,
  TrackModel,
  UserIntent,
} from "@workspace/db";
import type { StyleKnowledgeFinding, StyleKnowledgeSource } from "./producerIntelligence/styleResolution";
import { statedImpliedValues } from "./producerIntelligence/styleResearch";
import { compareFingerprints, deriveStyleFingerprint, dimensionsFromFingerprint } from "./styleFingerprint";

export const REFERENCE_INTELLIGENCE_METHOD = "reference-intelligence/v1 (scoped, content-free fingerprints; inferred rank)";
export const REFERENCE_COPY_SCOPES: readonly ReferenceCopyScope[] = ["groove", "sound", "arrangement", "mood"];
/** PR-U1's detector ids: `reference_aspect_<intent reference id>` with options `aspect_<scope>`. */
export const REFERENCE_ASPECT_QUESTION_PREFIX = "reference_aspect_";
export const REFERENCE_ASPECT_OPTION_PREFIX = "aspect_";
export const MAX_REFERENCE_LABEL_LENGTH = 200;
export const MAX_RIGHTS_NOTE_LENGTH = 500;

// ---------------------------------------------------------------------------
// Records and store contract
// ---------------------------------------------------------------------------

export type ReferenceTrackRecord = {
  id: string;
  projectId: string;
  ownerId: string | null;
  kind: ReferenceTrackKind;
  label: string;
  /** The owner's own upload (`music_project_sources`, any of their projects); null for a named reference. */
  sourceId: string | null;
  /** Version of that source's Song Model the fingerprint was taken from. */
  songModelVersion: number | null;
  /** The PR-27 fingerprint row; null until the upload is analysed and fingerprinted. */
  fingerprintId: string | null;
  allowedScopes: ReferenceCopyScope[];
  /** The user's own statement of what this is. Required for an uploaded reference. */
  rightsNote: string | null;
  createdAt: string;
  updatedAt: string;
};

/** `kind` / `sourceId` change only when a named reference is upgraded to one of the owner's uploads. */
export type ReferenceTrackPatch = Partial<Pick<ReferenceTrackRecord, "label" | "allowedScopes" | "rightsNote" | "fingerprintId" | "songModelVersion" | "kind" | "sourceId">>;

export type ReferenceSourceInfo = { id: string; projectId: string; ownerId: string; name: string; status: string };

/** A Song Model as the fingerprint needs it, with the project's tempo/meter as fallbacks. */
export type FingerprintableSongModel = { version: number; model: SongModelData; bpm?: number; meter?: string };

export type FingerprintableArrangement = {
  id: string;
  version: number | null;
  trackModels: TrackModel[];
  songModel: SongModelData | null;
  bpm?: number;
  meter?: string;
};

/** The persistence a reference needs. `producerChatDbStore.ts` implements it; the in-memory store below is for tests. */
export type ReferenceStore = {
  listReferences(projectId: string): Promise<ReferenceTrackRecord[]>;
  insertReference(record: ReferenceTrackRecord): Promise<void>;
  updateReference(projectId: string, referenceId: string, patch: ReferenceTrackPatch, updatedAt: string): Promise<ReferenceTrackRecord | null>;
  /** Removes the row and, when no other reference shares it, its `reference_upload` fingerprint row. Never touches project sources. */
  deleteReference(projectId: string, referenceId: string): Promise<boolean>;
  loadProjectSource(sourceId: string): Promise<ReferenceSourceInfo | null>;
  /** The latest ready Song Model analysed from that upload, whichever project it lives in. */
  loadSourceSongModel(sourceId: string): Promise<FingerprintableSongModel | null>;
  loadFingerprint(projectId: string, fingerprintId: string): Promise<StyleFingerprint | null>;
  /** Idempotent per (project, source kind, source id, inputs digest); returns the row id. */
  insertFingerprint(projectId: string, fingerprint: StyleFingerprint, createdBy: string | null): Promise<string>;
  /** The arrangement (given id, or the latest with TrackModels) with what its fingerprint needs. */
  loadArrangementForFingerprint(projectId: string, arrangementId?: string): Promise<FingerprintableArrangement | null>;
};

// ---------------------------------------------------------------------------
// Scopes
// ---------------------------------------------------------------------------

export function isReferenceCopyScope(value: unknown): value is ReferenceCopyScope {
  return typeof value === "string" && (REFERENCE_COPY_SCOPES as readonly string[]).includes(value);
}

/** Canonical order, deduplicated, unknown values dropped. */
export function normalizeScopes(values: readonly unknown[]): ReferenceCopyScope[] {
  const set = new Set(values.filter(isReferenceCopyScope));
  return REFERENCE_COPY_SCOPES.filter((s) => set.has(s));
}

/**
 * Only the scope words themselves (English and Hebrew) are read out of a
 * stated aspect. "the drums from X" names an instrument, not a scope — it is
 * not guessed into `groove`; the reference then contributes nothing until the
 * user picks a scope.
 */
const SCOPE_WORDS: ReadonlyArray<[ReferenceCopyScope, RegExp]> = [
  ["groove", /\bgroove\b|(?<![\p{L}])ה?גרוב(?![\p{L}])/iu],
  ["sound", /\bsound\b|(?<![\p{L}])ה?סאונד(?![\p{L}])/iu],
  ["arrangement", /\barrangement\b|(?<![\p{L}])ה?עיבוד(?![\p{L}])/iu],
  ["mood", /\b(?:mood|vibe|atmosphere)\b|(?<![\p{L}])ה?(?:אווירה|וייב)(?![\p{L}])/iu],
];

export function parseReferenceScopes(aspect: string | undefined | null): ReferenceCopyScope[] {
  if (!aspect) return [];
  return SCOPE_WORDS.filter(([, pattern]) => pattern.test(aspect)).map(([scope]) => scope);
}

/** The aspect string a scoped reference carries on the intent: "groove, mood". */
export const scopesAspect = (scopes: readonly ReferenceCopyScope[]): string => normalizeScopes(scopes).join(", ");

const labelKey = (label: string): string => label.trim().toLowerCase();

export function findReferenceByLabel<T extends { label: string }>(rows: readonly T[], label: string): T | undefined {
  const key = labelKey(label);
  return rows.find((r) => labelKey(r.label) === key);
}

// ---------------------------------------------------------------------------
// Rows ↔ intent
// ---------------------------------------------------------------------------

export type IntakeReferenceLike = Pick<IntentReference, "kind" | "label" | "aspect">;

/**
 * Rows as intake references, so a reference added through the API is part of
 * the next intent. The scope rides as the aspect so PR-U1's detector stops
 * asking once a scope is set (and so the intent digest changes with it).
 */
export function intakeReferencesFromRows(rows: readonly ReferenceTrackRecord[]): IntakeReferenceLike[] {
  return rows.map((r) => ({
    kind: r.kind === "uploaded_audio" ? "recording" : "song",
    label: r.label,
    ...(r.allowedScopes.length ? { aspect: scopesAspect(r.allowedScopes) } : {}),
  }));
}

/** First occurrence of a label wins (the extractor dedupes the same way). */
export function mergeIntakeReferences(...lists: ReadonlyArray<readonly IntakeReferenceLike[]>): IntakeReferenceLike[] {
  const out: IntakeReferenceLike[] = [];
  for (const list of lists) for (const ref of list) if (!findReferenceByLabel(out, ref.label)) out.push(ref);
  return out;
}

/**
 * The stored scope is the truth about what a reference may lend: it becomes
 * the intent reference's aspect wherever a row has one. A stated aspect that
 * parsed to no scope ("the drums") is left as the user said it.
 */
export function applyReferenceScopes(intent: UserIntent, rows: readonly ReferenceTrackRecord[]): UserIntent {
  if (!intent.references.length || !rows.length) return intent;
  let changed = false;
  const references = intent.references.map((ref) => {
    const row = findReferenceByLabel(rows, ref.label);
    if (!row || !row.allowedScopes.length) return ref;
    const aspect = scopesAspect(row.allowedScopes);
    if (ref.aspect === aspect) return ref;
    changed = true;
    return { ...ref, aspect };
  });
  return changed ? { ...intent, references } : intent;
}

export type NewReferenceContext = { projectId: string; ownerId?: string | null; now: Date; newId: () => string };

export function namedReferenceRecord(ref: IntakeReferenceLike & { rightsNote?: string | null }, ctx: NewReferenceContext): ReferenceTrackRecord {
  const at = ctx.now.toISOString();
  return {
    id: ctx.newId(), projectId: ctx.projectId, ownerId: ctx.ownerId ?? null, kind: "named", label: ref.label.trim(),
    sourceId: null, songModelVersion: null, fingerprintId: null,
    allowedScopes: parseReferenceScopes(ref.aspect), rightsNote: ref.rightsNote?.trim() || null,
    createdAt: at, updatedAt: at,
  };
}

/**
 * Durable rows for the references this version newly names — from the text
 * or the intake API — that have none yet. Only *new* references get a row,
 * so a reference the user deleted does not come back on the next turn: its
 * words stay in the intake as a label (PR-U1 behaviour) and nothing more.
 */
export function referenceRowsToCreate(
  newReferences: readonly IntentReference[],
  rows: readonly ReferenceTrackRecord[],
  ctx: NewReferenceContext,
): ReferenceTrackRecord[] {
  const out: ReferenceTrackRecord[] = [];
  for (const ref of newReferences) {
    if (!ref.label.trim()) continue;
    if (findReferenceByLabel(rows, ref.label) || findReferenceByLabel(out, ref.label)) continue;
    out.push(namedReferenceRecord(ref, ctx));
  }
  return out;
}

// ---------------------------------------------------------------------------
// The reference_aspect answer → scopes
// ---------------------------------------------------------------------------

export type ReferenceScopeAnswer = { referenceId: string; label: string; kind: IntentReference["kind"]; scopes: ReferenceCopyScope[] };

/**
 * PR-U1's question has one option per scope and the contract's answer shape
 * carries one option — so several answers to the same question in one call
 * are read as a multi-select (the union), and the rest can be toggled later.
 */
export function referenceScopeAnswers(
  open: readonly ClarificationQuestion[],
  answers: readonly ClarificationAnswer[],
  intent: Pick<UserIntent, "references">,
): ReferenceScopeAnswer[] {
  const byReference = new Map<string, ReferenceScopeAnswer>();
  for (const answer of answers) {
    if (!answer.questionId.startsWith(REFERENCE_ASPECT_QUESTION_PREFIX) || !answer.optionId) continue;
    if (!open.some((q) => q.id === answer.questionId)) continue;
    const referenceId = answer.questionId.slice(REFERENCE_ASPECT_QUESTION_PREFIX.length);
    const ref = intent.references.find((r) => r.id === referenceId);
    if (!ref) continue;
    const scope = answer.optionId.startsWith(REFERENCE_ASPECT_OPTION_PREFIX) ? answer.optionId.slice(REFERENCE_ASPECT_OPTION_PREFIX.length) : answer.optionId;
    if (!isReferenceCopyScope(scope)) continue;
    const entry = byReference.get(referenceId) ?? { referenceId, label: ref.label, kind: ref.kind, scopes: [] };
    entry.scopes = normalizeScopes([...entry.scopes, scope]);
    byReference.set(referenceId, entry);
  }
  return [...byReference.values()];
}

// ---------------------------------------------------------------------------
// Validation (rights are recorded, not assumed)
// ---------------------------------------------------------------------------

export type ReferenceInput = {
  kind: ReferenceTrackKind;
  label: string;
  sourceId?: string | null;
  allowedScopes?: readonly unknown[];
  rightsNote?: string | null;
};

/** A reason the input cannot become a row, or null. */
export function referenceInputProblem(input: ReferenceInput): string | null {
  const label = input.label?.trim() ?? "";
  if (!label) return "A reference needs a label";
  if (label.length > MAX_REFERENCE_LABEL_LENGTH) return `A reference label is at most ${MAX_REFERENCE_LABEL_LENGTH} characters`;
  if (input.kind !== "named" && input.kind !== "uploaded_audio") return `Unknown reference kind "${String(input.kind)}"`;
  if (input.allowedScopes?.some((s) => !isReferenceCopyScope(s))) return `Allowed scopes are ${REFERENCE_COPY_SCOPES.join(" / ")}`;
  if ((input.rightsNote?.length ?? 0) > MAX_RIGHTS_NOTE_LENGTH) return `A rights note is at most ${MAX_RIGHTS_NOTE_LENGTH} characters`;
  if (input.kind === "uploaded_audio") {
    if (!input.sourceId?.trim()) return "An uploaded reference needs the sourceId of one of your analysed uploads";
    if (!input.rightsNote?.trim()) return "An uploaded reference needs a rights note — say in your own words what this recording is (e.g. \"my own demo\", \"commercial track, for reference only\")";
  } else if (input.sourceId) {
    return "A named reference carries no upload; use kind uploaded_audio to attach one of your recordings";
  }
  return null;
}

// ---------------------------------------------------------------------------
// Fingerprints
// ---------------------------------------------------------------------------

/** The PR-27 fingerprint of an uploaded reference's Song Model (`sourceKind: reference_upload`). */
export function deriveReferenceFingerprint(row: ReferenceTrackRecord, songModel: FingerprintableSongModel, now: Date): StyleFingerprint {
  if (!row.sourceId) throw new Error("A named reference has no audio to fingerprint");
  return deriveStyleFingerprint({
    source: { kind: "reference_upload", id: row.sourceId, version: songModel.version, label: row.label },
    songModel: songModel.model, tempoBpm: songModel.bpm, meter: songModel.meter, now,
  });
}

export function deriveArrangementFingerprint(arrangement: FingerprintableArrangement, now: Date): StyleFingerprint {
  return deriveStyleFingerprint({
    source: { kind: "arrangement", id: arrangement.id, version: arrangement.version },
    trackModels: arrangement.trackModels, songModel: arrangement.songModel, tempoBpm: arrangement.bpm, meter: arrangement.meter, now,
  });
}

// ---------------------------------------------------------------------------
// Into the profile, by allowed scope, below what the user said
// ---------------------------------------------------------------------------

export type ReferenceWithheld = { dimension: StyleDimensionName; value: StyleDimensionValue; reason: string };

export type ReferenceContribution = {
  referenceId: string;
  label: string;
  fingerprintId: string;
  allowedScopes: ReferenceCopyScope[];
  /** Dimensions offered to the resolver (as `inferred`; the merge may still prefer a stated or researched value). */
  offered: StyleDimensionName[];
  /** Fingerprint values not offered because the user's own words already decide the dimension differently. */
  withheld: ReferenceWithheld[];
};

export type ReferenceKnowledge = { sources: StyleKnowledgeSource[]; contributions: ReferenceContribution[] };

const valueKey = (v: StyleDimensionValue): string => JSON.stringify(v);

/**
 * One knowledge source per fingerprinted, scoped reference (id `reference:<fp>`,
 * the same string the dimensions carry in `sourceRefs`), so
 * `StyleProfile.sources` lists the reference. A reference without a
 * fingerprint or without any allowed scope yields no source at all.
 */
export function referenceKnowledge(
  rows: readonly ReferenceTrackRecord[],
  fingerprints: ReadonlyMap<string, StyleFingerprint>,
  intent: UserIntent,
): ReferenceKnowledge {
  const sources: StyleKnowledgeSource[] = [];
  const contributions: ReferenceContribution[] = [];
  let stated: Map<StyleDimensionName, StyleDimensionValue> | null = null;
  for (const row of rows) {
    if (!row.fingerprintId || !row.allowedScopes.length) continue;
    const fingerprint = fingerprints.get(row.fingerprintId);
    if (!fingerprint) continue;
    const dimensions = dimensionsFromFingerprint(fingerprint, row.fingerprintId, row.allowedScopes);
    stated ??= statedImpliedValues(intent);
    const findings: StyleKnowledgeFinding[] = [];
    const withheld: ReferenceWithheld[] = [];
    for (const [name, dim] of Object.entries(dimensions) as Array<[StyleDimensionName, { value: StyleDimensionValue; confidence: number; sourceRefs: string[] }]>) {
      const said = stated.get(name);
      if (said !== undefined && valueKey(said) !== valueKey(dim.value)) {
        withheld.push({ dimension: name, value: dim.value, reason: `contradicts what the user said or their words imply (${String(said)})` });
        continue;
      }
      findings.push({ dimension: name, value: dim.value, confidence: dim.confidence, provenance: "inferred", sourceRefs: dim.sourceRefs });
    }
    sources.push({ id: `reference:${row.fingerprintId}`, lookup: () => findings });
    contributions.push({
      referenceId: row.id, label: row.label, fingerprintId: row.fingerprintId, allowedScopes: [...row.allowedScopes],
      offered: findings.map((f) => f.dimension), withheld,
    });
  }
  return { sources, contributions };
}

/** Dimensions of a stored profile that cite the reference's fingerprint (won or corroborated). */
export function dimensionsCiting(profile: Pick<StyleProfile, "dimensions">, fingerprintId: string): StyleDimensionName[] {
  const ref = `reference:${fingerprintId}`;
  return (Object.entries(profile.dimensions) as Array<[StyleDimensionName, { sourceRefs?: string[] }]>)
    .filter(([, dim]) => dim.sourceRefs?.includes(ref))
    .map(([name]) => name)
    .sort();
}

const humanise = (name: string): string => name.replace(/([A-Z])/g, " $1").toLowerCase().trim();
const list = (items: readonly string[]): string =>
  items.length <= 1 ? items.join("") : `${items.slice(0, -1).join(", ")} and ${items[items.length - 1]}`;

/** One data-derived sentence per contributing reference, for the producer's reply. */
export function describeReferenceContributions(contributions: readonly ReferenceContribution[]): string | null {
  const sentences: string[] = [];
  for (const c of contributions) {
    const parts: string[] = [];
    if (c.offered.length) parts.push(`${list(c.offered.map(humanise))} — marked inferred in the brief, below anything you said or research found`);
    if (c.withheld.length) parts.push(`withheld ${list(c.withheld.map((w) => `${humanise(w.dimension)} (${w.reason})`))}`);
    if (!parts.length) parts.push("nothing to offer inside the allowed scopes yet");
    sentences.push(`From your reference "${c.label}" (${list(c.allowedScopes)} allowed): ${parts.join("; ")}.`);
  }
  return sentences.length ? sentences.join(" ") : null;
}

// ---------------------------------------------------------------------------
// "How close is this to my reference?"
// ---------------------------------------------------------------------------

const CLOSENESS = /\b(?:close|far|similar|compare|compared|comparison|distance|match|matches|near|resemble|resembles)\b|(?<![\p{L}])(?:קרוב|קרובה|רחוק|רחוקה|דומה|להשוות|השוואה|מתאים|מתאימה)(?![\p{L}])/iu;
// Hebrew prefixes (ל/ב/מ/ה/ו/ש) attach to the noun: "לרפרנס", "והרפרנס".
const REFERENCE_WORD = /\breferences?\b|\bref\b|(?<![\p{L}])[לבמהוש]{0,2}רפרנס(?:ים)?(?![\p{L}])/iu;

/**
 * The fingerprinted reference a question is about: the one whose label the
 * text names, else the only one. Null when the question is not about
 * closeness to a reference, or no reference has a fingerprint.
 */
export function referenceForClosenessQuestion(text: string, rows: readonly ReferenceTrackRecord[]): ReferenceTrackRecord | null {
  if (!CLOSENESS.test(text)) return null;
  const fingerprinted = rows.filter((r) => r.fingerprintId);
  const lower = text.toLowerCase();
  const named = fingerprinted.find((r) => r.label.trim() && lower.includes(labelKey(r.label)));
  if (named) return named;
  if (!REFERENCE_WORD.test(text)) return null;
  return fingerprinted.length === 1 ? fingerprinted[0] : null;
}

export const isReferenceClosenessQuestion = (text: string, rows: readonly ReferenceTrackRecord[]): boolean =>
  CLOSENESS.test(text) && (REFERENCE_WORD.test(text) || rows.some((r) => r.label.trim() && text.toLowerCase().includes(labelKey(r.label))));

const inProducerWords = (summary: string): string =>
  summary.replace(/\bthe left\b/g, "the reference").replace(/\bthe right\b/g, "the arrangement");

/** PR-27's comparison in words: reference on the left, arrangement on the right. */
export function explainReferenceComparison(
  reference: Pick<ReferenceTrackRecord, "label">,
  arrangementId: string,
  comparison: FingerprintComparison,
): PlanExplanation {
  const ranked = [...comparison.deltas].filter((d) => d.distance > 0).sort((a, b) => b.distance - a.distance);
  const headline = comparison.headline.map(inProducerWords);
  const answer = ranked.length
    ? `Against "${reference.label}" this arrangement (${arrangementId}) sits at distance ${comparison.distance} on the content-free fingerprint (0 = the same behaviour, 1 = as different as the features allow). Biggest differences (reference vs arrangement): ${headline.join("; ")}.`
    : `Against "${reference.label}" this arrangement (${arrangementId}) reads the same on every fingerprint feature (distance 0).`;
  return {
    answered: true,
    answer,
    evidence: ranked.slice(0, 8).map((d) => ({ source: "reference.fingerprint", ref: d.feature, detail: inProducerWords(d.summary) })),
    // Deterministic feature arithmetic; the weights are hand-set (PR-27's limit), so not 1.
    confidence: 0.8,
  };
}

export function compareReferenceToArrangement(
  reference: ReferenceTrackRecord & { fingerprintId: string },
  referenceFingerprint: StyleFingerprint,
  arrangementFingerprintId: string,
  arrangementFingerprint: StyleFingerprint,
): FingerprintComparison {
  return compareFingerprints(referenceFingerprint, arrangementFingerprint, { leftId: reference.fingerprintId, rightId: arrangementFingerprintId });
}

// ---------------------------------------------------------------------------
// In-memory store (tests)
// ---------------------------------------------------------------------------

export type InMemoryReferenceSeed = {
  references?: ReferenceTrackRecord[];
  projectSources?: ReferenceSourceInfo[];
  /** Song Models by source id, as the analysis would have stored them. */
  sourceSongModels?: Record<string, FingerprintableSongModel>;
  arrangement?: FingerprintableArrangement | null;
};

export function createInMemoryReferenceStore(seed: InMemoryReferenceSeed = {}): ReferenceStore & {
  references: ReferenceTrackRecord[];
  fingerprints: Map<string, { projectId: string; fingerprint: StyleFingerprint }>;
  projectSources: ReferenceSourceInfo[];
} {
  const references = seed.references ?? [];
  const projectSources = seed.projectSources ?? [];
  const fingerprints = new Map<string, { projectId: string; fingerprint: StyleFingerprint }>();
  let sequence = 0;
  // Reads hand out copies, as a database would: a caller's row never changes
  // under it when another call updates the store.
  const copy = (r: ReferenceTrackRecord): ReferenceTrackRecord => ({ ...r, allowedScopes: [...r.allowedScopes] });
  return {
    references, fingerprints, projectSources,
    async listReferences(projectId) {
      return references.filter((r) => r.projectId === projectId).sort((a, b) => a.createdAt.localeCompare(b.createdAt) || a.id.localeCompare(b.id)).map(copy);
    },
    async insertReference(record) { references.push(copy(record)); },
    async updateReference(projectId, referenceId, patch, updatedAt) {
      const row = references.find((r) => r.projectId === projectId && r.id === referenceId);
      if (!row) return null;
      Object.assign(row, patch, { updatedAt });
      return copy(row);
    },
    async deleteReference(projectId, referenceId) {
      const index = references.findIndex((r) => r.projectId === projectId && r.id === referenceId);
      if (index < 0) return false;
      const [removed] = references.splice(index, 1);
      if (removed.fingerprintId && !references.some((r) => r.fingerprintId === removed.fingerprintId)) {
        const entry = fingerprints.get(removed.fingerprintId);
        if (entry?.fingerprint.source.kind === "reference_upload") fingerprints.delete(removed.fingerprintId);
      }
      return true;
    },
    async loadProjectSource(sourceId) { return projectSources.find((s) => s.id === sourceId) ?? null; },
    async loadSourceSongModel(sourceId) { return seed.sourceSongModels?.[sourceId] ?? null; },
    async loadFingerprint(projectId, fingerprintId) {
      const entry = fingerprints.get(fingerprintId);
      return entry && entry.projectId === projectId ? entry.fingerprint : null;
    },
    async insertFingerprint(projectId, fingerprint) {
      for (const [id, entry] of fingerprints) {
        if (entry.projectId === projectId && entry.fingerprint.source.kind === fingerprint.source.kind && entry.fingerprint.source.id === fingerprint.source.id && entry.fingerprint.inputsDigestSha256 === fingerprint.inputsDigestSha256) return id;
      }
      const id = `fp-${String(++sequence).padStart(3, "0")}`;
      fingerprints.set(id, { projectId, fingerprint });
      return id;
    },
    async loadArrangementForFingerprint(_projectId, arrangementId) {
      const arrangement = seed.arrangement ?? null;
      if (!arrangement || (arrangementId && arrangement.id !== arrangementId)) return null;
      return arrangement;
    },
  };
}
