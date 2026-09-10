import assert from "node:assert/strict";
import test from "node:test";
import {
  ANCHOR_ORDER,
  DEFAULT_SEGMENTATION,
  DEFAULT_VARIANTS,
  splitAtOnsets,
  MELODY_STEM_PATH_PROVIDER,
  REGISTER_RANGE,
  bassEvidenceFromOutcome,
  canonicalMelodyAcceptance,
  chooseMelodyStem,
  melodyStemPathForAnalysis,
  runMelodyBassPath,
  fuseTrackers,
  hzToMidi,
  linesFromTrack,
  melodyBassEndpoint,
  melodyStemPathEnabled,
  melodyTranscriptionResult,
  midiToHz,
  monophonicFromEvents,
  repairOctaves,
  requestMelodyBassWorker,
  scoreNotes,
  segmentFrames,
  stemPathFromTrack,
  type PitchFrame,
  type TrackedNote,
  type WorkerTrack,
} from "./melodyBassPaths";

/** Frames for a sequence of (midi pitch | null, seconds) at 10 ms hop with a given confidence. */
function framesFor(sequence: Array<[pitch: number | null, seconds: number]>, confidence = 0.9, jitterCents = 0): PitchFrame[] {
  const frames: PitchFrame[] = [];
  let t = 0;
  let k = 0;
  for (const [pitch, seconds] of sequence) {
    const count = Math.round(seconds / 0.01);
    for (let i = 0; i < count; i += 1) {
      const jitter = jitterCents ? ((k % 3) - 1) * (jitterCents / 100) : 0;
      frames.push([Number((t).toFixed(3)), pitch === null ? 0 : midiToHz(pitch + jitter), pitch === null ? 0.05 : confidence]);
      t += 0.01;
      k += 1;
    }
  }
  return frames;
}

const notesOf = (pairs: Array<[start: number, end: number, pitch: number, confidence?: number]>): TrackedNote[] =>
  pairs.map(([start, end, pitch, confidence]) => ({ start, end, pitch, confidence: confidence ?? 0.9 }));

test("hz <-> midi round-trips at A4 and the bass register", () => {
  assert.equal(Math.round(hzToMidi(440) * 1000) / 1000, 69);
  assert.equal(Math.round(hzToMidi(55)), 33);
  assert.equal(Math.round(midiToHz(69)), 440);
});

test("segmentFrames turns a clean pitch track into notes with exact onsets and pitches", () => {
  const frames = framesFor([[60, 0.5], [62, 0.3], [null, 0.2], [64, 0.4]]);
  const notes = segmentFrames(frames, DEFAULT_SEGMENTATION.melody);
  assert.deepEqual(notes.map((n) => [n.start, n.pitch]), [[0, 60], [0.5, 62], [1, 64]]);
  assert.ok(Math.abs(notes[0].end - 0.5) < 0.011);
  assert.ok(Math.abs(notes[2].end - 1.4) < 0.011);
});

test("segmentFrames ignores a one-frame glitch, drops micro notes and merges a same-pitch gap", () => {
  const frames = framesFor([[60, 0.3], [72, 0.01], [60, 0.3]]);
  const notes = segmentFrames(frames, DEFAULT_SEGMENTATION.melody);
  assert.equal(notes.length, 1, "a single deviant frame must not split the note");
  assert.equal(notes[0].pitch, 60);

  const micro = framesFor([[60, 0.3], [67, 0.03], [null, 0.5]]);
  assert.deepEqual(segmentFrames(micro, DEFAULT_SEGMENTATION.melody).map((n) => n.pitch), [60]);

  const gapped = framesFor([[60, 0.3], [null, 0.02], [60, 0.3]]);
  assert.equal(segmentFrames(gapped, DEFAULT_SEGMENTATION.melody).length, 1, "a 20 ms unvoiced gap is not a rest");
  const rest = framesFor([[60, 0.3], [null, 0.2], [60, 0.3]]);
  assert.equal(segmentFrames(rest, DEFAULT_SEGMENTATION.melody).length, 2, "a 200 ms rest is");
});

