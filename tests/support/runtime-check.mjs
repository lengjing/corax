import assert from "node:assert/strict";
import { join } from "node:path";
import { pathToFileURL } from "node:url";

// Isolate loaded native assets and workers so Windows can remove the fixture after exit.
const [root, project] = process.argv.slice(2);
process.chdir(project);
let production;
let development;
try {
  const load = (name) => import(pathToFileURL(join(root,
    `node_modules/@coraxjs/core/dist/src/internal/nitro/host/${name}.js`)).href);
  const { startProductionServer } = await load("start-production-server");
  production = await startProductionServer(project, { host: "127.0.0.1", port: 0 });
  const health = await fetch(new URL("/corax/v1/health", production.url));
  assert.equal(health.status, 200, await health.text());
  const denied = await fetch(new URL("/corax/v1/info", production.url));
  assert.equal(denied.status, 401);
  await denied.body?.cancel();
  const accepted = await fetch(new URL("/corax/v1/info", production.url), {
    headers: { authorization: `Basic ${Buffer.from("smoke-user:smoke-password").toString("base64")}` },
  });
  assert.equal(accepted.status, 200, await accepted.text());
  // Skipping a live tail scan must still reject missing history before HTTP 200.
  const missing = "wrun_01M6JWQZ0A0QH6MERWTZ96Z7TB";
  for (const suffix of ["?startIndex=0", "?follow=false"]) {
    const history = await fetch(new URL(`/corax/v1/session/${missing}/stream${suffix}`, production.url), {
      headers: { authorization: `Basic ${Buffer.from("smoke-user:smoke-password").toString("base64")}` },
    });
    assert.equal(history.status, 404, await history.text());
  }
  await production.close();
  production = undefined;

  const { createDevelopmentServer } = await import(pathToFileURL(join(root,
    "node_modules/@coraxjs/core/dist/src/cli/dev/local-server-process.js")).href);
  development = createDevelopmentServer(project, {
    host: "127.0.0.1", port: 0, developmentExtensions: { enabled: [] },
  });
  const handle = await development.start();
  const response = await fetch(new URL("/corax/v1/health", handle.url));
  assert.equal(response.status, 200, await response.text());
  console.log("RUNTIME_SMOKE=ok");
} catch (error) {
  console.error(error);
  process.exitCode = 1;
} finally {
  await development?.close();
  await production?.close();
}
process.exit(process.exitCode ?? 0);
