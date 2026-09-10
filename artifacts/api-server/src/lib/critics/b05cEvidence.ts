/**
 * Evidence builder for `docs/evidence/brain-b05c-critics-decide.json`
 * (Brain B-05c, D6): everything the two reviews asked to see measured, built
 * from the same code the tests run.
 *
 *  1. R-1b §4's table, row by row, with the dimension that catches each row now
 *     and the control result behind it.
 *  2. The `groove = 0` isolation on the owner's song (R-1a P1-1): both controls
 *     and the cause they name.
 *  3. The judge on the owner's output before and after the re-weighting.
 *  4. The candidate ranking on the corpus, against the audit's two probes.
 *  5. The ledger diff against `origin/main`, every status change with its reason.
 */
import { evaluateAllDimensions, DIMENSION_NAMES } from "./dimensions/index";
import { runAdversarialCritics } from "./adversarial/index";
import { anchors, applyPurposeBuilt, displaceHarmonyOffGrid, ownerAnchor, ownerComposedAnchor, probeAnchor, quantiseFamiliesToGrid, silenceOpeningBars, CLEAN_ANCHOR_IDS, FIXED_ANCHOR_DEFECTS, DEFECT_ANCHOR_REASONS } from "./dimensions/anchors";
import { BENCHMARK_CORPUS } from "../benchmarkCorpus";
import { CONTROL_LEDGER, CONTROL_LEDGER_VERSION } from "./dimensions/controlLedger";
import { CLAIMED_CONTROLS, CONTROL_HARNESS_VERSION } from "./controls";
import { SENSITIVITY_RULE, CRITIC_SENSITIVITY_VERSION } from "./sensitivity";
import { judge, judgeContextFromInput, JUDGE_VERSION, SALIENCE_FLOOR, CLIMAX_SALIENCE, SUNG_SALIENCE, MAJOR_BLOCKS_DIMENSIONS, BED_KINDS, ALWAYS_REFUSES_KINDS } from "./judge";
import { rankCandidates, CANDIDATE_RANK_VERSION } from "./rank";
import { grooveDimension } from "./dimensions/groove";
import type { CriticDimensionReport, CriticInput, CriticObservation } from "./types";

export const B05C_EVIDENCE_VERSION = "BRAIN_B05C_EVIDENCE_v1" as const;

const r3 = (v: number) => Number(v.toFixed(3));

/**
 * The control ledger as `origin/main` 31b9443 carried it (B05A_CONTROLS_v2),
 * copied here verbatim so the diff below is a diff and not an assertion.
 */
export const LEDGER_AT_MAIN: Record<string, { status: string; strongestControl: string; n: number }> = {
  density: { status: "informing", strongestControl: "piano_one_note_per_bar", n: 7 },
  emotionalArcAndTension: { status: "gated", strongestControl: "flatten_arc", n: 8 },
  groove: { status: "gated", strongestControl: "onset_jitter@3", n: 31 },
  harmony: { status: "gated", strongestControl: "chord_tone_to_non_chord_tone@3", n: 22 },
  idiomaticity: { status: "informing", strongestControl: "piano_wide_voicing", n: 7 },
  melodyAndCounterline: { status: "gated", strongestControl: "top_line_into_vocal_register", n: 8 },
  motifRecurrenceAndDevelopment: { status: "informing", strongestControl: "random_pitch", n: 8 },
  orchestration: { status: "gated", strongestControl: "drums_only", n: 8 },
  performanceRealisation: { status: "gated", strongestControl: "strip_cc_and_quantise", n: 8 },
  playability: { status: "gated", strongestControl: "bass_roots_only_leaps", n: 8 },
  register: { status: "gated", strongestControl: "role_inversion@3", n: 8 },
  repetitionVsVariation: { status: "informing", strongestControl: "chorus_copy", n: 5 },
  rhythmicInteraction: { status: "gated", strongestControl: "parallel_doubling@3", n: 22 },
  sectionDevelopment: { status: "informing", strongestControl: "chorus_copy+develop_chorus_2", n: 5 },
  transitions: { status: "gated", strongestControl: "erase_boundary_events+realise_boundaries", n: 8 },
  voiceLeading: { status: "gated", strongestControl: "bass_roots_only_leaps", n: 8 },
};

function compact(o: CriticObservation) {
  return {
    dimension: o.dimension, kind: o.kind, severity: o.severity,
    bars: `${o.location.startBar}-${o.location.endBar}`, section: o.location.sectionName ?? null,
    tracks: o.location.trackIds, origin: `${o.suspectedOrigin}@${o.originConfidence}`,
    confidence: o.confidence, evidence: o.evidence,
    repair: o.recommendedRepair ? `${o.recommendedRepair.operation} (${o.recommendedRepair.scope})` : null,
  };
}

const findings = (reports: CriticDimensionReport[], kind: string) =>
  reports.flatMap((r) => r.observations).filter((o) => o.kind === kind);

// ---------------------------------------------------------------------------
// 1. R-1b §4, row by row
// ---------------------------------------------------------------------------

type Section4Row = {
  observedDefect: string;
  reviewSaid: string;
  status: "closed" | "partly_closed" | "open";
  caughtBy: string[];
  controlStatus: string;
  measuredOnTheOwnersSong: string;
  control: string;
};

