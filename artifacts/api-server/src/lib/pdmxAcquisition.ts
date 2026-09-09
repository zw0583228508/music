/**
 * PDMX acquisition (Wave Q, Q-05 Tier A).
 *
 * Pulls the official PDMX release from its Zenodo record through the public
 * API, verifies every file against the checksum Zenodo publishes for it, and
 * takes only the formats this platform actually uses.
 *
 * Four rules, each because the careless version of this is worse than not
 * having the data:
 *
 *  1. **Fail closed on the record.** If the record's access right or licence is
 *     not what this module was written against, nothing is downloaded. A
 *     dataset whose terms changed since the code was reviewed is a dataset
 *     nobody has reviewed.
 *  2. **Checksum everything.** A file that does not match its published digest
 *     is not the dataset; it is bytes that arrived over a network.
 *  3. **Only what we use.** The record carries 14.4 GB. This platform needs
 *     468 MB of it. The 9.6 GB of rendered sheet-music PDFs are images we do
 *     not train on, and downloading them anyway would be waste dressed as
 *     thoroughness.
 *  4. **Never into the repository.** The target directory must be ignored by
 *     git, and the plan refuses if it is not.
 *
 * A note the rest of the pipeline depends on: **the record's CC-BY-4.0 licence
 * is a licence on the dataset compilation, not on the works inside it.** The
 * works are claimed public domain on MuseScore, and the authors themselves
 * found that claim contradicted for 31,221 songs (12.29%). Which of them may be
 * used is decided per work by `pdmxIngest.ts`, on the `no_license_conflict`
 * subset — never by this module, and never by the dataset licence.
 */
import { createHash } from "node:crypto";

export const PDMX_RECORD_ID = "15571083";
export const PDMX_DOI = "10.5281/zenodo.15571083";
export const PDMX_API_URL = `https://zenodo.org/api/records/${PDMX_RECORD_ID}`;

/** Zenodo blocks anonymous clients; identify the caller honestly. */
export const PDMX_USER_AGENT =
  "ai-music-platform-pdmx-acquisition/1.0 (symbolic music research dataset ingestion)";

/** The terms this module was written against. A change here is a stop, not a warning. */
export const EXPECTED_ACCESS_RIGHT = "open";
export const EXPECTED_LICENSE_ID = "cc-by-4.0";

export type ZenodoFile = {
  key: string;
  size: number;
  /** As published, e.g. "md5:49ffd75ecf5489c0be6d41182eb11ff7". */
  checksum: string;
  links?: { self?: string };
};

export type ZenodoRecord = {
  doi?: string;
  title?: string;
  files?: ZenodoFile[];
  metadata?: {
    access_right?: string;
    license?: { id?: string };
    publication_date?: string;
  };
};

/** Why this platform wants a file, or why it does not. */
type FilePurpose = { key: string; purpose: string };

/**
 * What we take. Deliberately short: the rights table, the official subset
 * definition, and the symbolic format we train and benchmark on.
 */
export const REQUIRED_FILES: FilePurpose[] = [
  {
    key: "PDMX.csv",
    purpose:
      "the per-work metadata table carrying the licence-conflict flag; nothing is admitted without it",
  },
  {
    key: "subset_paths.tar.gz",
    purpose: "the authors' own subset definitions, including no_license_conflict",
  },
  {
    key: "mid.tar.gz",
    purpose: "MIDI — the symbolic format the tokenizer and the benchmark read",
  },
];

/** What we skip, and why. A silent skip is indistinguishable from a bug. */
export const SKIPPED_FILES: FilePurpose[] = [
  {
    key: "pdf.tar.gz",
    purpose: "rendered sheet-music images; nothing in this platform reads a PDF",
  },
  {
    key: "mxl.tar.gz",
    purpose: "compressed MusicXML; the MIDI carries what the tokenizer needs",
  },
  {
    key: "data.tar.gz",
    purpose: "the authors' own JSON encoding; superseded by our own parsing of the MIDI",
  },
  {
    key: "metadata.tar.gz",
    purpose: "per-song descriptive metadata; PDMX.csv carries the fields the rights gate reads",
  },
];

