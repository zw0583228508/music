/**
 * The one chord-symbol parser (Brain B-02, D1).
 *
 * Every case the twelve previous parsers disagreed on is pinned here with the
 * reading a musician would give, plus the analysis engine's own cases (its
 * `parseChordSymbol` now adapts onto this module) and a round trip through
 * `formatChord` over the whole vocabulary.
 */
import assert from "node:assert/strict";
import test from "node:test";
import {
  bassInterval, chordFromEvent, chordPitchClassesOf, formatChord, inversionOfChord, parseChord, parseChordTemplate,
  parsePitchClass, ROOT_NAMES, TEMPLATE_INTERVALS, TEMPLATE_SUFFIX, type ParsedChord, type TemplateQuality,
} from "./chordSymbols";

const pcs = (symbol: string): number[] | null => parseChord(symbol)?.pitchClasses ?? null;
const sorted = (xs: number[] | null) => (xs ? [...xs].sort((a, b) => a - b) : null);
const intervals = (symbol: string) => parseChord(symbol)?.intervals ?? null;

test("roots: both accidental spellings, unicode accidentals, double accidentals folded, canonical names", () => {
  assert.equal(parsePitchClass("C"), 0);
  assert.equal(parsePitchClass("C#"), 1);
  assert.equal(parsePitchClass("Db"), 1);
  assert.equal(parsePitchClass("D♭"), 1);
  assert.equal(parsePitchClass("E♭"), 3);
  assert.equal(parsePitchClass("D#"), 3);
  assert.equal(parsePitchClass("Cb"), 11);
  assert.equal(parsePitchClass("B#"), 0);
  assert.equal(parsePitchClass("E#"), 5);
  assert.equal(parsePitchClass("Fb"), 4);
  assert.equal(parsePitchClass("C##"), 2);
  assert.equal(parsePitchClass("Dbb"), 0);
  assert.equal(parsePitchClass("H"), null);
  assert.equal(parseChord("D#m")!.rootName, "Eb", "pitch class 3 is spelled Eb by the platform");
  assert.equal(parseChord("D#m")!.symbol, "Ebm");
  assert.equal(parseChord("Ebmaj7")!.root, 3);
  assert.equal(parseChord("E♭maj7")!.root, 3);
  assert.deepEqual(ROOT_NAMES, ["C", "C#", "D", "Eb", "E", "F", "F#", "G", "Ab", "A", "Bb", "B"]);
});

test("triads and the cases the twelve parsers disagreed on", () => {
  assert.deepEqual(pcs("C"), [0, 4, 7]);
  assert.deepEqual(pcs("Am"), [9, 0, 4]);
  assert.deepEqual(pcs("Cdim"), [0, 3, 6]);
  assert.deepEqual(pcs("Caug"), [0, 4, 8]);
  assert.deepEqual(pcs("C+"), [0, 4, 8]);
  assert.deepEqual(pcs("C5"), [0, 7], "a power chord has no third");
  // musicCritic read Gsus4 as a G major triad; the composer read a suspension. It is a suspension.
  assert.deepEqual(pcs("Gsus4"), [7, 0, 2]);
  assert.equal(parseChord("Gsus4")!.roles.get(0), "suspension");
  assert.deepEqual(pcs("Gsus"), [7, 0, 2]);
  assert.deepEqual(pcs("Csus2"), [0, 2, 7]);
  // C/E carries its bass everywhere now (the composer discarded it).
  const slash = parseChord("C/E")!;
  assert.equal(slash.bass, 4);
  assert.equal(slash.symbol, "C/E");
  assert.equal(inversionOfChord(slash), 1);
  assert.equal(bassInterval(slash), 4);
  assert.equal(parseChord("C")!.bass, 0);
  assert.equal(inversionOfChord(parseChord("C/G")!), 2);
  assert.equal(inversionOfChord(parseChord("G7/F")!), 3);
  assert.equal(inversionOfChord(parseChord("C/Bb")!), -1, "a non-chord-tone bass is not an inversion");
  assert.equal(bassInterval(parseChord("C/Bb")!), null);
  assert.equal(parseChord("Am/C")!.symbol, "Am/C");
});

