import { MODEL_CONNECTION_ENV } from "#shared/model-helper.js";
import { resolveModelApiKey } from "./api-key.js";
import type { DevelopmentModelCredential } from "./development-broker-protocol.js";

/**
 * Resolves the AI Gateway credential. Only an explicit API key is supported:
 * either the `ai-gateway-key` connection saved by /login, or a plain
 * `AI_GATEWAY_API_KEY` environment variable.
 */
export async function resolveGatewayModelCredential(): Promise<DevelopmentModelCredential> {
  const selected = process.env[MODEL_CONNECTION_ENV];
  if (selected === "ai-gateway-key")
    return { kind: "api-key", token: await resolveModelApiKey("ai-gateway-key") };
  if (process.env.AI_GATEWAY_API_KEY?.trim())
    return { kind: "api-key", token: process.env.AI_GATEWAY_API_KEY };
  throw new Error(
    `AI Gateway credentials are not configured. Set ${MODEL_CONNECTION_ENV}=ai-gateway-key with AI_GATEWAY_API_KEY, or use a provider model instance instead of a bare model id.`,
  );
}
