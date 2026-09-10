import assert from "node:assert/strict";
import test from "node:test";
import type { MusicalNote, PhrasePlan } from "@workspace/db";
import { PERFORMANCE_ENGINE, applyPerformance, performanceStyleFromProfile } from "./performanceEngine";

/** Straight 8ths at 120 BPM (beat = 0.5 s, bar = 2 s). */
const eighths = (pitch: number, count = 16): MusicalNote[] =>
  Array.from({ length: count }, (_, i) => ({
    id: `n${i}`, start: i * 0.25, duration: 0.22, pitch, velocity: 90,
  }));

const phrases: PhrasePlan[] = [
  { id: "p1", sectionName: "Verse", startBar: 1, endBar: 4, role: "opening", energyTarget: 0.4, entersFamilies: [], leavesFamilies: [] },
  { id: "p2", sectionName: "Verse", startBar: 5, endBar: 8, role: "cadence", energyTarget: 0.5, entersFamilies: [], leavesFamilies: [] },
];

const base = { trackId: "t", tempoBpm: 120, meter: "4/4", seed: 42, phrases };

test("humanisation is deterministic for a given seed and varies with the seed", () => {
  const a = applyPerformance({ ...base, instrument: "keys", family: "keys", role: "HARMONIC_BED", notes: eighths(60) });
  const b = applyPerformance({ ...base, instrument: "keys", family: "keys", role: "HARMONIC_BED", notes: eighths(60) });
  const c = applyPerformance({ ...base, seed: 7, instrument: "keys", family: "keys", role: "HARMONIC_BED", notes: eighths(60) });
  assert.deepEqual(a.notes, b.notes);
  assert.notDeepEqual(a.notes.map((n) => n.start), c.notes.map((n) => n.start));
  assert.equal(a.evidence.engine, PERFORMANCE_ENGINE);
});

test("timing is not a single random offset — it varies per note with reasons", () => {
  const performed = applyPerformance({ ...base, instrument: "keys", family: "keys", role: "LEAD", notes: eighths(64) });
  const offsets = performed.evidence.decisions.map((d) => d.timingOffsetMs);
  assert.ok(new Set(offsets.map((o) => o.toFixed(2))).size > 3, "offsets differ note to note");
  assert.ok(performed.evidence.timingStdMs > 0.5, "there is real timing spread");
  for (const decision of performed.evidence.decisions) {
    assert.ok(decision.reasons.length >= 3, "each decision names its musical reasons");
    assert.ok(decision.reasons.some((r) => /metrical weight/.test(r)));
  }
});

test("downbeats are accented and hats sit under kick/snare", () => {
  const drumNotes: MusicalNote[] = [
    { id: "k1", start: 0, duration: 0.2, pitch: 36, velocity: 90 },
    { id: "h1", start: 0.25, duration: 0.1, pitch: 42, velocity: 90 },
    { id: "s1", start: 0.5, duration: 0.2, pitch: 38, velocity: 90 },
    { id: "h2", start: 0.75, duration: 0.1, pitch: 42, velocity: 90 },
    { id: "k2", start: 1.0, duration: 0.2, pitch: 36, velocity: 90 },
  ];
  const performed = applyPerformance({ ...base, instrument: "drums", family: "drums", role: "GROOVE", notes: drumNotes });
  const kick = performed.notes.find((n) => n.id === "k1")!;
  const hat = performed.notes.find((n) => n.id === "h1")!;
  assert.ok(kick.velocity > hat.velocity, "kick louder than the offbeat hat");
  assert.ok(performed.evidence.addedEvents.flams >= 1, "a flam was added");
});

test("swing pushes offbeats late; straight does not", () => {
  const straight = applyPerformance({ ...base, groove: "steady_pulse", instrument: "keys", family: "keys", role: "OSTINATO", notes: eighths(60, 8) });
  const swung = applyPerformance({ ...base, groove: "swing", instrument: "keys", family: "keys", role: "OSTINATO", notes: eighths(60, 8) });
  const offbeat = (out: typeof straight) => out.notes.find((n) => n.id === "n1")!.start;
  assert.ok(offbeat(swung) > offbeat(straight) + 0.03, "the swung offbeat lands measurably later");
  assert.ok(swung.evidence.decisions.some((d) => d.reasons.includes("swung offbeat")));
});

