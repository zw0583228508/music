/**
 * Candidate ranking and the re-weighted judge (Brain B-05c, D4).
 *
 * Two halves: constructed reports, where the ordering rules can be exercised
 * one at a time, and the real corpus, where the ranking has to survive the
 * output the composer actually writes.
 */
import assert from "node:assert/strict";
import test from "node:test";
import { anchors, applyPurposeBuilt, displaceHarmonyOffGrid, ownerAnchor, ownerComposedAnchor, probeAnchor } from "./dimensions/anchors";
import { BENCHMARK_CORPUS } from "../benchmarkCorpus";
import { evaluateAllDimensions } from "./dimensions/index";
import { runAdversarialCritics } from "./adversarial/index";
import { judge, judgeContextFromInput, SALIENCE_FLOOR } from "./judge";
import { constructiveScoreOf, rankCandidates, CANDIDATE_RANK_VERSION, NEAR_IDENTICAL_CODE } from "./rank";
import type { CriticDimensionReport, CriticObservation, ControlStatus, Severity } from "./types";

// ---------------------------------------------------------------------------
// Constructed reports
// ---------------------------------------------------------------------------

let counter = 0;
function observation(over: Partial<CriticObservation> & { dimension: string; kind: string; severity: Severity }): CriticObservation {
  counter += 1;
  return {
    id: over.id ?? `${over.dimension}:${over.kind}:t:${counter}`,
    dimension: over.dimension,
    kind: over.kind,
    severity: over.severity,
    location: over.location ?? { startBar: 1, endBar: 8, trackIds: ["t"] },
    evidence: over.evidence ?? { n: 1 },
    suspectedOrigin: over.suspectedOrigin ?? "compose",
    originConfidence: over.originConfidence ?? 0.5,
    recommendedRepair: over.recommendedRepair ?? { operation: "fix_it", scope: "part", detail: "detail" },
    confidence: over.confidence ?? 0.8,
  };
}

function report(dimension: string, controlStatus: ControlStatus, observations: CriticObservation[], score = 80): CriticDimensionReport {
  return {
    dimension, version: "test", applicable: true, observations,
    summary: { score0to100: score, coverage: 1, controlStatus },
  };
}

test("ordering: a candidate the judge refuses never outranks one it does not", () => {
  const clean = [report("groove", "gated", [observation({ dimension: "groove", kind: "off_grid", severity: "minor" })], 95)];
  const refused = [report("groove", "gated", [observation({ dimension: "groove", kind: "off_grid", severity: "blocking" })], 99)];
  const result = rankCandidates([{ candidateId: "b-refused", reports: refused }, { candidateId: "a-clean", reports: clean }]);
  assert.equal(result.version, CANDIDATE_RANK_VERSION);
  assert.deepEqual(result.ranked.map((r) => r.candidateId), ["a-clean", "b-refused"]);
  assert.equal(result.selected, "a-clean");
  assert.equal(result.ranked[0].releasable, true);
  assert.equal(result.ranked[1].releasable, false);
  assert.match(result.ranked[1].why, /is releasable and this one is not/);
  // …even though the refused candidate has the higher constructive score.
  assert.ok(result.ranked[1].constructiveScore > result.ranked[0].constructiveScore);
});

test("ordering: among refused candidates, fewer blocking findings first, then the salience-weighted majors, then the scores", () => {
  const blocking = (n: number) => Array.from({ length: n }, () => observation({ dimension: "groove", kind: "off_grid", severity: "blocking" }));
  const one = [report("groove", "gated", blocking(1), 50)];
  const three = [report("groove", "gated", blocking(3), 90)];
  const byBlocking = rankCandidates([{ candidateId: "three", reports: three }, { candidateId: "one", reports: one }]);
  assert.deepEqual(byBlocking.ranked.map((r) => r.candidateId), ["one", "three"]);
  assert.match(byBlocking.ranked[1].why, /3 blocking finding\(s\) against 1/);

  // Same verdict and blocking count: the majors decide, weighted by the judge's priority.
  const fewMajors = [report("register", "gated", [...blocking(1), observation({ dimension: "register", kind: "part_outside_planned_band", severity: "major" })], 60)];
  const manyMajors = [report("register", "gated", [...blocking(1),
    observation({ dimension: "register", kind: "part_outside_planned_band", severity: "major" }),
    observation({ dimension: "register", kind: "part_outside_planned_band", severity: "major" }),
    observation({ dimension: "register", kind: "part_outside_planned_band", severity: "major" })], 99)];
  const byMajors = rankCandidates([{ candidateId: "many", reports: manyMajors }, { candidateId: "few", reports: fewMajors }]);
  assert.deepEqual(byMajors.ranked.map((r) => r.candidateId), ["few", "many"]);
  assert.match(byMajors.ranked[1].why, /major findings weigh/);

  // Everything equal but the scores: the control-weighted score is the last real criterion.
  const low = [report("groove", "gated", blocking(1), 40)];
  const high = [report("groove", "gated", blocking(1), 70)];
  const byScore = rankCandidates([{ candidateId: "low", reports: low }, { candidateId: "high", reports: high }]);
  assert.deepEqual(byScore.ranked.map((r) => r.candidateId), ["high", "low"]);
  assert.match(byScore.ranked[1].why, /constructive score 40 against 70/);
});

