/**
 * Unit tests for the audio critic dimensions (Brain B-07 D2).
 *
 * These hold the mechanics: what each detector does to a signal it is handed,
 * and what it says when it cannot look. Whether a dimension hears a *musical*
 * defect is not decided here — that is `critics/audioControls.test.ts`, which
 * renders real arrangements before and after a deliberate worsening and is the
 * only thing allowed to set a `controlStatus`.
 */
import assert from "node:assert/strict";
import test from "node:test";
import { BENCHMARK_CORPUS, buildBenchmarkSongModel } from "../../benchmarkCorpus";
import { orchestrateArrangement } from "../../arrangementOrchestrator";
import { evaluateAudioBalance } from "./audioBalance";
import { evaluateAudioDynamics } from "./audioDynamics";
import { evaluateAudioMasking } from "./audioMasking";
import { evaluateAudioRhythm, onsetTimes } from "./audioRhythm";
import { evaluateAudioTransitions } from "./audioTransitions";
import { ALL_AUDIO_DIMENSIONS, evaluateAudioDimensions, toBrainAudioDimensions } from "./audioDimensions";
import type { AudioCriticInput, AudioRenderLike } from "./audioShared";

const SAMPLE_RATE = 8_000;

const anchor = (() => {
  const songModel = buildBenchmarkSongModel(BENCHMARK_CORPUS.find((c) => c.id === "pop-full")!);
  const result = orchestrateArrangement({ songModel, candidateCount: 1, render: false, now: new Date(0) });
  return { songModel, plan: result.plan, trackModels: result.candidates[0].trackModels };
})();

const songSeconds = Math.max(...anchor.trackModels.flatMap((t) => t.notes.map((n) => n.start + n.duration))) + 1;

/** A stereo buffer of `songSeconds` filled by `fill(t)`. */
function signal(fill: (seconds: number, index: number) => number): Float32Array {
  const frames = Math.ceil(songSeconds * SAMPLE_RATE);
  const out = new Float32Array(frames * 2);
  for (let i = 0; i < frames; i += 1) {
    const v = fill(i / SAMPLE_RATE, i);
    out[2 * i] = v;
    out[2 * i + 1] = v;
  }
  return out;
}

function renderOf(fills: Array<(seconds: number, index: number) => number>): AudioRenderLike {
  const stems = anchor.trackModels.map((track, index) => ({
    trackId: track.id,
    instrument: track.instrument,
    role: track.role,
    family: /drum/i.test(track.instrument) ? "drums" : /bass/i.test(track.instrument) ? "bass" : "keys",
    samples: signal(fills[index] ?? (() => 0)),
    noteCount: track.notes.length,
  }));
  const frames = stems[0].samples.length;
  const mix = new Float32Array(frames);
  for (const stem of stems) for (let i = 0; i < frames; i += 1) mix[i] += stem.samples[i];
  return { sampleRate: SAMPLE_RATE, channels: 2, durationSeconds: songSeconds, stems, mix };
}

function input(render: AudioRenderLike): AudioCriticInput {
  return { songModel: anchor.songModel, plan: anchor.plan, trackModels: anchor.trackModels, render };
}

const tone = (hz: number, amplitude: number) => (seconds: number) => amplitude * Math.sin(2 * Math.PI * hz * seconds);

test("audioDynamics hears a clipped stem and blames the render, not the notes", () => {
  const render = renderOf([tone(220, 0.2), tone(110, 0.2), (s) => Math.max(-1, Math.min(1, 4 * Math.sin(2 * Math.PI * 440 * s)))]);
  const report = evaluateAudioDynamics(input(render));
  const clipped = report.observations.filter((o) => o.kind === "clipped_stem");
  assert.equal(clipped.length, 1, `expected one clipped stem, got ${report.observations.map((o) => o.kind).join(",")}`);
  assert.equal(clipped[0].severity, "blocking");
  assert.equal(clipped[0].suspectedOrigin, "render", "a stem that clips is a defect of the render");
  assert.equal(clipped[0].recommendedRepair?.operation, "rerender_stem");
  assert.ok(Number(clipped[0].evidence["clippedSamples"]) > 0);
  assert.ok(clipped[0].location.trackIds.length === 1);

  // The same arrangement without the clipping raises nothing of the kind.
  const clean = evaluateAudioDynamics(input(renderOf([tone(220, 0.2), tone(110, 0.2), tone(440, 0.2)])));
  assert.equal(clean.observations.filter((o) => o.kind === "clipped_stem").length, 0);
});

test("audioDynamics hears dead air inside a section and blames the composition", () => {
  const gapFrom = songSeconds * 0.4;
  const quiet = (seconds: number) => (seconds > gapFrom && seconds < gapFrom + 4 ? 0 : 0.2 * Math.sin(2 * Math.PI * 220 * seconds));
  const report = evaluateAudioDynamics(input(renderOf([quiet, quiet, quiet])));
  const dropouts = report.observations.filter((o) => o.kind === "dropout");
  assert.ok(dropouts.length >= 1, "a four-second hole inside a section is a dropout");
  assert.equal(dropouts[0].suspectedOrigin, "compose");
  assert.ok(Number(dropouts[0].evidence["silentSeconds"]) >= 1);
  assert.ok(dropouts[0].location.startBar >= 1, "located to bars through the timeline");
  assert.ok(Number(dropouts[0].evidence["startSeconds"]) >= 0, "and keeping the seconds it was measured over");
});

