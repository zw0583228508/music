import assert from "node:assert/strict";
import test from "node:test";
import type { PartGenerationRequest } from "./partComposer";
import {
  HARMONY_PLAN_PENDING,
  STYLE_GRAMMAR_PENDING,
  upgradePartGenerationRequest,
  type PartGenerationRequestV2,
} from "./partGenerationContextV2";
import { projectV2ForComposersAssistant2 } from "./symbolicGenerationProvider";
import {
  CA2_ASSIGNED_INSTRUCTION_COUNT,
  CA2_INSTRUCTIONS,
  CA2_VOCABULARY,
  CONDITIONING_APPROACHES,
  CONDITIONING_DISPOSITIONS,
  CONDITIONING_FIELDS,
  CONDITIONING_MAP,
  ca2Bin,
  chordPitchClasses,
  completeConditioningMap,
  coverageByApproach,
  expressV2InCa2Vocabulary,
  loudnessLevelForEnergy,
  missingClassifications,
  unmappedRequestKeys,
  zeroNewTokenCoverage,
  type ConditioningRow,
} from "./conditioningMap";

// ---------------------------------------------------------------------------
// A V1 request with every property the types declare populated, so the key
// walk in `unmappedRequestKeys` sees the whole contract, not a stub.
// ---------------------------------------------------------------------------

