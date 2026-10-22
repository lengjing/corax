import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { access, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import test from "./support/test.mjs";
import { sqliteMemory } from "../packages/corax/dist/src/public/memory/file/backends/sqlite.js";
import { defaultFileMemoryBackend } from "../packages/corax/dist/src/public/memory/file/backends/default.js";

const execute = promisify(execFile);
const moduleURL = new URL(
  "../packages/corax/dist/src/public/memory/file/backends/sqlite.js",
  import.meta.url,
).href;

async function database(t) {
  const root = await mkdtemp(join(tmpdir(), "corax-memory-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  return join(root, "memory.sqlite");
}

test("memory survives a new backend instance and stale versions cannot overwrite it", async (t) => {
  const path = await database(t);
  const signal = new AbortController().signal;
  const first = sqliteMemory({ path });
  const created = await first.write({
    key: "alice",
    content: "first",
    expectedVersion: null,
    signal,
  });
  const second = sqliteMemory({ path });
  assert.deepEqual(await second.read({ key: "alice", signal }), created);
  const updated = await second.write({
    key: "alice",
    content: "second",
    expectedVersion: created.version,
    signal,
  });
  await assert.rejects(
    first.write({ key: "alice", content: "stale", expectedVersion: created.version, signal }),
    { name: "MemoryDocumentConflictError" },
  );
  await assert.rejects(
    first.write({ key: "alice", content: "duplicate", expectedVersion: null, signal }),
    { name: "MemoryDocumentConflictError" },
  );
  assert.deepEqual(await first.read({ key: "alice", signal }), updated);
  assert.equal(await first.read({ key: "bob", signal }), null);
});

test("two independent processes cannot both win a memory compare-and-swap", async (t) => {
  const path = await database(t);
  const backend = sqliteMemory({ path });
  const signal = new AbortController().signal;
  const created = await backend.write({
    key: "shared",
    content: "initial",
    expectedVersion: null,
    signal,
  });
  const script = `import {sqliteMemory} from ${JSON.stringify(moduleURL)};
try { await sqliteMemory({path:process.argv[1]}).write({key:'shared', content:process.argv[2], expectedVersion:process.argv[3], signal:new AbortController().signal}); console.log('won'); }
catch(error) { if(error.name!=='MemoryDocumentConflictError') throw error; console.log('conflict'); }`;
  const results = await Promise.all(
    ["worker-a", "worker-b"].map((name) =>
      execute(
        process.execPath,
        ["-e", script, path, name, created.version],
        { timeout: 10_000 },
      ),
    ),
  );
  assert.deepEqual(results.map(({ stdout }) => stdout.trim()).sort(), ["conflict", "won"]);
  assert.ok(
    ["worker-a", "worker-b"].includes((await backend.read({ key: "shared", signal })).content),
  );
});

test("default memory persists locally even when cloud environment markers are present", async (t) => {
  const root = await mkdtemp(join(tmpdir(), "corax-memory-"));
  const previous = { cwd: process.cwd(), vercel: process.env.VERCEL };
  process.chdir(root);
  process.env.VERCEL = "1";
  t.after(async () => {
    process.chdir(previous.cwd);
    if (previous.vercel === undefined) delete process.env.VERCEL;
    else process.env.VERCEL = previous.vercel;
    await rm(root, { recursive: true, force: true });
  });
  const signal = new AbortController().signal;
  const saved = await defaultFileMemoryBackend().write({
    key: "private",
    content: "local",
    expectedVersion: null,
    signal,
  });
  await access(join(root, ".corax", "memory.sqlite"));
  assert.deepEqual(await defaultFileMemoryBackend().read({ key: "private", signal }), saved);
  const aborted = AbortSignal.abort();
  await assert.rejects(
    defaultFileMemoryBackend().write({
      key: "private",
      content: "cancelled",
      expectedVersion: saved.version,
      signal: aborted,
    }),
    { name: "AbortError" },
  );
  assert.deepEqual(await defaultFileMemoryBackend().read({ key: "private", signal }), saved);
});
