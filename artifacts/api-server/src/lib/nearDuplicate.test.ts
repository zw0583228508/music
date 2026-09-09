import assert from "node:assert/strict";
import test from "node:test";
import type { MidiNote, ParsedMidi } from "./midiFile";
import {
  SIGNATURE_SIZE,
  assignSplitsWithGroups,
  barShingles,
  estimateJaccard,
  fingerprintMidi,
  hashSplit,
  minhashSignature,
  nearDuplicateGroups,
  shinglesFromBars,
} from "./nearDuplicate";

const TPQ = 480;

function note(over: Partial<MidiNote>): MidiNote {
  return { track: 0, channel: 0, program: 0, isPercussion: false, pitch: 60, velocity: 80, startTick: 0, endTick: 240, ...over };
}

/** A deterministic pseudo-melody of `bars` bars, seeded so two scores can differ. */
function piece(bars: number, seed: number, options: { velocity?: number; transpose?: number; program?: number } = {}): ParsedMidi {
  const notes: MidiNote[] = [];
  let x = seed || 1;
  const rand = () => { x ^= x << 13; x ^= x >>> 17; x ^= x << 5; return (x >>> 0) / 0xffffffff; };
  for (let bar = 0; bar < bars; bar += 1) {
    for (let beat = 0; beat < 4; beat += 1) {
      const start = (bar * 4 + beat) * TPQ;
      notes.push(note({
        startTick: start, endTick: start + TPQ,
        pitch: 55 + Math.floor(rand() * 20) + (options.transpose ?? 0),
        velocity: options.velocity ?? 80,
        program: options.program ?? 0,
      }));
      notes.push(note({ startTick: start, endTick: start + TPQ, pitch: 36 + Math.floor(rand() * 12), program: 33, track: 1 }));
    }
  }
  return {
    ticksPerQuarter: TPQ, format: 1, trackCount: 2, notes,
    tempos: [{ tick: 0, usPerQuarter: 500_000, bpm: 120 }],
    timeSignatures: [{ tick: 0, numerator: 4, denominator: 4 }],
    endTick: bars * 4 * TPQ,
  };
}

/** The same piece with the first `changedBars` bars rewritten. */
function edited(bars: number, seed: number, changedBars: number): ParsedMidi {
  const original = piece(bars, seed);
  const replacement = piece(bars, seed + 999);
  const cut = changedBars * 4 * TPQ;
  return {
    ...original,
    notes: [...replacement.notes.filter((n) => n.startTick < cut), ...original.notes.filter((n) => n.startTick >= cut)],
  };
}

test("the content hash ignores velocity and tempo but not pitch", () => {
  const a = fingerprintMidi(piece(16, 1), "a");
  const b = fingerprintMidi(piece(16, 1, { velocity: 40 }), "b");
  const c = fingerprintMidi({ ...piece(16, 1), tempos: [{ tick: 0, usPerQuarter: 400_000, bpm: 150 }] }, "c");
  const d = fingerprintMidi(piece(16, 1, { transpose: 2 }), "d");
  assert.equal(a.contentHash, b.contentHash, "dynamics do not change the score");
  assert.equal(a.contentHash, c.contentHash, "tempo does not change the score");
  assert.notEqual(a.contentHash, d.contentHash, "a transposition is a different note stream");
});

test("bar bigrams: two empty bars make no shingle", () => {
  assert.deepEqual([...shinglesFromBars(["a", "", "", "b"])].sort(), ["a||", "||b"].sort());
  assert.equal(shinglesFromBars(["", "", ""]).size, 0);
  const { bars } = barShingles(piece(4, 1));
  assert.equal(bars.length, 4);
  assert.ok(bars.every((b) => b.includes("keys:") && b.includes("bass:")));
});

