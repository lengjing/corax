import { access, mkdir, mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { describe, expect, it, vi } from "vitest";

vi.mock("#shared/resolve-corax-binary.js", () => ({
  resolveCoraxBinaryPath: (root: string) => join(root, "node_modules", "corax", "bin", "corax.js"),
}));

import { withCorax } from "./index.js";

async function createWorkspace(): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), "corax-vercel-config-"));
  await writeFile(
    join(root, "package.json"),
    JSON.stringify({ dependencies: { corax: "*" }, packageManager: "pnpm@10.0.0", private: true }),
  );
  await Promise.all([
    mkdir(join(root, "agents", "support", "agent"), { recursive: true }),
    mkdir(join(root, "agents", "research", "agent"), { recursive: true }),
  ]);
  return root;
}

describe("withCorax", () => {
  it("composes workspace agents with authored Vercel services and routes", async () => {
    const root = await createWorkspace();
    const config = await withCorax(
      {
        crons: [{ path: "/api/dispatch", schedule: "* * * * *" }],
        routes: [
          { destination: { service: "web", type: "service" }, src: "^/api/(.*)$" },
          { handle: "filesystem" },
        ],
        services: { web: { framework: "nextjs", root: "apps/web" } },
      },
      { root },
    );

    expect(config.crons).toEqual([{ path: "/api/dispatch", schedule: "* * * * *" }]);
    expect(config.routes).toEqual([
      { destination: { service: "web", type: "service" }, src: "^/api/(.*)$" },
      {
        destination: { service: "corax-research", type: "service" },
        src: "^/corax/research/v1/(.*)$",
      },
      {
        destination: { service: "corax-research", type: "service" },
        src: "^/corax/research/?$",
      },
      {
        destination: { service: "corax-support", type: "service" },
        src: "^/corax/support/v1/(.*)$",
      },
      {
        destination: { service: "corax-support", type: "service" },
        src: "^/corax/support/?$",
      },
      { handle: "filesystem" },
    ]);
    expect(config.services.web).toEqual({ framework: "nextjs", root: "apps/web" });
    expect(config.services["corax-support"]).toEqual({
      buildCommand:
        "cd '../../../agents/support' && export CORAX_INTERNAL_BUILD_OUTPUT_DIRECTORY='../../.corax/vercel-services/corax-support/.vercel/output' && export CORAX_INTERNAL_HOST_BUILD_OUTPUT_DIRECTORY='../../.vercel/output' && export CORAX_PUBLIC_ROUTE_PREFIX='/corax/support' && export CORAX_INTERNAL_AGENT_WORKSPACE_MEMBER=1 && node 'node_modules/corax/bin/corax.js' build",
      devCommand:
        "cd '../../../agents/support' && export CORAX_PUBLIC_ROUTE_PREFIX='/corax/support' && export CORAX_INTERNAL_AGENT_WORKSPACE_MEMBER=1 && node 'node_modules/corax/bin/corax.js' dev --no-ui",
      framework: "corax",
      outputDirectory: ".vercel/output",
      root: ".corax/vercel-services/corax-support",
      routes: [
        {
          src: "^/corax/support/?$",
          transforms: [{ args: "/", op: "set", type: "request.path" }],
        },
        {
          src: "^/corax/support/v1/(.*)$",
          transforms: [{ args: "/corax/v1/$1", op: "set", type: "request.path" }],
        },
      ],
    });
    await expect(
      access(join(root, ".corax", "vercel-services", "corax-support")),
    ).resolves.toBeUndefined();
  });

  it("discovers the workspace when Vercel evaluates config from .vercel", async () => {
    const root = await createWorkspace();
    const configDirectory = join(root, ".vercel");
    await mkdir(configDirectory);
    const originalCwd = process.cwd();
    process.chdir(configDirectory);
    try {
      const config = await withCorax({});
      expect(config.services["corax-support"]).toBeDefined();
    } finally {
      process.chdir(originalCwd);
    }
  });

  it("does not modify the root Build Output", async () => {
    const root = await createWorkspace();
    const marker = join(root, ".vercel", "output", "services", "web", "config.json");
    await mkdir(join(marker, ".."), { recursive: true });
    await writeFile(marker, "web output");

    await withCorax({}, { root });

    await expect(access(marker)).resolves.toBeUndefined();
  });

  it("rejects authored service keys owned by generated agents", async () => {
    const root = await createWorkspace();

    await expect(
      withCorax({ services: { "corax-support": { framework: "nextjs" } } }, { root }),
    ).rejects.toThrow(
      'Vercel service key "corax-support" conflicts with the service generated for corax agent "support". Remove or rename the authored service; withCorax owns this key.',
    );
  });

  it("rejects authored corax services when composing a standalone agent", async () => {
    const root = await mkdtemp(join(tmpdir(), "corax-vercel-config-standalone-conflict-"));
    await writeFile(join(root, "package.json"), JSON.stringify({ dependencies: { corax: "*" } }));
    await mkdir(join(root, "agent"), { recursive: true });

    await expect(withCorax({ services: { legacy: { framework: "corax" } } }, { root })).rejects.toThrow(
      'Vercel service key "corax" conflicts with the service generated for corax agent "the default agent". Remove or rename the authored service; withCorax owns this key.',
    );
  });

  it("rejects authored routes owned by generated agents", async () => {
    const root = await createWorkspace();

    await expect(
      withCorax({ routes: [{ src: "^/corax/support/v1/(.*)$" }] }, { root }),
    ).rejects.toThrow(
      'Vercel route "^/corax/support/v1/(.*)$" conflicts with the route generated for corax agent "support". Remove the authored route; withCorax adds it automatically.',
    );
  });

  it("rejects authored routes owned by generated agent home pages", async () => {
    const root = await createWorkspace();

    await expect(withCorax({ routes: [{ src: "^/corax/support/?$" }] }, { root })).rejects.toThrow(
      'Vercel route "^/corax/support/?$" conflicts with the route generated for corax agent "support". Remove the authored route; withCorax adds it automatically.',
    );
  });

  it("rejects duplicate names in a service array", async () => {
    const root = await createWorkspace();

    await expect(
      withCorax(
        {
          services: [
            { framework: "nextjs", name: "web", root: "apps/first" },
            { framework: "nuxtjs", name: "web", root: "apps/second" },
          ],
        },
        { root },
      ),
    ).rejects.toThrow('Duplicate Vercel service name "web".');
  });

  it("rejects obsolete service fields", async () => {
    const root = await createWorkspace();

    await expect(withCorax({ experimentalServicesV2: {} }, { root })).rejects.toThrow(
      "withCorax cannot compose experimentalServices or experimentalServicesV2. Remove the obsolete field and define authored services under services.",
    );
  });

  it("requires at least one workspace agent", async () => {
    const root = await mkdtemp(join(tmpdir(), "corax-vercel-config-empty-workspace-"));
    await writeFile(join(root, "package.json"), JSON.stringify({ dependencies: { corax: "*" } }));
    await mkdir(join(root, "agents"));

    await expect(withCorax({}, { root })).rejects.toThrow(
      `withCorax found no workspace agents under ${join(root, "agents")}. Add an agent or remove withCorax from vercel.ts.`,
    );
  });

  it("composes a standalone agent at the unprefixed protocol route", async () => {
    const root = await mkdtemp(join(tmpdir(), "corax-vercel-config-standalone-"));
    await writeFile(join(root, "package.json"), JSON.stringify({ dependencies: { corax: "*" } }));
    await mkdir(join(root, "agent"), { recursive: true });

    const config = await withCorax({}, { root });

    expect(config.routes).toEqual([
      { destination: { service: "corax", type: "service" }, src: "^/corax/v1/(.*)$" },
    ]);
    expect(config.services.corax).toEqual({
      buildCommand:
        "cd '../../..' && export CORAX_INTERNAL_BUILD_OUTPUT_DIRECTORY='.corax/vercel-services/corax/.vercel/output' && export CORAX_INTERNAL_HOST_BUILD_OUTPUT_DIRECTORY='.vercel/output' && node 'node_modules/corax/bin/corax.js' build",
      devCommand: "cd '../../..' && node 'node_modules/corax/bin/corax.js' dev --no-ui",
      framework: "corax",
      outputDirectory: ".vercel/output",
      root: ".corax/vercel-services/corax",
      routes: [
        {
          src: "^/corax/v1/(.*)$",
          transforms: [{ args: "/corax/v1/$1", op: "set", type: "request.path" }],
        },
      ],
    });
  });
});