test("the constructive score weighs a dimension by what its controls demonstrated", () => {
  const gated = [report("groove", "gated", [], 60)];
  const demoted = [report("sectionDevelopment", "demoted", [], 100)];
  // 60 alone, then the demoted 100 pulled in at a quarter of the weight.
  assert.equal(constructiveScoreOf(gated), 60);
  assert.equal(constructiveScoreOf([...gated, ...demoted]), Number(((1 * 60 + 0.25 * 100) / 1.25).toFixed(4)));
});

test("determinism: the same reports in any input order give the same order, and a true tie is reported as one", () => {
  const make = (id: string) => ({ candidateId: id, reports: [report("groove", "gated", [observation({ dimension: "groove", kind: "off_grid", severity: "major", id: `fixed-${id}` })], 80)] });
  const a = rankCandidates([make("x"), make("y"), make("z")]);
  const b = rankCandidates([make("z"), make("x"), make("y")]);
  assert.deepEqual(a.ranked.map((r) => r.candidateId), b.ranked.map((r) => r.candidateId));
  assert.deepEqual(a.ranked.map((r) => r.candidateId), ["x", "y", "z"]);
  assert.deepEqual(a.ties, [["x", "y", "z"]]);
  assert.match(a.ranked[1].why, /indistinguishable from x on every criterion; ordered by candidate id/);
});

test("near-identical candidates are named as such: a ranking that hides a non-choice is pretending to have chosen", () => {
  // R-1b P1-8: the owner's three candidates scored 72 / 72 / 72 and differed by
  // two bass notes.
  const same = (id: string, noteCount: number) => ({
    candidateId: id, noteCount,
    reports: [report("groove", "gated", [
      observation({ dimension: "groove", kind: "off_grid", severity: "major", id: `g-${id}`, location: { startBar: 1, endBar: 8, sectionName: "Verse", trackIds: ["t"] } }),
    ], 72)],
  });
  const result = rankCandidates([same("a", 1867), same("b", 1980), same("c", 1978)]);
  assert.ok(result.nearIdentical, "three candidates with the same findings and the same score");
  assert.equal(result.nearIdentical!.kind, "candidates_near_identical");
  assert.deepEqual(result.nearIdentical!.candidateIds, ["a", "b", "c"]);
  assert.equal(result.nearIdentical!.sharedFindingShare, 1);
  assert.equal(result.nearIdentical!.scoreSpread, 0);
  assert.equal(result.nearIdentical!.noteCountSpread, 113);
  assert.match(result.nearIdentical!.detail, /not a choice/);
  assert.equal(NEAR_IDENTICAL_CODE, "PREDICTABILITY_FAILURE");

  // Candidates that really differ are not reported as near-identical.
  const different = rankCandidates([
    same("a", 1867),
    { candidateId: "d", reports: [report("groove", "gated", [observation({ dimension: "groove", kind: "kick_bass_disagreement", severity: "major", id: "k-d" })], 60)] },
  ]);
  assert.equal(different.nearIdentical, null);
});

// ---------------------------------------------------------------------------
// Release rules
// ---------------------------------------------------------------------------

