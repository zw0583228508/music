import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import type { InstrumentRoleAssignment, SectionPhrasePlan, SongModelData } from "@workspace/db";
import { deriveGlobalArrangementPlan } from "./globalArrangementPlanner";
import { deriveSectionPhrasePlan } from "./sectionPhrasePlanner";
import {
  REGISTER_BAND_BOUNDS,
  bandOf,
  bandsCovered,
  deriveOrchestrationBudget,
  deriveRegisterPlan,
  registerBoundsFor,
} from "./orchestrationBudget";
import { getInstrumentProfile } from "./instrumentProfile";

const FIXED_NOW = new Date("2026-09-10T00:00:00.000Z");
const FIXTURE = join(process.cwd(), "src/lib/__fixtures__/rachem-na-song-model-v3.b03.json");
/** The section/phrase/role plan the owner's arrangement was actually composed from (export v6). */
const STORED_PLAN = join(process.cwd(), "src/lib/__fixtures__/rachem-na-section-plan-v7.b03.json");

function ownerSong(): SongModelData {
  return JSON.parse(readFileSync(FIXTURE, "utf8")) as SongModelData;
}

function ownerSectionPlan(): SectionPhrasePlan {
  const { _fixture, ...plan } = JSON.parse(readFileSync(STORED_PLAN, "utf8")) as SectionPhrasePlan & { _fixture: unknown };
  return plan;
}

test("the planners re-derive a plan from the owner's Song Model fixture (a brief-less run keeps only bass and drums: diagnosis F4)", () => {
  const song = ownerSong();
  const global = deriveGlobalArrangementPlan(song, { now: FIXED_NOW });
  const section = deriveSectionPhrasePlan(song, global, { now: FIXED_NOW });
  const budget = deriveOrchestrationBudget(song, section, { now: FIXED_NOW });
  assert.equal(budget.version, "1.1");
  assert.ok(budget.registerPlan!.windows.length >= 9);
  assert.deepEqual(budget.registerPlan!.unresolved, []);
});

const assignment = (sectionName: string, instrument: string, role: InstrumentRoleAssignment["role"], register: InstrumentRoleAssignment["register"] = "mid"): InstrumentRoleAssignment => ({
  sectionName, instrument, role, register, density: 0.5, rhythmicActivity: 0.4, melodicActivity: 0.3,
  voicingStrategy: "close", articulationFamily: "sustain", dynamicShape: "mp", interactionWithLead: "support", entryBar: 1, exitBar: 8,
});

function sectionPlanWith(assignments: InstrumentRoleAssignment[]): SectionPhrasePlan {
  return {
    version: "1.0", derivedAt: FIXED_NOW.toISOString(), inputsDigestSha256: "0".repeat(64), method: "test",
    sections: [{
      sectionName: "Verse", startBar: 1, endBar: 8, function: "verse", energy: 0.35, density: 0.4, tension: 0.3, groove: "straight",
      activeInstrumentFamilies: [...new Set(assignments.map((a) => a.instrument))], inactiveInstrumentFamilies: [], leadRole: "vocal",
      supportingRoles: [], registerDistribution: { mid: 1 }, rhythmicActivity: 0.4, melodicActivity: 0.3, harmonicActivity: 0.4,
      transitionIn: "none", transitionOut: "none", noveltyRelativeToPreviousSection: 0,
    }],
    phrases: [{ id: "p1", sectionName: "Verse", startBar: 1, endBar: 8, role: "opening", energyTarget: 0.35, entersFamilies: [], leavesFamilies: [] }],
    roleAssignments: assignments,
  };
}

test("bands are concert MIDI octaves with the mud zone named", () => {
  assert.deepEqual(REGISTER_BAND_BOUNDS.low_mid, [48, 59]);
  assert.equal(bandOf(47), "low"); assert.equal(bandOf(48), "low_mid"); assert.equal(bandOf(60), "mid");
  assert.equal(bandOf(83), "upper_mid"); assert.equal(bandOf(84), "high");
  assert.deepEqual(bandsCovered(55, 72), ["low_mid", "mid", "upper_mid"]);
});

