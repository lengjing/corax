import { test, expect } from "bun:test";
import { resolve, join } from "node:path";
import { resolveCoraxDataDirectory, isCoraxDataPath } from "../packages/corax/src/shared/data-directory.ts";
import { resolveRuntimeCompilerArtifactPaths } from "../packages/corax/src/runtime/loaders/artifact-paths.ts";

test("configured data root only redirects the authored application, not isolated compiler roots", () => {
  const previous = { root: process.env.CORAX_PROJECT_ROOT, data: process.env.CORAX_DATA_DIR };
  try {
    const root = resolve("fixture");
    process.env.CORAX_PROJECT_ROOT = root;
    process.env.CORAX_DATA_DIR = ".auto-agent/corax";
    expect(resolveCoraxDataDirectory(root)).toBe(join(root, ".auto-agent", "corax"));
    expect(resolveRuntimeCompilerArtifactPaths(root).compileDirectoryPath).toBe(join(root, ".auto-agent", "corax", "compile").replaceAll("\\", "/"));
    expect(isCoraxDataPath(join(root, ".auto-agent/corax/logs/test"))).toBe(true);
    expect(isCoraxDataPath(join(root, "tools/wiki.ts"))).toBe(false);
    expect(resolveCoraxDataDirectory(join(root, "isolated"))).toBe(join(root, "isolated", ".corax"));
    delete process.env.CORAX_DATA_DIR;
    expect(resolveCoraxDataDirectory(root)).toBe(join(root, ".corax"));
  } finally {
    if (previous.root === undefined) delete process.env.CORAX_PROJECT_ROOT; else process.env.CORAX_PROJECT_ROOT = previous.root;
    if (previous.data === undefined) delete process.env.CORAX_DATA_DIR; else process.env.CORAX_DATA_DIR = previous.data;
  }
});