test("release rules: blocking from a gated dimension refuses; the same finding from a demoted one does not", () => {
  const gated = judge([report("groove", "gated", [observation({ dimension: "groove", kind: "off_grid", severity: "blocking" })])]);
  assert.equal(gated.overall.releasable, false);
  assert.deepEqual(gated.refusals.map((r) => r.rule), ["blocking_from_gated_dimension"]);
  const demoted = judge([report("sectionDevelopment", "demoted", [observation({ dimension: "sectionDevelopment", kind: "repeat_without_development", severity: "blocking" })])]);
  assert.equal(demoted.overall.releasable, true);
  assert.equal(demoted.refusals.length, 0);
  assert.ok(demoted.overall.reasons.some((r) => /could not block because their dimension is not gated/.test(r)));
});

test("release rules: register / density / instrumentReality majors refuse on a bed or at the climax, and nowhere else", () => {
  const context = { sections: [
    { name: "Verse", startBar: 1, endBar: 8, role: "verse", isClimax: false, isSung: true },
    { name: "Chorus 3", startBar: 9, endBar: 16, role: "chorus", isClimax: true, isSung: true },
  ] };
  const inVerse = { startBar: 1, endBar: 8, sectionName: "Verse", trackIds: ["t"] };
  const inClimax = { startBar: 9, endBar: 16, sectionName: "Chorus 3", trackIds: ["t"] };

  const bedInVerse = judge([report("density", "gated", [observation({ dimension: "density", kind: "single_voice_bed", severity: "major", location: inVerse })])], context);
  assert.equal(bedInVerse.overall.releasable, false);
  assert.deepEqual(bedInVerse.refusals.map((r) => r.rule), ["major_on_a_bed"]);

  const registerAtClimax = judge([report("register", "gated", [observation({ dimension: "register", kind: "part_outside_planned_band", severity: "major", location: inClimax })])], context);
  assert.equal(registerAtClimax.overall.releasable, false);
  assert.deepEqual(registerAtClimax.refusals.map((r) => r.rule), ["major_at_the_climax"]);

  // The same non-bed register major away from the climax informs and does not refuse.
  const registerInVerse = judge([report("register", "gated", [observation({ dimension: "register", kind: "part_outside_planned_band", severity: "major", location: inVerse })])], context);
  assert.equal(registerInVerse.overall.releasable, true);

  // …and so does a major from a dimension outside the three.
  const other = judge([report("transitions", "gated", [observation({ dimension: "transitions", kind: "boundary_unmarked", severity: "major", location: inClimax })])], context);
  assert.equal(other.overall.releasable, true);
});

test("release rules: an arrival that does not arrive refuses on its own", () => {
  const v = judge([report("density", "informing", [observation({ dimension: "density", kind: "arrival_thinner_than_setup", severity: "major", evidence: { respectsThatFell: 3 } })])]);
  assert.equal(v.overall.releasable, false);
  assert.deepEqual(v.refusals.map((r) => r.rule), ["the_arrival_did_not_arrive"]);
  assert.match(v.refusals[0].detail, /smaller than its setup/);
});

test("the verdict names the top three problems a professional would fix first, one per kind", () => {
  const v = judge([
    report("groove", "gated", [
      observation({ dimension: "groove", kind: "off_grid", severity: "blocking", id: "g1" }),
      observation({ dimension: "groove", kind: "off_grid", severity: "blocking", id: "g2" }),
    ]),
    report("density", "gated", [observation({ dimension: "density", kind: "single_voice_bed", severity: "blocking", id: "d1" })]),
    report("register", "gated", [observation({ dimension: "register", kind: "climax_all_treble", severity: "major", id: "r1" })]),
  ]);
  assert.equal(v.topProblems.length, 3);
  // Three problems, not three instances of one: the second `off_grid` is
  // dropped. The two blocking findings tie on every factor here, so the
  // tie-break is the observation id (`d1` before `g1`), which is what makes the
  // order total and independent of report order.
  assert.deepEqual(v.topProblems.map((p) => p.kind), ["single_voice_bed", "off_grid", "climax_all_treble"]);
  assert.ok(v.topProblems.every((p) => p.whatToFix.includes("fix_it")));
  assert.ok(v.overall.reasons.some((r) => r.startsWith("fix first: 1. single_voice_bed")));
});

test("disagreement is still preserved", () => {
  const context = { sections: [{ name: "Chorus", startBar: 1, endBar: 8, role: "chorus", isClimax: true, isSung: true }] };
  const v = judge([
    report("register", "gated", [observation({ dimension: "register", kind: "string_bed_too_high", severity: "major", id: "a" })]),
    report("orchestration", "gated", [observation({ dimension: "orchestration", kind: "register_fight", severity: "major", id: "b" })]),
  ], context);
  assert.ok(v.disagreements.length >= 1);
  assert.equal(v.disagreements[0].topic, "register");
  assert.equal(v.disagreements[0].resolution, "resolved");
  assert.match(v.disagreements[0].rationale, /playable_register_first/);
  assert.equal(v.disagreements[0].positions.length, 2, "both positions are kept with their evidence");
});

