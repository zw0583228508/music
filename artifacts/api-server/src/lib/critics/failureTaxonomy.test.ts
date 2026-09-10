import assert from "node:assert/strict";
import test from "node:test";
import { ADVERSARIAL_KINDS, ADVERSARIAL_MODULES } from "./adversarial/index";
import { DIMENSION_DEFAULT_CODE, FAILURE_CODES, FAILURE_TAXONOMY, KIND_TO_CODE, codeForKind, originsForKind, repairScopeForKind } from "./failureTaxonomy";
import { anchors } from "./dimensions/anchors";
import { DIMENSION_NAMES, evaluateAllDimensions } from "./dimensions/index";

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

test("every kind a B-05a dimension emits on the anchors maps to a code (B-05c)", () => {
  // R-1b P0-5: "the judge's priority appears to scale with bar extent and gated
  // status". Part of the cause was here: the judge's PRIORITY_RULES,
  // OPPOSITIONS and agreement grouping all match on failure *codes*, and until
  // B-05c not one of the forty-odd kinds the B-05a dimensions emit was in the
  // taxonomy. Every one of them was `UNCLASSIFIED`, so no code-based rule could
  // ever fire on a constructive finding and no two dimensions could ever be
  // recorded as agreeing. This test walks the dimensions over every anchor and
  // requires a code for everything they actually emit.
  const emitted = new Set<string>();
  for (const anchor of anchors()) {
    for (const report of evaluateAllDimensions(anchor.input)) {
      for (const o of report.observations) emitted.add(`${report.dimension}|${o.kind}`);
    }
  }
  assert.ok(emitted.size >= 40, `kinds observed on the anchors: ${emitted.size}`);
  const unmapped = [...emitted]
    .filter((entry) => {
      const [dimension, kind] = entry.split("|");
      // `measured` is the informational record every dimension writes; it is a
      // measurement, not a failure, and deliberately has no failure code.
      if (kind === "measured") return false;
      return codeForKind(kind) === null && codeForKind(kind, dimension) === null;
    })
    .sort();
  assert.deepEqual(unmapped, [], `unmapped kinds: ${unmapped.join(", ")}`);
  // The playability dimension re-emits the constraint engine's own violation
  // codes, an open set; they reach a code through the dimension fallback rather
  // than a taxonomy row, so that the engine's vocabulary lives in one place.
  const playabilityKinds = [...emitted].filter((e) => e.startsWith("playability|")).map((e) => e.split("|")[1]);
  const viaFallback = playabilityKinds.filter((kind) => KIND_TO_CODE[kind] === undefined && kind !== "measured");
  for (const kind of viaFallback) assert.equal(codeForKind(kind, "playability"), "PLAYABILITY_FAILURE");
  assert.equal(DIMENSION_DEFAULT_CODE.playability, "PLAYABILITY_FAILURE");
  // Every dimension has a fallback, so a kind added tomorrow reaches the rules.
  for (const dimension of DIMENSION_NAMES) assert.ok(DIMENSION_DEFAULT_CODE[dimension], `${dimension} has no default code`);
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
