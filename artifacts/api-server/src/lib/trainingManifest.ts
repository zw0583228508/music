/**
 * CA2 training-dataset manifest verification (Wave Q — Model Discovery, PR-63).
 *
 * `services/composers-assistant-train/build_dataset.py` writes a manifest for
 * every dataset it builds: digests, counts, the split rule and per-example
 * provenance — never the examples. This module is the platform's reading of
 * that object. It re-derives what it can (the split of every work, the split
 * digest, the leak check, the token ceilings) and hands the provenance to the
 * dataset rights proof, so the training run gates on the same proof the
 * arranger pipeline gates on. A manifest that fails any check is refused with
 * every problem named; a manifest that passes yields a verified proof the
 * trainer must carry.
 */
import { createHash } from "node:crypto";
import {
  buildDatasetRightsProof,
  isProofRefusal,
  type DatasetRightsProof,
  type ExampleProvenance,
  type RightsBasis,
} from "./datasetRightsProof";

export const TRAINING_MANIFEST_VERSION = "CA2_TRAINING_MANIFEST_v1";
export const TRAINING_RIGHTS_BASIS_VERSION = "TRAINING_RIGHTS_BASIS_v1";
export const CA2_MAX_LEN = 1650;
export const CA2_VOCAB_SIZE = 1944;
/** `CA2_UNJOINED_v2.1.0_<vocab sha256 prefix>_1944`, as ca2_pins.tokenizer_version() writes it. */
export const CA2_TOKENIZER_VERSION_PATTERN = /^CA2_UNJOINED_v2\.1\.0_[0-9a-f]{8}_1944$/;
export const SPLIT_RULE = "work-level: int(sha256(workId).hex[:8], 16) % 100 -> <90 train, <95 val, else test";

export type TrainingSplit = "train" | "val" | "test";

export type TrainingExampleProvenance = {
  workId: string;
  split: TrainingSplit;
  index: number;
  exampleId: string;
  targetInst: number;
  inputTokens: number;
  labelTokens: number;
};

export type TrainingManifest = {
  version: string;
  builtAt: string;
  task: string;
  tokenizerVersion: string;
  ca2: Record<string, unknown>;
  datasetDigest: string;
  examplesDigest: string;
  splitDigest: string;
  rightsBasis: {
    version: string;
    basisDigest: string;
    datasetDigest: string;
    rightsDigest: string;
    source: { recordId: string; doi: string; subset: string };
    admittedWorkCount: number;
  };
  splitRule: string;
  maxLen: number;
  maxInputTokensSeen: number;
  maxLabelTokensSeen: number;
  counts: {
    examples: number;
    works: number;
    perSplit: Record<TrainingSplit, { examples: number; works: number; inputTokens: number; labelTokens: number }>;
    perTargetInstrument: Record<string, number>;
    perVariant: Record<string, number>;
  };
  workLevelSplitLeak: boolean;
  provenance: TrainingExampleProvenance[];
};

/** The git-ignored file `scripts/export-training-rights-basis.mjs` writes for the Python builder. */
export type ExportedRightsBasis = {
  version: string;
  exportedAt: string;
  source: { recordId: string; doi: string; subset: string };
  datasetDigest: string;
  rightsDigest: string;
  ourAdmittedCount: number;
  authorsAdmittedCount: number;
  /** Admitted by BOTH gates — the only ids a dataset may be built from. */
  admittedWorkIds: string[];
  /** Ours-only and authors-only, so both original sets can be rebuilt for the proof. */
  ourOnlyWorkIds: string[];
  authorsOnlyWorkIds: string[];
  basisDigest: string;
};

const sha256 = (text: string): string => createHash("sha256").update(text).digest("hex");
const HEX64 = /^[0-9a-f]{64}$/;

/** Identical to extract-arranger-tasks.mjs and training_manifest.split_for_work. */
export function splitForWork(workId: string): TrainingSplit {
  const h = parseInt(sha256(workId).slice(0, 8), 16) % 100;
  return h < 90 ? "train" : h < 95 ? "val" : "test";
}

export function splitDigest(provenance: readonly { workId: string; split: string }[]): string {
  const lines = [...new Set(provenance.map((p) => `${p.workId}:${p.split}`))].sort();
  return sha256(lines.join("\n"));
}

/** Identical to training_manifest.rights_basis_digest. */
export function rightsBasisDigest(basis: Omit<ExportedRightsBasis, "basisDigest">): string {
  const ids = [...basis.admittedWorkIds].sort();
  const head = `${TRAINING_RIGHTS_BASIS_VERSION}\n${basis.datasetDigest}\n${basis.rightsDigest}\n${basis.source.recordId}:${basis.source.subset}\n`;
  return sha256(head + ids.join("\n"));
}

