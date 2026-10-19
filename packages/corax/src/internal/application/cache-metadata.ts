import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";

import { resolveInstalledPackageInfo } from "#internal/application/package.js";

const CORAX_CACHE_METADATA_FILE = "corax-cache.json";

/**
 * Clears one corax-owned cache directory when its recorded corax version is missing
 * or differs from the currently installed package version.
 */
export async function prepareCoraxVersionedCacheDirectory(directoryPath: string): Promise<void> {
  const cachedCoraxVersion = await readCoraxCacheVersion(directoryPath);
  const coraxVersion = resolveInstalledPackageInfo().version;

  if (cachedCoraxVersion !== null && cachedCoraxVersion === coraxVersion) {
    return;
  }

  await rm(directoryPath, {
    force: true,
    recursive: true,
  });
}

/**
 * Writes the current installed corax version into one corax-owned cache directory.
 */
export async function writeCoraxVersionedCacheMetadata(directoryPath: string): Promise<void> {
  await mkdir(directoryPath, {
    recursive: true,
  });
  await writeFile(
    join(directoryPath, CORAX_CACHE_METADATA_FILE),
    `${JSON.stringify(
      {
        coraxVersion: resolveInstalledPackageInfo().version,
      },
      null,
      2,
    )}\n`,
  );
}

async function readCoraxCacheVersion(directoryPath: string): Promise<string | null> {
  try {
    const parsed = JSON.parse(
      await readFile(join(directoryPath, CORAX_CACHE_METADATA_FILE), "utf8"),
    ) as {
      coraxVersion?: unknown;
    };
    return typeof parsed.coraxVersion === "string" ? parsed.coraxVersion : null;
  } catch (error) {
    if (error instanceof Error && "code" in error && error.code === "ENOENT") {
      return null;
    }

    return null;
  }
}
