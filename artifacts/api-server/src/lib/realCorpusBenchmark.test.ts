import assert from "node:assert/strict";
import test from "node:test";
import { orchestrateArrangement } from "./arrangementOrchestrator";
import { BENCHMARK_CORPUS, buildBenchmarkSongModel } from "./benchmarkCorpus";
import { REAL_BENCHMARK_CORPUS, corpusCoverage, type CorpusEntry } from "./benchmarkCorpusPlan";
import { gmProgramForTrack, isPercussionTrack } from "./benchmarkMeasures";
import { parseMidiFile, writeMidiFile, type MidiNote } from "./midiFile";
import {
  BENCHMARK_LEVELS,
  TIER_H_TASK,
  levelBlocker,
  planRealBenchmark,
  runRealCorpusBenchmark,
  stripContextFamilies,
  tierHTasksFor,
} from "./realCorpusBenchmark";
import { attributesFromMeasurement, measurePdmxWork, selectTierH, tierHRefusal } from "./realCorpusSelection";
import { HUMAN_SUT, REFERENCE_SUT, type TournamentProvider } from "./tournamentProviders";

const NOW = new Date("2026-01-01T00:00:00.000Z");

/** A multitrack MIDI in the tournament's shape, written from an orchestrator arrangement of a synthetic case. */
function midiFromCase(caseId: string): Buffer {
  const spec = BENCHMARK_CORPUS.find((c) => c.id === caseId)!;
  const songModel = buildBenchmarkSongModel(spec);
  const result = orchestrateArrangement({ songModel, candidateCount: 1, render: false, now: NOW });
  const selected = result.candidates.find((c) => c.candidateId === result.selected?.candidateId)!;
  const tpq = 480;
  const quarter = 60 / spec.tempoBpm;
  const [num, den] = spec.meter.split("/").map(Number);
  const notes: MidiNote[] = selected.trackModels.flatMap((track, index) => {
    const percussion = isPercussionTrack(track);
    const program = percussion ? 0 : gmProgramForTrack(track);
    return track.notes.map((n) => ({
      track: index + 1, channel: percussion ? 9 : 0, program, isPercussion: percussion,
      pitch: n.pitch, velocity: n.velocity,
      startTick: Math.round((n.start / quarter) * tpq), endTick: Math.round(((n.start + n.duration) / quarter) * tpq) + 1,
    }));
  });
  return writeMidiFile({
    ticksPerQuarter: tpq, notes,
    tempos: [{ tick: 0, usPerQuarter: Math.round(60_000_000 / spec.tempoBpm), bpm: spec.tempoBpm }],
    timeSignatures: [{ tick: 0, numerator: num, denominator: den }],
  });
}

const songModelBars = (caseId: string) => buildBenchmarkSongModel(BENCHMARK_CORPUS.find((c) => c.id === caseId)!).bars.length;

function entryFor(id: string, midi: Buffer, admittedBy: "b08-csv-scan" | "tournament-global" = "b08-csv-scan"): CorpusEntry {
  const measured = measurePdmxWork(parseMidiFile(midi));
  assert.ok(measured.ok);
  const { genre, ...attributes } = attributesFromMeasurement(measured.measurement, { n_pitch_classes: 6, genres: "pop" });
  void genre;
  return {
    id: `pdmx-${id}`, title: id, inputType: "midi",
    rights: { kind: "public_domain", reference: "https://example.org/licence", work: `${id} (PDMX test)`, clearedAt: "2026-01-01T00:00:00.000Z", commercialUse: true, composer: "Test Composer", composerDied: 1800 },
    attributes,
    symbolicSource: {
      kind: "pdmx_midi", workId: id, relativePath: `mid/mid/0/0/${id}.mid`, sha256: "0".repeat(64), admittedBy,
      measured: { bars: measured.measurement.bars, tracks: measured.measurement.tracks, families: measured.measurement.families, meter: measured.measurement.meter, tempoBpm: measured.measurement.tempoBpm, tempoChanges: 0, notesPerBar: measured.measurement.notesPerBar, swingRatio: measured.measurement.swingRatio, effectivePitchClasses: 6 },
      genre: { primary: "pop", families: ["pop"], source: "genres" },
    },
  };
}

