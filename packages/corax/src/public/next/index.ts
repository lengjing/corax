import { resolve } from "node:path";

import type { NextConfig } from "next";

import { assertValidPublicAgentName } from "#internal/agent-name.js";
import { findCoraxProjectContext } from "#internal/project-context.js";
import { CORAX_ROUTE_PREFIX } from "#protocol/routes.js";
import { joinCoraxRoutePath } from "#shared/corax-route-path.js";
import { resolveDevServerTimeout } from "#shared/framework-corax-server.js";
import {
  CORAX_NEXT_HOST,
  ensureCoraxProductionServer,
  NEXT_PHASE_PRODUCTION_BUILD,
  NEXT_PHASE_PRODUCTION_SERVER,
  resolveCoraxDestinationPrefix,
} from "./server.js";

/**
 * Default private route namespace used when proxying to a separately hosted
 * corax service in production. {@link WithCoraxOptions.servicePrefix} defaults
 * to this value.
 */
export const CORAX_NEXT_SERVICE_PREFIX = "/_corax_internal/corax";

const CORAX_NEXT_PRODUCTION_ORIGIN_ENV = "CORAX_NEXT_PRODUCTION_ORIGIN";
const CORAX_NEXT_PRODUCTION_PORT_ENV = "CORAX_NEXT_PRODUCTION_PORT";
const DEFAULT_CORAX_NEXT_PRODUCTION_PORT = 4274;
const CORAX_NAMED_AGENT_ROUTE_PREFIX = "/corax";

type ArrayElement<T> = T extends readonly (infer TElement)[] ? TElement : never;
type NextRewrites = Awaited<ReturnType<NonNullable<NextConfig["rewrites"]>>>;

/**
 * Next.js rewrite rule that {@link withCorax} emits.
 */
export type CoraxNextRewriteRule = ArrayElement<NextRewrites>;

/**
 * Resolved return type of a Next.js `rewrites` function: an array of rules, or
 * the sectioned `{ beforeFiles, afterFiles, fallback }` object.
 */
export type CoraxNextRewrites = NextRewrites;

/**
 * Sectioned Next.js rewrite rules.
 */
export type CoraxNextRewriteSections = Extract<
  NextRewrites,
  {
    readonly afterFiles?: CoraxNextRewriteRule[];
    readonly beforeFiles?: CoraxNextRewriteRule[];
    readonly fallback?: CoraxNextRewriteRule[];
  }
>;

/**
 * Alias of Next.js's `NextConfig`, the config object form {@link withCorax}
 * accepts (the other being {@link CoraxNextConfigFunction}).
 */
export type CoraxNextConfig = NextConfig;

/**
 * Structural shape of a Next.js config function: receives the build `phase` and
 * a `context` containing `defaultConfig`, and returns a config (or a promise of
 * one). This is the form {@link withCorax} returns.
 */
export type CoraxNextConfigFunction<TConfig extends CoraxNextConfig = CoraxNextConfig> = (
  phase: string,
  context: {
    readonly defaultConfig: TConfig;
  },
) => TConfig | Promise<TConfig>;

/**
 * Next.js config input that {@link withCorax} accepts.
 */
export type CoraxNextConfigInput<TConfig extends CoraxNextConfig = CoraxNextConfig> =
  | CoraxNextConfigFunction<TConfig>
  | TConfig;

/**
 * Configuration for one named corax agent mounted by {@link withCorax}.
 */
export interface WithCoraxAgentOptions {
  /**
   * Path to the corax application root, relative to `process.cwd()` unless
   * absolute.
   */
  readonly root: string;
  /**
   * Private route namespace used when proxying to this agent's separately
   * hosted service in production.
   */
  readonly servicePrefix?: string;
}

/**
 * Map of agent names to roots or per-agent configuration.
 */
export type WithCoraxAgentsConfig = Record<string, string | WithCoraxAgentOptions>;

/**
 * Options for {@link withCorax}.
 */
