import assert from "node:assert/strict";
import test from "node:test";
import type { StyleFingerprint } from "@workspace/db";
import {
  FIELD_REGISTRY,
  SEED_REASONING_PROVIDER,
  applyClarificationAnswer,
  arrangementInstructions,
  clarificationQuestions,
  decomposeStyle,
  decomposeStyleDeterministic,
  listFields,
  mergeClaim,
  parseStyleDescription,
  reconcileWithFingerprint,
  resolutionShare,
  styleGrammarFromUniversalStyle,
  synthesiseEvidence,
  universalStyleGrammarSlot,
  validateSeed,
  type StyleClaim,
  type StyleReasoningProvider,
  type UniversalStyle,
} from "./universalStyle";
import { STYLE_CORPUS } from "./universalStyleCorpus";
import { INSTRUMENTS, PITCH_SYSTEMS, gmFamilyOfProgram } from "./universalStyleLexicon";

const NOW = new Date("2026-09-09T00:00:00.000Z");

function fingerprint(over: Partial<StyleFingerprint> = {}): StyleFingerprint {
  return {
    version: "1.0", method: "test", derivedAt: NOW.toISOString(), inputsDigestSha256: "0".repeat(64),
    source: { kind: "song_model", id: "song", version: 1 }, contentFree: true,
    tempo: { bpm: 100, stability: 0.9, meter: "4/4", behavior: "moderate" },
    groove: { swingRatio: 0.5, microtimingMs: 0, microtiming: "quantized", syncopation: 0.2, subdivisions: { quarter: 0.4, eighth: 0.4, sixteenth: 0.1, triplet: 0, other: 0.1 }, onsetDensity: 2 },
    harmony: { chordsPerBar: 1, harmonicRhythm: "moderate", extensionShare: 0.15, chordExtensions: "sevenths", keyChanges: 0, functionalMotion: 0.35 },
    melodicShape: { rangeSemitones: 12, stepwiseRatio: 0.65, leapRatio: 0.35, meanIntervalSemitones: 2.2, phraseLengthBeats: 16, phraseLength: "regular", ornamentDensity: 0.05, ornamentation: "light" },
    register: { low: 0.3, mid: 0.5, high: 0.2, tendency: "mid" },
    dynamics: { velocityP10: 60, velocityP90: 90, rangeClass: "moderate" },
    energyArc: [0.5, 0.5, 0.5, 0.5, 0.5, 0.5, 0.5, 0.5],
    density: { notesPerBarMean: 8, notesPerBarP10: 6, notesPerBarP90: 10, arcShape: "flat" },
    instrumentation: { hierarchy: ["keys", "bass", "drums"], familyShare: { keys: 0.5, bass: 0.25, drums: 0.25 }, trackCount: 3 },
    sectionCount: 4, durationSeconds: 180,
    ...over,
  };
}

// ---------------------------------------------------------------------------
// schema
// ---------------------------------------------------------------------------

test("the registry covers every leaf field, every field starts unknown, and no field can hold a note sequence", () => {
  const { style } = parseStyleDescription("", { now: NOW });
  const fields = listFields(style);
  assert.equal(fields.length, FIELD_REGISTRY.length);
  for (const { field } of fields) {
    assert.equal(field.basis, "unknown");
    assert.equal(field.value, null);
    assert.equal(field.confidence, 0);
  }
  // A 32-note "melody" fits no field: the only numeric lists are pitch-class sets (≤12, 0..11) and cents.
  const melody = Array.from({ length: 32 }, (_, i) => 60 + (i % 7));
  for (const spec of FIELD_REGISTRY) {
    assert.equal(spec.validate(melody), null, `${spec.path} accepted a note list`);
  }
  const ps = FIELD_REGISTRY.find((s) => s.path === "harmony.pitchSystem")!;
  assert.equal(ps.validate({ id: "x", name: "x", kind: "other", pitchClasses: [0, 2, 4, 5, 7, 9, 11, 12] }), null, "a pitch class above 11 is not a pitch class");
});

