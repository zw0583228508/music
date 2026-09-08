import assert from "node:assert/strict";
import test from "node:test";
import {
  createProviderRegistry,
  MUSIC_PROVIDERS,
  ProviderUnavailableError,
  providerIsShadowOnly,
  runArrangementProvider,
  type ArrangementProviderInput,
  type ProviderGenerationInput,
} from "./musicProviders";

const shadowEnvironment = {
  MAGENTA_RT2_API_URL: "https://magenta-rt2.example.test",
  MAGENTA_RT2_API_TOKEN: "magenta-rt2-token",
  MUSIC_PROVIDER_MAGENTA_RT2_URL: "https://gateway.example.test/magenta-rt2",
  MUSIC_PROVIDER_MAGENTA_RT2_TOKEN: "magenta-rt2-gateway-token",
  MUSIC_PROVIDER_GATEWAY_URL: "https://gateway.example.test",
  MUSIC_PROVIDER_GATEWAY_TOKEN: "gateway-token",
  MUSIC_AI_WORKER_TOKEN: "worker-token",
} as const;

function configureEndpoints(): () => void {
  const saved = new Map<string, string | undefined>();
  for (const [key, value] of Object.entries(shadowEnvironment)) {
    saved.set(key, process.env[key]);
    process.env[key] = value;
  }
  return () => {
    for (const [key, value] of saved) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  };
}

test("a fully licensed shadow model still cannot route by default", async () => {
  // Magenta RT2's licence is verified permissive and ungated, so nothing in the
  // rights gates stops it. The quality gate has to, on its own — otherwise a
  // clean licence review silently promotes an unevaluated model.
  const restore = configureEndpoints();
  const originalFetch = globalThis.fetch;
  let fetchCalls = 0;
  globalThis.fetch = async () => {
    fetchCalls += 1;
    throw new Error("shadow providers must not route");
  };

  try {
    assert.equal(providerIsShadowOnly("MAGENTA_RT2"), true);

    const descriptor = MUSIC_PROVIDERS.find((candidate) => candidate.id === "MAGENTA_RT2");
    assert.ok(descriptor, "MAGENTA_RT2 is registered");
    assert.match(descriptor.notes, /SHADOW_ONLY/);
    // The licence is clean; that is precisely the point of this test.
    assert.match(descriptor.license ?? "", /Apache-2\.0.*CC-BY-4\.0/);
    assert.doesNotMatch(descriptor.license ?? "", /BLOCKED|UNVERIFIED/i);

    await assert.rejects(
      runArrangementProvider(descriptor, {} as ArrangementProviderInput),
      ProviderUnavailableError,
    );

    const registry = createProviderRegistry();
    const provider = registry.find((candidate) => candidate.definition.id === "MAGENTA_RT2");
    assert.ok(provider);
    // Every endpoint variable above is set. The provider is still unavailable,
    // which is the actual claim: configuration cannot promote a shadow model.
    assert.equal(provider.available, false);
    assert.equal(provider.readiness.availability, "unavailable");
    assert.equal(provider.readiness.configurationReady, false);
    await assert.rejects(provider.generate({} as ProviderGenerationInput));

    const readiness = await provider.checkHealth(true);
    assert.equal(readiness.availability, "unavailable");
    // The operator has to be told which gate is holding it, and it is not licence.
    assert.match(readiness.message ?? "", /SHADOW_ONLY/);
    assert.doesNotMatch(readiness.message ?? "", /BLOCKED_LICENSE/);
    assert.equal(fetchCalls, 0, "no shadow provider request left the process");
  } finally {
    globalThis.fetch = originalFetch;
    restore();
  }
});

test("the realizer is never advertised as an arranger", () => {
  // The whole architecture depends on this boundary: our symbolic pipeline
  // composes, and RT2 only renders what it composed.
  const descriptor = MUSIC_PROVIDERS.find((candidate) => candidate.id === "MAGENTA_RT2");
  assert.ok(descriptor);
  assert.deepEqual(descriptor.capabilities, ["audio_generation"]);
  assert.ok(!descriptor.capabilities.includes("arrangement"));
  assert.ok(!descriptor.capabilities.includes("orchestration"));
  assert.ok(!descriptor.capabilities.includes("harmony"));
});

test("shadow status is a quality gate, not a licence gate", () => {
  // A licence-blocked provider and a shadow provider must not be confused: the
  // first can never route, the second routes as soon as it earns it.
  const blocked = MUSIC_PROVIDERS.find((candidate) => candidate.id === "LADA_BAND");
  const shadow = MUSIC_PROVIDERS.find((candidate) => candidate.id === "MAGENTA_RT2");
  assert.ok(blocked && shadow);
  assert.match(blocked.notes, /BLOCKED_LICENSE/);
  assert.doesNotMatch(shadow.notes, /BLOCKED_LICENSE/);
  assert.equal(providerIsShadowOnly("LADA_BAND"), false, "licence blocks are a different mechanism");
});
