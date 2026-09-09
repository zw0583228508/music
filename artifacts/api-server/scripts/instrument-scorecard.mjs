/**
 * Instrument scorecard from tournament evidence (Wave Q — Model Discovery, Workstream K).
 *
 *   node scripts/instrument-scorecard.mjs [--in docs/evidence/model-tournament-live.json[,more.json]]
 *        [--out docs/evidence/instrument-scorecard.json] [--md docs/model-discovery/instrument-scorecard.md]
 *
 * Reads one or more tournament reports, recovers each entry's candidate
 * pitches from the token-named MIDI beside it (for the idiomatic-register
 * measure), and writes the per-family × arm scorecard plus the Markdown
 * tables the report embeds. Read-only on the tournament evidence.
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join, resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { tmpdir } from "node:os";
import { rm } from "node:fs/promises";

const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(here, "../../..");

const esbuild = await import("esbuild");
const bundlePath = join(tmpdir(), `scorecard-${process.pid}.mjs`);
await esbuild.build({
  entryPoints: [resolve(here, "./scorecard-entry.ts")],
  outfile: bundlePath, bundle: true, platform: "node", format: "esm", logLevel: "error",
  alias: { "@workspace/db": resolve(here, "../src/lib/musicProviders.testDbStub.ts") },
});
await esbuild.stop?.();
const lib = await import(`file:///${bundlePath.replace(/\\/g, "/")}`);
await rm(bundlePath, { force: true });

const args = process.argv.slice(2);
const flag = (name, fallback) => {
  const i = args.indexOf(`--${name}`);
  return i >= 0 && args[i + 1] && !args[i + 1].startsWith("--") ? args[i + 1] : fallback;
};
const inputs = flag("in", "docs/evidence/model-tournament-live.json").split(",").map((p) => p.trim()).filter(Boolean);
const outPath = resolve(repoRoot, flag("out", "docs/evidence/instrument-scorecard.json"));
const mdPath = resolve(repoRoot, flag("md", "docs/model-discovery/instrument-scorecard.md"));

const entries = [];
const sources = [];
let midiResolved = 0, midiMissing = 0, midiAmbiguous = 0;
for (const input of inputs) {
  const path = resolve(repoRoot, input);
  if (!existsSync(path)) { console.error(`missing: ${path}`); continue; }
  const evidence = JSON.parse(readFileSync(path, "utf8"));
  const report = evidence.report ?? evidence;
  const base = dirname(path);
  sources.push({ path: input, runId: report.runId, ranAt: report.ranAt, entries: report.entries.length });
  const taskById = new Map((report.tasks ?? []).map((t) => [t.id, t]));
  for (const e of report.entries) {
    let pitches = null;
    let notes = null;
    if (e.midi) {
      // Entry MIDIs are stored relative to the repo root of the run that wrote them; try that, then beside the report.
      const candidates = [resolve(repoRoot, e.midi), resolve(base, "..", "..", e.midi), resolve(base, e.midi)];
      const file = candidates.find((c) => existsSync(c));
      if (!file) { midiMissing += 1; }
      else {
        try {
          const midi = lib.parseMidiFile(readFileSync(file));
          const drums = e.targetInst === lib.DRUMS_PROGRAM;
          // Seconds under the file's own first tempo, exactly as the calibration
          // reads a human window; the judge's physical rules are in seconds.
          const bpm = midi.tempos[0]?.bpm && midi.tempos[0].bpm >= 20 && midi.tempos[0].bpm <= 400 ? midi.tempos[0].bpm : 120;
          const secondsPerTick = 60 / (bpm * midi.ticksPerQuarter);
          const byTrack = new Map();
          for (const n of midi.notes) {
            if (drums ? !n.isPercussion : n.program !== e.targetInst) continue;
            const note = {
              id: `${n.track}-${n.startTick}-${n.pitch}`,
              start: Number((n.startTick * secondsPerTick).toFixed(4)),
              duration: Number(Math.max(0.01, (n.endTick - n.startTick) * secondsPerTick).toFixed(4)),
              pitch: n.pitch,
              velocity: Math.max(1, Math.min(127, n.velocity || 80)),
            };
            byTrack.set(n.track, [...(byTrack.get(n.track) ?? []), note]);
          }
          const want = e.judgement.metrics.noteCount;
          const exact = [...byTrack.entries()].filter(([, ns]) => ns.length === want);
          if (want === 0) { notes = []; midiResolved += 1; }
          else if (exact.length >= 1) { notes = exact.sort((a, b) => b[0] - a[0])[0][1]; midiResolved += 1; if (exact.length > 1) midiAmbiguous += 1; }
          else if (byTrack.size) { notes = [...byTrack.entries()].sort((a, b) => b[0] - a[0])[0][1]; midiResolved += 1; midiAmbiguous += 1; }
          else midiMissing += 1;
          pitches = notes ? notes.map((n) => n.pitch) : null;
        } catch { midiMissing += 1; }
      }
    }
    entries.push({
      taskId: e.taskId, targetFamily: e.targetFamily, targetInst: e.targetInst, providerId: e.providerId, seed: e.seed,
      score: e.judgement.score, metrics: e.judgement.metrics, failure: e.failure, pitches, notes,
      tempoBpm: taskById.get(e.taskId)?.tempoBpm ?? null, source: report.runId,
    });
  }
}
const card = lib.buildInstrumentScorecard(entries, { sources: sources.map((s) => `${s.path} (run ${s.runId}, ${s.entries} entries)`) });
const evidenceOut = {
  title: "Instrument scorecard — per family × arm, from the tournament evidence (Wave Q — Model Discovery, Workstream K)",
  ranAt: new Date().toISOString(),
  inputs: sources,
  midiRecovery: { resolved: midiResolved, missing: midiMissing, ambiguous: midiAmbiguous, note: "candidate pitches recovered from the token-named entry MIDIs by program + note count; 'ambiguous' = fell back to the last track carrying the program" },
  scorecard: card,
};
mkdirSync(dirname(outPath), { recursive: true });
writeFileSync(outPath, `${JSON.stringify(evidenceOut, null, 2)}\n`);
mkdirSync(dirname(mdPath), { recursive: true });
writeFileSync(mdPath.replace(/\.md$/, ".tables.md"), `${lib.renderInstrumentScorecard(card)}\n`);

console.log(`${entries.length} entries from ${sources.length} report(s); MIDI pitches resolved ${midiResolved}, missing ${midiMissing}, ambiguous ${midiAmbiguous}`);
for (const f of card.families) {
  console.log(`\n${f.family} (${f.tasks} tasks, GM ${f.programs.join(",")}): best machine ${f.bestMachineArm?.providerId} ${f.bestMachineArm?.meanScore} (+${f.bestMachineArm?.marginOverNext})`);
  for (const a of f.arms) console.log(`  ${a.providerId.padEnd(28)} score ${String(a.meanScore).padStart(6)} err ${String(a.playabilityErrorsPerEntry).padStart(5)} reg ${a.idiomaticRegisterShare} cov ${a.coverage} chord ${a.chordToneShare} dens ${a.densityLogRatio} rep ${a.barRepetitionShare} clash ${a.contextClashShare}`);
}
console.log("\ndesign:", JSON.stringify(card.design, null, 1));
console.log(`\n→ ${outPath}\n→ ${mdPath.replace(/\.md$/, ".tables.md")} (tables to embed)`);
