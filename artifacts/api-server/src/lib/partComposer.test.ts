import assert from "node:assert/strict";
import test from "node:test";
import type { SongModelData } from "@workspace/db";
import { deriveMusicalMap } from "./songMusicalMap";
import {
  PART_COMPOSER_PLAN_VERSION,
  buildPartComposerPlan,
  buildPartGenerationRequest,
  partComposerPlanInputsDigest,
  planPartComposition,
  silentPlannedFamilyFindings,
} from "./partComposer";

const FIXED_NOW = new Date("2026-01-01T00:00:00.000Z");

function makeModel(): SongModelData {
  const secPerBar = 2;
  const bars = Array.from({ length: 24 }, (_, i) => ({
    bar: i + 1, start: i * secPerBar, end: (i + 1) * secPerBar, beats: 4, confidence: 1,
  }));
  const beats = Array.from({ length: 96 }, (_, i) => ({
    time: i * 0.5, beat: (i % 4) + 1, bar: Math.floor(i / 4) + 1, confidence: 1,
  }));
  const melody: SongModelData["melody"] = [];
  for (let phrase = 0; phrase < 12; phrase += 1) {
    [0, 2, 4, 7].forEach((interval, k) => {
      const start = phrase * 4 + k * 0.5;
      melody.push({ start, end: start + 0.45, pitch: 62 + interval, velocity: 90, confidence: 0.9, source: "MT3" });
    });
  }
  const chords: SongModelData["chords"] = [];
  for (let g = 0; g < 6; g += 1) {
    [
      { symbol: "C", roman: "I", root: "C", quality: "maj", function: "tonic" },
      { symbol: "F", roman: "IV", root: "F", quality: "maj", function: "subdominant" },
      { symbol: "G", roman: "V", root: "G", quality: "7", function: "dominant" },
      { symbol: "C", roman: "I", root: "C", quality: "maj", function: "tonic" },
    ].forEach((c, i) => {
      const start = g * 8 + i * 2;
      chords.push({ ...c, start, end: start + 2, confidence: 0.9 });
    });
  }
  const bass: NonNullable<SongModelData["bass"]> = chords.map((c) => ({
    start: c.start, end: c.end, pitch: 40, confidence: 0.85, provider: "BASS",
  }));
  const energy = [...Array(8).fill(0.3), ...Array(8).fill(0.9), ...Array(8).fill(0.35)] as number[];
  const model: SongModelData = {
    contractVersion: "2.0",
    timebase: { ppq: 960, originSeconds: 0, coordinateSystem: "seconds+ticks" },
    audio: {
      name: "f.wav", contentType: "audio/wav", size: 5_000_000, durationSeconds: 48,
      sampleRate: 44_100, channels: 2, proxyObjectPath: null, proxyContentType: null,
      analysisStartSeconds: 0, analysisDurationSeconds: 48, analysisCoverage: "full",
    },
    analysisStartSeconds: 0, analysisDurationSeconds: 48, analysisCoverage: 1,
    tempoMap: [{ time: 0, bpm: 120, confidence: 0.95 }],
    meterMap: [{ bar: 1, meter: "4/4", confidence: 0.95 }],
    keyMap: [{ time: 0, key: "C major", confidence: 0.9 }],
    melody, bass, chords,
    sections: [
      { name: "Intro", startBar: 1, endBar: 4, energy: 0.2 },
      { name: "Verse", startBar: 5, endBar: 12, energy: 0.35 },
      { name: "Chorus", startBar: 13, endBar: 20, energy: 0.9 },
      { name: "Outro", startBar: 21, endBar: 24, energy: 0.3 },
    ],
    energy, beats, bars,
    dynamics: energy.map((v) => v * 0.9),
    waveform: [],
    stems: [
      { name: "vocals", role: "vocals", source: "d", channels: 2, confidence: 0.9 },
      { name: "drums", role: "drums", source: "d", channels: 2, confidence: 0.9 },
      { name: "bass", role: "bass", source: "d", channels: 2, confidence: 0.9 },
      { name: "keys", role: "keys", source: "d", channels: 2, confidence: 0.9 },
      { name: "strings", role: "strings", source: "d", channels: 2, confidence: 0.9 },
    ],
    sourceStems: [],
    lyrics: [],
    confidenceByField: {},
    providerProvenance: [],
    validation: { status: "accepted", issues: [] },
    fusion: { selectedProvider: "MT3", confidence: 0.9, decisions: [] },
  };
  model.musicalMap = deriveMusicalMap(model, { now: FIXED_NOW });
  return model;
}

