/**
 * Adversarial critic tests (Brain B-05b).
 *
 * For every module: a positive control on the anchor arrangements (the
 * deliberately worsened version is rejected harder on every anchor), a null
 * control (a clean hand-written arrangement is not rejected), the contract
 * gates (numeric evidence, a location, a confidence derived from evidence),
 * determinism, and abstention when there is nothing to judge.
 */
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { join, resolve } from "node:path";
import test from "node:test";
import type { MusicalNote, TrackModel } from "@workspace/db";
import type { CriticDimensionReport, CriticObservation } from "../types";
import { ANCHOR_CASE_IDS, anchorFor, anchors } from "./anchors";
import { ADVERSARIAL_MODULES, ADVERSARIAL_KINDS, runAdversarialCritics } from "./index";
import { CONTROLS, controlFor, ledgerStatusFromDetection } from "./controls";
import { cleanFixture, fixtureWith } from "./fixture";
import { penaltyOf } from "./shared";
import { PROFESSIONAL_DIMENSION, PROFESSIONAL_RULES, critiqueProfessionalWouldChange } from "./professionalWouldChange";
import { critiqueInstrumentReality } from "./instrumentReality";
import { roleWindowForDefinition } from "../dimensions/register";
import { critiqueArbitrariness } from "./arbitrariness";
import { critiqueFighting } from "./fighting";
import { critiqueCopiedRepeat } from "./copiedRepeat";

const ALL = anchors();
const majorOrWorse = (r: CriticDimensionReport) => r.observations.filter((o) => o.severity === "major" || o.severity === "blocking").length;

function assertContract(report: CriticDimensionReport): void {
  assert.ok(report.dimension.startsWith("adversarial."));
  assert.ok(report.version.length > 0);
  assert.ok(report.summary.coverage >= 0 && report.summary.coverage <= 1);
  for (const o of report.observations) {
    assert.ok(ADVERSARIAL_KINDS.includes(o.kind), `${o.kind} is a declared kind`);
    assert.ok(o.location.startBar >= 1 && o.location.endBar >= o.location.startBar, `${o.id} has a bar range`);
    assert.ok(Array.isArray(o.location.trackIds));
    const numeric = Object.values(o.evidence).filter((v) => typeof v === "number");
    assert.ok(numeric.length >= 1, `${o.id} carries numeric evidence`);
    assert.ok(numeric.every((v) => Number.isFinite(v)), `${o.id} evidence is finite`);
    assert.ok(o.confidence > 0 && o.confidence <= 1, `${o.id} confidence in (0, 1]`);
    assert.ok(o.originConfidence > 0 && o.originConfidence <= 1, `${o.id} origin confidence in (0, 1]`);
    assert.ok(o.suspectedOrigin.length > 0);
    assert.equal(o.id, `${o.dimension}:${o.kind}:${o.location.startBar}-${o.location.endBar}:${o.location.trackIds.join("+") || "all"}`);
    if (o.recommendedRepair) assert.ok(["note", "part", "section", "plan"].includes(o.recommendedRepair.scope));
  }
}

test("anchors: at least three synthetic corpus cases arranged by the real orchestrator with the reference composer", () => {
  assert.ok(ANCHOR_CASE_IDS.length >= 3);
  for (const a of ALL) {
    assert.equal(a.composer, "REFERENCE_PART_COMPOSER_V1");
    assert.ok(a.input.trackModels.length >= 3, `${a.id} has several parts`);
    assert.ok(a.noteCount > 50, `${a.id} has real notes`);
  }
});

