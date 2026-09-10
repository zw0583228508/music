import assert from "node:assert/strict";
import test from "node:test";
import { orchestrateArrangement } from "./arrangementOrchestrator";
import { BENCHMARK_CORPUS, buildBenchmarkSongModel } from "./benchmarkCorpus";
import { taskFromArrangement } from "./benchmarkMeasures";
import {
  LEDGER_RULE,
  METRIC_PROBES,
  applyListeningRung,
  buildPositiveControlLedger,
  controlFamilies,
  corruptionContextForArrangement,
  keyFromSongModel,
  measureArrangementTarget,
  tierHAnchorsFrom,
  tierSAnchorsFrom,
  type ArrangementAnchor,
} from "./positiveControlLedger";
import { CORRUPTION_FAMILY_NAMES } from "./symbolicCorruptions";

const NOW = new Date("2026-01-01T00:00:00.000Z");

function anchorFor(caseId: string): ArrangementAnchor {
  const spec = BENCHMARK_CORPUS.find((c) => c.id === caseId)!;
  const songModel = buildBenchmarkSongModel(spec);
  const result = orchestrateArrangement({ songModel, candidateCount: 1, render: false, now: NOW });
  const selected = result.candidates.find((c) => c.candidateId === result.selected?.candidateId)!;
  return tierSAnchorsFrom([{ id: spec.id, songModel, plan: result.plan, trackModels: selected.trackModels }])[0];
}

test("the control families are the repo's corruption library plus the listening ladder, strongest rung last", () => {
  const families = controlFamilies();
  for (const name of CORRUPTION_FAMILY_NAMES) {
    const family = families.find((f) => f.id === name)!;
    assert.ok(family, `missing ${name}`);
    assert.deepEqual(family.rungs.map((r) => r.strength), [1, 2, 3]);
  }
  const pitch = families.find((f) => f.id === "listening_pitch_shift")!;
  assert.deepEqual(pitch.rungs.map((r) => r.strength), [0.1, 0.3, 0.6]);
  assert.ok(families.some((f) => f.id === "listening_note_deletion"));
  assert.equal(new Set(METRIC_PROBES.map((p) => p.id)).size, METRIC_PROBES.length, "metric ids are unique");
});

test("the Song Model key is read in the corruption library's shape, including the corpus's 'Am minor' spelling", () => {
  assert.deepEqual(keyFromSongModel({ keyMap: [{ time: 0, key: "C major", confidence: 0.9 }] })?.tonic, 0);
  const minor = keyFromSongModel({ keyMap: [{ time: 0, key: "Am minor", confidence: 0.9 }] });
  assert.equal(minor?.tonic, 9);
  assert.equal(minor?.mode, "minor");
  assert.equal(keyFromSongModel({ keyMap: [{ time: 0, key: "E♭ minor", confidence: 0.9 }] })?.tonic, 3);
  assert.equal(keyFromSongModel({ keyMap: [] }), null);
});

test("a listening rung on seconds-domain notes changes the stated share and keeps the rest", () => {
  const notes = Array.from({ length: 40 }, (_, i) => ({ id: `n${i}`, start: i * 0.5, duration: 0.4, pitch: 60 + (i % 5), velocity: 90 }));
  const shifted = applyListeningRung(notes, { kind: "pitch_shift", strength: 0.6 }, "seed", 120, 20);
  assert.equal(shifted.changed, 24);
  assert.equal(shifted.notes.length, 40);
  const moved = shifted.notes.filter((n, i) => n.pitch !== notes[i].pitch).length;
  assert.equal(moved, 24);
  const deleted = applyListeningRung(notes, { kind: "note_deletion", strength: 0.5 }, "seed", 120, 20);
  assert.equal(deleted.notes.length, 20);
  assert.deepEqual(applyListeningRung(notes, { kind: "pitch_shift", strength: 0.6 }, "seed", 120, 20), shifted, "deterministic");
});

test("measuring a target returns every probe the anchor kind supports, and a wrong-pitch copy is worse on the note-level metrics", () => {
  const anchor = anchorFor("pop-full");
  const bass = anchor.trackModels.find((t) => t.id === "bass-bass")!;
  const task = taskFromArrangement(anchor.songModel, anchor.trackModels, bass.id)!;
  const original = measureArrangementTarget(anchor, task, bass.id, bass.notes);
  for (const probe of METRIC_PROBES.filter((p) => p.anchors.includes("arrangement"))) {
    assert.ok(probe.id in original, `probe ${probe.id} not measured`);
  }
  assert.ok((original["musicCritic.overall"] ?? 0) > 0);
  assert.ok((original["benchmarkHarmony.chordToneShare"] ?? 0) > 0.8, "the reference bass sits on chord tones");

  const tritone = measureArrangementTarget(anchor, task, bass.id, bass.notes.map((n) => ({ ...n, pitch: n.pitch + 6 })));
  assert.ok((tritone["benchmarkHarmony.chordToneShare"] ?? 1) < (original["benchmarkHarmony.chordToneShare"] ?? 0));
  assert.ok((tritone["benchmarkHarmony.harmonyScore"] ?? 1) < (original["benchmarkHarmony.harmonyScore"] ?? 0));
  // The audit's finding, as a measurement: the critic's harmony dimension reads the Song Model, not the notes.
  assert.equal(tritone["musicCritic.harmony"], original["musicCritic.harmony"]);
});