test("the Tier H task is stated once and the north-star level stays blocked", () => {
  assert.equal(TIER_H_TASK.id, "strip-families-and-arrange");
  const readiness = planRealBenchmark(REAL_BENCHMARK_CORPUS);
  assert.match(levelBlocker(BENCHMARK_LEVELS.vsHumanGold, readiness) ?? "", /human gold/);
});

test("a symbolic entry is runnable without an uploaded source; coverage still reports its gaps", () => {
  const entry = entryFor("rock", midiFromCase("rock-full"));
  const readiness = planRealBenchmark([entry]);
  assert.equal(readiness.runnable.length, 1);
  assert.equal(readiness.ready, false);
  assert.ok(readiness.blockers.some((b) => /songs: 1 of 100/.test(b)));
  const coverage = corpusCoverage([entry]);
  assert.ok(coverage.gaps.some((g) => /inputType "full_song"/.test(g)), "a score is never a recorded song");
});

test("measurement reads metre, tempo, bars, parts, families and density from the MIDI; the coverage attributes follow the stated thresholds", () => {
  const midi = parseMidiFile(midiFromCase("orchestral-midi"));
  const measured = measurePdmxWork(midi);
  assert.ok(measured.ok);
  const m = measured.measurement;
  assert.equal(m.meter, "3/4");
  assert.equal(m.tempoBpm, 76);
  // Recalibrated at the merge (B-01): the Song Model has 36 bars, but the
  // merged brain's strings-climax_layer holds its final chord (three notes,
  // 5.42 s from bar 35) 0.71 s past the last bar line at 76 BPM in 3/4, and
  // measurePdmxWork counts bars up to the last note-off (ceil), so the written
  // MIDI measures as 37 bars (36 on 3bf23aa). The overrun is asserted as such,
  // not hidden: the bar count follows the notes, and the notes now run over.
  const ticksPerBar = 3 * 480;
  assert.equal(songModelBars("orchestral-midi"), 36);
  assert.ok(midi.endTick > 36 * ticksPerBar && midi.endTick <= 37 * ticksPerBar, `the arrangement's last note-off (${midi.endTick} ticks) lies inside a 37th bar`);
  assert.equal(m.bars, 37);
  assert.ok(m.tracks >= 3);
  assert.ok(m.families.includes("bass") && m.families.includes("drums"));
  const attributes = attributesFromMeasurement(m, { n_pitch_classes: 10.5, genres: "classical" });
  assert.equal(attributes.meter, "3/4");
  assert.equal(attributes.tempoBand, "medium");
  assert.equal(attributes.harmony, "complex");
  assert.equal(attributes.idiom, "western");
  assert.equal(attributes.production, "acoustic");
  assert.equal(tierHRefusal(m), null);
  assert.match(tierHRefusal({ ...m, families: ["keys"] }) ?? "", /not multitrack/);
  assert.match(tierHRefusal({ ...m, bars: 8 }) ?? "", /shorter/);
  const world = attributesFromMeasurement(m, { n_pitch_classes: 6, genres: "worldmusic", tags: "klezmer" });
  assert.equal(world.idiom, "non_western");
  const compound = attributesFromMeasurement({ ...m, meter: "6/8" }, { n_pitch_classes: 6 });
  assert.equal(compound.feel, "compound");
});

test("a work with two metres is refused rather than measured on the wrong grid", () => {
  const midi = parseMidiFile(midiFromCase("pop-full"));
  const changed = { ...midi, timeSignatures: [...midi.timeSignatures, { tick: 4 * 480 * 8, numerator: 3, denominator: 4 }] };
  const measured = measurePdmxWork(changed);
  assert.equal(measured.ok, false);
  if (!measured.ok) assert.match(measured.refusal, /metre changes/);
});

