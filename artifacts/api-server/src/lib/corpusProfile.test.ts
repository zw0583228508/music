import assert from "node:assert/strict";
import test from "node:test";
import type { MidiNote, ParsedMidi } from "./midiFile";
import { aggregateProfiles, effectiveCount, ensembleClassOf, genreFamilyOf, meterSpans, profileWork, summarise } from "./corpusProfile";

const TPQ = 480;
const BAR = 4 * TPQ;

function note(over: Partial<MidiNote>): MidiNote {
  return { track: 0, channel: 0, program: 0, isPercussion: false, pitch: 60, velocity: 80, startTick: 0, endTick: 240, ...over };
}

/** C-major I–IV–V–I in the keys, roots in the bass, a kick on every beat; `bars` bars. */
function trio(bars: number): ParsedMidi {
  const notes: MidiNote[] = [];
  const chords = [[60, 64, 67], [65, 69, 72], [67, 71, 74], [60, 64, 67]];
  const roots = [36, 41, 43, 36];
  for (let bar = 0; bar < bars; bar += 1) {
    const chord = chords[bar % 4];
    for (const p of chord) notes.push(note({ startTick: bar * BAR, endTick: bar * BAR + BAR, pitch: p, track: 0 }));
    for (let beat = 0; beat < 4; beat += 1) {
      notes.push(note({ startTick: bar * BAR + beat * TPQ, endTick: bar * BAR + beat * TPQ + TPQ, pitch: roots[bar % 4], program: 33, track: 1 }));
      notes.push(note({ startTick: bar * BAR + beat * TPQ, endTick: bar * BAR + beat * TPQ + 120, pitch: 36, isPercussion: true, channel: 9, track: 2 }));
    }
  }
  return {
    ticksPerQuarter: TPQ, format: 1, trackCount: 4, notes,
    tempos: [{ tick: 0, usPerQuarter: 500_000, bpm: 120 }],
    timeSignatures: [{ tick: 0, numerator: 4, denominator: 4 }],
    endTick: bars * BAR,
  };
}

/** Right hand and left hand on two MIDI tracks: two tracks, one family. */
function pianoTwoHands(bars: number): ParsedMidi {
  const base = trio(bars);
  return { ...base, notes: base.notes.filter((n) => !n.isPercussion).map((n) => ({ ...n, program: 0 })) };
}

test("ensemble class: two piano hands are solo; keys + bass or keys + drums are multitrack", () => {
  assert.equal(ensembleClassOf([]), "empty");
  assert.equal(ensembleClassOf(["keys"]), "solo");
  assert.equal(ensembleClassOf(["drums"]), "solo");
  assert.equal(ensembleClassOf(["keys", "bass"]), "multitrack");
  assert.equal(ensembleClassOf(["drums", "keys"]), "multitrack");
  const two = profileWork(pianoTwoHands(16), "p");
  assert.equal(two.trackCount, 2);
  assert.deepEqual(two.families, ["keys"]);
  assert.equal(two.ensemble, "solo");
});

test("genre family folds the CSV's hyphen-joined field on its first token", () => {
  assert.equal(genreFamilyOf("classical"), "classical");
  assert.equal(genreFamilyOf("rock-pop"), "rock");
  assert.equal(genreFamilyOf("pop-rbfunksoul"), "pop");
  assert.equal(genreFamilyOf("metal"), "rock");
  assert.equal(genreFamilyOf("religiousmusic"), "religious");
  assert.equal(genreFamilyOf("NA"), "unknown");
  assert.equal(genreFamilyOf(undefined), "unknown");
  assert.equal(genreFamilyOf("polka"), "other");
});

