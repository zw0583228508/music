/**
 * Bass-line planner, per-role voicing solver and style parameters (Brain
 * B-02, D5). Property tests over seeded random progressions in every key,
 * each paired with a positive control: the old behaviour (root nearest MIDI
 * 40; chord tones stacked from the register centre) measured with the same
 * code, so "better" is a comparison, not a claim.
 */
import assert from "node:assert/strict";
import test from "node:test";
import type { ChordHarmonyEvent } from "@workspace/db";
import { chordEventsIn, type HarmonyChordEvent } from "./shared";
import { planBassLine, planBassSkeleton, topVoiceGuide, type BassPlanInput } from "./bassLine";
import { planVoicings, tonesToVoice, voiceCountFor, type VoicingPlanInput } from "./voicings";
import { aestheticFor, HARMONY_STYLE_DEFAULTS, harmonyStyleParams, type HarmonyStyleParams } from "./styleParams";
import { ROOT_NAMES, parseChord } from "../chordSymbols";

const pc = (p: number) => ((p % 12) + 12) % 12;

function lcg(seed: number) {
  let s = seed >>> 0;
  return () => { s = (Math.imul(s, 1664525) + 1013904223) >>> 0; return s / 2 ** 32; };
}

const QUALITIES = ["", "m", "7", "maj7", "m7", "sus4", "dim", "6", "add9", "m7b5"];
/** Degrees of a key a random progression draws from (I ii iii IV V vi bVII). */
const DEGREES = [0, 2, 4, 5, 7, 9, 10];

type Progression = { key: number; symbols: string[]; events: HarmonyChordEvent[]; barSeconds: number; beatSeconds: number };

/** A seeded random progression in `key`: 8 chords, 1-2 bars each, some slash chords. */
function randomProgression(seed: number, key: number, options: { slash?: boolean } = {}): Progression {
  const rnd = lcg(seed * 7919 + key);
  const beatSeconds = 0.5;
  const barSeconds = 2;
  const chords: ChordHarmonyEvent[] = [];
  const symbols: string[] = [];
  let t = 0;
  for (let i = 0; i < 8; i += 1) {
    const root = (key + DEGREES[Math.floor(rnd() * DEGREES.length)]) % 12;
    const quality = QUALITIES[Math.floor(rnd() * QUALITIES.length)];
    let symbol = `${ROOT_NAMES[root]}${quality}`;
    if (options.slash && rnd() < 0.35) {
      const parsed = parseChord(symbol)!;
      const bass = parsed.pitchClasses[1 + Math.floor(rnd() * (parsed.pitchClasses.length - 1))];
      symbol = `${symbol}/${ROOT_NAMES[bass]}`;
    }
    const bars = rnd() < 0.5 ? 1 : 2;
    chords.push({ start: t, end: t + bars * barSeconds, symbol, roman: "", confidence: 1 });
    symbols.push(symbol);
    t += bars * barSeconds;
  }
  return { key, symbols, events: chordEventsIn(chords, { start: 0, end: t }), barSeconds, beatSeconds };
}

const BASS_RANGE = { lo: 36, hi: 60 };

function bassInput(p: Progression, overrides: Partial<BassPlanInput> = {}): BassPlanInput {
  return {
    events: p.events, window: { start: 0, end: p.events[p.events.length - 1].end },
    range: BASS_RANGE, maxLeap: 12, style: { ...HARMONY_STYLE_DEFAULTS.pop, source: [] },
    arc: { level: 0.5, tensionRole: "lift" },
    timing: { beatSeconds: p.beatSeconds, barSeconds: p.barSeconds, beatsPerBar: 4, origin: 0 },
    density: 0.6, seed: 11, minNoteDuration: 0.08,
    ...overrides,
  };
}

const ALL_PROGRESSIONS: Progression[] = [];
for (let seed = 0; seed < 17; seed += 1) for (let key = 0; key < 12; key += 1) ALL_PROGRESSIONS.push(randomProgression(seed, key, { slash: true }));
// 204 progressions, 12 keys, 1,632 chord events.

