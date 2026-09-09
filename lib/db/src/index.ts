import { drizzle } from "drizzle-orm/node-postgres";
import pg from "pg";
import * as schema from "./schema";

const { Pool } = pg;

if (!process.env.DATABASE_URL) {
  throw new Error(
    "DATABASE_URL must be set. Did you forget to provision a database?",
  );
}

export const pool = new Pool({ connectionString: process.env.DATABASE_URL });
// An idle client the server drops (Neon closes idle connections) emits
// 'error' on the pool; with no listener that is an uncaught exception and
// the process dies. Log it; the pool replaces the client on the next query.
pool.on("error", (error) => {
  console.error(`[db] idle client error: ${error instanceof Error ? error.message : String(error)}`);
});
export const db = drizzle(pool, { schema });

export function createIsolatedDatabase() {
  const isolatedPool = new Pool({
    connectionString: process.env.DATABASE_URL,
    max: 1,
  });
  return {
    pool: isolatedPool,
    db: drizzle(isolatedPool, { schema }),
  };
}

export * from "./schema";
