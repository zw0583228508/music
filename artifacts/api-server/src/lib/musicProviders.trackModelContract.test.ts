import assert from "node:assert/strict";
import test from "node:test";
import type { MusicalNote, TrackModel } from "@workspace/db";
import { getInstrumentDefinition } from "./musicEngines";
import { LEGATO_TOLERANCE_SECONDS } from "./musicalConstraints";
import { validateCanonicalTrackModels } from "./musicProviders";

function bassTrack(notes: MusicalNote[]): TrackModel {
  const definition = getInstrumentDefinition("bass", "bass");
  return {
    id: "p--bass", instrument: "bass", instrumentDefinition: definition, role: "bass",
    notes, cc: [], articulations: [], automation: [],
    source: "TEST", version: 1,
    provenance: { model: "TEST", version: "1.0.0", parameters: {}, parentIds: [], createdBy: "test" },
  };
}

const note = (id: string, start: number, duration: number): MusicalNote =>
  ({ id, start, duration, pitch: 40, velocity: 90 });

test("a legato tail is a connected line, not polyphony", () => {
  // Each note laps 20 ms into the next: how a bassist plays, and what the
  // performance engine produces. Below the tolerance, so it must validate.
  const legato = [note("a", 0, 0.52), note("b", 0.5, 0.52), note("c", 1.0, 0.52)];
  const track = bassTrack(legato);
  assert.deepEqual(validateCanonicalTrackModels([track], [track.id]), []);
});

test("a genuine overlap on a monophonic instrument is still rejected", () => {
  const chord = [note("a", 0, 0.5), note("b", 0.1, 0.5)]; // 400 ms of overlap
  const track = bassTrack(chord);
  const errors = validateCanonicalTrackModels([track], [track.id]);
  assert.ok(errors.some((e) => /polyphony/.test(e)), errors.join("; "));
});

test("the validator and the constraint engine share one tolerance", () => {
  assert.equal(LEGATO_TOLERANCE_SECONDS, 0.03);
  const boundary = [note("a", 0, 0.5 + LEGATO_TOLERANCE_SECONDS), note("b", 0.5, 0.5)];
  assert.deepEqual(validateCanonicalTrackModels([bassTrack(boundary)], ["p--bass"]), []);
  const over = [note("a", 0, 0.5 + LEGATO_TOLERANCE_SECONDS + 0.01), note("b", 0.5, 0.5)];
  assert.ok(validateCanonicalTrackModels([bassTrack(over)], ["p--bass"]).length > 0);
});
