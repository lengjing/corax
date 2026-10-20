import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const packageInfo = vi.hoisted(() => ({ name: "corax", version: "1.2.3" }));
vi.mock("#internal/application/package.js", () => ({
  resolveInstalledPackageInfo: () => packageInfo,
}));

import {
  DEFAULT_CORAX_SANDBOX_IMAGE,
  resolveCoraxSandboxImage,
} from "#execution/sandbox/bindings/corax-image.js";

describe("corax sandbox image", () => {
  beforeEach(() => {
    packageInfo.version = "1.2.3";
    vi.stubEnv("CORAX_SANDBOX_IMAGE_TAG", "");
  });
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.resetModules();
  });

  it("uses the versioned GHCR image", () => {
    expect(resolveCoraxSandboxImage()).toBe("ghcr.io/vercel/eve:1.2.3");
    expect(DEFAULT_CORAX_SANDBOX_IMAGE).toBe("ghcr.io/vercel/eve:1.2.3");
  });

  it.each([
    ["0.56.0+git.4c27b3e37fa36d84", "0.56.0"],
    ["0.56.0+main.4c27b3e37fa36d84", "0.56.0"],
    ["0.56.0-beta.1+git.4c27b3e37fa36d84", "0.56.0-beta.1"],
  ])("uses the release image for artifact version %s", async (version, tag) => {
    packageInfo.version = version;
    vi.resetModules();
    const images = await import("#execution/sandbox/bindings/corax-image.js");
    expect(images.resolveCoraxSandboxImage()).toBe(`ghcr.io/vercel/eve:${tag}`);
    expect(images.DEFAULT_CORAX_SANDBOX_IMAGE).toBe(`ghcr.io/vercel/eve:${tag}`);
  });

  it("uses CORAX_SANDBOX_IMAGE_TAG when set", async () => {
    packageInfo.version = "0.56.0+git.4c27b3e37fa36d84";
    vi.stubEnv("CORAX_SANDBOX_IMAGE_TAG", "latest");
    vi.resetModules();

    const images = await import("#execution/sandbox/bindings/corax-image.js");
    expect(images.resolveCoraxSandboxImage()).toBe("ghcr.io/vercel/eve:latest");
    expect(images.DEFAULT_CORAX_SANDBOX_IMAGE).toBe("ghcr.io/vercel/eve:latest");
  });
});
