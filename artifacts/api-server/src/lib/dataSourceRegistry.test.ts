import assert from "node:assert/strict";
import test from "node:test";
import {
  STYLE_FAMILIES,
  classifyDataSource,
  estimateTaskYield,
  explainDataSourceClassification,
  researchUsable,
  shippable,
  summariseRegistry,
  trainableCommercially,
  unreadLicences,
  type DataSourceEntry,
  type LicenceEvidence,
} from "./dataSourceRegistry";
import { DATA_SOURCE_REGISTRY, PR60_CANDIDATES } from "./dataSourceRegistryData";

const verified = (stated: string): LicenceEvidence => ({
  stated, source: "licence page", readOn: "2026-09-09", confidence: "verified_primary_source",
});
const unread: LicenceEvidence = { stated: null, source: null, readOn: null, confidence: "unknown" };

function entry(over: Partial<DataSourceEntry> = {}): DataSourceEntry {
  return {
    id: "X", name: "X", kind: "open_dataset", publisher: "lab", url: null,
    formats: ["midi"], ensemble: "multitrack", multitrackShare: null,
    styles: ["contemporary_pop"], regions: [],
    claimedSize: { works: 100, claim: "100 works", measured: false },
    compilationLicence: verified("CC BY 4.0"),
    perWorkLicence: verified("uniform — CC BY 4.0"),
    underlyingWorks: { ...verified("commissioned originals"), cleared: "yes", basis: "commissioned_original" },
    statedRestriction: null,
    cost: { model: "free", note: "" },
    acquisition: "NOT_FETCHED",
    rightsRecordNeeds: [], knownLimitations: [],
    auditConfidence: "verified_primary_source",
    ...over,
  };
}

// ---------------------------------------------------------------------------
// The classifier
// ---------------------------------------------------------------------------

test("TRAIN_CLEARED needs all three layers read from a primary source and the works cleared", () => {
  assert.equal(classifyDataSource(entry()), "TRAIN_CLEARED");
  assert.ok(trainableCommercially(entry()));
});

test("a permissive compilation licence does not clear a per-work layer that was never read", () => {
  const e = entry({ perWorkLicence: unread });
  assert.equal(classifyDataSource(e), "LEGAL_REVIEW_REQUIRED");
  assert.match(explainDataSourceClassification(e), /per-work licence/);
});

test("permissive everywhere on paper, but the underlying works not cleared, is RESEARCH_ONLY (the Lakh case)", () => {
  const e = entry({ underlyingWorks: { ...verified("scraped transcriptions"), cleared: "no", basis: "copyrighted_transcription" } });
  assert.equal(classifyDataSource(e), "RESEARCH_ONLY");
  assert.match(explainDataSourceClassification(e), /not cleared/);
  assert.ok(!trainableCommercially(e));
});

test("non-commercial anywhere blocks, in every dialect archivists write it in", () => {
  for (const wording of [
    "CC BY-NC-SA 4.0",
    "Creative Commons Attribution-NonCommercial 4.0",
    "cc-by-nc-4.0",
    "the tracks can only be used for academic purposes only",
    "intended for private, non-commercial use only",
    "distributed under Fair Dealing for research and private study",
    "research-only licence",
  ]) {
    assert.equal(classifyDataSource(entry({ compilationLicence: verified(wording) })), "BLOCKED_LICENSE", wording);
    assert.equal(classifyDataSource(entry({ perWorkLicence: verified(wording) })), "BLOCKED_LICENSE", wording);
    assert.equal(classifyDataSource(entry({ statedRestriction: wording })), "BLOCKED_LICENSE", wording);
  }
});

test("an explicit AI-training ban blocks even on an otherwise open licence", () => {
  const bans = [
    "You may not use, adapt, modify, or process the material in any way with Large Language Models",
    "may not use the Sounds as source or training material for generative or other types of artificial intelligence models",
    "use any MIDI file as a source to develop or train any artificial intelligence technology is prohibited",
    "prohibited for the purpose of training, developing or enhancing AI systems or machine learning models",
  ];
  for (const ban of bans) {
    const e = entry({ compilationLicence: verified(`ODbL, commercial use permitted; ${ban}`) });
    assert.equal(classifyDataSource(e), "BLOCKED_LICENSE", ban);
    assert.match(explainDataSourceClassification(e), /ban on AI\/ML training/);
  }
  // Mentioning AI is not banning it.
  assert.equal(classifyDataSource(entry({ compilationLicence: verified("CC BY 4.0; no clause about AI exists") })), "TRAIN_CLEARED");
});

test("unknown provenance is LEGAL_REVIEW_REQUIRED, not a quiet pass", () => {
  const e = entry({ underlyingWorks: { ...verified("traditional"), cleared: "unknown", basis: "traditional_unattributed" } });
  assert.equal(classifyDataSource(e), "LEGAL_REVIEW_REQUIRED");
  assert.match(explainDataSourceClassification(e), /underlying-works provenance/);
});

