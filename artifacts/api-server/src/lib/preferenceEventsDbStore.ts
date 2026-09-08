/** Drizzle store for preference events (PR-28); the logic lives in preferenceEvents.ts. */
import { and, desc, eq } from "drizzle-orm";
import { db, preferenceEventsTable, producerPreferencesTable, type PreferenceEvent } from "@workspace/db";
import type { LearningControls, PreferenceEventStore } from "./preferenceEvents";

type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0];
type Executor = typeof db | Tx;

const toEvent = (row: typeof preferenceEventsTable.$inferSelect): PreferenceEvent => ({
  id: row.id, ownerId: row.ownerId, projectId: row.projectId, decisionId: row.decisionId, kind: row.kind, source: row.source,
  rightsBasis: row.rightsBasis, subject: row.subject, compared: row.compared ?? null, outcome: row.outcome, features: row.features,
  createdAt: row.createdAt.toISOString(),
});

export class DbPreferenceEventStore implements PreferenceEventStore {
  constructor(private readonly executor: Executor = db) {}

  async learningControls(ownerId: string): Promise<LearningControls> {
    const [row] = await this.executor.select().from(producerPreferencesTable).where(eq(producerPreferencesTable.ownerId, ownerId)).limit(1);
    return row ? { learningEnabled: row.learningEnabled, inferredBehaviorEnabled: row.inferredBehaviorEnabled } : { learningEnabled: true, inferredBehaviorEnabled: true };
  }

  async insert(event: PreferenceEvent): Promise<PreferenceEvent> {
    const [row] = await this.executor.insert(preferenceEventsTable).values({
      id: event.id, ownerId: event.ownerId, projectId: event.projectId, decisionId: event.decisionId, kind: event.kind, source: event.source,
      rightsBasis: event.rightsBasis, subject: event.subject, compared: event.compared, outcome: event.outcome, features: event.features,
      createdAt: new Date(event.createdAt),
    }).returning();
    return toEvent(row);
  }

  async list(ownerId: string, options: { projectId?: string; limit?: number } = {}): Promise<PreferenceEvent[]> {
    const rows = await this.executor.select().from(preferenceEventsTable)
      .where(options.projectId ? and(eq(preferenceEventsTable.ownerId, ownerId), eq(preferenceEventsTable.projectId, options.projectId)) : eq(preferenceEventsTable.ownerId, ownerId))
      .orderBy(desc(preferenceEventsTable.createdAt)).limit(Math.min(500, Math.max(1, options.limit ?? 100)));
    return rows.map(toEvent);
  }

  async erase(ownerId: string, projectId?: string): Promise<number> {
    const rows = await this.executor.delete(preferenceEventsTable)
      .where(projectId ? and(eq(preferenceEventsTable.ownerId, ownerId), eq(preferenceEventsTable.projectId, projectId)) : eq(preferenceEventsTable.ownerId, ownerId))
      .returning({ id: preferenceEventsTable.id });
    return rows.length;
  }
}
