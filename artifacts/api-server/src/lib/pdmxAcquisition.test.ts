import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import test from "node:test";
import {
  EXPECTED_LICENSE_ID,
  PDMX_RECORD_ID,
  PDMX_USER_AGENT,
  REQUIRED_FILES,
  acquisitionRefusalReason,
  describeAcquisitionPlan,
  fetchPdmxRecord,
  planAcquisition,
  targetDirectoryRefusal,
  verifyDigest,
  type ZenodoRecord,
} from "./pdmxAcquisition";

/** The record exactly as Zenodo publishes it today. */
function record(over: Partial<ZenodoRecord> = {}): ZenodoRecord {
  return {
    doi: "10.5281/zenodo.15571083",
    title: "PDMX: A Large-Scale Public Domain MusicXML Dataset for Symbolic Music Processing",
    metadata: { access_right: "open", license: { id: "cc-by-4.0" }, publication_date: "2025-06-01" },
    files: [
      { key: "subset_paths.tar.gz", size: 29_000_000, checksum: "md5:092eee416ece8060f77d08575b94a43d" },
      { key: "mxl.tar.gz", size: 1_894_000_000, checksum: "md5:49ffd75ecf5489c0be6d41182eb11ff7" },
      { key: "metadata.tar.gz", size: 159_000_000, checksum: "md5:5bc79445090dd2fe5e96cffa77a3461c" },
      { key: "pdf.tar.gz", size: 9_622_000_000, checksum: "md5:2e03ccd072755332bd63a75c57c89b3f" },
      { key: "data.tar.gz", size: 2_238_000_000, checksum: "md5:f38dfa7b75f95e5a3d8d70459c1f9b72" },
      { key: "mid.tar.gz", size: 214_000_000, checksum: "md5:d920a21b2fcd99a56d9c381b39debbb2" },
      { key: "PDMX.csv", size: 225_000_000, checksum: "md5:30392ccf38bb63ce70e7afae70f9c88c" },
    ],
    ...over,
  };
}

test("the published record is accepted on the terms this pipeline was written against", () => {
  assert.equal(acquisitionRefusalReason(record()), null);
});

test("terms that changed since review stop the pipeline rather than being noticed later", () => {
  assert.match(
    acquisitionRefusalReason(record({ metadata: { access_right: "embargoed", license: { id: EXPECTED_LICENSE_ID } } }))!,
    /not "open"/,
  );
  assert.match(
    acquisitionRefusalReason(record({ metadata: { access_right: "open", license: { id: "cc-by-nc-4.0" } } }))!,
    /terms changed since this pipeline was written/,
  );
  assert.match(acquisitionRefusalReason(record({ files: [] }))!, /lists no files/);
});

test("a release that no longer carries a file we need is a stop, not a partial download", () => {
  const without = record({ files: record().files!.filter((f) => f.key !== "PDMX.csv") });
  assert.match(acquisitionRefusalReason(without)!, /no longer contains PDMX\.csv/);
  assert.throws(() => planAcquisition(without), /acquisition refused/);
});

test("only the formats this platform reads are fetched, and the rest is skipped with a reason", () => {
  const plan = planAcquisition(record());
  assert.deepEqual(
    plan.download.map((f) => f.key).sort(),
    REQUIRED_FILES.map((f) => f.key).sort(),
  );
  // 468 MB taken, 13.9 GB left alone.
  assert.ok(plan.downloadBytes < 500_000_000, `${plan.downloadBytes} bytes is more than this platform needs`);
  assert.ok(plan.skippedBytes > 13_000_000_000);

  const pdf = plan.skipped.find((f) => f.key === "pdf.tar.gz")!;
  assert.match(pdf.reason, /nothing in this platform reads a PDF/);
  assert.ok(plan.skipped.every((f) => f.reason.length > 0), "no file is skipped silently");
});