test("a secondary-source licence is not enough to train on", () => {
  const e = entry({ compilationLicence: { ...verified("CC BY 4.0"), confidence: "secondary" } });
  assert.equal(classifyDataSource(e), "LEGAL_REVIEW_REQUIRED");
});

test("an entry cannot declare itself trainable: classification is derived, never stored", () => {
  assert.ok(!Object.keys(entry()).includes("licenseClass"));
  assert.ok(!Object.keys(entry()).includes("classification"));
});

test("the predicates partition as documented", () => {
  const cleared = entry({ id: "A" });
  const research = entry({ id: "B", underlyingWorks: { ...verified("x"), cleared: "no", basis: "copyrighted_transcription" } });
  const review = entry({ id: "C", perWorkLicence: unread });
  const blocked = entry({ id: "D", statedRestriction: "non-commercial" });
  const all = [cleared, research, review, blocked];
  assert.deepEqual(shippable(all).map((e) => e.id), ["A"]);
  assert.deepEqual(researchUsable(all).map((e) => e.id), ["A", "B"]);
  assert.deepEqual(unreadLicences(all).map((e) => e.id), ["C"]);
});

// ---------------------------------------------------------------------------
// Yield
// ---------------------------------------------------------------------------

test("yield follows PR-65's measured per-work rates and refuses to invent a number", () => {
  const multi = estimateTaskYield(entry({ claimedSize: { works: 1_000, claim: "", measured: false } }));
  assert.equal(multi.totalTasks, Math.round(1_000 * (1_347_597 / 20_638)));
  assert.equal(multi.arrangementTasks, Math.round(1_000 * (1_019_817 / 20_638)));

  const melody = estimateTaskYield(entry({ ensemble: "melody_only", claimedSize: { works: 1_000, claim: "", measured: false } }));
  assert.equal(melody.arrangementTasks, 0, "a melody has nothing to hide");
  assert.equal(melody.totalTasks, Math.round(1_000 * (1_966_370 / 202_131)));

  assert.equal(estimateTaskYield(entry({ ensemble: "drums_only" })).totalTasks, 0);
  assert.equal(estimateTaskYield(entry({ ensemble: "audio_stems" })).totalTasks, 0);
  assert.equal(estimateTaskYield(entry({ claimedSize: { works: null, claim: "unknown", measured: false } })).totalTasks, null);
  assert.equal(estimateTaskYield(entry({ ensemble: "mixed", multitrackShare: null })).totalTasks, null);

  const mixed = estimateTaskYield(entry({ ensemble: "mixed", multitrackShare: 0.5, claimedSize: { works: 200, claim: "", measured: false } }));
  assert.equal(mixed.arrangementTasks, Math.round(100 * (1_019_817 / 20_638)));
});

// ---------------------------------------------------------------------------
// The real registry obeys the discipline
// ---------------------------------------------------------------------------

test("no source is marked trainable on an unread licence, and every read layer names its source and date", () => {
  for (const source of DATA_SOURCE_REGISTRY) {
    for (const layer of [source.compilationLicence, source.perWorkLicence, source.underlyingWorks]) {
      if (layer.confidence === "verified_primary_source") {
        assert.ok(layer.stated && layer.source && layer.readOn, `${source.id}: a verified layer cites what was read and when`);
      }
    }
    if (trainableCommercially(source)) {
      assert.ok(!unreadLicences([source]).length, `${source.id} is trainable only because every layer was read`);
      assert.equal(source.underlyingWorks.cleared, "yes", `${source.id}: works cleared`);
    }
  }
});

test("non-commercial or AI-ban wording anywhere in a real entry lands it in BLOCKED_LICENSE", () => {
  const restrictive = /non-?commercial|\bnc\b|academic purposes only|fair dealing|artificial intelligence|large language model|machine learning/i;
  for (const source of DATA_SOURCE_REGISTRY) {
    const texts = [source.statedRestriction, source.compilationLicence.stated, source.perWorkLicence.stated, source.underlyingWorks.stated];
    const hasBan = source.statedRestriction !== null && restrictive.test(source.statedRestriction);
    if (hasBan) assert.equal(classifyDataSource(source), "BLOCKED_LICENSE", source.id);
    if (texts.some((t) => t && /cc[- ]by[- ]nc|non-?commercial/i.test(t))) {
      assert.equal(classifyDataSource(source), "BLOCKED_LICENSE", source.id);
    }
  }
});

test("the registry classifies; it does not fetch", () => {
  for (const source of DATA_SOURCE_REGISTRY) {
    assert.equal(source.acquisition, "NOT_FETCHED", source.id);
  }
  // Only PDMX carries a measured count — PR-65 measured it on every file.
  assert.deepEqual(
    DATA_SOURCE_REGISTRY.filter((s) => s.claimedSize.measured).map((s) => s.id),
    ["PDMX_NO_LICENSE_CONFLICT"],
  );
});

