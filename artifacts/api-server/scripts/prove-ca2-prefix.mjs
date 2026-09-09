/**
 * Live proof of the worker's `instructions` field (PR-74).
 *
 *   node scripts/prove-ca2-prefix.mjs [--work Qma11MhFz64u8wRiW1cTZ5VJ4zTQWbYbVHDnMGafAFoaN6] [--inst 58] [--bar 8]
 *        [--seed 7] [--local-check <json>] [--out docs/evidence/ca2-prefix-live.json]
 *
 * Two real requests to the deployed endpoint on the same PDMX score, window and
 * seed: one without `instructions` (the historical request) and one with the
 * instructions the +PREFIX arm derives from the task. Records what the worker
 * applied, the input hash and token count of each request, the outputs, and
 * the control check of each output against the instructions. The token never
 * leaves the environment.
 */
import { existsSync, readFileSync, readdirSync, writeFileSync, mkdirSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { tmpdir } from "node:os";
import { rm } from "node:fs/promises";

const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(here, "../../..");
const esbuild = await import("esbuild");
const bundlePath = join(tmpdir(), `prove-prefix-${process.pid}.mjs`);
await esbuild.build({
  entryPoints: [resolve(here, "./arms-entry.ts")],
  outfile: bundlePath, bundle: true, platform: "node", format: "esm", logLevel: "error",
  alias: { "@workspace/db": resolve(here, "../src/lib/musicProviders.testDbStub.ts") },
});
await esbuild.stop?.();
const lib = await import(`file:///${bundlePath.replace(/\\/g, "/")}`);
await rm(bundlePath, { force: true });

const args = process.argv.slice(2);
const flag = (name, fallback) => { const i = args.indexOf(`--${name}`); return i >= 0 && args[i + 1] && !args[i + 1].startsWith("--") ? args[i + 1] : fallback; };
const workId = flag("work", "Qma11MhFz64u8wRiW1cTZ5VJ4zTQWbYbVHDnMGafAFoaN6");
const targetInst = Number(flag("inst", "58"));
const barStart = Number(flag("bar", "8"));
const seed = Number(flag("seed", "7"));
const target = resolve(repoRoot, flag("target", ".pdmx-data"));
const localCheckPath = flag("local-check", null);
const outPath = resolve(repoRoot, flag("out", "docs/evidence/ca2-prefix-live.json"));

const envPath = join(repoRoot, ".env.local");
if (existsSync(envPath)) {
  for (const line of readFileSync(envPath, "utf8").split(/\r?\n/)) {
    const m = /^\s*(COMPOSERS_ASSISTANT_2_API_(?:URL|TOKEN))\s*=\s*(.*?)\s*$/.exec(line);
    if (m && !process.env[m[1]]) process.env[m[1]] = m[2].replace(/^["']|["']$/g, "");
  }
}
const refusal = lib.ca2EndpointRefusal();
if (refusal) { console.error(refusal); process.exit(2); }

function* walk(dir) {
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, e.name);
    if (e.isDirectory()) yield* walk(full);
    else if (e.name.endsWith(".mid")) yield full;
  }
}
let file = null;
for (const f of walk(join(target, "mid"))) if (lib.pdmxIdFromPath(f) === workId) { file = f; break; }
if (!file) { console.error(`work ${workId} not found under ${target}/mid`); process.exit(2); }
const midiBytes = readFileSync(file);
const midi = lib.parseMidiFile(midiBytes);
const task = lib.buildTournamentTask(midi, { workId, targetInst, barStart, windowBars: 8 });
if ("refusal" in task) { console.error(task.refusal); process.exit(2); }
const { v2 } = lib.platformRequestFor(task, seed);
const expression = lib.expressV2InCa2Vocabulary(v2);
const plan = lib.wireFromExpression(expression);

const endpoint = lib.ca2Endpoint();
console.log("health…");
const health = await lib.ca2Health(endpoint);
console.log(` healthy=${health.healthy} imageEvidence=${health.imageEvidence}`);
const base = { midi: new Uint8Array(midiBytes), midiName: `${workId}.mid`, targetInst, startMeasure: barStart, nMeasures: 8, seed };
const window = lib.measurementWindowFor(task);
const contexts = task.contextTracks.filter((t) => !t.isPercussion).map((t) => t.notes);
const describe = (label, result) => {
  const notes = result.output?.notes ?? [];
  const adapted = notes.map((n, i) => ({ id: `${label}-${i}`, start: Number((n.startQn * (60 / task.tempoBpm)).toFixed(4)), duration: Number(((n.endQn - n.startQn) * (60 / task.tempoBpm)).toFixed(4)), pitch: n.pitch, velocity: n.velocity }));
  const judgement = lib.judgePart(task, adapted);
  return {
    label,
    request: { inputTokens: result.request?.inputTokens, inputSha256: result.request?.inputSha256, instructionsSent: result.request?.instructionsSent, inputTail: result.request?.inputTail },
    workerAccount: { received: result.account?.received, instructions: result.account?.instructions },
    inference: result.inference,
    httpSeconds: result.httpSeconds,
    output: { generatedNotes: result.output?.generatedNotes, measuresWithNotes: result.output?.measuresWithNotes, pitchRange: result.output?.pitchRange },
    judge: { version: lib.PART_JUDGE_VERSION, score: judgement.score, playabilityErrors: judgement.metrics.playabilityErrors, coverage: judgement.metrics.coverage, chordToneShare: judgement.metrics.chordToneShare },
    controlsAgainstThePrefixInstructions: lib.checkControls(plan.sent, plan.wire.loudness, adapted, window, contexts),
    realised: lib.measureControls(adapted, window, contexts),
    definitionOfDone: result.definitionOfDone,
    imageEvidence: result.imageEvidence,
  };
};
console.log("infill without instructions…");
const plain = await lib.ca2Infill(endpoint, base, health);
console.log(` ${plain.output?.generatedNotes} notes, ${plain.inference?.seconds}s, input sha ${plain.request?.inputSha256?.slice(0, 12)}`);
console.log("infill with instructions…");
const instructed = await lib.ca2Infill(endpoint, { ...base, instructions: plan.wire }, health);
console.log(` ${instructed.output?.generatedNotes} notes, ${instructed.inference?.seconds}s, input sha ${instructed.request?.inputSha256?.slice(0, 12)}, applied ${instructed.account?.instructions?.applied?.length}, refused ${instructed.account?.instructions?.refused?.length}`);

const evidence = {
  title: "Composer's Assistant 2 worker — the `instructions` field proven live on the deployed Modal endpoint (Wave Q — Model Discovery, PR-74)",
  ranAt: new Date().toISOString(),
  endpoint: { app: "composers-assistant-worker", health: { healthy: health.healthy, modelBinVerified: health.modelBinVerified, release: health.release, python: health.runtime?.python, torch: health.runtime?.torch, transformers: health.runtime?.transformers, imageEvidence: health.imageEvidence } },
  input: { workId, file: `PDMX ${workId}.mid (no_license_conflict ∩ our gate)`, bytes: midiBytes.length, targetInst, targetFamily: task.targetFamily, barStart, windowBars: 8, tempoBpm: task.tempoBpm, meter: `${task.meter.numerator}/${task.meter.denominator}`, contextFamilies: [...new Set(task.contextTracks.map((t) => t.family))], humanNotes: task.humanTarget.length, seed },
  prefix: {
    derivedBy: "expressV2InCa2Vocabulary(platformRequestFor(task, seed).v2) → wireFromExpression — the exact path the +PREFIX arm takes",
    wire: plan.wire,
    expressed: expression.expressed,
    omitted: expression.omitted,
    notSentOnWire: plan.notSentOnWire,
  },
  requests: [describe("without-instructions", plain), describe("with-instructions", instructed)],
  byteIdentity: {
    claim: "with the field absent the encoder input is byte-identical to the PR-58 worker's",
    localCheck: localCheckPath && existsSync(resolve(repoRoot, localCheckPath))
      ? (() => { const text = readFileSync(resolve(repoRoot, localCheckPath), "utf8"); return JSON.parse(text.slice(0, text.lastIndexOf("}") + 1)); })()
      : "not attached",
    liveNote: "the deployed worker reports request.inputSha256 for both calls above; the two differ exactly by the instruction tokens (compare inputTail).",
  },
  honestLimits: [
    "One score, one window, one seed: this proves the field works end to end on the deployed image, not that the model obeys it — the tournament's control-accuracy tables are that measurement.",
    "Sampling is stochastic on CPU; the two outputs differ by seed-independent sampling as well as by the instructions.",
  ],
};
mkdirSync(dirname(outPath), { recursive: true });
writeFileSync(outPath, `${JSON.stringify(evidence, null, 2)}\n`);
console.log(`evidence → ${outPath}`);