// ---------------------------------------------------------------------------
// The real corpus and the owner's song
// ---------------------------------------------------------------------------

test("on the owner's song, constructed with R-1b's three defects, the judge refuses, and it refuses for the right reasons", () => {
  // Re-anchored at the merge, and this is what changed.
  //
  // This test is about the *ranking*: that the judge refuses on each of R-1b
  // §7's three defects by its own rule, and that it puts them above an empty
  // two-bar intro (P0-5). It used to get those three defects for free, because
  // the owner's arrangement had them. B-13 fixed two of them - the harmony is
  // now written on the bar grid (chord events median 140.8 ms -> 0.04 ms from
  // the beat) and no bed ships as one voice (the owner's string bed 91 -> 278
  // notes, no section below 3 voices) - so on today's owner anchor `off_grid`
  // is no longer a refusal and `single_voice_bed` does not exist at all.
  //
  // Reading the ranking off an arrangement that no longer has the defects
  // would be testing the composer's old output, not the ranking. So the case
  // is now *constructed*: `strip_bed_to_top_voice` puts the beds back on one
  // voice and `displaceHarmonyOffGrid` moves every harmonic part's onsets
  // 180 ms off the beat - the middle of the 100-230 ms range R-1b measured.
  // Both are deterministic, and the composed (pre-perform) notes are left on
  // the grid, so the constructed defect has the shape the review found.
  //
  // The dimensions and the release rules are untouched: no threshold moved,
  // and the defects are real observations raised by the unmodified critics.
  const owner = ownerAnchor();
  const composed = ownerComposedAnchor();
  const stripped = applyPurposeBuilt(owner, "strip_bed_to_top_voice");
  assert.ok(stripped, "the owner's beds can be reduced to one voice");
  assert.match(stripped.detail, /bed\(s\) reduced to one voice/);
  const constructed = displaceHarmonyOffGrid(stripped.input);
  const input = { ...constructed, composedTrackModels: composed.input.trackModels };
  const reports = [...evaluateAllDimensions(input), ...runAdversarialCritics(input)];
  const context = judgeContextFromInput(input);
  const v = judge(reports, context);

  assert.equal(v.overall.releasable, false);
  const kinds = new Set(v.refusals.map((r) => r.kind));
  // The three defects R-1b's §7 puts first, each refusing on its own rule.
  assert.ok(kinds.has("off_grid"), "the harmony is off the beat");
  assert.ok(kinds.has("single_voice_bed"), "the string bed ships as one voice");
  assert.ok(kinds.has("top_line_above_comfortable_ceiling"), "and it sits above the profile's ceiling");
  assert.ok(v.refusals.some((r) => r.rule === "major_on_a_bed"));

  // And the fix B-13 landed is asserted where the defect used to be pinned:
  // on the unmodified owner anchor the harmony is on the grid and no bed is a
  // single voice, so neither refuses.
  const clean = { ...owner.input, composedTrackModels: composed.input.trackModels };
  const cleanVerdict = judge([...evaluateAllDimensions(clean), ...runAdversarialCritics(clean)], judgeContextFromInput(clean));
  const cleanKinds = new Set(cleanVerdict.refusals.map((r) => r.kind));
  assert.ok(!cleanKinds.has("off_grid"), "B-13: the harmony is on the bar grid, so off_grid no longer refuses the owner's song");
  assert.ok(
    !cleanVerdict.ranked.some((r) => r.observation.kind === "single_voice_bed"),
    "B-13: no bed on the owner's song ships as one voice, so the observation is not raised at all",
  );

  // R-1b P0-5: "the judge ranks a 2-bar silent intro above everything else …
  // Until the judge prefers a full string bed over an empty two-bar intro, the
  // loop will keep polishing the wrong thing."
  const rank = (predicate: (o: CriticObservation) => boolean) => v.ranked.findIndex((r) => predicate(r.observation));
  const intro = rank((o) => o.kind === "planned_family_silent" && o.location.endBar <= 2);
  const bed = rank((o) => o.kind === "single_voice_bed");
  const grid = rank((o) => o.kind === "off_grid");
  assert.ok(intro >= 0 && bed >= 0 && grid >= 0, `intro ${intro}, bed ${bed}, grid ${grid}`);
  assert.ok(bed < intro, `the string bed (#${bed + 1}) outranks the empty intro (#${intro + 1})`);
  assert.ok(grid < intro, `the off-grid harmony (#${grid + 1}) outranks the empty intro (#${intro + 1})`);
  // The count moved with the arrangement, not with the intro. On B-05c's
  // anchor thirteen blocking findings outranked the two silent bars; with
  // B-18's per-family levels the owner's arrangement carries ten, because four
  // `off_grid` findings fall under the blocking threshold — strings Verse 1
  // 0.733 -> 0.400, keys Verse 3 0.618 -> 0.441, strings Verse 3 0.571 ->
  // 0.500, keys Chorus 0.559 -> 0.529 — and one `single_voice_bed` (Chorus 2)
  // joins them. Nothing about the intro moved: its priority is the same 60.1
  // and its salience the same floor, asserted below. The orderings R-1b P0-5
  // actually asked for are the two assertions above, and both hold with the
  // bed at #2 and the off-grid harmony at #1.
  assert.ok(intro >= 10, `the empty intro is out of the top ten (#${intro + 1})`);
  assert.ok(v.ranked.slice(0, intro).every((r) => r.observation.severity === "blocking"),
    "everything above it is blocking — the intro is last of the blocking findings that carry sounding music");

  // The salience that does it is measured, not asserted: two silent bars carry
  // no sounding music, so they sit at the floor.
  const introRanked = v.ranked[intro];
  assert.equal(introRanked.salience, SALIENCE_FLOOR, "no music sounds in bars 1-2");
  assert.ok(v.ranked[bed].salience > SALIENCE_FLOOR);
  assert.match(introRanked.rationale, /silent_mandatory_family_outranks_all does not apply: no music sounds/);

  // And the verdict says what to fix first, one per kind, covering the
  // constructed defects. The order inside the top three is a property of *this
  // construction's* magnitudes (a bed on one voice is blocking on every bed;
  // the 180 ms displacement lands hardest on the harmony against the kit), not
  // of the ranking rule, so it is pinned as measured rather than argued from
  // R-1b's item 10 - which is about these problems coming first at all.
  assert.deepEqual(v.topProblems.map((p) => p.kind), ["single_voice_bed", "harmony_off_grid", "off_grid"]);
});

