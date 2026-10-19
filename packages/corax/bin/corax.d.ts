export interface BootstrapOptions {
  /**
   * Absolute path to the compiled CLI module.
   */
  cliEntrypointPath?: string;

  /**
   * Absolute path to the corax package root.
   */
  packageRoot?: string;

  /**
   * Absolute path to the canonical package build script.
   */
  buildScriptPath?: string;
}

export interface BootstrapCommandOptions {
  cwd: string;
}

export interface BootstrapBuildDependencies {
  exists?: (path: string) => Promise<boolean>;
  getLatestBuildInputMtimeMs?: (input: { packageRoot: string }) => Promise<number>;
  getPathMtimeMs?: (path: string) => Promise<number | undefined>;
  runCommand?: (
    command: string,
    args: readonly string[],
    options: BootstrapCommandOptions,
  ) => Promise<void>;
}

export interface BootstrapCliModule {
  runCli(argv?: string[]): Promise<void>;
}

export interface BootstrapSemverModule {
  default: {
    validRange(range: string | undefined): string | null;
    satisfies(version: string, range: string): boolean;
  };
}

export interface BootstrapDependencies extends BootstrapBuildDependencies {
  importBootstrapModule?: (specifier: string) => Promise<BootstrapSemverModule>;

  importModule?: (specifier: string) => Promise<BootstrapCliModule>;

  /**
   * Bun version string used by tests to exercise the bin version guard.
   */
  bunVersion?: string;

  /**
   * Bun engine range used by tests to exercise non-default package contracts.
   */
  bunEngineRequirement?: string;
}

/**
 * Ensures the compiled CLI entrypoint exists before the workspace bin is executed.
 */
export function ensureBuiltCli(
  overrides?: BootstrapOptions,
  dependencies?: BootstrapBuildDependencies,
): Promise<string>;

/**
 * Runs the compiled corax CLI, building the workspace package on demand when needed.
 */
export function runCoraxCli(
  argv?: string[],
  overrides?: BootstrapOptions,
  dependencies?: BootstrapDependencies,
): Promise<void>;

/** Runs the CLI, flushes output, and exits after command shutdown completes. */
export function main(argv?: string[]): Promise<never>;
