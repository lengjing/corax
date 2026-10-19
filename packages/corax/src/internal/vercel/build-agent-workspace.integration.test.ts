import { access, mkdir, mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { describe, expect, it, vi } from "vitest";

vi.mock("#shared/resolve-corax-binary.js", () => ({
  resolveCoraxBinaryPath: (root: string) => join(root, "node_modules", "corax", "bin", "corax.js"),
}));

import { resolveCoraxProjectContext } from "#internal/project-context.js";
import { buildAgentWorkspace } from "#internal/vercel/build-agent-workspace.js";

async function createWorkspace(): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), "corax-workspace-build-"));
  await writeFile(
    join(root, "package.json"),
    JSON.stringify({
      dependencies: { corax: "*" },
      packageManager: "pnpm@10.0.0",
      private: true,
    }),
  );
  await Promise.all([
    mkdir(join(root, "agents", "support", "agent"), { recursive: true }),
    mkdir(join(root, "agents", "research", "agent"), { recursive: true }),
  ]);
  return root;
}

async function resolveWorkspace(root: string) {
  const context = await resolveCoraxProjectContext(root);
  if (context.kind !== "workspace") throw new Error("Expected a workspace context.");
  return context.workspace;
}

describe("buildAgentWorkspace", () => {
  it("emits peer services and canonical public routes", async () => {
    const root = await createWorkspace();
    const workspace = await resolveWorkspace(root);
    expect(workspace).toBeDefined();

    const output = await buildAgentWorkspace(workspace);
    const config = JSON.parse(await readFile(join(output, "config.json"), "utf8"));
    const multiAgentSummary = JSON.parse(
      await readFile(join(root, ".corax", "agent-summary.json"), "utf8"),
    );

    expect(multiAgentSummary).toMatchObject({
      agents: [
        {
          name: "research",
          routePrefix: "/corax/research",
          summaryPath: "agents/research/.corax/agent-summary.json",
        },
        {
          name: "support",
          routePrefix: "/corax/support",
          summaryPath: "agents/support/.corax/agent-summary.json",
        },
      ],
      kind: "vercel-corax-multi-agent-summary",
      schemaVersion: 1,
    });

    expect(config.routes).toEqual([
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
    await expect(readFile(join(output, "static", "index.html"), "utf8")).resolves.toContain(
      "2 agents are up and accepting messages.",
    );
    await expect(
      access(join(root, ".corax", "vercel-services", "corax-support")),
    ).resolves.toBeUndefined();

    expect(config.services["corax-support"]).toEqual({
      buildCommand:
        "cd '../../../agents/support' && export CORAX_INTERNAL_BUILD_OUTPUT_DIRECTORY='../../.corax/vercel-services/corax-support/.vercel/output' && export CORAX_INTERNAL_HOST_BUILD_OUTPUT_DIRECTORY='../../.vercel/output' && export CORAX_PUBLIC_ROUTE_PREFIX='/corax/support' && export CORAX_INTERNAL_AGENT_WORKSPACE_MEMBER=1 && node 'node_modules/corax/bin/corax.js' build",
      devCommand:
        "cd '../../../agents/support' && export CORAX_PUBLIC_ROUTE_PREFIX='/corax/support' && export CORAX_INTERNAL_AGENT_WORKSPACE_MEMBER=1 && node 'node_modules/corax/bin/corax.js' dev --no-ui",
      framework: "corax",
      outputDirectory: ".vercel/output",
      root: ".corax/vercel-services/corax-support",
      routePrefix: "/corax/support",
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
  });

  it("keeps digit-bearing public names while encoding the generated service name", async () => {
    const root = await createWorkspace();
    await mkdir(join(root, "agents", "support2", "agent"), { recursive: true });
    const workspace = await resolveWorkspace(root);
    const output = await buildAgentWorkspace(workspace);
    const config = JSON.parse(await readFile(join(output, "config.json"), "utf8"));
    const supportServiceName = Object.keys(config.services).find((name) =>
      name.startsWith("corax-support-"),
    );

    expect(supportServiceName).toMatch(/^corax-support-[a-z]+$/);
    expect(config.routes).toContainEqual({
      destination: { service: supportServiceName, type: "service" },
      src: "^/corax/support2/v1/(.*)$",
    });
  });

  it("refuses to assemble an authored graph", async () => {
    const root = await createWorkspace();
    await writeFile(join(root, "vercel.json"), JSON.stringify({ services: {} }));
    const workspace = await resolveWorkspace(root);
    await expect(buildAgentWorkspace(workspace)).rejects.toThrow(/vercel\.ts.*corax\/vercel/);
  });
});
