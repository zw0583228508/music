import assert from "node:assert/strict";
import test from "node:test";
import { admitEntries, corpusCoverage } from "./benchmarkCorpusPlan";
import {
  PDMX_SOURCE,
  pdmxRefusalReason,
  pdmxToCorpusEntries,
  selectSpread,
  type PdmxMetadataRow,
} from "./pdmxIngest";

const clean: PdmxMetadataRow = {
  id: "0001",
  title: "A niggun",
  // The composition layer: a composer on the verified public-domain list (d. 1938).
  composer: "Abraham Zevi Idelsohn",
  license_conflict: false,
  license: "Public Domain",
  url: "https://example.test/score/0001",
  tempo: 92,
  time_signature: "4/4",
  n_tracks: 3,
  n_pitch_classes: 8,
  notes_per_bar: 9,
};

test("only the no_license_conflict subset is admitted, and only public-domain statements in it", () => {
  assert.equal(pdmxRefusalReason(clean), null);
  assert.match(
    pdmxRefusalReason({ ...clean, license_conflict: true })!,
    new RegExp(`outside the ${PDMX_SOURCE.subset} subset`),
  );
  // Anything but an explicit false is a conflict: an absent flag is not consent.
  assert.match(pdmxRefusalReason({ ...clean, license_conflict: undefined })!, /outside the/);
  assert.match(pdmxRefusalReason({ ...clean, license: "CC BY-NC 4.0" })!, /not a public-domain statement/);
  assert.match(pdmxRefusalReason({ ...clean, license: undefined })!, /not a public-domain statement/);
  assert.match(pdmxRefusalReason({ ...clean, url: "" })!, /no URL to check its licence/);
  assert.equal(pdmxRefusalReason({ ...clean, license_conflict: "False", license: "CC0 1.0" }), null);
});

test("a row becomes an entry whose rights name the work, not the dataset", () => {
  const { entries, refused } = pdmxToCorpusEntries([clean, { ...clean, id: "0002", license_conflict: true }], {
    clearedAt: "2026-09-09T00:00:00.000Z",
  });
  assert.equal(entries.length, 1);
  assert.deepEqual(refused, [{ id: "0002", reason: `0002 is outside the ${PDMX_SOURCE.subset} subset` }]);
  const [entry] = entries;
  assert.equal(entry.id, "pdmx-0001");
  assert.equal(entry.inputType, "midi", "PDMX holds scores: it fills the MIDI slice and nothing else");
  assert.equal(entry.rights.kind, "public_domain");
  assert.equal(entry.rights.reference, clean.url, "the work's own licence statement, not the record page");
  assert.match(entry.rights.work, /A niggun \(PDMX 0001, no_license_conflict\)/);
  assert.equal(entry.rights.commercialUse, true);
  assert.equal(entry.rights.composer, "Abraham Zevi Idelsohn", "the composition layer names its composer");
  assert.equal(entry.rights.composerDied, 1938);
  // Attributes are derived from published metadata, never invented.
  assert.equal(entry.attributes.tempoBand, "medium");
  assert.equal(entry.attributes.harmony, "moderate");
  assert.equal(entry.attributes.density, "moderate");
  assert.equal(entry.attributes.ensemble, "small");
  assert.equal(entry.attributes.idiom, "western");
  // Everything admitted here passes the corpus's own rights gate.
  assert.equal(admitEntries(entries).refused.length, 0);
});

test("the score's licence does not clear the composition: a row with no verified composer is refused as contested, with the reason", () => {
  const { entries, refused } = pdmxToCorpusEntries([
    { ...clean, id: "pd", composer: "Ludwig van Beethoven" },
    { ...clean, id: "pop", title: "Mamma Mia!", composer: undefined, artist: "ABBA" },
    { ...clean, id: "nobody", title: "Untitled score", composer: undefined },
    { ...clean, id: "label", title: "Santa Baby", composer: "Traditional" },
  ], { clearedAt: "2026-09-10T00:00:00.000Z" });
  assert.deepEqual(entries.map((e) => e.id), ["pdmx-pd"]);
  assert.deepEqual(refused.map((r) => r.id), ["pop", "nobody", "label"]);
  assert.match(refused[0].reason, /contested: .*"abba".*names no verified composer/);
  assert.match(refused[1].reason, /contested: .*names no composer/);
  assert.match(refused[2].reason, /contested: .*labelled "Traditional".*not on the verified traditional/);
  assert.equal(admitEntries(entries).refused.length, 0);
});

test("compound meter is read as compound, and a named non-western tradition as non-western", () => {
  const { entries } = pdmxToCorpusEntries([
    { ...clean, id: "a", time_signature: "6/8" },
    { ...clean, id: "b", time_signature: "3/4" },
    { ...clean, id: "c", genres: ["klezmer", "folk"] },
    { ...clean, id: "d", tempo: 60, n_pitch_classes: 12, notes_per_bar: 22, n_tracks: 9 },
  ]);
  assert.equal(entries[0].attributes.feel, "compound");
  assert.equal(entries[1].attributes.feel, "straight", "3/4 is triple, not compound and not swung");
  assert.equal(entries[2].attributes.idiom, "non_western");
  assert.equal(entries[3].attributes.tempoBand, "slow");
  assert.equal(entries[3].attributes.harmony, "complex");
  assert.equal(entries[3].attributes.density, "dense");
  assert.equal(entries[3].attributes.ensemble, "large");
});

test("selection takes a spread, not the first N rows", () => {
  const rows: PdmxMetadataRow[] = [
    ...Array.from({ length: 20 }, (_, i) => ({ ...clean, id: `plain${i}` })),
    { ...clean, id: "waltz", time_signature: "3/4" },
    { ...clean, id: "jig", time_signature: "6/8" },
    { ...clean, id: "klez", genres: "klezmer" },
  ];
  const { entries } = pdmxToCorpusEntries(rows);
  const picked = selectSpread(entries, 4);
  assert.equal(picked.length, 4);
  const meters = new Set(picked.map((e) => e.attributes.meter));
  assert.ok(meters.has("3/4") && meters.has("6/8"), `first-N would have taken 4 identical rows; got ${[...meters].join(", ")}`);
  // Asking for more than exists returns everything, without repeating a row.
  const all = selectSpread(entries, 999);
  assert.equal(all.length, entries.length);
  assert.equal(new Set(all.map((e) => e.id)).size, entries.length);
});

test("PDMX alone does not make the benchmark corpus a measure", () => {
  const { entries } = pdmxToCorpusEntries(
    Array.from({ length: 200 }, (_, i) => ({ ...clean, id: `s${i}` })),
  );
  const coverage = corpusCoverage(entries);
  assert.equal(coverage.ready, false);
  // Scores cannot fill the recorded-audio slices, and they carry no human gold.
  const inputs = coverage.dimensions.find((d) => d.dimension === "inputType")!;
  assert.deepEqual(inputs.missing.sort(), ["full_song", "piano_vocal", "vocal_only"]);
  assert.ok(coverage.gaps.some((g) => g.includes("human gold arrangements: 0")));
});
