import { describe, expect, it } from "vitest";

import {
  resolveGatewayCredential,
  resolveModelEndpointStatus,
} from "./resolve-model-endpoint-status.js";

describe("resolveModelEndpointStatus", () => {
  it("reports an external endpoint without a connectedness claim", () => {
    expect(
      resolveModelEndpointStatus(
        { kind: "external", provider: "anthropic" },
        { apiKey: false, oidc: false },
      ),
    ).toEqual({ kind: "external", provider: "anthropic" });
  });

  it("reports brokered ChatGPT readiness for the Codex provider", () => {
    expect(
      resolveModelEndpointStatus(
        { kind: "external", provider: "codex" },
        { apiKey: false, oidc: false },
        { state: "reauth-required" },
      ),
    ).toEqual({ kind: "chatgpt", state: "reauth-required" });
  });

  it("reports gateway connected via api-key, which outranks oidc", () => {
    expect(
      resolveModelEndpointStatus(
        { kind: "gateway", target: "openai" },
        { apiKey: true, oidc: true },
      ),
    ).toEqual({ kind: "gateway", connected: true, credential: "api-key" });
  });

  it("does not treat a hosted OIDC token as a self-hosted gateway credential", () => {
    expect(
      resolveModelEndpointStatus(
        { kind: "gateway", target: "openai" },
        { apiKey: false, oidc: true },
      ),
    ).toEqual({ kind: "gateway", connected: false });
  });

  it("reports gateway not connected when neither credential is present", () => {
    expect(
      resolveModelEndpointStatus(
        { kind: "gateway", target: "openai" },
        { apiKey: false, oidc: false },
      ),
    ).toEqual({ kind: "gateway", connected: false });
  });
});

describe("resolveGatewayCredential", () => {
  it("ranks an env-file key first, attributing its location", () => {
    expect(
      resolveGatewayCredential({ apiKeyFile: ".env.local", apiKeyInEnv: true, oidcFile: ".env" }),
    ).toEqual({
      credential: "api-key",
      source: { kind: "env-file", path: ".env.local" },
    });
  });

  it("ranks a shell key over an OIDC token", () => {
    expect(resolveGatewayCredential({ apiKeyInEnv: true, oidcAvailable: true })).toEqual({
      credential: "api-key",
      source: { kind: "shell" },
    });
  });

  it("does not fall back to hosted OIDC credentials", () => {
    expect(resolveGatewayCredential({ oidcFile: ".env.local" })).toBeUndefined();
    expect(resolveGatewayCredential({ oidcAvailable: true })).toBeUndefined();
  });

  it("resolves nothing when no credential is observable", () => {
    expect(resolveGatewayCredential({})).toBeUndefined();
  });
});
