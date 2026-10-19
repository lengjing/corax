import { mkdir, mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, it, vi } from "vitest";

import { CORAX_BASE_URL_ENV, resolveSharedCoraxDevServer } from "./dev-server.js";

async function createTempAppRoot(): Promise<string> {
  return await mkdtemp(join(tmpdir(), "corax-sveltekit-dev-server-"));
}

async function writeRegistry(appRoot: string, registry: Record<string, unknown>): Promise<void> {
  await mkdir(join(appRoot, ".corax"), { recursive: true });
  await writeFile(
    join(appRoot, ".corax", "sveltekit-dev-server.json"),
    `${JSON.stringify(registry, null, 2)}\n`,
  );
}

afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
  delete process.env[CORAX_BASE_URL_ENV];
});

describe("resolveSharedCoraxDevServer", () => {
  it("reuses a ready registered server instead of spawning", async () => {
    const appRoot = await createTempAppRoot();
    const fetchMock = vi.fn(async () => Response.json({ revision: "rev-1" }));
    vi.stubGlobal("fetch", fetchMock);

    await writeRegistry(appRoot, {
      appRoot,
      origin: "http://127.0.0.1:49152",
      pid: null,
      updatedAt: new Date().toISOString(),
    });

    const handle = await resolveSharedCoraxDevServer(appRoot);

    expect(handle).toEqual({ origin: "http://127.0.0.1:49152" });
    expect(handle.process).toBeUndefined();
    expect(process.env[CORAX_BASE_URL_ENV]).toBe("http://127.0.0.1:49152");
    expect(fetchMock).toHaveBeenCalledWith(
      new URL("/corax/v1/dev/runtime-artifacts", "http://127.0.0.1:49152"),
      { redirect: "error", signal: expect.any(AbortSignal) },
    );
  });
});
