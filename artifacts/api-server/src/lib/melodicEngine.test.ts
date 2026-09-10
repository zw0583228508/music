/**
 * Melodic engine (Brain B-10, D4): answers never over a sung window; contrary /
 * oblique motion against a moving bass on 200 random progressions with a
 * positive control; a fifth clear of the singer; recall across statements of
 * a section; the instrumental lead; withholding; chord tones on strong
 * beats; truthful motif metadata; determinism.
 */
import assert from "node:assert/strict";
import test from "node:test";
import type { ChordHarmonyEvent, MusicalNote } from "@workspace/db";
import { chordPitchClasses } from "./composer/harmonyParts";
import {
  answerTransformationFor, chordRootsAsBass, developAfter, isStrongBeat, motionRateVsBass, overlapsVocal, vocalClearance,
  vocalGaps, writeMelodicLine, type MelodicLineRequest,
} from "./melodicEngine";
import { buildMotifLedger, cellOf, classifyTransformation, type MotifLedger, type TimedPitch } from "./motifLedger";

const BPM = 120;
const BEAT = 60 / BPM;
const BAR = BEAT * 4;
const ROOTS: Record<string, number> = { C: 0, D: 2, E: 4, F: 5, G: 7, A: 9, B: 11, Bb: 10, Eb: 3, Ab: 8, Db: 1 };

function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6D2B79F5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function chordsFor(progression: string[], bars: number, barSeconds = BAR): ChordHarmonyEvent[] {
  return Array.from({ length: bars }, (_, i) => ({
    symbol: progression[i % progression.length], start: i * barSeconds, end: (i + 1) * barSeconds, roman: "", confidence: 0.9,
  }));
}

/** A bass that moves on every beat (root, then chord tones up or down) - oblique motion is not free against it. */
function walkingBass(chords: ChordHarmonyEvent[], rng: () => number): TimedPitch[] {
  const out: TimedPitch[] = [];
  for (const chord of chords) {
    const tones = chordPitchClasses(chord);
    const root = 36 + tones[0];
    let pitch = root;
    for (let b = 0; b < 4; b += 1) {
      if (b > 0) {
        const step = tones[Math.floor(rng() * tones.length)];
        const candidates = [step + 36, step + 48].filter((p) => p !== pitch);
        pitch = candidates[Math.floor(rng() * candidates.length)] ?? pitch + (rng() < 0.5 ? 2 : -2);
      }
      out.push({ start: chord.start + b * BEAT, end: chord.start + (b + 1) * BEAT - 0.02, pitch });
    }
  }
  return out;
}

/** The singer: a rising four-note cell in the first half of every two-bar phrase, silent in the second half. */
function singer(bars: number, cell = [60, 62, 64, 67], phraseBars = 2): Array<MusicalNote & { confidence: number }> {
  const notes: Array<MusicalNote & { confidence: number }> = [];
  for (let bar = 0; bar < bars; bar += phraseBars) {
    cell.forEach((pitch, k) => notes.push({
      id: `v${bar}-${k}`, start: bar * BAR + k * BEAT, duration: BEAT * 0.9, pitch, velocity: 92, confidence: 0.9,
    }));
  }
  return notes;
}
const timed = (notes: ReadonlyArray<{ start: number; duration: number; pitch: number }>): TimedPitch[] =>
  notes.map((n) => ({ start: n.start, end: n.start + n.duration, pitch: n.pitch }));

function ledgerOf(melody: Array<MusicalNote & { confidence: number }>, chords: ChordHarmonyEvent[], sections?: Parameters<typeof buildMotifLedger>[0]["sections"]): MotifLedger {
  return buildMotifLedger({
    songModel: { melody: melody.map((n) => ({ start: n.start, end: n.start + n.duration, pitch: n.pitch, velocity: n.velocity, confidence: n.confidence, source: "test" })), chords, sections: [] },
    sections, beatSeconds: BEAT,
  });
}