function section4(reports: CriticDimensionReport[]): Section4Row[] {
  const at = (kind: string) => findings(reports, kind);
  const statusOf = (dimension: string) => CONTROL_LEDGER[dimension]?.status ?? "uncalibrated";
  // B-25 (charter rule 6): the rates these rows used to quote were copied by
  // hand from a harness run and went stale the moment the anchors moved. They
  // are read from the generated ledger now - the same table `rank.ts` and the
  // judge read - so there is one source of truth for what a control showed.
  const gatesOn = (dimension: string) => {
    const e = CONTROL_LEDGER[dimension];
    if (!e) return `${dimension}: uncalibrated`;
    const rate = e.detectionRate === null ? "an unmeasured rate" : `${Math.round(e.detectionRate * 100)} %`;
    return e.gatingTransforms.length
      ? `${dimension} gates on ${e.gatingTransforms.join(" + ")} (strongest ${e.strongestControl}, ${rate} of ${e.n} items)`
      : `${dimension} does not gate: ${e.reason}`;
  };
  const count = (kind: string) => at(kind).length;
  const worst = (kind: string) => {
    const order = { info: 0, minor: 1, major: 2, blocking: 3 } as Record<string, number>;
    return at(kind).reduce<string>((best, o) => (order[o.severity] > order[best] ? o.severity : best), "info");
  };
  return [
    {
      observedDefect: "String bed reduced to one voice by perform -> repair",
      reviewSaid: "density.bed_single_voice minor x6; register 93; not in the judge's top 12",
      status: "closed",
      caughtBy: ["density.single_voice_bed"],
      controlStatus: statusOf("density"),
      measuredOnTheOwnersSong: `${count("single_voice_bed")} sections (B-05c measured >= 5, all blocking). Closed by B-13: \`playabilityRepair\` releases the earlier voices of a crowded onset instead of dropping them, and the bed ships 281 notes with no section below three voices. The control that found it keeps its sensitivity on a constructed case - \`strip_bed_to_top_voice\` on the owner's own beds raises it again in 11 sections, 7 of them attributed to \`perform\` with composedMeanVoices 3-8 against a shipped 1.0 (\`dimensions/ownerAnchor.test.ts\`)`,
      control: `${gatesOn("density")}; for the origin, the composed-notes control`,
    },
    {
      observedDefect: "Strings at 89-92 in the climax; 79-84 elsewhere read as \"in range\"",
      reviewSaid: "register.part_outside_comfortable_range major x1 (Chorus 3 only)",
      status: "closed",
      caughtBy: ["register.top_line_above_comfortable_ceiling", "register.part_outside_comfortable_range"],
      controlStatus: statusOf("register"),
      measuredOnTheOwnersSong: `${count("top_line_above_comfortable_ceiling")} sections against the ceiling the part's own profile gives it in its role, plus ${count("part_outside_comfortable_range")} against the absolute band (R-1b: 5 refusals and one \`climax_all_treble\`). Closed by B-21 D4: the writers take the window from \`instrumentProfile.roleRegisterFor\` - the critic's own table - instead of the family range widened by the section histogram, and \`register\` scores 100. Sensitivity demonstrated on \`strings_up_two_octaves\`, which puts the dimension on its floor with 8 \`top_line_above_comfortable_ceiling\` majors on the same bed`,
      control: gatesOn("register"),
    },
    {
      observedDefect: "Harmony parts 100-230 ms off the beat while the kit is on it",
      reviewSaid: "groove 0, off_grid blocking - caught, but origin `perform` (wrong)",
      status: "closed",
      caughtBy: ["groove.off_grid", "groove.harmony_off_grid"],
      controlStatus: statusOf("groove"),
      measuredOnTheOwnersSong: `${count("off_grid")} off_grid and ${count("harmony_off_grid")} harmony_off_grid observations (B-05c measured >= 20 off_grid, B-13 12). Closed by B-13 and B-21 D2/D3/D5; every part's median deviation is 3-13 ms inside a 30 ms tolerance. What is left is one \`harmony_off_grid\` major: the strings state the harmony 53 ms from the kit in the Bridge, measured against the kit's own eighth grid. Both controls keep their sensitivity on a constructed case - see \`grooveIsolation\``,
      control: gatesOn("groove"),
    },
    {
      observedDefect: "Arc flattened in performance (x0.6, first-section shape)",
      reviewSaid: "performanceRealisation 97, flat_dynamics on percussion only",
      status: "partly_closed",
      caughtBy: ["performanceRealisation.dynamic_range_flat_per_section"],
      controlStatus: statusOf("performanceRealisation"),
      measuredOnTheOwnersSong: `${count("dynamic_range_flat_per_section")} findings; performanceRealisation ${reports.find((r) => r.dimension === "performanceRealisation")!.summary.score0to100} (was 97 in the review). What is still not caught is the *cause*: nothing here reads the first-section role assignment, because the critic sees notes and not the performance call.`,
      control: gatesOn("performanceRealisation"),
    },
    {
      observedDefect: "The chorus is thinner than the verse before it",
      reviewSaid: "density.louder_section_thinner major - caught",
      status: "closed",
      caughtBy: ["density.arrival_thinner_than_setup", "density.louder_section_thinner"],
      controlStatus: statusOf("density"),
      measuredOnTheOwnersSong: `${count("arrival_thinner_than_setup")} arrivals smaller than their setup in two of onsets/voices/dynamics, ${count("louder_section_thinner")} on onsets alone; the new kind refuses a candidate on its own`,
      control: gatesOn("density"),
    },
    {
      observedDefect: "No LH / empty C3-C5 in the climax",
      reviewSaid: "register sub_register_overlap, info only",
      status: "closed",
      caughtBy: ["register.climax_all_treble"],
      controlStatus: statusOf("register"),
      measuredOnTheOwnersSong: count("climax_all_treble")
        ? `${count("climax_all_treble")} finding: ${JSON.stringify(at("climax_all_treble")[0].evidence)}`
        : "not raised on this output: the climax has note-seconds between C3 and C5 (the bass reaches C3 in Chorus 3), so the detector abstains — the hole the review describes is between C3 and C5 *in the pitched harmony*, and this kind reads the whole ensemble",
      control: "no dedicated transform; the kind is exercised by its unit test and reported as `informing`-grade evidence only",
    },
    {
      observedDefect: "The same staccato triad on every beat for 22 bars",
      reviewSaid: "repetitionVsVariation 100; idiomaticity 100; boredom 100",
      status: "open",
      caughtBy: [],
      controlStatus: statusOf("repetitionVsVariation"),
      measuredOnTheOwnersSong: "still not caught. A cell repeated inside one section with a changing voicing is not a bar-for-bar repeat, and no dimension in this set reads gesture monotony. B-05c does not close it.",
      control: "none",
    },
    {
      observedDefect: "Chromatic / major-third approach tones in minor",
      reviewSaid: "harmony.clash_share minor (Chorus 3) - partially",
      status: "closed",
      caughtBy: ["harmony.approach_tone_wrong_mode"],
      controlStatus: statusOf("harmony"),
      measuredOnTheOwnersSong: count("approach_tone_wrong_mode")
        ? at("approach_tone_wrong_mode").map((o) => `${o.location.sectionName}: ${o.evidence.approachTones} approach tones, ${o.evidence.majorThirdOverMinorChord} of them the major third of a minor chord (${o.evidence.chords})`).join("; ")
        : "not raised on this output (the approach notes the review names are longer than the 0.75 s window or do not resolve by step within a beat)",
      control: `${gatesOn("harmony")}; this kind has no transform of its own`,
    },
    {
      observedDefect: "Eight planned devices unrealised",
      reviewSaid: "transitions 80, all minor",
      status: "partly_closed",
      caughtBy: ["transitions.planned_device_unrealised"],
      controlStatus: statusOf("transitions"),
      measuredOnTheOwnersSong: `${count("planned_device_unrealised")} unrealised devices; the dimension is now \`informing\`, not \`gated\`, because its only passing transform is a prepared one`,
      control: `${gatesOn("transitions")} - its only passing transform is prepared, so it informs and never gates`,
    },
    {
      observedDefect: "Climax unprepared (keys alone -> tutti with no fill)",
      reviewSaid: "emotionalArc no_build_into_climax minor; causality climax_not_prepared major - caught",
      status: "closed",
      caughtBy: ["emotionalArcAndTension.no_build_into_climax", "causality.climax_not_prepared"],
      controlStatus: statusOf("emotionalArcAndTension"),
      measuredOnTheOwnersSong: `${count("no_build_into_climax")} emotionalArc no_build_into_climax and ${count("climax_not_prepared")} causality climax_not_prepared findings on the owner's output`,
      control: gatesOn("emotionalArcAndTension"),
    },
    {
      observedDefect: "No ending: the last stab lands 1.06 s before the song does",
      reviewSaid: "causality ending_missing major - caught (adversarial, uncalibrated)",
      status: "closed",
      caughtBy: ["transitions.ending_cut", "causality.ending_missing"],
      controlStatus: statusOf("transitions"),
      measuredOnTheOwnersSong: count("ending_cut")
        ? `ending_cut ${worst("ending_cut")}: ${JSON.stringify(at("ending_cut")[0].evidence)}`
        : "not raised: a pitched part is still sounding within half a second of the song's end on this output",
      control: "none of its own; the kind is exercised by its unit test",
    },
    {
      observedDefect: "The empty two-bar intro",
      reviewSaid: "orchestration.planned_family_silent blocking, judge priority 2404 - top of the list",
      status: "closed",
      caughtBy: ["transitions.intro_empty", "orchestration.planned_family_silent"],
      controlStatus: statusOf("orchestration"),
      measuredOnTheOwnersSong: `${count("intro_empty")} intro_empty and ${count("planned_family_silent")} planned_family_silent. Closed by B-21 D1: \`composer/opening.ts\` reads the arc's decided opening figure and states the tonic under it on the song's own first analysed chord, and the arrangement starts at 0.000 s instead of 3.795 s. R-1b P0-5's ordering - the bed and the off-grid harmony above the empty intro - is demonstrated on the constructed case in \`judgeOnTheOwnersSong.after.onTheConstructedCase\``,
      control: gatesOn("orchestration"),
    },
    {
      observedDefect: "Jazz arranged as disco; rock without a guitar; a kit in an orchestra",
      reviewSaid: "idiomaticity 100, orchestration 100, instrumentReality silent, releasable: true",
      status: "open",
      caughtBy: [],
      controlStatus: statusOf("idiomaticity"),
      measuredOnTheOwnersSong: "not applicable to the owner's song. On the corpus it is still open: no dimension in this set reads a style contract, and `idiomaticity` is now `demoted`-adjacent (`informing`, gated by one transform). B-05c does not close it; B-09's grammar has no critic.",
      control: gatesOn("idiomaticity"),
    },
    {
      observedDefect: "Counter-line halved by density thinning",
      reviewSaid: "nothing (B-10's proposed motif_statement_thinned not implemented)",
      status: "partly_closed",
      caughtBy: ["melodyAndCounterline.counterline_clashes_bed"],
      controlStatus: statusOf("melodyAndCounterline"),
      measuredOnTheOwnersSong: count("counterline_clashes_bed")
        ? `counterline_clashes_bed: ${at("counterline_clashes_bed").map((o) => `${o.location.sectionName} ${JSON.stringify(o.evidence)}`).join("; ")}`
        : "the new kind reads the counter-line's *relation to the bed* and does not fire here; the thinning itself (10 notes -> 5) is still uncaught — it needs the composed notes on the melodic part, which B-05c wires but no dimension yet reads for this",
      control: gatesOn("melodyAndCounterline"),
    },
  ];
}

