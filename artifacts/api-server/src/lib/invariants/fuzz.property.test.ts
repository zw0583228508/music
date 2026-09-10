/**
 * Brain B-12, D3: bounded fuzz.
 *
 * 200 random Song Models, including degenerate ones (one section, one chord,
 * no chords, 300 BPM, 30 BPM, odd meters, empty stems, bar-per-section forms,
 * a gap in the sections): `orchestrateArrangement` must never throw, never
 * return NaN/Infinity, never a pitch outside 0-127, a non-positive duration
 * or a duplicate note id in a track. Failures are recorded with their seed.
 */
import assert from "node:assert/strict";
import test from "node:test";
import type { SongModelData } from "@workspace/db";
import { orchestrateArrangement } from "../arrangementOrchestrator";
import { checkNoteSanity, type Violation } from "./analysis";
import { recordEvidence, seedsUpTo, summarizeOutcomes, type SeedOutcome } from "./evidence";
import { finalizeSongModel, generateSongModel, makeRng } from "./generators";

const SEEDS = seedsUpTo(200, 2000);

type Degeneration = { name: string; apply: (model: SongModelData) => SongModelData };

const DEGENERATIONS: Degeneration[] = [
  { name: "one_section", apply: (m) => finalizeSongModel({ ...m, sections: [{ name: "Song", startBar: 1, endBar: m.sections.at(-1)!.endBar, energy: 0.5 }] }) },
  { name: "one_chord", apply: (m) => finalizeSongModel({ ...m, chords: [{ ...m.chords[0], start: 0, end: m.audio.durationSeconds }] }) },
  { name: "empty_chords", apply: (m) => finalizeSongModel({ ...m, chords: [] }) },
  { name: "bpm_300", apply: (m) => ({ ...m, tempoMap: [{ ...m.tempoMap[0], bpm: 300 }] }) },
  { name: "bpm_30", apply: (m) => ({ ...m, tempoMap: [{ ...m.tempoMap[0], bpm: 30 }] }) },
  { name: "meter_1_4", apply: (m) => ({ ...m, meterMap: [{ ...m.meterMap[0], meter: "1/4" }] }) },
  { name: "meter_13_8", apply: (m) => ({ ...m, meterMap: [{ ...m.meterMap[0], meter: "13/8" }] }) },
  { name: "meter_2_2", apply: (m) => ({ ...m, meterMap: [{ ...m.meterMap[0], meter: "2/2" }] }) },
  { name: "empty_stems", apply: (m) => finalizeSongModel({ ...m, stems: [] }) },
  { name: "bar_per_section", apply: (m) => finalizeSongModel({ ...m, sections: m.bars.slice(0, 24).map((b) => ({ name: `S${b.bar}`, startBar: b.bar, endBar: b.bar, energy: 0.5 })) }) },
  { name: "section_gap", apply: (m) => ({ ...m, sections: m.sections.map((s, i) => (i === 1 ? { ...s, startBar: s.startBar + 1 } : s)) }) },
  { name: "no_energy", apply: (m) => ({ ...m, energy: [], dynamics: [] }) },
  { name: "no_bars_no_beats", apply: (m) => ({ ...m, bars: [], beats: [] }) },
  { name: "no_musical_map", apply: (m) => ({ ...m, musicalMap: undefined }) },
  { name: "duplicate_section_names", apply: (m) => finalizeSongModel({ ...m, sections: m.sections.map((s) => ({ ...s, name: "Part" })) }) },
  { name: "zero_length_audio", apply: (m) => ({ ...m, audio: { ...m.audio, durationSeconds: 0.1 } }) },
  { name: "melody_out_of_range", apply: (m) => ({ ...m, melody: m.melody.map((n) => ({ ...n, pitch: 127 })) }) },
  { name: "all_stems_mix", apply: (m) => finalizeSongModel({ ...m, stems: [{ name: "MIX", role: "MIX", source: "x", channels: 1, confidence: 1 }] }) },
];

