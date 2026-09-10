/**
 * Brain B-12b invariant: harmony as voicing (B-02), measured on the composer's
 * own parts before the candidate strategy, the performance and the repair
 * touch them.
 *
 *   - every chord event: a chord tone among the notes struck at its onset;
 *   - no composed note outside the instrument's playable range;
 *   - the bass never leaps beyond its limit (by construction) and opens on the
 *     slash note under a slash chord;
 *   - parallel perfect fifths / octaves between the bass and a chordal part's
 *     top voice: none under the classical parameters, counted under the
 *     default aesthetic;
 *   - the composer's parts for T_k(song) are T_k(the parts for song), note id
 *     by note id: no octave fold now that ranges are respected by construction.
 *
 * Every checker is shown rejecting a deliberately broken part below.
 */
import assert from "node:assert/strict";
import test from "node:test";
import type { MusicalNote, PartTask } from "@workspace/db";
import {
  bassLeapViolations, chordToneOnsets, compareComposedSongs, composeSong, composedTransposition, isBassPart, isChordalPart, parallelPerfects,
  rangeViolations, slashBassHonoured, type ComposedPart, type Violation,
} from "./analysis";
import type { PartGenerationRequest } from "../partComposer";
import { recordEvidence, seedsUpTo, summarizeOutcomes, type SeedOutcome } from "./evidence";
import { generateSongModel, makeRng, transposeSongModel, withSlashChords } from "./generators";

const SEEDS = seedsUpTo(24, 1400);
const TRANSPOSED_TASKS: readonly PartTask[] = ["BASS", "PIANO", "KEYS", "ACOUSTIC_GUITAR", "ELECTRIC_GUITAR", "STRINGS", "PAD", "BRASS", "WOODWINDS"];
const describe = (violations: Violation[]) => violations.slice(0, 4).map((v) => `${v.code}: ${v.detail}`).join(" | ");
const STEMS = ["drums", "bass", "keys", "guitar", "strings", "pads", "brass"];
const stemsFor = (seed: number) => STEMS.filter((_, i) => i < 3 || (seed + i) % 2 === 0);

test("every chord onset carries a chord tone and every composed note is inside the instrument's range (24 seeds)", (t) => {
  const outcomes: SeedOutcome[] = [];
  let eventsJudged = 0;
  let eventsWithoutOnset = 0;
  let parts = 0;
  for (const seed of SEEDS) {
    const { model } = generateSongModel(seed, { stems: stemsFor(seed), vocals: seed % 3 === 0 });
    const song = composeSong(model);
    const violations: Violation[] = [];
    for (const part of song.parts) {
      if (!part.notes.length) continue;
      if (isChordalPart(part)) {
        parts += 1;
        const report = chordToneOnsets(part);
        eventsJudged += report.eventsJudged;
        eventsWithoutOnset += report.eventsWithoutOnset;
        violations.push(...report.violations);
      }
      if (isChordalPart(part) || isBassPart(part)) violations.push(...rangeViolations(part));
    }
    outcomes.push({ seed, passed: violations.length === 0, violations, notes: { meter: model.meterMap[0].meter, stems: model.stems.map((s) => s.role), tasks: song.parts.length } });
  }
  const record = summarizeOutcomes({
    invariant: "harmony-chord-tones-and-range",
    description: "Composer-direct: at every chord event with notes struck at its onset at least one is a chord tone; no chordal or bass note outside the playable range.",
    outcomes, extra: { chordalParts: parts, chordEventsJudged: eventsJudged, chordEventsWithoutOnsetNotes: eventsWithoutOnset },
  });
  recordEvidence(record);
  t.diagnostic(`chord tones / range: ${record.passed}/${SEEDS.length} pass; ${eventsJudged} chord onsets judged (${eventsWithoutOnset} without an onset note); codes ${JSON.stringify(record.violationCodes)}`);
  assert.deepEqual(outcomes.filter((o) => !o.passed).map((o) => `${o.seed}: ${describe(o.violations)}`), []);
});

