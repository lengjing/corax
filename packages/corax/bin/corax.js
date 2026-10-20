#!/usr/bin/env -S bun --no-env-file

import { spawn } from "node:child_process";
import { access, readdir, realpath, stat } from "node:fs/promises";
import { createRequire } from "node:module";
import { dirname, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const require = createRequire(import.meta.url);
const packageJson = require("../package.json");
const packageBunEngine = packageJson.engines?.bun;
const bootstrapPackageRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
let semverPromise;

if (typeof packageBunEngine !== "string") {
  throw new Error("corax package.json must declare a valid engines.bun range.");
}

function createBootstrapOptions(overrides = {}) {
  const packageRoot = overrides.packageRoot ?? bootstrapPackageRoot;

  return {
    cliEntrypointPath:
      overrides.cliEntrypointPath ?? resolve(packageRoot, "dist", "src", "cli", "run.js"),
    packageRoot,
    buildScriptPath: overrides.buildScriptPath ?? resolve(packageRoot, "scripts", "build.mjs"),
  };
}

async function fileExists(path) {
  try {
    await access(path);
    return true;
  } catch {
    return false;
  }
}

async function getPathMtimeMs(path) {
  try {
    return (await stat(path)).mtimeMs;
  } catch {
    return undefined;
  }
}

async function getLatestDirectoryMtimeMs(path) {
  const stats = await stat(path);
  let latestMtimeMs = stats.mtimeMs;

  if (!stats.isDirectory()) {
    return latestMtimeMs;
  }

  const entries = await readdir(path, {
    withFileTypes: true,
  });

  for (const entry of entries) {
    const entryPath = resolve(path, entry.name);
    const entryLatestMtimeMs = await getLatestDirectoryMtimeMs(entryPath);

    if (entryLatestMtimeMs > latestMtimeMs) {
      latestMtimeMs = entryLatestMtimeMs;
    }
  }

  return latestMtimeMs;
}

async function getLatestBuildInputMtimeMs({ packageRoot }) {
  let latestMtimeMs = 0;

  for (const relativePath of ["src", "bin", "scripts"]) {
    const path = resolve(packageRoot, relativePath);
    const pathMtimeMs = await getPathMtimeMs(path);

    if (pathMtimeMs === undefined) {
      continue;
    }

    const latestPathMtimeMs = await getLatestDirectoryMtimeMs(path);

    if (latestPathMtimeMs > latestMtimeMs) {
      latestMtimeMs = latestPathMtimeMs;
    }
  }

  return latestMtimeMs;
}

async function canBuildWorkspaceCli({ exists, packageRoot, buildScriptPath }) {
  for (const requiredPath of [resolve(packageRoot, "src"), buildScriptPath]) {
    if (!(await exists(requiredPath))) {
      return false;
    }
  }

  return true;
}

function vendorCompiledScriptPath({ packageRoot }) {
  return resolve(packageRoot, "scripts", "vendor-compiled.mjs");
}

function generatedSemverPath({ packageRoot }) {
  return resolve(packageRoot, ".generated", "compiled", "semver", "index.js");
}

async function canBuildVendoredSemver({ exists, packageRoot }) {
  return await exists(vendorCompiledScriptPath({ packageRoot }));
}

function isModuleNotFoundError(error) {
  return typeof error === "object" && error !== null && error.code === "ERR_MODULE_NOT_FOUND";
}

async function loadVendoredSemver(options, dependencies = {}) {
  semverPromise ??= (async () => {
    const exists = dependencies.exists ?? fileExists;
    const executeCommand = dependencies.runCommand ?? runCommand;
    const importModule = dependencies.importBootstrapModule ?? ((specifier) => import(specifier));

    try {
      const module = await importModule("#compiled/semver/index.js");
      return module.default;
    } catch (error) {
      if (
        !isModuleNotFoundError(error) ||
        !(await canBuildVendoredSemver({ exists, packageRoot: options.packageRoot }))
      ) {
        throw error;
      }
    }

    const scriptPath = vendorCompiledScriptPath({
      packageRoot: options.packageRoot,
    });
    const semverPath = generatedSemverPath({
      packageRoot: options.packageRoot,
    });

    if (!(await exists(semverPath))) {
      await executeCommand(process.execPath, [scriptPath], {
        cwd: options.packageRoot,
      });
    }

    if (!(await exists(semverPath))) {
      throw new Error(`Building corax's vendored dependencies did not produce ${semverPath}.`);
    }

    const module = await importModule(pathToFileURL(semverPath).href);
    return module.default;
  })();

  return semverPromise;
}

async function assertSupportedBunVersion(
  version = process.versions.bun,
  requiredRange = packageBunEngine,
  options = createBootstrapOptions(),
  dependencies = {},
) {
  if (!version) throw new Error("corax requires Bun. Run the CLI with bun.");
  const semver = await loadVendoredSemver(options, dependencies);

  if (semver.validRange(requiredRange) === null) {
    throw new Error(`corax declares an invalid Bun engine range: "${requiredRange}".`);
  }
  if (semver.satisfies(version, requiredRange)) {
    return;
  }

  throw new Error(
    [
      `corax requires Bun ${requiredRange}.`,
      `You are running ${version}.`,
      "Please install a compatible Bun version and try again.",
    ].join(" "),
  );
}

async function runCommand(command, args, options) {
  await new Promise((resolveCommand, rejectCommand) => {
    const child = spawn(command, args, {
      cwd: options.cwd,
      stdio: "inherit",
    });

    child.once("error", rejectCommand);
    child.once("exit", (code, signal) => {
      if (code === 0) {
        resolveCommand();
        return;
      }

      if (signal) {
        rejectCommand(new Error(`Command "${command}" exited due to signal ${signal}.`));
        return;
      }

      rejectCommand(new Error(`Command "${command}" exited with code ${code ?? "unknown"}.`));
    });
  });
}

/**
 * Ensures the compiled CLI entrypoint exists before the workspace bin is executed.
 */
export async function ensureBuiltCli(overrides = {}, dependencies = {}) {
  const options = createBootstrapOptions(overrides);
  const exists = dependencies.exists ?? fileExists;
  const getBuildInputMtimeMs =
    dependencies.getLatestBuildInputMtimeMs ?? getLatestBuildInputMtimeMs;
  const getEntrypointMtimeMs = dependencies.getPathMtimeMs ?? getPathMtimeMs;
  const executeCommand = dependencies.runCommand ?? runCommand;
  const packageCanBuildCli = await canBuildWorkspaceCli({
    exists,
    packageRoot: options.packageRoot,
    buildScriptPath: options.buildScriptPath,
  });

  if (await exists(options.cliEntrypointPath)) {
    if (!packageCanBuildCli) {
      return options.cliEntrypointPath;
    }

    const [latestBuildInputMtimeMs, cliEntrypointMtimeMs] = await Promise.all([
      getBuildInputMtimeMs({
        packageRoot: options.packageRoot,
      }),
      getEntrypointMtimeMs(options.cliEntrypointPath),
    ]);

    if (cliEntrypointMtimeMs !== undefined && cliEntrypointMtimeMs >= latestBuildInputMtimeMs) {
      return options.cliEntrypointPath;
    }
  }

  if (!packageCanBuildCli) {
    throw new Error(
      `corax package at ${options.packageRoot} does not include the sources required to rebuild the CLI.`,
    );
  }

  await executeCommand(process.execPath, [options.buildScriptPath], {
    cwd: options.packageRoot,
  });

  if (await exists(options.cliEntrypointPath)) {
    return options.cliEntrypointPath;
  }

  throw new Error(`Building corax did not produce ${options.cliEntrypointPath}.`);
}

/**
 * Runs the compiled corax CLI, building the workspace package on demand when needed.
 */
export async function runCoraxCli(argv = process.argv.slice(2), overrides = {}, dependencies = {}) {
  const options = createBootstrapOptions(overrides);
  await assertSupportedBunVersion(
    dependencies.bunVersion,
    dependencies.bunEngineRequirement,
    options,
    dependencies,
  );

  const cliEntrypointPath = await ensureBuiltCli(options, dependencies);
  const importModule = dependencies.importModule ?? ((specifier) => import(specifier));
  const cliModule = await importModule(pathToFileURL(cliEntrypointPath).href);

  if (typeof cliModule.runCli !== "function") {
    throw new Error(`The corax CLI module at ${cliEntrypointPath} does not export runCli().`);
  }

  await cliModule.runCli(argv);
}

/**
 * Resolves once every write already queued on the stream has been handed to the OS.
 */
async function flushWritable(stream) {
  if (stream.destroyed || stream.writableEnded) {
    return;
  }

  await new Promise((resolveFlush) => stream.write("", () => resolveFlush()));
}

async function isDirectExecution() {
  if (!process.argv[1]) {
    return false;
  }

  try {
    const [currentPath, invokedPath] = await Promise.all([
      realpath(fileURLToPath(import.meta.url)),
      realpath(process.argv[1]),
    ]);

    return currentPath === invokedPath;
  } catch {
    return false;
  }
}

export async function main(argv = process.argv.slice(2)) {
  try {
    await runCoraxCli(argv);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error(message);
    // Walk the `cause` chain so wrapped errors (sandbox prewarm wraps the
    // underlying provider failure with remediation hints, etc.) still
    // surface the original message a user can search for.
    let cause = error instanceof Error ? error.cause : undefined;
    while (cause instanceof Error) {
      console.error(`  Caused by: ${cause.message}`);
      cause = cause.cause;
    }
    process.exitCode = 1;
  } finally {
    // Pipes and sockets can accept writes asynchronously, and `process.exit`
    // drops anything still queued, truncating large output such as
    // `corax info --json` read by a parent Node process.
    await Promise.all([flushWritable(process.stdout), flushWritable(process.stderr)]);
    // The CLI bootstraps build/dev toolchains that can leave native service
    // handles alive after the command has completed. Once the top-level
    // command resolves, terminate the bin process explicitly so commands like
    // `corax dev` + `/exit` do not hang on leaked implementation details.
    process.exit(process.exitCode ?? 0);
  }
}

if (await isDirectExecution()) await main();
