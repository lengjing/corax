import { EventEmitter } from "node:events";
import { mkdir, mkdtemp, readFile, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("#shared/resolve-corax-binary.js", async () => {
  const { join } = await import("node:path");
  return {
    // Pin resolution to the conventional app-local path so build-command
    // assertions stay deterministic without a real corax install on disk. The
    // real resolver is exercised in resolve-corax-binary.integration.test.ts.
    resolveCoraxBinaryPath: (nextRoot: string) =>
      join(nextRoot, "node_modules", "corax", "bin", "corax.js"),
  };
});

interface SpawnOptions {
  readonly cwd: string;
  readonly env: Record<string, string | undefined>;
}

const spawnMock = vi.hoisted(() =>
  vi.fn<(command: string, args: readonly string[], options: SpawnOptions) => EventEmitter>(),
);

vi.mock("node:child_process", () => ({
  spawn: spawnMock,
}));

import { withCorax, type CoraxNextConfig, type CoraxNextRewriteSections } from "./index.js";

interface TestConfig extends CoraxNextConfig {
  readonly basePath?: string;
}

async function createTempAppRoot(): Promise<string> {
  return await mkdtemp(join(tmpdir(), "corax-next-config-"));
}

async function readJsonFile(path: string): Promise<unknown> {
  return JSON.parse(await readFile(path, "utf8")) as unknown;
}

async function resolveConfig(config: ReturnType<typeof withCorax<TestConfig>>): Promise<TestConfig> {
  return await config("phase-test", {
    defaultConfig: {},
  });
}

describe("withCorax Vercel config", () => {
  const originalCwd = process.cwd();

  afterEach(() => {
    spawnMock.mockReset();
    process.chdir(originalCwd);
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
  });

  it("requires a local corax build when next start loads config outside Vercel", async () => {
    const appRoot = await createTempAppRoot();
    process.chdir(appRoot);
    vi.stubEnv("NODE_ENV", "production");

    await expect(
      withCorax<TestConfig>({})("phase-production-server", { defaultConfig: {} }),
    ).rejects.toThrow(/Run corax build from .+ before starting Next\.js\./u);
    expect(spawnMock).not.toHaveBeenCalled();
    await expect(
      readFile(join(appRoot, ".vercel", "output", "config.json"), "utf8"),
    ).rejects.toThrow();
  });

  it("starts each managed agent once when next start loads config, without rewrites()", async () => {
    const appRoot = await createTempAppRoot();
    process.chdir(appRoot);
    const resolvedAppRoot = process.cwd();
    vi.stubEnv("NODE_ENV", "production");
    await writeBuiltAgent(join(resolvedAppRoot, "agents", "billing"));
    await writeBuiltAgent(join(resolvedAppRoot, "agents", "support"));
    spawnListeningServer();
    const config = withCorax<TestConfig>(
      {},
      { agents: { billing: "./agents/billing", support: "./agents/support" } },
    );

    await config("phase-production-server", { defaultConfig: {} });
    expect(spawnedServers()).toEqual([
      { cwd: join(resolvedAppRoot, "agents", "billing"), port: "4274" },
      { cwd: join(resolvedAppRoot, "agents", "support"), port: "4275" },
    ]);

    const reloaded = await config("phase-production-server", { defaultConfig: {} });
    const rewrites = await reloaded.rewrites?.();

    expect(spawnMock).toHaveBeenCalledTimes(2);
    expect(getBeforeFiles(rewrites)).toEqual([
      { destination: "http://127.0.0.1:4274/corax/v1/:path+", source: "/corax/billing/v1/:path+" },
      { destination: "http://127.0.0.1:4275/corax/v1/:path+", source: "/corax/support/v1/:path+" },
    ]);
  });

  it("starts one managed server per port when named agents share a root", async () => {
    const appRoot = await createTempAppRoot();
    process.chdir(appRoot);
    const sharedRoot = join(process.cwd(), "agents", "shared");
    vi.stubEnv("NODE_ENV", "production");
    await writeBuiltAgent(sharedRoot);
    spawnListeningServer();
    const config = withCorax<TestConfig>(
      {},
      { agents: { billing: "./agents/shared", support: "./agents/shared" } },
    );

    await config("phase-production-server", { defaultConfig: {} });
    const reloaded = await config("phase-production-server", { defaultConfig: {} });
    const rewrites = await reloaded.rewrites?.();

    expect(spawnedServers()).toEqual([
      { cwd: sharedRoot, port: "4274" },
      { cwd: sharedRoot, port: "4275" },
    ]);
    expect(getBeforeFiles(rewrites)).toEqual([
      { destination: "http://127.0.0.1:4274/corax/v1/:path+", source: "/corax/billing/v1/:path+" },
      { destination: "http://127.0.0.1:4275/corax/v1/:path+", source: "/corax/support/v1/:path+" },
    ]);
  });

  it("does not start a managed agent on Vercel, for a hosted origin, or while building", async () => {
    const appRoot = await createTempAppRoot();
    process.chdir(appRoot);
    vi.stubEnv("NODE_ENV", "production");
    await writeBuiltAgent(process.cwd());
    spawnListeningServer();

    await withCorax<TestConfig>({})("phase-production-build", { defaultConfig: {} });
    vi.stubEnv("CORAX_NEXT_PRODUCTION_ORIGIN", "https://agent.example.com");
    await withCorax<TestConfig>({})("phase-production-server", { defaultConfig: {} });
    vi.stubEnv("CORAX_NEXT_PRODUCTION_ORIGIN", "");
    vi.stubEnv("VERCEL", "1");
    vi.stubEnv("VERCEL_URL", "preview.example.com");
    await withCorax<TestConfig>({})("phase-production-server", { defaultConfig: {} });

    expect(spawnMock).not.toHaveBeenCalled();
  });

  it("writes Build Output config in Vercel even when no linked project is detected", async () => {
    const appRoot = await createTempAppRoot();
    process.chdir(appRoot);
    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv("VERCEL", "1");
    vi.stubEnv("VERCEL_URL", "preview.example.com");

    const config = await resolveConfig(withCorax<TestConfig>({}));
    const rewrites = await config.rewrites?.();
    const outputConfig = await readJsonFile(join(appRoot, ".vercel", "output", "config.json"));

    expect(outputConfig).toEqual({
      routes: [
        {
          destination: {
            service: "corax",
            type: "service",
          },
          src: "^/corax/v1/(.*)$",
        },
      ],
      services: {
        corax: {
          buildCommand:
            "cd '../../..' && export CORAX_INTERNAL_BUILD_OUTPUT_DIRECTORY='.corax/vercel-services/corax/.vercel/output' && export CORAX_INTERNAL_HOST_BUILD_OUTPUT_DIRECTORY='.vercel/output' && node 'node_modules/corax/bin/corax.js' build",
          framework: "corax",
          outputDirectory: ".vercel/output",
          routes: [
            {
              src: "^/corax/v1/(.*)$",
              transforms: [
                {
                  args: "/corax/v1/$1",
                  op: "set",
                  type: "request.path",
                },
              ],
            },
          ],
          root: ".corax/vercel-services/corax",
        },
      },
      version: 3,
    });
    expect(rewrites).toBeUndefined();
  });

  it("isolates a colocated generated corax service from the Next.js Build Output", async () => {
    const appRoot = await createTempAppRoot();
    process.chdir(appRoot);
    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv("VERCEL", "1");
    vi.stubEnv("VERCEL_URL", "preview.example.com");

    await resolveConfig(withCorax<TestConfig>({}));

    const serviceRoot = join(appRoot, ".corax", "vercel-services", "corax");
    const outputConfig = await readJsonFile(join(appRoot, ".vercel", "output", "config.json"));

    expect((await stat(serviceRoot)).isDirectory()).toBe(true);
    expect(outputConfig).toMatchObject({
      services: {
        corax: {
          buildCommand:
            "cd '../../..' && export CORAX_INTERNAL_BUILD_OUTPUT_DIRECTORY='.corax/vercel-services/corax/.vercel/output' && export CORAX_INTERNAL_HOST_BUILD_OUTPUT_DIRECTORY='.vercel/output' && node 'node_modules/corax/bin/corax.js' build",
          root: ".corax/vercel-services/corax",
        },
      },
    });
  });

  it("writes fallback Build Output config under the app in a linked monorepo", async () => {
    const projectRoot = await createTempAppRoot();
    const appRoot = join(projectRoot, "apps", "web");
    await mkdir(join(projectRoot, ".vercel"), { recursive: true });
    await writeFile(
      join(projectRoot, ".vercel", "project.json"),
      JSON.stringify({ settings: { rootDirectory: "apps/web" } }),
    );
    await mkdir(join(projectRoot, "custom-staging"));
    await writeFile(join(projectRoot, "custom-staging", "builds.json"), "{}\n");
    await mkdir(appRoot, { recursive: true });
    process.chdir(appRoot);
    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv("VERCEL", "1");
    vi.stubEnv("VERCEL_URL", "preview.example.com");

    await resolveConfig(withCorax<TestConfig>({}));

    const outputConfig = await readJsonFile(join(appRoot, ".vercel", "output", "config.json"));

    expect(outputConfig).toEqual({
      routes: [
        {
          destination: {
            service: "corax",
            type: "service",
          },
          src: "^/corax/v1/(.*)$",
        },
      ],
      services: {
        corax: {
          buildCommand:
            "cd '../../..' && export CORAX_INTERNAL_BUILD_OUTPUT_DIRECTORY='.corax/vercel-services/corax/.vercel/output' && export CORAX_INTERNAL_HOST_BUILD_OUTPUT_DIRECTORY='.vercel/output' && node 'node_modules/corax/bin/corax.js' build",
          framework: "corax",
          outputDirectory: ".vercel/output",
          routes: [
            {
              src: "^/corax/v1/(.*)$",
              transforms: [
                {
                  args: "/corax/v1/$1",
                  op: "set",
                  type: "request.path",
                },
              ],
            },
          ],
          root: ".corax/vercel-services/corax",
        },
      },
      version: 3,
    });
    await expect(
      readFile(join(projectRoot, ".vercel", "output", "config.json"), "utf8"),
    ).rejects.toThrow();
  });

  it("uses an already configured root corax service", async () => {
    const appRoot = await createTempAppRoot();
    process.chdir(appRoot);
    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv("VERCEL", "1");
    vi.stubEnv("VERCEL_URL", "preview.example.com");
    await writeFile(
      join(appRoot, "vercel.json"),
      `${JSON.stringify(
        {
          $schema: "https://openapi.vercel.sh/vercel.json",
          services: {
            agent: {
              entrypoint: "package.json",
              framework: "corax",
              root: "agent",
            },
          },
        },
        null,
        2,
      )}\n`,
    );

    const config = await resolveConfig(withCorax<TestConfig>({}));
    const rewrites = await config.rewrites?.();

    await expect(
      readFile(join(appRoot, ".vercel", "output", "config.json"), "utf8"),
    ).rejects.toThrow();
    expect(rewrites).toBeUndefined();
  });

  it("preserves an already configured Build Output corax service and inserts its route", async () => {
    const appRoot = await createTempAppRoot();
    process.chdir(appRoot);
    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv("VERCEL", "1");
    vi.stubEnv("VERCEL_URL", "preview.example.com");
    await mkdir(join(appRoot, ".vercel", "output"), { recursive: true });
    await writeFile(join(appRoot, ".vercel", "project.json"), "{}\n");
    await writeFile(
      join(appRoot, ".vercel", "output", "config.json"),
      `${JSON.stringify(
        {
          version: 3,
          routes: [
            { handle: "filesystem" },
            {
              destination: {
                service: "agent",
                type: "service",
              },
              src: "^/corax/v1/(.*)$",
            },
          ],
          services: {
            agent: {
              entrypoint: "package.json",
              framework: "corax",
              root: "agent",
            },
          },
        },
        null,
        2,
      )}\n`,
    );

    const config = await resolveConfig(withCorax<TestConfig>({}));
    const rewrites = await config.rewrites?.();
    const outputConfig = await readJsonFile(join(appRoot, ".vercel", "output", "config.json"));

    expect(outputConfig).toEqual({
      routes: [
        {
          destination: {
            service: "agent",
            type: "service",
          },
          src: "^/corax/v1/(.*)$",
        },
        { handle: "filesystem" },
      ],
      services: {
        agent: {
          entrypoint: "package.json",
          framework: "corax",
          routes: [
            {
              src: "^/corax/v1/(.*)$",
              transforms: [
                {
                  args: "/corax/v1/$1",
                  op: "set",
                  type: "request.path",
                },
              ],
            },
          ],
          root: "agent",
        },
      },
      version: 3,
    });
    expect(rewrites).toBeUndefined();
  });

  it("discovers workspace agents when the Next.js app owns the workspace", async () => {
    const appRoot = await createTempAppRoot();
    process.chdir(appRoot);
    await Promise.all([
      mkdir(join(appRoot, "agents", "support", "agent"), { recursive: true }),
      mkdir(join(appRoot, "agents", "research", "agent"), { recursive: true }),
      writeFile(join(appRoot, "package.json"), JSON.stringify({ dependencies: { corax: "*" } })),
    ]);
    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv("VERCEL", "1");
    vi.stubEnv("VERCEL_URL", "preview.example.com");

    const config = await resolveConfig(withCorax<TestConfig>({}));
    const rewrites = await config.rewrites?.();
    const outputConfig = await readJsonFile(join(appRoot, ".vercel", "output", "config.json"));

    expect(outputConfig).toMatchObject({
      routes: expect.arrayContaining([
        expect.objectContaining({
          destination: { service: "corax-research", type: "service" },
          src: "^/corax/research/v1/(.*)$",
        }),
        expect.objectContaining({
          destination: { service: "corax-support", type: "service" },
          src: "^/corax/support/v1/(.*)$",
        }),
        expect.objectContaining({
          destination: { service: "corax-research", type: "service" },
          src: "^/corax/research/?$",
        }),
        expect.objectContaining({
          destination: { service: "corax-support", type: "service" },
          src: "^/corax/support/?$",
        }),
      ]),
      services: expect.objectContaining({
        "corax-research": expect.objectContaining({
          buildCommand: expect.stringContaining("CORAX_INTERNAL_AGENT_WORKSPACE_MEMBER=1"),
          routePrefix: "/corax/research",
        }),
        "corax-support": expect.objectContaining({
          buildCommand: expect.stringContaining("CORAX_INTERNAL_AGENT_WORKSPACE_MEMBER=1"),
          routePrefix: "/corax/support",
        }),
      }),
    });
    expect(rewrites).toBeUndefined();
  });

  it("discovers a peer workspace through coraxRoot", async () => {
    const workspaceRoot = await createTempAppRoot();
    const nextRoot = join(workspaceRoot, "apps", "web");
    await Promise.all([
      mkdir(join(workspaceRoot, "agents", "support", "agent"), { recursive: true }),
      mkdir(join(workspaceRoot, "agents", "research", "agent"), { recursive: true }),
      mkdir(nextRoot, { recursive: true }),
      writeFile(
        join(workspaceRoot, "package.json"),
        JSON.stringify({ dependencies: { corax: "*" } }),
      ),
    ]);
    process.chdir(nextRoot);
    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv("VERCEL", "1");
    vi.stubEnv("VERCEL_URL", "preview.example.com");

    await resolveConfig(withCorax<TestConfig>({}, { coraxRoot: "../.." }));
    const outputConfig = await readJsonFile(join(nextRoot, ".vercel", "output", "config.json"));

    expect(outputConfig).toMatchObject({
      routes: expect.arrayContaining([
        expect.objectContaining({ src: "^/corax/research/v1/(.*)$" }),
        expect.objectContaining({ src: "^/corax/support/v1/(.*)$" }),
      ]),
      services: expect.objectContaining({
        "corax-research": expect.objectContaining({ routePrefix: "/corax/research" }),
        "corax-support": expect.objectContaining({ routePrefix: "/corax/support" }),
      }),
    });
  });

  it("accepts a custom corax service build command", async () => {
    const appRoot = await createTempAppRoot();
    process.chdir(appRoot);
    await mkdir(join(appRoot, ".vercel"), { recursive: true });
    await writeFile(join(appRoot, ".vercel", "project.json"), "{}\n");
    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv("VERCEL", "1");
    vi.stubEnv("VERCEL_URL", "preview.example.com");

    await resolveConfig(
      withCorax<TestConfig>(
        {},
        {
          coraxBuildCommand: "pnpm build:corax",
        },
      ),
    );
    const outputConfig = await readJsonFile(join(appRoot, ".vercel", "output", "config.json"));

    expect(outputConfig).toMatchObject({
      services: {
        corax: {
          buildCommand:
            "cd '../../..' && export CORAX_INTERNAL_BUILD_OUTPUT_DIRECTORY='.corax/vercel-services/corax/.vercel/output' && export CORAX_INTERNAL_HOST_BUILD_OUTPUT_DIRECTORY='.vercel/output' && pnpm build:corax",
        },
      },
    });
  });

  it("discovers workspace members from an absolute coraxRoot with a trailing slash", async () => {
    const appRoot = await createTempAppRoot();
    process.chdir(appRoot);
    await mkdir(join(appRoot, "agents", "a", "agent"), { recursive: true });
    await mkdir(join(appRoot, "agents", "b", "agent"), { recursive: true });
    await writeFile(
      join(appRoot, "package.json"),
      `${JSON.stringify({ dependencies: { corax: "0.0.0" } })}\n`,
    );
    await writeFile(join(appRoot, "agents", "a", "agent", "agent.ts"), "export default {};\n");
    await writeFile(join(appRoot, "agents", "b", "agent", "agent.ts"), "export default {};\n");
    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv("VERCEL", "1");

    await resolveConfig(withCorax<TestConfig>({}, { coraxRoot: `${appRoot}/` }));
    const outputConfig = (await readJsonFile(
      join(appRoot, ".vercel", "output", "config.json"),
    )) as { services?: Record<string, unknown> };

    expect(Object.keys(outputConfig.services ?? {})).toEqual(["corax-a", "corax-b"]);
  });

  it("writes one Build Output service and route for each named agent", async () => {
    const appRoot = await createTempAppRoot();
    process.chdir(appRoot);
    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv("VERCEL", "1");
    vi.stubEnv("VERCEL_URL", "preview.example.com");

    const config = await resolveConfig(
      withCorax<TestConfig>(
        {},
        {
          agents: {
            billing: {
              buildCommand: "pnpm build:billing-agent",
              root: "./agents/billing",
              servicePrefix: "/_corax_internal/billing",
            },
            support: "./agents/support",
          },
        },
      ),
    );
    const rewrites = await config.rewrites?.();
    const outputConfig = await readJsonFile(join(appRoot, ".vercel", "output", "config.json"));

    expect(outputConfig).toEqual({
      routes: [
        {
          destination: {
            service: "corax-billing",
            type: "service",
          },
          src: "^/corax/billing/v1/(.*)$",
        },
        {
          destination: {
            service: "corax-support",
            type: "service",
          },
          src: "^/corax/support/v1/(.*)$",
        },
      ],
      services: {
        "corax-billing": {
          buildCommand:
            "cd '../../../agents/billing' && export CORAX_INTERNAL_BUILD_OUTPUT_DIRECTORY='../../.corax/vercel-services/corax-billing/.vercel/output' && export CORAX_INTERNAL_HOST_BUILD_OUTPUT_DIRECTORY='../../.vercel/output' && export CORAX_PUBLIC_ROUTE_PREFIX='/corax/billing' && pnpm build:billing-agent",
          framework: "corax",
          outputDirectory: ".vercel/output",
          routes: [
            {
              src: "^/corax/billing/v1/(.*)$",
              transforms: [
                {
                  args: "/corax/v1/$1",
                  op: "set",
                  type: "request.path",
                },
              ],
            },
          ],
          root: ".corax/vercel-services/corax-billing",
          routePrefix: "/corax/billing",
        },
        "corax-support": {
          buildCommand:
            "cd '../../../agents/support' && export CORAX_INTERNAL_BUILD_OUTPUT_DIRECTORY='../../.corax/vercel-services/corax-support/.vercel/output' && export CORAX_INTERNAL_HOST_BUILD_OUTPUT_DIRECTORY='../../.vercel/output' && export CORAX_PUBLIC_ROUTE_PREFIX='/corax/support' && node 'node_modules/corax/bin/corax.js' build",
          framework: "corax",
          outputDirectory: ".vercel/output",
          routes: [
            {
              src: "^/corax/support/v1/(.*)$",
              transforms: [
                {
                  args: "/corax/v1/$1",
                  op: "set",
                  type: "request.path",
                },
              ],
            },
          ],
          root: ".corax/vercel-services/corax-support",
          routePrefix: "/corax/support",
        },
      },
      version: 3,
    });
    expect(rewrites).toBeUndefined();
  });

  it("normalizes existing Build Output service arrays before adding named agents", async () => {
    const appRoot = await createTempAppRoot();
    process.chdir(appRoot);
    await mkdir(join(appRoot, ".vercel", "output"), { recursive: true });
    await writeFile(join(appRoot, ".vercel", "project.json"), "{}\n");
    await writeFile(join(appRoot, ".vercel", "output", "builds.json"), "{}\n");
    await writeFile(
      join(appRoot, ".vercel", "output", "config.json"),
      `${JSON.stringify(
        {
          version: 3,
          routes: [
            {
              destination: {
                service: "corax-billing",
                type: "service",
              },
              src: "^/corax/billing/v1/(.*)$",
            },
            { handle: "filesystem" },
          ],
          services: [
            {
              buildCommand: "corax build:support",
              entrypoint: "package.json",
              framework: "corax",
              name: "corax-support",
              root: "agents/support",
              routePrefix: "/corax/support",
              schema: "experimentalServicesV2",
            },
          ],
        },
        null,
        2,
      )}\n`,
    );
    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv("VERCEL", "1");
    vi.stubEnv("VERCEL_URL", "preview.example.com");

    const config = await resolveConfig(
      withCorax<TestConfig>(
        {},
        {
          agents: {
            billing: "./agents/billing",
            support: "./agents/support",
          },
        },
      ),
    );
    const rewrites = await config.rewrites?.();
    const outputConfig = await readJsonFile(join(appRoot, ".vercel", "output", "config.json"));

    expect(outputConfig).toEqual({
      routes: [
        {
          destination: {
            service: "corax-billing",
            type: "service",
          },
          src: "^/corax/billing/v1/(.*)$",
        },
        {
          destination: {
            service: "corax-support",
            type: "service",
          },
          src: "^/corax/support/v1/(.*)$",
        },
        { handle: "filesystem" },
      ],
      services: {
        "corax-billing": {
          buildCommand:
            "cd '../../../agents/billing' && export CORAX_INTERNAL_BUILD_OUTPUT_DIRECTORY='../../.corax/vercel-services/corax-billing/.vercel/output' && export CORAX_INTERNAL_HOST_BUILD_OUTPUT_DIRECTORY='../../.vercel/output' && export CORAX_PUBLIC_ROUTE_PREFIX='/corax/billing' && node 'node_modules/corax/bin/corax.js' build",
          framework: "corax",
          outputDirectory: ".vercel/output",
          routes: [
            {
              src: "^/corax/billing/v1/(.*)$",
              transforms: [
                {
                  args: "/corax/v1/$1",
                  op: "set",
                  type: "request.path",
                },
              ],
            },
          ],
          root: ".corax/vercel-services/corax-billing",
          routePrefix: "/corax/billing",
        },
        "corax-support": {
          buildCommand: "corax build:support",
          entrypoint: "package.json",
          framework: "corax",
          routes: [
            {
              src: "^/corax/support/v1/(.*)$",
              transforms: [
                {
                  args: "/corax/v1/$1",
                  op: "set",
                  type: "request.path",
                },
              ],
            },
          ],
          root: "agents/support",
          routePrefix: "/corax/support",
          schema: "experimentalServicesV2",
        },
      },
      version: 3,
    });
    expect(rewrites).toBeUndefined();
  });

  it("does not start a local corax build while Next.js is building", async () => {
    const appRoot = await createTempAppRoot();
    process.chdir(appRoot);
    vi.stubEnv("NODE_ENV", "production");
    await mkdir(join(appRoot, ".output", "server"), {
      recursive: true,
    });
    await writeFile(join(appRoot, ".output", "server", "index.mjs"), "process.exit(1);\n");

    const config = await withCorax<TestConfig>({})("phase-production-build", {
      defaultConfig: {},
    });
    const rewrites = await config.rewrites?.();

    expect(getBeforeFiles(rewrites)).toContainEqual({
      destination: "http://127.0.0.1:4274/corax/v1/:path+",
      source: "/corax/v1/:path+",
    });
  });

  it("reuses an app-local development server registry before spawning", async () => {
    const appRoot = await createTempAppRoot();
    process.chdir(appRoot);
    const resolvedAppRoot = process.cwd();
    vi.stubEnv("NODE_ENV", "development");
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => Response.json({ revision: "rev-1" })),
    );
    await mkdir(join(resolvedAppRoot, ".corax"), {
      recursive: true,
    });
    await writeFile(
      join(resolvedAppRoot, ".corax", "next-dev-server.json"),
      `${JSON.stringify(
        {
          appRoot: resolvedAppRoot,
          origin: "http://127.0.0.1:49152",
          pid: null,
          updatedAt: new Date().toISOString(),
        },
        null,
        2,
      )}\n`,
    );

    const config = await resolveConfig(withCorax<TestConfig>({}));
    const rewrites = await config.rewrites?.();

    expect(fetch).toHaveBeenCalledWith(
      new URL("/corax/v1/dev/runtime-artifacts", "http://127.0.0.1:49152"),
      { redirect: "error", signal: expect.any(AbortSignal) },
    );
    expect(getBeforeFiles(rewrites)).toContainEqual({
      destination: "http://127.0.0.1:49152/corax/v1/:path+",
      source: "/corax/v1/:path+",
    });
  });
});

