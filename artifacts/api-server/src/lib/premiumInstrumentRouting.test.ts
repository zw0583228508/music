import assert from "node:assert/strict";
import test from "node:test";
import {
  loadPremiumRoutingTable,
  parsePremiumRoutingTable,
  routePremiumInstrument,
} from "./premiumInstrumentRouting";

const attested = ["retrologue-2.4.0", "groove-agent-se-5.2.20", "padshop-2.2.0"];
const table = parsePremiumRoutingTable({
  default: "retrologue-2.4.0",
  byFamily: { drums: "groove-agent-se-5.2.20", strings: "padshop-2.2.0" },
  byRole: { PAD: "padshop-2.2.0" },
  byInstrument: { "Lead Synth": "retrologue-2.4.0" },
});

test("the most specific rule wins: instrument > role > family > default", () => {
  assert.equal(routePremiumInstrument({ instrument: "drums", role: "GROOVE", family: "drums" }, table, attested).assetId, "groove-agent-se-5.2.20");
  assert.equal(routePremiumInstrument({ instrument: "strings", role: "PAD", family: "strings" }, table, attested).assetId, "padshop-2.2.0");
  assert.equal(routePremiumInstrument({ instrument: "lead synth", role: "LEAD", family: "synth" }, table, attested).assetId, "retrologue-2.4.0");
  const fallback = routePremiumInstrument({ instrument: "bass", role: "BASS", family: "strings" }, table, attested);
  assert.equal(fallback.assetId, "padshop-2.2.0", "family rule applies before default");
  const dflt = routePremiumInstrument({ instrument: "keys", role: "HARMONIC_BED", family: "keys" }, table, attested);
  assert.equal(dflt.assetId, "retrologue-2.4.0");
  assert.match(dflt.reason, /default/);
});

test("matching is case-insensitive on names, never on asset ids", () => {
  const route = routePremiumInstrument({ instrument: "DRUMS", role: "groove", family: "Drums" }, table, attested);
  assert.equal(route.assetId, "groove-agent-se-5.2.20");
});

test("a rule that names an unattested asset refuses instead of substituting", () => {
  // The operator asked for HALion by name; the worker has not attested it.
  // Silently routing to the default would render with the wrong instrument.
  const strict = parsePremiumRoutingTable({ default: "retrologue-2.4.0", byFamily: { keys: "halion-sonic-7.1.40.846" } });
  const route = routePremiumInstrument({ instrument: "piano", role: "HARMONIC_BED", family: "keys" }, strict, attested);
  assert.equal(route.assetId, null);
  assert.match(route.reason, /halion-sonic-7\.1\.40\.846, which the renderer has not attested/);
});

test("no matching rule and no default is an explicit refusal", () => {
  const sparse = parsePremiumRoutingTable({ byFamily: { drums: "groove-agent-se-5.2.20" } });
  const route = routePremiumInstrument({ instrument: "keys", role: "PAD", family: "keys" }, sparse, attested);
  assert.equal(route.assetId, null);
  assert.match(route.reason, /no routing rule matches/);
});

test("the table is validated, and absent configuration means no routing", () => {
  assert.throws(() => parsePremiumRoutingTable([]), /JSON object/);
  assert.throws(() => parsePremiumRoutingTable({ default: 3 }), /default must be/);
  assert.throws(() => parsePremiumRoutingTable({ byFamily: { drums: 1 } }), /byFamily must map/);
  assert.equal(loadPremiumRoutingTable({}), null);
  const loaded = loadPremiumRoutingTable({ PREMIUM_INSTRUMENT_ROUTING: '{"default":"retrologue-2.4.0"}' });
  assert.deepEqual(loaded, { default: "retrologue-2.4.0" });
});
