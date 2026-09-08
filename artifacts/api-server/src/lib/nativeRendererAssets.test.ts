/**
 * The PEDALBOARD_VST3 client against a stubbed worker: asset selection, the
 * attestation checks per asset, and the health cache. No network, no plugin.
 */
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import test from "node:test";
import type { TrackModel } from "@workspace/db";
import {
  PedalboardRenderer,
  clearRendererHealthCache,
  performedMaterialSha256,
} from "./musicEngines";
import { getInstrumentDefinition } from "./musicEngines";

const SR = 44_100;
const DURATION = 1.0;
const FRAMES = Math.ceil(SR * DURATION);

function canonicalJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map((item) => canonicalJson(item)).join(",")}]`;
  if (value && typeof value === "object") {
    return `{${Object.entries(value as Record<string, unknown>).sort(([l], [r]) => l.localeCompare(r)).map(([k, v]) => `${JSON.stringify(k)}:${canonicalJson(v)}`).join(",")}}`;
  }
  return JSON.stringify(value);
}

function wav16Stereo(frames: number, sampleRate: number): Buffer {
  const data = Buffer.alloc(frames * 4);
  for (let i = 0; i < frames; i += 1) {
    const v = Math.round(Math.sin(i / 20) * 12_000);
    data.writeInt16LE(v, i * 4); data.writeInt16LE(v, i * 4 + 2);
  }
  const header = Buffer.alloc(44);
  header.write("RIFF", 0); header.writeUInt32LE(36 + data.length, 4); header.write("WAVE", 8);
  header.write("fmt ", 12); header.writeUInt32LE(16, 16); header.writeUInt16LE(1, 20); header.writeUInt16LE(2, 22);
  header.writeUInt32LE(sampleRate, 24); header.writeUInt32LE(sampleRate * 4, 28); header.writeUInt16LE(4, 32); header.writeUInt16LE(16, 34);
  header.write("data", 36); header.writeUInt32LE(data.length, 40);
  return Buffer.concat([header, data]);
}

const track: TrackModel = {
  id: "p--keys", instrument: "keys", role: "harmonic_bed",
  instrumentDefinition: getInstrumentDefinition("keys", "harmonic_bed"),
  notes: [{ id: "n1", start: 0, duration: 0.5, pitch: 60, velocity: 90 }],
  cc: [], articulations: [], automation: [], source: "TEST", version: 1,
  provenance: { model: "TEST", version: "1.0.0", parameters: {}, parentIds: [], createdBy: "test" },
};

function asset(id: string) {
  return {
    id, identity: `VST3-${id}@1`, sha256: "a".repeat(64), licenseOwner: "owner", licenseReference: "ref",
    rendererIdentity: "pedalboard_native:x@0.9.24", rendererSha256: "b".repeat(64),
  };
}
function smoke(id: string, ok = true) {
  return {
    assetId: id, sha256: "a".repeat(64), rendererSha256: "b".repeat(64), outputSha256: "c".repeat(64),
    trackModelRendered: ok, audible: ok, canonicalSensitivity: ok, nativeHostAttested: ok,
  };
}

const health = {
  contractVersion: "1.0", healthy: true, provider: "VST3", modelVersion: "VST3-retro@1",
  runtimeIdentity: "pedalboard-0.9.24", runtimeReady: true, smokeTested: true,
  asset: asset("retro"), smokeEvidence: smoke("retro"),
  assets: [
    { ...asset("retro"), smokeEvidence: smoke("retro") },
    { ...asset("groove"), smokeEvidence: smoke("groove") },
    { ...asset("broken"), smokeEvidence: smoke("broken", false) },
  ],
};

function stubWorker(options: { echoAsset?: (requested: string | undefined) => string } = {}) {
  const calls = { health: 0, render: [] as Array<string | undefined> };
  const wav = wav16Stereo(FRAMES, SR);
  globalThis.fetch = (async (url: URL | string, init?: RequestInit) => {
    const target = String(url);
    if (target.includes("/health")) {
      calls.health += 1;
      return new Response(JSON.stringify(health), { status: 200, headers: { "content-type": "application/json" } });
    }
    const body = JSON.parse(String(init?.body));
    const requested = body.parameters?.assetId as string | undefined;
    calls.render.push(requested);
    const used = options.echoAsset ? options.echoAsset(requested) : (requested ?? "retro");
    return new Response(JSON.stringify({
      contractVersion: "1.0", provider: "VST3", trackModelId: track.id,
      trackModelSha256: createHash("sha256").update(canonicalJson(track)).digest("hex"),
      performedMaterialSha256: performedMaterialSha256(track),
      sampleRate: SR, frameCount: FRAMES, durationSeconds: DURATION,
      outputSha256: createHash("sha256").update(wav).digest("hex"),
      audio_base64: wav.toString("base64"),
      asset: asset(used),
    }), { status: 200, headers: { "content-type": "application/json" } });
  }) as typeof fetch;
  return calls;
}

const originalFetch = globalThis.fetch;
process.env.PEDALBOARD_VST3_API_URL = "http://worker.test";
process.env.PEDALBOARD_VST3_API_TOKEN = "t";

test("without an asset id the worker's default asset renders, as before PR-22", async () => {
  clearRendererHealthCache();
  const calls = stubWorker();
  try {
    const result = await new PedalboardRenderer().renderAttested(track, SR, DURATION);
    assert.equal(result.attestation.assetId, "retro");
    assert.equal(result.samples.length, FRAMES * 2);
    assert.deepEqual(calls.render, [undefined]);
  } finally { globalThis.fetch = originalFetch; }
});

test("a named asset is used and its own evidence is checked", async () => {
  clearRendererHealthCache();
  const calls = stubWorker();
  try {
    const renderer = new PedalboardRenderer();
    const result = await renderer.renderAttested(track, SR, DURATION, { assetId: "groove" });
    assert.equal(result.attestation.assetId, "groove");
    assert.equal(result.attestation.assetIdentity, "VST3-groove@1");
    assert.deepEqual(calls.render, ["groove"]);
    // An asset whose own smoke failed is not attested, however healthy the default is.
    await assert.rejects(renderer.renderAttested(track, SR, DURATION, { assetId: "broken" }), /not backed by a healthy attested asset \(broken\)/);
    await assert.rejects(renderer.renderAttested(track, SR, DURATION, { assetId: "nope" }), /\(nope\)/);
    assert.deepEqual(await renderer.listAttestedAssetIds(), ["retro", "groove"]);
  } finally { globalThis.fetch = originalFetch; }
});

test("a worker that renders with a different asset than requested is rejected", async () => {
  clearRendererHealthCache();
  stubWorker({ echoAsset: () => "retro" });
  try {
    await assert.rejects(
      new PedalboardRenderer().renderAttested(track, SR, DURATION, { assetId: "groove" }),
      /incomplete attestation/,
    );
  } finally { globalThis.fetch = originalFetch; }
});

test("health is fetched once per worker per window, not once per track", async () => {
  clearRendererHealthCache();
  const calls = stubWorker();
  try {
    const renderer = new PedalboardRenderer();
    await renderer.renderAttested(track, SR, DURATION);
    await renderer.renderAttested(track, SR, DURATION, { assetId: "groove" });
    await renderer.listAttestedAssetIds();
    assert.equal(calls.health, 1);
    clearRendererHealthCache();
    await renderer.renderAttested(track, SR, DURATION);
    assert.equal(calls.health, 2);
  } finally { globalThis.fetch = originalFetch; }
});