function fullV1(): PartGenerationRequest {
  const sectionTarget = (sectionName: string, startBar: number, endBar: number, energy: number, density: number) => ({
    sectionName, startBar, endBar, energy, density, tension: 0.3, role: "verse" as const, noveltyVsPrevious: 0.2,
  });
  const bar = (n: number) => ({ start: (n - 1) * 2, end: n * 2 });
  return {
    task: "PAD",
    taskId: "part-verse-1-strings-PAD",
    seed: 7,
    instrument: "strings",
    role: "PAD",
    section: {
      sectionName: "verse-1", startBar: 5, endBar: 8, function: "verse", energy: 0.5, density: 0.4, tension: 0.3,
      groove: "steady", activeInstrumentFamilies: ["strings", "bass"], inactiveInstrumentFamilies: ["brass"],
      leadRole: "vocal", supportingRoles: ["PAD"], registerDistribution: { mid: 0.6, upper_mid: 0.4 },
      rhythmicActivity: 0.3, melodicActivity: 0.2, harmonicActivity: 0.5, transitionIn: "continue", transitionOut: "build",
      noveltyRelativeToPreviousSection: 0.2,
    },
    phrases: [{ id: "p1", sectionName: "verse-1", startBar: 5, endBar: 8, role: "opening", energyTarget: 0.5, entersFamilies: ["strings"], leavesFamilies: [] }],
    globalPlan: {
      version: "1.0", derivedAt: "2026-09-09T00:00:00.000Z", inputsDigestSha256: "x", method: "test", confidence: 0.8,
      style: "pop", substyle: null,
      instrumentPalette: [{ role: "strings", priority: 1, rationale: "bed" }],
      sectionTargets: [sectionTarget("intro", 1, 4, 0.2, 0.2), sectionTarget("verse-1", 5, 8, 0.5, 0.4), sectionTarget("chorus-1", 9, 12, 0.9, 0.8)],
      climax: { sectionName: "chorus-1", atBar: 9, energy: 0.9 }, secondaryClimax: null,
      grooveStrategy: "steady_pulse", orchestrationStrategy: "layered_build", motifStrategy: "recurring_hook",
      contrastStrategy: "dynamic_contrast", harmonicComplexity: 0.3, rhythmicComplexity: 0.3, productionAesthetic: "polished_pop",
    },
    budgetWindows: [{
      id: "w1", startBar: 5, endBar: 8, vocalAttention: 0.7,
      budgets: { totalDensity: 0.5, melodic: 0.2, rhythmic: 0.3, harmonic: 0.4, register: 0.5, spectral: 0.5, attention: 0.6 },
      instrumentAdjustments: [{ instrument: "strings", densityMultiplier: 0.8, registerShift: 0, note: "under the voice" }],
    }],
    transitions: [{
      id: "t1", fromSection: "verse-1", toSection: "chorus-1", atBar: 9, approachBars: 1, kind: "build", strength: 0.6,
      harmonicApproach: "dominant_prep", vocalSafe: true,
      devices: [{ device: "string_run", instrument: "strings", startBar: 8, endBar: 8, intensity: 0.5, rationale: "lift" }],
    }],
    context: {
      previousBars: { startBar: 3, endBar: 4, chords: [{ symbol: "F", roman: "IV", confidence: 0.8, ...bar(3) }], melody: [{ start: 4, end: 5, pitch: 65, confidence: 1, provider: "t" }], bass: [{ start: 4, end: 6, pitch: 41, confidence: 1, provider: "t" }] },
      currentBars: {
        startBar: 5, endBar: 8,
        chords: [
          { symbol: "C", roman: "I", confidence: 0.8, root: "C", quality: "maj", ...bar(5) },
          { symbol: "Am7", roman: "vi7", confidence: 0.8, ...bar(6) },
          { symbol: "F", roman: "IV", confidence: 0.8, ...bar(7) },
          { symbol: "G7", roman: "V7", confidence: 0.8, ...bar(8) },
        ],
        melody: [{ start: 8, end: 9, pitch: 67, confidence: 1, provider: "t" }, { start: 12, end: 13, pitch: 69, confidence: 1, provider: "t" }],
        bass: [{ start: 8, end: 10, pitch: 36, confidence: 1, provider: "t" }],
      },
      nextBars: { startBar: 9, endBar: 10, chords: [{ symbol: "C", roman: "I", confidence: 0.8, ...bar(9) }], melody: [], bass: [] },
    },
    existingParts: [{ instrument: "bass", role: "BASS", noteCount: 4 }],
    styleFingerprint: {
      version: "1.0", method: "test", derivedAt: "2026-09-09T00:00:00.000Z", inputsDigestSha256: "x",
      source: { kind: "song_model", id: "s", version: 1 }, contentFree: true,
      tempo: { bpm: 100, stability: 0.9, meter: "4/4", behavior: "moderate" },
      groove: { swingRatio: 0.5, microtimingMs: 0, microtiming: "quantized", syncopation: 0.2, subdivisions: { quarter: 0.5, eighth: 0.4, sixteenth: 0.1, triplet: 0, other: 0 }, onsetDensity: 2 },
      harmony: { chordsPerBar: 1, harmonicRhythm: "moderate", extensionShare: 0.2, chordExtensions: "sevenths", keyChanges: 0, functionalMotion: 0.4 },
      melodicShape: { rangeSemitones: 12, stepwiseRatio: 0.7, leapRatio: 0.2, meanIntervalSemitones: 2, phraseLengthBeats: 4, phraseLength: "regular", ornamentDensity: 0.05, ornamentation: "light" },
      register: { low: 0.2, mid: 0.6, high: 0.2, tendency: "mid" },
      dynamics: { velocityP10: 60, velocityP90: 100, rangeClass: "moderate" },
      energyArc: [0.2, 0.3, 0.4, 0.5, 0.6, 0.7, 0.8, 0.6],
      density: { notesPerBarMean: 8, notesPerBarP10: 4, notesPerBarP90: 12, arcShape: "rising" },
      instrumentation: { hierarchy: ["strings", "bass"], familyShare: { strings: 0.7, bass: 0.3 }, trackCount: 2 },
      sectionCount: 3, durationSeconds: 120,
    } as unknown as PartGenerationRequest["styleFingerprint"],
    constraints: {
      playableRange: { min: 36, max: 96 }, comfortableRange: { min: 48, max: 84 }, maxLeap: 12,
      maxSimultaneousNotes: 4, minNoteDuration: 0.05, physicalRules: ["section = divisi ok"],
    },
  } as unknown as PartGenerationRequest;
}