test("selection fills the rare values first, prefers already-admitted seeds, and reports what stays short", () => {
  const rock = entryFor("rock", midiFromCase("rock-full"), "tournament-global");
  const waltz = entryFor("waltz", midiFromCase("orchestral-midi"));
  // Distinct titles: distinct compositions. A second arrangement of the same work is collapsed (tested below).
  const pool = [waltz, { ...waltz, id: "pdmx-waltz2", title: "waltz 2" }, { ...waltz, id: "pdmx-waltz3", title: "waltz 3" }, ...Array.from({ length: 6 }, (_, i) => ({ ...rock, id: `pdmx-rock${i}`, title: `rock ${i}` }))];
  const { chosen, short } = selectTierH([rock], pool, { max: 6 });
  assert.equal(chosen.length, 6);
  assert.equal(selectTierH([], [waltz, { ...waltz, id: "pdmx-waltz-again" }], { max: 6 }).chosen.length, 1, "one entry per composition: a second arrangement of the same work adds a task, not coverage");
  assert.equal(chosen.filter((e) => e.attributes.meter === "3/4").length, 3, "the rare metre claims its slots before 4/4 fills the corpus");
  assert.ok(chosen.some((e) => e.id === rock.id), "the seed is kept");
  assert.ok(short.some((s) => s.dimension === "meter" && s.value === "6/8" && s.have === 0), "an unfillable value is reported short, not invented");
  assert.deepEqual(selectTierH([rock], pool, { max: 6 }).chosen.map((e) => e.id), chosen.map((e) => e.id), "deterministic");
});

