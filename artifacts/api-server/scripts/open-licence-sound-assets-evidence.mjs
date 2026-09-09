#!/usr/bin/env node
/**
 * PR-93 (SOUND-2) - write docs/evidence/open-licence-sound-assets-live.json.
 *
 *   node scripts/open-licence-sound-assets-evidence.mjs \
 *     --catalogue ../../services/music-ai-worker/open_licence_assets.json \
 *     --provision <provision.json> [--provision <more.json>] \
 *     [--attest <attest.json>] [--audition <audition.json>] [--survey <survey.json>] \
 *     [--renders ../../.corpus-data/sound-assets] [--extra-usd 0.0] [--branch <name>] \
 *     --out ../../docs/evidence/open-licence-sound-assets-live.json
 *
 * Bundles the TypeScript entry with esbuild (Windows-safe, like the other
 * scripts here) and runs it; the WAV phrases are measured with the repo's
 * BS.1770-4 meter.
 */
import { build } from "esbuild";
import { mkdirSync, rmSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const packageDir = resolve(here, "..");
const bundleDir = join(packageDir, ".tmp");
mkdirSync(bundleDir, { recursive: true });
const bundlePath = join(bundleDir, `open-licence-sound-assets-${process.pid}.mjs`);

await build({
  entryPoints: [join(here, "open-licence-sound-assets-entry.ts")],
  bundle: true, platform: "node", format: "esm", outfile: bundlePath,
  alias: { "@workspace/db": join(packageDir, "src", "lib", "musicProviders.testDbStub.ts") },
  logLevel: "error",
});
try {
  const { main } = await import(pathToFileURL(bundlePath).href);
  main(process.argv.slice(2));
} finally {
  rmSync(bundlePath, { force: true });
}
