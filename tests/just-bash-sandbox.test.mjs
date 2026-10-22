import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "./support/test.mjs";
import { executeBashOnSandbox } from "../packages/corax/dist/src/execution/sandbox/bash.js";
import {
  createBashSandbox,
  createJustBashHandle,
} from "../packages/corax/dist/src/execution/sandbox/bindings/just-bash-runtime.js";

// Vitest runs its workers under Node, where just-bash and Bun's lazily built
// FileHandle registry never collide; only Bun Test exercises the real runtime.
test("just-bash redirections write through under Bun", async (t) => {
  const rootPath = await mkdtemp(join(tmpdir(), "corax-just-bash-"));
  const host = {
    loadOptionalPackage: async ({ importModule }) => importModule(),
    resolveProjectPath: (path) => path,
  };
  const sandbox = await createBashSandbox({
    autoInstall: false,
    host,
    rootPath,
    sessionKey: "test",
    storagePath: rootPath,
  });
  const handle = createJustBashHandle(sandbox);
  t.after(async () => {
    await handle.onRuntimeShutdown();
    await rm(rootPath, { recursive: true, force: true });
  });

  const silenced = await executeBashOnSandbox(handle.sandbox, {
    command: "echo hidden >/dev/null 2>&1; echo rc=$?",
  });
  assert.equal(silenced.exitCode, 0, silenced.stderr);
  assert.equal(silenced.stdout.trim(), "rc=0");

  const written = await executeBashOnSandbox(handle.sandbox, {
    command: "printf 'a\\nb\\n' > /tmp/lines && tail -1 /tmp/lines",
  });
  assert.equal(written.exitCode, 0, written.stderr);
  assert.equal(written.stdout.trim(), "b");
});
