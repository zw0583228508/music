import assert from "node:assert/strict";
import test from "node:test";
import {
  CA2_TOKEN_ENV,
  CA2_URL_ENV,
  Ca2HttpError,
  ca2Endpoint,
  ca2EndpointRefusal,
  ca2Health,
  ca2Infill,
} from "./composersAssistantClient";
import { CA2_LARGE_MODEL_SHA256, ca2ResultRefusal } from "./ca2ResultAdapter";

const env = (overrides: Record<string, string | undefined>): NodeJS.ProcessEnv => ({ ...overrides });

test("the endpoint refuses to exist without a URL, without https, or without its own token", () => {
  assert.match(ca2EndpointRefusal(env({})) ?? "", new RegExp(CA2_URL_ENV));
  assert.match(
    ca2EndpointRefusal(env({ [CA2_URL_ENV]: "http://worker.example.com", [CA2_TOKEN_ENV]: "t" })) ?? "",
    /https/,
  );
  assert.match(
    ca2EndpointRefusal(env({ [CA2_URL_ENV]: "https://worker.example.com", MUSIC_AI_WORKER_TOKEN: "shared" })) ?? "",
    new RegExp(CA2_TOKEN_ENV),
    "the shared worker token must not stand in for the dedicated one",
  );
  assert.equal(ca2EndpointRefusal(env({ [CA2_URL_ENV]: "https://worker.example.com/", [CA2_TOKEN_ENV]: "t" })), null);
  assert.equal(ca2EndpointRefusal(env({ [CA2_URL_ENV]: "http://localhost:8010", [CA2_TOKEN_ENV]: "t" })), null, "a local worker may be plain http");
  assert.equal(ca2Endpoint(env({}))!, null);
  assert.equal(ca2Endpoint(env({ [CA2_URL_ENV]: "https://worker.example.com/", [CA2_TOKEN_ENV]: "t" }))!.baseUrl, "https://worker.example.com");
});

test("health sends the bearer token and surfaces a 401 as an error, not as a healthy worker", async () => {
  const endpoint = { baseUrl: "https://w.example", token: "secret-token" };
  const seen: Array<{ url: string; auth: string | undefined }> = [];
  const fetchImpl = async (url: string, init?: RequestInit): Promise<Response> => {
    seen.push({ url, auth: (init?.headers as Record<string, string>)?.Authorization });
    return new Response(JSON.stringify({ detail: "unauthorized" }), { status: 401, headers: { "content-type": "application/json" } });
  };
  await assert.rejects(ca2Health(endpoint, { fetchImpl }), (error: unknown) => {
    assert.ok(error instanceof Ca2HttpError);
    assert.equal(error.call, "health");
    assert.equal(error.status, 401);
    return true;
  });
  assert.deepEqual(seen, [{ url: "https://w.example/health", auth: "Bearer secret-token" }]);
});

test("infill posts multipart with the GM program and attaches the container's identity to the result", async () => {
  const endpoint = { baseUrl: "https://w.example", token: "secret-token" };
  let received: FormData | null = null;
  const fetchImpl = async (url: string, init?: RequestInit): Promise<Response> => {
    assert.equal(url, "https://w.example/infill");
    assert.equal(init?.method, "POST");
    received = init?.body as FormData;
    return new Response(
      JSON.stringify({
        provider: "COMPOSERS_ASSISTANT_2",
        seed: 13,
        task: { targetTrack: 2, targetInst: 58, measureSlice: [0, 8], maskLocations: 8, heldOutHumanNotes: 40 },
        inference: { seconds: 14.2, outputTokens: 300, device: "cpu" },
        output: { generatedNotes: 2, notes: [
          { measure: 0, pitch: 41, startQn: 0, endQn: 1, velocity: 80, isDrum: false },
          { measure: 0, pitch: 45, startQn: 1, endQn: 2, velocity: 80, isDrum: false },
        ] },
        definitionOfDone: { realSymbolicOutput: true, verdict: "PASS" },
      }),
      { status: 200, headers: { "content-type": "application/json" } },
    );
  };
  const health = { modelBinVerified: true, modelBinSha256Expected: CA2_LARGE_MODEL_SHA256, release: "v2.1.0" };
  const result = await ca2Infill(
    endpoint,
    { midi: new Uint8Array([0x4d, 0x54, 0x68, 0x64]), targetInst: 58, startMeasure: 0, nMeasures: 8, seed: 13, temperature: 1.15 },
    health,
    { fetchImpl },
  );
  assert.ok(received);
  const form = received as unknown as FormData;
  assert.equal(form.get("target_inst"), "58");
  assert.equal(form.get("start_measure"), "0");
  assert.equal(form.get("n_measures"), "8");
  assert.equal(form.get("seed"), "13");
  assert.equal(form.get("temperature"), "1.15");
  assert.equal(form.get("target_track"), null, "an unset field is not sent as the string 'undefined'");
  assert.ok(form.get("midi") instanceof Blob);
  assert.deepEqual(result.identity, health);
  assert.equal(ca2ResultRefusal(result), null, "a verified container's result is accepted by the adapter");
  assert.ok(result.httpSeconds >= 0);
});

test("a container that could not verify its weights poisons every result through the attached identity", async () => {
  const endpoint = { baseUrl: "https://w.example", token: "t" };
  const fetchImpl = async (): Promise<Response> =>
    new Response(JSON.stringify({ provider: "COMPOSERS_ASSISTANT_2", seed: 1, task: { targetTrack: 0, targetInst: 0, measureSlice: [0, 1], maskLocations: 1, heldOutHumanNotes: 1 }, output: { generatedNotes: 0, notes: [] } }), { status: 200 });
  const result = await ca2Infill(endpoint, { midi: new Uint8Array(4) }, { modelBinVerified: false }, { fetchImpl });
  assert.match(ca2ResultRefusal(result) ?? "", /could not verify the model checksum/);
});
