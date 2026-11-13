import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { mkdtemp, readdir, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { performance } from "node:perf_hooks";
import { promisify } from "node:util";
import { fileURLToPath } from "node:url";

const run = "wrun_benchmark";
const stream = "strm_benchmark";
const payloadBytes = 350;
const [mode, dataDir, countArg] = process.argv.slice(2);
if (mode === "seed" || mode === "read") {
  const count = Number(countArg);
  if (!Number.isSafeInteger(count) || count < 1 || count > 100_000)
    throw new Error("Invalid sample size");
  const { createWorld } =
    await import("../packages/corax/dist/src/compiled/@workflow/world-local/index.js");
  const world = createWorld({ dataDir, recoverActiveRuns: false, queueAuthKey: "read" });
  try {
    if (mode === "seed") {
      for (let offset = 0; offset < count; offset += 512)
        await world.streams.writeMulti(
          run,
          stream,
          Array.from({ length: Math.min(512, count - offset) }, () =>
            Buffer.alloc(payloadBytes, 120),
          ),
        );
      await world.streams.close(run, stream);
      assert.equal((await readdir(dataDir)).includes("streams"), false);
      console.log(
        JSON.stringify({
          phase: "seed",
          chunks: count,
          databaseBytes: (await stat(join(dataDir, "world.db"))).size,
        }),
      );
    } else {
      const started = performance.now();
      const info = await world.streams.getInfo(run, stream);
      const coldTailMs = performance.now() - started;
      assert.deepEqual(info, { tailIndex: count - 1, done: true });
      const tailStarted = performance.now();
      const page = await world.streams.getChunks(run, stream, {
        cursor: Buffer.from(JSON.stringify({ i: Math.max(0, count - 512) })).toString("base64"),
        limit: 512,
      });
      const tail512Ms = performance.now() - tailStarted;
      assert.equal(page.data.length, Math.min(512, count));
      const fullStarted = performance.now();
      const reader = (await world.streams.get(run, stream, 0)).getReader();
      let bytes = 0;
      while (true) {
        const next = await reader.read();
        if (next.done) break;
        bytes += next.value.byteLength;
      }
      assert.equal(bytes, count * payloadBytes);
      console.log(
        JSON.stringify({
          phase: "fresh-process-read",
          chunks: count,
          bytes,
          coldTailMs: Number(coldTailMs.toFixed(2)),
          tail512Ms: Number(tail512Ms.toFixed(2)),
          fullReadMs: Number((performance.now() - fullStarted).toFixed(2)),
        }),
      );
    }
  } finally {
    await world.close();
  }
} else {
  const root = await mkdtemp(join(tmpdir(), "corax-sqlite-benchmark-"));
  try {
    const execute = promisify(execFile);
    for (const phase of ["seed", "read"]) {
      const result = await execute(
        process.execPath,
        [fileURLToPath(import.meta.url), phase, root, "20000"],
        { timeout: 60_000 },
      );
      process.stdout.write(result.stdout);
    }
  } finally {
    await rm(root, { recursive: true, force: true, maxRetries: 5 });
  }
}
