import { afterEach, describe, expect, it, vi } from "vitest";
import type { ConfigEnv, Plugin, UserConfig } from "vite";

import { CORAX_ROUTE_PREFIX } from "#protocol/routes.js";
import { ensureCoraxVercelServicesConfig } from "#shared/vercel-services.js";

import { coraxSvelteKit } from "./index.js";
import { resolveSharedCoraxDevServer } from "./dev-server.js";

vi.mock("./dev-server.js", () => ({
  CORAX_BASE_URL_ENV: "CORAX_BASE_URL",
  resolveSharedCoraxDevServer: vi.fn(async () => ({ origin: "http://127.0.0.1:49152" })),
}));

vi.mock("#shared/vercel-services.js", () => ({
  ensureCoraxVercelServicesConfig: vi.fn(async () => ({ mode: "root" })),
  mergeCoraxVercelConfig: vi.fn(),
}));

const resolveSharedCoraxDevServerMock = vi.mocked(resolveSharedCoraxDevServer);
const ensureCoraxVercelServicesConfigMock = vi.mocked(ensureCoraxVercelServicesConfig);

type ConfigHook = (config: UserConfig, env: ConfigEnv) => unknown;

function getConfigHook(plugin: Plugin): ConfigHook {
  if (typeof plugin.config !== "function") {
    throw new Error("expected plugin config hook");
  }
  return plugin.config as ConfigHook;
}

afterEach(() => {
  vi.clearAllMocks();
  vi.unstubAllEnvs();
});

describe("coraxSvelteKit", () => {
  it("configures Vite dev server proxy to a shared corax server", async () => {
    const plugin = coraxSvelteKit();
    const result = (await getConfigHook(plugin)(
      {
        server: {
          proxy: {
            "/api": "http://127.0.0.1:3000",
          },
        },
      },
      { command: "serve", mode: "development" },
    )) as UserConfig;

    expect(resolveSharedCoraxDevServerMock).toHaveBeenCalledWith(process.cwd());
    expect(result).toEqual({
      server: {
        proxy: {
          "/api": "http://127.0.0.1:3000",
          [CORAX_ROUTE_PREFIX]: {
            changeOrigin: true,
            target: "http://127.0.0.1:49152",
          },
        },
      },
    });
  });

  it("configures Vite preview proxy and starts corax for local production preview", async () => {
    const plugin = coraxSvelteKit();
    const result = (await getConfigHook(plugin)(
      {
        preview: {
          proxy: {
            "/api": "http://127.0.0.1:3000",
          },
        },
      },
      { command: "serve", isPreview: true, mode: "production" },
    )) as UserConfig;

    expect(resolveSharedCoraxDevServerMock).toHaveBeenCalledWith(process.cwd());
    expect(result).toEqual({
      preview: {
        proxy: {
          "/api": "http://127.0.0.1:3000",
          [CORAX_ROUTE_PREFIX]: {
            changeOrigin: true,
            target: "http://127.0.0.1:49152",
          },
        },
      },
    });
  });

  it("prefers CORAX_BASE_URL over spawning a shared server", async () => {
    vi.stubEnv("CORAX_BASE_URL", "https://agent.example.com/root");
    const plugin = coraxSvelteKit();
    const result = (await getConfigHook(plugin)(
      {},
      { command: "serve", mode: "development" },
    )) as UserConfig;

    expect(resolveSharedCoraxDevServerMock).not.toHaveBeenCalled();
    expect(result.server?.proxy).toEqual({
      [CORAX_ROUTE_PREFIX]: {
        changeOrigin: true,
        target: "https://agent.example.com",
      },
    });
  });

  it("configures a generated Vercel service during Vercel production builds", async () => {
    vi.stubEnv("VERCEL", "1");
    const plugin = coraxSvelteKit({ coraxBuildCommand: "pnpm build:corax", coraxRoot: "agent" });

    await getConfigHook(plugin)({}, { command: "build", mode: "production" });

    expect(ensureCoraxVercelServicesConfigMock).toHaveBeenCalledWith({
      appRoot: expect.stringMatching(/agent$/),
      coraxBuildCommand: "pnpm build:corax",
      frameworkName: "SvelteKit",
      hostRoot: process.cwd(),
    });
  });
});
