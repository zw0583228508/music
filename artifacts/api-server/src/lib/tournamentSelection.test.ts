import assert from "node:assert/strict";
import test from "node:test";
import { selectRoundRobin, selectionProfile } from "./tournamentSelection";

const FAMILY_ORDER = ["drums", "bass", "guitar", "keys", "synth", "organ", "strings", "brass", "reed", "pipe", "ensemble"];

const cand = (workId: string, family: string, genre?: string) => ({ workId, family, genre });

test("selection cycles genres first, then families within each genre, one task per work", () => {
  const candidates = [
    cand("p1", "keys", "pop"), cand("p1", "bass", "pop"), cand("p2", "keys", "pop"), cand("p3", "drums", "pop"),
    cand("r1", "guitar", "rock"), cand("r2", "keys", "rock"), cand("r3", "drums", "rock"),
    cand("j1", "reed", "jazz"), cand("j2", "brass", "jazz"),
    cand("c1", "strings", "classical"), cand("c2", "keys", "classical"), cand("c3", "organ", "classical"), cand("c4", "keys", "classical"),
  ];
  const chosen = selectRoundRobin(candidates, { sampleSize: 8, familyOrder: FAMILY_ORDER, genreOrder: ["pop", "rock", "jazz"] });
  assert.equal(chosen.length, 8);
  // Round 1: one per genre, the family cursor starting at drums.
  assert.deepEqual(chosen.slice(0, 4).map((c) => `${c.genre}:${c.family}`), ["pop:drums", "rock:drums", "jazz:brass", "classical:keys"]);
  // Round 2: each genre continues from its own cursor — pop moves on to bass, not back to drums.
  assert.deepEqual(chosen.slice(4, 8).map((c) => `${c.genre}:${c.family}`), ["pop:bass", "rock:guitar", "jazz:reed", "classical:organ"]);
  // Classical could not fill the sample: 4 of 8, not 4 of the first 4.
  assert.equal(chosen.filter((c) => c.genre === "classical").length, 2);
  // One task per work, even where a work offered two families.
  assert.equal(new Set(chosen.map((c) => c.workId)).size, chosen.length);
  assert.deepEqual(selectRoundRobin(candidates, { sampleSize: 8, familyOrder: FAMILY_ORDER, genreOrder: ["pop", "rock", "jazz"] }), chosen, "deterministic");
});

test("a shared family cursor spreads a small sample over instruments instead of every genre's drums", () => {
  const candidates = [
    cand("p1", "drums", "pop"), cand("p2", "bass", "pop"), cand("p3", "keys", "pop"),
    cand("r1", "drums", "rock"), cand("r2", "bass", "rock"), cand("r3", "keys", "rock"),
    cand("j1", "drums", "jazz"), cand("j2", "bass", "jazz"), cand("j3", "keys", "jazz"),
  ];
  const perGenre = selectRoundRobin(candidates, { sampleSize: 3, familyOrder: FAMILY_ORDER, genreOrder: ["pop", "rock", "jazz"] });
  assert.deepEqual(perGenre.map((c) => c.family), ["drums", "drums", "drums"]);
  const shared = selectRoundRobin(candidates, { sampleSize: 3, familyOrder: FAMILY_ORDER, genreOrder: ["pop", "rock", "jazz"], familyCursor: "shared" });
  assert.deepEqual(shared.map((c) => `${c.genre}:${c.family}`), ["pop:drums", "rock:bass", "jazz:keys"]);
  // A genre lacking the family at its turn takes the next it has, and the cursor moves on from there.
  const sparse = selectRoundRobin([cand("p1", "drums", "pop"), cand("r1", "keys", "rock"), cand("j1", "bass", "jazz")], { sampleSize: 3, familyOrder: FAMILY_ORDER, genreOrder: ["pop", "rock", "jazz"], familyCursor: "shared" });
  assert.deepEqual(sparse.map((c) => `${c.genre}:${c.family}`), ["pop:drums", "rock:keys", "jazz:bass"]);
});

test("a per-genre cap and a family list both bound the sample; a candidate outside the family list is never chosen", () => {
  const candidates = [
    cand("a", "keys", "pop"), cand("b", "keys", "pop"), cand("c", "keys", "pop"),
    cand("d", "bass", "rock"), cand("e", "chromatic_perc", "rock"),
  ];
  const chosen = selectRoundRobin(candidates, { sampleSize: 10, familyOrder: ["bass", "keys"], maxPerGenre: 2 });
  assert.deepEqual(chosen.map((c) => c.workId).sort(), ["a", "b", "d"]);
  assert.ok(!chosen.some((c) => c.family === "chromatic_perc"));
});

test("without genres the selection is the first tournament's family round-robin", () => {
  const candidates = [cand("w1", "keys"), cand("w2", "keys"), cand("w3", "bass"), cand("w4", "strings")];
  const chosen = selectRoundRobin(candidates, { sampleSize: 3, familyOrder: ["bass", "keys", "strings"] });
  assert.deepEqual(chosen.map((c) => c.workId), ["w3", "w1", "w4"]);
  assert.deepEqual(selectionProfile(chosen), { any: { bass: 1, keys: 1, strings: 1 } });
});
