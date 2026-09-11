import assert from "node:assert/strict";
import test from "node:test";
import { anchorIds, anchors, applyFamilyCorruption, applyPurposeBuilt, CLEAN_ANCHOR_IDS, detect, eligibleParts } from "./anchors";
import { buildContext, pitchBand } from "./shared";
import { PLANNED_BAND_RANGE, registerDimension, roleWindowForDefinition, vocalRegisterConflict } from "./register";

test("pitch bands and the plan's register bands agree on their centres", () => {
  assert.equal(pitchBand(40), "low");
  assert.equal(pitchBand(55), "low_mid");
  assert.equal(pitchBand(66), "mid");
  assert.equal(pitchBand(78), "upper_mid");
  assert.equal(pitchBand(90), "high");
  for (const [band, [lo, hi]] of Object.entries(PLANNED_BAND_RANGE)) assert.equal(pitchBand(Math.round((lo + hi) / 2)), band);
});

test("positive control: the sustained bed two octaves up leaves its planned band and its comfortable range", () => {
  for (const anchor of anchors(["pop-full", "dance-full", "jazz-full"])) {
    const worsened = applyPurposeBuilt(anchor, "strings_up_two_octaves")!;
    const d = detect(registerDimension, anchor.input, worsened);
    assert.ok(d.detected, anchor.id);
    const band = d.newObservations.find((o) => o.kind === "part_outside_planned_band" || o.kind === "part_outside_comfortable_range");
    assert.ok(band, `${anchor.id}: ${d.newObservations.map((o) => o.kind).join(",")}`);
    assert.deepEqual(band!.location.trackIds, worsened.targetTrackIds);
    assert.ok(band!.location.sectionName);
    assert.ok(["compose", "orchestration"].includes(band!.suspectedOrigin));
  }
});

