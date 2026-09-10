import assert from "node:assert/strict";
import test from "node:test";
import type { TrackModel } from "@workspace/db";
import { orchestrateArrangement } from "./arrangementOrchestrator";
import { BENCHMARK_CORPUS, buildBenchmarkSongModel } from "./benchmarkCorpus";
import {
  coherenceOfTracks,
  currentMetricVersions,
  gmProgramForTrack,
  isPercussionTrack,
  meanCandidateDistance,
  measureCandidateHarmony,
  metricVersionMismatch,
  planTargetsOf,
  remiFamilyForTrack,
  songModelChords,
  taskFromArrangement,
} from "./benchmarkMeasures";
import { MUSIC_CRITIC_VERSION } from "./musicCritic";
import { PART_JUDGE_VERSION } from "./partJudge";

const NOW = new Date("2026-01-01T00:00:00.000Z");

function arrangement(caseId: string) {
  const spec = BENCHMARK_CORPUS.find((c) => c.id === caseId)!;
  const songModel = buildBenchmarkSongModel(spec);
  const result = orchestrateArrangement({ songModel, candidateCount: 2, render: false, now: NOW });
  const selected = result.candidates.find((c) => c.candidateId === result.selected?.candidateId)!;
  return { songModel, result, selected };
}

test("metric versions are pinned from the modules themselves and a mismatch is named", () => {
  const versions = currentMetricVersions();
  assert.equal(versions.musicCritic, MUSIC_CRITIC_VERSION);
  assert.equal(versions.partJudge, PART_JUDGE_VERSION);
  assert.deepEqual(metricVersionMismatch(versions, versions), []);
  const changed = metricVersionMismatch(versions, { ...versions, coherenceMetric: "COHERENCE_METRIC_v2" });
  assert.equal(changed.length, 1);
  assert.match(changed[0], /coherenceMetric: COHERENCE_METRIC_v1 -> COHERENCE_METRIC_v2/);
});

test("percussion is decided by the instrument name before the definition's family (the keys-as-drums resolution)", () => {
  const def = (family: string) => ({ family }) as TrackModel["instrumentDefinition"];
  assert.equal(isPercussionTrack({ instrument: "drums", instrumentDefinition: def("drums") }), true);
  assert.equal(isPercussionTrack({ instrument: "percussion", instrumentDefinition: def("drums") }), true);
  // dance-full's keys part in a RHYTHMIC_HARMONY role resolves to the kit definition; it is still a piano.
  assert.equal(isPercussionTrack({ instrument: "keys", instrumentDefinition: def("drums") }), false);
  assert.equal(isPercussionTrack({ instrument: "bass", instrumentDefinition: def("strings") }), false);
  assert.equal(gmProgramForTrack({ instrument: "bass", instrumentDefinition: def("strings") }), 33);
  assert.equal(remiFamilyForTrack({ instrument: "bass", instrumentDefinition: def("strings") }), "bass");
  assert.equal(remiFamilyForTrack({ instrument: "strings", instrumentDefinition: def("strings") }), "strings");
  assert.equal(remiFamilyForTrack({ instrument: "drums", instrumentDefinition: def("drums") }), "drums");
});

test("Song Model chords are read into the judge's chord shape with the judge's root spelling", () => {
  const { songModel } = arrangement("dance-full");
  const chords = songModelChords(songModel);
  assert.equal(chords.length, songModel.chords.length);
  assert.equal(chords[0].root, "A");
  assert.equal(chords[0].quality, "min");
  assert.ok(chords.every((c) => c.end > c.start && c.bar >= 1));
  const spelled = songModelChords({
    bars: [{ bar: 1, start: 0, end: 4, beats: 4, confidence: 1 }],
    chords: [
      { start: 0, end: 1, symbol: "Dbmaj7", roman: "I", confidence: 1 },
      { start: 1, end: 2, symbol: "G#m7", roman: "v", confidence: 1 },
      { start: 2, end: 3, symbol: "Bdim", roman: "vii", confidence: 1, root: "B", quality: "dim" },
      { start: 3, end: 4, symbol: "A#7", roman: "V", confidence: 1 },
    ],
  });
  assert.deepEqual(spelled.map((c) => [c.root, c.quality]), [["C#", "maj7"], ["Ab", "min7"], ["B", "dim"], ["Bb", "7"]]);
});

