import { eq } from "drizzle-orm";
import { db } from "@workspace/db";
import { tracksTable } from "@workspace/db/schema";
const rows = await db.select().from(tracksTable).where(eq(tracksTable.projectId, process.argv[2]));
for (const r of rows) console.log(r.id.split("--").slice(1).join("--"), "| muted", r.muted, "| trackModel", r.trackModel ? `${(r.trackModel as any).notes?.length} notes` : "NULL", "| arrangement", (r as any).arrangementId ?? "-", "| created", (r as any).createdAt?.toISOString?.().slice(11, 19));
process.exit(0);
