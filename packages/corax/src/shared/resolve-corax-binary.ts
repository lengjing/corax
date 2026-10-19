import { createRequire } from "node:module";
import { dirname, join } from "node:path";

/**
 * Resolves the absolute path to the installed corax binary from the app's
 * perspective.
 *
 * Uses module resolution rather than assuming an app-local `node_modules/corax`:
 * npm workspaces hoist corax to the workspace root, so the app-local path does
 * not exist there, while pnpm symlinks it app-locally. corax does not export
 * `./bin/corax.js`, but it does export `./package.json`, so we resolve that and
 * derive the bin path from the package root. Falls back to the conventional
 * app-local path when corax cannot be resolved (e.g. before install).
 */
export function resolveCoraxBinaryPath(appRoot: string): string {
  try {
    const require = createRequire(join(appRoot, "package.json"));
    return join(dirname(require.resolve("corax/package.json")), "bin", "corax.js");
  } catch {
    return join(appRoot, "node_modules", "corax", "bin", "corax.js");
  }
}