test("selection excludes a contested work before any quota is filled, names it with the reason, and leaves the value short rather than filling it", () => {
  const rock = entryFor("rock", midiFromCase("rock-full"), "tournament-global");
  const waltz = entryFor("waltz", midiFromCase("orchestral-midi"));
  const contestedWaltz: CorpusEntry = {
    ...waltz, id: "pdmx-waltz-contested", title: "A waltz under CC0 by a living composer",
    rights: { kind: "contested", commercialUse: false, reference: waltz.rights.reference, work: waltz.rights.work, clearedAt: waltz.rights.clearedAt, reason: "the PDMX row names \"Living Composer\", not on the verified public-domain composer list" },
  };
  const scoreOnlyWaltz: CorpusEntry = {
    ...waltz, id: "pdmx-waltz-score-only", title: "A waltz cleared on the score's licence alone",
    // The type itself refuses a public-domain basis with no composition evidence; the cast builds the shape the old corpus carried.
    rights: { kind: "public_domain", commercialUse: true, reference: waltz.rights.reference, work: waltz.rights.work, clearedAt: waltz.rights.clearedAt } as unknown as CorpusEntry["rights"],
  };
  const contestedSeed: CorpusEntry = { ...rock, id: "pdmx-rock-contested", title: "Pop song", rights: { ...contestedWaltz.rights } };
  const { chosen, short, excluded } = selectTierH([rock, contestedSeed], [waltz, contestedWaltz, scoreOnlyWaltz, { ...rock, id: "pdmx-rock2", title: "rock 2" }], { max: 6 });
  assert.ok(!chosen.some((e) => e.rights.kind !== "public_domain"), "nothing contested is chosen");
  assert.ok(!chosen.some((e) => e.id === scoreOnlyWaltz.id), "a public-domain claim with no composition basis is not chosen either");
  assert.equal(chosen.filter((e) => e.attributes.meter === "3/4").length, 1, "the two unproven waltzes do not fill the 3/4 quota");
  assert.ok(short.some((s) => s.dimension === "meter" && s.value === "3/4" && s.have === 1), "the gap is reported, not filled");
  assert.deepEqual(excluded.map((x) => x.id).sort(), [contestedSeed.id, contestedWaltz.id, scoreOnlyWaltz.id].sort());
  assert.match(excluded.find((x) => x.id === contestedWaltz.id)!.reason, /is contested: .*Living Composer/);
  assert.match(excluded.find((x) => x.id === scoreOnlyWaltz.id)!.reason, /score's licence alone/);
  assert.equal(excluded.find((x) => x.id === contestedSeed.id)!.admittedBy, "tournament-global");
});

test("Tier H tasks strip one family per task; further stripping thins the context, never the anchor", () => {
  const midi = parseMidiFile(midiFromCase("rock-full"));
  const { tasks, refusal } = tierHTasksFor(midi, "rock", { windowBars: 16, maxTasksPerWork: 4, stripAdditionalFamilies: 0 });
  assert.equal(refusal, null);
  assert.ok(tasks.length >= 2, `expected tasks for several programs, got ${tasks.length}`);
  assert.equal(new Set(tasks.map((t) => t.task.targetInst)).size, tasks.length, "one task per program");
  const [first] = tasks;
  const stripped = stripContextFamilies(first.task, 1)!;
  assert.ok(stripped);
  assert.equal(stripped.stripped.length, 1);
  assert.equal(stripped.task.contextTracks.length, first.task.contextTracks.length - first.task.contextTracks.filter((t) => t.family === stripped.stripped[0]).length);
  assert.deepEqual(stripped.task.humanTarget, first.task.humanTarget, "the anchor is untouched");
  assert.equal(stripContextFamilies(first.task, 99), null, "a context cannot lose every family");
});

test("the Tier H benchmark runs the reference composer on every entry with material and reports part-level scores against the human anchor", async () => {
  const rock = entryFor("rock", midiFromCase("rock-full"));
  const jazz = entryFor("jazz", midiFromCase("jazz-full"));
  const missing = entryFor("missing", midiFromCase("pop-full"));
  const bytes = new Map([[rock.id, midiFromCase("rock-full")], [jazz.id, midiFromCase("jazz-full")]]);
  const silent: TournamentProvider = { id: "SILENT_PROVIDER", kind: "model", async generate() { return { notes: [], account: null, inferenceSeconds: 0, failure: null }; } };
  const run = await runRealCorpusBenchmark({
    entries: [rock, jazz, missing],
    loadMidi: (entry) => bytes.get(entry.id) ?? null,
    providers: [silent],
    seeds: [7],
    windowBars: 16,
    maxTasksPerWork: 2,
    now: NOW,
    gitSha: "test",
  });
  assert.equal(run.tier, "H");
  assert.equal(run.task, TIER_H_TASK);
  assert.deepEqual(run.providers, [HUMAN_SUT, "SILENT_PROVIDER"], "the human anchor is always run");
  assert.deepEqual(run.unavailable, [{ id: missing.id, reason: "MIDI not present on this machine" }]);
  assert.equal(run.works.length, 2);
  const tasks = run.works.flatMap((w) => w.tasks);
  assert.ok(tasks.length >= 2);
  for (const task of tasks) {
    assert.ok(task.human.score > 0, "the human part scores above zero on its own window");
    assert.equal(task.byProvider.SILENT_PROVIDER.score, 0, "a silent part is a real, scored outcome: zero");
    assert.ok((task.byProvider.SILENT_PROVIDER.deltaVsHuman ?? 0) < 0);
  }
  const silentAggregate = run.aggregate.find((a) => a.providerId === "SILENT_PROVIDER")!;
  assert.equal(silentAggregate.meanScore, 0);
  assert.equal(silentAggregate.atOrAboveHumanShare, 0);
  assert.match(run.levelBlockers[BENCHMARK_LEVELS.vsHumanGold] ?? "", /human gold/);
  assert.ok(run.honestLimits.length >= 4);
  assert.ok(run.corpus.gaps.length > 0);
  assert.equal(run.providers.includes(REFERENCE_SUT), false, "providers are exactly what was asked for, plus the anchor");
});
