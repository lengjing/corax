import { mkdir, mkdtemp, realpath, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import { resolveCoraxBinaryPath } from "./resolve-corax-binary.js";

// Writes a minimal corax package at `dir` and returns its realpath'd bin path
// (createRequire canonicalizes symlinks, and macOS routes tmpdir through one).
async function writeCoraxPackage(dir: string): Promise<string> {
  await mkdir(join(dir, "bin"), { recursive: true });
  await writeFile(join(dir, "package.json"), JSON.stringify({ name: "corax", version: "0.0.0" }));
  await writeFile(join(dir, "bin", "corax.js"), "#!/usr/bin/env node\n");
  return join(await realpath(dir), "bin", "corax.js");
}

describe("resolveCoraxBinaryPath", () => {
  it("resolves corax hoisted to the workspace root (npm workspaces)", async () => {
    const workspaceRoot = await mkdtemp(join(tmpdir(), "corax-resolve-"));
    const expected = await writeCoraxPackage(join(workspaceRoot, "node_modules", "corax"));

    // The app has no corax under its own node_modules; npm hoisted it up.
    const appRoot = join(workspaceRoot, "apps", "web");
    await mkdir(appRoot, { recursive: true });
    await writeFile(join(appRoot, "package.json"), JSON.stringify({ name: "web" }));

    // realpath both sides so Windows short (8.3) paths compare equal.
    expect(await realpath(resolveCoraxBinaryPath(appRoot))).toBe(expected);
  });

  it("resolves corax through pnpm's virtual-store symlink", async () => {
    const appRoot = await mkdtemp(join(tmpdir(), "corax-resolve-"));
    await writeFile(join(appRoot, "package.json"), JSON.stringify({ name: "web" }));

    // pnpm installs the real package under .pnpm and symlinks node_modules/corax
    // to it; the resolver must follow the link to the store.
    const storeRoot = join(appRoot, "node_modules", ".pnpm", "corax@0.0.0", "node_modules", "corax");
    const expected = await writeCoraxPackage(storeRoot);
    await symlink(storeRoot, join(appRoot, "node_modules", "corax"), "junction");

    expect(await realpath(resolveCoraxBinaryPath(appRoot))).toBe(expected);
  });
});
