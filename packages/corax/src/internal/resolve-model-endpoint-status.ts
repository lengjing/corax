import type { ModelRouting } from "#shared/agent-definition.js";
import { isChatGptModelRouting } from "#shared/chatgpt-model.js";
import type { ChatGptEndpointState, ModelEndpointStatus } from "#shared/model-endpoint-status.js";

/**
 * Presence of the gateway credential, read from wherever the caller can
 * observe it: the running server's `process.env` (runtime-authoritative) or
 * an app's `.env` files (dev/setup-time). Only meaningful for gateway routing.
 */
export interface GatewayCredentialPresence {
  /** `AI_GATEWAY_API_KEY` is set. */
  readonly apiKey: boolean;
}

/** True when an environment value is present and non-blank. */
export function hasEnvValue(value: string | undefined): boolean {
  return value !== undefined && value.trim().length > 0;
}

/** Where a winning gateway API key was observed. */
export type GatewayCredentialSource = { kind: "env-file"; path: string } | { kind: "shell" };

/**
 * Everywhere the gateway credential can be observed. Callers fill in
 * whatever their vantage point can see (env files on disk, the process
 * environment) and the resolver ranks it.
 */
interface GatewayCredentialEvidence {
  /** `AI_GATEWAY_API_KEY` found in an app env file (the file's name). */
  readonly apiKeyFile?: string;
  /** `AI_GATEWAY_API_KEY` present in the process environment. */
  readonly apiKeyInEnv?: boolean;
}

export type GatewayCredentialResolution = {
  credential: "api-key";
  /** Where the winning key lives; a shell export is not corax's to remove. */
  source: GatewayCredentialSource;
};

/** Ranks Gateway credentials using runtime precedence. */
export function resolveGatewayCredential(
  evidence: GatewayCredentialEvidence,
): GatewayCredentialResolution | undefined {
  const source: GatewayCredentialSource | undefined =
    evidence.apiKeyFile !== undefined
      ? { kind: "env-file", path: evidence.apiKeyFile }
      : evidence.apiKeyInEnv === true
        ? { kind: "shell" }
        : undefined;

  if (source !== undefined) {
    return { credential: "api-key", source };
  }
  return undefined;
}

/**
 * Composes the build-time {@link ModelRouting} with runtime credential presence
 * into the consumer-facing {@link ModelEndpointStatus}.
 *
 * Credentials matter only for gateway routing; an external endpoint makes no
 * connectedness claim. Ranking delegates to {@link resolveGatewayCredential}.
 */
export function resolveModelEndpointStatus(
  routing: ModelRouting,
  credentials: GatewayCredentialPresence,
  chatgpt?: {
    readonly state: ChatGptEndpointState;
    readonly accountLabel?: string;
  },
): ModelEndpointStatus {
  if (routing.kind === "external") {
    if (isChatGptModelRouting(routing) && chatgpt !== undefined) {
      return { kind: "chatgpt", ...chatgpt };
    }
    return { kind: "external", provider: routing.provider };
  }
  const resolution = resolveGatewayCredential({
    apiKeyInEnv: credentials.apiKey,
  });
  if (resolution === undefined) {
    return { kind: "gateway", connected: false };
  }
  return { kind: "gateway", connected: true, credential: resolution.credential };
}
