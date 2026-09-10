import assert from "node:assert/strict";
import test from "node:test";
import {
  CORPUS_TARGET_HUMAN_GOLD,
  CORPUS_TARGET_SONGS,
  MIN_PER_VALUE,
  PUBLIC_DOMAIN_DEATH_YEAR_CUTOFF,
  REAL_BENCHMARK_CORPUS,
  admitEntries,
  corpusCoverage,
  corpusRefusalReason,
  describeCoverage,
  type CorpusEntry,
  type CorpusRightsBasis,
} from "./benchmarkCorpusPlan";
import { REAL_CORPUS_TIER_H } from "./realCorpusTierH";

const rights: CorpusRightsBasis = {
  kind: "public_domain",
  reference: "https://example.test/score/1234",
  work: "Niggun in D minor (trad., arr. unknown, pre-1900)",
  clearedAt: "2026-09-09T00:00:00.000Z",
  commercialUse: true,
  traditional: true,
  source: "Hasidic niggun, notated in Idelsohn's Thesaurus (1932) from a 19th-century tradition",
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

test("a public-domain claim clears the composition only with a composer dead by the cutoff or a traditional source; contested is refused with its reason", () => {
  const base = { reference: "https://example.test/score/9", work: "Some work (PDMX 9, no_license_conflict)", clearedAt: "2026-09-10T00:00:00.000Z" };
  // The score's licence alone - exactly what the previous Tier H rested on.
  const scoreOnly = entry("score-only", { rights: { ...base, kind: "public_domain", commercialUse: true } as CorpusRightsBasis });
  assert.match(corpusRefusalReason(scoreOnly)!, /claims public domain on the score's licence alone/);
  const late = entry("late", { rights: { ...base, kind: "public_domain", commercialUse: true, composer: "Jean Sibelius", composerDied: 1957 } });
  assert.match(corpusRefusalReason(late)!, new RegExp(`died in 1957, after the ${PUBLIC_DOMAIN_DEATH_YEAR_CUTOFF} cutoff`));
  const onTime = entry("on-time", { rights: { ...base, kind: "public_domain", commercialUse: true, composer: "Franz Xaver Gruber", composerDied: 1863 } });
  assert.equal(corpusRefusalReason(onTime), null);
  const unsourced = entry("unsourced", { rights: { ...base, kind: "public_domain", commercialUse: true, traditional: true, source: " " } });
  assert.match(corpusRefusalReason(unsourced)!, /called traditional with no source/);
  const contested = entry("contested", { rights: { ...base, kind: "contested", commercialUse: false, reason: "the PDMX row names \"ABBA\", not on the verified public-domain composer list" } });
  assert.match(corpusRefusalReason(contested)!, /is contested: the PDMX row names "ABBA"/);
  const { admitted, refused } = admitEntries([scoreOnly, late, onTime, unsourced, contested]);
  assert.deepEqual(admitted.map((e) => e.id), ["on-time"]);
  assert.equal(refused.length, 4);
  // A contested entry never counts towards coverage either.
  assert.equal(corpusCoverage([contested, onTime]).songs, 1);
});

test("the generated Tier H corpus holds no contested entry and every entry proves its composition", () => {
  assert.ok(REAL_CORPUS_TIER_H.length > 0, "Tier H is generated (select-real-corpus.mjs)");
  for (const e of REAL_CORPUS_TIER_H) {
    assert.notEqual(e.rights.kind, "contested", `${e.title} is contested and must not be in the generated corpus`);
    assert.equal(e.rights.kind, "public_domain");
    if (e.rights.kind === "public_domain") {
      if (e.rights.traditional) assert.ok(e.rights.source?.trim(), `${e.title}: traditional needs a source`);
      else {
        assert.ok(e.rights.composer?.trim(), `${e.title}: composer missing`);
        assert.ok(typeof e.rights.composerDied === "number" && e.rights.composerDied <= PUBLIC_DOMAIN_DEATH_YEAR_CUTOFF, `${e.title}: composer death year ${e.rights.composerDied} is not inside the term`);
      }
    }
    assert.equal(corpusRefusalReason(e), null, `${e.title}: ${corpusRefusalReason(e)}`);
  }
  assert.equal(admitEntries(REAL_CORPUS_TIER_H).refused.length, 0);
  assert.deepEqual(REAL_BENCHMARK_CORPUS.map((e) => e.id), REAL_CORPUS_TIER_H.map((e) => e.id));
});

test("the real corpus is not a measure yet and says so - Q-00 is not done", () => {
  const coverage = corpusCoverage(REAL_BENCHMARK_CORPUS);
  assert.equal(coverage.ready, false);
  assert.equal(coverage.songs, REAL_CORPUS_TIER_H.length);
  assert.equal(coverage.humanGold, 0);
  assert.ok(coverage.gaps[0].startsWith(`songs: ${REAL_CORPUS_TIER_H.length} of ${CORPUS_TARGET_SONGS}`));
  assert.ok(coverage.gaps.some((g) => g.startsWith('inputType "full_song"')), "scores never fill the recorded slices");
  assert.match(describeCoverage(coverage), /^The benchmark corpus is not a measure yet/);
});
