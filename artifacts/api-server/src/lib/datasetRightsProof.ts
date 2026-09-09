/**
 * Dataset rights proof (Wave Q, Q-05 — training gate 2).
 *
 * The plan: no full training before **every training example traces to an
 * admitted work**. This is the check that produces that guarantee, or refuses.
 *
 * "Admitted" is decided two ways that must agree:
 *
 *  1. Our own reading — `pdmxRefusalReason` over the row's `license_conflict`
 *     flag and licence statement.
 *  2. The authors' own `no_license_conflict.txt`, shipped in the release.
 *
 * A work counts as admitted only when **both** admit it. A work our gate would
 * admit but the authors' subset excludes is refused — the conservative
 * direction — and recorded, because a disagreement is a thing to look at, not
 * to resolve silently in our favour.
 *
 * The proof is a small signed object: the tokenizer version, the dataset and
 * rights digests, the admitted-work count, and — the point — a boolean that is
 * true only when not one example in the training set falls outside the
 * intersection. A training run records this object; a run whose proof does not
 * verify does not start.
 */
import { createHash } from "node:crypto";

/** A training example's provenance: which work it was derived from. */
export type ExampleProvenance = {
  /** The PDMX work id (the content-addressed hash from its path). */
  workId: string;
  /** Where this example sits, for a spot-check trace. */
  shard: string;
  index: number;
};

export type RightsBasis = {
  /** Work ids our own licence gate admitted, from PDMX.csv. */
  ourAdmitted: ReadonlySet<string>;
  /** Work ids the authors' no_license_conflict.txt admits. */
  authorsAdmitted: ReadonlySet<string>;
  /** From the acquisition manifest — ties the proof to the exact download. */
  datasetDigest: string;
  rightsDigest: string;
  /** Zenodo record + DOI, for the record. */
  source: { recordId: string; doi: string; subset: string };
};

export type DatasetRightsProof = {
  version: "DATASET_RIGHTS_PROOF_v1";
  tokenizerVersion: string;
  datasetDigest: string;
  rightsDigest: string;
  source: RightsBasis["source"];
  /** Work ids admitted by BOTH gates. This is the only set training may use. */
  admittedWorkCount: number;
  examplesChecked: number;
  distinctWorksInTraining: number;
  /** The count that matters: examples whose work is in the intersection. */
  examplesTracedToAdmittedWork: number;
  /** Examples whose work our gate admits but the authors' subset does not. */
  examplesInAuthorsExcluded: number;
  /** Examples whose work is in neither gate — should never be non-zero. */
  examplesUntraceable: number;
  /** A few concrete (work, shard, index) triples, for a human to spot-check. */
  sampleTrace: ExampleProvenance[];
  /** True only when every example is in the intersection. A run gates on this. */
  verified: boolean;
  /** Digest of this proof, so a training run can reference it immutably. */
  proofDigest: string;
};

export type ProofRefusal = {
  verified: false;
  reason: string;
  offendingExamples: ExampleProvenance[];
};

/**
 * Build the proof, or refuse.
 *
 * Refuses (rather than returning `verified: false`) when the inputs themselves
 * are unusable — no rights basis, empty admitted sets — because there is
 * nothing to prove against. A training set that contains a non-admitted work
 * is a normal, expected failure and returns a proof with `verified: false` and
 * the offending examples named.
 */
export function buildDatasetRightsProof(
  examples: readonly ExampleProvenance[],
  basis: RightsBasis,
  tokenizerVersion: string,
): DatasetRightsProof | ProofRefusal {
  if (!basis.ourAdmitted.size || !basis.authorsAdmitted.size) {
    return {
      verified: false,
      reason: "the rights basis is empty: run the acquisition and ingest steps first",
      offendingExamples: [],
    };
  }
  if (!tokenizerVersion) {
    return { verified: false, reason: "no tokenizer version was supplied", offendingExamples: [] };
  }

  // The intersection is the only set training may draw from.
  const intersection = new Set<string>();
  for (const workId of basis.ourAdmitted) {
    if (basis.authorsAdmitted.has(workId)) intersection.add(workId);
  }

  const distinctWorks = new Set<string>();
  let traced = 0;
  let inAuthorsExcluded = 0;
  let untraceable = 0;
  const offending: ExampleProvenance[] = [];

  for (const example of examples) {
    distinctWorks.add(example.workId);
    if (intersection.has(example.workId)) {
      traced += 1;
      continue;
    }
    if (basis.ourAdmitted.has(example.workId) && !basis.authorsAdmitted.has(example.workId)) {
      inAuthorsExcluded += 1;
    } else {
      untraceable += 1;
    }
    if (offending.length < 50) offending.push(example);
  }

  const verified = traced === examples.length && examples.length > 0;

  const sampleTrace = examples
    .filter((example) => intersection.has(example.workId))
    .filter((_, i) => i % Math.max(1, Math.floor(examples.length / 10)) === 0)
    .slice(0, 10);

  const proof: Omit<DatasetRightsProof, "proofDigest"> = {
    version: "DATASET_RIGHTS_PROOF_v1",
    tokenizerVersion,
    datasetDigest: basis.datasetDigest,
    rightsDigest: basis.rightsDigest,
    source: basis.source,
    admittedWorkCount: intersection.size,
    examplesChecked: examples.length,
    distinctWorksInTraining: distinctWorks.size,
    examplesTracedToAdmittedWork: traced,
    examplesInAuthorsExcluded: inAuthorsExcluded,
    examplesUntraceable: untraceable,
    sampleTrace,
    verified,
  };

  return { ...proof, proofDigest: digestProof(proof) };
}

/** Deterministic digest of a proof, over the fields that matter for provenance. */
export function digestProof(proof: Omit<DatasetRightsProof, "proofDigest">): string {
  return createHash("sha256")
    .update(
      [
        proof.version,
        proof.tokenizerVersion,
        proof.datasetDigest,
        proof.rightsDigest,
        `${proof.source.recordId}:${proof.source.subset}`,
        `admitted:${proof.admittedWorkCount}`,
        `examples:${proof.examplesChecked}`,
        `traced:${proof.examplesTracedToAdmittedWork}`,
        `verified:${proof.verified}`,
      ].join("\n"),
    )
    .digest("hex");
}

export const isProofRefusal = (
  result: DatasetRightsProof | ProofRefusal,
): result is ProofRefusal => "reason" in result;

/**
 * The single line a training run must be able to print before it starts.
 * Throws when the proof does not verify — that is the gate.
 */
export function assertTrainingMayProceed(result: DatasetRightsProof | ProofRefusal): DatasetRightsProof {
  if (isProofRefusal(result)) {
    throw new Error(`dataset rights proof could not be built: ${result.reason}`);
  }
  if (!result.verified) {
    throw new Error(
      `dataset rights proof failed: ${result.examplesUntraceable} example(s) trace to no admitted work and ` +
        `${result.examplesInAuthorsExcluded} to a work the authors' subset excludes. Training must not start.`,
    );
  }
  return result;
}
