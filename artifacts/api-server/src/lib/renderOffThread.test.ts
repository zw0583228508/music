/**
 * Rendering off the API's event loop (Brain B-07 D4).
 *
 * The claim under test is not "a Worker was constructed" but the two things
 * that make the change worth making: the bytes are the same wherever the
 * render runs, and while it runs a timer on the main thread still fires — the
 * heartbeat that PR-98 saw miss its 30 s window on a 4:18 export ("Export job
 * lease was lost" at rendering 25 %).
 *
 * The worker bundle is built here the way `run-benchmark.mjs` builds its own:
 * by running the esbuild CLI as a child process, so this test works whether it
 * is run from a bundle or from source. Without esbuild the worker half is
 * skipped and the in-process half still runs.
 */
import assert from "node:assert/strict";
import test from "node:test";
import { spawnSync } from "node:child_process";
import { createRequire } from "node:module";
import { existsSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { BENCHMARK_CORPUS, buildBenchmarkSongModel } from "./benchmarkCorpus";
import { orchestrateArrangement } from "./arrangementOrchestrator";
import { renderEvaluation } from "./evaluationRender";
import { renderEvaluationOffThread, renderLocation, shutdownRenderWorkers } from "./renderOffThread";

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

/**
 * esbuild's own JS entry point run through `process.execPath`, not the `.bin`
 * shim: on Windows `spawnSync` refuses a `.CMD` with EINVAL unless a shell is
 * spawned, and a shell is not worth the quoting.
 */
function esbuildEntry(root: string): string | null {
  for (const from of [root, join(root, "..", ".."), process.cwd()]) {
    try {
      return createRequire(join(from, "package.json")).resolve("esbuild/bin/esbuild");
    } catch {
      // try the next root
    }
  }
  return null;
}

function buildWorkerBundle(root: string, outDirectory: string): string | null {
  const esbuild = esbuildEntry(root);
  if (!esbuild) return null;
  const outfile = join(outDirectory, "render-worker.mjs");
  const result = spawnSync(process.execPath, [
    esbuild,
    resolve(root, "src/render-worker.ts"),
    "--bundle", "--platform=node", "--format=esm",
    `--alias:@workspace/db=${resolve(root, "src/lib/musicProviders.testDbStub.ts")}`,
    `--outfile=${outfile}`,
    "--log-level=error",
  ], { cwd: root, encoding: "utf8" });
  if (result.status !== 0 || !existsSync(outfile)) {
    console.warn(`[b07] could not build the render worker bundle: ${result.stderr || result.error?.message || `exit ${result.status}`}`);
    return null;
  }
  return outfile;
}

const trackModels = (() => {
  const songModel = buildBenchmarkSongModel(BENCHMARK_CORPUS.find((c) => c.id === "pop-full")!);
  return orchestrateArrangement({ songModel, candidateCount: 1, render: false, now: new Date(0) }).candidates[0].trackModels;
})();

test("without a worker bundle the render happens in-process and says so", async () => {
  const previous = process.env.MUSIC_RENDER_WORKER_FILE;
  process.env.MUSIC_RENDER_WORKER_FILE = join(tmpdir(), "b07-there-is-no-such-worker.mjs");
  try {
    const where = renderLocation();
    assert.equal(where.location, "in_process");
    assert.match(where.reason, /no render-worker bundle|MUSIC_RENDER_OFF_THREAD/);
    const off = await renderEvaluationOffThread(trackModels, { durationSeconds: 4 });
    assert.equal(off.location, "in_process");
    assert.equal(off.result.stems.length, trackModels.length);
  } finally {
    if (previous === undefined) delete process.env.MUSIC_RENDER_WORKER_FILE;
    else process.env.MUSIC_RENDER_WORKER_FILE = previous;
  }
});

test("MUSIC_RENDER_OFF_THREAD=off is an escape, not the default", () => {
  const previous = process.env.MUSIC_RENDER_OFF_THREAD;
  try {
    delete process.env.MUSIC_RENDER_OFF_THREAD;
    assert.notEqual(renderLocation().reason, "MUSIC_RENDER_OFF_THREAD=off");
    process.env.MUSIC_RENDER_OFF_THREAD = "off";
    const where = renderLocation();
    assert.equal(where.location, "in_process");
    assert.equal(where.reason, "MUSIC_RENDER_OFF_THREAD=off");
    assert.equal(where.workers, 0);
  } finally {
    if (previous === undefined) delete process.env.MUSIC_RENDER_OFF_THREAD;
    else process.env.MUSIC_RENDER_OFF_THREAD = previous;
  }
});

test("in a worker thread: the same bytes, and the main thread's timer still fires", async (t) => {
  const root = packageRoot();
  if (!root) return t.skip("the api-server package root was not found from the working directory");
  const directory = mkdtempSync(join(tmpdir(), "b07-render-worker."));
  const bundle = buildWorkerBundle(root, directory);
  if (!bundle) { rmSync(directory, { recursive: true, force: true }); return t.skip("esbuild is unavailable, so no worker bundle could be built"); }

  const previousFile = process.env.MUSIC_RENDER_WORKER_FILE;
  const previousWorkers = process.env.MUSIC_RENDER_WORKERS;
  process.env.MUSIC_RENDER_WORKER_FILE = bundle;
  process.env.MUSIC_RENDER_WORKERS = "2";
  try {
    const where = renderLocation();
    assert.equal(where.location, "worker_thread", where.reason);
    assert.equal(where.workers, 2);

    // A 30 s heartbeat cannot fire while the event loop is blocked; a 25 ms
    // one is the same claim at test speed. Count the ticks that land while a
    // render of the whole song is in flight.
    let ticks = 0;
    const timer = setInterval(() => { ticks += 1; }, 25);
    let offThread: Awaited<ReturnType<typeof renderEvaluationOffThread>>;
    try {
      offThread = await renderEvaluationOffThread(trackModels, { durationSeconds: 30 });
    } finally {
      clearInterval(timer);
    }
    assert.equal(offThread.location, "worker_thread");
    assert.ok(offThread.elapsedMs > 100, `the render took ${offThread.elapsedMs} ms, too little to prove anything`);
    const expected = Math.floor(offThread.elapsedMs / 25);
    assert.ok(ticks >= expected * 0.5,
      `the main thread's timer fired ${ticks} times during a ${offThread.elapsedMs} ms render; it should fire about ${expected} times`);

    // The same render, in-process: byte for byte the same, because both paths
    // call the same pure function.
    const inProcess = renderEvaluation(trackModels, { durationSeconds: 30 });
    assert.equal(offThread.result.key, inProcess.key);
    assert.equal(offThread.result.stems.length, inProcess.stems.length);
    assert.equal(offThread.result.mix.length, inProcess.mix.length);
    assert.deepEqual(offThread.result.loudness, inProcess.loudness);
    for (let i = 0; i < inProcess.mix.length; i += 997) {
      assert.equal(offThread.result.mix[i], inProcess.mix[i], `mix sample ${i} differs between the worker and the main thread`);
    }
    for (const [index, stem] of inProcess.stems.entries()) {
      const worker = offThread.result.stems[index]!;
      assert.equal(worker.trackId, stem.trackId);
      assert.equal(worker.rmsDbfs, stem.rmsDbfs);
      assert.equal(worker.peakDbfs, stem.peakDbfs);
    }

    // Two renders at once use both workers rather than queueing behind one.
    const pair = await Promise.all([
      renderEvaluationOffThread(trackModels, { durationSeconds: 6 }),
      renderEvaluationOffThread(trackModels, { durationSeconds: 6 }),
    ]);
    for (const one of pair) assert.equal(one.location, "worker_thread");
    assert.equal(pair[0].result.key, pair[1].result.key);
  } finally {
    await shutdownRenderWorkers();
    if (previousFile === undefined) delete process.env.MUSIC_RENDER_WORKER_FILE; else process.env.MUSIC_RENDER_WORKER_FILE = previousFile;
    if (previousWorkers === undefined) delete process.env.MUSIC_RENDER_WORKERS; else process.env.MUSIC_RENDER_WORKERS = previousWorkers;
    rmSync(directory, { recursive: true, force: true });
  }
});