test("positive control: a bass inverted to the top of the ensemble is outside its band and its range — and after B-21 it is applicable on every anchor", () => {
  // Re-anchored (B-05c), with the cause. The B-01-merge version wrote
  // `applyFamilyCorruption(...)!` and crashed with `Cannot read properties of
  // null` — R-1a P1-2's `TypeError`. The corruption is genuinely inapplicable
  // on dance-full: `roleInversion` refuses when the inverted register would
  // leave the MIDI range or when the part already sits where the inversion
  // would put it (`symbolicCorruptions.ts`), and dance-full's bass is one of
  // those. The harness's own rule — an unchanged input is not a control on that
  // anchor — is what the test now follows, and it names which anchors the
  // control could be applied to so a future change of that set is visible.
  //
  // Re-anchored at the B-13 merge, and the control gained anchors rather than
  // losing them. B-13's bass plays the groove plan's onsets with the texture's
  // full figure set - fifths, octaves, approach tones - so on the three busiest
  // anchors it now spans a register the inversion cannot lift without leaving
  // the instrument (pop-full 31-48, rock-full 28-54, dance-full 31-55), and
  // `roleInversion` refuses exactly as it is meant to. Rather than assert a
  // narrower list on a four-anchor sample, the control now runs over **every**
  // anchor: six of the nine accept it, all six detect, and the three that
  // refuse are named with their measured ranges so a future change of that set
  // is visible.
  //
  // **Re-anchored at the B-21 merge (B-26): a STALE PIN, and the control got
  // its lever back rather than losing it.** Measured on this tree and at
  // `3b9ace3` (B-21's base), same nine anchors, same transform, same seed:
  //
  //   anchor              bass range B-13 -> B-21   inversion      score drop
  //   pop-full            31-48  ->  28-48          skipped -> APPLIES   66.58
  //   rock-full           28-54  ->  28-40          skipped -> APPLIES   78.00
  //   dance-full          31-55  ->  28-48          skipped -> APPLIES   78.00
  //   ballad-piano-vocal  36-48  ->  33-41          applies              51.42
  //   acoustic-demo       38-59  ->  31-52          applies              66.00
  //   orchestral-midi     33-45  ->  33-45          applies              36.00
  //   ethnic-vocal        33-50  ->  33-43          applies              54.00
  //   jazz-full           29-50  ->  29-53          applies              54.00
  //   cinematic-midi      34-39  ->  34-39          applies              66.00
  //
  // `roleInversion` refuses when the inverted register would leave the MIDI
  // range or when the part already sits where the inversion would put it
  // (`symbolicCorruptions.ts`). B-21's D4 gives the bass the window its **own
  // profile** allows (electric bass BASS 28-55) instead of the family range
  // widened by the section's histogram, so on the three busiest anchors the
  // bass stops spanning the register the inversion needs, and the inversion
  // applies again. **Nine of nine applicable, nine of nine detected**, drops
  // 36-78. Nothing was re-pointed and nothing deleted: this control alone
  // demonstrates `register`'s sensitivity on every anchor in the corpus, which
  // is what charter rule 3 asks for before the dimension may gate.
  let detected = 0;
  let applicable = 0;
  const skipped: string[] = [];
  const drops: string[] = [];
  for (const anchor of anchors(anchorIds())) {
    const bass = eligibleParts(anchor, "role_inversion").find((p) => p.family === "bass");
    assert.ok(bass, `${anchor.id}: the anchor has a bass part with enough notes to damage`);
    const worsened = applyFamilyCorruption(anchor, bass!.id, "role_inversion", 3, 1);
    if (!worsened) { skipped.push(anchor.id); continue; }
    applicable += 1;
    const d = detect(registerDimension, anchor.input, worsened);
    drops.push(`${anchor.id}:${d.scoreDrop}`);
    if (!d.detected) continue;
    detected += 1;
    assert.ok(d.newObservations.some((o) => (o.kind === "part_outside_comfortable_range" || o.kind === "part_outside_planned_band") && o.location.trackIds[0] === bass!.id), anchor.id);
  }
  assert.deepEqual(skipped, [],
    `B-21: the inversion applies on every anchor (at B-13 it was refused on dance-full, pop-full and rock-full, whose bass then spanned the register); skipped ${skipped.join(",")}`);
  assert.equal(applicable, anchorIds().length, `applicable ${applicable}/${anchorIds().length}`);
  assert.equal(detected, applicable, `detected ${detected}/${applicable} applicable: ${drops.join(" ")}`);
});

