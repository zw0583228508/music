/**
 * Preference events (PR-28) — the learning system's rights-cleared memory.
 *
 * The producer-decision ledger says *that* the owner chose; a preference event
 * says what the choice was *about*, in the only form that is safe to learn
 * from: content-free fingerprint features (PR-27) of the subject and, for a
 * comparison, of the alternative, plus the critic/ranking scores and the
 * outcome. Nothing in an event can rebuild a note.
 *
 * Three guarantees, each tested:
 *   - consent: writes go through the same learning controls as the ledger
 *     (`learningWriteAllowed`); a disabled owner produces no event;
 *   - rights: every event names its basis; only platform-generated material,
 *     the owner's own uploads, or a bare fingerprint qualify;
 *   - content-free: `assertContentFree` runs on every stored row.
 *
 * The store is injectable so the logic is tested without a database; the
 * Drizzle store lives in `preferenceEventsDbStore.ts`.
 */
import { createHash, randomUUID } from "node:crypto";
import type {
  PreferenceEvent,
  PreferenceEventKind,
  PreferenceFeatureVector,
  PreferenceRightsBasis,
  PreferenceSubject,
  PreferenceSubjectKind,
  ProducerDecisionSource,
  StyleFingerprint,
} from "@workspace/db";
import { learningWriteAllowed, type LearningControls } from "./learningPolicy";
import { assertContentFree } from "./styleFingerprint";

export type { LearningControls };

export const PREFERENCE_EVENTS_VERSION = "1.0" as const;

/** Fixed feature order: the training pipeline (PR-31) depends on it staying stable. */
export const FEATURE_NAMES = [
  "tempo.bpm", "tempo.stability",
  "groove.swingRatio", "groove.microtimingMs", "groove.syncopation", "groove.onsetDensity",
  "groove.subdivisions.quarter", "groove.subdivisions.eighth", "groove.subdivisions.sixteenth", "groove.subdivisions.triplet",
  "harmony.chordsPerBar", "harmony.extensionShare", "harmony.functionalMotion", "harmony.keyChanges",
  "melodicShape.rangeSemitones", "melodicShape.stepwiseRatio", "melodicShape.leapRatio", "melodicShape.meanIntervalSemitones",
  "melodicShape.phraseLengthBeats", "melodicShape.ornamentDensity",
  "register.low", "register.mid", "register.high",
  "dynamics.velocityP10", "dynamics.velocityP90",
  "density.notesPerBarMean", "density.notesPerBarP10", "density.notesPerBarP90",
  "energyArc.0", "energyArc.1", "energyArc.2", "energyArc.3", "energyArc.4", "energyArc.5", "energyArc.6", "energyArc.7",
  "instrumentation.trackCount", "instrumentation.familyCount",
  "sectionCount", "durationSeconds",
] as const;

export function fingerprintFeatureVector(fingerprint: StyleFingerprint): PreferenceFeatureVector {
  const pick = (path: string): number => {
    if (path === "instrumentation.familyCount") return Object.keys(fingerprint.instrumentation.familyShare).length;
    let node: unknown = fingerprint;
    for (const part of path.split(".")) node = (node as Record<string, unknown> | undefined)?.[part];
    return typeof node === "number" && Number.isFinite(node) ? node : 0;
  };
  const vector: PreferenceFeatureVector = {};
  for (const name of FEATURE_NAMES) vector[name] = pick(name);
  return vector;
}

export function featureDelta(subject: PreferenceFeatureVector, compared: PreferenceFeatureVector): PreferenceFeatureVector {
  const delta: PreferenceFeatureVector = {};
  for (const name of FEATURE_NAMES) delta[name] = Number(((subject[name] ?? 0) - (compared[name] ?? 0)).toFixed(4)) + 0;
  return delta;
}

// ---------------------------------------------------------------------------

export type PreferenceSubjectInput = {
  kind: PreferenceSubjectKind;
  id: string;
  fingerprint: StyleFingerprint | null;
  rankingScore?: number | null;
  criticScore?: number | null;
  modelVersion?: string | null;
  /** How this subject came to exist; decides the rights basis. */
  origin: "platform_generated" | "owner_upload" | "third_party";
};

export type RecordPreferenceEventInput = {
  ownerId: string;
  projectId: string;
  decisionId?: string | null;
  kind: PreferenceEventKind;
  source: ProducerDecisionSource;
  subject: PreferenceSubjectInput;
  compared?: PreferenceSubjectInput | null;
  preferred?: "subject" | "compared" | null;
  rating?: number | null;
  reasons?: string[];
  now?: Date;
};

export interface PreferenceEventStore {
  learningControls(ownerId: string): Promise<LearningControls>;
  insert(event: PreferenceEvent): Promise<PreferenceEvent>;
  list(ownerId: string, options?: { projectId?: string; limit?: number }): Promise<PreferenceEvent[]>;
  erase(ownerId: string, projectId?: string): Promise<number>;
}

/** Rights basis: the strictest that applies. A third party's material only ever reaches learning as a fingerprint. */
export function rightsBasisFor(subject: PreferenceSubjectInput, compared?: PreferenceSubjectInput | null): PreferenceRightsBasis {
  const origins = [subject.origin, ...(compared ? [compared.origin] : [])];
  if (origins.includes("third_party")) return "fingerprint_only";
  if (origins.includes("owner_upload")) return "owner_upload";
  return "platform_generated";
}

const digestOf = (fingerprint: StyleFingerprint | null) =>
  fingerprint ? createHash("sha256").update(JSON.stringify(fingerprint)).digest("hex") : null;

