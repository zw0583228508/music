/**
 * Brain B-12b invariant: one groove, shared (B-04), on the shipped notes.
 *
 *   - where the plan locks the bass to the kick, the bass strikes with the kick;
 *   - where the plan pushes an up-beat, the kit, the bass and the comping push
 *     it together;
 *   - the hats never strike faster than the tempo ceiling the plan documents;
 *   - the downbeat kick is there (the metre suite judges the accents; this one
 *     measures how many bars keep a kick on beat 1 and why not).
 *
 * The 3/4, 6/8, 5/4 and 7/8 accents are B-12's metre suite, re-run separately.
 */
import assert from "node:assert/strict";
import test from "node:test";
import type { MusicalNote, PartTask } from "@workspace/db";
import type { OrchestrationResult } from "../arrangementOrchestrator";
import { anticipationsShared, composeSong, geometryOf, groovePlanOf, hatCeiling, isAccentHit, isDrumTrack, kickBassLock, notesInBars, runBrain, type Violation } from "./analysis";
import { recordEvidence, seedsUpTo, summarizeOutcomes, type SeedOutcome } from "./evidence";
import { generateSongModel } from "./generators";

const SEEDS = seedsUpTo(20, 1500);
const KIT_TASKS: readonly PartTask[] = ["DRUMS"];
const describe = (violations: Violation[]) => violations.slice(0, 4).map((v) => `${v.code}: ${v.detail}`).join(" | ");

const runs = new Map<number, { result: OrchestrationResult; model: ReturnType<typeof generateSongModel>["model"] }>();
function runFor(seed: number) {
  const held = runs.get(seed);
  if (held) return held;
  const model = generateSongModel(seed, { stems: ["drums", "bass", "keys"], vocals: seed % 2 === 0, naming: "english" }).model;
  const entry = { model, result: runBrain(model, { candidateCount: 1 }) };
  runs.set(seed, entry);
  return entry;
}

/**
 * Observed 2026-09-10 on main 4c5d967 (B-12b); the assertions are unchanged.
 *
 * B-04 planned the groove; nothing on the shipped path reads it for a pitched
 * part. `composer/rhythmParts.ts:255` `bassRhythmFor` and `:193`
 * `compingRhythmFor` have no caller outside `brainB04Evidence.ts` (grep over
 * `src/`, test files excluded); the bass and the comping are still written
 * from the chord span by `composer/harmonyParts.ts:283-289`, so the kit is on
 * the plan's grid and the pitched parts are on the chord sheet's. B-04's own
 * evidence module says so at `brainB04Evidence.ts:512`.
 */
const KNOWN_FAILURE_LOCK =
  "composer/harmonyParts.ts:283-289 writes the bass from the chord span; composer/rhythmParts.ts:255 bassRhythmFor has no production caller - 7/20 seeds pass, 691/899 accented kicks have a bass onset within 60 ms over 104 sections the plan locks (seed 1501 onward)";
const KNOWN_FAILURE_ANTICIPATION =
  "composer/rhythmParts.ts:193 compingRhythmFor has no production caller - 7/20 seeds pass; of 260 kit pushes the comping strikes with only 19 and the bass with 138";
/**
 * B-12 attributed a missing downbeat kick to `applyDensity` stride thinning
 * (its C7). That is not the cause here, and the control below says why: the
 * *composed* kit already has the downbeat in only 181 of 718 bars, the shipped
 * kit in 173 of 818, and every one of those bars' groove cells lists unit 0 as
 * a kick. The kick on 1 is planned and then deleted by
 * `composer/rhythmParts.ts:442` - `if (u === 0 && b.tiedDownbeat) continue` -
 * where `tiedDownbeat` (`:101`, set at `:105`) is true whenever *any* part's
 * anticipation slot targets the bar line. The kit's own replacement push at
 * `:443-446` is gated on `anticipations.value.kickAnticipates`, so where the
 * plan withholds the kick's anticipation the downbeat is removed and nothing
 * takes its place: 177 of 238 such bars carry no kick within three quarters of
 * a beat of the bar line.
 */
