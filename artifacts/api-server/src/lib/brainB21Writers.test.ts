/**
 * Brain B-21: the note writers write music a musician would sign.
 *
 * Four defects the brain's own critics reported on the owner's song "רחם נא"
 * (run v7a, `docs/evidence/brain-b21-writers.json` holds the measurements):
 *
 *   1. the two-bar intro shipped **silent** although the arc decided a
 *      `tonic_pad` on a tonic the chord analysis had not found;
 *   2. the verses arpeggiated 12-16 notes a second in a ten-semitone box while
 *      the choruses held long chords;
 *   3. the bass had no onset in 12 of Verse 3's 24 bars and 7 of the Outro's 13;
 *   4. the strings reached MIDI 92 and the keys 89, above the ceilings
 *      `instrumentProfile.ts` gives those parts in those roles.
 *
 * Each test names the measured cause and carries a control: a case in which
 * the fixed behaviour must **not** fire, so a passing assertion is evidence of
 * sensitivity and not of a constant.
 */
import assert from "node:assert/strict";
import test from "node:test";
import type { ArrangementArc, ChordHarmonyEvent } from "@workspace/db";
import { orchestrateArrangement } from "./arrangementOrchestrator";
import { composeReferencePart } from "./referencePartComposer";
import { deriveGlobalArrangementPlan } from "./globalArrangementPlanner";
import { deriveSectionPhrasePlan } from "./sectionPhrasePlanner";
import { deriveOrchestrationBudget } from "./orchestrationBudget";
import { deriveTransitionPlan } from "./transitionEngine";
import { buildPartComposerPlan, buildPartGenerationRequest, type PartGenerationRequest } from "./partComposer";
import { barTiming, type ComposeFrame } from "./composer/frame";
import { registerBounds, registerWindowFor, roleRegisterOf, MIN_REGISTER_WINDOW } from "./composer/registers";
import { BASELINE_TEXTURE, chordalTextureFor, textureIntentFor } from "./composer/texture";
import { CANDIDATE_STRATEGIES } from "./candidateStrategies";
import { barsOf, bassRhythmFor, grooveOf } from "./composer/rhythmParts";
import { endingIntentFor, openingFigureFor } from "./composer/opening";
import { comfortableCeilingFor } from "./critics/dimensions/register";
import { getInstrumentDefinition } from "./musicEngines";
import { DecisionRegistry } from "./decisionProvenance";
import { RACHEM_NA_FIXED_NOW, rachemNaSongModel } from "./__fixtures__/rachemNaSongModelV3";

const NOW = new Date(0);

/** The owner's brief as the arrangement hints of run v7 (`<scratchpad>/rachem/arrange8.mjs`). */
const OWNER_HINTS = {
  global: {
    arcTemplate: "intimate_ballad",
    sectionDynamics: { "Intro": "p", "Verse 1": "mp", "Verse 2": "mp", "Chorus": "mf", "Chorus 2": "mf", "Verse 3": "mp", "Bridge": "mp", "Chorus 3": "f", "Outro": "p" },
    textureLevels: { "Intro": "duo", "Verse 1": "bed", "Verse 2": "bed", "Chorus": "full", "Chorus 2": "full", "Verse 3": "bed", "Bridge": "bed", "Chorus 3": "tutti", "Outro": "duo" },
    climaxSectionName: "Chorus 3",
    grooveStrategy: "half_time_feel",
    paletteAdd: ["keys", "strings", "percussion"],
    paletteRemove: ["drums", "pads", "synth", "guitar"],
    familyPriority: ["keys", "strings", "bass", "percussion"],
    familyDynamicSteps: { strings: -1, bass: -1, percussion: -1 },
    familyEmphasis: { keys: "feature", strings: "support", bass: "support", percussion: "support" },
    introFigure: "tonic_pad",
    endingGesture: "held_final_chord",
    productionAesthetic: "intimate",
  },
  section: { sectionFamilies: { "Intro": { remove: ["percussion"], add: ["keys"] }, "Outro": { remove: ["percussion"], add: ["keys", "strings"] } } },
} as unknown as Parameters<typeof orchestrateArrangement>[0]["plannerHints"];

type OwnerParts = {
  requests: PartGenerationRequest[];
  notesFor: (sectionName: string, instrument: string) => ReturnType<typeof composeReferencePart>;
  requestFor: (sectionName: string, instrument: string) => PartGenerationRequest;
  frameFor: (request: PartGenerationRequest) => ComposeFrame;
  barSeconds: number;
  arc: ArrangementArc | undefined;
};

