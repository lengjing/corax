import {
  resolveSharedCoraxDevServer,
  startCoraxProductionServer,
  type CoraxFrameworkHost,
  type CoraxProcessHandle,
} from "#shared/framework-corax-server.js";

const CORAX_BASE_URL_ENV = "CORAX_BASE_URL";
export const NEXT_PHASE_PRODUCTION_BUILD = "phase-production-build";
export const NEXT_PHASE_PRODUCTION_SERVER = "phase-production-server";
export const CORAX_NEXT_HOST: CoraxFrameworkHost = { label: "Next.js", slug: "next" };

interface CoraxNextGlobalState {
  readonly servers: Map<string, Promise<CoraxProcessHandle>>;
}

const globalStateSymbol = Symbol.for("corax.next.state");

function getGlobalState(): CoraxNextGlobalState {
  const globalWithState = globalThis as typeof globalThis & {
    [globalStateSymbol]?: CoraxNextGlobalState;
  };

  globalWithState[globalStateSymbol] ??= {
    servers: new Map(),
  };

  return globalWithState[globalStateSymbol];
}

function readCoraxBaseUrlEnvironment(): string | undefined {
  const configuredUrl = process.env[CORAX_BASE_URL_ENV];

  if (configuredUrl === undefined || configuredUrl.trim().length === 0) {
    return undefined;
  }

  return new URL(configuredUrl).origin;
}

/**
 * Start the built corax server for `appRoot` on `origin` once per process. Named
 * agents may share a root, each on its own port, so both identify the server.
 * `next start` calls this while loading config, because Next serves the
 * rewrites saved by `next build` and never calls `rewrites()` again.
 */
export async function ensureCoraxProductionServer(input: {
  readonly appRoot: string;
  readonly origin: string;
}): Promise<void> {
  const state = getGlobalState();
  const key = `production:${input.appRoot}:${input.origin}`;
  let server = state.servers.get(key);
  if (server === undefined) {
    server = startCoraxProductionServer({
      appRoot: input.appRoot,
      host: CORAX_NEXT_HOST,
      origin: input.origin,
    }).catch((error: unknown) => {
      state.servers.delete(key);
      throw error;
    });
    state.servers.set(key, server);
  }
  await server;
}

export async function resolveCoraxDestinationPrefix(input: {
  readonly appRoot: string;
  readonly devServerTimeoutMs?: number;
  readonly logLabel?: string;
  readonly productionDestinationPrefix: string;
  /** Workspace member selected when spawning the local corax dev server. */
  readonly workspaceAgentName?: string;
}): Promise<string> {
  if (process.env.NODE_ENV === "production") {
    return input.productionDestinationPrefix;
  }

  const configuredCoraxBaseUrl = readCoraxBaseUrlEnvironment();
  if (configuredCoraxBaseUrl !== undefined) {
    return configuredCoraxBaseUrl;
  }

  if (process.env.NODE_ENV !== "development") {
    return input.productionDestinationPrefix;
  }

  const state = getGlobalState();
  const key = `dev:${input.appRoot}`;
  let server = state.servers.get(key);

  if (server === undefined) {
    server = resolveSharedCoraxDevServer({
      appRoot: input.appRoot,
      host: CORAX_NEXT_HOST,
      logLabel: input.logLabel,
      timeoutMs: input.devServerTimeoutMs,
      workspaceAgentName: input.workspaceAgentName,
    }).catch((error) => {
      state.servers.delete(key);
      throw error;
    });
    state.servers.set(key, server);
  }

  return (await server).origin;
}