for (const m of ADVERSARIAL_MODULES) {
  const control = controlFor(m.dimension);

  test(`${m.dimension}: positive control - the worsened arrangement is rejected harder on every anchor where the module applies`, () => {
    let tried = 0;
    for (const a of ALL) {
      const damaged = control.apply(a.input);
      if (damaged === a.input) continue; // the damage needs material the anchor lacks (e.g. two pitched non-bass parts) - not a control on this anchor
      const ref = m.run(a.input);
      const worse = m.run(damaged);
      if (!ref.applicable && !worse.applicable) continue; // e.g. copied repeats on a form with no repeated section
      tried += 1;
      const refPenalty = penaltyOf(ref.observations);
      const worsePenalty = penaltyOf(worse.observations);
      assert.ok(worsePenalty > refPenalty, `${m.dimension} on ${a.id} (${control.name}): penalty ${worsePenalty} must exceed ${refPenalty}`);
      assert.ok((worse.summary.score0to100 ?? 100) <= (ref.summary.score0to100 ?? 100), `${m.dimension} on ${a.id}: score must not rise`);
      assertContract(ref);
      assertContract(worse);
    }
    assert.ok(tried >= 3, `${m.dimension}: at least three anchors exercised (${tried})`);
  });

  test(`${m.dimension}: null control - a clean hand-written arrangement is not rejected`, () => {
    for (const input of [cleanFixture(), cleanFixture({ vocals: false })]) {
      const report = m.run(input);
      assert.ok(report.applicable, `${m.dimension} applies to the fixture`);
      assert.equal(majorOrWorse(report), 0, `${m.dimension} finds nothing major in the clean fixture: ${report.observations.map((o) => o.id).join(", ")}`);
      assert.ok((report.summary.score0to100 ?? 0) >= 95, `${m.dimension} scores the clean fixture >= 95 (${report.summary.score0to100})`);
    }
  });

  test(`${m.dimension}: deterministic, and abstains without notes or without a bar grid`, () => {
    const a = anchorFor("pop-full");
    assert.deepEqual(m.run(a.input), m.run(a.input));
    const empty = m.run({ ...a.input, trackModels: [] });
    assert.equal(empty.applicable, false);
    assert.match(empty.reasonIfNot ?? "", /No track carries a note/);
    assert.equal(empty.summary.score0to100, null);
    const noGrid = m.run({ ...a.input, songModel: { ...a.input.songModel, bars: [] } });
    assert.equal(noGrid.applicable, false);
    assert.match(noGrid.reasonIfNot ?? "", /no bar grid/);
    // Control status is never self-declared: without a ledger the module is uncalibrated.
    assert.equal(m.run(a.input).summary.controlStatus, "uncalibrated");
    assert.equal(m.run(a.input, { controlStatus: "informing" }).summary.controlStatus, "informing");
  });
}

test("no module types a confidence by hand (source gate)", () => {
  // The bundle runs from artifacts/api-server (the focused runner's cwd); the sources are read from there.
  const dir = resolve(process.cwd(), "src/lib/critics/adversarial");
  const sources = readdirSync(dir).filter((f) => f.endsWith(".ts") && !f.endsWith(".test.ts") && f !== "controls.ts" && f !== "fixture.ts" && f !== "anchors.ts");
  assert.ok(sources.length >= 9);
  for (const file of sources) {
    const text = readFileSync(join(dir, file), "utf8");
    const literal = /confidence:\s*(0?\.\d+|1)\b/.exec(text);
    assert.equal(literal, null, `${file} types a confidence literal: ${literal?.[0]}`);
    const originLiteral = /originConfidence:\s*(0?\.\d+|1)\b/.exec(text);
    assert.equal(originLiteral, null, `${file} types an origin confidence literal`);
  }
});

test("the ledger status comes only from a measured detection count", () => {
  assert.equal(ledgerStatusFromDetection(0, 0).status, "uncalibrated");
  assert.equal(ledgerStatusFromDetection(6, 6).status, "gated");
  assert.equal(ledgerStatusFromDetection(3, 3).status, "informing", "three of three is not enough for the interval to clear one half");
  assert.equal(ledgerStatusFromDetection(4, 6).status, "informing");
  assert.equal(ledgerStatusFromDetection(2, 6).status, "demoted");
  assert.deepEqual(ledgerStatusFromDetection(6, 6).ci95, [0.5407, 1]);
});