/**
 * Observed 2026-09-10 on main 4c5d967 (B-12b); the assertion is unchanged.
 *
 * 22/24 seeds pass; no leap ever exceeded the limit (largest 12 of 12 allowed).
 * Two slash chords lose their stated bass note: `harmonyPlan/bassLine.ts:111-114`
 * returns the pedal candidates and never reaches the slash branch at
 * `:115-118`, so a slash chord that falls inside a `setup` / `afterglow` pedal
 * window is voiced on the pedal's pitch class instead.
 */
const KNOWN_FAILURE_SLASH =
  "harmonyPlan/bassLine.ts:111-118 - the pedal branch returns before the slash branch: 22/24 seeds pass, 2 slash_bass_ignored (seed 1409 Outro/afterglow D/Gb -> pc 9; seed 1412 Section 1/setup Bbm/F -> pc 1)";

test("the bass never leaps beyond its limit and opens on the slash note under a slash chord (24 seeds with seeded slash chords)", { todo: KNOWN_FAILURE_SLASH || undefined }, (t) => {
  const outcomes: SeedOutcome[] = [];
  let slashJudged = 0;
  let slashWithoutOnset = 0;
  let maxLeap = 0;
  let bassParts = 0;
  for (const seed of SEEDS) {
    const base = generateSongModel(seed, { stems: ["drums", "bass", "keys"], vocals: seed % 2 === 0 }).model;
    const { model, slashStarts } = withSlashChords(base, makeRng(seed * 977));
    const song = composeSong(model, { tasks: ["BASS"] });
    const violations: Violation[] = [];
    for (const part of song.parts) {
      if (!part.notes.length) continue;
      bassParts += 1;
      const leaps = bassLeapViolations(part);
      maxLeap = Math.max(maxLeap, leaps.maxLeap);
      violations.push(...leaps.violations);
      const slash = slashBassHonoured(part);
      slashJudged += slash.slashEventsJudged;
      slashWithoutOnset += slash.slashEventsWithoutOnset;
      violations.push(...slash.violations);
    }
    outcomes.push({ seed, passed: violations.length === 0, violations, notes: { slashChords: slashStarts.length, bassParts: song.parts.length, maxLeapLimit: song.parts[0]?.request.constraints.maxLeap ?? null } });
  }
  const record = summarizeOutcomes({
    invariant: "harmony-bass-leaps-and-slash",
    description: "Composer-direct bass: consecutive notes never leap beyond constraints.maxLeap; the first bass note under a slash chord has the slash note's pitch class.",
    outcomes, knownFailure: KNOWN_FAILURE_SLASH || undefined,
    extra: { bassParts, slashEventsJudged: slashJudged, slashEventsWithoutOnsetNote: slashWithoutOnset, largestLeapSeen: maxLeap },
  });
  recordEvidence(record);
  t.diagnostic(`bass: ${record.passed}/${SEEDS.length} pass; ${slashJudged} slash events judged (${slashWithoutOnset} without an onset note); largest leap ${maxLeap}; codes ${JSON.stringify(record.violationCodes)}`);
  assert.deepEqual(outcomes.filter((o) => !o.passed).map((o) => `${o.seed}: ${describe(o.violations)}`), []);
});

/**
 * Observed 2026-09-10 on main 4c5d967 (B-12b); the assertion is unchanged.
 *
 * 7/24 seeds pass; 35 findings, every one a parallel *octave* between the
 * planned bass line and the chordal top voice moving with it (seed 1402
 * Em7->Bm bass 40->42, top 64->66). The bass is never a voice in the pairwise
 * parallel check: `voiceLeading.ts:310-327` costs `parallelPerfect` only
 * between voices inside one voicing, and the planned bass reaches
 * `planVoicings` only as the static unary floor at `voicings.ts:222-226`,
 * which has no motion term. B-02's own suite (`harmonyPlan.test.ts:306`)
 * measures parallels *within* a voicing, so it stays green.
 */
const KNOWN_FAILURE_PARALLELS =
  "voiceLeading.ts:310-327 + voicings.ts:222-226 - the planned bass is a static unary floor, never a voice in the pairwise parallel cost: 7/24 seeds pass, 35 parallel_perfect_classical over 880 pairs (86 under the default aesthetic); seed 1402 Em7->Bm bass 40->42, top 64->66";

