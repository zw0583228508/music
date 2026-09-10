/**
 * The evaluation renderer (Brain B-07 D1): one renderer and one loudness for
 * everything the platform judges. These tests hold the two things that must
 * not drift by hand — the renderer decision and the family-neutrality table —
 * to the measurements they came from.
 */
import assert from "node:assert/strict";
import test from "node:test";
import { BENCHMARK_CORPUS, buildBenchmarkSongModel } from "./benchmarkCorpus";
import { orchestrateArrangement } from "./arrangementOrchestrator";
import {
  AUDIO_SCORE_WEIGHT,
  EVALUATION_CHANNELS,
  EVALUATION_FAMILIES,
  EVALUATION_FAMILY_TRIMS_DB,
  EVALUATION_LOUDNESS,
  EVALUATION_RENDERER,
  EVALUATION_SAMPLE_RATE,
  bandShares,
  critiqueEvaluationRender,
  evaluationDurationSeconds,
  evaluationFamilyOf,
  evaluationRenderCacheSize,
  evaluationRenderKey,
  evaluationRendererDecision,
  measureFamilyNeutrality,
  monoOf,
  rememberEvaluationRender,
  renderEvaluation,
  takeEvaluationRender,
  type EvaluationFamily,
} from "./evaluationRender";

const anchor = (id: string) => {
  const spec = BENCHMARK_CORPUS.find((c) => c.id === id)!;
  const songModel = buildBenchmarkSongModel(spec);
  const result = orchestrateArrangement({ songModel, candidateCount: 1, render: false, now: new Date(0) });
  return { songModel, plan: result.plan, timing: result.timing, trackModels: result.candidates[0].trackModels };
};

test("the renderer decision is taken from the objective checks, not by ear", () => {
  const decision = evaluationRendererDecision();
  const byId = new Map(decision.candidates.map((c) => [c.renderer, c]));
  assert.equal(decision.candidates.length, 3, "all three renderers the platform owns are measured");

  // The chosen renderer passes every PR-72 check.
  const v2 = byId.get("LISTENING_SYNTH_V2")!;
  assert.equal(v2.check.passed, true, `V2 fails ${v2.check.failed.join(", ")}`);
  assert.equal(decision.chosen.renderer, EVALUATION_RENDERER);

  // The two it beat fail named checks — the reason the decision is recorded.
  const v1 = byId.get("REFERENCE_SYNTH_V1")!;
  assert.equal(v1.check.passed, false);
  for (const name of ["family_voices_distinguishable", "struck_and_sustained_envelopes", "drum_pieces_distinguishable", "stereo_image"]) {
    assert.ok(v1.check.failed.includes(name), `REFERENCE_SYNTH_V1 should fail ${name}; it fails ${v1.check.failed.join(", ")}`);
  }
  const preview = byId.get("LOCAL_EXPRESSIVE_SYNTH")!;
  assert.equal(preview.check.passed, false);
  assert.ok(preview.check.failed.includes("no_clipping"), "the preview synth clips a fortissimo ensemble");
  assert.ok(preview.check.failed.length > v1.check.failed.length, "the preview synth fails more checks than the reference synth");

  assert.deepEqual(decision.chosen.familyTrimsDb, { ...EVALUATION_FAMILY_TRIMS_DB });
  assert.deepEqual(decision.chosen.loudness, EVALUATION_LOUDNESS);
});

test("the family trims are the measurement, so they cannot drift by hand", () => {
  const measured = measureFamilyNeutrality();
  assert.deepEqual(measured.trimsDb, EVALUATION_FAMILY_TRIMS_DB,
    "EVALUATION_FAMILY_TRIMS_DB must equal measureFamilyNeutrality(); regenerate it when a V2 voice changes");
  // The trims exist because the voices are not neutral, and they make them so.
  assert.ok(measured.spreadBeforeDb > 8, `untrimmed spread ${measured.spreadBeforeDb} dB`);
  assert.ok(measured.spreadAfterDb <= 0.2, `trimmed spread ${measured.spreadAfterDb} dB`);
  for (const family of EVALUATION_FAMILIES) assert.ok(Number.isFinite(measured.rmsDbfs[family]));
});

test("the trims move the judged mix out of the bottom two octaves", () => {
  const { trackModels } = anchor("pop-full");
  const flat = Object.fromEntries(EVALUATION_FAMILIES.map((f) => [f, 0])) as Record<EvaluationFamily, number>;
  const untrimmed = renderEvaluation(trackModels, { familyTrimsDb: flat });
  const trimmed = renderEvaluation(trackModels);
  assert.ok(untrimmed.spectrum.sub150 > 80, `untrimmed sub-150 Hz share ${untrimmed.spectrum.sub150} %`);
  assert.ok(trimmed.spectrum.sub150 < untrimmed.spectrum.sub150 - 15,
    `the trims must move real power out of the sub band: ${untrimmed.spectrum.sub150} % -> ${trimmed.spectrum.sub150} %`);
  assert.ok(trimmed.spectrum.low2k > untrimmed.spectrum.low2k, "and into the band where the parts are");
  // A judge that imposes its own balance cannot judge balance: every family is
  // trimmed by the same table regardless of what the arrangement contains.
  assert.deepEqual(trimmed.familyTrimsDb, { ...EVALUATION_FAMILY_TRIMS_DB });
});

