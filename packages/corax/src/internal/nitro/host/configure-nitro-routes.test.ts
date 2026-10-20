import type { Nitro } from "nitro/types";
import { beforeEach, describe, expect, it, vi } from "vitest";

import type { PreparedApplicationHost } from "./types.js";

interface NitroStub {
  hookHandlers: Map<string, Array<() => unknown>>;
  hooks: {
    hook(name: string, handler: () => unknown): void;
  };
  options: {
    buildDir: string;
    dev: boolean;
    handlers: Nitro["options"]["handlers"];
    rootDir: string;
    virtual: Nitro["options"]["virtual"];
  };
  routing: {
    sync(): void;
  };
}

interface PreparedApplicationHostStub {
  appRoot: string;
  compileResult: {
    manifest: {
      channelRoutes: {
        effective: Array<{
          logicalPath: string;
          method: "GET" | "HEAD";
          name: string;
          sourceId: string;
          sourceKind: "module";
          urlPath: string;
        }>;
        preflight: [];
        shadowed: [];
      };
      config: {
        name: string;
        experimental?: { workflow?: { world?: string } };
      };
    };
    project: {
      agentRoot: string;
      appRoot: string;
      layout: "nested";
    };
  };
  compiledArtifacts: {
    bootstrapPath: string;
    workflowWorldPluginPath: string;
  };
  scheduleRegistrations: [];
  schedules: [];
  workflowBuildDir: string;
}

const workflowBuilderMocks = vi.hoisted(() => ({
  build: vi.fn(async () => {}),
}));

const fsMocks = vi.hoisted(() => ({
  mkdir: vi.fn(async () => {}),
  writeFile: vi.fn(async () => {}),
}));

vi.mock("node:fs/promises", () => fsMocks);

vi.mock("../../application/package.js", () => ({
  resolvePackageDependencyPath: (specifier: string) =>
    `G:\\projects\\test-corax\\node_modules\\.pnpm\\${specifier}@1.0.0\\node_modules\\${specifier}\\dist\\index.js`,
  resolvePackageRoot: () =>
    "G:\\projects\\test-corax\\node_modules\\.pnpm\\corax@0.3.0\\node_modules\\corax",
  resolvePackageSourceFilePath: (relativeSourcePath: string) =>
    `G:\\projects\\test-corax\\node_modules\\.pnpm\\corax@0.3.0\\node_modules\\corax\\dist\\${relativeSourcePath
      .replace(/\.[cm]?tsx?$/, ".js")
      .replaceAll("/", "\\")}`,
  resolveWorkflowModulePath: (specifier: string) =>
    `G:\\projects\\test-corax\\node_modules\\.pnpm\\corax@0.3.0\\node_modules\\corax\\dist\\src\\compiled\\${specifier
      .replace(/^workflow\/(?:api|runtime)$/, "@workflow\\core\\runtime")
      .replace(/^workflow\/internal\/private$/, "@workflow\\core\\private")
      .replaceAll("/", "\\")}.js`,
}));

vi.mock("../../workflow-bundle/builder.js", () => ({
  WorkflowBundleBuilder: class {
    build = workflowBuilderMocks.build;
  },
}));

// Mock paths.js so the unit test avoids its heavyweight workflow-runtime import graph.
vi.mock("../../application/paths.js", () => ({}));

const { configureDevelopmentNitroRoutes, configureProductionNitroRoutes } =
  await import("./configure-nitro-routes.js");
const { CORAX_DEV_DISPATCH_SCHEDULE_ROUTE_PATTERN, CORAX_HEALTH_ROUTE_PATH, CORAX_INFO_ROUTE_PATH } =
  await import("#protocol/routes.js");

function createNitroStub(
  input: { buildDir?: string; dev?: boolean; rootDir?: string } = {},
): Nitro & Pick<NitroStub, "hookHandlers"> {
  const hookHandlers = new Map<string, Array<() => unknown>>();
  const nitro: NitroStub = {
    hookHandlers,
    hooks: {
      hook(name, handler) {
        hookHandlers.set(name, [...(hookHandlers.get(name) ?? []), handler]);
      },
    },
    options: {
      buildDir: input.buildDir ?? "G:\\projects\\test-corax\\.corax\\nitro",
      dev: input.dev ?? false,
      handlers: [],
      rootDir: input.rootDir ?? "G:\\projects\\test-corax",
      virtual: {},
    },
    routing: {
      sync() {},
    },
  };

  return nitro as never as Nitro & Pick<NitroStub, "hookHandlers">;
}