test("a work profile reads the score's real facts", () => {
  const profile = profileWork(trio(24), "w", { genres: "pop-rock", versionGroup: "g1" });
  assert.equal(profile.trackCount, 3);
  assert.equal(profile.noteCount, 24 * (3 + 4 + 4));
  assert.deepEqual(profile.programs, [0, 33, 128]);
  assert.deepEqual(profile.families, ["drums", "keys", "bass"]);
  assert.equal(profile.pitchedFamilyCount, 2);
  assert.equal(profile.hasDrums, true);
  assert.equal(profile.ensemble, "multitrack");
  assert.equal(profile.barCount, 24);
  assert.deepEqual(profile.meters, ["4/4"]);
  assert.deepEqual(profile.tempos, [120]);
  assert.equal(profile.key, "C major");
  assert.ok(profile.keyConfidence! > 0.5);
  assert.equal(profile.harmony.namedBars, 24, "every bar carries a clear triad");
  assert.equal(profile.harmony.distinctChords, 3, "C, F, G");
  // I–IV–V–I repeats: the only static transition is I→I across the loop seam, 5 of 23.
  assert.equal(profile.harmony.chordChangeRate, Number((18 / 23).toFixed(3)));
  assert.equal(profile.densityByFamily.keys, 3);
  assert.equal(profile.densityByFamily.bass, 4);
  assert.equal(profile.densityByFamily.drums, 4);
  assert.equal(profile.phrase.runs, 2, "keys and bass each play one unbroken run");
  assert.equal(profile.phrase.medianBeats, 96);
  assert.equal(profile.genreFamily, "pop");
  assert.equal(profile.csv.versionGroup, "g1");
  assert.equal(profile.fingerprint.workId, "w");
  assert.equal(profile.fingerprint.signature.length, 64);
  assert.ok(profile.tokenCount > 24 * 11 * 4);
  assert.ok(profile.taskCounts.masked_track! >= 6, "three families × two windows at least");
  assert.equal(profile.taskCounts.whole_form, 3);
  assert.deepEqual(Object.keys(profile.taskFamilyCounts.whole_form!).sort(), ["bass", "drums", "keys"]);
});

test("metre: the dominant metre, the change count and a pickup bar are read from the file", () => {
  const base = trio(16);
  const plain = profileWork(base, "w");
  assert.equal(plain.dominantMeter, "4/4");
  assert.equal(plain.meterChanges, 0);
  assert.equal(plain.pickupBar, false);
  // A one-beat anacrusis exported as 1/4 for one bar, then 4/4 for the rest.
  const withPickup: ParsedMidi = { ...base, timeSignatures: [{ tick: 0, numerator: 1, denominator: 4 }, { tick: TPQ, numerator: 4, denominator: 4 }] };
  const p = profileWork(withPickup, "w");
  assert.deepEqual(p.meters, ["1/4", "4/4"]);
  assert.equal(p.dominantMeter, "4/4");
  assert.equal(p.meterChanges, 1);
  assert.equal(p.pickupBar, true);
  // A real change halfway is not a pickup.
  const change: ParsedMidi = { ...base, timeSignatures: [{ tick: 0, numerator: 4, denominator: 4 }, { tick: 8 * BAR, numerator: 3, denominator: 4 }] };
  const c = profileWork(change, "w");
  assert.equal(c.pickupBar, false);
  assert.equal(c.meterChanges, 1);
  assert.equal(c.dominantMeter, "4/4", "8 bars of 4/4 outlast the 3/4 tail");
  assert.deepEqual(meterSpans({ timeSignatures: [], ticksPerQuarter: TPQ, endTick: 0 }), { dominant: "4/4", changes: 0, pickup: false });
});

test("the melody family and its phrase length are reported when a melody exists", () => {
  const profile = profileWork(trio(16), "w");
  assert.equal(profile.melodyFamily, "keys", "keys sit above the bass");
  assert.equal(profile.phrase.melodyMedianBeats, 64);
  const solo = profileWork(pianoTwoHands(16), "w");
  assert.equal(solo.melodyFamily, null);
  assert.equal(solo.phrase.melodyMedianBeats, null);
});

test("a rest-delimited run ends at a quarter-note rest", () => {
  const base = trio(8);
  // Remove bar 3 from the bass entirely: the bass now plays bars 0–2 and 4–7 → two runs; keys one → three runs.
  const gapped: ParsedMidi = { ...base, notes: base.notes.filter((n) => !(n.program === 33 && n.startTick >= 3 * BAR && n.startTick < 4 * BAR)) };
  const profile = profileWork(gapped, "w");
  assert.equal(profile.phrase.runs, 3);
});