test("the runner returns one report per module, uncalibrated unless a ledger says otherwise", () => {
  const a = anchorFor("rock-full");
  const reports = runAdversarialCritics(a.input);
  assert.equal(reports.length, ADVERSARIAL_MODULES.length);
  assert.ok(reports.every((r) => r.summary.controlStatus === "uncalibrated"));
  const ledgered = runAdversarialCritics(a.input, { controlLedger: { "adversarial.instrumentReality": "gated" } });
  assert.equal(ledgered.find((r) => r.dimension === "adversarial.instrumentReality")!.summary.controlStatus, "gated");
  assert.equal(ledgered.find((r) => r.dimension === "adversarial.boredom")!.summary.controlStatus, "uncalibrated");
  assert.equal(CONTROLS.length, ADVERSARIAL_MODULES.length, "every module has a positive control");
});

// ---------------------------------------------------------------------------
// Findings on the reference composer (the point of the exercise)
// ---------------------------------------------------------------------------

test("the reference composer is rejected on several axes (recorded, not hidden)", () => {
  const byKind = new Map<string, number>();
  for (const a of ALL) {
    for (const r of runAdversarialCritics(a.input)) {
      for (const o of r.observations) byKind.set(o.kind, (byKind.get(o.kind) ?? 0) + 1);
    }
  }
  // Each of these is a defect the program diagnosis named; the adversarial critic now measures it at note level.
  //
  // B-13 at the merge: `string_bed_too_high` was the third of these to close,
  // so it is asserted as a fix rather than as a count. B-13 wired the string
  // bed to the voicing solver and the groove plan's bed cell, and the two
  // anchors that carry a string part now average MIDI 74.84 (orchestral-midi,
  // 107 notes) and 73.59 (cinematic-midi, 22 notes) - below the 79 the rule
  // asks for, per section as well as overall. The tops still reach 86 and 84;
  // a violin line over a bed is not the defect, a bed parked up there was.
  // The rule and its threshold are untouched: the arrangement moved.
  //
  // **Re-anchored at B-26, and this time the rule moved — the lead's F15
  // ruling.** After B-21 the writers place a part inside
  // `instrumentProfile.roleRegisterFor`, and `orchestral-midi`'s
  // `strings-climax_layer` averages **79.93** in the Chorus: inside the
  // profile's CLIMAX_LAYER register of 67–91 and above this rule's old flat
  // 79, so the count came back to 1 while the `register` dimension scored the
  // same arrangement 100. Two sources of truth for one musical claim, the
  // third recurrence of the program's standing bug. The constant is gone —
  // `instrumentReality` now asks `roleWindowForDefinition`, the register
  // dimension's own reader, for the ceiling of the role the part holds in that
  // section. A PAD violin section still answers 79 (exactly the number the
  // constant was, so the owner's `strings-pad` at mean 80.00 still fires, as
  // F15 requires); a CLIMAX_LAYER answers 91. The count is 0 again, because a
  // climax layer sitting above a bed is not a defect — which is what a flat
  // number could not say.
  assert.equal(byKind.get("string_bed_too_high") ?? 0, 0,
    "B-26: no string part averages at or above the ceiling its own profile gives it in the role it holds (orchestral-midi CLIMAX_LAYER 79.93 against 91; the flat-79 rule reported 1)");
  const stringParts = ALL
    .flatMap((a) => a.input.trackModels
      .filter((t) => t.instrumentDefinition.family === "strings" && !/bass/i.test(t.instrument) && t.notes.length > 0)
      .map((t) => ({ anchor: a.id, track: t })));
  assert.ok(stringParts.length >= 2, `${stringParts.length} string parts across the anchors`);
  for (const { anchor, track } of stringParts) {
    const meanPitch = track.notes.reduce((s, n) => s + n.pitch, 0) / track.notes.length;
    const ceiling = roleWindowForDefinition(track.instrumentDefinition, track.role.toUpperCase(),
      { min: track.instrumentDefinition.comfortableRange.min, max: track.instrumentDefinition.comfortableRange.max }).hi;
    assert.ok(meanPitch < ceiling,
      `${anchor}/${track.id}: mean ${meanPitch.toFixed(2)} against the ${track.role} ceiling ${ceiling} its own profile gives it`);
  }
  // F5 (the planned LEAD keys wrote nothing) was closed by B-01: keys is never LEAD in a sung section, so the count is no longer asserted here.
  // Repeated sections as note copies (diagnosis §11.2) were closed by B-01 (operators) + B-10 (recall with variation) + B-02
  // (voicings solved per chord in context); the count is recorded in the evidence, not asserted here.
  assert.equal(byKind.get("root_position_only") ?? 0, 0, "root-position-only harmony (F6) was closed by B-02: voicings are solved per role with inversions");
  assert.ok((byKind.get("melody_masked") ?? 0) >= 3, "keys at high velocity in the vocal register while sung (audit §1.3)");
});

