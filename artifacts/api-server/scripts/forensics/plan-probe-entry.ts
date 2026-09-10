import { and, eq } from "drizzle-orm";
import { db } from "@workspace/db";
import { arrangementsTable, songModelsTable } from "@workspace/db/schema";
const [projectId, ...ids] = process.argv.slice(2);
const models = await db.select().from(songModelsTable).where(eq(songModelsTable.projectId, projectId));
const latest = models.sort((a, b) => b.version - a.version)[0];
const m: any = latest.model;
console.log("songModel v", latest.version, "| vocals:", m.musicalMap?.vocals?.status, "| cadences:", m.musicalMap?.harmony?.cadences?.length, "| chords:", m.chords?.length, "with roman:", (m.chords ?? []).filter((c: any) => c.roman).length, "with function:", (m.chords ?? []).filter((c: any) => c.function).length, "| energyCurve bars:", m.musicalMap?.energy?.energyCurve?.length);
for (const id of ids) {
  const [a] = await db.select().from(arrangementsTable).where(and(eq(arrangementsTable.id, id), eq(arrangementsTable.projectId, projectId))).limit(1);
  const plan: any = a.plan;
  console.log("\n== arrangement", id.slice(0, 8), "v" + a.version, a.name);
  console.log("plan keys:", Object.keys(plan ?? {}).join(","));
  const gp = plan.globalPlan, sp = plan.sectionPlan, pc = plan.partComposerPlan ?? plan.partPlan;
  if (gp) console.log("palette:", gp.instrumentPalette.map((p: any) => p.role).join(","), "| groove", gp.grooveStrategy, "| targets:", gp.sectionTargets.map((t: any) => `${t.sectionName}:${t.energy}`).join(" "));
  if (sp) for (const s of sp.sections) console.log("  ", s.sectionName.padEnd(9), "fn", s.function.padEnd(8), "e", s.energy, "active", JSON.stringify(s.activeInstrumentFamilies), "lead", s.leadRole);
  if (pc) { const tasks = pc.tasks ?? []; const by: Record<string, number> = {}; for (const t of tasks) by[`${t.instrument}:${t.task}`] = (by[`${t.instrument}:${t.task}`] ?? 0) + 1; console.log("  composer tasks:", tasks.length, JSON.stringify(by)); }
  console.log("  trackModels:", (a.trackModels as any[]).map((t) => `${t.instrument}/${t.role}:${t.notes.length}n@${t.notes[0]?.start?.toFixed(1)}`).join("  "));
  console.log("  stages:", (a.parameters as any)?.stages ?? (a as any).provenance?.parameters?.stages);
}
process.exit(0);