test("the seed references only instruments and pitch systems the lexicon has, and every note cites a source", () => {
  assert.deepEqual(validateSeed(), []);
  for (const entry of INSTRUMENTS) {
    if (entry.gm.program !== null && entry.gm.family !== "Voice") {
      assert.ok(entry.gm.program >= 0 && entry.gm.program <= 127, `${entry.id}: GM program out of range`);
      if (entry.gm.exact) assert.equal(entry.gm.family, gmFamilyOfProgram(entry.gm.program), `${entry.id}: exact GM mapping must be in the program's family`);
    }
  }
  for (const p of PITCH_SYSTEMS) {
    if (p.pitchClasses) assert.ok(p.pitchClasses.every((pc) => pc >= 0 && pc < 12) && p.pitchClasses.length <= 12, p.id);
    if (p.kind === "maqam" || p.kind === "raga" || p.kind === "qenet" || p.kind === "gamelan" || p.kind === "dastgah") assert.ok(p.hypothesis, `${p.id}: a non-Western system reduced to a set must be a hypothesis`);
    if (!p.pitchClasses && !p.intervalsCents) assert.ok(p.caveat, `${p.id}: an undefined system must say why`);
  }
});

// ---------------------------------------------------------------------------
// parsing
// ---------------------------------------------------------------------------

test("the parser reads tempo numbers, meters with grouping, decades, instruments, regions and grooves out of the text", () => {
  const { style, cues } = parseStyleDescription("Balkan brass at 132 bpm in 7/8 (3+2+2), late 1970s, oud and darbuka, swing feel", { now: NOW });
  assert.deepEqual(style.tempo.bpm.value, { min: 130, max: 134 });
  assert.equal(style.tempo.bpm.basis, "user_stated");
  assert.deepEqual(style.meter.value, { numerator: 7, denominator: 8, grouping: [3, 2, 2] });
  assert.deepEqual(style.identity.era.value, { from: 1976, to: 1979, label: "1970s" });
  assert.ok(style.identity.region.value?.includes("balkan"));
  const instruments = style.ensemble.value!.map((m) => m.instrument);
  assert.ok(instruments.includes("oud") && instruments.includes("darbuka") && instruments.includes("brass_section"), instruments.join(","));
  const oud = style.ensemble.value!.find((m) => m.instrument === "oud")!;
  assert.equal(oud.gm.exact, false, "GM has no oud; the mapping says so");
  assert.equal(style.groove.feel.value, "swung");
  assert.equal(style.groove.feel.basis, "user_stated");
  assert.equal(style.groove.swingRatio.basis, "inferred", "0.62 is the convention behind the word, not the user's number");
  assert.ok(cues.some((c) => c.kind === "groove" && c.id === "swing"));
  assert.deepEqual(style.unrecognised, [], `nothing should be unrecognised here: ${style.unrecognised.join(",")}`);
});

test("a novel combination decomposes without a genre list: instrument-scoped tags stay on the instrument", () => {
  const { style } = parseStyleDescription("1970s Ethiopian jazz with Mizrahi strings and a trap hi-hat", { now: NOW });
  assert.ok(style.identity.tags.value?.includes("jazz"));
  assert.ok(style.identity.region.value?.includes("ethiopian"));
  assert.deepEqual(style.identity.era.value, { from: 1970, to: 1979, label: "1970s" });
  const strings = style.ensemble.value!.find((m) => m.instrument === "string_section")!;
  assert.deepEqual(strings.styleTags, ["mizrahi"], "Mizrahi describes the strings, not the whole style");
  const hat = style.ensemble.value!.find((m) => m.instrument === "hi_hat")!;
  assert.deepEqual(hat.styleTags, ["trap"]);
  assert.equal(style.drums.hiHat.value, "trap_rolls");
  assert.ok(!style.identity.tags.value?.includes("trap"), "'trap hi-hat' names a hi-hat, not the trap genre");
});

test("words no lexicon knows become tags flagged unrecognised, never guessed at", () => {
  const { style } = parseStyleDescription("zorblax fusion with a glimmering wumpus", { now: NOW });
  assert.deepEqual(style.unrecognised.sort(), ["glimmering", "wumpus", "zorblax"]);
  assert.ok(style.identity.tags.value?.includes("zorblax"));
  assert.equal(style.identity.tags.hypothesis, true);
  assert.equal(style.tempo.bpm.basis, "unknown");
  assert.equal(style.harmony.pitchSystem.basis, "unknown");
});

