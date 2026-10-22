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
 * Loads or reloads the project's env files on top of Bun's own `.env`
 * loading. Variables set by the parent process keep precedence; file-owned
 * variables refresh on subsequent reloads so dev-mode file watching can pick
 * up changed values.
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
  /** The env files as of the last load; a variable still carrying its entry is file-owned. */
  let fileValues: ReadonlyMap<string, string> = new Map();

  const stageReload = (): DevelopmentEnvironmentReload => {
    const previousFileValues = fileValues;
    const nextValues = readDevelopmentEnvironmentValues(environmentRoot);
    const settings = readProviderSettingsSync(appRoot);
    const affectedKeys = new Set([
      ...previousFileValues.keys(),
      ...nextValues.keys(),
      MODEL_CONNECTION_ENV,
      "CORAX_MODEL_KEY_SOURCE",
    ]);
    const previousEnvironment = new Map(
      [...affectedKeys].map((key) => [key, process.env[key]] as const),
    );
    let settled = false;
    if (settings) process.env[MODEL_CONNECTION_ENV] = settings.selected;
    else delete process.env[MODEL_CONNECTION_ENV];
    const keySource = settings?.keySource;
    if (keySource) process.env.CORAX_MODEL_KEY_SOURCE = keySource;
    else delete process.env.CORAX_MODEL_KEY_SOURCE;

    applyDevelopmentEnvironmentValues(previousFileValues, nextValues);
    fileValues = nextValues;

    return {
      commit() {
        settled = true;
      },
      rollback() {
        if (settled) {
          return;
        }
        settled = true;
        fileValues = previousFileValues;
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

/**
 * Applies the env files with dotenv precedence: a variable the parent process
 * set — one whose value is not what the files last provided — is never
 * overridden, while file-owned variables follow edits and clear when their
 * entry disappears. Bun already loads these files into `process.env` before
 * any code runs, so the first load after Bun changes nothing; a launch from a
 * subdirectory, which Bun does not read, fills in the project's values.
 */
function applyDevelopmentEnvironmentValues(
  previous: ReadonlyMap<string, string>,
  next: ReadonlyMap<string, string>,
): void {
  const fileOwned = (key: string): boolean => {
    const current = process.env[key];
    return current === undefined || current === previous.get(key);
  };

  for (const key of previous.keys()) {
    if (!next.has(key) && fileOwned(key)) delete process.env[key];
  }
  for (const [key, value] of next) {
    if (fileOwned(key)) process.env[key] = value;
  }
}
