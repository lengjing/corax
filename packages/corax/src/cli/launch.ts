import { stat } from "node:fs/promises";
import { join, resolve } from "node:path";
import { parseEnv } from "node:util";

/** Values the CLI needs before the framework loads the project's environment files. */
export interface CliLaunchContext {
  readonly root: string;
  readonly host: string;
  readonly port: number | undefined;
}

const DEFAULT_HOST = "127.0.0.1";
const LAUNCH_ENV_KEYS = ["CORAX_DATA_DIR", "CORAX_HOST", "CORAX_PORT"] as const;

/**
 * Pulls `--root` out of argv before Commander runs so every project-scoped
 * command, the working directory and the data directory agree on one root.
 */
export function extractRootOption(argv: readonly string[]): { args: string[]; root: string } {
  let root = process.cwd();
  const args: string[] = [];
  for (let index = 0; index < argv.length; index++) {
    const arg = argv[index]!;
    if (arg === "--root") {
      const value = argv[++index];
      if (!value || value.startsWith("-")) throw new Error("--root requires a project directory.");
      root = resolve(value);
    } else if (arg.startsWith("--root=")) {
      const value = arg.slice("--root=".length);
      if (!value) throw new Error("--root requires a project directory.");
      root = resolve(value);
    } else {
      args.push(arg);
    }
  }
  return { args, root };
}

/**
 * Resolves the project root, applies `CORAX_*` launch defaults and switches
 * the process into the project so relative runtime paths resolve there.
 *
 * Only the launch keys are read from `.env` here; the framework loads the full
 * environment file set later (and reloads it in dev), so file-owned values stay
 * refreshable. Process environment always wins over the file.
 */
export async function prepareCliLaunch(input: {
  readonly args: readonly string[];
  readonly root: string;
}): Promise<CliLaunchContext> {
  const { root } = input;
  if (!(await isDirectory(root))) throw new Error(`Not a project directory: ${root}`);

  const help = input.args.includes("--help") || input.args.includes("-h");
  const command = input.args[0];
  if (!help && (command === "dev" || command === "build")) {
    if (!(await Bun.file(join(root, "agent.ts")).exists())) {
      throw new Error(`Missing ${join(root, "agent.ts")}. Point --root to your agent project.`);
    }
  }

  const fileValues = await readLaunchEnvFile(root);
  const value = (key: (typeof LAUNCH_ENV_KEYS)[number]) => process.env[key] || fileValues[key];

  process.env.CORAX_CONFIG_ROOT = root;
  process.env.CORAX_DATA_DIR = resolve(root, value("CORAX_DATA_DIR") || "data");
  process.chdir(root);

  const portValue = value("CORAX_PORT");
  const port = portValue ? Number.parseInt(portValue, 10) : undefined;
  if (portValue && (!Number.isInteger(port) || port! < 0 || port! > 65_535)) {
    throw new Error(`CORAX_PORT must be a port number, received "${portValue}".`);
  }

  return { root, host: value("CORAX_HOST") || DEFAULT_HOST, port };
}

async function readLaunchEnvFile(root: string): Promise<Record<string, string | undefined>> {
  const file = Bun.file(join(root, ".env"));
  if (!(await file.exists())) return {};
  const parsed = parseEnv(await file.text()) as Record<string, string | undefined>;
  return Object.fromEntries(LAUNCH_ENV_KEYS.map((key) => [key, parsed[key]]));
}

async function isDirectory(path: string): Promise<boolean> {
  try {
    return (await stat(path)).isDirectory();
  } catch {
    return false;
  }
}
