import { ChildProcess } from "node:child_process";

import { afterEach, describe, expect, it, vi } from "vitest";
import type { ConfigEnv, Plugin, UserConfig } from "vite";

import { CORAX_ROUTE_PREFIX } from "#protocol/routes.js";
import { resolveSharedCoraxDevServer } from "#shared/framework-corax-server.js";
import {
  ensureCoraxVercelServicesConfig,
  mergeCoraxVercelConfig,
  type VercelBuildConfig,
} from "#shared/vercel-services.js";

import { coraxTanStack } from "./index.js";

vi.mock("#shared/framework-corax-server.js", async (importOriginal) => ({
  ...(await importOriginal<typeof import("#shared/framework-corax-server.js")>()),
  resolveSharedCoraxDevServer: vi.fn(async () => ({ origin: "http://127.0.0.1:49152" })),
}));

vi.mock("#shared/vercel-services.js", () => ({
  ensureCoraxVercelServicesConfig: vi.fn(async () => ({ mode: "root" })),
  mergeCoraxVercelConfig: vi.fn(() => ({ routes: [], services: {}, version: 3 })),
}));

const resolveSharedCoraxDevServerMock = vi.mocked(resolveSharedCoraxDevServer);
const ensureCoraxVercelServicesConfigMock = vi.mocked(ensureCoraxVercelServicesConfig);
const mergeCoraxVercelConfigMock = vi.mocked(mergeCoraxVercelConfig);

type ConfigHook = (config: UserConfig, env: ConfigEnv) => Promise<unknown>;
type NitroOptions = { vercel?: { config?: VercelBuildConfig; [key: string]: unknown } };
type CoraxTanStackPlugin = Plugin & {
  nitro: { setup(nitro: { options: NitroOptions }): Promise<void> };
};

const serveEnv: ConfigEnv = { command: "serve", mode: "development" };
const buildEnv: ConfigEnv = { command: "build", mode: "production" };

function getConfigHook(plugin: Plugin): ConfigHook {
  if (typeof plugin.config !== "function") {
    throw new Error("expected plugin config hook");
  }
  return plugin.config as ConfigHook;
}

function callConfigResolved(plugin: Plugin): void {
  (plugin.configResolved as () => void)();
}

function callCloseServer(plugin: Plugin, reason: "close" | "restart"): void {
  (plugin.closeServer as (context: { reason: string }) => void)({ reason });
}

afterEach(() => {
  vi.clearAllMocks();
  vi.unstubAllEnvs();
});

