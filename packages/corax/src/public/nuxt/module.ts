import type { ChildProcess } from "node:child_process";
import { isAbsolute, resolve } from "node:path";

import { addImports, defineNuxtModule, extendRouteRules } from "@nuxt/kit";
import type { NuxtModule } from "@nuxt/schema";

import { CORAX_ROUTE_PREFIX } from "#protocol/routes.js";
import {
  resolveDevServerTimeout,
  resolveSharedCoraxDevServer,
  type CoraxFrameworkHost,
} from "#shared/framework-corax-server.js";

import { joinRoutePrefix, normalizeOrigin, resolveProductionTarget } from "./routing.js";

const CORAX_BASE_URL_ENV = "CORAX_BASE_URL";
const CORAX_NUXT_HOST: CoraxFrameworkHost = { label: "Nuxt", slug: "nuxt" };

/**
 * Options for the corax Nuxt module.
 */
export interface CoraxNuxtModuleOptions {
  /**
   * Maximum time in milliseconds to wait for the corax development server to
   * start, including waiting for another Nuxt process to start it. Defaults
   * to 180000 (three minutes).
   */
  devServerTimeoutMs?: number;
  /**
   * Path to the corax application root, resolved relative to the Nuxt project
   * root unless absolute. Defaults to the Nuxt project root. The dev server is
   * spawned here.
   */
  coraxRoot?: string;
}

function resolveApplicationRoot(nuxtRoot: string, appPath: string | undefined): string {
  if (appPath === undefined || appPath.length === 0) {
    return nuxtRoot;
  }
  return isAbsolute(appPath) ? appPath : resolve(nuxtRoot, appPath);
}

/**
 * Resolve the destination corax routes proxy to. In dev this is an explicit
 * `CORAX_BASE_URL` or a shared dev server spawned on demand; in production it
 * is a configured origin/port.
 *
 * When a dev server is spawned by this process, `onDevServerSpawned` is invoked
 * with the child handle so the caller can wire lifecycle-scoped cleanup.
 */
async function resolveCoraxProxyTarget(input: {
  readonly appRoot: string;
  readonly dev: boolean;
  readonly devServerTimeoutMs?: number;
  readonly onDevServerSpawned?: (child: ChildProcess) => void;
}): Promise<string> {
  if (!input.dev) {
    return resolveProductionTarget();
  }

  const configuredCoraxBaseUrl = process.env[CORAX_BASE_URL_ENV]?.trim();
  if (configuredCoraxBaseUrl && configuredCoraxBaseUrl.length > 0) {
    return joinRoutePrefix(normalizeOrigin(configuredCoraxBaseUrl), CORAX_ROUTE_PREFIX);
  }

  const handle = await resolveSharedCoraxDevServer({
    appRoot: input.appRoot,
    host: CORAX_NUXT_HOST,
    timeoutMs: input.devServerTimeoutMs,
  });
  if (handle.process !== undefined) {
    input.onDevServerSpawned?.(handle.process);
  }

  return joinRoutePrefix(handle.origin, CORAX_ROUTE_PREFIX);
}

/**
 * Nuxt module that wires a corax agent into a Nuxt app. Register under `modules`
 * (configured via the `corax` config key). It auto-imports the `useCoraxAgent()`
 * composable and routes corax transport requests (`/corax/v1/**`) to the corax
 * service: a shared dev server spawned on demand in dev and a configured
 * origin/port in production. Requires Nuxt >= 4.0.0. Configure via
 * {@link CoraxNuxtModuleOptions}.
 */
const coraxNuxtModule: NuxtModule<CoraxNuxtModuleOptions> = defineNuxtModule<CoraxNuxtModuleOptions>({
  meta: {
    name: "corax",
    configKey: "corax",
    compatibility: {
      nuxt: ">=4.0.0",
    },
  },
  defaults: {},
  async setup(options, nuxt) {
    const nuxtRoot = nuxt.options.rootDir;
    const appRoot = resolveApplicationRoot(nuxtRoot, options.coraxRoot);
    const devServerTimeoutMs = resolveDevServerTimeout(options.devServerTimeoutMs, CORAX_NUXT_HOST);

    // Auto-import the Vue composable so app code can call `useCoraxAgent()`
    // without an explicit import, matching Nuxt's composable conventions.
    addImports({ name: "useCoraxAgent", from: "corax/vue" });

    // Booting the shared corax dev server can take a while, so defer it out of
    // module setup. `modules:done` still runs before Nitro is configured, so
    // the proxy route rule is registered in time while other modules' setup
    // isn't blocked behind the spawn.
    nuxt.hook("modules:done", async () => {
      const proxyTarget = await resolveCoraxProxyTarget({
        appRoot,
        dev: nuxt.options.dev,
        devServerTimeoutMs,
        onDevServerSpawned: (child) => {
          // Prefer Nuxt's lifecycle for cleanup so the dev server is torn
          // down on graceful shutdown and dev restarts. The process-exit
          // guard in framework-corax-server.ts remains as a fallback for non-graceful
          // exits.
          nuxt.hook("close", () => {
            if (!child.killed) {
              child.kill();
            }
          });
        },
      });

      extendRouteRules(`${CORAX_ROUTE_PREFIX}/**`, {
        proxy: `${proxyTarget}/**`,
      });
    });
  },
});

export default coraxNuxtModule;