test("Hebrew descriptions parse: clitic prefixes, decade words, instruments", () => {
  const { style, language } = parseStyleDescription("בלדה מזרחית משנות השמונים עם כינורות ודרבוקה, איטית", { now: NOW });
  assert.equal(language, "he");
  assert.ok(style.identity.region.value?.includes("mizrahi"), JSON.stringify(style.identity.region.value));
  assert.ok(style.identity.tags.value?.includes("ballad"));
  assert.deepEqual(style.identity.era.value, { from: 1980, to: 1989, label: "1980s" });
  const ids = style.ensemble.value!.map((m) => m.instrument);
  assert.ok(ids.includes("violin") && ids.includes("darbuka"), ids.join(","));
  assert.deepEqual(style.tempo.bpm.value, { min: 60, max: 80 });
  assert.equal(style.tempo.bpm.basis, "inferred");
});

test("the user contradicting themself is recorded as contested, not silently resolved", () => {
  const { style } = parseStyleDescription("straight feel but with a swing", { now: NOW });
  assert.ok(style.groove.feel.contested?.length, "both feels were stated");
  assert.equal(style.groove.feel.hypothesis, true);
  const questions = clarificationQuestions(style);
  assert.ok(questions.some((q) => q.path === "groove.feel" && q.reason === "contested"));
});

// ---------------------------------------------------------------------------
// merging
// ---------------------------------------------------------------------------

test("a user's word is never overridden by evidence; evidence overrides inference; agreement corroborates", () => {
  const { style } = parseStyleDescription("120 bpm", { now: NOW });
  const claim = (over: Partial<StyleClaim>): StyleClaim => ({ path: "tempo.bpm", value: { min: 60, max: 80 }, confidence: 0.9, basis: "evidence", sources: ["seed:x"], note: null, ...over });
  assert.equal(mergeClaim(style, claim({})), "kept");
  assert.deepEqual(style.tempo.bpm.value, { min: 118, max: 122 });
  assert.equal(style.tempo.bpm.contested?.length, 1);

  assert.equal(mergeClaim(style, claim({ path: "density", value: 0.3, basis: "inferred", confidence: 0.7 })), "set");
  assert.equal(mergeClaim(style, claim({ path: "density", value: 0.8, basis: "evidence", confidence: 0.6 })), "contested");
  assert.equal(style.density.value, 0.8);
  assert.equal(style.density.basis, "evidence");
  assert.equal(mergeClaim(style, claim({ path: "density", value: 0.78, basis: "inferred", confidence: 0.5 })), "corroborated");
  assert.ok(style.density.confidence > 0.6, `corroboration raises confidence: ${style.density.confidence}`);

  assert.equal(mergeClaim(style, claim({ path: "groove.swingRatio", value: 0.9 })), "rejected", "0.9 is not a swing ratio");
  assert.equal(mergeClaim(style, claim({ path: "harmony.cadence", value: ["authentic"] })), "set");
  assert.equal(mergeClaim(style, claim({ path: "harmony.cadence", value: ["plagal"] })), "merged");
  assert.deepEqual(style.harmony.cadence.value, ["authentic", "plagal"]);
});

// ---------------------------------------------------------------------------
// evidence synthesis
// ---------------------------------------------------------------------------

test("the seed provider fills evidence fields for a known world and marks non-Western pitch systems as hypotheses", async () => {
  const parse = parseStyleDescription("bossa nova", { now: NOW });
  const { style, report } = await synthesiseEvidence(parse);
  assert.equal(report.providers[0].id, SEED_REASONING_PROVIDER.id);
  assert.ok(report.appliedNotes.some((n) => n.id === "bossa_nova"));
  assert.equal(style.harmony.chordVocabulary.value, "extended");
  assert.equal(style.harmony.chordVocabulary.basis, "evidence");
  assert.ok(style.harmony.chordVocabulary.sources.some((s) => s.startsWith("seed:bossa_nova")));
  assert.ok(style.harmony.chordVocabulary.sources.some((s) => s.startsWith("ref: ")), "every seed value carries a reference");
  assert.equal(style.groove.feel.value, "straight");
  assert.equal(style.ensemble.value?.[0].instrument, "nylon_guitar");

  const arabic = await synthesiseEvidence(parseStyleDescription("Egyptian tarab", { now: NOW }));
  assert.equal(arabic.style.harmony.pitchSystem.hypothesis, true, "which maqam is a question, not a fact");
  assert.equal(arabic.style.harmony.pitchSystem.value?.kind, "maqam");
  assert.equal(arabic.style.harmony.pitchSystem.value?.microtonal, true);
  assert.equal(arabic.style.drums.language.value, "arabic_iqa");
});

