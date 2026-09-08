import assert from "node:assert/strict";
import test from "node:test";
import type { MusicalNote, SoundCatalogueEntry, StyleProfile } from "@workspace/db";
import {
  SOUND_SELECTION_METHOD,
  deriveSoundTarget,
  resolveTrackAsset,
  selectTrackSound,
  toSoundCatalogue,
} from "./soundSelectionBrain";

const notes = (pitch: number, duration: number, count = 8): MusicalNote[] =>
  Array.from({ length: count }, (_, i) => ({ id: `n${i}`, start: i * 0.5, duration, pitch, velocity: 90 }));

const bass = { trackId: "t-bass", instrument: "Electric Bass", role: "BASS", family: "strings", notes: notes(40, 0.4) };
const pad = { trackId: "t-pad", instrument: "Warm Pad", role: "PAD", family: "synth", notes: notes(60, 2.0) };
const kit = { trackId: "t-kit", instrument: "Drum Kit", role: "GROOVE", family: "drums", notes: notes(36, 0.1, 16) };
const lead = { trackId: "t-lead", instrument: "Flute", role: "LEAD", family: "winds", notes: notes(84, 0.5) };

const catalogue: SoundCatalogueEntry[] = [
  { assetId: "retrologue", name: "Retrologue", manufacturer: "Steinberg", character: ["analog", "warm"] },
  { assetId: "groove-agent", name: "Groove Agent SE", families: ["drums"], roles: ["GROOVE", "FILL"], character: ["acoustic", "kit"] },
  { assetId: "padshop", name: "Padshop", families: ["strings", "synth"], roles: ["PAD", "HARMONIC_BED"], character: ["granular", "pad", "wide"] },
  { assetId: "halion", name: "HALion Sonic", families: ["keys", "guitar", "brass", "winds", "voice"] },
];

const profile = (dimensions: StyleProfile["dimensions"], exclusions: StyleProfile["exclusions"] = []): StyleProfile => ({
  version: "1.0", derivedAt: "1970-01-01T00:00:00.000Z", inputsDigestSha256: "0".repeat(64), method: "test",
  dimensions, exclusions, conflicts: [], sources: [], confidence: 0.7,
});

test("the target comes from family, role and the notes — each field with its provenance", () => {
  const { target, provenance } = deriveSoundTarget(bass);
  assert.equal(target.register, "low");
  assert.equal(target.width, "mono");
  assert.equal(target.brightness, "dark");
  const registerSource = provenance.filter((p) => p.field === "register").at(-1);
  assert.equal(registerSource?.source, "notes", "the notes decide the register last");
  assert.ok(provenance.some((p) => p.field === "width" && p.source === "role" && /BASS/.test(p.detail)));
  // A LEAD written low is a low sound whatever the role says.
  const lowLead = deriveSoundTarget({ ...lead, notes: notes(45, 0.5) });
  assert.equal(lowLead.target.register, "low");
  // Drums have no register; their sustain comes from the family.
  const drums = deriveSoundTarget(kit);
  assert.equal(drums.target.attack, "sharp");
  assert.equal(drums.target.sustain, "short");
  assert.ok(!drums.provenance.some((p) => p.source === "notes" && p.field === "register"));
});

test("the style's sound dimensions override with provenance, and open aesthetic words become target fields", () => {
  const styled = deriveSoundTarget(pad, profile({
    soundAesthetic: { value: "warm vintage cinematic", confidence: 0.8, provenance: "stated" },
    roomSize: { value: "hall", confidence: 0.6, provenance: "inferred" },
    era: { value: "1970s", confidence: 0.5, provenance: "inferred" },
  }));
  assert.equal(styled.target.saturation, "warm");
  assert.equal(styled.target.space, "hall", "an explicit roomSize beats the aesthetic's 'large'");
  assert.equal(styled.target.width, "wide");
  assert.deepEqual(styled.target.character, ["warm", "vintage", "cinematic"]);
  assert.ok(styled.provenance.some((p) => p.field === "space" && p.source === "style" && /roomSize \(inferred\)/.test(p.detail)));
  assert.ok(styled.provenance.some((p) => p.field === "saturation" && /soundAesthetic "warm" \(stated\)/.test(p.detail)));
  // A bass stays mono however wide the aesthetic asks for.
  const wideBass = deriveSoundTarget(bass, profile({ stereoAesthetic: { value: "wide", confidence: 0.9, provenance: "stated" } }));
  assert.equal(wideBass.target.width, "mono");
});

test("selection is deterministic, family-gated, and explains every candidate", () => {
  const drums = selectTrackSound(kit, catalogue);
  assert.equal(drums.selection.assetId, "groove-agent");
  assert.ok(/declared for family drums/.test(drums.selection.reason));
  assert.ok(/declared for role GROOVE/.test(drums.selection.reason));
  assert.deepEqual(drums.selection.rejected.map((r) => r.assetId).sort(), ["halion", "padshop"], "instruments declared for other families are rejected, not scored");
  assert.ok(drums.selection.candidates.some((c) => c.assetId === "retrologue"), "a universal instrument is a candidate for anything");
  assert.equal(drums.method, SOUND_SELECTION_METHOD);
  assert.equal(drums.inputsDigestSha256.length, 64);
  const again = selectTrackSound(kit, [...catalogue].reverse());
  assert.equal(again.selection.assetId, drums.selection.assetId);
  assert.equal(again.inputsDigestSha256, drums.inputsDigestSha256, "catalogue order does not change the decision or its digest");
});

