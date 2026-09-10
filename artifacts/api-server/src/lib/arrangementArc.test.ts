import assert from "node:assert/strict";
import test from "node:test";
import type { ArrangementArc, ArrangementSectionFunction } from "@workspace/db";
import {
  ARRANGEMENT_ARC_VERSION,
  arcDensity,
  arrangementArcInputsDigest,
  canonicalFamily,
  deriveArrangementArc,
  DYNAMIC_LEVEL,
  isArrangementArcStale,
  isNonFamilyHint,
  templateForStyle,
  textureFamilyCount,
  type ArrangementArcInput,
} from "./arrangementArc";

const NOW = new Date("2026-01-01T00:00:00.000Z");

type Sec = [string, ArrangementSectionFunction, number];

/** Verse / Chorus / Verse 2 / Chorus 2 / Bridge / Chorus 3 / Outro, 8 bars each, like a pop ballad. */
function sections(spec: Sec[] = [
  ["Intro", "intro", 4], ["Verse 1", "verse", 16], ["Chorus", "chorus", 8], ["Verse 2", "verse", 16],
  ["Chorus 2", "chorus", 8], ["Bridge", "bridge", 8], ["Chorus 3", "chorus", 8], ["Outro", "outro", 8],
]): ArrangementArcInput["sections"] {
  let bar = 1;
  return spec.map(([name, fn, bars]) => {
    const s = { name, startBar: bar, endBar: bar + bars - 1, function: fn };
    bar += bars;
    return s;
  });
}

function input(over: Partial<ArrangementArcInput> = {}): ArrangementArcInput {
  return {
    sections: sections(),
    paletteFamilies: ["drums", "percussion", "bass", "keys", "strings"],
    style: "unknown",
    productionAesthetic: "intimate",
    vocalStatus: "not_available",
    ...over,
  };
}

const section = (arc: ArrangementArc, name: string) => arc.sections.find((s) => s.sectionName === name)!;

test("the arc is deterministic, versioned and digest-tracked; staleness follows the inputs", () => {
  const a = deriveArrangementArc(input(), { now: NOW });
  const b = deriveArrangementArc(input(), { now: NOW });
  assert.equal(a.version, ARRANGEMENT_ARC_VERSION);
  assert.equal(a.status, "available");
  assert.deepEqual(a, b);
  assert.equal(a.inputsDigestSha256, arrangementArcInputsDigest(input()));
  assert.equal(isArrangementArcStale(input(), a), false);
  assert.equal(isArrangementArcStale(input({ paletteFamilies: ["drums", "bass"] }), a), true);
  // Hints enter the digest only when present, so a hint-less arc keeps its digest.
  assert.equal(arrangementArcInputsDigest(input({ hints: {} })), arrangementArcInputsDigest(input()));
  assert.notEqual(arrangementArcInputsDigest(input({ hints: { globalDynamicSteps: 1 } })), arrangementArcInputsDigest(input()));
});

test("UNKNOWN is a valid answer: no sections, or no palette families", () => {
  const none = deriveArrangementArc(input({ sections: [] }), { now: NOW });
  assert.equal(none.status, "unknown");
  assert.match(none.reason ?? "", /no sections/);
  assert.equal(none.sections.length, 0);
  assert.equal(none.primaryClimax, null);
  const noFamilies = deriveArrangementArc(input({ paletteFamilies: ["mix", "vocals", "fx"] }), { now: NOW });
  assert.equal(noFamilies.status, "unknown");
  assert.match(noFamilies.reason ?? "", /no palette families/);
});

