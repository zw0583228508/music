import assert from "node:assert/strict";
import test from "node:test";
import { ADVERSARIAL_KINDS, ADVERSARIAL_MODULES } from "./adversarial/index";
import { FAILURE_CODES, FAILURE_TAXONOMY, KIND_TO_CODE, codeForKind, originsForKind, repairScopeForKind } from "./failureTaxonomy";

test("every code has a definition, at least one default origin layer and a repair scope", () => {
  for (const code of FAILURE_CODES) {
    const spec = FAILURE_TAXONOMY[code];
    assert.equal(spec.code, code);
    assert.ok(spec.definition.length > 30, `${code} has a real definition`);
    assert.ok(spec.defaultOrigins.length >= 1, `${code} names its usual origin layer(s)`);
    assert.ok(["note", "part", "section", "plan"].includes(spec.defaultRepairScope));
  }
});

test("the brief's code list is present", () => {
  for (const code of [
    "GLOBAL_COHERENCE_FAILURE", "FORM_FAILURE", "ENERGY_ARC_FAILURE", "MOTIF_FAILURE", "HARMONY_FAILURE", "VOICE_LEADING_FAILURE",
    "GROOVE_FAILURE", "ORCHESTRATION_FAILURE", "REGISTER_FAILURE", "DENSITY_FAILURE", "PLAYABILITY_FAILURE", "STYLE_FAILURE",
    "TRANSITION_FAILURE", "REPETITION_FAILURE", "PERFORMANCE_FAILURE", "RENDER_FAILURE", "AUDIO_BALANCE_FAILURE",
  ]) {
    assert.ok((FAILURE_CODES as readonly string[]).includes(code), `${code} is in the taxonomy`);
  }
});

test("every kind emitted by an adversarial module maps to exactly one failure code", () => {
  assert.ok(ADVERSARIAL_KINDS.length >= 40, `the modules declare their kinds (${ADVERSARIAL_KINDS.length})`);
  const unmapped = ADVERSARIAL_KINDS.filter((kind) => codeForKind(kind) === null);
  assert.deepEqual(unmapped, [], "no adversarial kind is outside the taxonomy");
  // A kind belongs to one code only.
  const seen = new Map<string, string>();
  for (const code of FAILURE_CODES) {
    for (const kind of FAILURE_TAXONOMY[code].typicalKinds) {
      assert.ok(!seen.has(kind), `${kind} is listed under both ${seen.get(kind)} and ${code}`);
      seen.set(kind, code);
    }
  }
  assert.equal(Object.keys(KIND_TO_CODE).length, seen.size);
});

test("each module's declared kinds are the kinds it can emit (no undeclared emission path)", () => {
  for (const m of ADVERSARIAL_MODULES) {
    assert.ok(m.kinds.length >= 2, `${m.dimension} declares its kinds`);
    for (const kind of m.kinds) assert.ok(codeForKind(kind), `${m.dimension}: ${kind} maps to a code`);
  }
});

test("origins and repair scope for a kind come from its code; unknown kinds attribute to nothing", () => {
  assert.deepEqual(originsForKind("physically_unplayable"), ["compose", "perform"]);
  assert.equal(repairScopeForKind("physically_unplayable"), "note");
  assert.deepEqual(originsForKind("string_bed_too_high"), ["register", "compose"]);
  assert.deepEqual(originsForKind("kind_nobody_declared"), ["unknown"]);
  assert.equal(repairScopeForKind("kind_nobody_declared"), "plan");
  assert.equal(codeForKind("planned_family_silent"), "ORCHESTRATION_FAILURE");
  assert.equal(codeForKind("melody_masked"), "VOCAL_SPACE_FAILURE");
});
