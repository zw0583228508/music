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
import { anchors, ownerAnchor, ownerComposedAnchor, probeAnchor, quantiseFamiliesToGrid, CLEAN_ANCHOR_IDS, FIXED_ANCHOR_DEFECTS, DEFECT_ANCHOR_REASONS } from "./dimensions/anchors";
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
      measuredOnTheOwnersSong: `${count("single_voice_bed")} sections, worst ${worst("single_voice_bed")}; with the composed notes in view four of them are attributed to \`perform\` with composedMeanVoices 3-4 against a shipped 1.0`,
      control: "strip_bed_to_top_voice (9/9) and, for the origin, the composed-notes control",
    },
    {
      observedDefect: "Strings at 89-92 in the climax; 79-84 elsewhere read as \"in range\"",
      reviewSaid: "register.part_outside_comfortable_range major x1 (Chorus 3 only)",
      status: "closed",
      caughtBy: ["register.top_line_above_comfortable_ceiling", "register.part_outside_comfortable_range"],
      controlStatus: statusOf("register"),
      measuredOnTheOwnersSong: `${count("top_line_above_comfortable_ceiling")} sections against the ceiling the part's own profile gives it in its role, plus ${count("part_outside_comfortable_range")} against the absolute band`,
      control: "strings_up_two_octaves (9/9) + role_inversion@3 (9/9)",
    },
    {
      observedDefect: "Harmony parts 100-230 ms off the beat while the kit is on it",
      reviewSaid: "groove 0, off_grid blocking - caught, but origin `perform` (wrong)",
      status: "closed",
      caughtBy: ["groove.off_grid", "groove.harmony_off_grid"],
      controlStatus: statusOf("groove"),
      measuredOnTheOwnersSong: `${count("off_grid")} off_grid and ${count("harmony_off_grid")} harmony_off_grid observations; the origin is now decided by the composed-notes control and reads \`compose\` on ${at("off_grid").filter((o) => o.suspectedOrigin === "compose").length} of ${count("off_grid")}`,
      control: "onset_jitter@3 (29/31) + unlock_bass_from_kick (9/9)",
    },
    {
      observedDefect: "Arc flattened in performance (x0.6, first-section shape)",
      reviewSaid: "performanceRealisation 97, flat_dynamics on percussion only",
      status: "partly_closed",
      caughtBy: ["performanceRealisation.dynamic_range_flat_per_section"],
      controlStatus: statusOf("performanceRealisation"),
      measuredOnTheOwnersSong: `${count("dynamic_range_flat_per_section")} findings; performanceRealisation ${reports.find((r) => r.dimension === "performanceRealisation")!.summary.score0to100} (was 97 in the review). What is still not caught is the *cause*: nothing here reads the first-section role assignment, because the critic sees notes and not the performance call.`,
      control: "velocity_flatten_all (9/9) + strip_cc_and_quantise (9/9)",
    },
    {
      observedDefect: "The chorus is thinner than the verse before it",
      reviewSaid: "density.louder_section_thinner major - caught",
      status: "closed",
      caughtBy: ["density.arrival_thinner_than_setup", "density.louder_section_thinner"],
      controlStatus: statusOf("density"),
      measuredOnTheOwnersSong: `${count("arrival_thinner_than_setup")} arrivals smaller than their setup in two of onsets/voices/dynamics, ${count("louder_section_thinner")} on onsets alone; the new kind refuses a candidate on its own`,
      control: "arrival_thinned_and_softened (9/9)",
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
      control: "chord_tone_to_non_chord_tone@3 (22/22) + parallel_perfect_motion (9/9) for the dimension; this kind has no transform of its own",
    },
    {
      observedDefect: "Eight planned devices unrealised",
      reviewSaid: "transitions 80, all minor",
      status: "partly_closed",
      caughtBy: ["transitions.planned_device_unrealised"],
      controlStatus: statusOf("transitions"),
      measuredOnTheOwnersSong: `${count("planned_device_unrealised")} unrealised devices; the dimension is now \`informing\`, not \`gated\`, because its only passing transform is a prepared one`,
      control: "erase_boundary_events+realise_boundaries (9/9, prepared: informing only)",
    },
    {
      observedDefect: "Climax unprepared (keys alone -> tutti with no fill)",
      reviewSaid: "emotionalArc no_build_into_climax minor; causality climax_not_prepared major - caught",
      status: "closed",
      caughtBy: ["emotionalArcAndTension.no_build_into_climax", "causality.climax_not_prepared"],
      controlStatus: statusOf("emotionalArcAndTension"),
      measuredOnTheOwnersSong: `${count("no_build_into_climax")} emotionalArc no_build_into_climax and ${count("climax_not_prepared")} causality climax_not_prepared findings on the owner's output`,
      control: "flatten_arc (9/9) + swap_climax_with_quietest (9/9)",
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
      measuredOnTheOwnersSong: `${count("intro_empty")} intro_empty (minor) and ${count("planned_family_silent")} planned_family_silent; the finding is still made and is no longer first — see \`judgeOnTheOwnersSong\``,
      control: "drums_only (9/9) + silence_planned_family (9/9)",
    },
    {
      observedDefect: "Jazz arranged as disco; rock without a guitar; a kit in an orchestra",
      reviewSaid: "idiomaticity 100, orchestration 100, instrumentReality silent, releasable: true",
      status: "open",
      caughtBy: [],
      controlStatus: statusOf("idiomaticity"),
      measuredOnTheOwnersSong: "not applicable to the owner's song. On the corpus it is still open: no dimension in this set reads a style contract, and `idiomaticity` is now `demoted`-adjacent (`informing`, gated by one transform). B-05c does not close it; B-09's grammar has no critic.",
      control: "piano_wide_voicing (8/8)",
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
      control: "top_line_into_vocal_register (9/9) + top_line_erratic (9/9)",
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
  const allSixteenths = grooveDimension.evaluate(quantiseFamiliesToGrid(shipped, ["bass", "keys", "strings"], 4).input);
  const allEighths = grooveDimension.evaluate(quantiseFamiliesToGrid(shipped, ["bass", "keys", "strings"], 2).input);
  const offGrid = (r: CriticDimensionReport, trackId?: string) =>
    r.observations.filter((o) => o.kind === "off_grid" && (!trackId || o.location.trackIds[0] === trackId));

  // Whether a control moves the finding is *measured*, not asserted. It was
  // written as a literal `moves: false` / `moves: true` beside a sentence of
  // prose quoting numbers that were true when the sentence was typed; B-13
  // then changed the composed material and the prose went on claiming "the
  // composed notes score 0 as well" while the measurement beside it said 42.7.
  // An isolation whose verdict cannot be recomputed is not an isolation.
  const shippedOffGrid = offGrid(shippedReport).length;
  const composedOffGrid = offGrid(composedReport).length;
  const bassQuantisedOffGrid = offGrid(bassQuantised, "bass-bass").length;
  // A control "moves" the finding when the finding is gone after it: no
  // `off_grid` observation is left where there was one before.
  const aMoves = shippedOffGrid > 0 && composedOffGrid === 0;
  const bMoves = offGrid(shippedReport, "bass-bass").length > 0 && bassQuantisedOffGrid === 0;
  const share = (report: CriticDimensionReport, id: string) =>
    r3(Math.max(0, ...offGrid(report, id).map((o) => o.evidence.offGridShare as number)));

  return {
    finding: "R-1a P1-1: `groove = 0` on the owner's song, `off_grid` on the bass, `suspectedOrigin: perform`, and nobody could say why.",
    reproduced: { score: shippedReport.summary.score0to100, offGridObservations: shippedOffGrid },
    controls: [
      {
        id: "A_remove_performance_timing",
        what: "evaluate the notes the composer wrote, before `applyPerformance` and `playabilityRepair`",
        result: {
          score: composedReport.summary.score0to100,
          offGridObservations: composedOffGrid,
          worstShareByPart: Object.fromEntries(["bass-bass", "keys-rhythmic_harmony", "strings-pad"].map((id) => [id, {
            shipped: share(shippedReport, id),
            composed: share(composedReport, id),
          }])),
        },
        moves: aMoves,
        reading: aMoves
          ? `Removing the performance stage removes every off-grid observation (${shippedOffGrid} → 0). The performance stage is the cause.`
          : `The composed notes keep ${composedOffGrid} of the ${shippedOffGrid} off-grid observations and score ${composedReport.summary.score0to100} themselves. The performance stage is not the cause.`,
      },
      {
        id: "B_quantise_to_the_composer_grid",
        what: "snap the shipped onsets to the composer's bar grid, nothing else changed",
        result: {
          bassOnlyToSixteenths: { bassOffGridObservations: bassQuantisedOffGrid, score: bassQuantised.summary.score0to100 },
          allHarmonyToSixteenths: { score: allSixteenths.summary.score0to100, offGrid: offGrid(allSixteenths).length, harmonyOffGrid: allSixteenths.observations.filter((o) => o.kind === "harmony_off_grid").length },
          allHarmonyToEighths: { score: allEighths.summary.score0to100, offGrid: offGrid(allEighths).length, harmonyOffGrid: allEighths.observations.filter((o) => o.kind === "harmony_off_grid").length },
        },
        moves: bMoves,
        reading: `Quantising the bass ${bMoves ? "removes every" : "does not remove the"} \`off_grid\` observation on the bass and touches nothing else. `
          + `Quantising all the harmony to the kit's eighths lifts the dimension from ${shippedReport.summary.score0to100} to ${allEighths.summary.score0to100}; `
          + `quantising it to sixteenths only reaches ${allSixteenths.summary.score0to100}, because a hit on a sixteenth line can still be half a beat from the drums.`,
      },
    ],
    cause: {
      named: "the composer, through the analysed chord onsets",
      statement: "The harmony writers take the Song Model's analysed chord onsets as the harmonic rhythm (`harmonyPlan/shared.ts chordEventsIn` passes them through unquantised) and the owner's stored chord onsets sit a median of 136 ms from the nearest beat; the kit writer uses the bar grid. The arrangement has two grids, and it has them before the performance stage runs.",
      ruledOut: [
        "the performance engine — control A leaves the finding standing",
        "the critic's tolerance — max(30 ms, 5 % of a beat) is unchanged by this stream; the deviations survive on the composed notes and no tolerance that still rejects `onset_jitter@3` would accept them",
        "the critic being wrong — control B removes the finding exactly where the grid is fixed",
      ],
      whatChangedInTheCritic: "`off_grid` no longer guesses the layer from the size of the deviation. When `CriticInput.composedTrackModels` is present it reads the composed notes and says which layer put the onsets there; when it is not, it attributes to the composer at a lower confidence and names the control in the repair text.",
      attributionAfterTheFix: {
        total: attributed.observations.filter((o) => o.kind === "off_grid").length,
        compose: attributed.observations.filter((o) => o.kind === "off_grid" && o.suspectedOrigin === "compose").length,
        perform: attributed.observations.filter((o) => o.kind === "off_grid" && o.suspectedOrigin === "perform").length,
        note: "the one `perform` is real: the bass in Chorus 2 is on the grid in the composed notes and off it in the shipped ones",
      },
    },
    ownersOutputBefore: offGrid(shippedReport).slice(0, 6).map(compact),
  };
}

// ---------------------------------------------------------------------------
// 3 & 4. The judge and the ranking
// ---------------------------------------------------------------------------

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
  const rankOf = (v: typeof withSalience, predicate: (o: CriticObservation) => boolean) =>
    v.ranked.findIndex((r) => predicate(r.observation)) + 1;
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