export interface WithCoraxOptions {
  /**
   * Maximum time in milliseconds to wait for the corax development server to
   * start, including waiting for another Next.js process to start it. Defaults
   * to 180000 (three minutes).
   */
  readonly devServerTimeoutMs?: number;
  /**
   * Path to an corax project root, relative to the Next.js app root unless
   * absolute. The root may contain one `agent/` or an `agents/` workspace.
   * Defaults to the Next.js app root.
   */
  readonly coraxRoot?: string;
  /**
   * Named corax agents to mount under `/corax/<name>/v1/*`.
   *
   * Use this when one Next.js app needs to talk to multiple corax agents outside
   * a project-level `agents/` workspace. When unset, withCorax discovers a
   * workspace at the Next.js app root automatically. Do not combine with
   * {@link coraxRoot}; the single-agent form remains the shorthand for one
   * unnamed agent mounted at `/corax/v1/*`.
   */
  readonly agents?: WithCoraxAgentsConfig;
  /**
   * Private route namespace used when proxying to a separately hosted corax
   * service in production. Defaults to {@link CORAX_NEXT_SERVICE_PREFIX}
   * (`/_corax_internal/corax`). `withCorax` normalizes the prefix (adds a leading
   * slash, strips trailing slashes) and rejects a prefix that resolves to the
   * root route.
   */
  readonly servicePrefix?: string;
}

interface ResolvedCoraxNextAgent {
  readonly appRoot: string;
  readonly localProductionPortOffset: number;
  readonly name?: string;
  readonly publicRoutePrefix: string;
  readonly servicePrefix: string;
  readonly workspaceMember?: boolean;
}

function resolveApplicationRoot(appPath: string | undefined): string {
  if (appPath === undefined || appPath.length === 0) {
    return process.cwd();
  }

  return resolve(process.cwd(), appPath);
}

function normalizeRoutePrefix(prefix: string): string {
  const prefixed = prefix.startsWith("/") ? prefix : `/${prefix}`;
  const normalized = prefixed.replace(/\/+$/, "");

  if (normalized.length === 0) {
    throw new Error("corax Next.js service prefix cannot resolve to the root route.");
  }

  return normalized;
}

function joinRoutePrefix(prefix: string, path: string): string {
  return `${prefix.replace(/\/+$/, "")}/${path.replace(/^\/+/, "")}`;
}

function createNamedAgentRoutePrefix(name: string): string {
  return joinRoutePrefix(CORAX_NAMED_AGENT_ROUTE_PREFIX, name);
}

function createNamedAgentServicePrefix(basePrefix: string, name: string): string {
  return joinRoutePrefix(basePrefix, name);
}

function createAgentRewriteSource(publicRoutePrefix: string): string {
  return joinCoraxRoutePath(publicRoutePrefix, `${CORAX_ROUTE_PREFIX}/:path+`);
}

function normalizeOrigin(origin: string): string {
  return new URL(origin.trim()).origin;
}

function readLocalProductionPort(portOffset: number): number {
  const configuredPort = process.env[CORAX_NEXT_PRODUCTION_PORT_ENV];

  const basePort =
    configuredPort === undefined || configuredPort.trim().length === 0
      ? DEFAULT_CORAX_NEXT_PRODUCTION_PORT
      : Number.parseInt(configuredPort, 10);

  if (
    configuredPort !== undefined &&
    configuredPort.trim().length > 0 &&
    String(basePort) !== configuredPort.trim()
  ) {
    throw new Error(`${CORAX_NEXT_PRODUCTION_PORT_ENV} must be an integer between 1 and 65535.`);
  }

  const port = basePort + portOffset;
  if (port < 1 || port > 65_535) {
    throw new Error(`${CORAX_NEXT_PRODUCTION_PORT_ENV} plus the corax agent count exceeds 65535.`);
  }

  return port;
}

