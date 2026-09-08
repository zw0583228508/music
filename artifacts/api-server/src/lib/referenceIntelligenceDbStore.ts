/**
 * Drizzle-backed `ReferenceStore` (Wave U, PR-U4); the logic lives in
 * `referenceIntelligence.ts`. Reads the owner's project sources and their Song
 * Models (whichever project they live in), writes `music_reference_tracks`
 * and the PR-27 `music_style_fingerprints` rows a reference links to.
 *
 * `fingerprintPendingReferences` is the analysis-completion hook: when an
 * upload's Song Model is persisted, every reference that points at that
 * upload and has no fingerprint yet gets one. Best-effort — it never fails
 * the analysis.
 */
import { randomUUID } from "node:crypto";
import { and, desc, eq, sql } from "drizzle-orm";
import {
  arrangementsTable,
  db,
  musicProjectsTable,
  musicReferenceTracksTable,
  projectSourcesTable,
  songModelsTable,
  styleFingerprintsTable,
  type StyleFingerprint,
} from "@workspace/db";
import { logger } from "./logger";
import {
  deriveReferenceFingerprint,
  type FingerprintableSongModel,
  type ReferenceStore,
  type ReferenceTrackRecord,
} from "./referenceIntelligence";

type Database = typeof db;
type Executor = Database | Parameters<Parameters<Database["transaction"]>[0]>[0];

const iso = (value: Date): string => value.toISOString();

const toRecord = (row: typeof musicReferenceTracksTable.$inferSelect): ReferenceTrackRecord => ({
  id: row.id, projectId: row.projectId, ownerId: row.ownerId, kind: row.kind, label: row.label,
  sourceId: row.sourceId, songModelVersion: row.songModelVersion, fingerprintId: row.fingerprintId,
  allowedScopes: row.allowedScopes, rightsNote: row.rightsNote, createdAt: iso(row.createdAt), updatedAt: iso(row.updatedAt),
});

/** Idempotent per (project, source kind, source id, inputs digest) — the same rule as PR-27's route. */
export async function insertFingerprintRow(executor: Executor, projectId: string, fingerprint: StyleFingerprint, createdBy: string | null): Promise<string> {
  const [existing] = await executor.select({ id: styleFingerprintsTable.id }).from(styleFingerprintsTable).where(and(
    eq(styleFingerprintsTable.projectId, projectId),
    eq(styleFingerprintsTable.sourceKind, fingerprint.source.kind),
    eq(styleFingerprintsTable.sourceId, fingerprint.source.id),
    eq(styleFingerprintsTable.digest, fingerprint.inputsDigestSha256),
  )).limit(1);
  if (existing) return existing.id;
  const [created] = await executor.insert(styleFingerprintsTable).values({
    id: `fp-${randomUUID()}`, projectId, sourceKind: fingerprint.source.kind, sourceId: fingerprint.source.id,
    sourceVersion: fingerprint.source.version, digest: fingerprint.inputsDigestSha256, fingerprint, createdBy: createdBy ?? "system",
  }).returning({ id: styleFingerprintsTable.id });
  return created.id;
}

/** The latest ready Song Model analysed from an upload, with its project's tempo/meter as fingerprint fallbacks. */
export async function loadSourceSongModelRow(executor: Executor, sourceId: string): Promise<FingerprintableSongModel | null> {
  const [row] = await executor
    .select({ version: songModelsTable.version, model: songModelsTable.model, projectId: songModelsTable.projectId })
    .from(songModelsTable)
    .where(and(eq(songModelsTable.sourceId, sourceId), eq(songModelsTable.status, "ready")))
    .orderBy(desc(songModelsTable.version))
    .limit(1);
  if (!row) return null;
  const [project] = await executor.select({ bpm: musicProjectsTable.bpm, meter: musicProjectsTable.meter }).from(musicProjectsTable).where(eq(musicProjectsTable.id, row.projectId)).limit(1);
  return { version: row.version, model: row.model, ...(project?.bpm ? { bpm: project.bpm } : {}), ...(project?.meter ? { meter: project.meter } : {}) };
}