function createPreparedHost(
  input: {
    agentName?: string;
    appRoot?: string;
    workflowWorld?: string;
    workflowBuildDir?: string;
  } = {},
): PreparedApplicationHost {
  const appRoot = input.appRoot ?? "G:\\projects\\test-corax";
  const pathSeparator = appRoot.includes("\\") ? "\\" : "/";

  const preparedHost: PreparedApplicationHostStub = {
    appRoot,
    compileResult: {
      manifest: {
        channelRoutes: {
          effective: [
            ...["GET", "HEAD"].map((method) => ({
              logicalPath: "channels/home.ts",
              method: method as "GET" | "HEAD",
              name: "home",
              sourceId: "framework:home",
              sourceKind: "module" as const,
              urlPath: "/",
            })),
            ...["GET", "HEAD"].map((method) => ({
              logicalPath: "channels/corax.ts",
              method: method as "GET" | "HEAD",
              name: "corax",
              sourceId: "framework:corax",
              sourceKind: "module" as const,
              urlPath: CORAX_HEALTH_ROUTE_PATH,
            })),
            {
              logicalPath: "channels/corax.ts",
              method: "GET",
              name: "corax",
              sourceId: "framework:corax",
              sourceKind: "module",
              urlPath: CORAX_INFO_ROUTE_PATH,
            },
          ],
          preflight: [],
          shadowed: [],
        },
        config:
          input.workflowWorld === undefined
            ? { name: input.agentName ?? "test-agent" }
            : {
                name: input.agentName ?? "test-agent",
                experimental: { workflow: { world: input.workflowWorld } },
              },
      },
      project: {
        agentRoot: `${appRoot}\\agent`,
        appRoot,
        layout: "nested",
      },
    },
    compiledArtifacts: {
      bootstrapPath: `${appRoot}\\.corax\\compiled-artifacts-bootstrap.mjs`,
      workflowWorldPluginPath: `${appRoot}${pathSeparator}.corax${pathSeparator}compiled-artifacts-workflow-world.mjs`,
    },
    scheduleRegistrations: [],
    schedules: [],
    workflowBuildDir: input.workflowBuildDir ?? `${appRoot}\\.corax\\workflow-cache`,
  };

  return preparedHost as never as PreparedApplicationHost;
}