export type AcquisitionFile = {
  key: string;
  purpose: string;
  bytes: number;
  /** Algorithm and digest, split from Zenodo's "algo:hex" form. */
  algorithm: string;
  digest: string;
  url: string;
};

export type AcquisitionPlan = {
  recordId: string;
  doi: string;
  download: AcquisitionFile[];
  skipped: Array<{ key: string; bytes: number; reason: string }>;
  downloadBytes: number;
  skippedBytes: number;
  /**
   * Digest of exactly which files, at which checksums, this plan will fetch.
   * Recorded on every training run so a model can be tied to its data.
   */
  datasetDigest: string;
  /** Digest of the terms the data was taken under, for the same reason. */
  rightsDigest: string;
};

/**
 * Why this record may not be downloaded, or null when it may.
 *
 * Checks the terms rather than trusting them: an embargoed or relicensed record
 * must stop the pipeline, not be noticed later.
 */
export function acquisitionRefusalReason(record: ZenodoRecord): string | null {
  const access = record.metadata?.access_right;
  if (access !== EXPECTED_ACCESS_RIGHT) {
    return `Zenodo reports access_right "${access ?? "unknown"}", not "${EXPECTED_ACCESS_RIGHT}"; this record is not openly available on the terms this pipeline was reviewed against`;
  }
  const license = record.metadata?.license?.id;
  if (license !== EXPECTED_LICENSE_ID) {
    return `Zenodo reports licence "${license ?? "none"}", not "${EXPECTED_LICENSE_ID}"; the terms changed since this pipeline was written and must be re-reviewed`;
  }
  if (!record.files?.length) return "the record lists no files";
  const missing = REQUIRED_FILES.filter((f) => !record.files!.some((file) => file.key === f.key));
  if (missing.length) {
    return `the record no longer contains ${missing.map((f) => f.key).join(", ")}; the release layout changed`;
  }
  return null;
}

const splitChecksum = (checksum: string): { algorithm: string; digest: string } => {
  const [algorithm, digest] = checksum.includes(":") ? checksum.split(":", 2) : ["md5", checksum];
  return { algorithm: algorithm.toLowerCase(), digest: digest.toLowerCase() };
};

const fileUrl = (file: ZenodoFile): string =>
  file.links?.self ?? `https://zenodo.org/records/${PDMX_RECORD_ID}/files/${encodeURIComponent(file.key)}?download=1`;

/**
 * What would be fetched, what would not, and the digests that tie a training
 * run to this exact data. Throws only on a refusal, which is the one case where
 * continuing is worse than stopping.
 */
export function planAcquisition(record: ZenodoRecord): AcquisitionPlan {
  const refusal = acquisitionRefusalReason(record);
  if (refusal) throw new Error(`PDMX acquisition refused: ${refusal}`);

  const byKey = new Map((record.files ?? []).map((file) => [file.key, file]));
  const download: AcquisitionFile[] = REQUIRED_FILES.map((wanted) => {
    const file = byKey.get(wanted.key)!;
    const { algorithm, digest } = splitChecksum(file.checksum);
    return {
      key: file.key,
      purpose: wanted.purpose,
      bytes: file.size,
      algorithm,
      digest,
      url: fileUrl(file),
    };
  });

  const wantedKeys = new Set(REQUIRED_FILES.map((f) => f.key));
  const reasonByKey = new Map(SKIPPED_FILES.map((f) => [f.key, f.purpose]));
  const skipped = (record.files ?? [])
    .filter((file) => !wantedKeys.has(file.key))
    .map((file) => ({
      key: file.key,
      bytes: file.size,
      // A file the record gained since this module was written is skipped with
      // that said plainly, rather than quietly ignored.
      reason: reasonByKey.get(file.key) ?? "not named in this pipeline's manifest; skipped rather than guessed at",
    }));

  const datasetDigest = createHash("sha256")
    .update(
      download
        .map((file) => `${file.key}:${file.algorithm}:${file.digest}:${file.bytes}`)
        .sort()
        .join("\n"),
    )
    .digest("hex");
  const rightsDigest = createHash("sha256")
    .update(
      [
        `record:${PDMX_RECORD_ID}`,
        `doi:${record.doi ?? PDMX_DOI}`,
        `access:${record.metadata?.access_right}`,
        `license:${record.metadata?.license?.id}`,
        // The subset is part of the rights basis, not a filter applied later.
        "subset:no_license_conflict",
        "works:public_domain_per_work_verified_by_pdmxIngest",
      ].join("\n"),
    )
    .digest("hex");

  return {
    recordId: PDMX_RECORD_ID,
    doi: record.doi ?? PDMX_DOI,
    download,
    skipped,
    downloadBytes: download.reduce((sum, file) => sum + file.bytes, 0),
    skippedBytes: skipped.reduce((sum, file) => sum + file.bytes, 0),
    datasetDigest,
    rightsDigest,
  };
}

