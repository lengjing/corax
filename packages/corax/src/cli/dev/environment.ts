import { readFileSync } from "node:fs";
import { join, resolve } from "node:path";

import { findCoraxProjectRoot } from "#internal/corax-project-root.js";
import {
  DEVELOPMENT_ENV_FILE_NAMES,
  readDevelopmentEnvironmentValues,
} from "#shared/development-env-files.js";
import { MODEL_CONNECTION_ENV } from "#shared/model-helper.js";
import { readProviderSettingsSync } from "#setup/provider-settings.js";

interface DevelopmentEnvironmentLoader {
  readonly environmentRoot: string;
  reload(): void;
  stageReload(): DevelopmentEnvironmentReload;
}

export interface DevelopmentEnvironmentReload {
  commit(): void;
  rollback(): void;
}

const developmentEnvironmentLoaders = new Map<string, DevelopmentEnvironmentLoader>();

/**
 * Returns the local development environment files corax loads from an
 * application root, ordered from highest to lowest precedence.
 */
export function getDevelopmentEnvironmentFilePaths(appRoot: string): string[] {
  return DEVELOPMENT_ENV_FILE_NAMES.map((fileName) =>
    join(getDevelopmentEnvironmentLoader(appRoot).environmentRoot, fileName),
  );
}

/**
 * Captures the environment-file baseline and applies saved provider settings.
 * Bun owns dotenv loading and interpolation. File edits require a process
 * restart; reinterpreting process.env cannot recover where a value came from.
 */
export async function loadDevelopmentEnvironmentFiles(appRoot: string): Promise<void> {
  const resolvedAppRoot = resolve(appRoot);
  const environmentRoot = await findCoraxProjectRoot(resolvedAppRoot);
  getDevelopmentEnvironmentLoader(resolvedAppRoot, environmentRoot).reload();
}

export function stageDevelopmentEnvironmentFiles(appRoot: string): DevelopmentEnvironmentReload {
  return getDevelopmentEnvironmentLoader(appRoot).stageReload();
}

export function readDevelopmentEnvironmentHostValues(
  appRoot: string,
): Readonly<Record<string, string | null>> {
  const values: Record<string, string | null> = {};
  const fileValues = readDevelopmentEnvironmentValues(
    getDevelopmentEnvironmentLoader(appRoot).environmentRoot,
  );
  const hostKeys = new Set(fileValues.keys());

  for (const key of [...hostKeys].sort((left, right) => left.localeCompare(right))) {
    values[key] = process.env[key] ?? null;
  }

  return values;
}

function getDevelopmentEnvironmentLoader(
  appRoot: string,
  environmentRoot?: string,
): DevelopmentEnvironmentLoader {
  const resolvedAppRoot = resolve(appRoot);
  const existingLoader = developmentEnvironmentLoaders.get(resolvedAppRoot);
  if (existingLoader !== undefined && environmentRoot === undefined) return existingLoader;

  const resolvedEnvironmentRoot = resolve(environmentRoot ?? resolvedAppRoot);
  if (existingLoader?.environmentRoot === resolvedEnvironmentRoot) return existingLoader;

  const loader = createDevelopmentEnvironmentLoader(resolvedAppRoot, resolvedEnvironmentRoot);
  developmentEnvironmentLoaders.set(resolvedAppRoot, loader);
  return loader;
}

function createDevelopmentEnvironmentLoader(
  appRoot: string,
  environmentRoot: string,
): DevelopmentEnvironmentLoader {
  const files = DEVELOPMENT_ENV_FILE_NAMES.map((name) => join(environmentRoot, name));
  const initialContents = files.map(readEnvironmentFile);
  // Both shell exports and Bun-loaded values take precedence over saved settings.
  const protectedKeys = new Set(Object.keys(process.env));

  const stageSettings = (): DevelopmentEnvironmentReload => {
    const settings = readProviderSettingsSync(appRoot);
    const affectedKeys = [MODEL_CONNECTION_ENV, "CORAX_MODEL_KEY_SOURCE"];
    const previousEnvironment = new Map(
      [...affectedKeys].map((key) => [key, process.env[key]] as const),
    );
    let settled = false;
    if (!protectedKeys.has(MODEL_CONNECTION_ENV)) {
      if (settings) process.env[MODEL_CONNECTION_ENV] = settings.selected;
      else delete process.env[MODEL_CONNECTION_ENV];
    }
    if (!protectedKeys.has("CORAX_MODEL_KEY_SOURCE")) {
      if (settings?.keySource) process.env.CORAX_MODEL_KEY_SOURCE = settings.keySource;
      else delete process.env.CORAX_MODEL_KEY_SOURCE;
    }

    return {
      commit() {
        settled = true;
      },
      rollback() {
        if (settled) {
          return;
        }
        settled = true;
        for (const [key, value] of previousEnvironment) {
          if (value === undefined) {
            delete process.env[key];
          } else {
            process.env[key] = value;
          }
        }
      },
    };
  };

  return {
    environmentRoot,
    reload() {
      stageSettings().commit();
    },
    stageReload() {
      // Only rebuilding requires the files to match the startup environment.
      // Credential requests must keep working with that environment until restart.
      if (files.some((path, index) => readEnvironmentFile(path) !== initialContents[index])) {
        throw new Error(
          "Environment files changed. Restart corax dev to load the updated environment.",
        );
      }
      return stageSettings();
    },
  };
}

function readEnvironmentFile(path: string): string | undefined {
  try {
    return readFileSync(path, "utf8");
  } catch (error) {
    if (error !== null && typeof error === "object" && "code" in error && error.code === "ENOENT") {
      return undefined;
    }
    throw error;
  }
}
