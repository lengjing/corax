import { join } from "node:path";
import { glob, readFile, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";

const packageRoot = fileURLToPath(new URL("..", import.meta.url));
const packageJson = JSON.parse(await readFile(join(packageRoot, "package.json"), "utf8"));
const replacements = {
  __CORAX_PACKAGE_VERSION__: packageJson.version,
  __CORAX_PACKAGE_DEPENDENCY_VERSION__: process.env.CORAX_PACKAGE_DEPENDENCY_URL ?? packageJson.version,
};

for (const [token, value] of Object.entries(replacements)) {
  if (typeof value !== "string") throw new Error(`Missing build token value: ${token}`);
}

for await (const relative of glob("dist/**/*.js", { cwd: packageRoot })) {
  const file = join(packageRoot, relative);
  const source = await readFile(file, "utf8");
  let next = source;
  for (const [token, value] of Object.entries(replacements)) next = next.replaceAll(token, value);
  if (next !== source) await writeFile(file, next);
}
