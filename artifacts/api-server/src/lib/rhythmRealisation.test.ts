/**
 * Rhythm realisation tests (Brain B-04, D2 / D4 / D5): the parts written from
 * one GroovePlan agree with each other, on the nine synthetic benchmark cases,
 * the owner's song fixture and the re-metred variants.
 *
 *   - interlocking: kick vs the bass rhythm the plan hands the bass writer
 *     (`bassRhythmFor`) - ≥ 0.9 on locked plans, ≥ 0.5 on complement plans;
 *     and the shipped kick/bass agreement (the shipped bass is still B-02's
 *     writer) recorded against its pre-B-04 value;
 *   - anticipation agreement across kit / bass rhythm / comping rhythm /
 *     ostinato on every planned slot;
 *   - meters: no kit note on a beat the bar does not have, the backbeat on the
 *     meter's backbeat pulse, every part inside its own section;
 *   - tempo: no hat pattern faster than the plan's ceiling;
 *   - fills only at planned placements; the ending held; rests at stops.
 */
import assert from "node:assert/strict";
import test from "node:test";
import { BENCHMARK_CORPUS, buildBenchmarkSongModel } from "./benchmarkCorpus";
import {
  anticipationAgreement, bassOnRhythm, composeSong, corpusSongs, frameOf, hatRates, interlocking, meterCheck, meterVariants, planInterlocking,
  type ComposedSong,
} from "./brainB04Evidence";
import { bassRhythmFor, compingRhythmFor, grooveOf, barsOf } from "./composer/rhythmParts";
import { stepUnitsFor } from "./groovePlan";
import { meterOf } from "./composer/frame";

const SONGS: ComposedSong[] = corpusSongs();
const VARIANTS: ComposedSong[] = meterVariants().map((v) => composeSong(v.spec.id, buildBenchmarkSongModel(v.spec)));

test("interlocking on the plan's own contract: kick vs bassRhythmFor agree ≥ 0.9 on locked plans and ≥ 0.5 on complement plans, on every section of the corpus and the owner's song", () => {
  const rows = SONGS.flatMap((s) => planInterlocking(s));
  assert.ok(rows.length >= 20, `${rows.length} sections with a kit and a bass`);
  const locked = rows.filter((r) => r.relation === "lock");
  const complement = rows.filter((r) => r.relation === "complement");
  assert.ok(locked.length >= 10, `${locked.length} locked sections`);
  for (const r of locked) assert.ok(r.kickToBass! >= 0.9, `${r.song} ${r.section} (lock): kick→bass ${r.kickToBass}`);
  for (const r of complement) assert.ok(r.kickToBass! >= 0.5, `${r.song} ${r.section} (complement): kick→bass ${r.kickToBass}`);
  const meanLocked = locked.reduce((a, r) => a + r.kickToBass!, 0) / locked.length;
  assert.ok(meanLocked >= 0.95, `mean locked agreement ${meanLocked.toFixed(3)}`);
});

test("a bass written on bassRhythmFor (a test-local writer with the old pitch logic) locks with the shipped kit: this is what B-02's one-line wiring buys", () => {
  let sections = 0;
  for (const song of SONGS) {
    for (const bass of song.parts.filter((p) => p.request.task === "BASS")) {
      const kit = song.parts.find((p) => p.request.task === "DRUMS" && p.request.section.sectionName === bass.request.section.sectionName);
      if (!kit || !kit.notes.length) continue;
      const frame = frameOf(song, bass);
      const groove = grooveOf(frame);
      if (groove.kickBass.value !== "lock") continue;
      const written = bassOnRhythm(frame);
      // Fill kicks are a gesture, not the groove; the bass is not asked to double them. Compared inside the bass's arc window.
      const windowStart = (bass.request.partWindow.startBar - 1) * frame.barSeconds;
      const windowEnd = bass.request.partWindow.endBar * frame.barSeconds;
      const kicks = kit.notes.filter((n) => n.pitch === 36 && !n.id.includes("-fill") && n.start >= windowStart - 1e-3 && n.start < windowEnd - 1e-3).map((n) => n.start);
      const agree = kicks.filter((k) => written.some((n) => Math.abs(n.start - k) <= 0.03)).length / Math.max(1, kicks.length);
      assert.ok(agree >= 0.9, `${song.id} ${bass.request.section.sectionName}: shipped kit vs bass-on-rhythm ${agree.toFixed(3)}`);
      for (const n of written) assert.ok(n.pitch >= frame.lo && n.pitch <= frame.hi);
      sections += 1;
    }
  }
  assert.ok(sections >= 10, `${sections} locked sections checked`);
});