test("segmentFrames respects the voicing threshold and survives vibrato-sized jitter", () => {
  const quiet = framesFor([[60, 0.5]], 0.3);
  assert.equal(segmentFrames(quiet, DEFAULT_SEGMENTATION.melody).length, 0, "confidence 0.3 is unvoiced at threshold 0.5");
  const wobbly = framesFor([[67, 0.6], [69, 0.6]], 0.9, 40);
  assert.deepEqual(segmentFrames(wobbly, DEFAULT_SEGMENTATION.melody).map((n) => n.pitch), [67, 69]);
  assert.equal(segmentFrames([], DEFAULT_SEGMENTATION.melody).length, 0);
});

test("monophonicFromEvents keeps one line: highest for a lead, lowest for a bass, and trims small overlaps", () => {
  const chord = notesOf([[0, 1, 60, 0.8], [0, 1, 64, 0.7], [0, 1, 67, 0.6]]);
  assert.deepEqual(monophonicFromEvents(chord, { prefer: "highest" }).map((n) => n.pitch), [67]);
  assert.deepEqual(monophonicFromEvents(chord, { prefer: "lowest" }).map((n) => n.pitch), [60]);
  assert.deepEqual(monophonicFromEvents(chord, { prefer: "confidence" }).map((n) => n.pitch), [60]);
  const legato = notesOf([[0, 0.52, 60], [0.5, 1, 62]]);
  const line = monophonicFromEvents(legato, { prefer: "highest" });
  assert.deepEqual(line.map((n) => [n.pitch, n.end]), [[60, 0.5], [62, 1]]);
});

test("repairOctaves folds out-of-register notes and fixes an isolated octave glitch, counting both", () => {
  // Folding alone: the neighbours are too far away (> 250 ms) to anchor a glitch repair.
  const bass = notesOf([[0, 0.5, 33], [1, 1.5, 57], [2, 2.5, 35]]);
  const folded = repairOctaves(bass, "bass");
  assert.deepEqual(folded.notes.map((n) => n.pitch), [33, 45, 35]);
  assert.equal(folded.folded, 1);
  assert.equal(folded.repaired, 0);
  assert.equal(folded.outOfRegister, 0);
  // The same note inside a phrase: folded into the register, then seen as an
  // isolated octave leap between two close neighbours and shifted once more.
  const phrase = repairOctaves(notesOf([[0, 0.5, 33], [0.5, 1, 57], [1, 1.5, 35]]), "bass");
  assert.deepEqual(phrase.notes.map((n) => n.pitch), [33, 33, 35]);
  assert.equal(phrase.folded, 1);
  assert.equal(phrase.repaired, 1);

  const melody = notesOf([[0, 0.5, 65], [0.5, 1, 79], [1, 1.5, 67]]);
  const repaired = repairOctaves(melody, "melody");
  assert.deepEqual(repaired.notes.map((n) => n.pitch), [65, 67, 67]);
  assert.equal(repaired.repaired, 1);

  const genuineLeap = notesOf([[0, 0.5, 60], [0.5, 1, 72], [1, 1.5, 74]]);
  assert.deepEqual(repairOctaves(genuineLeap, "melody").notes.map((n) => n.pitch), [60, 72, 74], "a leap the next note confirms is music, not an error");
  assert.ok(REGISTER_RANGE.bass.maxMidi < REGISTER_RANGE.melody.maxMidi);
});

test("fuseTrackers confirms agreement, records disagreement as low confidence and never averages", () => {
  const crepe = notesOf([[0, 0.5, 60, 0.9], [0.5, 1, 62, 0.9], [1, 1.5, 64, 0.9], [1.5, 2, 65, 0.9]]);
  const pyin = notesOf([[0.02, 0.5, 60, 0.8], [0.5, 1, 74, 0.8], [1.5, 2, 65, 0.8]]);
  const fused = fuseTrackers([{ tracker: "crepe", notes: crepe }, { tracker: "pyin", notes: pyin }], { source: "TEST" });
  assert.equal(fused.notes.length, 4);
  assert.equal(fused.stats.agreed, 2);
  assert.equal(fused.stats.disagreed, 1);
  assert.equal(fused.stats.unsupported, 1);
  const [agreed, contested, , alone] = fused.notes;
  assert.ok(agreed.confidence >= 0.85, `agreed note confidence ${agreed.confidence}`);
  assert.equal(contested.pitch, 62, "the anchor's pitch is kept, not the mean of 62 and 74");
  assert.ok(contested.confidence <= 0.4, "a disagreement is low confidence");
  assert.ok(fused.notes[2].confidence <= 0.5, "an unsupported note is not high confidence");
  assert.equal(alone.pitch, 65);
  assert.deepEqual(fused.disagreements, [{ start: 0.5, end: 1, pitches: { crepe: 62, pyin: 74 } }]);
  assert.equal(fused.notes.every((note) => note.source === "TEST"), true);
  assert.ok(fused.confidence > 0 && fused.confidence <= 1);
});