function fullV2(over: Partial<PartGenerationRequestV2> = {}): PartGenerationRequestV2 {
  const v1 = fullV1();
  const v2 = upgradePartGenerationRequest(v1, {
    siblings: [{ instrument: "bass", role: "BASS", notes: [{ id: "b1", start: 8, duration: 2, pitch: 36, velocity: 90 }] }],
    window: { start: 8, end: 16 },
    lockedNotes: [{ id: "l1", start: 8, duration: 2, pitch: 60, velocity: 80 }],
    lockedReason: "producer kept bar 5",
    productionBriefRef: "brief-1",
    styleGrammar: {
      status: "available", version: "STYLE_GRAMMAR_V1:full",
      rules: [
        { id: "onset-density", description: "", weight: 0.5, directive: { kind: "rate", feature: "onsetsPerBeat", target: 2.5 } },
        { id: "stepwise-motion", description: "", weight: 0.5, directive: { kind: "ratio", feature: "stepwise", target: 0.7 } },
        { id: "chord-extensions", description: "", weight: 0.5, directive: { kind: "chordExtensions", level: "sevenths" } },
        { id: "syncopation", description: "", weight: 0.3, directive: { kind: "ratio", feature: "syncopation", target: 0.3 } },
        { id: "swing", description: "", weight: 0.4, directive: { kind: "swing", ratio: 0.62 } },
        { id: "register", description: "", weight: 0.5, directive: { kind: "register", tendency: "low" } },
      ],
    },
    harmonyPlan: { status: "available", version: "HARMONY_PLAN_V1", voicings: [{ bar: 5, pitches: [48, 55, 64], rationale: "open" }] },
  });
  return { ...v2, ...over };
}

// ---------------------------------------------------------------------------
// The map is complete, and silence is never support
// ---------------------------------------------------------------------------

test("every field is classified for every approach — no cell is silent", () => {
  assert.deepEqual(missingClassifications(CONDITIONING_MAP), [], "the shipped map has no gaps");
  for (const field of CONDITIONING_FIELDS) {
    const row = CONDITIONING_MAP[field.path];
    for (const approach of CONDITIONING_APPROACHES) {
      assert.ok(CONDITIONING_DISPOSITIONS.includes(row[approach].status), `${field.path} × ${approach} has a known disposition`);
      assert.ok(row[approach].via.length > 0, `${field.path} × ${approach} names its mechanism or reason`);
    }
  }
  assert.equal(new Set(CONDITIONING_FIELDS.map((f) => f.path)).size, CONDITIONING_FIELDS.length, "no field path listed twice");
});

test("a map that forgets a cell is completed with an explicit 'treated as dropped', mirroring completeDispositions", () => {
  const partial: Record<string, Partial<ConditioningRow>> = { role: { CA2_AS_IS: { status: "APPROXIMATED", via: "x" } } };
  const missing = missingClassifications(partial);
  assert.equal(missing.length, CONDITIONING_FIELDS.length * CONDITIONING_APPROACHES.length - 1);
  const full = completeConditioningMap(partial);
  assert.deepEqual(missingClassifications(full), []);
  assert.equal(full.role.CA2_AS_IS.via, "x");
  assert.equal(full.role.A_VOCAB_EXTENSION.status, "NOT_USEFUL");
  assert.match(full.role.A_VOCAB_EXTENSION.via, /treated as dropped/);
});

test("every property of a fully populated V2 request is the head of some field path", () => {
  const request = fullV2();
  const unmapped = unmappedRequestKeys(request);
  assert.deepEqual(unmapped, [], `request keys the study never looked at: ${unmapped.join(", ")}`);
  // And the walk is not vacuous: a key that is not in the map is reported.
  const stranger = { ...request, somethingNew: 1, section: { ...request.section, colour: "blue" } };
  const found = unmappedRequestKeys(stranger);
  assert.ok(found.includes("somethingNew") && found.includes("section.colour"), `found ${found.join(", ")}`);
});

