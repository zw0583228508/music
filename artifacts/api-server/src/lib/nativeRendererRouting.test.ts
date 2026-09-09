import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { test } from "node:test";
import {
  decideNativeRoute,
  resolveSfizzInstrument,
  sfizzFamilyCoverage,
  sfizzServedFamilies,
  type SfizzInstrumentMap,
} from "./nativeRendererRouting";

// The committed map the worker ships; the platform must read it the way the
// worker does. The test may run from the source tree or from a bundle under
// .tmp-tests/, so the repository root is found by its workspace file.
function repositoryRoot(): string {
  let directory = dirname(fileURLToPath(import.meta.url));
  for (let depth = 0; depth < 8; depth += 1) {
    if (existsSync(resolve(directory, "pnpm-workspace.yaml"))) return directory;
    directory = resolve(directory, "..");
  }
  throw new Error("repository root not found");
}
const committedMap = JSON.parse(readFileSync(
  resolve(repositoryRoot(), "services/music-ai-worker/sfizz_instrument_map.json"), "utf8",
)) as SfizzInstrumentMap;

const track = (instrument: string, id: string, family: string) => ({
  instrument,
  instrumentDefinition: { id, family: family as "keys" },
});

const healthySfizz = { configured: true as const, healthy: true as const, map: committedMap };

test("the committed map serves keys, strings and brass and explains every other family", () => {
  assert.deepEqual(sfizzServedFamilies(committedMap), ["keys", "strings", "brass"]);
  const coverage = sfizzFamilyCoverage(committedMap);
  assert.deepEqual(coverage.filter((row) => row.served).map((row) => row.family), ["keys", "strings", "brass"]);
  for (const row of coverage.filter((entry) => !entry.served)) {
    assert.ok(row.reason && row.reason !== "not mapped", `${row.family} must carry the reason it is not served`);
    assert.equal(row.instruments.length, 0);
  }
});

test("platform tracks resolve to the documented VSCO 2 CE instruments, in map order", () => {
  assert.deepEqual(resolveSfizzInstrument(committedMap, track("ensemble", "piano", "keys")), {
    served: true, sfz: "UprightPiano.sfz", instrument: "VSCO 2 CE Upright Piano", matchedBy: { family: "keys" },
  });
  assert.equal((resolveSfizzInstrument(committedMap, track("strings", "strings", "strings")) as { sfz: string }).sfz, "ViolinEnsSusVib.sfz");
  assert.equal((resolveSfizzInstrument(committedMap, track("Cello line", "cello", "strings")) as { sfz: string }).sfz, "CelloEnsSusVib.sfz");
  assert.equal((resolveSfizzInstrument(committedMap, track("Horns", "brass", "brass")) as { sfz: string }).sfz, "FHornSus.sfz");
  // A name keyword outranks the family entry: the platform folds every brass name into id "brass".
  assert.equal((resolveSfizzInstrument(committedMap, track("Trumpet Section", "brass", "brass")) as { sfz: string }).sfz, "TrumpetSusVib.sfz");
  assert.equal((resolveSfizzInstrument(committedMap, track("Trombones", "brass", "brass")) as { sfz: string }).sfz, "TromboneSus.sfz");
});

test("the bass is a declared stand-in, never a silent substitution", () => {
  const resolved = resolveSfizzInstrument(committedMap, track("bass", "bass", "strings"));
  assert.ok(resolved.served);
  assert.equal(resolved.sfz, "ContrabassPizz.sfz");
  assert.deepEqual(resolved.matchedBy, { instrumentId: "bass" });
  assert.match(resolved.standIn ?? "", /pizzicato contrabass/);
});

test("unserved families are refused with a reason that names the family and what is served", () => {
  for (const [instrument, id, family] of [["drums", "drums", "drums"], ["guitar", "guitar", "guitar"], ["Lead Vocal", "voice", "voice"], ["Synth Pad", "synth_pad", "synth"]]) {
    const resolved = resolveSfizzInstrument(committedMap, track(instrument, id, family));
    assert.equal(resolved.served, false);
    assert.match((resolved as { reason: string }).reason, new RegExp(`family '${family}'`));
    assert.match((resolved as { reason: string }).reason, /served families: keys, strings, brass/);
  }
  const drums = resolveSfizzInstrument(committedMap, track("drums", "drums", "drums")) as { reason: string };
  assert.match(drums.reason, /orchestral percussion only/);
});

