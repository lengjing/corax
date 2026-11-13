import assert from "node:assert/strict";
import fs from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";

// Verify the installed tarball, not checkout sources or a developer's runtime data.
const [packageRoot] = process.argv.slice(2);
const load = (path) => import(pathToFileURL(join(packageRoot, "dist/src", path)).href);
const { createWorld } = await load("compiled/@workflow/world-local/index.js");
const scopeURL = pathToFileURL(join(packageRoot, "dist/src/execution/history-read-scope.js"));
const scope = await import(scopeURL.href);
const copy = await import(`${scopeURL.href}?other-bundle`);
const { coraxChannel } = await load("public/channels/corax.js");
const { none } = await load("public/channels/auth.js");
const root = await fs.mkdtemp(join(tmpdir(), "corax-packed-history-"));
const run = "wrun_01M6JWQZ0A0QH6MERWTZ96Z7TB";
const stream = "strm_fixture";
const count = 65;
const realOpen = fs.open;
let opens = 0;
let world;
try {
  world = createWorld({ dataDir: root, recoverActiveRuns: false, queueAuthKey: "read" });
  await world.streams.writeMulti(
    run,
    stream,
    Array.from({ length: count }, () => "fixture"),
  );
  assert.equal((await fs.stat(join(root, "world.db"))).isFile(), true);
  assert.equal((await fs.readdir(root)).includes("streams"), false);
  await world.close();
  world = createWorld({ dataDir: root, recoverActiveRuns: false, queueAuthKey: "read" });
  fs.open = async (...args) => {
    opens++;
    return realOpen(...args);
  };
  assert.deepEqual(await world.streams.getInfo(run, stream), { tailIndex: 64, done: false });
  assert.equal(opens, 0);
  opens = 0;
  assert.deepEqual(await world.streams.getInfo(run, stream), { tailIndex: 64, done: false });
  assert.equal(opens, 0);

  let scans = 0;
  const read = async () => {
    scans++;
    return (await world.streams.getInfo(run, stream)).tailIndex;
  };
  await scope.withHistoryReadScope(run, async () => {
    assert.equal(await scope.readScopedTail(run, read), 64);
    assert.equal(await copy.readScopedTail(run, read), 64);
  });
  assert.equal(scans, 1);
  assert.equal(await copy.readScopedTail(run, read), 64);
  assert.equal(scans, 2);

  scans = 0;
  const getTail = () => scope.readScopedTail(run, read);
  const session = {
    id: run,
    getStreamTailIndex: getTail,
    async getEventStream(options) {
      const tail = await getTail();
      const start = options.startIndex < 0 ? Math.max(0, tail + 1 + options.startIndex) : 0;
      return new ReadableStream({
        start(controller) {
          for (let index = start; index <= tail; index++)
            controller.enqueue({ type: "fixture", data: { index } });
          controller.close();
        },
      });
    },
  };
  const channel = coraxChannel({ auth: none() });
  const route = channel.routes.find(
    (entry) => entry.method === "GET" && entry.path === "/corax/v1/session/:sessionId/stream",
  );
  const response = await route.handler(
    new Request(`http://localhost/corax/v1/session/${run}/stream?follow=false&startIndex=-2`),
    { params: { sessionId: run }, attachSession: () => session },
  );
  assert.equal(response.status, 200);
  assert.equal(response.headers.get("x-corax-stream-tail-index"), "64");
  assert.deepEqual(
    (await response.text())
      .trim()
      .split("\n")
      .map((line) => JSON.parse(line).data.index),
    [63, 64],
  );
  assert.equal(scans, 1);
  console.log("HISTORY_READ_SMOKE=ok");
} finally {
  fs.open = realOpen;
  await world?.close?.();
  await fs.rm(root, { recursive: true, force: true, maxRetries: 5 });
}
