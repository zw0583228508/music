/**
 * Brain B-18 evidence generator — the brief read like a musician.
 *
 * Writes `docs/evidence/brain-b18-brief-reading.json`: the owner's brief
 * resolved before and after (per-family levels, felt pulse, approach set,
 * intro / ending intent, questions asked), the pulse defaults of all 14
 * knowledge entries at the owner's measured tempo, and the arc / section-plan
 * diff for the owner's song.
 *
 * "Before" is not a re-implementation of the old code: it is the *measured*
 * behaviour R-1b recorded on `origin/main` (quoted with its section), plus the
 * one lever that can still be reproduced exactly — the arc planned with
 * `globalDynamicSteps: -1` and no family levels, which is what the old
 * `briefToPlanner` emitted for this brief.
 *
 * Run: node --loader ... or through the esbuild harness; deterministic.
 */
import { deriveGlobalArrangementPlan } from "./globalArrangementPlanner";
import { deriveSectionPhrasePlan } from "./sectionPhrasePlanner";
import { familyMarkingIn } from "./arrangementArc";
import { chordFromEvent } from "./chordSymbols";
import { HARMONY_STYLE_DEFAULTS, approachToneSet, tonalCentreOf } from "./harmonyPlan/styleParams";
import { compileProductionBrief } from "./producerIntelligence/briefCompiler";
import { briefPlannerHints, resolveBriefStyle } from "./producerIntelligence/briefToPlanner";
import { extractUserIntentSync } from "./producerIntelligence/intentExtraction";
import { resolveStyleProfile } from "./producerIntelligence/styleResolution";
import { STYLE_KNOWLEDGE_ENTRIES, feltPulseFor, pulseConventionOf, pulseStrategyFor } from "./styleKnowledge";
import { getStyleValue } from "./styleGrammar";
import { inferStyleFromSong } from "./styleResolver";
import { RACHEM_NA_FIXED_NOW as NOW, rachemNaSongModel } from "./__fixtures__/rachemNaSongModelV3";

export const OWNER_BRIEF = "intimate ballad; piano, soft strings, gentle bass, light percussion; big final chorus";
export const OWNER_BRIEF_WITH_TRADITION = "intimate chassidic ballad; piano, soft strings, gentle bass, light percussion; big final chorus";

function briefFor(text: string, model = rachemNaSongModel()) {
  const intent = extractUserIntentSync(text, { now: NOW });
  const profile = resolveStyleProfile(intent, { now: NOW });
  return compileProductionBrief(intent, profile, model, [], { now: NOW });
}

const FAMILIES = ["keys", "strings", "bass", "percussion"];