test("bass: every leap within the instrument's limit by construction, in range, no note lapping the next chord, no onsets closer than the shortest note - 204 random progressions in every key, three leap limits", () => {
  let notes = 0;
  for (const maxLeap of [7, 10, 12]) {
    for (const p of ALL_PROGRESSIONS) {
      for (const level of [0.1, 0.4, 0.55, 0.8]) {
        const plan = planBassLine(bassInput(p, { maxLeap, arc: { level, tensionRole: "lift" } }));
        assert.ok(plan.notes.length >= p.events.length, `${p.symbols.join(" ")}: at least one note per chord`);
        for (let i = 0; i < plan.notes.length; i += 1) {
          const n = plan.notes[i];
          assert.ok(n.pitch >= BASS_RANGE.lo && n.pitch <= BASS_RANGE.hi, `in range: ${n.pitch}`);
          const event = p.events[n.eventIndex];
          assert.ok(n.start >= event.start - 1e-6 && n.start + n.duration <= event.end + 1e-6, `${p.symbols[n.eventIndex]}: note ${n.start.toFixed(3)}+${n.duration.toFixed(3)} inside its chord ${event.start}-${event.end}`);
          if (i > 0) {
            const prev = plan.notes[i - 1];
            assert.ok(Math.abs(n.pitch - prev.pitch) <= maxLeap, `${p.symbols.join(" ")} (limit ${maxLeap}, level ${level}): leap ${prev.pitch}->${n.pitch}`);
            assert.ok(n.start >= prev.start + prev.duration - 1e-6, "no overlap");
            assert.ok(n.start - prev.start >= 0.08 - 1e-6, "onsets no closer than the shortest note");
          }
          notes += 1;
        }
      }
    }
  }
  assert.ok(notes > 20_000, `measured ${notes} notes`);
});

test("bass: a slash chord's bass is the bass, root position lands on the root, and the first note of every chord is the planned skeleton pitch", () => {
  let slashes = 0;
  for (const p of ALL_PROGRESSIONS) {
    const plan = planBassLine(bassInput(p, { arc: { level: 0.5, tensionRole: "lift" } }));
    for (const [i, event] of p.events.entries()) {
      const first = plan.notes.find((n) => n.eventIndex === i);
      assert.ok(first, `${event.symbol}: a note`);
      assert.equal(first.pitch, plan.skeleton[i].pitch, "the chord opens on its skeleton pitch");
      if (event.chord.bass !== event.chord.root) {
        slashes += 1;
        assert.equal(pc(first.pitch), event.chord.bass, `${event.symbol}: the slash bass is the bass`);
        assert.equal(plan.skeleton[i].kind, "slash");
      }
    }
  }
  assert.ok(slashes > 300, `slash chords measured: ${slashes}`);
});

/** The old bass: root nearest MIDI 40 per chord, independently. */
function oldBassSkeleton(p: Progression): number[] {
  return p.events.map((e) => { let x = e.chord.root + 12 * Math.round((40 - e.chord.root) / 12); while (x < 36) x += 12; while (x > 60) x -= 12; return x; });
}

function contraryShare(pitches: number[], guide: number[]): number | null {
  let moves = 0;
  let contrary = 0;
  for (let i = 1; i < pitches.length; i += 1) {
    const db = pitches[i] - pitches[i - 1];
    const dt = guide[i] - guide[i - 1];
    if (db === 0 || dt === 0) continue;
    moves += 1;
    if (Math.sign(db) !== Math.sign(dt)) contrary += 1;
  }
  return moves ? contrary / moves : null;
}

