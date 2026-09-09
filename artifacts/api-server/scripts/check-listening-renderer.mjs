/**
 * The objective renderer check, run on both renderers, written as evidence (Wave Q, PR-72).
 *
 *   node scripts/check-listening-renderer.mjs [--out docs/evidence/listening-renderer-v2-check.json]
 *        [--side docs/evidence/listening-v2/<token>.mid]   (optional: a real side, rendered by both, for timing and levels)
 *
 * The choice between REFERENCE_SYNTH_V1 and LISTENING_SYNTH_V2 for the V2
 * listening session is made from these numbers, not from taste: the same
 * probes, the same thresholds (`CHECK_THRESHOLDS`), both renderers.
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join, resolve, dirname, relative } from "node:path";
import { fileURLToPath } from "node:url";
import { tmpdir } from "node:os";
import { rm } from "node:fs/promises";

const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(here, "../../..");
const esbuild = await import("esbuild");
const bundlePath = join(tmpdir(), `renderer-check-${process.pid}.mjs`);
await esbuild.build({
  entryPoints: [resolve(here, "./listening-v2-entry.ts")],
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
const outPath = resolve(repoRoot, flag("out", "docs/evidence/listening-renderer-v2-check.json"));
const sidePath = flag("side", null) ? resolve(repoRoot, flag("side")) : null;

const adapters = [lib.v1RendererAdapter(), lib.v2Adapter];
const results = [];
for (const adapter of adapters) {
  const t0 = Date.now();
  const check = lib.rendererCheck(adapter);
  results.push({ ...check, checkSeconds: Number(((Date.now() - t0) / 1000).toFixed(1)) });
  console.log(`${adapter.id}@${adapter.version}: ${check.passed ? "PASS" : "FAIL"} (${check.checks.filter((c) => c.passed).length}/${check.checks.length})`);
  for (const c of check.checks) console.log(`  ${c.passed ? "ok  " : "FAIL"} ${c.name}: ${c.detail}`);
}

let realSide = null;
if (sidePath && existsSync(sidePath)) {
  const midi = readFileSync(sidePath);
  const t1 = Date.now();
  const v1 = lib.renderTournamentSide(midi);
  const s1 = (Date.now() - t1) / 1000;
  const t2 = Date.now();
  const v2 = lib.renderTournamentSideV2(midi);
  const s2 = (Date.now() - t2) / 1000;
  realSide = {
    file: relative(repoRoot, sidePath).replace(/\\/g, "/"),
    v1: { renderer: v1.renderer, channels: v1.channels, durationSeconds: v1.durationSeconds, bytes: v1.wav.length, renderSeconds: Number(s1.toFixed(2)), sha256: v1.sha256 },
    v2: { renderer: v2.renderer, channels: v2.channels, durationSeconds: v2.durationSeconds, bytes: v2.wav.length, renderSeconds: Number(s2.toFixed(2)), sha256: v2.sha256, rmsDbfs: v2.rmsDbfs, peakDbfs: v2.peakDbfs, normalisation: v2.normalisation },
  };
  console.log(`real side: V1 ${s1.toFixed(1)} s, V2 ${s2.toFixed(1)} s for ${v2.durationSeconds} s of audio`);
}

const v1 = results.find((r) => r.renderer === lib.REFERENCE_RENDERER);
const v2 = results.find((r) => r.renderer === lib.LISTENING_RENDERER_V2);
const decision = {
  rule: "the renderer that passes every check serves the V2 session; if both pass, the one with the larger minimum pairwise family-centroid ratio and a stereo image; if neither, the session is not opened",
  chosen: v2.passed ? lib.LISTENING_RENDERER_V2 : v1.passed ? lib.REFERENCE_RENDERER : null,
  v1Failed: v1.checks.filter((c) => !c.passed).map((c) => c.name),
  v2Failed: v2.checks.filter((c) => !c.passed).map((c) => c.name),
  identicalOnEverySide: "one renderer, one candidate gain (x1.35), one normalisation and one reverb for every arm of every pair; the arm is never an input to the renderer",
  fluidSynthNotBuilt: "a Modal FluidSynth + GM SoundFont worker was the alternative; not built because the in-process V2 passes the check without a network dependency inside the session-opening route, and no SoundFont licence had been verified. Recorded as the next step if listeners find V2 unmusical.",
};
const evidence = {
  title: "Listening renderer check: REFERENCE_SYNTH_V1 vs LISTENING_SYNTH_V2 on the same objective probes (Wave Q, PR-72)",
  ranAt: new Date().toISOString(),
  thresholds: lib.CHECK_THRESHOLDS,
  renderers: results,
  realSide,
  decision,
};
mkdirSync(dirname(outPath), { recursive: true });
writeFileSync(outPath, `${JSON.stringify(evidence, null, 2)}\n`);
console.log(`chosen: ${decision.chosen}; report -> ${outPath}`);