function request(over: Partial<MelodicLineRequest> & Pick<MelodicLineRequest, "kind" | "window" | "chords" | "ledger">): MelodicLineRequest {
  return {
    beatSeconds: BEAT, beatsPerBar: 4, originSeconds: 0,
    range: { lo: 55, hi: 96 }, maxLeap: 12, minNoteDuration: 0.05,
    vocal: [], bass: chordRootsAsBass(over.chords), bassReference: "chord_roots",
    section: { name: "Verse", function: "verse", occurrenceIndex: 0, developmentOperator: null, tensionRole: "setup" },
    instrument: "strings", taskId: "task", idPrefix: "task-x", phraseId: "p", baseVelocity: 80, density: 0.5, seed: 7,
    placement: "vocal_gap",
    ...over,
  };
}

test("answers sit in the gaps, never over a sung note, and mirror a rising cell; every note carries truthful motif metadata", () => {
  const chords = chordsFor(["C", "G", "Am", "F"], 8);
  const vocal = singer(8);
  const ledger = ledgerOf(vocal, chords);
  const sung = timed(vocal);
  const gaps = vocalGaps(sung, 0, 8 * BAR, { mergeGap: BEAT / 2, minSeconds: BEAT * 1.5 });
  assert.equal(gaps.length, 4, "four two-bar phrases leave four gaps");
  const release = { name: "Verse", function: "verse", occurrenceIndex: 0, developmentOperator: null, tensionRole: "release" as const };
  const results = gaps.map((gap, i) => writeMelodicLine(request({
    kind: "answer", window: { start: gap.start + BEAT / 2, end: gap.end - BEAT / 4 }, chords, ledger, vocal: sung,
    idPrefix: `task-ans${i}`, phraseId: `gap-${i}`, section: release,
  })));
  const all = results.flatMap((r) => r.notes);
  assert.ok(all.length >= 12, `answers were written (${all.length} notes)`);
  assert.equal(overlapsVocal(timed(all), sung), false, "no answer note overlaps a sung note");
  for (const r of results) assert.equal(r.metrics.overlapsVocal, false);
  const hook = ledger.hook()!;
  for (const n of all) {
    assert.equal(n.motif.id, hook.id, "the answer states the singer's cell");
    assert.equal(n.motif.intention, "response");
    assert.match(n.motif.evidenceSha256, /^[0-9a-f]{64}$/);
    assert.equal(n.motif.parentMotifId, null, "a first statement develops nothing");
    assert.ok(n.motif.phraseId.startsWith("src-phrase-"), "the phrase answered is the source phrase that just ended");
  }
  // A rising cell in a setup section is mirrored: the intended transformation is the inversion.
  assert.equal(answerTransformationFor("rising", "setup", 0).transformation, "inversion");
  assert.equal(answerTransformationFor("rising", "arrival", 0).transformation, "transposition");
  assert.equal(answerTransformationFor("arch", "release", 0).transformation, "retrograde");
  assert.equal(answerTransformationFor("rising", "setup", 1).transformation, "augmentation");
  const first = results[0];
  assert.ok(first.occurrences.length === 1);
  const emitted = cellOf(timed(first.notes), BEAT)!;
  // The label is what was emitted: either the inversion survived chord snapping, or the note says its intervals were adapted.
  const detected = classifyTransformation(hook.cell, emitted);
  assert.equal(first.notes[0].motif.transformation, detected ?? "harmonic_adaptation");
  assert.ok(["inversion", "harmonic_adaptation"].includes(first.notes[0].motif.transformation), first.notes[0].motif.transformation);
  if (first.notes[0].motif.transformation === "inversion") assert.deepEqual(emitted.intervals, hook.cell.intervals.map((i) => -i));
  assert.equal(ledger.data.occurrences.length, 4, "every answer is in the ledger");
  assert.ok(ledger.data.occurrences.every((o) => o.placement === "vocal_gap"));
  // In a setup section (no section order known) the hook is withheld: the answer is a fragment of it, and the decision says so.
  const setup = writeMelodicLine(request({
    kind: "answer", window: { start: gaps[0].start + BEAT / 2, end: gaps[0].end - BEAT / 4 }, chords, ledger: ledgerOf(vocal, chords), vocal: sung,
  }));
  assert.ok(["fragmentation", "harmonic_adaptation"].includes(setup.notes[0].motif.transformation));
  assert.ok(setup.decisions.some((d) => /withheld/.test(d)));
  assert.ok(setup.notes.length < first.notes.length, "a fragment is shorter than the full answer");
});

