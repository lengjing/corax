import type { ChildProcess } from "node:child_process";
import { isAbsolute, resolve } from "node:path";

import type { Plugin, UserConfig } from "vite";

import { CORAX_ROUTE_PREFIX } from "#protocol/routes.js";
import {
  resolveDevServerTimeout,
  resolveSharedCoraxDevServer,
  type CoraxFrameworkHost,
} from "#shared/framework-corax-server.js";

const CORAX_BASE_URL_ENV = "CORAX_BASE_URL";
const CORAX_TANSTACK_HOST: CoraxFrameworkHost = { label: "TanStack Start", slug: "tanstack" };

/**
 * Dev servers this process spawned, keyed by corax app root. Module scope
 * survives Vite config restarts, which re-run `vite.config.ts` and reuse the
 * running server through the shared registry.
 */
const spawnedDevServers = new Map<string, ChildProcess>();

/**
 * Options for the corax TanStack Start Vite plugin.
 */
export interface CoraxTanStackPluginOptions {
  /**
   * Maximum time in milliseconds to wait for the corax development server to
   * start, including waiting for another TanStack Start process to start it.
   * Defaults to 180000 (three minutes).
   */
  readonly devServerTimeoutMs?: number;
  /**
   * Path to the corax application root, relative to the TanStack Start project
   * root unless absolute. Defaults to the TanStack Start project root.
   */
  readonly coraxRoot?: string;
}

/**
 * The slice of Nitro's `nitro` Vite config key this plugin writes. It is typed
 * locally so corax does not depend on Nitro's Vite type augmentation.
 */
type NitroUserConfig = UserConfig & {
  readonly nitro?: {
    readonly routeRules?: Record<string, { readonly proxy: string }>;
  };
};

/**
 * The slice of a Nitro module, and of the Nitro instance its `setup` receives,
 * that this plugin uses. Nitro's Vite plugin installs the `nitro` property of
 * any Vite plugin as a Nitro module.
 */
interface CoraxNitroModule {
  readonly name: string;
  setup(nitro: { readonly options: Record<string, unknown> }): Promise<void>;
}

function resolveApplicationRoot(hostRoot: string, appPath: string | undefined): string {
  if (appPath === undefined || appPath.length === 0) {
    return hostRoot;
  }
  return isAbsolute(appPath) ? appPath : resolve(hostRoot, appPath);
}

function parseCoraxBaseUrl(value: string): string {
  const url = URL.parse(value);
  if (url === null || (url.protocol !== "http:" && url.protocol !== "https:")) {
    throw new Error(
      `${CORAX_BASE_URL_ENV} must be an absolute http(s) URL such as http://127.0.0.1:2000, received "${value}".`,
    );
  }
  return url.origin;
}

async function resolveCoraxDevOrigin(
  appRoot: string,
  timeoutMs: number | undefined,
): Promise<string> {
  const configuredCoraxBaseUrl = process.env[CORAX_BASE_URL_ENV]?.trim();
  if (configuredCoraxBaseUrl && configuredCoraxBaseUrl.length > 0) {
    return parseCoraxBaseUrl(configuredCoraxBaseUrl);
  }

  const handle = await resolveSharedCoraxDevServer({ appRoot, host: CORAX_TANSTACK_HOST, timeoutMs });
  if (handle.process !== undefined) {
    spawnedDevServers.set(appRoot, handle.process);
  }
  return handle.origin;
}

function stopSpawnedDevServer(appRoot: string): void {
  const child = spawnedDevServers.get(appRoot);
  spawnedDevServers.delete(appRoot);
  if (child !== undefined && !child.killed) {
    child.kill();
  }
}

/**
 * Vite plugin for running an corax agent alongside a TanStack Start app.
 *
 * TanStack Start serves through Nitro, so the app must register `nitro()` from
 * `nitro/vite`; `coraxTanStack` configures Nitro to route corax.
 *
 * In development, Nitro proxies corax protocol endpoints to a local corax server.
 * It resolves the server in order: the `CORAX_BASE_URL` env var if set, then a
 * healthy shared corax dev server already running for the app, then a freshly
 * spawned `corax dev --no-ui --port 0`. A server spawned by the plugin stops
 * when the Vite dev server closes.
 *
 * Production deployments run the corax app as its own service (`corax build`
 * + `corax start`) and route `/corax/v1/**` to it from the host.
 */
export function coraxTanStack(options: CoraxTanStackPluginOptions = {}): Plugin {
  const devServerTimeoutMs = resolveDevServerTimeout(options.devServerTimeoutMs, CORAX_TANSTACK_HOST);
  let hostRoot = process.cwd();
  let appRoot = resolveApplicationRoot(hostRoot, options.coraxRoot);
  let isPreview = false;
  let nitroModuleInstalled = false;

  const plugin: Plugin & { readonly nitro: CoraxNitroModule } = {
    name: "corax:tanstack",
    enforce: "pre",
    nitro: {
      name: "corax",
      // Installing a Nitro module is how the plugin learns Nitro is present;
      // `configResolved` fails fast when it is not.
      async setup() {
        nitroModuleInstalled = true;
      },
    },
    async config(config, env): Promise<NitroUserConfig> {
      isPreview = env.isPreview === true;
      if (isPreview) {
        return {};
      }

      hostRoot = resolve(process.cwd(), config.root ?? ".");
      appRoot = resolveApplicationRoot(hostRoot, options.coraxRoot);

      if (env.command !== "serve") {
        return {};
      }

      const origin = await resolveCoraxDevOrigin(appRoot, devServerTimeoutMs);
      // Vite's own `server.proxy` never runs: Nitro answers dev requests
      // before Vite's proxy middleware. The rule stays on the config key
      // because Nitro has normalized route rules by the time modules run.
      return {
        nitro: {
          routeRules: {
            [`${CORAX_ROUTE_PREFIX}/**`]: { proxy: `${origin}${CORAX_ROUTE_PREFIX}/**` },
          },
        },
      };
    },
    configResolved() {
      // Nitro installs the `nitro` module above while resolving config.
      // Without Nitro the corax routes would silently 404.
      if (!isPreview && !nitroModuleInstalled) {
        throw new Error(
          'coraxTanStack() needs the Nitro Vite plugin. Install "nitro" and add nitro() from "nitro/vite" to the plugins in vite.config.ts.',
        );
      }
    },
    closeServer({ reason }) {
      if (reason === "close") {
        stopSpawnedDevServer(appRoot);
      }
    },
  };
  return plugin;
}