let cachedOwner: OwnerParts | null = null;

function ownerParts(): OwnerParts {
  if (cachedOwner) return cachedOwner;
  const model = rachemNaSongModel();
  const now = RACHEM_NA_FIXED_NOW;
  const hints = OWNER_HINTS!;
  const globalPlan = deriveGlobalArrangementPlan(model, { now, hints: hints.global });
  const sectionPlan = deriveSectionPhrasePlan(model, globalPlan, { now, hints: hints.section });
  const budget = deriveOrchestrationBudget(model, sectionPlan, { now });
  const transitions = deriveTransitionPlan(model, globalPlan, sectionPlan, { now });
  const partPlan = buildPartComposerPlan(model, globalPlan, sectionPlan, transitions.transitions, { now });
  const layers = { globalPlan, sectionPlan, budgetWindows: budget.windows, transitions: transitions.transitions };
  const tempoBpm = model.tempoMap[0].bpm;
  const meter = model.meterMap[0].meter;
  const timing = barTiming(tempoBpm, meter);
  const requests = partPlan.tasks.map((task) => buildPartGenerationRequest(model, task, layers, []));
  const requestFor = (sectionName: string, instrument: string) => {
    const found = requests.find((r) => r.section.sectionName === sectionName && r.instrument === instrument);
    assert.ok(found, `no part request for ${instrument} in ${sectionName}`);
    return found;
  };
  const frameFor = (request: PartGenerationRequest): ComposeFrame => {
    const origin = 0;
    const startSeconds = origin + (request.section.startBar - 1) * timing.barSeconds;
    const endSeconds = origin + request.section.endBar * timing.barSeconds;
    const { lo, hi } = registerBounds(request);
    const budgetWindow = request.budgetWindows[0];
    const density = Math.max(0.15, Math.min(1, request.section.density * (budgetWindow ? budgetWindow.budgets.totalDensity : 1)));
    return {
      request, ...timing, origin, startSeconds, endSeconds, lo, hi,
      chords: (request.context.currentBars.chords ?? []).filter((c) => c.end > startSeconds && c.start < endSeconds).sort((a, b) => a.start - b.start),
      seed: request.seed, density, energy: request.section.energy,
      baseVelocity: 52 + request.section.energy * 55,
      push: () => {},
    };
  };
  cachedOwner = {
    requests,
    requestFor,
    frameFor,
    notesFor: (sectionName, instrument) => composeReferencePart(requestFor(sectionName, instrument), { tempoBpm, meter, originSeconds: 0 }),
    barSeconds: timing.barSeconds,
    arc: globalPlan.arc,
  };
  return cachedOwner;
}

/** Bars of the part's section in which the instrument has at least one onset. */
function barsWithOnset(notes: ReadonlyArray<{ start: number }>, barSeconds: number): Set<number> {
  return new Set(notes.map((n) => Math.floor(n.start / barSeconds + 1e-6) + 1));
}

// ---------------------------------------------------------------------------
// D4 — the register the instrument's own profile gives this part
// ---------------------------------------------------------------------------

test("D4: a part's register window is the role register its profile gives it, and that is the ceiling the register critic reads", () => {
  // The single source of truth. Before B-21 the composer took the *family's*
  // comfortable range and widened it by the argmax of the section's register
  // histogram, and the critic read `roleRegisterFor`; the two disagreed by up
  // to 35 semitones (piano HARMONIC_BED: composer 36-102, critic ceiling 67).
  for (const [instrument, role] of [
    ["keys", "HARMONIC_BED"], ["keys", "RHYTHMIC_HARMONY"],
    ["strings", "PAD"], ["strings", "CLIMAX_LAYER"], ["bass", "BASS"],
  ] as const) {
    const profileRegister = roleRegisterOf(instrument, role);
    assert.ok(profileRegister, `${instrument}/${role}: the profile answers`);
    const request = {
      instrument, role,
      constraints: {
        playableRange: getInstrumentDefinition(instrument, role).playableRange,
        comfortableRange: getInstrumentDefinition(instrument, role).comfortableRange,
      },
      section: { registerDistribution: { high: 1 } },
      formMemory: { developmentOperator: "identity" },
    } as unknown as PartGenerationRequest;
    const window = registerWindowFor(request);
    const definition = getInstrumentDefinition(instrument, role);
    assert.equal(window.source, "role_register", `${instrument}/${role}: the role register answers`);
    // The window is the role register intersected with the instrument's own
    // playable and comfortable ranges - the string section's CLIMAX_LAYER
    // register reaches 91 and its comfortable range stops at 86; the narrower
    // of the two is what a section actually sounds well on.
    assert.equal(window.hi, Math.min(profileRegister.hi, definition.comfortableRange.max), `${instrument}/${role}: the ceiling is the profile's`);
    // And it never exceeds the ceiling the register critic reads from the same table.
    const critic = comfortableCeilingFor({ track: { instrumentDefinition: definition }, comfortableRange: definition.comfortableRange } as never, role);
    assert.ok(window.hi <= critic.ceiling, `${instrument}/${role}: writer ceiling ${window.hi} <= critic ceiling ${critic.ceiling} (${critic.source})`);
  }
});