test("the map lists both V1 and V2 fields and says how each label would come out of PDMX", () => {
  const origins = new Set(CONDITIONING_FIELDS.map((f) => f.origin));
  assert.deepEqual([...origins].sort(), ["v1", "v2"]);
  const byDerivable = { automatic: 0, proxy: 0, none: 0, not_a_label: 0 };
  for (const f of CONDITIONING_FIELDS) byDerivable[f.pdmx.derivable] += 1;
  assert.ok(byDerivable.automatic > 0 && byDerivable.proxy > 0 && byDerivable.none > 0);
  // The honest ones: PDMX has no section labels, so section function cannot be automatic.
  assert.equal(CONDITIONING_FIELDS.find((f) => f.path === "section.function")!.pdmx.derivable, "none");
  assert.equal(CONDITIONING_FIELDS.find((f) => f.path === "context.currentBars.chords")!.pdmx.derivable, "automatic");
  assert.equal(CONDITIONING_FIELDS.find((f) => f.path === "role")!.pdmx.derivable, "proxy");
});

// ---------------------------------------------------------------------------
// Consistency with the PR-56 projection
// ---------------------------------------------------------------------------

/**
 * Where this study is deliberately stronger than PR-56's projection. PR-56
 * declared the whole styleGrammar slot unsupported ("no token for … any
 * grammar rule; only the 512 density/pitch instructions exist"). Four of the
 * grammar's directives *are* those instructions' own measurements, read from
 * encoding_functions.py: onsets per quarter, step share, notes per bar and
 * register bounds. The disagreement is stated here, not hidden in a cell.
 */
const REFINEMENTS_OVER_PR56: Record<string, string> = {
  "styleGrammar.rules[onset-density]": "onsetsPerBeat is CA2's horiz_note_onset_density (onsets per quarter), binned on the same slices",
  "styleGrammar.rules[stepwise-motion]": "stepwise ratio is CA2's pitch_step_prob, binned on the same slices",
  "styleGrammar.rules[density]": "notes per bar = horiz × vert density bins",
  "styleGrammar.rules[register]": "register tendency = lowest/highest_note_loose bounds, what those instructions meant in training",
};

test("the CA2_AS_IS column never claims direct support where the PR-56 projection says unsupported — except where the study says why", () => {
  const request = fullV2();
  const dispositions = projectV2ForComposersAssistant2(request);
  const disagreements: string[] = [];
  // PR-56 field → the map's field paths it stands for.
  const stands: Record<string, string[]> = {
    styleGrammar: CONDITIONING_FIELDS.filter((f) => f.path.startsWith("styleGrammar.rules[")).map((f) => f.path),
    harmonyPlan: ["harmonyPlan.voicings[].pitches"],
    vocalAttentionMap: ["vocalAttentionMap.occupied", "vocalAttentionMap.register"],
    motifMemory: ["motifMemory[].intervals"],
    previousSectionSummary: ["previousSectionSummary.sectionName", "previousSectionSummary.energy"],
    nextSectionIntent: ["nextSectionIntent.sectionName", "nextSectionIntent.approach"],
    role: ["role"],
    phrases: ["phrases[].role", "phrases[].startBar"],
    productionBriefRef: ["productionBriefRef"],
    instrument: ["instrument"],
    "candidateStrategy.seed": ["candidateStrategy.seeds"],
    "siblingParts.notes": ["siblingParts[].notes"],
  };
  for (const d of dispositions) {
    const paths = stands[d.field];
    if (!paths) continue;
    for (const path of paths) {
      const status = CONDITIONING_MAP[path].CA2_AS_IS.status;
      if (d.status === "unsupported" && status === "SUPPORTED_DIRECTLY") disagreements.push(path);
      if (d.status === "received") {
        assert.ok(status === "SUPPORTED_DIRECTLY" || status === "APPROXIMATED", `${path}: PR-56 says received`);
      }
    }
  }
  assert.deepEqual(disagreements.sort(), Object.keys(REFINEMENTS_OVER_PR56).sort(), "every disagreement with PR-56 is a stated refinement, and every stated refinement is real");
  for (const path of Object.keys(REFINEMENTS_OVER_PR56)) {
    assert.match(CONDITIONING_MAP[path].CA2_AS_IS.via, /note|bound|density|step/i, `${path} names the CA2 instruction it rests on`);
  }
});

