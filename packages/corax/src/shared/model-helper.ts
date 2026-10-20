export const MODEL_CONNECTION_ENV = "CORAX_MODEL_CONNECTION";

/** Connection selections that route bare model ids through the AI Gateway. */
export const GATEWAY_MODEL_CONNECTIONS = ["ai-gateway-key"] as const;

/**
 * Whether bare model id strings may be resolved through a default provider.
 *
 * The AI SDK resolves a bare string with `globalThis.AI_SDK_DEFAULT_PROVIDER ??
 * gateway`, which means the hosted AI Gateway unless the operator installed their
 * own default provider. Corax never contacts the gateway implicitly: the
 * operator must opt in through `CORAX_MODEL_CONNECTION`, `AI_GATEWAY_API_KEY`,
 * or by setting `AI_SDK_DEFAULT_PROVIDER` themselves.
 */
export function isGatewayModelRoutingEnabled(
  env: Record<string, string | undefined> = process.env,
): boolean {
  const selected = env[MODEL_CONNECTION_ENV];
  if ((GATEWAY_MODEL_CONNECTIONS as readonly string[]).includes(selected ?? "")) return true;
  if (env.AI_GATEWAY_API_KEY?.trim()) return true;
  return Reflect.get(globalThis, "AI_SDK_DEFAULT_PROVIDER") != null;
}

/** Error raised when a bare model id would be routed through AI Gateway without opt-in. */
export function bareModelIdRequiresGatewayError(modelId: string, location?: string): Error {
  return new Error(
    `${location ? `${location}: ` : ""}Model "${modelId}" is a bare model id, which the AI SDK routes through the AI Gateway. ` +
      "Corax does not use AI Gateway unless explicitly enabled. Pass a provider model instance instead " +
      '(for example createOpenAI({ baseURL }).chat("model")), or opt in with ' +
      `${MODEL_CONNECTION_ENV}=ai-gateway-key and AI_GATEWAY_API_KEY.`,
  );
}

/** Error raised when model limits would have to be fetched from the AI Gateway catalog without opt-in. */
export function modelLimitsRequireGatewayError(modelLabel: string, purpose?: string): Error {
  return new Error(
    `Cannot determine the context window for ${purpose ? `${purpose} ` : ""}"${modelLabel}" without contacting the AI Gateway model catalog, ` +
      "which Corax does not use unless explicitly enabled. Set modelContextWindowTokens on the agent " +
      `or model selection, or opt in with ${MODEL_CONNECTION_ENV}=ai-gateway-key and AI_GATEWAY_API_KEY.`,
  );
}
export const MODEL_HELPERS = {
  chatgpt: {
    module: "corax/models/openai",
    prefix: "chatgpt/",
    defaultModel: "gpt-6-luna-fast",
    provider: "codex",
  },
  openai: {
    module: "corax/models/openai",
    prefix: "openai-api/",
    defaultModel: "gpt-6-luna-fast",
    provider: "openai",
  },
  anthropic: {
    module: "corax/models/anthropic",
    prefix: "anthropic-api/",
    defaultModel: "claude-sonnet-5",
    provider: "anthropic",
  },
} as const;
export type ModelHelper = keyof typeof MODEL_HELPERS;
export function parseModelHelper(
  selection: string,
): { helper: ModelHelper; id: string } | undefined {
  for (const helper of Object.keys(MODEL_HELPERS) as ModelHelper[]) {
    const { prefix } = MODEL_HELPERS[helper];
    if (selection.startsWith(prefix)) {
      const id = selection.slice(prefix.length);
      if (id && id === id.trim() && !id.includes("/")) return { helper, id };
    }
  }
  return undefined;
}
