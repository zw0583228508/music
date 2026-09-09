import assert from "node:assert/strict";
import test from "node:test";

import type { FormInput, FormNote, FormTrack } from "./formSegmentation";
import type { ParsedMidi } from "./midiFile";
import {
  MIN_BARS,
  MIN_BOUNDARY_F1,
  MIN_DENSITY_SPREAD,
  MIN_FAMILIES,
  MIN_SECTIONS,
  PLANNING_FILTERS,
  PLANNING_SUPERVISION_VERSION,
  admitPlanningSupervision,
  boundaryAgreement,
  dominantMetreShare,
  extractPlanningSupervision,
  guessFunctions,
  orchestrationStrategyOf,
  planningSupervisionFromMidi,
  platformFamilyOf,
  registerBandOf,
  renderPlanText,
} from "./planningSupervision";

// ---------------------------------------------------------------------------
// A piece builder with a known form. Units are beats; a bar is four beats.
// Families: reed (melody), keys, bass, drums.
// ---------------------------------------------------------------------------

const BEATS = 4;
const note = (start: number, end: number, pitch: number, velocity = 80): FormNote => ({ start, end, pitch, velocity });

type Kind = "A" | "B" | "C" | "intro" | "outro";

function makeTracks(): FormTrack[] {
  return [
    { id: "melody", family: "reed", isPercussion: false, notes: [] },
    { id: "keys", family: "keys", isPercussion: false, notes: [] },
    { id: "bass", family: "bass", isPercussion: false, notes: [] },
    { id: "drums", family: "drums", isPercussion: true, notes: [] },
  ];
}

function addBlock(tracks: FormTrack[], bar0: number, kind: Kind, bars: number): void {
  const [melody, keys, bass, drums] = tracks;
  for (let bar = bar0; bar < bar0 + bars; bar += 1) {
    const t0 = bar * BEATS;
    if (kind === "A") {
      const line = [60, 62, 64, 65, 67, 65, 64, 62];
      for (let beat = 0; beat < BEATS; beat += 1) melody.notes.push(note(t0 + beat, t0 + beat + 1, line[(bar % 2) * 4 + beat]));
      for (const p of [48, 52, 55]) keys.notes.push(note(t0, t0 + BEATS, p, 70));
      bass.notes.push(note(t0, t0 + 2, 36), note(t0 + 2, t0 + 4, 43));
    } else if (kind === "B") {
      const line = [79, 72, 76, 74, 77, 72, 79, 76];
      for (let eighth = 0; eighth < 8; eighth += 1) melody.notes.push(note(t0 + eighth / 2, t0 + (eighth + 1) / 2, line[eighth], 96));
      for (const p of [53, 57, 60, 65]) keys.notes.push(note(t0, t0 + BEATS, p, 90));
      for (let beat = 0; beat < BEATS; beat += 1) bass.notes.push(note(t0 + beat, t0 + beat + 1, 41));
      for (let eighth = 0; eighth < 8; eighth += 1) drums.notes.push(note(t0 + eighth / 2, t0 + eighth / 2 + 0.25, 42, 60));
      drums.notes.push(note(t0, t0 + 0.25, 36, 100), note(t0 + 2, t0 + 2.25, 38, 100));
    } else if (kind === "C") {
      const local = bar - bar0;
      for (let beat = 0; beat < BEATS; beat += 1) melody.notes.push(note(t0 + beat, t0 + beat + 1, 70 + ((local * local + beat * 3) % 11)));
      for (const p of [50 + ((local * local) % 7), 57 + ((local * 5) % 6), 62]) keys.notes.push(note(t0, t0 + BEATS, p, 70));
      bass.notes.push(note(t0, t0 + 4, 38 + ((local * local) % 7)));
    } else if (kind === "intro") {
      keys.notes.push(note(t0, t0 + BEATS, 48, 50), note(t0, t0 + BEATS, 55, 50));
    } else {
      bass.notes.push(note(t0, t0 + BEATS, 36, 50), note(t0 + 2, t0 + BEATS, 43, 50));
    }
  }
}

function piece(blocks: Array<[Kind, number]>): FormInput {
  const tracks = makeTracks();
  let bar = 0;
  for (const [kind, bars] of blocks) { addBlock(tracks, bar, kind, bars); bar += bars; }
  const barStarts = Array.from({ length: bar }, (_, i) => i * BEATS);
  return { tracks: tracks.filter((t) => t.notes.length > 0), barStarts, end: bar * BEATS };
}

