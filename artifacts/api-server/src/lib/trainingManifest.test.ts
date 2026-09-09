import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import test from "node:test";
import type { RightsBasis } from "./datasetRightsProof";
import {
  SPLIT_RULE,
  exportRightsBasis,
  rightsBasisDigest,
  rightsBasisFromExport,
  rightsProofRecord,
  splitDigest,
  splitForWork,
  verifyTrainingManifest,
  type TrainingExampleProvenance,
  type TrainingManifest,
} from "./trainingManifest";

const sha = (s: string) => createHash("sha256").update(s).digest("hex");

function basis(over: Partial<RightsBasis> = {}): RightsBasis {
  return {
    ourAdmitted: new Set(["w1", "w2", "w3", "w4"]),
    authorsAdmitted: new Set(["w1", "w2", "w3", "w5"]),
    datasetDigest: "d".repeat(64),
    rightsDigest: "r".repeat(64),
    source: { recordId: "15571083", doi: "10.5281/zenodo.15571083", subset: "no_license_conflict" },
    ...over,
  };
}

function prov(workId: string, index: number, over: Partial<TrainingExampleProvenance> = {}): TrainingExampleProvenance {
  return { workId, split: splitForWork(workId), index, exampleId: sha(`${workId}|${index}`).slice(0, 16), targetInst: 0, inputTokens: 120, labelTokens: 40, ...over };
}

function manifest(provenance: TrainingExampleProvenance[], over: Partial<TrainingManifest> = {}): TrainingManifest {
  const perSplit = { train: { examples: 0, works: 0, inputTokens: 0, labelTokens: 0 }, val: { examples: 0, works: 0, inputTokens: 0, labelTokens: 0 }, test: { examples: 0, works: 0, inputTokens: 0, labelTokens: 0 } };
  const works: Record<string, Set<string>> = { train: new Set(), val: new Set(), test: new Set() };
  for (const p of provenance) {
    perSplit[p.split].examples += 1;
    perSplit[p.split].inputTokens += p.inputTokens;
    perSplit[p.split].labelTokens += p.labelTokens;
    works[p.split].add(p.workId);
  }
  for (const s of ["train", "val", "test"] as const) perSplit[s].works = works[s].size;
  return {
    version: "CA2_TRAINING_MANIFEST_v1",
    builtAt: "2026-09-09T00:00:00Z",
    task: "infill",
    tokenizerVersion: "CA2_UNJOINED_v2.1.0_285d28b7_1944",
    ca2: { release: "v2.1.0" },
    datasetDigest: sha("dataset"),
    examplesDigest: sha("examples"),
    splitDigest: splitDigest(provenance),
    rightsBasis: { version: "TRAINING_RIGHTS_BASIS_v1", basisDigest: sha("basis"), datasetDigest: "d".repeat(64), rightsDigest: "r".repeat(64), source: basis().source, admittedWorkCount: 3 },
    splitRule: SPLIT_RULE,
    maxLen: 1650,
    maxInputTokensSeen: Math.max(0, ...provenance.map((p) => p.inputTokens)),
    maxLabelTokensSeen: Math.max(0, ...provenance.map((p) => p.labelTokens)),
    counts: {
      examples: provenance.length,
      works: new Set(provenance.map((p) => p.workId)).size,
      perSplit,
      perTargetInstrument: { "0": provenance.length },
      perVariant: { plain: provenance.length },
    },
    workLevelSplitLeak: false,
    provenance,
    ...over,
  };
}

test("the split rule is sha256[:8] % 100 → 90/5/5, and identical to training_manifest.split_for_work", () => {
  for (const id of ["QmbbhLwwmuKqA9MC1ULhojEMGxnxDobsZPJEo69N8nbgTw", "w1", "w2", "w3"]) {
    const h = parseInt(sha(id).slice(0, 8), 16) % 100;
    assert.equal(splitForWork(id), h < 90 ? "train" : h < 95 ? "val" : "test");
  }
  const counts = { train: 0, val: 0, test: 0 };
  for (let i = 0; i < 20000; i += 1) counts[splitForWork(`work-${i}`)] += 1;
  assert.ok(Math.abs(counts.train / 20000 - 0.9) < 0.01);
  assert.ok(Math.abs(counts.val / 20000 - 0.05) < 0.01);
});