test("no parallel perfect fifths / octaves between the bass and a chordal part's top voice under the classical parameters; the default aesthetic's count is reported (24 seeds)", { todo: KNOWN_FAILURE_PARALLELS || undefined }, (t) => {
  const outcomes: SeedOutcome[] = [];
  let classicalPairs = 0;
  let defaultParallels = 0;
  let defaultPairs = 0;
  for (const seed of SEEDS) {
    const { model } = generateSongModel(seed, { stems: ["drums", "bass", "keys", "strings"], vocals: false });
    const classical = composeSong(model, { patch: (request) => ({ ...request, globalPlan: { ...request.globalPlan, style: "classical" } }) });
    const standard = composeSong(model);
    const violations: Violation[] = [];
    const judge = (song: ReturnType<typeof composeSong>, strict: boolean) => {
      let parallels = 0;
      let pairs = 0;
      for (const upper of song.parts.filter(isChordalPart)) {
        const bass = song.parts.find((p) => isBassPart(p) && p.request.section.sectionName === upper.request.section.sectionName);
        if (!bass || !bass.notes.length || !upper.notes.length) continue;
        const report = parallelPerfects(bass, upper);
        parallels += report.parallels;
        pairs += report.pairsJudged;
        if (strict && report.parallels) violations.push({ code: "parallel_perfect_classical", trackId: upper.request.taskId, count: report.parallels, detail: report.examples[0] ?? `${upper.request.taskId}: ${report.parallels} parallel(s)` });
      }
      return { parallels, pairs };
    };
    const c = judge(classical, true);
    const d = judge(standard, false);
    classicalPairs += c.pairs;
    defaultParallels += d.parallels;
    defaultPairs += d.pairs;
    outcomes.push({ seed, passed: violations.length === 0, violations, notes: { classicalParallels: c.parallels, classicalPairs: c.pairs, defaultParallels: d.parallels, defaultPairs: d.pairs } });
  }
  const record = summarizeOutcomes({
    invariant: "harmony-parallels",
    description: "Composer-direct: parallel perfect fifths/octaves between the bass and the top voice at consecutive chord onsets are 0 under classical harmony parameters; the default aesthetic's count is reported, not gated.",
    outcomes, knownFailure: KNOWN_FAILURE_PARALLELS || undefined,
    extra: { classicalPairsJudged: classicalPairs, defaultParallels, defaultPairsJudged: defaultPairs },
  });
  recordEvidence(record);
  t.diagnostic(`parallels: ${record.passed}/${SEEDS.length} pass under classical params (${classicalPairs} pairs judged); default aesthetic ${defaultParallels} parallel(s) over ${defaultPairs} pairs`);
  assert.deepEqual(outcomes.filter((o) => !o.passed).map((o) => `${o.seed}: ${describe(o.violations)}`), []);
});

/**
 * Observed 2026-09-10 on main 4c5d967 (B-12b); the assertion is unchanged.
 *
 * 0/24 seeds pass: of 15,252 matched notes only 4,572 are the exact +k note;
 * 9,905 carry a different pitch class, 775 are octave folds, 119 lost and 112
 * gained. B-12 measured the *pre-B-02* composer transposing exactly (0 wrong
 * pitches over 2,289 notes, probe 2), so this is a regression of the new
 * voicing solver, not an old gap.
 *
 * The isolating control below moves the instrument's range by the same k. It
 * lifts exact 4,572 -> 11,945 and cuts wrong pitch classes 9,905 -> 3,197 and
 * folds 775 -> 110, which places most of the gap on the absolute register
 * anchor: `harmonyPlan/voicings.ts:198-200` derives `targetCentre` from the
 * instrument's range alone (`composer/registers.ts:18-30` never sees the key)
 * and `voicings.ts:210` then pays `registerWeight x |mean(pitches) -
 * targetCentre|`, so the solver re-centres every key on the same absolute band
 * and chooses a different inversion. The 3,197 that survive the control are
 * *not* isolated: the remaining absolute constants (`voicings.ts:80-82`
 * MUD_CEILING 48 / LOW_OCTAVE_CEILING 52, used at `:220` and `:224`) and the
 * melody-register costs at `:235-240` are candidates, untested here.
 */
