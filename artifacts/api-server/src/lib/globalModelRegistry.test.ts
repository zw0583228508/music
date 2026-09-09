import assert from "node:assert/strict";
import test from "node:test";
import {
  classify,
  explainClassification,
  provenLive,
  shippable,
  teacherOutputsNeedReview,
  type ModelEntry,
} from "./globalModelRegistry";
import { GLOBAL_MODEL_REGISTRY } from "./globalModelRegistryData";

const verified = (stated: string) => ({ stated, source: "LICENSE file", confidence: "verified_primary_source" as const });

function entry(over: Partial<ModelEntry> = {}): ModelEntry {
  return {
    id: "X", family: "X", name: "X", authorLab: "lab",
    sourceRepository: null, huggingFace: null, paper: null, releaseDate: null, revision: null,
    parameterCount: null, architecture: null, representation: null, contextLength: null,
    capabilities: [], checkpointAvailable: true, checkpointNotes: null,
    codeLicense: verified("MIT"),
    weightsLicense: verified("MIT"),
    trainingData: { ...verified("public domain"), datasets: ["PD set"], underlyingWorksCleared: "yes" },
    statedRestriction: null,
    roles: [], expectedRole: "", integrationComplexity: "low", knownLimitations: [],
    auditConfidence: "verified_primary_source", liveInferenceProven: false,
    ...over,
  };
}

test("SHIP_CLEARED needs all three layers verified from a primary source and the works cleared", () => {
  assert.equal(classify(entry()), "SHIP_CLEARED");
});

test("a permissive code licence does not clear weights that were never read", () => {
  const e = entry({ weightsLicense: { stated: null, source: null, confidence: "unknown" } });
  assert.equal(classify(e), "LEGAL_REVIEW_REQUIRED");
  assert.match(explainClassification(e), /weights licence/);
});

test("permissive everywhere on paper, but the underlying works not cleared, is RESEARCH_ONLY (the Lakh case)", () => {
  const e = entry({
    trainingData: { ...verified("CC-BY-4.0"), datasets: ["Lakh MIDI"], underlyingWorksCleared: "no" },
  });
  assert.equal(classify(e), "RESEARCH_ONLY");
  assert.match(explainClassification(e), /underlying works are not cleared/);
});

test("an explicit non-commercial term anywhere is BLOCKED_LICENSE, and fine-tuning does not change that", () => {
  assert.equal(classify(entry({ weightsLicense: verified("CC-BY-NC-4.0") })), "BLOCKED_LICENSE");
  assert.equal(classify(entry({ trainingData: { ...verified("research-only"), datasets: [], underlyingWorksCleared: "yes" } })), "BLOCKED_LICENSE");
  assert.equal(classify(entry({ statedRestriction: "acquired under Fair Dealing; non-commercial use only" })), "BLOCKED_LICENSE");
  assert.match(explainClassification(entry({ weightsLicense: verified("CC-BY-NC-4.0") })), /Fine-tuning would not remove it/);
});

test("a secondary-source licence is not enough to ship on", () => {
  const e = entry({ codeLicense: { stated: "MIT", source: "a blog post", confidence: "secondary" } });
  assert.equal(classify(e), "LEGAL_REVIEW_REQUIRED");
});

test("unknown provenance is LEGAL_REVIEW_REQUIRED, not a quiet pass", () => {
  const e = entry({ trainingData: { ...verified("MIT"), datasets: [], underlyingWorksCleared: "unknown" } });
  assert.equal(classify(e), "LEGAL_REVIEW_REQUIRED");
  assert.match(explainClassification(e), /training-data provenance/);
});

test("an entry cannot declare itself shippable: there is no field that overrides classify()", () => {
  // A row is classified purely from evidence. If someone adds a `licenseClass`
  // field to the type later, this test is the reminder that it must not win.
  const keys = Object.keys(entry());
  assert.ok(!keys.includes("licenseClass"), "classification is derived, never stored");
});

test("teacher outputs from non-cleared models are flagged for legal review before training on them", () => {
  const cleared = entry({ id: "A", roles: ["TEACHER_MODEL"] });
  const nc = entry({ id: "B", roles: ["TEACHER_MODEL"], weightsLicense: verified("CC-BY-NC-4.0") });
  const lakh = entry({
    id: "C", roles: ["TEACHER_MODEL"],
    trainingData: { ...verified("CC-BY-4.0"), datasets: ["Lakh"], underlyingWorksCleared: "no" },
  });
  const notATeacher = entry({ id: "D", roles: ["BENCHMARK_ONLY"], weightsLicense: verified("CC-BY-NC-4.0") });
  assert.deepEqual(teacherOutputsNeedReview([cleared, nc, lakh, notATeacher]).map((e) => e.id), ["B", "C"]);
});

// ---------------------------------------------------------------------------
// The real registry obeys the discipline
// ---------------------------------------------------------------------------

test("the first-pass registry ships nothing: every external entry still has an unread layer", () => {
  // This is the honest state of the audit on 2026-09-09. When a row is
  // promoted to SHIP_CLEARED it must be because a primary source was read,
  // and this assertion must be updated deliberately, not silently.
  assert.deepEqual(shippable(GLOBAL_MODEL_REGISTRY).map((e) => e.id), []);
});

test("nothing in the registry claims live inference: no model has been run here yet", () => {
  assert.deepEqual(provenLive(GLOBAL_MODEL_REGISTRY).map((e) => e.id), []);
});

test("every registry row records a classification a reader can act on", () => {
  for (const e of GLOBAL_MODEL_REGISTRY) {
    const verdict = classify(e);
    assert.ok(["SHIP_CLEARED", "RESEARCH_ONLY", "LEGAL_REVIEW_REQUIRED", "BLOCKED_LICENSE"].includes(verdict));
    assert.ok(explainClassification(e).length > 20, `${e.id} explains itself`);
    assert.ok(e.roles.length > 0, `${e.id} has an expected role`);
    assert.ok(e.knownLimitations.length > 0, `${e.id} names at least one limitation`);
  }
});

test("the known non-commercial models are classified as such, not as review-pending", () => {
  const byId = new Map(GLOBAL_MODEL_REGISTRY.map((e) => [e.id, classify(e)]));
  assert.equal(byId.get("MIDI_GPT"), "BLOCKED_LICENSE", "CC-BY-NC weights on Fair-Dealing data");
  assert.equal(byId.get("ANTICIPATORY_MUSIC_TRANSFORMER"), "RESEARCH_ONLY", "Lakh MIDI: permissive licence, uncleared works");
});

test("the strongest lead is still only LEGAL_REVIEW_REQUIRED until its files are read", () => {
  const ca = GLOBAL_MODEL_REGISTRY.find((e) => e.id === "COMPOSERS_ASSISTANT_2")!;
  assert.equal(classify(ca), "LEGAL_REVIEW_REQUIRED");
  assert.match(explainClassification(ca), /weights licence/);
});
