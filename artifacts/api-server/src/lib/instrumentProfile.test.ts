import assert from "node:assert/strict";
import test from "node:test";
import type { InstrumentArrangementRole } from "@workspace/db";
import { getInstrumentDefinition, getInstrumentPerformanceCapability } from "./musicEngines";
import { gmReference } from "./instrumentReference";
import {
  INSTRUMENT_PROFILES,
  definitionFromProfile,
  getInstrumentProfile,
  instrumentDefinitionFor,
  isUnknownInstrumentDefinition,
  listInstrumentProfiles,
  resolveInstrumentProfile,
  roleRegisterFor,
  roleSuitabilityFor,
  shouldRest,
} from "./instrumentProfile";

const ROLES: InstrumentArrangementRole[] = [
  "LEAD", "FOUNDATION", "BASS", "GROOVE", "RHYTHMIC_HARMONY", "HARMONIC_BED", "OSTINATO",
  "COUNTER_MELODY", "CALL_RESPONSE", "ACCENT", "PAD", "FILL", "TRANSITION", "CLIMAX_LAYER",
];

test("every profile is internally consistent and every number carries a source", () => {
  const profiles = listInstrumentProfiles();
  assert.ok(profiles.length >= 30, `${profiles.length} profiles`);
  for (const p of profiles) {
    const [alo, ahi] = p.range.absolute.value;
    const [clo, chi] = p.range.comfortable.value;
    assert.ok(alo < ahi && alo >= 0 && ahi <= 127, `${p.id} absolute ${alo}-${ahi}`);
    assert.ok(clo >= alo && chi <= ahi && clo < chi, `${p.id} comfortable ${clo}-${chi} inside absolute ${alo}-${ahi}`);
    assert.ok(p.range.absolute.note.length >= 5 && p.range.comfortable.note.length >= 5, `${p.id} range notes`);
    for (const reg of p.registers) {
      assert.ok(reg.range[0] >= alo - 0 && reg.range[1] <= ahi, `${p.id} register ${reg.name} ${reg.range} inside ${alo}-${ahi}`);
      assert.ok(reg.character.length > 3);
    }
    for (const role of ROLES) {
      const rr = p.roleRegisters[role];
      if (!rr) continue;
      assert.ok(rr.value[0] >= alo && rr.value[1] <= ahi && rr.value[0] < rr.value[1], `${p.id} ${role} register ${rr.value} inside ${alo}-${ahi}`);
      assert.ok(rr.note.length >= 3, `${p.id} ${role} note`);
      const suit = p.roleSuitability[role] ?? 0;
      assert.ok(suit > 0 && suit <= 1, `${p.id} ${role} has a register so it must have a suitability`);
    }
    assert.ok(p.polyphony.value.maxVoices >= 1 && p.polyphony.note.length > 3, `${p.id} polyphony`);
    assert.ok(p.leap.value.std >= 1 && p.leap.value.ext >= p.leap.value.std, `${p.id} leap`);
    assert.ok(p.gestures.length >= 3, `${p.id} gestures`);
    for (const g of p.gestures) {
      assert.ok(g.roles.length >= 1 && g.voices[0] >= 1 && g.voices[1] >= g.voices[0], `${p.id} gesture ${g.id}`);
      assert.ok(g.voices[1] <= p.polyphony.value.maxVoices, `${p.id} gesture ${g.id} uses ${g.voices[1]} voices of ${p.polyphony.value.maxVoices}`);
    }
    assert.ok(p.densityTolerance.value > 0 && p.densityTolerance.value <= 1);
    assert.ok(p.registerFlexibility.value >= 0 && p.registerFlexibility.value <= 1);
    assert.ok(p.aliases.length >= 1);
    // Values taken from the GM table are the GM table's values, not retyped.
    if (p.gmProgram !== null && p.range.absolute.source === "gm-reference-table") {
      const gm = gmReference(p.gmProgram);
      assert.ok(gm?.range, `${p.id} GM ${p.gmProgram}`);
      assert.deepEqual(p.range.absolute.value, gm!.range!.std, `${p.id} reuses GM_REFERENCE[${p.gmProgram}].range.std`);
    }
    if (p.leap.source === "gm-reference-table" && p.gmProgram !== null) {
      const gm = gmReference(p.gmProgram)!;
      assert.deepEqual(p.leap.value, { std: gm.leap.std, ext: gm.leap.ext });
    }
  }
  const ids = profiles.map((p) => p.id);
  assert.equal(new Set(ids).size, ids.length, "ids are unique");
  const aliases = profiles.flatMap((p) => p.aliases.map((a) => a.toLowerCase()));
  assert.equal(new Set(aliases).size, aliases.length, `aliases are unique: ${aliases.filter((a, i) => aliases.indexOf(a) !== i).join(", ")}`);
});