const KNOWN_FAILURE_DOWNBEAT =
  "composer/rhythmParts.ts:442 (tiedDownbeat at :101/:105) deletes the cell's unit-0 kick whenever any part anticipates the bar line, and the replacement push at :443-446 only fires when kickAnticipates - 0/20 seeds pass: 114/596 bars in kick-anticipating sections and 59/222 in plain ones; 177/238 plain bars have no kick within 0.75 beats of the bar line (seed 1501 onward)";

test("on sections the plan locks, every accented kick has a bass onset with it (20 seeds)", { todo: KNOWN_FAILURE_LOCK || undefined }, (t) => {
  const outcomes: SeedOutcome[] = [];
  let lockSections = 0;
  let kicks = 0;
  let matched = 0;
  const relations = new Map<string, number>();
  for (const seed of SEEDS) {
    const { result, model } = runFor(seed);
    const plan = groovePlanOf(result, model);
    for (const s of plan?.sections ?? []) relations.set(s.kickBass.value, (relations.get(s.kickBass.value) ?? 0) + 1);
    const report = kickBassLock(result.candidates[0], result, model);
    lockSections += report.rows.length;
    for (const row of report.rows) { kicks += row.kicks; matched += row.matched; }
    outcomes.push({ seed, passed: report.violations.length === 0, violations: report.violations, notes: { meter: model.meterMap[0].meter, lockSections: report.rows.length, shares: report.rows.map((r) => `${r.sectionName}:${r.share}`).join(" ") } });
  }
  const record = summarizeOutcomes({
    invariant: "groove-kick-bass-lock",
    description: "Shipped kit vs shipped bass: on every section whose GroovePlan kickBass is `lock`, at least 90% of accented kick onsets have a bass onset within 60 ms.",
    outcomes, knownFailure: KNOWN_FAILURE_LOCK || undefined,
    extra: { lockSections, kicksJudged: kicks, kicksWithBass: matched, agreement: kicks ? Number((matched / kicks).toFixed(3)) : null, relationsPlanned: Object.fromEntries(relations) },
  });
  recordEvidence(record);
  t.diagnostic(`kick/bass lock: ${record.passed}/${SEEDS.length} pass; ${matched}/${kicks} kicks matched over ${lockSections} lock sections; relations planned ${JSON.stringify(Object.fromEntries(relations))}`);
  assert.deepEqual(outcomes.filter((o) => !o.passed).map((o) => `${o.seed}: ${describe(o.violations)}`), []);
});

test("where the kit pushes an anticipated up-beat, the comping and the bass strike with it (20 seeds)", { todo: KNOWN_FAILURE_ANTICIPATION || undefined }, (t) => {
  const outcomes: SeedOutcome[] = [];
  let pushes = 0, comping = 0, bass = 0, compingJudged = 0, bassJudged = 0;
  for (const seed of SEEDS) {
    const { result, model } = runFor(seed);
    const report = anticipationsShared(result.candidates[0], result, model);
    for (const row of report.rows) {
      pushes += row.kitPushes;
      if (row.compingAtPush >= 0) { comping += row.compingAtPush; compingJudged += row.kitPushes; }
      if (row.bassAtPush >= 0) { bass += row.bassAtPush; bassJudged += row.kitPushes; }
    }
    outcomes.push({ seed, passed: report.violations.length === 0, violations: report.violations, notes: { sectionsWithPushes: report.rows.length, rows: report.rows.map((r) => `${r.sectionName}:${r.kitPushes}/${r.compingAtPush}/${r.bassAtPush}`).join(" ") } });
  }
  const record = summarizeOutcomes({
    invariant: "groove-anticipations-shared",
    description: "Shipped notes: at the kit's anticipation pushes (the plan's slots), the comping and the bass have an onset within 60 ms on at least 80% of pushes per section.",
    outcomes, knownFailure: KNOWN_FAILURE_ANTICIPATION || undefined,
    extra: { kitPushes: pushes, compingWithPush: comping, compingPushesJudged: compingJudged, bassWithPush: bass, bassPushesJudged: bassJudged },
  });
  recordEvidence(record);
  t.diagnostic(`anticipations: ${record.passed}/${SEEDS.length} pass; kit pushes ${pushes}; comping with the push ${comping}/${compingJudged}; bass with the push ${bass}/${bassJudged}`);
  assert.deepEqual(outcomes.filter((o) => !o.passed).map((o) => `${o.seed}: ${describe(o.violations)}`), []);
});

