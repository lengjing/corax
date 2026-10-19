import { describe, expect, it } from "vitest";

import {
  compileCoraxVercelService,
  createCoraxServiceName,
} from "#internal/vercel/corax-service-contribution.js";
import { resolveCoraxServicePrefixByRoot } from "#internal/vercel/vercel-service-config-operations.js";
import { isValidVercelServiceName } from "#internal/vercel/vercel-service-name.js";

describe("resolveCoraxServicePrefixByRoot", () => {
  it("resolves stable and legacy services by application root", () => {
    expect(
      resolveCoraxServicePrefixByRoot({
        appRoots: ["/project/agents/support"],
        config: {
          services: {
            corax: { framework: "corax", root: "agents/support", routePrefix: "/support" },
          },
        },
        configRoot: "/project",
      }),
    ).toBe("/support");
    expect(
      resolveCoraxServicePrefixByRoot({
        appRoots: ["/project/agent"],
        config: {
          experimentalServices: {
            corax: { entrypoint: "agent", framework: "corax", mount: { path: "/agent" } },
          },
        },
        configRoot: "/project",
      }),
    ).toBe("/agent");
  });

  it("ignores malformed legacy service collections", () => {
    expect(
      resolveCoraxServicePrefixByRoot({
        appRoots: ["/project/agent"],
        config: {
          experimentalServices: null,
          services: {
            corax: { framework: "corax", root: "agent", routePrefix: "/agent" },
            web: { framework: "nextjs" },
          },
        },
        configRoot: "/project",
      }),
    ).toBe("/agent");
  });
});

describe("compileCoraxVercelService", () => {
  it("runs generated workspace agents headlessly under their public routes", () => {
    expect(
      compileCoraxVercelService({
        agent: {
          appRoot: "/project/agents/support",
          buildCommand: "corax build",
          devCommand: "corax dev --no-ui",
          name: "support",
          publicRoutePrefix: "/support",
          workspaceMember: true,
        },
        target: { hostOutputDirectory: "/project/.vercel/output", projectRoot: "/project" },
      }).service.devCommand,
    ).toBe(
      "cd '../../../agents/support' && export CORAX_PUBLIC_ROUTE_PREFIX='/support' && export CORAX_INTERNAL_AGENT_WORKSPACE_MEMBER=1 && corax dev --no-ui",
    );
  });
});

describe("createCoraxServiceName", () => {
  it("preserves public agent names that are valid service suffixes", () => {
    expect(createCoraxServiceName("customer-care")).toBe("corax-customer-care");
  });

  it("encodes digit-bearing public names into stable valid service names", () => {
    const serviceName = createCoraxServiceName("support2");
    expect(serviceName).toBe(createCoraxServiceName("support2"));
    expect(serviceName).not.toBe(createCoraxServiceName("support3"));
    expect(serviceName).toMatch(/^corax-support-[a-z]+$/);
    expect(isValidVercelServiceName(serviceName)).toBe(true);
  });

  it("truncates long names while retaining a distinguishing suffix", () => {
    const serviceName = createCoraxServiceName(`support-${"a".repeat(80)}`);
    expect(serviceName.length).toBeLessThanOrEqual(64);
    expect(isValidVercelServiceName(serviceName)).toBe(true);
  });
});
