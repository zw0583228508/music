/**
 * A hand-written clean arrangement (Brain B-05b test fixture).
 *
 * 32 bars, 4/4, 120 BPM, Verse / Chorus / Verse 2 / Chorus 2 over C G Am F,
 * with the things a professional does without thinking: a bass line that
 * approaches changes by step, keyboard voicings that change inversion,
 * strings that enter with a pickup and rest at phrase ends, drum fills into
 * lifts, a second chorus that develops the first, a held ending, and seeded
 * human timing / dynamics. It is the null control for every adversarial
 * module (a clean arrangement must not be rejected) and the base the
 * per-rule violators mutate.
 */
import type { ArrangementPlan, MusicalNote, TrackModel } from "@workspace/db";
import { getInstrumentDefinition } from "../../musicEngines";
import { buildBenchmarkSongModel, type BenchmarkCase } from "../../benchmarkCorpus";
import type { CriticInput } from "../types";

export const FIXTURE_SPEC: BenchmarkCase = {
  id: "b05b-clean-fixture", genre: "pop", inputType: "full_song", tempoBpm: 120, meter: "4/4", key: "C",
  form: [["Verse", 8], ["Chorus", 8], ["Verse", 8], ["Chorus", 8]],
  progression: ["C", "G", "Am", "F"], melodyFigure: [0, 4, 7, 4],
  stems: ["vocals", "drums", "bass", "keys", "strings"],
  energies: [0.35, 0.75, 0.45, 0.9],
};

const BAR = 2;
const BEAT = 0.5;
const r4 = (v: number) => Number(v.toFixed(4));

function seededUnit(seed: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < seed.length; i += 1) { h ^= seed.charCodeAt(i); h = Math.imul(h, 0x01000193) >>> 0; }
  return (h >>> 8) / 0x1000000;
}
/** Human timing: +-6 ms, seeded by the note id. */
const jitter = (id: string) => (seededUnit(id) - 0.5) * 0.012;

type Writer = { notes: MusicalNote[]; add: (id: string, bar: number, beat: number, duration: number, pitch: number, velocity: number) => void };
function writer(prefix: string): Writer {
  const notes: MusicalNote[] = [];
  return {
    notes,
    add(id, bar, beat, duration, pitch, velocity) {
      const nid = `${prefix}-${id}`;
      notes.push({ id: nid, start: r4((bar - 1) * BAR + beat * BEAT + jitter(nid)), duration: r4(duration * BEAT), pitch, velocity: Math.max(1, Math.min(127, Math.round(velocity + (seededUnit(`${nid}:v`) - 0.5) * 6))) });
    },
  };
}

const ROOTS = [0, 7, 9, 5]; // C G Am F
const QUAL = [[0, 4, 7], [0, 4, 7], [0, 3, 7], [0, 4, 7]];
const chordIndexAt = (bar: number) => Math.floor((bar - 1) / 2) % 4;
const sectionOf = (bar: number) => (bar <= 8 ? "Verse" : bar <= 16 ? "Chorus" : bar <= 24 ? "Verse 2" : "Chorus 2");
const isChorus = (bar: number) => bar > 8 && (bar <= 16 || bar > 24);
const isLastBarOfSection = (bar: number) => bar % 8 === 0;
const phraseBar = (bar: number) => ((bar - 1) % 4) + 1;

export type FixtureOptions = { vocals?: boolean };