// ---------------------------------------------------------------------------
// Coverage numbers
// ---------------------------------------------------------------------------

test("coverage counts add up, and the zero-new-token measure is a real fraction", () => {
  const coverage = coverageByApproach();
  for (const approach of CONDITIONING_APPROACHES) {
    const c = coverage[approach];
    const sum = CONDITIONING_DISPOSITIONS.reduce((n, d) => n + c[d], 0);
    assert.equal(sum, c.fields);
    assert.equal(c.fields, CONDITIONING_FIELDS.length);
  }
  // Only A/F introduce tokens; B never does (that is its definition).
  assert.equal(coverage.B_STRUCTURED_PREFIX.TOKEN_CANDIDATE, 0);
  assert.ok(coverage.A_VOCAB_EXTENSION.TOKEN_CANDIDATE > 0);
  assert.ok(coverage.F_CONTROL_TOKENS.CONTROL_CODE_CANDIDATE > 0);
  assert.ok(coverage.G_POST_PROCESS.POST_PROCESS_ONLY > 0);

  const zero = zeroNewTokenCoverage();
  assert.equal(zero.musicalFields + zero.provenanceFields, CONDITIONING_FIELDS.length);
  const now = zero.noTraining;
  assert.equal(now.direct + now.approximated + now.postProcessOnly + now.nothing, zero.musicalFields);
  const later = zero.withFineTune;
  assert.equal(later.direct + later.approximated + later.prefix + later.postProcessOnly + later.nothing, zero.musicalFields);
  // The claim the study rests on: a large share is expressible today, and fine-tuning spare ids widens it.
  assert.ok((now.direct + now.approximated) / zero.musicalFields > 0.4, `today: ${JSON.stringify(now)} of ${zero.musicalFields}`);
  assert.ok(later.nothing < now.nothing, "a prefix with fine-tuned spare ids leaves fewer fields with nothing");
});

// ---------------------------------------------------------------------------
// CA2's surface, from its source
// ---------------------------------------------------------------------------

test("the vocabulary families sum to 1,944 and the instruction table matches encoding_functions.py", () => {
  assert.equal(CA2_VOCABULARY.families.reduce((n, f) => n + f.size, 0), CA2_VOCABULARY.total);
  assert.equal(CA2_VOCABULARY.total, 1944);
  assert.equal(CA2_ASSIGNED_INSTRUCTION_COUNT, 49);
  assert.equal(512 - CA2_ASSIGNED_INSTRUCTION_COUNT, CA2_VOCABULARY.spareIds.instruction);
  assert.equal(258 - 129, CA2_VOCABULARY.spareIds.instrument);
  const ids = CA2_INSTRUCTIONS.map((i) => i.id);
  assert.deepEqual(ids, Array.from({ length: 49 }, (_, i) => i), "ids are 0..48 in assignment order");
  // Bin counts equal slices + 1, as bisect produces.
  const count = (name: string) => CA2_INSTRUCTIONS.filter((i) => i.name === name).length;
  assert.equal(count("horiz_note_onset_density"), CA2_VOCABULARY.slices.horizNoteOnsetDensity.length + 1);
  assert.equal(count("vert_note_onset_density"), CA2_VOCABULARY.slices.vertNoteOnsetDensity.length + 1);
  assert.equal(count("pitch_step_prob"), CA2_VOCABULARY.slices.pitchHistStep.length + 1);
  assert.equal(count("horiz_note_onset_irregularity"), CA2_VOCABULARY.slices.horizNoteOnsetIrregularity.length + 1);
  assert.equal(CA2_INSTRUCTIONS[45].name, "highest_note_strict");
  assert.equal(CA2_INSTRUCTIONS[48].name, "lowest_note_loose");
});