test("a keyboard chord is rolled and the left hand leads", () => {
  const chord: MusicalNote[] = [
    { id: "c1", start: 1, duration: 1, pitch: 48, velocity: 80 },
    { id: "c2", start: 1, duration: 1, pitch: 64, velocity: 80 },
    { id: "c3", start: 1, duration: 1, pitch: 67, velocity: 80 },
    { id: "c4", start: 1, duration: 1, pitch: 72, velocity: 80 },
  ];
  const performed = applyPerformance({ ...base, instrument: "keys", family: "keys", role: "HARMONIC_BED", notes: chord });
  const starts = performed.notes.filter((n) => n.id.startsWith("c")).map((n) => n.start);
  assert.equal(new Set(starts).size > 1, true, "the chord is spread, not a block");
  const low = performed.notes.find((n) => n.id === "c1")!;
  const high = performed.notes.find((n) => n.id === "c4")!;
  assert.ok(low.start < high.start, "the left hand enters first");
  assert.ok(performed.evidence.addedEvents.strumSpreadNotes >= 3);
  assert.ok(performed.evidence.ccCurves.some((c) => /CC64/.test(c)), "sustain pedal written");
});

test("strings get CC1/CC11 curves, bow changes, and a legato length factor", () => {
  const performed = applyPerformance({
    ...base, instrument: "strings", family: "strings", role: "PAD",
    dynamicShape: "mp->f", notes: eighths(67, 8),
  });
  assert.ok(performed.cc.some((c) => c.controller === 1));
  assert.ok(performed.cc.some((c) => c.controller === 11));
  assert.ok(performed.articulations.some((a) => a.name === "bow_change"));
  assert.ok(performed.evidence.ccCurves.length >= 2);
  const source = eighths(67, 8)[0];
  const performedNote = performed.notes.find((n) => n.id === "n0")!;
  assert.ok(performedNote.duration > source.duration, "legato lengthening");
});

test("a bass is plucked, and no articulation leaves the instrument's vocabulary", () => {
  // The bass lives in the strings definition family. Bowing it is not a
  // performance decision the renderer can map, so it must never be emitted.
  const performed = applyPerformance({
    ...base, instrument: "Electric Bass", family: "strings", role: "BASS",
    notes: eighths(40), articulationVocabulary: ["finger", "pick", "slap", "mute", "slide"],
  });
  assert.ok(!performed.articulations.some((a) => a.name === "bow_change"), "no bow changes on a bass");
  // Plucked, not bowed: no legato lengthening, and never more than the legato
  // tolerance of overlap with the next note once monophony is declared.
  const mono = applyPerformance({
    ...base, instrument: "Electric Bass", family: "strings", role: "BASS",
    notes: eighths(40), maxSimultaneousNotes: 1,
  });
  const sorted = [...mono.notes].sort((a, b) => a.start - b.start);
  for (let i = 0; i + 1 < sorted.length; i += 1) {
    const overlap = sorted[i].start + sorted[i].duration - sorted[i + 1].start;
    assert.ok(overlap <= 0.03 + 1e-6, `note ${i} overlaps the next by ${overlap.toFixed(3)}s`);
  }
  for (const articulation of performed.articulations) {
    assert.ok(
      ["finger", "pick", "slap", "mute", "slide"].includes(articulation.name),
      `${articulation.name} is outside the bass vocabulary`,
    );
  }
  // A bowed section keeps its bow changes when its vocabulary allows them.
  const section = applyPerformance({
    ...base, instrument: "Violins", family: "strings", role: "HARMONIC_BED",
    notes: eighths(72), articulationVocabulary: ["legato", "bow_change", "staccato"],
  });
  assert.ok(section.articulations.some((a) => a.name === "bow_change"));
});

// ---------------------------------------------------------------------------
// PR-23: style-driven performance
// ---------------------------------------------------------------------------

