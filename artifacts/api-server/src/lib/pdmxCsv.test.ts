import assert from "node:assert/strict";
import test from "node:test";
import {
  MAX_PLAUSIBLE_BPM,
  csvHeaderIndex,
  csvRowToMetadataRow,
  headerRefusalReason,
  parseCsvLine,
  pdmxIdFromPath,
  subsetAgreement,
} from "./pdmxCsv";
import { pdmxRefusalReason } from "./pdmxIngest";

/** The real header, verbatim. */
const HEADER =
  "path,metadata,mxl,pdf,mid,version,is_user_pro,is_user_publisher,is_user_staff,has_paywall,is_rated,is_official,is_original,is_draft,has_custom_audio,has_custom_video,n_comments,n_favorites,n_views,n_ratings,rating,license,license_url,license_conflict,genres,groups,tags,song_name,title,subtitle,artist_name,composer_name,publisher,complexity,n_tracks,tracks,song_length,song_length.seconds,song_length.bars,song_length.beats,n_notes,notes_per_bar,n_annotations,has_annotations,n_lyrics,has_lyrics,n_tokens,pitch_class_entropy,scale_consistency,groove_consistency,best_path,is_best_path,best_arrangement,is_best_arrangement,best_unique_arrangement,is_best_unique_arrangement,subset:all,subset:rated,subset:deduplicated,subset:rated_deduplicated,subset:no_license_conflict,subset:all_valid";

const index = csvHeaderIndex(HEADER);

/** Build a CSV line from a small patch over sane defaults. */
function line(over: Record<string, string> = {}): string {
  const base: Record<string, string> = {
    path: "./data/1/11/QmbbGKtZ9G6DkWxvSeU516c1ktWiFJmEbHGmR3JFtLAPyC.json",
    mid: "./mid/1/11/QmbbGKtZ9G6DkWxvSeU516c1ktWiFJmEbHGmR3JFtLAPyC.mid",
    license: "publicdomain",
    license_url: "https://creativecommons.org/publicdomain/mark/1.0/",
    license_conflict: "False",
    "subset:no_license_conflict": "True",
    genres: "classical",
    song_name: "I shall be no stranger there",
    composer_name: "Trad.",
    n_tracks: "3",
    "song_length.seconds": "120",
    "song_length.bars": "60",
    "song_length.beats": "240",
    notes_per_bar: "9",
    pitch_class_entropy: "3",
  };
  const patched = { ...base, ...over };
  return parseCsvLine(HEADER)
    .map((column) => patched[column] ?? "")
    .join(",");
}

test("a header missing a column this pipeline reads is refused by name", () => {
  assert.equal(headerRefusalReason(index), null);
  const short = csvHeaderIndex(HEADER.replace(",license_conflict", ",lic_conf"));
  assert.match(headerRefusalReason(short)!, /missing the column\(s\).*license_conflict/);
});

test("a quoted field containing commas and quotes survives the split", () => {
  const fields = parseCsvLine('a,"Beethoven, Ludwig van","he said ""hi""",z');
  assert.deepEqual(fields, ["a", "Beethoven, Ludwig van", 'he said "hi"', "z"]);
});

test("the work id comes from the content-addressed path, not a row number", () => {
  assert.equal(
    pdmxIdFromPath("./mid/1/11/QmbbGKtZ9G6DkWxvSeU516c1ktWiFJmEbHGmR3JFtLAPyC.mid"),
    "QmbbGKtZ9G6DkWxvSeU516c1ktWiFJmEbHGmR3JFtLAPyC",
  );
  assert.equal(pdmxIdFromPath("./x/y.pdf"), undefined);
  assert.equal(pdmxIdFromPath(undefined), undefined);
});

test("a row is mapped onto exactly the fields the rights gate reads", () => {
  const row = csvRowToMetadataRow(parseCsvLine(line()), index)!;
  assert.equal(row.id, "QmbbGKtZ9G6DkWxvSeU516c1ktWiFJmEbHGmR3JFtLAPyC");
  assert.equal(row.title, "I shall be no stranger there");
  assert.equal(row.license, "publicdomain");
  assert.equal(row.n_tracks, 3);
  assert.equal(row.notes_per_bar, 9);
  // 240 beats / 120 s * 60 = 120 BPM, arithmetic on two published fields.
  assert.equal(row.tempo, 120);
  // 2 ** entropy: the effective number of pitch classes, from the entropy the
  // table actually measures.
  assert.equal(row.n_pitch_classes, 8);
  // The table has no time signature. The gate must see that, not a fabricated 4/4.
  assert.equal(row.time_signature, undefined);
  assert.equal(pdmxRefusalReason(row), null, "this row is admissible");
});

test("an implausible derived tempo is dropped, not banded on", () => {
  // 961 beats / 90 s * 60 = 640 BPM. A real row in the table divides out to this.
  const fast = csvRowToMetadataRow(
    parseCsvLine(line({ "song_length.seconds": "90", "song_length.beats": "961" })),
    index,
  )!;
  assert.equal(fast.tempo, undefined, `640 BPM is a data artefact, not a pulse`);
  assert.ok(MAX_PLAUSIBLE_BPM < 640);

  const sane = csvRowToMetadataRow(
    parseCsvLine(line({ "song_length.seconds": "120", "song_length.beats": "180" })),
    index,
  )!;
  assert.equal(sane.tempo, 90);
});

test("a row with no usable identifier is dropped rather than given a placeholder id", () => {
  assert.equal(csvRowToMetadataRow(parseCsvLine(line({ path: "./x/y.json", mid: "" })), index), null);
});

test("our reading and the authors' subset flag are compared, and disagreement is surfaced", () => {
  const admit = csvRowToMetadataRow(parseCsvLine(line()), index)!;
  assert.equal(subsetAgreement(admit, true), "agree");
  assert.equal(subsetAgreement(admit, false), "we_exclude_they_admit");

  const theyExclude = csvRowToMetadataRow(
    parseCsvLine(line({ "subset:no_license_conflict": "False" })),
    index,
  )!;
  assert.equal(subsetAgreement(theyExclude, false), "agree");
  // The dangerous direction: we would admit a row their own subset drops.
  assert.equal(subsetAgreement(theyExclude, true), "we_admit_they_exclude");
});

test("cc-zero, the spelling the real table uses, is accepted as public domain", () => {
  const cc0 = csvRowToMetadataRow(
    parseCsvLine(line({ license: "cc-zero", license_url: "https://creativecommons.org/publicdomain/zero/1.0/" })),
    index,
  )!;
  assert.equal(pdmxRefusalReason(cc0), null, "a hyphen must not exclude a valid CC0 dedication");
});
