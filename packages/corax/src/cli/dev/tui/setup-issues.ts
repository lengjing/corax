import type { AgentInfoResult } from "#client/index.js";
import { hasEnvValue, resolveGatewayCredential } from "#internal/resolve-model-endpoint-status.js";

/** One boot-time setup problem the TUI can point at a fixing command. */
export interface SetupIssue {
  /** Diagnostics never authorize a command by themselves. */
  kind: "attention";
  /** Short category label, e.g. "AI Gateway credentials". */
  label: string;
  /** The slash command that fixes it, e.g. "/model". */
  command: string;
}

/** What a boot detection may inspect. */
export interface BootDetectionContext {
  /** The local project the in-process dev server is running. */
  appRoot: string;
  /** `corax dev` loads the project env files before the TUI boots. */
  env: Record<string, string | undefined>;
  /** Best-effort agent truth from the header fetch; undefined when unavailable. */
  info?: AgentInfoResult;
}

/**
 * One installation-state check run at TUI boot, before the user hits the
 * failure mid-conversation. Detections must stay cheap and local (env reads,
 * a single fs stat) — they run between the header and the first prompt.
 */
export interface BootDetection {
  id: string;
  detect(context: BootDetectionContext): SetupIssue[] | Promise<SetupIssue[]>;
}

type ModelProviderAccess =
  | { kind: "unknown" }
  | { kind: "dynamic" }
  | { kind: "external" }
  | {
      kind: "gateway";
      runtime:
        | { status: "connected"; credential: "api-key" }
        | { status: "disconnected" }
        | { status: "unknown" };
    };

/**
 * Resolves the local TUI's current model-provider state into the agent-info
 * snapshot it caches. The local TUI and dev server share `process.env`, so a
 * loaded credential is usable even when an earlier `/info` response says
 * disconnected.
 */
export function normalizeLocalModelEndpoint(
  info: AgentInfoResult | undefined,
  env: Record<string, string | undefined>,
): AgentInfoResult | undefined {
  const access = modelProviderAccess({ env, info });
  if (info === undefined || access.kind !== "gateway" || access.runtime.status !== "connected") {
    return info;
  }
  const { credential } = access.runtime;

  const model = info.agent.model;
  if (model.id === undefined || model.routing.kind !== "gateway") return info;
  const endpoint = model.endpoint;
  if (endpoint?.kind === "gateway" && endpoint.connected && endpoint.credential === credential) {
    return info;
  }
  const connectedEndpoint = {
    connected: true as const,
    credential,
    kind: "gateway" as const,
  };

  return {
    ...info,
    agent: {
      ...info.agent,
      model: {
        contextWindowTokens: model.contextWindowTokens,
        endpoint: connectedEndpoint,
        id: model.id,
        providerOptions: model.providerOptions,
        reasoning: model.reasoning,
        routing: model.routing,
        source: model.source,
      },
    },
  };
}

/** Classifies only evidence the boot path can actually observe. */
function modelProviderAccess(
  context: Pick<BootDetectionContext, "env" | "info">,
): ModelProviderAccess {
  const model = context.info?.agent.model;
  if (model?.routing?.kind === "dynamic") return { kind: "dynamic" };
  if (model?.routing?.kind === "external") return { kind: "external" };
  if (model?.routing?.kind !== "gateway") return { kind: "unknown" };

  // The compiled routing decides whether gateway credentials apply. Local
  // ranking delegates to the one precedence authority; a freshly loaded key
  // outranks a stale server-reported endpoint snapshot.
  const selected = context.env.CORAX_MODEL_CONNECTION;
  const local = resolveGatewayCredential({
    apiKeyInEnv:
      (selected === undefined ||
        (selected === "ai-gateway-key" && context.env.CORAX_MODEL_KEY_SOURCE !== "secret")) &&
      hasEnvValue(context.env.AI_GATEWAY_API_KEY),
  });
  if (local?.credential === "api-key") {
    return { kind: "gateway", runtime: { status: "connected", credential: "api-key" } };
  }
  const endpoint = model.endpoint;
  if (endpoint?.kind === "gateway" && endpoint.connected) {
    return {
      kind: "gateway",
      runtime: { status: "connected", credential: endpoint.credential },
    };
  }
  if (endpoint?.kind === "gateway") return { kind: "gateway", runtime: { status: "disconnected" } };
  return { kind: "gateway", runtime: { status: "unknown" } };
}

/**
 * One diagnosis for the model-provider path. An external-provider model is
 * skipped entirely: it reaches the model with its own provider key, so gateway
 * credentials don't apply (and /model can't reconfigure it). For a gateway
 * model it reports only the missing credential. The header and detection
 * receive the same local-credential-normalized endpoint snapshot. A hint, not
 * an error: the model call stays the source of truth.
 */
const modelProvider: BootDetection = {
  id: "model-provider",
  detect({ env, info }) {
    const access = modelProviderAccess({ env, info });

    // Dynamic selectors can return any provider; their credentials cannot be
    // diagnosed until a model is selected at runtime.
    if (access.kind === "external" || access.kind === "dynamic") return [];
    if (access.kind !== "gateway" || access.runtime.status === "unknown") return [];
    if (access.runtime.status === "connected") return [];

    return [
      {
        kind: "attention",
        label: "AI Gateway credentials missing",
        command: "/login",
      },
    ];
  },
};

/** The built-in boot detections, run in order. */
export const BOOT_DETECTIONS: readonly BootDetection[] = [modelProvider];

/**
 * Runs the boot detections and aggregates their issues. Each detection is
 * individually guarded: one that throws contributes nothing and never blocks
 * the prompt.
 */
export async function detectSetupIssues(
  context: BootDetectionContext,
  detections: readonly BootDetection[] = BOOT_DETECTIONS,
): Promise<SetupIssue[]> {
  const results = await Promise.all(
    detections.map(async (detection) => {
      try {
        return await detection.detect(context);
      } catch {
        return [];
      }
    }),
  );
  return results.flat();
}

/** Places the auth issue before boot-time setup issues. */
export function orderedSetupIssues(
  bootIssues: readonly SetupIssue[],
  authIssue: SetupIssue | undefined,
): SetupIssue[] {
  return authIssue === undefined ? [...bootIssues] : [authIssue, ...bootIssues];
}

/**
 * The attention line's body, mirroring Claude Code's
 * `1 setup issue: MCP · /doctor` shape; the renderer prefixes the warning
 * glyph and paints the command blue.
 */
export function formatSetupIssuesLine(issues: readonly SetupIssue[]): string {
  const noun = issues.length === 1 ? "setup issue" : "setup issues";
  const entries = issues.map((issue) => `${issue.label} · ${issue.command}`).join(", ");
  return `${issues.length} ${noun}: ${entries}`;
}