function resolveProductionDestination(input: {
  readonly localProductionPortOffset: number;
  readonly servicePrefix: string;
}): {
  readonly destinationPrefix: string;
  readonly localServerOrigin?: string;
} {
  const configuredOrigin = process.env[CORAX_NEXT_PRODUCTION_ORIGIN_ENV];

  if (configuredOrigin !== undefined && configuredOrigin.trim().length > 0) {
    return {
      destinationPrefix: joinRoutePrefix(normalizeOrigin(configuredOrigin), input.servicePrefix),
    };
  }

  const localServerOrigin = `http://127.0.0.1:${String(
    readLocalProductionPort(input.localProductionPortOffset),
  )}`;
  return {
    destinationPrefix: localServerOrigin,
    localServerOrigin,
  };
}

function createCoraxRewriteRule(input: {
  readonly destinationPrefix: string;
  readonly publicRoutePrefix: string;
}): CoraxNextRewriteRule {
  const source = createAgentRewriteSource(input.publicRoutePrefix);
  return {
    destination: joinRoutePrefix(input.destinationPrefix, `${CORAX_ROUTE_PREFIX}/:path+`),
    source,
  };
}

async function resolveExistingRewrites(
  rewrites: CoraxNextConfig["rewrites"],
): Promise<CoraxNextRewrites | undefined> {
  return await rewrites?.();
}

function mergeRewriteRules(
  existing: CoraxNextRewrites | undefined,
  coraxRules: CoraxNextRewriteRule[],
): CoraxNextRewrites {
  if (existing === undefined) {
    return {
      beforeFiles: coraxRules,
    };
  }

  if (!isRewriteSections(existing)) {
    return {
      afterFiles: existing,
      beforeFiles: coraxRules,
    };
  }

  return {
    ...existing,
    beforeFiles: [...coraxRules, ...(existing.beforeFiles ?? [])],
  };
}

function isRewriteSections(rewrites: CoraxNextRewrites): rewrites is CoraxNextRewriteSections {
  return !Array.isArray(rewrites);
}

async function resolveNextConfig<TConfig extends CoraxNextConfig>(
  configOrFunction: CoraxNextConfigInput<TConfig>,
  phase: string,
  context: {
    readonly defaultConfig: TConfig;
  },
): Promise<TConfig> {
  return typeof configOrFunction === "function"
    ? await configOrFunction(phase, context)
    : configOrFunction;
}

function assertValidAgentName(name: string): void {
  assertValidPublicAgentName(name, "corax Next.js agent name");
}

function assertValidWithCoraxOptions(options: WithCoraxOptions): void {
  if (options.coraxRoot !== undefined && options.agents !== undefined) {
    throw new Error("withCorax cannot combine coraxRoot with agents. Use one configuration form.");
  }
  if (options.agents === undefined) return;
  const agentNames = Object.keys(options.agents);
  if (agentNames.length === 0) {
    throw new Error("withCorax agents must contain at least one named corax agent.");
  }
  for (const name of agentNames) assertValidAgentName(name);
}

async function normalizeAgentsConfig(
  options: WithCoraxOptions,
): Promise<readonly ResolvedCoraxNextAgent[]> {
  const servicePrefixBase = normalizeRoutePrefix(options.servicePrefix ?? CORAX_NEXT_SERVICE_PREFIX);

  if (options.agents === undefined) {
    const coraxRoot = resolveApplicationRoot(options.coraxRoot);
    const context = await findCoraxProjectContext(coraxRoot);
    if (
      context?.kind === "workspace" &&
      context.workspace.root === coraxRoot &&
      context.workspace.members.length > 0
    ) {
      return context.workspace.members.map((member, index) => ({
        appRoot: member.appRoot,
        localProductionPortOffset: index,
        name: member.name,
        publicRoutePrefix: createNamedAgentRoutePrefix(member.name),
        servicePrefix: createNamedAgentServicePrefix(servicePrefixBase, member.name),
        workspaceMember: true,
      }));
    }

    const appRoot = coraxRoot;
    return [
      {
        appRoot,
        localProductionPortOffset: 0,
        publicRoutePrefix: "",
        servicePrefix: servicePrefixBase,
      },
    ];
  }

  const entries = Object.entries(options.agents);
  if (entries.length === 0) {
    throw new Error("withCorax agents must contain at least one named corax agent.");
  }

  return entries.map(([name, config], index) => {
    assertValidAgentName(name);

    const agentConfig = typeof config === "string" ? { root: config } : config;
    const appRoot = resolveApplicationRoot(agentConfig.root);

    return {
      appRoot,
      localProductionPortOffset: index,
      name,
      publicRoutePrefix: createNamedAgentRoutePrefix(name),
      servicePrefix: normalizeRoutePrefix(
        agentConfig.servicePrefix ?? createNamedAgentServicePrefix(servicePrefixBase, name),
      ),
    };
  });
}

