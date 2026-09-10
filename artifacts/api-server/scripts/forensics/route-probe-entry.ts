// Route probe: run the exact function the mix/master revision route runs
// (renderArrangementExport) on the real DB rows of one arrangement, with the
// revision's own mix controls, and report the RMS envelope of every file it
// produces (stems, mix, premaster, master). Read-only against the DB.
import { readFileSync, writeFileSync } from "node:fs";
import { and, eq } from "drizzle-orm";
import { db } from "@workspace/db";
import { arrangementsTable, musicProjectsTable, songModelsTable, tracksTable } from "@workspace/db/schema";
import { renderArrangementExport } from "../../src/lib/exportEngine";
import { arrangementTrackRows } from "../../src/lib/projectTracks";

const [projectId, arrangementId, revisionPath, outPath] = process.argv.slice(2);
const revision = JSON.parse(readFileSync(revisionPath, "utf8"));
const [project] = await db.select().from(musicProjectsTable).where(eq(musicProjectsTable.id, projectId)).limit(1);
const [arrangement] = await db.select().from(arrangementsTable).where(and(eq(arrangementsTable.id, arrangementId), eq(arrangementsTable.projectId, projectId))).limit(1);
const songModels = await db.select().from(songModelsTable).where(eq(songModelsTable.projectId, projectId));
const projectTracks = await db.select().from(tracksTable).where(eq(tracksTable.projectId, projectId));
const songModel = songModels.find((m) => m.version === arrangement!.songModelVersion)!;
const tracks = arrangementTrackRows(projectTracks, arrangement!.trackModels);
const controls = revision.controls;
console.log("arrangement v", arrangement!.version, "songModel v", songModel.version, "tracks", tracks.map((t) => `${t.id.split("--")[1]}:${t.muted ? "muted" : "on"}`), "styleSpec keys", Object.keys(arrangement!.styleSpec ?? {}).length);
console.log("trackModels", arrangement!.trackModels.map((t: any) => `${t.role}:${t.notes.length}n first ${t.notes[0]?.start}`));
const renderTracks = tracks;
const files = await renderArrangementExport({
  projectName: project!.name, bpm: project!.bpm, key: project!.key, meter: project!.meter,
  arrangementName: arrangement!.name, arrangementVersion: arrangement!.version,
  masterProfile: "STREAMING", energy: arrangement!.energy, density: arrangement!.density,
  harmonyComplexity: arrangement!.harmonyComplexity, sections: arrangement!.sections as any, tracks: renderTracks as any,
  songModel: songModel.model as any, plan: arrangement!.plan as any, trackModels: arrangement!.trackModels as any,
  styleSpec: arrangement!.styleSpec as any, seed: arrangement!.seed ?? undefined,
  generationProvider: arrangement!.generationProvider ?? "ARRANGEMENT_ENGINE",
  generationModelVersion: arrangement!.modelVersion ?? undefined, parentIds: ["probe"],
  includeStems: true, includeMidi: false, mixMasterControls: controls,
});
const env = (wav: Buffer) => {
  const sr = wav.readUInt32LE(24); const ch = wav.readUInt16LE(22); const bits = wav.readUInt16LE(34);
  const data = wav.subarray(44); const frame = ch * (bits / 8); const win = sr * 10;
  const out: number[] = [];
  for (let start = 0; (start + win) * frame <= data.length; start += win) {
    let acc = 0;
    for (let i = 0; i < win; i += 1) {
      for (let c = 0; c < ch; c += 1) {
        const off = (start + i) * frame + c * (bits / 8);
        const v = bits === 16 ? data.readInt16LE(off) / 32768 : data.readIntLE(off, 3) / 8388608;
        acc += v * v;
      }
    }
    out.push(Number((20 * Math.log10(Math.sqrt(acc / (win * ch)) + 1e-9)).toFixed(1)));
  }
  return { sr, ch, bits, seconds: data.length / frame / sr, rms10s: out.slice(0, 27) };
};
const report: Record<string, unknown> = {};
for (const f of files) {
  if (f.format !== "WAV") { report[f.name] = { type: f.type, bytes: f.data.length }; continue; }
  report[f.name] = { type: f.type, renderer: (f as any).renderer ?? (f as any).rendererStatus, ...env(f.data) };
}
writeFileSync(outPath, JSON.stringify(report, null, 2));
console.log(JSON.stringify(report, null, 1));
process.exit(0);