test("sevenths: m7b5, dim7, maj7 in every spelling, the minor-major seventh, and the uppercase-M trap", () => {
  assert.deepEqual(intervals("Cm7b5"), [0, 3, 6, 10]);
  assert.equal(parseChord("Cm7b5")!.template, "m7b5");
  assert.deepEqual(intervals("Cø"), [0, 3, 6, 10]);
  assert.deepEqual(intervals("Cø7"), [0, 3, 6, 10]);
  assert.deepEqual(intervals("Chdim7"), [0, 3, 6, 10]);
  assert.deepEqual(intervals("Cdim7"), [0, 3, 6, 9]);
  assert.deepEqual(intervals("Co7"), [0, 3, 6, 9]);
  assert.deepEqual(intervals("C°7"), [0, 3, 6, 9]);
  assert.deepEqual(intervals("C°"), [0, 3, 6]);
  assert.deepEqual(intervals("C7"), [0, 4, 7, 10]);
  assert.deepEqual(intervals("Cdom7"), [0, 4, 7, 10]);
  for (const s of ["Cmaj7", "CM7", "CΔ7", "CΔ", "Cmajor7", "CMa7"]) assert.deepEqual(intervals(s), [0, 4, 7, 11], s);
  assert.deepEqual(intervals("CM"), [0, 4, 7], "M alone is a major triad");
  assert.deepEqual(intervals("Cmaj"), [0, 4, 7]);
  for (const s of ["Cm7", "Cmin7", "C-7", "Cminor7"]) assert.deepEqual(intervals(s), [0, 3, 7, 10], s);
  // The audit's trap: a case-insensitive /M7/ turned Cm7 into a major seventh. It is minor.
  assert.equal(parseChord("Cm7")!.seventh, "min7");
  assert.equal(parseChord("CM7")!.seventh, "maj7");
  for (const s of ["CmM7", "CmMaj7", "Cm(maj7)", "CminMaj7", "C-Δ7", "Cmmaj7"]) {
    assert.deepEqual(intervals(s), [0, 3, 7, 11], s);
    assert.equal(parseChord(s)!.template, "minMaj7", s);
  }
  assert.deepEqual(intervals("Caug7"), [0, 4, 8, 10]);
  assert.deepEqual(intervals("C+7"), [0, 4, 8, 10]);
  assert.deepEqual(intervals("C7#5"), [0, 4, 8, 10]);
  assert.deepEqual(intervals("C7b5"), [0, 4, 6, 10]);
  assert.deepEqual(intervals("C7sus4"), [0, 5, 7, 10]);
  assert.deepEqual(intervals("C7sus"), [0, 5, 7, 10]);
  assert.deepEqual(intervals("C9sus4"), [0, 5, 7, 10, 14]);
});

