import assert from "node:assert/strict";
import test from "node:test";
import {
  CORPUS_TARGET_HUMAN_GOLD,
  CORPUS_TARGET_SONGS,
  MIN_PER_VALUE,
  REAL_BENCHMARK_CORPUS,
  admitEntries,
  corpusCoverage,
  corpusRefusalReason,
  describeCoverage,
  type CorpusEntry,
  type CorpusRightsBasis,
} from "./benchmarkCorpusPlan";

const rights: CorpusRightsBasis = {
  kind: "public_domain",
  reference: "https://example.test/score/1234",
  work: "Niggun in D minor (trad., arr. unknown, pre-1900)",
  clearedAt: "2026-09-09T00:00:00.000Z",
  commercialUse: true,
};

function entry(id: string, over: Partial<CorpusEntry> = {}): CorpusEntry {
  return {
    id,
    title: `Song ${id}`,
    inputType: "full_song",
    rights,
    attributes: {
      tempoBand: "medium",
      meter: "4/4",
      feel: "straight",
      harmony: "moderate",
      density: "moderate",
      ensemble: "small",
      idiom: "western",
      production: "acoustic",
    },
    ...over,
  };
}

test("rights fail closed: a song without a checkable, commercial basis is not in the corpus", () => {
  assert.equal(corpusRefusalReason(entry("a")), null);
  assert.match(
    corpusRefusalReason(entry("b", { rights: { ...rights, commercialUse: false as never } }))!,
    /no commercial-use rights basis/,
  );
  assert.match(corpusRefusalReason(entry("c", { rights: { ...rights, reference: "  " } }))!, /nothing to check it against/);
  // A dataset's licence is not proof of rights in the works inside it, so the
  // basis has to name the work.
  assert.match(corpusRefusalReason(entry("d", { rights: { ...rights, work: "" } }))!, /names no work/);
  assert.match(corpusRefusalReason(entry("e", { rights: { ...rights, clearedAt: "soon" } }))!, /no clearance date/);
  // A human gold arrangement is a separate work and needs its own basis.
  assert.match(
    corpusRefusalReason(entry("f", {
      humanGold: { arrangementId: "arr-1", arrangerCredit: "A. Arranger", rights: { ...rights, commercialUse: false as never } },
    }))!,
    /human gold arrangement .* no commercial-use rights basis of its own/,
  );

  const { admitted, refused } = admitEntries([entry("ok"), entry("bad", { rights: { ...rights, work: "" } })]);
  assert.deepEqual(admitted.map((e) => e.id), ["ok"]);
  assert.equal(refused.length, 1);
  assert.equal(refused[0].id, "bad");
});

test("coverage is reported, and an unbalanced corpus is not called a measure", () => {
  // A hundred identical 4/4 straight pop songs: the count is met, the spread is not.
  const lopsided = Array.from({ length: CORPUS_TARGET_SONGS }, (_, i) => entry(`s${i}`));
  const coverage = corpusCoverage(lopsided);
  assert.equal(coverage.songs, CORPUS_TARGET_SONGS);
  assert.equal(coverage.ready, false, "count alone is not coverage");
  const meter = coverage.dimensions.find((d) => d.dimension === "meter")!;
  assert.equal(meter.counts["4/4"], CORPUS_TARGET_SONGS);
  assert.deepEqual(meter.missing, ["3/4", "6/8"]);
  assert.ok(coverage.gaps.some((g) => g.startsWith('meter "3/4"')));
  assert.ok(coverage.gaps.some((g) => g.includes(`human gold arrangements: 0 of ${CORPUS_TARGET_HUMAN_GOLD}`)));
  assert.ok(!coverage.gaps.some((g) => g.startsWith("songs:")), "the song count is met");
  assert.match(describeCoverage(coverage), /not a measure yet/);
});

test("a dimension represented by one or two songs is an anecdote, not coverage", () => {
  const entries = [
    entry("a", { attributes: { ...entry("a").attributes, meter: "3/4" } }),
    entry("b", { attributes: { ...entry("b").attributes, meter: "3/4" } }),
  ];
  const meter = corpusCoverage(entries).dimensions.find((d) => d.dimension === "meter")!;
  assert.equal(meter.counts["3/4"], 2);
  assert.ok(meter.missing.includes("3/4"), `${MIN_PER_VALUE} songs are required before a value counts`);
});

test("the real corpus is empty and says so — Q-00 is not done", () => {
  assert.deepEqual(REAL_BENCHMARK_CORPUS, []);
  const coverage = corpusCoverage(REAL_BENCHMARK_CORPUS);
  assert.equal(coverage.ready, false);
  assert.equal(coverage.songs, 0);
  assert.equal(coverage.humanGold, 0);
  assert.ok(coverage.gaps[0].startsWith(`songs: 0 of ${CORPUS_TARGET_SONGS}`));
  assert.match(describeCoverage(coverage), /^The benchmark corpus is not a measure yet/);
});