test("a provider cannot override the user, cannot fill a field outside the registry, and a failing provider is recorded not fatal", async () => {
  const rogue: StyleReasoningProvider = {
    id: "rogue", kind: "test",
    async reason() {
      return [
        { path: "tempo.bpm", value: { min: 60, max: 70 }, confidence: 1, basis: "evidence", sources: ["rogue"], note: null },
        { path: "notes" as never, value: [60, 62, 64], confidence: 1, basis: "evidence", sources: ["rogue"], note: null },
        { path: "harmony.pitchSystem", value: { id: "melody", name: "melody", kind: "other", pitchClasses: Array.from({ length: 40 }, (_, i) => i) }, confidence: 1, basis: "evidence", sources: ["rogue"], note: null },
        { path: "density", value: 0.9, confidence: 1, basis: "user_stated" as never, sources: ["rogue"], note: null },
      ];
    },
  };
  const broken: StyleReasoningProvider = { id: "broken", kind: "test", async reason() { throw new Error("model down"); } };
  const parse = parseStyleDescription("140 bpm techno", { now: NOW });
  const { style, report } = await synthesiseEvidence(parse, [rogue, broken, SEED_REASONING_PROVIDER]);
  assert.deepEqual(style.tempo.bpm.value, { min: 138, max: 142 }, "the user's tempo stands");
  assert.equal(style.harmony.pitchSystem.basis, "unknown", "a 40-'pitch-class' list is not a pitch system");
  assert.equal(style.density.value === 0.9 && style.density.basis === "user_stated", false, "a provider may not speak as the user");
  const rogueReport = report.providers.find((p) => p.id === "rogue")!;
  assert.equal(rogueReport.outcomes.rejected, 3);
  assert.equal(rogueReport.outcomes.kept, 1);
  assert.equal(report.providers.find((p) => p.id === "broken")!.error, "model down");
  assert.equal(style.drums.language.value, "four_on_the_floor", "the seed still ran after the broken provider");
});

test("two worlds in one description merge, and their disagreements are contested and asked about", async () => {
  const result = await decomposeStyle("Renaissance consort meets lo-fi hip-hop", { now: NOW });
  assert.ok(result.synthesis.appliedNotes.some((n) => n.id === "renaissance"));
  assert.ok(result.synthesis.appliedNotes.some((n) => n.id === "lo_fi"));
  assert.ok(result.synthesis.contested.includes("drums.kit"), `renaissance says no drums, lo-fi says a kit: ${result.synthesis.contested.join(",")}`);
  const ids = result.style.ensemble.value!.map((m) => m.instrument);
  assert.ok(ids.includes("viol") && ids.includes("electric_piano"), "both palettes survive as one ensemble");
  assert.ok(result.questions.some((q) => q.reason === "contested" || q.reason === "hypothesis"));
  assert.equal(result.style.production.saturation.value, "lo_fi");
});

// ---------------------------------------------------------------------------
// clarification
// ---------------------------------------------------------------------------

test("clarification asks only about unknown, consequential fields — most consequential first — and an answer settles the field", async () => {
  const bare = decomposeStyleDeterministic("something zorblaxy and dreamy", NOW).style;
  const questions = clarificationQuestions(bare);
  assert.ok(questions.length <= 4);
  assert.ok(questions.every((q) => FIELD_REGISTRY.find((s) => s.path === q.path)!.consequence >= 0.6 || q.reason !== "unknown"));
  assert.equal(questions[0].reason, "unrecognised", `'zorblaxy' is not a style: ${questions[0].id}`);
  assert.ok(!questions.some((q) => q.path === "production.room"), "room size is not worth a question");

  const seeded = (await decomposeStyle("techno at 130 bpm", { now: NOW })).style;
  const after = clarificationQuestions(seeded);
  assert.ok(!after.some((q) => q.path === "tempo.bpm" || q.path === "meter" || q.path === "drums.language"), `known fields are not asked: ${after.map((q) => q.id).join(",")}`);
  const target = after.find((q) => q.reason === "unknown");
  if (target) {
    const outcome = applyClarificationAnswer(seeded, target.path, target.options[0]?.value ?? "modal", "answer");
    assert.equal(outcome, "set");
    assert.equal(listFields(seeded).find((f) => f.path === target.path)!.field.basis, "user_stated");
  }
});

// ---------------------------------------------------------------------------
// grammar
// ---------------------------------------------------------------------------

