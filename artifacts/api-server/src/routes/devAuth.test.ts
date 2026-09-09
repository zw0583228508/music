import assert from "node:assert/strict";
import test from "node:test";
import type { NextFunction, Request, Response } from "express";
import { devAuthEnabled } from "../lib/devAuthPolicy";
import { requireLocalRequest } from "../lib/localAccess";

/** Set env for one case and always put it back. */
function withEnv<T>(values: Record<string, string | undefined>, run: () => T): T {
  const saved = new Map(Object.keys(values).map((key) => [key, process.env[key]]));
  for (const [key, value] of Object.entries(values)) {
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
  try {
    return run();
  } finally {
    for (const [key, value] of saved) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  }
}

const call = (peer: string | undefined, headers: Record<string, string> = {}) => {
  const res = { statusCode: 0, body: undefined as unknown, status(code: number) { this.statusCode = code; return this; }, json(payload: unknown) { this.body = payload; return this; } };
  let nexted = false;
  const refusals: string[] = [];
  requireLocalRequest((reason) => refusals.push(reason))(
    { headers, socket: { remoteAddress: peer }, path: "/dev-login" } as unknown as Request,
    res as unknown as Response,
    (() => { nexted = true; }) as NextFunction,
  );
  return { nexted, statusCode: res.statusCode, body: res.body, refusals };
};

// ---------------------------------------------------------------------------
// The mount gate: when the router may exist at all
// ---------------------------------------------------------------------------

test("development sign-in cannot exist in production, whatever else is set", () => {
  assert.equal(withEnv({ NODE_ENV: "production", DEV_AUTH_ENABLED: "true" }, devAuthEnabled), false);
  assert.equal(withEnv({ NODE_ENV: "production", DEV_AUTH_ENABLED: "TRUE" }, devAuthEnabled), false);
  assert.equal(withEnv({ NODE_ENV: "production", DEV_AUTH_ENABLED: "1" }, devAuthEnabled), false);
});

test("it does not exist unless it is switched on explicitly", () => {
  assert.equal(withEnv({ NODE_ENV: "development", DEV_AUTH_ENABLED: undefined }, devAuthEnabled), false);
  assert.equal(withEnv({ NODE_ENV: "development", DEV_AUTH_ENABLED: "false" }, devAuthEnabled), false);
  // Only the exact string, so a stray "1" or "yes" in an env file does not open it.
  assert.equal(withEnv({ NODE_ENV: "development", DEV_AUTH_ENABLED: "1" }, devAuthEnabled), false);
  assert.equal(withEnv({ NODE_ENV: "development", DEV_AUTH_ENABLED: "true" }, devAuthEnabled), true);
});

// ---------------------------------------------------------------------------
// The per-request gate: who may reach it once it exists
// ---------------------------------------------------------------------------

test("a request from this machine passes", () => {
  for (const peer of ["127.0.0.1", "::1", "::ffff:127.0.0.1"]) {
    const result = call(peer);
    assert.equal(result.nexted, true, peer);
    assert.equal(result.statusCode, 0, "an allowed request is not answered by the gate");
  }
});

test("every refusal is reported to the server's log, so it is visible to the operator", () => {
  const result = call("203.0.113.7");
  assert.equal(result.refusals.length, 1);
  assert.match(result.refusals[0], /not loopback/);
  assert.equal(call("127.0.0.1").refusals.length, 0);
});

test("a request from anywhere else is refused with a flat 404", () => {
  for (const peer of ["192.168.1.10", "10.0.0.5", "172.17.0.1", "203.0.113.7", "::ffff:192.168.1.10", undefined]) {
    const result = call(peer);
    assert.equal(result.nexted, false, String(peer));
    assert.equal(result.statusCode, 404, String(peer));
    // Not 401/403: a remote caller must not learn that a development sign-in is mounted.
    assert.deepEqual(result.body, { error: "Not found" });
  }
});

test("headers cannot make a remote request local", () => {
  const result = call("203.0.113.7", {
    "x-forwarded-for": "127.0.0.1",
    "x-real-ip": "::1",
    host: "localhost:5000",
    origin: "http://localhost:5173",
  });
  assert.equal(result.nexted, false);
  assert.equal(result.statusCode, 404);
});

test("a tunnel or reverse proxy on this machine cannot relay a stranger in", () => {
  // The peer is loopback — a cloudflared/ngrok/nginx hop — but the caller is not.
  const result = call("127.0.0.1", { "x-forwarded-for": "203.0.113.7" });
  assert.equal(result.nexted, false);
  assert.equal(result.statusCode, 404);
});
