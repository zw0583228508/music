import assert from "node:assert/strict";
import test from "node:test";
import { GOLD_DOMAINS, coverageOf, parseChordSymbol, scoreAgainstGold, validateManifest, ANALYSIS_GOLD_VERSION, type GoldItem } from "./analysisGold";
import { COMPOSED_SPECS, beatUnitQuarters, composeWork, makeTickClock, pdmxGold, renderGoldWork } from "./analysisGoldSynthetic";
import { decodeWavPcm16 } from "./listeningRendererV2";
import type { ParsedMidi } from "./midiFile";

const specById = (id: string) => COMPOSED_SPECS.find((s) => s.id === id)!;

test("every composed spec reads its own chord sheet and yields a truth in every domain", () => {
  const ids = new Set<string>();
  for (const spec of COMPOSED_SPECS) {
    assert.ok(!ids.has(spec.id), `duplicate id ${spec.id}`);
    ids.add(spec.id);
    for (const section of spec.sections) for (const cell of section.chords) for (const symbol of cell.split("|")) assert.ok(parseChordSymbol(symbol.trim()), `${spec.id}: chord ${symbol}`);
    const work = composeWork(spec);
    const coverage = coverageOf(work.truth);
    for (const domain of GOLD_DOMAINS) assert.equal(coverage[domain], "EXACT", `${spec.id}: ${domain}`);
    assert.ok(work.endSeconds >= 30 && work.endSeconds <= 90, `${spec.id}: ${work.endSeconds}s`);
    assert.ok(work.tracks.length >= 2, `${spec.id}: tracks`);
    // The truth is a self-consistent grid.
    const t = work.truth;
    assert.equal(t.tempo!.durationSeconds, work.endSeconds);
    for (const d of t.downbeats!) assert.ok(t.beats!.includes(d), `${spec.id}: downbeat ${d} is not a beat`);
    assert.equal(t.sections![0].start, 0);
    assert.equal(t.sections![t.sections!.length - 1].end, work.endSeconds);
    assert.equal(t.chords![t.chords!.length - 1].end, work.endSeconds);
    for (let i = 1; i < t.chords!.length; i += 1) assert.equal(t.chords![i].start, t.chords![i - 1].end, `${spec.id}: chord gap`);
    for (const track of t.notes!.tracks) for (const [start, duration] of track.notes) assert.ok(start >= 0 && duration > 0 && start < work.endSeconds + 1, `${spec.id}: note bounds`);
  }
});

test("the composed set covers the traps the brief names", () => {
  const traps = new Set(COMPOSED_SPECS.flatMap((s) => s.traps ?? []));
  for (const expected of ["pickup_bar", "double_tempo_feel:136", "half_tempo_feel:84", "tempo_step_change", "ritardando", "metre_change", "compound_metre:quarter=90", "relative_key_pair:eb-major-vs-c-minor", "c6_vs_am7_ambiguity"]) {
    assert.ok(traps.has(expected), expected);
  }
  const metres = new Set(COMPOSED_SPECS.map((s) => s.metre));
  assert.ok(metres.has("4/4") && metres.has("3/4") && metres.has("6/8"));
  const families = new Set(COMPOSED_SPECS.map((s) => s.genreFamily));
  for (const f of ["pop", "rock", "folk", "jazz", "classical", "film_game"]) assert.ok(families.has(f), f);
});

test("pickup: the first downbeat is one beat in, time 0 is a beat but not a downbeat", () => {
  const work = composeWork(specById("composed-folk-g-major-3-4-pickup"));
  const t = work.truth;
  assert.equal(t.metre!.pickupBar, true);
  assert.equal(t.metre!.pickupBeats, 1);
  assert.equal(t.beats![0], 0);
  assert.equal(t.downbeats![0], 0.6); // one beat at 100 BPM
  assert.equal(t.metre!.numerator, 3);
  assert.equal(t.tempo!.bpm, 100);
  const melody = t.notes!.tracks.find((tr) => tr.role === "flute")!;
  assert.ok(melody.notes.some(([start]) => start < 0.6), "the melody plays in the pickup");
  for (const track of t.notes!.tracks) if (track.role !== "flute") assert.ok(track.notes.every(([start]) => start >= 0.6 - 1e-9), `${track.role} waits for the downbeat`);
});

test("tempo step and ritardando produce a map, and the dominant tempo is the one that lasts longest", () => {
  const step = composeWork(specById("composed-tempo-step-100-125")).truth.tempo!;
  assert.deepEqual(step.map.map((p) => p.bpm), [100, 125, 100]);
  assert.equal(step.bpm, 100);
  assert.equal(step.constant, false);
  const rit = composeWork(specById("composed-tempo-ritardando-120-to-72")).truth.tempo!;
  assert.equal(rit.bpm, 120);
  assert.ok(rit.map.length > 10, "a step per beat");
  assert.equal(rit.map[rit.map.length - 1].bpm, 72);
  for (let i = 1; i < rit.map.length; i += 1) assert.ok(rit.map[i].bpm < rit.map[i - 1].bpm);
});