describe("coraxTanStack", () => {
  it("proxies corax routes through Nitro to a shared corax dev server", async () => {
    const result = await getConfigHook(coraxTanStack())({}, serveEnv);

    expect(resolveSharedCoraxDevServerMock).toHaveBeenCalledWith({
      appRoot: process.cwd(),
      host: { label: "TanStack Start", slug: "tanstack" },
    });
    expect(result).toEqual({
      nitro: {
        routeRules: {
          [`${CORAX_ROUTE_PREFIX}/**`]: { proxy: `http://127.0.0.1:49152${CORAX_ROUTE_PREFIX}/**` },
        },
      },
    });
  });

  it("prefers CORAX_BASE_URL over spawning a shared server", async () => {
    vi.stubEnv("CORAX_BASE_URL", "https://agent.example.com/root");

    const result = await getConfigHook(coraxTanStack())({}, serveEnv);

    expect(resolveSharedCoraxDevServerMock).not.toHaveBeenCalled();
    expect(result).toEqual({
      nitro: {
        routeRules: {
          [`${CORAX_ROUTE_PREFIX}/**`]: {
            proxy: `https://agent.example.com${CORAX_ROUTE_PREFIX}/**`,
          },
        },
      },
    });
  });

  it("names CORAX_BASE_URL when it is not an absolute URL", async () => {
    vi.stubEnv("CORAX_BASE_URL", "localhost:2000");

    await expect(getConfigHook(coraxTanStack())({}, serveEnv)).rejects.toThrow(
      /CORAX_BASE_URL must be an absolute http\(s\) URL/,
    );
    expect(resolveSharedCoraxDevServerMock).not.toHaveBeenCalled();
  });

  it("resolves coraxRoot against the Vite root", async () => {
    await getConfigHook(coraxTanStack({ coraxRoot: "agent" }))({ root: "/projects/web" }, serveEnv);

    expect(resolveSharedCoraxDevServerMock).toHaveBeenCalledWith(
      expect.objectContaining({ appRoot: "/projects/web/agent" }),
    );
  });

  it("passes devServerTimeoutMs to the shared corax dev server", async () => {
    await getConfigHook(coraxTanStack({ devServerTimeoutMs: 5000 }))({}, serveEnv);

    expect(resolveSharedCoraxDevServerMock).toHaveBeenCalledWith(
      expect.objectContaining({ timeoutMs: 5000 }),
    );
  });

  it("rejects a non-positive devServerTimeoutMs", () => {
    expect(() => coraxTanStack({ devServerTimeoutMs: 0 })).toThrow(
      /TanStack Start development server timeout must be a positive number/,
    );
  });

  it("stops a dev server it spawned when Vite closes, but not when Vite restarts", async () => {
    const child = new ChildProcess();
    const kill = vi.spyOn(child, "kill").mockReturnValue(true);
    resolveSharedCoraxDevServerMock.mockResolvedValueOnce({
      origin: "http://127.0.0.1:49152",
      process: child,
    });
    const plugin = coraxTanStack();
    await getConfigHook(plugin)({ root: "/projects/spawned" }, serveEnv);

    callCloseServer(plugin, "restart");
    expect(kill).not.toHaveBeenCalled();

    // Vite re-runs vite.config.ts on restart; the new plugin instance reuses
    // the registered server and owns its shutdown.
    const restarted = coraxTanStack();
    await getConfigHook(restarted)({ root: "/projects/spawned" }, serveEnv);
    callCloseServer(restarted, "close");
    expect(kill).toHaveBeenCalledOnce();
  });

  it("does not start corax for local production preview", async () => {
    const plugin = coraxTanStack();
    const result = await getConfigHook(plugin)(
      {},
      { command: "serve", isPreview: true, mode: "production" },
    );

    expect(resolveSharedCoraxDevServerMock).not.toHaveBeenCalled();
    expect(result).toEqual({});
    expect(() => callConfigResolved(plugin)).not.toThrow();
  });

  it("adds no Nitro config for builds", async () => {
    vi.stubEnv("VERCEL", "1");

    const result = await getConfigHook(coraxTanStack())({}, buildEnv);

    expect(result).toEqual({});
  });

  it("leaves Nitro's Vercel config alone outside Vercel builds", async () => {
    const plugin = coraxTanStack() as CoraxTanStackPlugin;
    await getConfigHook(plugin)({}, buildEnv);
    const options: NitroOptions = {};

    await plugin.nitro.setup({ options });

    expect(ensureCoraxVercelServicesConfigMock).not.toHaveBeenCalled();
    expect(options).toEqual({});
  });

  it("merges the generated corax service into the user's resolved Nitro Vercel config", async () => {
    vi.stubEnv("VERCEL", "1");
    const generated = { mode: "generated", services: {} } as const;
    ensureCoraxVercelServicesConfigMock.mockResolvedValueOnce(generated);
    const plugin = coraxTanStack({
      coraxBuildCommand: "pnpm build:corax",
      coraxRoot: "agent",
    }) as CoraxTanStackPlugin;
    await getConfigHook(plugin)({ root: "/projects/web" }, buildEnv);
    const userConfig: VercelBuildConfig = { routes: [{ src: "/(.*)", dest: "/" }] };
    const options: NitroOptions = { vercel: { config: userConfig, functions: {} } };

    await plugin.nitro.setup({ options });

    expect(ensureCoraxVercelServicesConfigMock).toHaveBeenCalledWith({
      appRoot: "/projects/web/agent",
      coraxBuildCommand: "pnpm build:corax",
      frameworkName: "TanStack Start",
      hostRoot: "/projects/web",
    });
    expect(mergeCoraxVercelConfigMock).toHaveBeenCalledWith(userConfig, generated);
    expect(options.vercel).toEqual({
      config: { routes: [], services: {}, version: 3 },
      functions: {},
    });
  });

  it("leaves routing to the user's services config when vercel.json declares services", async () => {
    vi.stubEnv("VERCEL", "1");
    const plugin = coraxTanStack() as CoraxTanStackPlugin;
    await getConfigHook(plugin)({}, buildEnv);
    const options: NitroOptions = {};

    await plugin.nitro.setup({ options });

    expect(mergeCoraxVercelConfigMock).not.toHaveBeenCalled();
    expect(options).toEqual({});
  });

  it("fails fast when the Nitro Vite plugin did not install its module", async () => {
    const plugin = coraxTanStack() as CoraxTanStackPlugin;
    await getConfigHook(plugin)({}, buildEnv);

    expect(() => callConfigResolved(plugin)).toThrow(/nitro\(\) from "nitro\/vite"/);

    await plugin.nitro.setup({ options: {} });
    expect(() => callConfigResolved(plugin)).not.toThrow();
  });
});