test("without a style the engine is V1: no ornaments, fills or keyswitches, evidence says 1.0", () => {
  const performed = applyPerformance({ ...base, instrument: "keys", family: "keys", role: "LEAD", notes: eighths(64) });
  assert.equal(performed.evidence.engineVersion, "1.0");
  assert.equal(performed.evidence.styleInputs, undefined);
  assert.ok(!performed.notes.some((n) => n.id.includes("-grace") || n.id.includes("-fill")));
  assert.ok(!performed.articulations.some((a) => a.keyswitch !== undefined));
  // An empty style enables V2 without changing any parameter it does not name.
  const v2 = applyPerformance({ ...base, instrument: "keys", family: "keys", role: "LEAD", notes: eighths(64), performanceStyle: {} });
  assert.equal(v2.evidence.engineVersion, "2.0");
  assert.deepEqual(v2.evidence.styleInputs, []);
});

test("the swing ratio comes from the style, not a constant", () => {
  const notes = eighths(60);
  const light = applyPerformance({ ...base, instrument: "keys", family: "keys", role: "GROOVE", notes, performanceStyle: { swingRatio: 0.58 } });
  const heavy = applyPerformance({ ...base, instrument: "keys", family: "keys", role: "GROOVE", notes, performanceStyle: { swingRatio: 0.67 } });
  const offbeat = (p: ReturnType<typeof applyPerformance>) => p.notes.find((n) => n.id === "n1")!.start - 0.25;
  assert.ok(offbeat(heavy) > offbeat(light) + 0.02, "a heavier ratio pushes the offbeat later");
  assert.ok(heavy.evidence.decisions.some((d) => d.reasons.some((r) => /swing ratio 0\.67/.test(r))));
});

test("microtiming behind sits later than ahead, and quantized is tighter than loose", () => {
  const run = (microtiming: "behind" | "ahead" | "quantized" | "loose") =>
    applyPerformance({ ...base, instrument: "keys", family: "keys", role: "HARMONIC_BED", notes: eighths(60), performanceStyle: { microtiming } });
  assert.ok(run("behind").evidence.meanTimingOffsetMs > run("ahead").evidence.meanTimingOffsetMs + 10);
  assert.ok(run("quantized").evidence.timingStdMs < run("loose").evidence.timingStdMs);
});

test("wide dynamics spread velocity more than narrow", () => {
  const spread = (dynamics: "narrow" | "wide") => {
    const p = applyPerformance({ ...base, instrument: "keys", family: "keys", role: "LEAD", notes: eighths(64, 32), performanceStyle: { dynamics } });
    const v = p.notes.map((n) => n.velocity);
    return Math.max(...v) - Math.min(...v);
  };
  assert.ok(spread("wide") > spread("narrow"));
});

test("ornaments go to melodic roles only, stay in range, and keep a monophonic line playable", () => {
  // A real contour: the phrase peaks mid-way, so peak, start and end differ.
  const contour = eighths(72).map((n, i) => ({ ...n, pitch: 72 + [0, 2, 4, 5, 7, 5, 4, 2][i % 8] }));
  const lead = applyPerformance({
    ...base, instrument: "flute", family: "winds", role: "LEAD", notes: contour,
    performanceStyle: { melodicOrnamentation: "heavy" }, playableRange: { min: 60, max: 96 }, maxSimultaneousNotes: 1,
  });
  const graces = lead.notes.filter((n) => n.id.endsWith("-grace"));
  assert.equal(graces.length, 2, "heavy: the phrase peak and the phrase end get a grace note (the first note has no room before it)");
  assert.ok(graces.some((g) => g.id === "n4-grace"), "the grace leads into the peak");
  assert.ok(graces.every((g) => g.pitch >= 60), "ornaments never leave the playable range");
  const sorted = [...lead.notes].sort((a, b) => a.start - b.start);
  for (let i = 0; i + 1 < sorted.length; i += 1) {
    assert.ok(sorted[i].start + sorted[i].duration - sorted[i + 1].start <= 0.03 + 1e-6, "monophony survives the ornaments");
  }
  assert.equal(lead.evidence.addedEvents.ornaments, graces.length);
  const bed = applyPerformance({ ...base, instrument: "keys", family: "keys", role: "HARMONIC_BED", notes: eighths(60), performanceStyle: { melodicOrnamentation: "heavy" } });
  assert.equal(bed.evidence.addedEvents.ornaments, 0, "a harmonic bed is not ornamented");
});