// ---------------------------------------------------------------------------
// 2. The `groove = 0` isolation
// ---------------------------------------------------------------------------

function grooveIsolation() {
  const shipped = ownerAnchor();
  const composed = ownerComposedAnchor();
  const withComposed = { ...shipped.input, composedTrackModels: composed.input.trackModels };
  const shippedReport = grooveDimension.evaluate(shipped.input);
  const composedReport = grooveDimension.evaluate(composed.input);
  const attributed = grooveDimension.evaluate(withComposed);
  const bassQuantised = grooveDimension.evaluate(quantiseFamiliesToGrid(shipped, ["bass"]).input);
  const offGrid = (r: CriticDimensionReport, trackId?: string) =>
    r.observations.filter((o) => o.kind === "off_grid" && (!trackId || o.location.trackIds[0] === trackId));

  // B-25, at the B-21 merge. The finding this section isolates is **closed**,
  // so the controls are re-pointed at a constructed case rather than deleted:
  // `displaceHarmonyOffGrid` moves every harmonic part's onsets 180 ms — the
  // middle of the 100-230 ms range R-1b measured on this song. Applied to the
  // shipped notes alone it is what a performance stage does; applied to both
  // layers it is what a composer does. Control A has to tell those apart, and
  // control B has to remove exactly the part it is pointed at.
  const displacedInput = displaceHarmonyOffGrid(shipped.input);
  const displaced = { ...shipped, input: displacedInput };
  const performedOnly = { ...displacedInput, composedTrackModels: composed.input.trackModels };
  const writtenIn = { ...displacedInput, composedTrackModels: displaceHarmonyOffGrid(composed.input).trackModels };
  const performedReport = grooveDimension.evaluate(performedOnly);
  const writtenReport = grooveDimension.evaluate(writtenIn);
  const bassBack = grooveDimension.evaluate(quantiseFamiliesToGrid(displaced, ["bass"]).input);
  const displacedReport = grooveDimension.evaluate(displacedInput);
  const cSixteenths = grooveDimension.evaluate(quantiseFamiliesToGrid(displaced, ["bass", "keys", "strings"], 4).input);
  const cEighths = grooveDimension.evaluate(quantiseFamiliesToGrid(displaced, ["bass", "keys", "strings"], 2).input);
  const originCounts = (r: CriticDimensionReport) => ({
    total: offGrid(r).length,
    compose: offGrid(r).filter((o) => o.suspectedOrigin === "compose").length,
    perform: offGrid(r).filter((o) => o.suspectedOrigin === "perform").length,
  });

  return {
    finding: "R-1a P1-1: `groove = 0` on the owner's song, `off_grid` on the bass, `suspectedOrigin: perform`, and nobody could say why.",
    reproduced: {
      score: shippedReport.summary.score0to100,
      offGridObservations: offGrid(shippedReport).length,
      closedBy: "B-13 (chord events on the bar grid, median 140.8 ms -> 0.04 ms) and B-21 D2/D3/D5 (the arpeggio as a broken chord, the bass back on `groove.bassUnits`, `visibleChords` on the solver's quantised events)",
      note: "The finding no longer reproduces on the owner's song: 0 -> 8.85 (B-13) -> 70.74 (B-21), and `off_grid` is empty on every part and on both layers. Every part's median deviation is 3-13 ms inside a 30 ms tolerance, with an off-grid share of exactly 0 (B-05c measured shares of 0.55-0.73).",
    },
    reproducedOnAConstructedCase: {
      what: "`displaceHarmonyOffGrid(shipped)` — every harmonic part's onsets +180 ms, the middle of the range R-1b measured on this song",
      score: displacedReport.summary.score0to100,
      offGridObservations: offGrid(displacedReport).length,
      reading: "The dimension is back on its floor, so the controls below have something to isolate. Nothing about the dimension or its tolerance changed; the arrangement did.",
    },
    controls: [
      {
        id: "A_remove_performance_timing",
        what: "evaluate the notes the composer wrote, before `applyPerformance` and `playabilityRepair`",
        onTheOwnersSong: {
          score: composedReport.summary.score0to100,
          shippedScore: shippedReport.summary.score0to100,
          offGridObservations: offGrid(composedReport).length,
          worstShareByPart: Object.fromEntries(["bass-bass", "keys-rhythmic_harmony", "strings-pad"].map((id) => [id, {
            shipped: r3(Math.max(0, ...offGrid(shippedReport, id).map((o) => o.evidence.offGridShare as number))),
            composed: r3(Math.max(0, ...offGrid(composedReport, id).map((o) => o.evidence.offGridShare as number))),
          }])),
        },
        moves: "no_finding_to_move",
        sensitivityDemonstratedOn: {
          case: "the same 180 ms displacement, applied to the shipped notes alone and to both layers — the two cases differ only in what the composer wrote",
          displacedAfterComposition: {
            ...originCounts(performedReport),
            composedRecordedOnGrid: offGrid(performedReport).filter((o) => o.evidence.composedOnGrid === true).length,
            worstComposedShare: r3(Math.max(0, ...offGrid(performedReport).map((o) => (o.evidence.composedOffGridShare as number) ?? 0))),
          },
          displacedInTheWriting: {
            ...originCounts(writtenReport),
            composedRecordedOffGrid: offGrid(writtenReport).filter((o) => o.evidence.composedOnGrid === false).length,
            worstComposedShare: r3(Math.max(0, ...offGrid(writtenReport).map((o) => (o.evidence.composedOffGridShare as number) ?? 0))),
          },
          reading: "The same 22 findings, attributed the opposite way round: 17 of 22 to `perform` when only the shipped notes moved, 18 of 22 to `compose` when both layers did. The attribution is the control's evidence, not the size of the deviation.",
        },
        reading: "On the owner's song neither layer carries an `off_grid` finding, so the control has nothing to move — the answer is 'neither', not 'the composer'. Its ability to say which layer is demonstrated above, on a case where there is a layer to name.",
      },
      {
        id: "B_quantise_to_the_composer_grid",
        what: "snap the shipped onsets to the composer's bar grid, nothing else changed",
        onTheOwnersSong: {
          bassOnlyToSixteenths: { bassOffGridObservations: offGrid(bassQuantised, "bass-bass").length, score: bassQuantised.summary.score0to100 },
          bassOffGridBeforeTheControl: offGrid(shippedReport, "bass-bass").length,
        },
        moves: "no_finding_to_move",
        sensitivityDemonstratedOn: {
          case: "the constructed off-grid arrangement",
          bassOnlyToSixteenths: {
            bassBefore: offGrid(displacedReport, "bass-bass").length,
            bassAfter: offGrid(bassBack, "bass-bass").length,
            keysUnchanged: offGrid(bassBack, "keys-rhythmic_harmony").length === offGrid(displacedReport, "keys-rhythmic_harmony").length,
            stringsUnchanged: offGrid(bassBack, "strings-pad").length === offGrid(displacedReport, "strings-pad").length,
          },
          allHarmonyToSixteenths: { score: cSixteenths.summary.score0to100, offGrid: offGrid(cSixteenths).length, harmonyOffGrid: cSixteenths.observations.filter((o) => o.kind === "harmony_off_grid").length },
          allHarmonyToEighths: { score: cEighths.summary.score0to100, offGrid: offGrid(cEighths).length, harmonyOffGrid: cEighths.observations.filter((o) => o.kind === "harmony_off_grid").length },
          reading: "Quantising only the bass removes all five of the bass's findings and leaves the keys' nine and the strings' eight exactly as they were: the control is isolating. Quantising all the harmony to sixteenths clears `off_grid` and leaves `harmony_off_grid` standing; only the kit's own eighths settle both. 'On a grid' and 'with the kit' are still not the same claim.",
        },
        reading: "On the owner's song the control is a no-op — it takes nothing away, because the bass is already on the grid before it runs.",
      },
    ],
    cause: {
      named: "closed: both causes named on this anchor are fixed in the writers",
      statement: "B-05c named the cause as the harmony writers passing the Song Model's analysed chord onsets through unquantised (a median 136 ms from the beat) while the kit writer used the bar grid — two grids, before the performance stage ran. B-13 closed that (140.8 ms -> 0.04 ms). B-13 then named the residue as the groove plan's own eighth-note swing and anticipations under the bass and the bed; B-21's D2, D3 and D5 closed that. With the composed notes in view the dimension now raises 0 `off_grid` observations, where B-05c measured >= 20 and B-13 measured 12.",
      ruledOut: [
        "the performance engine — control A finds no finding on either layer, and demonstrates on a constructed case that it can still tell the layers apart",
        "the critic's tolerance — max(30 ms, 5 % of a beat) is unchanged by B-05c, B-13, B-21 or B-25, and every part's median deviation is 3-13 ms inside it",
        "the critic being wrong — the same unmodified dimension goes straight back to 0 on the constructed case",
      ],
      whatChangedInTheCritic: "nothing in B-25. `off_grid` still reads `CriticInput.composedTrackModels` when it is present and says which layer put the onsets there; when it is not, it attributes to the composer at a lower confidence and names the control in the repair text.",
      attributionAfterTheFix: {
        ...originCounts(attributed),
        note: "zero: there is nothing left on the owner's song for the attribution to attribute.",
      },
      attributionOnTheConstructedCase: {
        displacedAfterComposition: originCounts(performedReport),
        displacedInTheWriting: originCounts(writtenReport),
      },
      whatIsLeft: attributed.observations.filter((o) => o.kind === "harmony_off_grid").map(compact),
    },
    ownersOutputNow: shippedReport.observations.filter((o) => o.severity !== "info").map(compact),
  };
}