test("strong beats land on chord tones; passing tones between are at most a step from one", () => {
  const chords = chordsFor(["Dm", "G7", "Cmaj7", "A7"], 8);
  const ledger = ledgerOf(singer(8, [62, 65, 67, 69]), chords);
  const r = writeMelodicLine(request({ kind: "counterline", window: { start: 0, end: 8 * BAR }, chords, ledger, vocal: timed(singer(8, [62, 65, 67, 69])) }));
  assert.ok(r.notes.length >= 12, `counter-line written (${r.notes.length})`);
  for (const n of r.notes) {
    const chord = chords.find((c) => c.start <= n.start + 1e-6 && c.end > n.start + 1e-6)!;
    const tones = chordPitchClasses(chord);
    const pc = ((n.pitch % 12) + 12) % 12;
    if (isStrongBeat(n.start, 0, BEAT, 4)) assert.ok(tones.includes(pc), `strong beat ${n.start.toFixed(2)} pitch ${n.pitch} is a chord tone of ${chord.symbol}`);
    else assert.ok(tones.some((t) => Math.min(Math.abs(t - pc), 12 - Math.abs(t - pc)) <= 2), `weak beat ${n.start.toFixed(2)} pitch ${n.pitch} is within a step of a chord tone of ${chord.symbol}`);
  }
});

test("counter-line: contrary / oblique motion against a walking bass >= 0.6 on 200 random progressions; a parallel line is the positive control", () => {
  const rng = mulberry32(2026);
  const pool = ["C", "Dm", "Em", "F", "G", "Am", "Bb", "Eb", "Ab", "G7", "A7", "Cmaj7"];
  const rates: number[] = [];
  const parallelRates: number[] = [];
  let notesTotal = 0;
  for (let p = 0; p < 200; p += 1) {
    const progression = Array.from({ length: 4 }, () => pool[Math.floor(rng() * pool.length)]);
    const chords = chordsFor(progression, 8);
    const bass = walkingBass(chords, rng);
    const cellRoot = 60 + Math.floor(rng() * 7);
    const vocalCell = [cellRoot, cellRoot + 2 + Math.floor(rng() * 3), cellRoot + 5 + Math.floor(rng() * 3), cellRoot + 3];
    const vocal = singer(8, vocalCell);
    const ledger = ledgerOf(vocal, chords);
    const r = writeMelodicLine(request({
      kind: "counterline", window: { start: 0, end: 8 * BAR }, chords, ledger, vocal: timed(vocal), bass, bassReference: "source_bass",
      seed: p, density: 0.3 + rng() * 0.6,
    }));
    if (!r.metrics.motionVsBass) continue;
    notesTotal += r.notes.length;
    rates.push(r.metrics.motionVsBass.rate);
    // Positive control: a line that shadows the bass a tenth above moves in similar motion by construction.
    const shadow = bass.map((b) => ({ start: b.start, end: b.end, pitch: b.pitch + 16 }));
    parallelRates.push(motionRateVsBass(shadow, bass)!.rate);
  }
  const mean = rates.reduce((s, v) => s + v, 0) / rates.length;
  const share = rates.filter((v) => v >= 0.6).length / rates.length;
  const parallelMean = parallelRates.reduce((s, v) => s + v, 0) / parallelRates.length;
  assert.ok(rates.length >= 190, `the engine wrote a line on ${rates.length} of 200 progressions`);
  assert.ok(mean >= 0.6, `mean contrary+oblique rate ${mean.toFixed(3)} (share >= 0.6: ${share.toFixed(2)}, ${notesTotal} notes)`);
  assert.ok(parallelMean <= 0.2, `the parallel control scores ${parallelMean.toFixed(3)} - the metric separates`);
  assert.ok(mean - parallelMean >= 0.4, `effect ${mean.toFixed(3)} vs ${parallelMean.toFixed(3)}`);
});

