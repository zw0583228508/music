/**
 * HTTP client for the Anticipatory Music Transformer worker (Wave Q — Model
 * Discovery, round 2), on the CA2 client's pattern.
 *
 * The worker lives at `ANTICIPATORY_MT_API_URL` and takes a **dedicated**
 * bearer token, `ANTICIPATORY_MT_API_TOKEN`. There is deliberately no fallback
 * to the shared `MUSIC_AI_WORKER_TOKEN` nor to the CA2 token: one provider,
 * one credential, one blast radius.
 *
 *   amtHealth()  — the worker's identity gate; the only source of `identity`
 *                  for `amtResultRefusal`.
 *   amtInfill()  — one real inference: a Standard MIDI File, the held-out
 *                  part by GM program, a bar window, seed and top_p. Returns
 *                  the worker's result verbatim with `identity` attached.
 *
 * Configuration never implies readiness, and for this provider readiness is
 * not a possible state: it is RESEARCH_ONLY. This client exists for the
 * tournament runner and the evidence probe only.
 */
import type { AmtWorkerResult } from "./anticipatoryResultAdapter";

export const AMT_URL_ENV = "ANTICIPATORY_MT_API_URL";
export const AMT_TOKEN_ENV = "ANTICIPATORY_MT_API_TOKEN";

export type AmtEndpoint = { baseUrl: string; token: string };

export type AmtInfillParams = {
  midi: Uint8Array;
  midiName?: string;
  /** GM program 0–127, or 128 for drums. */
  targetInst?: number;
  startMeasure?: number;
  nMeasures?: number;
  seed?: number;
  topP?: number;
  maxEvents?: number;
  /** May the model answer "not here" inside the window? (its own REST token) */
  allowRest?: boolean;
  /** May it write a note it has already written at this onset? */
  forbidDuplicate?: boolean;
  /** Force every sampled note to the held-out program (the worker's default)? Unmasked, the model writes the other instruments and returns nothing for the held-out one. */
  maskInstrument?: boolean;
};

export type AmtHealth = {
  provider?: string;
  model?: string;
  revision?: string;
  modelSafetensorsVerified?: boolean;
  modelSafetensorsSha256Expected?: string;
  healthy?: boolean;
  imageEvidence?: string | null;
  runtime?: { python?: string; torch?: string; transformers?: string; cuda?: boolean; device?: string };
  [key: string]: unknown;
};

type FetchLike = (input: string, init?: RequestInit) => Promise<Response>;

/** Why the client cannot be built, or null when it can. Names the variable so an operator can fix it. */
export function amtEndpointRefusal(env: NodeJS.ProcessEnv = process.env): string | null {
  const url = env[AMT_URL_ENV]?.trim();
  const token = env[AMT_TOKEN_ENV]?.trim();
  if (!url) return `${AMT_URL_ENV} is not set`;
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return `${AMT_URL_ENV} is not a URL`;
  }
  if (parsed.protocol !== "https:" && !/^(localhost|127\.0\.0\.1)$/.test(parsed.hostname)) {
    return `${AMT_URL_ENV} must be https (a bearer token travels with every request)`;
  }
  if (!token) return `${AMT_TOKEN_ENV} is not set (neither the shared worker token nor another provider's token is accepted)`;
  return null;
}

export function amtEndpoint(env: NodeJS.ProcessEnv = process.env): AmtEndpoint | null {
  if (amtEndpointRefusal(env)) return null;
  return { baseUrl: env[AMT_URL_ENV]!.trim().replace(/\/+$/, ""), token: env[AMT_TOKEN_ENV]!.trim() };
}

async function readJson(response: Response): Promise<unknown> {
  const text = await response.text();
  try {
    return JSON.parse(text);
  } catch {
    return { text: text.slice(0, 800) };
  }
}

export class AmtHttpError extends Error {
  constructor(
    readonly call: "health" | "infill",
    readonly status: number,
    readonly body: unknown,
  ) {
    super(`AMT ${call} returned HTTP ${status}`);
  }
}

/** GET /health. Throws on a non-2xx; a 401 here means the dedicated token is wrong, not that the model is. */
export async function amtHealth(
  endpoint: AmtEndpoint,
  options: { fetchImpl?: FetchLike; timeoutMs?: number } = {},
): Promise<AmtHealth> {
  const fetchImpl = options.fetchImpl ?? fetch;
  const response = await fetchImpl(`${endpoint.baseUrl}/health`, {
    headers: { Authorization: `Bearer ${endpoint.token}` },
    // A cold container loads 3.1 GB of fp32 weights onto a GPU and hashes them before it answers.
    signal: AbortSignal.timeout(options.timeoutMs ?? 600_000),
  });
  const body = await readJson(response);
  if (!response.ok) throw new AmtHttpError("health", response.status, body);
  return body as AmtHealth;
}

/**
 * POST /infill. Returns the worker's result with `identity` attached from
 * `health`, so `amtResultRefusal` judges against what the container verified.
 */
export async function amtInfill(
  endpoint: AmtEndpoint,
  params: AmtInfillParams,
  health: AmtHealth,
  options: { fetchImpl?: FetchLike; timeoutMs?: number } = {},
): Promise<AmtWorkerResult & { httpSeconds: number }> {
  const fetchImpl = options.fetchImpl ?? fetch;
  const form = new FormData();
  const bytes = Uint8Array.from(params.midi);
  form.append("midi", new Blob([bytes.buffer], { type: "audio/midi" }), params.midiName ?? "input.mid");
  const fields: Array<[string, number | undefined]> = [
    ["target_inst", params.targetInst],
    ["start_measure", params.startMeasure],
    ["n_measures", params.nMeasures],
    ["seed", params.seed],
    ["top_p", params.topP],
    ["max_events", params.maxEvents],
  ];
  for (const [name, value] of fields) {
    if (value !== undefined) form.append(name, String(value));
  }
  // Booleans travel as "true"/"false"; FastAPI parses both.
  for (const [name, value] of [["allow_rest", params.allowRest], ["forbid_duplicate", params.forbidDuplicate], ["mask_instrument", params.maskInstrument]] as const) {
    if (value !== undefined) form.append(name, value ? "true" : "false");
  }
  const started = Date.now();
  const response = await fetchImpl(`${endpoint.baseUrl}/infill`, {
    method: "POST",
    headers: { Authorization: `Bearer ${endpoint.token}` },
    body: form,
    signal: AbortSignal.timeout(options.timeoutMs ?? 1_200_000),
  });
  const body = await readJson(response);
  if (!response.ok) throw new AmtHttpError("infill", response.status, body);
  const result = body as AmtWorkerResult;
  return {
    ...result,
    identity: {
      modelSafetensorsVerified: health.modelSafetensorsVerified,
      modelSafetensorsSha256Expected: health.modelSafetensorsSha256Expected,
      revision: health.revision,
      model: health.model,
    },
    httpSeconds: Number(((Date.now() - started) / 1000).toFixed(2)),
  };
}
