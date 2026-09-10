/**
 * The production export render, off the API's event loop (Brain B-07 D4).
 *
 * Its own module rather than a function in `renderOffThread.ts`: the worker
 * pool sits under the Arrangement Brain's provider, and `exportEngine` reaches
 * that provider back through the registry, so importing the engine from the
 * pool module closes an import cycle that leaves the provider class
 * `undefined` at import time. Here the cycle cannot form — nothing under the
 * provider imports this file; `exportJobs.ts` and the studio routes do.
 *
 * Why it exists: `renderArrangementExport` is synchronous synthesis, and while
 * it runs the production job runner's 30 s heartbeat timer cannot fire. PR-98
 * recorded a 4:18 song losing its lease at "rendering 25 %", and
 * `PRODUCTION_JOB_LEASE_MS` has been an operator knob for that reason ever
 * since. With the render in a worker thread the heartbeat fires on time and
 * the knob goes back to being a knob.
 */
import type { GeneratedExportFile, renderArrangementExport as renderArrangementExportFn } from "./exportEngine";
import { renderArrangementExport } from "./exportEngine";
import {
  packExportFiles,
  postToRenderWorker,
  renderLocation,
  renderWorkerUrl,
  unpackExportFiles,
  type OffThreadResult,
  type PackedFile,
} from "./renderOffThread";

export type RenderArrangementExportInput = Parameters<typeof renderArrangementExportFn>[0];

/**
 * The export render, in a worker where one exists. The input is plain data
 * (Song Model, plan, TrackModels, controls); the worker inherits the process
 * environment, so native-renderer routing reads the same configuration it
 * would on the main thread, and the files come back with their per-stem
 * evidence (`stemEvidence`) intact — the manifest and the revision evidence
 * are built by one function inside the render, not reassembled here.
 *
 * A payload the structured clone cannot carry (a function or a class instance
 * on the input) falls back to the main thread with its reason, rather than
 * failing the export.
 */
export async function renderArrangementExportOffThread(
  input: RenderArrangementExportInput,
): Promise<OffThreadResult<GeneratedExportFile[]> & { fallbackReason?: string }> {
  const started = performance.now();
  const where = renderLocation();
  const url = where.location === "worker_thread" ? renderWorkerUrl() : null;
  if (!url) {
    return {
      result: await renderArrangementExport(input),
      location: "in_process",
      elapsedMs: Math.round(performance.now() - started),
      fallbackReason: where.reason,
    };
  }
  try {
    const payload = await postToRenderWorker<PackedFile[]>(url, { kind: "export", input });
    return { result: unpackExportFiles(payload), location: "worker_thread", elapsedMs: Math.round(performance.now() - started) };
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error);
    if (!/could not be cloned|DataCloneError/i.test(reason)) throw error;
    return {
      result: await renderArrangementExport(input),
      location: "in_process",
      elapsedMs: Math.round(performance.now() - started),
      fallbackReason: `the export input could not be transferred to a worker (${reason}); rendered on the main thread`,
    };
  }
}

export { packExportFiles };