// ---------------------------------------------------------------------------
// 3 & 4. The judge and the ranking
// ---------------------------------------------------------------------------

/**
 * R-1b P0-5's ordering, demonstrated where the findings still exist (B-25).
 * The four transforms are the anchor set's own, one per closed defect, and the
 * judge and its rules are untouched.
 */
function constructedOrdering() {
  const owner = ownerAnchor();
  const composed = ownerComposedAnchor();
  const asAnchor = (input: CriticInput) => ({ ...owner, input });
  const raised = applyPurposeBuilt(owner, "counterline_into_bed_register");
  const stripped = raised ? applyPurposeBuilt(asAnchor(raised.input), "strip_bed_to_top_voice") : null;
  const silent = stripped ? silenceOpeningBars(asAnchor(stripped.input), 2) : null;
  if (!silent) return { built: false as const, reason: "the anchor no longer supports one of the four transforms" };
  const input: CriticInput = { ...displaceHarmonyOffGrid(silent.input), composedTrackModels: composed.input.trackModels };
  const v = judge([...evaluateAllDimensions(input), ...runAdversarialCritics(input)], judgeContextFromInput(input));
  const rankOf = (predicate: (o: CriticObservation) => boolean) => {
    const i = v.ranked.findIndex((r) => predicate(r.observation));
    return i < 0 ? null : i + 1;
  };
  const intro = rankOf((o) => o.kind === "planned_family_silent" && o.location.endBar <= 2);
  return {
    built: true as const,
    transforms: ["counterline_into_bed_register", "strip_bed_to_top_voice", "silenceOpeningBars(2)", "displaceHarmonyOffGrid(0.18)"],
    releasable: v.overall.releasable,
    refusalKinds: [...new Set(v.refusals.map((r) => r.kind))],
    positions: {
      emptyIntro: intro,
      stringBed: rankOf((o) => o.kind === "single_voice_bed"),
      offGridHarmony: rankOf((o) => o.kind === "off_grid"),
      aboveTheIntroAllBlocking: intro === null ? null : v.ranked.slice(0, intro - 1).every((r) => r.observation.severity === "blocking"),
      introSalience: intro === null ? null : v.ranked[intro - 1].salience,
      introPriority: intro === null ? null : v.ranked[intro - 1].priority,
    },
    topProblems: v.topProblems.map((p) => `${p.kind} (${p.severity})`),
    reading: "The string bed and the off-grid harmony both outrank the empty two-bar intro, which sits at the salience floor because no music sounds in bars 1-2 — R-1b P0-5, on an arrangement that has the findings.",
  };
}