test("names that used to be a silent piano resolve to real profiles, each saying how it matched", () => {
  const cases: Array<[string, string, string]> = [
    ["WOODWINDS", "woodwind_section", "alias"],
    ["winds", "woodwind_section", "alias"],
    ["flute", "flute", "exact"],
    ["Oboe", "oboe", "exact"],
    ["horn", "french_horn", "alias"],
    ["horns", "brass_section", "alias"],
    ["ensemble", "string_section", "alias"],
    ["mix", "piano", "alias"],
    ["percussion", "hand_percussion", "alias"],
    ["Library darbuka", "hand_percussion", "name-word"],
    ["vocals", "solo_voice", "alias"],
    ["Lead Vocal", "solo_voice", "alias"],
    ["viola", "viola_section", "alias"],
    ["cello", "cello_solo", "alias"],
    ["cellos", "cello_section", "alias"],
    ["Violins", "violin_section", "alias"],
    ["violin", "violin_solo", "alias"],
    ["double bass", "double_bass_section", "alias"],
    ["upright bass", "acoustic_bass", "alias"],
    ["808", "synth_bass", "alias"],
    ["Electric Bass", "electric_bass", "exact"],
    ["Warm Pad", "synth_pad", "alias"],
    ["lead synth", "synth_lead", "alias"],
    ["Poly Synth", "synth_pad", "alias"],
    ["acoustic guitar", "acoustic_guitar", "exact"],
    ["Guitar", "electric_guitar", "alias"],
    ["Rhodes", "electric_piano", "alias"],
    ["hammond", "organ", "alias"],
    ["harp", "harp", "exact"],
    ["tuba", "tuba", "exact"],
    ["Drum Kit", "drum_kit", "exact"],
    ["keys", "piano", "alias"],
  ];
  for (const [name, profileId, matchedBy] of cases) {
    const r = resolveInstrumentProfile(name);
    assert.equal(r.status, "resolved", `${name} resolves`);
    assert.equal(r.status === "resolved" && r.profileId, profileId, `${name} -> ${profileId}`);
    assert.equal(r.matchedBy, matchedBy, `${name} matched by ${matchedBy}`);
  }
  // Labelled aliases carry their note: 'mix' is not an instrument.
  const mix = resolveInstrumentProfile("mix");
  assert.ok(mix.status === "resolved" && /full-mix stem hint/.test(mix.note ?? ""));
  const strings = resolveInstrumentProfile("strings");
  assert.ok(strings.status === "resolved" && strings.profileId === "violin_section" && /one track per desk/.test(strings.note ?? ""));
  // The role decides only when the name names nothing (the PR-61 rule).
  const kitByRole = resolveInstrumentProfile("track 3", "RHYTHMIC_HARMONY");
  assert.ok(kitByRole.status === "resolved" && kitByRole.profileId === "drum_kit" && kitByRole.matchedBy === "role");
  const guitarByName = resolveInstrumentProfile("rhythm guitar", "RHYTHMIC_HARMONY");
  assert.ok(guitarByName.status === "resolved" && guitarByName.profileId === "electric_guitar", "a guitar in a rhythm role stays a guitar");
});

test("an unknown name is an explicit UNKNOWN definition, never a piano", () => {
  for (const name of ["anything", "zither", "fx", "", "theremin"]) {
    const r = resolveInstrumentProfile(name, "HARMONIC_BED");
    assert.equal(r.status, "unknown", `${JSON.stringify(name)} is unknown`);
    assert.ok(r.status === "unknown" && r.nearest.length > 0 && /must resolve it/.test(r.reason));
    const def = getInstrumentDefinition(name, "HARMONIC_BED");
    assert.equal(def.id, "unknown");
    assert.equal(def.family, "unknown");
    assert.equal(def.profile?.status, "unknown");
    assert.ok(isUnknownInstrumentDefinition(def));
    assert.deepEqual(def.playableRange, { min: 0, max: 127 }, "no range is invented");
    // Unknown routes to no native renderer: an export falls back with the reason.
    assert.deepEqual(getInstrumentPerformanceCapability(def).nativeRenderers, []);
  }
  assert.ok(!isUnknownInstrumentDefinition(getInstrumentDefinition("piano")));
});