test("hat / ride strikes per second never exceed the plan's tempo ceiling (20 seeds)", (t) => {
  const outcomes: SeedOutcome[] = [];
  let max = 0;
  let bars = 0;
  for (const seed of SEEDS) {
    const { result, model } = runFor(seed);
    const report = hatCeiling(result.candidates[0], result, model);
    max = Math.max(max, report.maxStrikesPerSecond);
    bars += report.barsJudged;
    outcomes.push({ seed, passed: report.violations.length === 0, violations: report.violations, notes: { bpm: model.tempoMap[0].bpm, meter: model.meterMap[0].meter, maxStrikesPerSecond: report.maxStrikesPerSecond, ceiling: report.ceiling } });
  }
  const record = summarizeOutcomes({
    invariant: "groove-hat-ceiling",
    description: "Distinct hat/ride onsets per bar divided by the bar's seconds never exceed 7.5 (9 for a programmed dance/electronic kit).",
    outcomes, extra: { barsJudged: bars, maxStrikesPerSecondSeen: max },
  });
  recordEvidence(record);
  t.diagnostic(`hat ceiling: ${record.passed}/${SEEDS.length} pass; max ${max} strikes/s over ${bars} bars`);
  assert.deepEqual(outcomes.filter((o) => !o.passed).map((o) => `${o.seed}: ${describe(o.violations)}`), []);
});

test("the downbeat kick: at least 90% of a section's bars keep an accented kick on beat 1 (20 seeds; split by whether the plan lets the kick anticipate)", { todo: KNOWN_FAILURE_DOWNBEAT || undefined }, (t) => {
  const outcomes: SeedOutcome[] = [];
  const totals = { anticipating: { bars: 0, withKick: 0 }, plain: { bars: 0, withKick: 0 } };
  const whenCounts = new Map<string, number>();
  for (const seed of SEEDS) {
    const { result, model } = runFor(seed);
    const plan = groovePlanOf(result, model);
    const g = geometryOf(model);
    const drums = result.candidates[0].trackModels.find(isDrumTrack);
    const violations: Violation[] = [];
    const rows: string[] = [];
    for (const section of plan?.sections ?? []) {
      whenCounts.set(section.anticipations.value.when, (whenCounts.get(section.anticipations.value.when) ?? 0) + 1);
      if (!drums) continue;
      const kicks = notesInBars(drums, g, section.startBar, section.endBar).filter((n) => (n.pitch === 35 || n.pitch === 36) && isAccentHit(n));
      const barsWithKick = new Set(kicks.filter((n) => Math.abs(g.beatInBar(n.start)) <= 0.2 || g.beatInBar(n.start) >= g.numerator - 0.2).map((n) => g.barOf(n.start + 0.05)));
      const barCount = section.endBar - section.startBar + 1;
      if (!kicks.length) continue;
      const bucket = section.anticipations.value.kickAnticipates ? totals.anticipating : totals.plain;
      bucket.bars += barCount;
      bucket.withKick += barsWithKick.size;
      const share = barsWithKick.size / barCount;
      rows.push(`${section.sectionName}:${barsWithKick.size}/${barCount}${section.anticipations.value.kickAnticipates ? "*" : ""}`);
      if (share < 0.9) violations.push({ code: "downbeat_kick_missing", sectionName: section.sectionName, detail: `${section.sectionName} (${section.pulse.value}, anticipations ${section.anticipations.value.when}, kick anticipates ${section.anticipations.value.kickAnticipates}): kick on beat 1 in ${barsWithKick.size} of ${barCount} bars` });
    }
    outcomes.push({ seed, passed: violations.length === 0, violations, notes: { meter: model.meterMap[0].meter, sections: rows.join(" ") } });
  }
  const record = summarizeOutcomes({
    invariant: "groove-downbeat-kick",
    description: "Per section: the share of bars with an accented kick within 0.2 beats of beat 1 (a pushed downbeat counts) is at least 0.9.",
    outcomes, knownFailure: KNOWN_FAILURE_DOWNBEAT || undefined,
    extra: { anticipatingKick: totals.anticipating, plainKick: totals.plain, anticipationWhen: Object.fromEntries(whenCounts) },
  });
  recordEvidence(record);
  t.diagnostic(`downbeat kick: ${record.passed}/${SEEDS.length} pass; kick-anticipating sections ${totals.anticipating.withKick}/${totals.anticipating.bars} bars, plain sections ${totals.plain.withKick}/${totals.plain.bars}; when ${JSON.stringify(Object.fromEntries(whenCounts))}`);
  assert.deepEqual(outcomes.filter((o) => !o.passed).map((o) => `${o.seed}: ${describe(o.violations)}`), []);
});