function judgeOnTheOwnersSong() {
  const shipped = ownerAnchor();
  const composed = ownerComposedAnchor();
  const input: CriticInput = { ...shipped.input, composedTrackModels: composed.input.trackModels };
  const reports = [...evaluateAllDimensions(input), ...runAdversarialCritics(input)];
  const context = judgeContextFromInput(input);
  const withSalience = judge(reports, context);
  // The v1 ordering: the same reports and sections with no sounding-time map.
  const withoutSalience = judge(reports, { sections: context.sections });
  const topOf = (v: typeof withSalience) => v.ranked.slice(0, 8).map((r) => ({
    priority: r.priority, salience: r.salience,
    what: `${r.observation.dimension}:${r.observation.kind}`, severity: r.observation.severity,
    section: r.observation.location.sectionName ?? null, bars: `${r.observation.location.startBar}-${r.observation.location.endBar}`,
  }));
  // B-25: `null` when the finding is not raised at all, never 0. Three of the
  // four defects R-1b ranked here are closed in the writers, and a position of
  // "0" would read as "first" to anything that compared these numbers.
  const rankOf = (v: typeof withSalience, predicate: (o: CriticObservation) => boolean) => {
    const i = v.ranked.findIndex((r) => predicate(r.observation));
    return i < 0 ? null : i + 1;
  };
  const isIntro = (o: CriticObservation) => o.kind === "planned_family_silent" && o.location.endBar <= 2;
  const isBed = (o: CriticObservation) => o.kind === "single_voice_bed";
  const isGrid = (o: CriticObservation) => o.kind === "off_grid";
  return {
    dimensionScores: Object.fromEntries(reports.map((r) => [r.dimension, { score: r.summary.score0to100, controlStatus: r.summary.controlStatus, applicable: r.applicable }])),
    before: {
      what: "the judge as `origin/main` 31b9443 ranks it: severity x confidence x control weight x rule boosts, with nothing that knows how much music a finding is about",
      releasable: withoutSalience.overall.releasable,
      top8: topOf(withoutSalience),
      positions: { emptyIntro: rankOf(withoutSalience, isIntro), stringBed: rankOf(withoutSalience, isBed), offGridHarmony: rankOf(withoutSalience, isGrid) },
    },
    after: {
      what: "priority x musical salience (seconds of sounding music in the span, lifted at the climax and in sung sections), and a boost that assumes a section is being carried does not apply where nothing sounds",
      releasable: withSalience.overall.releasable,
      top8: topOf(withSalience),
      positions: { emptyIntro: rankOf(withSalience, isIntro), stringBed: rankOf(withSalience, isBed), offGridHarmony: rankOf(withSalience, isGrid) },
      closedInTheWriters: {
        emptyIntro: "B-21 D1: `composer/opening.ts` states the arc's decided opening on the song's own first chord; the first note is at 0.000 s, not 3.795 s, and `planned_family_silent` is not raised",
        stringBed: "B-13: `playabilityRepair` releases the earlier voices of a crowded onset instead of dropping them; no section is below three voices and `single_voice_bed` is not raised",
        offGridHarmony: "B-13 + B-21 D2/D3/D5: the writers are on the bar grid and `off_grid` is not raised on either layer",
        note: "All three positions above are therefore `null`. The ordering R-1b P0-5 asked for is demonstrated on the constructed case below, where the three findings exist to be ordered.",
      },
      onTheConstructedCase: constructedOrdering(),
      refusals: withSalience.refusals,
      topProblems: withSalience.topProblems,
      reasons: withSalience.overall.reasons,
      disagreementsKeptOpen: withSalience.disagreements.filter((d) => d.resolution === "kept_open").length,
      agreements: withSalience.agreements.length,
    },
  };
}