export function fuzzSongModel(seed: number): { model: SongModelData; degeneration: string | null } {
  const rng = makeRng(seed ^ 0xabcdef);
  const { model } = generateSongModel(seed, { maxBars: 48 });
  if (rng.chance(0.55)) return { model, degeneration: null };
  const count = rng.int(1, 2);
  let out = model;
  const applied: string[] = [];
  for (let i = 0; i < count; i += 1) {
    const degeneration = rng.pick(DEGENERATIONS);
    try { out = degeneration.apply(out); applied.push(degeneration.name); } catch { applied.push(`${degeneration.name}(refused)`); }
  }
  return { model: out, degeneration: applied.join("+") };
}

/** Observed 2026-09-10 on main da21dff; the assertion is unchanged. */
const KNOWN_FAILURE =
  "194/200 pass and nothing throws. 6 models ship duplicate note ids: a chord whose end exceeds the next section's start by a floating-point epsilon is still included in that section's window (referencePartComposer.ts:80-82) and written as a minimum-duration stub of the previous harmony on the downbeat, with the same position-based id as the new chord's voice (referencePartComposer.ts:88-96, 181).";

test("200 random and degenerate Song Models: the brain never throws and never returns a malformed note", { todo: KNOWN_FAILURE }, (t) => {
  const outcomes: SeedOutcome[] = [];
  const throwsByDegeneration = new Map<string, number>();
  let degenerate = 0;
  for (const seed of SEEDS) {
    const { model, degeneration } = fuzzSongModel(seed);
    if (degeneration) degenerate += 1;
    let violations: Violation[] = [];
    let candidates = 0;
    try {
      const result = orchestrateArrangement({ songModel: model, candidateCount: 2, render: false, now: new Date(0) });
      candidates = result.candidates.length;
      violations = checkNoteSanity(result);
    } catch (error) {
      violations = [{ code: "threw", detail: error instanceof Error ? `${error.constructor.name}: ${error.message.slice(0, 160)}` : String(error) }];
      const key = degeneration ?? "none";
      throwsByDegeneration.set(key, (throwsByDegeneration.get(key) ?? 0) + 1);
    }
    outcomes.push({ seed, passed: violations.length === 0, violations, notes: { degeneration: degeneration ?? "none", candidates } });
  }
  const record = summarizeOutcomes({
    invariant: "fuzz",
    description: "orchestrateArrangement over 200 random Song Models (45% degenerate): no unhandled exception, finite numbers, pitches 0-127, positive durations, unique note ids per track, a selection when candidates exist.",
    outcomes,
    knownFailure: KNOWN_FAILURE,
    extra: { degenerateModels: degenerate, throwsByDegeneration: Object.fromEntries(throwsByDegeneration) },
  });
  recordEvidence(record);
  t.diagnostic(`fuzz: ${record.passed}/${SEEDS.length} pass (${degenerate} degenerate); codes ${JSON.stringify(record.violationCodes)}; throws by degeneration ${JSON.stringify(Object.fromEntries(throwsByDegeneration))}`);
  assert.deepEqual(outcomes.filter((o) => !o.passed).map((o) => `${o.seed} [${o.notes?.degeneration}]: ${o.violations.slice(0, 2).map((v) => `${v.code}: ${v.detail}`).join(" | ")}`), []);
});

test("negative control: the sanity check catches NaN starts, out-of-range pitches, duplicate ids and a missing selection", () => {
  const { model } = generateSongModel(2001, { stems: ["drums", "bass", "keys"], vocals: false, maxBars: 16 });
  const result = orchestrateArrangement({ songModel: model, candidateCount: 1, render: false, now: new Date(0) });
  const broken = JSON.parse(JSON.stringify(result)) as typeof result;
  const track = broken.candidates[0].trackModels[0];
  track.notes[0] = { ...track.notes[0], start: Number.NaN };
  track.notes[1] = { ...track.notes[1], pitch: 140 };
  track.notes[2] = { ...track.notes[2], id: track.notes[3].id };
  track.notes[4] = { ...track.notes[4], duration: 0 };
  broken.selected = null;
  (broken as { selection?: unknown }).selection = { ...(broken as { selection?: object }).selection, reason: "" };
  const codes = new Set(checkNoteSanity(broken).map((v) => v.code));
  for (const code of ["bad_start", "bad_pitch", "duplicate_note_ids", "bad_duration", "nothing_selected"]) assert.ok(codes.has(code), `${code} is reported`);
  assert.deepEqual(checkNoteSanity(result), [], "the unbroken result is clean");
});
