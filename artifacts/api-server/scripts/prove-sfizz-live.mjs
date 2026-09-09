#!/usr/bin/env node
/**
 * Live proof of SFIZZ_VSCO2_CE (PR-92, SOUND-1), through the platform's own code:
 *
 *   1. authenticated GET /health?provider=SFIZZ_VSCO2_CE via SfzRenderer.health()
 *      - the asset attestation (identity, licence, tree sha256, host sha256,
 *      retained three-render smoke), the instrument map and the toolchain;
 *   2. real TrackModels of a real arrangement (fetched from the API) rendered
 *      through SfzRenderer.renderAttested() -> renderRemoteInstrument(), which
 *      verifies every echoed digest byte for byte before it accepts audio;
 *   3. the routing decision for every track of the arrangement (served /
 *      fallback with reason), so the family coverage in the evidence is the
 *      decision the export would take.
 *
 *   MUSIC_AI_WORKER_URL=... MUSIC_AI_WORKER_TOKEN=... node scripts/prove-sfizz-live.mjs \
 *        --api http://127.0.0.1:5020 --arrangement <id> --out <file.json>
 *
 * The token is read from the process environment (or `.env.local`) and never
 * printed; the endpoint host is recorded, the token is not.
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { tmpdir } from "node:os";
import { rm } from "node:fs/promises";
import { fileURLToPath, pathToFileURL } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(here, "../../..");
const args = process.argv.slice(2);
const flag = (name, fallback) => {
  const index = args.indexOf(`--${name}`);
  return index >= 0 && index + 1 < args.length && !args[index + 1].startsWith("--") ? args[index + 1] : fallback;
};
const log = (...parts) => console.log(new Date().toISOString().slice(11, 19), ...parts);

for (const rawLine of existsSync(resolve(repoRoot, ".env.local")) ? readFileSync(resolve(repoRoot, ".env.local"), "utf8").split("\n") : []) {
  const line = rawLine.trim();
  if (!line || line.startsWith("#") || !line.includes("=")) continue;
  const key = line.slice(0, line.indexOf("=")).trim();
  let value = line.slice(line.indexOf("=") + 1).trim();
  if ((value.startsWith("'") && value.endsWith("'")) || (value.startsWith('"') && value.endsWith('"'))) value = value.slice(1, -1);
  if (!(key in process.env)) process.env[key] = value;
}
if (!process.env.MUSIC_AI_WORKER_URL) throw new Error("MUSIC_AI_WORKER_URL is required in the process environment");

const esbuild = await import("esbuild");
const bundlePath = join(tmpdir(), `prove-sfizz-${process.pid}.mjs`);
await esbuild.build({
  entryPoints: [resolve(here, "./sound-ab-entry.ts")],
  outfile: bundlePath, bundle: true, platform: "node", format: "esm", logLevel: "error",
  banner: { js: "import { createRequire as __cr } from 'node:module'; const require = __cr(import.meta.url);" },
  external: ["*.node", "pg-native", "@google-cloud/*", "sharp", "bufferutil", "utf-8-validate"],
});
await esbuild.stop?.();
const lib = await import(pathToFileURL(bundlePath).href);
await rm(bundlePath, { force: true });

const base = flag("api", "http://127.0.0.1:5020");
const arrangementId = flag("arrangement");
const sampleRate = Number(flag("sample-rate", "44100"));
const out = resolve(process.cwd(), flag("out", "sfizz-live-probe.json"));
const endpointHost = new URL(process.env.MUSIC_AI_WORKER_URL).host;

// 1. health
const renderer = new lib.SfzRenderer();
lib.clearRendererHealthCache();
const healthStarted = Date.now();
const health = await renderer.health();
const healthMs = Date.now() - healthStarted;
log("health", health.healthy, health.status, `${healthMs} ms`, "served:", (health.servedFamilies ?? []).join(","));
const unauthenticated = await fetch(new URL("/health?provider=SFIZZ_VSCO2_CE", process.env.MUSIC_AI_WORKER_URL));
log("unauthenticated health ->", unauthenticated.status);

// 2. the arrangement's TrackModels
const login = await fetch(new URL("/api/dev-login", base), { method: "POST", headers: { "Content-Type": "application/json" }, body: "{}" });
const cookie = (login.headers.getSetCookie?.() ?? [login.headers.get("set-cookie")]).filter(Boolean).map((c) => c.split(";")[0]).join("; ");
const arrangementResponse = await fetch(new URL(`/api/arrangements/${arrangementId}`, base), { headers: { Cookie: cookie } });
if (!arrangementResponse.ok) throw new Error(`arrangement fetch failed: HTTP ${arrangementResponse.status}`);
const arrangementBody = await arrangementResponse.json();
const arrangement = arrangementBody.arrangement ?? arrangementBody;
const trackModels = arrangement.trackModels ?? [];
if (!trackModels.length) throw new Error("arrangement has no TrackModels");
const noteEnd = Math.max(...trackModels.flatMap((track) => track.notes.map((note) => note.start + note.duration)));
const durationSeconds = Number(flag("duration", String(Math.ceil(noteEnd + 1))));

// 3. routing + real renders through renderRemoteInstrument
const state = await renderer.workerState();
const renders = [];
for (const track of trackModels) {
  const route = lib.decideNativeRoute({ track, pedalboardConfigured: false, pedalboardFamilies: [], sfizz: state });
  const entry = {
    trackModelId: track.id,
    instrument: track.instrument,
    instrumentId: track.instrumentDefinition.id,
    family: track.instrumentDefinition.family,
    notes: track.notes.length,
    cc: track.cc.length,
    decision: route.candidates[0] ?? null,
    fallbackReason: route.reason,
    performedMaterialSha256: lib.performedMaterialSha256(track),
  };
  if (route.candidates[0]?.renderer === "SFIZZ_VSCO2_CE") {
    const started = Date.now();
    try {
      const result = await renderer.renderAttested(track, sampleRate, durationSeconds);
      const latencyMs = Date.now() - started;
      let peak = 0;
      let energy = 0;
      for (let i = 0; i < result.samples.length; i += 1) { peak = Math.max(peak, Math.abs(result.samples[i])); energy += result.samples[i] * result.samples[i]; }
      entry.render = {
        ok: true,
        latencyMs,
        secondsOfAudio: durationSeconds,
        latencyPerMinuteOfAudioMs: Math.round(latencyMs / (durationSeconds / 60)),
        frames: result.samples.length / 2,
        peak: Number(peak.toFixed(5)),
        rmsDbfs: Number((20 * Math.log10(Math.sqrt(energy / result.samples.length) || 1e-12)).toFixed(2)),
        attestation: result.attestation,
      };
      log("rendered", track.instrument, `${latencyMs} ms`, "peak", peak.toFixed(4));
    } catch (error) {
      entry.render = { ok: false, latencyMs: Date.now() - started, error: error instanceof Error ? error.message : String(error) };
      log("render FAILED", track.instrument, entry.render.error);
    }
  }
  renders.push(entry);
}
// A fail-closed check on the wire: the worker must refuse an unserved family with 422, not render it.
const drums = trackModels.find((track) => track.instrumentDefinition.family === "drums") ?? { ...trackModels[0], id: "unserved-probe", instrument: "drums", instrumentDefinition: { ...trackModels[0].instrumentDefinition, id: "drums", family: "drums" } };
const config = lib.sfizzWorkerConfig();
const refused = await fetch(new URL("/render", config.endpoint), {
  method: "POST",
  headers: { "Content-Type": "application/json", ...(config.token ? { Authorization: `Bearer ${config.token}` } : {}) },
  body: JSON.stringify({ contractVersion: "1.0", provider: "SFIZZ_VSCO2_CE", trackModel: drums, sampleRate, durationSeconds: 2 }),
});
const refusedBody = await refused.json().catch(() => ({}));
log("unserved family on the wire ->", refused.status, refusedBody.detail ?? "");

const record = {
  probedAt: new Date().toISOString(),
  endpointHost,
  tokenPrinted: false,
  arrangementId,
  projectId: arrangement.projectId,
  durationSeconds,
  sampleRate,
  health: { status: unauthenticated.status === 401 ? "401 without a bearer token" : `unauthenticated -> ${unauthenticated.status}`, latencyMs: healthMs, body: health },
  routing: state,
  tracks: renders,
  unservedFamilyOnTheWire: { family: drums.instrumentDefinition.family, httpStatus: refused.status, detail: refusedBody.detail ?? null },
};
mkdirSync(dirname(out), { recursive: true });
writeFileSync(out, JSON.stringify(record, null, 2) + "\n");
log("wrote", out);