export function cleanFixture(options: FixtureOptions = {}): CriticInput {
  const spec: BenchmarkCase = options.vocals === false ? { ...FIXTURE_SPEC, id: `${FIXTURE_SPEC.id}-instrumental`, stems: FIXTURE_SPEC.stems.filter((s) => s !== "vocals") } : FIXTURE_SPEC;
  const songModel = buildBenchmarkSongModel(spec);

  // Drums: kick 1 (+ "and of 3" in choruses), snare 2/4, hats quarters in verses and eighths in choruses,
  // accents shaped over the phrase, a fill into every lift, a crash on the final downbeat only.
  const drums = writer("dr");
  for (let bar = 1; bar <= 32; bar += 1) {
    const chorus = isChorus(bar);
    const lift = chorus ? 14 : 0;
    const shape = phraseBar(bar) * 2;
    if (bar === 32) { drums.add("crash", bar, 0, 4, 49, 104); drums.add("k-final", bar, 0, 1, 36, 104); continue; }
    drums.add(`k${bar}`, bar, 0, 0.4, 36, 92 + lift);
    // Chorus 1: a pushed kick every other bar; Chorus 2: every bar (the development).
    if (chorus && (bar % 2 === 0 || bar > 24)) drums.add(`k${bar}b`, bar, 2.5, 0.4, 36, 80 + lift);
    drums.add(`s${bar}a`, bar, 1, 0.4, 38, 88 + lift + shape);
    drums.add(`s${bar}b`, bar, 3, 0.4, 38, 86 + lift + shape);
    // Verse 1 hats in quarters, Verse 2 and the choruses in eighths.
    const steps = chorus || bar > 16 ? 8 : 4;
    for (let s = 0; s < steps; s += 1) {
      if (isLastBarOfSection(bar) && s >= steps - (steps === 8 ? 2 : 1)) break;
      drums.add(`h${bar}-${s}`, bar, s * (4 / steps), 0.25, 42, (s % 2 ? 48 : 66) + lift * 0.6 + shape);
    }
    if (isLastBarOfSection(bar) && bar !== 32) {
      [45, 47, 48, 50].forEach((tom, i) => drums.add(`fill${bar}-${i}`, bar, 3 + i * 0.25, 0.25, tom, 84 + i * 5 + lift));
    }
  }

  // Bass: root on 1, fifth on the "and of 3" in verses; in choruses root / octave / fifth / a stepwise
  // approach into the next root on the "and of 4". Verse 2 adds the approach; final bar a held root.
  const bass = writer("bs");
  for (let bar = 1; bar <= 32; bar += 1) {
    const ci = chordIndexAt(bar);
    const root = 36 + ROOTS[ci] + (ROOTS[ci] > 6 ? -12 : 0) + 12; // 41-48
    const chorus = isChorus(bar);
    const vel = (chorus ? 92 : 78) + phraseBar(bar) * 2;
    if (bar === 32) { bass.add("final", bar, 0, 4, root, 96); continue; }
    // One voice at a time (the bass ceiling is one), and a breath at every phrase end.
    const phraseEnd = phraseBar(bar) === 4;
    bass.add(`r${bar}`, bar, 0, chorus ? 1.4 : phraseEnd ? 1.8 : 2.3, root, vel);
    if (chorus) {
      bass.add(`o${bar}`, bar, 1.5, 0.4, root + 12 > 55 ? root : root + 12, vel - 10);
      if (!phraseEnd) bass.add(`f${bar}`, bar, 2, 0.9, root + 7 > 55 ? root - 5 : root + 7, vel - 6);
    } else if (!phraseEnd) {
      bass.add(`f${bar}`, bar, 2.5, 0.9, root + 7 > 55 ? root - 5 : root + 7, vel - 8);
    }
    if (bar % 2 === 0 && !phraseEnd && (chorus || bar > 16)) {
      const nextRoot = 36 + ROOTS[chordIndexAt(bar + 1)] + (ROOTS[chordIndexAt(bar + 1)] > 6 ? -12 : 0) + 12;
      bass.add(`a${bar}`, bar, 3.5, 0.45, nextRoot - (nextRoot > root ? 1 : -1) * 1, vel - 4);
    }
  }

  // Keys: enter in Chorus (comping), stay as a light pad in Verse 2, comp with an added "and of 3" in Chorus 2.
  // Voicings cycle inversions so the shape and the lowest note change chord to chord; all above the bass.
  const keys = writer("ky");
  const voicing = (ci: number, inversion: number, centre: number): number[] => {
    const tones = QUAL[ci].map((iv) => (ROOTS[ci] + iv) % 12);
    const order = [...tones.slice(inversion), ...tones.slice(0, inversion)];
    const out: number[] = [];
    let floor = centre - 6;
    for (const pc of order) {
      let p = pc + 12 * Math.ceil((floor - pc) / 12);
      if (p < floor) p += 12;
      out.push(p);
      floor = p + 1;
    }
    return out;
  };
  for (let bar = 9; bar <= 32; bar += 1) {
    const ci = chordIndexAt(bar);
    const inv = (Math.floor((bar - 1) / 2) + (bar > 24 ? 1 : 0)) % 3;
    const chord = voicing(ci, inv, 64);
    const section = sectionOf(bar);
    if (bar === 32) { chord.forEach((p, i) => keys.add(`final-${i}`, bar, 0, 4, p, 82 - i * 2)); continue; }
    if (section === "Verse 2") {
      // A pad on each phrase start and a shorter one in bar 3, leaving bar 4 of the phrase silent.
      if (phraseBar(bar) === 1) chord.forEach((p, i) => keys.add(`pad${bar}-${i}`, bar, 0, 7.4, p, 58 - i * 2));
      if (phraseBar(bar) === 3) chord.forEach((p, i) => keys.add(`pad${bar}-${i}`, bar, 0, 3.6, p, 60 - i * 2));
      continue;
    }
    const hits = bar > 24 ? [0, 1.5, 2.5, 3] : [0, 1.5, 3];
    if (phraseBar(bar) === 4) hits.splice(2); // breathe before the next phrase
    const base = bar > 24 ? 74 : 68;
    for (const h of hits) {
      // The last hit before a chord change anticipates the next chord on the "and of 4".
      const anticipates = h === hits[hits.length - 1] && bar % 2 === 0 && phraseBar(bar) !== 4;
      const voiced = anticipates ? voicing(chordIndexAt(bar + 1), (inv + 1) % 3, 64) : chord;
      const at = anticipates ? 3.5 : h;
      voiced.forEach((p, i) => keys.add(`c${bar}-${at}-${i}`, bar, at, at === 0 ? 1.2 : 0.7, p, base - i * 3 + phraseBar(bar)));
    }
  }

  // Strings: a three-note pickup into the chorus, sustained two-bar chords in the viola/cello register with a
  // rest in the last bar of each phrase; Chorus 2 adds a stepwise top line one note per bar.
  const strings = writer("st");
  strings.add("pick-0", 8, 2, 0.9, 69, 60); strings.add("pick-1", 8, 3, 0.9, 71, 64); strings.add("pick-2", 8, 3.5, 0.5, 72, 68);
  strings.add("pick2-0", 24, 2, 0.9, 69, 66); strings.add("pick2-1", 24, 3, 0.9, 71, 70); strings.add("pick2-2", 24, 3.5, 0.5, 72, 74);
  const topLine = [79, 77, 76, 77, 79, 81, 83, 84];
  for (let bar = 9; bar <= 32; bar += 1) {
    if (!isChorus(bar)) continue;
    const ci = chordIndexAt(bar);
    // Violins above the keyboard's comping register (66-78), never in its octave.
    const chord = voicing(ci, (ci + 1) % 3, 72).slice(0, 3);
    if (bar === 32) { chord.forEach((p, i) => strings.add(`final-${i}`, bar, 0, 4, p, 84 - i)); strings.add("final-top", bar, 0, 4, 84, 88); continue; }
    if (bar % 2 === 1 && phraseBar(bar) !== 4) {
      // A phrase-bar-3 chord runs 4.6 beats: it holds over the phrase's last
      // bar, which is a rest, and stops short of the next phrase.
      //
      // B-13 at the merge: bar 31 is the exception, and it was wrong. Bar 32
      // is not a rest - it carries the final four-voice chord - so 4.6 beats
      // rang 0.6 of a beat (302 ms) into it and eight string voices sounded
      // together on a section whose ceiling is four. It was invisible until
      // B-13: the old contract bucketed onsets to the millisecond but then
      // filtered by exact start, so three of the final chord's four voices
      // (62.0032 / 62.0033 / 62.0034 s, all in the 62003 ms bucket) were
      // dropped from the cluster it measured and it counted four. B-13's
      // `polyphonyClusters` evaluates at each gesture's *last* onset, so every
      // voice of a staggered chord has arrived - and the fixture's overlap is
      // real. This is a hand-written *clean* arrangement and the null control
      // it anchors means what it says, so the pad now releases 48 ms before
      // the final chord instead of playing through it.
      const dur = phraseBar(bar) === 3 ? (bar === 31 ? 3.9 : 4.6) : 7.6;
      chord.forEach((p, i) => strings.add(`p${bar}-${i}`, bar, 0, dur, p, (bar > 24 ? 72 : 62) - i * 2));
    }
    if (bar > 24) strings.add(`top${bar}`, bar, 0, phraseBar(bar) === 4 ? 2.8 : 3.8, topLine[bar - 25], 76 + phraseBar(bar) * 2);
  }

  const track = (id: string, instrument: string, role: string, notes: MusicalNote[]): TrackModel => ({
    id, instrument, instrumentDefinition: getInstrumentDefinition(instrument, role), role,
    notes: [...notes].sort((a, b) => a.start - b.start || a.pitch - b.pitch), cc: [], articulations: [], automation: [],
    source: "B05B_FIXTURE", version: 1,
    provenance: { model: "b05b-clean-fixture", version: "1.0", parameters: {}, parentIds: [], createdBy: "b05b" },
  });
  const trackModels = [
    track("drums-groove", "drums", "GROOVE", drums.notes),
    track("bass-bass", "bass", "BASS", bass.notes),
    track("keys-harmonic_bed", "keys", "HARMONIC_BED", keys.notes),
    track("strings-pad", "strings", "PAD", strings.notes),
  ];

  const sections = [
    { sectionName: "Verse", startBar: 1, endBar: 8, role: "verse" as const, energy: 0.35 },
    { sectionName: "Chorus", startBar: 9, endBar: 16, role: "chorus" as const, energy: 0.75 },
    { sectionName: "Verse 2", startBar: 17, endBar: 24, role: "verse" as const, energy: 0.45 },
    { sectionName: "Chorus 2", startBar: 25, endBar: 32, role: "chorus" as const, energy: 0.9 },
  ];
  const assignment = (sectionName: string, instrument: string, role: string, startBar: number, endBar: number) => ({
    sectionName, instrument, role: role as "GROOVE", register: "mid" as const, density: 0.6, rhythmicActivity: 0.5, melodicActivity: 0.3,
    voicingStrategy: "close" as const, articulationFamily: "mixed" as const, dynamicShape: "mp", interactionWithLead: "support" as const,
    entryBar: startBar, exitBar: endBar,
  });
  const plan = {
    id: "b05b-fixture-plan", version: 1, sections: [], style: {}, songModelVersion: 1, parameters: {},
    provenance: { model: "b05b-clean-fixture", version: "1.0", parameters: {}, parentIds: [], createdBy: "b05b" },
    hierarchy: {},
    globalPlan: {
      version: "1.0", derivedAt: "2026-01-01T00:00:00.000Z", inputsDigestSha256: "fixture", method: "hand", confidence: 1,
      style: "pop", substyle: null, instrumentPalette: [],
      sectionTargets: sections.map((s) => ({ ...s, density: s.energy, tension: s.energy, noveltyVsPrevious: 0.3 })),
      climax: { sectionName: "Chorus 2", atBar: 25, energy: 0.9 }, secondaryClimax: null,
      grooveStrategy: "steady_pulse", orchestrationStrategy: "layered_build", motifStrategy: "recurring_hook",
      contrastStrategy: "dynamic_contrast", harmonicComplexity: 0.3, rhythmicComplexity: 0.4, productionAesthetic: "polished_pop",
    },
    sectionPlan: {
      version: "1.0", derivedAt: "2026-01-01T00:00:00.000Z", inputsDigestSha256: "fixture", method: "hand", sections: [],
      phrases: [],
      roleAssignments: [
        ...sections.map((s) => assignment(s.sectionName, "drums", "GROOVE", s.startBar, s.endBar)),
        ...sections.map((s) => assignment(s.sectionName, "bass", "BASS", s.startBar, s.endBar)),
        assignment("Chorus", "keys", "HARMONIC_BED", 9, 16), assignment("Verse 2", "keys", "PAD", 17, 24), assignment("Chorus 2", "keys", "HARMONIC_BED", 25, 32),
        assignment("Chorus", "strings", "PAD", 8, 16), assignment("Chorus 2", "strings", "CLIMAX_LAYER", 24, 32),
      ],
    },
    transitionPlan: {
      version: "1.0", derivedAt: "2026-01-01T00:00:00.000Z", inputsDigestSha256: "fixture", method: "hand",
      transitions: [
        { id: "t1", fromSection: "Verse", toSection: "Chorus", atBar: 9, approachBars: 1, kind: "build", strength: 0.6, harmonicApproach: "none", vocalSafe: true, devices: [{ device: "drum_fill", instrument: "drums", startBar: 8, endBar: 8, intensity: 0.6, rationale: "lift" }] },
        { id: "t3", fromSection: "Verse 2", toSection: "Chorus 2", atBar: 25, approachBars: 1, kind: "build", strength: 0.8, harmonicApproach: "none", vocalSafe: true, devices: [{ device: "drum_fill", instrument: "drums", startBar: 24, endBar: 24, intensity: 0.8, rationale: "climax" }] },
      ],
    },
  } as unknown as ArrangementPlan;

  return { songModel, plan, trackModels };
}

/** The clean fixture with its track models rewritten by `mutate` (a violator for one rule). */
export function fixtureWith(mutate: (tracks: TrackModel[], input: CriticInput) => TrackModel[], options: FixtureOptions = {}): CriticInput {
  const input = cleanFixture(options);
  return { ...input, trackModels: mutate(input.trackModels.map((t) => ({ ...t, notes: t.notes.map((n) => ({ ...n })) })), input) };
}