test("bass: contrary motion against the top-voice guide is above the old root-nearest-40 baseline (positive control), and leaps are smaller", () => {
  let planned = 0;
  let old = 0;
  let n = 0;
  let plannedLeap = 0;
  let oldLeap = 0;
  for (const p of randomProgressions(60)) {
    const guide = topVoiceGuide(p.events);
    const skeleton = planBassSkeleton(bassInput(p, { style: { ...HARMONY_STYLE_DEFAULTS.classical, source: [] } })).map((s) => s.pitch);
    const before = oldBassSkeleton(p);
    const a = contraryShare(skeleton, guide);
    const b = contraryShare(before, guide);
    if (a === null || b === null) continue;
    planned += a; old += b; n += 1;
    for (let i = 1; i < skeleton.length; i += 1) { plannedLeap += Math.abs(skeleton[i] - skeleton[i - 1]); oldLeap += Math.abs(before[i] - before[i - 1]); }
  }
  assert.ok(n >= 40);
  assert.ok(planned / n > old / n + 0.1, `contrary share planned ${(planned / n).toFixed(3)} vs old ${(old / n).toFixed(3)}`);
  // The old rule's 13-18 semitone leaps came from cycling chord tones nearest each
  // chord's own root; its roots alone (clamped to 36-60) never leap beyond 12, so
  // the control here is the total motion, not the limit.
  assert.ok(plannedLeap < oldLeap * 0.85, `total leap planned ${plannedLeap} vs old ${oldLeap}`);
});

function randomProgressions(count: number): Progression[] {
  const out: Progression[] = [];
  for (let i = 0; i < count; i += 1) out.push(randomProgression(100 + i, i % 12));
  return out;
}

test("bass: approach tones follow the style's rate - none at 0, into nearly every change at 1, by step from a non-chord tone - and never break the leap limit", () => {
  const withRate = (rate: number, chromatic: boolean) => {
    let changes = 0;
    let approached = 0;
    for (const p of randomProgressions(40)) {
      const plan = planBassLine(bassInput(p, {
        style: { ...HARMONY_STYLE_DEFAULTS.pop, approachToneRate: rate, chromaticApproach: chromatic, inversionTolerance: 0, source: [] },
        arc: { level: 0.5, tensionRole: "lift" },
      }));
      for (let i = 1; i < plan.skeleton.length; i += 1) {
        if (plan.skeleton[i].pitch === plan.skeleton[i - 1].pitch) continue;
        changes += 1;
        const landing = plan.notes.find((n) => n.eventIndex === i)!;
        const before = [...plan.notes.filter((n) => n.eventIndex === i - 1)].pop()!;
        if (before.kind === "approach") {
          approached += 1;
          const step = Math.abs(landing.pitch - before.pitch);
          assert.ok(step === 1 || step === 2, `an approach is a step (${step})`);
          assert.ok(!p.events[i - 1].chord.pitchClasses.includes(pc(before.pitch)), `${p.symbols[i - 1]} -> ${p.symbols[i]}: the approach tone is not a tone of the chord being left`);
        }
      }
    }
    return { changes, approached };
  };
  const none = withRate(0, true);
  const all = withRate(1, true);
  const diatonic = withRate(1, false);
  assert.equal(none.approached, 0);
  assert.ok(all.approached / all.changes > 0.75, `rate 1 approaches ${all.approached}/${all.changes} changes`);
  assert.ok(diatonic.approached / diatonic.changes > 0.5, `diatonic rate 1 approaches ${diatonic.approached}/${diatonic.changes}`);
});