/** intro 4 · A 8 · A 8 · B 8 · A 8 · outro 4 = 40 bars, four families. */
const SONG: Array<[Kind, number]> = [["intro", 4], ["A", 8], ["A", 8], ["B", 8], ["A", 8], ["outro", 4]];
const extract = (input: FormInput, workId = "w1") => extractPlanningSupervision(input, { workId, metre: { dominant: "4/4", share: 1, changes: 0 } });

// ---------------------------------------------------------------------------

test("boundary agreement: exact, within tolerance, and empty", () => {
  assert.equal(boundaryAgreement([8, 16, 24], [8, 16, 24]), 1);
  assert.equal(boundaryAgreement([8, 16, 24], [9, 16, 23]), 1);
  assert.equal(boundaryAgreement([8, 16, 24], [8, 16]), 0.8);
  assert.equal(boundaryAgreement([8, 16, 24], [12, 20, 28]), 0);
  assert.equal(boundaryAgreement([], []), 1);
  assert.equal(boundaryAgreement([8], []), 0);
});

test("vocabulary: register bands and the platform family mapping", () => {
  assert.deepEqual([36, 48, 60, 72, 84].map(registerBandOf), ["low", "low_mid", "mid", "upper_mid", "high"]);
  assert.equal(platformFamilyOf("reed"), "winds");
  assert.equal(platformFamilyOf("organ"), "keys");
  assert.equal(platformFamilyOf("drums"), "drums");
  assert.equal(platformFamilyOf("unknown_family"), "unknown_family");
});

test("function names follow the repeat structure and energy, and never invent a chorus in a through-composed piece", () => {
  const body = (base: string, energy: number, densityRel = 0.8, families = 4) => ({ base, kind: "body" as const, energy, densityRel, families });
  const thin = (base: string, kind: "intro" | "outro") => ({ base, kind, energy: 0.2, densityRel: 0.3, families: 1 });
  assert.deepEqual(
    guessFunctions([thin("X", "intro"), body("A", 0.5), body("A", 0.5), body("B", 0.9), body("A", 0.5), thin("Y", "outro")]),
    ["intro", "verse", "verse", "bridge", "verse", "outro"],
  );
  // B repeats and is the louder letter: it is the chorus; the unique C between repeats is a bridge.
  assert.deepEqual(guessFunctions([body("A", 0.4), body("B", 0.9), body("A", 0.4), body("C", 0.5), body("B", 0.9)]), ["verse", "chorus", "verse", "bridge", "chorus"]);
  assert.deepEqual(guessFunctions([body("A", 0.4), body("B", 0.6), body("C", 0.8)]), ["neutral", "neutral", "neutral"]);
  // A run of unique letters between repeats is not a run of bridges.
  assert.deepEqual(guessFunctions([body("A", 0.5), body("B", 0.9), body("C", 0.6), body("D", 0.6), body("A", 0.5), body("B", 0.9)]), ["verse", "chorus", "neutral", "neutral", "verse", "chorus"]);
  // A full-band opening segmentForm flagged as intro-like is not named an intro when it is as full as the rest.
  assert.deepEqual(
    guessFunctions([{ base: "X", kind: "intro", energy: 0.9, densityRel: 0.95, families: 5 }, body("A", 0.5, 0.8, 5), body("B", 0.6, 0.9, 5), body("A", 0.5, 0.8, 5)]),
    ["neutral", "verse", "bridge", "verse"],
  );
});

test("orchestration strategy restates the planner's rule", () => {
  assert.equal(orchestrationStrategyOf([0.5]), "static_bed");
  assert.equal(orchestrationStrategyOf([0.5, 0.55, 0.6]), "static_bed");
  assert.equal(orchestrationStrategyOf([0.2, 0.4, 0.6, 0.9]), "sparse_to_full");
  assert.equal(orchestrationStrategyOf([0.2, 0.8, 0.3, 0.9, 0.4]), "wave_dynamics");
});

