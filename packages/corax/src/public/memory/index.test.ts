import { afterEach, describe, expect, it, vi } from "vitest";

import { defaultNamespace, type MemoryScopeContext } from "#public/memory/index.js";
import { byPrincipal } from "#public/memory/scope.js";

const baseContext: MemoryScopeContext = {
  abortSignal: new AbortController().signal,
  channel: { kind: "corax" },
  session: { auth: { current: null, initiator: null }, id: "session_1" },
};

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("memory namespaces and scopes", () => {
  it("derives stable local namespaces without persisting the raw application root", () => {
    vi.stubEnv("VERCEL_PROJECT_ID", "");
    vi.stubEnv("VERCEL_OIDC_TOKEN", "");
    const input = { appRoot: "/Users/example/private/app", node: "__root__", slot: "profile" };

    const first = defaultNamespace(input);
    const second = defaultNamespace(input);

    expect(first).toBe(second);
    expect(first).not.toContain(input.appRoot);
    expect(JSON.parse(first)).toMatchObject([
      "corax-memory-namespace-v1",
      expect.any(String),
      "__root__",
      "profile",
    ]);
  });

  it("ignores hosted deployment coordinates for the same local project", () => {
    vi.stubEnv("VERCEL_PROJECT_ID", "prj_123");
    vi.stubEnv("VERCEL_ENV", "preview");
    vi.stubEnv("VERCEL_GIT_COMMIT_REF", "feature/memory");
    const preview = defaultNamespace({ appRoot: "/app", node: "__root__", slot: "profile" });

    vi.stubEnv("VERCEL_ENV", "production");
    const production = defaultNamespace({
      appRoot: "/app",
      node: "__root__",
      slot: "profile",
    });

    expect(preview).toBe(production);
  });

  it("separates different local workspace projects", () => {
    const support = defaultNamespace({ appRoot: "/app/support", node: "__root__", slot: "profile" });
    const research = defaultNamespace({ appRoot: "/app/research", node: "__root__", slot: "profile" });
    expect(support).not.toBe(research);
  });

  it("keeps a project's namespace stable when its public route prefix changes", () => {
    vi.stubEnv("VERCEL_PROJECT_ID", "prj_123");
    vi.stubEnv("VERCEL_ENV", "production");
    const input = { appRoot: "/app", node: "__root__", slot: "profile" };
    const unprefixed = defaultNamespace(input);

    vi.stubEnv("CORAX_PUBLIC_ROUTE_PREFIX", "/support");

    expect(defaultNamespace(input)).toBe(unprefixed);
  });

  it("disables anonymous and runtime principals and normalizes local development", () => {
    const context = (principalType: string, principalId = "principal") => ({
      ...baseContext,
      session: {
        ...baseContext.session,
        auth: {
          current: {
            attributes: {},
            authenticator: principalType,
            principalId,
            principalType,
          },
          initiator: null,
        },
      },
    });

    expect(byPrincipal(baseContext)).toBeNull();
    expect(byPrincipal(context("anonymous"))).toBeNull();
    expect(byPrincipal(context("runtime"))).toBeNull();
    expect(byPrincipal(context("local-dev", "machine-specific"))).toBe("local-dev");
  });

  it("includes the authenticated principal coordinates without delimiter flattening", () => {
    const context: MemoryScopeContext = {
      ...baseContext,
      session: {
        ...baseContext.session,
        auth: {
          current: {
            attributes: {},
            authenticator: "oidc:primary",
            issuer: "https://issuer.example",
            principalId: "user:123",
            principalType: "user",
          },
          initiator: null,
        },
      },
    };

    expect(JSON.parse(byPrincipal(context)!)).toEqual([
      "user",
      "oidc:primary",
      "https://issuer.example",
      "user:123",
    ]);
  });
});
