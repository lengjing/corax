import { afterEach, describe, expect, it, vi } from "vitest";

import type { DeployedSelfModificationConfig } from "./remote/config.js";
import {
  defineDeployedSelfModificationSandbox,
  selectDeployedSelfModificationEnvironment,
} from "./deployed-sandbox.js";

const connectConfig: DeployedSelfModificationConfig = {
  authorize: () => true,
  credentials: { pat: true },
  source: { git: { directory: ".", repository: "github.com/acme/agent" } },
  target: { branch: "main" },
};

afterEach(() => vi.unstubAllEnvs());

describe("deployed self-modification sandbox", () => {
  it("keeps the self-hosted sandbox even with hosted environment markers", () => {
    expect(
      selectDeployedSelfModificationEnvironment({
        isDeployedOnVercel: () => true,
        isMicrosandboxSupported: () => true,
      }).provider,
    ).toBe("microsandbox");
  });

  it("selects microsandbox on a supported self-hosted system", () => {
    expect(
      selectDeployedSelfModificationEnvironment({
        isDeployedOnVercel: () => false,
        isMicrosandboxSupported: () => true,
      }).provider,
    ).toBe("microsandbox");
  });

  it("fails when no deployed provider is available", () => {
    expect(() =>
      selectDeployedSelfModificationEnvironment({
        isDeployedOnVercel: () => false,
        isMicrosandboxSupported: () => false,
      }),
    ).toThrow("Configure microsandbox on a supported self-hosted system");
  });

  it("does not probe deployed providers during corax dev", () => {
    vi.stubEnv("CORAX_DEV", "1");
    const probes = { isDeployedOnVercel: vi.fn(), isMicrosandboxSupported: vi.fn() };
    expect(defineDeployedSelfModificationSandbox(connectConfig, probes)).toBeTypeOf("function");
    expect(probes.isDeployedOnVercel).not.toHaveBeenCalled();
    expect(probes.isMicrosandboxSupported).not.toHaveBeenCalled();
  });
});
