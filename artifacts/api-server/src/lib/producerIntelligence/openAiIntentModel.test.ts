import assert from "node:assert/strict";
import test from "node:test";
import { extractUserIntent } from "./intentExtraction";
import {
  DEFAULT_PRODUCER_LLM_MODEL,
  createOpenAiIntentModel,
  openAiIntegrationConfigured,
  openAiIntentModelSelected,
  selectIntentLanguageModel,
  type IntentChatClient,
} from "./openAiIntentModel";

const NOW = new Date("2026-01-01T00:00:00.000Z");
const CONFIGURED = { AI_INTEGRATIONS_OPENAI_BASE_URL: "https://mock-openai.test/v1", AI_INTEGRATIONS_OPENAI_API_KEY: "test-key" };

test("the OpenAI intent model is never selected unless opted in AND configured", () => {
  assert.equal(selectIntentLanguageModel({}), undefined, "nothing set");
  assert.equal(selectIntentLanguageModel({ PRODUCER_LLM: "openai" }), undefined, "opted in without the integration");
  assert.equal(selectIntentLanguageModel(CONFIGURED), undefined, "integration present but not opted in");
  assert.equal(selectIntentLanguageModel({ ...CONFIGURED, PRODUCER_LLM: "anthropic" }), undefined, "a different provider name is not this adapter");
  assert.equal(openAiIntegrationConfigured({}), false);
  assert.equal(openAiIntegrationConfigured(CONFIGURED), true);
  assert.equal(openAiIntentModelSelected({ ...CONFIGURED, PRODUCER_LLM: "openai" }), true);

  const selected = selectIntentLanguageModel({ ...CONFIGURED, PRODUCER_LLM: "openai" }, { client: async () => { throw new Error("not called at selection time"); } });
  assert.ok(selected, "selected when opted in and configured");
  assert.equal(selected!.id, `openai/${DEFAULT_PRODUCER_LLM_MODEL}`);
  const custom = selectIntentLanguageModel({ ...CONFIGURED, PRODUCER_LLM: "openai", PRODUCER_LLM_MODEL: "gpt-test" }, { client: async () => { throw new Error("not called"); } });
  assert.equal(custom!.id, "openai/gpt-test");
});

function fakeClient(reply: string | null, seen: Array<{ role: string; content: string }>): IntentChatClient {
  return {
    chat: {
      completions: {
        async create(request) {
          seen.push(...request.messages);
          assert.equal(request.response_format.type, "json_object");
          return { choices: [{ message: { content: reply } }] };
        },
      },
    },
  };
}

test("the adapter asks for JSON only and returns the parsed object; garbage becomes null", async () => {
  const seen: Array<{ role: string; content: string }> = [];
  const model = createOpenAiIntentModel({ model: "gpt-test", client: async () => fakeClient('{"inferences":[{"slot":"mood","value":"warm","confidence":0.9,"evidence":["warm"]}]}', seen) });
  const raw = await model.complete({ instructions: "read it", text: "a warm song", schemaHint: "{...}" });
  assert.deepEqual(raw, { inferences: [{ slot: "mood", value: "warm", confidence: 0.9, evidence: ["warm"] }] });
  assert.equal(seen[0].role, "system");
  assert.match(seen[0].content, /read it/);
  assert.match(seen[0].content, /never write notes/);
  assert.equal(seen[1].role, "user");
  assert.equal(seen[1].content, "a warm song");

  const broken = createOpenAiIntentModel({ client: async () => fakeClient("not json at all", []) });
  assert.equal(await broken.complete({ instructions: "", text: "x", schemaHint: "" }), null);
  const empty = createOpenAiIntentModel({ client: async () => fakeClient(null, []) });
  assert.equal(await empty.complete({ instructions: "", text: "x", schemaHint: "" }), null);
});

test("through extractUserIntent, model output is held to the verbatim-span rule and never removes a deterministic reading", async () => {
  const text = "a warm hasidic ballad";
  const model = createOpenAiIntentModel({
    model: "gpt-test",
    client: async () => fakeClient(JSON.stringify({
      // "warm" is in the text (kept, as inferred); "cinematic" is not (dropped);
      // a fabricated constraint without a verbatim statement is dropped too.
      inferences: [
        { slot: "mood", value: "warm", confidence: 0.99, evidence: ["warm"] },
        { slot: "production_feel", value: "cinematic", confidence: 0.99, evidence: ["cinematic"] },
      ],
      constraints: [{ kind: "avoid", subject: "drums", statement: "no drums" }],
      references: [{ kind: "artist", label: "Somebody", evidence: "like Somebody" }],
    }), []),
  });
  const intent = await extractUserIntent(text, { llm: model, now: NOW });
  assert.equal(intent.method, "intent-extraction/v1+openai/gpt-test");
  assert.ok(intent.inferences.some((i) => i.slot === "tradition" && i.value === "hasidic" && i.provenance === "stated"), "the deterministic reading stands");
  assert.ok(intent.inferences.some((i) => i.slot === "genre_word" && i.value === "ballad"));
  const warm = intent.inferences.find((i) => i.slot === "mood" && i.value === "warm");
  assert.ok(warm);
  assert.ok(warm!.confidence <= 0.85, "a model reading is capped below a stated one");
  assert.equal(intent.inferences.some((i) => i.value === "cinematic"), false, "no verbatim span → discarded");
  assert.equal(intent.constraints.length, 0, "a constraint without a verbatim statement is discarded");
  assert.equal(intent.references.length, 0, "a reference without a verbatim span is discarded");

  const failing = createOpenAiIntentModel({ client: async () => { throw new Error("network down"); } });
  const fallback = await extractUserIntent(text, { llm: failing, now: NOW });
  assert.equal(fallback.method, "intent-extraction/v1", "a failing model falls back to the deterministic extractor");
});