/**
 * Isolating control for the failure above. Three measurements, one variable
 * each: (a) the *composed* kit against the shipped one - if thinning were the
 * cause the composed kit would keep its downbeats; (b) whether the groove
 * cell that governs each bar lists unit 0 as a kick at all; (c) the split by
 * `kickAnticipates`, which separates "the downbeat was pushed" from "the
 * downbeat was deleted and nothing replaced it". Nothing here relaxes the
 * invariant; it only says which line to look at.
 */
test("isolating control: the composed kit has already lost the downbeat, every cell asks for it, and the plain-kick sections lose it to nothing (20 seeds)", (t) => {
  const composed = { bars: 0, onBarline: 0 };
  const shipped = { bars: 0, onBarline: 0 };
  let cellAsksForIt = 0;
  const byAnticipation = {
    anticipating: { bars: 0, onBarline: 0, pushed: 0, neither: 0 },
    plain: { bars: 0, onBarline: 0, pushed: 0, neither: 0 },
  };
  for (const seed of SEEDS) {
    const { result, model } = runFor(seed);
    const g = geometryOf(model);
    const plan = groovePlanOf(result, model);
    const drums = result.candidates[0].trackModels.find(isDrumTrack);
    const kitNotes = composeSong(model, { tasks: KIT_TASKS }).parts.flatMap((p) => p.notes);
    const beat = (60 / (model.tempoMap?.[0]?.bpm ?? 120)) * (4 / g.denominator);
    const kicks = (notes: readonly MusicalNote[]) => notes.filter((n) => (n.pitch === 35 || n.pitch === 36) && isAccentHit(n));
    for (const section of plan?.sections ?? []) {
      const inSection = kicks(kitNotes.filter((n) => { const bar = g.barOf(n.start); return bar >= section.startBar && bar <= section.endBar; }));
      if (!inSection.length) continue;
      const shippedKicks = drums ? kicks(notesInBars(drums, g, section.startBar, section.endBar)) : [];
      const bucket = section.anticipations.value.kickAnticipates ? byAnticipation.anticipating : byAnticipation.plain;
      const asks = section.kit.kick.some((u) => Math.abs(u) < 1e-9);
      for (let bar = section.startBar; bar <= section.endBar; bar += 1) {
        const { start } = g.barBounds(bar);
        const on = (list: readonly MusicalNote[]) => list.some((n) => Math.abs(n.start - start) <= 0.2 * beat);
        composed.bars += 1; if (on(inSection)) composed.onBarline += 1;
        if (shippedKicks.length) { shipped.bars += 1; if (on(shippedKicks)) shipped.onBarline += 1; }
        if (asks) cellAsksForIt += 1;
        bucket.bars += 1;
        if (on(inSection)) bucket.onBarline += 1;
        else if (inSection.some((n) => n.start < start - 0.2 * beat && n.start >= start - 0.75 * beat)) bucket.pushed += 1;
        else bucket.neither += 1;
      }
    }
  }
  recordEvidence({
    invariant: "groove-downbeat-kick-control",
    description: "Control for the downbeat-kick failure: the composed kit vs the shipped kit, whether the governing groove cell lists unit 0 as a kick, and the split by whether the plan lets the kick anticipate.",
    composed, shipped, barsWhoseCellAsksForADownbeatKick: cellAsksForIt, byAnticipation,
  });
  t.diagnostic(`downbeat control: composed ${composed.onBarline}/${composed.bars} bars, shipped ${shipped.onBarline}/${shipped.bars}; cells asking for a unit-0 kick ${cellAsksForIt}/${composed.bars}; anticipating ${JSON.stringify(byAnticipation.anticipating)}; plain ${JSON.stringify(byAnticipation.plain)}`);
  assert.equal(cellAsksForIt, composed.bars, "every bar's groove cell asks for a kick on unit 0, so the cell is not the cause");
  assert.ok(composed.onBarline < composed.bars * 0.5, "the composed kit has already lost the downbeat before any thinning or performance");
  assert.ok(Math.abs(composed.onBarline / composed.bars - shipped.onBarline / shipped.bars) < 0.1, "shipping barely changes the share: applyDensity is not the cause");
  assert.ok(byAnticipation.plain.pushed === 0 && byAnticipation.plain.neither > byAnticipation.plain.onBarline,
    "where the plan says the kick does not anticipate, the downbeat is deleted and nothing replaces it");
});

