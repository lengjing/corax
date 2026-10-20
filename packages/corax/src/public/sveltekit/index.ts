import { isAbsolute, resolve } from "node:path";

import type { Plugin, UserConfig } from "vite";

import { CORAX_ROUTE_PREFIX } from "#protocol/routes.js";

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

/**
 * Vite plugin for running an corax agent alongside a SvelteKit app.
 *
 * In development and local preview, `coraxSvelteKit` proxies corax protocol
 * endpoints to a local corax server. It resolves the server in order: the
 * `CORAX_BASE_URL` env var if set, then a healthy shared corax dev server already
 * running for the app, then a freshly spawned `corax dev --no-ui --port 0`.
 *
 * Production deployments run the corax app as its own service (`corax build`
 * + `corax start`) and route `/corax/v1/**` to it from the host.
 */
export function coraxSvelteKit(options: CoraxSvelteKitPluginOptions = {}): Plugin {
  let svelteKitRoot = process.cwd();
  let appRoot = resolveApplicationRoot(svelteKitRoot, options.coraxRoot);

  return {
    enforce: "post",
    name: "corax:sveltekit",
    async config(config, env) {
      svelteKitRoot =
        config.root === undefined ? process.cwd() : resolve(process.cwd(), config.root);
      appRoot = resolveApplicationRoot(svelteKitRoot, options.coraxRoot);

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
  };
}