test("fuseTrackers with a single tracker is exactly as confident as its notes, and with none returns nothing", () => {
  const only = fuseTrackers([{ tracker: "pyin", notes: notesOf([[0, 1, 60, 0.7]]) }], { source: "T" });
  assert.equal(only.notes.length, 1);
  assert.ok(only.notes[0].confidence <= 0.5);
  assert.equal(only.stats.trackersUsed.length, 1);
  const none = fuseTrackers([{ tracker: "pyin", notes: [] }], { source: "T" });
  assert.equal(none.notes.length, 0);
  assert.equal(none.confidence, 0);
});

test("scoreNotes: perfect prediction is 1.0 everywhere; an octave error is counted as one", () => {
  const truth = notesOf([[0, 0.5, 60], [0.5, 1, 62], [1, 1.5, 64], [1.5, 2, 65]]);
  const perfect = scoreNotes(truth, truth, { durationSeconds: 2 });
  assert.equal(perfect.onset.f1, 1);
  assert.equal(perfect.onsetPitch.f1, 1);
  assert.equal(perfect.onsetPitchOffset.f1, 1);
  assert.equal(perfect.voicing.accuracy, 1);
  assert.equal(perfect.framePitchAccuracy, 1);
  assert.equal(perfect.octaveErrorRate, 0);

  const octave = notesOf([[0.02, 0.5, 60], [0.5, 1, 74], [1.03, 1.5, 64], [1.5, 2.3, 65]]);
  const score = scoreNotes(octave, truth, { durationSeconds: 2.3 });
  assert.equal(score.onset.f1, 1);
  assert.equal(score.onsetPitch.f1, 0.75);
  assert.equal(score.octaveErrorRate, 0.25);
  assert.equal(score.pitchErrorRate, 0.25);
  assert.ok(score.onsetPitchOffset.f1 < score.onsetPitch.f1, "a 300 ms late offset fails the offset criterion");
  // The octave error costs pitch accuracy but not chroma; the 20-30 ms late
  // onsets cost a few voiced frames of both.
  assert.ok(score.frameChromaAccuracy >= 0.95 && score.frameChromaAccuracy < 1, `chroma ${score.frameChromaAccuracy}`);
  assert.ok(score.framePitchAccuracy < score.frameChromaAccuracy - 0.2);
  assert.ok(score.voicing.falseAlarm > 0);

  const empty = scoreNotes([], truth, { durationSeconds: 2 });
  assert.equal(empty.onset.f1, 0);
  assert.equal(empty.voicing.recall, 0);
});