test("the human plan of an intro A A B A outro piece: families, entries, exits, density arc, transitions", () => {
  const plan = extract(piece(SONG));
  assert.equal(plan.version, PLANNING_SUPERVISION_VERSION);
  assert.equal(plan.barCount, 40);
  assert.deepEqual(plan.families, ["drums", "keys", "bass", "reed"]);
  assert.deepEqual(plan.platformFamilies, ["drums", "keys", "bass", "winds"]);
  assert.ok(plan.sections.length >= 5, `sections ${plan.form.formString}`);
  assert.ok(plan.form.hasIntroLike && plan.form.hasOutroLike, "intro and outro recognised");

  // The B block (bars 20–27, 0-based) is the fullest: every family active, density 1 of peak, the climax.
  const b = plan.sections.find((s) => s.startBar === 20);
  assert.ok(b, `a section starts at bar 20: ${plan.sections.map((s) => s.startBar).join(",")}`);
  assert.deepEqual(b!.activeFamilies, ["drums", "keys", "bass", "reed"]);
  assert.equal(b!.densityRel, 1);
  assert.equal(plan.shape.climaxSection, b!.index);
  assert.equal(plan.shape.lastSectionIsDensest, false);
  assert.equal(plan.shape.allInFromTheStart, false);
  assert.deepEqual(b!.entries.map((e) => [e.family, e.bar]), [["drums", 20]]);
  assert.deepEqual(b!.exits.map((e) => [e.family, e.bar]), [["drums", 28]]);
  const drums = b!.families.find((f) => f.family === "drums")!;
  assert.equal(drums.active, true);
  assert.equal(drums.registerCentre, null, "percussion carries no register");
  const reed = b!.families.find((f) => f.family === "reed")!;
  assert.equal(reed.registerBand, "upper_mid");
  assert.equal(reed.relToFamilyMax, 1);
  assert.ok(b!.registerWidth > plan.sections[1].registerWidth, "B spans a wider register than A");
  assert.ok(b!.energy > plan.sections[1].energy && b!.energy <= 1);

  // The first A: bass and reed enter with it (the intro was keys alone).
  const a1 = plan.sections.find((s) => s.startBar === 4);
  assert.ok(a1, "a section starts at bar 4");
  assert.deepEqual(a1!.entries.map((e) => e.family).sort(), ["bass", "reed"]);
  assert.ok(plan.sections[0].activeFamilies.length === 1 && plan.sections[0].activeFamilies[0] === "keys");

  // Transitions: into B is a build with drums entering; out of B is a drop with drums leaving.
  const intoB = plan.transitions.find((t) => t.atBar === 20)!;
  assert.equal(intoB.kind, "build");
  assert.deepEqual(intoB.familiesIn, ["drums"]);
  assert.ok(intoB.densityDelta > 0.2);
  const outOfB = plan.transitions.find((t) => t.atBar === 28)!;
  assert.equal(outOfB.kind, "drop");
  assert.deepEqual(outOfB.familiesOut, ["drums"]);
  assert.ok(plan.shape.boundaryFamilyChangeShare > 0);

  // Harmony and tension are populated where the bars support a chord.
  assert.ok(a1!.chordsNamedShare > 0.5, `A names its chords (${a1!.chordsNamedShare})`);
  assert.ok(a1!.tension >= 0 && a1!.tension <= 1);
  assert.ok(a1!.key !== null, "A has enough notes for a key");
  // Every field says how it was derived.
  for (const key of ["sections", "stability", "energy", "tension", "function", "transitions", "entries", "exits"]) assert.ok(plan.derivation[key], key);
});

test("platform-shaped targets use 1-based inclusive bars, platform family names, and unit ranges", () => {
  const plan = extract(piece(SONG));
  assert.equal(plan.sectionPlans.length, plan.sections.length);
  assert.equal(plan.globalTargets.sectionTargets.length, plan.sections.length);
  plan.sectionPlans.forEach((sp, i) => {
    const s = plan.sections[i];
    assert.equal(sp.startBar, s.startBar + 1);
    assert.equal(sp.endBar, s.endBar);
    assert.equal(sp.function, s.function);
    for (const v of [sp.energy, sp.density, sp.tension, sp.rhythmicActivity, sp.melodicActivity, sp.harmonicActivity, sp.noveltyRelativeToPreviousSection]) assert.ok(v >= 0 && v <= 1, `${v}`);
    for (const f of sp.activeInstrumentFamilies) assert.ok(["drums", "keys", "bass", "winds"].includes(f), f);
    assert.equal(sp.groove, "unknown");
  });
  assert.equal(plan.sectionPlans[0].transitionIn, "none");
  assert.equal(plan.sectionPlans[plan.sectionPlans.length - 1].transitionOut, "none");
  assert.ok(plan.globalTargets.climax && plan.globalTargets.climax.atBar === 21);
  assert.ok(["layered_build", "wave_dynamics", "sparse_to_full", "static_bed"].includes(plan.globalTargets.orchestrationStrategy));
  // The section with the melody carries a lead role in the platform's vocabulary.
  const lead = plan.sectionPlans.find((sp) => sp.leadRole !== "none");
  assert.ok(lead && lead.leadRole === "instrument:winds", `lead ${lead?.leadRole}`);
});

