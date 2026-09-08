import assert from "node:assert/strict";
import test from "node:test";
import type { MusicalNote, TrackModel } from "@workspace/db";
import {
  FEATURE_NAMES,
  MemoryPreferenceEventStore,
  buildPreferenceEvent,
  featureDelta,
  fingerprintFeatureVector,
  recordPreferenceEvent,
  recordSelectionAmongSiblings,
  rightsBasisFor,
  trainingRows,
} from "./preferenceEvents";
import { deriveStyleFingerprint } from "./styleFingerprint";
import { getInstrumentDefinition } from "./musicEngines";

function track(id: string, role: string, instrument: string, notes: MusicalNote[]): TrackModel {
  return {
    id, instrument, role, instrumentDefinition: getInstrumentDefinition(instrument, role), notes,
    cc: [], articulations: [], automation: [], source: "TEST", version: 1,
    provenance: { model: "TEST", version: "1.0.0", parameters: {}, parentIds: [], createdBy: "test" },
  };
}
const line = (pitch: number, swing = 0.5): MusicalNote[] => Array.from({ length: 32 }, (_, i) => ({
  id: `n${i}`, start: (Math.floor(i / 2) + (i % 2 ? swing : 0)) * 0.5, duration: 0.2, pitch: pitch + (i % 5), velocity: 80 + (i % 3) * 10,
}));
const fp = (id: string, swing = 0.5) => deriveStyleFingerprint({ source: { kind: "arrangement", id, version: 1 }, trackModels: [track("lead", "LEAD", "flute", line(72, swing)), track("bass", "BASS", "Electric Bass", line(40, swing))], now: new Date(0) });

const subject = (id: string, swing = 0.5, origin: "platform_generated" | "owner_upload" | "third_party" = "platform_generated") =>
  ({ kind: "candidate" as const, id, fingerprint: fp(id, swing), rankingScore: 0.8, criticScore: 71, modelVersion: "brain@1.0", origin });

test("the feature vector has a fixed order, only numbers, and stays content-free", () => {
  const vector = fingerprintFeatureVector(fp("a"));
  assert.deepEqual(Object.keys(vector), [...FEATURE_NAMES]);
  assert.ok(Object.values(vector).every((v) => typeof v === "number" && Number.isFinite(v)));
  assert.equal(vector["tempo.bpm"], 120);
  assert.equal(vector["instrumentation.familyCount"], 2);
  const delta = featureDelta(fingerprintFeatureVector(fp("a", 0.66)), vector);
  assert.ok(delta["groove.swingRatio"] > 0.1, "a swung subject minus a straight one is a positive swing delta");
});

test("a pairwise event carries both subjects' features and their delta, and nothing that could rebuild a note", () => {
  const event = buildPreferenceEvent({
    ownerId: "o", projectId: "p", kind: "pairwise", source: "explicit_feedback",
    subject: subject("A", 0.66), compared: subject("B"), preferred: "subject", reasons: ["the swing feels right", "  "], now: new Date(0),
  });
  assert.equal(event.outcome.preferred, "subject");
  assert.deepEqual(event.outcome.reasons, ["the swing feels right"]);
  assert.equal(event.subject.criticScore, 71);
  assert.ok(event.features.compared && event.features.delta);
  assert.ok(event.features.delta!["groove.swingRatio"] > 0.1);
  const json = JSON.stringify(event);
  assert.ok(!/"notes"|"melody"|"pitches"|"chords"|"audio"/.test(json));
  assert.equal(event.subject.fingerprintDigest?.length, 64);
  assert.throws(() => buildPreferenceEvent({ ownerId: "o", projectId: "p", kind: "pairwise", source: "explicit_feedback", subject: subject("A") }), /needs a compared subject/);
});

test("rights basis is the strictest that applies; a third party's material only reaches learning as a fingerprint", () => {
  assert.equal(rightsBasisFor(subject("A")), "platform_generated");
  assert.equal(rightsBasisFor(subject("A"), subject("B", 0.5, "owner_upload")), "owner_upload");
  assert.equal(rightsBasisFor(subject("A", 0.5, "third_party")), "fingerprint_only");
  const event = buildPreferenceEvent({ ownerId: "o", projectId: "p", kind: "rating", source: "explicit_feedback", subject: subject("R", 0.5, "third_party"), rating: 4, now: new Date(0) });
  assert.equal(event.rightsBasis, "fingerprint_only");
  assert.equal(event.outcome.rating, 4);
});

test("consent: learning controls gate writes exactly as the ledger does", async () => {
  const off = new MemoryPreferenceEventStore({ learningEnabled: false, inferredBehaviorEnabled: false });
  assert.equal(await recordPreferenceEvent(off, { ownerId: "o", projectId: "p", kind: "rating", source: "explicit_feedback", subject: subject("A"), rating: 5 }), null);
  assert.ok(await recordPreferenceEvent(off, { ownerId: "o", projectId: "p", kind: "rating", source: "objective_evidence", subject: subject("A"), rating: 5 }), "objective evidence is always allowed");
  const noInferred = new MemoryPreferenceEventStore({ learningEnabled: true, inferredBehaviorEnabled: false });
  assert.equal(await recordPreferenceEvent(noInferred, { ownerId: "o", projectId: "p", kind: "approval", source: "inferred_behavior", subject: subject("A") }), null);
  assert.ok(await recordPreferenceEvent(noInferred, { ownerId: "o", projectId: "p", kind: "rating", source: "explicit_feedback", subject: subject("A"), rating: 3 }));
});

test("selecting one candidate among siblings records N−1 pairwise events, chosen over each alternative", async () => {
  const store = new MemoryPreferenceEventStore();
  const events = await recordSelectionAmongSiblings(store, {
    ownerId: "o", projectId: "p", source: "inferred_behavior",
    selected: subject("A", 0.66), siblings: [subject("A", 0.66), subject("B"), subject("C", 0.6)], now: new Date(0),
  });
  assert.equal(events.length, 2);
  assert.ok(events.every((e) => e.kind === "pairwise" && e.outcome.preferred === "subject" && e.subject.id === "A"));
  assert.deepEqual(events.map((e) => e.compared!.id), ["B", "C"]);
  const listed = await store.list("o", { projectId: "p" });
  assert.equal(listed.length, 2);
});

test("the training export has fixed columns, features in FEATURE_NAMES order, and no content; erasure removes everything", async () => {
  const store = new MemoryPreferenceEventStore();
  await recordSelectionAmongSiblings(store, { ownerId: "o", projectId: "p", source: "inferred_behavior", selected: subject("A", 0.66), siblings: [subject("B")], now: new Date(0) });
  await recordPreferenceEvent(store, { ownerId: "o", projectId: "q", kind: "rating", source: "explicit_feedback", subject: subject("D"), rating: 2 });
  const rows = trainingRows(await store.list("o"));
  assert.equal(rows.length, 2);
  for (const row of rows) {
    assert.equal((row.features as number[]).length, FEATURE_NAMES.length);
    assert.ok(!/"notes"|"melody"|"pitches"|"chords"/.test(JSON.stringify(row)));
  }
  const pairwise = rows.find((r) => r.kind === "pairwise")!;
  assert.equal((pairwise.delta as number[]).length, FEATURE_NAMES.length);
  assert.equal(await store.erase("o", "q"), 1);
  assert.equal((await store.list("o")).length, 1);
  assert.equal(await store.erase("o"), 1);
  assert.equal((await store.list("o")).length, 0);
});