test("the grammar produces directives in the shape applyGroove reads, weighs by basis, and omits unknowns visibly", async () => {
  const { style, grammar, grammarSlot } = await decomposeStyle("swing jazz at 160 bpm, walking bass, brushes", { now: NOW });
  const swing = grammar.rules.find((r) => r.id === "swing")!;
  assert.ok(swing, "a swung style states a swing rule");
  assert.equal((swing.directive as { kind: string }).kind, "swing");
  assert.ok(Math.abs((swing.directive as { ratio: number }).ratio - 0.62) < 0.01);
  const tempo = grammar.rules.find((r) => r.id === "tempo")!;
  assert.deepEqual(tempo.directive, { kind: "tempo", bpmMin: 158, bpmMax: 162 });
  assert.equal(tempo.basis, "user_stated");
  assert.equal(tempo.weight, 1);
  const bass = grammar.rules.find((r) => r.id === "bass-language")!;
  assert.equal((bass.directive as { pattern: string }).pattern, "walking");
  assert.ok(grammar.omitted.some((line) => line.endsWith(": unknown")), "unknown fields are listed, not silent");
  assert.equal(grammarSlot.status, "available");
  if (grammarSlot.status === "available") {
    assert.ok(grammarSlot.version.startsWith("UNIVERSAL_STYLE_GRAMMAR_V1:"));
    assert.ok(grammarSlot.rules.every((r) => r.directive && typeof r.directive === "object" && "kind" in (r.directive as object)));
  }
  assert.ok(grammar.rules.every((r) => r.weight >= 0.15));
  const unknownCount = listFields(style).filter((f) => f.field.basis === "unknown").length;
  assert.equal(grammar.basis.unknownFields, unknownCount);
});

test("an empty description yields an unavailable slot with the reason, and every unknown listed", () => {
  const grammar = styleGrammarFromUniversalStyle(parseStyleDescription("", { now: NOW }).style);
  assert.deepEqual(grammar.rules, []);
  // Every rule the grammar could have stated is listed as omitted, with why —
  // an empty description must produce silence that is visible, not silence.
  assert.ok(grammar.omitted.length >= 20, `${grammar.omitted.length} omissions`);
  assert.ok(grammar.omitted.every((line) => /: (unknown|.*unknown|too weak.*)$/.test(line)), grammar.omitted.join(" | "));
  assert.equal(grammar.basis.unknownFields, FIELD_REGISTRY.length);
  assert.equal(grammar.basis.resolvedFields, 0);
  const slot = universalStyleGrammarSlot(grammar);
  assert.equal(slot.status, "not_available");
});

// ---------------------------------------------------------------------------
// arrangement instructions
// ---------------------------------------------------------------------------

test("arrangement instructions assign every instrument to a role in the planners' vocabulary and carry the pitch system as a constraint", async () => {
  const { instructions, style } = await decomposeStyle("flamenco with cajón, palmas and a nylon guitar, phrygian dominant", { now: NOW });
  const roles = Object.fromEntries(instructions.roles.map((r) => [r.role, r]));
  assert.ok(roles.drums.instruments.includes("cajon"));
  assert.equal(roles.drums.arrangementRole, "GROOVE");
  assert.ok(roles.harmony.instruments.includes("nylon_guitar"));
  assert.ok(roles.harmony.constraints.some((c) => /Phrygian dominant/.test(c) && /\{0,1,4,5,7,8,10\}/.test(c)), roles.harmony.constraints.join(" | "));
  assert.ok(roles.lead.instruments.includes("lead_vocal"));
  assert.ok(instructions.palette.every((p) => ["GROOVE", "BASS", "RHYTHMIC_HARMONY", "HARMONIC_BED", "LEAD", "PAD", "COUNTER_MELODY", "ACCENT", "OSTINATO", "FILL", "TRANSITION", "CALL_RESPONSE", "CLIMAX_LAYER", "FOUNDATION"].includes(p.role)));
  assert.equal(style.harmony.cadence.value?.includes("andalusian"), true);
  assert.equal(instructions.sectionTargets.tension, 0.7);
  assert.ok(instructions.unknowns.length > 0 && instructions.caveat.includes("unknown"));
});

test("a stated vocal always leads; another lead instrument becomes colour", async () => {
  const { instructions } = await decomposeStyle("singer with trumpet, piano, bass and drums", { now: NOW });
  const lead = instructions.roles.find((r) => r.role === "lead")!;
  assert.deepEqual(lead.instruments, ["lead_vocal"]);
  assert.ok(instructions.roles.find((r) => r.role === "colour")!.instruments.includes("trumpet"));
});

