import assert from "node:assert/strict";
import childProcess from "node:child_process";
import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { syncBuiltinESMExports } from "node:module";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import test from "./support/test.mjs";

import { createDevDiagnosticDump } from "../packages/corax/dist/src/cli/dev/diagnostic-dump.js";
import { resolveLocalDevelopmentClientOptions } from "../packages/corax/dist/src/services/dev-client/client-options.js";
import { promptCommandsFor } from "../packages/corax/dist/src/cli/dev/tui/prompt-commands.js";

test("local diagnostic collection needs no external CLI or network", async (t) => {
  const root = await mkdtemp(join(tmpdir(), "corax-diagnostics-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  const calls = [];
  const spawn = t.mock.method(childProcess, "spawn", (...args) => {
    calls.push(args);
    throw new Error("Diagnostics must not launch external commands");
  });
  const fetch = t.mock.method(globalThis, "fetch", async () => {
    throw new Error("Diagnostics must not contact external services");
  });
  syncBuiltinESMExports();
  t.after(() => {
    spawn.mock.restore();
    syncBuiltinESMExports();
  });

  const sessions = join(root, ".corax/.workflow-data");
  await mkdir(sessions, { recursive: true });
  await writeFile(join(sessions, "session.json"), "{}");
  const dump = createDevDiagnosticDump(root, join(root, "development.log"));
  try {
    assert.equal(calls.length, 0, "diagnostics must not spawn a cloud CLI");
    let environment;
    const deadline = Date.now() + 2000;
    while (Date.now() < deadline) {
      const document = await readFile(dump.path, "utf8")
        .then(JSON.parse)
        .catch(() => undefined);
      if (document?.environment) {
        environment = document.environment;
        break;
      }
      await delay(10);
    }
    assert.ok(environment, "local environment diagnostics must finish");
    assert.equal(environment.bunVersion, Bun.version);
    assert.equal(environment.sessionsDirectory.files, 1);
    assert.equal(environment.sessionsDirectory.bytes, 2);
    assert.equal(fetch.mock.callCount(), 0);
  } finally {
    await dump.close();
  }
});

test("local TUI credentials are explicit rather than inherited from a cloud account", () => {
  const options = resolveLocalDevelopmentClientOptions({
    serverUrl: "http://127.0.0.1:2000",
    interactiveClient: true,
    headers: { Authorization: "Basic supplied-by-user" },
  });
  assert.equal(options.auth, undefined);
  assert.equal(options.headers.Authorization, "Basic supplied-by-user");
  assert.equal(
    resolveLocalDevelopmentClientOptions({ serverUrl: "http://127.0.0.1:2000" }).auth,
    undefined,
  );
});

test("local command discovery does not offer the upstream hosted setup flows", () => {
  const names = promptCommandsFor("local").map(({ name }) => name);
  for (const hosted of ["deploy", "login", "model", "add"]) assert.ok(!names.includes(hosted));
  assert.ok(names.includes("info"));
});