test("the reference beds sit on the singer's pitches: vocal masking is a real finding on the anchors, located to sung sections", () => {
  // Re-anchored at the B-13 merge, with the measurement. This block pins a
  // *defect* - the reference beds are written over the singer - and B-13 made
  // it smaller on the anchor it was read from: rock-full falls from 2 masked
  // sections to 1 (Verse, keys-rhythmic_harmony, 0.60 of the sung beats),
  // because the bed reads the groove plan's bed cell and rests where it used to
  // sit on the voice. The finding has not gone, so the test still asserts it
  // rather than declaring it fixed - it now reads the anchors that carry it
  // and pins the count per anchor. Nothing is relaxed: every reported masking
  // must still be located to a section and carry at least 0.2 of the sung
  // beats.
  // **Re-anchored at the B-21 merge (B-26). This is the one failure in the nine
  // suites that is a REAL REGRESSION, and it is smaller and more specific than
  // it looks from one anchor.** Measured on this tree against `3b9ace3`:
  //
  //   anchor              masked sections  B-13 -> B-21
  //   pop-full                 2 -> 5     Intro .625, Verse .688, Chorus .333, Verse 2 .625, Chorus 2 .444
  //   ballad-piano-vocal       2 -> 1
  //   rock-full                1 -> 2
  //   dance-full               0 -> 0
  //   acoustic-demo            0 -> 0
  //   orchestral-midi          8 -> 7
  //   ethnic-vocal             0 -> 0
  //   jazz-full                1 -> 0
  //   cinematic-midi           4 -> 2
  //   ------------------------------------
  //   total                   18 -> 17
  //
  // So across the corpus the defect is one finding *smaller*; on pop-full it
  // more than doubled. The cause is the collision B-21 created between two
  // rules this dimension has always carried, and the numbers say exactly where
  // the collision bites (window = the part's own role register, sung = the
  // singer's band widened by the masking distance, span = the part's own
  // voicing):
  //
  //   pop-full   keys RHYTHMIC_HARMONY [48,72]  sung 58-69  span 12  below 9   above 2   NO ROOM
  //   pop-full   keys HARMONIC_BED     [48,67]  sung 58-69  span 12  below 9   above -3  NO ROOM
  //   rock-full  keys RHYTHMIC_HARMONY [48,72]  sung 62-73  span 10  below 13  above -2  clear below
  //   ballad     keys RHYTHMIC_HARMONY [48,72]  sung 63-71  span  9  below 14  above 0   clear below
  //   orch       strings CLIMAX_LAYER  [67,91]  sung 60-75  span 13  below -8  above 15  clear above
  //
  // On pop-full the singer sits at 60-67 and a piano's RHYTHMIC_HARMONY
  // register is 48-72: the masked band takes 58-69 out of it, leaving nine
  // semitones underneath for a voicing that spans twelve. **No placement of
  // that part satisfies both the register B-21 gave the writers and the room
  // the singer needs**, and that is not a fact about this dimension's
  // thresholds - a whole-octave fold of the two verses, measured, moves
  // register 66.58 -> 82.18 and clears two of the five, and there is no fold at
  // all for the other three.
  //
  // The arbitration is therefore in the dimension (`vocalRegisterConflict`),
  // not in a re-pinned number: every masking observation now carries the
  // window, the sung band, the room on each side and which constraint has to
  // give, and the ones with nowhere to go are attributed to `orchestration`
  // (the plan chose the role) instead of telling a composer to move a part that
  // cannot move. What this test asserts is the measurement and the attribution;
  // the count is not relaxed and no threshold moved.
  const measured: Record<string, number> = {
    // pop-full is 4, not the 5 B-26 measured on its own branch: the Wave 3
    // merge (B-19's selection, B-22's melody evidence, B-24's jitter reseed)
    // moved its notes and the Chorus bed came off the voice. Corpus total
    // 17 -> 16. Re-measured at the merge, which B-26's tracker entry said
    // these exact-count assertions would need.
    "pop-full": 4, "ballad-piano-vocal": 1, "rock-full": 2, "dance-full": 0, "acoustic-demo": 0,
    "orchestral-midi": 7, "ethnic-vocal": 0, "jazz-full": 0, "cinematic-midi": 2,
  };
  /** How the arbitration resolves each anchor's findings, measured. */
  const resolutions: Record<string, Record<string, number>> = {
    "pop-full": { no_room: 4 },
    "ballad-piano-vocal": { clear_below: 1 },
    "rock-full": { clear_below: 2 },
    "orchestral-midi": { clear_below: 4, clear_above: 1, no_room: 2 },
    "cinematic-midi": { no_room: 2 },
  };
  let total = 0;
  let noRoom = 0;
  for (const anchor of anchors(anchorIds())) {
    const masking = registerDimension.evaluate(anchor.input).observations.filter((o) => o.kind === "vocal_masking");
    assert.equal(masking.length, measured[anchor.id], `${anchor.id}: ${masking.map((o) => `${o.location.sectionName}:${o.evidence.maskedBeatShare}`).join(", ")}`);
    assert.ok(masking.every((o) => o.location.sectionName && (o.evidence.maskedBeatShare as number) >= 0.2), anchor.id);
    const counts: Record<string, number> = {};
    for (const o of masking) {
      counts[String(o.evidence.resolution)] = (counts[String(o.evidence.resolution)] ?? 0) + 1;
      // Every finding states both constraints and the room between them.
      assert.equal(typeof o.evidence.roleRegisterLo, "number", `${anchor.id}/${o.location.sectionName}: the role register is stated`);
      assert.equal(typeof o.evidence.roleRegisterHi, "number");
      assert.ok(String(o.evidence.roleRegisterSource).length > 0, "the ceiling names its source");
      assert.equal(typeof o.evidence.roomBelowVocal, "number");
      assert.equal(typeof o.evidence.roomAboveVocal, "number");
      // …and who owns it follows from that, not from taste.
      if (o.evidence.resolution === "no_room") {
        noRoom += 1;
        assert.equal(o.suspectedOrigin, "orchestration", `${anchor.id}/${o.location.sectionName}: nowhere to move is the plan's decision`);
        assert.equal(o.recommendedRepair?.operation, "replan_register_band");
        assert.equal(o.recommendedRepair?.scope, "plan");
      } else {
        assert.ok(["compose", "register"].includes(o.suspectedOrigin), `${anchor.id}/${o.location.sectionName}: ${o.suspectedOrigin}`);
        assert.ok(["open_voicing_below_vocal", "lift_line_above_vocal"].includes(String(o.recommendedRepair?.operation)), String(o.recommendedRepair?.operation));
      }
      // The lead line is named for what it is: two anchors carry a MIDI lead
      // with no vocal evidence, and a reader must not read those as a singer.
      assert.equal(o.evidence.leadEvidence, o.evidence.leadIsVocal ? "vocal_detected" : "lead_line_without_vocal_evidence");
    }
    if (masking.length) assert.deepEqual(counts, resolutions[anchor.id], `${anchor.id}: ${JSON.stringify(counts)}`);
    total += masking.length;
  }
  assert.equal(total, 16, `vocal masking is still a real finding across the anchors: ${total} sections (B-13 measured 18)`);
  assert.equal(noRoom, 8, `findings with no placement that satisfies both the role register and the voice: ${noRoom}`);
});