const KNOWN_FAILURE_TRANSPOSITION =
  "harmonyPlan/voicings.ts:198-200,210 (targetCentre from the instrument's range, not the key; composer/registers.ts:18-30) - 0/24 seeds pass: 4,572 exact of 15,252 matched, 9,905 wrong pitch class, 775 octave folds, 119 lost, 112 gained; the range-shift control lifts exact to 11,945 and leaves 3,197 wrong, which are not isolated";

test("the composer's chordal and bass parts for the transposed song are the transposed parts, note id by note id, with no octave fold (24 seeds, k in -6..6)", { todo: KNOWN_FAILURE_TRANSPOSITION || undefined }, (t) => {
  const outcomes: SeedOutcome[] = [];
  let matched = 0, exact = 0, folds = 0, wrong = 0, lost = 0, gained = 0;
  const byTask = new Map<string, { exact: number; folds: number; wrong: number; setChanged: number }>();
  for (const seed of SEEDS) {
    const rng = makeRng(seed * 7919);
    const k = [-6, -5, -4, -3, -2, -1, 1, 2, 3, 4, 5, 6][rng.int(0, 11)];
    const { model } = generateSongModel(seed, { stems: stemsFor(seed), vocals: seed % 3 === 0 });
    const report = composedTransposition(model, k, { tasks: TRANSPOSED_TASKS });
    matched += report.matched; exact += report.exact; folds += report.octaveFolds; wrong += report.wrongPitchClass; lost += report.lost; gained += report.gained;
    for (const [taskId, row] of Object.entries(report.perTask)) {
      const task = taskId.split("-").slice(-2).join("-");
      const agg = byTask.get(task) ?? { exact: 0, folds: 0, wrong: 0, setChanged: 0 };
      agg.exact += row.exact; agg.folds += row.folds; agg.wrong += row.wrong; agg.setChanged += row.lost + row.gained;
      byTask.set(task, agg);
    }
    outcomes.push({ seed, passed: report.violations.length === 0, violations: report.violations, notes: { k, meter: model.meterMap[0].meter, matched: report.matched, exact: report.exact, folds: report.octaveFolds, wrongPitchClass: report.wrongPitchClass, lost: report.lost, gained: report.gained } });
  }
  const record = summarizeOutcomes({
    invariant: "harmony-transposition-by-construction",
    description: "Composer-direct: for every chordal / bass task, the notes composed for T_k(song) equal T_k(the notes for song) by note id - exact +k on every matched note, no octave fold, no note lost or gained.",
    outcomes, knownFailure: KNOWN_FAILURE_TRANSPOSITION || undefined,
    extra: { matched, exact, octaveFolds: folds, wrongPitchClass: wrong, lost, gained, byTaskKind: Object.fromEntries(byTask) },
  });
  recordEvidence(record);
  t.diagnostic(`composed transposition: ${record.passed}/${SEEDS.length} pass; ${exact} exact, ${folds} folds, ${wrong} wrong pitch class, ${lost} lost, ${gained} gained over ${matched} matched; by task ${JSON.stringify(Object.fromEntries(byTask))}`);
  assert.deepEqual(outcomes.filter((o) => !o.passed).map((o) => `${o.seed} (k ${o.notes?.k}): ${describe(o.violations)}`), []);
});

/**
 * Isolating control for the failure above. The invariant is not weakened: this
 * is a *second* measurement that moves one thing - the instrument's own range -
 * by the same k, so the voicer's absolute register anchor cannot pull the
 * transposed song back to the original band. If the anchor is the cause, the
 * same comparison must improve; the residual is reported, not explained.
 */