test("canonicalMelodyAcceptance applies the real canonical gate: no sole line reaches canon at the measured reliability; beside a second provider, agreed notes do", () => {
  // The gate: note confidence x result confidence x reliability >= 0.85 for a
  // sole provider. The reliability is the measured 0.72 (providerReliability,
  // mirrored in fuseCanonicalNotes), so even two trackers agreeing on every
  // note at confidence 1 (notes 1.0, agreement rate 1.0) score 0.72: the stem
  // path alone never makes a melody `detected`. Measured, reported, not tuned.
  const line = notesOf([[0, 0.5, 60, 1], [0.5, 1, 62, 1], [1, 1.5, 64, 1]]);
  const agreed = fuseTrackers([{ tracker: "crepe", notes: line }, { tracker: "pyin", notes: line }], { source: MELODY_STEM_PATH_PROVIDER });
  assert.equal(agreed.confidence, 1);
  const sole = canonicalMelodyAcceptance(agreed, { durationSeconds: 2 });
  assert.equal(sole.canonicalNotes, 0, "1 x 1 x 0.72 is under the 0.85 sole-provider floor");
  assert.equal(sole.melodyDetected, false);
  assert.equal(sole.validatorAccepts, true, "an empty line is a valid `not_available`");
  assert.deepEqual(sole.rawLineValidatorErrors, [], "the fused line itself is a valid melody");
  assert.equal(sole.canonicalNotesWithFullMix, null);

  // One contested note in three: the result confidence is the agreement rate
  // (0.667), multiplied into every note, confirmed or not.
  const pyin = notesOf([[0, 0.5, 60, 1], [0.5, 1, 74, 1], [1, 1.5, 64, 1]]);
  const contested = fuseTrackers([{ tracker: "crepe", notes: line }, { tracker: "pyin", notes: pyin }], { source: MELODY_STEM_PATH_PROVIDER });
  assert.equal(contested.confidence, 0.6667);
  const alone = canonicalMelodyAcceptance(contested, { durationSeconds: 2 });
  assert.equal(alone.canonicalNotes, 0);
  assert.equal(alone.melodyDetected, false);

  // Beside a full-mix Basic Pitch result: a note both providers heard at the
  // same onset and pitch is admitted whatever the floor; the full mix's own
  // lone note at 3 s (0.9 x 0.5 x 1 = 0.45) and the contested 62 are not.
  const fullMix = { providerId: "BASIC_PITCH" as const, version: "t", confidence: 0.5, notes: [
    { start: 0.01, end: 0.5, pitch: 60, velocity: 80, confidence: 0.9, source: "BASIC_PITCH" },
    { start: 1, end: 1.5, pitch: 64, velocity: 80, confidence: 0.9, source: "BASIC_PITCH" },
    { start: 3, end: 3.5, pitch: 60, velocity: 80, confidence: 0.9, source: "BASIC_PITCH" },
  ] };
  const beside = canonicalMelodyAcceptance(contested, { durationSeconds: 4, fullMix });
  assert.equal(beside.canonicalNotesWithFullMix, 2);
  assert.equal(beside.melodyDetectedWithFullMix, true);
  assert.equal(beside.validatorAccepts, true, "the carried two-note line is a valid melody");
  assert.equal(canonicalMelodyAcceptance({ notes: [], confidence: 0 }, { durationSeconds: 4, fullMix }).canonicalNotesWithFullMix, 0, "the full mix alone admits nothing: the owner's case");

  const single = fuseTrackers([{ tracker: "pyin", notes: line }], { source: MELODY_STEM_PATH_PROVIDER });
  assert.equal(canonicalMelodyAcceptance(single, { durationSeconds: 2 }).canonicalNotes, 0, "a line one tracker heard alone never reaches canon");
});

test("canonicalMelodyAcceptance reports a micro note on the raw line, and on the carried line when a second provider admits it", () => {
  const micro = { start: 0, end: 0.02, pitch: 60, velocity: 80, confidence: 1, source: "X" };
  const alone = canonicalMelodyAcceptance({ notes: [micro], confidence: 1 }, { durationSeconds: 1 });
  assert.ok(alone.rawLineValidatorErrors.some((code) => code.startsWith("MICRO_NOTE")), "the path emitted a 20 ms note");
  assert.equal(alone.canonicalNotes, 0, "the gate did not carry it");
  assert.equal(alone.validatorAccepts, true, "so the carried (empty) line is still valid");
  const fullMix = { providerId: "BASIC_PITCH" as const, version: "t", confidence: 0.9, notes: [{ ...micro, source: "BASIC_PITCH" }] };
  const carried = canonicalMelodyAcceptance({ notes: [micro], confidence: 1 }, { durationSeconds: 1, fullMix });
  assert.equal(carried.canonicalNotesWithFullMix, 1, "two providers agreeing admit even a micro note");
  assert.equal(carried.validatorAccepts, false);
  assert.ok(carried.validatorErrors.some((code) => code.startsWith("MICRO_NOTE")));
});

test("splitAtOnsets cuts a tracked note only at a same-pitch Basic Pitch onset strictly inside it", () => {
  const tracked = notesOf([[0, 1, 60], [1, 1.5, 62]]);
  const events = notesOf([[0, 0.3, 60, 0.7], [0.5, 1, 60, 0.7], [0.98, 1.5, 62, 0.7], [1.2, 1.5, 64, 0.7]]);
  const split = splitAtOnsets(tracked, events);
  assert.deepEqual(split.notes.map((n) => [n.start, n.end, n.pitch]), [[0, 0.5, 60], [0.5, 1, 60], [1, 1.5, 62]]);
  assert.equal(split.splits, 1, "the onset at 0 is the edge, 0.98 is outside, 64 is another pitch: one cut");
  const edge = splitAtOnsets(notesOf([[0, 1, 60]]), notesOf([[0.02, 0.5, 60], [0.97, 1, 60]]));
  assert.equal(edge.splits, 0, "cuts within 40 ms of an edge are not believed");
  assert.equal(splitAtOnsets(tracked, []).splits, 0);
});

