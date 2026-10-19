import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { cp, mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import test from "./support/test.mjs";

const execute = promisify(execFile);

test("release rejects mismatched runtime identity before building or publishing anything", async (t) => {
  const root = await mkdtemp(join(tmpdir(), "corax-release-version-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  await mkdir(join(root, "scripts"));
  await mkdir(join(root, "packages/corax/scripts"), { recursive: true });
  await cp(new URL("../scripts/release.mjs", import.meta.url), join(root, "scripts/release.mjs"));
  await writeFile(join(root, "package.json"), '{"version":"1.0.0"}');
  await writeFile(join(root, "packages/corax/package.json"), '{"version":"2.0.0"}');
  await writeFile(
    join(root, "packages/corax/scripts/build.mjs"),
    "import {writeFile} from 'node:fs/promises'; export async function buildCore() { await writeFile(new URL('../../../build-ran',import.meta.url),'yes'); }",
  );
  await assert.rejects(
    execute(process.execPath, [join(root, "scripts/release.mjs")], { timeout: 10_000 }),
    (error) => {
      assert.match(error.stderr, /product and core versions must match/);
      return true;
    },
  );
  await assert.rejects(readFile(join(root, "build-ran")), { code: "ENOENT" });
});
