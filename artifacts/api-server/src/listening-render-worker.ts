/**
 * Worker-thread entry: render one listening side off the main thread (PR-72).
 *
 * A side is seconds of synchronous DSP; a 50-pair session is minutes of it.
 * On the main thread that starves the event loop long enough for the database
 * pool's idle connections to be dropped and their TLS re-handshakes to time
 * out. This worker takes `{ id, midi, renderer }` and answers
 * `{ id, render }` (or `{ id, error }`), so the API stays responsive while a
 * session is opened. Built as its own bundle entry (`build.mjs`).
 */
import { parentPort } from "node:worker_threads";
import { renderTournamentSide, type TournamentRenderer } from "./lib/tournamentAudio";

type Request = { id: number; midi: Uint8Array; renderer?: TournamentRenderer };

parentPort?.on("message", (request: Request) => {
  try {
    const render = renderTournamentSide(Buffer.from(request.midi), { renderer: request.renderer });
    const wav = render.wav;
    // Transfer the WAV's bytes rather than copying them.
    const copy = new Uint8Array(wav.buffer.slice(wav.byteOffset, wav.byteOffset + wav.byteLength));
    parentPort?.postMessage({ id: request.id, render: { ...render, wav: copy } }, [copy.buffer as ArrayBuffer]);
  } catch (error) {
    parentPort?.postMessage({ id: request.id, error: error instanceof Error ? error.message : String(error) });
  }
});