test("every value says where it came from, and a source measurement is never the intent", () => {
  const arc = deriveArrangementArc(input(), { now: NOW });
  for (const s of arc.sections) {
    for (const decision of [s.intendedDynamic, s.textureLevel, s.tensionRole, s.developmentOperator]) {
      assert.ok(["brief", "template", "source_prior", "default"].includes(decision.source), `${s.sectionName}: source`);
      assert.ok(decision.reason.length > 0, `${s.sectionName}: reason`);
    }
    assert.ok(s.intendedDynamic.value.level >= 0 && s.intendedDynamic.value.level <= 1);
    // Without a source curve nothing is a prior.
    assert.notEqual(s.intendedDynamic.source, "source_prior");
    assert.equal(s.sourceEnergy, null);
    assert.equal(s.sourceContrast, "unknown");
  }
});

test("with no brief and no style, an intimate palette gets the ballad template and a defensible arc", () => {
  const arc = deriveArrangementArc(input(), { now: NOW });
  assert.equal(arc.template?.id, "intimate_ballad");
  assert.equal(arc.template?.source, "template", "the aesthetic implied it");
  // Verse quiet and thin, chorus louder and fuller, bridge lifts, outro afterglow, final chorus the climax.
  const verse = section(arc, "Verse 1");
  const chorus = section(arc, "Chorus");
  const bridge = section(arc, "Bridge");
  const outro = section(arc, "Outro");
  const last = section(arc, "Chorus 3");
  assert.equal(verse.intendedDynamic.value.marking, "p");
  assert.equal(verse.textureLevel.value, "bed");
  assert.equal(verse.tensionRole.value, "setup");
  assert.equal(chorus.intendedDynamic.value.marking, "mf");
  assert.ok(chorus.activeFamilies.length > verse.activeFamilies.length, "the chorus is fuller than the verse");
  assert.equal(chorus.tensionRole.value, "arrival");
  assert.equal(bridge.tensionRole.value, "lift");
  assert.equal(outro.tensionRole.value, "afterglow");
  assert.ok(last.isPrimaryClimax);
  assert.equal(arc.primaryClimax?.sectionName, "Chorus 3");
  assert.equal(arc.primaryClimax?.source, "template");
  assert.equal(last.intendedDynamic.value.marking, "f", "the ballad climax is f");
  assert.equal(last.textureLevel.value, "tutti");
  assert.equal(arc.secondaryClimax?.sectionName, "Chorus 2");
  // The ballad's family order: the piano is the core, the kit is last in.
  assert.deepEqual(arc.familyOrder, ["keys", "bass", "strings", "percussion", "drums"]);
  assert.deepEqual(verse.activeFamilies, ["keys", "bass", "strings"]);
});

test("templates follow the style first; the aesthetic settles only an unknown style or a pop ballad", () => {
  assert.equal(templateForStyle("pop", "raw_band"), "pop_build");
  assert.equal(templateForStyle("pop", "intimate"), "intimate_ballad");
  assert.equal(templateForStyle("pop", null, "pop_ballad"), "intimate_ballad");
  assert.equal(templateForStyle("rock", "polished_pop"), "band_steady");
  assert.equal(templateForStyle("dance", null), "electronic_drop");
  assert.equal(templateForStyle("orchestral", null), "cinematic_swell");
  assert.equal(templateForStyle("unknown", "cinematic"), "cinematic_swell");
  assert.equal(templateForStyle("unknown", null), "pop_build");
  const pop = deriveArrangementArc(input({ style: "pop", productionAesthetic: "polished_pop" }), { now: NOW });
  assert.equal(pop.template?.id, "pop_build");
  assert.equal(section(pop, "Chorus").intendedDynamic.value.marking, "f");
  assert.equal(section(pop, "Chorus 3").intendedDynamic.value.marking, "ff");
});

