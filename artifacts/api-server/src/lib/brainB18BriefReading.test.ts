/**
 * Brain B-18 — the brief read like a musician (R-1b §7 item 7, P1-2/3/6/7).
 *
 * Four defects the independent musical review measured on the owner's song
 * "רחם נא" (C minor, 130.43 BPM, 92 chords, 9 sections), and what this stream
 * changed on the *plan* side. The writers that realise the plan are B-13's.
 *
 *   P1-2  "soft strings, gentle bass, light percussion" compiled into one
 *         global `energy=low` decision, the grammar turned it into
 *         `arrangement.globalDynamic=low`, and `briefToPlanner` shifted every
 *         section one marking down: template chorus mf → mp, verse p → pp,
 *         Verse 3 to level 0.059. Two words about two instruments quietened a
 *         four-minute song. Now: per-family levels, and a marking for the song
 *         only from a word about the song.
 *   P1-3  The kit played a pop backbeat on 2 and 4 at 130 BPM under an
 *         "intimate ballad", and with no brief the map's tempo band answered
 *         `four_on_floor` — a kick on every beat in all three choruses of a
 *         chassidic ballad. Now: a `pulse` convention on all 14 knowledge
 *         entries, a felt pulse read against the song's measured tempo, a
 *         question when the count falls outside the style's own band whose
 *         answer moves the plan, and no dance grid without evidence for one.
 *   P1-6  Approach tones from `scaleOf(events)` — the union of every pitch
 *         class any chord of the song uses — admitted E natural under Cm and
 *         A natural under Fm in a C minor song. Now: the mode's own scale, per
 *         style, with the major third above a minor tonic excluded.
 *   P1-7  The intro was "no harmony" (two bars of silence) and the song ended
 *         on a staccato piano stab 1.06 s early. Now: an intro figure that
 *         states the tonic, and an ending gesture with a ritardando.
 *
 * Every assertion here is on the plan; note-level realisation is B-13's.
 */
import assert from "node:assert/strict";
import test from "node:test";
import {
  DYNAMIC_MARKINGS, deriveArrangementArc, familyDynamicShape, familyEmphasisIn, familyLevelIn,
  familyMarkingIn, templateForStyle, type ArcHints,
} from "./arrangementArc";
import { deriveGlobalArrangementPlan } from "./globalArrangementPlanner";
import { compileProductionBrief, familyLevelsFromText } from "./producerIntelligence/briefCompiler";
import { briefPlannerHints, resolveBriefStyle } from "./producerIntelligence/briefToPlanner";
import { extractUserIntentSync } from "./producerIntelligence/intentExtraction";
import { resolveStyleProfile } from "./producerIntelligence/styleResolution";
import {
  HARMONY_STYLE_DEFAULTS, aestheticFor, approachToneChoice, approachToneSet, harmonyStyleParams,
  majorThirdOfMinorChord, tonalCentreOf,
} from "./harmonyPlan/styleParams";
import { chordFromEvent } from "./chordSymbols";
import { STYLE_KNOWLEDGE_ENTRIES, feltPulseFor, pulseConventionOf, pulseStrategyFor } from "./styleKnowledge";
import { answerStyleQuestion, inferStyleFromSong, resolveStyle } from "./styleResolver";
import { getStyleValue } from "./styleGrammar";
import { RACHEM_NA_FIXED_NOW as NOW, rachemNaSongModel } from "./__fixtures__/rachemNaSongModelV3";

const OWNER_BRIEF = "intimate ballad; piano, soft strings, gentle bass, light percussion; big final chorus";
const OWNER_BRIEF_WITH_TRADITION = "intimate chassidic ballad; piano, soft strings, gentle bass, light percussion; big final chorus";

function ownerBrief(text: string, model = rachemNaSongModel()) {
  const intent = extractUserIntentSync(text, { now: NOW });
  const profile = resolveStyleProfile(intent, { now: NOW });
  return compileProductionBrief(intent, profile, model, [], { now: NOW });
}

const markingIndex = (m: string): number => DYNAMIC_MARKINGS.indexOf(m as (typeof DYNAMIC_MARKINGS)[number]);

// ---------------------------------------------------------------------------
// D1 — per-family levels
// ---------------------------------------------------------------------------