test("sixths, adds, extensions and alterations", () => {
  assert.deepEqual(intervals("C6"), [0, 4, 7, 9]);
  assert.equal(parseChord("C6")!.template, "maj6");
  assert.deepEqual(intervals("Cm6"), [0, 3, 7, 9]);
  assert.deepEqual(intervals("C69"), [0, 4, 7, 9, 14]);
  assert.deepEqual(intervals("C6/9"), [0, 4, 7, 9, 14], "6/9 is not a slash chord");
  assert.equal(parseChord("C6/9")!.bass, 0);
  assert.deepEqual(intervals("Cadd9"), [0, 4, 7, 14]);
  assert.equal(parseChord("Cadd9")!.template, "add9");
  assert.deepEqual(intervals("Cadd2"), [0, 4, 7, 14]);
  assert.equal(parseChord("Cadd2")!.symbol, "Cadd9");
  assert.deepEqual(intervals("Cmadd9"), [0, 3, 7, 14]);
  assert.deepEqual(intervals("Cadd11"), [0, 4, 7, 17]);
  assert.deepEqual(intervals("Cadd#11"), [0, 4, 7, 18]);
  assert.deepEqual(intervals("C9"), [0, 4, 7, 10, 14]);
  assert.equal(parseChord("C9")!.template, "dom9");
  assert.deepEqual(intervals("C11"), [0, 4, 7, 10, 14, 17]);
  assert.deepEqual(intervals("C13"), [0, 4, 7, 10, 14, 21], "a 13 names 7-9-13; the 11 is omitted by convention");
  assert.deepEqual(intervals("Cmaj9"), [0, 4, 7, 11, 14]);
  assert.deepEqual(intervals("Cmaj13"), [0, 4, 7, 11, 14, 21]);
  assert.deepEqual(intervals("Cm9"), [0, 3, 7, 10, 14]);
  assert.deepEqual(intervals("Cm11"), [0, 3, 7, 10, 14, 17]);
  assert.deepEqual(intervals("C7#9"), [0, 4, 7, 10, 15]);
  assert.deepEqual(parseChord("C7#9")!.alterations, ["#9"]);
  assert.equal(parseChord("C7#9")!.symbol, "C7#9");
  assert.deepEqual(intervals("C7b9"), [0, 4, 7, 10, 13]);
  assert.deepEqual(intervals("C7#11"), [0, 4, 7, 10, 18]);
  assert.deepEqual(intervals("C7b13"), [0, 4, 7, 10, 20]);
  assert.deepEqual(intervals("C7(b9,#11)"), [0, 4, 7, 10, 13, 18]);
  assert.deepEqual(intervals("C7b9#11"), [0, 4, 7, 10, 13, 18]);
  assert.deepEqual(intervals("C7alt"), [0, 4, 7, 10, 13, 15, 20]);
  assert.deepEqual(intervals("C7no3"), [0, 7, 10]);
  assert.deepEqual(intervals("Comit5"), [0, 4]);
  assert.deepEqual(intervals("Cmaj7#11"), [0, 4, 7, 11, 18]);
  assert.deepEqual(intervals("Cm7add11"), [0, 3, 7, 10, 17]);
});

test("MIREX dialect and degree basses", () => {
  assert.deepEqual(pcs("C:maj"), [0, 4, 7]);
  assert.deepEqual(intervals("F#:min7"), [0, 3, 7, 10]);
  assert.equal(parseChord("F#:min7")!.root, 6);
  assert.equal(parseChord("C:maj/3")!.bass, 4);
  assert.equal(parseChord("C:maj/5")!.bass, 7);
  assert.equal(parseChord("C:min/3")!.bass, 3);
  assert.equal(parseChord("G:7/7")!.bass, 5);
  assert.equal(parseChord("Bb/D")!.bass, 2);
  assert.equal(parseChord("Bb/D")!.root, 10);
});

test("no-chord markers and unreadable symbols are null, never a guess", () => {
  for (const s of ["N", "X", "N.C.", "NC", "", "  ", "?!", "H7", "wat", "C7xyz", "Cmajor7th", "C/H", "Csus3"]) {
    assert.equal(parseChord(s), null, JSON.stringify(s));
  }
  assert.deepEqual(chordPitchClassesOf({ symbol: "N" }), []);
});