test("the key estimator refuses thin material and the profile says null", () => {
  const thin: ParsedMidi = { ...trio(1), notes: trio(1).notes.slice(0, 4) };
  const profile = profileWork(thin, "w");
  assert.equal(profile.key, null);
  assert.equal(profile.keyConfidence, null);
});

test("aggregation counts what the profiles say", () => {
  const profiles = [
    profileWork(trio(24), "a", { genres: "classical" }),
    profileWork(trio(40), "b", { genres: "rock-pop" }),
    profileWork(pianoTwoHands(16), "c", { genres: "NA" }),
    profileWork({ ...trio(1), notes: [] }, "d"),
  ];
  const agg = aggregateProfiles(profiles, { capPerType: 1 });
  assert.equal(agg.works, 4);
  assert.deepEqual(agg.byEnsemble, { empty: 1, solo: 1, multitrack: 2 });
  assert.equal(agg.familyPresence.all.keys, 3);
  assert.equal(agg.familyPresence.multitrack.drums, 2);
  assert.deepEqual(agg.ensembles.top, { "drums+keys+bass": 2 });
  assert.equal(agg.meters.top["4/4"], 4);
  assert.equal(agg.meters.dominantTop["4/4"], 4);
  assert.equal(agg.meters.worksWithPickupBar, 0);
  assert.equal(agg.ensembles.effective, 1, "one ensemble only");
  assert.equal(effectiveCount([1, 1, 1, 1]), 4);
  assert.deepEqual(agg.melodyFamily, { keys: 2 });
  assert.equal(agg.phraseMedianBeats.melody!.n, 2);
  assert.equal(agg.keys.major, 3);
  assert.equal(agg.keys.worksWithoutKey, 1);
  assert.deepEqual(agg.genres.byFamily, { classical: 1, rock: 1, unknown: 2 });
  assert.deepEqual(agg.genres.multitrackByFamily, { classical: 1, rock: 1 });
  assert.equal(agg.tasks.byType.whole_form, 6);
  assert.equal(agg.tasks.worksYieldingByType.whole_form, 2);
  assert.equal(agg.tasks.byTypeAndFamily.whole_form.bass, 2);
  assert.equal(agg.tasks.byGenreFamily.classical, Object.values(profiles[0].taskCounts).reduce((s, n) => s + n, 0));
  assert.ok(agg.tasks.total > agg.tasks.totalCapped, "the cap bites on a 40-bar piece");
  assert.equal(agg.tasks.worksYieldingAny, 3, "the solo piano still yields continuations");
  // The ensemble breakdown separates what only a multitrack score can teach
  // from what a solo score can: whole_form needs two families, phrase
  // continuation does not.
  assert.equal(
    agg.tasks.byEnsemble.solo + agg.tasks.byEnsemble.multitrack + agg.tasks.byEnsemble.empty,
    agg.tasks.total,
    "every task belongs to exactly one ensemble class",
  );
  assert.equal(agg.tasks.byEnsemble.empty, 0, "an empty score yields nothing");
  assert.deepEqual(agg.tasks.byTypeAndEnsemble.whole_form, { empty: 0, solo: 0, multitrack: 6 });
  assert.ok(agg.tasks.byTypeAndEnsemble.phrase_continuation.solo > 0, "a solo piano yields phrase continuations");
  assert.deepEqual(agg.tasks.worksYieldingByEnsemble, { empty: 0, solo: 1, multitrack: 2 });
  for (const [type, byEnsemble] of Object.entries(agg.tasks.byTypeAndEnsemble)) {
    const sum = byEnsemble.empty + byEnsemble.solo + byEnsemble.multitrack;
    assert.equal(sum, agg.tasks.byType[type], `${type} splits exactly over ensemble classes`);
  }
  assert.equal(agg.barCount.multitrackHistogram["16-31"], 1);
  assert.equal(agg.barCount.multitrackHistogram["32-63"], 1);
  assert.equal(agg.tokenCount.multitrackUnder["8192"], 2);
});

test("summarise reports percentiles", () => {
  assert.equal(summarise([]), null);
  const s = summarise([5, 1, 3, 2, 4])!;
  assert.equal(s.n, 5);
  assert.equal(s.min, 1);
  assert.equal(s.max, 5);
  assert.equal(s.p50, 3);
  assert.equal(s.mean, 3);
});
