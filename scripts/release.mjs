import { cp, mkdir, mkdtemp, readFile, rename, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("../", import.meta.url));
const manifest = JSON.parse(await readFile(join(root, "package.json"), "utf8"));
const { version } = manifest;
const core = JSON.parse(await readFile(join(root, "packages/corax/package.json"), "utf8"));
if (core.version !== version) {
  throw new Error(
    "The product and core versions must match so durable runs identify the released code correctly.",
  );
}
const { buildCore } = await import("../packages/corax/scripts/build.mjs");
await buildCore();
const name = `corax-${version}-${process.platform}-${process.arch}`;
const output = join(root, "release");
const stage = await mkdtemp(join(tmpdir(), "corax-release-"));
const pending = join(output, `${name}.pending.tgz`);
try {
  await stageRelease(stage);
  await mkdir(output, { recursive: true });
  const archive = join(output, `${name}.tgz`);
  await runCommand(["tar", "-czf", pending, "-C", stage, "."], root);
  await runCommand([process.execPath, "test", "./tests/release-smoke.scenario.mjs"], root, {
    ...process.env,
    CORAX_RELEASE_ARCHIVE: pending,
  });
  await rename(pending, archive);
  console.log(`[corax] Release created: ${archive}`);
} finally {
  await rm(stage, { recursive: true, force: true });
  await rm(pending, { force: true });
}

async function runCommand(command, cwd, env = process.env) {
  await new Promise((resolve, reject) => {
    const child = spawn(command[0], command.slice(1), { cwd, env, stdio: "inherit" });
    child.once("error", reject);
    child.once("close", (code) => code === 0
      ? resolve()
      : reject(new Error(`${command.join(" ")} exited with ${code}.`)));
  });
}

function publishedPaths(value) {
  if (typeof value === "string") {
    if (value.startsWith("./src/"))
      return value.replace(/^\.\/src\//, "./dist/src/").replace(/\.ts$/, ".js");
    return value.replace(/^\.\/\.generated\//, "./dist/src/");
  }
  if (value && typeof value === "object")
    return Object.fromEntries(
      Object.entries(value).map(([key, entry]) => [key, publishedPaths(entry)]),
    );
  return value;
}

/** Assemble a relocatable CLI plus its local SDK and production dependencies. */
async function stageRelease(stage) {
  const versions = (group = {}) => Object.fromEntries(
    Object.entries(group).map(([key, value]) => [
      key,
      value === "catalog:" ? manifest.workspaces.catalog[key] : value,
    ]),
  );
  const target = join(stage, "packages/corax");
  await mkdir(target, { recursive: true });
  for (const name of ["bin", "dist", "docs", "LICENSE", "NOTICE", "README.md"])
    await cp(join(root, "packages/corax", name), join(target, name), { recursive: true });

  const runtimeCore = { ...core };
  delete runtimeCore.devDependencies;
  delete runtimeCore.scripts;
  // Published runtime resolution must never point at checkout-only .ts sources.
  runtimeCore.imports = publishedPaths(core.imports);
  runtimeCore.exports = publishedPaths(core.exports);
  runtimeCore.dependencies = versions(core.dependencies);
  runtimeCore.peerDependencies = versions(core.peerDependencies);
  await writeFile(join(target, "package.json"), JSON.stringify(runtimeCore, null, 2));
  await runCommand([
    process.execPath, "pm", "pack", "--ignore-scripts", "--quiet",
    "--filename", join(stage, "packages/corax.tgz"),
  ], target);

  await cp(join(root, "cli"), join(stage, "cli"), { recursive: true });
  await cp(join(root, "docs/deployment.md"), join(stage, "README.md"));
  await writeFile(join(stage, "package.json"), JSON.stringify({
    name: "corax-cli",
    version,
    private: true,
    type: "module",
    bin: { "corax": "./cli/bin/corax.ts" },
    engines: manifest.engines,
    packageManager: manifest.packageManager,
    dependencies: { corax: "file:./packages/corax.tgz" },
    scripts: { start: "bun --no-env-file cli/bin/corax.ts" },
  }, null, 2));
  await runCommand([process.execPath, "install", "--production"], stage);
}
import { spawn } from "node:child_process";