test("the owner's string bed is planned around MIDI 60–79 (violins) / 48–64 (cellos), never 79–91, and never in the piano's close band", () => {
  const song = ownerSong();
  const section = ownerSectionPlan();
  assert.ok(section.roleAssignments.some((r) => r.instrument === "strings" && r.sectionName === "Verse 1" && r.role === "PAD"), "the stored plan has the string bed");
  const budget = deriveOrchestrationBudget(song, section, { now: FIXED_NOW });
  const plan = budget.registerPlan!;
  assert.equal(budget.version, "1.1");
  assert.ok(plan.windows.length >= 9, `${plan.windows.length} windows`);
  assert.deepEqual(plan.unresolved, [], "every palette word of the owner's song (bass, keys, mix, strings, percussion) resolves to a profile");

  const stringWindows = plan.windows.filter((w) => w.entries.some((e) => e.instrument === "strings"));
  assert.ok(stringWindows.length >= 5, `strings are planned in several windows (verse 1, chorus 2, bridge, chorus 3, outro): ${stringWindows.length}`);
  const violinsProfile = getInstrumentProfile("violin_section")!;
  for (const window of stringWindows) {
    const entry = window.entries.find((e) => e.instrument === "strings")!;
    assert.equal(entry.profileId, "string_section", "the palette word plans the whole section");
    const bounds = registerBoundsFor({ profile: violinsProfile, role: entry.role, window: { id: window.id }, plan, instrument: "strings" });
    assert.equal(bounds.source, "register-plan");
    if (bounds.tacet) continue;
    assert.ok(bounds.hi <= 91 && bounds.lo >= 55, `${window.sectionName} ${entry.role}: violins ${bounds.lo}-${bounds.hi}`);
    if (["HARMONIC_BED", "PAD"].includes(entry.role)) {
      assert.ok(bounds.hi <= 79 && bounds.lo >= 60, `${window.sectionName} bed/pad violins ${bounds.lo}-${bounds.hi} sit in 60–79, not 79–91`);
      const cellos = bounds.desks!.find((d) => d.desk === "cellos");
      assert.ok(cellos && cellos.lo >= 43 && cellos.hi <= 64, `${window.sectionName} cellos ${cellos?.lo}-${cellos?.hi}`);
      // The piano ("mix", HARMONIC_BED) and the violins never share a close band.
      const piano = window.entries.find((e) => e.instrument === "mix" && e.role === "HARMONIC_BED");
      if (piano?.bounds) {
        const overlap = Math.min(piano.bounds.hi, bounds.hi) - Math.max(piano.bounds.lo, bounds.lo) + 1;
        assert.ok(overlap < 5, `${window.sectionName}: piano ${piano.bounds.lo}-${piano.bounds.hi} vs violins ${bounds.lo}-${bounds.hi} overlap ${overlap}`);
      }
    }
    assert.ok(!bounds.desks!.some((d) => d.desk === "basses"), "the bass holds the low band, so the string basses sit out");
  }
  // The verse-1 layout in numbers (the evidence quotes these).
  const verse1 = plan.windows.find((w) => w.sectionName === "Verse 1" && w.entries.some((e) => e.instrument === "strings"))!;
  const strings = verse1.entries.find((e) => e.instrument === "strings")!;
  const piano = verse1.entries.find((e) => e.instrument === "mix")!;
  assert.deepEqual(piano.bounds, { lo: 48, hi: 67 }, "the piano bed keeps its LH/RH register (foundation first)");
  const violins = strings.desks!.find((d) => d.desk === "violins")!;
  assert.ok(violins.lo >= 68 && violins.hi === 79, `violins ${violins.lo}-${violins.hi}: trimmed above the piano's RH`);
  assert.equal(strings.action, "trim");
  const bass = verse1.entries.find((e) => e.instrument === "bass")!;
  assert.ok(bass.bounds && bass.bounds.hi <= 55 && bass.bounds.lo >= 28);
  // Strings below MIDI 80 in every verse (the gate).
  for (const w of plan.windows.filter((w) => /verse/i.test(w.sectionName))) {
    const e = w.entries.find((x) => x.instrument === "strings");
    if (e?.bounds) assert.ok(e.bounds.hi < 80, `${w.sectionName}: strings ${e.bounds.lo}-${e.bounds.hi}`);
  }
  // Deterministic.
  const again = deriveOrchestrationBudget(song, section, { now: FIXED_NOW });
  assert.deepEqual(again.registerPlan, plan);
  // The PR-06 fields still describe the same plan: every overcrowded band has a resolution.
  for (const span of budget.registerOccupancy) {
    for (const band of span.overcrowdedBands) assert.ok(span.resolutions.some((r) => r.band === band), `${span.startBar}: ${band} resolved`);
  }
  const shifts = budget.windows.flatMap((w) => w.instrumentAdjustments.filter((a) => a.registerShift !== 0));
  assert.ok(shifts.every((a) => Math.abs(a.registerShift) === 12), "shifts are octaves");
});

test("two HARMONIC_BED close voicings never share a band: the colour instrument yields, by trim, then octave, then tacet", () => {
  const plan = deriveRegisterPlan({
    sectionPlan: sectionPlanWith([
      assignment("Verse", "bass", "BASS", "low"),
      assignment("Verse", "keys", "HARMONIC_BED"),
      assignment("Verse", "strings", "HARMONIC_BED", "upper_mid"),
      assignment("Verse", "pads", "HARMONIC_BED"),
    ]),
    windows: [{ id: "w1", startBar: 1, endBar: 8 }],
  });
  const w = plan.windows[0];
  const keys = w.entries.find((e) => e.instrument === "keys")!;
  const strings = w.entries.find((e) => e.instrument === "strings")!;
  const pads = w.entries.find((e) => e.instrument === "pads")!;
  assert.deepEqual(keys.bounds, { lo: 48, hi: 67 });
  assert.equal(keys.action, "keep");
  const violins = strings.desks!.find((d) => d.desk === "violins")!;
  assert.ok(violins.lo > 67, `violins ${violins.lo}-${violins.hi} above the piano`);
  // The pad finds no free close band between the piano and the violins and is trimmed or moved out, or rests.
  assert.ok(["trim", "octave_up", "octave_down", "tacet"].includes(pads.action), pads.action);
  const closeZones = w.entries
    .filter((e) => e.bounds && e.voicing !== "line")
    .map((e) => e.desks ? e.desks.find((d) => d.voicing === "close")! : { lo: e.bounds!.lo, hi: e.bounds!.hi, name: e.instrument });
  for (let i = 0; i < closeZones.length; i += 1) {
    for (let j = i + 1; j < closeZones.length; j += 1) {
      const a = closeZones[i]; const b = closeZones[j];
      assert.ok(Math.min(a.hi, b.hi) - Math.max(a.lo, b.lo) + 1 < 5, `${JSON.stringify(a)} vs ${JSON.stringify(b)}`);
    }
  }
  assert.ok(w.collisions.length >= 2);
  for (const c of w.collisions) assert.ok(c.resolution.length > 5 && ["low", "low_mid", "mid", "upper_mid", "high"].includes(c.band));
});

