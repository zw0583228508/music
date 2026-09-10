/**
 * The export render off the API's event loop (Brain B-07 D4), and the one
 * builder behind both records of what each stem was rendered with.
 *
 * PR-98 recorded a 4:18 export losing its lease at "rendering 25 %": the
 * synthesis ran on the event loop, so the 30 s heartbeat timer could not fire.
 * `PRODUCTION_JOB_LEASE_MS` has been an operator knob ever since. These tests
 * hold that the render now runs in a worker thread where the built server has
 * one, that the files it returns are the files the main thread would have
 * produced — per-stem evidence included — and that the manifest and the
 * revision evidence are the same object from the same builder, not two
 * assemblies that can drift.
 */
import assert from "node:assert/strict";
import test from "node:test";
import { createHash } from "node:crypto";
import { spawnSync } from "node:child_process";
import { createRequire } from "node:module";
import { existsSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import type { SongModelData, TrackModel } from "@workspace/db";
import { createStyleSpec } from "./musicEngines";
import { renderArrangementExport, stemRendererEvidence } from "./exportEngine";
import { renderArrangementExportOffThread, type RenderArrangementExportInput } from "./exportRenderOffThread";
import { packExportFiles, shutdownRenderWorkers } from "./renderOffThread";

// ---------------------------------------------------------------------------
// A minimal, real export input (the shape `exportJobs.ts` hands the engine)
// ---------------------------------------------------------------------------

const provenance = { model: "TEST", version: "1", parameters: {}, parentIds: ["track-model-artifact"], createdBy: "b07-test" };

const instrumentDefinition = {
  id: "piano", family: "keys",
  playableRange: { min: 21, max: 108 }, comfortableRange: { min: 36, max: 96 },
  registers: [{ name: "full", min: 21, max: 108, character: "balanced" }],
  polyphonic: true, maxVoices: 10, articulations: ["sustain"],
  constraints: { maxLeap: 24, minNoteDuration: 0.05, maxSimultaneousNotes: 10 },
  controls: { dynamics: [1], expression: [11], sustain: 64, pitchBend: false, aftertouch: true },
};

const trackModel = {
  id: "stem-piano", instrument: "piano", instrumentDefinition, role: "harmony",
  notes: [
    { id: "note-1", start: 0, duration: 1, pitch: 60, velocity: 96 },
    { id: "note-2", start: 1, duration: 1, pitch: 64, velocity: 88 },
  ],
  cc: [], articulations: [], automation: [], source: "PERFORMANCE_ENGINE", version: 1, provenance,
} as unknown as TrackModel;

const style = createStyleSpec("pop", { energy: 0.6, density: 0.5, harmonyComplexity: 4 });

const songModel = {
  audio: { name: "source.wav", contentType: "audio/wav", size: 1, durationSeconds: 2, sampleRate: 44_100, channels: 2 },
  tempoMap: [{ time: 0, bpm: 120, confidence: 1 }],
  meterMap: [{ bar: 1, meter: "4/4", confidence: 1 }],
  keyMap: [{ time: 0, key: "C major", confidence: 1 }],
  melody: [], chords: [], sections: [], energy: [], beats: [], bars: [], dynamics: [],
  sourceStems: [], lyrics: [], confidenceByField: {}, provenance: [],
} as unknown as SongModelData;

const exportInput = (): RenderArrangementExportInput => ({
  projectName: "B-07 off-thread", bpm: 120, key: "C major", meter: "4/4",
  arrangementName: "Off-thread render", arrangementVersion: 1, masterProfile: "STREAMING",
  energy: 0.6, density: 0.5, harmonyComplexity: 4,
  sections: [{ name: "Verse", energy: 0.6, density: 0.5, tracks: ["Piano"] }],
  tracks: [{ id: "stem-piano", name: "Piano", role: "harmony", volume: -6, muted: false, solo: false }],
  songModel,
  plan: {
    id: "b07-plan", version: 1,
    sections: [{ section: "verse", startBar: 1, endBar: 2, energy: 0.6, density: 0.5, tracks: { Piano: "main_harmony" }, operations: ["phrase"] }],
    style, songModelVersion: 1, parameters: {}, provenance,
  },
  trackModels: [trackModel], styleSpec: style,
  generationProvider: "TEST", parentIds: ["track-model-artifact"],
  planArtifactId: "plan-artifact", planParentIds: ["song-model-artifact"],
  trackModelArtifactIds: { "stem-piano": "track-model-artifact" },
  includeStems: true, includeMidi: false,
} as unknown as RenderArrangementExportInput);

const sha256 = (value: Uint8Array): string => createHash("sha256").update(value).digest("hex");

// ---------------------------------------------------------------------------

function packageRoot(): string | null {
  let directory = process.cwd();
  for (let i = 0; i < 6; i += 1) {
    if (existsSync(join(directory, "src", "render-worker.ts"))) return directory;
    const parent = dirname(directory);
    if (parent === directory) break;
    directory = parent;
  }
  return null;
}

function buildWorkerBundle(root: string, outDirectory: string): string | null {
  let esbuild: string | null = null;
  for (const from of [root, join(root, "..", ".."), process.cwd()]) {
    try { esbuild = createRequire(join(from, "package.json")).resolve("esbuild/bin/esbuild"); break; } catch { /* next */ }
  }
  if (!esbuild) return null;
  const outfile = join(outDirectory, "render-worker.mjs");
  const result = spawnSync(process.execPath, [
    esbuild, resolve(root, "src/render-worker.ts"),
    "--bundle", "--platform=node", "--format=esm",
    `--alias:@workspace/db=${resolve(root, "src/lib/musicProviders.testDbStub.ts")}`,
    `--outfile=${outfile}`, "--log-level=error",
  ], { cwd: root, encoding: "utf8" });
  return result.status === 0 && existsSync(outfile) ? outfile : null;
}

test("one builder writes the per-stem renderer, sound selection and gate outcome into both records", async () => {
  const files = await renderArrangementExport(exportInput());
  const manifest = files.find((f) => f.name === "project/manifest.json")!;
  assert.ok(manifest, "the export carries a manifest");

  // The file's own `stemEvidence` is what the mix/master revision stores; the
  // manifest's `stemEvidence` is what a producer reads. They must be the same
  // object from `stemRendererEvidence`, not two assemblies.
  const parsed = JSON.parse(Buffer.from(manifest.data).toString("utf8")) as { stemEvidence: unknown };
  assert.deepEqual(parsed.stemEvidence, JSON.parse(JSON.stringify(manifest.stemEvidence)),
    "the manifest and the revision evidence are one builder's output");

  const stems = manifest.stemEvidence!;
  assert.ok(stems.length > 0, "at least one stem is accounted for");
  for (const stem of stems) {
    assert.ok(stem.trackId && stem.instrument, "the stem names the track it is");
    assert.ok(stem.renderer, "and the renderer that made it");
    assert.ok(["licensed-native", "preview-only", "unlicensed-native"].includes(stem.rendererStatus), stem.rendererStatus);
    assert.ok(typeof stem.gate.passed === "boolean", "and the gate outcome");
    assert.ok(Array.isArray(stem.gate.reasons));
    // Nothing is asserted as native here; what matters is that a fallback
    // carries its reason rather than passing silently (charter rule 10).
    if (stem.rendererStatus !== "licensed-native") {
      assert.ok(stem.fallbackReason !== undefined, `${stem.trackId} says why it is ${stem.rendererStatus}`);
      assert.equal(stem.gate.passed, false, "a preview stem never passes the gate");
    }
  }
  assert.equal(stemRendererEvidence([], [], undefined).length, 0, "the builder is a pure function of what it is given");
});

test("without a worker bundle the export render falls back to the main thread and says why", async () => {
  const previous = process.env.MUSIC_RENDER_WORKER_FILE;
  process.env.MUSIC_RENDER_WORKER_FILE = join(tmpdir(), "b07-no-such-worker.mjs");
  try {
    const off = await renderArrangementExportOffThread(exportInput());
    assert.equal(off.location, "in_process");
    assert.match(off.fallbackReason ?? "", /no render-worker bundle/);
    assert.ok(off.result.length > 0);
  } finally {
    if (previous === undefined) delete process.env.MUSIC_RENDER_WORKER_FILE;
    else process.env.MUSIC_RENDER_WORKER_FILE = previous;
  }
});

test("the export files survive the trip through a worker thread byte for byte", async (t) => {
  const root = packageRoot();
  if (!root) return t.skip("the api-server package root was not found from the working directory");
  const directory = mkdtempSync(join(tmpdir(), "b07-export-worker."));
  const bundle = buildWorkerBundle(root, directory);
  if (!bundle) { rmSync(directory, { recursive: true, force: true }); return t.skip("esbuild is unavailable, so no worker bundle could be built"); }

  const previous = process.env.MUSIC_RENDER_WORKER_FILE;
  process.env.MUSIC_RENDER_WORKER_FILE = bundle;
  try {
    const inProcess = await renderArrangementExport(exportInput());
    const offThread = await renderArrangementExportOffThread(exportInput());
    assert.equal(offThread.location, "worker_thread");
    assert.equal(offThread.result.length, inProcess.length);
    for (const [index, file] of inProcess.entries()) {
      const worker = offThread.result[index];
      assert.equal(worker.name, file.name);
      assert.equal(worker.type, file.type);
      assert.equal(worker.format, file.format);
      if (file.format === "JSON") {
        // The manifest stamps a wall-clock time, so it is compared as data
        // with the timestamps removed rather than byte for byte.
        const strip = (value: unknown): unknown => JSON.parse(
          JSON.stringify(value, (key, v) => (/at$|At$|time|Time/.test(key) ? "<time>" : v)));
        assert.deepEqual(
          strip(JSON.parse(Buffer.from(worker.data).toString("utf8"))),
          strip(JSON.parse(Buffer.from(file.data).toString("utf8"))),
          `${file.name} differs between the worker and the main thread`);
      } else {
        assert.equal(sha256(worker.data), sha256(file.data), `${file.name} differs between the worker and the main thread`);
      }
      assert.ok(Buffer.isBuffer(worker.data), `${file.name} comes back as a Buffer, not a bare Uint8Array`);
      assert.deepEqual(
        JSON.parse(JSON.stringify(worker.stemEvidence ?? null)),
        JSON.parse(JSON.stringify(file.stemEvidence ?? null)),
        `${file.name} keeps its per-stem evidence across the thread boundary`);
      assert.deepEqual(JSON.parse(JSON.stringify(worker.provenance)), JSON.parse(JSON.stringify(file.provenance)));
    }
  } finally {
    await shutdownRenderWorkers();
    if (previous === undefined) delete process.env.MUSIC_RENDER_WORKER_FILE;
    else process.env.MUSIC_RENDER_WORKER_FILE = previous;
    rmSync(directory, { recursive: true, force: true });
  }
});

test("packing an export file transfers its bytes and keeps everything else", async () => {
  const files = await renderArrangementExport(exportInput());
  const { payload, transfer } = packExportFiles(files);
  assert.equal(payload.length, files.length);
  assert.equal(transfer.length, files.length, "every file's bytes are transferred, not copied");
  for (const [index, packed] of payload.entries()) {
    assert.equal(packed.name, files[index].name);
    assert.equal(sha256(packed.data), sha256(files[index].data));
    assert.notEqual(packed.data.buffer, files[index].data.buffer, "the packed copy owns its own buffer");
  }
});
