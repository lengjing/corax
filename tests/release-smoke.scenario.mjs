import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { promisify } from "node:util";
import { fileURLToPath } from "node:url";
import test from "./support/test.mjs";

const execute = promisify(execFile);

test("the released Bun CLI builds and serves an external flat project", { timeout: 180_000 }, async (t) => {
  const { version } = await Bun.file(new URL("../package.json", import.meta.url)).json();
  const archive = process.env.CORAX_RELEASE_ARCHIVE ||
    resolve(`release/corax-${version}-${process.platform}-${process.arch}.tgz`);
  const temporary = await mkdtemp(join(tmpdir(), "corax-release-smoke-"));
  const previousCwd = process.cwd();
  t.after(() => {
    process.chdir(previousCwd);
    return rm(temporary, { recursive: true, force: true, maxRetries: 5 });
  });
  const root = join(temporary, "runner");
  const project = join(temporary, "my-agent");
  await mkdir(root);
  await mkdir(join(project, "channels"), { recursive: true });
  await execute("tar", ["-xf", archive, "-C", root], { timeout: 30_000 });
  const manifest = JSON.parse(await readFile(join(root, "package.json"), "utf8"));
  assert.equal(manifest.name, "corax-cli");
  assert.equal(manifest.bin.corax, "./cli/bin/corax.ts");
  const sdk = JSON.parse(await readFile(join(root, "packages/corax/package.json"), "utf8"));
  assert.equal(sdk.name, "corax");
  assert.equal(sdk.bin, undefined, "the internal bootstrap must not shadow the public corax CLI");
  assert.equal(manifest.engines.bun, ">=1.4.2");
  assert.equal(manifest.engines.node, undefined);
  for (const args of [["--help"], ["--version"]]) {
    const { stdout } = await execute(process.execPath,
      ["--no-env-file", join(root, "cli/bin/corax.ts"), ...args],
      { cwd: tmpdir(), timeout: 20_000 });
    assert.match(stdout, args[0] === "--help" ? /corax.*\[options\]/ : new RegExp(version.replaceAll(".", "\\.")));
  }
  assert.equal(await Bun.file(join(root, "packages/corax/src/index.ts")).exists(), false);
  assert.equal(await Bun.file(join(root, "agent.ts")).exists(), false);

  await writeFile(join(project, "package.json"), JSON.stringify({
    name: "external-smoke-agent", private: true, type: "module",
    dependencies: { corax: "file:../runner/packages/corax.tgz", "@ai-sdk/openai": "^4.0.91" },
  }));
  await writeFile(join(project, "agent.ts"), `
import { defineAgent } from 'corax';
import { createOpenAI } from '@ai-sdk/openai';
const provider = createOpenAI({ apiKey: process.env.OPENAI_API_KEY, baseURL: 'http://127.0.0.1:1/v1' });
export default defineAgent({ model: provider.chat('smoke-model'), modelContextWindowTokens: 128000, experimental: { workflow: { world: 'local' } } });
`);
  await writeFile(join(project, "channels/corax.ts"), `
import { httpBasic } from 'corax/channels/auth';
import { coraxChannel } from 'corax/channels/corax';
export default coraxChannel({ auth: [httpBasic({ username: 'smoke-user', password: process.env.CORAX_PASSWORD! })] });
`);
  await writeFile(join(project, ".env"), "OPENAI_API_KEY=smoke-key\nCORAX_PASSWORD=smoke-password\n");
  await execute(process.execPath, ["install"], { cwd: project, timeout: 60_000 });
  await execute(process.execPath, ["--no-env-file", join(root, "cli/bin/corax.ts"), "build", "--root", project],
    { cwd: tmpdir(), timeout: 90_000, maxBuffer: 4 * 1024 * 1024 });
  const nitro = await Bun.file(join(project, ".output/nitro.json")).json();
  assert.equal(nitro.preset, "bun");
  assert.equal(await Bun.file(join(project, ".output/.corax/compile/module-map.mjs")).exists(), true);

  const checked = await execute(process.execPath, ["--no-env-file",
    fileURLToPath(new URL("./support/runtime-check.mjs", import.meta.url)), root, project],
    { cwd: tmpdir(), timeout: 90_000, maxBuffer: 4 * 1024 * 1024 });
  assert.match(checked.stdout, /RUNTIME_SMOKE=ok/);
});