test("D1: a word in front of an instrument is that instrument's level; a word about the song is the song's", () => {
  const owner = familyLevelsFromText(OWNER_BRIEF);
  assert.deepEqual(
    owner.levels.map((l) => [l.family, l.dynamicSteps, l.emphasis, l.word]),
    [["bass", -1, "support", "gentle"], ["percussion", -1, "support", "light"], ["strings", -1, "support", "soft"]],
  );
  assert.deepEqual(owner.claimedWords.sort(), ["gentle", "light", "soft"]);
  for (const level of owner.levels) {
    assert.equal(level.provenance, "stated");
    assert.ok(level.sourceRefs[0].startsWith("text:"), level.sourceRefs.join(","));
    assert.ok(level.rationale.includes("not for the song"), level.rationale);
  }

  // The same adjectives with no instrument beside them stay the song's.
  assert.deepEqual(familyLevelsFromText("a quiet, understated ballad").levels, []);
  assert.deepEqual(familyLevelsFromText("keep it soft throughout").levels.map((l) => l.family), []);

  // Hebrew reads the same way (the owner writes Hebrew).
  const hebrew = familyLevelsFromText("בלדה חסידית; פסנתר, מיתרים רכים, בס עדין");
  assert.deepEqual(hebrew.levels.map((l) => [l.family, l.dynamicSteps]), [["bass", -1], ["strings", -1]]);

  // A word that features a family moves it the other way.
  assert.deepEqual(
    familyLevelsFromText("big drums, prominent guitar").levels.map((l) => [l.family, l.dynamicSteps, l.emphasis]),
    [["drums", 1, "feature"], ["guitar", 1, "feature"]],
  );

  // Adjacency is what makes a word a family's: an adjective reaches at most one
  // word away, and a word about the world ends its reach.
  assert.deepEqual(familyLevelsFromText("an understated ballad on piano").levels, [],
    "\"understated ballad on piano\" is a sentence about the song, not about the piano");
  assert.deepEqual(familyLevelsFromText("soft strings").levels.map((l) => l.family), ["strings"]);
  assert.deepEqual(familyLevelsFromText("strings soft and warm; big drums").levels.map((l) => [l.family, l.dynamicSteps]),
    [["drums", 1], ["strings", -1]], "the adjective may stand on either side of the noun (Hebrew puts it after)");
});

test("D1: the owner's brief no longer quietens the song — the arc keeps its markings and only the named families move", () => {
  const model = rachemNaSongModel();
  const brief = ownerBrief(OWNER_BRIEF, model);
  assert.deepEqual(
    (brief.familyLevels ?? []).map((l) => l.family),
    ["bass", "percussion", "strings"],
  );
  // The global energy decision is recorded, and it carries no value: the
  // compiler says out loud that the words belong to three families.
  const globalEnergy = brief.producerDecisions.filter((d) => d.scope.kind === "global" && d.topic === "energy");
  assert.equal(globalEnergy.length, 1);
  assert.equal(globalEnergy[0].value, undefined);
  assert.match(globalEnergy[0].statement, /describes bass, percussion, strings, not the song/);
  // And there is a per-track decision the producer can later supersede.
  const perTrack = brief.producerDecisions.filter((d) => d.scope.kind === "track");
  assert.deepEqual(perTrack.map((d) => (d.scope as { instrument: string }).instrument).sort(), ["bass", "percussion", "strings"]);

  const hints = briefPlannerHints(brief, { songModel: model });
  assert.equal(hints.global.globalDynamicSteps, undefined, "R-1b P1-2: no global marking from words about instruments");
  assert.deepEqual(hints.global.familyDynamicSteps, { bass: -1, percussion: -1, strings: -1 });
  assert.deepEqual(hints.global.familyEmphasis, { bass: "support", percussion: "support", strings: "support" });
  const grammar = resolveBriefStyle(brief, { songModel: model }).grammar;
  assert.equal(grammar.arrangement.globalDynamic, undefined);

  const plan = deriveGlobalArrangementPlan(model, { now: NOW, hints: hints.global });
  const arc = plan.arc!;
  const chorus3 = arc.sections.find((s) => s.sectionName === "Chorus 3")!;
  // The deliverable's own measurement: the final chorus is `f` for the piano
  // and `mf` for the strings, and the section itself is still `f`.
  assert.equal(chorus3.intendedDynamic.value.marking, "f");
  assert.equal(familyMarkingIn(chorus3, "keys"), "f", "the piano keeps the arc's marking");
  assert.equal(familyMarkingIn(chorus3, "strings"), "mf", "the strings sit a step below it");
  assert.equal(familyMarkingIn(chorus3, "bass"), "mf");
  assert.equal(familyMarkingIn(chorus3, "percussion"), "mf");
  assert.equal(familyEmphasisIn(chorus3, "strings"), "support");
  assert.equal(familyEmphasisIn(chorus3, "keys"), "neutral", "a family the brief did not name keeps the section's role");
  assert.ok(familyLevelIn(chorus3, "strings") < familyLevelIn(chorus3, "keys"));

  // Every section: the piano is at the arc's marking, the three named families
  // one step under it, and no section was shifted as a whole.
  const bare = deriveGlobalArrangementPlan(model, {
    now: NOW,
    hints: { ...hints.global, familyDynamicSteps: undefined, familyEmphasis: undefined },
  });
  for (const section of arc.sections) {
    const same = bare.arc!.sections.find((s) => s.sectionName === section.sectionName)!;
    assert.equal(section.intendedDynamic.value.marking, same.intendedDynamic.value.marking,
      `${section.sectionName}: the section's own marking is untouched by the family words`);
    assert.equal(familyMarkingIn(section, "keys"), section.intendedDynamic.value.marking);
    for (const family of ["strings", "bass", "percussion"]) {
      if (!section.activeFamilies.includes(family)) continue;
      const own = markingIndex(familyMarkingIn(section, family));
      const own0 = markingIndex(section.intendedDynamic.value.marking);
      assert.ok(own <= own0, `${section.sectionName}/${family}: ${own} vs ${own0}`);
      // pp is the floor of the scale: a family already at pp cannot go under it.
      if (own0 > 0) assert.equal(own, own0 - 1);
    }
  }

  // The section planner's own shape string, per family (the read for B-07).
  assert.equal(familyDynamicShape(chorus3, "keys"), "f");
  assert.equal(familyDynamicShape(chorus3, "strings"), "mf");
  const bridge = arc.sections.find((s) => s.sectionName === "Bridge")!;
  assert.equal(bridge.tensionRole.value, "lift");
  assert.equal(familyDynamicShape(bridge, "strings"), `${familyMarkingIn(bridge, "strings")}->${DYNAMIC_MARKINGS[markingIndex(familyMarkingIn(bridge, "strings")) + 1]}`);
});

