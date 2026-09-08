/**
 * Drizzle-backed `ProducerChatStore` (Wave U, PR-U2). Reads the project's
 * latest Song Model and the latest stored ArrangementPlan; writes the three
 * additive tables. Every write of one turn happens inside one transaction.
 */
import { and, desc, eq, isNotNull, lt, or, sql } from "drizzle-orm";
import {
  arrangementsTable,
  db,
  musicProducerBriefDecisionsTable,
  musicProducerChatTurnsTable,
  musicProductionBriefsTable,
  songModelsTable,
} from "@workspace/db";
import type {
  ProducerBriefDecisionRecord,
  ProducerBriefRecord,
  ProducerChatStore,
  ProducerChatTurnRecord,
} from "./producerChat";

type Database = typeof db;
type Executor = Database | Parameters<Parameters<Database["transaction"]>[0]>[0];

const iso = (value: Date): string => value.toISOString();

export function createProducerChatDbStore(executor: Executor = db): ProducerChatStore {
  const store: ProducerChatStore = {
    async currentBrief(projectId) {
      const [row] = await executor
        .select()
        .from(musicProductionBriefsTable)
        .where(eq(musicProductionBriefsTable.projectId, projectId))
        .orderBy(desc(musicProductionBriefsTable.version))
        .limit(1);
      if (!row) return null;
      const record: ProducerBriefRecord = {
        id: row.id, projectId: row.projectId, version: row.version, intent: row.intent,
        styleProfile: row.styleProfile, brief: row.brief, answers: row.answers,
        inputsDigestSha256: row.inputsDigestSha256, createdAt: iso(row.createdAt),
      };
      return record;
    },

    async insertBrief(record) {
      await executor.insert(musicProductionBriefsTable).values({
        id: record.id, projectId: record.projectId, version: record.version, intent: record.intent,
        styleProfile: record.styleProfile, brief: record.brief, answers: record.answers,
        inputsDigestSha256: record.inputsDigestSha256, createdAt: new Date(record.createdAt),
      });
    },

    async insertTurns(records) {
      if (!records.length) return;
      await executor.insert(musicProducerChatTurnsTable).values(records.map((r) => ({
        id: r.id, projectId: r.projectId, briefId: r.briefId, role: r.role, text: r.text,
        structured: r.structured, createdAt: new Date(r.createdAt),
      })));
    },

    async listTurns(projectId, page) {
      let cursor: { createdAt: Date; id: string } | null = null;
      if (page.before) {
        const [anchor] = await executor
          .select({ createdAt: musicProducerChatTurnsTable.createdAt, id: musicProducerChatTurnsTable.id })
          .from(musicProducerChatTurnsTable)
          .where(and(eq(musicProducerChatTurnsTable.projectId, projectId), eq(musicProducerChatTurnsTable.id, page.before)))
          .limit(1);
        cursor = anchor ?? null;
      }
      const rows = await executor
        .select()
        .from(musicProducerChatTurnsTable)
        .where(cursor
          ? and(
            eq(musicProducerChatTurnsTable.projectId, projectId),
            or(
              lt(musicProducerChatTurnsTable.createdAt, cursor.createdAt),
              and(eq(musicProducerChatTurnsTable.createdAt, cursor.createdAt), lt(musicProducerChatTurnsTable.id, cursor.id)),
            ),
          )
          : eq(musicProducerChatTurnsTable.projectId, projectId))
        .orderBy(desc(musicProducerChatTurnsTable.createdAt), desc(musicProducerChatTurnsTable.id))
        .limit(page.limit + 1);
      const hasMore = rows.length > page.limit;
      const turns: ProducerChatTurnRecord[] = rows.slice(0, page.limit).reverse().map((r) => ({
        id: r.id, projectId: r.projectId, briefId: r.briefId, role: r.role, text: r.text,
        structured: r.structured ?? null, createdAt: iso(r.createdAt),
      }));
      return { turns, hasMore };
    },

    async listDecisions(projectId) {
      const rows = await executor
        .select()
        .from(musicProducerBriefDecisionsTable)
        .where(eq(musicProducerBriefDecisionsTable.projectId, projectId))
        .orderBy(musicProducerBriefDecisionsTable.createdAt, musicProducerBriefDecisionsTable.id);
      return rows.map((r): ProducerBriefDecisionRecord => ({
        id: r.id, projectId: r.projectId, briefId: r.briefId, decisionId: r.decisionId, decision: r.decision,
        delta: r.delta ?? null, supersededBy: r.supersededBy, createdAt: iso(r.createdAt),
      }));
    },

    async insertDecisions(records) {
      if (!records.length) return;
      await executor.insert(musicProducerBriefDecisionsTable).values(records.map((r) => ({
        id: r.id, projectId: r.projectId, briefId: r.briefId, decisionId: r.decisionId, decision: r.decision,
        delta: r.delta, supersededBy: r.supersededBy, createdAt: new Date(r.createdAt),
      })));
    },

    async markSuperseded(projectId, rowId, supersededBy) {
      await executor
        .update(musicProducerBriefDecisionsTable)
        .set({ supersededBy })
        .where(and(eq(musicProducerBriefDecisionsTable.projectId, projectId), eq(musicProducerBriefDecisionsTable.id, rowId)));
    },

    async loadSongModel(projectId) {
      const [row] = await executor
        .select({ version: songModelsTable.version, model: songModelsTable.model })
        .from(songModelsTable)
        .where(eq(songModelsTable.projectId, projectId))
        .orderBy(desc(songModelsTable.version))
        .limit(1);
      return row ? { version: row.version, model: row.model } : null;
    },

    async loadLatestArrangementPlan(projectId) {
      const [row] = await executor
        .select({ plan: arrangementsTable.plan })
        .from(arrangementsTable)
        .where(and(eq(arrangementsTable.projectId, projectId), isNotNull(arrangementsTable.plan)))
        .orderBy(desc(arrangementsTable.createdAt), desc(sql`${arrangementsTable.version}`))
        .limit(1);
      return row?.plan ?? null;
    },

    async transaction(fn) {
      if (executor !== db) return fn(store);
      return db.transaction((tx) => fn(createProducerChatDbStore(tx)));
    },
  };
  return store;
}