export function brainB18Evidence(): Record<string, unknown> {
  const model = rachemNaSongModel();
  const tempoBpm = model.tempoMap[0].bpm;

  // --- the owner's brief, after -------------------------------------------
  const brief = briefFor(OWNER_BRIEF, model);
  const withTradition = briefFor(OWNER_BRIEF_WITH_TRADITION, model);
  const resolution = resolveBriefStyle(brief, { songModel: model });
  const resolutionNamed = resolveBriefStyle(withTradition, { songModel: model });
  const hints = briefPlannerHints(brief, { songModel: model });
  const planAfter = deriveGlobalArrangementPlan(model, { now: NOW, hints: hints.global });
  const sectionAfter = deriveSectionPhrasePlan(model, planAfter, { now: NOW });

  // --- the same brief as the old compiler read it --------------------------
  // R-1b P1-2 / B-09's own evidence: `globalDynamicSteps: -1`, no family
  // levels. Everything else about the hints is unchanged, so planning with
  // exactly that lever reproduces the arc the review measured.
  const beforeHints = {
    ...hints.global,
    familyDynamicSteps: undefined,
    familyEmphasis: undefined,
    introFigure: undefined,
    endingGesture: undefined,
    globalDynamicSteps: -1,
    styleGrammar: undefined,
    grooveStrategy: "steady_pulse" as const,
  };
  const planBefore = deriveGlobalArrangementPlan(model, { now: NOW, hints: beforeHints });
  const sectionBefore = deriveSectionPhrasePlan(model, planBefore, { now: NOW });

  const sectionRow = (name: string) => {
    const before = planBefore.arc!.sections.find((s) => s.sectionName === name)!;
    const after = planAfter.arc!.sections.find((s) => s.sectionName === name)!;
    return {
      section: name,
      before: {
        marking: before.intendedDynamic.value.marking,
        level: before.intendedDynamic.value.level,
        everyFamily: before.intendedDynamic.value.marking,
        reason: before.intendedDynamic.reason,
      },
      after: {
        marking: after.intendedDynamic.value.marking,
        level: after.intendedDynamic.value.level,
        perFamily: Object.fromEntries(FAMILIES
          .filter((f) => after.activeFamilies.includes(f))
          .map((f) => [f, familyMarkingIn(after, f)])),
        reason: after.intendedDynamic.reason,
      },
    };
  };

  // --- the approach set ----------------------------------------------------
  const chords = model.chords
    .map((c) => { const parsed = chordFromEvent(c); return parsed ? { ...parsed, start: c.start, end: c.end } : null; })
    .filter((c): c is NonNullable<typeof c> => !!c);
  const centre = tonalCentreOf(chords);
  const union = [...new Set(chords.flatMap((c) => c.pitchClasses.map((p) => ((p % 12) + 12) % 12)))].sort((a, b) => a - b);
  const NAMES = ["C", "C#", "D", "Eb", "E", "F", "F#", "G", "Ab", "A", "Bb", "B"];
  const allowedBallad = approachToneSet(HARMONY_STYLE_DEFAULTS.intimate_ballad.approachTones, centre)!;
  const allowedChassidic = approachToneSet(HARMONY_STYLE_DEFAULTS.chassidic.approachTones, centre)!;

  // --- the 14 entries' pulse defaults --------------------------------------
  const pulses = STYLE_KNOWLEDGE_ENTRIES.map((entry) => {
    const pulse = pulseConventionOf(entry, STYLE_KNOWLEDGE_ENTRIES)!;
    return {
      entry: entry.id,
      writtenBpm: pulse.writtenBpm,
      above: pulse.above,
      below: pulse.below,
      strategy: pulse.strategy,
      halfTimeStrategy: pulse.halfTimeStrategy ?? null,
      never: pulse.never,
      confidence: pulse.confidence,
      why: pulse.why,
      atOwnerTempo: {
        bpm: tempoBpm,
        feltPulse: feltPulseFor(pulse, tempoBpm),
        strategy: pulseStrategyFor(pulse, tempoBpm),
      },
      introFigure: (entry.levels.orchestration as Record<string, { value: unknown } | undefined>)["arrangement.introFigure"]?.value ?? null,
      endingGesture: (entry.levels.orchestration as Record<string, { value: unknown } | undefined>)["arrangement.endingGesture"]?.value ?? null,
    };
  });

  // --- the no-brief reading -------------------------------------------------
  const noBrief = deriveGlobalArrangementPlan(model, { now: NOW });
  const inference = inferStyleFromSong({
    symbols: model.chords.map((c) => c.symbol),
    chordsPerBar: model.chords.length / Math.max(...model.sections.map((s) => s.endBar)),
    extensionShare: 0,
    functionalMotion: null,
    key: model.keyMap?.[0]?.key ?? null,
    tempoBpm,
    hasRhythmEvidence: false,
  });

  return {
    stream: "B-18",
    title: "the brief read like a musician",
    review: "docs/brain/reviews/2026-09-10-r1b-musical-attack.md (P1-2, P1-3, P1-6, P1-7, §7 item 7)",
    song: {
      name: "רחם נא (Song Model v3 fixture)",
      key: model.keyMap?.[0]?.key ?? null,
      tempoBpm,
      chords: model.chords.length,
      sections: model.sections.map((s) => `${s.name} ${s.startBar}-${s.endBar}`),
      rhythmStatus: model.musicalMap?.rhythm.status ?? null,
      paletteHints: model.musicalMap?.styleFingerprint.instrumentPaletteHints ?? [],
    },
    brief: { text: OWNER_BRIEF, withTradition: OWNER_BRIEF_WITH_TRADITION },

    d1_perFamilyLevels: {
      claim: "\"soft strings, gentle bass, light percussion\" are three family levels, never a marking for the song (R-1b P1-2)",
      before: {
        measured: "R-1b P1-2 / B-09 evidence: globalDynamicSteps -1 -> arrangement.globalDynamic=low; template chorus mf -> mp, verse p -> pp, Verse 3 to level 0.059",
        globalDynamicSteps: -1,
        familyLevels: null,
      },
      after: {
        globalDynamicSteps: hints.global.globalDynamicSteps ?? null,
        familyLevels: brief.familyLevels ?? [],
        familyDynamicSteps: hints.global.familyDynamicSteps ?? null,
        familyEmphasis: hints.global.familyEmphasis ?? null,
        grammarGlobalDynamic: resolution.grammar.arrangement.globalDynamic ?? null,
        evidence: hints.evidence.filter((e) => /marking for|R-1b P1-2/.test(e)),
      },
      controls: {
        "a word about the song still moves the song": {
          brief: "a quiet, understated ballad on piano",
          globalDynamicSteps: briefPlannerHints(briefFor("a quiet, understated ballad on piano", model), { songModel: model }).global.globalDynamicSteps ?? null,
          familyLevels: briefFor("a quiet, understated ballad on piano", model).familyLevels ?? [],
        },
        "a word that features a family moves it up": briefFor("big drums, prominent guitar; a ballad", model).familyLevels ?? [],
      },
      arcDiff: model.sections.map((s) => sectionRow(s.name)),
      sectionPlanDiff: {
        note: "the section planner still writes one dynamicShape per section (B-07 owns that file). The per-family shape is `arrangementArc.familyDynamicShape(arcSection, family)`; the read B-07 must add is listed in the PR body.",
        before: sectionBefore.roleAssignments
          .filter((r) => r.sectionName === "Chorus 3")
          .map((r) => ({ instrument: r.instrument, dynamicShape: r.dynamicShape })),
        after: sectionAfter.roleAssignments
          .filter((r) => r.sectionName === "Chorus 3")
          .map((r) => ({ instrument: r.instrument, dynamicShape: r.dynamicShape, perFamilyPlanned: familyMarkingIn(planAfter.arc!.sections.find((s) => s.sectionName === "Chorus 3")!, r.instrument) })),
      },
    },

    d2_pulse: {
      claim: "an intimate ballad at 130 BPM is felt at 65; four_on_floor is never the reading for a ballad / chassidic / singer-songwriter / jazz-standard world; with no brief the song's own chords are read (R-1b P1-3, §7 item 7)",
      before: {
        withBrief: "grooveStrategy steady_pulse -> the kit plays a backbeat on 2 and 4 at 130 BPM (R-1b §1)",
        withoutBrief: "grooveStrategy four_on_floor from the map's tempo band -> a kick on every beat in all three choruses (R-1b §1, P1-3)",
      },
      after: {
        withBrief: {
          feltPulse: getStyleValue(resolution.grammar, "groove.feltPulse"),
          pulseStrategy: getStyleValue(resolution.grammar, "groove.pulseStrategy"),
          forbidden: getStyleValue(resolution.grammar, "groove.forbiddenStrategies")?.value ?? null,
          grooveStrategy: planAfter.grooveStrategy,
          styleDecisions: planAfter.styleDecisions,
          knowledgeEntry: resolution.knowledge.entry,
        },
        withBriefAndTradition: {
          knowledgeEntry: resolutionNamed.knowledge.entry,
          feltPulse: getStyleValue(resolutionNamed.grammar, "groove.feltPulse"),
          pulseStrategy: getStyleValue(resolutionNamed.grammar, "groove.pulseStrategy"),
          forbidden: getStyleValue(resolutionNamed.grammar, "groove.forbiddenStrategies")?.value ?? null,
        },
        withoutBrief: {
          style: noBrief.style,
          grooveStrategy: noBrief.grooveStrategy,
          styleDecisions: noBrief.styleDecisions,
          inference: {
            status: inference.status,
            candidates: inference.candidates,
            strategy: inference.strategy,
            forbidden: inference.forbidden,
            notes: inference.notes,
          },
        },
      },
      questions: {
        verbatim: resolution.questions.map((q) => ({ path: q.path, reason: q.reason, gain: q.informationGain, options: q.options.map((o) => o.value) })),
        withTradition: resolutionNamed.questions.map((q) => ({ path: q.path, reason: q.reason, gain: q.informationGain, options: q.options.map((o) => o.value) })),
        answered: {
          note: "answering the felt-pulse question moves the plan in both directions; the assertions are in brainB18BriefReading.test.ts",
          as_written: "grooveStrategy steady_pulse (styleDecisions.grooveStrategy = brief)",
          half_time: "grooveStrategy half_time_feel (styleDecisions.grooveStrategy = brief)",
        },
      },
      knowledgeEntries: pulses,
    },

    d3_approachTones: {
      claim: "in a minor key the approach set excludes the major third above the root unless the style says otherwise; leading tones and lower neighbours are preferred for chassidic / liturgical entries (R-1b P1-6)",
      tonalCentre: { tonicPc: centre.tonicPc, tonic: centre.tonicPc === null ? null : NAMES[centre.tonicPc], mode: centre.mode, why: centre.why },
      before: {
        rule: "!previousChordPcs.has(pc) && (chromaticApproach || scale.has(pc) || Math.abs(p - target) === 2), then a fallback to any non-chord tone",
        scaleWas: "the union of every pitch class any chord of the song uses",
        unionPitchClasses: union.map((p) => NAMES[p]),
        admittedInCMinor: ["E (the major third above the tonic; one C major triad in 92 chords puts it in the union)", "A (from a D major, an F major and a Dm)"],
        measured: "R-1b P1-6: E natural under Cm (b115.2), A natural under Fm (b117.3), G natural under Ab (b120.2); ballad case: Ab under Dm, B natural under Bb",
      },
      after: {
        intimate_ballad: {
          preferredOffsets: HARMONY_STYLE_DEFAULTS.intimate_ballad.approachTones.preferredOffsets,
          admissiblePitchClasses: [...allowedBallad].sort((a, b) => a - b).map((p) => NAMES[p]),
          excluded: [4, 9].map((p) => NAMES[p]),
          why: HARMONY_STYLE_DEFAULTS.intimate_ballad.approachTones.why,
        },
        chassidic: {
          preferredOffsets: HARMONY_STYLE_DEFAULTS.chassidic.approachTones.preferredOffsets,
          admissiblePitchClasses: [...allowedChassidic].sort((a, b) => a - b).map((p) => NAMES[p]),
          why: HARMONY_STYLE_DEFAULTS.chassidic.approachTones.why,
        },
        jazz: {
          modeOnly: HARMONY_STYLE_DEFAULTS.jazz.approachTones.modeOnly,
          why: HARMONY_STYLE_DEFAULTS.jazz.approachTones.why,
        },
        goldenImpact: "ballad-piano-vocal, ethnic-vocal and cinematic-midi composer digests moved with identical note counts; acoustic-demo's shipped notes moved; the four chromatic-style cases are byte-identical (see reference-part-composer.golden.json recordedAt)",
      },
      plannerRead: {
        file: "artifacts/api-server/src/lib/harmonyPlan/bassLine.ts",
        lines: [
          "import { approachToneChoice, tonalCentreOf, type HarmonyStyleParams } from \"./styleParams\";",
          "const choice = approachToneChoice({ admissible, target, avoidPcs: previousChordPcs, style: input.style, centre: tonalCentreOf(...) });",
          "the now-dead `const scale = scaleOf(...)` local and `scaleOf` from the shared import were removed",
        ],
      },
    },

    d4_introAndEnding: {
      claim: "the arc states an intro figure and an ending; the owner's 2-bar intro implies the tonic rather than 'no harmony' (R-1b P1-7)",
      before: "Intro bars 1-2: no chord under them -> three dropped_part warnings and two bars of silence; Outro: the last piano stab ends 1.06 s before the song end, no held chord, no ritardando (ending_missing major)",
      after: {
        verbatim: { opening: planAfter.arc!.opening, ending: planAfter.arc!.ending },
        withTradition: (() => {
          const h = briefPlannerHints(withTradition, { songModel: model });
          const p = deriveGlobalArrangementPlan(model, { now: NOW, hints: h.global });
          return { introFigure: h.global.introFigure ?? null, endingGesture: h.global.endingGesture ?? null, opening: p.arc!.opening, ending: p.arc!.ending };
        })(),
      },
      writerReads: "listed in the PR body for B-13",
    },

    honestLimits: [
      "The plan side only. No writer realises the intro figure, the ending gesture, the per-family level or the approach preference at note level yet; the reads B-13 and B-07 must add are listed in the PR body. Until they do, the owner's shipped notes change only where the bass planner already read HarmonyStyleParams (D3).",
      "`sectionPhrasePlanner.dynamicShapeFor` still writes one dynamicShape per section, so the per-family marking reaches the section plan only through `arrangementArc.familyDynamicShape` — which nothing calls yet. D1 is proven at the arc, not at the role assignment.",
      "The family-word reader is adjacency-based on the producer's own text: an adjective reaches at most one word past the instrument, and a word about the world ends its reach. \"Make the strings, which enter in the chorus, soft\" is not read; it stays a global word.",
      "`applyConstraint` (\"not too busy\", \"less drums\") is untouched: a *constraint* about a family is still compiled as a section-scoped density nudge, not as a family level.",
      "The forbidden degrees are excluded whatever the target chord is. A minor-key song that genuinely borrows a major-III chord loses the major third as an approach tone into it; no case in the corpus does this, and no test covers it.",
      "`tonalCentreOf` reads one tonal centre for the whole part window. A song that modulates is read in its opening key; the fixture does not modulate (keyChanges 0).",
      "The pulse conventions are the B-18 specialist's generalisations about each style, not measurements of a corpus — the same standing as every other knowledge-base value. Their bands are round numbers a musician would defend, and each carries its why.",
      "`inferStyleFromSong` claims a *form*, never a tradition: a triadic minor song with a slow harmonic rhythm and no rhythm section reads as ballad-shaped, and which world it belongs to stays a question. It returns `unknown` whenever the evidence supports no reading.",
      "The no-brief reading replaces a bad default only: it is consulted when the map's answer is a reading the style forbids or a dance grid nothing evidenced. A defensible measurement is never overwritten (the eight corpus cases with a detected rhythm section keep their readings; only jazz-full changed, and only because its ii-V vocabulary forbids four_on_floor).",
      "`groove.pulseStrategy` outranks `groove.family` in `grooveFromGrammar`. A knowledge entry whose pulse strategy and groove family disagree would now be read by the strategy; every shipped entry's pair agrees, and no test enforces the invariant across future entries.",
    ],
  };
}

async function main(): Promise<void> {
  process.stdout.write(JSON.stringify(brainB18Evidence(), null, 2));
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