// ---------------------------------------------------------------------------
// reconciliation
// ---------------------------------------------------------------------------

test("reconciliation surfaces conflicts as questions and never rewrites the stated value", async () => {
  const { style } = await decomposeStyle("swing jazz at 160 bpm in 3/4 with heavy ornamentation", { now: NOW });
  const before = JSON.stringify(style);
  const rec = reconcileWithFingerprint(style, fingerprint({ tempo: { bpm: 100, stability: 0.9, meter: "4/4", behavior: "moderate" } }));
  assert.equal(JSON.stringify(style), before, "the style is untouched");
  const byPath = new Map(rec.items.map((i) => [i.path, i]));
  assert.equal(byPath.get("tempo.bpm")!.status, "conflict");
  assert.equal(byPath.get("meter")!.status, "conflict");
  assert.equal(byPath.get("groove.swingRatio")!.status, "conflict", "stated swing vs a straight song");
  assert.equal(byPath.get("melody.ornamentation")!.status, "conflict");
  assert.ok(rec.questions.length >= 4);
  assert.ok(rec.questions.every((q) => q.reason === "fingerprint_conflict" && q.options.length === 2));
  assert.ok(rec.questions.every((q) => q.currentAssumption?.startsWith("what you said")));

  // A song that matches the description on every field the fingerprint measures
  // — including the fields the seed contributed — raises nothing.
  const agree = reconcileWithFingerprint(style, fingerprint({
    tempo: { bpm: 160, stability: 0.9, meter: "3/4", behavior: "fast" },
    groove: { ...fingerprint().groove, swingRatio: 0.63 },
    melodicShape: { ...fingerprint().melodicShape, ornamentation: "heavy" },
    harmony: { ...fingerprint().harmony, chordExtensions: "extended", functionalMotion: 0.6 },
    density: { notesPerBarMean: 19, notesPerBarP10: 15, notesPerBarP90: 23, arcShape: "flat" },
    instrumentation: { hierarchy: ["keys", "bass", "drums", "winds", "brass", "guitar"], familyShare: { keys: 0.2, bass: 0.2, drums: 0.2, winds: 0.2, brass: 0.1, guitar: 0.1 }, trackCount: 6 },
  }));
  assert.deepEqual(agree.items.filter((i) => i.status === "conflict").map((i) => i.path), []);
  assert.equal(agree.conflicts, 0);
  assert.ok(agree.agreements >= 8, `${agree.agreements} agreements`);
  assert.equal(agree.items.find((i) => i.path === "groove.microtimingMs")!.status, "not_stated");
});

test("a tempo at half or double time counts as agreement, flagged for confirmation", async () => {
  const { style } = await decomposeStyle("trap at 140", { now: NOW });
  const rec = reconcileWithFingerprint(style, fingerprint({ tempo: { bpm: 70, stability: 0.9, meter: "4/4", behavior: "slow" } }));
  const item = rec.items.find((i) => i.path === "tempo.bpm")!;
  assert.equal(item.status, "agree");
  assert.match(item.note, /half or double/);
});

// ---------------------------------------------------------------------------
// the whole pipeline
// ---------------------------------------------------------------------------

test("decomposition is deterministic and reports the resolution share honestly", async () => {
  const a = await decomposeStyle("1970s Ethiopian jazz with Mizrahi strings and a trap hi-hat", { now: NOW });
  const b = await decomposeStyle("1970s Ethiopian jazz with Mizrahi strings and a trap hi-hat", { now: NOW });
  assert.deepEqual(a.style, b.style);
  assert.deepEqual(a.grammar, b.grammar);
  const share = resolutionShare(a.style);
  assert.equal(share.user_stated + share.inferred + share.evidence + share.unknown, share.fields);
  assert.ok(share.deterministicShare + share.reasoningShare + share.unknownShare > 0.99);
  const det = decomposeStyleDeterministic("1970s Ethiopian jazz with Mizrahi strings and a trap hi-hat", NOW).share;
  assert.equal(det.evidence, 0, "the parse alone seeds nothing");
  assert.ok(det.unknown > share.unknown, "the seed resolved fields the parser could not");
  assert.ok(a.style.hypotheses.includes("harmony.pitchSystem"), "the Ethiopian mode is a hypothesis to confirm");
  assert.ok(a.questions.some((q) => q.path === "harmony.pitchSystem"));
  const styleTags = a.style.ensemble.value!.find((m) => m.instrument === "string_section")!.styleTags;
  assert.deepEqual(styleTags, ["mizrahi"]);
  assert.equal(a.instructions.roles.find((r) => r.role === "harmony")!.styleTags.includes("mizrahi"), true, "the instrument-scoped tag reaches its role instruction");
});

