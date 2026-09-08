#!/usr/bin/env node
/**
 * Cross-platform local dev launcher. Loads `.env.local`, then starts one of the
 * local services. Avoids POSIX-only npm script one-liners that break under the
 * Windows cmd shell pnpm uses.
 *
 *   node scripts/dev-local.mjs api      # build + run the API server (:5000)
 *   node scripts/dev-local.mjs studio   # vite dev server for the studio (:5173)
 *   node scripts/dev-local.mjs db-push  # drizzle-kit push to DATABASE_URL
 */
import { spawn } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");

function loadEnvLocal() {
  const file = resolve(repoRoot, ".env.local");
  if (!existsSync(file)) {
    console.warn("[dev-local] no .env.local found; continuing with process env only");
    return;
  }
  for (const rawLine of readFileSync(file, "utf8").split("\n")) {
    const line = rawLine.trim();
    if (!line || line.startsWith("#")) continue;
    const eq = line.indexOf("=");
    if (eq === -1) continue;
    const key = line.slice(0, eq).trim();
    let value = line.slice(eq + 1).trim();
    if (
      (value.startsWith("'") && value.endsWith("'")) ||
      (value.startsWith('"') && value.endsWith('"'))
    ) {
      value = value.slice(1, -1);
    }
    if (!(key in process.env)) process.env[key] = value;
  }
}

function run(command, args, cwd) {
  return new Promise((resolvePromise, rejectPromise) => {
    const child = spawn(command, args, {
      cwd,
      stdio: "inherit",
      shell: process.platform === "win32",
      env: process.env,
    });
    child.on("exit", (code) =>
      code === 0 ? resolvePromise() : rejectPromise(new Error(`${command} exited ${code}`)),
    );
    child.on("error", rejectPromise);
  });
}

const target = process.argv[2];
// The studio reads DATABASE_URL etc. from nothing — it only needs its own port
// and the API proxy target. Loading .env.local there would leak PORT=5000 (the
// API port) into vite.
if (target !== "studio") loadEnvLocal();
process.env.NODE_ENV ??= "development";
if (target === "studio") {
  process.env.PORT ??= "5173";
  process.env.API_PROXY_TARGET ??= "http://localhost:5000";
}

const apiDir = resolve(repoRoot, "artifacts/api-server");
const studioDir = resolve(repoRoot, "artifacts/music-studio");
const dbDir = resolve(repoRoot, "lib/db");
const pnpm = process.platform === "win32" ? "pnpm.cmd" : "pnpm";

try {
  if (target === "api") {
    await run("node", ["./build.mjs"], apiDir);
    await run("node", ["--enable-source-maps", "./dist/index.mjs"], apiDir);
  } else if (target === "studio") {
    await run(pnpm, ["exec", "vite", "--config", "vite.config.ts", "--host", "0.0.0.0"], studioDir);
  } else if (target === "db-push") {
    await run(pnpm, ["exec", "drizzle-kit", "push", "--config", "./drizzle.config.ts"], dbDir);
  } else {
    console.error("usage: node scripts/dev-local.mjs <api|studio|db-push>");
    process.exit(2);
  }
} catch (error) {
  console.error(`[dev-local] ${error.message}`);
  process.exit(1);
}