test("getInstrumentDefinition keeps its contract for the legacy names and gains profile provenance", () => {
  const drums = getInstrumentDefinition("Drums", "rhythm");
  assert.equal(drums.id, "drums"); assert.equal(drums.family, "drums");
  assert.deepEqual(drums.playableRange, { min: 35, max: 81 });
  assert.equal(drums.maxVoices, 4);
  assert.deepEqual(drums.registers.slice(0, 3).map((r) => r.name), ["low", "middle", "high"], "the legacy engine addresses registers by name");
  assert.deepEqual(drums.registers.find((r) => r.name === "high")!.min, 66, "the legacy high third of 35–81 is unchanged");
  const bass = getInstrumentDefinition("bass", "BASS");
  assert.equal(bass.id, "bass"); assert.equal(bass.family, "strings");
  assert.equal(bass.maxVoices, 1); assert.equal(bass.constraints.maxLeap, 12);
  assert.deepEqual(bass.playableRange, { min: 28, max: 67 });
  const strings = getInstrumentDefinition("strings", "HARMONIC_BED");
  assert.equal(strings.id, "strings"); assert.equal(strings.family, "strings");
  assert.equal(strings.profile?.id, "violin_section");
  assert.equal(strings.constraints.maxLeap, gmReference(40)!.leap.std, "the leap rule is the calibrated GM one, not the pre-B-03 10");
  const cello = getInstrumentDefinition("cello", "COUNTER_MELODY");
  assert.equal(cello.id, "cello"); assert.equal(cello.maxVoices, 2);
  const piano = getInstrumentDefinition("keys", "HARMONIC_BED");
  assert.equal(piano.id, "piano"); assert.equal(piano.maxVoices, 10); assert.equal(piano.constraints.hands, 2);
  assert.equal(piano.controls.sustain, 64);
  assert.ok(piano.directiveMappings?.registers?.middle && piano.directiveMappings.controls?.dynamics === 1);
  const pad = getInstrumentDefinition("Synth Pad", "PAD");
  assert.equal(pad.id, "synth_pad"); assert.equal(pad.family, "synth");
  const flute = getInstrumentDefinition("flute", "LEAD");
  assert.equal(flute.family, "winds"); assert.equal(flute.constraints.breathSeconds, 10);
  assert.ok(getInstrumentPerformanceCapability(flute).nativeRenderers.length > 0, "winds have a native capability row");
  const guitar = getInstrumentDefinition("Guitar", "harmony");
  assert.equal(guitar.id, "guitar"); assert.equal(guitar.constraints.strings, 6); assert.equal(guitar.constraints.frets, 22);
  // The adapter and the module agree.
  assert.deepEqual(getInstrumentDefinition("Violins", "PAD"), instrumentDefinitionFor("Violins", "PAD"));
  const viaProfile = definitionFromProfile(INSTRUMENT_PROFILES.violin_section, resolveInstrumentProfile("Violins", "PAD"));
  assert.equal(viaProfile.profile?.id, "violin_section");
});

test("role registers and suitability: strings sit in the middle register for a bed, the E string is for lines and climaxes", () => {
  const violins = getInstrumentProfile("violin_section")!;
  assert.deepEqual([roleRegisterFor(violins, "HARMONIC_BED").lo, roleRegisterFor(violins, "HARMONIC_BED").hi], [60, 79]);
  assert.ok(roleRegisterFor(violins, "CLIMAX_LAYER").hi > 84);
  const cellos = getInstrumentProfile("cello_section")!;
  assert.deepEqual([roleRegisterFor(cellos, "HARMONIC_BED").lo, roleRegisterFor(cellos, "HARMONIC_BED").hi], [48, 64]);
  const piano = getInstrumentProfile("piano")!;
  assert.deepEqual([roleRegisterFor(piano, "HARMONIC_BED").lo, roleRegisterFor(piano, "HARMONIC_BED").hi], [48, 67]);
  // A role the profile has no register for falls back to the comfortable range and says so.
  const bassGroove = roleRegisterFor(getInstrumentProfile("tuba")!, "GROOVE");
  assert.equal(bassGroove.fromRole, false);
  assert.match(bassGroove.note, /no GROOVE register/);
  assert.equal(roleSuitabilityFor(getInstrumentProfile("synth_pad")!, "PAD"), 1);
  assert.equal(roleSuitabilityFor(getInstrumentProfile("synth_pad")!, "BASS"), 0);
  assert.ok(roleSuitabilityFor(getInstrumentProfile("french_horn")!, "PAD") > roleSuitabilityFor(getInstrumentProfile("trumpet")!, "PAD"), "a horn pads better than a trumpet");
  assert.ok(roleSuitabilityFor(getInstrumentProfile("cello_section")!, "COUNTER_MELODY") >= 0.9, "cellos carry a counter-line");
});