test("a pad goes to the pad instrument, a lead to the multi-timbral one, a bass to the universal analog synth", () => {
  assert.equal(selectTrackSound(pad, catalogue).selection.assetId, "padshop");
  assert.equal(selectTrackSound(lead, catalogue).selection.assetId, "halion");
  const bassPick = selectTrackSound(bass, catalogue);
  assert.equal(bassPick.selection.assetId, "retrologue");
  assert.ok(bassPick.selection.rejected.some((r) => r.assetId === "groove-agent" && /declared for drums, not strings/.test(r.reason)));
});

test("a producer exclusion removes an instrument even when it fits best", () => {
  const noGranular = selectTrackSound(pad, catalogue, profile({}, [{ value: "granular", sourceRefs: [] }]));
  assert.notEqual(noGranular.selection.assetId, "padshop");
  assert.ok(noGranular.selection.rejected.some((r) => r.assetId === "padshop" && /excluded "granular"/.test(r.reason)));
  // "no synths" excludes by family too.
  const noSynth = selectTrackSound(pad, catalogue, profile({}, [{ value: "synth", sourceRefs: [] }]));
  assert.ok(noSynth.selection.rejected.some((r) => r.assetId === "padshop"));
});

test("style character words pull the catalogue: between two otherwise-equal synths the aesthetic decides", () => {
  const twoSynths: SoundCatalogueEntry[] = [
    { assetId: "analog-poly", character: ["analog", "warm"] },
    { assetId: "digital-poly", character: ["digital", "clean"] },
  ];
  const keys = { trackId: "t-keys", instrument: "Poly Synth", role: "RHYTHMIC_HARMONY", family: "synth", notes: notes(64, 0.4) };
  assert.equal(selectTrackSound(keys, twoSynths).selection.assetId, "digital-poly", "no style: the synth family's default is clean, so the clean synth fits");
  const warm = profile({ soundAesthetic: { value: "warm analog", confidence: 0.9, provenance: "stated" } });
  const warmPick = selectTrackSound(keys, twoSynths, warm);
  assert.equal(warmPick.selection.assetId, "analog-poly");
  assert.ok(warmPick.selection.candidates.find((c) => c.assetId === "analog-poly")!.reasons.some((r) => /character "analog" matches/.test(r)));
  assert.ok(warmPick.selection.candidates.find((c) => c.assetId === "digital-poly")!.reasons.some((r) => /contradicts the style's saturation/.test(r)));
  const clean = profile({ saturation: { value: "clean", confidence: 0.9, provenance: "stated" }, soundAesthetic: { value: "modern polished", confidence: 0.8, provenance: "stated" } });
  assert.equal(selectTrackSound(keys, twoSynths, clean).selection.assetId, "digital-poly");
  // Against a declared pad instrument, the aesthetic narrows the gap but a
  // declared family + role still wins: the operator's declaration is evidence
  // the style's words are not.
  const plain = selectTrackSound(pad, catalogue).selection.candidates.find((c) => c.assetId === "retrologue")!.score;
  const pulled = selectTrackSound(pad, catalogue, warm).selection.candidates.find((c) => c.assetId === "retrologue")!.score;
  assert.ok(pulled > plain + 3, `the warm analog style lifts the analog synth from ${plain} to ${pulled}`);
  assert.equal(selectTrackSound(pad, catalogue, warm).selection.assetId, "padshop");
});

test("nothing fits → a refusal with the reason, never a guess", () => {
  const only = selectTrackSound(kit, [catalogue[2]]);
  assert.equal(only.selection.assetId, null);
  assert.ok(/no attested instrument fits Drum Kit/.test(only.selection.reason));
  assert.ok(/padshop declared for strings\/synth, not drums/.test(only.selection.reason));
  const empty = selectTrackSound(kit, []);
  assert.equal(empty.selection.reason, "the renderer offers no attested instruments");
});

test("precedence: explicit operator rule > brain > table default > worker default; unattested rules still refuse", () => {
  const explicit = resolveTrackAsset({ track: kit, table: { byRole: { GROOVE: "retrologue" } }, catalogue });
  assert.equal(explicit.source, "operator");
  assert.equal(explicit.assetId, "retrologue");
  assert.equal(explicit.soundProfile, null);

  const brain = resolveTrackAsset({ track: kit, table: { default: "retrologue" }, catalogue });
  assert.equal(brain.source, "brain", "the brain outranks a table default");
  assert.equal(brain.assetId, "groove-agent");
  assert.ok(brain.soundProfile);

  const noTable = resolveTrackAsset({ track: pad, table: null, catalogue });
  assert.equal(noTable.source, "brain");
  assert.equal(noTable.assetId, "padshop");

  const tableDefault = resolveTrackAsset({ track: kit, table: { default: "retrologue" }, catalogue: [catalogue[2]] });
  assert.equal(tableDefault.source, "refused", "the default names an asset the worker has not attested");
  const tableDefaultOk = resolveTrackAsset({ track: kit, table: { default: "padshop" }, catalogue: [catalogue[2]] });
  assert.equal(tableDefaultOk.source, "operator-default");
  assert.equal(tableDefaultOk.assetId, "padshop");

  const unattested = resolveTrackAsset({ track: kit, table: { byFamily: { drums: "kontakt" } }, catalogue });
  assert.equal(unattested.source, "refused");
  assert.ok(/has not attested/.test(unattested.reason));

  const workerDefault = resolveTrackAsset({ track: kit, table: null, catalogue: [] });
  assert.equal(workerDefault.source, "worker-default");
  assert.equal(workerDefault.assetId, null);
});

test("the renderer's asset list becomes a catalogue without paths or empty hints", () => {
  const entries = toSoundCatalogue([
    { id: "a", name: "A", families: [], roles: ["PAD"], character: ["warm"] },
    { id: "b" },
  ]);
  assert.deepEqual(entries, [{ assetId: "a", name: "A", roles: ["PAD"], character: ["warm"] }, { assetId: "b" }]);
});
