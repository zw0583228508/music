/**
 * Worker-thread entry: the platform's synchronous DSP off the main thread
 * (Brain B-07). Two request kinds:
 *
 *   evaluation  — `renderEvaluation(trackModels, options)`: the Arrangement
 *                 Brain's per-candidate evaluation render (6–20 s of DSP per
 *                 candidate on the Tier S cases; five candidates per job).
 *   export      — `renderArrangementExport(input)`: the production export
 *                 render (PR-98 saw a 4:18 song lose its lease at
 *                 "rendering 25 %" because the heartbeat timer could not fire
 *                 while the synth ran on the event loop).
 *
 * Answers `{ id, result }` or `{ id, error }`; Float32Array / byte payloads
 * are transferred, not copied. Built as its own bundle entry (`build.mjs`);
 * `renderOffThread.ts` falls back to in-process rendering where the bundle
 * does not exist (unit tests, an unbundled run) — the bytes are the same.
 */
import { parentPort } from "node:worker_threads";
import { renderEvaluation, type EvaluationRenderOptions } from "./lib/evaluationRender";
import { renderArrangementExport } from "./lib/exportEngine";
import { packEvaluationRender, packExportFiles, type RenderWorkerRequest } from "./lib/renderOffThread";

parentPort?.on("message", async (request: RenderWorkerRequest) => {
  try {
    if (request.kind === "evaluation") {
      const render = renderEvaluation(request.trackModels, request.options as EvaluationRenderOptions);
      const { payload, transfer } = packEvaluationRender(render);
      parentPort?.postMessage({ id: request.id, result: payload }, transfer);
      return;
    }
    if (request.kind === "export") {
      const files = await renderArrangementExport(request.input as Parameters<typeof renderArrangementExport>[0]);
      const { payload, transfer } = packExportFiles(files);
      parentPort?.postMessage({ id: request.id, result: payload }, transfer);
      return;
    }
    parentPort?.postMessage({ id: (request as { id: number }).id, error: `unknown render request kind` });
  } catch (error) {
    parentPort?.postMessage({ id: request.id, error: error instanceof Error ? (error.stack ?? error.message) : String(error) });
  }
});