test("B-26: where there is no melody the dimension says the masking check did not run, instead of scoring as if there were room", () => {
  // The owner's song is this case and it is why the statement exists: its
  // `vocals.status` is `not_available`, so `register` scores 100 with no
  // masking observation at all — not because the arrangement leaves room for
  // him but because the platform does not know where his voice sits. A report
  // that is silent about that cannot be told apart from one that measured and
  // found nothing.
  const withVocal = anchors(["pop-full"])[0];
  const context = buildContext(withVocal.input);
  assert.ok(context.vocal, "pop-full carries a melody");
  const measuredReport = registerDimension.evaluate(withVocal.input);
  assert.equal(measuredReport.observations.filter((o) => o.kind === "vocal_masking_not_measured").length, 0,
    "where there is a melody the check runs and says nothing extra");

  // The same anchor with its melody removed: nothing else changed.
  const noMelody = { ...withVocal.input, songModel: { ...withVocal.input.songModel, melody: [] } };
  assert.equal(buildContext(noMelody).vocal, null);
  const report = registerDimension.evaluate(noMelody);
  const stated = report.observations.filter((o) => o.kind === "vocal_masking_not_measured");
  assert.equal(stated.length, 1, "the report says the check did not run");
  assert.equal(stated[0].severity, "info", "it is a statement about coverage, not a finding against the notes");
  assert.equal(stated[0].evidence.maskingChecked, false);
  assert.ok(String(stated[0].evidence.reason).includes("no melody"));
  assert.equal(report.observations.filter((o) => o.kind === "vocal_masking").length, 0,
    "and there is indeed nothing to measure");
  // The findings that were there are gone with the melody — which is exactly
  // the silence the statement exists to label. Four, not the five B-26
  // measured on its own branch: the Wave 3 merge (B-19's selection, B-22's
  // melody evidence, B-24's jitter reseed) moved pop-full's notes, and the
  // Chorus bed came off the voice. Re-pinned at the merge, as B-26's tracker
  // entry said these exact-count assertions would have to be.
  assert.equal(measuredReport.observations.filter((o) => o.kind === "vocal_masking").length, 4);
});

