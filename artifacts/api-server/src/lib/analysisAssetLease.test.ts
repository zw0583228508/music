import assert from "node:assert/strict";
import { Readable, Writable } from "node:stream";
import test from "node:test";
import {
  DEFAULT_LEASE_MAX_FETCHES,
  analysisAssetBase,
  assetBaseUrlRefusal,
  claimLease,
  createLeaseStore,
  leaseUrl,
  mintLease,
  pruneLeases,
  revokeAllLeases,
  tokenFromPath,
} from "./analysisAssetLease";
import { createAssetRequestHandler, startAnalysisAssetServer } from "./analysisAssetServer";

test("a base URL that would leak the token, or that no worker can reach, is refused", () => {
  assert.equal(assetBaseUrlRefusal("https://tunnel.example.test"), null);
  assert.match(assetBaseUrlRefusal(undefined)!, /no analysis asset base URL/);
  assert.match(assetBaseUrlRefusal("http://tunnel.example.test")!, /not https/);
  assert.match(assetBaseUrlRefusal("https://localhost:8080")!, /not globally resolvable/);
  assert.match(assetBaseUrlRefusal("https://127.0.0.1:8080")!, /not globally resolvable/);
  assert.match(assetBaseUrlRefusal("https://192.168.1.9")!, /not globally resolvable/);
  assert.match(assetBaseUrlRefusal("https://172.20.0.4")!, /not globally resolvable/);
  assert.match(assetBaseUrlRefusal("not a url")!, /is not a URL/);
  assert.match(assetBaseUrlRefusal("https://ok.example.test/?x=1")!, /query or fragment/);

  assert.deepEqual(analysisAssetBase({ ANALYSIS_ASSET_BASE_URL: "https://ok.example.test/" } as NodeJS.ProcessEnv), {
    base: "https://ok.example.test",
  });
  assert.ok("refusal" in analysisAssetBase({} as NodeJS.ProcessEnv));
});

test("a lease is unguessable, expires, and is spent a bounded number of times", () => {
  const store = createLeaseStore();
  const lease = mintLease(store, { bucketName: "b", objectName: "uploads/x.wav", now: 1_000, ttlMs: 500 });
  assert.equal(lease.token.length, 43, "256 bits of randomness, base64url");
  assert.equal(lease.maxFetches, DEFAULT_LEASE_MAX_FETCHES);
  assert.equal(leaseUrl("https://t.example.test/", lease.token), `https://t.example.test/a/${lease.token}`);

  // Nobody else's token opens it.
  assert.deepEqual(claimLease(store, "z".repeat(43), 1_100), { refusal: "unknown" });
  const claimed = claimLease(store, lease.token, 1_100);
  assert.ok("lease" in claimed && claimed.lease.objectName === "uploads/x.wav");

  // Past its expiry it is dead even though fetches remain, and it is dropped.
  assert.deepEqual(claimLease(store, lease.token, 1_600), { refusal: "expired" });
  assert.equal(store.size, 0, "a dead token is deleted, not kept as something to guess at");
});

test("a lease is exhausted after its fetches, and the store does not accumulate dead tokens", () => {
  const store = createLeaseStore();
  const lease = mintLease(store, { bucketName: "b", objectName: "o", maxFetches: 2, now: 0, ttlMs: 10_000 });
  assert.ok("lease" in claimLease(store, lease.token, 1));
  assert.ok("lease" in claimLease(store, lease.token, 2));
  assert.deepEqual(claimLease(store, lease.token, 3), { refusal: "exhausted" });

  const other = mintLease(store, { bucketName: "b", objectName: "o2", now: 0, ttlMs: 5 });
  assert.equal(pruneLeases(store, 100), 1);
  assert.equal(store.size, 0);
  mintLease(store, { bucketName: "b", objectName: other.objectName });
  assert.equal(revokeAllLeases(store), 1);
  assert.equal(store.size, 0);
});

test("only /a/<token> is a path here: there is no object name to traverse", () => {
  const token = "a".repeat(43);
  assert.equal(tokenFromPath(`/a/${token}`), token);
  assert.equal(tokenFromPath(`/a/${token}?x=1`), token);
  assert.equal(tokenFromPath("/a/short"), null);
  assert.equal(tokenFromPath("/a/../../etc/passwd"), null);
  assert.equal(tokenFromPath("/api/dev-login"), null);
  assert.equal(tokenFromPath("/"), null);
});

/**
 * A ServerResponse stand-in. It is a real Writable, because the handler streams
 * the object into it with `pipeline`: a plain object would never finish.
 */