test("part plan is versioned, deterministic, and enumerates real tasks", () => {
  const model = makeModel();
  const a = planPartComposition(model, { now: FIXED_NOW });
  const b = planPartComposition(model, { now: FIXED_NOW });
  assert.equal(a.plan.version, PART_COMPOSER_PLAN_VERSION);
  assert.deepEqual(a.plan, b.plan);
  assert.ok(a.plan.tasks.length >= 6);
  const tasks = new Set(a.plan.tasks.map((t) => t.task));
  assert.ok(tasks.has("DRUMS") && tasks.has("BASS"));
  // Brain B-01: the `ensemble` intro / ending / transition figures (a piano
  // nobody planned) are no longer written; each is recorded as a decision.
  assert.ok(!a.plan.tasks.some((t) => t.instrument === "ensemble"), "no fake ensemble instrument");
  assert.ok(a.plan.decisions?.some((d) => d.instrument === "ensemble" && d.sectionName === "Outro" && /ending/.test(d.reason)));
  assert.ok(a.plan.decisions?.some((d) => d.instrument === "ensemble" && /transition/.test(d.reason)));
  assert.equal(
    a.plan.inputsDigestSha256,
    partComposerPlanInputsDigest(model, a.layers.sectionPlan, a.layers.transitions),
  );
});

test("B-01: a sung section keeps its keys part; a LEAD family in a sung section keeps its bed task", () => {
  const model = makeModel();
  const { plan, layers } = planPartComposition(model, { now: FIXED_NOW });
  // The verse and chorus are sung (a vocal stem is in the model): keys is not LEAD and still writes.
  for (const name of ["Verse", "Chorus"]) {
    const section = layers.sectionPlan.sections.find((s) => s.sectionName === name)!;
    assert.equal(section.leadRole, "vocals", `${name} is sung`);
    if (section.activeInstrumentFamilies.includes("keys")) {
      assert.ok(plan.tasks.some((t) => t.sectionName === name && t.instrument === "keys"), `${name}: keys task`);
    }
  }
  // A plan that still says LEAD in a sung section (pre-B-01 rows, a caller's own plan) is not silenced.
  const forced = {
    ...layers.sectionPlan,
    roleAssignments: layers.sectionPlan.roleAssignments.map((r) =>
      r.sectionName === "Verse" && r.instrument === "keys" ? { ...r, role: "LEAD" as const } : r),
  };
  const rebuilt = buildPartComposerPlan(model, layers.globalPlan, forced, layers.transitions, { now: FIXED_NOW });
  const keysVerse = rebuilt.tasks.find((t) => t.sectionName === "Verse" && t.instrument === "keys");
  assert.ok(keysVerse, "the keys part exists");
  assert.equal(keysVerse!.task, "KEYS");
  assert.equal(keysVerse!.role, "HARMONIC_BED");
  assert.ok(rebuilt.decisions?.some((d) => d.kind === "lead_kept_as_bed" && d.instrument === "keys" && d.sectionName === "Verse"));
});

test("B-01: a family with no instrument definition is excluded with a reason instead of becoming a piano", () => {
  const model = makeModel();
  const { layers } = planPartComposition(model, { now: FIXED_NOW });
  const withWinds = {
    ...layers.sectionPlan,
    roleAssignments: [
      ...layers.sectionPlan.roleAssignments,
      { ...layers.sectionPlan.roleAssignments[0], sectionName: "Chorus", instrument: "winds", role: "ACCENT" as const },
      { ...layers.sectionPlan.roleAssignments[0], sectionName: "Chorus", instrument: "mix", role: "HARMONIC_BED" as const },
    ],
  };
  const plan = buildPartComposerPlan(model, layers.globalPlan, withWinds, layers.transitions, { now: FIXED_NOW });
  assert.ok(!plan.tasks.some((t) => t.instrument === "winds" || t.instrument === "mix"));
  const winds = plan.decisions?.find((d) => d.instrument === "winds");
  assert.equal(winds?.kind, "excluded_no_definition");
  assert.match(winds?.reason ?? "", /piano/);
  const mix = plan.decisions?.find((d) => d.instrument === "mix");
  assert.equal(mix?.kind, "excluded_non_family");
});

test("B-01: a request carries the arc's intent, the form memory and its own bar window; keys is never constrained as a kit", () => {
  const model = makeModel();
  const { plan, layers } = planPartComposition(model, { now: FIXED_NOW });
  const chorusKeys = plan.tasks.find((t) => t.sectionName === "Chorus" && t.instrument === "keys");
  const verseKeys = plan.tasks.find((t) => t.sectionName === "Verse" && t.instrument === "keys");
  assert.ok(chorusKeys && verseKeys, "keys plays the verse and the chorus");
  const request = buildPartGenerationRequest(model, chorusKeys!, layers);
  assert.ok(request.arcIntent, "the arc's intent is on the request");
  assert.ok(["pp", "p", "mp", "mf", "f", "ff"].includes(request.arcIntent!.dynamic));
  assert.equal(request.arcIntent!.level, request.section.energy);
  assert.equal(request.formMemory.occurrenceIndex, 0);
  assert.equal(request.formMemory.occurrenceCount, 1);
  assert.equal(request.formMemory.developmentOperator, "identity");
  assert.ok(request.partWindow.startBar >= request.section.startBar && request.partWindow.endBar <= request.section.endBar);
  // The verse keys part is comping (RHYTHMIC_HARMONY), a role name that used to
  // turn "keys" into the drum kit's range and polyphony.
  const verseRequest = buildPartGenerationRequest(model, verseKeys!, layers);
  assert.ok(verseRequest.constraints.playableRange.min <= 21 && verseRequest.constraints.playableRange.max >= 108, "a piano's range, not a kit's");
  assert.ok(verseRequest.constraints.maxSimultaneousNotes >= 8);
});

