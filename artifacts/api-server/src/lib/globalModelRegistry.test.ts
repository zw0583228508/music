import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import { dirname, resolve } from "node:path";
import test from "node:test";
import {
  classify,
  explainClassification,
  provenLive,
  shippable,
  teacherOutputsNeedReview,
  type ModelEntry,
} from "./globalModelRegistry";
import { AUDITED_OUT_OF_SCOPE, GLOBAL_MODEL_REGISTRY } from "./globalModelRegistryData";

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

/** Walk up from the working directory to the repo root (the suite runs from a bundle in a temp directory). */
function repoFileExists(relativePath: string): boolean {
  let directory = process.cwd();
  for (let up = 0; up < 8; up += 1) {
    if (existsSync(resolve(directory, relativePath)) && existsSync(resolve(directory, "pnpm-workspace.yaml"))) return true;
    directory = dirname(directory);
  }
  return false;
}

test("exactly one entry is SHIP_CLEARED, and only because every layer was read from a primary source", () => {
  // Deliberately updated on 2026-09-09 from "ships nothing". Composer's
  // Assistant 2 was promoted after reading, verbatim, the repository LICENSE
  // (MIT), disclaimer.txt (models under that licence, no rights claimed on
  // outputs, training on PD/CC0/CC-BY/permitted MIDI) and acknowledgments.html
  // (2,451 Mutopia links, CocoChorales CC-BY-4.0, JRP, named contributors), and
  // confirming the model zip carries no contrary licence. Its two named
  // residuals live in knownLimitations. Round 2 audited thirteen more models
  // from primary sources and promoted none: every permissive label sits on an
  // uncleared, NC or undisclosed corpus. Any further promotion must add a name
  // here with the same kind of reason.
  assert.deepEqual(shippable(GLOBAL_MODEL_REGISTRY).map((e) => e.id), ["COMPOSERS_ASSISTANT_2"]);
  const ca = GLOBAL_MODEL_REGISTRY.find((e) => e.id === "COMPOSERS_ASSISTANT_2")!;
  for (const layer of [ca.codeLicense, ca.weightsLicense, ca.trainingData]) {
    assert.equal(layer.confidence, "verified_primary_source");
    assert.ok(layer.source && layer.stated, "a shipped entry cites a source for every layer");
  }
  assert.equal(ca.trainingData.underlyingWorksCleared, "yes");
  assert.ok(ca.knownLimitations.some((l) => /Residual/.test(l)), "the residual risks are named, not hidden");
});

test("exactly two entries claim live inference, and each evidence file exists on disk", () => {
  // Deliberately updated on 2026-09-09 (round 2) from "exactly one". The
  // Anticipatory Music Transformer ran real infills on real PDMX MIDI on the
  // deployed Modal worker (A10G): real input, real GPT-2 inference, real notes,
  // evidence written. It stays RESEARCH_ONLY — proven live is not proven
  // shippable, and the two facts are recorded separately on purpose.
  // Any further promotion must add a name here AND a file the walk-up finds.
  const live = provenLive(GLOBAL_MODEL_REGISTRY);
  assert.deepEqual(live.map((e) => e.id), ["COMPOSERS_ASSISTANT_2", "ANTICIPATORY_MUSIC_TRANSFORMER"]);
  for (const entry of live) {
    assert.ok(entry.liveEvidence, `${entry.id}: a live claim must point at an evidence file`);
    assert.ok(repoFileExists(entry.liveEvidence!), `${entry.id}: ${entry.liveEvidence} does not exist — a live claim with no file is a claim`);
  }
  assert.equal(classify(live[1]), "RESEARCH_ONLY", "live is not the same as shippable");
});

test("every registry row records a classification a reader can act on", () => {
  const ids = new Set<string>();
  for (const e of GLOBAL_MODEL_REGISTRY) {
    assert.ok(!ids.has(e.id), `${e.id} appears twice`);
    ids.add(e.id);
    const verdict = classify(e);
    assert.ok(["SHIP_CLEARED", "RESEARCH_ONLY", "LEGAL_REVIEW_REQUIRED", "BLOCKED_LICENSE"].includes(verdict));
    assert.ok(explainClassification(e).length > 20, `${e.id} explains itself`);
    assert.ok(e.roles.length > 0, `${e.id} has an expected role`);
    assert.ok(e.knownLimitations.length > 0, `${e.id} names at least one limitation`);
    // A "verified" layer must say where it was read.
    for (const layer of [e.codeLicense, e.weightsLicense, e.trainingData]) {
      if (layer.confidence === "verified_primary_source") assert.ok(layer.source && layer.stated, `${e.id}: a verified layer cites its source`);
    }
  }
  assert.ok(GLOBAL_MODEL_REGISTRY.length >= 21, `round 2 audited at least 21 models, found ${GLOBAL_MODEL_REGISTRY.length}`);
});