function rankingOnTheCorpus(ids: readonly string[]) {
  return ids.map((id) => {
    const spec = BENCHMARK_CORPUS.find((c) => c.id === id)!;
    const reference = anchors([id])[0];
    const random = probeAnchor(spec, "random_pitch");
    const drums = probeAnchor(spec, "drums_only");
    const forInput = (input: CriticInput) => [...evaluateAllDimensions(input), ...runAdversarialCritics(input)];
    const result = rankCandidates([
      { candidateId: "random-pitch", reports: forInput(random.input), context: judgeContextFromInput(random.input), noteCount: random.input.trackModels.reduce((s, t) => s + t.notes.length, 0) },
      { candidateId: "reference", reports: forInput(reference.input), context: judgeContextFromInput(reference.input), noteCount: reference.input.trackModels.reduce((s, t) => s + t.notes.length, 0) },
      { candidateId: "drums-only", reports: forInput(drums.input), context: judgeContextFromInput(drums.input), noteCount: drums.input.trackModels.reduce((s, t) => s + t.notes.length, 0) },
    ]);
    return {
      case: id,
      selected: result.selected,
      order: result.ranked.map((r) => ({
        candidateId: r.candidateId, rank: r.rank, releasable: r.releasable,
        blocking: r.blockingCount, refusals: r.refusalCount,
        salienceWeightedMajors: r.salienceWeightedMajors, constructiveScore: r.constructiveScore, why: r.why,
      })),
      nearIdentical: result.nearIdentical,
      referenceTopProblems: result.ranked.find((r) => r.candidateId === "reference")!.topProblems.map((p) => `${p.kind}${p.section ? ` @${p.section}` : ""} (${p.severity})`),
    };
  });
}

// ---------------------------------------------------------------------------
// 5. The ledger diff
// ---------------------------------------------------------------------------

function ledgerDiff() {
  return DIMENSION_NAMES.map((dimension) => {
    const before = LEDGER_AT_MAIN[dimension];
    const after = CONTROL_LEDGER[dimension];
    const rank = { gated: 3, informing: 2, demoted: 1, uncalibrated: 0 } as Record<string, number>;
    const direction = rank[after.status] > rank[before.status] ? "promoted" : rank[after.status] < rank[before.status] ? "demoted" : "unchanged";
    return {
      dimension,
      before: before.status, after: after.status, direction,
      strongestControlBefore: before.strongestControl, strongestControlAfter: after.strongestControl,
      nBefore: before.n, nAfter: after.n,
      gatingTransforms: after.gatingTransforms,
      reason: after.reason,
    };
  });
}

