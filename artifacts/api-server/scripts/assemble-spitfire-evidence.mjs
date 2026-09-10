#!/usr/bin/env node
/**
 * PR-97 (SPITFIRE-1): assemble `docs/evidence/spitfire-local-render-live.json`
 * from the live artefacts of the stream - the local worker's /health (token
 * from the process env, never printed), its retained smoke proof, the plugin
 * probes and the articulation / switching measurements (scratch JSON files),
 * and the A/B export records + registration written by `sound-ab.mjs`.
 *
 *   node scripts/assemble-spitfire-evidence.mjs --scratch <dir> --ab <dir with synth/ spitfire/ registration.json> \
 *        --worker http://127.0.0.1:8023 --out docs/evidence/spitfire-local-render-live.json
 *
 * Everything private (paths, tokens) is stripped: the manifest's `path` never
 * enters the evidence; the health already omits it.
 */
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";

const args = process.argv.slice(2);
const flag = (name, fallback) => {
  const index = args.indexOf(`--${name}`);
  return index >= 0 && index + 1 < args.length ? args[index + 1] : fallback;
};
const scratch = resolve(flag("scratch"));
const abDir = flag("ab") ? resolve(flag("ab")) : null;
const worker = flag("worker", "http://127.0.0.1:8023");
const out = resolve(flag("out", "docs/evidence/spitfire-local-render-live.json"));
const stateDir = flag("state-dir") ? resolve(flag("state-dir")) : null;

// Python wrote the smoke proof with `-Infinity` for silent renders; JSON.parse refuses it.
const readJson = (path) => (existsSync(path)
  ? JSON.parse(readFileSync(path, "utf8").replace(/:\s*-Infinity/g, ": null").replace(/:\s*Infinity/g, ": null").replace(/:\s*NaN/g, ": null"))
  : null);
const token = process.env.VST3_RENDER_TOKEN ?? process.env.PEDALBOARD_VST3_API_TOKEN;
if (!token) throw new Error("VST3_RENDER_TOKEN must be in the process environment");

const healthResponse = await fetch(new URL("/health?provider=VST3", worker), { headers: { Authorization: `Bearer ${token}` } });
const health = await healthResponse.json();
delete health.plugin;
const unauthenticated = await fetch(new URL("/health?provider=VST3", worker));

const smokeProof = stateDir ? readJson(join(stateDir, "smoke-proof.json")) : null;
const smokeRows = smokeProof
  ? Object.values(smokeProof.assets ?? {}).map((proof) => ({
      assetId: proof.assetId, identity: proof.identity, passed: proof.passed, audible: proof.audible,
      canonicalSensitivity: proof.canonicalSensitivity, noClipping: proof.noClipping, deterministic: proof.deterministic,
      velocitySensitive: proof.velocitySensitive, loadSeconds: proof.loadSeconds, outputSha256: proof.outputSha256,
      rmsDbfs: proof.measurements?.rmsDbfs ?? null, peak: proof.measurements?.peak ?? null,
    }))
  : [];

const probe1 = readJson(join(scratch, "probe1.json"));
const probe2 = readJson(join(scratch, "probe2.json"));
const measurement = readJson(join(scratch, "articulation-measurement.json"));
const measurementRun1 = readJson(join(scratch, "articulation-measurement-run1.json"));
const measurementUnmounted = readJson(join(scratch, "articulation-measurement-D-unmounted.json"));
const switching = readJson(join(scratch, "switching-measurement.json"));
const inventoryRaw = readJson(join(scratch, "state", "instrument-inventory.json"));
// Identities only - never a filesystem path.
const redactPaths = (value) => Array.isArray(value) ? value.map(redactPaths)
  : value && typeof value === "object" ? Object.fromEntries(Object.entries(value).map(([k, v]) => [k, /path|dir|file/i.test(k) && typeof v === "string" ? "<private>" : redactPaths(v)]))
  : value;
const inventory = redactPaths(inventoryRaw);