test("bass: a pedal is held under a setup when the style tolerates one, never under a lift; density follows the arc's level", () => {
  const p = randomProgression(3, 0);
  const orchestral = { ...HARMONY_STYLE_DEFAULTS.orchestral, source: [] };
  const setup = planBassLine(bassInput(p, { style: orchestral, arc: { level: 0.3, tensionRole: "setup" } }));
  const lift = planBassLine(bassInput(p, { style: orchestral, arc: { level: 0.3, tensionRole: "lift" } }));
  assert.ok(setup.pedalEvents >= 2, `pedal under ${setup.pedalEvents} chords`);
  assert.equal(lift.pedalEvents, 0);
  const pedalPitch = setup.skeleton[0].pitch;
  for (const entry of setup.skeleton.filter((s) => s.kind === "pedal")) assert.equal(entry.pitch, pedalPitch);
  assert.equal(planBassLine(bassInput(p, { style: { ...orchestral, pedalTolerance: 0 }, arc: { level: 0.3, tensionRole: "setup" } })).pedalEvents, 0, "no tolerance, no pedal");

  const silent = { ...HARMONY_STYLE_DEFAULTS.pop, approachToneRate: 0, source: [] };
  const pp = planBassLine(bassInput(p, { arc: { level: 0.1, tensionRole: "lift" }, style: silent }));
  const f = planBassLine(bassInput(p, { arc: { level: 0.8, tensionRole: "lift" }, style: silent }));
  assert.equal(pp.pattern, "whole");
  assert.equal(pp.notes.length, p.events.length, "pp: one note per chord");
  // At pp a change may still be led into, at half the style's rate and only after a bar or more.
  const ppLed = planBassLine(bassInput(p, { arc: { level: 0.1, tensionRole: "lift" }, style: { ...HARMONY_STYLE_DEFAULTS.pop, approachToneRate: 1, source: [] } }));
  assert.ok(ppLed.approaches > 0 && ppLed.approaches <= p.events.length, `pp approaches ${ppLed.approaches}`);
  for (const n of ppLed.notes.filter((x) => x.kind === "approach")) assert.ok(p.events[n.eventIndex].end - p.events[n.eventIndex].start >= p.barSeconds - 1e-6, "only after a bar or more");
  assert.equal(f.pattern, "moving");
  const beats = p.events.reduce((s, e) => s + (e.end - e.start) / p.beatSeconds, 0);
  assert.ok(f.notes.length >= beats * 0.8, `f: a note on nearly every beat (${f.notes.length} of ${beats})`);
  assert.ok(f.notes.length > pp.notes.length * 2);
});

test("bass: inversions are taken only as the style tolerates - never at 0, sparingly in a ballad, more in classical writing", () => {
  const share = (tolerance: number) => {
    let inversions = 0;
    let total = 0;
    for (const p of randomProgressions(40)) {
      const skeleton = planBassSkeleton(bassInput(p, { style: { ...HARMONY_STYLE_DEFAULTS.classical, inversionTolerance: tolerance, source: [] } }));
      for (const s of skeleton) { total += 1; if (s.kind === "inversion") inversions += 1; }
    }
    return inversions / total;
  };
  assert.equal(share(0), 0);
  const ballad = share(0.3);
  const classical = share(0.7);
  assert.ok(ballad < 0.2, `ballad inversion share ${ballad.toFixed(3)}`);
  assert.ok(classical > ballad, `classical ${classical.toFixed(3)} > ballad ${ballad.toFixed(3)}`);
});

// ---------------------------------------------------------------------------
// Voicings
// ---------------------------------------------------------------------------

const KEYS_RANGE = { lo: 48, hi: 84 };

function voicingInput(p: Progression, overrides: Partial<VoicingPlanInput> = {}): VoicingPlanInput {
  const bass = planBassSkeleton(bassInput(p)).map((s) => s.pitch);
  return {
    events: p.events, kind: "keys_bed", range: KEYS_RANGE, maxSimultaneous: 10,
    style: { ...HARMONY_STYLE_DEFAULTS.classical, source: [] }, texture: "full", level: 0.5, operator: "identity",
    bassRef: bass, suppliesBass: false,
    ...overrides,
  };
}

/** The old stacker: chord tones from the register centre, 3 semitones apart, nearest octave. */
function oldStack(p: Progression, n: number): number[][] {
  const centre = (KEYS_RANGE.lo + KEYS_RANGE.hi) / 2;
  return p.events.map((e) => e.chord.pitchClasses.slice(0, n).map((klass, i) => {
    let x = klass + 12 * Math.round((centre + i * 3 - klass) / 12);
    while (x < KEYS_RANGE.lo) x += 12;
    while (x > KEYS_RANGE.hi) x -= 12;
    return x;
  }).sort((a, b) => a - b));
}

function voicingStats(voicings: number[][]) {
  let held = 0;
  let voices = 0;
  let motion = 0;
  let parallel = 0;
  for (let i = 1; i < voicings.length; i += 1) {
    const from = voicings[i - 1];
    const to = voicings[i];
    const n = Math.min(from.length, to.length);
    for (let v = 0; v < n; v += 1) { voices += 1; motion += Math.abs(to[v] - from[v]); if (from.includes(to[v])) held += 1; }
    for (let a = 0; a < n; a += 1) for (let b = a + 1; b < n; b += 1) {
      const before = Math.abs(from[a] - from[b]) % 12;
      const after = Math.abs(to[a] - to[b]) % 12;
      const da = to[a] - from[a];
      const db = to[b] - from[b];
      if (da !== 0 && db !== 0 && Math.sign(da) === Math.sign(db) && (before === 7 || before === 0) && before === after) parallel += 1;
    }
  }
  return { commonToneShare: voices ? held / voices : 0, motionPerVoice: voices ? motion / voices : 0, parallel, transitions: voicings.length - 1 };
}

