import assert from "node:assert/strict";
import { test } from "node:test";
import {
  ONSET_TOLERANCE_SECONDS,
  amtInstrumentClass,
  amtMatchNotes,
  amtNotesMatch,
  amtScore,
  amtScoreByInstrument,
  amtVerdict,
  buildBenchmarkClip,
  summariseAmtModel,
  tickToSecondsMapper,
  type AmtNote,
} from "./amtBenchmark";
import { writeMidiFile } from "./midiFile";

const note = (over: Partial<AmtNote> = {}): AmtNote => ({
  onset: 0,
  offset: 1,
  pitch: 60,
  program: 0,
  isDrum: false,
  ...over,
});

test("instrument class buckets by GM family, and every drum is one bucket", () => {
  assert.equal(amtInstrumentClass(note({ program: 0 })), "keys");
  assert.equal(amtInstrumentClass(note({ program: 4 })), "keys", "programs 0-7 share a family");
  assert.equal(amtInstrumentClass(note({ program: 33 })), "bass");
  assert.equal(amtInstrumentClass(note({ program: 40 })), "strings");
  // A drum note's program is meaningless; it must not split the drum bucket.
  assert.equal(amtInstrumentClass(note({ program: 0, isDrum: true })), "drums");
  assert.equal(amtInstrumentClass(note({ program: 118, isDrum: true })), "drums");
});

test("onset tolerance is inclusive at exactly 50 ms and excludes past it", () => {
  const reference = note({ onset: 1 });
  assert.equal(amtNotesMatch(reference, note({ onset: 1 + ONSET_TOLERANCE_SECONDS }), "instrument_onset"), true);
  assert.equal(amtNotesMatch(reference, note({ onset: 1 - ONSET_TOLERANCE_SECONDS }), "instrument_onset"), true);
  assert.equal(amtNotesMatch(reference, note({ onset: 1.0501 }), "instrument_onset"), false);
});

test("instrument-aware mode rejects a right note called by the wrong instrument; pitch-only accepts it", () => {
  const reference = note({ program: 0 });
  const wrongFamily = note({ program: 33 });
  assert.equal(amtNotesMatch(reference, wrongFamily, "instrument_onset"), false);
  assert.equal(amtNotesMatch(reference, wrongFamily, "onset"), true);
  // Same family, different program inside it, still matches: no model is being
  // asked to tell Acoustic Grand from Bright Acoustic.
  assert.equal(amtNotesMatch(reference, note({ program: 5 }), "instrument_onset"), true);
});

test("offset rule is the later of 50 ms and 20 % of the reference duration", () => {
  // A 4 s note tolerates 800 ms; a 0.1 s note tolerates the 50 ms floor.
  const long = note({ onset: 0, offset: 4 });
  assert.equal(amtNotesMatch(long, note({ onset: 0, offset: 4.7 }), "instrument_onset_offset"), true);
  assert.equal(amtNotesMatch(long, note({ onset: 0, offset: 4.9 }), "instrument_onset_offset"), false);
  const short = note({ onset: 0, offset: 0.1 });
  assert.equal(amtNotesMatch(short, note({ onset: 0, offset: 0.14 }), "instrument_onset_offset"), true);
  assert.equal(amtNotesMatch(short, note({ onset: 0, offset: 0.2 }), "instrument_onset_offset"), false);
});

test("drum offsets are not scored — both sides emit a convention, not a transcription", () => {
  const reference = note({ isDrum: true, onset: 0, offset: 0.2 });
  const estimate = note({ isDrum: true, onset: 0, offset: 4 });
  assert.equal(amtNotesMatch(reference, estimate, "instrument_onset_offset"), true);
});

test("matching is maximum bipartite, not greedy — two references in one window cannot share an estimate", () => {
  // Both references are within 50 ms of the single estimate. A greedy matcher
  // that scanned references in order would still only match one, but a matcher
  // that reused the estimate would report 2. This pins the "at most once" rule.
  const reference = [note({ onset: 1.0 }), note({ onset: 1.04 })];
  const estimate = [note({ onset: 1.02 })];
  assert.equal(amtMatchNotes(reference, estimate, "instrument_onset"), 1);

  // The case greedy actually gets wrong: ref A can only take est A, ref B can
  // take either. Taking est A for ref B first would strand ref A at 1 match;
  // augmenting paths must find 2.
  const refs = [note({ onset: 1.0, pitch: 60 }), note({ onset: 1.04, pitch: 60 })];
  const ests = [note({ onset: 1.02, pitch: 60 }), note({ onset: 1.08, pitch: 60 })];
  assert.equal(amtMatchNotes(refs, ests, "instrument_onset"), 2);
});