const stripAudio = (record) => record && {
  ...record,
  stems: (record.stems ?? []).map((stem) => {
    const key = Object.keys(record.measurements ?? {}).find((name) => name.startsWith("stems/") && name.endsWith(`_${stem.instrument}.wav`));
    return { ...stem, measurement: key ? record.measurements[key] : null };
  }),
};
const ab = abDir
  ? {
      a: stripAudio(readJson(join(abDir, "synth", "export.json"))),
      b: stripAudio(readJson(join(abDir, "spitfire", "export.json"))),
      b2: existsSync(join(abDir, "spitfire-trimmed", "export.json")) ? stripAudio(readJson(join(abDir, "spitfire-trimmed", "export.json"))) : null,
      bWithDriveUnmounted: existsSync(join(abDir, "spitfire-drive-unmounted", "export.json"))
        ? { note: "side B exported while drive D: (Spitfire sample content) was unmounted: the worker rendered silence and the export refused to attest it ('returned audio that failed validation'), so the stem fell back to the preview synth with that reason", ...stripAudio(readJson(join(abDir, "spitfire-drive-unmounted", "export.json"))) }
        : null,
      abMasters: {
        a: readJson(join(abDir, "synth", "ab-master.json")),
        b: readJson(join(abDir, existsSync(join(abDir, "spitfire-trimmed", "ab-master.json")) ? "spitfire-trimmed" : "spitfire", "ab-master.json")),
      },
      registration: readJson(join(abDir, "registration.json")),
    }
  : null;

const evidence = {
  pr: "PR-97 spitfire-libraries-local-render (SPITFIRE-1)",
  recordedAt: new Date().toISOString(),
  worker: { endpoint: worker, unauthenticatedHealthStatus: unauthenticated.status, manifestSource: "main checkout .local-vst3-assets (git-ignored), state dir alongside" },
  health,
  smoke: { ranAt: smokeProof?.ranAt ?? null, rows: smokeRows },
  inventory: inventory?.instruments ?? inventory,
  pluginProbes: {
    defaultState: probe2 ? { defaultPatchMeta: probe2.defaultPatchMeta, patchSwapMetaAfter: probe2.patchSwapMetaAfter ?? null, patchSwapArtics: probe2.patchSwapArtics ?? null, presetLoad: probe2.presetLoad ?? null, stateSha256: probe2.stateSha256 } : null,
    probe1: probe1 ? { plugin: probe1.plugin, loadSeconds: probe1.loadSeconds, renderSeconds: probe1.renderSeconds, deterministic: probe1.deterministic, variants: probe1.variants } : null,
    probe2: probe2 ? { variants: probe2.variants } : null,
  },
  articulationMeasurement: {
    throughWorker: measurement,
    firstRunSalvaged: measurementRun1,
    driveUnmountedRun: measurementUnmounted ? { note: "drive D: (Spitfire sample content) was unmounted mid-run; every render after the first variant is silent - kept as the record of that failure mode", variants: Object.fromEntries(Object.entries(measurementUnmounted.variants ?? {}).map(([k, v]) => [k, { rmsPerRun: v.rmsPerRun }])) } : null,
    switchingAfterPriming: switching,
  },
  ab,
};
// Belt and braces: no local filesystem path of any kind leaves with the evidence
// (plugin bundles, scratch files inside error messages, the operator's home).
const WINDOWS_PATH = /[A-Za-z]:\\[^"\s]*/g;
const POSIX_HOME = /\/(?:c|d)\/Users\/[^"\s]*/g;
const scrubPaths = (value) => Array.isArray(value) ? value.map(scrubPaths)
  : value && typeof value === "object" ? Object.fromEntries(Object.entries(value).map(([k, v]) => [k, scrubPaths(v)]))
  : typeof value === "string" ? value.replace(WINDOWS_PATH, "<private path>").replace(POSIX_HOME, "<private path>")
  : value;
writeFileSync(out, JSON.stringify(scrubPaths(evidence), null, 2) + "\n");
console.log("wrote", out, JSON.stringify({ healthy: health.healthy, assets: (health.assets ?? []).map((a) => a.id), smokeRows: smokeRows.length, ab: Boolean(ab) }));