test("the shipped kick/bass agreement (B-02's bass writer, unwired) has not regressed below its pre-B-04 value", () => {
  const rows = SONGS.flatMap((s) => interlocking(s));
  const mean = rows.filter((r) => r.kickToBass !== null).reduce((a, r) => a + r.kickToBass!, 0) / rows.filter((r) => r.kickToBass !== null).length;
  // Recorded on a751796 with the same measurement: 0.619. It stays there until B-02 calls bassRhythmFor.
  assert.ok(mean >= 0.6, `shipped kick→bass ${mean.toFixed(3)} (before: 0.619)`);
});

test("anticipations agree across the kit, the bass rhythm, the comping rhythm and the ostinato on ≥ 0.9 of the planned slots", () => {
  const all = SONGS.flatMap((s) => anticipationAgreement(s));
  const slots = all.reduce((a, r) => a + r.slots, 0);
  const agreed = all.reduce((a, r) => a + r.agreed, 0);
  assert.ok(slots >= 40, `${slots} planned anticipation slots`);
  assert.ok(agreed / slots >= 0.9, `agreement ${(agreed / slots).toFixed(3)} (${agreed}/${slots})`);
  const disagreements = all.filter((r) => r.slots && r.agreed < r.slots);
  for (const d of disagreements) assert.ok(d.notes.length, `${d.song} ${d.section}: each disagreement names its reason`);
});

test("the pushed downbeat is tied by every part: no kick, bass or comping onset restrikes a downbeat the previous bar anticipated (inside a section)", () => {
  let tied = 0;
  for (const song of SONGS) {
    for (const drums of song.parts.filter((p) => p.request.task === "DRUMS" && p.notes.length)) {
      const frame = frameOf(song, drums);
      const groove = grooveOf(frame);
      if (!groove.anticipations.value.kickAnticipates) continue;
      for (const b of barsOf(frame, groove)) {
        if (!b.tiedDownbeat) continue;
        tied += 1;
        assert.ok(!drums.notes.some((n) => n.pitch === 36 && Math.abs(n.start - b.barStart) < 1e-3), `${song.id} bar ${b.bar}: the kick does not restrike a pushed downbeat`);
        const bass = song.parts.find((p) => p.request.task === "BASS" && p.request.section.sectionName === drums.request.section.sectionName);
        if (bass) {
          const rhythm = bassRhythmFor(frameOf(song, bass));
          assert.ok(!rhythm.some((o) => Math.abs(o.start - b.barStart) < 1e-3), `${song.id} bar ${b.bar}: the bass rhythm ties the downbeat`);
        }
      }
    }
  }
  assert.ok(tied >= 5, `${tied} tied downbeats seen`);
});

test("meters: in 3/4, 6/8, 5/4 and 7/8 no kit onset lies outside the bar, the backbeat snare sits on the meter's backbeat pulse, and every part's notes stay inside its section", () => {
  const checks = [...SONGS, ...VARIANTS].map(meterCheck).filter((m) => m.meter !== "4/4");
  assert.ok(checks.length >= 8);
  for (const m of checks) {
    assert.equal(m.kitOnsetsOutsideBar, 0, `${m.song}: kit onsets outside the ${m.meter} bar`);
    assert.equal(m.notesOutsideSection, 0, `${m.song}: ${m.notesOutsideSection}/${m.notes} notes outside their section`);
    assert.deepEqual(m.familiesSilentInLaterSections, [], `${m.song}: later sections keep their parts`);
    const [num] = m.meter.split("/").map(Number);
    for (const b of [...m.snareBeats, ...m.kickBeats]) assert.ok(b < num, `${m.song}: template hit at unit ${b} of ${num}`);
    const expectedSnare = m.meter === "3/4" ? [1] : m.meter === "6/8" ? [3] : m.meter === "5/4" ? [3] : m.meter === "7/8" ? [4] : null;
    if (expectedSnare) assert.deepEqual(m.snareBeats, expectedSnare, `${m.song}: backbeat snare on ${expectedSnare} in ${m.meter} (got ${m.snareBeats})`);
    if (m.meter === "3/4") assert.deepEqual(m.kickBeats, [0], `${m.song}: a waltz kick on 1 only`);
  }
});

test("tempo awareness: the hat pattern never exceeds the plan's ceiling - 4.95/s at 148 BPM rock (8ths), 8.4/s at 126 BPM dance (programmed 16ths), never 9.9/s", () => {
  const rates = SONGS.map(hatRates);
  const rock = rates.find((r) => r.song === "rock-full")!;
  assert.ok(rock.maxHatStrikesPerSecond! <= 7.5, `rock at 148: ${rock.maxHatStrikesPerSecond}/s (was 9.9)`);
  const dance = rates.find((r) => r.song === "dance-full")!;
  assert.ok(dance.maxHatStrikesPerSecond! <= 9, `dance at 126: ${dance.maxHatStrikesPerSecond}/s`);
  for (const r of rates) if (r.maxHatStrikesPerSecond !== null) assert.ok(r.maxHatStrikesPerSecond <= 9.01, `${r.song}: ${r.maxHatStrikesPerSecond}/s`);
  for (const song of SONGS) {
    for (const drums of song.parts.filter((p) => p.request.task === "DRUMS" && p.notes.length)) {
      const groove = grooveOf(frameOf(song, drums));
      const ceilingStep = stepUnitsFor(groove.densityCeiling.value, meterOf(song.meter)) * groove.meter.unitSeconds;
      const hats = drums.notes.filter((n) => n.pitch === 42 || n.pitch === 46 || n.pitch === 51).map((n) => n.start).sort((a, b) => a - b);
      for (let i = 1; i < hats.length; i += 1) {
        const gap = hats[i] - hats[i - 1];
        if (gap < 1e-3) continue;
        assert.ok(gap >= (ceilingStep || 0) * 0.98 - 1e-6, `${song.id} ${drums.request.section.sectionName}: hat gap ${gap.toFixed(3)} under the ceiling step ${ceilingStep.toFixed(3)}`);
      }
    }
  }
});