test("D1 control: a word about the song still moves the whole song", () => {
  const model = rachemNaSongModel();
  const quiet = ownerBrief("a quiet, understated ballad on piano", model);
  assert.equal(quiet.familyLevels, undefined, "no family word: nothing per family");
  const hints = briefPlannerHints(quiet, { songModel: model });
  assert.equal(hints.global.globalDynamicSteps, -1, "\"quiet\" is about the song");
  assert.equal(hints.global.familyDynamicSteps, undefined);
});

// ---------------------------------------------------------------------------
// D2 — the pulse
// ---------------------------------------------------------------------------

test("D2: all 14 knowledge entries state a pulse convention, and none of them reads a ballad-shaped world as a dance grid", () => {
  assert.equal(STYLE_KNOWLEDGE_ENTRIES.length, 14);
  const seen: string[] = [];
  for (const entry of STYLE_KNOWLEDGE_ENTRIES) {
    const pulse = pulseConventionOf(entry, STYLE_KNOWLEDGE_ENTRIES);
    assert.ok(pulse, `${entry.id} states no pulse convention`);
    assert.ok(pulse!.writtenBpm.min > 0 && pulse!.writtenBpm.max > pulse!.writtenBpm.min, entry.id);
    assert.ok(pulse!.why.trim().length > 30, `${entry.id}: the why must say something`);
    assert.equal(feltPulseFor(pulse!, (pulse!.writtenBpm.min + pulse!.writtenBpm.max) / 2), "as_written", entry.id);
    assert.equal(feltPulseFor(pulse!, pulse!.writtenBpm.max + 1), pulse!.above, entry.id);
    assert.equal(feltPulseFor(pulse!, pulse!.writtenBpm.min - 1), pulse!.below, entry.id);
    assert.equal(feltPulseFor(pulse!, null), null, `${entry.id}: no tempo, no reading`);
    seen.push(entry.id);
  }
  // The deliverable's four worlds never read as four-on-the-floor.
  for (const id of ["ballad", "chassidic_ballad", "singer_songwriter_acoustic", "jazz_standard"]) {
    const entry = STYLE_KNOWLEDGE_ENTRIES.find((e) => e.id === id)!;
    const pulse = pulseConventionOf(entry, STYLE_KNOWLEDGE_ENTRIES)!;
    assert.ok(pulse.never.includes("four_on_floor"), `${id} must forbid four_on_floor (R-1b P1-3)`);
    for (const bpm of [50, 70, 90, 110, 130, 150, 180]) {
      assert.notEqual(pulseStrategyFor(pulse, bpm), "four_on_floor", `${id} at ${bpm} BPM`);
    }
  }
  // Positive control: the style whose pulse *is* the dance grid keeps it.
  const edm = pulseConventionOf(STYLE_KNOWLEDGE_ENTRIES.find((e) => e.id === "edm_dance")!, STYLE_KNOWLEDGE_ENTRIES)!;
  assert.equal(pulseStrategyFor(edm, 128), "four_on_floor");
  assert.deepEqual(seen.length, 14);
});