test("canonical Song Model fields lay over the symbol: a canonical bass is an inversion, a canonical quality fills an empty suffix", () => {
  const ownerChord = chordFromEvent({ symbol: "Fm", root: "F", quality: "min", bass: "F" })!;
  assert.deepEqual(ownerChord.pitchClasses, [5, 8, 0]);
  assert.equal(ownerChord.bass, 5);
  const inverted = chordFromEvent({ symbol: "C", root: "C", quality: "maj", bass: "E" })!;
  assert.equal(inverted.bass, 4, "the canonical bass is honoured although the symbol has no slash");
  assert.equal(inverted.symbol, "C/E");
  assert.deepEqual(chordFromEvent({ symbol: "C", quality: "min7" })!.intervals, [0, 3, 7, 10]);
  assert.deepEqual(chordFromEvent({ symbol: "C", quality: "dom7" })!.intervals, [0, 4, 7, 10]);
  assert.deepEqual(chordFromEvent({ symbol: "C", quality: "7" })!.intervals, [0, 4, 7, 10]);
  assert.deepEqual(chordFromEvent({ symbol: "C", quality: "sus4" })!.intervals, [0, 5, 7]);
  // A written suffix wins over a canonical quality that disagrees with it.
  assert.deepEqual(chordFromEvent({ symbol: "Cm7", quality: "maj" })!.intervals, [0, 3, 7, 10]);
  // The symbol's own slash wins over a canonical bass.
  assert.equal(chordFromEvent({ symbol: "C/G", bass: "E" })!.bass, 7);
  assert.deepEqual(chordFromEvent({ symbol: "C7", extensions: ["9"] })!.intervals, [0, 4, 7, 10, 14]);
  assert.deepEqual(chordFromEvent({ symbol: "C7", alterations: ["#11"] })!.intervals, [0, 4, 7, 10, 18]);
  assert.deepEqual(chordFromEvent({ symbol: "C", extensions: ["6"] })!.intervals, [0, 4, 7, 9]);
  assert.equal(chordFromEvent({ symbol: "C", root: "junk" })!.root, 0, "an unreadable canonical root is ignored");
});

test("roles: root, third, fifth, seventh, sixth, extensions, suspension", () => {
  const c13 = parseChord("C13")!;
  assert.equal(c13.roles.get(0), "root");
  assert.equal(c13.roles.get(4), "third");
  assert.equal(c13.roles.get(7), "fifth");
  assert.equal(c13.roles.get(10), "seventh");
  assert.equal(c13.roles.get(2), "ninth");
  assert.equal(c13.roles.get(9), "thirteenth");
  assert.equal(parseChord("C6")!.roles.get(9), "sixth");
  assert.equal(parseChord("Am")!.roles.get(0), "third", "A minor's third is C");
  assert.equal(parseChord("G7")!.roles.get(5), "seventh", "G7's seventh is F");
  assert.equal(parseChord("Csus4")!.roles.get(5), "suspension");
  assert.equal(parseChord("C11")!.roles.get(5), "eleventh");
});

const ROUND_TRIP = [
  "C", "Am", "Cdim", "Caug", "C5", "Csus4", "Csus2", "C/E", "Am/C", "G7/B", "C/Bb",
  "C6", "Cm6", "C69", "C7", "Cmaj7", "Cm7", "CmMaj7", "Cdim7", "Cm7b5", "Caug7", "CaugMaj7", "C7sus4", "C9sus4", "Cmaj7sus4",
  "Cadd9", "Cmadd9", "Cadd11", "Cadd#11", "C9", "C11", "C13", "Cmaj9", "Cmaj13", "Cm9", "Cm11", "Cm13", "Cm9b5",
  "C7#9", "C7b9", "C7#11", "C7b13", "C7b9#11", "C7b9#9b13", "C7b5", "C7#5", "Cmaj7#11", "C7add13", "C7add11", "C13add11",
  "C7no3", "Cno5", "Cm7add11", "C6add9", "Ebmaj7/G", "F#m7b5/A", "Bb13/Ab", "Dbm/Fb",
];

test("the canonical spelling reads back to the same chord for the whole vocabulary", () => {
  const strip = (c: ParsedChord) => {
    const { input: _input, roles, ...rest } = c;
    return { ...rest, roles: [...roles.entries()] };
  };
  for (const symbol of ROUND_TRIP) {
    const first = parseChord(symbol);
    assert.ok(first, `${symbol} parses`);
    const again = parseChord(first.symbol);
    assert.ok(again, `${symbol} -> ${first.symbol} parses back`);
    assert.deepEqual(strip(again), strip(first), `${symbol} -> ${first.symbol} -> ${again.symbol}`);
    assert.equal(formatChord(again), first.symbol);
  }
});

