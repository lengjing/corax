import {
  type BundlerDefaultLogHandler,
  onVendoredDependencyLog,
} from "#internal/bundler/vendored-dependency-log.js";
import { createNodeEsmCompatBannerPlugin } from "#internal/node-esm-compat-banner.js";

// Nitro's default `codeSplitting` group names chunks with a function and no
// `debugName`. Newer Rolldown releases warn about the missing timing label on
// every build, while older releases in Nitro's range reject the key, so corax
// cannot set it for Nitro.
const MISSING_CODE_SPLITTING_GROUP_DEBUG_NAME = "MISSING_CODE_SPLITTING_GROUP_DEBUG_NAME";

/** Multiple SDK installations may trace the same package/version to one output path. */
export function deduplicateTracedPackageFiles(
  packages: Record<string, { versions: Record<string, { files: string[] }> }>,
): void {
  for (const [name, pkg] of Object.entries(packages)) {
    const marker = `/node_modules/${name}/`;
    for (const version of Object.values(pkg.versions)) {
      const destinations = new Set<string>();
      version.files = version.files.filter((file) => {
        const normalized = file.replaceAll("\\", "/");
        const index = normalized.lastIndexOf(marker);
        const destination = index < 0 ? normalized : normalized.slice(index + marker.length);
        if (destinations.has(destination)) return false;
        destinations.add(destination);
        return true;
      });
    }
  }
}

function onNitroBundlerLog(
  level: string,
  log: unknown,
  defaultHandler: BundlerDefaultLogHandler,
): void {
  if (
    level === "warn" &&
    (log as { code?: unknown } | null)?.code === MISSING_CODE_SPLITTING_GROUP_DEBUG_NAME
  ) {
    return;
  }
  onVendoredDependencyLog(level, log, defaultHandler);
}

/**
 * Creates corax-owned Nitro bundler overrides that must apply to both Rollup
 * and Rolldown hosted builds.
 */
export function createNitroBundlerConfig(plugins: readonly object[]): Record<string, unknown> {
  return {
    onLog: onNitroBundlerLog,
    plugins: [
      {
        name: "corax:bun-builtins",
        resolveId(source: string) {
          return source.startsWith("bun:") ? { id: source, external: true } : null;
        },
      },
      createNodeEsmCompatBannerPlugin(), ...plugins,
    ],
  };
}
