/**
 * Drizzle-backed `ScopedRegenerationStore` (Wave U, PR-U5). Reads the edit
 * turn, the latest arrangement with TrackModels, the Song Model and the brief;
 * writes the new arrangement version, refreshes the ensemble's track rows,
 * logs a studio activity and the `regeneration` turn pair — all in one
 * transaction, serialised per project so version numbers never collide.
 */
import { randomUUID } from "node:crypto";
import { and, desc, eq, sql } from "drizzle-orm";
import {
  arrangementsTable,
  db,
  musicProducerChatTurnsTable,
  studioActivitiesTable,
  tracksTable,
} from "@workspace/db";
import { createProducerChatDbStore } from "./producerChatDbStore";
import type { ProducerChatTurnRecord } from "./producerChat";
import type { RegenerableArrangement, ScopedRegenerationStore } from "./scopedRegeneration";

type Database = typeof db;
type Executor = Database | Parameters<Parameters<Database["transaction"]>[0]>[0];

export function createScopedRegenerationDbStore(executor: Executor = db): ScopedRegenerationStore {
  const chat = createProducerChatDbStore(executor);
  const store: ScopedRegenerationStore = {
    loadSongModel: (projectId) => chat.loadSongModel(projectId),
    currentBrief: (projectId) => chat.currentBrief(projectId),
    insertTurns: (records) => chat.insertTurns(records),

    async loadTurn(projectId, turnId) {
      const [row] = await executor
        .select()
        .from(musicProducerChatTurnsTable)
        .where(and(eq(musicProducerChatTurnsTable.projectId, projectId), eq(musicProducerChatTurnsTable.id, turnId)))
        .limit(1);
      if (!row) return null;
      const record: ProducerChatTurnRecord = {
        id: row.id, projectId: row.projectId, briefId: row.briefId, role: row.role, text: row.text,
        structured: row.structured ?? null, createdAt: row.createdAt.toISOString(),
      };
      return record;
    },

    async loadLatestArrangement(projectId) {
      const [row] = await executor
        .select({
          id: arrangementsTable.id, projectId: arrangementsTable.projectId, name: arrangementsTable.name,
          version: arrangementsTable.version, trackModels: arrangementsTable.trackModels, plan: arrangementsTable.plan,
          songModelVersion: arrangementsTable.songModelVersion,
        })
        .from(arrangementsTable)
        .where(and(eq(arrangementsTable.projectId, projectId), sql`jsonb_array_length(${arrangementsTable.trackModels}) > 0`))
        .orderBy(desc(arrangementsTable.version), desc(arrangementsTable.createdAt))
        .limit(1);
      if (!row) return null;
      const arrangement: RegenerableArrangement = {
        id: row.id, projectId: row.projectId, name: row.name, version: row.version,
        trackModels: row.trackModels, plan: row.plan ?? null, songModelVersion: row.songModelVersion,
      };
      return arrangement;
    },

    async insertArrangementVersion(input) {
      await executor.execute(sql`select pg_advisory_xact_lock(hashtext(${input.projectId}))`);
      const [parent] = await executor.select().from(arrangementsTable).where(eq(arrangementsTable.id, input.parent.id)).limit(1);
      if (!parent) throw new Error("The arrangement being regenerated no longer exists");
      const versions = await executor
        .select({ version: arrangementsTable.version })
        .from(arrangementsTable)
        .where(eq(arrangementsTable.projectId, input.projectId));
      const version = Math.max(0, ...versions.map((v) => v.version)) + 1;
      const id = randomUUID();
      await executor.insert(arrangementsTable).values({
        id,
        projectId: input.projectId,
        name: input.name,
        style: parent.style,
        mode: parent.mode,
        version,
        status: "ready",
        harmonyComplexity: parent.harmonyComplexity,
        energy: parent.energy,
        density: parent.density,
        orchestraSize: parent.orchestraSize,
        rhythmIntensity: parent.rhythmIntensity,
        sections: parent.sections,
        generationProvider: parent.generationProvider,
        candidates: [],
        selectedCandidateId: null,
        sourceGenerationJobId: null,
        sourceCandidateId: null,
        generationProvenance: null,
        styleSpec: parent.styleSpec,
        plan: { ...input.plan, version },
        trackModels: input.trackModels,
        songModelVersion: input.songModelVersion,
        parentArrangementId: input.parent.id,
        parameters: { ...parent.parameters, ...input.parameters },
        seed: parent.seed,
        modelVersion: parent.modelVersion,
        provenance: input.provenance,
      });
      // The studio's mixer reads the project's track rows: a regenerated part
      // updates the row it already had; a part new to the ensemble gets one.
      for (const track of input.trackModels) {
        const [updated] = await executor
          .update(tracksTable)
          .set({ instrumentDefinition: track.instrumentDefinition, trackModel: track, provenance: track.provenance, status: "rendered" })
          .where(and(eq(tracksTable.id, track.id), eq(tracksTable.projectId, input.projectId)))
          .returning({ id: tracksTable.id });
        if (!updated) {
          await executor.insert(tracksTable).values({
            id: track.id, projectId: input.projectId, name: track.instrument, role: track.role, kind: "midi",
            color: "#6b7280", volume: 0, muted: false, solo: false, status: "rendered",
            instrumentDefinition: track.instrumentDefinition, trackModel: track, provenance: track.provenance,
          }).onConflictDoNothing();
        }
      }
      await executor.insert(studioActivitiesTable).values({
        id: randomUUID(), projectId: input.projectId, title: input.activity.title, detail: input.activity.detail, type: "arrangement",
      });
      return { id, version };
    },

    async transaction(fn) {
      if (executor !== db) return fn(store);
      return db.transaction((tx) => fn(createScopedRegenerationDbStore(tx)));
    },
  };
  return store;
}