test("every analysis template formats and parses back to itself, in every root and every chord-tone bass", () => {
  for (const quality of Object.keys(TEMPLATE_INTERVALS) as TemplateQuality[]) {
    for (let root = 0; root < 12; root += 1) {
      for (const interval of TEMPLATE_INTERVALS[quality]) {
        const bass = (root + interval) % 12;
        const symbol = `${ROOT_NAMES[root]}${TEMPLATE_SUFFIX[quality]}${bass === root ? "" : `/${ROOT_NAMES[bass]}`}`;
        const parsed = parseChord(symbol);
        assert.ok(parsed, symbol);
        assert.equal(parsed.root, root, symbol);
        assert.equal(parsed.bass, bass, symbol);
        assert.equal(parsed.template, quality, `${symbol}: template ${parsed.template}`);
        assert.deepEqual(sorted(parsed.pitchClasses), sorted(TEMPLATE_INTERVALS[quality].map((i) => (root + i) % 12)), symbol);
        assert.equal(parsed.symbol, symbol, "the canonical spelling is the analysis engine's spelling");
      }
    }
  }
});

test("the template adapter keeps the analysis engine's readings and corrects three of its misreadings", () => {
  assert.deepEqual(parseChordTemplate("C"), { root: 0, quality: "maj", bass: 0 });
  assert.deepEqual(parseChordTemplate("C:maj"), { root: 0, quality: "maj", bass: 0 });
  assert.deepEqual(parseChordTemplate("Am"), { root: 9, quality: "min", bass: 9 });
  assert.deepEqual(parseChordTemplate("F#:min7"), { root: 6, quality: "min7", bass: 6 });
  assert.deepEqual(parseChordTemplate("Bb/D"), { root: 10, quality: "maj", bass: 2 });
  assert.deepEqual(parseChordTemplate("C:maj/3"), { root: 0, quality: "maj", bass: 4 });
  assert.deepEqual(parseChordTemplate("E♭maj7"), { root: 3, quality: "maj7", bass: 3 });
  assert.equal(parseChordTemplate("N"), null);
  assert.equal(parseChordTemplate("?!"), null);
  assert.deepEqual(parseChordTemplate("CM7"), { root: 0, quality: "maj7", bass: 0 });
  assert.deepEqual(parseChordTemplate("Cm7"), { root: 0, quality: "min7", bass: 0 });
  assert.deepEqual(parseChordTemplate("CmM7"), { root: 0, quality: "minMaj7", bass: 0 });
  assert.deepEqual(parseChordTemplate("Cadd2"), { root: 0, quality: "add9", bass: 0 });
  assert.deepEqual(parseChordTemplate("Chalfdim"), { root: 0, quality: "m7b5", bass: 0 });
  // Divergences from the old harmonyEngine parser, on purpose:
  //  - Cmaj13 was read as C MINOR (the `^m` fallback); it is a major-seventh chord.
  assert.equal(parseChordTemplate("Cmaj13")!.quality, "maj9");
  //  - C13 / C11 folded to dom7; the ninth they carry is in the chroma, so dom9 is the nearer template.
  assert.equal(parseChordTemplate("C13")!.quality, "dom9");
  //  - C7sus4 was read as a dominant seventh WITH a major third; it has none, so sus4 is the nearer template.
  assert.equal(parseChordTemplate("C7sus4")!.quality, "sus4");
  //  - C5 (power chord) was refused; it is a chord without a third and scores as the major template.
  assert.equal(parseChordTemplate("C5")!.quality, "maj");
  //  - C7#9 was refused; it is a dominant seventh.
  assert.equal(parseChordTemplate("C7#9")!.quality, "dom7");
});