test("the brief's levers are honoured as stated: markings, steps, textures, climax, template, family priority", () => {
  const arc = deriveArrangementArc(input({
    style: "pop",
    productionAesthetic: "polished_pop",
    hints: {
      arcTemplate: "intimate_ballad",
      sectionDynamics: { Bridge: "ff" },
      sectionDynamicSteps: { "Verse 2": 1 },
      globalDynamicSteps: -1,
      textureLevels: { Outro: "solo" },
      textureSteps: { "Verse 1": 1 },
      climaxSectionName: "Chorus 2",
      familyPriority: ["strings", "percussion"],
    },
  }), { now: NOW });
  assert.equal(arc.template?.id, "intimate_ballad");
  assert.equal(arc.template?.source, "brief");
  assert.equal(section(arc, "Bridge").intendedDynamic.value.marking, "ff");
  assert.equal(section(arc, "Bridge").intendedDynamic.source, "brief");
  // Verse 1: p (template) - 1 (global) = pp; Verse 2: p - 1 + 1 = p.
  assert.equal(section(arc, "Verse 1").intendedDynamic.value.marking, "pp");
  assert.equal(section(arc, "Verse 2").intendedDynamic.value.marking, "p");
  assert.equal(section(arc, "Outro").textureLevel.value, "solo");
  assert.equal(section(arc, "Outro").activeFamilies.length, 1);
  assert.equal(section(arc, "Verse 1").textureLevel.value, "full", "bed + 1 step");
  assert.equal(arc.primaryClimax?.sectionName, "Chorus 2");
  assert.equal(arc.primaryClimax?.source, "brief");
  assert.ok(section(arc, "Chorus 2").isPrimaryClimax);
  // A later chorus stays under the named climax.
  const climaxLevel = DYNAMIC_LEVEL[section(arc, "Chorus 2").intendedDynamic.value.marking];
  assert.ok(DYNAMIC_LEVEL[section(arc, "Chorus 3").intendedDynamic.value.marking] < climaxLevel);
  // The brief's families come first, in the template's order among themselves.
  assert.deepEqual(arc.familyOrder.slice(0, 2), ["strings", "percussion"]);
});

test("the source recording is a weak prior only: a 10x louder chorus moves the level by at most 0.05", () => {
  const quiet = deriveArrangementArc(input({ sourceEnergy: [0.01, 0.1, 0.05, 0.1, 0.06, 0.1, 0.05, 0.05] }), { now: NOW });
  const loud = deriveArrangementArc(input({ sourceEnergy: [0.01, 0.1, 0.5, 0.1, 0.6, 0.1, 0.5, 0.05] }), { now: NOW });
  for (const name of ["Chorus", "Chorus 2", "Chorus 3"]) {
    const a = section(quiet, name);
    const b = section(loud, name);
    assert.equal(a.intendedDynamic.value.marking, b.intendedDynamic.value.marking, `${name}: the marking is the decision`);
    assert.ok(Math.abs(a.intendedDynamic.value.level - b.intendedDynamic.value.level) <= 0.1 + 1e-9, `${name}: within the prior's reach`);
    assert.deepEqual(a.activeFamilies, b.activeFamilies, `${name}: the texture does not follow the RMS`);
  }
  // The deprecated multiplier acts on the prior only.
  const biased = deriveArrangementArc(input({
    sourceEnergy: [0.01, 0.1, 0.5, 0.1, 0.6, 0.1, 0.5, 0.05],
    hints: { sectionEnergyBias: { Chorus: 1.4 } },
  }), { now: NOW });
  assert.equal(section(biased, "Chorus").intendedDynamic.value.marking, section(loud, "Chorus").intendedDynamic.value.marking);
  assert.ok(Math.abs(section(biased, "Chorus").intendedDynamic.value.level - section(loud, "Chorus").intendedDynamic.value.level) <= 0.1 + 1e-9);
});

test("a section where the singer is quieter than its neighbours leaves space", () => {
  // Verse 2 sits between two loud choruses and the source is far quieter there.
  const arc = deriveArrangementArc(input({ sourceEnergy: [0.05, 0.3, 0.6, 0.1, 0.7, 0.4, 0.6, 0.2] }), { now: NOW });
  const verse2 = section(arc, "Verse 2");
  assert.equal(verse2.sourceContrast, "quieter_than_neighbours");
  assert.equal(verse2.intendedDynamic.source, "source_prior");
  assert.match(verse2.intendedDynamic.reason, /source prior/);
  // The repeat does not pile a layer on where the singer holds back.
  assert.notEqual(verse2.developmentOperator.value, "add_layer");
  assert.ok(verse2.activeFamilies.length <= section(arc, "Verse 1").activeFamilies.length);
});