test("linesFromTrack splits CREPE and pYIN at Basic Pitch onsets when asked, and the default variant does", () => {
  const track: WorkerTrack = {
    stem: "other", register: "melody", rmsDbfs: -20, durationSeconds: 1,
    crepe: { frames: framesFor([[67, 1]]), seconds: 1, hopSeconds: 0.01 },
    basic_pitch: { notes: notesOf([[0, 0.5, 67, 0.8], [0.5, 1, 67, 0.8]]), seconds: 1, params: {} },
  };
  const plain = linesFromTrack(track, "melody");
  assert.equal(plain[0].notes.length, 1, "f0 alone cannot see the re-articulation");
  assert.equal(plain[0].onsetSplits, 0);
  const split = linesFromTrack(track, "melody", { onsetSplit: true });
  assert.deepEqual(split[0].notes.map((n) => [n.start, n.end]), [[0, 0.5], [0.5, 1]]);
  assert.equal(split[0].onsetSplits, 1);
  const path = stemPathFromTrack(track, "melody", MELODY_STEM_PATH_PROVIDER);
  assert.deepEqual(path.variant, DEFAULT_VARIANTS.melody);
  assert.deepEqual(path.fusion.stats.trackersUsed, ["basic_pitch", "crepe"], "Basic Pitch anchors a melody; the split CREPE line confirms");
  assert.equal(path.fusion.notes.length, 2);
  assert.equal(path.fusion.stats.agreed, 2, "both Basic Pitch notes are confirmed by the split CREPE halves");
  const crepeAnchor = stemPathFromTrack(track, "melody", MELODY_STEM_PATH_PROVIDER, { onsetSplit: false, anchorOrder: ["crepe", "pyin", "basic_pitch"] });
  assert.equal(crepeAnchor.fusion.notes.length, 1, "a CREPE anchor without the split carries one long note");
  const bassPath = stemPathFromTrack({ ...track, register: "bass" }, "bass", "BASS_STEM_PATH_V1");
  assert.deepEqual(bassPath.variant, DEFAULT_VARIANTS.bass);
  assert.equal(bassPath.variant.onsetSplit, false);
});

test("linesFromTrack and stemPathFromTrack build one line per tracker and fuse in anchor order", () => {
  const track: WorkerTrack = {
    stem: "vocals", register: "melody", rmsDbfs: -20, durationSeconds: 1.5,
    crepe: { frames: framesFor([[60, 0.5], [62, 0.5], [64, 0.5]]), seconds: 1, hopSeconds: 0.01 },
    pyin: { frames: framesFor([[60, 0.5], [74, 0.5], [64, 0.5]]), seconds: 1, hopSeconds: 0.01 },
    basic_pitch: { notes: notesOf([[0, 0.5, 60, 0.6], [0, 0.5, 48, 0.4], [0.5, 1, 62, 0.6], [1, 1.5, 64, 0.6]]), seconds: 1, params: {} },
  };
  const lines = linesFromTrack(track, "melody");
  assert.deepEqual(lines.map((line) => line.tracker), ["crepe", "pyin", "basic_pitch"]);
  assert.deepEqual(lines[1].notes.map((n) => n.pitch), [60, 62, 64], "pyin's octave glitch between two close neighbours was repaired");
  assert.equal(lines[1].octave.repaired, 1);
  assert.deepEqual(lines[2].notes.map((n) => n.pitch), [60, 62, 64], "the polyphonic Basic Pitch events became the top line");
  assert.equal(lines[2].rawNotes, 4);
  const path = stemPathFromTrack(track, "melody", MELODY_STEM_PATH_PROVIDER, { anchorOrder: ["crepe", "pyin", "basic_pitch"] });
  assert.equal(path.fusion.stats.trackersUsed[0], "crepe");
  assert.deepEqual(path.fusion.stats.trackersUsed, ["crepe", "pyin", "basic_pitch"]);
  assert.equal(path.fusion.stats.agreed, 3);
  assert.equal(path.fusion.stats.disagreed, 0, "the repair happened before fusion, so nothing is contested");
  assert.equal(path.fusion.notes.length, 3);
  assert.equal(path.fusion.confidence, 1);
  const defaults = stemPathFromTrack(track, "melody", MELODY_STEM_PATH_PROVIDER);
  assert.deepEqual(defaults.fusion.stats.trackersUsed, ["basic_pitch", "crepe", "pyin"], "the melody default anchors on Basic Pitch");
  assert.equal(defaults.fusion.stats.agreed, 3);
  assert.equal(ANCHOR_ORDER, DEFAULT_VARIANTS.melody.anchorOrder);
});

