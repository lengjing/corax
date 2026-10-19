import { readFile, writeFile } from "node:fs/promises";
import { isAbsolute, join, resolve } from "node:path";

import type { Plugin, ResolvedConfig, UserConfig } from "vite";

import { CORAX_ROUTE_PREFIX } from "#protocol/routes.js";
import {
  ensureCoraxVercelServicesConfig,
  mergeCoraxVercelConfig,
  type EnsureCoraxVercelServicesConfigResult,
  type VercelBuildConfig,
} from "#shared/vercel-services.js";

import { CORAX_BASE_URL_ENV, resolveSharedCoraxDevServer } from "./dev-server.js";
import { normalizeOrigin } from "./routing.js";

/**
 * Options for the corax SvelteKit Vite plugin.
 */
export interface CoraxSvelteKitPluginOptions {
  /**
   * Path to the corax application root, relative to the SvelteKit project root
   * unless absolute. Defaults to the SvelteKit project root.
   */
  readonly coraxRoot?: string;
  /**
   * Command that builds the corax app inside the generated Vercel corax service.
   * Defaults to running the installed corax binary from the SvelteKit app's
   * dependencies (`node <path-to>/corax/bin/corax.js build`).
   */
  readonly coraxBuildCommand?: string;
}

function resolveApplicationRoot(svelteKitRoot: string, appPath: string | undefined): string {
  if (appPath === undefined || appPath.length === 0) {
    return svelteKitRoot;
  }
  return isAbsolute(appPath) ? appPath : resolve(svelteKitRoot, appPath);
}

function mergeProxyConfig(
  existingProxy: NonNullable<UserConfig["server"]>["proxy"],
  coraxTarget: string,
): NonNullable<UserConfig["server"]>["proxy"] {
  return {
    ...existingProxy,
    [CORAX_ROUTE_PREFIX]: {
      changeOrigin: true,
      target: coraxTarget,
    },
  };
}

async function resolveCoraxDevProxyTarget(appRoot: string): Promise<string> {
  const configuredCoraxBaseUrl = process.env[CORAX_BASE_URL_ENV]?.trim();
  if (configuredCoraxBaseUrl && configuredCoraxBaseUrl.length > 0) {
    return normalizeOrigin(configuredCoraxBaseUrl);
  }

  return (await resolveSharedCoraxDevServer(appRoot)).origin;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

async function mergeGeneratedVercelServicesConfig(input: {
  readonly generated: Extract<EnsureCoraxVercelServicesConfigResult, { mode: "generated" }>;
  readonly outputConfigPath: string;
}): Promise<void> {
  let outputConfigContents: string;

  try {
    outputConfigContents = await readFile(input.outputConfigPath, "utf8");
  } catch (error) {
    if (error instanceof Error && "code" in error && error.code === "ENOENT") {
      return;
    }

    throw error;
  }

  const outputConfig: unknown = JSON.parse(outputConfigContents);

  if (!isRecord(outputConfig)) {
    throw new Error("Vercel Build Output config.json must contain a JSON object.");
  }

  const merged = mergeCoraxVercelConfig(outputConfig as VercelBuildConfig, input.generated);
  await writeFile(input.outputConfigPath, `${JSON.stringify(merged, null, 2)}\n`);
}

/**
 * Vite plugin for running an corax agent alongside a SvelteKit app.
 *
 * In development and local preview, `coraxSvelteKit` proxies corax protocol
 * endpoints to a local corax server. It resolves the server in order: the
 * `CORAX_BASE_URL` env var if set, then a healthy shared corax dev server already
 * running for the app, then a freshly spawned `corax dev --no-ui --port 0`.
 *
 * On Vercel builds, `coraxSvelteKit` adds the corax runtime as a sibling Vercel
 * service and routes its transport requests before SvelteKit filesystem
 * routing.
 */
export function coraxSvelteKit(options: CoraxSvelteKitPluginOptions = {}): Plugin {
  let svelteKitRoot = process.cwd();
  let appRoot = resolveApplicationRoot(svelteKitRoot, options.coraxRoot);
  let isSsrBuild = false;
  let generatedVercelServices:
    | Extract<EnsureCoraxVercelServicesConfigResult, { mode: "generated" }>
    | undefined;

  return {
    enforce: "post",
    name: "corax:sveltekit",
    async config(config, env) {
      svelteKitRoot =
        config.root === undefined ? process.cwd() : resolve(process.cwd(), config.root);
      appRoot = resolveApplicationRoot(svelteKitRoot, options.coraxRoot);

      if (env.command === "build" && process.env.VERCEL) {
        const configured = await ensureCoraxVercelServicesConfig({
          appRoot,
          coraxBuildCommand: options.coraxBuildCommand,
          frameworkName: "SvelteKit",
          hostRoot: svelteKitRoot,
        });

        generatedVercelServices = configured.mode === "generated" ? configured : undefined;
      }

      if (env.command !== "serve") {
        return {};
      }

      const proxyTarget = await resolveCoraxDevProxyTarget(appRoot);

      if (env.isPreview) {
        return {
          preview: {
            proxy: mergeProxyConfig(config.preview?.proxy, proxyTarget),
          },
        };
      }

      return {
        server: {
          proxy: mergeProxyConfig(config.server?.proxy, proxyTarget),
        },
      };
    },
    configResolved(config: ResolvedConfig) {
      isSsrBuild = Boolean(config.build.ssr);
      svelteKitRoot = config.root;
    },
    closeBundle: {
      sequential: true,
      async handler() {
        if (!isSsrBuild || generatedVercelServices === undefined) {
          return;
        }

        await mergeGeneratedVercelServicesConfig({
          generated: generatedVercelServices,
          outputConfigPath: join(svelteKitRoot, ".vercel", "output", "config.json"),
        });
      },
    },
  };
}