test("the corruption context of an arrangement target carries the ensemble, the chords and the key", () => {
  const anchor = anchorFor("pop-full");
  const ctx = corruptionContextForArrangement(anchor, "bass-bass")!;
  assert.equal(ctx.targetFamily, "bass");
  assert.ok(ctx.target.length > 0);
  assert.ok(ctx.contextTracks.length >= 2);
  assert.ok(ctx.chords.length > 0);
  assert.equal(ctx.key?.tonic, 0);
  assert.equal(ctx.bars.length, 40);
});

test("the ledger records detection per metric per family with the stated rule; chord-tone share sees a pitch shift, the critic's harmony dimension does not", () => {
  const anchors = ["pop-full", "rock-full", "jazz-full"].map(anchorFor);
  const families = controlFamilies().filter((f) => ["octave_displacement", "leap_injection", "density_thinning", "listening_pitch_shift"].includes(f.id));
  const ledger = buildPositiveControlLedger(anchors, { families, now: NOW, gitSha: "test" });

  assert.equal(ledger.version, "1.0");
  assert.equal(ledger.rule.gateMinDetection, LEDGER_RULE.gateMinDetection);
  assert.equal(ledger.anchors.length, 3);
  assert.ok(ledger.trials.total > 0);
  for (const row of ledger.rows) {
    assert.ok(["gate", "inform", "demoted", "insufficient_data"].includes(row.verdict));
    const strongest = row.rungs[row.rungs.length - 1];
    assert.equal(row.strongestRung, strongest.rung);
    if (strongest.trials >= LEDGER_RULE.minTrials) {
      const rate = strongest.detectionRate ?? 0;
      if (row.verdict === "gate") assert.ok(rate >= LEDGER_RULE.gateMinDetection, `${row.metric}/${row.family} gated at ${rate}`);
      if (row.verdict === "demoted") assert.ok((strongest.pOneSidedVsChance ?? 0) >= LEDGER_RULE.informMaxP, `${row.metric}/${row.family} demoted while above chance`);
      assert.ok(strongest.ci95 && strongest.ci95[0] <= rate && rate <= strongest.ci95[1]);
    } else {
      assert.equal(row.verdict, "insufficient_data");
    }
  }
  // Every probe the anchors support has a row per family; the verdict is whatever the rule says.
  const playability = ledger.rows.filter((r) => r.metric === "partJudge.playabilityErrors");
  assert.equal(playability.length, families.length);
  for (const row of playability) assert.ok(row.rungs.every((r) => r.trials + r.notApplicable + r.unmeasurable > 0));
  // The one control with an arithmetic guarantee: moving 60 % of a chord-tone
  // part by a semitone or two cannot leave its chord-tone share where it was.
  const chordTone = ledger.rows.find((r) => r.metric === "benchmarkHarmony.chordToneShare" && r.family === "listening_pitch_shift")!;
  assert.ok(chordTone.verdict === "gate" || chordTone.verdict === "inform", chordTone.reason);
  // And the audit's finding, as a ledger row: the critic's harmony dimension does not see it.
  const criticHarmony = ledger.rows.find((r) => r.metric === "musicCritic.harmony" && r.family === "listening_pitch_shift")!;
  assert.equal(criticHarmony.rungs[criticHarmony.rungs.length - 1].detected, 0);
  assert.equal(criticHarmony.verdict, "demoted");
  // The lists partition the metrics honestly: a metric in `demoted` detects nothing anywhere.
  for (const metric of ledger.lists.demoted) {
    const summary = ledger.metrics.find((m) => m.metric === metric)!;
    assert.equal(summary.gate.length + summary.inform.length, 0);
  }
  assert.ok(ledger.honestLimits.length >= 3);
});

test("a task anchor (a real part in its context) is measured by the judge, the harmony measure and coherence only", () => {
  const anchor = anchorFor("rock-full");
  const task = taskFromArrangement(anchor.songModel, anchor.trackModels, "guitar-rhythmic_harmony", { workId: "as-if-pdmx" })!;
  const [taskAnchor] = tierHAnchorsFrom([task]);
  const families = controlFamilies().filter((f) => f.id === "pitch_shift_out_of_key");
  const ledger = buildPositiveControlLedger([taskAnchor], { families, now: NOW });
  const metrics = new Set(ledger.rows.map((r) => r.metric));
  assert.ok(metrics.has("partJudge.score") && metrics.has("benchmarkHarmony.chordToneShare"));
  assert.ok(!metrics.has("musicCritic.overall"), "the critic needs a plan a task does not have");
  assert.ok(ledger.rows.every((r) => r.verdict === "insufficient_data"), "one anchor is one trial; no verdict is drawn from it");
});
