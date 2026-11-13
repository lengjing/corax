import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";
import {
  verifyWorkflowWorldLocalSource,
  workflowWorldLocalCommit,
} from "../packages/corax/scripts/vendor-compiled/@workflow/world-local-source.mjs";

test("the checked-in official SQLite World sources match the pinned provenance", async () => {
  const source = fileURLToPath(new URL("../vendor/workflow-world-local/", import.meta.url));
  const files = await verifyWorkflowWorldLocalSource(source);
  assert.ok(files.includes("src/db/schema.ts"));
  assert.ok(files.includes("src/streamer.ts"));
  assert.ok(files.includes("LICENSE"));
});

test("vendoring refuses modified source bytes instead of silently bundling them", async (t) => {
  const root = await mkdtemp(join(tmpdir(), "corax-world-provenance-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  await mkdir(join(root, "src"));
  const source = "export const fixture = 1;\n";
  await writeFile(
    join(root, "UPSTREAM.json"),
    JSON.stringify({
      repository: "vercel/workflow",
      commit: workflowWorldLocalCommit,
      files: { "src/index.ts": createHash("sha256").update(source).digest("hex") },
    }),
  );
  await writeFile(join(root, "src/index.ts"), source);
  assert.deepEqual(await verifyWorkflowWorldLocalSource(root), ["src/index.ts"]);
  await writeFile(join(root, "src/index.ts"), "changed\n");
  await assert.rejects(verifyWorkflowWorldLocalSource(root), /integrity mismatch/);
});
