/**
 * Render a listening side without blocking the API's event loop (PR-72).
 *
 * In the built server the sibling bundle `listening-render-worker.mjs`
 * exists and every render goes through one lazily started worker thread,
 * requests answered in order. Where that file does not exist (unit tests,
 * an unbundled run) the render happens in-process, exactly as before — the
 * bytes are the same either way, since both call `renderTournamentSide`.
 */
import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { Worker } from "node:worker_threads";
import { renderTournamentSide, type TournamentRenderer, type TournamentSideRender } from "./tournamentAudio";

type Pending = { resolve: (render: TournamentSideRender) => void; reject: (error: Error) => void };

let worker: Worker | null = null;
let nextId = 1;
const pending = new Map<number, Pending>();

function workerUrl(): URL | null {
  try {
    const url = new URL("./listening-render-worker.mjs", import.meta.url);
    return existsSync(fileURLToPath(url)) ? url : null;
  } catch {
    return null;
  }
}

function startWorker(url: URL): Worker {
  const w = new Worker(url);
  w.on("message", (message: { id: number; render?: TournamentSideRender & { wav: Uint8Array }; error?: string }) => {
    const p = pending.get(message.id);
    if (!p) return;
    pending.delete(message.id);
    if (message.error || !message.render) p.reject(new Error(message.error ?? "render worker returned nothing"));
    else p.resolve({ ...message.render, wav: Buffer.from(message.render.wav.buffer, message.render.wav.byteOffset, message.render.wav.byteLength) });
  });
  w.on("error", (error: unknown) => {
    const failure = error instanceof Error ? error : new Error(String(error));
    for (const p of pending.values()) p.reject(failure);
    pending.clear();
    worker = null;
  });
  w.on("exit", () => { worker = null; });
  w.unref();
  return w;
}

/** Where the render will run: informational, for logs and evidence. */
export function renderOffThreadAvailable(): boolean {
  return workerUrl() !== null;
}

export function renderSideOffThread(midi: Buffer, options: { renderer?: TournamentRenderer } = {}): Promise<TournamentSideRender> {
  const url = workerUrl();
  if (!url) return Promise.resolve(renderTournamentSide(midi, options));
  if (!worker) worker = startWorker(url);
  const id = nextId;
  nextId += 1;
  return new Promise<TournamentSideRender>((resolve, reject) => {
    pending.set(id, { resolve, reject });
    const bytes = new Uint8Array(midi.buffer.slice(midi.byteOffset, midi.byteOffset + midi.byteLength));
    worker!.ref();
    worker!.postMessage({ id, midi: bytes, renderer: options.renderer }, [bytes.buffer as ArrayBuffer]);
  }).finally(() => { if (!pending.size) worker?.unref(); });
}
