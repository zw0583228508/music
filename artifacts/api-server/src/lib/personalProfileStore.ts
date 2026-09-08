/** Storage for personalized arrangement profiles (PR-30); derivation lives in personalProfile.ts. */
import { randomUUID } from "node:crypto";
import { and, desc, eq, sql } from "drizzle-orm";
import { db, personalArrangementProfilesTable, type PersonalizedArrangementProfile } from "@workspace/db";
import { derivePersonalProfile } from "./personalProfile";
import { DbPreferenceEventStore } from "./preferenceEventsDbStore";

export type PersonalProfileRecord = { id: string; ownerId: string; version: number; active: boolean; profile: PersonalizedArrangementProfile; createdAt: string };

const record = (row: typeof personalArrangementProfilesTable.$inferSelect): PersonalProfileRecord => ({
  id: row.id, ownerId: row.ownerId, version: row.version, active: row.active, profile: row.profile, createdAt: row.createdAt.toISOString(),
});

export async function listPersonalProfiles(ownerId: string): Promise<PersonalProfileRecord[]> {
  const rows = await db.select().from(personalArrangementProfilesTable).where(eq(personalArrangementProfilesTable.ownerId, ownerId)).orderBy(desc(personalArrangementProfilesTable.version));
  return rows.map(record);
}

export async function activePersonalProfile(ownerId: string): Promise<PersonalProfileRecord | null> {
  const [row] = await db.select().from(personalArrangementProfilesTable)
    .where(and(eq(personalArrangementProfilesTable.ownerId, ownerId), eq(personalArrangementProfilesTable.active, true))).limit(1);
  return row ? record(row) : null;
}

/**
 * Derive from every event the owner has and store a new version. Activation
 * is the owner's explicit act (`activate`): deriving never changes what the
 * generation path uses.
 */
export async function derivePersonalProfileForOwner(ownerId: string): Promise<PersonalProfileRecord> {
  const events = await new DbPreferenceEventStore().list(ownerId, { limit: 500 });
  const profile = derivePersonalProfile(events);
  return db.transaction(async (tx) => {
    await tx.execute(sql`select pg_advisory_xact_lock(hashtext(${"personal-profile:" + ownerId}))`);
    const [latest] = await tx.select({ version: personalArrangementProfilesTable.version }).from(personalArrangementProfilesTable)
      .where(eq(personalArrangementProfilesTable.ownerId, ownerId)).orderBy(desc(personalArrangementProfilesTable.version)).limit(1);
    const [row] = await tx.insert(personalArrangementProfilesTable).values({
      id: `pap-${randomUUID()}`, ownerId, version: (latest?.version ?? 0) + 1, active: false, profile,
    }).returning();
    return record(row);
  });
}

export async function setPersonalProfileActive(ownerId: string, profileId: string, active: boolean): Promise<PersonalProfileRecord> {
  return db.transaction(async (tx) => {
    await tx.execute(sql`select pg_advisory_xact_lock(hashtext(${"personal-profile:" + ownerId}))`);
    const [row] = await tx.select().from(personalArrangementProfilesTable)
      .where(and(eq(personalArrangementProfilesTable.id, profileId), eq(personalArrangementProfilesTable.ownerId, ownerId))).limit(1);
    if (!row) throw new Error("Personal profile not found");
    if (active) {
      await tx.update(personalArrangementProfilesTable).set({ active: false }).where(eq(personalArrangementProfilesTable.ownerId, ownerId));
    }
    const [updated] = await tx.update(personalArrangementProfilesTable).set({ active }).where(eq(personalArrangementProfilesTable.id, row.id)).returning();
    return record(updated);
  });
}