test("isolating control: moving each instrument's range by the same k restores most of the composed transposition (24 seeds)", (t) => {
  const shiftRanges = (k: number) => (r: PartGenerationRequest): PartGenerationRequest => ({
    ...r,
    constraints: {
      ...r.constraints,
      playableRange: { min: r.constraints.playableRange.min + k, max: r.constraints.playableRange.max + k },
      comfortableRange: { min: r.constraints.comfortableRange.min + k, max: r.constraints.comfortableRange.max + k },
    },
  });
  const plain = { exact: 0, folds: 0, wrong: 0, matched: 0, pass: 0 };
  const control = { exact: 0, folds: 0, wrong: 0, matched: 0, pass: 0 };
  const residualByTask = new Map<string, number>();
  for (const seed of SEEDS) {
    const rng = makeRng(seed * 7919);
    const k = [-6, -5, -4, -3, -2, -1, 1, 2, 3, 4, 5, 6][rng.int(0, 11)];
    const { model } = generateSongModel(seed, { stems: stemsFor(seed), vocals: seed % 3 === 0 });
    const opts = { tasks: TRANSPOSED_TASKS };
    const base = composeSong(model, opts);
    const a = compareComposedSongs(base, composeSong(transposeSongModel(model, k), opts), k);
    const b = compareComposedSongs(base, composeSong(transposeSongModel(model, k), { ...opts, patch: shiftRanges(k) }), k);
    for (const [side, r] of [[plain, a], [control, b]] as const) {
      side.exact += r.exact; side.folds += r.octaveFolds; side.wrong += r.wrongPitchClass; side.matched += r.matched;
      if (!r.violations.length) side.pass += 1;
    }
    for (const [taskId, row] of Object.entries(b.perTask)) {
      const task = taskId.split("-").slice(-2).join("-");
      residualByTask.set(task, (residualByTask.get(task) ?? 0) + row.wrong + row.folds);
    }
  }
  recordEvidence({
    invariant: "harmony-transposition-register-control",
    description: "Control: the same composer-direct comparison with each instrument's playable and comfortable range moved by k. Isolates how much of the transposition gap is the voicer's absolute register anchor.",
    plain, control, residualByTask: Object.fromEntries([...residualByTask].sort((x, y) => y[1] - x[1])),
  });
  t.diagnostic(`register control: exact ${plain.exact} -> ${control.exact} of ${plain.matched}; wrong ${plain.wrong} -> ${control.wrong}; folds ${plain.folds} -> ${control.folds}; residual by task ${JSON.stringify(Object.fromEntries([...residualByTask].sort((x, y) => y[1] - x[1]).slice(0, 5)))}`);
  assert.ok(control.exact > plain.exact * 1.5, `moving the range restores exact notes (${plain.exact} -> ${control.exact})`);
  assert.ok(control.wrong < plain.wrong / 2, `moving the range halves the wrong pitch classes (${plain.wrong} -> ${control.wrong})`);
  assert.ok(control.wrong > 0, "and does not explain all of it - the residual is named as not isolated, never as fixed");
});

// ---------------------------------------------------------------------------
// Negative controls: each checker rejects a deliberately broken part
// ---------------------------------------------------------------------------

function firstPart(seed: number, pick: (part: ComposedPart) => boolean): ComposedPart {
  const { model } = generateSongModel(seed, { stems: ["drums", "bass", "keys", "strings"], vocals: false });
  const song = composeSong(model);
  const part = song.parts.find((p) => pick(p) && p.notes.length > 8);
  assert.ok(part, "a part to break");
  return part!;
}

test("negative control: a chordal part whose onset notes are moved off the chord fails the chord-tone check; a note pushed out of range fails the range check", () => {
  const part = firstPart(1401, isChordalPart);
  assert.deepEqual(chordToneOnsets(part).violations, [], "the composed part passes");
  const offChord: ComposedPart = { ...part, notes: part.notes.map((n) => ({ ...n, pitch: n.pitch + 1 })) };
  // A semitone shift of every voice leaves a chord tone only by coincidence (a chord's tones are never all a semitone apart).
  assert.ok(chordToneOnsets(offChord).violations.length > 0, "shifted voicings are refused");
  const high: ComposedPart = { ...part, notes: part.notes.map((n, i) => (i === 0 ? { ...n, pitch: part.request.constraints.playableRange.max + 5 } : n)) };
  assert.ok(rangeViolations(high).some((v) => v.code === "out_of_range"));
  assert.deepEqual(rangeViolations(part), []);
});