test("D4 control: the section's register histogram no longer moves a part, and an instrument with no profile says so", () => {
  const base = (band: string) => ({
    instrument: "keys", role: "HARMONIC_BED",
    constraints: { playableRange: { min: 21, max: 108 }, comfortableRange: { min: 36, max: 96 } },
    section: { registerDistribution: { [band]: 1 } },
    formMemory: { developmentOperator: "identity" },
  } as unknown as PartGenerationRequest);
  const high = registerWindowFor(base("high"));
  const mid = registerWindowFor(base("mid"));
  const low = registerWindowFor(base("low"));
  assert.deepEqual([high.lo, high.hi], [mid.lo, mid.hi], "an `upper` section does not raise this part");
  assert.deepEqual([low.lo, low.hi], [mid.lo, mid.hi], "nor does a `low` one lower it");
  // The pre-B-21 arithmetic, quoted as the defect it was: comfortable.max + 12,
  // clamped only by the playable maximum.
  assert.ok(high.hi < Math.min(108, 96 + 12), `the old rule would have reached ${Math.min(108, 96 + 12)}; the window stops at ${high.hi}`);
  assert.match(high.reason, /histogram/);

  // Control: a name no profile knows keeps the family's comfortable range and
  // says which answer it used, rather than inventing a role register.
  const unknown = registerWindowFor({
    instrument: "theremin-of-the-spheres", role: "HARMONIC_BED",
    constraints: { playableRange: { min: 40, max: 90 }, comfortableRange: { min: 50, max: 80 } },
    section: { registerDistribution: {} },
    formMemory: { developmentOperator: "identity" },
  } as unknown as PartGenerationRequest);
  assert.equal(unknown.source, "constraints_comfortable");
  assert.deepEqual([unknown.lo, unknown.hi], [50, 80]);
});

test("D4: raise_register lifts the floor inside the window and never the ceiling; a family with no register to raise is untouched", () => {
  const of = (instrument: string, role: string, operator: string) => registerWindowFor({
    instrument, role,
    constraints: {
      playableRange: getInstrumentDefinition(instrument, role).playableRange,
      comfortableRange: getInstrumentDefinition(instrument, role).comfortableRange,
    },
    section: { registerDistribution: {} },
    formMemory: { developmentOperator: operator },
  } as unknown as PartGenerationRequest);
  const plain = of("keys", "HARMONIC_BED", "identity");
  const raised = of("keys", "HARMONIC_BED", "raise_register");
  assert.ok(raised.lo > plain.lo, "the floor rises");
  assert.equal(raised.hi, plain.hi, "the ceiling does not");
  assert.ok(raised.hi - raised.lo >= MIN_REGISTER_WINDOW, "and never leaves less than an octave");
  assert.match(raised.reason, /raise_register/);
  // Control: `REGISTER_SHIFTABLE_FAMILIES` (arrangementArc.ts) is keys, guitar
  // and synth - a bowed section or a foundation that moves up is not a
  // brighter arrangement, and the operator does not touch them.
  for (const [instrument, role] of [["bass", "BASS"], ["strings", "PAD"]] as const) {
    const before = of(instrument, role, "identity");
    const after = of(instrument, role, "raise_register");
    assert.deepEqual([after.lo, after.hi], [before.lo, before.hi], `${instrument} does not shift`);
  }
});

