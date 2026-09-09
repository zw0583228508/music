/**
 * Tokenizer round-trip proof over real PDMX MIDI (Wave Q, Q-05).
 *
 *   node scripts/prove-tokenizer-roundtrip.mjs [--sample 3000] [--target .pdmx-data]
 *
 * The training plan's first gate: no full training before the tokenizer is
 * shown to be lossless modulo the grid on real data. This tokenizes and
 * detokenizes a random sample of the extracted PDMX MIDI and accounts for
 * every note — dropped, invented, or snapped — then writes the distribution.
 *
 * A file that fails to parse is reported, not silently skipped: a tokenizer
 * that only works on the files it likes is not a proof.
 */
import { readdirSync, readFileSync, writeFileSync } from "node:fs";
import { join, resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { tmpdir } from "node:os";
import { rm } from "node:fs/promises";

const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(here, "../../..");

const esbuild = await import("esbuild");
const bundlePath = join(tmpdir(), `remi-proof-${process.pid}.mjs`);
await esbuild.build({
  entryPoints: [resolve(here, "./tokenizer-proof-entry.ts")],
  outfile: bundlePath, bundle: true, platform: "node", format: "esm", logLevel: "error",
});
await esbuild.stop?.();
const { parseMidiFile, roundTrip, tokenize, vocabularyVersion } =
  await import(`file:///${bundlePath.replace(/\\/g, "/")}`);
await rm(bundlePath, { force: true });

const args = process.argv.slice(2);
const flag = (name, fallback) => {
  const i = args.indexOf(`--${name}`);
  return i >= 0 && args[i + 1] && !args[i + 1].startsWith("--") ? args[i + 1] : fallback;
};
const sampleSize = Number(flag("sample", "3000"));
const target = resolve(repoRoot, flag("target", ".pdmx-data"));
const midRoot = join(target, "mid");

/** Deterministic PRNG so a proof can be re-run. */
let seed = 0x9e3779b9;
const rand = () => {
  seed ^= seed << 13; seed ^= seed >>> 17; seed ^= seed << 5;
  return ((seed >>> 0) / 0xffffffff);
};

function* walk(dir) {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) yield* walk(full);
    else if (entry.name.endsWith(".mid")) yield full;
  }
}

console.log("indexing extracted MIDI…");
const allFiles = [...walk(midRoot)];
console.log(`${allFiles.length} files; sampling ${sampleSize}`);

// Reservoir sample so we do not hold 250k paths' worth of bias toward one folder.
const sample = [];
for (let i = 0; i < allFiles.length; i += 1) {
  if (sample.length < sampleSize) sample.push(allFiles[i]);
  else {
    const j = Math.floor(rand() * (i + 1));
    if (j < sampleSize) sample[j] = allFiles[i];
  }
}

let parsed = 0;
let parseFailures = 0;
let filesEmpty = 0;
let filesWithNotes = 0;
let filesApproxTimeSig = 0;
let losslessModuloGrid = 0;
let totalConsidered = 0;
let totalDropped = 0;
let totalSpurious = 0;
let totalFull = 0;
let totalExact = 0;
let onsetErrSum = 0;
let onsetErrMax = 0;
let tokenTotal = 0;
const failureSamples = [];
const worstDrift = [];

for (const file of sample) {
  let midi;
  try {
    midi = parseMidiFile(readFileSync(file));
  } catch (error) {
    parseFailures += 1;
    if (failureSamples.length < 15) {
      failureSamples.push({ file: file.slice(midRoot.length + 1), reason: String(error.message ?? error).slice(0, 160) });
    }
    continue;
  }
  parsed += 1;
  if (!midi.notes.length) { filesEmpty += 1; continue; }
  filesWithNotes += 1;

  const result = roundTrip(midi, { maxBars: 512 });
  if (result.timeSigApproximated) filesApproxTimeSig += 1;
  tokenTotal += tokenize(midi, { maxBars: 512 }).length;
  totalConsidered += result.consideredNotes;
  totalDropped += result.droppedNotes;
  totalSpurious += result.spuriousNotes;
  totalExact += result.exactGridMatches;
  totalFull += result.fullMatches;
  onsetErrSum += result.onsetErrorQuartersMean * result.consideredNotes;
  onsetErrMax = Math.max(onsetErrMax, result.onsetErrorQuartersMax);
  if (result.lossless_modulo_grid) losslessModuloGrid += 1;
  else if (worstDrift.length < 15) {
    worstDrift.push({
      file: file.slice(midRoot.length + 1),
      considered: result.consideredNotes,
      dropped: result.droppedNotes,
      spurious: result.spuriousNotes,
    });
  }
}

const summary = {
  ranAt: new Date().toISOString(),
  vocabularyVersion: vocabularyVersion(),
  sampleRequested: sampleSize,
  filesSampled: sample.length,
  parsed,
  parseFailures,
  parseFailureShare: sample.length ? Number((parseFailures / sample.length).toFixed(4)) : 0,
  filesEmpty,
  filesWithNotes,
  filesWithApproximatedTimeSig: filesApproxTimeSig,
  notesConsidered: totalConsidered,
  filesLosslessModuloGrid: losslessModuloGrid,
  // Denominator is files that actually had notes to test.
  filesLosslessShare: filesWithNotes ? Number((losslessModuloGrid / filesWithNotes).toFixed(6)) : 0,
  noteDropShare: totalConsidered ? Number((totalDropped / totalConsidered).toFixed(6)) : 0,
  noteSpuriousShare: totalConsidered ? Number((totalSpurious / totalConsidered).toFixed(6)) : 0,
  exactGridMatchShare: totalConsidered ? Number((totalExact / totalConsidered).toFixed(6)) : 0,
  fullMatchShare: totalConsidered ? Number((totalFull / totalConsidered).toFixed(6)) : 0,
  onsetSnapErrorQuartersMean: totalConsidered ? Number((onsetErrSum / totalConsidered).toFixed(6)) : 0,
  onsetSnapErrorQuartersMax: Number(onsetErrMax.toFixed(6)),
  gridStepQuarters: Number((1 / 12).toFixed(6)),
  meanTokensPerFile: parsed ? Math.round(tokenTotal / parsed) : 0,
  parseFailureSamples: failureSamples,
  notLosslessSamples: worstDrift,
};

console.log(JSON.stringify(summary, null, 2));
const outPath = join(target, "tokenizer-roundtrip-summary.json");
writeFileSync(outPath, `${JSON.stringify(summary, null, 2)}\n`, "utf8");
console.log(`\nsummary → ${outPath}`);