test("form memory: repeats state something new, operators are not reused, identity is explicit", () => {
  const arc = deriveArrangementArc(input(), { now: NOW });
  const [c1, c2, c3] = ["Chorus", "Chorus 2", "Chorus 3"].map((n) => section(arc, n));
  assert.deepEqual([c1.occurrenceIndex, c2.occurrenceIndex, c3.occurrenceIndex], [0, 1, 2]);
  assert.equal(c1.occurrenceCount, 3);
  assert.equal(c1.developmentOperator.value, "identity");
  assert.match(c1.developmentOperator.reason, /first statement/);
  assert.equal(c1.previousOccurrenceSummary, null);
  assert.notEqual(c2.developmentOperator.value, "identity");
  assert.equal(c2.previousOccurrenceSummary?.sectionName, "Chorus");
  assert.deepEqual(c2.previousOccurrenceSummary?.families, c1.activeFamilies);
  assert.equal(c2.previousOccurrenceSummary?.dynamicMarking, c1.intendedDynamic.value.marking);
  assert.notEqual(c3.developmentOperator.value, c2.developmentOperator.value, "an operator is not spent twice");
  // Chorus 2 differs from chorus 1 in the operator's own dimension.
  if (c2.developmentOperator.value === "add_layer") {
    assert.ok(c2.activeFamilies.length > c1.activeFamilies.length);
    assert.ok(c2.familyEntries.some((e) => /add_layer/.test(e.reason)));
  }
  if (c3.developmentOperator.value === "raise_register") assert.equal(c3.registerBandShift, 1);

  // A palette with nothing to add and nothing to raise: identity is the honest answer.
  const trio = deriveArrangementArc(input({ paletteFamilies: ["drums", "bass"], sections: sections([
    ["Chorus", "chorus", 8], ["Chorus 2", "chorus", 8], ["Chorus 3", "chorus", 8], ["Chorus 4", "chorus", 8],
  ]) }), { now: NOW });
  const ops = trio.sections.map((s) => s.developmentOperator.value);
  assert.equal(ops[0], "identity");
  assert.ok(ops.slice(1).includes("identity"), `ran out of applicable operators: ${ops.join(",")}`);
  const identityRepeat = trio.sections.slice(1).find((s) => s.developmentOperator.value === "identity")!;
  assert.match(identityRepeat.developmentOperator.reason, /already used/);
});