test("with the singer present, every concurrent counter-line note is at least a fifth from the sung pitch and above the bass", () => {
  const chords = chordsFor(["C", "G", "Am", "F"], 8);
  // The singer sings continuously (every beat) in the middle register.
  const vocal: Array<MusicalNote & { confidence: number }> = [];
  const cell = [60, 62, 64, 65, 67, 65, 64, 62];
  for (let beat = 0; beat < 32; beat += 1) vocal.push({ id: `v${beat}`, start: beat * BEAT, duration: BEAT * 0.95, pitch: cell[beat % cell.length], velocity: 90, confidence: 0.9 });
  const ledger = ledgerOf(vocal, chords);
  const bass = chordRootsAsBass(chords);
  const r = writeMelodicLine(request({ kind: "counterline", window: { start: 0, end: 8 * BAR }, chords, ledger, vocal: timed(vocal), bass, range: { lo: 55, hi: 103 } }));
  assert.ok(r.notes.length >= 12);
  const clearance = vocalClearance(timed(r.notes), timed(vocal));
  assert.ok(clearance !== null && clearance >= 7, `clearance ${clearance}`);
  assert.equal(r.metrics.vocalClearance, clearance);
  for (const n of r.notes) {
    const b = bass.find((x) => x.start <= n.start + 1e-6 && x.end > n.start + 1e-6)!;
    assert.ok(n.pitch >= b.pitch + 7, `above the bass: ${n.pitch} vs ${b.pitch}`);
    assert.ok(n.pitch >= 55 && n.pitch <= 103);
  }
  // Leaps stay within the instrument's limit.
  for (let i = 1; i < r.notes.length; i += 1) {
    if (r.notes[i].motif.phraseId !== r.notes[i - 1].motif.phraseId) continue;
    assert.ok(Math.abs(r.notes[i].pitch - r.notes[i - 1].pitch) <= 12, `leap ${r.notes[i - 1].pitch}->${r.notes[i].pitch}`);
  }
});