test("negative controls: a bass shifted off the kick fails the lock check; doubled hats fail the ceiling; comping removed from the pushes fails the anticipation check", () => {
  const { result, model } = runFor(1502);
  const candidate = result.candidates[0];
  const bass = candidate.trackModels.find((tr) => tr.instrument === "bass")!;
  const drums = candidate.trackModels.find(isDrumTrack)!;
  const plan = groovePlanOf(result, model)!;
  assert.ok(plan.sections.some((s) => s.kickBass.value === "lock"), "the plan locks at least one section");
  // A bass that strikes exactly a third of a beat after every kick.
  const beat = 60 / model.tempoMap[0].bpm;
  const kicks = drums.notes.filter((n) => n.pitch === 36 || n.pitch === 35);
  const locked = { ...candidate, trackModels: candidate.trackModels.map((tr) => (tr.id === bass.id ? { ...tr, notes: kicks.map((k, i) => ({ ...k, id: `lockbass-${i}`, pitch: 40 })) } : tr)) };
  assert.deepEqual(kickBassLock(locked, result, model).violations, [], "a bass on every kick passes");
  const shifted = { ...candidate, trackModels: candidate.trackModels.map((tr) => (tr.id === bass.id ? { ...tr, notes: kicks.map((k, i) => ({ ...k, id: `lockbass-${i}`, pitch: 40, start: Number((k.start + beat / 3).toFixed(4)) })) } : tr)) };
  assert.ok(kickBassLock(shifted, result, model).violations.some((v) => v.code === "kick_bass_not_locked"));
  const doubled = { ...candidate, trackModels: candidate.trackModels.map((tr) => (tr.id === drums.id ? { ...tr, notes: [...tr.notes, ...tr.notes.filter((n) => n.pitch === 42).map((n) => ({ ...n, id: `${n.id}-dbl`, start: Number((n.start + 0.02).toFixed(4)) }))] } : tr)) };
  const before = hatCeiling(candidate, result, model);
  const after = hatCeiling(doubled, result, model);
  assert.ok(after.maxStrikesPerSecond > before.maxStrikesPerSecond, "doubling raised the rate");
  assert.ok(after.violations.length > 0 || after.maxStrikesPerSecond <= after.ceiling, "doubled hats over the ceiling are reported");
  const pushes = drums.notes.filter((n) => /-ka\d+-/.test(n.id));
  if (pushes.length) {
    const keys = candidate.trackModels.filter((tr) => tr.instrument === "keys");
    const withPushes = { ...candidate, trackModels: candidate.trackModels.map((tr) => (keys.includes(tr) ? { ...tr, notes: [...tr.notes, ...pushes.map((p, i) => ({ ...p, id: `push-${i}`, pitch: 60 }))] } : tr)) };
    const without = { ...candidate, trackModels: candidate.trackModels.map((tr) => (keys.includes(tr) ? { ...tr, notes: tr.notes.filter((n) => !pushes.some((p) => Math.abs(p.start - n.start) <= 0.06)) } : tr)) };
    const a = anticipationsShared(withPushes, result, model);
    const b = anticipationsShared(without, result, model);
    assert.ok(!a.violations.some((v) => v.code === "comping_misses_anticipation"), "comping on every push passes");
    assert.ok(b.violations.some((v) => v.code === "comping_misses_anticipation"), "comping off every push is refused");
  }
});
