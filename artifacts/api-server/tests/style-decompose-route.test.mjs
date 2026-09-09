/**
 * POST /api/style/decompose (Wave Q, Q-02 — PR-66).
 *
 * The route is read-only and stateless: no table, no schema change, no model.
 * This mounts the real router on a bare Express app with a stubbed session, so
 * what is exercised is the route's own auth gate, validation and payload —
 * not the platform's session store.
 */
import { strict as assert } from "node:assert";
import { after, before, test } from "node:test";
import { rm } from "node:fs/promises";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { build } from "esbuild";

// fileURLToPath, not URL.pathname: the repo can live under a path with
// non-ASCII characters, which pathname would hand back percent-encoded.
const apiDirectory = fileURLToPath(new URL("..", import.meta.url));
// The harness lives inside the package so `express` resolves from node_modules.
const bundlePath = join(apiDirectory, `.style-route-harness-${process.pid}.mjs`);

await build({
  stdin: {
    contents: `
      import express from "express";
      import styleRouter from "./src/routes/style";
      /** getUser() is read per request, so one server can serve signed-in and signed-out. */
      export function createApp(getUser) {
        const app = express();
        app.use(express.json());
        app.use((req, _res, next) => {
          const user = getUser();
          if (user) req.user = user;
          next();
        });
        app.use("/api", styleRouter);
        return app;
      }
    `,
    resolveDir: apiDirectory,
    loader: "ts",
  },
  outfile: bundlePath,
  bundle: true,
  platform: "node",
  format: "esm",
  logLevel: "error",
  packages: "external",
  alias: { "@workspace/db": join(apiDirectory, "src/lib/musicProviders.testDbStub.ts") },
});

const { createApp } = await import(`file:///${bundlePath.replace(/\\/g, "/")}`);

let currentUser = { id: "user-1" };
let server;
let baseUrl;

before(async () => {
  const app = createApp(() => currentUser);
  server = await new Promise((resolve) => {
    const s = app.listen(0, "127.0.0.1", () => resolve(s));
  });
  baseUrl = `http://127.0.0.1:${server.address().port}`;
});

after(async () => {
  if (server) await new Promise((resolve) => server.close(resolve));
  await rm(bundlePath, { force: true });
});

async function post(body, { signedIn = true } = {}) {
  currentUser = signedIn ? { id: "user-1" } : null;
  const response = await fetch(`${baseUrl}/api/style/decompose`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
  return { status: response.status, body: await response.json() };
}

test("a signed-out caller is refused", async () => {
  const { status, body } = await post({ description: "bossa nova" }, { signedIn: false });
  assert.equal(status, 401);
  assert.equal(body.error, "Unauthorized");
});

test("a missing, empty or oversized description is a 400, not a guess", async () => {
  assert.equal((await post({})).status, 400);
  assert.equal((await post({ description: "   " })).status, 400);
  assert.equal((await post({ description: "x".repeat(2001) })).status, 400);
  assert.equal((await post({ description: "bossa nova", maxQuestions: -1 })).status, 400);
  assert.equal((await post({ description: "bossa nova", deterministicOnly: "yes" })).status, 400);
});

test("a description comes back decomposed, with the grammar, the instructions and the honest share", async () => {
  const { status, body } = await post({ description: "1970s Ethiopian jazz with Mizrahi strings and a trap hi-hat", maxQuestions: 3 });
  assert.equal(status, 200);
  assert.equal(body.mode, "parser_and_seed");
  assert.equal(body.style.version, "UNIVERSAL_STYLE_V1");
  assert.ok(body.style.identity.tags.value.includes("jazz"));
  assert.ok(body.style.identity.region.value.includes("ethiopian"));
  assert.equal(body.grammarSlot.status, "available");
  assert.ok(body.grammar.rules.length > 0);
  assert.ok(body.grammar.rules.every((rule) => typeof rule.directive?.kind === "string"));
  assert.equal(body.instructions.roles.length, 6);
  assert.ok(body.questions.length <= 3);
  assert.ok(body.share.unknownShare > 0, "the share is reported honestly, not hidden");
  assert.ok(body.share.deterministicShare + body.share.reasoningShare + body.share.unknownShare > 0.99);
});

test("deterministicOnly returns what the text alone says and seeds nothing", async () => {
  const { status, body } = await post({ description: "techno at 130 bpm", deterministicOnly: true });
  assert.equal(status, 200);
  assert.equal(body.mode, "parser_only");
  assert.equal(body.share.evidence, 0);
  assert.deepEqual(body.style.tempo.bpm.value, { min: 128, max: 132 });
  assert.equal(body.style.drums.language.basis, "unknown", "the seed did not run");
});