test("recall: the second chorus's counter-line quotes the first chorus's answer, developed, with the lineage on every note", () => {
  const chords = chordsFor(["C", "G", "Am", "F"], 16);
  const vocal = singer(16);
  const ledger = ledgerOf(vocal, chords);
  const sung = timed(vocal);
  const chorus1 = { name: "Chorus", function: "chorus", occurrenceIndex: 0, developmentOperator: null, tensionRole: "arrival" as const };
  const gap = vocalGaps(sung, 0, 8 * BAR, { mergeGap: BEAT / 2, minSeconds: BEAT * 1.5 })[0];
  const answer = writeMelodicLine(request({ kind: "answer", window: { start: gap.start + BEAT / 2, end: gap.end - BEAT / 4 }, chords, ledger, vocal: sung, section: chorus1, instrument: "brass", idPrefix: "c1-ans" }));
  assert.ok(answer.notes.length >= 3);
  const chorus2 = { name: "Chorus 2", function: "chorus", occurrenceIndex: 1, developmentOperator: "activate_counterline" as const, tensionRole: "arrival" as const };
  const line = writeMelodicLine(request({ kind: "counterline", window: { start: 8 * BAR, end: 16 * BAR }, chords, ledger, vocal: sung, section: chorus2, instrument: "strings", idPrefix: "c2-cl" }));
  assert.ok(line.notes.length >= 6);
  const first = line.occurrences[0];
  assert.equal(first.recallOf, answer.occurrences[0].index, "the counter-line's first unit develops the first chorus's answer");
  assert.equal(first.motifId, answer.occurrences[0].motifId);
  assert.notEqual(first.transformation, answer.occurrences[0].transformation, "developed, not copied");
  assert.match(first.reason, /recall of occurrence #0/);
  assert.match(first.reason, /activate_counterline|form memory/);
  for (const n of line.notes.filter((n) => n.id.startsWith("c2-cl-0-"))) {
    assert.equal(n.motif.parentMotifId, answer.occurrences[0].motifId);
    assert.equal(n.motif.intention, "support");
  }
  assert.equal(developAfter("inversion"), "augmentation");
  assert.equal(developAfter("retrograde_inversion"), "transposition");
  // The ledger remembers both, in order, with their sections.
  assert.deepEqual(ledger.data.occurrences.map((o) => o.sectionName).slice(0, 2), ["Chorus", "Chorus 2"]);
});

test("an instrumental section's lead states the hook in the foreground; the hook is withheld to a fragment before the arrival", () => {
  const chords = chordsFor(["C", "G", "Am", "F"], 16);
  const vocal = singer(16);
  const sections = [
    { sectionName: "Intro", startBar: 1, endBar: 4, function: "intro" as const, tensionRole: "setup" as const, startSeconds: 0, endSeconds: 4 * BAR },
    { sectionName: "Chorus", startBar: 5, endBar: 12, function: "chorus" as const, tensionRole: "arrival" as const, startSeconds: 4 * BAR, endSeconds: 12 * BAR },
    { sectionName: "Solo", startBar: 13, endBar: 16, function: "instrumental" as const, tensionRole: "release" as const, startSeconds: 12 * BAR, endSeconds: 16 * BAR },
  ];
  const ledger = ledgerOf(vocal, chords, sections);
  assert.equal(ledger.data.withheld[0]?.untilSectionName, "Chorus");
  const intro = writeMelodicLine(request({
    kind: "lead", window: { start: 0, end: 4 * BAR }, chords, ledger, vocal: [],
    section: { name: "Intro", function: "intro", occurrenceIndex: 0, developmentOperator: null, tensionRole: "setup" }, idPrefix: "intro",
  }));
  assert.ok(intro.notes.length > 0);
  assert.ok(intro.occurrences.every((o) => o.transformation === "fragmentation" || o.transformation === "harmonic_adaptation"), intro.occurrences.map((o) => o.transformation).join(","));
  assert.ok(intro.decisions.some((d) => /withheld/.test(d)), "the withholding is a recorded decision");
  const solo = writeMelodicLine(request({
    kind: "lead", window: { start: 12 * BAR, end: 16 * BAR }, chords, ledger, vocal: [],
    section: { name: "Solo", function: "instrumental", occurrenceIndex: 0, developmentOperator: null, tensionRole: "release" }, idPrefix: "solo",
  }));
  assert.ok(solo.notes.length >= 6);
  assert.ok(solo.notes.every((n) => n.motif.intention === "foreground"));
  assert.ok(solo.occurrences.some((o) => o.transformation !== "fragmentation"), "after the arrival the hook is stated in full");
  // The arc's tension role is realised in the dynamic: a release sits about 4 below a setup, all else equal.
  const meanVelocity = (ns: MusicalNote[]) => ns.reduce((s, n) => s + n.velocity, 0) / ns.length;
  const drop = meanVelocity(intro.notes) - meanVelocity(solo.notes);
  assert.ok(Math.abs(drop - 4) <= 2.5, `release vs setup velocity drop ${drop.toFixed(1)} (expected ~4)`);
});

test("an empty ledger writes nothing and says so; the same request twice gives the same notes", () => {
  const chords = chordsFor(["C", "G"], 4);
  const empty = buildMotifLedger({ songModel: { melody: [], chords: [], sections: [] }, beatSeconds: BEAT });
  const r = writeMelodicLine(request({ kind: "counterline", window: { start: 0, end: 4 * BAR }, chords, ledger: empty }));
  assert.equal(r.notes.length, 0);
  assert.ok(r.decisions.some((d) => /ledger is empty/.test(d)));
  const vocal = singer(8);
  const a = writeMelodicLine(request({ kind: "counterline", window: { start: 0, end: 8 * BAR }, chords: chordsFor(["C", "G", "Am", "F"], 8), ledger: ledgerOf(vocal, chordsFor(["C", "G", "Am", "F"], 8)), vocal: timed(vocal) }));
  const b = writeMelodicLine(request({ kind: "counterline", window: { start: 0, end: 8 * BAR }, chords: chordsFor(["C", "G", "Am", "F"], 8), ledger: ledgerOf(vocal, chordsFor(["C", "G", "Am", "F"], 8)), vocal: timed(vocal) }));
  assert.deepEqual(a.notes, b.notes);
  assert.deepEqual(a.decisions, b.decisions);
  const none = writeMelodicLine(request({ kind: "answer", window: { start: 0, end: BEAT / 2 }, chords, ledger: empty }));
  assert.equal(none.notes.length, 0);
});