test("shouldRest applies an arranger's conventions and names them; the same input at energy says play", () => {
  const brass = getInstrumentProfile("brass_section")!;
  const quiet = shouldRest({ profile: brass, role: "PAD", window: { sectionFunction: "verse", energy: 0.3 } });
  assert.equal(quiet.rest, true); assert.equal(quiet.convention, "brass_tacet_in_intimate");
  const loud = shouldRest({ profile: brass, role: "PAD", window: { sectionFunction: "chorus", energy: 0.8 } });
  assert.equal(loud.rest, false, "positive control: the same brass plays in a loud chorus");
  const asked = shouldRest({ profile: brass, role: "PAD", window: { sectionFunction: "verse", energy: 0.3 }, arc: { requested: true } });
  assert.equal(asked.rest, false, "the brief overrides a suggestion");

  const kit = getInstrumentProfile("drum_kit")!;
  assert.equal(shouldRest({ profile: kit, role: "GROOVE", window: { sectionFunction: "intro", energy: 0.2 } }).convention, "percussion_rests_in_intro_outro");
  assert.equal(shouldRest({ profile: kit, role: "GROOVE", window: { sectionFunction: "verse", energy: 0.2 } }).rest, false);

  const strings = getInstrumentProfile("string_section")!;
  const soloEntry = shouldRest({ profile: strings, role: "PAD", window: { sectionFunction: "instrumental", energy: 0.6, soloEntry: true, barsIntoSection: 0 } });
  assert.equal(soloEntry.convention, "pad_rests_during_solo_entry");
  const afterEntry = shouldRest({ profile: strings, role: "PAD", window: { sectionFunction: "instrumental", energy: 0.6, soloEntry: true, barsIntoSection: 4 } });
  assert.equal(afterEntry.rest, false);
  const climaxEarly = shouldRest({ profile: strings, role: "CLIMAX_LAYER", window: { sectionFunction: "verse", energy: 0.3 }, arc: { tensionRole: "setup" } });
  assert.equal(climaxEarly.convention, "climax_layer_only_at_arrival");
  const climaxNow = shouldRest({ profile: strings, role: "CLIMAX_LAYER", window: { sectionFunction: "chorus", energy: 0.9, isFinalChorus: true }, arc: { tensionRole: "arrival" } });
  assert.equal(climaxNow.rest, false);
  const notYet = shouldRest({ profile: strings, role: "PAD", window: { sectionFunction: "chorus", energy: 0.8 }, arc: { familyEntryBar: 41, windowStartBar: 33 } });
  assert.equal(notYet.convention, "family_entry_plan");
  const never = shouldRest({ profile: strings, role: "PAD", window: { sectionFunction: "chorus", energy: 0.8 }, arc: { familyEntryBar: null } });
  assert.equal(never.rest, true);
  const soloTexture = shouldRest({ profile: strings, role: "PAD", window: { sectionFunction: "verse", energy: 0.5 }, arc: { textureLevel: "solo" } });
  assert.equal(soloTexture.convention, "texture_level");
  const pianoSolo = shouldRest({ profile: getInstrumentProfile("piano")!, role: "HARMONIC_BED", window: { sectionFunction: "verse", energy: 0.5 }, arc: { textureLevel: "solo" } });
  assert.equal(pianoSolo.rest, false, "a solo texture is the piano itself");
  const unsuited = shouldRest({ profile: getInstrumentProfile("synth_pad")!, role: "BASS", window: { sectionFunction: "chorus", energy: 0.8 } });
  assert.equal(unsuited.convention, "role_unsuited");
  // Deterministic.
  assert.deepEqual(quiet, shouldRest({ profile: brass, role: "PAD", window: { sectionFunction: "verse", energy: 0.3 } }));
});
