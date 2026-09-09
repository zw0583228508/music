import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";
import {
  AUDITION_FAMILIES,
  PLATFORM_FAMILIES,
  assetAdmissibility,
  deriveSfizzInstrumentMap,
  estimatedSpend,
  familyCoverage,
  instrumentKeyword,
  providerAssetModel,
  worldInstruments,
  type OpenLicenceAsset,
  type OpenLicenceCatalogue,
  type ProvisionRecord,
} from "./openLicenceSoundAssets";

const here = dirname(fileURLToPath(import.meta.url));
// The bundle runs from .tmp-tests/ at the repository root; the source runs from src/lib/.
const catalogueCandidates = [
  join(here, "..", "..", "..", "..", "services", "music-ai-worker", "open_licence_assets.json"),
  join(here, "..", "services", "music-ai-worker", "open_licence_assets.json"),
  join(process.cwd(), "services", "music-ai-worker", "open_licence_assets.json"),
  join(process.cwd(), "..", "..", "services", "music-ai-worker", "open_licence_assets.json"),
];

function committedCatalogue(): OpenLicenceCatalogue {
  for (const candidate of catalogueCandidates) {
    try {
      return JSON.parse(readFileSync(candidate, "utf8")) as OpenLicenceCatalogue;
    } catch {
      // try the next location
    }
  }
  throw new Error(`open_licence_assets.json not found near ${here}`);
}

const SHA = "a".repeat(64);
const HOST = "b".repeat(64);

function asset(overrides: Partial<OpenLicenceAsset> = {}): OpenLicenceAsset {
  return {
    assetId: "lib-abc1234",
    identity: "Vendor / Library / commit abc1234",
    licenseOwner: "CC0",
    source: { kind: "git", repository: "https://example.invalid/lib.git", commit: "c".repeat(40) },
    licence: { spdx: "CC0-1.0", file: "LICENSE" },
    smokeInstrument: "Programs/main.sfz",
    instruments: [
      { sfz: "Programs/main.sfz", instrument: "Library piano", family: "keys", auditionFamily: "piano", keyRange: [21, 108] },
      { sfz: "Programs/Darbuka - Hits.sfz", instrument: "Library darbuka", family: "drums", auditionFamily: "drums", keyRange: [60, 64], world: true, drumKeys: { kick: 60 } },
      { sfz: "Programs/Harp, Concert.sfz", instrument: "Library harp", family: "strings", auditionFamily: "strings", keyRange: [28, 102], standIn: "A plucked harp, not a section." },
    ],
    ...overrides,
  };
}

function goodRecord(overrides: Partial<ProvisionRecord> = {}): ProvisionRecord {
  return {
    assetId: "lib-abc1234",
    licence: { spdx: "CC0-1.0", file: "LICENSE", sha256: "d".repeat(64), markersFound: ["CC0 1.0 Universal"] },
    activated: true,
    steps: { subset: { sha256: SHA, fileCount: 10, bytes: 1000 } },
    operator: {
      host: { identity: "host", sha256: HOST },
      stage: { candidate: { sha256: SHA, rendererSha256: HOST, status: "verified" }, smoke: { audible: true, canonicalSensitivity: true } },
      activate: { status: "active", sha256: SHA },
      health: { healthy: true, asset: { id: "lib-abc1234", sha256: SHA, rendererSha256: HOST } },
      renders: {
        "Programs/main.sfz": { audible: true, peak: 0.4, renderMs: 900 },
        "Programs/Darbuka - Hits.sfz": { audible: true, peak: 0.6, renderMs: 400 },
        "Programs/Harp, Concert.sfz": { audible: false, peak: 0, renderMs: 300 },
      },
    },
    cost: { costUsd: 0.05, containerWallSeconds: 120 },
    ...overrides,
  };
}

test("an asset is admissible only with captured licence text, one tree hash through stage/activate/health, a sensitive smoke and an audible render", () => {
  assert.deepEqual(assetAdmissibility(asset(), goodRecord()), { admissible: true, reasons: [] });
  assert.equal(assetAdmissibility(asset(), undefined).admissible, false);

  const refused = assetAdmissibility(asset(), { assetId: "lib-abc1234", refused: "LICENSE does not carry CC0-1.0" });
  assert.equal(refused.admissible, false);
  assert.match(refused.reasons.join(" "), /licence gate refused/);
  assert.match(refused.reasons.join(" "), /not activated/);

  const wrongLicence = assetAdmissibility(asset(), goodRecord({ licence: { spdx: "CC-BY-4.0", file: "LICENSE", sha256: "d".repeat(64), markersFound: ["Attribution 4.0 International"] } }));
  assert.match(wrongLicence.reasons.join(" "), /captured licence is CC-BY-4.0, catalogue says CC0-1.0/);

  const good = goodRecord();
  const drift = assetAdmissibility(asset(), { ...good, operator: { ...good.operator, activate: { status: "active", sha256: "e".repeat(64) } } });
  assert.match(drift.reasons.join(" "), /activated tree hash differs/);

  const silent = assetAdmissibility(asset(), { ...good, operator: { ...good.operator, renders: { "Programs/main.sfz": { audible: false } } } });
  assert.match(silent.reasons.join(" "), /no instrument rendered an audible phrase/);

  const unhealthy = assetAdmissibility(asset(), { ...good, operator: { ...good.operator, health: { healthy: false, reason: "manifest changed" } } });
  assert.match(unhealthy.reasons.join(" "), /renderer_health is not healthy: manifest changed/);
});

