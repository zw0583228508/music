import assert from "node:assert/strict";
import test from "node:test";
import type { MusicalNote, SoundCatalogueEntry, StyleProfile } from "@workspace/db";
import {
  SOUND_SELECTION_METHOD,
  assessKeyRangeFit,
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

// ---------------------------------------------------------------------------
// B-03: range-aware selection. The catalogue below is the local worker's
// twelve attested assets with the ranges read from their SFZ files
// (services/vst3-render-worker/known_asset_ranges.json); the two synths
// answer every key.
// ---------------------------------------------------------------------------

const LOCAL_WORKER: SoundCatalogueEntry[] = [
  { assetId: "surge-xt-1.3.4", name: "Surge XT", families: ["synth"], character: ["analog", "wide", "clean", "digital"], keyRange: [0, 127], keyRangeSource: "synth" },
  { assetId: "dexed-1.0.1", name: "Dexed", families: ["synth"], character: ["digital", "fm", "bright", "vintage", "electric"], keyRange: [0, 127], keyRangeSource: "synth" },
  { assetId: "sfizz-salamander-grand-v3", name: "Salamander Grand Piano", families: ["keys"], character: ["acoustic", "piano", "natural", "sampled", "grand"], keyRange: [21, 108], sampledRange: [21, 108], velocityLayers: 4 },
  { assetId: "sfizz-vsco2-violin-ens-sus", name: "VSCO2 Violin Ensemble Sustain", families: ["strings"], roles: ["PAD", "HARMONIC_BED", "TRANSITION", "CLIMAX_LAYER", "COUNTER_MELODY"], character: ["acoustic", "orchestral", "sampled", "sustain", "natural"], keyRange: [55, 86], sampledRange: [55, 86] },
  { assetId: "sfizz-vsco2-cello-ens-sus", name: "VSCO2 Cello Ensemble Sustain", families: ["strings"], roles: ["FOUNDATION", "HARMONIC_BED", "COUNTER_MELODY", "PAD"], character: ["acoustic", "orchestral", "sampled", "dark", "sustain"], keyRange: [36, 77], sampledRange: [36, 77] },
  { assetId: "sfizz-vsco2-horn-sus", name: "VSCO2 French Horn Sustain", families: ["brass"], roles: ["PAD", "CLIMAX_LAYER", "HARMONIC_BED", "COUNTER_MELODY"], character: ["acoustic", "orchestral", "sampled", "warm"], keyRange: [33, 77], sampledRange: [33, 77] },
  { assetId: "sfizz-vsco2-flute-sus", name: "VSCO2 Flute Sustain Vibrato", families: ["winds"], roles: ["LEAD", "COUNTER_MELODY", "CALL_RESPONSE"], character: ["acoustic", "orchestral", "sampled", "airy"], keyRange: [60, 96], sampledRange: [60, 96] },
  { assetId: "sfizz-vsco2-harp", name: "VSCO2 Harp", families: ["strings"], roles: ["OSTINATO", "ACCENT"], character: ["acoustic", "orchestral", "plucked", "sampled"], keyRange: [28, 101], sampledRange: [28, 101] },
  { assetId: "sfizz-drskit-stereo", name: "DrumGizmo DRSKit", families: ["drums"], roles: ["GROOVE", "FILL"], character: ["acoustic", "kit", "drum", "natural", "sampled"], keyRange: [35, 76], mappedKeys: [35, 36, 37, 38, 40, 41, 42, 43, 44, 46, 47, 48, 49, 50, 51, 52, 53, 54, 55, 56, 57, 58, 60, 61, 62, 63, 64, 65, 66, 67, 68, 69, 70, 71, 72, 73, 74, 76] },
  { assetId: "sfizz-meatbass-arco", name: "Karoryfer Meatbass Arco", families: ["bass", "strings"], roles: ["BASS", "FOUNDATION"], character: ["acoustic", "dark", "mono", "sampled", "bowed"], keyRange: [12, 72], sampledRange: [21, 69] },
  { assetId: "sfizz-meatbass-pizz", name: "Karoryfer Meatbass Pizzicato", families: ["bass", "strings"], roles: ["BASS", "FOUNDATION", "OSTINATO"], character: ["acoustic", "dark", "mono", "sampled", "plucked"], keyRange: [12, 79], sampledRange: [21, 79] },
  { assetId: "sfizz-emilyguitar-basic", name: "Karoryfer Emilyguitar Electric", families: ["guitar"], roles: ["RHYTHMIC_HARMONY", "LEAD", "COUNTER_MELODY", "ACCENT"], character: ["electric", "clean", "vintage", "sampled"], keyRange: [33, 96], sampledRange: [37, 96] },
];
/** The catalogue as the live worker published it on 2026-09-10: no ranges at all. */
const LOCAL_WORKER_NO_RANGES: SoundCatalogueEntry[] = LOCAL_WORKER.map(({ keyRange, sampledRange, mappedKeys, velocityLayers, keyRangeSource, ...rest }) => rest);

const span = (lo: number, hi: number, duration = 1.0, count = 12): MusicalNote[] =>
  Array.from({ length: count }, (_, i) => ({ id: `s${i}`, start: i * 0.5, duration, pitch: lo + Math.round((hi - lo) * (i / Math.max(1, count - 1))), velocity: 80 }));

/** The owner's v6 string part: HARMONIC_BED written at MIDI 79–91. */
const ownerStrings = { trackId: "strings-harmonic_bed", instrument: "strings", role: "HARMONIC_BED", family: "strings", notes: span(79, 91, 1.8) };

test("assessKeyRangeFit says whether an asset can sound the part, and how well", () => {
  const cello = LOCAL_WORKER.find((c) => c.assetId === "sfizz-vsco2-cello-ens-sus")!;
  const outside = assessKeyRangeFit(ownerStrings.notes, cello);
  assert.equal(outside.status, "outside");
  assert.equal(outside.outside, ownerStrings.notes.length, "every note of a 79–91 part is above a 36–77 cello");
  assert.match(outside.detail, /key range 36–77 does not cover the part \(79–91\)/);
  const violins = LOCAL_WORKER.find((c) => c.assetId === "sfizz-vsco2-violin-ens-sus")!;
  const partly = assessKeyRangeFit(ownerStrings.notes, violins);
  assert.equal(partly.status, "outside", "the violin ensemble is sampled to D6 (86): 87–91 would be silent too");
  assert.ok(partly.outside > 0 && partly.outside < ownerStrings.notes.length);
  const fits = assessKeyRangeFit(span(60, 79, 1.8), violins);
  assert.equal(fits.status, "covers"); assert.equal(fits.sampled, "covers");
  const stretched = assessKeyRangeFit(span(15, 40), LOCAL_WORKER.find((c) => c.assetId === "sfizz-meatbass-arco")!);
  assert.equal(stretched.status, "covers"); assert.equal(stretched.sampled, "stretched");
  assert.match(stretched.detail, /stretched samples/);
  const unverified = assessKeyRangeFit(span(60, 79), { });
  assert.equal(unverified.status, "unverified");
  const kit = LOCAL_WORKER.find((c) => c.assetId === "sfizz-drskit-stereo")!;
  assert.equal(assessKeyRangeFit([{ pitch: 54 }], kit).status, "covers", "GM 54 (tambourine) is a mapped DRSKit key (crash L tip)");
  const unmapped = assessKeyRangeFit([{ pitch: 36 }, { pitch: 59 }, { pitch: 75 }], kit);
  assert.equal(unmapped.status, "outside"); assert.deepEqual(unmapped.unmapped, [59, 75]);
  assert.equal(assessKeyRangeFit([], kit).status, "no-notes");
});

test("the owner's MIDI 79–91 string part is never routed to the cello ensemble; with ranges declared it is refused outright rather than rendered silent", () => {
  const withRanges = selectTrackSound(ownerStrings, LOCAL_WORKER);
  assert.notEqual(withRanges.selection.assetId, "sfizz-vsco2-cello-ens-sus");
  const cello = withRanges.selection.rejected.find((r) => r.assetId === "sfizz-vsco2-cello-ens-sus");
  assert.ok(cello && /does not cover the part \(79–91\)/.test(cello.reason), cello?.reason);
  const violins = withRanges.selection.rejected.find((r) => r.assetId === "sfizz-vsco2-violin-ens-sus");
  assert.ok(violins && /55–86/.test(violins.reason), "the violins are sampled to 86: the part reaches 91");
  // Nothing in the strings family can sound 79–91 except the harp (28–101); the brain says so.
  assert.equal(withRanges.selection.assetId, "sfizz-vsco2-harp");
  assert.match(withRanges.selection.reason, /range 28–101 covers the part \(79–91\)/);
  assert.equal(withRanges.method, SOUND_SELECTION_METHOD);
  // Before B-03 (no ranges on the catalogue) the same call picked the cello ensemble - the v4 failure.
  const before = selectTrackSound(ownerStrings, LOCAL_WORKER_NO_RANGES);
  assert.equal(before.selection.assetId, "sfizz-vsco2-cello-ens-sus", "positive control: without ranges the old choice comes back");
  // The operator's v6 rule (strings -> violin ensemble) is refused for this part, with the reason.
  const operator = resolveTrackAsset({ track: ownerStrings, table: { byInstrument: { strings: "sfizz-vsco2-violin-ens-sus" } }, catalogue: LOCAL_WORKER });
  assert.equal(operator.source, "refused");
  assert.match(operator.reason, /operator rule .* names sfizz-vsco2-violin-ens-sus, but its key range 55–86 does not cover/);
  // Written where the register plan puts a string bed (60–79), the same rule and the same brain both give the violins.
  const bed = { ...ownerStrings, notes: span(60, 79, 1.8) };
  assert.equal(resolveTrackAsset({ track: bed, table: { byInstrument: { strings: "sfizz-vsco2-violin-ens-sus" } }, catalogue: LOCAL_WORKER }).source, "operator");
  const brainBed = selectTrackSound(bed, LOCAL_WORKER);
  assert.equal(brainBed.selection.assetId, "sfizz-vsco2-violin-ens-sus");
  assert.match(brainBed.selection.reason, /sampled range 55–86 covers the part/);
});

test("a bass part is never routed to a violin; the sampled-range fit and a declared range beat an undeclared one", () => {
  const bassPart = { trackId: "bass-bass", instrument: "bass", role: "BASS", family: "strings", notes: span(36, 50, 0.4) };
  const pick = selectTrackSound(bassPart, LOCAL_WORKER);
  assert.notEqual(pick.selection.assetId, "sfizz-vsco2-violin-ens-sus");
  assert.ok(pick.selection.rejected.some((r) => r.assetId === "sfizz-vsco2-violin-ens-sus" && /55–86 does not cover the part \(36–50\)/.test(r.reason)));
  assert.equal(pick.selection.assetId, "sfizz-meatbass-arco", "the bass asset declared for BASS with its own samples across 36–50");
  // A declared fitting range outranks silence about the range.
  const declared: SoundCatalogueEntry = { assetId: "declared", families: ["strings"], roles: ["BASS"], keyRange: [28, 67], sampledRange: [28, 67] };
  const silent: SoundCatalogueEntry = { assetId: "silent", families: ["strings"], roles: ["BASS"] };
  const compare = selectTrackSound(bassPart, [silent, declared]);
  assert.equal(compare.selection.assetId, "declared");
  const silentCandidate = compare.selection.candidates.find((c) => c.assetId === "silent")!;
  assert.ok(silentCandidate, "an asset without a range is still a candidate");
  assert.ok(silentCandidate.reasons.some((r) => /unverified/.test(r)));
  assert.ok(compare.selection.candidates.find((c) => c.assetId === "declared")!.score > silentCandidate.score);
  // Sampled fit breaks a tie between two covering assets.
  const stretchy: SoundCatalogueEntry = { assetId: "stretchy", families: ["strings"], roles: ["BASS"], keyRange: [12, 79], sampledRange: [55, 79] };
  assert.equal(selectTrackSound(bassPart, [stretchy, declared]).selection.assetId, "declared");
});

test("the owner's five v6 stems under the new rules, against the local worker's catalogue with ranges", () => {
  const stems = [
    { trackId: "bass-bass", instrument: "bass", role: "BASS", family: "strings", notes: span(36, 50, 0.4) },
    { trackId: "percussion-accent", instrument: "percussion", role: "ACCENT", family: "drums", notes: span(54, 54, 0.1) },
    { trackId: "mix-harmonic_bed", instrument: "mix", role: "HARMONIC_BED", family: "keys", notes: span(61, 77, 1.5) },
    ownerStrings,
    { trackId: "ensemble-transition", instrument: "ensemble", role: "TRANSITION", family: "keys", notes: span(62, 79, 0.5) },
  ];
  const chosen = Object.fromEntries(stems.map((stem) => [stem.trackId, selectTrackSound(stem, LOCAL_WORKER).selection.assetId]));
  assert.equal(chosen["bass-bass"], "sfizz-meatbass-arco");
  assert.equal(chosen["percussion-accent"], "sfizz-drskit-stereo");
  assert.equal(chosen["mix-harmonic_bed"], "sfizz-salamander-grand-v3");
  assert.equal(chosen["strings-harmonic_bed"], "sfizz-vsco2-harp", "79–91 is above every sustained string asset; the harp is the only strings asset that sounds it (and the brain says why)");
  assert.equal(chosen["ensemble-transition"], "sfizz-salamander-grand-v3");
});

test("the renderer's range hints ride into the catalogue, validated", () => {
  const entries = toSoundCatalogue([
    { id: "a", keyRange: [55, 86], sampledRange: [55, 86], velocityLayers: 2, articulations: ["sustain"], keyRangeSource: "sfz-regions" },
    { id: "b", keyRange: [90, 10], mappedKeys: ["x"], velocityLayers: 0, articulations: [] },
    { id: "c", mappedKeys: [38, 36, 42] },
  ]);
  assert.deepEqual(entries[0], { assetId: "a", keyRange: [55, 86], sampledRange: [55, 86], velocityLayers: 2, articulations: ["sustain"], keyRangeSource: "sfz-regions" });
  assert.deepEqual(entries[1], { assetId: "b" }, "an inverted range and non-numeric keys are dropped, not trusted");
  assert.deepEqual(entries[2], { assetId: "c", mappedKeys: [36, 38, 42] });
});