test("D2: an intimate ballad at 130 BPM is arranged at half time, and the question that says so moves the plan both ways", () => {
  const model = rachemNaSongModel();
  for (const text of [OWNER_BRIEF, OWNER_BRIEF_WITH_TRADITION]) {
    const brief = ownerBrief(text, model);
    const resolution = resolveBriefStyle(brief, { songModel: model });
    assert.equal(getStyleValue(resolution.grammar, "groove.feltPulse")!.value, "half_time", text);
    assert.equal(getStyleValue(resolution.grammar, "groove.pulseStrategy")!.value, "half_time_feel", text);
    assert.deepEqual(getStyleValue(resolution.grammar, "groove.forbiddenStrategies")!.value, text === OWNER_BRIEF
      ? ["four_on_floor", "syncopated"]
      : ["four_on_floor", "syncopated", "swing"]);
    assert.ok(resolution.flags.includes("pulse_inferred"));
    assert.ok(resolution.flags.includes("tempo_mismatch"));

    // The question is still asked: only the producer knows what he feels.
    const question = resolution.questions.find((q) => q.path === "groove.feltPulse")!;
    assert.ok(question, resolution.questions.map((q) => q.path).join(","));
    assert.equal(question.reason, "inferred");
    assert.deepEqual(question.options.map((o) => o.value).sort(), ["as_written", "half_time"]);

    const hints = briefPlannerHints(brief, { songModel: model });
    const plan = deriveGlobalArrangementPlan(model, { now: NOW, hints: hints.global });
    assert.equal(plan.grooveStrategy, "half_time_feel", text);
    assert.equal(plan.styleDecisions?.grooveStrategy, "template");

    // Answering it changes the plan — in both directions.
    const input = { brief, song: { tempoBpm: 130.43 } };
    const asWritten = answerStyleQuestion(input, { path: "groove.feltPulse" }, "as_written");
    const written = deriveGlobalArrangementPlan(model, { now: NOW, hints: { ...hints.global, styleGrammar: asWritten.grammar } });
    assert.equal(written.grooveStrategy, "steady_pulse", `${text}: the producer feels 130`);
    assert.equal(written.styleDecisions?.grooveStrategy, "brief");
    assert.ok(!asWritten.questions.some((q) => q.path === "groove.feltPulse"), "an answered question is not asked again");

    const halved = answerStyleQuestion(input, { path: "groove.feltPulse" }, "half_time");
    const half = deriveGlobalArrangementPlan(model, { now: NOW, hints: { ...hints.global, styleGrammar: halved.grammar } });
    assert.equal(half.grooveStrategy, "half_time_feel");
    assert.equal(half.styleDecisions?.grooveStrategy, "brief");
    assert.notEqual(written.grooveStrategy, half.grooveStrategy, "the answer decides, not the tempo band");
    assert.notEqual(written.inputsDigestSha256, half.inputsDigestSha256);
  }
});