test("the harmony measure reads the candidate's notes: a chord-tone part scores high, a tritone copy low, drums are excluded", () => {
  const { songModel, selected } = arrangement("pop-full");
  const chords = songModelChords(songModel);
  const measure = measureCandidateHarmony(selected.trackModels, chords);
  assert.ok(measure.tracksMeasured >= 2);
  assert.ok(measure.perTrack.every((t) => !/drum/.test(t.trackId)));
  assert.ok((measure.chordToneShare ?? 0) > 0.9, `reference parts sit on chord tones: ${measure.chordToneShare}`);
  assert.ok((measure.harmonyScore ?? 0) > 80);
  const tritone = measureCandidateHarmony(selected.trackModels.map((t) => ({ ...t, notes: t.notes.map((n) => ({ ...n, pitch: n.pitch + 6 })) })), chords);
  assert.ok((tritone.chordToneShare ?? 1) < 0.3, `a tritone away is off the chord: ${tritone.chordToneShare}`);
  assert.ok((tritone.harmonyScore ?? 100) < (measure.harmonyScore ?? 0));
  assert.deepEqual(measureCandidateHarmony([], chords), { chordToneShare: null, clashShare: null, harmonyScore: null, tracksMeasured: 0, perTrack: [] });
});

test("coherence runs on the candidate's tracks with the plan's section targets, 0-based and end-exclusive", () => {
  const { songModel, result, selected } = arrangement("rock-full");
  const targets = planTargetsOf(result.plan)!;
  assert.equal(targets[0].startBar, 0);
  assert.equal(targets[0].endBar, result.plan.globalPlan!.sectionTargets[0].endBar);
  const report = coherenceOfTracks(selected.trackModels, songModel, result.plan);
  assert.ok(report);
  assert.equal(report.barCount, songModel.bars.length);
  assert.equal(report.trackCount, selected.trackModels.filter((t) => t.notes.length).length);
  assert.ok(report.components.trajectorySmoothness.score !== null, "trajectory smoothness is measurable on a 36-bar arrangement");
  assert.ok(!report.limits.some((l) => /no section plan given/.test(l)), "the plan's targets were handed to the metric");
  assert.equal(coherenceOfTracks(selected.trackModels, { bars: [] }, result.plan), null, "no bar grid, no coherence");
});

test("mean candidate distance is the production gate's own distance, averaged over pairs", () => {
  const { result } = arrangement("jazz-full");
  const distance = meanCandidateDistance(result.plan, result.candidates);
  assert.ok(distance !== null && distance >= 0 && distance <= 1);
  assert.equal(meanCandidateDistance(result.plan, result.candidates.slice(0, 1)), null);
  const identical = meanCandidateDistance(result.plan, [result.candidates[0], result.candidates[0]]);
  assert.equal(identical, 0);
});

test("a tournament task can be built around one track of an arrangement", () => {
  const { songModel, selected } = arrangement("rock-full");
  const task = taskFromArrangement(songModel, selected.trackModels, "guitar-rhythmic_harmony", { workId: "rock" })!;
  assert.ok(task);
  assert.equal(task.targetFamily, "guitar");
  assert.equal(task.targetInst, 25);
  assert.equal(task.bars.length, songModel.bars.length);
  assert.ok(task.contextTracks.length >= 3);
  assert.ok(task.contextTracks.every((t) => t.notes.length > 0));
  assert.ok(task.humanTarget.length > 0);
  assert.equal(task.chords.length, songModel.chords.length);
  assert.equal(task.meter.numerator, 4);
  assert.ok(task.limits[0].includes("not a human's"));
  assert.equal(taskFromArrangement(songModel, selected.trackModels, "nope"), null);
});