test("MinHash agreement estimates Jaccard", () => {
  const base = Array.from({ length: 200 }, (_, i) => `s${i}`);
  const half = base.slice(0, 100);
  const sameSig = minhashSignature(base);
  assert.equal(sameSig.length, SIGNATURE_SIZE);
  assert.equal(estimateJaccard(sameSig, minhashSignature([...base])), 1);
  // Jaccard(base, first 100) = 100/200 = 0.5; the estimate should be close.
  const estimate = estimateJaccard(sameSig, minhashSignature(half));
  assert.ok(estimate > 0.3 && estimate < 0.7, `estimate ${estimate} should be near 0.5`);
  assert.equal(estimateJaccard(minhashSignature(["x"]), minhashSignature(["y"])), 0);
  assert.equal(estimateJaccard([], sameSig), 0, "an empty signature matches nothing");
});

test("a re-export is an exact duplicate; a light edit is a near-duplicate; a different piece is neither", () => {
  const fps = [
    fingerprintMidi(piece(32, 7), "original"),
    fingerprintMidi(piece(32, 7, { velocity: 60 }), "reexport"),
    fingerprintMidi(edited(32, 7, 4), "edited-4-bars"),
    fingerprintMidi(piece(32, 8), "other"),
    fingerprintMidi(piece(32, 9), "another"),
  ];
  const result = nearDuplicateGroups(fps, { threshold: 0.5 });
  assert.equal(result.exactDuplicateGroups, 1);
  assert.equal(result.worksInExactGroups, 2);
  assert.deepEqual(result.groups, [["edited-4-bars", "original", "reexport"]]);
  assert.equal(result.worksInGroups, 3);
  assert.equal(result.distinctWorks, 3, "five works, one of them counted three times");
  assert.deepEqual(result.groupSizeHistogram, { "3": 1 });
});

test("a too-short work only groups by exact hash", () => {
  const short = piece(2, 3);
  const a = fingerprintMidi(short, "a");
  assert.equal(a.signature.length, 0);
  const result = nearDuplicateGroups([a, fingerprintMidi(short, "b"), fingerprintMidi(piece(2, 4), "c")]);
  assert.equal(result.worksIndexed, 0);
  assert.deepEqual(result.groups, [["a", "b"]]);
});

test("the threshold decides: a heavier edit passes 0.3 and fails 0.8", () => {
  const fps = [fingerprintMidi(piece(32, 11), "o"), fingerprintMidi(edited(32, 11, 12), "e")];
  const loose = nearDuplicateGroups(fps, { threshold: 0.3 });
  const strict = nearDuplicateGroups(fps, { threshold: 0.8 });
  assert.equal(loose.groups.length, 1, "12 of 32 bars changed is still the same piece at 0.3");
  assert.equal(strict.groups.length, 0, "and a different one at 0.8");
});

test("grouping is deterministic and independent of input order", () => {
  const fps = [fingerprintMidi(piece(24, 5), "x"), fingerprintMidi(edited(24, 5, 2), "y"), fingerprintMidi(piece(24, 6), "z")];
  const a = nearDuplicateGroups(fps).groups;
  const b = nearDuplicateGroups([...fps].reverse()).groups;
  assert.deepEqual(a, b);
  assert.deepEqual(a, [["x", "y"]]);
});

test("a duplicate group lands on one split, decided by its smallest member", () => {
  const ids = ["w-a", "w-b", "w-c", "w-d"];
  const groups = [["w-c", "w-a"]];
  const splitOf = (id: string): "train" | "val" | "test" => (id === "w-a" ? "test" : "train");
  const { splits, movedByGroup } = assignSplitsWithGroups(ids, groups, splitOf);
  assert.equal(splits.get("w-a"), "test");
  assert.equal(splits.get("w-c"), "test", "follows its group anchor w-a");
  assert.equal(splits.get("w-b"), "train");
  assert.equal(movedByGroup, 1);
  // The hash split is stable and roughly 90/5/5.
  const many = Array.from({ length: 5000 }, (_, i) => hashSplit(`work-${i}`));
  const train = many.filter((s) => s === "train").length / many.length;
  assert.ok(train > 0.87 && train < 0.93, `train share ${train}`);
  assert.equal(hashSplit("work-1"), hashSplit("work-1"));
});
