import assert from "node:assert/strict";
import { mkdtemp, mkdir, readFile, rm, utimes, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "./support/test.mjs";

import { ensureBuiltCli } from "../packages/corax/bin/corax.js";

async function fixture(t, { stale = false, failing = false } = {}) {
  const packageRoot = await mkdtemp(join(tmpdir(), "corax-bootstrap-"));
  t.after(() => rm(packageRoot, { recursive: true, force: true }));
  await mkdir(join(packageRoot, "src"));
  await mkdir(join(packageRoot, "scripts"));
  await mkdir(join(packageRoot, "dist/src/cli"), { recursive: true });
  await writeFile(join(packageRoot, "src/index.ts"), "export const revision = 'new';\n");
  await writeFile(
    join(packageRoot, "scripts/build.mjs"),
    failing
      ? "process.exitCode = 7;\n"
      : `import { writeFile } from 'node:fs/promises';
await writeFile('dist/src/cli/run.js', 'export const revision = "new";\\n');
await writeFile('build-completed', 'yes');
`,
  );
  const cliEntrypointPath = join(packageRoot, "dist/src/cli/run.js");
  if (stale) {
    await writeFile(cliEntrypointPath, 'export const revision = "old";\n');
    await utimes(cliEntrypointPath, new Date(0), new Date(0));
  }
  return { packageRoot, cliEntrypointPath };
}

test("CLI bootstrap rebuilds stale output through the package's canonical build", async (t) => {
  const options = await fixture(t, { stale: true });
  assert.equal(await ensureBuiltCli(options), options.cliEntrypointPath);
  assert.equal(
    await readFile(options.cliEntrypointPath, "utf8"),
    'export const revision = "new";\n',
  );
  assert.equal(await readFile(join(options.packageRoot, "build-completed"), "utf8"), "yes");
});

test("CLI bootstrap can create missing output without a separate TypeScript build path", async (t) => {
  const options = await fixture(t);
  assert.equal(await ensureBuiltCli(options), options.cliEntrypointPath);
  assert.equal(await readFile(join(options.packageRoot, "build-completed"), "utf8"), "yes");
});

test("CLI bootstrap propagates a failed canonical build", async (t) => {
  const options = await fixture(t, { failing: true });
  await assert.rejects(ensureBuiltCli(options), /exited with code 7/);
});

test("a packaged CLI does not require source or build scripts", async (t) => {
  const options = await fixture(t, { stale: true });
  await rm(join(options.packageRoot, "src"), { recursive: true });
  await rm(join(options.packageRoot, "scripts"), { recursive: true });
  assert.equal(await ensureBuiltCli(options), options.cliEntrypointPath);
});