test("low-mid accumulation is detected and the most flexible colour voicing is raised out of it", () => {
  const plan = deriveRegisterPlan({
    sectionPlan: sectionPlanWith([
      assignment("Verse", "bass", "BASS", "low"),
      assignment("Verse", "guitar", "RHYTHMIC_HARMONY"),
      assignment("Verse", "keys", "HARMONIC_BED"),
    ]),
    windows: [{ id: "w1", startBar: 1, endBar: 8 }],
  });
  const w = plan.windows[0];
  const guitar = w.entries.find((e) => e.instrument === "guitar")!;
  const keys = w.entries.find((e) => e.instrument === "keys")!;
  // Guitar (tier 2, listed first by the planner) keeps 45–76; the piano yields upward.
  assert.equal(guitar.action, "keep");
  assert.ok(keys.bounds && keys.bounds.lo >= 60, `piano ${keys.bounds?.lo}-${keys.bounds?.hi} moved above the guitar's comping band`);
  assert.equal(w.closeVoicingsPerBand.low_mid <= 1, true, "at most one close voicing left in C3–B3");
  // Positive control: bass + piano alone accumulate nothing.
  const calm = deriveRegisterPlan({
    sectionPlan: sectionPlanWith([assignment("Verse", "bass", "BASS", "low"), assignment("Verse", "keys", "HARMONIC_BED")]),
    windows: [{ id: "w1", startBar: 1, endBar: 8 }],
  }).windows[0];
  assert.equal(calm.lowMid.flagged, false);
  assert.equal(calm.collisions.length, 0);
});

test("a detected vocal band pushes close voicings away from the singer; a second bass line is tacet; unknown instruments are reported, not ranged", () => {
  const plan = deriveRegisterPlan({
    sectionPlan: sectionPlanWith([
      assignment("Verse", "bass", "BASS", "low"),
      assignment("Verse", "808", "BASS", "low"),
      assignment("Verse", "keys", "HARMONIC_BED"),
      // A name no profile knows, in a role no role-rule claims (a PAD role would
      // resolve it to a synth pad by the PR-61 role rule, labelled as such).
      assignment("Verse", "theremin", "HARMONIC_BED"),
    ]),
    windows: [{ id: "w1", startBar: 1, endBar: 8 }],
    vocalRegister: [{ startBar: 1, endBar: 8, register: "mid" }],
  });
  const w = plan.windows[0];
  assert.deepEqual(w.vocal, { status: "detected", band: "mid", range: [60, 71] });
  const keys = w.entries.find((e) => e.instrument === "keys")!;
  assert.ok(keys.bounds && keys.bounds.hi < 60, `piano ${keys.bounds?.lo}-${keys.bounds?.hi} below the vocal's band`);
  assert.equal(keys.action, "trim");
  const synthBass = w.entries.find((e) => e.instrument === "808")!;
  assert.equal(synthBass.action, "tacet");
  assert.match(synthBass.reason, /already holds the low band/);
  assert.deepEqual(plan.unresolved, [{ instrument: "theremin", role: "HARMONIC_BED", reason: plan.unresolved[0]?.reason }]);
  assert.match(plan.unresolved[0].reason, /no instrument profile matches "theremin"/);
  // registerBoundsFor reports the tacet and falls back honestly outside the plan.
  const tacet = registerBoundsFor({ profile: getInstrumentProfile("synth_bass")!, role: "BASS", window: { bar: 3 }, plan, instrument: "808" });
  assert.equal(tacet.tacet, true); assert.equal(tacet.source, "register-plan");
  const outside = registerBoundsFor({ profile: getInstrumentProfile("piano")!, role: "HARMONIC_BED", window: { bar: 99 }, plan });
  assert.equal(outside.source, "profile-default"); assert.deepEqual([outside.lo, outside.hi], [48, 67]);
  const noPlan = registerBoundsFor({ profile: getInstrumentProfile("piano")!, role: "HARMONIC_BED", window: { bar: 1 }, plan: null });
  assert.match(noPlan.reason, /no register plan/);
});