test("metre change: 3/4 bars in the bridge, the dominant stays 4/4, downbeats follow the written bars", () => {
  const t = composeWork(specById("composed-metre-change-4-4-to-3-4")).truth;
  assert.equal(t.metre!.numerator, 4);
  assert.deepEqual(t.metre!.changes.map((c) => `${c.numerator}/${c.denominator}`), ["4/4", "3/4", "4/4"]);
  const secondsPerQuarter = 60 / 116;
  const bridge = t.sections!.find((s) => s.label === "bridge")!;
  assert.ok(Math.abs(bridge.end - bridge.start - 8 * 3 * secondsPerQuarter) < 0.01);
  const downbeatsInBridge = t.downbeats!.filter((d) => d >= bridge.start - 1e-6 && d < bridge.end - 1e-6);
  assert.equal(downbeatsInBridge.length, 8);
});

test("6/8: beats are dotted quarters at 60, the quarter tempo is 90", () => {
  const t = composeWork(specById("composed-metre-6-8-ballad-60")).truth;
  assert.equal(t.tempo!.bpm, 60);
  assert.equal(t.tempo!.quarterBpm, 90);
  assert.equal(beatUnitQuarters(6, 8), 1.5);
  assert.equal(t.beats![1] - t.beats![0], 1);
  assert.equal(t.downbeats![1] - t.downbeats![0], 2);
});

test("relative-key twins share the key signature and differ only in the key truth", () => {
  const eb = composeWork(specById("composed-key-trap-eb-major-88")).truth;
  const cm = composeWork(specById("composed-key-trap-c-minor-88")).truth;
  assert.equal(eb.keySignature!.fifths, -3);
  assert.equal(cm.keySignature!.fifths, -3);
  assert.equal(eb.key!.mode, "major");
  assert.equal(cm.key!.mode, "minor");
  assert.equal(scoreAgainstGold("key", "C minor", eb).status, "scored");
  assert.equal((scoreAgainstGold("key", "C minor", eb) as { credit?: string }).credit, "relative");
  // The C minor twin actually contains the leading tone at its cadences: G7 carries B natural.
  assert.ok(cm.chords!.some((c) => c.root === "G" && c.quality === "7"));
  assert.ok(!eb.chords!.some((c) => c.root === "G"));
});

test("slash chords carry their bass in the truth and in the lowest comp voice", () => {
  const work = composeWork(specById("composed-pop-c-major-120"));
  const gOverB = work.truth.chords!.find((c) => c.root === "G" && c.bass === "B")!;
  assert.ok(gOverB, "G/B is in the sheet");
  const comp = work.tracks.find((t) => t.role === "keys")!;
  const lowest = comp.notes.filter((n) => n.start >= gOverB.start && n.start < gOverB.end).reduce((m, n) => Math.min(m, n.pitch), 127);
  assert.equal(lowest % 12, 11, "B is the lowest comp voice under G/B");
  const bass = work.tracks.find((t) => t.role === "bass")!;
  const bassUnder = bass.notes.filter((n) => n.start >= gOverB.start && n.start < gOverB.end);
  assert.equal(bassUnder[0].pitch % 12, 11);
});

test("the render is stereo 44.1 kHz, stems sum to the mix within 16-bit rounding, and it is deterministic", () => {
  const spec = { ...specById("composed-country-a-major-2-beat-112"), sections: [{ label: "verse", chords: ["A", "D", "E7", "A"] }] };
  const work = composeWork(spec);
  const a = renderGoldWork(work);
  const b = renderGoldWork(work);
  assert.equal(a.mixSha256, b.mixSha256);
  assert.equal(a.sampleRate, 44_100);
  assert.equal(a.channels, 2);
  assert.equal(a.stems.length, work.tracks.length);
  const mix = decodeWavPcm16(a.mix);
  const stems = a.stems.map((s) => decodeWavPcm16(s.wav));
  let maxError = 0;
  for (let i = 0; i < mix.left.length; i += 1000) {
    const sum = stems.reduce((s, st) => s + st.left[i], 0);
    maxError = Math.max(maxError, Math.abs(sum - mix.left[i]));
  }
  assert.ok(maxError < stems.length / 32_767 + 1e-4, `stems sum to the mix (max error ${maxError})`);
  assert.ok(a.durationSeconds > work.endSeconds);
});

// ---------------------------------------------------------------------------
// PDMX truth extraction on a synthetic ParsedMidi
// ---------------------------------------------------------------------------