test("one loudness: the mix is normalised and the same gain reaches every stem", () => {
  const { trackModels } = anchor("ballad-piano-vocal");
  const render = renderEvaluation(trackModels);
  assert.equal(render.sampleRate, EVALUATION_SAMPLE_RATE);
  assert.equal(render.channels, EVALUATION_CHANNELS);
  assert.equal(render.loudness.targetRmsDbfs, EVALUATION_LOUDNESS.targetRmsDbfs);
  assert.equal(render.loudness.peakCeiling, EVALUATION_LOUDNESS.peakCeiling);
  assert.ok(render.loudness.applied === "rms" || render.loudness.applied === "peak");
  assert.ok(Number.isFinite(render.loudness.gainDb));
  assert.ok(render.stems.length === trackModels.length, "one stem per track");
  for (const stem of render.stems) {
    assert.ok(stem.samples.length === render.mix.length, "stems and mix are the same length");
    assert.ok(stem.rmsDbfs < 0 && stem.peakDbfs <= 0.1, `${stem.instrument} ${stem.rmsDbfs} / ${stem.peakDbfs} dBFS`);
    assert.equal(stem.trimDb, EVALUATION_FAMILY_TRIMS_DB[stem.family]);
  }
  const shares = bandShares(monoOf(render.mix), render.sampleRate);
  assert.ok(shares.frames > 0);
  assert.ok(Math.abs(shares.sub150 + shares.low2k + shares.presence5k + shares.air - 100) < 0.5, "the four bands are the whole spectrum");
});

test("the render is deterministic and its key covers the notes", () => {
  const { trackModels } = anchor("pop-full");
  const a = renderEvaluation(trackModels, { durationSeconds: 8 });
  const b = renderEvaluation(trackModels, { durationSeconds: 8 });
  assert.equal(a.key, b.key);
  assert.deepEqual([...a.mix.subarray(0, 4096)], [...b.mix.subarray(0, 4096)], "the same notes give the same bytes");

  const moved = trackModels.map((t, i) => (i === 0 ? { ...t, notes: t.notes.map((n) => ({ ...n, pitch: n.pitch + 1 })) } : t));
  assert.notEqual(
    evaluationRenderKey(moved, { sampleRate: a.sampleRate, durationSeconds: a.durationSeconds, familyTrimsDb: a.familyTrimsDb }),
    a.key,
    "one changed pitch changes the key");
});

test("the render length covers the plan, and the cache hands the render on once", () => {
  const { trackModels, plan, timing } = anchor("pop-full");
  const seconds = evaluationDurationSeconds(trackModels, plan, timing.tempoBpm, timing.meter);
  const lastNoteOff = Math.max(...trackModels.flatMap((t) => t.notes.map((n) => n.start + n.duration)));
  assert.ok(seconds >= lastNoteOff, `${seconds} s must reach the last note-off at ${lastNoteOff.toFixed(2)} s`);

  const render = renderEvaluation(trackModels, { durationSeconds: 4 });
  const before = evaluationRenderCacheSize();
  rememberEvaluationRender(render);
  assert.equal(evaluationRenderCacheSize(), before + 1);
  assert.equal(takeEvaluationRender(render.key)?.key, render.key);
  assert.equal(takeEvaluationRender(render.key), null, "one consumer: the render is taken, not copied");
});

test("families come from the GM program the export MIDI would carry", () => {
  const { trackModels } = anchor("orchestral-midi");
  const families = trackModels.map((t) => `${t.instrument}=${evaluationFamilyOf(t)}`);
  assert.ok(families.some((f) => f.endsWith("=drums")), `a kit is a kit: ${families.join(", ")}`);
  assert.ok(families.some((f) => f.endsWith("=bass")), `a bass is a bass: ${families.join(", ")}`);
  for (const t of trackModels) assert.ok((EVALUATION_FAMILIES as readonly string[]).includes(evaluationFamilyOf(t)));
});

test("audio-critic/v1 runs on the evaluation render and returns a usable score", () => {
  const { trackModels } = anchor("pop-full");
  const render = renderEvaluation(trackModels, { durationSeconds: 20 });
  const critique = critiqueEvaluationRender(render);
  assert.equal(critique.stemCount, trackModels.length);
  assert.ok(critique.overallScore > 0 && critique.overallScore <= 100);
  assert.ok(critique.dimensions.length > 0);
  assert.equal(AUDIO_SCORE_WEIGHT, 0.4, "the blend mirrors the orchestrator's 0.6 symbolic + 0.4 audio");
});
