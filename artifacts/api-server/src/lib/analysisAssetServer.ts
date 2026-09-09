/**
 * The one read-only surface a cloud analysis worker is allowed to reach.
 *
 * This is deliberately not the API. It is a separate `http.Server`, on its own
 * port, with exactly one route — `GET /a/<token>` — and no session, cookie,
 * database handle or write path anywhere in it. A tunnel points here; the API
 * stays on localhost.
 *
 * Everything it can serve was leased by `analysisAssetLease.ts`. There is no
 * path parameter that names an object, so there is nothing to traverse: an
 * unleased object is unreachable no matter what the caller sends.
 */
import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import type { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";
import {
  claimLease,
  pruneLeases,
  revokeAllLeases,
  tokenFromPath,
  type LeaseStore,
} from "./analysisAssetLease";

export type ObjectReader = (
  bucketName: string,
  objectName: string,
) => Promise<{ stream: Readable; contentType?: string; size?: number } | null>;

export type AssetServerEvent =
  | { kind: "served"; bucketName: string; objectName: string; bytes?: number }
  | { kind: "refused"; reason: "unknown" | "expired" | "exhausted" | "not_a_lease" | "method" | "missing" }
  | { kind: "failed"; message: string };

export type AssetServerOptions = {
  store: LeaseStore;
  readObject: ObjectReader;
  onEvent?: (event: AssetServerEvent) => void;
};

/**
 * Every refusal is the same 404 with no body. The caller learns whether a
 * token works, and nothing else: not whether it once existed, not whether it
 * expired, not whether the object is there. The reason goes to the log.
 */
function refuse(
  res: ServerResponse,
  reason: Extract<AssetServerEvent, { kind: "refused" }>["reason"],
  onEvent?: AssetServerOptions["onEvent"],
): void {
  onEvent?.({ kind: "refused", reason });
  res.writeHead(404, { "Content-Type": "text/plain", "Cache-Control": "no-store" });
  res.end("not found");
}

export function createAssetRequestHandler(options: AssetServerOptions) {
  const { store, readObject, onEvent } = options;
  return async function handle(req: IncomingMessage, res: ServerResponse): Promise<void> {
    try {
      if (req.method !== "GET" && req.method !== "HEAD") {
        // Nothing here is writable; a non-read method is not a mistake to
        // correct, it is a caller that wants something this surface never does.
        return refuse(res, "method", onEvent);
      }
      const token = tokenFromPath(req.url ?? "/");
      if (!token) return refuse(res, "not_a_lease", onEvent);

      const claim = claimLease(store, token);
      if ("refusal" in claim) return refuse(res, claim.refusal, onEvent);

      const object = await readObject(claim.lease.bucketName, claim.lease.objectName);
      if (!object) return refuse(res, "missing", onEvent);

      res.writeHead(200, {
        "Content-Type": object.contentType ?? "application/octet-stream",
        ...(object.size ? { "Content-Length": String(object.size) } : {}),
        // A lease is private and single-purpose: nothing on the way may keep it.
        "Cache-Control": "private, no-store",
        "X-Content-Type-Options": "nosniff",
      });
      if (req.method === "HEAD") {
        object.stream.destroy();
        res.end();
      } else {
        await pipeline(object.stream, res);
      }
      onEvent?.({
        kind: "served",
        bucketName: claim.lease.bucketName,
        objectName: claim.lease.objectName,
        bytes: object.size,
      });
    } catch (error) {
      onEvent?.({ kind: "failed", message: error instanceof Error ? error.message : String(error) });
      if (!res.headersSent) {
        res.writeHead(500, { "Content-Type": "text/plain", "Cache-Control": "no-store" });
        res.end("error");
      } else {
        res.destroy();
      }
    }
  };
}

export type AnalysisAssetServer = {
  server: Server;
  port: number;
  /** Revokes every outstanding lease, then stops listening. */
  close: () => Promise<number>;
};

/**
 * Starts the asset surface. Binds to loopback unless a host is given, so
 * exposing it is a deliberate act — a tunnel or an explicit bind — and never a
 * side effect of starting the API.
 */
export async function startAnalysisAssetServer(
  options: AssetServerOptions & { port: number; host?: string; pruneIntervalMs?: number },
): Promise<AnalysisAssetServer> {
  const handler = createAssetRequestHandler(options);
  const server = createServer((req, res) => {
    void handler(req, res);
  });
  const pruneTimer = setInterval(
    () => pruneLeases(options.store),
    options.pruneIntervalMs ?? 60_000,
  );
  pruneTimer.unref();

  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(options.port, options.host ?? "127.0.0.1", () => {
      server.removeListener("error", reject);
      resolve();
    });
  });
  const address = server.address();
  const port = typeof address === "object" && address ? address.port : options.port;

  return {
    server,
    port,
    close: async () => {
      clearInterval(pruneTimer);
      // Revoke first: a lease that outlives the server that serves it is a
      // token still in someone's log with nothing to say it is dead.
      const revoked = revokeAllLeases(options.store);
      await new Promise<void>((resolve) => server.close(() => resolve()));
      return revoked;
    },
  };
}
