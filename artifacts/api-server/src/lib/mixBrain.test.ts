import assert from "node:assert/strict";
import test from "node:test";
import type { MusicalNote, StyleProfile } from "@workspace/db";
import { MIX_BRAIN_METHOD, deriveMixPlan, mixPlanToControls, type MixBrainInput } from "./mixBrain";

/** Notes across the whole song (32 s at 120 BPM = 16 bars), or a bar range. */
const notes = (pitch: number, fromBar = 1, toBar = 16, duration = 0.4): MusicalNote[] => {
  const out: MusicalNote[] = [];
  for (let bar = fromBar; bar <= toBar; bar += 1) {
    for (let beat = 0; beat < 4; beat += 1) {
      out.push({ id: `n${bar}-${beat}`, start: (bar - 1) * 2 + beat * 0.5, duration, pitch: pitch + (beat % 3), velocity: 90 });
    }
  }
  return out;
};

const sections: MixBrainInput["sections"] = [
  { name: "Intro", startBar: 1, endBar: 4, energy: 0.3, density: 0.3 },
  { name: "Verse", startBar: 5, endBar: 8, energy: 0.5, density: 0.5 },
  { name: "Chorus", startBar: 9, endBar: 12, energy: 0.9, density: 0.8 },
  { name: "Outro", startBar: 13, endBar: 16, energy: 0.4, density: 0.35 },
];

const band: MixBrainInput["tracks"] = [
  { trackId: "kit", instrument: "Drum Kit", role: "GROOVE", family: "drums", notes: notes(36, 5, 16, 0.1) },
  { trackId: "bass", instrument: "Electric Bass", role: "BASS", family: "strings", notes: notes(40) },
  { trackId: "lead", instrument: "Flute", role: "LEAD", family: "winds", notes: notes(79, 5, 16) },
  { trackId: "counter", instrument: "Oboe", role: "COUNTER_MELODY", family: "winds", notes: notes(77, 9, 16) },
  { trackId: "pad", instrument: "Warm Pad", role: "PAD", family: "synth", notes: notes(60, 1, 16, 2) },
  { trackId: "bed", instrument: "Strings", role: "HARMONIC_BED", family: "strings", notes: notes(62, 9, 16, 2) },
];

const base: MixBrainInput = { arrangementId: "arr-1", tracks: band, sections, bpm: 120, meter: "4/4", durationSeconds: 32, now: new Date(0) };

const profile = (dimensions: StyleProfile["dimensions"]): StyleProfile => ({
  version: "1.0", derivedAt: "1970-01-01T00:00:00.000Z", inputsDigestSha256: "0".repeat(64), method: "test",
  dimensions, exclusions: [], conflicts: [], sources: [], confidence: 0.7,
});

test("the mix is decided per role, not per track index, and every value has a reason", () => {
  const plan = deriveMixPlan(base);
  const by = Object.fromEntries(plan.tracks.map((t) => [t.trackId, t]));
  assert.equal(plan.method, MIX_BRAIN_METHOD);
  assert.equal(by.bass.pan, 0, "bass is centred");
  assert.equal(by.bass.sendDb, -80, "bass is dry");
  assert.equal(by.kit.bus, "DRUMS");
  assert.equal(by.lead.priority, 1);
  assert.ok(by.pad.levelDb < by.lead.levelDb - 5, "the pad sits well under the lead");
  assert.ok(by.pad.processing.highPassHz >= 140, "the pad is high-passed away from the bass");
  assert.ok(Math.abs(by.pad.pan) >= 0.5, "the pad is wide");
  for (const track of plan.tracks) assert.ok(track.rationale.length >= 1, `${track.trackId} explains itself`);
  assert.ok(by.bass.rationale.some((r) => /dry/.test(r)));
});

test("a counter-melody in the lead's register is tucked under it and panned to the side", () => {
  const plan = deriveMixPlan(base);
  const by = Object.fromEntries(plan.tracks.map((t) => [t.trackId, t]));
  const masking = plan.conflicts.find((c) => c.kind === "register_masking" && c.trackIds.includes("lead") && c.trackIds.includes("counter"));
  assert.ok(masking, "the shared register is detected");
  assert.equal(by.counter.levelDb, -3.5, "COUNTER_MELODY -2 dB base, -1.5 dB under the lead");
  assert.notEqual(by.counter.pan, 0);
  // Two background parts sharing a register end up on opposite sides.
  const beds = plan.conflicts.find((c) => c.kind === "register_masking" && c.trackIds.includes("pad") && c.trackIds.includes("bed"));
  assert.ok(beds, "pad and bed share a register");
  assert.ok(Math.sign(by.pad.pan) !== Math.sign(by.bed.pan), "pad and bed are on opposite sides");
});