test("ca2Bin is bisect.bisect: right-closed on the slice value", () => {
  const slices = CA2_VOCABULARY.slices.horizNoteOnsetDensity; // [0.5, 1, 2, 4, 4.5]
  assert.equal(ca2Bin(slices, 0.2), 0);
  assert.equal(ca2Bin(slices, 0.5), 1, "a value equal to a slice falls in the upper bin, as bisect does");
  assert.equal(ca2Bin(slices, 2.5), 3);
  assert.equal(ca2Bin(slices, 9), 5);
  assert.equal(loudnessLevelForEnergy(0), 0);
  assert.equal(loudnessLevelForEnergy(1), 7);
  assert.ok(loudnessLevelForEnergy(0.5) >= 2 && loudnessLevelForEnergy(0.5) <= 5);
});

test("chord tones come from canonical fields when present and from the symbol otherwise", () => {
  assert.deepEqual(chordPitchClasses({ symbol: "C", root: "C", quality: "maj" }), [0, 4, 7]);
  assert.deepEqual(chordPitchClasses({ symbol: "Am7" }), [9, 0, 4, 7]);
  assert.deepEqual(chordPitchClasses({ symbol: "F#dim" }), [6, 9, 0]);
  assert.deepEqual(chordPitchClasses({ symbol: "Bb/D" }), [10, 2, 5]);
  assert.deepEqual(chordPitchClasses({ symbol: "N.C." }), []);
});

// ---------------------------------------------------------------------------
// The executable prefix: V2 in CA2's words, with an account
// ---------------------------------------------------------------------------

test("a V2 request becomes CA2 instruction strings with the exact ids the encoder assigns", () => {
  const out = expressV2InCa2Vocabulary(fullV2());
  // onsetsPerBeat 2.5 → horiz bin 3 → id 1+3 = 4
  assert.ok(out.commandsAtEnd.includes(";<instruction_4>"), out.commandsAtEnd);
  // PAD with sevenths → vert bin 3 → id 7+3 = 10, and n_pitch_classes bin 3 → id 26+3 = 29
  assert.ok(out.commandsAtEnd.includes(";<instruction_10>"));
  assert.ok(out.commandsAtEnd.includes(";<instruction_29>"));
  // stepwise 0.7 → step bin 4 → id 12+4 = 16; leapRatio 0.2 → leap bin 2 → id 19+2 = 21
  assert.ok(out.commandsAtEnd.includes(";<instruction_16>"));
  assert.ok(out.commandsAtEnd.includes(";<instruction_21>"));
  // syncopation 0.3 → irregularity bin 2 → id 31+2 = 33
  assert.ok(out.commandsAtEnd.includes(";<instruction_33>"));
  // loose bounds: comfortable 48–84 ∩ playable 36–96, capped under the vocal (67−2 = 65), then shifted low.
  assert.match(out.commandsAtEnd, /;<instruction_48>;N:48;<instruction_47>;N:(\d+)/);
  const hi = Number(/;<instruction_47>;N:(\d+)/.exec(out.commandsAtEnd)![1]);
  assert.ok(hi <= 65 && hi >= 60, `upper bound ${hi} sits under the vocal and above an octave`);
  // Strict bounds are never sent: they meant the true extremes in training.
  assert.ok(!out.commandsAtEnd.includes(";<instruction_45>") && !out.commandsAtEnd.includes(";<instruction_46>"));
  // Sibling notes exist and the part is pitched → not-an-octave-doubling on every masked cell.
  assert.equal(out.trackMeasureCommands, ";<instruction_39>");
  // One loudness level per bar of the window (5..8 = 4 bars), none fixed at the worker's 5 by accident.
  assert.equal(out.loudnessLevels.length, 4);
  assert.ok(out.loudnessLevels.every((l) => l >= 0 && l <= 7));
  // Harmony as a guide track of chord tones; the vocal as a voice track.
  const harmony = out.guideTracks.find((g) => g.purpose === "harmony")!;
  assert.equal(harmony.program, 48);
  assert.ok(harmony.notes.some((n) => n.pitch % 12 === 9 && n.start === 10), "Am7 in bar 6 contributes an A");
  assert.equal(out.guideTracks.find((g) => g.purpose === "vocal")!.program, 53);
  // The locked bar 5 (seconds 8–10) is left unmasked.
  assert.deepEqual(out.unmaskedBars, [5]);
  assert.deepEqual(out.contextBars, { before: 2, after: 2 });
  // The account: what went in and what could not, both non-empty and both named.
  assert.ok(out.expressed.some((e) => e.field === "styleGrammar.rules[onset-density]"));
  assert.ok(out.omitted.some((o) => o.field === "section.function"));
  assert.ok(out.omitted.some((o) => o.field === "styleGrammar.rules[swing]"), "swing is named as left to the groove pass");
});

