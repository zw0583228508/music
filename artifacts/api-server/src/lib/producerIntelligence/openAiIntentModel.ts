/**
 * OpenAI-backed `IntentLanguageModel` (Wave U, PR-U2).
 *
 * The model reads the producer's text and returns structured intent JSON.
 * That is all it does: `extractUserIntent` validates every item against the
 * verbatim-span rule and never lets the model remove a deterministic reading;
 * nothing here writes notes, plans or briefs.
 *
 * Selection is explicit and off by default: `PRODUCER_LLM=openai` *and* the
 * workspace OpenAI integration env (`AI_INTEGRATIONS_OPENAI_BASE_URL` +
 * `AI_INTEGRATIONS_OPENAI_API_KEY`) must both be present. The integration
 * package throws at import when its env is missing, so it is imported lazily
 * and only after the env check.
 */
import type { IntentLanguageModel } from "./intentExtraction";

export const DEFAULT_PRODUCER_LLM_MODEL = "gpt-5.6-terra";

type EnvLike = Record<string, string | undefined>;

/** A minimal chat-completions client, so tests can inject a fake. */
export type IntentChatClient = {
  chat: {
    completions: {
      create(request: {
        model: string;
        max_completion_tokens: number;
        response_format: { type: "json_object" };
        messages: Array<{ role: "system" | "user"; content: string }>;
      }): Promise<{ choices: Array<{ message?: { content?: string | null } }> }>;
    };
  };
};

export type OpenAiIntentModelOptions = {
  model?: string;
  maxCompletionTokens?: number;
  /** Injected client (tests). Default: the workspace OpenAI integration, imported lazily. */
  client?: () => Promise<IntentChatClient>;
};

/** True when the integration env is complete. Says nothing about whether it is selected. */
export function openAiIntegrationConfigured(env: EnvLike = process.env): boolean {
  return Boolean(env.AI_INTEGRATIONS_OPENAI_BASE_URL && env.AI_INTEGRATIONS_OPENAI_API_KEY);
}

/** True only when the operator opted in *and* the integration is configured. */
export function openAiIntentModelSelected(env: EnvLike = process.env): boolean {
  return env.PRODUCER_LLM === "openai" && openAiIntegrationConfigured(env);
}

async function defaultClient(): Promise<IntentChatClient> {
  const { openai } = await import("@workspace/integrations-openai-ai-server");
  return openai as unknown as IntentChatClient;
}

export function createOpenAiIntentModel(options: OpenAiIntentModelOptions = {}): IntentLanguageModel {
  const model = options.model ?? process.env.PRODUCER_LLM_MODEL ?? DEFAULT_PRODUCER_LLM_MODEL;
  const maxCompletionTokens = options.maxCompletionTokens ?? 1_500;
  const client = options.client ?? defaultClient;
  return {
    id: `openai/${model}`,
    async complete({ instructions, text, schemaHint }) {
      const api = await client();
      const response = await api.chat.completions.create({
        model,
        max_completion_tokens: maxCompletionTokens,
        response_format: { type: "json_object" },
        messages: [
          {
            role: "system",
            content: [
              instructions,
              "Return exactly one JSON object with the keys inferences, constraints and references, shaped like:",
              schemaHint,
              "Quote evidence spans verbatim from the text, in the text's own language. Do not translate, do not paraphrase.",
              "You describe intent only; you never write notes, chords, or arrangement decisions.",
            ].join("\n"),
          },
          { role: "user", content: text },
        ],
      });
      const content = response.choices[0]?.message?.content;
      if (typeof content !== "string" || !content.trim()) return null;
      try {
        return JSON.parse(content) as unknown;
      } catch {
        return null;
      }
    },
  };
}

/**
 * The model to hand to `extractUserIntent`, or `undefined` for the
 * deterministic fallback (the default).
 */
export function selectIntentLanguageModel(
  env: EnvLike = process.env,
  options: OpenAiIntentModelOptions = {},
): IntentLanguageModel | undefined {
  if (!openAiIntentModelSelected(env)) return undefined;
  return createOpenAiIntentModel({ model: env.PRODUCER_LLM_MODEL, ...options });
}