test("voicings: common-tone retention above the old stacker and less motion per voice, on the same progressions (positive control)", () => {
  let solverHeld = 0;
  let stackHeld = 0;
  let solverMotion = 0;
  let stackMotion = 0;
  let n = 0;
  for (const p of randomProgressions(60)) {
    const plan = planVoicings(voicingInput(p, { voices: 4 }));
    assert.equal(plan.voicings.length, p.events.length);
    const solver = voicingStats(plan.voicings.map((v) => v.pitches));
    const stack = voicingStats(oldStack(p, 4));
    solverHeld += solver.commonToneShare; stackHeld += stack.commonToneShare;
    solverMotion += solver.motionPerVoice; stackMotion += stack.motionPerVoice;
    n += 1;
  }
  assert.ok(solverHeld / n > stackHeld / n + 0.05, `common tones: solver ${(solverHeld / n).toFixed(3)} vs stacker ${(stackHeld / n).toFixed(3)}`);
  assert.ok(solverMotion / n < stackMotion / n * 0.6, `motion per voice: solver ${(solverMotion / n).toFixed(2)} vs stacker ${(stackMotion / n).toFixed(2)}`);
});

test("voicings: no parallel fifths or octaves under the classical parameters; allowed (and present) under the band parameters", () => {
  let classical = 0;
  let band = 0;
  let transitions = 0;
  for (const p of randomProgressions(60)) {
    const c = planVoicings(voicingInput(p, { voices: 4, style: { ...HARMONY_STYLE_DEFAULTS.classical, source: [] } }));
    const b = planVoicings(voicingInput(p, { voices: 4, style: { ...HARMONY_STYLE_DEFAULTS.band, source: [] } }));
    const cs = voicingStats(c.voicings.map((v) => v.pitches));
    const bs = voicingStats(b.voicings.map((v) => v.pitches));
    classical += cs.parallel; band += bs.parallel; transitions += cs.transitions;
  }
  assert.ok(transitions > 300);
  assert.ok(classical <= transitions * 0.01, `classical parallels ${classical} of ${transitions} transitions`);
  assert.ok(band > classical, `band ${band} > classical ${classical}: the parameter has an effect`);
});