export function exportRightsBasis(
  basis: RightsBasis,
  exportedAt: string,
): ExportedRightsBasis {
  const admitted: string[] = [];
  const ourOnly: string[] = [];
  const authorsOnly: string[] = [];
  for (const id of basis.ourAdmitted) (basis.authorsAdmitted.has(id) ? admitted : ourOnly).push(id);
  for (const id of basis.authorsAdmitted) if (!basis.ourAdmitted.has(id)) authorsOnly.push(id);
  admitted.sort();
  ourOnly.sort();
  authorsOnly.sort();
  const body = {
    version: TRAINING_RIGHTS_BASIS_VERSION,
    exportedAt,
    source: basis.source,
    datasetDigest: basis.datasetDigest,
    rightsDigest: basis.rightsDigest,
    ourAdmittedCount: basis.ourAdmitted.size,
    authorsAdmittedCount: basis.authorsAdmitted.size,
    admittedWorkIds: admitted,
    ourOnlyWorkIds: ourOnly,
    authorsOnlyWorkIds: authorsOnly,
  };
  return { ...body, basisDigest: rightsBasisDigest(body) };
}

/** Rebuild the two gate sets from an export, refusing a tampered file. */
export function rightsBasisFromExport(exported: ExportedRightsBasis): RightsBasis {
  if (exported.version !== TRAINING_RIGHTS_BASIS_VERSION) {
    throw new Error(`rights basis version ${exported.version} is not ${TRAINING_RIGHTS_BASIS_VERSION}`);
  }
  if (rightsBasisDigest(exported) !== exported.basisDigest) {
    throw new Error("rights basis digest mismatch: the exported admitted set was altered; refusing");
  }
  return {
    ourAdmitted: new Set([...exported.admittedWorkIds, ...exported.ourOnlyWorkIds]),
    authorsAdmitted: new Set([...exported.admittedWorkIds, ...exported.authorsOnlyWorkIds]),
    datasetDigest: exported.datasetDigest,
    rightsDigest: exported.rightsDigest,
    source: exported.source,
  };
}

export type ManifestVerification =
  | { ok: true; problems: []; proof: DatasetRightsProof; summary: ManifestSummary }
  | { ok: false; problems: string[]; proof: DatasetRightsProof | null; summary: ManifestSummary | null };

export type ManifestSummary = {
  datasetDigest: string;
  splitDigest: string;
  tokenizerVersion: string;
  examples: number;
  works: number;
  perSplit: TrainingManifest["counts"]["perSplit"];
  perTargetInstrument: Record<string, number>;
};

/**
 * Verify a manifest against a rights basis. Every problem is collected, not
 * just the first: a builder that produced three defects should hear three.
 */