test("drum fills land on the beat before a cadence, and only for the groove role", () => {
  const drumNotes: MusicalNote[] = Array.from({ length: 32 }, (_, i) => ({
    id: `k${i}`, start: i * 0.5, duration: 0.2, pitch: i % 2 ? 38 : 36, velocity: 100,
  }));
  const kit = applyPerformance({ ...base, instrument: "drums", family: "drums", role: "GROOVE", notes: drumNotes, performanceStyle: { fillFrequency: "moderate" } });
  const fills = kit.notes.filter((n) => n.id.includes("-fill-"));
  assert.equal(fills.length, 4, "one four-note fill into the cadence phrase (bar 5)");
  const phraseStart = 4 * 2; // bar 5 at 2 s per bar
  assert.ok(fills.every((n) => n.start >= phraseStart - 0.5 - 1e-6 && n.start < phraseStart));
  assert.ok(fills[3].velocity > fills[0].velocity, "the fill rises into the phrase");
  const rare = applyPerformance({ ...base, instrument: "drums", family: "drums", role: "GROOVE", notes: drumNotes, performanceStyle: { fillFrequency: "rare" } });
  assert.equal(rare.evidence.addedEvents.fills, 0, "rare fills only into explicit fill phrases");
});

test("articulations resolve to keyswitches through the track map, and never without one", () => {
  const withMap = applyPerformance({
    ...base, instrument: "Violins", family: "strings", role: "HARMONIC_BED", notes: eighths(72),
    articulationVocabulary: ["legato", "bow_change", "staccato"], performanceStyle: {}, articulationMap: { bow_change: 24, legato: "25" },
  });
  const keyed = withMap.articulations.filter((a) => a.keyswitch !== undefined);
  assert.ok(keyed.length > 0);
  assert.ok(keyed.every((a) => (a.name === "bow_change" && a.keyswitch === 24) || (a.name === "legato" && a.keyswitch === 25)));
  assert.equal(withMap.evidence.addedEvents.keyswitches, keyed.length);
  const withoutMap = applyPerformance({
    ...base, instrument: "Violins", family: "strings", role: "HARMONIC_BED", notes: eighths(72),
    articulationVocabulary: ["legato", "bow_change", "staccato"], performanceStyle: {},
  });
  assert.ok(withoutMap.articulations.every((a) => a.keyswitch === undefined));
  assert.ok(withoutMap.articulations.some((a) => a.name === "legato"), "a connected line is marked legato at phrase starts");
});

test("a bass placed laid back arrives after one anticipated, and sustained lengthens within monophony", () => {
  const notes = eighths(40);
  const laidBack = applyPerformance({ ...base, instrument: "Electric Bass", family: "strings", role: "BASS", notes, performanceStyle: { bassAttackPosition: "laid_back" }, maxSimultaneousNotes: 1 });
  const early = applyPerformance({ ...base, instrument: "Electric Bass", family: "strings", role: "BASS", notes, performanceStyle: { bassAttackPosition: "anticipated" }, maxSimultaneousNotes: 1 });
  assert.ok(laidBack.evidence.meanTimingOffsetMs > early.evidence.meanTimingOffsetMs + 20);
  const sustained = applyPerformance({ ...base, instrument: "Electric Bass", family: "strings", role: "BASS", notes, performanceStyle: { bassAttackPosition: "sustained" }, maxSimultaneousNotes: 1 });
  const sorted = [...sustained.notes].sort((a, b) => a.start - b.start);
  for (let i = 0; i + 1 < sorted.length; i += 1) assert.ok(sorted[i].start + sorted[i].duration - sorted[i + 1].start <= 0.03 + 1e-6);
});