test("D2: with no brief the song's own chords are read, and a dance grid needs evidence", () => {
  const model = rachemNaSongModel();
  const plan = deriveGlobalArrangementPlan(model, { now: NOW });
  assert.equal(plan.style, "unknown", "four chords name no tradition: the identity stays unknown");
  assert.equal(plan.grooveStrategy, "half_time_feel", "R-1b: no brief used to give four_on_floor at 130 BPM");
  assert.equal(plan.styleDecisions?.grooveStrategy, "template");
  assert.match(plan.styleDecisions?.grooveReason ?? "", /harmonic rhythm of a slow sung song/);

  // The inference itself: candidates, confidence, provenance, and `unknown`.
  const owner = inferStyleFromSong({
    symbols: model.chords.map((c) => c.symbol),
    chordsPerBar: 0.65, extensionShare: 0, functionalMotion: 0.4,
    key: "C minor", tempoBpm: 130.43, hasRhythmEvidence: false,
  });
  assert.equal(owner.status, "inferred");
  assert.equal(owner.candidates[0].entryId, "ballad");
  assert.ok(owner.candidates[0].confidence > 0 && owner.candidates[0].confidence <= 1);
  assert.ok(owner.forbidden.includes("four_on_floor"));
  assert.equal(owner.strategy?.value, "half_time_feel");

  // A ii-V vocabulary is not pop (R-1b §7 item 7).
  const jazz = inferStyleFromSong({
    symbols: ["Dm7", "G7", "Cmaj7", "Am7", "D7", "Gmaj7", "Em7", "A7"],
    chordsPerBar: 1, extensionShare: 1, functionalMotion: 0.9,
    key: "C major", tempoBpm: 132, hasRhythmEvidence: true,
  });
  assert.equal(jazz.candidates[0].entryId, "jazz_standard");
  assert.ok(jazz.forbidden.includes("four_on_floor"));

  // `unknown` is a real answer: too few chords, or evidence that says nothing.
  assert.equal(inferStyleFromSong({ symbols: ["C", "F"], chordsPerBar: 1, extensionShare: 0, functionalMotion: 0.5, key: null, tempoBpm: 120, hasRhythmEvidence: true }).status, "unknown");
  const middling = inferStyleFromSong({
    symbols: ["C", "F", "G", "Am", "C", "F"], chordsPerBar: 1.5, extensionShare: 0.1,
    functionalMotion: 0.5, key: "C major", tempoBpm: 120, hasRhythmEvidence: true,
  });
  assert.equal(middling.status, "unknown");
  assert.equal(middling.strategy, null);
  assert.ok(middling.notes[0].includes("no reading this evidence supports"), middling.notes.join(" | "));

  // Positive control: a song where something *does* play a beat keeps the
  // reading its own rhythm evidences — the guard removes a default, not a
  // measurement. The owner's fixture has `rhythm: not_available` and one `mix`
  // stem; nothing in it plays a groove.
  assert.equal(model.musicalMap?.rhythm.status, "not_available");
  assert.deepEqual(model.musicalMap?.styleFingerprint.instrumentPaletteHints, ["mix"]);
});

test("D2: the arc template follows the world the resolver settled on, not only the form word", () => {
  assert.equal(templateForStyle("ballad", null, "chassidic_ballad"), "intimate_ballad");
  assert.equal(templateForStyle("ballad", null, "chassidic_simcha_dance"), "band_steady", "a simcha dance is not a ballad arc");
  assert.equal(templateForStyle("pop", null, "singer_songwriter_acoustic"), "intimate_ballad");
  assert.equal(templateForStyle("pop", null, null), "pop_build", "the plain pop reading is unchanged");
  assert.equal(templateForStyle("rock", null, null), "band_steady");
  assert.equal(templateForStyle("unknown", null, null), "pop_build");
});

// ---------------------------------------------------------------------------
// D3 — approach tones
// ---------------------------------------------------------------------------

test("D3: in a minor key the approach set excludes the major third above the tonic, unless the style says otherwise", () => {
  const model = rachemNaSongModel();
  const chords = model.chords.map((c) => {
    const parsed = chordFromEvent(c);
    return parsed ? { ...parsed, start: c.start, end: c.end } : null;
  }).filter((c): c is NonNullable<typeof c> => !!c);
  const centre = tonalCentreOf(chords);
  assert.equal(centre.tonicPc, 0, "C");
  assert.equal(centre.mode, "minor");

  // The old scale: the union of every chord's pitch classes. It contains E
  // natural (one C major triad among the 92 chords) and A natural (a D major,
  // an F major, a Dm) — which is exactly why the bass played them under Cm and
  // Fm (R-1b P1-6).
  const union = new Set<number>();
  for (const c of chords) for (const pc of c.pitchClasses) union.add(((pc % 12) + 12) % 12);
  assert.ok(union.has(4), "the old union admits E natural in a C minor song");
  assert.ok(union.has(9), "and A natural");

  const ballad = HARMONY_STYLE_DEFAULTS.intimate_ballad;
  const allowed = approachToneSet(ballad.approachTones, centre)!;
  assert.ok(!allowed.has(4), "E natural is not an approach tone in C minor");
  assert.ok(!allowed.has(9), "nor A natural");
  assert.ok(allowed.has(11), "the raised seventh is: it is the leading tone");
  assert.deepEqual([...allowed].sort((a, b) => a - b), [0, 2, 3, 5, 7, 8, 10, 11]);

  // The note the review heard: E natural leading into F (the root of Fm).
  const avoid = new Set([0, 3, 7]); // the Cm being left
  assert.equal(
    approachToneChoice({ admissible: [64, 67, 62], target: 65, avoidPcs: avoid, style: ballad, centre }),
    62, "E natural (64) is refused for being outside the mode, G (67) for being a tone of the Cm being left; D (62) is taken",
  );
  // With only wrong notes on offer a diatonic style writes no approach at all.
  assert.equal(
    approachToneChoice({ admissible: [64, 66], target: 65, avoidPcs: avoid, style: ballad, centre }),
    null, "a plainer bass line beats a wrong note",
  );
  // The style that says otherwise: blues / jazz keep the chromatic idiom.
  assert.equal(
    approachToneChoice({ admissible: [64, 66], target: 65, avoidPcs: avoid, style: HARMONY_STYLE_DEFAULTS.jazz, centre }),
    64, "chromatic approach is the jazz idiom",
  );
  assert.equal(approachToneSet(HARMONY_STYLE_DEFAULTS.jazz.approachTones, centre), null);

  // Major keys are restricted the same way, by their own mode.
  const fMajor = { tonicPc: 5, mode: "major" as const };
  const inFMajor = approachToneSet(ballad.approachTones, fMajor)!;
  assert.ok(!inFMajor.has(8), "Ab is not an approach tone in F major (R-1b: 'Ab under Dm')");
  assert.ok(!inFMajor.has(11), "nor B natural (R-1b: 'B natural under Bb')");
  assert.ok(inFMajor.has(10) && inFMajor.has(9), "Bb and A are");

  // Unknown mode: nothing is claimed, and the planner's own order stands.
  assert.equal(approachToneSet(ballad.approachTones, { tonicPc: null, mode: "unknown" }), null);
});