// ---------------------------------------------------------------------------

export function buildB05cEvidence(options: { now?: Date } = {}) {
  const shipped = ownerAnchor();
  const composed = ownerComposedAnchor();
  const ownerInput: CriticInput = { ...shipped.input, composedTrackModels: composed.input.trackModels };
  const ownerReports = [...evaluateAllDimensions(ownerInput), ...runAdversarialCritics(ownerInput)];
  const diff = ledgerDiff();

  return {
    version: B05C_EVIDENCE_VERSION,
    generatedAt: (options.now ?? new Date()).toISOString(),
    builtAgainst: "origin/main 31b9443 (the R-1 reviews commit)",
    answers: {
      "R-1a P1-1": "the owner's fixture is an anchor and `groove = 0` is isolated — see `grooveIsolation`",
      "R-1a P1-2": "the eight red `critics/dimensions` suites are green; twelve tests fixed or re-anchored with the cause beside each — see `redSuites`",
      "R-1a P1-3": "one rule (`critics/sensitivity.ts`), one ledger shape, prepared controls never gate, two independent transforms required — see `sensitivityRule` and `ledgerDiff`",
      "R-1a P0-3": "`critics/rank.ts` ranks on the critics that pass controls — see `rankingOnTheCorpus`. Wiring it is the lead's integration line; this stream edits no orchestrator file.",
      "R-1b §4": "see `section4Table`",
      "R-1b P0-5 / §7 item 10": "see `judgeOnTheOwnersSong`",
    },
    versions: {
      sensitivity: CRITIC_SENSITIVITY_VERSION,
      controlHarness: CONTROL_HARNESS_VERSION,
      controlLedger: CONTROL_LEDGER_VERSION,
      judge: JUDGE_VERSION,
      rank: CANDIDATE_RANK_VERSION,
    },
    sensitivityRule: {
      rule: SENSITIVITY_RULE,
      sharedBy: ["critics/controls.ts", "critics/adversarial/controls.ts", "lib/positiveControlLedger.ts (integration line: import SENSITIVITY_RULE instead of restating SENSITIVITY_GATE)"],
      derivedFrom: "listeningSensitivity.SENSITIVITY_GATE — the same constants B-08's ledger uses; no fourth set exists in the repo",
      addedClauses: [
        "a prepared control (`control+preparation`) may inform, never gate",
        "a dimension needs two independent non-prepared transforms to gate",
      ],
      claimedControls: CLAIMED_CONTROLS,
    },
    anchors: {
      clean: CLEAN_ANCHOR_IDS,
      defectReasons: DEFECT_ANCHOR_REASONS,
      fixedDefects: FIXED_ANCHOR_DEFECTS,
      owner: {
        id: shipped.id,
        bars: shipped.input.songModel.bars.length,
        tracks: shipped.input.trackModels.map((t) => ({ id: t.id, notes: t.notes.length })),
        composedTracks: composed.input.trackModels.map((t) => ({ id: t.id, notes: t.notes.length })),
        note: "deliberately not in the clean set or the control set: it carries real defects the dimensions are supposed to flag, and 141 bars x every control is a different order of runtime",
      },
    },
    section4Table: section4(ownerReports),
    grooveIsolation: grooveIsolation(),
    judgeOnTheOwnersSong: judgeOnTheOwnersSong(),
    rankingOnTheCorpus: rankingOnTheCorpus(["pop-full", "rock-full", "jazz-full", "dance-full"]),
    ledgerDiff: diff,
    ledgerDiffSummary: {
      promoted: diff.filter((d) => d.direction === "promoted").map((d) => `${d.dimension}: ${d.before} -> ${d.after}`),
      demoted: diff.filter((d) => d.direction === "demoted").map((d) => `${d.dimension}: ${d.before} -> ${d.after} (${d.reason})`),
      unchanged: diff.filter((d) => d.direction === "unchanged").map((d) => d.dimension),
    },
    releaseRules: {
      blockingFromGated: "any blocking observation from a dimension the ledger gates",
      majorBlocks: [...MAJOR_BLOCKS_DIMENSIONS],
      bedKinds: [...BED_KINDS],
      alwaysRefuses: [...ALWAYS_REFUSES_KINDS],
      salience: { floor: SALIENCE_FLOOR, climaxMultiplier: CLIMAX_SALIENCE, sungMultiplier: SUNG_SALIENCE, measuredAgainst: "seconds of sounding music inside the observation's bars, as a share of the song's sounding seconds" },
    },
    redSuites: [
      { suite: "harmony", test: "null control", action: "re-anchored", cause: "orchestral-midi scores 89.2, not >= 90: three named minor findings B-02's harmony chain introduced (keys ostinato clash share 0.085 / 0.081, bass states the root on 1 of 4 changes). The `no blocking` half of the null control is unchanged and still strict." },
      { suite: "groove", test: "erase_drum_fills on dance-full", action: "re-anchored", cause: "copying bar 7 (10 onsets) over bar 8 (8) raises the fill bar's density, so the erasure improves the score (91.27 -> 93.76). A transform that improves the score is not a control; recorded as the null result it is." },
      { suite: "orchestration", test: "tutti_everywhere", action: "fixed", cause: "the control filled only the sections a part did not 'play in'; on five anchors every part clears that bar while still resting inside its sections, so the harness never produced a tutti (2/5). It now fills every resting bar and the control is 9/9." },
      { suite: "orchestration", test: "anchors' composer defects", action: "re-anchored", cause: "ethnic-vocal no longer overflows the song — B-04's meter work fixed it (last note 48.32 s in a 48.46 s song, no blocking finding from any dimension). The stale `DEFECT_ANCHOR_REASONS` string is retired and the anchor joins the clean and control sets." },
      { suite: "register", test: "role_inversion positive control", action: "re-anchored", cause: "TypeError from a non-null assertion: `roleInversion` is genuinely inapplicable on dance-full (the inverted register leaves the MIDI range, or the part already sits there). The harness's own rule — an unchanged input is not a control on that anchor — now applies, and the skipped set is asserted." },
      { suite: "density", test: "chorus_thinner_than_verse", action: "re-anchored", cause: "since B-01 the pop and rock verses have no drums, so a chorus thinned to a third is still at 90 % of the verse's onsets per bar with an extra part playing; only dance-full clears the 0.85 threshold. The other anchors detect the control through other kinds, asserted by name. What the review actually asked for is `arrival_thinner_than_setup`, added with its own transform." },
      { suite: "repetitionVsVariation", test: "dance breakdown is its verse", action: "re-anchored", cause: "B-04 gave the breakdown its own groove cell; the sections now share 0.25 / 0 of their bars. The 'real finding' test becomes a positive control (paste the verse back over the breakdown) so the detector stays under test without requiring the composer to stay broken." },
      { suite: "sectionDevelopment", test: "chorus 2 keeps identity and develops", action: "re-anchored", cause: "identity share 0.22-0.375 (0 on acoustic-demo): after B-02/B-04/B-10 the composer develops chorus 2 and keeps no identity. R-1b §5 measured the same thing on the owner's song. The dimension is right; the test pins what it reads." },
      { suite: "sectionDevelopment", test: "a developed chorus 2 reads as developed", action: "re-anchored", cause: "same cause; the `identityKept` assertion is dropped and the two axes the preparation moves are pinned instead." },
      { suite: "sectionDevelopment", test: "chorus_copy positive control", action: "re-anchored", cause: "acoustic-demo drops 4.95 not >= 7 because its prepared chorus 2 already carries `repeat_without_identity`, so the copy trades one major finding for another. Per-anchor floors, with the condition asserted rather than the number loosened for all four." },
      { suite: "transitions", test: "boundaries are read from the notes", action: "re-anchored", cause: "dance-full's intro fill ratio is 1.1428 against the dimension's 1.15 and there is no tom anywhere on the anchor; the boundary is marked by a crash on the downbeat and a register move, which is what the reading says." },
      { suite: "transitions", test: "erased fills and pickups", action: "re-anchored", cause: "on dance-full the drums read as realising every planned fill before and after the erasure, so what the erasure removes there is the three bass pickups. The test asserts the located devices and requires a drum fill only where the drums are the marker." },
    ],
    honestLimits: [
      "Nothing here is wired into production. `critics/rank.ts` is pure and is called by no orchestrator file; B-13 owns the compose loop and B-06 the repair stage. Until one of them calls it, R-1a P0-3 is answered on paper and `musicCritic` still ranks and gates.",
      "Two of the transforms that earn a gate are close to a detector's own definition — `strip_bed_to_top_voice` reduces beds to one voice and `single_voice_bed` counts voices; `arrival_thinned_and_softened` damages onsets, voices and velocity and `arrival_thinner_than_setup` reads those three. They are independent of *each other*, which is what the two-transform rule asks, and they are not independent of the detector. R-1a §3's criticism of `flatten_arc` and `strip_cc_and_quantise` applies to them too and is not closed by this stream.",
      "`density` is promoted from `informing` to `gated`, and one of its two gating transforms is the definitional one above. A reader who discounts that transform should read `density` as `informing`.",
      "The ninth anchor (ethnic-vocal) raises `n` from 8 to 9 on every purpose-built control, which is what lifts several transforms over the eight-item floor. That is more evidence, not a weaker rule — but it means several statuses sit one item above the threshold.",
      "`idiomaticity` catches `piano_wide_voicing` 8 of 8 and is still only `informing`, because its other claimed transform (`density_doubling@3`) it catches 0 of 31. `sectionDevelopment` is `demoted` for the same kind of reason. Both are reported, not tuned.",
      "Three rows of R-1b §4 are still open: gesture monotony (the same staccato triad for 22 bars), style fidelity (jazz arranged as disco, rock without a guitar), and the density thinning of a motif-tagged line. No dimension in this set reads them, and B-05c does not add one.",
      "`climax_all_treble`, `ending_cut`, `approach_tone_wrong_mode` and `counterline_clashes_bed` have unit tests and null tests but no purpose-built transform of their own, so they carry their dimension's control status rather than earning one. Their evidence on the owner's song is reported above, including where they do not fire.",
      "The owner's anchor is one arrangement of one song with one brief. It is a real anchor and it is not a corpus.",
      "The composed notes reach the critics through `CriticInput.composedTrackModels`, which only a caller that captured them can fill. On the production path nobody captures them yet, so `single_voice_bed` would ship as `major`/`compose` rather than `blocking`/`perform` — the correct reading of the shipped notes alone, and not the whole truth.",
      "The judge's salience is measured from the notes, so it moves when the composer changes. That is intended; it also means the ordering in this file is a measurement of one composer, not a fixed ranking.",
    ],
    retiredFromRanking: {
      what: "the dimensions `critics/rank.ts` must stop reading once it is wired",
      musicCritic: {
        note: "all eleven v1 dimensions are demoted in B-08's merged ledger (`docs/evidence/positive-control-ledger.json`); only `musicCritic.overall` gates, on `role_inversion`",
        dimensions: ["harmony", "voiceLeading", "melody", "rhythm", "groove", "orchestration", "register", "density", "transitions", "performancePotential", "arrangementArc"],
        keepAs: "`initialCritique` for the drift metric only — never a ranking weight",
      },
      candidateQuality: {
        note: "B-08's ledger records 13 of 17 dimensions as `insufficient data` on brain output",
        keepAs: "the legacy path's own score; not read by `rankCandidates`",
      },
      deleted: "nothing — this stream deletes no code and edits neither module beyond a comment",
    },
  };
}
