import assert from "node:assert/strict";
import test from "node:test";
import { FAILURE_CODES, FAILURE_TAXONOMY } from "./critics/failureTaxonomy";
import { ADVERSARIAL_KINDS } from "./critics/adversarial/index";
import {
  ALL_FAILURE_CODES,
  CONSTRAINT_CODE_CLASSIFICATION,
  ORCHESTRATOR_KIND_CLASSIFICATION,
  classifyBrainFinding,
  classifyFinding,
  classifyHardRuleMessage,
  countFailureCodes,
} from "./findingClassification";

test("the schema's failure-code list is the taxonomy's list (same 24 codes, same order)", () => {
  assert.deepEqual([...ALL_FAILURE_CODES], [...FAILURE_CODES]);
  assert.equal(FAILURE_CODES.length, 24);
});

test("every orchestrator finding kind classifies to a taxonomy code with an origin layer", () => {
  const kinds = ["dropped_part", "planned_family_silent", "unknown_tempo", "unknown_meter", "performed_constraints", "playability_check_missing", "repair_unapplied"] as const;
  for (const kind of kinds) {
    const c = classifyFinding(kind);
    assert.ok((FAILURE_CODES as readonly string[]).includes(c.failureCode), `${kind} -> ${c.failureCode}`);
    assert.deepEqual(c, ORCHESTRATOR_KIND_CLASSIFICATION[kind]);
  }
  assert.deepEqual(classifyFinding("planned_family_silent"), { failureCode: "ORCHESTRATION_FAILURE", originLayer: "orchestration" });
  assert.deepEqual(classifyFinding("dropped_part"), { failureCode: "PLAN_REALISATION_FAILURE", originLayer: "compose" });
  assert.deepEqual(classifyFinding("unknown_tempo"), { failureCode: "INPUT_UNKNOWN", originLayer: "unknown" });
  assert.deepEqual(classifyFinding("performed_constraints"), { failureCode: "PLAYABILITY_FAILURE", originLayer: "perform" });
});

test("constraint-engine codes classify as playability (idiom for the re-strike warning); the origin is the composer", () => {
  for (const code of Object.keys(CONSTRAINT_CODE_CLASSIFICATION)) {
    assert.equal(classifyFinding(code).originLayer, "compose", code);
  }
  assert.equal(classifyFinding("impossible_leap").failureCode, "PLAYABILITY_FAILURE");
  assert.equal(classifyFinding("unrealistic_repetition").failureCode, "IDIOM_FAILURE");
});

test("critic observation kinds (B-05b) classify through the taxonomy with the code's first default origin", () => {
  for (const kind of ADVERSARIAL_KINDS) {
    const c = classifyFinding(kind);
    assert.notEqual(c.failureCode, "INPUT_UNKNOWN", `${kind} is classified`);
    assert.equal(c.originLayer, FAILURE_TAXONOMY[c.failureCode].defaultOrigins[0]);
  }
  assert.deepEqual(classifyFinding("string_bed_too_high"), { failureCode: "REGISTER_FAILURE", originLayer: "register" });
});

test("an unknown kind is INPUT_UNKNOWN / unknown - never a guessed musical cause", () => {
  assert.deepEqual(classifyFinding("something_nobody_defined"), { failureCode: "INPUT_UNKNOWN", originLayer: "unknown" });
});

test("hard-rule messages map to the rule that produced them", () => {
  assert.equal(classifyHardRuleMessage("No meter is established.").failureCode, "INPUT_UNKNOWN");
  assert.deepEqual(classifyHardRuleMessage('Section "Chorus" leaves a gap after "Verse".'), { kind: "form_gap", failureCode: "FORM_FAILURE", originLayer: "form" });
  assert.equal(classifyHardRuleMessage('Mandatory section "Chorus" has no instruments assigned.').failureCode, "ORCHESTRATION_FAILURE");
  assert.equal(classifyHardRuleMessage("bass: melodic leap of 13 semitones exceeds the 12-semitone limit").kind, "impossible_leap");
  assert.equal(classifyHardRuleMessage("strings: 6 notes sound together, the instrument allows 4").kind, "excess_polyphony");
  assert.equal(classifyHardRuleMessage("piano: note 110 is out of range 21-108").kind, "out_of_range");
});

test("classifyBrainFinding stamps the code once and leaves an already classified finding alone", () => {
  const stamped = classifyBrainFinding({ kind: "dropped_part", severity: "error", message: "x" });
  assert.equal(stamped.failureCode, "PLAN_REALISATION_FAILURE");
  assert.equal(stamped.originLayer, "compose");
  const kept = classifyBrainFinding({ ...stamped, failureCode: "FORM_FAILURE", originLayer: "form" });
  assert.equal(kept.failureCode, "FORM_FAILURE");
});

test("countFailureCodes groups by code, origin and severity, largest first", () => {
  const counts = countFailureCodes([
    { failureCode: "ORCHESTRATION_FAILURE", originLayer: "orchestration", severity: "error" },
    { failureCode: "ORCHESTRATION_FAILURE", originLayer: "orchestration", severity: "error" },
    { failureCode: "PLAYABILITY_FAILURE", originLayer: "perform", severity: "error" },
    { severity: "warning" },
  ]);
  assert.deepEqual(counts, [
    { failureCode: "ORCHESTRATION_FAILURE", originLayer: "orchestration", severity: "error", count: 2 },
    { failureCode: "INPUT_UNKNOWN", originLayer: "unknown", severity: "warning", count: 1 },
    { failureCode: "PLAYABILITY_FAILURE", originLayer: "perform", severity: "error", count: 1 },
  ]);
});
