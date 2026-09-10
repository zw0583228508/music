import { test } from "node:test";
import assert from "node:assert/strict";
import { candidateStatusAfterProviderGate, providerHardRuleRefusal } from "./candidateRanking";

// R-1a P0-1: the Arrangement Brain refuses a candidate at its own hard-rule gate and returns it
// labelled rather than omitted, so the reasons stay on the record. Before this guard the runner
// validated it anyway and it could be ranked first — the drums-only arrangement the audit's Probe 5
// built is exactly such a candidate.

test("a candidate the provider refused is not validated, and its reason travels", () => {
  const parameters = {
    arrangementBrain: {
      selectable: false,
      hardRuleFeasible: false,
      hardRuleReasons: ["planned_family_silent: keys wrote nothing in Verse 1", "dropped_part: bass"],
    },
  };
  const refusal = providerHardRuleRefusal(parameters);
  assert.equal(refusal.refused, true);
  assert.match(refusal.reason ?? "", /planned_family_silent/);
  const gated = candidateStatusAfterProviderGate("validated", parameters);
  assert.equal(gated.status, "rejected");
  assert.match(gated.reason ?? "", /hard-rule gate/);
});

test("a candidate the provider accepted keeps its status untouched", () => {
  const parameters = { arrangementBrain: { selectable: true, hardRuleFeasible: true, hardRuleReasons: [] } };
  assert.deepEqual(providerHardRuleRefusal(parameters), { refused: false, reason: null });
  assert.deepEqual(candidateStatusAfterProviderGate("validated", parameters), { status: "validated", reason: null });
});

test("a provider without a hard-rule gate is unaffected", () => {
  for (const parameters of [undefined, null, {}, { arrangementBrain: null }, { other: 1 }]) {
    assert.deepEqual(providerHardRuleRefusal(parameters), { refused: false, reason: null });
    assert.equal(candidateStatusAfterProviderGate("validated", parameters).status, "validated");
  }
});

test("the gate only removes a validation; it never promotes another status", () => {
  const refused = { arrangementBrain: { selectable: false } };
  for (const status of ["rejected", "diversity_rejected", "repair_not_improved"]) {
    assert.equal(candidateStatusAfterProviderGate(status, refused).status, status);
  }
});

test("hardRuleFeasible false alone is enough (an older provider payload)", () => {
  const gated = candidateStatusAfterProviderGate("validated", { arrangementBrain: { hardRuleFeasible: false } });
  assert.equal(gated.status, "rejected");
  assert.equal(gated.reason, "the provider's hard-rule gate refused this candidate");
});
