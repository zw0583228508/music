/**
 * Brain B-12 invariant: transposition.
 *
 * Arranging T_k(song) must give T_k(arrangement of song): the same notes at
 * the same times, every pitched note k semitones away (a whole octave more or
 * less is a fold forced by the instrument's range and is counted, not
 * failed), drums untouched, the same families active per section, the same
 * roles, and the same playability verdict.
 */
import assert from "node:assert/strict";
import test from "node:test";
import type { MusicalNote } from "@workspace/db";
import { checkTransposition, runBrain, type Violation } from "./analysis";
import { recordEvidence, seedsUpTo, summarizeOutcomes, type SeedOutcome } from "./evidence";
import { generateSongModel, makeRng, transposeSongModel } from "./generators";

const SEEDS = seedsUpTo(24);
const describe = (violations: Violation[]) => violations.slice(0, 4).map((v) => `${v.code}: ${v.detail}`).join(" | ");

/** Observed 2026-09-10 on main da21dff; the assertion below is unchanged and will pass when these are fixed. */
const KNOWN_FAILURE =
  "7/24 seeds pass. (1) In x/8 metres the composer's bar is numerator x quarter (referencePartComposer.ts:73-78), so intro/ending/transition tasks find no chord in their window and write a literal C-major [0,4,7] (referencePartComposer.ts:266): pitch_not_transposed on every ensemble track of every 6/8 and 7/8 seed. " +
  "(2) playabilityRepair.ts:139 breaks velocity ties on pitch, so which voice of a legal chord it drops depends on the key: voice_choice_changed on 10 seeds. (3) seed 21: constraint-error count differs (60 vs 54).";

test("transposition by k in -6..+6 transposes every pitched part by k (mod 12 folds counted), keeps rhythm, drums, families, roles and playability", { todo: KNOWN_FAILURE }, (t) => {
  const outcomes: SeedOutcome[] = [];
  let folds = 0;
  let matched = 0;
  let gestures = 0;
  for (const seed of SEEDS) {
    const rng = makeRng(seed * 104_729);
    const k = [-6, -5, -4, -3, -2, -1, 1, 2, 3, 4, 5, 6][rng.int(0, 11)];
    const { model } = generateSongModel(seed);
    const original = runBrain(model);
    const transposed = runBrain(transposeSongModel(model, k));
    const report = checkTransposition(original, transposed, k);
    folds += report.octaveFolds;
    matched += report.matchedNotes;
    gestures += report.gestureShifts;
    const perform = (r: typeof original) => JSON.stringify(r.stages.find((s) => s.stage === "perform")?.evidence ?? null);
    outcomes.push({
      seed, passed: report.violations.length === 0, violations: report.violations,
      notes: {
        k, octaveFolds: report.octaveFolds, matchedNotes: report.matchedNotes, gestureShifts: report.gestureShifts,
        rhythmChangedFamilies: report.rhythmChangedFamilies,
        meter: model.meterMap[0].meter, stems: model.stems.map((s) => s.role),
        performOriginal: perform(original), performTransposed: perform(transposed),
      },
    });
  }
  const record = summarizeOutcomes({
    invariant: "transposition",
    description: "Arrangement of the transposed Song Model equals the transposed arrangement: pitch classes +k per matched note id, identical onsets/durations (chord-roll order shifts under 40 ms reported, not failed), drums unchanged, families/roles/playability unchanged.",
    outcomes,
    knownFailure: KNOWN_FAILURE,
    extra: { totalOctaveFolds: folds, totalMatchedNotes: matched, totalGestureShifts: gestures },
  });
  recordEvidence(record);
  t.diagnostic(`transposition: ${record.passed}/${SEEDS.length} seeds pass; ${folds} octave folds and ${gestures} sub-gesture shifts over ${matched} matched notes; codes ${JSON.stringify(record.violationCodes)}`);
  const failing = outcomes.filter((o) => !o.passed);
  assert.deepEqual(failing.map((o) => `${o.seed}: ${describe(o.violations)}`), [], "every seed satisfies the transposition invariant");
});

test("negative control: a composer that ignores the harmony is caught (pitch classes do not follow k)", () => {
  const { model } = generateSongModel(5, { stems: ["drums", "bass", "keys"], vocals: false });
  // A "composer" that writes C major arpeggios whatever the chords say.
  const deaf = (request: { taskId: string; section: { startBar: number; endBar: number } }): MusicalNote[] => {
    const notes: MusicalNote[] = [];
    const bpm = model.tempoMap[0].bpm;
    const barSeconds = (60 / bpm) * 4;
    for (let bar = request.section.startBar; bar <= request.section.endBar; bar += 1) {
      [60, 64, 67, 72].forEach((pitch, i) => notes.push({
        id: `${request.taskId}-${bar}-${i}`, start: Number(((bar - 1) * barSeconds + i * barSeconds / 4).toFixed(4)), duration: 0.4, pitch, velocity: 90,
      }));
    }
    return notes;
  };
  const original = runBrain(model, { composeParts: deaf, candidateCount: 2 });
  const transposed = runBrain(transposeSongModel(model, 4), { composeParts: deaf, candidateCount: 2 });
  const report = checkTransposition(original, transposed, 4);
  assert.ok(report.violations.some((v) => v.code === "pitch_not_transposed"), `the harmony-deaf composer fails the invariant: ${describe(report.violations)}`);
});

test("negative control: comparing a run with itself under k != 0 fails, and with k = 0 passes", () => {
  const { model } = generateSongModel(6, { stems: ["drums", "bass", "keys", "strings"], vocals: false });
  const result = runBrain(model, { candidateCount: 2 });
  assert.ok(checkTransposition(result, result, 3).violations.some((v) => v.code === "pitch_not_transposed"), "an untransposed twin is not a transposition");
  assert.deepEqual(checkTransposition(result, result, 0).violations, [], "a run is its own zero-transposition");
});

test("negative control: a dropped note or a moved onset is reported", () => {
  const { model } = generateSongModel(7, { stems: ["drums", "bass", "keys"], vocals: false });
  const a = runBrain(model, { candidateCount: 1 });
  const b = JSON.parse(JSON.stringify(a)) as typeof a;
  const track = b.candidates[0].trackModels.find((t) => t.instrument === "bass") ?? b.candidates[0].trackModels[0];
  track.notes = track.notes.slice(1).map((n, i) => (i === 0 ? { ...n, start: n.start + 0.3 } : n));
  const report = checkTransposition(a, b, 0);
  assert.ok(report.violations.some((v) => v.code === "note_set_changed"), "the lost note is reported");
  assert.ok(report.violations.some((v) => v.code === "rhythm_changed"), "the moved onset is reported");
});
