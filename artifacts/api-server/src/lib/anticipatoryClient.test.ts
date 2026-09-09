import assert from "node:assert/strict";
import test from "node:test";
import {
  AMT_TOKEN_ENV,
  AMT_URL_ENV,
  AmtHttpError,
  amtEndpoint,
  amtEndpointRefusal,
  amtHealth,
  amtInfill,
} from "./anticipatoryClient";
import { AMT_MODEL_ID, AMT_MODEL_REVISION, AMT_SAFETENSORS_SHA256, amtResultRefusal } from "./anticipatoryResultAdapter";

const env = (overrides: Record<string, string | undefined>): NodeJS.ProcessEnv => ({ ...overrides });

test("the endpoint refuses to exist without a URL, without https, or without its own token", () => {
  assert.match(amtEndpointRefusal(env({})) ?? "", new RegExp(AMT_URL_ENV));
  assert.match(amtEndpointRefusal(env({ [AMT_URL_ENV]: "http://worker.example.com", [AMT_TOKEN_ENV]: "t" })) ?? "", /https/);
  assert.match(
    amtEndpointRefusal(env({ [AMT_URL_ENV]: "https://worker.example.com", MUSIC_AI_WORKER_TOKEN: "shared", COMPOSERS_ASSISTANT_2_API_TOKEN: "ca2" })) ?? "",
    new RegExp(AMT_TOKEN_ENV),
    "neither the shared worker token nor CA2's token may stand in for the dedicated one",
  );
  assert.equal(amtEndpointRefusal(env({ [AMT_URL_ENV]: "https://worker.example.com/", [AMT_TOKEN_ENV]: "t" })), null);
  assert.equal(amtEndpointRefusal(env({ [AMT_URL_ENV]: "http://localhost:8011", [AMT_TOKEN_ENV]: "t" })), null, "a local worker may be plain http");
  assert.equal(amtEndpoint(env({})), null);
  assert.equal(amtEndpoint(env({ [AMT_URL_ENV]: "https://worker.example.com/", [AMT_TOKEN_ENV]: "t" }))!.baseUrl, "https://worker.example.com");
});

test("health sends the bearer token and surfaces a 401 as an error, not as a healthy worker", async () => {
  const endpoint = { baseUrl: "https://w.example", token: "secret-token" };
  const seen: Array<{ url: string; auth: string | undefined }> = [];
  const fetchImpl = async (url: string, init?: RequestInit): Promise<Response> => {
    seen.push({ url, auth: (init?.headers as Record<string, string>)?.Authorization });
    return new Response(JSON.stringify({ detail: "unauthorized" }), { status: 401, headers: { "content-type": "application/json" } });
  };
  await assert.rejects(amtHealth(endpoint, { fetchImpl }), (error: unknown) => {
    assert.ok(error instanceof AmtHttpError);
    assert.equal(error.call, "health");
    assert.equal(error.status, 401);
    return true;
  });
  assert.deepEqual(seen, [{ url: "https://w.example/health", auth: "Bearer secret-token" }]);
});

test("infill posts multipart with the GM program, seed and top_p, and attaches the container's identity", async () => {
  const endpoint = { baseUrl: "https://w.example", token: "secret-token" };
  let received: FormData | null = null;
  const fetchImpl = async (url: string, init?: RequestInit): Promise<Response> => {
    assert.equal(url, "https://w.example/infill");
    assert.equal(init?.method, "POST");
    received = init?.body as FormData;
    return new Response(
      JSON.stringify({
        provider: "ANTICIPATORY_MUSIC_TRANSFORMER",
        seed: 13,
        model: AMT_MODEL_ID,
        revision: AMT_MODEL_REVISION,
        task: { targetInst: 58, measureSlice: [0, 8], windowSeconds: [0, 16], heldOutHumanNotes: 56, contextNotesInWindow: 155 },
        inference: { seconds: 9.4, mode: "anticipate", forwardPasses: 6, generatedEvents: 2, device: "cuda:0" },
        output: { generatedNotes: 2, offTargetEventsDropped: 0, notes: [
          { measure: 0, pitch: 41, startSec: 0, endSec: 0.5, startQn: 0, endQn: 1, velocity: 80, isDrum: false },
          { measure: 0, pitch: 45, startSec: 0.5, endSec: 1, startQn: 1, endQn: 2, velocity: 80, isDrum: false },
        ] },
        definitionOfDone: { realSymbolicOutput: true, verdict: "PASS" },
      }),
      { status: 200, headers: { "content-type": "application/json" } },
    );
  };
  const health = { modelSafetensorsVerified: true, modelSafetensorsSha256Expected: AMT_SAFETENSORS_SHA256, revision: AMT_MODEL_REVISION, model: AMT_MODEL_ID };
  const result = await amtInfill(
    endpoint,
    { midi: new Uint8Array([0x4d, 0x54, 0x68, 0x64]), targetInst: 58, startMeasure: 0, nMeasures: 8, seed: 13, topP: 0.98 },
    health,
    { fetchImpl },
  );
  assert.ok(received);
  const form = received as unknown as FormData;
  assert.equal(form.get("target_inst"), "58");
  assert.equal(form.get("start_measure"), "0");
  assert.equal(form.get("n_measures"), "8");
  assert.equal(form.get("seed"), "13");
  assert.equal(form.get("top_p"), "0.98");
  assert.equal(form.get("max_events"), null, "an unset field is not sent as the string 'undefined'");
  assert.ok(form.get("midi") instanceof Blob);
  assert.deepEqual(result.identity, health);
  assert.equal(amtResultRefusal(result), null, "a verified container's result is accepted by the adapter");
  assert.ok(result.httpSeconds >= 0);
});

test("a container that could not verify its weights poisons every result through the attached identity", async () => {
  const endpoint = { baseUrl: "https://w.example", token: "t" };
  const fetchImpl = async (): Promise<Response> =>
    new Response(JSON.stringify({ provider: "ANTICIPATORY_MUSIC_TRANSFORMER", seed: 1, task: { targetInst: 0, measureSlice: [0, 1], windowSeconds: [0, 2], heldOutHumanNotes: 1, contextNotesInWindow: 1 }, output: { generatedNotes: 0, notes: [] } }), { status: 200 });
  const result = await amtInfill(endpoint, { midi: new Uint8Array(4) }, { modelSafetensorsVerified: false }, { fetchImpl });
  assert.match(amtResultRefusal(result) ?? "", /could not verify the checkpoint checksum/);
});

test("a container serving a different checkpoint is refused through the attached identity", async () => {
  const endpoint = { baseUrl: "https://w.example", token: "t" };
  const fetchImpl = async (): Promise<Response> =>
    new Response(JSON.stringify({ provider: "ANTICIPATORY_MUSIC_TRANSFORMER", seed: 1, task: { targetInst: 0, measureSlice: [0, 1], windowSeconds: [0, 2], heldOutHumanNotes: 1, contextNotesInWindow: 1 }, output: { generatedNotes: 0, notes: [] } }), { status: 200 });
  const result = await amtInfill(endpoint, { midi: new Uint8Array(4) }, { modelSafetensorsVerified: true, model: "stanford-crfm/music-medium-800k" }, { fetchImpl });
  assert.match(amtResultRefusal(result) ?? "", /not the audited stanford-crfm\/music-large-800k/);
});
