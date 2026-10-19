import { execFile } from "node:child_process";
import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";

import { afterEach, describe, expect, it } from "vitest";

const roots: string[] = [];

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { force: true, recursive: true })));
});

describe("extension corax peer compatibility", () => {
  it.each(["0.24.6", "0.25.0-beta.1"])(
    "installs with corax %s under npm strict peer checks",
    async (coraxVersion) => {
      const root = await mkdtemp(join(tmpdir(), "corax-extension-peer-"));
      roots.push(root);
      const coraxRoot = join(root, "corax-package");
      const extensionRoot = join(root, "extension-package");
      const appRoot = join(root, "app");
      await Promise.all([mkdir(coraxRoot), mkdir(extensionRoot), mkdir(appRoot)]);
      await Promise.all([
        writePackageJson(coraxRoot, { name: "corax", version: coraxVersion }),
        writePackageJson(extensionRoot, {
          name: "@acme/extension-peer-test",
          version: "1.0.0",
          peerDependencies: { corax: "*" },
        }),
        writePackageJson(appRoot, { name: "consumer", version: "1.0.0", private: true }),
      ]);

      await Promise.all([
        runNpm(["pack", "--pack-destination", root], coraxRoot),
        runNpm(["pack", "--pack-destination", root], extensionRoot),
      ]);
      await runNpm(
        [
          "install",
          "--strict-peer-deps",
          "--ignore-scripts",
          "--no-audit",
          "--no-package-lock",
          join(root, `corax-${coraxVersion}.tgz`),
          join(root, "acme-extension-peer-test-1.0.0.tgz"),
        ],
        appRoot,
      );

      const installed = JSON.parse(
        await readFile(join(appRoot, "node_modules", "corax", "package.json"), "utf8"),
      ) as { version?: string };
      expect(installed.version).toBe(coraxVersion);
    },
  );
});

async function writePackageJson(root: string, value: Record<string, unknown>): Promise<void> {
  await writeFile(join(root, "package.json"), `${JSON.stringify(value, null, 2)}\n`, "utf8");
}

async function runNpm(arguments_: readonly string[], cwd: string): Promise<void> {
  await promisify(execFile)(process.platform === "win32" ? "npm.cmd" : "npm", [...arguments_], {
    cwd,
  });
}
