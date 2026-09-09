/**
 * HTTP client for the Composer's Assistant 2 worker (Wave Q — Model Discovery).
 *
 * The worker lives at `COMPOSERS_ASSISTANT_2_API_URL` and takes a **dedicated**
 * bearer token, `COMPOSERS_ASSISTANT_2_API_TOKEN`. There is deliberately no
 * fallback to the shared `MUSIC_AI_WORKER_TOKEN`: one provider, one credential,
 * one blast radius, and a misconfigured shared token can never quietly open
 * this endpoint.
 *
 * Two calls:
 *
 *   health()  — the worker's identity gate. The response is the only source of
 *               `identity` for `ca2ResultRefusal`, so an infill result is judged
 *               against what the running container actually verified, not
 *               against a constant on this side.
 *   infill()  — one real inference: a Standard MIDI File, the target named by
 *               GM program (`targetInst`) or post-clean track index, a measure
 *               window, and the sampling parameters. Returns the worker's
 *               result verbatim; conversion and refusal live in
 *               `ca2ResultAdapter`.
 *
 * Configuration in the catalogue never implies readiness. This client can be
 * configured and still refuse every result — that is the design.
 */
import type { Ca2WorkerResult } from "./ca2ResultAdapter";

export const CA2_URL_ENV = "COMPOSERS_ASSISTANT_2_API_URL";
export const CA2_TOKEN_ENV = "COMPOSERS_ASSISTANT_2_API_TOKEN";

export type Ca2Endpoint = { baseUrl: string; token: string };

export type Ca2InfillParams = {
  midi: Uint8Array;
  midiName?: string;
  /** GM program 0–127, or 128 for drums. Resolved by the worker after CA2's own cleaning. */
  targetInst?: number;
  /** Post-clean track index. Prefer `targetInst`; indices from another parser mean nothing to CA2. */
  targetTrack?: number;
  startMeasure?: number;
  nMeasures?: number;
  seed?: number;
  maxNewTokens?: number;
  temperature?: number;
  topP?: number;
};

export type Ca2Health = {
  provider?: string;
  release?: string;
  modelBinVerified?: boolean;
  modelBinSha256Expected?: string;
  healthy?: boolean;
  imageEvidence?: string | null;
  [key: string]: unknown;
};

type FetchLike = (input: string, init?: RequestInit) => Promise<Response>;

/** Why the client cannot be built, or null when it can. Names the variable so an operator can fix it. */
export function ca2EndpointRefusal(env: NodeJS.ProcessEnv = process.env): string | null {
  const url = env[CA2_URL_ENV]?.trim();
  const token = env[CA2_TOKEN_ENV]?.trim();
  if (!url) return `${CA2_URL_ENV} is not set`;
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return `${CA2_URL_ENV} is not a URL`;
  }
  if (parsed.protocol !== "https:" && !/^(localhost|127\.0\.0\.1)$/.test(parsed.hostname)) {
    return `${CA2_URL_ENV} must be https (a bearer token travels with every request)`;
  }
  if (!token) return `${CA2_TOKEN_ENV} is not set (the shared worker token is deliberately not accepted)`;
  return null;
}

export function ca2Endpoint(env: NodeJS.ProcessEnv = process.env): Ca2Endpoint | null {
  if (ca2EndpointRefusal(env)) return null;
  return { baseUrl: env[CA2_URL_ENV]!.trim().replace(/\/+$/, ""), token: env[CA2_TOKEN_ENV]!.trim() };
}

async function readJson(response: Response): Promise<unknown> {
  const text = await response.text();
  try {
    return JSON.parse(text);
  } catch {
    return { text: text.slice(0, 800) };
  }
}

export class Ca2HttpError extends Error {
  constructor(
    readonly call: "health" | "infill",
    readonly status: number,
    readonly body: unknown,
  ) {
    super(`CA2 ${call} returned HTTP ${status}`);
  }
}

/** GET /health. Throws on a non-2xx; a 401 here means the dedicated token is wrong, not that the model is. */
export async function ca2Health(
  endpoint: Ca2Endpoint,
  options: { fetchImpl?: FetchLike; timeoutMs?: number } = {},
): Promise<Ca2Health> {
  const fetchImpl = options.fetchImpl ?? fetch;
  const response = await fetchImpl(`${endpoint.baseUrl}/health`, {
    headers: { Authorization: `Bearer ${endpoint.token}` },
    // A cold container loads 770 MB of fp32 weights before it answers.
    signal: AbortSignal.timeout(options.timeoutMs ?? 300_000),
  });
  const body = await readJson(response);
  if (!response.ok) throw new Ca2HttpError("health", response.status, body);
  return body as Ca2Health;
}

/**
 * POST /infill. Returns the worker's result with `identity` attached from
 * `health`, so `ca2ResultRefusal` can check the checksum the container
 * reported. `health` is a parameter, not fetched here, so a tournament pays
 * for one health call per session rather than one per task.
 */
export async function ca2Infill(
  endpoint: Ca2Endpoint,
  params: Ca2InfillParams,
  health: Ca2Health,
  options: { fetchImpl?: FetchLike; timeoutMs?: number } = {},
): Promise<Ca2WorkerResult & { httpSeconds: number }> {
  const fetchImpl = options.fetchImpl ?? fetch;
  const form = new FormData();
  // Copy into a fresh ArrayBuffer: a view over a shared or offset buffer is not a Blob part.
  const bytes = Uint8Array.from(params.midi);
  form.append("midi", new Blob([bytes.buffer], { type: "audio/midi" }), params.midiName ?? "input.mid");
  const fields: Array<[string, number | undefined]> = [
    ["target_inst", params.targetInst],
    ["target_track", params.targetTrack],
    ["start_measure", params.startMeasure],
    ["n_measures", params.nMeasures],
    ["seed", params.seed],
    ["max_new_tokens", params.maxNewTokens],
    ["temperature", params.temperature],
    ["top_p", params.topP],
  ];
  for (const [name, value] of fields) {
    if (value !== undefined) form.append(name, String(value));
  }
  const started = Date.now();
  const response = await fetchImpl(`${endpoint.baseUrl}/infill`, {
    method: "POST",
    headers: { Authorization: `Bearer ${endpoint.token}` },
    body: form,
    signal: AbortSignal.timeout(options.timeoutMs ?? 1_500_000),
  });
  const body = await readJson(response);
  if (!response.ok) throw new Ca2HttpError("infill", response.status, body);
  const result = body as Ca2WorkerResult;
  return {
    ...result,
    identity: {
      modelBinVerified: health.modelBinVerified,
      modelBinSha256Expected: health.modelBinSha256Expected,
      release: health.release,
    },
    httpSeconds: Number(((Date.now() - started) / 1000).toFixed(2)),
  };
}
