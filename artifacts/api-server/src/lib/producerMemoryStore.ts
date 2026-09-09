/**
 * Producer memory persistence (Wave U, PR-U6). The rules themselves and every
 * refusal live in `producerMemory.ts`; this is Drizzle and ownership.
 */
import { randomUUID } from "node:crypto";
import { and, asc, desc, eq } from "drizzle-orm";
import {
  db,
  musicProducerBriefDecisionsTable,
  musicProducerMemoryTable,
  musicProductionBriefsTable,
  musicProjectsTable,
  type BriefDelta,
  type ProducerBriefDecision,
  type ProducerMemoryRule,
  type ProducerMemoryStatus,
} from "@workspace/db";
import { ProducerMemoryError, memoryRuleFromDecision } from "./producerMemory";

export type ProducerMemoryRecord = {
  id: string;
  rule: ProducerMemoryRule;
  status: ProducerMemoryStatus;
  sourceProjectId: string | null;
  createdAt: string;
  revokedAt: string | null;
};

const record = (row: typeof musicProducerMemoryTable.$inferSelect): ProducerMemoryRecord => ({
  id: row.id,
  rule: row.rule,
  status: row.status,
  sourceProjectId: row.sourceProjectId,
  createdAt: row.createdAt.toISOString(),
  revokedAt: row.revokedAt ? row.revokedAt.toISOString() : null,
});

/** Every rule the owner has, newest first, revoked ones included. */
export async function listProducerMemory(ownerId: string): Promise<ProducerMemoryRecord[]> {
  const rows = await db
    .select()
    .from(musicProducerMemoryTable)
    .where(eq(musicProducerMemoryTable.ownerId, ownerId))
    .orderBy(asc(musicProducerMemoryTable.createdAt));
  return rows.map(record).reverse();
}

/**
 * Promote one of the owner's own project decisions to a standing rule. The
 * decision must belong to a project they own; `producerMemory.ts` decides
 * whether it may be carried at all.
 */
export async function rememberDecision(input: {
  ownerId: string;
  projectId: string;
  decisionId: string;
  now?: Date;
}): Promise<ProducerMemoryRecord> {
  const [project] = await db
    .select({ id: musicProjectsTable.id, ownerId: musicProjectsTable.ownerId })
    .from(musicProjectsTable)
    .where(eq(musicProjectsTable.id, input.projectId))
    .limit(1);
  if (!project || (project.ownerId && project.ownerId !== input.ownerId)) {
    throw new ProducerMemoryError(404, "Project not found");
  }
  // A decision made in chat has a row (with the delta that produced it). One
  // read out of the intake text lives only in the current brief — that is
  // still the producer's own statement, and `deltaForDecision` reproduces it.
  const [row] = await db
    .select()
    .from(musicProducerBriefDecisionsTable)
    .where(and(
      eq(musicProducerBriefDecisionsTable.projectId, input.projectId),
      eq(musicProducerBriefDecisionsTable.decisionId, input.decisionId),
    ))
    .orderBy(asc(musicProducerBriefDecisionsTable.createdAt))
    .limit(1);
  let decision: ProducerBriefDecision | null = row?.decision ?? null;
  let briefId = row?.briefId ?? "";
  let storedDelta: BriefDelta | null = row?.delta ?? null;
  if (!decision) {
    const [brief] = await db
      .select({ id: musicProductionBriefsTable.id, brief: musicProductionBriefsTable.brief })
      .from(musicProductionBriefsTable)
      .where(eq(musicProductionBriefsTable.projectId, input.projectId))
      .orderBy(desc(musicProductionBriefsTable.version))
      .limit(1);
    decision = brief?.brief.producerDecisions.find((d) => d.id === input.decisionId) ?? null;
    briefId = brief?.id ?? "";
    storedDelta = null;
  }
  if (!decision) throw new ProducerMemoryError(404, `No decision "${input.decisionId}" in this project`);
  const existing = await db
    .select()
    .from(musicProducerMemoryTable)
    .where(and(
      eq(musicProducerMemoryTable.ownerId, input.ownerId),
      eq(musicProducerMemoryTable.sourceDecisionId, input.decisionId),
    ))
    .limit(1);
  if (existing[0]?.status === "active") {
    throw new ProducerMemoryError(409, `"${existing[0].rule.statement}" is already a standing rule`);
  }
  const rule = memoryRuleFromDecision({
    id: randomUUID(),
    decision,
    delta: storedDelta,
    projectId: input.projectId,
    briefId,
    now: input.now,
  });
  // A rule revoked earlier and remembered again is the same row, active once more.
  if (existing[0]) {
    const [updated] = await db
      .update(musicProducerMemoryTable)
      .set({ rule: { ...rule, id: existing[0].id }, status: "active", revokedAt: null })
      .where(eq(musicProducerMemoryTable.id, existing[0].id))
      .returning();
    return record(updated);
  }
  const [inserted] = await db
    .insert(musicProducerMemoryTable)
    .values({
      id: rule.id,
      ownerId: input.ownerId,
      rule,
      sourceProjectId: input.projectId,
      sourceDecisionId: input.decisionId,
      status: "active",
    })
    .returning();
  return record(inserted);
}

/** Stop a rule applying to new briefs. The briefs it already shaped are untouched. */
export async function revokeProducerMemory(ownerId: string, ruleId: string): Promise<ProducerMemoryRecord> {
  const [row] = await db
    .update(musicProducerMemoryTable)
    .set({ status: "revoked", revokedAt: new Date() })
    .where(and(eq(musicProducerMemoryTable.id, ruleId), eq(musicProducerMemoryTable.ownerId, ownerId)))
    .returning();
  if (!row) throw new ProducerMemoryError(404, "Standing rule not found");
  return record(row);
}