/** Human-readable account of a plan, for a log or an evidence file. */
export function describeAcquisitionPlan(plan: AcquisitionPlan): string {
  const gb = (bytes: number) => `${(bytes / 1e9).toFixed(2)} GB`;
  return [
    `PDMX ${plan.doi}: fetching ${plan.download.length} file(s), ${gb(plan.downloadBytes)}`,
    ...plan.download.map((f) => `  + ${f.key} (${gb(f.bytes)}) — ${f.purpose}`),
    `skipping ${plan.skipped.length} file(s), ${gb(plan.skippedBytes)}`,
    ...plan.skipped.map((f) => `  - ${f.key} (${gb(f.bytes)}) — ${f.reason}`),
    `dataset digest ${plan.datasetDigest.slice(0, 16)}… rights digest ${plan.rightsDigest.slice(0, 16)}…`,
  ].join("\n");
}

export type FetchLike = (url: string, init?: { headers?: Record<string, string> }) => Promise<{
  ok: boolean;
  status: number;
  json: () => Promise<unknown>;
}>;

/** The record as Zenodo currently publishes it. */
export async function fetchPdmxRecord(fetchImpl: FetchLike): Promise<ZenodoRecord> {
  const response = await fetchImpl(PDMX_API_URL, {
    headers: { accept: "application/json", "user-agent": PDMX_USER_AGENT },
  });
  if (!response.ok) {
    throw new Error(
      response.status === 403
        ? `Zenodo returned 403. It blocks clients that do not identify themselves; this pipeline sends "${PDMX_USER_AGENT}". A 403 with that header set means rate limiting, not a permissions problem — retry later rather than working around it.`
        : `Zenodo returned ${response.status} for ${PDMX_API_URL}`,
    );
  }
  return (await response.json()) as ZenodoRecord;
}

/**
 * Whether a downloaded file is the file the record describes.
 *
 * Returns the reason it is not, so a mismatch is reported as a mismatch rather
 * than as a generic failure.
 */
export function verifyDigest(
  actualDigestHex: string,
  file: Pick<AcquisitionFile, "key" | "digest" | "algorithm">,
): string | null {
  if (actualDigestHex.toLowerCase() === file.digest) return null;
  return `${file.key} failed its ${file.algorithm} check: Zenodo publishes ${file.digest}, the downloaded bytes hash to ${actualDigestHex.toLowerCase()}`;
}

/**
 * Where the raw archive may be written.
 *
 * The dataset is 468 MB of third-party data and must never enter the
 * repository — not as a file, not as an LFS pointer. The caller passes the
 * paths git already ignores; anything outside them is refused here rather than
 * discovered in a diff.
 */
export function targetDirectoryRefusal(
  targetDirectory: string,
  gitIgnoredPrefixes: readonly string[],
): string | null {
  const normalised = targetDirectory.replace(/\\/g, "/").replace(/\/+$/, "");
  if (!normalised) return "no target directory was given";
  const covered = gitIgnoredPrefixes.some((prefix) => {
    const clean = prefix.replace(/\\/g, "/").replace(/\/+$/, "");
    return clean.length > 0 && (normalised === clean || normalised.startsWith(`${clean}/`));
  });
  if (!covered) {
    return `${targetDirectory} is not inside a git-ignored path (${gitIgnoredPrefixes.join(", ") || "none given"}); raw dataset files must never be able to enter the repository`;
  }
  return null;
}