function fakeMidi(): ParsedMidi {
  // 1/4 pickup then 4/4; 120 BPM for two bars then 90; one key signature; two tracks.
  const tpq = 480;
  const notes: ParsedMidi["notes"] = [];
  const add = (track: number, channel: number, program: number, pitch: number, startTick: number, endTick: number) =>
    notes.push({ track, channel, program, isPercussion: channel === 9, pitch, velocity: 90, startTick, endTick });
  add(0, 0, 0, 67, 0, 480); // the pickup note
  for (let bar = 0; bar < 20; bar += 1) {
    const base = 480 + bar * 1920;
    for (let beat = 0; beat < 4; beat += 1) {
      add(0, 0, 0, 60 + (beat % 3) * 2, base + beat * 480, base + beat * 480 + 400);
      add(1, 1, 33, 36, base + beat * 480, base + beat * 480 + 300);
      add(2, 9, 0, beat % 2 ? 38 : 36, base + beat * 480, base + beat * 480 + 60);
    }
  }
  return {
    ticksPerQuarter: tpq, format: 1, trackCount: 3, notes,
    tempos: [{ tick: 0, usPerQuarter: 500_000, bpm: 120 }, { tick: 480 + 2 * 1920, usPerQuarter: 666_667, bpm: 90 }],
    timeSignatures: [{ tick: 0, numerator: 1, denominator: 4 }, { tick: 480, numerator: 4, denominator: 4 }],
    endTick: 480 + 20 * 1920,
    keySignatures: [{ tick: 0, fifths: -3, minorFlag: false }],
    markers: [],
  };
}

test("pdmxGold: the pickup is not a downbeat, the tempo map follows the file, the key is only a signature", () => {
  const midi = fakeMidi();
  const result = pdmxGold(midi, { maxSeconds: 90, minSeconds: 10, minNotes: 20 })!;
  assert.ok(result);
  const t = result.truth;
  assert.equal(t.metre!.pickupBar, true);
  assert.equal(t.metre!.pickupBeats, 1);
  assert.equal(t.beats![0], 0);
  assert.equal(t.downbeats![0], 0.5);
  assert.equal(t.metre!.numerator, 4);
  assert.deepEqual(t.tempo!.map.map((p) => p.bpm), [120, 90]);
  assert.equal(t.tempo!.map[1].time, 4.5); // a 0.5 s pickup and two 2 s bars at 120
  assert.equal(t.tempo!.bpm, 90, "90 BPM lasts longer");
  assert.equal(t.key, null);
  assert.equal(t.keySignature!.fifths, -3);
  assert.equal(t.chords, null);
  assert.equal(t.sections, null);
  const coverage = coverageOf(t);
  assert.equal(coverage.key, "PARTIAL");
  assert.equal(coverage.chords, "UNKNOWN");
  assert.equal(coverage.notes, "EXACT");
  assert.equal(t.notes!.tracks.length, 3);
  assert.ok(t.notes!.tracks.some((tr) => tr.percussion));
  const clock = makeTickClock(midi);
  assert.equal(Number(clock(480 + 2 * 1920).toFixed(3)), 4.5);
});

test("pdmxGold: a long score is trimmed to a downbeat at or before the window, and a thin one is refused", () => {
  const result = pdmxGold(fakeMidi(), { maxSeconds: 20, minSeconds: 10, minNotes: 20 })!;
  assert.ok(result.trimmed);
  assert.ok(result.endSeconds <= 20);
  assert.ok(result.truth.downbeats!.every((d) => d < result.endSeconds));
  assert.ok(result.truth.notes!.tracks.every((tr) => tr.notes.every(([start, duration]) => start + duration <= result.endSeconds + 1e-6)));
  assert.equal(pdmxGold(fakeMidi(), { maxSeconds: 90, minSeconds: 200 }), null);
  assert.equal(pdmxGold(fakeMidi(), { maxSeconds: 90, minSeconds: 10, minNotes: 10_000 }), null);
});

test("a composed item passes manifest validation as SYNTHETIC_EXACT", () => {
  const work = composeWork(specById("composed-reggae-g-major-76"));
  const item: GoldItem = {
    id: "x", tier: "SYNTHETIC_EXACT", title: "x", genreFamily: "reggae_ska",
    source: { kind: "composed", generator: "test", spec: "x" },
    audio: { mix: { path: "x.wav", sha256: "0".repeat(64), bytes: 1 }, stems: [], sampleRate: 44_100, channels: 2, durationSeconds: 1, renderer: "test" },
    truth: work.truth, coverage: coverageOf(work.truth),
  };
  assert.deepEqual(validateManifest({ version: ANALYSIS_GOLD_VERSION, builtAt: "now", items: [item] }), []);
});