test("a well-formed manifest over admitted works verifies and yields a verified rights proof", () => {
  const v = verifyTrainingManifest(manifest([prov("w1", 0), prov("w2", 0), prov("w3", 0), prov("w1", 1)]), basis());
  assert.deepEqual(v.problems, []);
  assert.equal(v.ok, true);
  if (!v.ok) return;
  assert.equal(v.proof.verified, true);
  assert.equal(v.proof.examplesTracedToAdmittedWork, 4);
  assert.equal(v.proof.admittedWorkCount, 3);
  const record = rightsProofRecord(v, "2026-09-09T01:00:00Z");
  assert.equal(record.ok, true);
  assert.equal(record.datasetDigest, sha("dataset"));
});

test("a work outside the intersection fails the proof and the manifest", () => {
  const v = verifyTrainingManifest(manifest([prov("w1", 0), prov("w4", 0)]), basis());
  assert.equal(v.ok, false);
  assert.ok(v.problems.some((p) => /rights proof failed/.test(p)), v.problems.join("; "));
  assert.equal(v.proof?.examplesInAuthorsExcluded, 1);
});

test("every defect is named: wrong split, over MAX_LEN, leak, bad tokenizer, wrong digests", () => {
  const p1 = prov("w1", 0);
  const wrongSplit = { ...prov("w2", 0), split: (splitForWork("w2") === "test" ? "train" : "test") as "train" | "test" };
  const over = prov("w3", 0, { inputTokens: 1651 });
  const m = manifest([p1, wrongSplit, over], { tokenizerVersion: "ARRANGER_REMI_v1_3cfd16b3_386", maxLen: 1024, splitRule: "random" });
  m.workLevelSplitLeak = false;
  m.rightsBasis.datasetDigest = "x".repeat(64);
  const v = verifyTrainingManifest(m, basis());
  assert.equal(v.ok, false);
  const text = v.problems.join("\n");
  assert.match(text, /tokenizerVersion/);
  assert.match(text, /maxLen 1024/);
  assert.match(text, /splitRule/);
  assert.match(text, /1 example\(s\) sit in a split/);
  assert.match(text, /exceed MAX_LEN/);
  assert.match(text, /rightsBasis\.datasetDigest/);
});

test("a manifest whose counts disagree with its provenance is refused", () => {
  const m = manifest([prov("w1", 0), prov("w2", 0)]);
  m.counts.examples = 3;
  m.counts.perSplit.train.examples += 1;
  m.splitDigest = sha("nope");
  const v = verifyTrainingManifest(m, basis());
  assert.equal(v.ok, false);
  assert.ok(v.problems.some((p) => /counts\.examples 3 != provenance length 2/.test(p)));
  assert.ok(v.problems.some((p) => /splitDigest does not match/.test(p)));
});

test("an empty manifest cannot be verified", () => {
  const v = verifyTrainingManifest(manifest([]), basis());
  assert.equal(v.ok, false);
  assert.ok(v.problems.some((p) => /no provenance/.test(p)));
});

test("the exported rights basis round-trips and detects tampering", () => {
  const exported = exportRightsBasis(basis(), "2026-09-09T00:00:00Z");
  assert.deepEqual(exported.admittedWorkIds, ["w1", "w2", "w3"]);
  assert.deepEqual(exported.ourOnlyWorkIds, ["w4"]);
  assert.deepEqual(exported.authorsOnlyWorkIds, ["w5"]);
  assert.equal(exported.basisDigest, rightsBasisDigest(exported));
  const back = rightsBasisFromExport(exported);
  assert.deepEqual([...back.ourAdmitted].sort(), ["w1", "w2", "w3", "w4"]);
  assert.deepEqual([...back.authorsAdmitted].sort(), ["w1", "w2", "w3", "w5"]);
  const tampered = { ...exported, admittedWorkIds: [...exported.admittedWorkIds, "smuggled"] };
  assert.throws(() => rightsBasisFromExport(tampered), /digest mismatch/);
});