test("D4 on the owner's song: no part is written above the ceiling its own profile gives it", () => {
  const owner = ownerParts();
  const offenders: string[] = [];
  for (const request of owner.requests) {
    const profileRegister = roleRegisterOf(request.instrument, request.role);
    if (!profileRegister || !profileRegister.fromRole) continue;
    const notes = composeReferencePart(request, { tempoBpm: 130.43, meter: "4/4", originSeconds: 0 });
    if (!notes.length) continue;
    const top = Math.max(...notes.map((n) => n.pitch));
    if (top > profileRegister.hi) offenders.push(`${request.section.sectionName}/${request.instrument} ${request.role}: ${top} > ${profileRegister.hi}`);
  }
  assert.deepEqual(offenders, [], "measured before B-21: strings 92 > 91 (CLIMAX_LAYER) and keys 89 > 67 (HARMONIC_BED) in Chorus 3");
});

// ---------------------------------------------------------------------------
// D2 — the arpeggio is a broken chord, and the arc's level chooses the rate
// ---------------------------------------------------------------------------

const intentFor = (strategy: keyof typeof CANDIDATE_STRATEGIES, multiplier: number) =>
  textureIntentFor(strategy, CANDIDATE_STRATEGIES[strategy].bias, multiplier);

test("D2: an `arpeggiated_8ths` comp is a broken chord, and a block comp is not", () => {
  const arp = chordalTextureFor({
    task: "PIANO", role: "RHYTHMIC_HARMONY", family: "keys", level: "bed", arcLevel: 0.44,
    intent: BASELINE_TEXTURE, plannedRhythmicCell: "arpeggiated_8ths", plannedBedCell: "whole_note_bed",
  });
  assert.equal(arp.archetype, "arpeggio");
  assert.equal(arp.brokenChord, true, "one voice per onset, not the whole voicing on every eighth");
  // Control: the same part on a block cell is not a broken chord.
  const block = chordalTextureFor({
    task: "PIANO", role: "RHYTHMIC_HARMONY", family: "keys", level: "bed", arcLevel: 0.44,
    intent: BASELINE_TEXTURE, plannedRhythmicCell: "quarter_pulses", plannedBedCell: "whole_note_bed",
  });
  assert.equal(block.archetype, "block");
  assert.equal(block.brokenChord, false);
});

test("D2: the arc's level decides how often a struck bed re-articulates; a bowed bed still holds", () => {
  const keys = (level: "duo" | "bed" | "full" | "tutti", arcLevel: number) => chordalTextureFor({
    task: "KEYS", role: "HARMONIC_BED", family: "keys", level, arcLevel,
    intent: BASELINE_TEXTURE, plannedRhythmicCell: "arpeggiated_8ths", plannedBedCell: "whole_note_bed",
  });
  assert.equal(keys("tutti", 0.67).onsetCell, "quarter_pulses", "an arrival is heard, not held");
  assert.equal(keys("full", 0.55).onsetCell, "quarter_pulses");
  assert.equal(keys("bed", 0.44).onsetCell, "whole_note_bed", "a bed-texture verse holds the chord");
  assert.equal(keys("duo", 0.25).archetype, "sustained", "and a duo holds it without re-striking at all");
  // Control: a bowed section holds whatever the level is — a string bed
  // re-struck on every pulse is not a string bed.
  const strings = (level: "bed" | "tutti", arcLevel: number) => chordalTextureFor({
    task: "STRINGS", role: "PAD", family: "strings", level, arcLevel,
    intent: BASELINE_TEXTURE, plannedRhythmicCell: "arpeggiated_8ths", plannedBedCell: "whole_note_bed",
  });
  assert.equal(strings("tutti", 0.67).archetype, "sustained");
  assert.equal(strings("tutti", 0.67).onsetCell, "whole_note_bed");
  assert.equal(strings("bed", 0.44).archetype, "sustained");
});