async function buildAgentWorkspaceExtensions(
  agents: readonly ResolvedCoraxNextAgent[],
): Promise<void> {
  // Loaded lazily so development config loads skip the extension builder.
  const [{ buildWorkspaceExtensions }, { DiscoveryProjectResolutionError }] = await Promise.all([
    import("#internal/nitro/host/workspace-extensions.js"),
    import("#discover/project.js"),
  ]);
  // Agents can mount the same extension, so build them one at a time.
  for (const agent of agents) {
    try {
      await buildWorkspaceExtensions(agent.appRoot);
    } catch (error) {
      // The Next.js app can proxy to an agent built and deployed elsewhere.
      if (error instanceof DiscoveryProjectResolutionError) continue;
      throw error;
    }
  }
}

/**
 * Wraps a Next.js config so same-origin corax endpoints proxy to a separate corax
 * service.
 *
 * In development, starts `corax dev --no-ui --port 0` for the corax app and
 * rewrites corax protocol endpoints to that local URL. During `next build`,
 * builds each agent's mounted source-backed workspace extensions so the
 * Next.js type check can resolve them. In production, serves an existing `.output/server/index.mjs` build
 * on a stable local port when present; otherwise set `CORAX_NEXT_PRODUCTION_ORIGIN`
 * to the origin serving the corax service namespace.
 */
export function withCorax<TConfig extends CoraxNextConfig>(
  configOrFunction: CoraxNextConfigInput<TConfig>,
  options: WithCoraxOptions = {},
): CoraxNextConfigFunction<TConfig> {
  const devServerTimeoutMs = resolveDevServerTimeout(options.devServerTimeoutMs, CORAX_NEXT_HOST);
  assertValidWithCoraxOptions(options);
  return async function coraxNextConfig(phase, context) {
    const [agents, nextConfig] = await Promise.all([
      normalizeAgentsConfig(options),
      resolveNextConfig(configOrFunction, phase, context),
    ]);
    if (phase === NEXT_PHASE_PRODUCTION_BUILD) {
      await buildAgentWorkspaceExtensions(agents);
    }
    const existingRewrites = nextConfig.rewrites;
    const agentsWithDestinations = agents.map((agent) => {
      const productionDestination = resolveProductionDestination({
        localProductionPortOffset: agent.localProductionPortOffset,
        servicePrefix: agent.servicePrefix,
      });

      return {
        ...agent,
        productionDestination,
      };
    });
    if (phase === NEXT_PHASE_PRODUCTION_SERVER) {
      await Promise.all(
        agentsWithDestinations.map(async ({ appRoot, productionDestination }) => {
          if (productionDestination.localServerOrigin !== undefined) {
            await ensureCoraxProductionServer({
              appRoot,
              origin: productionDestination.localServerOrigin,
            });
          }
        }),
      );
    }

    return {
      ...nextConfig,
      async rewrites() {
        const [existing, coraxRules] = await Promise.all([
          resolveExistingRewrites(existingRewrites),
          Promise.all(
            agentsWithDestinations.map(async (agent) => {
              const destinationPrefix = await resolveCoraxDestinationPrefix({
                appRoot: agent.appRoot,
                devServerTimeoutMs,
                logLabel: agent.name,
                productionDestinationPrefix: agent.productionDestination.destinationPrefix,
                workspaceAgentName: agent.workspaceMember === true ? agent.name : undefined,
              });

              return createCoraxRewriteRule({
                destinationPrefix,
                publicRoutePrefix: agent.publicRoutePrefix,
              });
            }),
          ),
        ]);

        return mergeRewriteRules(existing, coraxRules);
      },
    };
  };
}