test("with nothing to say the expression is empty and honest, not invented", () => {
  const bare = fullV2({
    styleGrammar: STYLE_GRAMMAR_PENDING, harmonyPlan: HARMONY_PLAN_PENDING, siblingParts: [],
    vocalAttentionMap: { status: "no_vocal", occupied: [], gaps: [], fillWindows: [], register: null, occupancy: 0, dense: false },
    lockedMaterial: { notes: [], frozenRanges: [], reason: null },
    context: { ...fullV1().context, currentBars: { startBar: 5, endBar: 8, chords: [], melody: [], bass: [] } },
  });
  const out = expressV2InCa2Vocabulary(bare);
  assert.equal(out.trackMeasureCommands, "");
  assert.deepEqual(out.guideTracks, []);
  assert.deepEqual(out.unmaskedBars, []);
  // Range and the planner's density still speak; nothing else is made up.
  // section.density 0.4 → horiz bin 2 → id 3; PAD without a grammar → vert bin 3 → id 10, n-pitch-classes bin 3 → id 29.
  assert.match(out.commandsAtEnd, /^;<instruction_48>;N:48;<instruction_47>;N:84;<instruction_3>;<instruction_10>;<instruction_29>$/);
  assert.ok(out.omitted.some((o) => o.field === "context.currentBars.chords"));
  // Deterministic.
  assert.deepEqual(expressV2InCa2Vocabulary(bare), out);
});

test("a bass part is asked for a mono line and a drum part gets drum-note bounds", () => {
  const bass = expressV2InCa2Vocabulary(fullV2({ role: "BASS", instrument: "bass", constraints: { ...fullV1().constraints, maxSimultaneousNotes: 2 } }));
  assert.ok(bass.commandsAtEnd.includes(";<instruction_7>"), "vert bin 0 = mono");
  assert.ok(!bass.commandsAtEnd.includes(";<instruction_26>") && !bass.commandsAtEnd.includes(";<instruction_29>"), "no pitch-class instruction for a mono line");
  const drums = expressV2InCa2Vocabulary(fullV2({ role: "GROOVE", instrument: "drums", siblingParts: [] }));
  assert.match(drums.commandsAtEnd, /;<instruction_48>;D:\d+;<instruction_47>;D:\d+/);
  assert.equal(drums.trackMeasureCommands, "", "a drum part is not asked to avoid octave doublings");
});