test("D2 on the owner's song: the choruses are no longer four to six times thinner than the verses", () => {
  const owner = ownerParts();
  const perBar = (sectionName: string) => {
    const request = owner.requestFor(sectionName, "keys");
    const notes = owner.notesFor(sectionName, "keys");
    const bars = request.section.endBar - request.section.startBar + 1;
    return { notes: notes.length, perBar: notes.length / bars, onsets: new Set(notes.map((n) => n.start.toFixed(3))).size / bars };
  };
  const verse1 = perBar("Verse 1");
  const verse2 = perBar("Verse 2");
  const chorus = perBar("Chorus");
  const chorus3 = perBar("Chorus 3");
  // Measured before B-21 (composed notes): Verse 1 501, Verse 2 488, Chorus
  // 100, Chorus 3 108 — a verse five times the size of its arrival.
  assert.ok(verse1.notes < 260, `Verse 1 keys ${verse1.notes} notes (was 501)`);
  assert.ok(verse2.notes < 260, `Verse 2 keys ${verse2.notes} notes (was 488)`);
  assert.ok(chorus.perBar > verse2.perBar, `the arrival carries more notes a bar than its setup (${chorus.perBar.toFixed(1)} vs ${verse2.perBar.toFixed(1)})`);
  assert.ok(chorus3.perBar > verse1.perBar, `and so does the climax (${chorus3.perBar.toFixed(1)} vs ${verse1.perBar.toFixed(1)})`);
  // Control: the verse is still a moving broken chord, not a held pad — the
  // fix must not turn the verses into the choruses.
  assert.ok(verse1.onsets >= 4, `Verse 1 keys still attacks ${verse1.onsets.toFixed(1)} times a bar`);
});

// ---------------------------------------------------------------------------
// D3 — the pedal bass keeps the plan's onsets
// ---------------------------------------------------------------------------

test("D3: a pedal bass plays the plan's own onsets plus the chord starts, in every bar", () => {
  const owner = ownerParts();
  const request = owner.requestFor("Verse 1", "bass");
  const frame = owner.frameFor(request);
  const groove = grooveOf(frame);
  assert.equal(groove.kickBass.value, "pedal", "the owner's Verse 1 is planned as a held root");
  assert.deepEqual(groove.bassUnits, [0], "and the plan's onset is the downbeat of every bar");
  const onsets = bassRhythmFor(frame);
  const bars = new Set(onsets.map((o) => o.bar));
  // Every bar is attacked or tied. A bar whose downbeat the previous bar
  // anticipated is deliberately *not* re-struck (`barsOf().tiedDownbeat`, the
  // shared anticipation every part honours): the root arrived early and is
  // held over the bar line, which is a foundation and not a gap.
  const tied = new Set(barsOf(frame, groove).filter((b) => b.tiedDownbeat).map((b) => b.bar));
  for (let bar = request.partWindow.startBar; bar <= request.partWindow.endBar; bar += 1) {
    assert.ok(bars.has(bar) || tied.has(bar), `bar ${bar} is attacked or tied (before B-21 the writer discarded groove.bassUnits and re-articulated only every second bar)`);
  }
  // Control: the onsets are still the plan's, not a grid of this writer's own
  // invention — every onset is either the downbeat or a chord start.
  const chordStarts = new Set(request.context.currentBars.chords.map((c: ChordHarmonyEvent) => Number(c.start.toFixed(1))));
  for (const onset of onsets) {
    const isDownbeat = onset.unit === 0;
    const isChordStart = chordStarts.has(Number(onset.start.toFixed(1))) || chordStarts.has(Number((onset.start + 0.1).toFixed(1)));
    assert.ok(isDownbeat || isChordStart || onset.anticipates, `onset at bar ${onset.bar} unit ${onset.unit} comes from the plan`);
  }
});

test("D3 on the owner's song: no verse or outro bar is left without a bass note", () => {
  const owner = ownerParts();
  for (const sectionName of ["Verse 1", "Verse 3", "Outro"]) {
    const request = owner.requestFor(sectionName, "bass");
    const notes = owner.notesFor(sectionName, "bass");
    const played = barsWithOnset(notes, owner.barSeconds);
    const empty: number[] = [];
    for (let bar = request.partWindow.startBar; bar <= request.partWindow.endBar; bar += 1) {
      const barStart = (bar - 1) * owner.barSeconds;
      const sounds = played.has(bar) ||
        notes.some((n) => n.start < barStart + owner.barSeconds - 1e-6 && n.start + n.duration > barStart + 1e-6);
      if (!sounds) empty.push(bar);
    }
    const bars = request.partWindow.endBar - request.partWindow.startBar + 1;
    // `density:foundation_gaps` fires from 20 % of a section's bars empty; it
    // was major (>= 40 %) in Verse 3 (12 of 24) and the Outro (7 of 13).
    assert.ok(empty.length / bars < 0.2, `${sectionName}: ${empty.length} of ${bars} bars without a bass onset (${empty.join(", ")})`);
  }
});

