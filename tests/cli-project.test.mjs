import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { cp, mkdtemp, mkdir, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import test from "./support/test.mjs";
import { resolveDiscoveryProject } from "../packages/corax/dist/src/discover/project.js";
import { discoverAgent } from "../packages/corax/dist/src/discover/discover-agent.js";
import { resolveAuthoredPackageRoot } from "../packages/corax/dist/src/internal/authored-module-loader.js";

const execute = promisify(execFile);
const cli = fileURLToPath(new URL("../packages/corax/bin/corax.js", import.meta.url));

test("each capability example is a valid flat agent with optional instructions", async () => {
  for (const name of ["minimal", "channels", "memory", "sandbox", "basic-agent"]) {
    const root = fileURLToPath(new URL(`../examples/${name}`, import.meta.url));
    const project = await resolveDiscoveryProject(root);
    assert.equal(project.layout, "flat", name);
    assert.equal(project.agentRoot, project.appRoot, name);
    const result = await discoverAgent(project);
    assert.deepEqual(result.diagnostics.filter((item) => item.severity === "error"), [], name);
  }
});

test("Bun starts the supervised channels development child with its console preload", { timeout: 60_000 }, async (t) => {
  const project = await mkdtemp(join(tmpdir(), "corax-dev-child-"));
  t.after(() => rm(project, { recursive: true, force: true, maxRetries: 5 }));
  const example = new URL("../examples/channels/", import.meta.url);
  for (const name of ["agent.ts", "package.json", "channels"])
    await cp(new URL(name, example), join(project, name), { recursive: true });
  await mkdir(join(project, "node_modules/@ai-sdk"), { recursive: true });
  for (const name of ["corax", "@ai-sdk/openai"])
    await symlink(fileURLToPath(new URL(`node_modules/${name}`, example)), join(project, "node_modules", name),
      process.platform === "win32" ? "junction" : "dir");
  const { stdout } = await execute(process.execPath, ["--no-env-file",
    fileURLToPath(new URL("./support/development-check.mjs", import.meta.url)), project],
    { cwd: tmpdir(), timeout: 50_000, maxBuffer: 2 * 1024 * 1024 });
  assert.match(stdout, /DEVELOPMENT_SMOKE=ok/);
});

test("--root selects an external flat project instead of the caller's directory", async (t) => {
  const root = await mkdtemp(join(tmpdir(), "corax-project-"));
  t.after(() => rm(root, { recursive: true, force: true, maxRetries: 3 }));
  const target = join(root, "target");
  await mkdir(target);
  await writeFile(join(target, "agent.ts"), "export default {};\n");
  await writeFile(join(target, "package.json"), JSON.stringify({ name: "external", dependencies: { corax: "0.1.0" } }));
  const { stdout } = await execute(process.execPath,
    ["--no-env-file", cli, "dev", "--root", target, "--help"],
    { cwd: root, timeout: 30_000 });
  assert.match(stdout, /dev/);
  assert.equal((await resolveDiscoveryProject(target)).agentRoot, target);
  assert.equal(resolveAuthoredPackageRoot(target), target);
  assert.equal(resolveAuthoredPackageRoot(join(target, "agent.ts")), target);
  await assert.rejects(execute(process.execPath,
    ["--no-env-file", cli, "build", "--root", root],
    { cwd: target, timeout: 10_000 }), (error) => {
      assert.match(error.stderr, /Missing .*agent\.ts/);
      return true;
    });
});