describe("Nitro route configuration", () => {
  beforeEach(() => {
    fsMocks.mkdir.mockClear();
    fsMocks.writeFile.mockClear();
    workflowBuilderMocks.build.mockClear();
    vi.unstubAllEnvs();
  });

  it("registers compiler-owned routes through channel virtual handlers", async () => {
    const nitro = createNitroStub();

    await configureProductionNitroRoutes(nitro, createPreparedHost());

    const healthHandler = nitro.options.handlers.find(
      (handler) => handler.route === CORAX_HEALTH_ROUTE_PATH && handler.method === "GET",
    );
    expect(healthHandler?.handler).toBe(`#nitro/virtual/corax-channel/GET ${CORAX_HEALTH_ROUTE_PATH}`);

    const virtualSource = nitro.options.virtual[healthHandler?.handler ?? ""];
    expect(virtualSource).toContain("dispatchChannelRequest");
    expect(virtualSource).not.toContain('"G:\\');
  });

  it("routes the compiled home channel through the same dispatcher", async () => {
    const nitro = createNitroStub();

    await configureProductionNitroRoutes(nitro, createPreparedHost({ agentName: "support-agent" }));

    const homeHandler = nitro.options.handlers.find(
      (handler) => handler.route === "/" && handler.method === "GET",
    );
    expect(homeHandler?.handler).toBe("#nitro/virtual/corax-channel/GET /");

    const virtualSource = nitro.options.virtual[homeHandler?.handler ?? ""];
    expect(virtualSource).toContain("dispatchChannelRequest");
    expect(virtualSource).not.toContain("support-agent");
  });

  it("registers the health route for HEAD so load balancers probing with HEAD see 200", async () => {
    const nitro = createNitroStub();

    await configureProductionNitroRoutes(nitro, createPreparedHost());

    const healthMethods = nitro.options.handlers
      .filter((handler) => handler.route === CORAX_HEALTH_ROUTE_PATH)
      .map((handler) => handler.method);
    expect(healthMethods).toContain("GET");
    expect(healthMethods).toContain("HEAD");

    const headHandler = nitro.options.handlers.find(
      (handler) => handler.route === CORAX_HEALTH_ROUTE_PATH && handler.method === "HEAD",
    );
    expect(headHandler?.handler).toBe(`#nitro/virtual/corax-channel/HEAD ${CORAX_HEALTH_ROUTE_PATH}`);

    const virtualSource = nitro.options.virtual[headHandler?.handler ?? ""];
    expect(virtualSource).toContain("dispatchChannelRequest");
  });

  it("registers workflow routes through physical handlers with relative bundle imports", async () => {
    const root = "/tmp/corax-nitro-routes";
    const buildDir = `${root}/nitro`;
    const workflowBuildDir = `${root}/workflow-cache`;
    const nitro = createNitroStub({ buildDir, dev: true, rootDir: root });

    await configureDevelopmentNitroRoutes(
      nitro,
      createPreparedHost({
        appRoot: root,
        workflowBuildDir,
      }),
    );

    const workflowHandler = nitro.options.handlers.find(
      (handler) => handler.route === "/.well-known/workflow/v1/flow",
    );
    const expectedHandlerPath = `${buildDir}/workflow/workflows-handler.mjs`;

    expect(workflowHandler?.handler).toBe(expectedHandlerPath);
    expect(fsMocks.writeFile).toHaveBeenCalledWith(
      expectedHandlerPath,
      expect.stringContaining('import { POST } from "./workflows.mjs";'),
    );
    expect(workflowBuilderMocks.build).toHaveBeenCalledWith({
      nitroStepOutfile: `${buildDir}/workflow/steps.mjs`,
      nitroWorkflowOutfile: `${buildDir}/workflow/workflows.mjs`,
    });
    expect(nitro.options.virtual["#corax-workflow/workflows"]).toBeUndefined();
  });

  it("does not retain a workflow reload hook after configuring a candidate", async () => {
    const nitro = createNitroStub({ dev: true });

    await configureDevelopmentNitroRoutes(nitro, createPreparedHost());
    const build = nitro.hookHandlers.get("build:before")?.[0];
    if (build === undefined) {
      throw new Error("Expected the workflow build hook to be registered.");
    }

    expect(nitro.hookHandlers.has("dev:reload")).toBe(false);
    await expect(build()).resolves.toBeUndefined();
    expect(workflowBuilderMocks.build).toHaveBeenCalledOnce();
  });

  it("leaves development queue dispatch to the stable parent", async () => {
    const root = "/tmp/corax-nitro-direct-handlers";
    const buildDir = `${root}/nitro`;
    const nitro = createNitroStub({ buildDir, dev: true, rootDir: root });

    await configureDevelopmentNitroRoutes(nitro, createPreparedHost({ appRoot: root }));

    const workflowHandlerSource = readWriteFileSourceMatching("/workflow/workflows-handler.mjs");

    expect(workflowHandlerSource).toContain('import { POST } from "./workflows.mjs";');
    expect(workflowHandlerSource).not.toContain("registerHandler");
    expect(workflowHandlerSource).not.toContain("__coraxGetWorkflowWorld");
    expect(readWriteFileSourceMatching("/workflow/steps-handler.mjs")).toBeUndefined();
  });

  it("keeps configured development World queue dispatch inside the worker", async () => {
    const root = "/tmp/corax-nitro-configured-world-handlers";
    const nitro = createNitroStub({ buildDir: `${root}/nitro`, dev: true, rootDir: root });

    await configureDevelopmentNitroRoutes(
      nitro,
      createPreparedHost({ appRoot: root, workflowWorld: "@workflow/world-postgres" }),
    );

    const workflowHandlerSource = readWriteFileSourceMatching("/workflow/workflows-handler.mjs");
    expect(workflowHandlerSource).toContain(
      "const __coraxWorkflowWorld = await __coraxGetWorkflowWorld();",
    );
    expect(workflowHandlerSource).toContain("__coraxWorkflowWorld.registerHandler");
  });

  it("bakes the module map loader into the dev schedule handler", async () => {
    const nitro = createNitroStub({ dev: true });

    await configureDevelopmentNitroRoutes(nitro, createPreparedHost());

    const source = nitro.options.virtual[`#corax-route${CORAX_DEV_DISPATCH_SCHEDULE_ROUTE_PATTERN}`];
    expect(source).toContain('"moduleMapLoaderPath"');
    expect(source).toContain("authored-module-map-loader.js");
  });

  it("registers the dev runtime artifact revision route only in dev mode", async () => {
    const devNitro = createNitroStub({ dev: true });
    const prodNitro = createNitroStub({ dev: false });

    await configureDevelopmentNitroRoutes(devNitro, createPreparedHost());
    await configureProductionNitroRoutes(prodNitro, createPreparedHost());

    expect(devNitro.options.handlers).toContainEqual({
      handler: "#corax-route/corax/v1/dev/runtime-artifacts",
      method: "GET",
      route: "/corax/v1/dev/runtime-artifacts",
    });
    expect(devNitro.options.handlers).not.toContainEqual(
      expect.objectContaining({
        route: "/corax/v1/dev/runtime-artifacts/rebuild",
      }),
    );
    expect(prodNitro.options.handlers).not.toContainEqual(
      expect.objectContaining({
        route: "/corax/v1/dev/runtime-artifacts",
      }),
    );
  });

  it("registers the agent info route for dev and production app builds", async () => {
    const devNitro = createNitroStub({ dev: true });
    const prodNitro = createNitroStub({ dev: false });

    await configureDevelopmentNitroRoutes(devNitro, createPreparedHost());
    await configureProductionNitroRoutes(prodNitro, createPreparedHost());

    expect(devNitro.options.handlers).toContainEqual({
      handler: `#nitro/virtual/corax-channel/GET ${CORAX_INFO_ROUTE_PATH}`,
      method: "GET",
      route: CORAX_INFO_ROUTE_PATH,
    });
    expect(prodNitro.options.handlers).toContainEqual({
      handler: `#nitro/virtual/corax-channel/GET ${CORAX_INFO_ROUTE_PATH}`,
      method: "GET",
      route: CORAX_INFO_ROUTE_PATH,
    });
    expect(
      devNitro.options.virtual[`#nitro/virtual/corax-channel/GET ${CORAX_INFO_ROUTE_PATH}`],
    ).toContain('"kind":"development"');
    expect(
      prodNitro.options.virtual[`#nitro/virtual/corax-channel/GET ${CORAX_INFO_ROUTE_PATH}`],
    ).toContain('"kind":"production"');
    expect(
      devNitro.options.virtual[`#nitro/virtual/corax-channel/GET ${CORAX_INFO_ROUTE_PATH}`],
    ).toContain("dispatchChannelRequest");
    expect(
      prodNitro.options.virtual[`#nitro/virtual/corax-channel/GET ${CORAX_INFO_ROUTE_PATH}`],
    ).toContain("dispatchChannelRequest");
    expect(devNitro.options.virtual[`#corax-route${CORAX_INFO_ROUTE_PATH}`]).toBeUndefined();
    expect(prodNitro.options.virtual[`#corax-route${CORAX_INFO_ROUTE_PATH}`]).toBeUndefined();
  });

  it("registers direct workflow queue handlers for self-hosted production builds with a configured world", async () => {
    const root = "/tmp/corax-nitro-direct-handlers-self-hosted";
    const buildDir = `${root}/nitro`;
    const workflowBuildDir = `${root}/workflow-cache`;
    const nitro = createNitroStub({ buildDir, dev: false, rootDir: root });

    await configureProductionNitroRoutes(
      nitro,
      createPreparedHost({
        appRoot: root,
        workflowBuildDir,
        workflowWorld: "@workflow/world-postgres",
      }),
    );

    const workflowHandlerSource = readWriteFileSourceMatching("/workflow/workflows-handler.mjs");

    expect(workflowHandlerSource).toContain(
      'import { POST } from "../../workflow-cache/workflows.mjs";',
    );
    expect(workflowHandlerSource).toContain(
      "const __coraxWorkflowWorld = await __coraxGetWorkflowWorld();",
    );
    expect(workflowHandlerSource).toContain(
      '__coraxWorkflowWorld.registerHandler("__corax746573742d6167656e74_wkf_workflow_", POST);',
    );
    expect(readWriteFileSourceMatching("/workflow/steps-handler.mjs")).toBeUndefined();
  });

  it("does not register direct workflow queue handlers for self-hosted production builds without a configured world", async () => {
    const root = "/tmp/corax-nitro-direct-handlers-self-hosted-no-world";
    const buildDir = `${root}/nitro`;
    const workflowBuildDir = `${root}/workflow-cache`;
    const nitro = createNitroStub({ buildDir, dev: false, rootDir: root });

    await configureProductionNitroRoutes(
      nitro,
      createPreparedHost({ appRoot: root, workflowBuildDir }),
    );

    const workflowHandlerSource = readWriteFileSourceMatching("/workflow/workflows-handler.mjs");

    expect(workflowHandlerSource).not.toContain("registerHandler");
    expect(workflowHandlerSource).not.toContain("__coraxGetWorkflowWorld");
  });
});

function readWriteFileSourceMatching(suffix: string): string | undefined {
  const calls = fsMocks.writeFile.mock.calls as readonly unknown[][];
  const call = calls.find((args) => {
    const target = args[0];
    return typeof target === "string" && target.replaceAll("\\", "/").endsWith(suffix);
  });

  if (call === undefined) {
    return undefined;
  }

  const source = call[1];
  return typeof source === "string" ? source : undefined;
}