test("score is precision/recall/F1 over matched notes, and an empty estimate scores zero not NaN", () => {
  const reference = [note({ onset: 0 }), note({ onset: 1 }), note({ onset: 2 })];
  const estimate = [note({ onset: 0 }), note({ onset: 1 }), note({ onset: 9 })];
  const score = amtScore(reference, estimate, "instrument_onset");
  assert.equal(score.matched, 2);
  assert.equal(score.precision, 0.6667);
  assert.equal(score.recall, 0.6667);
  assert.equal(score.f1, 0.6667);
  const empty = amtScore(reference, [], "instrument_onset");
  assert.equal(empty.f1, 0);
  assert.equal(Number.isNaN(empty.precision), false);
});

test("per-instrument scoring reports a class the model invented", () => {
  const reference = [note({ program: 0, onset: 0 })];
  const estimate = [note({ program: 0, onset: 0 }), note({ program: 60, onset: 0, pitch: 70 })];
  const rows = amtScoreByInstrument(reference, estimate);
  const brass = rows.find((r) => r.instrumentClass === "brass");
  assert.ok(brass, "a hallucinated brass note must appear as its own row, not vanish into the mean");
  assert.equal(brass.referenceNotes, 0);
  assert.equal(brass.estimateNotes, 1);
  assert.equal(brass.f1, 0);
  assert.equal(rows.find((r) => r.instrumentClass === "keys")?.f1, 1);
});

test("tempo mapper honours a tempo change rather than assuming the first tempo holds", () => {
  const midi = {
    ticksPerQuarter: 480,
    // 120 bpm for one quarter, then 60 bpm.
    tempos: [
      { tick: 0, usPerQuarter: 500_000, bpm: 120 },
      { tick: 480, usPerQuarter: 1_000_000, bpm: 60 },
    ],
  } as never as Parameters<typeof tickToSecondsMapper>[0];
  const at = tickToSecondsMapper(midi);
  assert.equal(Number(at(0).toFixed(6)), 0);
  assert.equal(Number(at(480).toFixed(6)), 0.5);
  // One more quarter, now at half speed: 0.5 s + 1.0 s.
  assert.equal(Number(at(960).toFixed(6)), 1.5);
});

test("a missing initial tempo defaults to 120 bpm rather than dividing by zero", () => {
  const midi = { ticksPerQuarter: 480, tempos: [] } as never as Parameters<typeof tickToSecondsMapper>[0];
  assert.equal(Number(tickToSecondsMapper(midi)(480).toFixed(6)), 0.5);
});

test("a benchmark clip's reference notes are exactly the notes that were rendered", () => {
  const midi = writeMidiFile({
    ticksPerQuarter: 480,
    tempos: [{ tick: 0, usPerQuarter: 500_000, bpm: 120 }],
    timeSignatures: [{ tick: 0, numerator: 4, denominator: 4 }],
    notes: [
      // A piano line and a bass line, so the clip is genuinely multi-instrument.
      { track: 0, channel: 0, program: 0, isPercussion: false, pitch: 60, velocity: 90, startTick: 0, endTick: 480 },
      { track: 0, channel: 0, program: 0, isPercussion: false, pitch: 64, velocity: 90, startTick: 480, endTick: 960 },
      { track: 1, channel: 1, program: 33, isPercussion: false, pitch: 40, velocity: 100, startTick: 0, endTick: 960 },
    ],
  });
  const clip = buildBenchmarkClip(midi, { maxSeconds: 30 });
  assert.equal(clip.reference.length, 3);
  assert.deepEqual(clip.instrumentClasses, ["bass", "keys"]);
  // Sorted by onset then pitch, so the two notes at 0 s come out bass-first.
  const bass = clip.reference.find((n) => n.program === 33);
  const firstKeys = clip.reference.find((n) => n.program === 0 && n.pitch === 60);
  assert.deepEqual(
    { onset: bass?.onset, offset: bass?.offset },
    { onset: 0, offset: 1 },
    "the bass note runs the full two beats",
  );
  assert.deepEqual(
    { onset: firstKeys?.onset, offset: firstKeys?.offset },
    { onset: 0, offset: 0.5 },
    "480 ticks at 480 ppq and 120 bpm is half a second",
  );
  assert.equal(clip.wav.subarray(0, 4).toString("ascii"), "RIFF");
  assert.equal(clip.wavSha256.length, 64);
  // A model that returns the truth verbatim must score a perfect 1.
  assert.equal(amtScore(clip.reference, clip.reference, "instrument_onset_offset").f1, 1);
});

