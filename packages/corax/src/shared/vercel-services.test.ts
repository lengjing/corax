import { describe, expect, it } from "vitest";

import {
  createCoraxServiceRequestPathRoute,
  createCoraxServiceRoute,
  mergeCoraxVercelConfig,
  type EnsureCoraxVercelServicesConfigResult,
} from "./vercel-services.js";

const GENERATED: Extract<EnsureCoraxVercelServicesConfigResult, { mode: "generated" }> = {
  mode: "generated",
  services: {
    corax: {
      buildCommand: "corax build",
      framework: "corax",
      outputDirectory: ".vercel/output",
      routes: [createCoraxServiceRequestPathRoute()],
      root: ".corax/vercel-services/corax",
    },
  },
};

describe("createCoraxServiceRoute", () => {
  it("routes the corax transport namespace to the corax service", () => {
    expect(createCoraxServiceRoute()).toEqual({
      destination: {
        service: "corax",
        type: "service",
      },
      src: "^/corax/v1/(.*)$",
    });
  });

  it("targets a custom service name", () => {
    expect(createCoraxServiceRoute("agent").destination.service).toBe("agent");
  });
});

describe("createCoraxServiceRequestPathRoute", () => {
  it("pins the request path to the corax transport namespace", () => {
    expect(createCoraxServiceRequestPathRoute()).toEqual({
      src: "^/corax/v1/(.*)$",
      transforms: [
        {
          args: "/corax/v1/$1",
          op: "set",
          type: "request.path",
        },
      ],
    });
  });
});

describe("mergeCoraxVercelConfig", () => {
  it("builds a fresh config when nothing exists", () => {
    expect(mergeCoraxVercelConfig(undefined, GENERATED)).toEqual({
      version: 3,
      routes: [createCoraxServiceRoute()],
      services: GENERATED.services,
    });
  });

  it("prepends the service route before user routes", () => {
    const userRoute = { src: "^/custom/(.*)$", dest: "/other/$1" };

    expect(mergeCoraxVercelConfig({ routes: [userRoute] }, GENERATED).routes).toEqual([
      createCoraxServiceRoute(),
      userRoute,
    ]);
  });

  it("inserts the service route before a user filesystem handle", () => {
    const before = { src: "^/a$", dest: "/b" };
    const after = { src: "^/c$", dest: "/d" };

    expect(
      mergeCoraxVercelConfig({ routes: [before, { handle: "filesystem" }, after] }, GENERATED).routes,
    ).toEqual([before, createCoraxServiceRoute(), { handle: "filesystem" }, after]);
  });

  it("preserves a user-configured corax service and routes to it", () => {
    const merged = mergeCoraxVercelConfig(
      {
        services: {
          agent: {
            framework: "corax",
            buildCommand: "pnpm build:agent",
            root: "agent",
          },
          other: { framework: "hono" },
        },
      },
      GENERATED,
    );

    expect(merged.services).toEqual({
      agent: {
        framework: "corax",
        buildCommand: "pnpm build:agent",
        root: "agent",
        routes: [createCoraxServiceRequestPathRoute()],
      },
      other: { framework: "hono" },
    });
    expect(merged.routes).toEqual([createCoraxServiceRoute("agent")]);
  });

  it("stays idempotent when merged twice", () => {
    const once = mergeCoraxVercelConfig(undefined, GENERATED);

    expect(mergeCoraxVercelConfig(once, GENERATED)).toEqual(once);
  });

  it("preserves unknown keys and an explicit version", () => {
    const merged = mergeCoraxVercelConfig({ version: 2, cleanUrls: true }, GENERATED);

    expect(merged.version).toBe(2);
    expect(merged.cleanUrls).toBe(true);
  });
});
