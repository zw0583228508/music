import assert from "node:assert/strict";
import test from "node:test";

import { RHYTHM_CONDITIONS } from "./rhythmCorpus";
import {
  LICENCE_BLOCKED_RHYTHM_PROVIDERS,
  RHYTHM_ROUTING,
  UNAVAILABLE_RHYTHM_PROVIDERS,
  leadProviderFor,
  routingFor,
  routingIsWorthwhile,
} from "./rhythmRouting";

test("every measured condition is a condition the corpus actually has", () => {
  for (const row of RHYTHM_ROUTING) {
    assert.ok(
      (RHYTHM_CONDITIONS as readonly string[]).includes(row.condition),
      `${row.condition} is not a corpus condition`,
    );
  }
  const seen = new Set(RHYTHM_ROUTING.map((row) => row.condition));
  assert.equal(seen.size, RHYTHM_ROUTING.length, "a condition appears twice");
});

test("the routable leader of every row is one the platform may ship", () => {
  for (const row of RHYTHM_ROUTING) {
    assert.ok(
      !LICENCE_BLOCKED_RHYTHM_PROVIDERS.has(row.routableLeader),
      `${row.condition} routes to ${row.routableLeader}, which is licence-blocked`,
    );
    assert.ok(
      !UNAVAILABLE_RHYTHM_PROVIDERS.has(row.routableLeader),
      `${row.condition} routes to ${row.routableLeader}, which did not run`,
    );
  }
});

test("madmom is never handed out as a production route, however well it scored", () => {
  // The whole point of the licence gate: it must survive madmom leading.
  for (const condition of RHYTHM_CONDITIONS) {
    const decision = leadProviderFor(condition);
    if (!decision) continue;
    assert.ok(
      !LICENCE_BLOCKED_RHYTHM_PROVIDERS.has(decision.provider),
      `${condition} would route to ${decision.provider}`,
    );
  }
});

test("when a blocked provider leads, the cost of the licence is reported, not hidden", () => {
  const blockedRows = RHYTHM_ROUTING.filter((row) =>
    LICENCE_BLOCKED_RHYTHM_PROVIDERS.has(row.measuredLeader));
  for (const row of blockedRows) {
    const decision = leadProviderFor(row.condition);
    assert.ok(decision, `${row.condition} has no decision`);
    assert.ok(decision!.blockedLeader, `${row.condition} hid its blocked leader`);
    assert.equal(decision!.blockedLeader!.provider, row.measuredLeader);
    assert.match(decision!.blockedLeader!.reason, /CC BY-NC-SA/);
    // The routable answer is never better than the measured one; if it looked
    // better the table would be inconsistent with its own ranking.
    assert.ok(decision!.beatF <= decision!.blockedLeader!.beatF + 1e-9);
  }
  // And with the escape hatch, the blocked provider comes back — for offline
  // measurement only.
  for (const row of blockedRows) {
    const measured = leadProviderFor(row.condition, { allowNonCommercial: true });
    assert.equal(measured!.provider, row.measuredLeader);
    assert.equal(measured!.blockedLeader, null);
  }
});

test("a margin inside the noise of four cases is not called decisive", () => {
  for (const row of RHYTHM_ROUTING) {
    if (row.margin !== null && row.margin < 0.05) {
      assert.equal(row.decisive, false, `${row.condition} claims a decisive ${row.margin}`);
    }
    assert.ok(row.cases >= 1, `${row.condition} has no cases`);
  }
});

test("routingFor and leadProviderFor agree, and unknown conditions return null", () => {
  for (const row of RHYTHM_ROUTING) {
    assert.equal(routingFor(row.condition)?.condition, row.condition);
  }
  const missing = RHYTHM_CONDITIONS.filter((condition) => !routingFor(condition));
  for (const condition of missing) {
    assert.equal(leadProviderFor(condition), null);
  }
});

test("the table says whether routing is worth doing at all", () => {
  const verdict = routingIsWorthwhile();
  assert.ok(verdict.reason.length > 20, "the verdict must explain itself");
  if (verdict.singleRoutableLeader) {
    // One winner everywhere means routing buys nothing — and the module must
    // say so rather than shipping a table that returns one name forever.
    assert.equal(verdict.worthwhile, false);
    const leaders = new Set(RHYTHM_ROUTING.map((row) => row.routableLeader));
    assert.equal(leaders.size, 1);
  } else if (RHYTHM_ROUTING.length) {
    assert.equal(new Set(RHYTHM_ROUTING.map((row) => row.routableLeader)).size > 1, true);
  }
});