// ---------------------------------------------------------------------------
// D1 — the intro is the tonic, and the ending is the arc's
// ---------------------------------------------------------------------------

test("D1: the opening figure is the arc's decision, read and not re-derived", () => {
  const owner = ownerParts();
  assert.ok(owner.arc?.opening, "the arc decided an opening");
  const opening = owner.arc!.opening!.value;
  assert.equal(opening.figure, "tonic_pad");
  assert.equal(opening.impliesTonic, true);

  const keys = owner.requestFor("Intro", "keys");
  const figure = openingFigureFor(owner.frameFor(keys), false);
  assert.ok(figure, "the Intro writer is given the figure");
  assert.equal(figure!.figure, "tonic_pad");
  assert.equal(figure!.plays, true, "the arc names keys among the families");
  assert.ok(figure!.chord, "and a chord to state it on");
  assert.equal(figure!.chordSource, "next_bars", "the tonic comes from the song's first analysed chord, not from a pitch this module chose");

  // Control 1: a section that already carries harmony is not overridden.
  assert.equal(openingFigureFor(owner.frameFor(keys), true), null);
  // Control 2: a section that is not the arc's opening section gets nothing.
  assert.equal(openingFigureFor(owner.frameFor(owner.requestFor("Verse 1", "keys")), false), null);
  // Control 3: an arc that decided `none` produces no figure.
  const noFigure = owner.frameFor(keys);
  const withNone = {
    ...noFigure,
    request: { ...noFigure.request, globalPlan: { ...noFigure.request.globalPlan, arc: { ...owner.arc!, opening: { ...owner.arc!.opening!, value: { ...opening, figure: "none" } } } } },
  } as ComposeFrame;
  assert.equal(openingFigureFor(withNone, false), null);
  // Control 4: `impliesTonic: false` means the intro really is empty.
  const withoutTonic = {
    ...noFigure,
    request: { ...noFigure.request, globalPlan: { ...noFigure.request.globalPlan, arc: { ...owner.arc!, opening: { ...owner.arc!.opening!, value: { ...opening, impliesTonic: false } } } } },
  } as ComposeFrame;
  assert.equal(openingFigureFor(withoutTonic, false), null);
});

test("D1 on the owner's song: the intro sounds, and it sounds the tonic", () => {
  const owner = ownerParts();
  const keys = owner.notesFor("Intro", "keys");
  const bass = owner.notesFor("Intro", "bass");
  assert.ok(keys.length > 0, "the piano states the intro (before B-21 it wrote 0 notes and the earliest note of the song was at 3.795 s)");
  assert.ok(bass.length > 0, "and so does the bass");
  assert.ok(Math.min(...[...keys, ...bass].map((n) => n.start)) < owner.barSeconds, "from the first bar");
  // The tonic of this song is C; every note of the figure is a tone of the
  // chord the arc says the intro implies.
  const firstChord = owner.requestFor("Intro", "keys").context.nextBars.chords[0];
  assert.ok(firstChord, "the song's first analysed chord");
  assert.equal(firstChord.root ?? firstChord.symbol.slice(0, 1), "C");
  assert.deepEqual([...new Set(bass.map((n) => n.pitch % 12))], [0], "the bass holds C");
});

test("D1: the ending is the arc's gesture, not the section's level", () => {
  const owner = ownerParts();
  const frame = owner.frameFor(owner.requestFor("Outro", "keys"));
  const ending = endingIntentFor(frame);
  assert.ok(ending);
  assert.equal(ending!.gesture, "held_final_chord");
  assert.equal(ending!.ritardando, true, "and the arc asks for a ritardando (the agogic belongs to the performance stage)");
  // The Outro's own level is 0.25, which the level-only rule read as
  // `thin_out` — the staccato close R-1b P1-7 heard.
  assert.ok((frame.request.arcIntent?.level ?? 1) < 0.45, "the level rule would have thinned it");
  // Control: an arc that says `fade` is not read as a held chord.
  const faded = {
    ...frame,
    request: { ...frame.request, globalPlan: { ...frame.request.globalPlan, arc: { ...owner.arc!, ending: { ...owner.arc!.ending!, value: { ...owner.arc!.ending!.value, gesture: "fade" } } } } },
  } as ComposeFrame;
  assert.equal(endingIntentFor(faded)!.gesture, "fade");
});

