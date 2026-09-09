import assert from "node:assert/strict";
import test from "node:test";
import {
  assertTrainingMayProceed,
  buildDatasetRightsProof,
  digestProof,
  isProofRefusal,
  type ExampleProvenance,
  type RightsBasis,
} from "./datasetRightsProof";

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

const ex = (workId: string, index = 0): ExampleProvenance => ({ workId, shard: "shard-0", index });

test("a training set entirely inside the intersection verifies", () => {
  // w1, w2, w3 are in BOTH gates.
  const proof = buildDatasetRightsProof([ex("w1"), ex("w2"), ex("w3"), ex("w1", 1)], basis(), "TOK_v1");
  assert.ok(!isProofRefusal(proof));
  if (isProofRefusal(proof)) return;
  assert.equal(proof.verified, true);
  assert.equal(proof.admittedWorkCount, 3, "only w1, w2, w3 are admitted by both");
  assert.equal(proof.examplesTracedToAdmittedWork, 4);
  assert.equal(proof.examplesUntraceable, 0);
  assert.match(proof.proofDigest, /^[0-9a-f]{64}$/);
  assert.doesNotThrow(() => assertTrainingMayProceed(proof));
});

test("a work our gate admits but the authors' subset excludes fails the proof, conservatively", () => {
  // w4 is ours-only.
  const proof = buildDatasetRightsProof([ex("w1"), ex("w4")], basis(), "TOK_v1");
  assert.ok(!isProofRefusal(proof));
  if (isProofRefusal(proof)) return;
  assert.equal(proof.verified, false);
  assert.equal(proof.examplesInAuthorsExcluded, 1);
  assert.equal(proof.examplesUntraceable, 0);
  assert.throws(() => assertTrainingMayProceed(proof), /authors' subset excludes/);
});

test("a work in neither gate is untraceable and blocks training", () => {
  const proof = buildDatasetRightsProof([ex("w1"), ex("ghost")], basis(), "TOK_v1");
  assert.ok(!isProofRefusal(proof));
  if (isProofRefusal(proof)) return;
  assert.equal(proof.verified, false);
  assert.equal(proof.examplesUntraceable, 1);
  assert.throws(() => assertTrainingMayProceed(proof), /trace to no admitted work/);
});

test("an empty rights basis is refused outright, not reported as unverified", () => {
  const refusal = buildDatasetRightsProof([ex("w1")], basis({ ourAdmitted: new Set() }), "TOK_v1");
  assert.ok(isProofRefusal(refusal));
  assert.match((refusal as { reason: string }).reason, /rights basis is empty/);
  assert.throws(() => assertTrainingMayProceed(refusal), /could not be built/);
});

test("no tokenizer version is a refusal: a proof must name what it was proven against", () => {
  const refusal = buildDatasetRightsProof([ex("w1")], basis(), "");
  assert.ok(isProofRefusal(refusal));
  assert.match((refusal as { reason: string }).reason, /tokenizer version/);
});

test("an empty training set does not verify", () => {
  const proof = buildDatasetRightsProof([], basis(), "TOK_v1");
  assert.ok(!isProofRefusal(proof));
  if (isProofRefusal(proof)) return;
  assert.equal(proof.verified, false);
});

test("the proof digest changes when anything provenance-bearing changes", () => {
  const a = buildDatasetRightsProof([ex("w1"), ex("w2")], basis(), "TOK_v1");
  const b = buildDatasetRightsProof([ex("w1"), ex("w2")], basis(), "TOK_v2");
  assert.ok(!isProofRefusal(a) && !isProofRefusal(b));
  if (isProofRefusal(a) || isProofRefusal(b)) return;
  assert.notEqual(a.proofDigest, b.proofDigest, "a different tokenizer is a different proof");

  const sameAgain = buildDatasetRightsProof([ex("w1"), ex("w2")], basis(), "TOK_v1");
  assert.ok(!isProofRefusal(sameAgain));
  if (isProofRefusal(sameAgain)) return;
  assert.equal(sameAgain.proofDigest, a.proofDigest, "identical inputs, identical proof");
});

test("digestProof is deterministic and independent of sampleTrace contents", () => {
  const shared = {
    version: "DATASET_RIGHTS_PROOF_v1" as const,
    tokenizerVersion: "TOK_v1",
    datasetDigest: "d".repeat(64),
    rightsDigest: "r".repeat(64),
    source: { recordId: "15571083", doi: "x", subset: "no_license_conflict" },
    admittedWorkCount: 100,
    examplesChecked: 500,
    distinctWorksInTraining: 90,
    examplesTracedToAdmittedWork: 500,
    examplesInAuthorsExcluded: 0,
    examplesUntraceable: 0,
    verified: true,
  };
  const one = digestProof({ ...shared, sampleTrace: [ex("w1")] });
  const two = digestProof({ ...shared, sampleTrace: [ex("w2"), ex("w3")] });
  assert.equal(one, two, "the spot-check sample is illustrative, not part of the guarantee");
});