test("family coverage counts a family only through an admissible asset's audible instrument and names what was left out", () => {
  const catalogue: OpenLicenceCatalogue = { version: 1, assets: [asset()] };
  const rows = familyCoverage(catalogue, { "lib-abc1234": goodRecord() });
  assert.deepEqual(rows.map((row) => row.family), [...PLATFORM_FAMILIES]);
  const byFamily = Object.fromEntries(rows.map((row) => [row.family, row]));
  assert.equal(byFamily.keys.sampled, true);
  assert.equal(byFamily.drums.sampled, true);
  assert.equal(byFamily.drums.instruments[0].world, true);
  assert.equal(byFamily.strings.sampled, false);
  assert.deepEqual(byFamily.strings.notCounted, [{ assetId: "lib-abc1234", sfz: "Programs/Harp, Concert.sfz", why: "rendered silence" }]);
  assert.match(byFamily.guitar.fallback ?? "", /LOCAL_EXPRESSIVE_SYNTH/);
  assert.equal(byFamily.keys.fallback, null);

  const refusedRows = familyCoverage(catalogue, { "lib-abc1234": { assetId: "lib-abc1234", refused: "no licence" } });
  assert.ok(refusedRows.every((row) => !row.sampled));
  assert.match(refusedRows.find((row) => row.family === "keys")!.notCounted[0].why, /licence gate refused/);
});

test("the derived instrument map has PR-92's shape: keyword entries, one family entry per served family, reasons for the rest", () => {
  const map = deriveSfizzInstrumentMap(asset());
  assert.equal(instrumentKeyword("Programs/Darbuka - Hits.sfz"), "darbuka");
  assert.equal(instrumentKeyword("Programs/Harp, Concert.sfz"), "harp");
  assert.equal(instrumentKeyword("Black_Pearl_5pc.sfz"), "black pearl 5pc");
  const keywords = map.entries.filter((entry) => entry.match.nameKeyword).map((entry) => entry.match.nameKeyword);
  assert.deepEqual(keywords, ["main", "darbuka", "harp"]);
  const families = map.entries.filter((entry) => entry.match.family).map((entry) => entry.match.family);
  assert.deepEqual(families, ["keys", "strings", "drums"]);
  for (const entry of map.entries) {
    assert.equal(Object.keys(entry.match).length, 1, "exactly one match key, as the worker requires");
    assert.match(entry.sfz, /\.sfz$/);
  }
  assert.equal(map.entries.find((entry) => entry.match.family === "strings")!.standIn, "A plucked harp, not a section.");
  assert.deepEqual(Object.keys(map.unserved).sort(), ["brass", "guitar", "synth", "voice"]);
  assert.match(map.derivedFrom, /review before a worker routes by it/);
});

test("the provider/asset model says one provider id, one active asset per worker process, one root per library", () => {
  const catalogue: OpenLicenceCatalogue = { version: 1, assets: [asset(), asset({ assetId: "other-1234567" })] };
  const model = providerAssetModel(catalogue, { "lib-abc1234": goodRecord() });
  assert.equal(model.providerId, "SFIZZ_VSCO2_CE");
  assert.equal(model.activeAssetsPerWorkerProcess, 1);
  assert.deepEqual(model.assetRoots.map((root) => [root.assetId, root.admissible, root.sha256]), [["lib-abc1234", true, SHA], ["other-1234567", false, null]]);
  assert.equal(model.assetRoots[0].manifest, "/var/lib/music-ai/assets/lib-abc1234/licensed_assets.json");
  assert.match(model.why, /one active `sfz` entry per manifest/);
});

test("world instruments and spend are read from the records, never invented", () => {
  const catalogue: OpenLicenceCatalogue = { version: 1, assets: [asset()] };
  assert.deepEqual(worldInstruments(catalogue), [{ assetId: "lib-abc1234", sfz: "Programs/Darbuka - Hits.sfz", instrument: "Library darbuka", family: "drums" }]);
  assert.deepEqual(estimatedSpend([goodRecord(), undefined, { cost: { costUsd: 0.0125, containerWallSeconds: 30.4 } }], 0.01), { estimatedUsd: 0.0725, containerWallSeconds: 150 });
});

test("the committed catalogue is well-formed on the platform side too", () => {
  const catalogue = committedCatalogue();
  assert.ok(catalogue.assets.length >= 9);
  const ids = new Set<string>();
  for (const entry of catalogue.assets) {
    assert.ok(!ids.has(entry.assetId), `duplicate ${entry.assetId}`);
    ids.add(entry.assetId);
    assert.match(entry.source.commit ?? "", /^[0-9a-f]{40}$/, entry.assetId);
    assert.ok(entry.instruments.some((instrument) => instrument.sfz === entry.smokeInstrument), `${entry.assetId} smoke instrument`);
    for (const instrument of entry.instruments) {
      assert.ok((PLATFORM_FAMILIES as readonly string[]).includes(instrument.family), `${entry.assetId} ${instrument.sfz} family`);
      assert.ok((AUDITION_FAMILIES as readonly string[]).includes(instrument.auditionFamily));
      assert.ok(instrument.keyRange[0] <= instrument.keyRange[1]);
      assert.ok(!instrument.sfz.startsWith("/") && !instrument.sfz.includes(".."));
    }
    const map = deriveSfizzInstrumentMap(entry);
    assert.ok(map.entries.length >= entry.instruments.length, `${entry.assetId} map`);
  }
  const world = worldInstruments(catalogue);
  assert.ok(world.length >= 10);
  assert.ok(world.some((instrument) => /darbuka/i.test(instrument.instrument)));
  assert.ok(catalogue.excluded?.some((entry) => entry.id === "musical-artifacts-941-orient-instruments" && /various/.test(entry.reason)));
});