test("a clip truncates to the window: later notes are dropped, straddling notes are kept and clamped", () => {
  const midi = writeMidiFile({
    ticksPerQuarter: 480,
    tempos: [{ tick: 0, usPerQuarter: 500_000, bpm: 120 }],
    timeSignatures: [{ tick: 0, numerator: 4, denominator: 4 }],
    notes: [
      // Starts at 0 s, ends at 4 s — straddles a 2 s window.
      { track: 0, channel: 0, program: 0, isPercussion: false, pitch: 60, velocity: 90, startTick: 0, endTick: 3840 },
      // Starts at 3 s — entirely outside a 2 s window.
      { track: 0, channel: 0, program: 0, isPercussion: false, pitch: 67, velocity: 90, startTick: 2880, endTick: 3360 },
    ],
  });
  const clip = buildBenchmarkClip(midi, { maxSeconds: 2 });
  assert.equal(clip.reference.length, 1, "a note that never sounds in the window must not be truth");
  assert.equal(clip.reference[0].offset, 2, "a straddling note keeps its attack and is clamped to the window");
});

test("summary keeps clips apart: a clip-1 estimate cannot match a clip-2 reference", () => {
  // Identical notes in two clips. Pooling before matching would let the two
  // estimates cross-match and report 2 matches per clip.
  const only = [note({ onset: 0, pitch: 60 })];
  const summary = summariseAmtModel("m", [
    { clipId: "a", genreFamily: "pop", reference: only, estimate: only },
    { clipId: "b", genreFamily: "jazz", reference: only, estimate: only },
  ]);
  assert.equal(summary.micro.instrument_onset.matched, 2);
  assert.equal(summary.micro.instrument_onset.referenceNotes, 2);
  assert.equal(summary.micro.instrument_onset.f1, 1);
  assert.equal(summary.perGenre.length, 2);
  assert.equal(summary.perClip.length, 2);
});

test("micro and macro disagree when a model is good on the dense clip and bad on the sparse one", () => {
  const dense = Array.from({ length: 10 }, (_, i) => note({ onset: i, pitch: 60 + i }));
  const sparse = [note({ onset: 0, pitch: 40 })];
  const summary = summariseAmtModel("m", [
    { clipId: "dense", genreFamily: "pop", reference: dense, estimate: dense },
    { clipId: "sparse", genreFamily: "pop", reference: sparse, estimate: [] },
  ]);
  // 10 of 11 notes right, but one of two songs completely failed.
  assert.equal(summary.micro.instrument_onset.f1, 0.9524);
  assert.equal(summary.macroF1.instrument_onset, 0.5);
});

test("verdict refuses a gain bought by flooding the output with false notes", () => {
  const reference = Array.from({ length: 20 }, (_, i) => note({ onset: i * 0.5, pitch: 60 }));
  const incumbent = summariseAmtModel("MT3", [
    { clipId: "c", genreFamily: "pop", reference, estimate: reference.slice(0, 10) },
  ]);
  // Every reference note found, plus 200 invented ones.
  const flooder = [
    ...reference,
    ...Array.from({ length: 200 }, (_, i) => note({ onset: 40 + i * 0.5, pitch: 61 })),
  ];
  const challenger = summariseAmtModel("FLOOD", [
    { clipId: "c", genreFamily: "pop", reference, estimate: flooder },
  ]);
  const verdict = amtVerdict(incumbent, challenger);
  assert.equal(verdict.verdict, "not_better");
  assert.match(verdict.reasons.join(" "), /precision falls/);
});

test("verdict accepts a real gain and names the numbers behind it", () => {
  const reference = Array.from({ length: 20 }, (_, i) => note({ onset: i * 0.5, pitch: 60 }));
  const incumbent = summariseAmtModel("MT3", [
    { clipId: "c", genreFamily: "pop", reference, estimate: reference.slice(0, 8) },
  ]);
  const challenger = summariseAmtModel("YOUR_MT3", [
    { clipId: "c", genreFamily: "pop", reference, estimate: reference.slice(0, 18) },
  ]);
  const verdict = amtVerdict(incumbent, challenger);
  assert.equal(verdict.verdict, "better");
  assert.match(verdict.reasons[0], /instrument-aware onset F1/);
});

test("a gain too small to matter is not a promotion", () => {
  const reference = Array.from({ length: 100 }, (_, i) => note({ onset: i * 0.1, pitch: 60 }));
  const incumbent = summariseAmtModel("MT3", [
    { clipId: "c", genreFamily: "pop", reference, estimate: reference.slice(0, 50) },
  ]);
  const challenger = summariseAmtModel("X", [
    { clipId: "c", genreFamily: "pop", reference, estimate: reference.slice(0, 51) },
  ]);
  assert.equal(amtVerdict(incumbent, challenger).verdict, "not_better");
});