test("melodyTranscriptionResult and bassEvidenceFromOutcome carry only what the fusion supports", () => {
  const bassTrack: WorkerTrack = {
    stem: "bass", register: "bass", rmsDbfs: -18, durationSeconds: 1,
    crepe: { frames: framesFor([[33, 0.5], [40, 0.5]]), seconds: 1, hopSeconds: 0.01 },
    pyin: { frames: framesFor([[33, 0.5], [52, 0.5]]), seconds: 1, hopSeconds: 0.01 },
  };
  const outcome = {
    melody: stemPathFromTrack({ ...bassTrack, stem: "vocals", register: "melody" as const, crepe: { frames: framesFor([[60, 0.5]]), seconds: 1, hopSeconds: 0.01 }, pyin: { frames: framesFor([[60, 0.5]]), seconds: 1, hopSeconds: 0.01 } }, "melody", MELODY_STEM_PATH_PROVIDER),
    bass: stemPathFromTrack(bassTrack, "bass", "BASS_STEM_PATH_V1"),
    melodyStem: "vocals" as const,
    melodyStemChosenBy: "rule" as const,
    worker: { version: "1.0.0", imageEvidence: null, separationSeconds: 1, seconds: 2, calls: 1, stems: {} },
  };
  const transcription = melodyTranscriptionResult(outcome);
  assert.equal(transcription?.providerId, MELODY_STEM_PATH_PROVIDER);
  assert.equal(transcription?.notes.length, 1);
  const bass = bassEvidenceFromOutcome(outcome);
  assert.equal(bass.length, 1, "the contested second bass note is not evidence");
  assert.equal(bass[0].pitch, 33);
  assert.equal(bass[0].provider, "BASS_STEM_PATH_V1");
  assert.deepEqual(bass[0].providers, ["DEMUCS_HTDEMUCS", "CREPE", "PYIN"]);
  assert.equal(melodyTranscriptionResult({ ...outcome, melody: null }), null);
  assert.deepEqual(bassEvidenceFromOutcome({ ...outcome, bass: null }), []);
});

test("the endpoint and the flag refuse to exist without configuration", () => {
  assert.deepEqual(melodyBassEndpoint({}), { refusal: "MELODY_BASS_API_URL is not configured" });
  assert.deepEqual(melodyBassEndpoint({ MELODY_BASS_API_URL: "ftp://x" }), { refusal: "MELODY_BASS_API_URL must be an http(s) URL" });
  assert.deepEqual(melodyBassEndpoint({ MELODY_BASS_API_URL: "https://w.example/" }), { refusal: "MELODY_BASS_API_TOKEN is not configured" });
  assert.deepEqual(melodyBassEndpoint({ MELODY_BASS_API_URL: "https://w.example/", MELODY_BASS_API_TOKEN: "t" }), { url: "https://w.example", token: "t" });
  assert.equal(melodyStemPathEnabled({}), false);
  assert.equal(melodyStemPathEnabled({ MELODY_STEM_PATH_V1: "false" }), false);
  assert.equal(melodyStemPathEnabled({ MELODY_STEM_PATH_V1: "true" }), true);
});

