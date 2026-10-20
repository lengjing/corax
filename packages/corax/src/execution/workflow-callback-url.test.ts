import { afterEach, describe, expect, it, vi } from "vitest";

import {
  createWorkflowCallbackUrl,
  resolveWorkflowCallbackBaseUrl,
} from "#execution/workflow-callback-url.js";

describe("resolveWorkflowCallbackBaseUrl", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("uses workflow metadata when no callback override is configured", () => {
    vi.stubEnv("WORKFLOW_LOCAL_BASE_URL", "");

    expect(resolveWorkflowCallbackBaseUrl("http://localhost:3000/")).toBe("http://localhost:3000");
  });

  it("prefers the active local world base URL and removes its trailing slash", () => {
    vi.stubEnv("WORKFLOW_LOCAL_BASE_URL", "http://127.0.0.1:2000/");

    expect(resolveWorkflowCallbackBaseUrl("http://localhost:3000")).toBe("http://127.0.0.1:2000");
  });

  it("appends the configured public route prefix to the resolved base", () => {
    vi.stubEnv("WORKFLOW_LOCAL_BASE_URL", "");
    vi.stubEnv("CORAX_PUBLIC_ROUTE_PREFIX", "/corax/support");

    expect(resolveWorkflowCallbackBaseUrl("https://deployment.example.com/")).toBe(
      "https://deployment.example.com/corax/support",
    );
  });

  it("ignores a public route prefix resolving to the root route", () => {
    vi.stubEnv("WORKFLOW_LOCAL_BASE_URL", "");
    vi.stubEnv("CORAX_PUBLIC_ROUTE_PREFIX", "/");

    expect(resolveWorkflowCallbackBaseUrl("http://localhost:3000")).toBe("http://localhost:3000");
  });
});

describe("createWorkflowCallbackUrl", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("preserves a public route prefix carried by the base URL", () => {
    expect(
      createWorkflowCallbackUrl(
        "https://agent.example.com/corax/support",
        "/corax/v1/callback/corax%3Aparent-token",
      ),
    ).toBe("https://agent.example.com/corax/support/v1/callback/corax%3Aparent-token");
  });
});
