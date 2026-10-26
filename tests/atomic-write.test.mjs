import assert from "node:assert/strict";
import { mkdtemp, readFile, readdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "./support/test.mjs";
import { atomicWriteFile } from "../packages/corax/dist/src/shared/atomic-write-file.js";

test("concurrent same-millisecond atomic writes never share a temporary file", async (t) => {
  const root = await mkdtemp(join(tmpdir(), "corax-atomic-concurrent-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  const target = join(root, "span.json");
  const payloads = Array.from({ length: 12 }, (_, writer) =>
    JSON.stringify({ writer, content: String(writer).repeat(64 * 1024) }),
  );
  const now = Date.now;
  Date.now = () => 1_800_000_000_000;
  let results;
  try {
    results = await Promise.allSettled(payloads.map((payload) => atomicWriteFile(target, payload)));
  } finally {
    Date.now = now;
  }
  assert.deepEqual(
    results.filter((result) => result.status === "rejected"),
    [],
  );
  assert.ok(payloads.includes(await readFile(target, "utf8")), "one complete writer must win");
  assert.deepEqual(await readdir(root), ["span.json"]);
});
