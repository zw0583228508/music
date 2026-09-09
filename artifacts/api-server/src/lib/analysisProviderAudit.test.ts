import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import test from "node:test";
import {
  AUDIT_RUNGS,
  UNKNOWN,
  nextRungAfter,
  rungHistogram,
  rungIndex,
  validateAnalysisProviderAudit,
  validateProviderAuditEntry,
  type AnalysisProviderAudit,
  type ProviderAuditEntry,
} from "./analysisProviderAudit";

function repoRoot(): string {
  let current = resolve(process.cwd());
  for (;;) {
    if (existsSync(join(current, "pnpm-workspace.yaml"))) return current;
    const parent = dirname(current);
    if (parent === current) throw new Error("pnpm-workspace.yaml not found above " + process.cwd());
    current = parent;
  }
}

const EVIDENCE_PATH = "docs/evidence/analysis-provider-audit-live.json";

const NAMED_PROVIDERS = [
  "BASIC_PITCH", "DEMUCS", "BS_ROFORMER", "ALL_IN_ONE", "BEAT_THIS", "MADMOM",
  "ESSENTIA", "CHROMA", "TORCHCREPE", "PYLOUDNORM", "MT3", "MR_MT3", "YOUR_MT3",
  "SHEETSAGE", "MOSS_MUSIC_INSTRUCT", "MOSS_MUSIC_THINKING",
];

function liveSmokeEntry(): ProviderAuditEntry {
  return {
    id: "EXAMPLE",
    family: "test",
    capabilities: ["transcription"],
    rung: "LIVE_SMOKE",
    proof: {
      manifest: { file: "musicProviders.ts", symbol: "MUSIC_PROVIDERS[EXAMPLE]" },
      codeWired: { adapter: "analysisProviders.ts parseTranscription", scheduledIn: "runAnalysisProviders", typecheck: "green" },
      deployed: {
        modalApp: "example-worker", modalAppId: "ap-1", endpointEnv: "EXAMPLE_API_URL",
        health: { httpStatus: 200, status: "ok", modelVersion: "1.0", checksum: "abc", requestId: "fc-1", latencyMs: 12, probedAt: "2026-09-09T00:00:00Z" },
      },
      liveSmoke: {
        fixture: { path: "fixtures/x.mp3", sha256: "deadbeef", bytes: 10 },
        requestId: "fc-2", latencyMs: 100, outputBytes: 2048, outputSummary: "12 notes",
        modelVersion: "1.0", checksum: "abc", costUsd: 0.01, smokedAt: "2026-09-09T00:00:01Z", evidence: "docs/evidence/x.json",
      },
    },
    nextRung: "BENCHMARKED",
    whatWouldMoveItUp: "score it against a truth set",
    costUsd: 0.01,
    latencyMs: 100,
    notes: [],
  };
}

test("the ladder is ordered and every rung but the last has a successor", () => {
  assert.deepEqual([...AUDIT_RUNGS], ["MANIFEST_ONLY", "CODE_WIRED", "DEPLOYED", "LIVE_SMOKE", "BENCHMARKED", "PROMOTED"]);
  assert.equal(rungIndex("DEPLOYED"), 2);
  assert.equal(rungIndex("nope"), -1);
  assert.equal(nextRungAfter("LIVE_SMOKE"), "BENCHMARKED");
  assert.equal(nextRungAfter("PROMOTED"), null);
});

test("a fully proven LIVE_SMOKE entry validates", () => {
  assert.deepEqual(validateProviderAuditEntry(liveSmokeEntry()), []);
});

test("a rung cannot be claimed without its own proof fields", () => {
  const entry = liveSmokeEntry();
  delete (entry.proof.liveSmoke as { requestId?: string }).requestId;
  const issues = validateProviderAuditEntry(entry);
  assert.ok(issues.some((issue) => issue.includes("proof.liveSmoke.requestId")), issues.join("\n"));
});

test("the ladder is cumulative: a higher rung also needs every lower proof", () => {
  const entry = liveSmokeEntry();
  delete entry.proof.deployed;
  const issues = validateProviderAuditEntry(entry);
  assert.ok(issues.some((issue) => issue.includes("proof.deployed (for DEPLOYED) is missing")), issues.join("\n"));
});