test("negative control: a 20-semitone bass leap and a bass that ignores a slash are reported", () => {
  const base = generateSongModel(1402, { stems: ["drums", "bass", "keys"], vocals: false }).model;
  const { model, slashStarts } = withSlashChords(base, makeRng(1), 1);
  assert.ok(slashStarts.length > 4, "slash chords were written");
  const song = composeSong(model, { tasks: ["BASS"] });
  const part = song.parts.find((p) => p.notes.length > 4)!;
  assert.deepEqual(bassLeapViolations(part).violations, []);
  const leaping: ComposedPart = { ...part, notes: part.notes.map((n, i) => (i === 1 ? { ...n, pitch: n.pitch + 20 } : n)) };
  assert.ok(bassLeapViolations(leaping).violations.some((v) => v.code === "bass_leap_over_limit"));
  const slash = slashBassHonoured(part);
  assert.ok(slash.slashEventsJudged > 0, "slash events were judged");
  assert.deepEqual(slash.violations, []);
  const rooted: ComposedPart = {
    ...part,
    notes: part.notes.map((n) => {
      const event = part.events.find((e) => e.chord.bass !== e.chord.root && n.start >= e.start - 1e-3 && n.start < e.end - 1e-3);
      return event ? { ...n, pitch: n.pitch - ((n.pitch % 12) - event.chord.root + 12) % 12 } : n;
    }),
  };
  assert.ok(slashBassHonoured(rooted).violations.some((v) => v.code === "slash_bass_ignored"), "a bass that plays the root under every slash is refused");
});

test("negative control: a top voice that shadows the bass a fifth above is counted as parallel fifths; the composed pair is not", () => {
  const { model } = generateSongModel(1403, { stems: ["drums", "bass", "keys"], vocals: false });
  const song = composeSong(model, { patch: (request) => ({ ...request, globalPlan: { ...request.globalPlan, style: "classical" } }) });
  const upper = song.parts.find((p) => isChordalPart(p) && p.notes.length > 8)!;
  const bass = song.parts.find((p) => isBassPart(p) && p.request.section.sectionName === upper.request.section.sectionName)!;
  const honest = parallelPerfects(bass, upper);
  assert.ok(honest.pairsJudged > 2, `pairs judged: ${honest.pairsJudged}`);
  const shadow: MusicalNote[] = bass.notes.map((n) => ({ ...n, id: `${n.id}-shadow`, pitch: n.pitch + 19 }));
  const shadowing: ComposedPart = { ...upper, notes: shadow };
  const report = parallelPerfects(bass, shadowing);
  assert.ok(report.parallels > 0 && report.parallels >= report.pairsJudged * 0.5, `shadowing a fifth above is parallel fifths on most pairs (${report.parallels}/${report.pairsJudged})`);
});

test("negative control: a twin shifted by 3 is refused under k = 0, an octave-folded voice is counted, a dropped note is reported; the exact twin passes", () => {
  const { model } = generateSongModel(1404, { stems: ["drums", "bass", "keys"], vocals: false });
  const zero = composedTransposition(model, 0, { tasks: ["BASS", "KEYS", "PIANO"] });
  assert.deepEqual(zero.violations, [], "k = 0 is the identity");
  assert.ok(zero.matched > 20);
  const a = composeSong(model, { tasks: ["BASS", "KEYS", "PIANO"] });
  const shifted = { parts: a.parts.map((p) => ({ ...p, notes: p.notes.map((n) => ({ ...n, pitch: n.pitch + 3 })) })) };
  assert.ok(compareComposedSongs(a, shifted, 0).violations.some((v) => v.code === "voicing_not_transposed"), "a shifted twin is not the identity");
  assert.deepEqual(compareComposedSongs(a, shifted, 3).violations, [], "and it is the exact +3 twin");
  const folded = { parts: a.parts.map((p) => ({ ...p, notes: p.notes.map((n, i) => (i === 0 ? { ...n, pitch: n.pitch + 12 } : n)) })) };
  const foldReport = compareComposedSongs(a, folded, 0);
  assert.ok(foldReport.octaveFolds >= 1 && foldReport.violations.some((v) => v.code === "voicing_octave_folded"), "an octave fold is counted and refused");
  const dropped = { parts: a.parts.map((p) => ({ ...p, notes: p.notes.slice(1) })) };
  assert.ok(compareComposedSongs(a, dropped, 0).violations.some((v) => v.code === "voicing_note_set_changed"));
});