test("D3: no style approaches a minor chord through its own major third — not even a chromatic one", () => {
  // The one refusal that does not consult the style's vocabulary. R-1b P1-6
  // describes the note by the chord it *sounds over* ("E natural under Cm",
  // "A natural under Fm"), and B-05c's harmony critic reads it the same way
  // and grades it `major` whatever the style. Found on the corpus: after B-18's
  // no-brief groove reading moved jazz-full's bass, it wrote an E natural over
  // a Cm7 as a chromatic approach into the next chord's F — idiomatic by the
  // offset, a semitone from the Eb the keys hold for the whole beat it sounds.
  const cm7 = { root: 0, pitchClasses: [0, 3, 7, 10] };
  const bb = { root: 10, pitchClasses: [10, 2, 5] };
  const major = { tonicPc: 5, mode: "major" as const };
  for (const [name, style] of Object.entries(HARMONY_STYLE_DEFAULTS)) {
    // 64 = E natural: the major third of the Cm7 it sounds over, a semitone
    // under the F (65) it leads to.
    assert.notEqual(
      approachToneChoice({ admissible: [64, 63], target: 65, avoidPcs: new Set(cm7.pitchClasses), style, centre: major, sourceChord: cm7, targetChord: bb }),
      64, `${name}: the major third of a minor chord is never an approach note`,
    );
    // The same rule on the chord being approached.
    assert.notEqual(
      approachToneChoice({ admissible: [64, 62], target: 63, avoidPcs: new Set(bb.pitchClasses), style, centre: major, sourceChord: bb, targetChord: cm7 }),
      64, `${name}: nor of the minor chord it leads to`,
    );
  }
  // A *major* chord's third is untouched: this is not a ban on thirds.
  const c = { root: 0, pitchClasses: [0, 4, 7] };
  assert.equal(majorThirdOfMinorChord(c), null);
  assert.equal(majorThirdOfMinorChord(cm7), 4);
  assert.equal(majorThirdOfMinorChord(null), null);
  assert.equal(
    approachToneChoice({ admissible: [64, 66], target: 65, avoidPcs: new Set([10, 2, 5]), style: HARMONY_STYLE_DEFAULTS.jazz, centre: major, sourceChord: c, targetChord: c }),
    64, "over a C major chord, E is a chord tone of the world and the chromatic style may still use it",
  );
});