class FakeResponse extends Writable {
  statusCode = 0;
  headers: Record<string, string> = {};
  headersSent = false;
  private readonly chunks: Buffer[] = [];

  override _write(chunk: Buffer, _encoding: string, done: (error?: Error) => void): void {
    this.chunks.push(Buffer.from(chunk));
    done();
  }

  writeHead(status: number, headers: Record<string, string>): this {
    this.statusCode = status;
    this.headers = headers;
    this.headersSent = true;
    return this;
  }

  get body(): string {
    return Buffer.concat(this.chunks).toString("utf8");
  }
}

const fakeResponse = (): FakeResponse => new FakeResponse();

test("the handler refuses everything it was not given a lease for, identically", async () => {
  const store = createLeaseStore();
  const seen: string[] = [];
  const handle = createAssetRequestHandler({
    store,
    readObject: async () => ({ stream: Readable.from(["never"]), contentType: "audio/wav" }),
    onEvent: (event) => { if (event.kind === "refused") seen.push(event.reason); },
  });

  const cases = [
    { method: "GET", url: "/a/tooshort" },
    { method: "GET", url: "/api/dev-login" },
    { method: "GET", url: `/a/${"b".repeat(43)}` },
    { method: "POST", url: `/a/${"b".repeat(43)}` },
    { method: "DELETE", url: "/" },
  ];
  for (const request of cases) {
    const res = fakeResponse();
    await handle(request as never, res as never);
    assert.equal(res.statusCode, 404, `${request.method} ${request.url} must be a 404`);
    assert.equal(res.body, "not found", "every refusal reads the same to the caller");
  }
  // The distinction exists for the log only.
  assert.deepEqual(seen, ["not_a_lease", "not_a_lease", "unknown", "method", "method"]);
});

test("a leased object is served once, and the same URL then stops working", async () => {
  const store = createLeaseStore();
  const reads: string[] = [];
  const handle = createAssetRequestHandler({
    store,
    readObject: async (bucketName, objectName) => {
      reads.push(`${bucketName}/${objectName}`);
      return { stream: Readable.from(["RIFFdata"]), contentType: "audio/wav", size: 8 };
    },
  });
  const lease = mintLease(store, { bucketName: "priv", objectName: "uploads/song.wav", maxFetches: 1 });

  const first = fakeResponse();
  await handle({ method: "GET", url: `/a/${lease.token}` } as never, first as never);
  assert.equal(first.statusCode, 200);
  assert.equal(first.body, "RIFFdata");
  assert.equal(first.headers["Content-Type"], "audio/wav");
  assert.equal(first.headers["Cache-Control"], "private, no-store");
  assert.deepEqual(reads, ["priv/uploads/song.wav"]);

  const second = fakeResponse();
  await handle({ method: "GET", url: `/a/${lease.token}` } as never, second as never);
  assert.equal(second.statusCode, 404, "the lease was spent");
  assert.equal(reads.length, 1, "the object was never read a second time");
});

test("the surface binds to loopback and serves only leases, over real HTTP", async () => {
  const store = createLeaseStore();
  const running = await startAnalysisAssetServer({
    port: 0,
    store,
    readObject: async () => ({ stream: Readable.from(["audio-bytes"]), contentType: "audio/wav", size: 11 }),
  });
  try {
    const lease = mintLease(store, { bucketName: "priv", objectName: "uploads/a.wav" });
    const base = `http://127.0.0.1:${running.port}`;

    const ok = await fetch(`${base}/a/${lease.token}`);
    assert.equal(ok.status, 200);
    assert.equal(await ok.text(), "audio-bytes");

    // The routes an exposed API would have carried simply do not exist here.
    for (const path of ["/api/dev-login", "/api/projects", "/", "/a/"]) {
      assert.equal((await fetch(`${base}${path}`)).status, 404, `${path} must not exist`);
    }
    assert.equal((await fetch(`${base}/a/${lease.token}`, { method: "POST" })).status, 404);
  } finally {
    await running.close();
  }
});

test("closing the surface revokes the leases it was serving", async () => {
  const store = createLeaseStore();
  const running = await startAnalysisAssetServer({
    port: 0,
    store,
    readObject: async () => ({ stream: Readable.from(["x"]) }),
  });
  mintLease(store, { bucketName: "b", objectName: "o1" });
  mintLease(store, { bucketName: "b", objectName: "o2" });
  assert.equal(await running.close(), 2);
  assert.equal(store.size, 0, "no lease outlives the server that could serve it");
});