test("on the corpus the ranking prefers the reference composer to the audit's probes, on every case", () => {
  // R-1a P0-3: through the production path a same-rhythm random-pitch composer
  // is *selected* on six of the nine cases. The new critics block it on every
  // case; this is the ranking saying so.
  const ids = ["pop-full", "rock-full", "jazz-full", "dance-full"];
  const rows: string[] = [];
  for (const id of ids) {
    const spec = BENCHMARK_CORPUS.find((c) => c.id === id)!;
    const reference = anchors([id])[0];
    const random = probeAnchor(spec, "random_pitch");
    const drums = probeAnchor(spec, "drums_only");
    const forInput = (input: typeof reference.input) => [...evaluateAllDimensions(input), ...runAdversarialCritics(input)];
    const result = rankCandidates([
      { candidateId: "random-pitch", reports: forInput(random.input), context: judgeContextFromInput(random.input) },
      { candidateId: "reference", reports: forInput(reference.input), context: judgeContextFromInput(reference.input) },
      { candidateId: "drums-only", reports: forInput(drums.input), context: judgeContextFromInput(drums.input) },
    ]);
    rows.push(`${id}: ${result.ranked.map((r) => `${r.candidateId}(${r.blockingCount}b/${r.refusalCount}r/${r.constructiveScore})`).join(" > ")}`);
    assert.equal(result.selected, "reference", rows[rows.length - 1]);
    assert.ok(result.ranked.find((r) => r.candidateId === "random-pitch")!.blockingCount > 0, `${id}: the random composer is blocked`);
    assert.ok(result.ranked.find((r) => r.candidateId === "drums-only")!.blockingCount > 0, `${id}: the drums-only composer is blocked`);
    assert.equal(result.nearIdentical, null, `${id}: three genuinely different candidates`);
  }
  console.log("RANK on the corpus:\n  " + rows.join("\n  "));
});
