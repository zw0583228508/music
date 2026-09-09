/**
 * Analysis asset leases (Wave Q, Q-01 transport).
 *
 * A cloud analysis worker cannot fetch audio from `http://localhost:5000`, and
 * it is right to refuse: its SSRF guard requires a globally-resolvable source.
 * The obvious fix — put a public tunnel in front of the development API — is
 * the wrong one. This API mounts `/api/dev-login`, which mints a full session
 * for anyone who asks, and that session reaches the Neon database. Exposing the
 * API exposes the database.
 *
 * A lease exposes one object instead of one application:
 *
 *  - a 256-bit random token addresses a single stored object,
 *  - it expires, and may be spent a bounded number of times,
 *  - the surface that serves it is read-only, has no session, no cookie, no
 *    database and no second route.
 *
 * If a lease URL leaks, the loss is that one audio file until the lease
 * expires. If the API leaks, the loss is the account and everything in it.
 *
 * This module is the ledger only. Serving is `analysisAssetServer.ts`, which
 * has no way to read an object this module did not lease.
 */
import { randomBytes } from "node:crypto";

/** Long enough for a slow transcription fetch, short enough to be a lease. */
export const DEFAULT_LEASE_TTL_MS = 30 * 60 * 1000;

/** One worker may retry; it may not become a distribution channel. */
export const DEFAULT_LEASE_MAX_FETCHES = 3;

export type AssetLease = {
  token: string;
  bucketName: string;
  objectName: string;
  /** Epoch ms after which the lease is dead, spent or not. */
  expiresAt: number;
  maxFetches: number;
  fetches: number;
};

export type LeaseStore = Map<string, AssetLease>;

export const createLeaseStore = (): LeaseStore => new Map();

/**
 * Why a base URL may not be used, or null when it may.
 *
 * The point of a lease is to be reachable by a cloud worker while the API is
 * not. A base that is plain http, or that points back at this machine, either
 * defeats the guard or fails it — both are refused here rather than at the
 * worker, so the reason is visible where it can be fixed.
 */
export function assetBaseUrlRefusal(raw: string | undefined | null): string | null {
  const value = raw?.trim();
  if (!value) return "no analysis asset base URL is configured";
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    return `"${value}" is not a URL`;
  }
  if (url.protocol !== "https:") {
    // The lease travels over the public internet: plain http would publish the
    // token to every hop on the way.
    return `${url.protocol}// is not https, and a lease token must not travel in clear text`;
  }
  if (/^(localhost|127\.|0\.0\.0\.0|\[?::1\]?$|10\.|192\.168\.|169\.254\.)/i.test(url.hostname) ||
      /^172\.(1[6-9]|2\d|3[01])\./.test(url.hostname)) {
    return `${url.hostname} is not globally resolvable, so a cloud worker cannot fetch it`;
  }
  if (url.search || url.hash) return "an asset base URL must not carry a query or fragment";
  return null;
}

/** The configured base, or null with the reason it may not be used. */
export function analysisAssetBase(
  environment: NodeJS.ProcessEnv = process.env,
): { base: string } | { refusal: string } {
  const raw = environment.ANALYSIS_ASSET_BASE_URL;
  const refusal = assetBaseUrlRefusal(raw);
  if (refusal) return { refusal };
  return { base: raw!.trim().replace(/\/+$/, "") };
}

export const leaseUrl = (base: string, token: string): string =>
  `${base.replace(/\/+$/, "")}/a/${token}`;

/** The token in `/a/<token>`, or null when the path is anything else. */
export function tokenFromPath(path: string): string | null {
  const match = /^\/a\/([A-Za-z0-9_-]{43})$/.exec(path.split("?")[0]);
  return match ? match[1] : null;
}

export function mintLease(
  store: LeaseStore,
  input: {
    bucketName: string;
    objectName: string;
    ttlMs?: number;
    maxFetches?: number;
    now?: number;
  },
): AssetLease {
  if (!input.bucketName || !input.objectName) {
    throw new Error("A lease needs a bucket and an object");
  }
  const now = input.now ?? Date.now();
  // 256 bits: a lease URL is the only credential, so it is not guessable and
  // not enumerable.
  const token = randomBytes(32).toString("base64url");
  const lease: AssetLease = {
    token,
    bucketName: input.bucketName,
    objectName: input.objectName,
    expiresAt: now + Math.max(1, input.ttlMs ?? DEFAULT_LEASE_TTL_MS),
    maxFetches: Math.max(1, input.maxFetches ?? DEFAULT_LEASE_MAX_FETCHES),
    fetches: 0,
  };
  store.set(token, lease);
  return lease;
}

export type LeaseClaim =
  | { lease: AssetLease }
  /** For the log only. Every refusal is one 404 to the caller. */
  | { refusal: "unknown" | "expired" | "exhausted" };

/**
 * Spend one fetch of a lease. Expired and exhausted leases are deleted rather
 * than left to accumulate: a ledger of dead tokens is a list of things to
 * guess at.
 */
export function claimLease(store: LeaseStore, token: string, now = Date.now()): LeaseClaim {
  const lease = store.get(token);
  if (!lease) return { refusal: "unknown" };
  if (now >= lease.expiresAt) {
    store.delete(token);
    return { refusal: "expired" };
  }
  if (lease.fetches >= lease.maxFetches) {
    store.delete(token);
    return { refusal: "exhausted" };
  }
  lease.fetches += 1;
  return { lease };
}

/** Drop leases that can no longer be claimed. Returns how many went. */
export function pruneLeases(store: LeaseStore, now = Date.now()): number {
  let dropped = 0;
  for (const [token, lease] of store) {
    if (now >= lease.expiresAt || lease.fetches >= lease.maxFetches) {
      store.delete(token);
      dropped += 1;
    }
  }
  return dropped;
}

/** Revoke every outstanding lease — used when a run ends or the server stops. */
export function revokeAllLeases(store: LeaseStore): number {
  const count = store.size;
  store.clear();
  return count;
}