test("B-26 (F15): `string_bed_too_high` reads the role the part holds here, and the rule still fires on a constructed bed above that role's own ceiling", () => {
  // The re-point, with both halves measured — it must fire on the constructed
  // defect and not on the clean case.
  //
  // **Not on the clean case.** Every string part on every anchor now averages
  // below the ceiling its own profile gives it in the role the *plan* assigns
  // it in that section (asserted in the test above). The one firing that came
  // back after B-21 was `orchestral-midi/strings-climax_layer` at mean 79.93 in
  // the Chorus, which the profile allows a CLIMAX_LAYER (67-91) and the flat 79
  // refused.
  //
  // **On the constructed defect.** A bed lifted two octaves is above any of
  // those ceilings, and the rule says so with the ceiling and the role in its
  // evidence.
  const anchor = anchorFor("orchestral-midi");
  const strings = anchor.input.trackModels.find((t) => t.id === "strings-climax_layer")!;
  const clean = critiqueInstrumentReality(anchor.input).observations.filter((o) => o.kind === "string_bed_too_high");
  assert.deepEqual(clean, [], "the clean anchor carries none");
  const lifted = {
    ...anchor.input,
    trackModels: anchor.input.trackModels.map((t) => (t.id === strings.id
      ? { ...t, notes: t.notes.map((n) => ({ ...n, pitch: Math.min(127, n.pitch + 24) })) }
      : t)),
  };
  const fired = critiqueInstrumentReality(lifted).observations.filter((o) => o.kind === "string_bed_too_high");
  assert.ok(fired.length >= 1, "the constructed bed two octaves up is reported");
  for (const o of fired) {
    assert.equal(o.severity, "major");
    assert.deepEqual(o.location.trackIds, [strings.id]);
    assert.ok((o.evidence.meanPitch as number) >= (o.evidence.threshold as number),
      `${o.evidence.meanPitch} against ${o.evidence.threshold}`);
    // The threshold is sourced, not a constant: it names the role and the profile.
    assert.ok(String(o.evidence.role).length > 0);
    assert.match(String(o.evidence.ceilingSource), /instrumentProfile/);
  }
  // …and the role that answers is the one the plan gives the part in that
  // section, which is the same lookup `critics/dimensions/register` makes.
  // The two rules cannot drift apart again.
  const roles = new Set(fired.map((o) => String(o.evidence.role)));
  assert.ok(roles.size >= 1 && [...roles].every((r) => r === r.toUpperCase()), [...roles].join(","));
});

test("instrument reality: after B-03 no keys part resolves to a drum-kit definition (dance-full)", () => {
  const a = anchorFor("dance-full");
  const report = critiqueInstrumentReality(a.input);
  const mismatch = report.observations.filter((o) => o.kind === "definition_family_mismatch");
  assert.equal(mismatch.length, 0, "keys in RHYTHMIC_HARMONY was a drum kit before B-03's profiles; it is a piano now");
  assert.ok(a.input.trackModels.some((t) => t.instrument === "keys" && t.instrumentDefinition.family === "keys"));
});