// ---------------------------------------------------------------------------
// Provenance and determinism
// ---------------------------------------------------------------------------

test("every writer decision can say why: the registry carries the register, the texture, the bass line and the arc figures", () => {
  const owner = ownerParts();
  const decisions = new DecisionRegistry();
  for (const sectionName of ["Intro", "Verse 1", "Chorus 3", "Outro"]) {
    for (const instrument of ["keys", "bass"]) {
      composeReferencePart(owner.requestFor(sectionName, instrument), { tempoBpm: 130.43, meter: "4/4", originSeconds: 0, decisions });
    }
  }
  const kinds = new Set(decisions.decisions().map((d) => d.kind));
  for (const kind of ["register_window", "chordal_texture", "bass_line", "opening_figure", "ending_gesture"]) {
    assert.ok(kinds.has(kind), `the writers registered "${kind}"`);
  }
  for (const record of decisions.decisions()) {
    assert.ok(record.reason.trim().length > 0, `${record.id} carries a reason`);
    assert.ok(record.instrument && record.sectionName, `${record.id} says whose decision it is`);
  }
  assert.ok(decisions.rangesFor("keys").length > 0, "and the keys' bars are attributed to them");

  // Control: without a registry the writers behave identically and record
  // nothing — the seam is observation, never a second code path.
  const withRegistry = composeReferencePart(owner.requestFor("Verse 1", "keys"), { tempoBpm: 130.43, meter: "4/4", originSeconds: 0, decisions: new DecisionRegistry() });
  const without = composeReferencePart(owner.requestFor("Verse 1", "keys"), { tempoBpm: 130.43, meter: "4/4", originSeconds: 0 });
  assert.deepEqual(withRegistry, without);
});

test("the writers stay deterministic: the same request twice is the same notes", () => {
  const owner = ownerParts();
  for (const sectionName of ["Intro", "Verse 1", "Chorus", "Outro"]) {
    for (const instrument of ["keys", "bass"]) {
      assert.deepEqual(owner.notesFor(sectionName, instrument), owner.notesFor(sectionName, instrument), `${sectionName}/${instrument}`);
    }
  }
});

// ---------------------------------------------------------------------------
// End to end: the judge on the owner's song
// ---------------------------------------------------------------------------

test("end to end: the owner's song is composed with an audible intro, a foundation in every bar and nothing above its ceilings", () => {
  const result = orchestrateArrangement({
    songModel: rachemNaSongModel(), candidateCount: 3, render: false, now: NOW, plannerHints: OWNER_HINTS,
  });
  assert.ok(result.selected, `a candidate ships: ${result.selection.reason}`);
  const selected = result.candidates.find((c) => c.candidateId === result.selected!.candidateId)!;
  const barSeconds = (60 / 130.43) * 4;
  const first = Math.min(...selected.trackModels.flatMap((t) => t.notes.map((n) => n.start)));
  assert.ok(first < barSeconds, `the song starts in bar 1, not at ${first.toFixed(3)} s (measured before B-21: 3.795 s)`);
  // One track carries every role its instrument holds across the song (the
  // owner's strings are a PAD in the verses and a CLIMAX_LAYER in the last
  // chorus, and the orchestrator merges both onto `strings-pad`), so the
  // ceiling to check a *track* against is the highest of its parts' own.
  const rolesOf = new Map<string, Set<string>>();
  for (const assignment of selected.plan.sectionPlan!.roleAssignments) {
    rolesOf.set(assignment.instrument, (rolesOf.get(assignment.instrument) ?? new Set<string>()).add(assignment.role));
  }
  for (const track of selected.trackModels) {
    const roles = [...(rolesOf.get(track.instrument) ?? new Set([track.role]))];
    const ceilings = roles.map((role) => roleRegisterOf(track.instrument, role)).filter((r) => r && r.fromRole).map((r) => r!.hi);
    if (!ceilings.length || !track.notes.length) continue;
    const ceiling = Math.max(...ceilings);
    const above = track.notes.filter((n) => n.pitch > ceiling).length / track.notes.length;
    assert.ok(above < 0.05, `${track.id}: ${(above * 100).toFixed(1)} % of notes above ${ceiling} (roles ${roles.join("+")})`);
  }
});
