/**
 * Bundle-only database stub for routing-policy tests.
 *
 * The tested blocked-provider paths must return before registry persistence.
 * Any accidental persistence call is therefore a test failure.
 */
function unexpectedDatabaseAccess(): never {
  throw new Error("blocked provider routing test must not access the database");
}

export const modelRegistryTable = { id: "id" };
// PR-70: the dev-auth gate test bundles `routes/devAuth.ts`, which imports these
// two tables at module scope. The gate under test returns before any query, so
// a stub that throws on use is exactly right — reaching the database from a
// refused request would be the bug.
export const usersTable = { id: "id" };
export const sessionsTable = { sid: "sid" };
export const db = {
  insert: unexpectedDatabaseAccess,
  select: unexpectedDatabaseAccess,
  update: unexpectedDatabaseAccess,
  delete: unexpectedDatabaseAccess,
};