test("entries and exits are bar offsets inside sections, not just section bounds", () => {
  // An 8-bar intro is a real intro (a duo), so the first verse has a colour family to bring in.
  const arc = deriveArrangementArc(input({
    paletteFamilies: ["drums", "percussion", "bass", "keys", "strings", "pads"],
    sections: sections([
      ["Intro", "intro", 8], ["Verse 1", "verse", 16], ["Chorus", "chorus", 8], ["Verse 2", "verse", 16],
      ["Chorus 2", "chorus", 8], ["Bridge", "bridge", 8], ["Chorus 3", "chorus", 8], ["Outro", "outro", 8],
    ]),
  }), { now: NOW });
  const intro = section(arc, "Intro");
  assert.equal(intro.textureLevel.value, "duo");
  // A short intro is a pickup and states the verse's texture instead.
  const pickup = deriveArrangementArc(input(), { now: NOW });
  assert.equal(section(pickup, "Intro").textureLevel.value, "bed");
  assert.match(section(pickup, "Intro").textureLevel.reason, /pickup/);
  const verse1 = section(arc, "Verse 1");
  const bridge = section(arc, "Bridge");
  const last = section(arc, "Chorus 3");
  const outro = section(arc, "Outro");
  // The song opens with everything the intro has.
  assert.ok(intro.familyEntries.length >= 1 && intro.familyEntries.every((e) => e.barOffset === 0));
  // The first verse opens with the core; a colour family joins at its second half.
  const staggered = verse1.familyEntries.filter((e) => e.barOffset > 0);
  assert.ok(staggered.length >= 1, `staggered entries in verse 1: ${JSON.stringify(verse1.familyEntries)}`);
  assert.equal(staggered[0].barOffset, 8);
  // A breath before the final chorus: everyone but the core leaves two bars early.
  const early = bridge.familyExits.filter((e) => e.barOffset === bridge.endBar - bridge.startBar + 1 - 2);
  assert.ok(early.length >= 1, `early exits in the bridge: ${JSON.stringify(bridge.familyExits)}`);
  assert.ok(!early.some((e) => e.family === arc.familyOrder[0]), "the core stays");
  // ...and they come back in at the final chorus.
  assert.ok(last.familyEntries.some((e) => e.barOffset === 0 && early.some((x) => x.family === e.family)));
  // The outro thins to its core and the last section releases everything.
  assert.ok(outro.familyExits.some((e) => e.barOffset > 0 && e.barOffset < outro.endBar - outro.startBar + 1));
  const bars = outro.endBar - outro.startBar + 1;
  for (const family of outro.activeFamilies) {
    assert.ok(outro.familyExits.some((e) => e.family === family && e.barOffset <= bars), `${family} leaves by the end`);
  }
  // A family not carried into the next section leaves at the boundary.
  for (let i = 0; i + 1 < arc.sections.length; i += 1) {
    const here = arc.sections[i];
    const next = new Set(arc.sections[i + 1].activeFamilies);
    for (const family of here.activeFamilies) {
      if (next.has(family)) continue;
      assert.ok(here.familyExits.some((e) => e.family === family), `${here.sectionName}: ${family} exits before ${arc.sections[i + 1].sectionName}`);
    }
  }
});

test("the texture ladder is relative to the palette, and registers rise only where there is room", () => {
  assert.deepEqual(["solo", "duo", "bed", "full", "tutti"].map((l) => textureFamilyCount(l as never, 3)), [1, 2, 2, 3, 3]);
  assert.deepEqual(["solo", "duo", "bed", "full", "tutti"].map((l) => textureFamilyCount(l as never, 5)), [1, 2, 3, 4, 5]);
  assert.deepEqual(["solo", "duo", "bed", "full", "tutti"].map((l) => textureFamilyCount(l as never, 7)), [1, 2, 4, 6, 7]);
  const arc = deriveArrangementArc(input({ paletteFamilies: ["bass", "keys"], sections: sections([
    ["Chorus", "chorus", 8], ["Chorus 2", "chorus", 8],
  ]) }), { now: NOW });
  const repeat = section(arc, "Chorus 2");
  assert.equal(repeat.developmentOperator.value, "raise_register", "nothing to add: the piano goes up");
  assert.equal(repeat.registerBandShift, 1);
  // Density: a ballad at the same level is sparser than pop, and both grow with the texture.
  assert.ok(arcDensity(0.55, "full", "intimate_ballad") < arcDensity(0.55, "full", "pop_build"));
  assert.ok(arcDensity(0.55, "tutti", "pop_build") > arcDensity(0.55, "duo", "pop_build"));
  assert.ok(arcDensity(0.7, "tutti", "intimate_ballad") < 0.6, "a ballad never reaches the subdivision level");
});

test("stem hints that are not families are recognised and canonical names are shared", () => {
  for (const hint of ["mix", "MIX", "vocals", "vocal", "fx", "other"]) assert.equal(isNonFamilyHint(hint), true, hint);
  for (const hint of ["keys", "piano", "strings", "drums", "pads", "synth"]) assert.equal(isNonFamilyHint(hint), false, hint);
  assert.equal(canonicalFamily("piano"), "keys");
  assert.equal(canonicalFamily("pad"), "pads");
  assert.equal(canonicalFamily("clarinet"), "winds");
});