test("audioBalance hears one part far above the rest", () => {
  const report = evaluateAudioBalance(input(renderOf([tone(220, 0.02), tone(110, 0.02), tone(440, 0.6)])));
  const dominates = report.observations.filter((o) => o.kind === "part_dominates");
  assert.ok(dominates.length > 0, `expected part_dominates, got ${report.observations.map((o) => o.kind).join(",")}`);
  assert.ok(Number(dominates[0].evidence["marginDb"]) >= 8);
  assert.ok(report.summary.score0to100 !== null && report.summary.score0to100 < 100);

  const level = evaluateAudioBalance(input(renderOf([tone(220, 0.2), tone(110, 0.2), tone(440, 0.2)])));
  assert.equal(level.observations.filter((o) => o.severity !== "info").length, 0, "three equal parts are balanced");
});

test("audioMasking hears two parts sharing the sub band", () => {
  const sub = tone(60, 0.3);
  const report = evaluateAudioMasking(input(renderOf([tone(1_200, 0.2), sub, sub])));
  const congestion = report.observations.filter((o) => o.kind === "low_end_congestion");
  assert.ok(congestion.length > 0, `expected low_end_congestion, got ${report.observations.map((o) => o.kind).join(",")}`);
  assert.ok(["register", "orchestration"].includes(congestion[0].suspectedOrigin));
  assert.equal(congestion[0].recommendedRepair?.operation, "separate_registers");
});

test("audioRhythm finds onsets and needs a kit to have a grid at all", () => {
  // Eight clicks a second apart, the first at 0.5 s so that every one of them
  // is preceded by silence (a signal that starts at full level has no rise and
  // is correctly not an onset).
  const clicks = signal((seconds) => {
    if (seconds < 0.5 || seconds >= 8.5) return 0;
    const phase = (seconds - 0.5) % 1;
    return phase < 0.02 ? Math.sin(2 * Math.PI * 900 * seconds) * (1 - phase / 0.02) : 0;
  });
  const onsets = onsetTimes(clicks, 2, SAMPLE_RATE);
  assert.equal(onsets.length, 8, `expected eight onsets, got ${onsets.length}: ${onsets.join(",")}`);
  for (const [index, t] of onsets.entries()) assert.ok(Math.abs(t - (0.5 + index)) < 0.05, `onset ${index} at ${t}`);

  // Without a kit stem there is no grid, and the dimension says so instead of guessing one.
  const noKit: AudioRenderLike = { ...renderOf([tone(220, 0.2), tone(110, 0.2), tone(440, 0.2)]) };
  const report = evaluateAudioRhythm(input({ ...noKit, stems: noKit.stems.map((s) => ({ ...s, family: "keys" })) }));
  assert.equal(report.applicable, false);
  assert.match(report.reasonIfNot ?? "", /kit/);
  assert.equal(report.summary.score0to100, null, "UNKNOWN is a valid answer");
});

test("audioTransitions needs two sections and reports what it measured at each boundary", () => {
  const report = evaluateAudioTransitions(input(renderOf([tone(220, 0.2), tone(110, 0.2), tone(440, 0.2)])));
  assert.equal(report.applicable, true);
  const measured = report.observations.filter((o) => o.kind === "measured");
  assert.ok(measured.length > 0, "every boundary is measured, whatever the verdict");
  for (const observation of measured) {
    assert.ok(typeof observation.evidence["beforeDbfs"] === "number");
    assert.ok(typeof observation.evidence["afterDbfs"] === "number");
    assert.ok(typeof observation.evidence["plannedEnergyDelta"] === "number");
  }
  assert.ok(report.summary.coverage > 0 && report.summary.coverage <= 1);
});

test("every dimension answers, carries a ledger status it did not type, and survives the persisted shape", () => {
  const reports = evaluateAudioDimensions(input(renderOf([tone(220, 0.2), tone(110, 0.2), tone(440, 0.2)])));
  assert.equal(reports.length, ALL_AUDIO_DIMENSIONS.length);
  for (const report of reports) {
    assert.ok(["gated", "informing", "demoted", "uncalibrated"].includes(report.summary.controlStatus));
    assert.ok(report.summary.coverage >= 0 && report.summary.coverage <= 1);
    if (!report.applicable) assert.ok(report.reasonIfNot, `${report.dimension} says why it could not look`);
  }
  const persisted = toBrainAudioDimensions(reports);
  assert.equal(persisted.length, reports.length);
  for (const dimension of persisted) {
    for (const observation of dimension.observations) {
      assert.equal(observation.dimension, dimension.dimension);
      assert.ok(!("startSeconds" in observation.evidence), "the seconds move to their own fields, not the evidence bag");
      assert.ok(observation.startSeconds >= 0 && observation.endSeconds >= observation.startSeconds);
      assert.ok(JSON.stringify(observation).length > 0, "the whole observation is JSON-serialisable for the database");
    }
  }
});

test("a render with one stem is not enough to judge balance or masking, and they say so", () => {
  const one: AudioRenderLike = (() => {
    const full = renderOf([tone(220, 0.2)]);
    return { ...full, stems: full.stems.slice(0, 1) };
  })();
  const balance = evaluateAudioBalance(input(one));
  assert.equal(balance.applicable, false);
  assert.match(balance.reasonIfNot ?? "", /two rendered stems/);
  const masking = evaluateAudioMasking(input(one));
  assert.equal(masking.applicable, false);
  assert.match(masking.reasonIfNot ?? "", /two pitched stems/);
});
