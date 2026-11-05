/**
 * Runtime-owned compiled artifact paths for one application root.
 */
interface RuntimeCompilerArtifactPaths {
  readonly appRoot: string;
  readonly compiledManifestPath: string;
  readonly compileDirectoryPath: string;
  readonly compileMetadataPath: string;
  readonly diagnosticsPath: string;
  readonly discoveryManifestPath: string;
  readonly discoveryDirectoryPath: string;
  readonly moduleMapPath: string;
  readonly sandboxPreparedArtifactsPath: string;
}

/**
 * Resolves the stable corax artifact paths for one application root without
 * depending on Node path helpers.
 */
export function resolveRuntimeCompilerArtifactPaths(appRoot: string): RuntimeCompilerArtifactPaths {
  const normalizedAppRoot = normalizeFilesystemPath(appRoot);
  const environment = typeof process === "undefined" ? undefined : process.env;
  const projectRoot = environment?.CORAX_PROJECT_ROOT ?? (typeof process !== "undefined" && typeof process.cwd === "function" ? process.cwd() : "");
  const configured = environment?.CORAX_DATA_DIR?.trim();
  // Runtime helpers also run in bundled contexts; keep this free of Node module imports.
  const dataRoot = configured && normalizeFilesystemPath(projectRoot) === normalizedAppRoot
    ? normalizeFilesystemPath(/^(?:[A-Za-z]:[\\/]|[\\/])/.test(configured) ? configured : `${normalizedAppRoot}/${configured}`)
    : `${normalizedAppRoot}/.corax`;
  const discoveryDirectoryPath = `${dataRoot}/discovery`;
  const compileDirectoryPath = `${dataRoot}/compile`;

  return {
    appRoot: normalizedAppRoot,
    compiledManifestPath: `${compileDirectoryPath}/compiled-agent-manifest.json`,
    compileDirectoryPath,
    compileMetadataPath: `${compileDirectoryPath}/compile-metadata.json`,
    diagnosticsPath: `${discoveryDirectoryPath}/diagnostics.json`,
    discoveryDirectoryPath,
    discoveryManifestPath: `${discoveryDirectoryPath}/agent-discovery-manifest.json`,
    moduleMapPath: `${compileDirectoryPath}/module-map.mjs`,
    sandboxPreparedArtifactsPath: `${compileDirectoryPath}/sandbox-prepared-artifacts.json`,
  };
}

function normalizeFilesystemPath(path: string): string {
  const normalized = path.replaceAll("\\", "/");

  if (normalized === "/") {
    return normalized;
  }

  return normalized.replace(/\/+$/, "");
}
