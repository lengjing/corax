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
 * Loads project dotenv values and saved settings, preserving the environment
 * inherited before the first load. File-owned values can be reloaded atomically.
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
  const protectedKeys = new Set(Object.keys(process.env));
  const managedValues = new Map<string, string>();

  const stageReload = (): DevelopmentEnvironmentReload => {
    const previousManagedValues = new Map(managedValues);
    const nextValues = readDevelopmentEnvironmentValues(environmentRoot);
    const settings = readProviderSettingsSync(appRoot);
    // Explicit shell and dotenv values outrank persisted interactive choices.
    if (settings && !nextValues.has(MODEL_CONNECTION_ENV)) {
      nextValues.set(MODEL_CONNECTION_ENV, settings.selected);
    }
    if (settings?.keySource && !nextValues.has("CORAX_MODEL_KEY_SOURCE")) {
      nextValues.set("CORAX_MODEL_KEY_SOURCE", settings.keySource);
    }
    const affectedKeys = new Set([...managedValues.keys(), ...nextValues.keys()]);
    const previousEnvironment = new Map(
      [...affectedKeys].map((key) => [key, process.env[key]] as const),
    );
    let settled = false;
    for (const [key, previous] of managedValues) {
      if (!nextValues.has(key)) {
        if (!protectedKeys.has(key) && process.env[key] === previous) delete process.env[key];
        managedValues.delete(key);
      }
    }
    for (const [key, value] of nextValues) {
      if (!protectedKeys.has(key)) {
        process.env[key] = value;
        managedValues.set(key, value);
      }
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
        managedValues.clear();
        for (const [key, value] of previousManagedValues) managedValues.set(key, value);
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
      stageReload().commit();
    },
    stageReload,
  };
}