async function writeBuiltAgent(agentRoot: string): Promise<void> {
  await mkdir(join(agentRoot, ".output", "server"), { recursive: true });
  await writeFile(join(agentRoot, ".output", "server", "index.mjs"), "// built agent\n");
}

/** Each spawned child reports it is listening on the port it was given. */
function spawnListeningServer(): void {
  spawnMock.mockImplementation((_command, _args, options) => {
    const child = Object.assign(new EventEmitter(), {
      killed: false,
      kill: () => undefined,
      pid: 12345,
      stderr: new EventEmitter(),
      stdout: new EventEmitter(),
    });
    setImmediate(() => {
      child.stdout.emit(
        "data",
        Buffer.from(`Listening on: http://127.0.0.1:${options.env.PORT ?? ""}/\n`),
      );
    });
    return child;
  });
}

function spawnedServers(): readonly { readonly cwd: string; readonly port: string }[] {
  return spawnMock.mock.calls.map(([, , options]) => ({
    cwd: options.cwd,
    port: options.env.PORT ?? "",
  }));
}

function getBeforeFiles(
  rewrites: Awaited<ReturnType<NonNullable<TestConfig["rewrites"]>>> | undefined,
): readonly NonNullable<CoraxNextRewriteSections["beforeFiles"]>[number][] {
  expect(isRewriteSections(rewrites)).toBe(true);
  if (!isRewriteSections(rewrites)) {
    return [];
  }

  return rewrites.beforeFiles ?? [];
}

function isRewriteSections(
  rewrites: Awaited<ReturnType<NonNullable<TestConfig["rewrites"]>>> | undefined,
): rewrites is CoraxNextRewriteSections {
  return rewrites !== undefined && !Array.isArray(rewrites);
}