test("a polyphony ceiling survives legato lengthening: a bowed 4-voice chord sequence never sounds 5 notes together", () => {
  // Four-voice chords every half bar, each voice written to its full length,
  // exactly what the composer produced for the benchmark's orchestral cases.
  // Bowed strings lengthen ×1.08, so without a clamp the previous chord's
  // tails still ring at the next onset and the constraint engine counts 5–6.
  const chords: MusicalNote[] = [];
  for (let i = 0; i < 8; i += 1) {
    for (const [v, pitch] of [55, 62, 67, 71].entries()) {
      chords.push({ id: `c${i}v${v}`, start: i * 1.0, duration: 1.0, pitch: pitch + (i % 2) * 2, velocity: 80 });
    }
  }
  const sounding = (notes: MusicalNote[], t: number) =>
    notes.filter((n) => n.start <= t + 1e-6 && n.start + n.duration > t + 0.03).length;
  const performed = applyPerformance({
    ...base, instrument: "strings", family: "strings", role: "CLIMAX_LAYER", notes: chords, maxSimultaneousNotes: 4,
  });
  const onsets = [...new Set(performed.notes.map((n) => Number(n.start.toFixed(3))))];
  for (const t of onsets) assert.ok(sounding(performed.notes, t) <= 4, `${sounding(performed.notes, t)} notes sound at ${t}s`);
  assert.equal(performed.notes.length, chords.length, "nothing is dropped, only released early");
  // Without a declared ceiling the legato overlap is kept: that is the bowed sound.
  const free = applyPerformance({ ...base, instrument: "strings", family: "strings", role: "CLIMAX_LAYER", notes: chords });
  assert.ok(onsets.some((t) => sounding(free.notes, t) > 4) || free.notes.some((n) => n.duration > 1.0), "legato lengthening is real");
  // A ceiling above the written polyphony changes nothing.
  const roomy = applyPerformance({ ...base, instrument: "strings", family: "strings", role: "CLIMAX_LAYER", notes: chords, maxSimultaneousNotes: 8 });
  assert.deepEqual(roomy.notes, free.notes);
});

test("performanceStyleFromProfile carries only evidenced dimensions, with provenance", () => {
  const profile = {
    version: "1.0", derivedAt: "", inputsDigestSha256: "", method: "t", exclusions: [], conflicts: [], sources: [], confidence: 0.5,
    dimensions: {
      swingRatio: { value: 0.62, confidence: 0.8, provenance: "stated" },
      microtiming: { value: "behind", confidence: 0.6, provenance: "inferred" },
      dynamics: { value: "nonsense", confidence: 0.9, provenance: "stated" },
    },
  } as unknown as Parameters<typeof performanceStyleFromProfile>[0];
  const style = performanceStyleFromProfile(profile);
  assert.equal(style.swingRatio, 0.62);
  assert.equal(style.microtiming, "behind");
  assert.equal(style.dynamics, undefined, "an out-of-vocabulary value is not carried");
  assert.equal(style.melodicOrnamentation, undefined, "absent stays absent");
  // Brain B-09: the profile is adapted into the StyleGrammar; a profile value the producer stated or the vocabulary implied is provenance `brief`.
  assert.deepEqual(style.sources?.map((s) => [s.dimension, s.provenance]), [["swingRatio", "brief"], ["microtiming", "brief"]]);
  assert.deepEqual(performanceStyleFromProfile(null), {});
});

test("a wind part breathes before long rests", () => {
  const notes: MusicalNote[] = [
    { id: "a", start: 0, duration: 1.2, pitch: 72, velocity: 90 },
    { id: "b", start: 2.0, duration: 1.0, pitch: 74, velocity: 90 },
  ];
  const performed = applyPerformance({ ...base, instrument: "flute", family: "winds", role: "COUNTER_MELODY", notes });
  assert.ok(performed.evidence.addedEvents.breathGaps >= 1);
  assert.ok(performed.articulations.some((a) => a.name === "attack"));
});

test("a rising dynamic shape makes later notes louder at the same metrical spot", () => {
  const performed = applyPerformance({
    ...base, instrument: "keys", family: "keys", role: "HARMONIC_BED",
    dynamicShape: "mp->f", notes: eighths(60, 16),
  });
  // n0 and n8 are both bar downbeats, so only the written shape (and the
  // phrase arc) separates them — metrical accent is held constant.
  const firstDownbeat = performed.notes.find((n) => n.id === "n0")!;
  const laterDownbeat = performed.notes.find((n) => n.id === "n8")!;
  assert.ok(
    laterDownbeat.velocity > firstDownbeat.velocity,
    "the part grows with the written shape",
  );
});

test("metrical accent outranks the ramp — an offbeat stays under a downbeat", () => {
  const performed = applyPerformance({
    ...base, instrument: "keys", family: "keys", role: "HARMONIC_BED",
    dynamicShape: "mp->f", notes: eighths(60, 16),
  });
  const downbeat = performed.notes.find((n) => n.id === "n0")!;
  const lateOffbeat = performed.notes.find((n) => n.id === "n15")!;
  assert.ok(lateOffbeat.velocity < downbeat.velocity);
});