function toSubject(input: PreferenceSubjectInput): PreferenceSubject {
  return {
    kind: input.kind, id: input.id, fingerprintDigest: input.fingerprint?.inputsDigestSha256 ?? digestOf(input.fingerprint),
    rankingScore: Number.isFinite(input.rankingScore ?? NaN) ? (input.rankingScore as number) : null,
    criticScore: Number.isFinite(input.criticScore ?? NaN) ? (input.criticScore as number) : null,
    modelVersion: input.modelVersion ?? null,
  };
}

/** Build the event without storing it: pure, so the guarantees are testable in isolation. */
export function buildPreferenceEvent(input: RecordPreferenceEventInput): PreferenceEvent {
  const subjectFeatures = input.subject.fingerprint ? fingerprintFeatureVector(input.subject.fingerprint) : {};
  const comparedFeatures = input.compared?.fingerprint ? fingerprintFeatureVector(input.compared.fingerprint) : null;
  if (input.kind === "pairwise" && !input.compared) throw new Error("a pairwise preference event needs a compared subject");
  if (input.kind === "pairwise" && !input.preferred) throw new Error("a pairwise preference event needs a preferred side");
  const event: PreferenceEvent = {
    id: `pref-${randomUUID()}`,
    ownerId: input.ownerId, projectId: input.projectId, decisionId: input.decisionId ?? null,
    kind: input.kind, source: input.source,
    rightsBasis: rightsBasisFor(input.subject, input.compared),
    subject: toSubject(input.subject),
    compared: input.compared ? toSubject(input.compared) : null,
    outcome: {
      preferred: input.kind === "pairwise" ? input.preferred ?? null : null,
      rating: Number.isFinite(input.rating ?? NaN) ? (input.rating as number) : null,
      reasons: (input.reasons ?? []).map((r) => r.trim()).filter(Boolean).slice(0, 20).map((r) => r.slice(0, 200)),
    },
    features: {
      subject: subjectFeatures,
      compared: comparedFeatures,
      delta: comparedFeatures ? featureDelta(subjectFeatures, comparedFeatures) : null,
    },
    createdAt: (input.now ?? new Date()).toISOString(),
  };
  // Reasons are the owner's own words about their own choice; everything else must be statistics.
  assertContentFree({ subject: event.subject, compared: event.compared, features: event.features });
  return event;
}

/**
 * Record an event, or return null when the owner's learning controls forbid
 * it. Objective evidence (critic measurements) is always allowed, as in the
 * ledger; explicit feedback needs learning on; inferred behaviour needs both.
 */
export async function recordPreferenceEvent(store: PreferenceEventStore, input: RecordPreferenceEventInput): Promise<PreferenceEvent | null> {
  const controls = await store.learningControls(input.ownerId);
  if (!learningWriteAllowed(controls, input.source)) return null;
  return store.insert(buildPreferenceEvent(input));
}

/**
 * A selection among siblings is N−1 pairwise events: the chosen candidate over
 * each alternative the owner saw and did not choose.
 */
export async function recordSelectionAmongSiblings(store: PreferenceEventStore, input: {
  ownerId: string; projectId: string; decisionId?: string | null; source: ProducerDecisionSource;
  selected: PreferenceSubjectInput; siblings: PreferenceSubjectInput[]; now?: Date;
}): Promise<PreferenceEvent[]> {
  const events: PreferenceEvent[] = [];
  for (const sibling of input.siblings) {
    if (sibling.id === input.selected.id) continue;
    const event = await recordPreferenceEvent(store, {
      ownerId: input.ownerId, projectId: input.projectId, decisionId: input.decisionId, kind: "pairwise", source: input.source,
      subject: input.selected, compared: sibling, preferred: "subject", now: input.now,
    });
    if (event) events.push(event);
  }
  return events;
}

/** Training export rows (PR-31): fixed columns, content-free, owner-scoped. */
export function trainingRows(events: readonly PreferenceEvent[]): Array<Record<string, unknown>> {
  return events.map((event) => ({
    id: event.id, kind: event.kind, source: event.source, rightsBasis: event.rightsBasis, createdAt: event.createdAt,
    preferred: event.outcome.preferred, rating: event.outcome.rating,
    subjectKind: event.subject.kind, subjectCritic: event.subject.criticScore, subjectRanking: event.subject.rankingScore,
    comparedKind: event.compared?.kind ?? null, comparedCritic: event.compared?.criticScore ?? null, comparedRanking: event.compared?.rankingScore ?? null,
    features: FEATURE_NAMES.map((name) => event.features.subject[name] ?? 0),
    comparedFeatures: event.features.compared ? FEATURE_NAMES.map((name) => event.features.compared![name] ?? 0) : null,
    delta: event.features.delta ? FEATURE_NAMES.map((name) => event.features.delta![name] ?? 0) : null,
  }));
}

/** An in-memory store for tests and dry runs. */
export class MemoryPreferenceEventStore implements PreferenceEventStore {
  readonly events: PreferenceEvent[] = [];
  constructor(private readonly controls: LearningControls = { learningEnabled: true, inferredBehaviorEnabled: true }) {}
  async learningControls(): Promise<LearningControls> { return this.controls; }
  async insert(event: PreferenceEvent): Promise<PreferenceEvent> { this.events.push(event); return event; }
  async list(ownerId: string, options: { projectId?: string; limit?: number } = {}): Promise<PreferenceEvent[]> {
    return this.events.filter((e) => e.ownerId === ownerId && (!options.projectId || e.projectId === options.projectId)).slice(-(options.limit ?? 100)).reverse();
  }
  async erase(ownerId: string, projectId?: string): Promise<number> {
    const before = this.events.length;
    for (let i = this.events.length - 1; i >= 0; i -= 1) {
      if (this.events[i].ownerId === ownerId && (!projectId || this.events[i].projectId === projectId)) this.events.splice(i, 1);
    }
    return before - this.events.length;
  }
}
