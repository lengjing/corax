import { join } from "node:path";
import { fileURLToPath } from "node:url";

const packageRoot = fileURLToPath(new URL("..", import.meta.url));
const workspaceRoot = fileURLToPath(new URL("../../..", import.meta.url));
const packageJson = await Bun.file(join(packageRoot, "package.json")).json();
const workspace = await Bun.file(join(workspaceRoot, "package.json")).json();
const catalog = workspace.workspaces.catalog;
const replacements = {
  __CORAX_PACKAGE_VERSION__: packageJson.version,
  __CORAX_PACKAGE_DEPENDENCY_VERSION__: process.env.CORAX_PACKAGE_DEPENDENCY_URL ?? packageJson.version,
  __BUN_ENGINE__: packageJson.engines.bun,
  __AI_SDK_VERSION__: catalog.ai,
  __BETTER_AUTH_VERSION__: catalog["better-auth"],
  __NEXT_VERSION__: catalog.next,
  __REACT_VERSION__: catalog.react,
  __REACT_DOM_VERSION__: catalog["react-dom"],
  __STREAMDOWN_VERSION__: catalog.streamdown,
  __ZOD_VERSION__: catalog.zod,
  __TYPESCRIPT_VERSION__: catalog.typescript,
  __TYPES_REACT_VERSION__: catalog["@types/react"],
  __TYPES_REACT_DOM_VERSION__: catalog["@types/react-dom"],
};

for (const [token, value] of Object.entries(replacements)) {
  if (typeof value !== "string") throw new Error(`Missing build token value: ${token}`);
}

for await (const relative of new Bun.Glob("dist/**/*.js").scan(packageRoot)) {
  const file = Bun.file(join(packageRoot, relative));
  const source = await file.text();
  let next = source;
  for (const [token, value] of Object.entries(replacements)) next = next.replaceAll(token, value);
  if (next !== source) await Bun.write(file, next);
}