test("ids are unique, every source covers at least one style family, and the PR-60 candidates are all present", () => {
  const ids = DATA_SOURCE_REGISTRY.map((s) => s.id);
  assert.equal(new Set(ids).size, ids.length);
  for (const source of DATA_SOURCE_REGISTRY) {
    assert.ok(source.styles.length > 0, source.id);
    for (const family of source.styles) assert.ok(STYLE_FAMILIES.includes(family), `${source.id}: ${family}`);
  }
  for (const id of PR60_CANDIDATES) assert.ok(ids.includes(id), id);
});

test("exactly these sources are TRAIN_CLEARED, each because every layer was read from a primary source", () => {
  // Deliberately pinned. Adding a name here means someone read three licence
  // layers from primary sources on a stated date and found no restriction.
  assert.deepEqual(shippable(DATA_SOURCE_REGISTRY).map((s) => s.id).sort(), [
    "EXPANDED_GROOVE_MIDI",
    "GROOVE_MIDI_DATASET",
    "MUTOPIA",
    "ONAIR_MUSIC_STEMS",
    "OPENSCORE_LIEDER",
    "PDMX_NO_LICENSE_CONFLICT",
    "RADIF_CORPUS",
  ]);
});

test("the honest bottom line is pinned: no cleared source yields an arrangement task for Mizrahi/Israeli, Jewish diaspora, maqam, Indian, East/Southeast Asian, Balkan, flamenco, Latin or reggae/afrobeat", () => {
  const summary = summariseRegistry(DATA_SOURCE_REGISTRY);
  for (const family of [
    "mizrahi_israeli", "jewish_diaspora", "middle_eastern_maqam", "indian", "east_asian", "southeast_asian",
    "balkan", "flamenco", "latin", "reggae_afrobeat",
  ] as const) {
    assert.equal(summary.clearedYieldByStyle[family].arrangementTasks, 0, family);
    assert.ok(summary.stylesWithoutClearedArrangementData.includes(family), family);
  }
  // The production families have cleared arrangement tasks from PDMX alone,
  // measured, and few: pop 437 multitrack works, hip-hop 95, electronic 125.
  const pdmx = DATA_SOURCE_REGISTRY.find((s) => s.id === "PDMX_NO_LICENSE_CONFLICT")!;
  for (const family of ["contemporary_pop", "hiphop", "edm_house_techno", "rnb_soul"] as const) {
    const slot = summary.clearedYieldByStyle[family];
    assert.equal(slot.measuredSources, 1, family);
    assert.equal(slot.arrangementTasks, pdmx.measuredYieldByStyle![family]!.arrangementTasks, family);
    assert.ok(slot.arrangementTasks < 25_000, `${family}: ${slot.arrangementTasks}`);
  }
  // A cleared source without measured per-family numbers is an estimate and flagged as one.
  assert.ok(summary.clearedYieldByStyle.middle_eastern_maqam.estimatedSources >= 1);
  assert.equal(summary.total, DATA_SOURCE_REGISTRY.length);
  assert.equal(summary.byClass.TRAIN_CLEARED, 7);
  assert.equal(summary.read + summary.unread, summary.total);
  assert.equal(summary.notFetched, summary.total);
});

test("measured per-family yield is only claimed by the source whose files were measured", () => {
  assert.deepEqual(
    DATA_SOURCE_REGISTRY.filter((s) => s.measuredYieldByStyle).map((s) => s.id),
    ["PDMX_NO_LICENSE_CONFLICT"],
  );
  const pdmx = DATA_SOURCE_REGISTRY.find((s) => s.id === "PDMX_NO_LICENSE_CONFLICT")!;
  for (const family of Object.keys(pdmx.measuredYieldByStyle!)) {
    assert.ok(pdmx.styles.includes(family as never), `${family} is listed as a covered style`);
  }
});

test("the four PR-60 refusals stay refused and the five possibles are not quietly cleared", () => {
  const byId = new Map(DATA_SOURCE_REGISTRY.map((s) => [s.id, classifyDataSource(s)]));
  for (const id of ["LAKH_MIDI", "METAMIDI", "SLAKH2100", "WIKIFONIA"]) {
    assert.equal(byId.get(id), "RESEARCH_ONLY", id);
  }
  assert.equal(byId.get("IMSLP_PD_CC0_SUBSET"), "LEGAL_REVIEW_REQUIRED");
  assert.equal(byId.get("CPDL"), "LEGAL_REVIEW_REQUIRED");
  assert.equal(byId.get("NOTTINGHAM_MUSIC_DATABASE"), "LEGAL_REVIEW_REQUIRED");
  assert.equal(byId.get("GROOVE_MIDI_DATASET"), "TRAIN_CLEARED");
  assert.equal(byId.get("TOONTRACK_MIDI_PACKS"), "BLOCKED_LICENSE", "the 2026 EULA bans AI training outright");
});