test("fills appear only at planned placements, the song's last bar is a held hit or a thin-out, and a section that stops rests where the plan says", () => {
  for (const song of SONGS) {
    for (const drums of song.parts.filter((p) => p.request.task === "DRUMS" && p.notes.length)) {
      const frame = frameOf(song, drums);
      const groove = grooveOf(frame);
      const fillBars = new Set(groove.fills.placements.filter((p) => p.lengthUnits > 0).map((p) => p.bar));
      for (const n of drums.notes.filter((x) => x.id.includes("-fill"))) {
        // Composed starts are rounded to 4 decimals, so a note on a bar line can sit 5e-5 s early.
        const bar = Math.floor(n.start / frame.barSeconds + 1e-4) + 1;
        assert.ok(fillBars.has(bar), `${song.id} ${drums.request.section.sectionName}: fill note ${n.id} in bar ${bar} without a placement`);
      }
      const lastOfSong = Math.max(...drums.request.globalPlan.sectionTargets.map((t) => t.endBar));
      // Only when the kit is still playing at the end (the arc may have it leave earlier - pop-full's drums exit at bar 38 of 40).
      if (drums.request.section.endBar === lastOfSong && drums.request.partWindow.endBar >= lastOfSong && groove.ending.value !== "none") {
        const lastBarStart = (lastOfSong - 1) * frame.barSeconds;
        const inLast = drums.notes.filter((n) => n.start >= lastBarStart - 1e-3);
        assert.ok(inLast.length >= 2 && inLast.length <= 3, `${song.id}: the last bar is a hit, not a groove (${inLast.length} notes)`);
        assert.ok(inLast.every((n) => Math.abs(n.start - lastBarStart) < 1e-3), `${song.id}: everything on the final downbeat`);
        assert.ok(inLast.some((n) => n.pitch === 49), `${song.id}: a crash closes the song`);
      }
    }
  }
});

test("compingRhythmFor: a bed re-attacks on chord changes and holds, rhythmic comping plays the cell, pushes carry the anticipated chord, and both stay inside the part's window", () => {
  const song = SONGS[0];
  const keys = song.parts.find((p) => /KEYS|PIANO/.test(p.request.task) && p.request.section.sectionName === "Chorus")!;
  const frame = frameOf(song, keys);
  const bed = compingRhythmFor(frame, "bed");
  const rhythmic = compingRhythmFor(frame, "rhythmic");
  assert.ok(bed.length >= 4 && rhythmic.length > bed.length, "the rhythmic cell is denser than the bed");
  for (const o of [...bed, ...rhythmic]) {
    assert.ok(o.start >= frame.startSeconds - 1e-6 && o.start < frame.endSeconds, "inside the section");
    assert.ok(o.accent > 0 && o.accent <= 1);
  }
  const pushes = rhythmic.filter((o) => o.anticipates);
  assert.ok(pushes.length >= 1, "the chorus pushes into its chord changes");
  for (const p of pushes) {
    const bar = Math.floor(p.start / frame.barSeconds + 1e-6) + 1;
    const next = frame.request.context.currentBars.chords.find((c) => Math.abs(c.start - bar * frame.barSeconds) < 1e-3) ?? frame.request.context.nextBars.chords[0];
    if (next) assert.equal(p.anticipates!.symbol, next.symbol, "the push carries the chord that arrives on the next downbeat");
  }
});

test("a bass written on bassRhythmFor keeps one voice at a time: onsets never overlap", () => {
  const song = SONGS.find((s) => s.id === "rock-full")!;
  const bass = song.parts.find((p) => p.request.task === "BASS" && p.request.section.sectionName === "Chorus")!;
  const notes = bassOnRhythm(frameOf(song, bass)).sort((a, b) => a.start - b.start);
  for (let i = 1; i < notes.length; i += 1) assert.ok(notes[i].start >= notes[i - 1].start + notes[i - 1].duration - 1e-6, `${notes[i - 1].id} laps ${notes[i].id}`);
});