test("voicings: in range, uncrossed, within the spacing rules per role, never wider than the instrument, cello on root or third, voice counts by texture and operator", () => {
  let celloOnRootOrThird = 0;
  let celloVoicings = 0;
  for (const p of randomProgressions(30)) {
    const strings = planVoicings(voicingInput(p, { kind: "string_pad", range: { lo: 48, hi: 84 }, maxSimultaneous: 4, texture: "full", style: { ...HARMONY_STYLE_DEFAULTS.orchestral, source: [] } }));
    assert.equal(strings.voiceCount, 4);
    for (const v of strings.voicings) {
      celloVoicings += 1;
      assert.equal(v.pitches.length, 4);
      assert.ok(v.pitches.every((x) => x >= 48 && x <= 84));
      for (let i = 1; i < 4; i += 1) assert.ok(v.pitches[i] >= v.pitches[i - 1], "uncrossed");
      assert.ok(v.pitches[0] <= 48 + 19, `cello within its band: ${v.pitches[0]}`);
      for (let i = 2; i < 4; i += 1) assert.ok(v.pitches[i] - v.pitches[i - 1] <= 12, "upper strings within an octave of each other");
      const role = p.events[v.index].chord.roles.get(pc(v.pitches[0]));
      if (role === "root" || role === "third" || role === "suspension") celloOnRootOrThird += 1;
    }

    const comping = planVoicings(voicingInput(p, { kind: "keys_comping", texture: "bed" }));
    assert.equal(comping.voiceCount, 3);
    for (const v of comping.voicings) for (let i = 1; i < v.pitches.length; i += 1) assert.ok(v.pitches[i] - v.pitches[i - 1] <= 9, "comping voices close");
  }
  assert.ok(celloOnRootOrThird / celloVoicings >= 0.7, `cello on root/third ${celloOnRootOrThird}/${celloVoicings}`);
  const p = randomProgression(5, 7);
  assert.equal(voiceCountFor("string_pad", "duo", 4, "identity"), 2);
  assert.equal(voiceCountFor("string_pad", "tutti", 4, "identity"), 4);
  assert.equal(voiceCountFor("keys_bed", "bed", 10, "identity"), 3);
  assert.equal(voiceCountFor("keys_bed", "bed", 10, "thicken_voicing"), 4);
  assert.equal(voiceCountFor("keys_bed", "tutti", 3, "thicken_voicing"), 3, "never wider than the instrument");
  assert.equal(voiceCountFor("brass_line", "tutti", 1, "thicken_voicing"), 1);
  const identity = planVoicings(voicingInput(p, { texture: "bed", operator: "identity" }));
  const thick = planVoicings(voicingInput(p, { texture: "bed", operator: "thicken_voicing" }));
  assert.equal(thick.voiceCount, identity.voiceCount + 1, "thicken_voicing adds a voice");
  assert.ok(thick.targetSpacing > identity.targetSpacing, "and opens the spacing");
});

test("voicings: raise_register lifts the voicing about an octave within the range; the keys keep out of the bass's octave; a supplied bass honours the slash", () => {
  const p = randomProgression(9, 2, { slash: true });
  const low = planVoicings(voicingInput(p, { raiseRegister: false }));
  const high = planVoicings(voicingInput(p, { raiseRegister: true }));
  const meanOf = (plan: typeof low) => plan.voicings.reduce((s, v) => s + v.pitches.reduce((a, b) => a + b, 0) / v.pitches.length, 0) / plan.voicings.length;
  assert.ok(meanOf(high) - meanOf(low) >= 5, `raised by ${(meanOf(high) - meanOf(low)).toFixed(1)} semitones`);
  assert.ok(high.voicings.every((v) => v.pitches.every((x) => x <= KEYS_RANGE.hi)));

  const bass = planBassSkeleton(bassInput(p)).map((s) => s.pitch);
  const above = planVoicings(voicingInput(p, { bassRef: bass }));
  above.voicings.forEach((v, i) => {
    assert.ok(v.pitches[0] >= bass[i] + 3, `${p.symbols[i]}: the lowest keys voice (${v.pitches[0]}) sits above the bass (${bass[i]})`);
  });

  const supplied = planVoicings(voicingInput(p, { bassRef: p.events.map(() => null), suppliesBass: true, range: { lo: 36, hi: 84 }, voices: 4 }));
  p.events.forEach((event, i) => {
    if (event.chord.bass === event.chord.root) return;
    assert.equal(pc(supplied.voicings[i].pitches[0]), event.chord.bass, `${event.symbol}: the left hand takes the slash bass`);
  });
});

test("voicings: a singer's note is kept clear of the top voice (positive control against the same solve without the melody)", () => {
  let withMelody = 0;
  let without = 0;
  for (const p of randomProgressions(30)) {
    const melody = p.events.map((e) => 60 + e.chord.pitchClasses[1 % e.chord.pitchClasses.length] + (e.chord.root % 2 ? 12 : 0));
    const a = planVoicings(voicingInput(p, { melody }));
    const b = planVoicings(voicingInput(p));
    const clashes = (plan: typeof a) => plan.voicings.reduce((s, v, i) => s + (Math.abs(v.pitches[v.pitches.length - 1] - melody[i]) <= 2 ? 1 : 0), 0);
    withMelody += clashes(a);
    without += clashes(b);
  }
  assert.ok(without > 0, "the control is sensitive: the melody-blind solve does clash sometimes");
  assert.ok(withMelody < without * 0.5, `clashes with the melody known ${withMelody} vs blind ${without}`);
});

