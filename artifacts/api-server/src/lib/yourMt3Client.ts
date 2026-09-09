/**
 * HTTP client for the YourMT3+ transcription worker (PR-83, stream C), on the
 * anticipatory / CA2 client pattern.
 *
 * Naming: `amt*` in this repository already means the **Anticipatory Music
 * Transformer**. Automatic Music Transcription is spelled `yourMt3*` here so
 * the two never collide.
 *
 * The worker lives at `YOURMT3_API_URL` and takes a **dedicated** bearer
 * token, `YOURMT3_API_TOKEN`. There is deliberately no fallback to the shared
 * `MUSIC_AI_WORKER_TOKEN`: one provider, one credential, one blast radius.
 *
 *   yourMt3Health()      — the identity gate; the only source of `identity`
 *                          for `yourMt3ResultRefusal`.
 *   yourMt3Transcribe()  — one real inference: a WAV in, notes out, with the
 *                          container's identity attached.
 *
 * Configuration never implies readiness. `YOUR_MT3` is
 * `LEGAL_REVIEW_REQUIRED` — a GPL-3.0/Apache-2.0 conflict on the code and
 * unread terms on the training corpora — so this client exists for the sweep,
 * the evidence probe and a future shadow arm, and for nothing user-facing.
 */
export const YOUR_MT3_URL_ENV = "YOURMT3_API_URL";
export const YOUR_MT3_TOKEN_ENV = "YOURMT3_API_TOKEN";

/** The variants the worker image carries. `YPTF.MoE+Multi` is the challenge's 2nd-place row. */
export const YOUR_MT3_VARIANTS = ["YPTF.MoE+Multi", "YPTF+Single", "YMT3+"] as const;
export type YourMt3Variant = (typeof YOUR_MT3_VARIANTS)[number];

export type YourMt3Endpoint = { baseUrl: string; token: string };

/** One note as the worker emits it: seconds, GM program, drum flag. */
export type YourMt3WorkerNote = {
  onset: number;
  offset: number;
  pitch: number;
  program: number;
  isDrum: boolean;
  /** The model's internal program group before `midi_output_inverse_vocab`. */
  rawProgram?: number;
};

export type YourMt3Identity = {
  provider?: string;
  family?: string;
  codeRevision?: string;
  codeSource?: string;
  modelRepo?: string;
  modelRevision?: string;
  imageEvidence?: string | null;
  licence?: string;
  checkpoints?: {
    verified?: boolean;
    checkpoints?: Record<string, { variant?: string; verified?: boolean; sha256?: string; sha256Expected?: string; bytes?: number; reason?: string }>;
  };
  runtime?: { python?: string; torch?: string; cuda?: boolean; device?: string; gpuName?: string | null };
  [key: string]: unknown;
};

export type YourMt3Health = { healthy?: boolean } & YourMt3Identity;

export type YourMt3TranscribeResult = {
  variant: string;
  notes: YourMt3WorkerNote[];
  noteCount: number;
  audio?: {
    sourceSampleRate?: number;
    modelSampleRate?: number;
    durationSeconds?: number;
    segments?: number;
    sha256?: string;
  };
  seconds?: { prepare?: number; inference?: number; decode?: number; total?: number };
  realtimeFactor?: number;
  decodeErrors?: Record<string, number>;
  identity?: YourMt3Identity;
};

type FetchLike = (input: string, init?: RequestInit) => Promise<Response>;

/** Why the client cannot be built, or null when it can. Names the variable so an operator can fix it. */
export function yourMt3EndpointRefusal(env: NodeJS.ProcessEnv = process.env): string | null {
  const url = env[YOUR_MT3_URL_ENV]?.trim();
  const token = env[YOUR_MT3_TOKEN_ENV]?.trim();
  if (!url) return `${YOUR_MT3_URL_ENV} is not set`;
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return `${YOUR_MT3_URL_ENV} is not a URL`;
  }
  if (parsed.protocol !== "https:" && !/^(localhost|127\.0\.0\.1)$/.test(parsed.hostname)) {
    return `${YOUR_MT3_URL_ENV} must be https (a bearer token travels with every request)`;
  }
  if (!token) return `${YOUR_MT3_TOKEN_ENV} is not set (the shared worker token is not accepted)`;
  return null;
}

export function yourMt3Endpoint(env: NodeJS.ProcessEnv = process.env): YourMt3Endpoint | null {
  if (yourMt3EndpointRefusal(env)) return null;
  return {
    baseUrl: env[YOUR_MT3_URL_ENV]!.trim().replace(/\/+$/, ""),
    token: env[YOUR_MT3_TOKEN_ENV]!.trim(),
  };
}

async function readJson(response: Response): Promise<unknown> {
  const text = await response.text();
  try {
    return JSON.parse(text);
  } catch {
    return { text: text.slice(0, 800) };
  }
}

export class YourMt3HttpError extends Error {
  constructor(
    readonly call: "health" | "transcribe",
    readonly status: number,
    readonly body: unknown,
  ) {
    super(`YourMT3 ${call} returned HTTP ${status}`);
  }
}

/**
 * GET /health. Throws on a non-2xx; a 401 here means the dedicated token is
 * wrong, not that the model is.
 */
export async function yourMt3Health(
  endpoint: YourMt3Endpoint,
  options: { fetchImpl?: FetchLike; timeoutMs?: number } = {},
): Promise<YourMt3Health> {
  const fetchImpl = options.fetchImpl ?? fetch;
  const response = await fetchImpl(`${endpoint.baseUrl}/health`, {
    headers: { Authorization: `Bearer ${endpoint.token}` },
    // A cold container re-hashes 1.6 GB of checkpoints before it answers.
    signal: AbortSignal.timeout(options.timeoutMs ?? 900_000),
  });
  const body = await readJson(response);
  if (!response.ok) throw new YourMt3HttpError("health", response.status, body);
  return body as YourMt3Health;
}

/**
 * POST /transcribe. Returns the worker's result with `identity` attached from
 * `health`, so `yourMt3ResultRefusal` judges against what the container
 * verified rather than against what the response claims about itself.
 */
export async function yourMt3Transcribe(
  endpoint: YourMt3Endpoint,
  params: { wav: Uint8Array; wavName?: string; variant?: YourMt3Variant },
  options: { fetchImpl?: FetchLike; timeoutMs?: number; identity?: YourMt3Identity } = {},
): Promise<YourMt3TranscribeResult> {
  const fetchImpl = options.fetchImpl ?? fetch;
  const form = new FormData();
  // `Uint8Array` is a valid Blob part at runtime; the DOM lib's `BlobPart` is
  // not in scope in this server build, so the cast is to `ArrayBufferView`.
  form.append(
    "audio",
    new Blob([params.wav as ArrayBufferView as never], { type: "audio/wav" }),
    params.wavName ?? "clip.wav",
  );
  form.append("variant", params.variant ?? "YPTF.MoE+Multi");
  const response = await fetchImpl(`${endpoint.baseUrl}/transcribe`, {
    method: "POST",
    headers: { Authorization: `Bearer ${endpoint.token}` },
    body: form,
    signal: AbortSignal.timeout(options.timeoutMs ?? 900_000),
  });
  const body = await readJson(response);
  if (!response.ok) throw new YourMt3HttpError("transcribe", response.status, body);
  const result = body as YourMt3TranscribeResult;
  if (options.identity) result.identity = options.identity;
  return result;
}