test("proof for an unclaimed rung is refused rather than silently ignored", () => {
  const entry = liveSmokeEntry();
  entry.rung = "CODE_WIRED";
  entry.nextRung = "DEPLOYED";
  const issues = validateProviderAuditEntry(entry);
  assert.ok(issues.some((issue) => issue.includes("proof.deployed is present but rung CODE_WIRED is claimed")), issues.join("\n"));
  // Moved to `historical`, the same facts are admissible.
  const honest = liveSmokeEntry();
  honest.rung = "CODE_WIRED";
  honest.nextRung = "DEPLOYED";
  honest.historical = { deployed: honest.proof.deployed, liveSmoke: honest.proof.liveSmoke };
  delete honest.proof.deployed;
  delete honest.proof.liveSmoke;
  assert.deepEqual(validateProviderAuditEntry(honest), []);
});

test("DEPLOYED needs a 200 with a healthy status, and the smoke must match the attested checksum", () => {
  const unhealthy = liveSmokeEntry();
  unhealthy.proof.deployed!.health.httpStatus = 500;
  unhealthy.proof.deployed!.health.status = "unhealthy";
  const issues = validateProviderAuditEntry(unhealthy);
  assert.ok(issues.some((issue) => issue.includes("HTTP 200")), issues.join("\n"));
  assert.ok(issues.some((issue) => issue.includes("healthy, ready or ok")), issues.join("\n"));

  const drifted = liveSmokeEntry();
  drifted.proof.liveSmoke!.checksum = "other";
  assert.ok(validateProviderAuditEntry(drifted).some((issue) => issue.includes("must equal the checksum")));
});

test("UNKNOWN is admissible for a measurement, never for a proof field", () => {
  const entry = liveSmokeEntry();
  entry.costUsd = UNKNOWN;
  entry.latencyMs = UNKNOWN;
  entry.proof.liveSmoke!.costUsd = UNKNOWN;
  assert.deepEqual(validateProviderAuditEntry(entry), []);
  const bad = liveSmokeEntry();
  (bad.proof.liveSmoke as { requestId: string }).requestId = "";
  assert.ok(validateProviderAuditEntry(bad).some((issue) => issue.includes("proof.liveSmoke.requestId")));
});

test("nextRung must follow the claimed rung and a reason to climb is required below PROMOTED", () => {
  const entry = liveSmokeEntry();
  entry.nextRung = "PROMOTED";
  assert.ok(validateProviderAuditEntry(entry).some((issue) => issue.includes("nextRung must be BENCHMARKED")));
  const silent = liveSmokeEntry();
  silent.whatWouldMoveItUp = "  ";
  assert.ok(validateProviderAuditEntry(silent).some((issue) => issue.includes("whatWouldMoveItUp is required")));
});

test("the document validator checks the ladder, uniqueness and every entry", () => {
  const entry = liveSmokeEntry();
  const document = { title: "t", date: "2026-09-09", ladder: [...AUDIT_RUNGS], providers: [entry, { ...entry }] };
  const issues = validateAnalysisProviderAudit(document);
  assert.deepEqual(issues, ["EXAMPLE: listed more than once"]);
  assert.ok(validateAnalysisProviderAudit({ ...document, ladder: ["PROMOTED"] }).some((issue) => issue.startsWith("ladder must be")));
  assert.ok(validateAnalysisProviderAudit({ ...document, date: "yesterday" }).some((issue) => issue.startsWith("date must be")));
});

test("the committed live audit validates and names every provider the platform names", () => {
  const document = JSON.parse(readFileSync(join(repoRoot(), EVIDENCE_PATH), "utf8")) as AnalysisProviderAudit;
  const issues = validateAnalysisProviderAudit(document);
  assert.deepEqual(issues, [], issues.join("\n"));
  const ids = new Set(document.providers.map((entry) => entry.id));
  for (const id of NAMED_PROVIDERS) assert.ok(ids.has(id), `${id} is missing from ${EVIDENCE_PATH}`);
  const histogram = rungHistogram(document);
  const total = Object.values(histogram).reduce((sum, count) => sum + count, 0);
  assert.equal(total, document.providers.length);
  // Nothing may claim BENCHMARKED or PROMOTED without a truth-set evidence file
  // that exists in the repository.
  for (const entry of document.providers) {
    if (rungIndex(entry.rung) >= rungIndex("BENCHMARKED")) {
      const file = entry.proof.benchmarked?.evidenceFile ?? "";
      assert.ok(existsSync(join(repoRoot(), file)), `${entry.id}: benchmark evidence ${file} does not exist`);
    }
    if (entry.proof.liveSmoke) {
      // `path#fragment` points into a section of an evidence file.
      const file = entry.proof.liveSmoke.evidence.split("#")[0];
      assert.ok(existsSync(join(repoRoot(), file)),
        `${entry.id}: live smoke evidence ${file} does not exist`);
    }
  }
});
