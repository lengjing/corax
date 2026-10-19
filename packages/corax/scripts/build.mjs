import { spawn } from "node:child_process";
import { fileURLToPath, pathToFileURL } from "node:url";

const cwd = fileURLToPath(new URL("../", import.meta.url));

export async function buildCore() {
  for (const script of [
    "check-bin-runtime-dependencies.mjs",
    "build-js.mjs",
    "copy-docs.mjs",
    "stamp-version-tokens.mjs",
    "prepare-package.mjs",
  ]) {
    await new Promise((resolve, reject) => {
      const child = spawn(process.execPath, [`scripts/${script}`], { cwd, stdio: "inherit" });
      child.once("error", reject);
      child.once("exit", (code, signal) => {
        if (code === 0) resolve();
        else reject(new Error(`${script} exited with ${signal ?? code}.`));
      });
    });
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) await buildCore();