test("the known non-commercial models are classified as such, not as review-pending", () => {
  const byId = new Map(GLOBAL_MODEL_REGISTRY.map((e) => [e.id, classify(e)]));
  assert.equal(byId.get("MIDI_GPT"), "BLOCKED_LICENSE", "CC-BY-NC weights on Fair-Dealing data");
  assert.equal(byId.get("MIDI_RWKV"), "BLOCKED_LICENSE", "GigaMIDI: Fair Dealing, non-commercial");
  assert.equal(byId.get("MIDI_LLM"), "BLOCKED_LICENSE", "GigaMIDI component; Llama licence besides");
  assert.equal(byId.get("ARIA"), "BLOCKED_LICENSE", "Apache weights over CC-BY-NC-SA transcriptions");
});

test("permissive licences over uncleared works are RESEARCH_ONLY: shadow challengers and references, never weights", () => {
  const byId = new Map(GLOBAL_MODEL_REGISTRY.map((e) => [e.id, classify(e)]));
  assert.equal(byId.get("ANTICIPATORY_MUSIC_TRANSFORMER"), "RESEARCH_ONLY", "Lakh + MetaMIDI + transcribed commercial records under Apache-2.0");
  assert.equal(byId.get("FIGARO"), "RESEARCH_ONLY", "Lakh under MIT");
  assert.equal(byId.get("STRUCTURED_ARRANGEMENT"), "RESEARCH_ONLY", "LMD + Slakh");
  assert.equal(byId.get("GETMUSIC"), "RESEARCH_ONLY", "the publisher states crawled pop music and withholds the set");
  const amt = GLOBAL_MODEL_REGISTRY.find((e) => e.id === "ANTICIPATORY_MUSIC_TRANSFORMER")!;
  assert.ok(!amt.roles.includes("FOUNDATION_CANDIDATE") && !amt.roles.includes("FINE_TUNE_CANDIDATE"), "a RESEARCH_ONLY model is never a foundation or fine-tune candidate");
  assert.ok(teacherOutputsNeedReview(GLOBAL_MODEL_REGISTRY).some((e) => e.id === "ANTICIPATORY_MUSIC_TRANSFORMER"), "its outputs go to review before any student trains on them");
});

test("the permissively-labelled foundations with undisclosed corpora stay LEGAL_REVIEW_REQUIRED", () => {
  const byId = new Map(GLOBAL_MODEL_REGISTRY.map((e) => [e.id, classify(e)]));
  for (const id of [
    "MUPT", "NOTAGEN", "CLAMP3", "MOONBEAM", "REMI_Z_ARRANGER", "MUSECOCO", "SYMPHONYNET",
    "CHATMUSICIAN", "MELODYT5", "PIANIST_TRANSFORMER", "METASCORE_TRANSFORMER", "PHRASELDM", "EQUIVARIANT_MUSIC_TRANSFORMER",
  ]) {
    assert.equal(byId.get(id), "LEGAL_REVIEW_REQUIRED", `${id}: MIT/Apache on weights is not provenance`);
  }
});

test("the round-2 shadow challenger is pinned to what its worker verifies", () => {
  const amt = GLOBAL_MODEL_REGISTRY.find((e) => e.id === "ANTICIPATORY_MUSIC_TRANSFORMER")!;
  assert.match(amt.revision ?? "", /af37397922665a0fb8d474d7988b0f3755a38d45/, "code commit");
  assert.match(amt.revision ?? "", /e206a88d4658661c2757573eae724d5b27213824/, "checkpoint revision");
  assert.match(amt.revision ?? "", /83fb8b9546eacce77a90bb10006b3f569ba342361dce046d078cf2429975e09f/, "safetensors sha256");
  assert.equal(amt.roles.includes("SHADOW_CHALLENGER"), true);
  assert.ok(repoFileExists("services/anticipatory-worker/model_manifest.json"));
});

test("audio models were audited and deliberately kept out of the symbolic registry", () => {
  assert.ok(AUDITED_OUT_OF_SCOPE.includes("STAGE"));
  for (const id of AUDITED_OUT_OF_SCOPE) assert.ok(!GLOBAL_MODEL_REGISTRY.some((e) => e.id === id), `${id} must not have a row`);
});