test("there is no default: an empty map serves nothing and says so", () => {
  const resolved = resolveSfizzInstrument({ entries: [] }, track("ensemble", "piano", "keys"));
  assert.equal(resolved.served, false);
  assert.match((resolved as { reason: string }).reason, /served families: none/);
});

test("routing: sfizz alone serves a keys track and refuses a drums track with the reason", () => {
  const keys = decideNativeRoute({ track: track("ensemble", "piano", "keys"), pedalboardConfigured: false, pedalboardFamilies: [], sfizz: healthySfizz });
  assert.deepEqual(keys.candidates, [{ renderer: "SFIZZ_VSCO2_CE", sfz: "UprightPiano.sfz", instrument: "VSCO 2 CE Upright Piano", matchedBy: { family: "keys" } }]);
  assert.equal(keys.reason, null);
  const drums = decideNativeRoute({ track: track("drums", "drums", "drums"), pedalboardConfigured: false, pedalboardFamilies: [], sfizz: healthySfizz });
  assert.deepEqual(drums.candidates, []);
  assert.match(drums.reason ?? "", /No PEDALBOARD_VST3 worker is configured\. SFIZZ_VSCO2_CE has no approved instrument for family 'drums'/);
});

test("routing: pedalboard keeps first place for a family it lists; sfizz follows as the second attested candidate", () => {
  const decision = decideNativeRoute({
    track: track("bass", "bass", "strings"),
    pedalboardConfigured: true,
    pedalboardFamilies: ["keys", "strings", "brass", "drums", "guitar", "voice", "synth"],
    sfizz: healthySfizz,
  });
  assert.deepEqual(decision.candidates.map((candidate) => candidate.renderer), ["PEDALBOARD_VST3", "SFIZZ_VSCO2_CE"]);
  assert.equal(decision.reason, null);
  assert.deepEqual(decision.skipped, []);
});

test("routing: a renderer that is not a candidate keeps its reason even when another renderer is", () => {
  // Pedalboard lists every family, sfizz does not serve drums: pedalboard is the
  // only candidate, and if it fails the stem must still say why sfizz never applied.
  const decision = decideNativeRoute({
    track: track("drums", "drums", "drums"),
    pedalboardConfigured: true,
    pedalboardFamilies: ["keys", "strings", "brass", "drums", "guitar", "voice", "synth"],
    sfizz: healthySfizz,
  });
  assert.deepEqual(decision.candidates.map((candidate) => candidate.renderer), ["PEDALBOARD_VST3"]);
  assert.equal(decision.reason, null);
  assert.equal(decision.skipped.length, 1);
  assert.match(decision.skipped[0], /SFIZZ_VSCO2_CE has no approved instrument for family 'drums'/);
});

test("routing: an unconfigured or unhealthy sfizz worker is a reason, not a candidate", () => {
  const unconfigured = decideNativeRoute({ track: track("ensemble", "piano", "keys"), pedalboardConfigured: false, pedalboardFamilies: [], sfizz: { configured: false } });
  assert.deepEqual(unconfigured.candidates, []);
  assert.match(unconfigured.reason ?? "", /SFIZZ_VSCO2_CE is not configured/);
  const unhealthy = decideNativeRoute({
    track: track("ensemble", "piano", "keys"), pedalboardConfigured: false, pedalboardFamilies: [],
    sfizz: { configured: true, healthy: false, reason: "SFIZZ_VSCO2_CE health returned HTTP 503" },
  });
  assert.deepEqual(unhealthy.candidates, []);
  assert.match(unhealthy.reason ?? "", /not healthy: SFIZZ_VSCO2_CE health returned HTTP 503/);
  const noMap = decideNativeRoute({ track: track("ensemble", "piano", "keys"), pedalboardConfigured: false, pedalboardFamilies: [], sfizz: { configured: true, healthy: true, map: null } });
  assert.deepEqual(noMap.candidates, []);
  assert.match(noMap.reason ?? "", /published no instrument map/);
});

test("routing: with pedalboard configured but not listing the family, the reason names both workers", () => {
  const decision = decideNativeRoute({ track: track("drums", "drums", "drums"), pedalboardConfigured: true, pedalboardFamilies: ["keys"], sfizz: healthySfizz });
  assert.deepEqual(decision.candidates, []);
  assert.match(decision.reason ?? "", /PEDALBOARD_VST3 worker does not list family 'drums'/);
  assert.match(decision.reason ?? "", /SFIZZ_VSCO2_CE has no approved instrument for family 'drums'/);
});