export function createReferenceDbStore(executor: Executor = db): ReferenceStore {
  return {
    async listReferences(projectId) {
      const rows = await executor.select().from(musicReferenceTracksTable)
        .where(eq(musicReferenceTracksTable.projectId, projectId))
        .orderBy(musicReferenceTracksTable.createdAt, musicReferenceTracksTable.id);
      return rows.map(toRecord);
    },

    async insertReference(record) {
      await executor.insert(musicReferenceTracksTable).values({
        id: record.id, projectId: record.projectId, ownerId: record.ownerId, kind: record.kind, label: record.label,
        sourceId: record.sourceId, songModelVersion: record.songModelVersion, fingerprintId: record.fingerprintId,
        allowedScopes: record.allowedScopes, rightsNote: record.rightsNote,
        createdAt: new Date(record.createdAt), updatedAt: new Date(record.updatedAt),
      });
    },

    async updateReference(projectId, referenceId, patch, updatedAt) {
      const [row] = await executor.update(musicReferenceTracksTable)
        .set({ ...patch, updatedAt: new Date(updatedAt) })
        .where(and(eq(musicReferenceTracksTable.projectId, projectId), eq(musicReferenceTracksTable.id, referenceId)))
        .returning();
      return row ? toRecord(row) : null;
    },

    async deleteReference(projectId, referenceId) {
      const [row] = await executor.delete(musicReferenceTracksTable)
        .where(and(eq(musicReferenceTracksTable.projectId, projectId), eq(musicReferenceTracksTable.id, referenceId)))
        .returning();
      if (!row) return false;
      // The fingerprint was the only thing learned from the reference; it
      // goes with it unless another reference row still points at it. Only
      // `reference_upload` rows are ever removed here — never the project's
      // own Song Model or arrangement fingerprints, never a project source.
      if (row.fingerprintId) {
        const [shared] = await executor.select({ id: musicReferenceTracksTable.id }).from(musicReferenceTracksTable)
          .where(and(eq(musicReferenceTracksTable.projectId, projectId), eq(musicReferenceTracksTable.fingerprintId, row.fingerprintId))).limit(1);
        if (!shared) {
          await executor.delete(styleFingerprintsTable).where(and(
            eq(styleFingerprintsTable.id, row.fingerprintId),
            eq(styleFingerprintsTable.projectId, projectId),
            eq(styleFingerprintsTable.sourceKind, "reference_upload"),
          ));
        }
      }
      return true;
    },

    async loadProjectSource(sourceId) {
      const [row] = await executor
        .select({ id: projectSourcesTable.id, projectId: projectSourcesTable.projectId, ownerId: projectSourcesTable.ownerId, name: projectSourcesTable.name, status: projectSourcesTable.status })
        .from(projectSourcesTable).where(eq(projectSourcesTable.id, sourceId)).limit(1);
      return row ?? null;
    },

    loadSourceSongModel: (sourceId) => loadSourceSongModelRow(executor, sourceId),

    async loadFingerprint(projectId, fingerprintId) {
      const [row] = await executor.select({ fingerprint: styleFingerprintsTable.fingerprint }).from(styleFingerprintsTable)
        .where(and(eq(styleFingerprintsTable.id, fingerprintId), eq(styleFingerprintsTable.projectId, projectId))).limit(1);
      return row?.fingerprint ?? null;
    },

    insertFingerprint: (projectId, fingerprint, createdBy) => insertFingerprintRow(executor, projectId, fingerprint, createdBy),

    async loadArrangementForFingerprint(projectId, arrangementId) {
      const withTracks = sql`jsonb_array_length(${arrangementsTable.trackModels}) > 0`;
      const [arrangement] = await executor
        .select({ id: arrangementsTable.id, version: arrangementsTable.version, trackModels: arrangementsTable.trackModels, songModelVersion: arrangementsTable.songModelVersion })
        .from(arrangementsTable)
        .where(arrangementId
          ? and(eq(arrangementsTable.projectId, projectId), eq(arrangementsTable.id, arrangementId))
          : and(eq(arrangementsTable.projectId, projectId), withTracks))
        .orderBy(desc(arrangementsTable.createdAt), desc(arrangementsTable.version))
        .limit(1);
      if (!arrangement) return null;
      const [project] = await executor.select({ bpm: musicProjectsTable.bpm, meter: musicProjectsTable.meter }).from(musicProjectsTable).where(eq(musicProjectsTable.id, projectId)).limit(1);
      const [songModel] = arrangement.songModelVersion !== null
        ? await executor.select({ model: songModelsTable.model }).from(songModelsTable)
          .where(and(eq(songModelsTable.projectId, projectId), eq(songModelsTable.version, arrangement.songModelVersion))).limit(1)
        : [];
      return {
        id: arrangement.id, version: arrangement.version, trackModels: arrangement.trackModels, songModel: songModel?.model ?? null,
        ...(project?.bpm ? { bpm: project.bpm } : {}), ...(project?.meter ? { meter: project.meter } : {}),
      };
    },
  };
}

/**
 * Analysis-completion hook: fingerprint every reference (in any project) that
 * points at `sourceId` and has none yet. Returns the number fingerprinted.
 * The reference's project gets the fingerprint row; the upload's project is
 * only read. Does not recompile briefs — the next producer turn picks the
 * fingerprint up, and the studio's fingerprint button does it explicitly.
 */
export async function fingerprintPendingReferences(sourceId: string, now = new Date()): Promise<number> {
  const pending = await db.select().from(musicReferenceTracksTable).where(eq(musicReferenceTracksTable.sourceId, sourceId));
  const rows = pending.map(toRecord).filter((r) => r.kind === "uploaded_audio" && !r.fingerprintId);
  if (!rows.length) return 0;
  const songModel = await loadSourceSongModelRow(db, sourceId);
  if (!songModel) return 0;
  let count = 0;
  for (const row of rows) {
    try {
      const fingerprint = deriveReferenceFingerprint(row, songModel, now);
      const fingerprintId = await db.transaction(async (tx) => {
        const id = await insertFingerprintRow(tx, row.projectId, fingerprint, row.ownerId);
        await tx.update(musicReferenceTracksTable)
          .set({ fingerprintId: id, songModelVersion: songModel.version, updatedAt: now })
          .where(and(eq(musicReferenceTracksTable.id, row.id), eq(musicReferenceTracksTable.projectId, row.projectId)));
        return id;
      });
      count += 1;
      logger.info({ referenceId: row.id, projectId: row.projectId, sourceId, fingerprintId, songModelVersion: songModel.version }, "reference_fingerprint_taken");
    } catch (error) {
      logger.error({ referenceId: row.id, projectId: row.projectId, sourceId, errorMessage: error instanceof Error ? error.message : String(error) }, "reference_fingerprint_failed");
    }
  }
  return count;
}
