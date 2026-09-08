/**
 * Storage and lifecycle for the pairwise critic (PR-29): train from the
 * owner's preference events, keep every model as an immutable version,
 * promote only what proved itself, retire to roll back. The active model is
 * the single row with status "active" per owner.
 */
import { randomUUID } from "node:crypto";
import { and, desc, eq, sql } from "drizzle-orm";
import { db, pairwiseCriticModelsTable, type PairwiseCriticModel, type PairwiseCriticStatus } from "@workspace/db";
import { trainPairwiseCritic, type TrainOutcome } from "./pairwiseCritic";
import { DbPreferenceEventStore } from "./preferenceEventsDbStore";

export type PairwiseCriticRecord = {
  id: string; ownerId: string; version: number; status: PairwiseCriticStatus; model: PairwiseCriticModel;
  createdAt: string; promotedAt: string | null; retiredAt: string | null;
};

const record = (row: typeof pairwiseCriticModelsTable.$inferSelect): PairwiseCriticRecord => ({
  id: row.id, ownerId: row.ownerId, version: row.version, status: row.status, model: row.model,
  createdAt: row.createdAt.toISOString(), promotedAt: row.promotedAt?.toISOString() ?? null, retiredAt: row.retiredAt?.toISOString() ?? null,
});

export async function listPairwiseCritics(ownerId: string): Promise<PairwiseCriticRecord[]> {
  const rows = await db.select().from(pairwiseCriticModelsTable).where(eq(pairwiseCriticModelsTable.ownerId, ownerId)).orderBy(desc(pairwiseCriticModelsTable.version));
  return rows.map(record);
}

export async function activePairwiseCritic(ownerId: string): Promise<PairwiseCriticRecord | null> {
  const [row] = await db.select().from(pairwiseCriticModelsTable)
    .where(and(eq(pairwiseCriticModelsTable.ownerId, ownerId), eq(pairwiseCriticModelsTable.status, "active"))).limit(1);
  return row ? record(row) : null;
}

/** Train from every event the owner has (consent already applied at write time) and store the result as a candidate. */
export async function trainPairwiseCriticForOwner(ownerId: string): Promise<{ outcome: TrainOutcome; stored: PairwiseCriticRecord | null }> {
  const events = await new DbPreferenceEventStore().list(ownerId, { limit: 500 });
  const outcome = trainPairwiseCritic(events);
  if (outcome.status !== "trained") return { outcome, stored: null };
  const stored = await db.transaction(async (tx) => {
    await tx.execute(sql`select pg_advisory_xact_lock(hashtext(${"pairwise-critic:" + ownerId}))`);
    const [latest] = await tx.select({ version: pairwiseCriticModelsTable.version }).from(pairwiseCriticModelsTable)
      .where(eq(pairwiseCriticModelsTable.ownerId, ownerId)).orderBy(desc(pairwiseCriticModelsTable.version)).limit(1);
    const [row] = await tx.insert(pairwiseCriticModelsTable).values({
      id: `pwc-${randomUUID()}`, ownerId, version: (latest?.version ?? 0) + 1, status: "candidate", model: outcome.model,
    }).returning();
    return record(row);
  });
  return { outcome, stored };
}

/** Promotion is gated by the model's own held-out verdict; the previous active model is retired, never deleted. */
export async function promotePairwiseCritic(ownerId: string, modelId: string): Promise<PairwiseCriticRecord> {
  return db.transaction(async (tx) => {
    await tx.execute(sql`select pg_advisory_xact_lock(hashtext(${"pairwise-critic:" + ownerId}))`);
    const [row] = await tx.select().from(pairwiseCriticModelsTable)
      .where(and(eq(pairwiseCriticModelsTable.id, modelId), eq(pairwiseCriticModelsTable.ownerId, ownerId))).limit(1);
    if (!row) throw new Error("Pairwise critic model not found");
    if (!row.model.promotable) throw new Error(`This model did not prove itself: ${row.model.promotionReason}`);
    if (row.status === "retired") throw new Error("A retired model cannot be promoted; train a new one");
    const now = new Date();
    await tx.update(pairwiseCriticModelsTable).set({ status: "retired", retiredAt: now })
      .where(and(eq(pairwiseCriticModelsTable.ownerId, ownerId), eq(pairwiseCriticModelsTable.status, "active")));
    const [promoted] = await tx.update(pairwiseCriticModelsTable).set({ status: "active", promotedAt: now })
      .where(eq(pairwiseCriticModelsTable.id, row.id)).returning();
    return record(promoted);
  });
}

export async function retirePairwiseCritic(ownerId: string, modelId: string): Promise<PairwiseCriticRecord> {
  const [row] = await db.update(pairwiseCriticModelsTable).set({ status: "retired", retiredAt: new Date() })
    .where(and(eq(pairwiseCriticModelsTable.id, modelId), eq(pairwiseCriticModelsTable.ownerId, ownerId))).returning();
  if (!row) throw new Error("Pairwise critic model not found");
  return record(row);
}