test("requestMelodyBassWorker sends the bearer token and the contract, and refuses a bad status", async () => {
  const calls: Array<{ url: string; init: RequestInit }> = [];
  const fetchImpl = (async (url: string | URL | Request, init?: RequestInit) => {
    calls.push({ url: String(url), init: init ?? {} });
    return new Response(JSON.stringify({ contractVersion: "1.0", provider: "MELODY_BASS_WORKER", version: "1.0.0", mode: "mix", audio: { durationSeconds: 1, sampleRate: 44100, channels: 2 }, separation: null, tracks: {}, seconds: 1 }), { status: 200 });
  }) as unknown as typeof fetch;
  const environment = { MELODY_BASS_API_URL: "https://w.example", MELODY_BASS_API_TOKEN: "secret-token" };
  const payload = await requestMelodyBassWorker({ sourceUrl: "https://lease.example/a/x", stems: [{ name: "vocals", register: "melody" }] }, { environment, fetchImpl });
  assert.equal(payload.provider, "MELODY_BASS_WORKER");
  assert.equal(calls[0].url, "https://w.example/transcribe");
  assert.equal((calls[0].init.headers as Record<string, string>).authorization, "Bearer secret-token");
  const body = JSON.parse(String(calls[0].init.body));
  assert.deepEqual(body.stems, [{ name: "vocals", register: "melody" }]);
  assert.deepEqual(body.trackers, ["pyin", "crepe", "basic_pitch"]);

  const failing = (async () => new Response("nope", { status: 503 })) as unknown as typeof fetch;
  await assert.rejects(
    requestMelodyBassWorker({ sourceUrl: "https://lease.example/a/x", stems: [{ name: "bass", register: "bass" }] }, { environment, fetchImpl: failing }),
    /HTTP 503/,
  );
});

test("chooseMelodyStem: a vocal stem that carries signal wins, an empty one yields to other", () => {
  assert.equal(chooseMelodyStem({ vocals: { rmsDbfs: -22 }, other: { rmsDbfs: -26 } }), "vocals");
  assert.equal(chooseMelodyStem({ vocals: { rmsDbfs: -59 }, other: { rmsDbfs: -26 } }), "other", "an instrumental's vocal stem is noise");
  assert.equal(chooseMelodyStem({ vocals: { rmsDbfs: -38 }, other: { rmsDbfs: -20 } }), "other", "18 dB under the other stem is not the lead");
  assert.equal(chooseMelodyStem(null), "other");
});

/** A worker that answers with the requested stems, vocals at the given level. */
function fakeWorker(vocalsRms: number, log: string[][]): typeof fetch {
  return (async (_url: string | URL | Request, init?: RequestInit) => {
    const body = JSON.parse(String(init?.body));
    log.push(body.stems.map((s: { name: string }) => s.name));
    const tracks: Record<string, unknown> = {};
    for (const stem of body.stems as Array<{ name: string; register: string }>) {
      const pitch = stem.register === "bass" ? 40 : 67;
      tracks[`${stem.name}:${stem.register}`] = {
        stem: stem.name, register: stem.register, rmsDbfs: -20, durationSeconds: 1,
        crepe: { frames: framesFor([[pitch, 0.5], [pitch + 2, 0.5]], 1), seconds: 1, hopSeconds: 0.01 },
        pyin: { frames: framesFor([[pitch, 0.5], [pitch + 2, 0.5]], 1), seconds: 1, hopSeconds: 0.01 },
        basic_pitch: { notes: notesOf([[0, 0.5, pitch, 1], [0.5, 1, pitch + 2, 1]]), seconds: 1, params: {} },
      };
    }
    return new Response(JSON.stringify({
      contractVersion: "1.0", provider: "MELODY_BASS_WORKER", version: "1.0.0", mode: "mix",
      audio: { durationSeconds: 1, sampleRate: 44100, channels: 2 },
      separation: { model: "htdemucs", checkpointSha256: "x", seconds: 1, stems: { drums: { rmsDbfs: -20 }, bass: { rmsDbfs: -25 }, other: { rmsDbfs: -26 }, vocals: { rmsDbfs: vocalsRms } } },
      tracks, seconds: 3,
    }), { status: 200 });
  }) as unknown as typeof fetch;
}