test("the quality gate admits the well-formed piece and names every failure of the others", () => {
  const good = admitPlanningSupervision(extract(piece(SONG)));
  assert.deepEqual(good.failures, []);
  assert.equal(good.admitted, true);
  assert.ok(good.checks.stable_sections.value >= MIN_BOUNDARY_F1);

  // Too short: 16 bars.
  const short = admitPlanningSupervision(extract(piece([["A", 8], ["B", 8]])));
  assert.ok(short.failures.includes("min_bars"));
  assert.equal(short.checks.min_bars.value, 16);
  assert.equal(short.checks.min_bars.threshold, MIN_BARS);

  // Two families only: a keys + bass duet keeps its form but is not an arrangement.
  const duet = piece(SONG);
  duet.tracks = duet.tracks.filter((t) => t.family === "keys" || t.family === "bass");
  const duetVerdict = admitPlanningSupervision(extract(duet));
  assert.ok(duetVerdict.failures.includes("min_families"), duetVerdict.failures.join(","));
  assert.equal(duetVerdict.checks.min_families.threshold, MIN_FAMILIES);

  // Metre that changes for a third of the piece.
  const metreVerdict = admitPlanningSupervision(extractPlanningSupervision(piece(SONG), { workId: "m", metre: { dominant: "4/4", share: 0.66, changes: 3 } }));
  assert.deepEqual(metreVerdict.failures, ["one_dominant_metre"]);

  // A A A A A: the periodic split gives sections, but nothing changes between them.
  const flat = extract(piece([["A", 8], ["A", 8], ["A", 8], ["A", 8], ["A", 8]]));
  const flatVerdict = admitPlanningSupervision(flat);
  assert.ok(flatVerdict.failures.includes("non_degenerate_arc"), flatVerdict.failures.join(","));
  assert.ok(flat.checks.densitySpread < MIN_DENSITY_SPREAD && flat.checks.familyChangeBoundaries === 0);

  // The corpus-level duplicate flag is a named failure too.
  const dup = admitPlanningSupervision(extract(piece(SONG)), { isDuplicate: true });
  assert.deepEqual(dup.failures, ["duplicate_group"]);
  assert.equal(PLANNING_FILTERS.length, 6);
});

test("stable_sections requires at least MIN_SECTIONS under both settings and agreement between them", () => {
  const plan = extract(piece(SONG));
  const verdict = admitPlanningSupervision(plan);
  const expected = plan.checks.sections >= MIN_SECTIONS && plan.checks.alternativeSections >= MIN_SECTIONS && plan.checks.boundaryF1 >= MIN_BOUNDARY_F1;
  assert.equal(verdict.checks.stable_sections.pass, expected);
  assert.ok(plan.checks.boundaryF1 >= 0 && plan.checks.boundaryF1 <= 1);
  // A through-composed piece still yields a measured F1 in range; whatever it is, the gate agrees with the checks.
  const c = extract(piece([["C", 8], ["C", 8], ["C", 8], ["C", 8]]));
  const cv = admitPlanningSupervision(c);
  assert.equal(cv.checks.stable_sections.pass, c.checks.sections >= MIN_SECTIONS && c.checks.alternativeSections >= MIN_SECTIONS && c.checks.boundaryF1 >= MIN_BOUNDARY_F1);
});

