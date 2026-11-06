import { test } from "node:test";
import assert from "node:assert/strict";
import { resolve, join } from "node:path";
import { resolveCoraxDataDirectory, isCoraxDataPath } from "../packages/corax/src/shared/data-directory.ts";
import { resolveRuntimeCompilerArtifactPaths } from "../packages/corax/src/runtime/loaders/artifact-paths.ts";

test("configured data root only redirects the authored application, not isolated compiler roots", () => {
  const previous = { root: process.env.CORAX_PROJECT_ROOT, data: process.env.CORAX_DATA_DIR };
  try {
    const root = resolve("fixture");
    process.env.CORAX_PROJECT_ROOT = root;
    process.env.CORAX_DATA_DIR = ".auto-agent/corax";
    assert.equal(resolveCoraxDataDirectory(root), join(root, ".auto-agent", "corax"));
    assert.equal(resolveRuntimeCompilerArtifactPaths(root).compileDirectoryPath, join(root, ".auto-agent", "corax", "compile").replaceAll("\\", "/"));
    assert.equal(isCoraxDataPath(join(root, ".auto-agent/corax/logs/test")), true);
    assert.equal(isCoraxDataPath(join(root, "tools/wiki.ts")), false);
    assert.equal(resolveCoraxDataDirectory(join(root, "isolated")), join(root, "isolated", ".corax"));
    delete process.env.CORAX_DATA_DIR;
    assert.equal(resolveCoraxDataDirectory(root), join(root, ".corax"));
  } finally {
    if (previous.root === undefined) delete process.env.CORAX_PROJECT_ROOT; else process.env.CORAX_PROJECT_ROOT = previous.root;
    if (previous.data === undefined) delete process.env.CORAX_DATA_DIR; else process.env.CORAX_DATA_DIR = previous.data;
  }
});