test("arbitrariness: after B-01 the orchestral anchor has no silent planned keys (the F5 defect is closed)", () => {
  const a = anchorFor("orchestral-midi");
  const silent = critiqueArbitrariness(a.input).observations.filter((o) => o.kind === "planned_family_silent" && o.evidence.instrument === "keys");
  assert.equal(silent.length, 0, "keys was LEAD-and-silent in every section before B-01");
});

test("copied repeats: abstains on a form with no repeated section, and grades the final chorus copy major", () => {
  const orchestral = critiqueCopiedRepeat(anchorFor("orchestral-midi").input);
  assert.equal(orchestral.applicable, false);
  const pop = critiqueCopiedRepeat(anchorFor("pop-full").input);
  const finalChorus = pop.observations.filter((o) => o.location.sectionName === "Chorus 2" && o.kind === "section_note_copy");
  assert.ok(finalChorus.length >= 1);
  assert.ok(finalChorus.every((o) => o.severity === "major"), "the last chorus owed a development");
  assert.ok(finalChorus.every((o) => (o.evidence.noteMatchShare as number) >= 0.95));
});

test("fighting: melody masking names the covering track, the sung section and the masked share", () => {
  const report = critiqueFighting(anchorFor("pop-full").input);
  const masked = report.observations.filter((o) => o.kind === "melody_masked");
  assert.ok(masked.length >= 1);
  for (const o of masked) {
    assert.ok(o.location.trackIds.includes("keys-harmonic_bed"));
    assert.ok((o.evidence.maskedShare as number) >= 0.1);
    assert.ok((o.evidence.maskedMelodyNotes as number) >= 1);
    assert.match(String(o.location.sectionName), /Chorus/);
  }
});

// ---------------------------------------------------------------------------
// Professional rules: every rule has a violator the clean fixture does not trigger
// ---------------------------------------------------------------------------

const clusterIndex = (notes: MusicalNote[], n: MusicalNote) => notes.filter((x) => Math.abs(x.start - n.start) <= 0.03 && x.pitch < n.pitch).length;
const byId = (tracks: TrackModel[], id: string) => tracks.find((t) => t.id === id)!;