export function verifyTrainingManifest(
  manifest: TrainingManifest,
  basis: RightsBasis,
): ManifestVerification {
  const problems: string[] = [];
  if (manifest.version !== TRAINING_MANIFEST_VERSION) problems.push(`version ${manifest.version} is not ${TRAINING_MANIFEST_VERSION}`);
  if (manifest.task !== "infill") problems.push(`task ${manifest.task} is not CA2's fine-tune task "infill"`);
  if (!CA2_TOKENIZER_VERSION_PATTERN.test(manifest.tokenizerVersion ?? "")) {
    problems.push(`tokenizerVersion ${manifest.tokenizerVersion} is not a CA2 unjoined ${CA2_VOCAB_SIZE}-token vocabulary version`);
  }
  for (const [name, value] of [
    ["datasetDigest", manifest.datasetDigest],
    ["examplesDigest", manifest.examplesDigest],
    ["splitDigest", manifest.splitDigest],
  ] as const) {
    if (!HEX64.test(value ?? "")) problems.push(`${name} is not a sha256 hex digest`);
  }
  if (manifest.splitRule !== SPLIT_RULE) problems.push("splitRule differs from the platform's work-level rule");
  if (manifest.maxLen !== CA2_MAX_LEN) problems.push(`maxLen ${manifest.maxLen} is not CA2's MAX_LEN ${CA2_MAX_LEN}`);
  if (manifest.rightsBasis?.datasetDigest !== basis.datasetDigest) problems.push("rightsBasis.datasetDigest does not match the acquisition manifest");
  if (manifest.rightsBasis?.rightsDigest !== basis.rightsDigest) problems.push("rightsBasis.rightsDigest does not match the acquisition manifest");

  const provenance = Array.isArray(manifest.provenance) ? manifest.provenance : [];
  if (!provenance.length) problems.push("manifest carries no provenance: an empty dataset cannot be verified");
  if (provenance.length !== manifest.counts?.examples) {
    problems.push(`counts.examples ${manifest.counts?.examples} != provenance length ${provenance.length}`);
  }

  const worksBySplit: Record<TrainingSplit, Set<string>> = { train: new Set(), val: new Set(), test: new Set() };
  const seenIds = new Set<string>();
  let overLength = 0;
  let wrongSplit = 0;
  let maxIn = 0;
  let maxLab = 0;
  for (const p of provenance) {
    if (seenIds.has(p.exampleId)) problems.push(`duplicate exampleId ${p.exampleId}`);
    seenIds.add(p.exampleId);
    if (splitForWork(p.workId) !== p.split) wrongSplit += 1;
    if (p.inputTokens > CA2_MAX_LEN || p.labelTokens > CA2_MAX_LEN) overLength += 1;
    maxIn = Math.max(maxIn, p.inputTokens);
    maxLab = Math.max(maxLab, p.labelTokens);
    worksBySplit[p.split]?.add(p.workId);
  }
  if (wrongSplit) problems.push(`${wrongSplit} example(s) sit in a split the work-level rule does not assign them`);
  if (overLength) problems.push(`${overLength} example(s) exceed MAX_LEN ${CA2_MAX_LEN}`);
  const leak =
    [...worksBySplit.train].some((w) => worksBySplit.val.has(w) || worksBySplit.test.has(w)) ||
    [...worksBySplit.val].some((w) => worksBySplit.test.has(w));
  if (leak) problems.push("work-level split leak: a work appears in two splits");
  if (manifest.workLevelSplitLeak) problems.push("manifest itself reports a split leak");
  if (splitDigest(provenance) !== manifest.splitDigest) problems.push("splitDigest does not match the provenance");
  for (const s of ["train", "val", "test"] as const) {
    const declared = manifest.counts?.perSplit?.[s];
    if (!declared) { problems.push(`counts.perSplit.${s} missing`); continue; }
    const actual = provenance.filter((p) => p.split === s).length;
    if (declared.examples !== actual) problems.push(`counts.perSplit.${s}.examples ${declared.examples} != ${actual}`);
    if (declared.works !== worksBySplit[s].size) problems.push(`counts.perSplit.${s}.works ${declared.works} != ${worksBySplit[s].size}`);
  }
  if (manifest.maxInputTokensSeen !== maxIn) problems.push(`maxInputTokensSeen ${manifest.maxInputTokensSeen} != ${maxIn}`);
  if (manifest.maxLabelTokensSeen !== maxLab) problems.push(`maxLabelTokensSeen ${manifest.maxLabelTokensSeen} != ${maxLab}`);

  // The gate that matters: every example traces to a work admitted by both gates.
  const examples: ExampleProvenance[] = provenance.map((p) => ({ workId: p.workId, shard: p.split, index: p.index }));
  const proofResult = buildDatasetRightsProof(examples, basis, manifest.tokenizerVersion);
  let proof: DatasetRightsProof | null = null;
  if (isProofRefusal(proofResult)) {
    problems.push(`rights proof refused: ${proofResult.reason}`);
  } else {
    proof = proofResult;
    if (!proofResult.verified) {
      problems.push(
        `rights proof failed: ${proofResult.examplesUntraceable} untraceable, ${proofResult.examplesInAuthorsExcluded} in the authors' excluded set`,
      );
    }
  }

  const summary: ManifestSummary | null = manifest.counts
    ? {
        datasetDigest: manifest.datasetDigest,
        splitDigest: manifest.splitDigest,
        tokenizerVersion: manifest.tokenizerVersion,
        examples: manifest.counts.examples,
        works: manifest.counts.works,
        perSplit: manifest.counts.perSplit,
        perTargetInstrument: manifest.counts.perTargetInstrument,
      }
    : null;

  if (problems.length || !proof) return { ok: false, problems, proof, summary };
  return { ok: true, problems: [], proof, summary: summary! };
}

/** The file the trainer requires next to manifest.json before it will start. */
export function rightsProofRecord(verification: ManifestVerification, verifiedAt: string) {
  return {
    version: "CA2_TRAINING_RIGHTS_PROOF_RECORD_v1",
    verifiedAt,
    ok: verification.ok,
    problems: verification.problems,
    datasetDigest: verification.summary?.datasetDigest ?? null,
    proof: verification.proof,
  };
}
