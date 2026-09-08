/**
 * Versions of YOUR_ARRANGER_MODEL (PR-31): train from every consented event on
 * the platform, benchmark against the reference pipeline, store the verdict,
 * promote only what won, retire to roll back. The promoted flag the router
 * consults is refreshed from the database here.
 */
import { randomUUID } from "node:crypto";
import { desc, eq, sql } from "drizzle-orm";
import { arrangerModelVersionsTable, db, type ArrangerModelStatus, type ArrangerPolicyModel } from "@workspace/db";
import {
  buildTrainingDataset,
  evaluateArrangerModel,
  trainArrangerPolicy,
  type ArrangerModelEvaluation,
} from "./arrangerTrainingPipeline";
import { buildBlindComparisonSheet, type BenchmarkRun } from "./arrangementBenchmark";
import { registerArrangerModelLoader, setArrangerModelPromoted, type ActiveArrangerModel } from "./arrangerModelRouting";
import { DbPreferenceEventStore } from "./preferenceEventsDbStore";

export type ArrangerModelRecord = {
  id: string; version: number; status: ArrangerModelStatus; model: ArrangerPolicyModel;
  benchmark: { reference: BenchmarkRun; candidate: BenchmarkRun; verdict: ArrangerModelEvaluation["verdict"]; reason: string };
  beatsBaseline: boolean; createdBy: string; createdAt: string; promotedAt: string | null; retiredAt: string | null;
};

const record = (row: typeof arrangerModelVersionsTable.$inferSelect): ArrangerModelRecord => ({
  id: row.id, version: row.version, status: row.status, model: row.model,
  benchmark: row.benchmark as ArrangerModelRecord["benchmark"],
  beatsBaseline: row.beatsBaseline, createdBy: row.createdBy, createdAt: row.createdAt.toISOString(),
  promotedAt: row.promotedAt?.toISOString() ?? null, retiredAt: row.retiredAt?.toISOString() ?? null,
});

export async function listArrangerModels(): Promise<ArrangerModelRecord[]> {
  const rows = await db.select().from(arrangerModelVersionsTable).orderBy(desc(arrangerModelVersionsTable.version));
  return rows.map(record);
}

export async function activeArrangerModel(): Promise<ActiveArrangerModel> {
  const [row] = await db.select().from(arrangerModelVersionsTable).where(eq(arrangerModelVersionsTable.status, "active")).limit(1);
  return row ? { id: row.id, version: row.version, model: row.model } : null;
}
// The provider registry loads the active policy through the routing module.
registerArrangerModelLoader(activeArrangerModel);

/** Loads the promoted flag the router consults; called at boot and after promote / retire. */
export async function refreshArrangerModelRouting(): Promise<boolean> {
  const active = await activeArrangerModel();
  setArrangerModelPromoted(active !== null);
  return active !== null;
}

/** Train from every consented, content-free event on the platform; benchmark; store as a candidate version. */
export async function trainArrangerModelVersion(createdBy: string, options: { candidateCount?: number } = {}): Promise<{ record: ArrangerModelRecord; evaluation: ArrangerModelEvaluation }> {
  const events = await new DbPreferenceEventStore().listAll(2000);
  const dataset = buildTrainingDataset(events);
  const model = trainArrangerPolicy(dataset);
  const evaluation = evaluateArrangerModel(model, { candidateCount: options.candidateCount ?? 5 });
  const stored = await db.transaction(async (tx) => {
    await tx.execute(sql`select pg_advisory_xact_lock(hashtext('arranger-model'))`);
    const [latest] = await tx.select({ version: arrangerModelVersionsTable.version }).from(arrangerModelVersionsTable).orderBy(desc(arrangerModelVersionsTable.version)).limit(1);
    const [row] = await tx.insert(arrangerModelVersionsTable).values({
      id: `arm-${randomUUID()}`, version: (latest?.version ?? 0) + 1, status: "candidate", model,
      benchmark: { reference: evaluation.reference, candidate: evaluation.candidate, verdict: evaluation.verdict, reason: evaluation.reason },
      beatsBaseline: evaluation.promotable, createdBy,
    }).returning();
    return record(row);
  });
  return { record: stored, evaluation };
}

export async function promoteArrangerModel(modelId: string): Promise<ArrangerModelRecord> {
  const promoted = await db.transaction(async (tx) => {
    await tx.execute(sql`select pg_advisory_xact_lock(hashtext('arranger-model'))`);
    const [row] = await tx.select().from(arrangerModelVersionsTable).where(eq(arrangerModelVersionsTable.id, modelId)).limit(1);
    if (!row) throw new Error("Arranger model version not found");
    if (!row.beatsBaseline) throw new Error(`This version did not beat the reference pipeline on the benchmark: ${(row.benchmark as ArrangerModelRecord["benchmark"]).reason}`);
    if (row.status === "retired") throw new Error("A retired version cannot be promoted; train a new one");
    const now = new Date();
    await tx.update(arrangerModelVersionsTable).set({ status: "retired", retiredAt: now }).where(eq(arrangerModelVersionsTable.status, "active"));
    const [updated] = await tx.update(arrangerModelVersionsTable).set({ status: "active", promotedAt: now }).where(eq(arrangerModelVersionsTable.id, row.id)).returning();
    return record(updated);
  });
  await refreshArrangerModelRouting();
  return promoted;
}

export async function retireArrangerModel(modelId: string): Promise<ArrangerModelRecord> {
  const [row] = await db.update(arrangerModelVersionsTable).set({ status: "retired", retiredAt: new Date() }).where(eq(arrangerModelVersionsTable.id, modelId)).returning();
  if (!row) throw new Error("Arranger model version not found");
  await refreshArrangerModelRouting();
  return record(row);
}

/** Gate C: the anonymised A/B sheet between the reference run and a version's run, for human raters. */
export async function blindSheetForArrangerModel(modelId: string) {
  const [row] = await db.select().from(arrangerModelVersionsTable).where(eq(arrangerModelVersionsTable.id, modelId)).limit(1);
  if (!row) throw new Error("Arranger model version not found");
  const benchmark = row.benchmark as ArrangerModelRecord["benchmark"];
  return buildBlindComparisonSheet([benchmark.reference, benchmark.candidate]);
}