const VIOLATORS: Record<string, { vocals?: boolean; mutate: (tracks: TrackModel[]) => TrackModel[] }> = {
  bass_and_keys_share_low_octave: {
    mutate(tracks) {
      const bass = byId(tracks, "bass-bass");
      const keys = byId(tracks, "keys-harmonic_bed");
      // Every keyboard voicing rebuilt on the most recent bass note, root at the bottom, in the bass's octave.
      keys.notes = keys.notes.map((n) => {
        const b = [...bass.notes].filter((x) => x.start <= n.start + 0.03).sort((x, y) => y.start - x.start)[0];
        const bottom = b ? (b.pitch > 52 ? b.pitch - 12 : b.pitch) : n.pitch;
        return { ...n, pitch: bottom + clusterIndex(keys.notes, n) * 4 };
      });
      return tracks;
    },
  },
  no_top_voice_line: {
    vocals: false,
    mutate(tracks) {
      for (const id of ["keys-harmonic_bed", "strings-pad"]) {
        const t = byId(tracks, id);
        t.notes = t.notes.map((n) => (n.start >= 16 && n.start < 32 ? { ...n, pitch: 72 } : n));
      }
      return tracks;
    },
  },
  close_position_same_octave: {
    mutate(tracks) {
      const keys = byId(tracks, "keys-harmonic_bed");
      const strings = byId(tracks, "strings-pad");
      strings.notes = keys.notes.filter((n) => n.start >= 16 && n.start < 32).map((n, i) => ({ ...n, id: `st-copy-${i}`, pitch: n.pitch + 1 }));
      return tracks;
    },
  },
  single_pitch_percussion: {
    mutate(tracks) {
      const drums = byId(tracks, "drums-groove");
      drums.notes = drums.notes.map((n) => ({ ...n, pitch: 38 }));
      return tracks;
    },
  },
  unison_doubling_by_accident: {
    mutate(tracks) {
      const keys = byId(tracks, "keys-harmonic_bed");
      const strings = byId(tracks, "strings-pad");
      strings.notes = keys.notes.filter((n) => n.start >= 16 && n.start < 32).map((n, i) => ({ ...n, id: `st-double-${i}` }));
      return tracks;
    },
  },
  static_bass_no_approach: {
    mutate(tracks) {
      // Roots only: no approach tones, every change a jump from the old root to the new one.
      const bass = byId(tracks, "bass-bass");
      bass.notes = bass.notes.filter((n) => /-r\d+$|-final$/.test(n.id));
      return tracks;
    },
  },
  every_part_same_rhythm: {
    mutate(tracks) {
      const keys = byId(tracks, "keys-harmonic_bed");
      const source = keys.notes.filter((n) => n.start >= 15.9 && n.start < 31.9);
      byId(tracks, "strings-pad").notes = source.map((n, i) => ({ ...n, id: `st-hr-${i}`, pitch: n.pitch + 12 }));
      byId(tracks, "bass-bass").notes = source.filter((n) => clusterIndex(source, n) === 0).map((n, i) => ({ ...n, id: `bs-hr-${i}`, pitch: n.pitch - 24 }));
      return tracks;
    },
  },
  keys_low_interval_mud: {
    mutate(tracks) {
      const keys = byId(tracks, "keys-harmonic_bed");
      keys.notes = keys.notes.map((n) => ({ ...n, pitch: n.pitch - 24 }));
      return tracks;
    },
  },
};

test("professional rules are data: every rule has a title, a catch description, a severity and a repair", () => {
  assert.ok(PROFESSIONAL_RULES.length >= 8);
  for (const rule of PROFESSIONAL_RULES) {
    assert.ok(rule.title && rule.catches.length > 30 && rule.repair.operation && rule.repair.detail);
    assert.ok(VIOLATORS[rule.id], `${rule.id} has a violator in this test`);
  }
});

for (const rule of PROFESSIONAL_RULES) {
  test(`professional rule ${rule.id}: the clean fixture passes, the violator is caught with located numeric evidence`, () => {
    const violator = VIOLATORS[rule.id];
    const clean = critiqueProfessionalWouldChange(cleanFixture({ vocals: violator.vocals }));
    assert.equal(clean.observations.filter((o) => o.kind === rule.id).length, 0, `${rule.id} does not fire on the clean fixture`);
    const violated = critiqueProfessionalWouldChange(fixtureWith(violator.mutate, { vocals: violator.vocals }));
    const hits = violated.observations.filter((o) => o.kind === rule.id);
    assert.ok(hits.length >= 1, `${rule.id} fires on its violator (got: ${violated.observations.map((o) => o.kind).join(", ")})`);
    assert.equal(hits[0].dimension, PROFESSIONAL_DIMENSION);
    assert.ok(Object.values(hits[0].evidence).some((v) => typeof v === "number"));
    assert.ok(hits[0].location.trackIds.length >= 1);
    assert.ok(penaltyOf(violated.observations) > penaltyOf(clean.observations));
  });
}

test("observations are sorted by bar then id, so the report is stable for diffing", () => {
  const report = critiqueArbitrariness(anchorFor("rock-full").input);
  const ids = report.observations.map((o: CriticObservation) => `${String(o.location.startBar).padStart(4, "0")}:${o.id}`);
  assert.deepEqual(ids, [...ids].sort((a, b) => Number(a.slice(0, 4)) - Number(b.slice(0, 4)) || a.localeCompare(b)));
});
