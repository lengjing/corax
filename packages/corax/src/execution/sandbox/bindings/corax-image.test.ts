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

  it("uses the pinned upstream GHCR image", () => {
    expect(resolveCoraxSandboxImage()).toBe("ghcr.io/vercel/eve:0.79.1");
    expect(DEFAULT_CORAX_SANDBOX_IMAGE).toBe("ghcr.io/vercel/eve:0.79.1");
  });

  it.each([
    "0.1.0",
    "1.2.3",
    "0.56.0+git.4c27b3e37fa36d84",
    "0.56.0-beta.1+git.4c27b3e37fa36d84",
  ])("keeps the upstream image independent of Corax version %s", async (version) => {
    packageInfo.version = version;
    vi.resetModules();
    const images = await import("#execution/sandbox/bindings/corax-image.js");
    expect(images.resolveCoraxSandboxImage()).toBe("ghcr.io/vercel/eve:0.79.1");
    expect(images.DEFAULT_CORAX_SANDBOX_IMAGE).toBe("ghcr.io/vercel/eve:0.79.1");
  });

  it("uses CORAX_SANDBOX_IMAGE_TAG when set", async () => {
    packageInfo.version = "0.56.0+git.4c27b3e37fa36d84";
    vi.stubEnv("CORAX_SANDBOX_IMAGE_TAG", "latest");
    vi.resetModules();

    const images = await import("#execution/sandbox/bindings/corax-image.js");
    expect(images.resolveCoraxSandboxImage()).toBe("ghcr.io/vercel/eve:latest");
    expect(images.DEFAULT_CORAX_SANDBOX_IMAGE).toBe("ghcr.io/vercel/eve:latest");
  });

  it.each(["", "   ", " custom-tag "])(
    "resolves provider defaults and explicit image overrides with tag %j",
    async (tag) => {
      vi.stubEnv("CORAX_SANDBOX_IMAGE_TAG", tag);
      vi.resetModules();
      const { resolveDockerSandboxOptions } = await import("./docker-options.js");
      const { resolveMicrosandboxOptions } = await import("./microsandbox-options.js");
      const expected = `ghcr.io/vercel/eve:${tag.trim() || "0.79.1"}`;
      expect(resolveDockerSandboxOptions().image).toBe(expected);
      expect(resolveMicrosandboxOptions(undefined).image).toBe(expected);
      expect(resolveDockerSandboxOptions({ image: "custom/image:fixed" }).image).toBe(
        "custom/image:fixed",
      );
      expect(resolveMicrosandboxOptions({ image: "custom/image:fixed" }).image).toBe(
        "custom/image:fixed",
      );
    },
  );
});
