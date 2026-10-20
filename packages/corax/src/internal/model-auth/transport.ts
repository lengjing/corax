import { createGateway, type LanguageModel } from "ai";
import { asFetch } from "#shared/fetch.js";
import { isCoraxDevEnvironment } from "#internal/application/dev-environment.js";
import { resolveModelApiKey } from "./api-key.js";
import {
  developmentModelBrokerAvailable,
  readDevelopmentModelCredential,
} from "./development-broker-client.js";
import { resolveGatewayModelCredential } from "./gateway-credential.js";
import { MODEL_CONNECTION_ENV } from "#shared/model-helper.js";

export { MODEL_CONNECTION_ENV } from "#shared/model-helper.js";
export { resolveModelApiKey } from "./api-key.js";

export function createDirectModelFetch(provider: "openai" | "anthropic"): typeof fetch {
  return asFetch(async (url, init) => {
    const headers = new Headers(init?.headers);
    const credential = await readDevelopmentModelCredential(provider, undefined, init?.signal);
    const key = credential?.token ?? (await resolveModelApiKey(provider));
    headers.set(
      provider === "openai" ? "authorization" : "x-api-key",
      provider === "openai" ? `Bearer ${key}` : key,
    );
    return fetch(url, { ...init, headers });
  });
}

function createLocalGateway(): ReturnType<typeof createGateway> | undefined {
  if (!isCoraxDevEnvironment()) return undefined;
  const selected = process.env[MODEL_CONNECTION_ENV];
  if (!developmentModelBrokerAvailable() && selected !== "ai-gateway-key") return undefined;
  const resolve = async (signal?: AbortSignal | null) =>
    (await readDevelopmentModelCredential("gateway", undefined, signal)) ??
    (await resolveGatewayModelCredential());
  return createGateway({
    apiKey: "corax-local-credential",
    fetch: asFetch(async (url, init) => {
      const headers = new Headers(init?.headers);
      const credential = await resolve(init?.signal);
      headers.set("authorization", `Bearer ${credential.token}`);
      return fetch(url, { ...init, headers });
    }),
  });
}

/** Resolve the connection for every request, including models constructed before /login. */
export function localGatewayModel(id: string): LanguageModel | undefined {
  return createLocalGateway()?.languageModel(id);
}

/** Resolve a decision model through the same local Gateway connection used by language models. */
export function localGatewayDecisionModel(
  id: string,
): ReturnType<ReturnType<typeof createGateway>["decisionModel"]> | undefined {
  return createLocalGateway()?.decisionModel(id);
}
