import { mkdir, mkdtemp, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("#shared/resolve-corax-binary.js", async () => {
  const { join } = await import("node:path");
  return {
    // Pin resolution to the conventional app-local path so build-command
    // assertions stay deterministic without a real corax install on disk. The
    // real resolver is exercised in resolve-corax-binary.integration.test.ts.
    resolveCoraxBinaryPath: (appRoot: string) =>
      join(appRoot, "node_modules", "corax", "bin", "corax.js"),
  };
});

import { ensureCoraxVercelServicesConfig } from "#shared/vercel-services.js";

async function createTempHostRoot(): Promise<string> {
  return await mkdtemp(join(tmpdir(), "corax-vercel-services-"));
}

async function directoryExists(path: string): Promise<boolean> {
  try {
    return (await stat(path)).isDirectory();
  } catch {
    return false;
  }
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe("ensureCoraxVercelServicesConfig", () => {
  it("generates the corax service when vercel.json is missing", async () => {
    const hostRoot = await createTempHostRoot();

    const result = await ensureCoraxVercelServicesConfig({
      appRoot: hostRoot,
      frameworkName: "Test",
      hostRoot: hostRoot,
    });

    expect(result).toEqual({
      mode: "generated",
      services: {
        corax: {
          buildCommand:
            "cd '../../..' && export CORAX_INTERNAL_BUILD_OUTPUT_DIRECTORY='.corax/vercel-services/corax/.vercel/output' && export CORAX_INTERNAL_HOST_BUILD_OUTPUT_DIRECTORY='.vercel/output' && node 'node_modules/corax/bin/corax.js' build",
          framework: "corax",
          outputDirectory: ".vercel/output",
          routes: [
            {
              src: "^/corax/v1/(.*)$",
              transforms: [
                {
                  args: "/corax/v1/$1",
                  op: "set",
                  type: "request.path",
                },
              ],
            },
          ],
          root: ".corax/vercel-services/corax",
        },
      },
    });
  });

  it("creates the isolated service build root", async () => {
    const hostRoot = await createTempHostRoot();

    await ensureCoraxVercelServicesConfig({
      appRoot: hostRoot,
      frameworkName: "Test",
      hostRoot: hostRoot,
    });

    expect(await directoryExists(join(hostRoot, ".corax", "vercel-services", "corax"))).toBe(true);
  });

  it("uses a custom corax build command verbatim", async () => {
    const hostRoot = await createTempHostRoot();

    const result = await ensureCoraxVercelServicesConfig({
      appRoot: hostRoot,
      coraxBuildCommand: "pnpm build:corax",
      frameworkName: "Test",
      hostRoot: hostRoot,
    });

    expect(result.mode).toBe("generated");
    expect(result.mode === "generated" && result.services.corax?.buildCommand).toBe(
      "cd '../../..' && export CORAX_INTERNAL_BUILD_OUTPUT_DIRECTORY='.corax/vercel-services/corax/.vercel/output' && export CORAX_INTERNAL_HOST_BUILD_OUTPUT_DIRECTORY='.vercel/output' && pnpm build:corax",
    );
  });

  it("resolves relative paths for an corax app in a subdirectory", async () => {
    const hostRoot = await createTempHostRoot();
    const appRoot = join(hostRoot, "agent");
    await mkdir(appRoot, { recursive: true });

    const result = await ensureCoraxVercelServicesConfig({
      appRoot,
      frameworkName: "Test",
      hostRoot: hostRoot,
    });

    expect(result.mode === "generated" && result.services.corax?.buildCommand).toBe(
      "cd '../../../agent' && export CORAX_INTERNAL_BUILD_OUTPUT_DIRECTORY='../.corax/vercel-services/corax/.vercel/output' && export CORAX_INTERNAL_HOST_BUILD_OUTPUT_DIRECTORY='../.vercel/output' && node '../node_modules/corax/bin/corax.js' build",
    );
  });

  it("reads vercel.json from a linked Vercel project root", async () => {
    const projectRoot = await createTempHostRoot();
    const hostRoot = join(projectRoot, "apps", "web");
    await mkdir(join(projectRoot, ".vercel"), { recursive: true });
    await writeFile(join(projectRoot, ".vercel", "project.json"), "{}\n");
    await mkdir(hostRoot, { recursive: true });
    await writeFile(
      join(projectRoot, "vercel.json"),
      `${JSON.stringify({
        services: {
          web: { root: "apps/web", framework: "nuxtjs" },
          corax: { root: "agent", framework: "corax" },
        },
      })}\n`,
    );

    const result = await ensureCoraxVercelServicesConfig({
      appRoot: hostRoot,
      frameworkName: "Test",
      hostRoot: hostRoot,
    });

    expect(result).toEqual({ mode: "root" });
  });

  it("prefers the host root vercel.json services over the linked project root's", async () => {
    const projectRoot = await createTempHostRoot();
    const hostRoot = join(projectRoot, "apps", "web");
    await mkdir(join(projectRoot, ".vercel"), { recursive: true });
    await writeFile(join(projectRoot, ".vercel", "project.json"), "{}\n");
    await mkdir(hostRoot, { recursive: true });
    await writeFile(join(projectRoot, "vercel.json"), `${JSON.stringify({})}\n`);
    await writeFile(
      join(hostRoot, "vercel.json"),
      `${JSON.stringify({
        services: {
          web: { root: ".", framework: "nuxtjs" },
          corax: { root: "agent", framework: "corax" },
        },
      })}\n`,
    );

    const result = await ensureCoraxVercelServicesConfig({
      appRoot: hostRoot,
      frameworkName: "Test",
      hostRoot: hostRoot,
    });

    expect(result).toEqual({ mode: "root" });
  });

  it("generates nothing when vercel.json declares services including corax", async () => {
    const hostRoot = await createTempHostRoot();
    await writeFile(
      join(hostRoot, "vercel.json"),
      `${JSON.stringify({
        services: {
          web: { root: ".", framework: "nuxtjs" },
          agent: { root: "agent", framework: "corax" },
        },
      })}\n`,
    );

    const result = await ensureCoraxVercelServicesConfig({
      appRoot: hostRoot,
      frameworkName: "Test",
      hostRoot: hostRoot,
    });

    expect(result).toEqual({ mode: "root" });
    expect(await directoryExists(join(hostRoot, ".corax", "vercel-services"))).toBe(false);
  });

  it("accepts the named service array form", async () => {
    const hostRoot = await createTempHostRoot();
    await writeFile(
      join(hostRoot, "vercel.json"),
      `${JSON.stringify({
        services: [
          { name: "web", root: ".", framework: "nuxtjs" },
          { name: "corax", root: "agent", framework: "corax" },
        ],
      })}\n`,
    );

    await expect(
      ensureCoraxVercelServicesConfig({
        appRoot: hostRoot,
        frameworkName: "Test",
        hostRoot: hostRoot,
      }),
    ).resolves.toEqual({ mode: "root" });
  });

  it("throws when vercel.json services omit the corax service", async () => {
    const hostRoot = await createTempHostRoot();
    await writeFile(
      join(hostRoot, "vercel.json"),
      `${JSON.stringify({ services: { web: { root: ".", framework: "nuxtjs" } } })}\n`,
    );

    await expect(
      ensureCoraxVercelServicesConfig({
        appRoot: hostRoot,
        frameworkName: "Test",
        hostRoot: hostRoot,
      }),
    ).rejects.toThrow(/already defines services/);
  });

  it("warns and generates when vercel.json only has legacy experimentalServices", async () => {
    const hostRoot = await createTempHostRoot();
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    await writeFile(
      join(hostRoot, "vercel.json"),
      `${JSON.stringify({
        experimentalServices: {
          web: { entrypoint: ".", framework: "nuxtjs", routePrefix: "/" },
          corax: { entrypoint: ".", framework: "corax", routePrefix: "/_corax_internal/corax" },
        },
      })}\n`,
    );

    const result = await ensureCoraxVercelServicesConfig({
      appRoot: hostRoot,
      frameworkName: "Test",
      hostRoot: hostRoot,
    });

    expect(result.mode).toBe("generated");
    expect(warn).toHaveBeenCalledWith(expect.stringContaining("experimentalServices"));
  });

  it("prefers stable services over legacy experimentalServices without warning", async () => {
    const hostRoot = await createTempHostRoot();
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    await writeFile(
      join(hostRoot, "vercel.json"),
      `${JSON.stringify({
        experimentalServices: { corax: { entrypoint: ".", framework: "corax", routePrefix: "/x" } },
        services: { corax: { root: ".", framework: "corax" } },
      })}\n`,
    );

    const result = await ensureCoraxVercelServicesConfig({
      appRoot: hostRoot,
      frameworkName: "Test",
      hostRoot: hostRoot,
    });

    expect(result).toEqual({ mode: "root" });
    expect(warn).not.toHaveBeenCalled();
  });

  it("rejects a malformed vercel.json", async () => {
    const hostRoot = await createTempHostRoot();
    await writeFile(join(hostRoot, "vercel.json"), `["not", "an", "object"]\n`);

    await expect(
      ensureCoraxVercelServicesConfig({
        appRoot: hostRoot,
        frameworkName: "Test",
        hostRoot: hostRoot,
      }),
    ).rejects.toThrow(/must contain a JSON object/);
  });
});
