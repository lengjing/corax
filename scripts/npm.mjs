import { spawn } from "node:child_process";
import { realpathSync } from "node:fs";
import { delimiter, dirname, join } from "node:path";

/** Run npm's JS entry through Node, without a shell or Windows .cmd window. */
export async function runNpm(args, cwd) {
  const npmCli = resolveNpmCli();
  await new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [npmCli, ...args], {
      cwd, stdio: "inherit", windowsHide: true,
    });
    child.once("error", reject);
    child.once("close", (code) => code === 0
      ? resolve()
      : reject(new Error(`npm ${args.join(" ")} exited with ${code}.`)));
  });
}

function resolveNpmCli() {
  const directories = [dirname(process.execPath), ...(process.env.PATH ?? "").split(delimiter).filter(Boolean)];
  const candidates = [process.env.npm_execpath, ...directories.flatMap((directory) => [
    join(directory, "node_modules/npm/bin/npm-cli.js"),
    join(directory, "../lib/node_modules/npm/bin/npm-cli.js"),
    join(directory, "npm"),
  ])];
  for (const candidate of candidates) {
    if (!candidate) continue;
    try {
      const path = realpathSync(candidate);
      if (/[/\\]npm-cli\.js$/i.test(path)) return path;
    } catch {
      // Continue through common Node/npm layouts and PATH symlinks.
    }
  }
  throw new Error("Cannot locate npm-cli.js. Run this command through npm run with Node.js and npm installed.");
}
