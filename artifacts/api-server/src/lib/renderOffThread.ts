/**
 * Render off the API's event loop (Brain B-07), the PR-72 pattern generalised:
 * in the built server the sibling bundle `render-worker.mjs` exists and every
 * evaluation render and every export render goes through a small pool of
 * worker threads; where that file does not exist (unit tests, an unbundled
 * run) the render happens in-process — the bytes are the same either way,
 * because both paths call the same pure functions.
 *
 * Why it matters: an evaluation render is 6–20 s of synchronous DSP per
 * candidate (five per job), and the export render of a 4:18 song is long
 * enough to starve the 30 s lease heartbeat (PR-98's "Export job lease was
 * lost" at rendering 25 %). With the render in a worker the heartbeat timer
 * fires on time, so `PRODUCTION_JOB_LEASE_MS` is an operator knob rather than
 * a requirement.
 *
 * `MUSIC_RENDER_WORKER_FILE` names the worker bundle explicitly (tests build
 * one into a temp directory); `MUSIC_RENDER_WORKERS` sizes the pool (default
 * 2, max 4); `MUSIC_RENDER_OFF_THREAD=off` forces in-process rendering.
 */
import { existsSync } from "node:fs";
import { cpus } from "node:os";
import { fileURLToPath, pathToFileURL } from "node:url";
import { Worker } from "node:worker_threads";
import type { TrackModel } from "@workspace/db";
import {
  renderEvaluation,
  type EvaluationRender,
  type EvaluationRenderOptions,
  type EvaluationStem,
} from "./evaluationRender";
// `exportEngine` is deliberately NOT imported here: this module sits under the
// Arrangement Brain's provider, and `exportEngine` reaches the provider back
// through the registry (a cycle that leaves the provider class undefined at
// import time). The export half of the off-thread render lives in
// `exportRenderOffThread.ts`, which imports both this pool and the engine.
import type { GeneratedExportFile } from "./exportEngine";

export type RenderLocation = "worker_thread" | "in_process";

export type RenderWorkerRequest =
  | { id: number; kind: "evaluation"; trackModels: TrackModel[]; options: EvaluationRenderOptions }
  | { id: number; kind: "export"; input: unknown };

/** `Omit` over a union keeps the union (the built-in collapses it to the shared keys). */
type DistributiveOmit<T, K extends PropertyKey> = T extends unknown ? Omit<T, K> : never;
type RenderWorkerCall = DistributiveOmit<RenderWorkerRequest, "id">;

type Pending = { resolve: (result: unknown) => void; reject: (error: Error) => void };

type PoolWorker = { worker: Worker; busy: number };

let pool: PoolWorker[] = [];
let nextId = 1;
const pending = new Map<number, { entry: Pending; worker: PoolWorker }>();

function workerUrl(): URL | null {
  const explicit = process.env.MUSIC_RENDER_WORKER_FILE?.trim();
  if (explicit) {
    try {
      return existsSync(explicit) ? pathToFileURL(explicit) : null;
    } catch {
      return null;
    }
  }
  try {
    const url = new URL("./render-worker.mjs", import.meta.url);
    return existsSync(fileURLToPath(url)) ? url : null;
  } catch {
    return null;
  }
}

function poolSize(): number {
  const requested = Number(process.env.MUSIC_RENDER_WORKERS);
  const fallback = Math.max(1, Math.min(2, (cpus()?.length ?? 2) - 1));
  return Number.isFinite(requested) && requested >= 1 ? Math.min(4, Math.floor(requested)) : fallback;
}

/** Where a render will run, and why: informational, for logs and evidence. */
export function renderLocation(): { location: RenderLocation; reason: string; workers: number } {
  if (process.env.MUSIC_RENDER_OFF_THREAD?.trim().toLowerCase() === "off") {
    return { location: "in_process", reason: "MUSIC_RENDER_OFF_THREAD=off", workers: 0 };
  }
  const url = workerUrl();
  return url
    ? { location: "worker_thread", reason: `render-worker bundle at ${fileURLToPath(url)}`, workers: poolSize() }
    : { location: "in_process", reason: "no render-worker bundle beside this module (unbundled run or test); rendering in-process", workers: 0 };
}

function startWorker(url: URL): PoolWorker {
  const worker = new Worker(url);
  const entry: PoolWorker = { worker, busy: 0 };
  worker.on("message", (message: { id: number; result?: unknown; error?: string }) => {
    const p = pending.get(message.id);
    if (!p) return;
    pending.delete(message.id);
    entry.busy = Math.max(0, entry.busy - 1);
    if (!entry.busy) worker.unref();
    if (message.error !== undefined || message.result === undefined) p.entry.reject(new Error(message.error ?? "render worker returned nothing"));
    else p.entry.resolve(message.result);
  });
  const fail = (error: unknown) => {
    const failure = error instanceof Error ? error : new Error(String(error));
    for (const [id, p] of pending) {
      if (p.worker !== entry) continue;
      pending.delete(id);
      p.entry.reject(failure);
    }
    pool = pool.filter((w) => w !== entry);
  };
  worker.on("error", fail);
  worker.on("exit", (code) => fail(new Error(`render worker exited with code ${code}`)));
  worker.unref();
  return entry;
}