test("D3: chassidic and liturgical styles prefer the leading tone and the lower neighbour", () => {
  assert.equal(aestheticFor({ productionAesthetic: "intimate", tradition: "hasidic" }), "chassidic");
  assert.equal(aestheticFor({ productionAesthetic: "intimate", tradition: "chassidic_ballad" }), "chassidic");
  assert.equal(aestheticFor({ style: "cantorial" }), "chassidic");
  assert.equal(aestheticFor({ productionAesthetic: "intimate" }), "intimate_ballad", "no world named: the generic ballad");
  assert.deepEqual(HARMONY_STYLE_DEFAULTS.chassidic.approachTones.preferredOffsets, [-1, -2, 1, 2]);
  assert.deepEqual(HARMONY_STYLE_DEFAULTS.classical.approachTones.preferredOffsets, [-1, -2, 1, 2]);

  const centre = { tonicPc: 0, mode: "minor" as const };
  const avoid = new Set([5, 8, 0]); // an Fm being left
  // Both the leading tone (B, 71) and the lower neighbour (Bb, 70) are in the
  // mode; the leading tone is taken even though the caller offered the upper
  // neighbour first.
  assert.equal(
    approachToneChoice({ admissible: [74, 70, 71], target: 72, avoidPcs: avoid, style: HARMONY_STYLE_DEFAULTS.chassidic, centre }),
    71, "V-i with the raised seventh: the line arrives from underneath",
  );
  // The generic ballad states no preference: the planner's own order stands.
  assert.equal(
    approachToneChoice({ admissible: [74, 70, 71], target: 72, avoidPcs: avoid, style: HARMONY_STYLE_DEFAULTS.intimate_ballad, centre }),
    74,
  );

  // A grammar that names a harmonic-minor / freygish world brings the
  // leading-tone vocabulary with it.
  const model = rachemNaSongModel();
  const grammar = resolveBriefStyle(ownerBrief(OWNER_BRIEF_WITH_TRADITION, model), { songModel: model }).grammar;
  assert.equal(grammar.harmony.modalFlavour?.value, "harmonic_minor");
  const params = harmonyStyleParams({ productionAesthetic: "intimate", style: "ballad", grammar });
  assert.equal(params.aesthetic, "chassidic");
  assert.deepEqual(params.approachTones.preferredOffsets, [-1, -2, 1, 2]);
  assert.ok(params.source.some((s) => s.startsWith("grammar:identity=")), params.source.join(","));
  // Without the grammar the generic ballad set is what a caller gets, and it
  // is still mode-restricted.
  const plain = harmonyStyleParams({ productionAesthetic: "intimate", style: "ballad" });
  assert.equal(plain.aesthetic, "intimate_ballad");
  assert.equal(plain.approachTones.modeOnly, true);
});

test("D3: every aesthetic's vocabulary agrees with its own chromaticApproach flag", () => {
  for (const [name, params] of Object.entries(HARMONY_STYLE_DEFAULTS)) {
    assert.equal(params.approachTones.modeOnly, !params.chromaticApproach, `${name}: mode restriction and chromaticApproach must agree`);
    assert.equal(params.approachTones.allowOutOfMode, params.chromaticApproach, name);
    assert.ok(params.approachTones.why.trim().length > 20, name);
    if (params.approachTones.modeOnly) {
      assert.ok(params.approachTones.forbiddenDegreesMinor.includes(4), `${name}: the major third above a minor tonic is never an approach tone`);
    }
  }
});

// ---------------------------------------------------------------------------
// D4 — intro and ending
// ---------------------------------------------------------------------------

test("D4: the owner's two-bar intro implies the tonic, and the song ends on a held chord with a ritardando", () => {
  const model = rachemNaSongModel();
  const brief = ownerBrief(OWNER_BRIEF_WITH_TRADITION, model);
  const hints = briefPlannerHints(brief, { songModel: model });
  assert.equal(hints.global.introFigure, "piano_motif", "the chassidic ballad opens with the tune's first phrase");
  assert.equal(hints.global.endingGesture, "held_final_chord");

  const arc = deriveGlobalArrangementPlan(model, { now: NOW, hints: hints.global }).arc!;
  const opening = arc.opening!;
  assert.equal(opening.value.sectionName, "Intro");
  assert.equal(opening.value.barCount, 2);
  assert.equal(opening.value.figure, "piano_motif");
  assert.equal(opening.value.impliesTonic, true, "R-1b P1-7: bars 1-2 are not 'no harmony', they are the tonic");
  assert.ok(opening.value.families.includes("keys"));
  assert.match(opening.reason, /implies the tonic/);

  const ending = arc.ending!;
  assert.equal(ending.value.sectionName, "Outro");
  assert.equal(ending.value.gesture, "held_final_chord");
  assert.equal(ending.value.ritardando, true);
  assert.equal(ending.value.bars, 2);
  assert.ok(ending.value.families.length > 0);
});

