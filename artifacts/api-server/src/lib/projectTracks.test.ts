import assert from "node:assert/strict";
import test from "node:test";
import { arrangementTrackRows, retiredTrackIds } from "./projectTracks";

test("a stale drums row from an earlier arrangement version is retired, not rendered", () => {
  // The owner's second arrangement: v2 had drums + bass + transition, v4 has
  // bass + harmonic bed + transition. The drums row stayed in the project and
  // broke the revision ("controls required") and the export (one-to-one).
  const rows = [{ id: "p--drums-groove" }, { id: "p--bass-bass" }, { id: "p--mix-harmonic_bed" }, { id: "p--ensemble-transition" }];
  const models = [{ id: "p--bass-bass" }, { id: "p--mix-harmonic_bed" }, { id: "p--ensemble-transition" }];
  assert.deepEqual(arrangementTrackRows(rows, models).map((r) => r.id), ["p--bass-bass", "p--mix-harmonic_bed", "p--ensemble-transition"]);
  assert.deepEqual(retiredTrackIds(rows, models), ["p--drums-groove"]);
  assert.deepEqual(arrangementTrackRows(rows, null), []);
  assert.deepEqual(retiredTrackIds([], models), []);
});