function acquire(url: URL): PoolWorker {
  const size = poolSize();
  const idle = pool.find((w) => w.busy === 0);
  if (idle) return idle;
  if (pool.length < size) {
    const created = startWorker(url);
    pool.push(created);
    return created;
  }
  return [...pool].sort((a, b) => a.busy - b.busy)[0];
}

/** Post one request to the pool. Internal; `exportRenderOffThread.ts` is the only other caller. */
export function postToRenderWorker<T>(url: URL, request: RenderWorkerCall, transfer: ArrayBuffer[] = []): Promise<T> {
  return post<T>(url, request, transfer);
}

/** The worker bundle's URL, or null when there is none (unbundled run or test). */
export function renderWorkerUrl(): URL | null {
  return workerUrl();
}

function post<T>(url: URL, request: RenderWorkerCall, transfer: ArrayBuffer[] = []): Promise<T> {
  const target = acquire(url);
  const id = nextId;
  nextId += 1;
  target.busy += 1;
  target.worker.ref();
  return new Promise<T>((resolve, reject) => {
    pending.set(id, { entry: { resolve: resolve as (r: unknown) => void, reject }, worker: target });
    target.worker.postMessage({ id, ...request }, transfer);
  });
}

/** Stop every pooled worker (tests). Pending requests reject. */
export async function shutdownRenderWorkers(): Promise<void> {
  const workers = pool;
  pool = [];
  await Promise.all(workers.map((w) => w.worker.terminate().catch(() => undefined)));
}

// ---------------------------------------------------------------------------
// Payload packing (structured clone with transfers)
// ---------------------------------------------------------------------------

type PackedStem = Omit<EvaluationStem, "samples"> & { samples: Float32Array };
type PackedRender = Omit<EvaluationRender, "stems" | "mix"> & { stems: PackedStem[]; mix: Float32Array };

function ownedCopy(array: Float32Array): Float32Array {
  return new Float32Array(array.buffer.slice(array.byteOffset, array.byteOffset + array.byteLength));
}

export function packEvaluationRender(render: EvaluationRender): { payload: PackedRender; transfer: ArrayBuffer[] } {
  const mix = ownedCopy(render.mix);
  const stems = render.stems.map((s) => ({ ...s, samples: ownedCopy(s.samples) }));
  return {
    payload: { ...render, mix, stems },
    transfer: [mix.buffer as ArrayBuffer, ...stems.map((s) => s.samples.buffer as ArrayBuffer)],
  };
}

function unpackEvaluationRender(payload: PackedRender): EvaluationRender {
  return { ...payload, stems: payload.stems.map((s) => ({ ...s })) };
}

export type PackedFile = Omit<GeneratedExportFile, "data"> & { data: Uint8Array };

export function packExportFiles(files: GeneratedExportFile[]): { payload: PackedFile[]; transfer: ArrayBuffer[] } {
  const payload = files.map((file) => {
    const data = new Uint8Array(file.data.buffer.slice(file.data.byteOffset, file.data.byteOffset + file.data.byteLength));
    return { ...file, data };
  });
  return { payload, transfer: payload.map((f) => f.data.buffer as ArrayBuffer) };
}

export function unpackExportFiles(payload: PackedFile[]): GeneratedExportFile[] {
  return payload.map((file) => ({ ...file, data: Buffer.from(file.data.buffer, file.data.byteOffset, file.data.byteLength) }));
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

export type OffThreadResult<T> = { result: T; location: RenderLocation; elapsedMs: number };

/** The evaluation render, in a worker where one exists. */
export async function renderEvaluationOffThread(trackModels: ReadonlyArray<TrackModel>, options: EvaluationRenderOptions = {}): Promise<OffThreadResult<EvaluationRender>> {
  const started = performance.now();
  const where = renderLocation();
  const url = where.location === "worker_thread" ? workerUrl() : null;
  if (!url) {
    return { result: renderEvaluation(trackModels, options), location: "in_process", elapsedMs: Math.round(performance.now() - started) };
  }
  const payload = await post<PackedRender>(url, { kind: "evaluation", trackModels: [...trackModels], options });
  return { result: unpackEvaluationRender(payload), location: "worker_thread", elapsedMs: Math.round(performance.now() - started) };
}