test("B-26: the arbitration answers with room, not with taste — and the role decides which side counts", () => {
  // A piano comping part against a singer at 60-67. Its RHYTHMIC_HARMONY
  // register is 48-72, so the masked band 58-69 leaves nine semitones below.
  const window = { lo: 48, hi: 72, source: "instrumentProfile piano roleRegisters.RHYTHMIC_HARMONY" };
  const tight = vocalRegisterConflict({ window, role: "RHYTHMIC_HARMONY", vocalLow: 60, vocalHigh: 67, partLow: 60, partHigh: 72 });
  assert.equal(tight.resolution, "no_room", tight.reason);
  assert.deepEqual(tight.vocalBand, [58, 69]);
  assert.equal(tight.roomBelow, 9);
  assert.equal(tight.roomAbove, 2);
  assert.match(tight.reason, /no placement satisfies both/);

  // The same part with a voicing that fits underneath: nine semitones is
  // enough for a span of nine, and the rule says so with the numbers.
  const fits = vocalRegisterConflict({ window, role: "RHYTHMIC_HARMONY", vocalLow: 60, vocalHigh: 67, partLow: 60, partHigh: 69 });
  assert.equal(fits.resolution, "clear_below", fits.reason);

  // Above the voice is a resolution only for the roles a professional writes
  // there. A violin section's CLIMAX_LAYER register is 67-91 and the same
  // geometry is refused for a PAD, which belongs under the singer.
  const climax = { lo: 67, hi: 91, source: "instrumentProfile violin_section roleRegisters.CLIMAX_LAYER" };
  const above = vocalRegisterConflict({ window: climax, role: "CLIMAX_LAYER", vocalLow: 62, vocalHigh: 73, partLow: 73, partHigh: 86 });
  assert.equal(above.resolution, "clear_above", above.reason);
  const padSameGeometry = vocalRegisterConflict({ window: climax, role: "PAD", vocalLow: 62, vocalHigh: 73, partLow: 73, partHigh: 86 });
  assert.equal(padSameGeometry.resolution, "no_room", "a pad over the singer is the defect, not the resolution");
  assert.equal(padSameGeometry.roomAbove, above.roomAbove, "the geometry is identical; only the role differs");
});

test("B-26: the adversarial string-bed rule and the register dimension read one table (F15)", () => {
  // The lead's F15: `instrumentReality` carried a flat 79 while this dimension
  // asked the profile, and they disagreed about a violin section CLIMAX_LAYER.
  // Both now call `roleWindowForDefinition`, so the two numbers cannot drift.
  const violin = anchors(["orchestral-midi"])[0].input.trackModels.find((t) => t.id === "strings-climax_layer")!;
  const fallback = { min: violin.instrumentDefinition.comfortableRange.min, max: violin.instrumentDefinition.comfortableRange.max };
  assert.equal(roleWindowForDefinition(violin.instrumentDefinition, "CLIMAX_LAYER", fallback).hi, 91);
  assert.equal(roleWindowForDefinition(violin.instrumentDefinition, "PAD", fallback).hi, 79,
    "a PAD still answers exactly the 79 the constant was, so the owner's strings-pad at mean 80.00 still fires");
  assert.match(roleWindowForDefinition(violin.instrumentDefinition, "CLIMAX_LAYER", fallback).source, /instrumentProfile/);
  // An unknown role falls back to the profile's comfortable range and says so.
  const unknown = roleWindowForDefinition(violin.instrumentDefinition, "NOT_A_ROLE", fallback);
  assert.equal(unknown.fromRole, false);
  assert.match(unknown.source, /range\.comfortable/);
});

test("null control: no blocking register observation on any clean anchor", () => {
  for (const anchor of anchors(CLEAN_ANCHOR_IDS)) {
    const report = registerDimension.evaluate(anchor.input);
    assert.ok(report.applicable);
    assert.equal(report.observations.filter((o) => o.severity === "blocking").length, 0, anchor.id);
  }
});