test("the rendered plan reads in 1-based bars with entries and exits named", () => {
  const text = renderPlanText(extract(piece(SONG), "song-1"));
  assert.match(text, /^Work song-1 — 40 bars, 4\/4/);
  assert.match(text, /form /);
  assert.match(text, /drums enters bar 21/);
  assert.match(text, /drums out at bar 29/);
  assert.match(text, /bass enters bar 5/);
  assert.match(text, /Intro \[bars 1–4\]/);
  assert.match(text, /transition in: build/);
  assert.match(text, /density 1\.00 of peak/);
});

test("extraction is deterministic and the plan survives a JSON round trip", () => {
  const a = extract(piece(SONG));
  const b = extract(piece(SONG));
  assert.deepEqual(a, b);
  assert.deepEqual(JSON.parse(JSON.stringify(a)), a);
});

test("from a parsed MIDI: dominant metre share, pickup bar, families from programs", () => {
  const tpq = 480;
  const bar = 4 * tpq;
  const notes: ParsedMidi["notes"] = [];
  // 32 bars: keys chords throughout, bass from bar 8, strings from bar 16, drums in bars 16–23 only.
  for (let b = 0; b < 32; b += 1) {
    const t0 = tpq + b * bar; // one-beat pickup precedes the 4/4 grid
    for (const p of [48, 52, 55]) notes.push({ track: 1, channel: 0, program: 0, isPercussion: false, pitch: p + (b >= 16 ? 5 : 0), velocity: 70, startTick: t0, endTick: t0 + bar });
    if (b >= 8) notes.push({ track: 2, channel: 1, program: 33, isPercussion: false, pitch: 36 + (b % 4) * 2, velocity: 80, startTick: t0, endTick: t0 + bar / 2 }, { track: 2, channel: 1, program: 33, isPercussion: false, pitch: 43, velocity: 80, startTick: t0 + bar / 2, endTick: t0 + bar });
    if (b >= 16) for (let q = 0; q < 4; q += 1) notes.push({ track: 3, channel: 2, program: 48, isPercussion: false, pitch: 72 + [0, 2, 4, 5][q] + (b % 2) * 2, velocity: 90, startTick: t0 + q * tpq, endTick: t0 + (q + 1) * tpq });
    if (b >= 16 && b < 24) for (let e = 0; e < 8; e += 1) notes.push({ track: 4, channel: 9, program: 0, isPercussion: true, pitch: 42, velocity: 60, startTick: t0 + (e * tpq) / 2, endTick: t0 + (e * tpq) / 2 + 60 });
  }
  notes.push({ track: 1, channel: 0, program: 0, isPercussion: false, pitch: 60, velocity: 60, startTick: 0, endTick: tpq });
  const midi: ParsedMidi = {
    ticksPerQuarter: tpq, format: 1, trackCount: 5, notes,
    tempos: [{ tick: 0, usPerQuarter: 500_000, bpm: 120 }],
    timeSignatures: [{ tick: 0, numerator: 1, denominator: 4 }, { tick: tpq, numerator: 4, denominator: 4 }],
    endTick: tpq + 32 * bar,
  };
  const metre = dominantMetreShare(midi);
  assert.equal(metre.dominant, "4/4");
  assert.equal(metre.changes, 1);
  assert.ok(metre.share > 0.99, `share ${metre.share}`);
  const plan = planningSupervisionFromMidi(midi, "midi-1", { genre: "classical" });
  assert.equal(plan.genre, "classical");
  assert.equal(plan.truncated, false);
  assert.deepEqual(plan.families, ["drums", "keys", "bass", "strings"]);
  assert.deepEqual(plan.checks.metre, metre);
  // The pickup is its own 1/4 bar in formSegmentation's grid, so every later bar is one higher.
  assert.equal(plan.barCount, 33);
  const entries = plan.sections.flatMap((s) => s.entries).filter((e) => e.family !== "keys");
  assert.ok(entries.some((e) => e.family === "bass" && Math.abs(e.bar - 9) <= 1), `bass enters near bar 9: ${JSON.stringify(entries)}`);
  assert.ok(entries.some((e) => e.family === "strings" && Math.abs(e.bar - 17) <= 1), `strings enter near bar 17: ${JSON.stringify(entries)}`);
  const verdict = admitPlanningSupervision(plan);
  assert.ok(!verdict.failures.includes("min_families") && !verdict.failures.includes("min_bars") && !verdict.failures.includes("one_dominant_metre"), verdict.failures.join(","));
});
