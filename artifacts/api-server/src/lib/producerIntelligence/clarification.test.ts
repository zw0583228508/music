import assert from "node:assert/strict";
import test from "node:test";
import type { ClarificationOption } from "@workspace/db";
import {
  CLARIFICATION_THRESHOLD,
  MAX_CLARIFICATIONS,
  allClarificationCandidates,
  applyClarificationAnswers,
  planClarifications,
} from "./clarification";
import { extractUserIntentSync } from "./intentExtraction";
import { resolveStyleProfile } from "./styleResolution";

const NOW = new Date("2026-01-01T00:00:00.000Z");
const plan = (text: string, options = {}) => {
  const intent = extractUserIntentSync(text, { now: NOW });
  const profile = resolveStyleProfile(intent, { now: NOW });
  return { intent, profile, questions: planClarifications(intent, profile, options) };
};

test("'old Hasidic' asks which world, with concrete brief deltas per answer", () => {
  for (const text of ["old hasidic", "חסידי ישן"]) {
    const { questions } = plan(text);
    assert.equal(questions.length, 1, text);
    const [q] = questions;
    assert.equal(q.id, "world_of_tradition");
    assert.ok(q.informationGain >= 0.7, `high gain: ${q.informationGain}`);
    assert.deepEqual(q.options.map((o) => o.id), ["era_band", "communal_vocal", "arranged_orchestral"]);
    assert.ok(q.settlesDimensions.includes("ensembleType"));
    const ensembles = q.options.map((o) => {
      const delta = o.briefDeltas.find((d) => d.kind === "set_dimension" && d.dimension === "ensembleType");
      assert.ok(delta, `${o.id} settles the ensemble`);
      return delta!.kind === "set_dimension" ? delta.value : null;
    });
    assert.equal(new Set(ensembles).size, 3, "the three worlds imply three different ensembles");
    assert.ok(q.trigger.sourceRefs.some((r) => r.startsWith("text:")), "the question cites the words that triggered it");
  }
});

test("a fully specified intent asks nothing", () => {
  const { questions, profile } = plan("80s hasidic wedding band with clarinet, trumpet and drums");
  assert.equal(profile.dimensions.ensembleType?.value, "wedding_band");
  assert.deepEqual(questions, []);
});

test("at most two questions, highest gain first, all above the threshold", () => {
  const { intent, profile, questions } = plan("old klezmer, jazz and pop, like Giora Feidman");
  const candidates = allClarificationCandidates(intent, profile);
  assert.ok(candidates.length >= 3, `several candidates: ${candidates.map((c) => c.id).join(",")}`);
  assert.equal(questions.length, MAX_CLARIFICATIONS);
  assert.deepEqual(questions.map((q) => q.id), ["world_of_tradition", "genre_conflict"]);
  for (let i = 1; i < questions.length; i += 1) {
    assert.ok(questions[i - 1].informationGain >= questions[i].informationGain);
  }
  for (const q of questions) assert.ok(q.informationGain >= CLARIFICATION_THRESHOLD);
});

test("low-gain questions are not asked", () => {
  // A decade alone would be asked about; with a reference and named
  // instruments the answer would change little, so only the reference is asked.
  const { intent, profile, questions } = plan("80s, like Leonard Cohen, with piano and cello");
  const era = allClarificationCandidates(intent, profile).find((q) => q.id === "era_without_world");
  assert.ok(era && era.informationGain < CLARIFICATION_THRESHOLD, `era question stays below threshold (${era?.informationGain})`);
  assert.deepEqual(questions.map((q) => q.id), ["reference_aspect_ref-1"]);
  assert.deepEqual(plan("old hasidic", { threshold: 0.95 }).questions, []);
});

test("answers turn into deltas; free text becomes a soft decision; the rest stays open", () => {
  const { questions } = plan("old klezmer, jazz and pop");
  const applied = applyClarificationAnswers(questions, [
    { questionId: "world_of_tradition", optionId: "communal_vocal" },
    { questionId: "genre_conflict", freeText: "jazz harmony but a pop shape" },
  ]);
  assert.deepEqual(applied.answered, ["world_of_tradition", "genre_conflict"]);
  assert.deepEqual(applied.unanswered, []);
  assert.ok(applied.deltas.some((d) => d.kind === "set_dimension" && d.dimension === "ensembleType" && d.value === "vocal_led_small"));
  assert.ok(applied.deltas.some((d) => d.kind === "vocal_space"));
  const free = applied.deltas.find((d) => d.kind === "decision");
  assert.ok(free && free.kind === "decision" && free.strength === "soft" && free.statement === "jazz harmony but a pop shape");
  assert.deepEqual(applied.sourceRefs, ["answer:world_of_tradition/communal_vocal", "answer:genre_conflict/free_text"]);
  const partial = applyClarificationAnswers(questions, []);
  assert.deepEqual(partial.unanswered, ["world_of_tradition", "genre_conflict"]);
});

test("a knowledge source can supply tradition-specific worlds through worldsFor", () => {
  const worlds: ClarificationOption[] = [
    { id: "wedding_band_90s", label: "The 90s wedding-band sound", description: "", briefDeltas: [{ kind: "set_dimension", dimension: "ensembleType", value: "wedding_band", confidence: 0.9, rationale: "90s wedding band" }] },
    { id: "yeshiva_niggun", label: "The yeshiva / niggun world", description: "", briefDeltas: [{ kind: "set_dimension", dimension: "ensembleType", value: "vocal_led_small", confidence: 0.9, rationale: "niggun world" }] },
    { id: "traditional_orchestral", label: "Traditional orchestral", description: "", briefDeltas: [{ kind: "set_dimension", dimension: "ensembleType", value: "orchestral", confidence: 0.9, rationale: "orchestral" }] },
  ];
  const { questions } = plan("old hasidic", { worldsFor: (tradition: string) => (tradition === "hasidic" ? worlds : null) });
  assert.deepEqual(questions[0].options.map((o) => o.label), [
    "The 90s wedding-band sound", "The yeshiva / niggun world", "Traditional orchestral",
  ]);
  assert.deepEqual(plan("old klezmer", { worldsFor: () => null }).questions[0].options.map((o) => o.id), ["era_band", "communal_vocal", "arranged_orchestral"]);
});
