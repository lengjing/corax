import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { fileURLToPath } from "node:url";
import test from "node:test";

const execute = promisify(execFile);

test("npm packaging rejects a tag that does not match the SDK version", async () => {
  await assert.rejects(execute(process.execPath, [fileURLToPath(new URL("../scripts/pack.mjs", import.meta.url))], {
    env: { ...process.env, GITHUB_REF_TYPE: "tag", GITHUB_REF_NAME: "v999.0.0-mismatch" },
    timeout: 10_000,
  }), (error) => {
    assert.match(error.stderr, /must match corax version/);
    return true;
  });
});