test("a style the seed does not know stays honest: mostly unknown, no invented facts", async () => {
  const result = await decomposeStyle("Tuvan throat singing over Bulgarian wedding rhythms", { now: NOW });
  const style: UniversalStyle = result.style;
  assert.ok(style.identity.region.value?.includes("mongolian") && style.identity.region.value?.includes("balkan"));
  const seeded = listFields(style).filter((f) => f.field.basis === "evidence");
  for (const { field } of seeded) assert.ok(field.sources.some((s) => s.startsWith("seed:")), "every evidence value names its seed note");
  assert.ok(result.share.unknownShare > 0.3, `most of this is unknown to the seed: ${result.share.unknownShare}`);
  assert.equal(style.harmony.pitchSystem.hypothesis, true);
});

// ---------------------------------------------------------------------------
// compound style words and explicit roles
// ---------------------------------------------------------------------------

test("a compound style name is decomposed into the features inside it, but a groove word is not", () => {
  // "Balkan brass" is a brass section from the Balkans — the tag, the region
  // and the instrument all come out of the same two words.
  const balkan = parseStyleDescription("Balkan brass at 140 bpm", { now: NOW }).style;
  assert.ok(balkan.identity.tags.value?.includes("balkan_brass"));
  assert.ok(balkan.identity.region.value?.includes("balkan"));
  const brass = balkan.ensemble.value!.find((m) => m.instrument === "brass_section")!;
  assert.ok(brass, balkan.ensemble.value!.map((m) => m.instrument).join(","));
  assert.deepEqual(brass.styleTags, ["balkan"], "the region inside the style name describes the instrument it names");

  const ethio = parseStyleDescription("Ethiopian jazz", { now: NOW }).style;
  assert.ok(ethio.identity.tags.value?.includes("ethio_jazz"));
  assert.ok(ethio.identity.tags.value?.includes("jazz"), "the jazz inside ethio-jazz is jazz");
  assert.ok(ethio.identity.region.value?.includes("ethiopian"));

  // A groove word has already spent its parts on one meaning: reopening
  // "trap hi-hat" would invent a genre the producer never asked for.
  const trap = parseStyleDescription("a trap hi-hat over an acoustic guitar", { now: NOW }).style;
  assert.equal(trap.drums.hiHat.value, "trap_rolls");
  assert.ok(!trap.identity.tags.value?.includes("trap"));
});

test("an explicit role assignment is read; an instrument merely mentioned near a role word is not", () => {
  const assigned = parseStyleDescription("oud carries the melody, piano on chords, darbuka on the groove", { now: NOW }).style;
  assert.deepEqual(assigned.roles.value, { drums: ["darbuka"], harmony: ["piano"], lead: ["oud"] });
  assert.equal(assigned.roles.basis, "user_stated");

  const notAssigned = parseStyleDescription("oud and darbuka over a bed of strings", { now: NOW }).style;
  assert.equal(notAssigned.roles.basis, "unknown", "nothing here assigns a role");
});

test("an assigned role moves the instrument in the arrangement instructions", async () => {
  const { instructions } = await decomposeStyle("a jazz quartet where the saxophone carries the melody and the piano takes the harmony", { now: NOW });
  const byRole = Object.fromEntries(instructions.roles.map((r) => [r.role, r]));
  assert.ok(byRole.lead.instruments.includes("saxophone"), byRole.lead.instruments.join(","));
  assert.ok(byRole.harmony.instruments.includes("piano"), byRole.harmony.instruments.join(","));
});

// ---------------------------------------------------------------------------
// the corpus — the invariants that must hold for any description in the world
// ---------------------------------------------------------------------------

test("the corpus spans the traditions the platform claims and includes novel combinations", () => {
  assert.ok(STYLE_CORPUS.filter((e) => e.kind === "real").length >= 40, "at least 40 real style descriptions");
  assert.ok(STYLE_CORPUS.filter((e) => e.kind === "novel").length >= 10, "at least 10 novel combinations");
  assert.equal(new Set(STYLE_CORPUS.map((e) => e.id)).size, STYLE_CORPUS.length, "ids are unique");
  for (const area of ["jazz", "middle-east", "south-asia", "latin", "africa", "balkans", "edm", "orchestral", "gospel", "worship"]) {
    assert.ok(STYLE_CORPUS.some((e) => e.area === area), "the corpus covers " + area);
  }
});

