import { cp, mkdir } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const packageRoot = fileURLToPath(new URL("..", import.meta.url));
// Built-in extension trees are discovered from dist, so their instructions and
// skills must ship beside the compiled modules.
const extensionAssetDirs = [
  "src/extensions/git/extension",
  "src/computer-use/extension",
];
// Hand-written declaration files are tsc inputs, not outputs. The ambient
// `workflow` module types are referenced from `corax/tools` and exported as
// `corax/workflow-modules`, so they ship beside the emitted declarations.
const runtimeAssetFiles = ["src/public/workflow-modules.d.ts"];

export async function copyRuntimeAssets() {
  for (const relativePath of runtimeAssetFiles) {
    const destinationPath = join(packageRoot, "dist", relativePath);
    await mkdir(dirname(destinationPath), { recursive: true });
    await cp(join(packageRoot, relativePath), destinationPath, { recursive: true });
  }
  for (const relativePath of extensionAssetDirs) {
    await cp(join(packageRoot, relativePath), join(packageRoot, "dist", relativePath), {
      recursive: true,
      filter: (path) => !path.endsWith(".ts"),
    });
  }
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  await copyRuntimeAssets();
}