test("the mix evolves across sections: beds tuck in the dense chorus and open in the sparse intro; the climax lets them up", () => {
  const plan = deriveMixPlan(base);
  const pad = plan.tracks.find((t) => t.trackId === "pad")!;
  const intro = pad.sections.find((s) => s.sectionName === "Intro")!;
  const chorus = pad.sections.find((s) => s.sectionName === "Chorus")!;
  assert.ok(intro.sendOffsetDb > 0, "sparse intro: reverb opens on the pad");
  assert.ok(intro.levelOffsetDb < 0, "quiet intro: pad a step back");
  // Chorus is dense (-0.8) and the climax (+1.5): the two pull against each other, both named.
  assert.ok(/climax: beds open up/.test(chorus.reason));
  assert.ok(/bed tucked for density/.test(chorus.reason));
  assert.ok(chorus.sendOffsetDb < 0, "dense chorus: reverb closes");
  const lead = plan.tracks.find((t) => t.trackId === "lead")!;
  assert.equal(lead.sections.find((s) => s.sectionName === "Intro"), undefined, "the lead does not play in the intro, so it has no intro segment");
  const leadChorus = lead.sections.find((s) => s.sectionName === "Chorus")!;
  assert.ok(leadChorus.levelOffsetDb > 0, "foreground lifts with energy");
  const chorusSection = plan.sections.find((s) => s.sectionName === "Chorus")!;
  assert.deepEqual(chorusSection.focusTrackIds, ["lead"], "the lead is the focus of the chorus");
  const introSection = plan.sections.find((s) => s.sectionName === "Intro")!;
  assert.deepEqual(introSection.focusTrackIds, ["bass"], "with no lead or kit yet, the bass carries the intro");
});

test("style dimensions shape the mix with provenance: mono collapses pans, a hall opens sends, wide dynamics lower the target", () => {
  const styled = deriveMixPlan({ ...base, styleProfile: profile({
    stereoAesthetic: { value: "mono", confidence: 0.9, provenance: "stated" },
    roomSize: { value: "hall", confidence: 0.6, provenance: "inferred" },
    dynamics: { value: "wide", confidence: 0.7, provenance: "stated" },
    saturation: { value: "warm", confidence: 0.5, provenance: "inferred" },
    instrumentationHierarchy: { value: ["winds", "strings"], confidence: 0.6, provenance: "stated" },
  }) });
  assert.ok(styled.tracks.every((t) => t.pan === 0), "mono: every pan collapses");
  assert.equal(styled.master.processing.stereoWidth, 0);
  assert.equal(styled.master.targetLufs, -16);
  const pad = styled.tracks.find((t) => t.trackId === "pad")!;
  assert.equal(pad.sendDb, -5, "PAD -10 dB send + hall +5");
  assert.equal(pad.processing.saturation, 0.1, "warm: +0.1 saturation on music");
  const kit = styled.tracks.find((t) => t.trackId === "kit")!;
  assert.equal(kit.processing.saturation, 0.1, "drums keep their own saturation, no style boost");
  const lead = styled.tracks.find((t) => t.trackId === "lead")!;
  assert.equal(lead.levelDb, 2.5, "winds first in the hierarchy: +1.5 dB");
  assert.deepEqual(styled.styleInputs.map((s) => s.dimension), ["stereoAesthetic", "roomSize", "saturation", "dynamics", "instrumentationHierarchy"]);
  assert.ok(styled.styleInputs.every((s) => s.provenance === "stated" || s.provenance === "inferred"));
});

test("the plan is deterministic and its controls are what the revision route accepts", () => {
  const a = deriveMixPlan(base);
  const b = deriveMixPlan({ ...base, tracks: [...base.tracks].reverse() });
  assert.equal(a.inputsDigestSha256, b.inputsDigestSha256, "track order does not change the digest");
  assert.deepEqual(
    a.tracks.map((t) => [t.trackId, t.levelDb, t.pan]).sort(),
    b.tracks.map((t) => [t.trackId, t.levelDb, t.pan]).sort(),
  );
  const controls = mixPlanToControls(a);
  assert.deepEqual(Object.keys(controls.tracks).sort(), band.map((t) => t.trackId).sort());
  for (const control of Object.values(controls.tracks)) {
    assert.ok(control.levelDb >= -60 && control.levelDb <= 12);
    assert.ok(control.pan >= -1 && control.pan <= 1);
    assert.ok(control.sendDb >= -80 && control.sendDb <= 6);
    assert.ok(control.processing.highPassHz >= 20 && control.processing.compressorRatio >= 1 && control.processing.saturation <= 1);
    for (const segment of control.automation ?? []) {
      assert.ok(segment.endSeconds > segment.startSeconds);
      assert.ok(segment.levelOffsetDb !== 0 || segment.sendOffsetDb !== 0, "only moving segments are emitted");
    }
  }
  assert.ok(controls.tracks.pad.automation!.length >= 3, "the pad moves through the song");
  assert.equal(controls.tracks.bass.automation?.some((s) => s.label === "Chorus"), true);
  assert.equal(controls.master.targetLufs, -14);
  assert.equal(controls.master.truePeakDbtp, -1);
});

test("sections without bar numbers are spread evenly over the song", () => {
  const plan = deriveMixPlan({ ...base, sections: [
    { name: "A", energy: 0.4, density: 0.4 }, { name: "B", energy: 0.8, density: 0.8 },
  ] });
  assert.deepEqual(plan.sections.map((s) => [s.sectionName, s.startSeconds, s.endSeconds]), [["A", 0, 16], ["B", 16, 32]]);
});
