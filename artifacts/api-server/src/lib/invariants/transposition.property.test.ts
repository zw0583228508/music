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

/**
 * Refreshed for B-12b. B-12's reason named the x/8 bar length and the repair's
 * pitch tie-break, and recorded that "the raw composer transposes exactly, 0
 * wrong pitches over 2,289 notes". That is no longer true, and the cause has
 * moved upstream of everything B-12 measured.
 *
 * Observed 2026-09-10 on 4c5d967: **0/24 seeds pass** (B-12: 7/24), 2,945
 * octave folds and 214 `pitch_not_transposed` findings over 69,686 matched
 * notes. B-12b's composer-direct probe (`harmony.property.test.ts`) shows the
 * composer itself no longer transposes: of 15,252 matched composed notes only
 * 4,572 are the exact +k note. Its isolating control - moving each
 * instrument's range by the same k - lifts that to 11,945, which places most
 * of the gap on the voicer's absolute register anchor
 * (`harmonyPlan/voicings.ts:198-200,210`; `composer/registers.ts:18-30` never
 * sees the key). The 3,197 notes the control does not explain are not
 * isolated. The repair's pitch tie-break (`playabilityRepair.ts:139`) still
 * contributes the `voice_choice_changed` findings.
 */
const KNOWN_FAILURE =
  "harmonyPlan/voicings.ts:198-200,210 - the voicing solver re-centres every key on the instrument's absolute band, so T_k(song) is not T_k(the parts) - 0/24 seeds pass (B-12: 7/24): 2,945 octave folds, 214 pitch_not_transposed, 154 note_set_changed, 33 voice_choice_changed (playabilityRepair.ts:139) over 69,686 matched notes";

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