test("every description in the corpus decomposes honestly: no invented facts, no note lists, unknowns explicit", async () => {
  for (const entry of STYLE_CORPUS) {
    const result = await decomposeStyle(entry.description, { now: NOW, maxQuestions: 5 });
    const label = entry.id + ": " + entry.description;
    for (const { path, field } of listFields(result.style)) {
      if (field.basis === "unknown") {
        assert.equal(field.value, null, label + " / " + path + " is unknown but holds a value");
        assert.equal(field.confidence, 0, label + " / " + path);
      } else {
        assert.notEqual(field.value, null, label + " / " + path + " is known but holds no value");
        assert.ok(field.sources.length, label + " / " + path + " has no source");
        assert.ok(field.confidence > 0 && field.confidence <= 1, label + " / " + path + " confidence " + field.confidence);
      }
      // Every evidence value names the seed note behind it and a reference.
      if (field.basis === "evidence") {
        assert.ok(field.sources.some((s) => s.startsWith("seed:")), label + " / " + path + " claims evidence with no seed note");
        assert.ok(field.sources.some((s) => s.startsWith("ref: ")), label + " / " + path + " claims evidence with no reference");
      }
    }
    // A word nobody knows is kept and asked about, never resolved into a fact.
    if (result.style.unrecognised.length) {
      assert.ok(result.questions.some((q) => q.reason === "unrecognised"), label + " / unrecognised words but no question");
      assert.equal(result.style.identity.tags.hypothesis, true, label);
    }
    // A non-Western pitch system reduced to a set is always a hypothesis.
    const ps = result.style.harmony.pitchSystem.value;
    if (ps && ["maqam", "makam", "raga", "melakarta", "qenet", "gamelan", "dastgah"].includes(ps.kind)) {
      assert.equal(result.style.harmony.pitchSystem.hypothesis, true, label + " / " + ps.id + " must be a hypothesis");
      assert.ok(ps.caveat, label + " / " + ps.id + " must say what the set leaves out");
    }
    // Every grammar rule is actionable: a known directive kind and a real weight.
    for (const rule of result.grammar.rules) {
      assert.ok(typeof (rule.directive as { kind?: unknown }).kind === "string", label + " / " + rule.id + " has no directive kind");
      assert.ok(rule.weight >= 0.15 && rule.weight <= 1, label + " / " + rule.id + " weight " + rule.weight);
      assert.ok(rule.sources.length, label + " / " + rule.id + " has no sources");
    }
    // Instructions never name an instrument the ensemble does not have.
    const known = new Set((result.style.ensemble.value ?? []).map((m) => m.instrument));
    for (const role of result.instructions.roles) {
      for (const instrument of role.instruments) assert.ok(known.has(instrument), label + " / " + role.role + " names " + instrument);
    }
    // Questions are only ever asked about fields the registry knows.
    for (const q of result.questions) assert.ok(FIELD_REGISTRY.some((s) => s.path === q.path), label + " / question on " + q.path);
  }
});

test("the novel combinations produce a usable grammar although no seed note describes any of them", async () => {
  for (const entry of STYLE_CORPUS.filter((e) => e.kind === "novel")) {
    const result = await decomposeStyle(entry.description, { now: NOW });
    const label = entry.id + ": " + entry.description;
    // The seed has no note for "flamenco meets drum and bass"; it has notes for
    // flamenco and for drum and bass, and both must reach the one style.
    assert.ok(result.share.unknownShare < 1, label);
    if (entry.id !== "zorblax") {
      assert.equal(result.grammarSlot.status, "available", label + " / " + result.grammar.omitted.length + " omissions");
      assert.ok(result.grammar.rules.length >= 3, label + " / only " + result.grammar.rules.length + " rules");
    }
  }
  // A description of nothing anybody knows asks rather than invents.
  const nonsense = await decomposeStyle("zorblax fusion with a glimmering wumpus and a sad trombone", { now: NOW });
  assert.ok(nonsense.style.unrecognised.includes("zorblax"));
  assert.equal(nonsense.questions[0].reason, "unrecognised");
  assert.equal(nonsense.style.harmony.pitchSystem.basis, "unknown", "nothing here says what scale to use, so nothing does");
});
