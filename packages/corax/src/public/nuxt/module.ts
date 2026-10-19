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
import {
  ensureCoraxVercelServicesConfig,
  mergeCoraxVercelConfig,
  type VercelBuildConfig,
} from "#shared/vercel-services.js";

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
   * spawned here, and on Vercel it is the root the generated corax service
   * builds from.
   */
  coraxRoot?: string;
  /**
   * Command that builds the corax app inside the generated Vercel corax service.
   * Defaults to running the installed corax binary from the Nuxt app's
   * dependencies (`node <path-to>/corax/bin/corax.js build`).
   */
  coraxBuildCommand?: string;
}

function resolveApplicationRoot(nuxtRoot: string, appPath: string | undefined): string {
  if (appPath === undefined || appPath.length === 0) {
    return nuxtRoot;
  }
  return isAbsolute(appPath) ? appPath : resolve(nuxtRoot, appPath);
}

/**
 * Minimal view of the Nitro Vercel build-output config the module merges the
 * corax service into. The full `nitro` typing lives behind the nitropack/Nuxt
 * augmentation, which is not loaded in this package's build, so model only the
 * surface we touch.
 */
interface NitroVercelConfigHost {
  vercel?: {
    config?: VercelBuildConfig;
    [key: string]: unknown;
  };
}

/**
 * Resolve the destination corax routes proxy to. In dev this is an explicit
 * `CORAX_BASE_URL` or a shared dev server spawned on demand; in non-Vercel
 * production it is a configured origin/port.
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
 * Nuxt module that wires an corax agent into a Nuxt app. Register under `modules`
 * (configured via the `corax` config key). It auto-imports the `useCoraxAgent()`
 * composable and routes corax transport requests (`/corax/v1/**`) to the corax
 * service: a shared dev server spawned on demand in dev, a generated Vercel
 * service on Vercel deployments, and a configured origin/port in non-Vercel
 * production. Requires Nuxt >= 4.0.0. Configure via
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

    // On Vercel the corax app deploys as a sibling service. A Nitro runtime
    // `proxy` rule can't reach it — the proxied request loops back into the
    // Nuxt function and 404s — so declare the service and route corax transport
    // to it at the edge through the build output config, mirroring the Next.js
    // integration.
    if (!nuxt.options.dev && process.env.VERCEL) {
      const configured = await ensureCoraxVercelServicesConfig({
        appRoot,
        coraxBuildCommand: options.coraxBuildCommand,
        frameworkName: "Nuxt",
        hostRoot: nuxtRoot,
      });

      if (configured.mode === "generated") {
        const nitro = (nuxt.options as typeof nuxt.options & { nitro: NitroVercelConfigHost })
          .nitro;
        nitro.vercel = {
          ...nitro.vercel,
          config: mergeCoraxVercelConfig(nitro.vercel?.config, configured),
        };
      }
    } else {
      // Dev (and non-Vercel production, which proxies to an absolute origin):
      // booting the shared corax dev server can take a while, so defer it out of
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
    }
  },
});

export default coraxNuxtModule;