test("runMelodyBassPath tracks vocals first and asks for the other stem only when the rule says the voice is empty", async () => {
  const environment = { MELODY_BASS_API_URL: "https://w.example", MELODY_BASS_API_TOKEN: "t" };
  const sung: string[][] = [];
  const withVoice = await runMelodyBassPath("https://lease.example/a/x", { environment, fetchImpl: fakeWorker(-22, sung) });
  assert.deepEqual(sung, [["vocals", "bass"]]);
  assert.equal(withVoice.melodyStem, "vocals");
  assert.equal(withVoice.melodyStemChosenBy, "rule");
  assert.equal(withVoice.worker.calls, 1);
  assert.equal(withVoice.melody?.fusion.notes.length, 2);
  assert.equal(withVoice.bass?.fusion.notes.length, 2);

  const instrumental: string[][] = [];
  const noVoice = await runMelodyBassPath("https://lease.example/a/x", { environment, fetchImpl: fakeWorker(-60, instrumental) });
  assert.deepEqual(instrumental, [["vocals", "bass"], ["other"]]);
  assert.equal(noVoice.melodyStem, "other");
  assert.equal(noVoice.worker.calls, 2);
  assert.equal(noVoice.worker.seconds, 6);

  const forced: string[][] = [];
  const caller = await runMelodyBassPath("https://lease.example/a/x", { environment, fetchImpl: fakeWorker(-60, forced), melodyStem: "vocals" });
  assert.deepEqual(forced, [["vocals", "bass"]]);
  assert.equal(caller.melodyStemChosenBy, "caller");
});

test("melodyStemPathForAnalysis: off by default, a provenance record when it cannot run, a transcription result when it can", async () => {
  const off = await melodyStemPathForAnalysis({ sourceUrl: "https://lease.example/a/x", sourceType: "FULL_SONG" }, { environment: {} });
  assert.equal(off.transcription, null);
  assert.deepEqual(off.provenance.map((p) => [p.provider, p.status, p.errorCode]), [["MELODY_STEM_PATH_V1", "unavailable", "flag-off"]]);

  const on = { MELODY_STEM_PATH_V1: "true", MELODY_BASS_API_URL: "https://w.example", MELODY_BASS_API_TOKEN: "t" };
  const vocalOnly = await melodyStemPathForAnalysis({ sourceUrl: "https://lease.example/a/x", sourceType: "VOCAL_ONLY" }, { environment: on });
  assert.equal(vocalOnly.provenance[0].errorCode, "not-a-full-mix");
  const noLease = await melodyStemPathForAnalysis({ sourceUrl: null, sourceType: "FULL_SONG" }, { environment: on });
  assert.equal(noLease.provenance[0].errorCode, "source-unavailable");
  const unconfigured = await melodyStemPathForAnalysis({ sourceUrl: "https://lease.example/a/x", sourceType: "FULL_SONG" }, { environment: { MELODY_STEM_PATH_V1: "1" } });
  assert.equal(unconfigured.provenance[0].errorCode, "not-configured");

  const failing = (async () => new Response("down", { status: 503 })) as unknown as typeof fetch;
  const failed = await melodyStemPathForAnalysis({ sourceUrl: "https://lease.example/a/x", sourceType: "FULL_SONG" }, { environment: on, fetchImpl: failing });
  assert.equal(failed.transcription, null);
  assert.equal(failed.provenance[0].status, "failed");
  assert.match(failed.provenance[0].errorMessage ?? "", /HTTP 503/);

  const calls: string[][] = [];
  const ran = await melodyStemPathForAnalysis({ sourceUrl: "https://lease.example/a/x", sourceType: "FULL_SONG", durationSeconds: 60 }, { environment: on, fetchImpl: fakeWorker(-22, calls) });
  assert.equal(ran.transcription?.providerId, "MELODY_STEM_PATH_V1");
  assert.equal(ran.transcription?.notes.length, 2);
  assert.equal(ran.transcription?.confidence, 1, "three trackers agreed on every note");
  assert.equal(ran.bassEvidence.length, 2);
  assert.deepEqual(ran.provenance.map((p) => [p.capability, p.status, p.attempts]), [["melody", "ready", 1]]);
  // What the flag changes for a Song Model: alone, nothing (0.72 reliability
  // under the 0.85 floor); beside the full-mix Basic Pitch result, the notes
  // both heard become the melody.
  assert.equal(canonicalMelodyAcceptance(ran.transcription!, { durationSeconds: 60 }).canonicalNotes, 0);
  const fullMix = { providerId: "BASIC_PITCH" as const, version: "0.4.0", confidence: 0.5, notes: ran.transcription!.notes.map((n) => ({ ...n, confidence: 0.6, source: "BASIC_PITCH" })) };
  assert.equal(canonicalMelodyAcceptance(ran.transcription!, { durationSeconds: 60, fullMix }).canonicalNotesWithFullMix, 2);
});