test("a file the record gained since this code was written is skipped, and says it was not recognised", () => {
  const grown = record({
    files: [...record().files!, { key: "audio.tar.gz", size: 5_000_000_000, checksum: "md5:abc" }],
  });
  const plan = planAcquisition(grown);
  const added = plan.skipped.find((f) => f.key === "audio.tar.gz")!;
  assert.match(added.reason, /not named in this pipeline's manifest/);
  assert.ok(!plan.download.some((f) => f.key === "audio.tar.gz"), "an unrecognised file is never fetched");
});

test("the plan carries the digests a training run has to record", () => {
  const plan = planAcquisition(record());
  assert.match(plan.datasetDigest, /^[0-9a-f]{64}$/);
  assert.match(plan.rightsDigest, /^[0-9a-f]{64}$/);
  assert.notEqual(plan.datasetDigest, plan.rightsDigest);
  // The same record gives the same digests, so a run can be tied to its data.
  assert.equal(planAcquisition(record()).datasetDigest, plan.datasetDigest);

  // A file's checksum changing changes the dataset digest — that is the point.
  const rehashed = record({
    files: record().files!.map((f) => (f.key === "mid.tar.gz" ? { ...f, checksum: "md5:0000" } : f)),
  });
  assert.notEqual(planAcquisition(rehashed).datasetDigest, plan.datasetDigest);
});

test("checksum verification names what mismatched rather than failing generically", () => {
  const file = { key: "mid.tar.gz", digest: "d920a21b2fcd99a56d9c381b39debbb2", algorithm: "md5" };
  assert.equal(verifyDigest("D920A21B2FCD99A56D9C381B39DEBBB2", file), null, "case does not matter");
  const failure = verifyDigest("deadbeef", file)!;
  assert.match(failure, /mid\.tar\.gz failed its md5 check/);
  assert.match(failure, /Zenodo publishes d920a21b/);
  assert.match(failure, /hash to deadbeef/);
});

test("the raw archive may only land somewhere git already ignores", () => {
  const ignored = [".pdmx-data", "artifacts/api-server/.data"];
  assert.equal(targetDirectoryRefusal(".pdmx-data", ignored), null);
  assert.equal(targetDirectoryRefusal(".pdmx-data/mid", ignored), null);
  assert.equal(targetDirectoryRefusal(".pdmx-data\\mid", ignored), null, "windows separators are the same path");
  assert.match(targetDirectoryRefusal("docs/evidence", ignored)!, /not inside a git-ignored path/);
  assert.match(targetDirectoryRefusal("", ignored)!, /no target directory/);
  // A prefix that merely shares a name is not the same directory.
  assert.match(targetDirectoryRefusal(".pdmx-data-public", ignored)!, /not inside a git-ignored path/);
});

test("the record is fetched with an identifying user agent, and a 403 is explained", async () => {
  let seen: Record<string, string> | undefined;
  const ok = await fetchPdmxRecord(async (url, init) => {
    assert.equal(url, `https://zenodo.org/api/records/${PDMX_RECORD_ID}`);
    seen = init?.headers;
    return { ok: true, status: 200, json: async () => record() };
  });
  assert.equal(seen?.["user-agent"], PDMX_USER_AGENT);
  assert.equal(ok.doi, "10.5281/zenodo.15571083");

  await assert.rejects(
    fetchPdmxRecord(async () => ({ ok: false, status: 403, json: async () => ({}) })),
    // A 403 with the header set is rate limiting, and saying so stops the next
    // reader from "fixing" it by pretending to be a browser.
    /rate limiting, not a permissions problem/,
  );
});

test("the paths the acquisition script writes to are the paths .gitignore covers", () => {
  // The script asserts its target is git-ignored, but that assertion is only
  // worth anything if .gitignore actually lists the same paths. Reading the
  // real file is the difference between a guard and a comment.
  //
  // Walked up from the working directory rather than resolved from this file:
  // the suite runs from a bundle in a temp directory, where a relative path
  // from the source tree means nothing.
  let directory = process.cwd();
  let gitignore: string | null = null;
  for (let up = 0; up < 8 && gitignore === null; up += 1) {
    try {
      const text = readFileSync(resolve(directory, ".gitignore"), "utf8");
      // The repo root's gitignore, not a package-level one.
      if (text.includes(".local-object-store/")) gitignore = text;
    } catch {
      // keep walking
    }
    directory = dirname(directory);
  }
  assert.ok(gitignore, "could not find the repository .gitignore from the working directory");
  const entries = gitignore.split(/\r?\n/).map((line) => line.trim());
  for (const required of [".pdmx-data/", ".corpus-data/"]) {
    assert.ok(entries.includes(required), `.gitignore must list ${required}`);
  }
});

test("the plan reads as an account of what was taken and what was left", () => {
  const text = describeAcquisitionPlan(planAcquisition(record()));
  assert.match(text, /fetching 3 file\(s\), 0\.47 GB/);
  assert.match(text, /\+ PDMX\.csv/);
  assert.match(text, /- pdf\.tar\.gz \(9\.62 GB\)/);
  assert.match(text, /dataset digest [0-9a-f]{16}…/);
});