test("B-01 hard rule: a planned family that writes nothing in a sung section is an error; the reference path is clean", () => {
  const model = makeModel();
  const { plan, layers } = planPartComposition(model, { now: FIXED_NOW });
  const seconds = (bar: number) => (bar - 1) * 2;
  const tracks = layers.sectionPlan.sections.flatMap((s) =>
    s.activeInstrumentFamilies.map((family) => ({
      instrument: family,
      notes: [{ start: seconds(s.startBar) + 0.5 }],
    })));
  // Negative control: every planned family has a note in every section.
  assert.deepEqual(silentPlannedFamilyFindings(model, { sectionPlan: layers.sectionPlan, partComposerPlan: plan }, tracks), []);
  // Positive control: the keys track is empty although the plan tasks it in the chorus.
  const silentKeys = tracks.filter((t) => t.instrument !== "keys");
  const findings = silentPlannedFamilyFindings(model, { sectionPlan: layers.sectionPlan, partComposerPlan: plan }, silentKeys);
  const errors = findings.filter((f) => f.severity === "error");
  assert.ok(errors.length >= 1, "the silence is caught");
  assert.ok(errors.every((f) => f.instrument === "keys" && f.dimension === "hardRule"));
  assert.ok(errors.some((f) => f.sectionName === "Chorus"));
  assert.match(errors[0].message, /zero notes in mandatory section/);
  // An excluded family is a warning that carries the plan's reason, not an error.
  const excluded = {
    ...plan,
    tasks: plan.tasks.filter((t) => t.instrument !== "keys"),
    decisions: [{ kind: "excluded_no_definition" as const, sectionName: "Chorus", instrument: "keys", reason: "test exclusion" }],
  };
  const warned = silentPlannedFamilyFindings(model, { sectionPlan: layers.sectionPlan, partComposerPlan: excluded }, silentKeys);
  assert.ok(warned.some((f) => f.severity === "warning" && f.sectionName === "Chorus" && /test exclusion/.test(f.message)));
  assert.ok(!warned.some((f) => f.severity === "error" && f.sectionName === "Chorus"));
});

test("foundation composes before harmony before melodic; seeds are stable", () => {
  const { plan } = planPartComposition(makeModel(), { now: FIXED_NOW });
  const drums = plan.tasks.find((t) => t.task === "DRUMS")!;
  const counter = plan.tasks.find((t) => t.task === "COUNTER_MELODY");
  assert.ok(drums.dependsOn.length === 0);
  if (counter) {
    assert.ok(counter.dependsOn.length > 0, "a counter-melody depends on earlier parts");
  }
  // Seeds are 32-bit unsigned and reproducible.
  for (const task of plan.tasks) {
    assert.ok(Number.isInteger(task.seed) && task.seed >= 0 && task.seed <= 0xffffffff);
  }
  const again = planPartComposition(makeModel(), { now: FIXED_NOW }).plan;
  assert.deepEqual(
    plan.tasks.map((t) => [t.id, t.seed]),
    again.tasks.map((t) => [t.id, t.seed]),
  );
});

test("a request carries previous + current + next context and constraints", () => {
  const model = makeModel();
  const { plan, layers } = planPartComposition(model, { now: FIXED_NOW });
  const chorusBass = plan.tasks.find((t) => t.sectionName === "Chorus" && t.task === "BASS")!;
  const request = buildPartGenerationRequest(model, chorusBass, layers, [
    { instrument: "drums", role: "GROOVE", noteCount: 64 },
  ]);
  assert.equal(request.task, "BASS");
  assert.equal(request.section.sectionName, "Chorus");
  assert.ok(request.context.previousBars.endBar < request.context.currentBars.startBar);
  assert.ok(request.context.nextBars.startBar > request.context.currentBars.endBar);
  assert.ok(request.context.currentBars.chords.length > 0, "current window has harmony");
  assert.ok(request.context.previousBars.chords.length > 0, "previous context is not empty");
  assert.equal(request.existingParts[0].instrument, "drums");
  assert.ok(request.constraints.playableRange.max <= 127 && request.constraints.maxLeap > 0);
  assert.ok(request.transitions.some((t) => t.toSection === "Chorus" || t.fromSection === "Chorus"));
  assert.ok(request.budgetWindows.length >= 0);
});

test("a sung lead section does not emit an instrumental LEAD task", () => {
  const { plan } = planPartComposition(makeModel(), { now: FIXED_NOW });
  const leadTasksInVerse = plan.tasks.filter(
    (t) => t.sectionName === "Verse" && t.role === "LEAD",
  );
  assert.equal(leadTasksInVerse.length, 0);
});