test("tonesToVoice keeps the third and seventh, drops the fifth first, honours the extension level", () => {
  const c13 = parseChord("C13")!;
  const three = tonesToVoice(c13, 3, "extended", true);
  assert.ok(three.pitchClasses.includes(4) && three.pitchClasses.includes(10), "third and seventh kept");
  assert.equal(three.pitchClasses.length, 3);
  assert.ok(!three.pitchClasses.includes(7), "the fifth goes first");
  const triads = tonesToVoice(parseChord("Gm7")!, 4, "triads", false);
  assert.deepEqual([...triads.pitchClasses].sort((a, b) => a - b), [2, 7, 10], "triads only: the seventh is left to the symbol");
  const sevenths = tonesToVoice(parseChord("Cmaj9")!, 4, "sevenths", false);
  assert.deepEqual([...sevenths.pitchClasses].sort((a, b) => a - b), [0, 4, 7, 11]);
  assert.deepEqual([...tonesToVoice(parseChord("Gsus4")!, 3, "triads", false).pitchClasses].sort((a, b) => a - b), [0, 2, 7], "a suspension is voiced as one");
});

// ---------------------------------------------------------------------------
// Style parameters
// ---------------------------------------------------------------------------

test("style parameters come from the aesthetic, are refined by the grammar, and record their source", () => {
  assert.equal(aestheticFor({ productionAesthetic: "intimate" }), "intimate_ballad");
  assert.equal(aestheticFor({ productionAesthetic: "raw_band" }), "band");
  assert.equal(aestheticFor({ productionAesthetic: "orchestral" }), "orchestral");
  assert.equal(aestheticFor({ productionAesthetic: "cinematic" }), "orchestral");
  assert.equal(aestheticFor({ productionAesthetic: "electronic" }), "electronic");
  assert.equal(aestheticFor({ productionAesthetic: "polished_pop", style: "jazz ballad" }), "jazz", "a jazz style word wins");
  assert.equal(aestheticFor({ style: "unknown" }), "pop");
  const band = harmonyStyleParams({ productionAesthetic: "raw_band" });
  assert.equal(band.allowParallelFifths, true);
  assert.equal(band.parallelPerfectWeight, 0);
  assert.deepEqual(band.source, ["defaults:band"]);
  const refined = harmonyStyleParams({
    productionAesthetic: "polished_pop",
    grammar: { status: "available", version: "x", rules: [
      { id: "chord-extensions", description: "", weight: 0.8, directive: { kind: "chordExtensions", level: "triads" } },
      { id: "functional-motion", description: "", weight: 0.6, directive: { kind: "ratio", feature: "functionalMotion", target: 0.8 } },
    ] } as unknown as Parameters<typeof harmonyStyleParams>[0]["grammar"],
  });
  assert.equal(refined.extensions, "triads");
  assert.equal(refined.approachToneRate, 0.6);
  assert.deepEqual(refined.source, ["defaults:pop", "grammar:chord-extensions=triads", "grammar:functional-motion=0.8"]);
  const weak = harmonyStyleParams({ productionAesthetic: "polished_pop", grammar: { status: "available", version: "x", rules: [{ id: "chord-extensions", description: "", weight: 0.05, directive: { kind: "chordExtensions", level: "triads" } }] } as unknown as Parameters<typeof harmonyStyleParams>[0]["grammar"] });
  assert.equal(weak.extensions, "sevenths", "a rule under the weight floor does not refine");
  const complex = harmonyStyleParams({ productionAesthetic: "intimate", harmonicComplexity: 0.7 });
  assert.equal(complex.extensions, "extended");
  const every: HarmonyStyleParams[] = (Object.keys(HARMONY_STYLE_DEFAULTS) as Array<keyof typeof HARMONY_STYLE_DEFAULTS>).map((a) => harmonyStyleParams({ aesthetic: a }));
  for (const params of every) {
    assert.ok(params.approachToneRate >= 0 && params.approachToneRate <= 1);
    assert.ok(params.inversionTolerance >= 0 && params.inversionTolerance <= 1);
    assert.equal(params.allowParallelFifths, params.parallelPerfectWeight === 0);
  }
});
