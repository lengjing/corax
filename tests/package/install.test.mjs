import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { existsSync } from "node:fs";
import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import { fileURLToPath } from "node:url";
import test from "node:test";
import { runNpm } from "../../scripts/npm.mjs";

const execute = promisify(execFile);
const archive = fileURLToPath(new URL("../../artifacts/corax.tgz", import.meta.url));

test("npm tarball preserves SDK types and builds/serves an external project", { timeout: 240_000 }, async (t) => {
  assert.ok(existsSync(archive), "Run npm run pack first.");
  const project = await mkdtemp(join(tmpdir(), "corax-package-"));
  t.after(() => rm(project, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 }));
  await mkdir(join(project, "channels"));
  await writeFile(join(project, "package.json"), JSON.stringify({
    name: "external-package-test", private: true, type: "module",
    dependencies: { "@coraxjs/core": `file:${archive.replaceAll("\\", "/")}`, "@ai-sdk/openai": "4.0.91" },
    devDependencies: { typescript: "7.0.2", "@types/node": "24.13.3" },
  }));
  await runNpm(["install", "--no-audit", "--no-fund"], project);
  const packageRoot = join(project, "node_modules/@coraxjs/core");
  const manifest = JSON.parse(await readFile(join(packageRoot, "package.json"), "utf8"));
  assert.equal(manifest.name, "@coraxjs/core");
  assert.equal(manifest.private, false);
  assert.equal(manifest.bin.corax, "./bin/corax.js");
  assert.equal(manifest.engines.node, ">=24.0.0");
  assert.equal(manifest.scripts, undefined);
  assert.equal(manifest.devDependencies, undefined);
  for (const name of ["src", "scripts", ".env", ".corax", ".generated"]) {
    assert.equal(existsSync(join(packageRoot, name)), false, `${name} must not ship`);
  }
  for (const path of [...paths(manifest.exports), ...paths(manifest.imports)]) {
    assert.ok(!path.startsWith("./src/") && !path.startsWith("./.generated/"), path);
    if (!path.includes("*")) assert.ok(existsSync(join(packageRoot, path)), path);
  }
  for (const name of ["LICENSE", "NOTICE", "README.md", "dist/src/index.d.ts"]) {
    assert.ok(existsSync(join(packageRoot, name)), name);
  }

  const cli = join(packageRoot, "bin/corax.js");
  const history = await execute(process.execPath, [
    fileURLToPath(new URL("../support/history-read-check.mjs", import.meta.url)), packageRoot,
  ], { cwd: project, timeout: 30_000, maxBuffer: 1024 * 1024 });
  assert.match(history.stdout, /HISTORY_READ_SMOKE=ok/);
  for (const args of [["--help"], ["--version"], ["remote", "connect", "--help"]]) {
    const { stdout } = await execute(process.execPath, [cli, ...args], { cwd: project, timeout: 20_000 });
    assert.match(stdout, args[0] === "--version" ? new RegExp(manifest.version.replaceAll(".", "\\.")) : /corax/);
  }
  // Source conditions must also resolve to shipped JS, never checkout-only TS.
  await execute(process.execPath, ["--conditions=corax-source", cli, "--help"], { cwd: project, timeout: 20_000 });
  await writeFile(join(project, "agent.ts"), `
import { defineAgent } from '@coraxjs/core';
import { createOpenAI } from '@ai-sdk/openai';
const provider = createOpenAI({ apiKey: process.env.OPENAI_API_KEY, baseURL: 'http://127.0.0.1:1/v1' });
export default defineAgent({ model: provider.chat('smoke-model'), modelContextWindowTokens: 128000, experimental: { workflow: { world: 'local' } } });
`);
  await writeFile(join(project, "channels/corax.ts"), `
import { httpBasic } from '@coraxjs/core/channels/auth';
import { coraxChannel } from '@coraxjs/core/channels/corax';
export default coraxChannel({ auth: [httpBasic({ username: 'smoke-user', password: process.env.CORAX_PASSWORD! })] });
`);
  await writeFile(join(project, ".env"), "OPENAI_API_KEY=smoke-key\nCORAX_PASSWORD=smoke-password\n");
  await execute(process.execPath, [join(project, "node_modules/typescript/bin/tsc"),
    "--noEmit", "--strict", "--skipLibCheck", "--types", "node", "--module", "nodenext", "--target", "es2024", "agent.ts", "channels/corax.ts"],
  { cwd: project, timeout: 30_000 });
  await execute(process.execPath, [cli, "build"], { cwd: project, timeout: 90_000, maxBuffer: 4 * 1024 * 1024 });
  const nitro = JSON.parse(await readFile(join(project, ".output/nitro.json"), "utf8"));
  assert.equal(nitro.preset, "node-server");
  const { stdout } = await execute(process.execPath, [
    fileURLToPath(new URL("../support/runtime-check.mjs", import.meta.url)), project, project,
  ], { cwd: tmpdir(), timeout: 90_000, maxBuffer: 4 * 1024 * 1024 });
  assert.match(stdout, /RUNTIME_SMOKE=ok/);
});

function paths(value) {
  if (typeof value === "string") return [value];
  return Object.values(value ?? {}).flatMap(paths);
}