test("D4: every arc template and every knowledge entry states how it opens and closes", () => {
  for (const entry of STYLE_KNOWLEDGE_ENTRIES) {
    const resolution = resolveStyle({
      styleText: entry.id.replace(/_/g, " "),
      knowledge: [entry, ...STYLE_KNOWLEDGE_ENTRIES.filter((e) => e.id === entry.extends)],
      song: { tempoBpm: 100 },
    });
    void resolution;
  }
  // Read the defaults off the entries directly: every one names both.
  for (const entry of STYLE_KNOWLEDGE_ENTRIES) {
    const block = entry.levels.orchestration;
    assert.notEqual(block, "unknown", entry.id);
    const orchestration = block as Record<string, { value: unknown } | undefined>;
    assert.ok(orchestration["arrangement.introFigure"], `${entry.id}: no intro figure`);
    assert.ok(orchestration["arrangement.endingGesture"], `${entry.id}: no ending gesture`);
  }

  // The templates carry their own defaults for a plan with no knowledge entry.
  const sections = [
    { name: "Intro", startBar: 1, endBar: 4, function: "intro" as const },
    { name: "Verse", startBar: 5, endBar: 20, function: "verse" as const },
    { name: "Chorus", startBar: 21, endBar: 36, function: "chorus" as const },
    { name: "Outro", startBar: 37, endBar: 44, function: "outro" as const },
  ];
  const base = { sections, paletteFamilies: ["keys", "bass", "drums"], vocalStatus: "not_available" as const };
  const rock = deriveArrangementArc({ ...base, style: "rock" }, { now: NOW });
  assert.equal(rock.opening!.value.figure, "pickup_only", "a band counts in");
  assert.equal(rock.ending!.value.gesture, "stop");
  assert.equal(rock.ending!.value.ritardando, false);
  const dance = deriveArrangementArc({ ...base, style: "dance" }, { now: NOW });
  assert.equal(dance.ending!.value.gesture, "fade");
  const ballad = deriveArrangementArc({ ...base, style: "ballad" }, { now: NOW });
  assert.equal(ballad.opening!.value.figure, "piano_motif");
  assert.equal(ballad.ending!.value.ritardando, true);

  // The brief overrides the template, and says so.
  const stated: ArcHints = { introFigure: "tonic_pad", endingGesture: "fade" };
  const overridden = deriveArrangementArc({ ...base, style: "ballad", hints: stated }, { now: NOW });
  assert.equal(overridden.opening!.value.figure, "tonic_pad");
  assert.equal(overridden.opening!.source, "brief");
  assert.equal(overridden.ending!.value.gesture, "fade");
  assert.equal(overridden.ending!.source, "brief");
  assert.equal(overridden.ending!.value.ritardando, false, "a fade does not slow down");

  // A form with no intro says so rather than inventing one.
  const noIntro = deriveArrangementArc({ ...base, sections: sections.slice(1), style: "ballad" }, { now: NOW });
  assert.equal(noIntro.opening!.value.figure, "none");
  assert.equal(noIntro.opening!.value.impliesTonic, false);
  assert.match(noIntro.opening!.reason, /no intro/);

  // A one-bar intro is a pickup, whatever the style plays over four bars.
  const pickup = deriveArrangementArc({
    ...base,
    sections: [{ name: "Intro", startBar: 1, endBar: 1, function: "intro" as const }, ...sections.slice(1)],
    style: "ballad",
  }, { now: NOW });
  assert.equal(pickup.opening!.value.figure, "pickup_only");
});

// ---------------------------------------------------------------------------
// Determinism and staleness
// ---------------------------------------------------------------------------

test("the whole reading is deterministic: the same brief gives the same levels, pulse, approach set and plan", () => {
  const model = rachemNaSongModel();
  const a = briefPlannerHints(ownerBrief(OWNER_BRIEF, model), { songModel: model });
  const b = briefPlannerHints(ownerBrief(OWNER_BRIEF, model), { songModel: model });
  assert.deepEqual(a.global, b.global);
  assert.deepEqual(a.style?.inputsDigestSha256, b.style?.inputsDigestSha256);
  const planA = deriveGlobalArrangementPlan(model, { now: NOW, hints: a.global });
  const planB = deriveGlobalArrangementPlan(model, { now: NOW, hints: b.global });
  assert.equal(planA.inputsDigestSha256, planB.inputsDigestSha256);
  assert.deepEqual(planA.arc!.sections.map((s) => s.familyDynamics), planB.arc!.sections.map((s) => s.familyDynamics));
  // The family levers are part of the arc's identity: a different level is a
  // different arc, so a stored plan cannot silently keep the old reading.
  const other = deriveGlobalArrangementPlan(model, {
    now: NOW,
    hints: { ...a.global, familyDynamicSteps: { ...a.global.familyDynamicSteps, strings: -2 } },
  });
  assert.notEqual(other.arc!.inputsDigestSha256, planA.arc!.inputsDigestSha256);
});
